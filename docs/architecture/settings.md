# 08 — Settings & Migrations

How `settings/settings.json` is the source of truth, how settings flow into `m.global.user.settings`, how the registry persists changes, and how migrations evolve the schema across versions.

## The three setting tiers

JellyRock distinguishes three categories of "settings":

1. **Global settings** — device-wide, shared across all users on this Roku. Stored in the registry section `"JellyRock"`. Examples: `globalRememberMe`, `globalSplashScreen`.
2. **User settings** — per-user, stored in a registry section keyed by the Jellyfin user ID. Examples: theme colors, playback bitrate limit, subtitle preferences.
3. **Server config** — server-authoritative, fetched from Jellyfin on login, never written back to the registry. Lives in `m.global.user.config` and `m.global.user.policy`.

Defaults for tiers 1 and 2 live exclusively in `settings/settings.json`. Tier 3 has no defaults — the server is the source of truth.

## `settings/settings.json` — single source of truth

A nested JSON tree describing every JellyRock-managed setting:

```json
[
  {
    "title": "Global",
    "description": "Global settings that affect everyone...",
    "children": [
      {
        "title": "Remember Me?",
        "description": "Remember the currently logged in user...",
        "settingName": "globalRememberMe",
        "type": "bool",
        "default": "false",
        "titleKey": "MessageRememberMe",
        "descriptionKey": "MessageRememberTheCurrentlyLoggedInUser"
      },
      {
        "title": "Splash Screen Image",
        "settingName": "globalSplashScreen",
        "type": "radio",
        "default": "enabled",
        "options": [
          { "title": "Enabled", "id": "enabled", "titleKey": "LabelEnabled" },
          { "title": "Disabled", "id": "disabled", "titleKey": "LabelDisabled" }
        ],
        "titleKey": "LabelSplashScreenImage",
        "descriptionKey": "MessageControlWhetherTheServerSSplash"
      }
    ]
  },
  {
    "title": "Playback",
    "children": [
      {
        "title": "Bitrate Limit",
        "children": [...]    // nested categories
      }
    ]
  }
]
```

Every setting node has:

- **`settingName`** (lowerCamelCase) — the field name on `m.global.user.settings` and the registry key
- **`type`** — `bool`, `integer`, `string`, `radio`, `text`
- **`default`** — the default value (always a string in JSON, coerced to type at load)
- **`titleKey` / `descriptionKey`** — translation keys (so the Settings screen shows localized text)
- **`options`** (radio only) — selectable values

Categories nest arbitrarily (e.g., Playback → Bitrate Limit → Enable Limit + Maximum Bitrate). The Settings UI walks this tree to render itself, so adding a new setting means editing one JSON file.

`settings.json` is also the source of theme color defaults (loaded by `loadThemeColorDefaults` in `globals.bs`) and powers the auto-generated `docs/user/app-settings.md` (via `npm run docs:settings`).

## Registry persistence

Roku provides `roRegistrySection`, a string-keyed key/value store partitioned by section name. JellyRock uses two kinds of sections:

- **`"JellyRock"`** — the global section. All `global*` settings live here.
- **`<user-id>`** — one section per Jellyfin user (the user ID as a string is the section name). All `playback*`, `ui*`, `network*`, etc. settings live here.

Plus, in test builds, `"test-global"` and `"test-<id>"` sections are used to keep test data isolated from real user data.

Accessors live in `source/utils/config.bs`:

```brightscript
function getSetting(key, defaultValue = invalid)              ' read from "JellyRock" (global)
sub setSetting(key, value)                                     ' write to "JellyRock" (global)
function getUserSetting(key)                                   ' read from current user's section
sub setUserSetting(key, value)                                 ' write to current user's section
sub unsetUserSetting(key)                                      ' delete from current user's section
function GetConfigTree()                                       ' parse settings.json
function findConfigTreeKey(key, tree)                          ' walk the tree to find a setting node
```

Plus generic helpers:

```brightscript
function registryRead(key, section)
sub registryWrite(key, value, section)
sub registryDelete(key, section)
function RegistryReadAll(section)                              ' dump entire section as AA
```

`valueToString(value)` handles type coercion when writing — bools become `"true"`/`"false"`, integers/floats become their string representation.

**Defaults are never written to the registry.** If a setting key is missing from the registry, it's loaded from `settings.json` at startup (via `SessionDataTransformer`). This avoids the "user has the same value as the default but it's stuck because of an old write" problem when defaults change.

## The startup data flow

The full sequence for a logged-in user:

```brightscript
Roku starts → Main()
  ↓
setGlobals()
  ↓ creates empty m.global.user.settings (JellyfinUserSettings node)
  ↓
user.settings.SaveDefaults()
  ↓ reads settings/settings.json, writes every default value onto the node
  ↓
m.global.user.settings.callFunc("enableAutoSync")
  ↓ turns on observers — any subsequent field write also persists to registry
  ↓
runGlobalMigrations()
  ↓ may rename/delete/transform global registry entries
  ↓
runRegistryUserMigrations()
  ↓ same for per-user sections
  ↓
m.scene = m.screen.CreateScene("JRScene") + m.screen.show()
  ↓
setGlobalNodes() ... LoginFlow() ... user authenticates
  ↓
User login completes
  ↓
SessionDataTransformer reads the user's registry section
  ↓ for each saved setting, writes it onto m.global.user.settings (overlaying defaults)
  ↓
loadHomeScreen()
```

After this, all reads happen via `m.global.user.settings.<fieldName>` directly (typed by the `JellyfinUserSettings` ContentNode). All writes go through the same field assignment, and the `enableAutoSync` observer persists them to the user's registry section.

## Auto-sync — `JellyfinUserSettings.bs`

`enableAutoSync` is a method on the `JellyfinUserSettings` node that wires per-field observers:

```brightscript
sub enableAutoSync()
  ' For every settable field on this node, observe changes and write to registry
  fields = m.top.getFields()
  for each fieldName in fields
    if isSettable(fieldName)
      m.top.observeField(fieldName, "onSettingChanged")
    end if
  end for
end sub

sub onSettingChanged(msg)
  fieldName = msg.getField()
  newValue = msg.getData()
  setUserSetting(fieldName, newValue)        ' persist to registry
end sub
```

So application code never has to think about persistence:

```brightscript
m.global.user.settings.uiThemeColorPrimary = "8b5cf6"
' ↑ that line both updates the in-memory node AND persists to registry
```

This is one of the cleaner patterns in the codebase — the developer experience is "just write to the field." Persistence, type coercion, and observer firing are all handled.

## `SessionDataTransformer` — `source/data/SessionDataTransformer.bs`

Runs on login. Reads the user's registry section (via `RegistryReadAll(userId)`) and overlays every saved value onto `m.global.user.settings`. Because defaults were already loaded, this only changes fields the user has actually customized.

It also handles type coercion: registry values are always strings, but `JellyfinUserSettings` fields are typed (bool, integer, string, etc.). The transformer converts on the way in.

The same transformer is used by tests — `tests/source/integration/registry/` exercises the full read-overlay-validate cycle.

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
```

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

## Cruft callouts

- **Migration list grows monotonically.** As of today there are 8 version constants. Old migrations stay in the file forever (otherwise users skipping versions would miss them). The file is 413 lines and counting.
- **Registry values are all strings.** Type coercion happens on every read via `valueToString`. Boolean settings use `"true"`/`"false"` strings, etc. A typo in the registry (e.g. `"True"` instead of `"true"`) doesn't fail-fast — it parses as something unexpected. Mostly defensive code handles this.
- **No transactional migration.** If a migration crashes halfway through (e.g., write succeeds but delete fails), the next launch may try to re-run it. Most migrations are idempotent by check-existence-first, but it's not enforced.
- **Settings UI walks `settings.json` at runtime.** Any change to the schema (adding a setting type, restructuring the tree) requires both the JSON and the Settings UI renderer to handle the new shape. The renderer is generic but does have a finite set of supported `type:` values.
- **`m.wasMigrated` flag on global scope.** Global state passed via the implicit `m` AA. Works because `Main()` controls the flow, but reads as a global mutable variable.
- **No explicit setting deprecation lifecycle.** A setting can be removed, but there's no warning system or deprecation period — the migration just drops the old key. Users with old custom values lose them silently.
