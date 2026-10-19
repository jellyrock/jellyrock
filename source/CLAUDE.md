# Rules for `source/`

BrighterScript modules: shared utilities and the orchestration that doesn't live in components. See [docs/architecture/bootstrap.md](../docs/architecture/bootstrap.md) for the entry point and global setup, and [docs/architecture/api.md](../docs/architecture/api.md) for how the API layer is built.

## File scoping

- **`source/` is BrighterScript only.** No XML files here.
- Files in `source/` share one scope: code in any `source/*.bs` can call any other `source/*.bs` function without `import`.
- To use `source/` code from a component, add `import "pkg:/source/<path>.bs"`. Always root the path at `pkg:/`, never relative.

## Render thread protection

- Anything that does I/O runs on a Task thread: network and large file reads, and any large or repeated registry I/O. A small registry write on a user action (a setting, a recent search) is the exception (decision `search-history-render-thread-write`). Which thread is which (there are three, and the main thread is not the render thread): [threading.md](../docs/architecture/threading.md).
- **The caller's thread decides what a node access costs.** A `source/*.bs` helper runs on whichever thread called it, and nodes are render-owned by default, `m.global` included. On a Stick 4K (2026-08-23), one `m.global` field read took **2.0 µs from the render thread and 93 µs from a Task thread**. So a helper that is cheap when a component calls it can be expensive when a Task does. ⚠️ **Being on the right thread is not the same as being free:** a per-entry walk over Task nodes still costs tens of microseconds per entry there, so budget the loop too. The measured table: [threading.md](../docs/architecture/threading.md#measured-findings).
- **Start that Task with `launchTask(node)`** (`source/utils/tasks.bs`), never a raw `node.control = "RUN"`, `node["control"] = "RUN"` or `node.setField("control", "RUN")`. The `no-raw-run` BSC plugin makes all three a build error, so the thread count stays bounded and measurable (epic #728). An invalid node returns `false` instead of crashing as the raw form did; debug builds print when that happens. `source/` files share a scope only within `source`: a `source/*.bs` file that calls `launchTask` and is also imported by a component must `import "pkg:/source/utils/tasks.bs"` itself, or that component's scope won't resolve it.
- **Never launch one Task per item.** A `launchTask()` inside a loop is a build error (`no-task-fanout`) unless its argument is a fixed `m.<field>` slot the loop doesn't rebind. One thread per library is the shape #728 took, and correct teardown doesn't save you: the crash came from concurrent launches inside one screen load, not from threads leaked across navigation. Serve every item from one orchestrator Task over [`apiPipeline`](api/apiPipeline.bs) instead; `components/home/LoadLatestRowsTask.bs` is the reference.
- **A run that can restart while the previous one is in flight needs a new Task node.** A STOP then `launchTask` of the same node in one function (or after a same-file helper that STOPs it) is a build error (`no-same-node-relaunch`): while the old function still runs, the relaunch is sometimes silently ignored. So is a `launchTask(m.x)` with no new node assigned first, which is ignored every time the previous run is still going. Use `replaceTask()` and `isCurrentTaskEvent()` from `source/utils/tasks.bs`; the full rule is in [`components/CLAUDE.md`](../components/CLAUDE.md).
- HTTP: build the request with `GetApi().Build*Request()` and send it through one of [api.md's five call patterns](../docs/architecture/api.md#the-five-call-patterns): `fetchRes` or `fetchJson` from a Task, `fetchAsync` from a component, `SubmitSideEffect` for a write nobody reads, a dedicated Task, or `apiPipeline`.
- Four `ApiClient` methods still call synchronously: `AuthenticateByName`, `GetUser`, `GetPublicUsers` and `GetDisplayPreferences`, all on the sign-in path. They run on the main thread, where a promise's observer never fires ([api.md](../docs/architecture/api.md#the-synchronous-methods-left)). **Don't add new synchronous API calls.**

## Logging

- In a component or class, create the logger in init: `m.log = new log.Logger("Name")`. A free function in `source/*.bs` can't count on an `m.log`, so `print` is allowed there, and the `print-locations` plugin skips it.
- See [docs/architecture/logging.md](../docs/architecture/logging.md) for the levels and [build-and-tooling.md](../docs/architecture/build-and-tooling.md) for plugin opt-outs.
- **Never concatenate values into a log or print message; use the multi-argument form.** In BrightScript, `+` does not turn a boolean (and several other types) into a string, so `"" + someBool` raises `ERR_TM` at runtime. Lint doesn't catch it; only running it on a device does.
  - `print`: separate the label and values with `;` (or `,`): `print "channels="; channelCount; " codec="; codec`
  - `m.log.*`: pass label and value pairs as separate arguments: `m.log.debug("channels", channelCount, "codec", codec)`
- **An `m.log.*` call takes at most 9 arguments, the message included.** The logger's methods take a message and nine values, and in dev builds the `roku-log` plugin inserts the file location as the first argument. For more context, split it into two log lines rather than concatenating.

## What lives where

| Path | Purpose |
|---|---|
| `source/api/` | The API client, the Task pool and per-domain helpers. Has its own `CLAUDE.md`. |
| `source/utils/` | Cross-cutting utilities (translation, config, registry, languages and more). Has its own `CLAUDE.md`. |
| `source/data/` | The data transformers: `JellyfinDataTransformer` for items, `SessionDataTransformer` for the user's Configuration and Policy. |
| `source/GridView/` | Grid presenters per library type, and the grid's paging and query helpers. |
| `source/home/` | Home's row loading and failure handling. |
| `source/extras/` | The details screen's extras rows. |
| `source/remotecontrol/` | Remote-control commands and their dispatch. |
| `source/enums/` | Enum constants. |
| `source/constants/` | Shared constants (timeouts, sizes, layouts). |
| `source/roku_modules/` | Libraries vendored by ropm. Git ignores them and they are regenerated on install, so never edit them. |
| `source/main.bs` | The entry point, global setup and the main event loop. See [docs/architecture/bootstrap.md](../docs/architecture/bootstrap.md). |
| `source/loginRouter.bs`, `source/replayRoute.bs` | Main-thread sign-in and deep-link routing. See [bootstrap.md](../docs/architecture/bootstrap.md). |
| `source/deepLink.bs` | Deep-link predicates with no dependencies, safe from both the main thread and a component. |
| `source/libraryViewFactory.bs` | Maps a library item to the presenter `BaseGridView` uses. |
| `source/migrations.bs` | Registry-schema migrations. See [docs/architecture/migrations.md](../docs/architecture/migrations.md). |
| `source/showScenes.bs` | One router-agnostic helper, the performance beacon. |
