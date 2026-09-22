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

**Never spawn a Task per request** to parallelize N calls — that fan-out is what produced the `&h29` "too many task threads" crashes (#728). Use `apiPipeline`: one thread, one request per pool slot in flight. Note `res = invalid` from it means *no answer*, not an error response — don't clear UI on it, including a skeleton/placeholder the caller drew before the run (clearing that makes the next success re-insert the element, which pops in and shifts the rows after it).

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
- Don't build a request for a **bare-array endpoint** (spec 200 response `type: array`) with `validatedReq` — use `listReq`, and add it to the "List requests" group in `ApiClient.spec.bs`. The pool then guarantees an ok response carries an `roArray` and reports any other body as `ok = false` (`error = "unexpectedShape"`), which callers treat as no answer. Without it an object body reaches the caller, iterates as its KEYS, and the first `item.Field` or `json[0]` ends the app. See [docs/architecture/api.md](../../docs/architecture/api.md#reading-a-list-endpoints-body--sourceapiapiresponsebs).
- **A POST that only reads declares `skippable: true` on its request AA** (`BuildGetLiveTvScheduleRequest` is the one today). The pool skips a queued GET/HEAD whose caller has stopped waiting, and never a POST/DELETE, because a write the user asked for must land. A POST that queries, and has no side effect on the server, opts in. Don't mark one that can change server state: `BuildPostPlaybackInfoRequest` sends `AutoOpenLiveStream`, which can open a live stream. See [docs/architecture/api.md](../../docs/architecture/api.md#a-request-nobody-is-waiting-for).
- Don't write requests directly to a pool slot's field — go through `apiQueue` (children-as-vehicle dodge SceneGraph coalescing). See [docs/architecture/api.md](../../docs/architecture/api.md#the-coalescing-problem-why-children-not-fields).
- Don't change the pool width (`source/constants/apiPool.bs`) without measuring on device — the two values are measured, per device class, and each slot is a thread for the whole session. See [docs/architecture/api.md](../../docs/architecture/api.md#pool-width). Don't restate the width (or a slot/thread count derived from it) in comments or docs elsewhere — it differs per device, so say "one per pool slot" or link that section.
