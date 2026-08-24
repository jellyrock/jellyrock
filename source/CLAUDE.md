# Rules for `source/`

BrighterScript modules — shared utilities and orchestration that doesn't live in components. See [docs/architecture/bootstrap.md](../docs/architecture/bootstrap.md) for the entry point and global setup, and [docs/architecture/api.md](../docs/architecture/api.md) for the API layering model.

## File scoping

- **`source/` is BS only.** No XML files here.
- Files in `source/` auto-scope together — code in any `source/*.bs` can call any other `source/*.bs` function without `import`.
- To use `source/` code from a component, add `import "pkg:/source/<path>.bs"` (always pkg-rooted; no relative paths).

## Render thread protection

- Anything that does I/O must run on a Task thread (network, registry I/O, large file reads). Which thread is which (there are three, and main ≠ render): [threading.md](../docs/architecture/threading.md).
- **Which thread the caller is on decides what a node access costs.** A `source/*.bs` helper runs on whichever thread called it, and nodes are render-owned by default (`m.global` included): the same `m.global` field read is **2.0 µs from the render thread and 93 µs from a Task thread** (Stick 4K, ~46×). So a helper that is cheap when a component calls it can be expensive when a Task does. ⚠️ **Being on the right thread is not the same as being free** — a per-entry walk over Task nodes still costs ~20 µs/entry there, so budget the loop too. Measured table: [threading.md](../docs/architecture/threading.md#measured-findings).
- **Start that Task with `launchTask(node)`** (`source/utils/tasks.bs`), never a raw `node.control = "RUN"` (or `node["control"] = "RUN"`, or `node.setField("control", "RUN")`) — the `no-raw-run` BSC plugin makes all three a build error so the thread count stays bounded and measurable (epic #728). An invalid node is a silent `false` rather than the crash the raw form gave; debug builds print when that happens. Note `source/` files only auto-scope within the `source` scope: a `source/*.bs` file that calls `launchTask` and is also imported by a component must `import "pkg:/source/utils/tasks.bs"` explicitly, or that component's scope won't resolve it.
- **Never launch one Task per item.** A `launchTask()` inside a loop is a build error (`no-task-fanout`) unless its argument is a fixed `m.<field>` slot the loop doesn't rebind — one thread per library is the shape #728 took, and correct teardown does not save you (the crash is concurrent launches inside one screen load, not threads leaked across navigation). Service every item from one orchestrator Task over [`apiPipeline`](api/apiPipeline.bs) instead; `components/home/LoadLatestRowsTask.bs` is the reference.
- HTTP: route through `GetApi().Build*Request()` + `fetchRes()` / `submitApiRequest()` / `SubmitSideEffect()`. See [docs/architecture/api.md](../docs/architecture/api.md) for the four call patterns.
- Synchronous `Get*()` methods on `ApiClient` exist for the bootstrap path only (login, server discovery before the pool is up). **Don't add new sync API calls.**

## Logging

- Component / class init: `m.log = new log.Logger("Name")`. Top-level functions in `source/*.bs` have no `m`, so no `m.log` — `print` is the only option there, and the `print-locations` plugin auto-skips them.
- See [docs/architecture/logging.md](../docs/architecture/logging.md) for the levels and [build-and-tooling.md](../docs/architecture/build-and-tooling.md) for plugin opt-outs.
- **Never concatenate values into log/print messages — use the multi-arg form.** BrightScript's `+` does not coerce booleans (and several other types) to string, so `"" + someBool` raises `ERR_TM` at runtime — not caught by lint, only by sideloading and crashing.
  - `print` — separate label and values with `;` (or `,`): `print "channels="; channelCount; " codec="; codec`
  - `m.log.*` — pass label/value pairs as separate args, never concatenated: `m.log.debug("channels", channelCount, "codec", codec)`
- **`m.log.*` calls accept at most 9 args (including the message string).** roku-log was designed around a fixed-arity formatter; the cap is real. If you need more context, split into two log lines rather than concatenating.

## What lives in subfolders

| Folder | Purpose |
|---|---|
| `source/api/` | API client + task pool dispatcher + per-domain helpers. Has its own CLAUDE.md. |
| `source/utils/` | Cross-cutting utilities (translate, config, registry, languages, …). Has its own CLAUDE.md. |
| `source/data/` | Data transformers (session, Jellyfin items). Pure functions; no Tasks. |
| `source/GridView/` | Grid presenters per library type. |
| `source/enums/` | Enum constants. |
| `source/constants/` | Shared constants (timeouts, sizes, …). |
| `source/migrations.bs` | Registry-schema migrations. See [docs/architecture/migrations.md](../docs/architecture/migrations.md). |
| `source/main.bs` | Entry point; bootstrap; main event loop. See [docs/architecture/bootstrap.md](../docs/architecture/bootstrap.md). |
| `source/showScenes.bs` | One router-agnostic helper (perf beacon). `LoginFlow` + the scene factories were removed in the #550 sgRouter migration; the dead resume/start-over dialog followed. |
