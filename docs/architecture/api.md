---
topic: api
related-files:
  - source/api/ApiClient.bs
  - source/api/apiPool.bs
  - source/api/apiPipeline.bs
  - source/api/apiResponse.bs
  - source/constants/apiPool.bs
  - source/api/baseRequest.bs
  - source/api/apiTimeout.bs
  - source/api/image.bs
  - source/api/imageHelpers.bs
  - components/api/ApiTask.bs
  - components/api/ApiQueueTask.bs
  - components/api/ApiResultNode.xml
  - components/api/SideEffectTask.bs
  - components/home/LoadLatestRowsTask.bs
last-reviewed: 2026-09-25
---

# API Layer & Task Pool

How JellyRock talks to Jellyfin: the layered API model, the persistent task pool, and the five call patterns.

## Why this is harder than it sounds

Roku has a hard rule: anything that does I/O **must not run on the render thread**, or the UI freezes. All HTTP requests therefore have to run on a Task thread (an `roSGNode` of type `Task` with a `functionName` that runs in a separate BrightScript interpreter).

Naive implementations spawn a new Task per request. That's slow (Task creation is expensive on Roku) and gets tangled when many UI components want to fetch in parallel. JellyRock instead runs a **persistent pool** of Task threads — four on 512 MB devices, six on everything else (see [Pool width](#pool-width)) — with a FIFO coordinator that dispatches requests into them. The coordinator and its result vehicles are designed to be immune to `SceneGraph`'s event-coalescing quirks (which can silently drop events when multiple writers hit the same field).

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

**Build*Request() methods** return a request AA — `{ method, url, body?, expect? }` — for use with the task pool. **This is the modern, preferred pattern.**

```brightscript
req = GetApi().BuildGetItemRequest(itemId, { fields: "Overview,Genres" })
res = fetchRes(req, "myUniqueRequestId")    ' executes on task pool
if isValid(res) and res.ok then item = res.json
```

Internally, `Build*Request` methods:

- Inject the current user ID (`m.global.user.id`) into requests that need it
- Apply image defaults (`EnableImageTypes: "Primary,Backdrop,Logo,Thumb"`, `ImageTypeLimit: 1`)
- Route between `V1` and `V2` endpoints based on `getApiVersionFromGlobal()` (which reads `m.global.server.apiVersion`)
- Return `invalid` if there's no user (so callers don't have to null-check globals)
- Mark a bare-array endpoint's request `expect: "list"` (`listReq`), so the pool holds its body to that shape — see [Reading a list endpoint's body](#reading-a-list-endpoints-body--sourceapiapiresponsebs)
- **May REFUSE to build a request that would be unsafe, and may take a domain object instead of an id in order to check.** This is a second, narrower meaning of the `invalid` return above: not "I lack a prerequisite" but "I will not build this". `BuildDeleteSubtitleRequest(itemId, stream)` is the reference — it takes the subtitle `MediaStream` rather than a stream index, and returns `invalid` unless `IsExternal` is explicitly `true`, because the server deletes `MediaStream.Path` unconditionally and an embedded subtitle's path is the media container. Put a safety rule here, once, when getting it wrong destroys user data; a rule stated in prose for callers to honor is not a guard, and callers already treat an `invalid` request as "cannot do this", so a refusal degrades into an inert control rather than a crash.

Example of `V1/V2` routing (one method shown — the same pattern repeats per endpoint; canonical source: `source/api/ApiClient.bs`):

```brightscript
function BuildGetItemRequest(itemId as string, params = {} as object) as dynamic
  userId = m.getUserId()
  if userId = "" then return invalid

  mergedParams = m.injectDefaults(params)

  if m.getApiVersion() >= 2
    mergedParams.userId = userId
    return m.validatedReq("GET", buildURL(Substitute("/Items/{0}", itemId), mergedParams))
  end if
  return m.validatedReq("GET", buildURL(Substitute("/users/{0}/items/{1}", userId, itemId), mergedParams))
end function
```

**Legacy synchronous methods** (`Get*` without `Build`) execute the HTTP synchronously on the calling thread. Five remain, all on the bootstrap path (login, server discovery). **Don't add new sync calls.**

Their reason is narrower than "the pool isn't running yet", which is what this section used to say and is not true: `setGlobalNodes()` starts the pool in `Main()` *before* the login flow, and `UserSelect` has been issuing pre-login `fetchAsync` calls since #551. The real constraint is that `fetchAsync` registers a **named render-thread observer**, which Roku dispatches only inside a SceneGraph component — and `main.bs` / `source/loginRouter.bs` run on the MAIN thread, where named observers never fire.

So migrating one of the survivors is not a pool problem, it is a **call-site** problem: move the request into the render-thread component that wants the answer, and hand the coordinator only the finished result. Quick Connect is the worked example (#288 phase 4) — its three endpoints became `Build*Request` builders driven from `UserSelect` as promises, while `user.Login()` stayed on the main thread because it reads and writes the registry. See [`apiclient-sync-pool-coexistence`](tech-debt.md#apiclient-sync-pool-coexistence).

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
- **Need to add a new endpoint** → add a `Build*Request()` method to `ApiClient`, route through `V1/V2` if needed

## The task pool — the piece that makes async safe

The pool consists of:

```brightscript
m.global.apiPool0 … apiPool<N-1>         N × ApiTask Task nodes (workers), N = m.global.apiPoolWidth
m.global.apiQueue                         1 × ApiQueueTask Task node (FIFO coordinator)
m.global.sideEffectTask                   1 × SideEffectTask Task node (fire-and-forget)
                                          per-request: ApiResultNode (data vehicle)
```

All of these Task nodes are created in `setGlobalNodes()` (in `globals.bs`) and live for the entire app lifetime. Each is a continuously-running infinite loop (`while true / wait(0, port)`) that processes work as it arrives.

### Pool width

How many slots the coordinator can dispatch to at once ([ADR 0036](../adr/0036-api-pool-width-by-device-class.md)). It is chosen **once, at startup, by device class** — `apiPool.widthFor(m.global.device.isLowMemoryDevice)` in [`source/constants/apiPool.bs`](../../source/constants/apiPool.bs) — and stored as `m.global.apiPoolWidth`, which `ApiQueueTask` and `apiPipeline` read (`apiPool.currentWidth()`).

| Device class | Width | Why |
|---|---|---|
| Low-memory (512 MB, the `LOW_MEMORY_DEVICE_PREFIXES` list in `globals.bs`) | **4** | On a slow connection it already gets the device's whole speedup; wider gains nothing and, on a moderate connection, makes Home's first rows appear later |
| Everything else | **6** | Keeps cutting Home's full-load time on slow connections, costs nothing on fast ones, and matches the six connections per server a browser opens — the load Jellyfin's own web client already generates |

**What the width buys.** Home issues one request per row; with more rows than slots, requests queue, and on a slow connection the queue is the wait. Measured on Home (11 libraries, 16 rows) through a proxy that delays every response, widths 3 / 4 / 6 / 8, n = 10 per cell (30 on the 512 MB device at +150 ms), full-load time vs width 3:

| Device | +0 ms | +150 ms (4 / 6 / 8) | +400 ms (4 / 6 / 8) |
|---|---|---|---|
| Streaming Stick 4K (1 GB) | no significant difference | −18 % / −18 % / −22 % | −16 % / −23 % / −28 % |
| Ultra `4850X` (2 GB) | no significant difference | −18 % / −21 % / −27 % | −21 % / −30 % / −30 % |
| Streaming Stick `3600X` (512 MB) | no significant difference | −4 % / −1 % / −2 %; first paint +12 % later at 6 and at 8 | −12 % / −12 % / −13 % |

No comparison where a wider width was worse survives a Holm correction across the sweep's 54 comparisons. The 512 MB first-paint delay at +150 ms is acted on anyway, because it was predicted before the run and appeared at the same size three times (width 6 in an earlier run, +15 %; widths 6 and 8 here, +12 % each, raw p = 0.03 and 0.13). The one other raw p < 0.05 — width 4 at +0 ms on the same device, +10 % — was not predicted, contradicts widths 6 and 8 there (both faster), and is about what 54 comparisons produce by chance.

**Why not wider than 6 on fast devices.** Width 8 beat 6 by 0–7 %, never significantly, and above 6 the app would send more concurrent requests than the web client does over plain HTTP — a server-load question nothing here measured. **Why not one number.** The 512 MB device pays a first-paint cost at 6 and gains nothing from it. **Why not by connection speed or library count.** No width hurt on a fast connection, so there is nothing to switch off; and the coordinator only uses as many slots as there are queued requests, so a small library leaves the extra slots idle.

**Changing it.** Each slot is its own guarded block in `setGlobalNodes()` (no loop — `no-task-fanout`), up to 6, so any width from 1 to 6 is a constants change; above 6 needs more blocks. `ApiQueueTask` checks the created slots against `apiPoolWidth` at startup and logs an error in either direction, and `tests/source/unit/constants/apiPool.spec.bs` pins both values. Measure on device before changing either (`npm run measure`) — and note that a width is a thread for the whole session: the peak live-thread count is gated by `tests/rta/specs/task-thread-peak.spec.js`.

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
  │  2. executeRequest(req) — runs HTTP via roku-requests, then holds a list
  │     request's body to its shape (apiResponse.enforceShape)
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
2. `ApiQueueTask` waits for every pool slot to be ready before registering its own observers and setting **its own** `isReady = true`.
3. `fetchRes()` waits for `apiQueue.isReady` before appending any children.

This eliminates the startup race. After the first request, the `isReady` check is just a single field read.

### `ApiResultNode` — `components/api/ApiResultNode.xml`

A small component: three fields that carry the request and its answer, and two that say whether anyone is still waiting for it:

```xml
<component name="ApiResultNode" extends="Node">
  <interface>
    <field id="request" type="assocarray" />     <!-- inbound -->
    <field id="result"  type="assocarray" />     <!-- outbound -->
    <field id="isDone"  type="boolean" value="false" />
    <field id="owner"   type="node" />               <!-- the waiting Task, if any -->
    <field id="abandoned" type="boolean" value="false" />
  </interface>
</component>
```

One per request. Created by `fetchRes()`, appended to the queue, written to by the coordinator, observed by the caller, then garbage-collected.

### A request nobody is waiting for

Callers stop listening all the time: `replaceTask()` STOPs a Task that is blocked in `fetchRes`, a component's promises are abandoned at teardown, a pipeline run ends early, a caller times out. Before 2026-09-22 each of those left its request in the FIFO queue, where it was still dispatched and held a slot for as long as the server took — so on a slow server a burst of replaced runs (Search starts a new `SearchTask` per keystroke) queued the request the user *was* waiting for behind ones nobody would read.

So at dispatch the coordinator asks `apiPoolNextDispatch()` ([`apiPool.bs`](../../source/api/apiPool.bs)) what to do with each entry, and it calls `settleIfCallerGone()` for the ones worth checking. A queued **read** whose caller is gone — `abandoned` set by the caller, or an `owner` Task that is no longer running (`taskThreadIsLive()`) — is completed with `error: apiResponse.ERROR_ABANDONED` and never reaches a slot, which stays free for the next entry. Four rules hold it safe and affordable:

- **Only reads are skipped.** A GET or HEAD, or a POST that declares `skippable: true` because it only reads (`BuildGetLiveTvScheduleRequest`). A POST or DELETE is something the user asked for — a favorite, a recording, a delete — so it runs even though the screen moved on, and in FIFO order, so a run of toggles ends where the user left it. `BuildPostPlaybackInfoRequest` is not marked: it sends `AutoOpenLiveStream`, which can open a live stream on the server.
- **Only a request that WAITED for a slot is checked.** The check costs up to three crossings to the render thread, on the serial path every request takes — measured at 7796 µs per request when every entry was checked, against 88 µs when only waited ones were (Stick 4K, Home load, 2026-09-22; the table and method are in [ADR 0040](../adr/0040-pool-skips-abandoned-reads.md)). A request that finds a free slot on arrival goes out in the same breath, so its caller cannot have gone anywhere, and on a 6-wide pool against a healthy server that is *every* request: 0 of 96 waited. Take the numbers again with `npm run measure -- --measurement api-dispatch`.
- **Only Task-thread callers record an owner** — `fetchRes`, and `submitApiRequest` with a port (the pipeline). A render-thread caller marks `abandoned` itself instead, so a request can never be skipped because some unrelated node stopped.
- **`owner` is dropped only where it is known dead** — on the skip path. A dispatched entry's owner is by definition still waiting for the answer, and clearing it would cost a crossing on the path every request takes; the node lets it go when the coordinator's 50-child prune lets the node go.

The rules are pinned in [`apiPoolSkip.spec.bs`](../../tests/source/unit/api/apiPoolSkip.spec.bs).

#### A long request already on a slot

Skipping only helps a request still in the queue. A request that asks for a long HTTP limit — a library grid's page, which gets `timeouts.GRID_PAGE_MS` because a slow server can take ~40 s to answer it — would otherwise hold its slot for up to a minute after the user backed out. So when the coordinator **sends** a request that `apiRequestIsStoppable()` (a read with a longer-than-default limit), `watchCaller()` subscribes to the waiting Task's `state`; if the Task stops before the answer arrives, `stopSlot()` sets the slot's `quit` field. `roku-requests` reads `m.top.quit` on every pass of its wait loop and cancels the transfer when it is true, so the slot answers "no answer" and is free again: measured 2026-09-25 on a 512 MB Stick against a slow 10.11.11 server, the slot ended its transfer 139 ms after the stop and took the next request at once. The coordinator clears `quit` before it sends that slot anything else. Why, and what was ruled out: [ADR 0043](../adr/0043-pool-stops-long-reads-of-gone-callers.md).

- **Only long requests are watched.** Reading the waiting Task and subscribing to it cost 0.5–1.0 ms each on the coordinator (same device and date), on the serial path every request takes, and a request with the default limit frees its slot within `timeouts.HTTP_MS` anyway. The decision comes from the request AA alone, so every other request pays nothing.
- **Subscribe, then read once.** A Task that stopped between the enqueue and the subscription sends no event; the read after subscribing catches it.
- **`stop` also means "finished".** A Task that returns normally reports `stop` too, but only after its answer was delivered, and delivery ends the watch (`forgetCaller()`), so it matches no slot (`apiPoolSlotWatchedBy()`).
- **The watch uses `unobserveField`, which drops every observer of the field.** Nothing else observes a Task's `state` — the task ledger reads it instead, by design ([`tasks.bs`](../../source/utils/tasks.bs)) — and the scoped pair that would drop only this one needs Roku OS 12.

Only reads, for the same reason as skipping. A render-thread caller has no waiting Task to watch, so a long request made from the render thread would not be stopped; none exists today. The rules are pinned in [`apiPoolStop.spec.bs`](../../tests/source/unit/api/apiPoolStop.spec.bs), and the behavior end to end in the `slow-library` RTA spec.

**`roku-requests` polls `quit` without sleeping.** Its wait loop calls `GetMessage()` and reads `m.top.quit` on every pass, and because the slot's node is render-owned each read is a rendezvous with the render thread. Measured 2026-09-25 on a 512 MB Stick, 60 requests: 98.7% of the loop's time was spent inside that read, about 270 µs per pass against a fast local server and up to 469 ms for a single read while Home was building. This predates the stop — the read ran against a field that did not exist — and replacing the loop is tracked separately.

### A request a test makes fail or slow (RTA builds only)

On-device specs need a screen's failure and slow-server paths against a healthy, fast server, so RTA builds (`ENABLE_RTA`) let a spec make chosen requests fail or answer slowly. The coordinator holds the rules from `m.global.rtaFailRequests`, reading the field only when a spec writes it, and checks each request as it takes it off its children (`processNewChildren` → `answeredOnPurpose`). A failure is answered at once and never reaches a slot. The answer is the one the pool itself delivers for that failure, built by [`apiFaults.responseFor()`](../../source/api/apiFaults.bs): a `roku-requests` timeout is `ok = false` with no `statusCode` or body, and an HTTP failure keeps its status. Nothing marks it as injected, because code that could tell the two apart could handle a test failure differently from a real one.

A slow request (`kind: "slow"`, `ms`) is sent like any other, and its real answer is held until `ms` after it was sent (`heldOnPurpose`). Its slot stays in flight until then, because a slow server's cost to the app includes the pool slot it occupies — the thing a screen that abandons a slow load must be able to give back. While an answer is held, the loop waits only until the earliest is due (`apiFaults.nextWaitMs`) instead of indefinitely. A held request that is stopped ([above](#a-long-request-already-on-a-slot)) gives its slot back at once, as a stopped real one does (`releaseHeldOnPurpose`), and `m.global.rtaHeldRequests` counts the answers held, so a spec can see a request is on a slot before acting and see the slot come back.

The check decides from the request AA the coordinator already holds, so it adds no crossing to the serial path; the one write is the delivery a slot's answer would make anyway. Dev and production builds compile none of it. How a spec uses it: [`rta-tests.md`](../dev/rta-tests.md#making-requests-fail-or-slow-rtafailrequests).

## The 5 API call patterns

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

This blocks the *Task* thread (not the render thread!) for up to `apiTimeout.waitMs(req)`: `timeouts.API_WAIT_MS` for an ordinary request, or the request's own `timeoutMs` plus the same margin, so the HTTP call always gives up first ([`apiTimeout.bs`](../../source/api/apiTimeout.bs)). Concurrent calls from multiple Task threads are safe — each gets its own `ApiResultNode`.

`fetchJson(req, id)` is a convenience wrapper that returns just `res.json` (or `invalid` on timeout, an HTTP error, or a list body that failed its shape check — see [Reading a list endpoint's body](#reading-a-list-endpoints-body--sourceapiapiresponsebs)).

`fetchJson` drops the reason. A caller that must tell a failed load apart from an empty one — and log why — calls `fetchRes` and asks [`apiResponse.jsonFailure(res)`](../../source/api/apiResponse.bs): `""` for a usable body, otherwise a short cause (`timed out`, `HTTP 500`, `network error -7`, `unreadable reply`, …) for its warning line. `LoadItemsTask2.executeItemQuery()` is the reference.

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

> **Task threads with several requests in flight** pass their own `roMessagePort` as the optional
> third argument — `submitApiRequest(req, id, port)` — which observes `isDone` *before* the request
> enters the queue (no missed-event race) and waits on the port. Promises don't run on Task threads,
> so this is the sanctioned non-blocking shape there. Don't hand-roll the scheduling around it —
> that's Pattern 5.

> **Prefer a promise for new render-thread call sites.** `fetchAsync(req, id).then(...)` wraps this
> same `submitApiRequest` bridge and removes the manual observe/unobserve plumbing (and auto-abandons
> on destroy). See [async.md](./async.md) and [the promises how-to](../dev/promises.md). The raw
> observer pattern above is the convention that predates promises, still used by call sites not yet migrated.

### Pattern 3 — `SubmitSideEffect` (fire-and-forget POST/DELETE)

For requests where you don't need the response: telemetry, playback reporting, mark-watched, mark-favorite.

```brightscript
sub reportPlayback(state as string)
  req = GetApi().BuildPlaystateRequest(state, params)
  SubmitSideEffect(req)            ' returns immediately
end sub
```

Goes through the single `m.global.sideEffectTask` (not the pool). Like the pool, it uses the children-as-vehicle FIFO — a fresh `ApiResultNode` per request, drained in append order on its one thread — so back-to-back submits can't coalesce. (The earlier single shared `request` field could: two rapid writes merged and silently dropped one — #744.) Calls are serialized — a slow side-effect can delay the next one. Don't use this for cancellable UI requests.

### Pattern 4 — Dedicated Task with raw `roUrlTransfer`

For non-Jellyfin HTTP (e.g., font downloads, image fetches that need special handling, or the SSDP server discovery during login). Write a dedicated `Task` component, do the request inline with `wait(port)`, write to the output field.

Examples in the codebase: `FontDownloadTask`, `ServerDiscoveryTask`.

The bar is **actual I/O** — *or* a component the render thread is not allowed to construct. A Task that only computes — building a URL, transforming an AA — costs a thread to do work the render thread could do inline. `LoadPhotoTask` was such a case (its whole body was an `ImageURL()` call) and was removed; `PhotoDetails` now resolves the URL directly.

**Check the second half of that bar before deleting a "pointless" Task.** Some BrightScript components are MAIN|TASK-only and `CreateObject` returns `invalid` for them on the render thread — the next dot access then crashes. `roFontRegistry` is one, which is why `components/Buttons/TextSizeTask` measures label widths on a Task even though it does no I/O. Roku's docs for the component do **not** state the restriction; the device error does:

```text
BRIGHTSCRIPT: ERROR: roFontRegistry: creating MAIN|TASK-only component failed on RENDER thread
```

So the test for "does this need a Task?" is *I/O, or a thread-restricted component* — and the only reliable way to answer the second is to run it on hardware.

### Pattern 5 — `apiPipeline` (N independent requests, still one Task thread)

Pattern 1 with several requests in flight instead of one at a time. When an orchestrator has **N independent** requests — one per library, per season, per whatever the server returns — Pattern 1 in a loop pays the full round trip N times, and spawning a Task per request is the fan-out that produced the `&h29` "too many task threads" crashes on big libraries (epic #728). [`source/api/apiPipeline.bs`](../../source/api/apiPipeline.bs) is the third option: one thread, one request per pool slot riding the pool at once.

```brightscript
entries = []
for each lib in libs
  entries.push({ requestId: "latestRow-" + lib.id, req: GetApi().BuildGetLatestMediaRequest(params), libId: lib.id })
end for

pipe = apiPipelineBegin(entries)
result = apiPipelineNext(pipe)
while isValid(result)
  ' result.entry is the caller's own AA, echoed back — result.libId needs no side table.
  ' result.res is the pool response AA, or invalid if this entry never got an answer.
  emitRow(result.entry.libId, result.res)
  result = apiPipelineNext(pipe)
end while
```

Three things worth knowing before you use it:

- **Results arrive in completion order**, not entry order. Requests are *submitted* in entry order, so on-screen-first work still starts first.
- **`budgetMs` is one budget for the whole run** (`timeouts.PIPELINE_RUN_MS`), not a per-request timeout — a per-request wait lets N slow requests stack into N × `API_WAIT_MS`. On expiry the run stops submitting and yields every remaining entry with `res = invalid`, so expiry needs no special case at the call site.
- **The budget is charged only while the run is inside `apiPipelineNext`** (submitting and waiting). The caller's own work between calls (transforming a response, handing it to the render thread) is not charged, so a caller with many results cannot spend the budget on itself. The budget bounds a slow or dead server, not the run's total wall time. Anything that watches a run from outside must therefore judge it by how long it has gone *without delivering*, not by how long it has run — `latestRows.runIsStalled` is the example.
- **`res = invalid` means "no answer", not "the server said no."** An HTTP error is a valid `res` with `ok = false`. A caller that removes UI on an empty result must branch on the difference, or a timeout will delete good content — see `LoadLatestRowsTask` / `HomeRows`, where a failed row is left standing.
- **Leaving the UI alone means leaving its *placeholder* alone too.** Where a caller drew a skeleton before the run, the cheapest correct thing on failure is usually to do nothing at all: the placeholder stays, and the next successful run fills it *in place*. Clearing it instead forces the later success to re-create and re-insert the element, which visibly pops in and shifts everything after it. `HomeRows` leaves a failed latest row exactly as it found it, for that reason.

A run is also a *budget*, not a promise of coverage: it services roughly `PIPELINE_RUN_MS ÷ per-request-latency × pool width` requests before expiring, so on a large, distant server the tail of a run legitimately comes back undelivered. Design the call site for that, don't tune the constant for it.

Canonical example: `LoadLatestRowsTask` (Home's latest-media rows). Its state machine is split pure-core / I/O-shell for the same reason `apiPromise.bs` is — see [async.md](./async.md).

## Reading a list endpoint's body — `source/api/apiResponse.bs`

Most endpoints answer with a `{ Items: [...] }` query result, but some answer with a **bare array** — the Jellyfin OpenAPI spec says which, as a 200 response schema of `type: array`. **Build those requests with `listReq` instead of `validatedReq`:**

```brightscript
function BuildGetCulturesRequest() as dynamic
  return m.listReq("GET", buildURL("/Localization/Cultures"))
end function
```

`listReq` marks the request `expect: "list"`, and the pool holds the body to that shape: `ApiTask.executeRequest()` runs every response through `apiResponse.enforceShape()`. For a list request:

- **`ok` means `res.json` is an `roArray`.** Callers iterate it with no check of their own. It may be empty — empty is an answer, and the only way to say "empty".
- **A `{ Items: [...] }` wrapper is unwrapped** to its `Items`. Stock Jellyfin does not send one for these endpoints, but its `Items` is the same list, so reading it shows the user their content rather than leaving a row empty on every retry ([ADR 0039](../adr/0039-list-endpoint-shape-in-pool.md)).
- **Any other body arrives as a failure:** `ok = false`, `json = invalid`, `error = "unexpectedShape"`, with `statusCode` still the server's. Callers already treat `ok = false` as *no answer* — never as an empty list — so nothing on screen is removed (the same rule as `res = invalid` above).
- **The pool logs one `warn`**, naming the `requestId`, whenever a list endpoint answers with anything but a bare array — whether the wrapper was read through or the body rejected.

Which endpoints are list requests is the set of builders that call `listReq` — `grep listReq source/api/ApiClient.bs` — and is deliberately not repeated here. The "List requests" group in `ApiClient.spec.bs` pins each one on both API versions.

**Why a shape check, not trust in the spec:** BrightScript iterates an associative array's *keys*. If one of these endpoints ever answers with an object, `for each item in res.json` yields key strings and the first `item.Type` (or a `res.json[0]`) is a runtime error that ends the app — it cannot fail softly. That happened in the field (a v2.30.0 crash report): a server answered `/Items/Latest` with a query result, and the latest-media task crashed the app while Home was loading. **Why in the pool, not at each call site:** a per-caller check has to be remembered by every caller, and one forgotten caller is a crash. A builder is where the endpoint — and so its shape — is decided, and every pooled response already passes through one function.

Two paths read a list without the pool's help:

- **The synchronous bootstrap path** (`sdk.*` via `getJson`) never reaches `ApiTask`. Its one bare-array call, `ApiClient.GetPublicUsers()`, reads its body through `apiResponse.listFrom()` before returning it.
- **A caller that wants the list out of a response of either shape** reads it through `apiResponse.listFrom(res.json)`, which returns the array, or a wrapper's `Items`, or `invalid`. `extrasRows.itemsFromResponse()` does this, because its rows mix both kinds of endpoint.

## Authentication & request building — `source/api/baseRequest.bs`

`baseRequest.bs` provides the low-level helpers used everywhere:

- **`buildURL(path, params)`** — concatenates `m.global.server.serverUrl` + `path` + `?<encoded params>`
- **`buildParams(params)`** — converts an AA into a URL-encoded query string with type-aware encoding (string/integer/float/longinteger/array/boolean/null)
- **`buildAuthHeader(shouldIncludeDeviceName = true)`** — returns the `Authorization` header value: `MediaBrowser Client="...", Version="...", UserId="...", DeviceId="...", Token="..."`, plus a free-text `Device="<name> (<model>)"` unless `shouldIncludeDeviceName` is `false`. **`DeviceId` is the session-identity field**: Jellyfin resolves it from this header and nowhere else (never from a query string), falling back to the id the auth *token* was minted under when the header omits it — so every channel that opens a Jellyfin session must send this header, or it silently lands on a different session. The only caller passing `false` is the `ws://` remote-control handshake; see [remote-control.md](remote-control.md) and decision `deviceid-header-authoritative`.
- **`executeHttpRequest(req, defaultMethod, logLabel)`** — the shared executor behind both task tiers. Attaches the auth header, resolves the timeout (`apiTimeout.httpMs(req)`: the request's own `timeoutMs`, else `timeouts.HTTP_MS`), defaults `Content-Type` to `application/json` when a body is present, and performs the `roku-requests` call. Returns `invalid` on a missing/empty URL, leaving the caller to decide how to surface that.

Both task tiers prepend the auth header automatically, because both route through `executeHttpRequest()`:

```brightscript
' components/api/ApiTask.bs — Tier 1 (pool); maps `invalid` to an error response AA
r = executeHttpRequest(req, "GET", "[ApiTask]")

' components/api/SideEffectTask.bs — Tier 2 (fire-and-forget); result discarded
executeHttpRequest(child.request, "POST", "[SideEffectTask]")
```

So callers building requests don't need to remember to attach auth — it's automatic at the pool level. Centralizing it also removed a duplicated copy that had drifted across three separate fixes (see `tech-debt.md`).

## `V1` vs `V2` dispatch

`Jellyfin`'s API changed shape between **10.8** (V1) and **10.9+** (V2). Many endpoints moved or restructured: e.g., `/users/{userId}/items/{itemId}` (V1) → `/Items/{itemId}?userId={userId}` (V2).

JellyRock supports both. The dispatch is per-method inside `ApiClient`:

```brightscript
if m.getApiVersion() >= 2
  ' V2 endpoint
else
  ' V1 endpoint
end if
```

`getApiVersionFromGlobal()` (in `misc.bs`) reads `m.global.server.apiVersion`, which is set during login from the server's `/System/Info/Public` response. There's a comment in `ApiClient.bs` indicating "When adding `V3` support, add else-if branch in each method below" — the design accommodates future versions, but the dispatch is per-method (no centralized routing table).

`docs/dev/jellyfin-server-versioning.md` has the canonical version-policy guide.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for API / `ApiClient` entries.
