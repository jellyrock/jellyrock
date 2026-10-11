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
  - source/utils/itemImageUrl.bs
  - components/api/ApiTask.bs
  - components/api/ApiQueueTask.bs
  - components/api/ApiResultNode.xml
  - components/api/SideEffectTask.bs
  - components/home/LoadLatestRowsTask.bs
last-reviewed: 2026-10-10
---

# API layer and task pool

How JellyRock talks to Jellyfin: the three API layers, the persistent task pool, and the five call patterns.

## Why this is harder than it sounds

On Roku, I/O must not run on the render thread, or the UI freezes. So every HTTP request runs on a Task thread: an `roSGNode` of type `Task` whose `functionName` runs in its own BrightScript interpreter. Which thread is which is in [threading.md](threading.md).

Starting a Task per request is slow, and many components fetching at once gets tangled. JellyRock instead runs a persistent pool of Task threads, sized per device class ([Pool width](#pool-width)), with a FIFO coordinator that hands requests to them. The coordinator and its result nodes are built so that event coalescing in SceneGraph cannot drop a request ([below](#the-coalescing-problem-why-children-not-fields)).

## The three API layers

Application code calls the API at one of three layers:

| Layer | Files | What it does |
| --- | --- | --- |
| 3, domain helpers | `source/utils/itemImageUrl.bs`, `source/utils/rowItemImage.bs` | One call for a common need, such as an item's poster URL with a fallback chain |
| 2, business logic | `source/api/image.bs`, `source/api/userAuth.bs`, `source/api/items.bs` | Validation, defaults, and degrading to an empty answer instead of a bad request |
| 1, API client | `source/api/ApiClient.bs` | A singleton (`GetApi()`) whose `Build*Request()` methods return request AAs for the pool |

Below layer 1 sit the endpoint wrappers: `sdk.bs`, `sdkV1.bs` (Jellyfin 10.7 and 10.8) and `sdkV2.bs` (10.9 and later), and the request helpers in `baseRequest.bs` ([below](#authentication-and-request-building)).

### Layer 1: `ApiClient`

`ApiClient` is a singleton class; get it with `GetApi()`. Its `Build*Request()` methods return a request AA (`{ method, url, body?, expect? }`) for the task pool. This is the pattern for every new endpoint.

```brightscript
req = GetApi().BuildGetItemRequest(itemId, { fields: "Overview,Genres" })
res = fetchRes(req, "myUniqueRequestId")    ' executes on task pool
if isValid(res) and res.ok then item = res.json
```

A `Build*Request()` method:

- Injects the current user id (`m.global.user.id`) into requests that need it, and returns `invalid` when there is no user, so callers need not check the globals.
- Applies the image defaults (`EnableImageTypes: "Primary,Backdrop,Logo,Thumb"`, `ImageTypeLimit: 1`).
- Picks the V1 or V2 endpoint by `m.getApiVersion()` ([below](#v1-and-v2-dispatch)).
- Marks a request to a bare-array endpoint `expect: "list"` through `listReq`, so the pool holds its body to that shape ([Reading a list endpoint's body](#reading-a-list-endpoints-body)).
- May refuse to build a request that would be unsafe. This is a second meaning of `invalid`: not "I lack a prerequisite" but "I will not build this".

`BuildDeleteSubtitleRequest(itemId, stream)` is the reference for a refusal. It takes the subtitle's `MediaStream` rather than a stream index, and returns `invalid` unless `IsExternal` is `true`. The server deletes `MediaStream.Path` unconditionally, and an embedded subtitle's path is the media file itself. Put a safety rule like this in the builder, once, whenever getting it wrong destroys user data. A rule written in prose for callers to honor is not a guard. Callers already treat an `invalid` request as "cannot do this", so a refusal becomes an inert control, not a crash.

The V1 and V2 routing, copied from `ApiClient.BuildGetItemRequest()`; the same shape repeats per endpoint:

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

#### The synchronous methods left

Four `ApiClient` methods still make their HTTP call synchronously on the calling thread: `AuthenticateByName`, `GetUser`, `GetPublicUsers` and `GetDisplayPreferences`. All four are on the sign-in path, called from `loginRouter.bs` and `session.bs`. Don't add new ones. (`GetImageURL` and `GetUserImageURL` build URLs and make no request.)

They are not synchronous because the pool is not running yet. `setGlobalNodes()` starts the pool in `Main()` before sign-in, and `UserSelect` already makes pre-login `fetchAsync` calls. The constraint is where they are called from. `fetchAsync` registers a named observer, which Roku runs only inside a SceneGraph component, and `main.bs` and `loginRouter.bs` run on the main thread, where a named observer never fires.

So moving one of them to the pool is a call-site change: move the request into the render-thread component that wants the answer, and hand the main thread only the finished result. Quick Connect is the worked example (#288 phase 4). Its endpoints became `Build*Request()` builders that `UserSelect` drives as promises, while `user.Login()` stayed on the main thread because it reads and writes the registry. See [`apiclient-sync-pool-coexistence`](tech-debt.md#apiclient-sync-pool-coexistence).

### Layer 2: business logic

Layer 2 adds validation, defaults and graceful failure on top of layer 1. `ImageURL(id, version, params, serverURL)` in `image.bs` is the model: it returns `""` when the params name an image tag that is empty, or when no server URL is set. Otherwise it fills in default dimensions and quality and builds the URL with `buildURL()`. An empty string is the consistent failure value, because a Roku `Poster` given `""` as its `uri` shows nothing instead of requesting a URL the server answers with a 404.

### Layer 3: domain helpers

Layer 3 answers "what is a sensible image for this item?" in one call, so no component re-implements the fallback chain. This is usually what a UI component wants.

Each `getItem*Url()` in `source/utils/itemImageUrl.bs` takes a `JellyfinBaseItem` node and a size from the `imageSize` namespace, walks a fallback chain, and returns `""` when no image fits. `getItemPosterUrl()` tries the item's own primary image, then its parent's, then its series', then its album's (for an audio track with no art of its own). The same file has `getItemWidePosterUrl`, `getItemThumbnailUrl`, `getItemBackdropUrl` and `getItemParentWidePosterUrl`, and `getItemImageUrl` takes any image type (a logo, for example).

Row cells go through `getRowItemImageUrl()` in `rowItemImage.bs`, which picks the image by item type, slot size and user settings. `source/api/imageHelpers.bs` holds the user avatar helper, `GetUserAvatarURL`.

### Picking a layer

[`api-layering-guide.md`](../dev/api-layering-guide.md) has the full decision tree. In short:

| You need | Use |
| --- | --- |
| An item's poster, backdrop or logo URL | Layer 3, `itemImageUrl.bs` |
| A custom image URL | Layer 2, `ImageURL()` |
| Any other endpoint | Layer 1, `GetApi().Build*Request()` and the task pool |
| A new endpoint | A new `Build*Request()` method on `ApiClient`, with a V1 branch if the endpoint differs |

## The task pool

The pool is these Task nodes, all on `m.global`:

| Node | Type | Count | Job |
| --- | --- | --- | --- |
| `apiPool0`, `apiPool1`, … | `ApiTask` | `m.global.apiPoolWidth` | Workers: each runs one HTTP request at a time |
| `apiQueue` | `ApiQueueTask` | 1 | FIFO coordinator: hands queued requests to free workers |
| `sideEffectTask` | `SideEffectTask` | 1 | Fire-and-forget requests ([Pattern 3](#the-five-call-patterns)) |

Each request travels on its own `ApiResultNode` (a plain `Node`, not a thread). `setGlobalNodes()` in `globals.bs` creates the Task nodes, and they live for the whole session. Each runs a loop that waits on its port and handles work as it arrives.

### Pool width

The width is how many requests the coordinator can have on the network at once ([ADR 0036](../adr/0036-api-pool-width-by-device-class.md)). It is chosen once, at startup, by device class: `apiPool.widthFor(m.global.device.isLowMemoryDevice)` in [`source/constants/apiPool.bs`](../../source/constants/apiPool.bs). It is stored as `m.global.apiPoolWidth`, which `ApiQueueTask` and `apiPipeline` read through `apiPool.currentWidth()`.

| Device class | Width | Why |
| --- | --- | --- |
| Low memory (512 MB, the `LOW_MEMORY_DEVICE_PREFIXES` list in `globals.bs`) | 4 | On a slow connection it already gets the device's whole speedup. Wider gains nothing and, on a moderate connection, makes Home's first rows appear later. |
| Everything else | 6 | Keeps cutting Home's full load time on slow connections and costs nothing on fast ones. It matches the six connections per server a browser opens, the load Jellyfin's own web client already makes. |

Home issues one request per row, so with more rows than slots, requests queue, and on a slow connection the queue is the wait. The sweep behind the two numbers (three devices, four widths, three added delays) is in ADR 0036.

Why not other choices:

- **Wider than 6.** Width 8 never beat 6 significantly, and above 6 the app would send more concurrent requests than the web client does over plain HTTP. That server load was not measured.
- **One number for every device.** The 512 MB device pays a first-paint cost at 6 and gains nothing from it.
- **By connection speed or library size.** No width hurt on a fast connection, so there is nothing to switch off. The coordinator uses only as many slots as there are queued requests, so a small library leaves the extra slots idle.

**Changing it.** Each slot is its own guarded block in `setGlobalNodes()`, with no loop (the `no-task-fanout` rule), up to 6. So any width from 1 to 6 is a constants change; above 6 needs more blocks. `ApiQueueTask` checks the created slots against `apiPoolWidth` at startup and logs an error if they differ in either direction, and `tests/source/unit/constants/apiPool.spec.bs` pins both values. Measure on a device before changing either (`npm run measure`). Each slot is a thread for the whole session, and the peak live thread count is gated by `tests/rta/specs/task-thread-peak.spec.js`.

### How a request flows

A `fetchRes()` call, from a Task thread, goes through three threads:

| Step | Thread | What happens |
| --- | --- | --- |
| 1 | Caller | `fetchRes(req, id)` waits for `apiQueue.isReady`, the one-time startup gate ([below](#the-startup-ordering-problem)). |
| 2 | Caller | It creates an `ApiResultNode` carrying the request, observes the node's `isDone` on its own port, appends the node as a child of `apiQueue`, then writes the id to `apiQueue.enqueue` to wake the coordinator. |
| 3 | Caller | It waits on its port for `isDone`, up to `apiTimeout.waitMs(req)`. |
| 4 | Coordinator | `ApiQueueTask.runQueueLoop()` wakes on the `enqueue` write, reads every child it has not processed yet (`m.processedIndex`), and for each finds a free slot in `m.inFlight` (`apiPoolNextDispatch()`). |
| 5 | Coordinator | It writes the request AA to that slot's `request` field and marks the slot in flight. |
| 6 | Worker | `ApiTask.runApiLoop()` sees the `request` event and runs `executeRequest()`: the HTTP call through `roku-requests`, then `apiResponse.enforceShape()` for a list request. It writes the response AA to its `response` field. |
| 7 | Coordinator | It sees the `response` event, writes the response to the result node's `result`, sets its `isDone`, and frees the slot. |
| 8 | Caller | The `isDone` event wakes it, and `fetchRes()` returns `result`. |

The coordinator wakes only on field events: `enqueue`, a slot's `response`, a watched Task's `state` ([below](#a-long-request-already-on-a-slot)), and in RTA builds `rtaFailRequests`. It reads new children after any of them.

### The coalescing problem (why children, not fields)

SceneGraph can coalesce port events when several Task threads write the same field in quick succession. If three tasks each wrote a request to one shared field at the same moment, the coordinator could wake once, see the last write, and lose two requests.

So a request is never written to a shared field. It is appended to the coordinator as an `ApiResultNode` child, and a child append is never merged. The `enqueue` write is only a wake-up signal, and its value is ignored. Even if several wake-ups coalesce, the coordinator reads every child past `m.processedIndex`, so no request is lost.

The header of `components/api/ApiQueueTask.bs` explains this in more detail. Read it when debugging a request that "disappeared".

### The startup ordering problem

If anything writes a slot's `request` field before that slot has called `observeField("request", port)`, the write is lost, and the slot waits forever for an event that already happened.

A three-step ready cascade prevents it:

1. Each `ApiTask` sets `m.top.isReady = true` only after registering its `request` observer.
2. `ApiQueueTask` waits for every slot to be ready, then registers its own observers and sets its own `isReady`.
3. `fetchRes()` waits for `apiQueue.isReady` before appending a child.

After the first request, the check is one field read. `submitApiRequest()` does not wait: it returns `invalid` at once when the coordinator is not ready, which callers read as "no answer". It is safe only after something that does wait has run.

### `ApiResultNode`

[`components/api/ApiResultNode.xml`](../../components/api/ApiResultNode.xml) is one node per request. Three fields carry the request and its answer (`request`, `result`, `isDone`), and two say whether anyone still waits for it (`owner`, the waiting Task if there is one, and `abandoned`). The caller creates it, the coordinator writes to it and the caller reads it. The coordinator prunes its processed children once 50 have piled up (`m.processedIndex`).

### A request nobody is waiting for

Callers stop listening all the time. `replaceTask()` stops a Task that is blocked in `fetchRes`, a component's promises are abandoned at teardown, a pipeline run ends early, a caller times out. Each of those used to leave its request in the FIFO queue, where it was still sent and held a slot for as long as the server took. On a slow server a burst of replaced runs (Search starts a new `SearchTask` per keystroke) queued the request the user was waiting for behind ones nobody would read ([ADR 0040](../adr/0040-pool-skips-abandoned-reads.md)).

So at dispatch the coordinator asks `apiPoolNextDispatch()` in [`apiPool.bs`](../../source/api/apiPool.bs) what to do with each entry, and calls `settleIfCallerGone()` on the ones worth checking. A queued read whose caller is gone is completed with `error: apiResponse.ERROR_ABANDONED` and never reaches a slot. The caller is gone when it set `abandoned` itself, or when its `owner` Task is no longer running (`taskThreadIsLive()`). Four rules keep this safe and cheap:

- **Only reads are skipped.** A read is a GET or HEAD, or a POST that declares `skippable: true` because it only reads (`BuildGetLiveTvScheduleRequest`). A POST or DELETE is something the user asked for (a favorite, a recording, a delete), so it runs even though the screen moved on. It runs in FIFO order, so a run of toggles ends where the user left it. `BuildPostPlaybackInfoRequest` is not marked: it sends `AutoOpenLiveStream`, which can open a live stream on the server.
- **Only a request that waited for a slot is checked.** The check costs up to three crossings to the render thread, on the serial path every request takes. A request that finds a free slot on arrival goes out at once, so its caller cannot have gone anywhere, and against a healthy server that is nearly every request. ADR 0040 has the measured cost; take it again with `npm run measure -- --measurement api-dispatch`.
- **Only Task-thread callers record an owner:** `fetchRes`, and `submitApiRequest` with a port (the pipeline). A render-thread caller sets `abandoned` itself instead, so a request is never skipped because some unrelated node stopped.
- **`owner` is dropped only where it is known dead**, on the skip path. A dispatched entry's owner is by definition still waiting, and clearing it would cost a crossing on every request. The reference goes when the coordinator prunes the node.

The rules are pinned in [`apiPoolSkip.spec.bs`](../../tests/source/unit/api/apiPoolSkip.spec.bs).

#### A long request already on a slot

Skipping helps only a request still in the queue. A request with a long HTTP limit would otherwise hold its slot for up to a minute after the user backed out. A library grid's page is one: it gets `timeouts.GRID_PAGE_MS`, because a slow server can take about 40 s to answer it (measured 2026-09-24, [ADR 0043](../adr/0043-pool-stops-long-reads-of-gone-callers.md)).

So when the coordinator sends a request that `apiRequestIsStoppable()` (a read with a longer-than-default limit), `watchCaller()` subscribes to the waiting Task's `state`. If the Task stops before the answer arrives, `stopSlot()` adds a `quit` field set to true to the slot (`apiSlotQuit()`). `roku-requests` reads `m.top.quit` on every pass of its wait loop and cancels the transfer when it is true, so the slot answers "no answer" and is free again. The coordinator removes `quit` before it sends that slot anything else (`apiSlotClearQuit()`). ADR 0043 has why, the measurement, and what was ruled out.

- **Only long requests are watched.** Reading the waiting Task and subscribing to it cost the coordinator time on the serial path every request takes. A request with the default limit frees its slot within `timeouts.HTTP_MS` anyway. The decision comes from the request AA alone, so every other request pays nothing.
- **Subscribe, then read once.** A Task that stopped between the enqueue and the subscription sends no event, and the read after subscribing catches it.
- **`stop` also means "finished".** A Task that returns normally reports `stop` too, but only after its answers were delivered. Delivery ends the watch (`forgetCaller()`), so the stop matches no slot (`apiPoolSlotsWatchedBy()`).
- **The watch uses `unobserveField`, which drops every observer of the field.** Nothing else observes a Task's `state`; the task ledger reads it instead ([`tasks.bs`](../../source/utils/tasks.bs)). The scoped pair (`observeFieldScopedEx` and `unobserveFieldScoped`) should drop only this observer, but on a device `unobserveFieldScoped` has removed another component's observer (#898, [`components/CLAUDE.md`](../../components/CLAUDE.md)). So the pool keeps the plain pair until this exact case is measured (followup `api-pool-watch-scoped-observer` in [`progress.md`](../progress.md)).
- **So the watch is one per Task, not one per request.** An `apiPipeline` run can have several long requests from one Task on slots at once. Dropping the subscription when the first is answered would leave the rest with no watch. `watchCaller()` subscribes only for a Task that no other in-flight request is watching, `forgetCaller()` unsubscribes only when none is left, and a stopped Task stops every slot it was waiting on. A pipeline request with a long limit is still bounded by its run's budget (`apiPipelineBegin`'s `budgetMs`), so it needs a larger budget as well.
- **`roku-requests` ends a stopped request through its timeout path.** Its quit check reads `m.cancel_and_return` instead of its local `cancel_and_return`. So a stop cancels the transfer, logs `[http] Event Timed Out`, and would retry if the request allowed retries. `executeHttpRequest()` passes no `retryCount`, which keeps a stop to one cancel; see the comment in [`ApiTask.xml`](../../components/api/ApiTask.xml).

Only reads are stopped, for the same reason as skipping. The Live TV `PlaybackInfo` request that opens a live stream has a long limit too (`timeouts.LIVE_OPEN_MS`), and it must not be stopped: the server opens the stream anyway, and only the answer names the stream the app has to close ([playback.md](playback.md#a-live-stream-the-player-never-held)). A render-thread caller has no waiting Task to watch, so a long request from the render thread would not be stopped; none exists today. The rules are pinned in [`apiPoolStop.spec.bs`](../../tests/source/unit/api/apiPoolStop.spec.bs), and the behavior end to end in the `slow-library` RTA spec.

**`ApiTask` does not declare `quit`; the field exists only while a stop is pending.** The `roku-requests` wait loop reads `m.top.quit` on every pass without sleeping, and each read is a rendezvous with the render thread, because the slot's node is render-owned. Reading a declared field costs more than reading a missing one: on a 512 MB Stick, 2026-09-25, the median read took 6.9 ms with the field declared and 3.7 ms without (ADR 0043). Declaring it would tax every request in the app for the rare one that is stopped. So `apiSlotQuit()` adds it, `apiSlotClearQuit()` removes it, and a unit test pins that `ApiTask` declares no `quit`. The loop's polling predates the stop, and replacing it is tracked separately.

### A request a test makes fail or slow (RTA builds only)

On-device specs need a screen's failure and slow-server paths against a healthy, fast server. So RTA builds (`ENABLE_RTA`) let a spec make chosen requests fail or answer slowly. The coordinator holds the rules from `m.global.rtaFailRequests`, reading the field only when a spec writes it. It checks each request as it takes it off its children (`processNewChildren`, then `answeredOnPurpose`).

A failure is answered at once and never reaches a slot. The answer is the one the pool itself delivers for that failure, built by [`apiFaults.responseFor()`](../../source/api/apiFaults.bs): a `roku-requests` timeout is `ok = false` with no `statusCode` or body, and an HTTP failure keeps its status. Nothing marks it as injected, because code that could tell the two apart could handle a test failure differently from a real one.

A slow request (`kind: "slow"`, `ms`) is sent like any other, and its real answer is held until `ms` after it was sent (`heldOnPurpose`). Its slot stays in flight until then, because a slow server's cost to the app includes the slot it occupies, and a screen that abandons a slow load must be able to give that slot back. While an answer is held, the loop waits only until the earliest is due (`apiFaults.nextWaitMs`). A held request that is stopped ([above](#a-long-request-already-on-a-slot)) gives its slot back at once, as a stopped real one does (`releaseHeldOnPurpose`). `m.global.rtaHeldRequests` counts the answers held, so a spec can see a request is on a slot before acting, and see the slot come back.

The check decides from the request AA the coordinator already holds, so it adds no crossing to the serial path. Dev and production builds compile none of it. How a spec uses it: [`rta-tests.md`](../dev/rta-tests.md#making-requests-fail-or-slow-rtafailrequests).

## The five call patterns

| Pattern | Thread | Waits for the answer? | Use for |
| --- | --- | --- | --- |
| 1, `fetchRes` / `fetchJson` | Task | Blocks the Task | An orchestrator Task that needs a response to build its data |
| 2, `fetchAsync` | Render | No: a promise | A component that needs a response |
| 3, `SubmitSideEffect` | Any | No answer | A write nobody reads the answer to |
| 4, a dedicated Task | Task | Its own loop | Non-Jellyfin HTTP, or a component the render thread cannot construct |
| 5, `apiPipeline` | Task | Takes answers as they arrive | Many independent requests from one Task |

### Pattern 1: `fetchRes` and `fetchJson` (blocking, from a Task thread)

The common case: an orchestrator Task that needs one or more responses to build its data.

```brightscript
sub runOrchestrator()
  itemReq = GetApi().BuildGetItemRequest(m.top.itemId)
  res = fetchRes(itemReq, "loadItem-" + m.top.itemId)
  if isValid(res) and res.ok
    m.top.result = res.json
  end if
end sub
```

This blocks the Task thread, not the render thread, for up to `apiTimeout.waitMs(req)`. That is `timeouts.API_WAIT_MS` for an ordinary request, or the request's own `timeoutMs` plus the same margin, so the HTTP call always gives up first ([`apiTimeout.bs`](../../source/api/apiTimeout.bs)). Calls from several Task threads at once are safe, since each gets its own `ApiResultNode`.

`fetchJson(req, id)` returns only `res.json`, or `invalid` on a timeout, an HTTP error or a list body that failed its shape check ([Reading a list endpoint's body](#reading-a-list-endpoints-body)).

`fetchJson` drops the reason. A caller that must tell a failed load from an empty one, and log why, calls `fetchRes` and asks [`apiResponse.jsonFailure(res)`](../../source/api/apiResponse.bs). It returns `""` for a usable body, and otherwise a short cause (`timed out`, `HTTP 500`, `network error -7`, `unreadable reply`) for the warning line. `LoadItemsTask2.executeItemQuery()` is the reference.

### Pattern 2: `fetchAsync` (non-blocking, from the render thread)

A component that needs a response calls `fetchAsync(req, id)` and gets a promise. This one is copied from `Home.checkServerCapabilities()`:

```brightscript
promises.chain(fetchAsync(req, "serverCapabilities-home")).then(sub(res as object)
  serverCapabilities.recordSubtitleProviderStatus(res)
end sub).catch(sub(err as object)
  m.log.warn("server capability check failed", err.reason)
end sub)
```

`fetchAsync` wraps `submitApiRequest()`, gives the request a timeout, and abandons it when the component is destroyed. How it works is in [async.md](async.md), and how to write it is in [the promises guide](../dev/promises.md). It works only on the render thread, because it relies on a named observer.

It is the only render-thread shape for a request whose answer you need. Observing an `ApiResultNode`'s `isDone` by hand is the pattern promises replaced, and [`promise-ratchet.cjs`](../../scripts/lint/promise-ratchet.cjs) fails CI on any new `observeField("isDone"` outside the pool and its promise adapter. A callback that needs data transforms or array processing belongs on a Task thread instead (Pattern 1 from an orchestrator).

**On a Task thread with several requests in flight**, pass the Task's own `roMessagePort` as the third argument: `submitApiRequest(req, id, port)`. It observes `isDone` before the request enters the queue, so no response can arrive ahead of the observer. Promises don't run on Task threads, so this is the non-blocking shape there. Don't hand-roll the scheduling around it; that is Pattern 5.

**One request that needs nothing from an earlier one** can use the same call without a pipeline. Send it with `submitApiRequest(req, id, port)`, do the blocking `fetchRes` meanwhile, then collect it with `collectApiRequest(node, port)`, so the two waits overlap instead of adding up. A caller with its own deadline passes the most it will wait as a third argument. A caller that ends up not needing the answer calls `dropApiRequest(node)`, which abandons it so the pool can skip it. `LoadItemsTask.keepStartedSeries` is the reference.

### Pattern 3: `SubmitSideEffect` (fire-and-forget)

For a write whose answer nobody reads, such as playback reporting:

```brightscript
SubmitSideEffect(req)            ' returns immediately
```

It goes through the one `m.global.sideEffectTask`, not the pool. Like the pool, it uses a fresh `ApiResultNode` child per request, drained in append order on its one thread, so back-to-back submits cannot coalesce (#744 lost a request when they shared one field). Calls are serialized, so a slow one delays the next. Don't use this for a request the UI may want to cancel.

### Pattern 4: a dedicated Task with raw `roUrlTransfer`

For HTTP that is not to Jellyfin, such as a font download or the SSDP server discovery during sign-in. Write a dedicated `Task` component, make the request inline with `wait(port)`, and write the answer to an output field. `FontDownloadTask` and `ServerDiscoveryTask` are examples.

A Task is worth its thread only for I/O, or for a component the render thread cannot construct. A Task that only computes (building a URL, transforming an AA) costs a thread for work the render thread could do inline. `LoadPhotoTask` was one: its whole body was an `ImageURL()` call, so it was removed and `PhotoDetails` resolves the URL directly.

Roku does not publish which components a thread may construct, so measure before keeping a Task for that reason. [threading.md](threading.md#constructing-components) lists what has been measured. `roFontRegistry`, once believed to be Task-only, works on the render thread ([threading.md](threading.md#a-correction-worth-keeping)).

### Pattern 5: `apiPipeline` (many independent requests, one Task thread)

Pattern 1 with several requests in flight instead of one at a time. An orchestrator with many independent requests (one per library, per season) pays the full round trip for each if it runs Pattern 1 in a loop. Starting a Task per request is the fan-out that caused the `&h29` "too many task threads" crashes on big libraries (epic #728). [`source/api/apiPipeline.bs`](../../source/api/apiPipeline.bs) is the third option: one thread, with one request per pool slot in flight at once.

```brightscript
entries = []
for each lib in libs
  entries.push({ requestId: "latestRow-" + lib.id, req: GetApi().BuildGetLatestMediaRequest(params), libId: lib.id })
end for

pipe = apiPipelineBegin(entries)
result = apiPipelineNext(pipe)
while isValid(result)
  ' result.entry is the caller's own AA, echoed back, so result.entry.libId needs no side table.
  ' result.res is the pool response AA, or invalid if this entry never got an answer.
  emitRow(result.entry.libId, result.res)
  result = apiPipelineNext(pipe)
end while
```

Before you use it:

- **Results arrive in completion order**, not entry order. Requests are sent in entry order, so on-screen work still starts first.
- **`budgetMs` is one budget for the whole run** (`timeouts.PIPELINE_RUN_MS`), not a per-request timeout. A per-request wait would let many slow requests stack up, each to `API_WAIT_MS`. When the budget runs out, the run stops sending and yields every remaining entry with `res = invalid`, so the call site needs no special case for it.
- **The budget is charged only while the run is inside `apiPipelineNext`**, sending and waiting. The caller's own work between calls (transforming a response, handing it to the render thread) is not charged, so a caller with many results cannot spend the budget on itself. The budget bounds a slow or dead server, not the run's total time. Anything that watches a run from outside must judge it by how long it has gone without delivering, not by how long it has run; `latestRows.runIsStalled` is the example.
- **`res = invalid` means "no answer", not "the server said no".** An HTTP error is a valid `res` with `ok = false`. A caller that removes UI on an empty result must tell the two apart, or a timeout will delete good content. `LoadLatestRowsTask` and `HomeRows` leave a failed row standing.
- **Leave the placeholder alone too.** Where a caller drew a skeleton before the run, doing nothing on failure is usually right: the placeholder stays, and the next successful run fills it in place. Clearing it forces the later success to create and insert the element again, which pops in and shifts everything after it. `HomeRows` leaves a failed latest row as it found it.

A run is a budget, not a promise of coverage. It handles roughly `PIPELINE_RUN_MS ÷ per-request latency × pool width` requests before it runs out, so on a large, distant server the tail of a run can come back undelivered. Design the call site for that; don't tune the constant for it.

`LoadLatestRowsTask` (Home's latest-media rows) is the canonical caller. Its state machine is split into a pure core and an I/O shell, for the same reason as `apiPromise.bs` ([async.md](async.md)).

## Reading a list endpoint's body

Most endpoints answer with a `{ Items: [...] }` query result, but some answer with a bare array; the Jellyfin OpenAPI spec says which, as a 200 response schema of `type: array`. Build those requests with `listReq` instead of `validatedReq`:

```brightscript
function BuildGetCulturesRequest() as dynamic
  return m.listReq("GET", buildURL("/Localization/Cultures"))
end function
```

`listReq` marks the request `expect: "list"`, and the pool holds the body to that shape: `ApiTask.executeRequest()` runs every response through `apiResponse.enforceShape()`. For a list request:

- **`ok` means `res.json` is an `roArray`.** Callers iterate it with no check of their own. It may be empty: empty is an answer, and the only way to say "empty".
- **A `{ Items: [...] }` wrapper is unwrapped** to its `Items`. Stock Jellyfin does not send one for these endpoints, but its `Items` is the same list, so reading it shows the user their content instead of leaving a row empty on every retry ([ADR 0039](../adr/0039-list-endpoint-shape-in-pool.md)).
- **Any other body arrives as a failure:** `ok = false`, `json = invalid`, `error = "unexpectedShape"`, with `statusCode` still the server's. Callers already treat `ok = false` as no answer, never as an empty list, so nothing on screen is removed (the same rule as `res = invalid` above).
- **The pool logs one `warn`**, naming the `requestId`, whenever a list endpoint answers with anything but a bare array, whether the wrapper was read through or the body rejected.

Which endpoints are list requests is the set of builders that call `listReq` (`grep listReq source/api/ApiClient.bs`), so it is not repeated here. The "List requests" group in `ApiClient.spec.bs` pins each one on both API versions.

**Why check the shape instead of trusting the spec.** BrightScript iterates an associative array's keys. If one of these endpoints ever answers with an object, `for each item in res.json` yields key strings, and the first `item.Type` (or a `res.json[0]`) is a runtime error that ends the app. It cannot fail softly. That happened in the field: a v2.30.0 crash report showed a server answering `/Items/Latest` with a query result, and the latest-media task crashed the app while Home loaded.

**Why in the pool, not at each call site.** A per-caller check has to be remembered by every caller, and one forgotten caller is a crash. A builder is where the endpoint, and so its shape, is decided, and every pooled response already passes through one function.

Two paths read a list without the pool's help:

- **The synchronous sign-in path** (`sdk.*` through `getJson`) never reaches `ApiTask`. Its one bare-array call, `ApiClient.GetPublicUsers()`, reads its body through `apiResponse.listFrom()` before returning it.
- **A caller that wants the list out of a response of either shape** reads it through `apiResponse.listFrom(res.json)`, which returns the array, a wrapper's `Items`, or `invalid`. `extrasRows.itemsFromResponse()` does this, because its rows mix both kinds of endpoint.

## Authentication and request building

[`source/api/baseRequest.bs`](../../source/api/baseRequest.bs) holds the low-level helpers:

| Function | What it does |
| --- | --- |
| `buildURL(path, params, serverURL)` | The server URL (`m.global.server.serverUrl`, or `serverURL` when the caller already has it), then `path`, then the encoded query string |
| `buildParams(params)` | Turns an AA into a URL-encoded query string, by value type |
| `buildAuthHeader(shouldIncludeDeviceName = true)` | The `Authorization` header value ([below](#the-authorization-header)) |
| `executeHttpRequest(req, defaultMethod, logLabel)` | The shared executor behind both task tiers ([below](#one-executor-for-both-tiers)) |

`buildParams` encodes strings, integers, long integers, booleans and `invalid` (as `null`). It truncates a float to an integer, and it drops an array value: that branch is a `TODO`. Pass a list as a comma-joined string, as the image defaults do.

### The `Authorization` header

`buildAuthHeader()` returns `MediaBrowser Client="…", Version="…", UserId="…", DeviceId="…", Token="…"`, plus a free-text `Device="<name> (<model>)"` unless `shouldIncludeDeviceName` is `false`. `UserId` and `Token` appear only when set.

`DeviceId` is the session identity. Jellyfin reads it from this header and nowhere else, never from a query string, and falls back to the id the auth token was minted under when the header omits it. So every channel that opens a Jellyfin session must send this header, or it lands on a different session with no error. The only caller passing `false` is the `ws://` remote-control handshake; see [remote-control.md](remote-control.md) and decision `deviceid-header-authoritative`.

### One executor for both tiers

`executeHttpRequest()` attaches the auth header, resolves the timeout (`apiTimeout.httpMs(req)`: the request's own `timeoutMs`, else `timeouts.HTTP_MS`), defaults `Content-Type` to `application/json` when there is a body, and makes the `roku-requests` call. It returns `invalid` for a missing or empty URL and leaves the caller to decide how to report that.

```brightscript
' components/api/ApiTask.bs, the pool; maps invalid to an error response AA
r = executeHttpRequest(req, "GET", "[ApiTask]")

' components/api/SideEffectTask.bs, fire-and-forget; result discarded
executeHttpRequest(child.request, "POST", "[SideEffectTask]")
```

Because both tiers go through it, code that builds a request never attaches auth itself.

## V1 and V2 dispatch

Jellyfin's API changed shape between 10.8 (V1) and 10.9 (V2). Many endpoints moved. For example, `/users/{userId}/items/{itemId}` in V1 became `/Items/{itemId}?userId={userId}` in V2.

JellyRock supports both, and each `ApiClient` method branches on `m.getApiVersion() >= 2` (the `BuildGetItemRequest` sample [above](#layer-1-apiclient)). There is no central routing table. `getApiVersionFromGlobal()` in `misc.bs` reads `m.global.server.apiVersion`, which `server.Populate()` in `session.bs` sets from the server's `/System/Info/Public` version (`resolveApiVersion()`). A comment in `ApiClient.bs` says to add an `else if` branch in each method when a third version arrives.

[`jellyfin-server-versioning.md`](../dev/jellyfin-server-versioning.md) is the version policy guide, and the `/new-api-version` skill walks adding a tier.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md): search its `area` fields for `source/api/` and `ApiClient`.
