# Rules for `source/api/`

The Jellyfin API layer and the Task pool that runs its requests. [docs/architecture/api.md](../../docs/architecture/api.md) has the full design: the three layers, the persistent Task pool, the V1 and V2 dispatch, the five call patterns, and why requests travel as child nodes (SceneGraph coalesces field writes).

## The three layers

Pick the right layer for the job:

- **Layer 3, domain helpers** (`source/utils/itemImageUrl.bs`, `source/utils/rowItemImage.bs`): one call with a built-in fallback chain. Use them for poster, backdrop and logo URLs; UI components usually want this layer. The user avatar URL is `GetUserAvatarURL` in `imageHelpers.bs`.
- **Layer 2, business logic** (`image.bs`, `userAuth.bs`, `items.bs`): validation, defaults and graceful degradation. Returns an empty string or `invalid` when a prerequisite is missing, rather than building a bad URL.
- **Layer 1, `ApiClient`** (`ApiClient.bs`): a singleton through `GetApi()`. Each `Build*Request()` method returns a request AA for the Task pool, filling in the user ID and the default image parameters and picking the V1 or V2 path.

| Need | Use |
|---|---|
| A poster, backdrop or logo URL for an item | Layer 3 |
| A custom image URL | Layer 2 (`ImageURL`) |
| Any other API endpoint | Layer 1 (`GetApi().Build*Request()` and the Task pool) |
| A new endpoint | A new `Build*Request()` method on `ApiClient`, branching on the API version if needed |

[`docs/dev/api-layering-guide.md`](../../docs/dev/api-layering-guide.md) is the how-to with the full decision tree.

## The five call patterns

| Pattern | Use it for | From |
|---|---|---|
| `fetchRes(req, id)` or `fetchJson(req, id)` | Blocking; the common case for an orchestrator Task | A Task thread |
| `fetchAsync(req, id)` | A promise, for a component that needs the answer | The render thread |
| `SubmitSideEffect(req)` | A write nobody reads the answer to (telemetry, mark watched) | Any thread |
| A dedicated `Task` with `roUrlTransfer` | Non-Jellyfin HTTP (font downloads, SSDP) | A Task component |
| `apiPipelineBegin` and `apiPipelineNext` | Many independent requests that scale with server data (per library, per season) | A Task thread |

Details and examples: [api.md](../../docs/architecture/api.md#the-five-call-patterns).

**Never start a Task per request** to run many calls in parallel: that fan-out caused the `&h29` "too many task threads" crashes (#728). Use `apiPipeline`: one thread, with one request in flight per pool slot. A `res = invalid` from it means *no answer*, not an error response. Don't clear UI on it, including a skeleton or placeholder the caller drew before the run: clearing it makes the next success insert the element again, which pops in and shifts the rows after it.

## V1 and V2 dispatch

- Jellyfin's API changed shape between **10.7 to 10.8** (V1) and **10.9 and later** (V2). Many endpoints moved or changed.
- Read the tier with `getApiVersionFromGlobal()`, which reads `m.global.server.apiVersion`.
- Each `ApiClient` method branches on its own: add a new endpoint with the same `if m.getApiVersion() >= 2` shape.
- [`docs/dev/jellyfin-server-versioning.md`](../../docs/dev/jellyfin-server-versioning.md) is the version-policy guide.

## Don't bypass `ApiClient`

- `source/api/sdk.bs`, `sdkV1.bs` and `sdkV2.bs` are the endpoint wrappers underneath. **Don't call them from app code**; go through `GetApi()`. The `no-direct-sdk` BSC plugin makes it a build error: only `ApiClient.bs` and `sdk.bs` may call `sdk.<ns>.<fn>(...)`. [build-and-tooling.md](../../docs/architecture/build-and-tooling.md) gives the opt-out syntax, which is rarely needed.

## The auth header is automatic

- `executeHttpRequest()` in `baseRequest.bs`, which every pool request goes through, adds the `Authorization` header (`buildAuthHeader()`). A request you build doesn't attach it. See [api.md](../../docs/architecture/api.md#authentication-and-request-building).

## What not to do

- Don't add a new synchronous `Get*()` method on `ApiClient`. The four that remain are on the sign-in path, which runs on the main thread; a new endpoint uses `Build*Request()`.
- Don't build a request for a **bare-array endpoint** (spec 200 response `type: array`) with `validatedReq`. Use `listReq`, and add the request to the "List requests" group in `ApiClient.spec.bs`. The pool then guarantees a response with `ok = true` carries an `roArray`, and reports any other body as `ok = false` with `error = "unexpectedShape"`, which callers treat as no answer. Without it an object body reaches the caller and iterates as its keys, and the first `item.Field` or `json[0]` crashes the app. See [api.md](../../docs/architecture/api.md#reading-a-list-endpoints-body).
- **A POST that only reads declares `skippable: true` on its request AA** (`BuildGetLiveTvScheduleRequest` is the one today). The pool skips a queued GET or HEAD whose caller has stopped waiting, and never a POST or DELETE, because a write the user asked for must land. A POST that queries and has no side effect on the server opts in. Don't mark one that can change server state: `BuildPostPlaybackInfoRequest` sends `AutoOpenLiveStream`, which can open a live stream. See [api.md](../../docs/architecture/api.md#a-request-nobody-is-waiting-for).
- **Don't add a cross-thread read to the coordinator's dispatch path** (`apiPoolNextDispatch`, `ApiQueueTask.tryDispatch`). Every request the app makes passes through it in turn, and a rendezvous there costs milliseconds while the render thread is busy. Reading two fields per entry to decide whether to skip it measured **7796 µs per request**, against 88 µs once the same check was confined to requests that had waited for a slot (Stick 4K, Home load, 2026-09-22). Anything a dispatch decision needs rides the request AA the coordinator already holds, or is confined to a population that can't be the common case. Take the numbers again with `npm run measure -- --measurement api-dispatch`. See [api.md](../../docs/architecture/api.md#a-request-nobody-is-waiting-for) and [ADR 0040](../../docs/adr/0040-pool-skips-abandoned-reads.md).
- Don't write a request straight to a pool slot's field. Go through `apiQueue`, whose child nodes avoid the coalescing SceneGraph applies to field writes. See [api.md](../../docs/architecture/api.md#the-coalescing-problem-why-children-not-fields).
- Don't change the pool width (`source/constants/apiPool.bs`) without measuring on a device. Both values were measured, one per device class, and each slot is a thread for the whole session. See [api.md](../../docs/architecture/api.md#pool-width). Don't restate the width, or a slot or thread count derived from it, in comments or docs elsewhere: it differs per device, so say "one per pool slot" or link that section.
