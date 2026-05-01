---
topic: api
related-files:
  - source/api/ApiClient.bs
  - source/api/apiPool.bs
  - source/api/baseRequest.bs
  - source/api/image.bs
  - source/api/imageHelpers.bs
  - components/api/ApiTask.bs
  - components/api/ApiQueueTask.bs
  - components/api/ApiResultNode.xml
  - components/api/SideEffectTask.bs
last-reviewed: 2026-05-01
---

# API Layer & Task Pool

How JellyRock talks to Jellyfin: the layered API model, the persistent task pool, and the four call patterns.

## Why this is harder than it sounds

Roku has a hard rule: anything that does I/O **must not run on the render thread**, or the UI freezes. All HTTP requests therefore have to run on a Task thread (an `roSGNode` of type `Task` with a `functionName` that runs in a separate BrightScript interpreter).

Naive implementations spawn a new Task per request. That's slow (Task creation is expensive on Roku) and gets tangled when many UI components want to fetch in parallel. JellyRock instead runs a **persistent pool** of three Task threads, with a FIFO coordinator that dispatches requests into them. The coordinator and its result vehicles are designed to be immune to SceneGraph's event-coalescing quirks (which can silently drop events when multiple writers hit the same field).

This is one of the more clever pieces of the codebase. It mostly Just Works once you understand the shape.

## The 3-layer API model

Application code talks to the API at one of three layers, depending on need:

```text
Layer 3 — Domain helpers      ← typed wrappers; one-call solutions for common needs
  source/api/imageHelpers.bs  ← GetPosterURLFromItem(item) with full fallback chain
                              ↓
Layer 2 — Business logic       ← validation, defaults, error degradation
  source/api/image.bs          ← ImageURL(id, type, params) — validates tag, returns ""
                                  on failure rather than building an invalid URL
  source/api/userAuth.bs
  source/api/items.bs
                              ↓
Layer 1 — Smart API client     ← singleton, auto-injects defaults, routes V1/V2
  source/api/ApiClient.bs      ← class ApiClient. GetApi() returns the singleton.
                                  Build*Request() methods return request AAs.
                              ↓
Underlying ────────────────── source/api/sdk.bs        ← thin endpoint wrappers (legacy)
                              source/api/sdkV1.bs     ← Jellyfin 10.7–10.8 endpoints
                              source/api/sdkV2.bs     ← Jellyfin 10.9+ endpoints
                              source/api/baseRequest.bs ← buildURL(), buildAuthHeader(), buildParams()
```

### Layer 1 — `ApiClient` (`source/api/ApiClient.bs`)

A singleton class. Get it via `GetApi()`. Methods come in two flavors:

**Build*Request() methods** return a request AA — `{ method, url, body? }` — for use with the task pool. **This is the modern, preferred pattern.**

```brightscript
req = GetApi().BuildGetItemRequest(itemId, { fields: "Overview,Genres" })
res = fetchRes(req, "myUniqueRequestId")    ' executes on task pool
if isValid(res) and res.ok then item = res.json
```

Internally, `Build*Request` methods:

- Inject the current user ID (`m.global.user.id`) into requests that need it
- Apply image defaults (`EnableImageTypes: "Primary,Backdrop,Logo,Thumb"`, `ImageTypeLimit: 1`)
- Route between V1 and V2 endpoints based on `getApiVersionFromGlobal()` (which reads `m.global.server.apiVersion`)
- Return `invalid` if there's no user (so callers don't have to null-check globals)

Example of V1/V2 routing (one method shown — the same pattern repeats per endpoint; canonical source: `source/api/ApiClient.bs`):

```brightscript
function BuildGetItemRequest(itemId as string, params = {} as object) as dynamic
  userId = m.getUserId()
  if userId = "" then return invalid

  if m.getApiVersion() >= 2
    mergedParams.userId = userId
    return m.validatedReq("GET", buildURL(Substitute("/Items/{0}", itemId), mergedParams))
  end if
  return m.validatedReq("GET", buildURL(Substitute("/users/{0}/items/{1}", userId, itemId), mergedParams))
end function
```

**Legacy synchronous methods** (`Get*` without `Build`) execute the HTTP synchronously on the calling thread. They exist for the bootstrap path (login, server discovery) where the pool isn't running yet, and for pre-pool legacy code that hasn't been migrated. **Don't add new sync calls.**

### Layer 2 — Business logic (`image.bs`, `userAuth.bs`, `items.bs`)

Adds validation, defaults, and graceful degradation on top of Layer 1. Image URL building is the canonical example:

```brightscript
function ImageURL(id, version, params) as string
  ' Validates tag, validates id, returns "" if either is missing.
  ' Applies standard image dimension defaults.
  ' Builds the URL via Layer 1's GetImageURL.
end function
```

Returning empty string on failure is the consistent pattern — the caller can pass it to a Roku Poster's `uri` field which silently shows nothing, rather than triggering a 404.

### Layer 3 — Domain helpers (`imageHelpers.bs`)

One-call solutions for common product needs. The poster URL helper has a full fallback chain:

```brightscript
function GetPosterURLFromItem(item, maxHeight=440, maxWidth=295) as string
  ' 1. Item's primary image
  ' 2. Item's thumb image
  ' 3. Parent's primary image (for episodes)
  ' 4. Parent's thumb
  ' 5. Series primary image (for episodes)
  ' 6. Backdrop (last resort)
end function
```

This is usually what UI components want to call. It encapsulates "what's a sensible image to show for this item?" without making every consumer re-implement the chain.

Equivalent helpers exist for backdrops (`GetBackdropURLFromItem`) and logos (`GetLogoURLFromItem`).

### Picking a layer

`docs/dev/api-layering-guide.md` has the canonical decision tree. Short version:

- **Need a poster/backdrop/logo URL** → Layer 3 (`imageHelpers.bs`)
- **Need a custom image URL** → Layer 2 (`image.bs.ImageURL`)
- **Need to call any other API endpoint** → Layer 1 (`GetApi().Build*Request()` + task pool)
- **Need to add a new endpoint** → add a `Build*Request()` method to ApiClient, route through V1/V2 if needed

## The task pool — the piece that makes async safe

The pool consists of:

```brightscript
m.global.apiPool0, apiPool1, apiPool2    3 × ApiTask Task nodes (workers)
m.global.apiQueue                         1 × ApiQueueTask Task node (FIFO coordinator)
m.global.sideEffectTask                   1 × SideEffectTask Task node (fire-and-forget)
                                          per-request: ApiResultNode (data vehicle)
```

All four Task nodes are created in `setGlobalNodes()` (in `globals.bs`) and live for the entire app lifetime. Each is a continuously-running infinite loop (`while true / wait(0, port)`) that processes work as it arrives.

### How a request flows

```brightscript
Caller (any Task thread)
  │
  │   req = GetApi().BuildGetItemRequest(itemId)
  │   res = fetchRes(req, "uniqueId")             ← blocks calling thread
  │
  ▼
fetchRes() in source/api/apiPool.bs
  │
  │  1. Wait for apiQueue.isReady (one-time startup gate)
  │  2. Create an ApiResultNode (one per request)
  │  3. Append it as a CHILD of m.global.apiQueue ← key insight: children don't coalesce
  │  4. Set apiQueue.enqueue = "uniqueId"        ← wakeup signal
  │  5. wait(timeout, port) for resultNode's "done" event
  │
  ▼
ApiQueueTask.runQueueLoop() (Task thread)
  │
  │  1. Wakes up on enqueue or child append
  │  2. Reads ALL unprocessed children since m.processedIndex
  │  3. For each, finds a free pool slot (m.inFlight[i] = invalid)
  │  4. Writes the request AA to apiPool<i>.request   ← dispatch
  │  5. Marks slot as in-flight
  │
  ▼
ApiTask<i>.runApiLoop() (Task thread)
  │
  │  1. Observer fires on .request field
  │  2. executeRequest(req) — runs HTTP via roku-requests
  │  3. Writes response AA to .response
  │
  ▼
ApiQueueTask sees .response written
  │  6. Routes the response back to the originating ApiResultNode (.result, .isDone = true)
  │  7. Marks slot free
  │
  ▼
fetchRes() wakes up on done event
  │  Returns resultNode.result to the original caller
```

### The coalescing problem (why children, not fields)

SceneGraph can **coalesce port events** when multiple Task threads write to the same field in rapid succession. If three orchestrator tasks all `apiQueue.request = ...` at the same instant, the coordinator might wake up only once and see the most recent write — silently dropping two requests.

The fix: instead of writing requests to a shared field, **append `ApiResultNode` children** to the coordinator. SceneGraph never coalesces child appends. Even if the wakeup-signal events coalesce, the coordinator reads *all* unprocessed children (`m.processedIndex` tracks how far it's gotten), so no request is ever lost.

This is documented in detail at the top of `components/api/ApiQueueTask.bs`. It's worth reading if you ever need to debug a "the request just disappeared" issue.

### The startup ordering problem

If `fetchRes()` writes to a pool slot's `.request` field *before* that slot has called `observeField("request", port)`, the write is silently dropped. The slot would then sit forever waiting for an event that already happened.

The fix is a three-step ready cascade:

1. Each `ApiTask` slot sets `m.top.isReady = true` only **after** registering its request observer.
2. `ApiQueueTask` waits for all 3 pool slots to be ready before registering its own observers and setting **its own** `isReady = true`.
3. `fetchRes()` waits for `apiQueue.isReady` before appending any children.

This eliminates the startup race. After the first request, the `isReady` check is just a single field read.

### `ApiResultNode` — `components/api/ApiResultNode.xml`

A trivial component with three fields:

```xml
<component name="ApiResultNode" extends="Node">
  <interface>
    <field id="request" type="assocarray" />     <!-- inbound -->
    <field id="result"  type="assocarray" />     <!-- outbound -->
    <field id="isDone"  type="boolean" value="false" />
  </interface>
</component>
```

One per request. Created by `fetchRes()`, appended to the queue, written to by the coordinator, observed by the caller, then garbage-collected.

## The 4 API call patterns

### Pattern 1 — `fetchRes` / `fetchJson` (blocking, from a Task thread)

For the common case: an orchestrator Task that needs one or more API responses to assemble its data.

```brightscript
sub runOrchestrator()
  itemReq = GetApi().BuildGetItemRequest(m.top.itemId)
  res = fetchRes(itemReq, "loadItem-" + m.top.itemId)
  if isValid(res) and res.ok
    m.top.result = res.json
  end if
end sub
```

This blocks the *Task* thread (not the render thread!) for up to `timeouts.API_WAIT_MS` (currently 12 seconds; the canonical value lives in `source/constants/timeouts.bs`). Concurrent calls from multiple Task threads are safe — each gets its own `ApiResultNode`.

`fetchJson(req, id)` is a convenience wrapper that returns just `res.json` (or `invalid` on timeout/HTTP error).

### Pattern 2 — `submitApiRequest` (non-blocking, from render thread)

For one-off fire-and-respond from the render thread (e.g., user clicks a button → fire a single API call → toggle a UI state on response).

```brightscript
sub onFavoriteButtonPressed()
  req = GetApi().BuildToggleFavoriteRequest(itemId)
  m.favoriteResultNode = submitApiRequest(req, "favorite-toggle")
  m.favoriteResultNode.observeField("isDone", m.port)
end sub

' In main.bs event loop:
else if isNodeEvent(msg, "isDone")
  resultNode = msg.getRoSGNode()
  if resultNode.isSameNode(m.favoriteResultNode)
    handleFavoriteToggleDone()
  end if
```

The render thread does microseconds of work (create node, append, set wakeup field) and returns. The actual HTTP runs on a pool slot. The callback fires on the render thread when done.

**Don't use this when the callback needs data transforms or array processing** — those belong on a Task thread (use Pattern 1 from an orchestrator).

### Pattern 3 — `SubmitSideEffect` (fire-and-forget POST/DELETE)

For requests where you don't need the response: telemetry, playback reporting, mark-watched, mark-favorite.

```brightscript
sub ReportPlayback(state as string)
  req = GetApi().BuildPlaystateRequest(state, params)
  SubmitSideEffect(req)            ' returns immediately
end sub
```

Goes through the single `m.global.sideEffectTask` (not the pool). Calls are serialized — a slow side-effect can delay the next one. Don't use this for cancellable UI requests.

### Pattern 4 — Dedicated Task with raw `roUrlTransfer`

For non-Jellyfin HTTP (e.g., font downloads, image fetches that need special handling, or the SSDP server discovery during login). Write a dedicated `Task` component, do the request inline with `wait(port)`, write to the output field.

Examples in the codebase: `FontDownloadTask`, `ServerDiscoveryTask`, `LoadPhotoTask` (for some flows).

## Authentication & request building — `source/api/baseRequest.bs`

`baseRequest.bs` provides the low-level helpers used everywhere:

- **`buildURL(path, params)`** — concatenates `m.global.server.serverUrl` + `path` + `?<encoded params>`
- **`buildParams(params)`** — converts an AA into a URL-encoded query string with type-aware encoding (string/integer/float/longinteger/array/boolean/null)
- **`buildAuthHeader()`** — returns the `Authorization` header value: `MediaBrowser Token="..."`, includes Token, Client, Device, DeviceId, Version

Every `ApiTask` execution prepends the auth header automatically:

```brightscript
function executeRequest(req as object) as object
  headers = { Authorization: buildAuthHeader() }
  if isValid(req.headers) and type(req.headers) = "roAssociativeArray"
    headers.append(req.headers)
  end if
  ' ...HTTP via roku-requests with these headers
end function
```

So callers building requests don't need to remember to attach auth — it's automatic at the pool level.

## V1 vs V2 dispatch

Jellyfin's API changed shape between **10.8** (V1) and **10.9+** (V2). Many endpoints moved or restructured: e.g., `/users/{userId}/items/{itemId}` (V1) → `/Items/{itemId}?userId={userId}` (V2).

JellyRock supports both. The dispatch is per-method inside `ApiClient`:

```brightscript
if m.getApiVersion() >= 2
  ' V2 endpoint
else
  ' V1 endpoint
end if
```

`getApiVersionFromGlobal()` (in `misc.bs`) reads `m.global.server.apiVersion`, which is set during login from the server's `/System/Info/Public` response. There's a comment in `ApiClient.bs` indicating "When adding V3 support, add else-if branch in each method below" — the design accommodates future versions, but the dispatch is per-method (no centralized routing table).

`docs/dev/jellyfin-server-versioning.md` has the canonical version-policy guide.

## Cruft callouts

- **Two ways to call the same thing.** `ApiClient` has both `Get*()` (sync) and `Build*Request()` (async pool) methods for many endpoints. The migration to pool-only is ongoing. Sync methods are flagged in code with comments but not removed because the bootstrap path (login, server info) still needs them. Eventually the pool should be available pre-login and these can be unified.
- **`source/api/sdk.bs` namespace is mostly legacy.** Per its own header comment: "Only used by ApiClient (via GetApi()). Do NOT call these functions directly." Some callers still bypass ApiClient and call `sdk.<namespace>.<function>` directly. These should be migrated.
- **No request cancellation.** A `submitApiRequest` that's no longer needed (e.g., user navigated away) can't be cancelled — it'll complete and fire its callback regardless. Most callers handle this by checking "am I still the active screen?" in the callback, but that's defensive at the call site.
- **Per-method V1/V2 branching.** Adding a third API version means editing every Build method. A central routing table (path templates per version) would scale better, but the current shape is explicit and grep-able, which has its own merits.
- **`buildParams` doesn't handle `roArray` values.** Has a `' TODO handle array params` comment. Workaround: callers join arrays into comma-separated strings before passing.
- **API timeout is a single value.** `timeouts.API_WAIT_MS` is one number for all API calls. A long search vs. a quick favorite toggle have the same patience.
