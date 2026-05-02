---
topic: migrations
related-files:
  - source/migrations.bs
  - source/utils/config.bs
last-reviewed: 2026-05-01
---

# Registry Migrations

How JellyRock evolves its registry schema across versions: when a migration is needed, how version-gated migrations work, and the test-mode safeguards. The settings-loading mechanics that migrations slot into live in `settings.md`.

## Migrations — `source/migrations.bs`

Sometimes settings have to evolve: keys get renamed, values get transformed, options become deprecated. JellyRock handles this with **version-gated registry migrations**.

### When to add a migration

Yes:

- You renamed a setting (e.g. `playback.preferredAudioCodec` → `playbackPreferredMultichannelCodec`)
- You changed the value format (e.g. an enum value got renamed)
- You removed a setting that previously stored real user data
- You restructured how data is persisted

No:

- You added a new setting (defaults handle this automatically)
- You changed a default value (changes only affect new installs that don't have a saved value)
- You added a server-authoritative field

### Structure

Two top-level functions:

- `runGlobalMigrations()` — runs migrations on the `"JellyRock"` global section
- `runRegistryUserMigrations(targetSections)` — runs migrations on every per-user section

Both run early in `Main()`, **before** `SessionDataTransformer`, so that by the time settings are loaded, only the new key names and new value shapes exist.

A migration is gated by version constants:

```brightscript
const SETTINGS_MIGRATION_VERSION = "1.1.0"
const AUDIO_CODEC_MIGRATION_VERSION = "1.1.5"
const EMPTY_IMAGE_TAG_CLEANUP_VERSION = "1.4.0"
const SPLASH_SETTING_REMOVAL_VERSION = "1.5.0"
const GLOBAL_SETTINGS_CLEANUP_VERSION = "1.5.2"
const MUSIC_VIEW_MIGRATION_VERSION = "1.10.0"
const TV_SEASON_STRAIGHT_TO_EPISODES_REMOVAL_VERSION = "2.0.0"
const THEME_PRESET_MIGRATION_VERSION = "2.5.0"
const HOMESECTION_CLEANUP_VERSION = "2.13.0"   ' homeSection0-6 became server-authoritative
```

The constants list grows monotonically — the canonical list always lives in `source/migrations.bs`; the snippet above is illustrative of the shape, not exhaustive of current entries.

Each migration runs only if the user is *upgrading past* that version:

```brightscript
appLastRunVersion = m.global.app.lastRunVersion       ' from registry, set on previous launch

if isValid(appLastRunVersion) and not versionChecker(appLastRunVersion, SETTINGS_MIGRATION_VERSION)
  ' last run version < 1.1.0 — apply this migration
  m.wasMigrated = true
  ' ...read old key, write new key, delete old key, reg.flush()
end if
```

After all migrations finish, `Main()` writes the current version back to `LastRunVersion`:

```brightscript
if m.global.app.version <> m.global.app.lastRunVersion
  setSetting("LastRunVersion", m.global.app.version)
end if
```

So next launch knows what's already been migrated.

### Test mode safety

`runRegistryUserMigrations` includes a guard:

```brightscript
' Detect test mode: if ANY section starts with "test-", we're in test mode
hasTestSections = false
for each checkSection in regSections
  if LCase(checkSection).left(5) = "test-"
    hasTestSections = true
    exit for
  end if
end for

' In test mode, skip non-test user sections (don't touch real user data!)
for each section in regSections
  isTestSection = LCase(section).left(5) = "test-"
  if hasTestSections and not isTestSection
    continue for
  end if
  ' ...
end for
```

This means integration tests can write `test-<id>` sections without ever touching real user data, even in a dev build deployed to a personal device.

### Migration testing

`tests/source/integration/migration/` has a test suite per migration. The pattern is:

1. Set up registry state representing "old version" data
2. Run the migration
3. Assert the new state matches the expected schema
4. Assert old keys are gone, new keys exist with correct values

`docs/dev/registry-migrations.md` is the canonical guide for writing one. Read it before adding a migration.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for migration entries.
