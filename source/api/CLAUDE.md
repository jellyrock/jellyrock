# Rules for `source/api/`

Jellyfin API layer + task pool dispatcher. See [docs/architecture/api.md](../../docs/architecture/api.md) for the full design (3-layer model, persistent task pool, `V1/V2` dispatch, the five call patterns, the children-as-vehicle trick to dodge SceneGraph event coalescing).

## The 3-layer model

Pick the right layer for the job:

- **Layer 3 — domain helpers** (`imageHelpers.bs`): one-call solutions with built-in fallback chains. Use for poster/backdrop/logo URLs. UI components usually want this.
- **Layer 2 — business logic** (`image.bs`, `userAuth.bs`, `items.bs`): validation, defaults, graceful degradation. Returns empty string / `invalid` on missing prerequisites rather than building bad URLs.
- **Layer 1 — `ApiClient`** (`ApiClient.bs`): singleton via `GetApi()`. Per-method `Build*Request()` returns a request AA for the task pool. Auto-injects user ID, applies image defaults, routes `V1/V2`.

Decision flow:

| Need | Use |
|---|---|
| Poster / backdrop / logo URL for an item | Layer 3 |
| Custom image URL | Layer 2 (`ImageURL`) |
| Any other API endpoint | Layer 1 (`GetApi().Build*Request()` + task pool) |
| New endpoint | Add a `Build*Request()` method on `ApiClient`; route `V1/V2` if needed |

`docs/dev/api-layering-guide.md` is the canonical decision-tree how-to.

## Task pool — the five call patterns

| Pattern | Use case | From |
|---|---|---|
| `fetchRes(req, id)` / `fetchJson(req, id)` | Blocking; common case for orchestrator Tasks | a Task thread |
| `submitApiRequest(req, id)` | Non-blocking; user clicks → fire → toggle UI on response | render thread |
| `SubmitSideEffect(req)` | Fire-and-forget POST/DELETE (telemetry, mark-watched) | anywhere |
| Dedicated `Task` + `roUrlTransfer` | Non-Jellyfin HTTP (font downloads, SSDP, …) | a Task component |
| `apiPipelineBegin` / `apiPipelineNext` | N *independent* requests that scale with server data (per library, per season) | a Task thread |

**Never spawn a Task per request** to parallelize N calls — that fan-out is what produced the `&h29` "too many task threads" crashes (#728). Use `apiPipeline`: one thread, up to `apiPool.SLOT_COUNT` requests in flight. Note `res = invalid` from it means *no answer*, not an error response — don't clear **populated** UI on it. UI the caller drew before the run (a skeleton / placeholder) is the exception: protecting that strands it on screen blank, so clear it. See `HomeRows.discardEmptyLatestRow`.

## `V1` vs `V2` dispatch

- `Jellyfin`'s API changed shape between **10.7–10.8** (V1) and **10.9+** (V2). Many endpoints moved or restructured.
- Read `m.global.server.apiVersion` via `getApiVersionFromGlobal()`.
- Per-method branching inside `ApiClient` is the current convention. Add new endpoints with the same `if m.getApiVersion() >= 2` shape.
- See `docs/dev/jellyfin-server-versioning.md` for the version-policy guide.

## Don't bypass `ApiClient`

- `source/api/sdk.bs`, `sdkV1.bs`, `sdkV2.bs` are the underlying endpoint wrappers. **Don't call them directly** from app code — go through `GetApi()`. The `no-direct-sdk` BSC plugin enforces this at build time; only `ApiClient.bs` and `sdk.bs` itself are allowed to invoke `sdk.<ns>.<fn>(...)`. See [docs/architecture/build-and-tooling.md](../../docs/architecture/build-and-tooling.md) ("Convention plugins") for the opt-out syntax (rare).

## Auth header is automatic

- `ApiTask.executeRequest()` prepends the auth header (`MediaBrowser Token=...`) automatically. Callers building a request don't need to attach it.

## What NOT to do

- Don't add a new `Get*()` synchronous method on `ApiClient`. Sync exists for the bootstrap path; new endpoints use `Build*Request()`.
- Don't write requests directly to a pool slot's field — go through `apiQueue` (children-as-vehicle dodge SceneGraph coalescing). See [docs/architecture/api.md](../../docs/architecture/api.md#the-coalescing-problem-why-children-not-fields).
- Don't increase the pool size without measuring; three slots is intentional.
