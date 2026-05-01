# Rules for `source/`

BrighterScript modules — shared utilities and orchestration that doesn't live in components. See [docs/architecture/bootstrap.md](../docs/architecture/bootstrap.md) for the entry point and global setup, and [docs/architecture/api.md](../docs/architecture/api.md) for the API layering model.

## File scoping

- **`source/` is BS only.** No XML files here.
- Files in `source/` auto-scope together — code in any `source/*.bs` can call any other `source/*.bs` function without `import`.
- To use `source/` code from a component, add `import "pkg:/source/<path>.bs"` at the top of the component's `.bs` file.

## Imports

- Use `import "pkg:/source/..."`, not relative paths.
- Match the actual file path; BSC validates this at compile time.

## Render thread protection

- Anything that does I/O must run on a Task thread (network, registry I/O, large file reads).
- HTTP: route through `GetApi().Build*Request()` + `fetchRes()` / `submitApiRequest()` / `SubmitSideEffect()`. See [docs/architecture/api.md](../docs/architecture/api.md) for the four call patterns.
- Synchronous `Get*()` methods on `ApiClient` exist for the bootstrap path only (login, server discovery before the pool is up). **Don't add new sync API calls.**

## Logging

- Every `.bs` file that logs gets `m.log = new log.Logger("ComponentName")` in `init()`. **Class methods can use `m.log` too.** Top-level functions in `source/*.bs` can't carry an `m.log` — there's no `m` to attach it to.
- **`print` is allowed only in `source/main.bs`** (early bootstrap before the log manager is up) and in `globals.bs` debug-block init for developer console hints. The `print-locations` BSC plugin enforces this at build time, with smart skipping for top-level functions in `source/*.bs` (no `m.log` available there). See [docs/architecture/logging.md](../docs/architecture/logging.md) and [docs/architecture/build-and-tooling.md](../docs/architecture/build-and-tooling.md) ("Convention plugins") for the opt-out comment syntax.

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
| `source/showScenes.bs` | LoginFlow + scene factories. |

## What NOT to do

- Don't put XML in `source/`.
- Don't add a new sync HTTP call pattern; use the task pool.
- Don't bypass `GetApi()` and call `sdk.<namespace>.<function>` directly — that's legacy. The migration to pool-only is incomplete (see `tech-debt.md`'s `legacy-sdk-namespace`); don't add new bypass calls.
