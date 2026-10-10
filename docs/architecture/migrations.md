---
topic: migrations
related-files:
  - source/migrations.bs
  - source/main.bs
  - source/utils/config.bs
last-reviewed: 2026-10-09
---

# Registry migrations

How the registry migration runner in `source/migrations.bs` works: where it runs, how it decides which migrations a section needs, and which sections it never touches. To write a migration, and to learn when you need one, see [`registry-migrations.md`](../dev/registry-migrations.md). How settings load from the registry is in [`settings.md`](settings.md).

## Where it runs

`Main()` in `source/main.bs` calls `runGlobalMigrations()`, then `runRegistryUserMigrations()`. That happens after the globals and the setting defaults load, and before `Main()` creates the scene. So nothing that reads settings later, including `SessionDataTransformer` when a session loads, ever sees an old key name or value shape.

Each migration is a block guarded by a version constant from the top of the file. A block runs when the section was last used by a version older than its constant (`versionChecker(a, b)` is true when `a` is at least `b`). The blocks sit in version order, so a user several versions behind runs every block they missed, oldest first. A block that changed something sets `m.wasMigrated`, and `Main()` then prints the registry so the console shows the result.

## Two version records

The runner reads a different `LastRunVersion` for each scope:

- **Global:** the `LastRunVersion` key in the `JellyRock` section, read into `m.global.app.lastRunVersion` at startup. The global blocks run only when it exists, so a fresh install runs none. `Main()` writes the current version back after both runners finish, in every build.
- **Per user:** the `LastRunVersion` key in each user's own section. A section without one gets `0.0.0` written, so every user block runs on it. The current version is written to the user's section after a login, and only in a production build (`m.global.app.isDev` false).

The second rule is why every user block must be safe to run twice: on a sideloaded build, the user migrations run again at every launch.

## Sections the user runner skips

`runRegistryUserMigrations()` walks every registry section, or only the ones a caller passes in, and steps over three kinds:

- **The global sections**, `JellyRock` and `test-global`. They belong to `runGlobalMigrations()`.
- **Every non-test section, in test mode.** When any section's name starts with `test-`, only `test-` sections are migrated. Integration tests write `test-<id>` sections, so a test run on a personal device never changes a real user's data.
- **A section with no `serverId` key.** `user.Login()` writes `serverId` whether or not the user saved their credentials, so a section without it never finished a login. The runner treats it as orphaned and prints that it skipped it.

## Tests

Each migration has an integration spec in `tests/source/integration/migration/`, named for it. The one exception is the `HOMESECTION_CLEANUP_VERSION` cleanup, which is tested inside `SettingsMigration.spec.bs` because it deletes the keys that spec's rename creates. The rules for writing one are in [`registry-migrations.md`](../dev/registry-migrations.md#test-it).

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md): `m-wasmigrated-global-flag`, the flag passed between the runner and `Main()` through `m`.
