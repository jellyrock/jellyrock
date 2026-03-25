# API Request Patterns

All API calls must run on Task threads. The render thread and main thread (Main.bs event loop) must **never** block on an HTTP request.

## Infrastructure

JellyRock uses a two-tier API task pool:

- **Tier 1 (`ApiTask` pool)**: 3 persistent workers (`apiPool0/1/2`) coordinated by `ApiQueueTask` FIFO coordinator. Handles all GET/query requests.
- **Tier 2 (`SideEffectTask`)**: Single persistent node for fire-and-forget write operations (POST/DELETE).

All pool communication uses `ApiResultNode` per-request routing, immune to SceneGraph event coalescing.

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

Direct `rr_Requests()` in a standalone Task. For non-Jellyfin HTTP, binary downloads, timer-driven loops.

Examples: `captionTask`, `FontDownloadTask`, `ServerDiscoveryTask`

## Decision Tree

1. Write operation, don't need response? --> **Pattern 3** (SubmitSideEffect)
2. Single GET, callback just sets a field? --> **Pattern 1** (submitApiRequest)
3. Multiple calls, branching logic, or data transforms? --> **Pattern 2** (Orchestrator Task)
4. Non-API HTTP or binary download? --> **Pattern 4** (Dedicated Task)

## Rules

- **NEVER** call `fetchRes()`/`fetchJson()` from the render thread or main thread (they block with `wait()`)
- **NEVER** call legacy `GetApi().GetX()` execute-and-return methods from any thread (deprecated)
- **NEVER** instantiate `roUrlTransfer` outside a Task thread
- New components should **NOT** add cases to `LoadItemsTask` -- create component-owned tasks instead
- Existing `LoadItemsTask` cases remain; migrate to component-owned tasks over time

## Key Files

| File | Purpose |
| ------ | ------- |
| `source/api/ApiPool.bs` | `fetchRes()`, `fetchJson()`, `submitApiRequest()`, `SubmitSideEffect()` |
| `source/api/ApiClient.bs` | `Build*Request()` methods that create request AAs |
| `components/api/ApiQueueTask.bs` | FIFO coordinator for the pool |
| `components/api/ApiTask.bs` | Pool worker that executes HTTP requests |
| `components/api/ApiResultNode.xml` | Per-request vehicle (request in, result out) |
| `components/tasks/QuickPlayTask.bs` | Orchestrator for quickplay/Play All/Instant Mix/Trailer |
