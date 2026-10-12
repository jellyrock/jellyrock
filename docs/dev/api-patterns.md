---
topic: api-patterns
related-files:
  - source/api/apiPool.bs
  - source/api/apiPipeline.bs
  - source/api/ApiClient.bs
  - source/api/baseRequest.bs
  - components/api/ApiQueueTask.bs
  - components/api/ApiTask.bs
  - components/api/ApiResultNode.xml
  - components/api/SideEffectTask.bs
last-reviewed: 2026-10-09
---

# API request patterns

Every API call runs on a Task thread. The render thread and the main thread (the event loop in `main.bs`) never wait on an HTTP request.

## How requests run

JellyRock runs API requests on two tiers of persistent Task threads:

- **Tier 1, the `ApiTask` pool**, handles every request whose answer the app needs, which is mostly reads (GET). Its workers (`apiPool0` and up) take requests in order from the `ApiQueueTask` coordinator. The pool's width is [chosen per device class](../architecture/api.md#pool-width).
- **Tier 2, `SideEffectTask`**, handles fire-and-forget writes (POST, DELETE). It is one thread, so writes run one at a time in the order they were sent.

Both tiers carry each request on its own new `ApiResultNode`, so two requests sent back to back can never merge into one field change. Both send the request through `executeHttpRequest()` in `baseRequest.bs`, which adds the auth header, the timeout and the content type.

## Patterns

### Pattern 1: `fetchAsync` (one request from the render thread)

Send a request to the pool from the render thread and handle the answer in a promise callback.

```brighterscript
req = GetApi().BuildGetLocalTrailersRequest(itemId)
promises.chain(fetchAsync(req, "trailerCheck-" + itemId)).then(sub(res as object)
  if res.ok then m.top.trailerAvailable = res.json.Count() > 0  ' trivial assignment only
end sub).catch(sub(err as object)
  m.top.trailerAvailable = false  ' the request never completed
end sub)
```

The render thread never makes the HTTP call. `fetchAsync()` hands the request to the coordinator through `submitApiRequest()` and returns a promise at once. An `ApiTask` thread makes the call. The promise also times the request out, and is dropped when the component is destroyed.

**Use it when** you need one call and the callback does something small, such as setting a flag or reading one value. Don't transform data or loop over arrays in the callback. The [promises guide](promises.md) covers which outcomes reach `.then` and which reach `.catch`, and how to pass state to the callbacks.

Don't observe the `ApiResultNode` that `submitApiRequest()` returns yourself: [`promise-ratchet.cjs`](../../scripts/lint/promise-ratchet.cjs) fails CI on any raw `observeField("isDone", …)` in app code.

### Pattern 2: Orchestrator Task (several calls, or transforms)

Write a Task component that calls `fetchRes()` or `fetchJson()` itself. The caller creates the task, sets its input fields and observes its output.

```brighterscript
m.myTask = CreateObject("roSGNode", "MyOrchestrator")
m.myTask.input = { ... }
m.myTask.observeField("output", "onMyTaskDone")
m.myTask.control = "RUN"
```

**Use it when** you make several calls in sequence or by condition, transform the data (`JellyfinDataTransformer`), or process large arrays. Examples: `LoadItemsTask`, `SearchTask`, `QuickPlayTask`.

**Overlap a request that doesn't depend on another one's answer.** Send it first with `submitApiRequest(req, id, port)`, make the blocking `fetchRes()` call, then collect the first answer with `collectApiRequest(node, port)`. The two waits then overlap instead of adding up. If your task has its own deadline, pass the longest you will wait as the third argument. If you turn out not to need the answer, call `dropApiRequest(node)` so the pool can skip it. `LoadItemsTask.keepStartedSeries()` is the reference.

### Pattern 3: `SubmitSideEffect` (fire-and-forget writes)

```brighterscript
SubmitSideEffect(GetApi().BuildMarkFavoriteRequest(itemId))
```

It returns at once, runs after any writes sent before it, and gives no response.

**Use it when** you write (POST, DELETE) and don't need the response: marking an item played or a favorite, deleting, reporting playback state.

### Pattern 4: Dedicated Task (not the Jellyfin API)

Write a standalone Task for HTTP that isn't the Jellyfin API, for binary downloads, or for a loop that runs on a timer. Examples: `LoadCaptionTask` and `ServerDiscoveryTask` (`roUrlTransfer`), `FontDownloadTask` (`rr_Requests()`).

**Keep the fetch and any render-thread work in separate components.** A component's `m` is shared between its Task thread and its render-thread code. Captions used to be one component that fetched the file and also ran a render-thread caption timer, and that shared `m` caused an `&hf3` crash. Now `LoadCaptionTask` only fetches, and `CaptionRenderer` (a `Group`, with no Task function) only draws, so the race cannot happen. Build anything new in that shape.

**If one component must do both, make the request with `roUrlTransfer` and `port.WaitMessage()`, not `rr_Requests()`.** `rr_Requests_run()` runs with the component's shared `m`, and its loop reads `m.top` constantly from the Task thread while it waits. Render-thread code reading `m` at the same time (a timer, a field observer) races with it, which corrupts `m` and crashes the app at random. `FontDownloadTask` still uses `rr_Requests()` because nothing on the render thread runs in that component.

### Pattern 5: `apiPipeline` (many independent requests, one thread)

Use it inside an orchestrator Task (pattern 2) when the calls don't depend on each other. It keeps one request per pool slot in flight without starting a thread per request.

```brighterscript
entries = []
for each lib in libs
  entries.push({ requestId: "latestRow-" + lib.id, req: GetApi().BuildGetLatestMediaRequest(params), libId: lib.id })
end for

pipe = apiPipelineBegin(entries)
result = apiPipelineNext(pipe)
while isValid(result)
  emitRow(result.entry.libId, result.res)   ' entry = your AA, echoed back
  result = apiPipelineNext(pipe)
end while
```

**Use it when** an orchestrator makes one request per library, per season or per anything else the server's data decides. Never start a Task per request for this: that fan-out caused the `&h29` crashes in #728.

Results arrive in the order they finish. `budgetMs`, the second argument to `apiPipelineBegin()`, is one time budget for the whole run, so a server that doesn't answer can't cost one full timeout per request. The budget only runs down while you are inside `apiPipelineNext()`, so your own work on each result doesn't use it up.

`res = invalid` means no answer: the request was never sent, or the budget ran out. An HTTP error is a valid `res` with `ok = false`. Tell the two apart when you decide whether to clear what the screen shows.

Example: `LoadLatestRowsTask`.

## Which pattern to use

1. A write whose response you don't need: pattern 3, `SubmitSideEffect`.
2. One read from the render thread whose callback sets a field: pattern 1, `fetchAsync`.
3. Several calls, branching, or data transforms: pattern 2, an orchestrator Task.
4. HTTP that isn't the Jellyfin API, or a binary download: pattern 4, a dedicated Task.
5. Inside an orchestrator, independent calls whose number depends on the server's data: pattern 5, `apiPipeline`.

## Rules

- Never call `fetchRes()` or `fetchJson()` from the render thread or the main thread. They block until the answer arrives.
- Don't add calls to the synchronous `GetApi().Get*()` methods (those without `Build` in the name). They make the HTTP call on the calling thread. The few that remain are on the sign-in path ([api.md](../architecture/api.md)).
- Never create an `roUrlTransfer` outside a Task thread.
- Don't add cases to `LoadItemsTask` for new components. Give the component its own Task instead. Existing cases stay until they are moved.

## Key files

| File | Purpose |
| --- | --- |
| `source/api/apiPromise.bs` | `fetchAsync()`: one request from the render thread, as a promise |
| `source/api/apiPool.bs` | `fetchRes()`, `fetchJson()`, `submitApiRequest()`, `collectApiRequest()`, `dropApiRequest()`, `SubmitSideEffect()` |
| `source/api/apiPipeline.bs` | `apiPipelineBegin()` and `apiPipelineNext()`: many independent requests on one Task thread |
| `source/api/apiIds.bs` | `apiIds.chunks()`: splits a lookup's `Ids=` list so each request line stays short |
| `source/api/ApiClient.bs` | The `Build*Request()` methods that create request AAs |
| `components/api/ApiQueueTask.bs` | The coordinator that hands requests to the pool in order |
| `components/api/ApiTask.bs` | A pool worker that makes the HTTP calls |
| `components/api/ApiResultNode.xml` | Carries one request in and its result out |
| `components/tasks/QuickPlayTask.bs` | Orchestrator for Quick Play, **Play All**, **Instant Mix** and trailers |
