# Rules for `source/`

BrighterScript modules — shared utilities and orchestration that doesn't live in components. See [docs/architecture/bootstrap.md](../docs/architecture/bootstrap.md) for the entry point and global setup, and [docs/architecture/api.md](../docs/architecture/api.md) for the API layering model.

## File scoping

- **`source/` is BS only.** No XML files here.
- Files in `source/` auto-scope together — code in any `source/*.bs` can call any other `source/*.bs` function without `import`.
- To use `source/` code from a component, add `import "pkg:/source/<path>.bs"` (always pkg-rooted; no relative paths).

## Render thread protection

- Anything that does I/O must run on a Task thread (network, registry I/O, large file reads).
- HTTP: route through `GetApi().Build*Request()` + `fetchRes()` / `submitApiRequest()` / `SubmitSideEffect()`. See [docs/architecture/api.md](../docs/architecture/api.md) for the four call patterns.
- Synchronous `Get*()` methods on `ApiClient` exist for the bootstrap path only (login, server discovery before the pool is up). **Don't add new sync API calls.**

## Logging

- Component / class init: `m.log = new log.Logger("Name")`. Top-level functions in `source/*.bs` have no `m`, so no `m.log` — `print` is the only option there, and the `print-locations` plugin auto-skips them.
- See [docs/architecture/logging.md](../docs/architecture/logging.md) for the levels and [build-and-tooling.md](../docs/architecture/build-and-tooling.md) for plugin opt-outs.

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
| `source/showScenes.bs` | `LoginFlow` + scene factories. |
