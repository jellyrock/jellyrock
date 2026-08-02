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
last-reviewed: 2026-08-02
---

# API Request Patterns

All API calls must run on Task threads. The render thread and main thread (Main.bs event loop) must **never** block on an HTTP request.

## Infrastructure

JellyRock uses a two-tier API task pool:

- **Tier 1 (`ApiTask` pool)**: 3 persistent workers (`apiPool0/1/2`) coordinated by `ApiQueueTask` FIFO coordinator. Handles all GET/query requests.
- **Tier 2 (`SideEffectTask`)**: Single persistent worker running a FIFO children-as-vehicle queue for fire-and-forget writes (POST/DELETE). Requests execute serially on its one thread.

**Both tiers** use `ApiResultNode` per-request routing (a fresh child node per request), immune to SceneGraph event coalescing. Tier 2 adopted this in #744 — the earlier single shared `request` field could coalesce two back-to-back submits and silently drop one. The shared HTTP execution (auth header, timeout, Content-Type) lives once in `baseRequest.bs`'s `executeHttpRequest()`, called by both `ApiTask` and `SideEffectTask`.

## Patterns

### Pattern 1: `submitApiRequest` (single non-blocking request)

Submits a request to the API pool from the render thread and returns immediately. The render thread observes the result via a callback.

```brighterscript
m.resultNode = submitApiRequest(GetApi().BuildGetXRequest(...), "myReq")
if isValid(m.resultNode)
  m.resultNode.observeField("done", "onMyReqDone")
end if

sub onMyReqDone()
  res = m.resultNode.result
  m.resultNode.unobserveField("done")
  m.resultNode = invalid
  if isValid(res) and res.ok
    m.top.someField = res.json.SomeValue  ' trivial assignment only
  end if
end sub
```

The render thread does NOT make the HTTP call. `submitApiRequest()` creates an `ApiResultNode`, appends it to the coordinator, and returns (~microseconds). The actual HTTP runs on an `ApiTask` pool thread.

**Use when**: Single API call with a trivial callback (set a boolean, read one value). NO data transforms, NO array loops.

### Pattern 2: Orchestrator Task (multi-call or transforms)

Create a Task component that calls `fetchRes()`/`fetchJson()` internally. The caller creates the task, sets input fields, observes output.

```brighterscript
m.myTask = CreateObject("roSGNode", "MyOrchestrator")
m.myTask.input = { ... }
m.myTask.observeField("output", "onMyTaskDone")
m.myTask.control = "RUN"
```

**Use when**: Multiple sequential/conditional API calls, data transformation (`JellyfinDataTransformer`), or large array processing.

Examples: `LoadItemsTask`, `SearchTask`, `QuickPlayTask`

### Pattern 3: `SubmitSideEffect` (fire-and-forget writes)

```brighterscript
SubmitSideEffect(GetApi().BuildMarkFavoriteRequest(itemId))
```

Non-blocking, serialized, no response observed.

**Use when**: POST/DELETE where response isn't needed (mark watched, favorite, delete, playstate).

### Pattern 4: Dedicated Task (non-API)

Standalone Task for non-Jellyfin HTTP, binary downloads, or timer-driven loops.

Use `roUrlTransfer` + `port.WaitMessage()` for the HTTP request. **Do NOT use `rr_Requests()` in Tasks with active render-thread timers or frequent field observers.** `rr_Requests_run()` is a standalone function whose `m` resolves to the component's shared `m` AA; its busy-polling loop reads `m.top` thousands of times per second from the task thread, racing with any render-thread code that also reads `m`. This data race corrupts the AA's internal state and causes intermittent crashes.

`FontDownloadTask` still uses `rr_Requests()` safely because it has no render-thread timers — the collision window is negligible. Tasks with timers (like `captionTask`) must use `roUrlTransfer` + `WaitMessage()` instead.

Examples: `captionTask` (`roUrlTransfer` + `WaitMessage`), `FontDownloadTask` (rr_Requests), `ServerDiscoveryTask` (`roUrlTransfer` + wait)

### Pattern 5: `apiPipeline` (N independent requests, one thread)

Inside an orchestrator Task (Pattern 2), when the calls are independent of each other rather than sequential. Keeps up to `apiPool.SLOT_COUNT` requests in flight without adding a thread per request.

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

**Use when**: an orchestrator has N independent requests where N scales with server data (per library, per season). Never spawn a Task per request for this — that's the fan-out behind the `&h29` crashes (#728).

Results arrive in completion order. `budgetMs` is a whole-run deadline, so a dead server can't cost N × `API_WAIT_MS`. `res = invalid` means **no answer** (never submitted, or the budget ran out) — an HTTP error is a valid `res` with `ok = false`, so don't treat the two the same when deciding whether to clear UI.

Example: `LoadLatestRowsTask`

## Decision Tree

1. Write operation, don't need response? --> **Pattern 3** (SubmitSideEffect)
2. Single GET, callback just sets a field? --> **Pattern 1** (submitApiRequest)
3. Multiple calls, branching logic, or data transforms? --> **Pattern 2** (Orchestrator Task)
4. Non-API HTTP or binary download? --> **Pattern 4** (Dedicated Task)
5. Inside an orchestrator, N *independent* calls that scale with server data? --> **Pattern 5** (apiPipeline)

## Rules

- **NEVER** call `fetchRes()`/`fetchJson()` from the render thread or main thread (they block with `wait()`)
- **NEVER** call legacy `GetApi().GetX()` execute-and-return methods from any thread (deprecated)
- **NEVER** instantiate `roUrlTransfer` outside a Task thread
- New components should **NOT** add cases to `LoadItemsTask` -- create component-owned tasks instead
- Existing `LoadItemsTask` cases remain; migrate to component-owned tasks over time

## Key Files

| File | Purpose |
| ------ | ------- |
| `source/api/apiPool.bs` | `fetchRes()`, `fetchJson()`, `submitApiRequest()`, `SubmitSideEffect()` |
| `source/api/apiPipeline.bs` | `apiPipelineBegin()` / `apiPipelineNext()` — N independent requests on one Task thread |
| `source/api/ApiClient.bs` | `Build*Request()` methods that create request AAs |
| `components/api/ApiQueueTask.bs` | FIFO coordinator for the pool |
| `components/api/ApiTask.bs` | Pool worker that executes HTTP requests |
| `components/api/ApiResultNode.xml` | Per-request vehicle (request in, result out) |
| `components/tasks/QuickPlayTask.bs` | Orchestrator for quickplay/Play All/Instant Mix/Trailer |
