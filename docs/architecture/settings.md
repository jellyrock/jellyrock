---
topic: settings
related-files:
  - settings/settings.json
  - source/utils/config.bs
  - source/utils/globals.bs
  - source/data/SessionDataTransformer.bs
  - components/data/jellyfin/JellyfinUserSettings.xml
  - components/data/jellyfin/JellyfinUserSettings.bs
last-reviewed: 2026-08-26
---

# Settings

How `settings/settings.json` is the source of truth, how settings flow into `m.global.user.settings`, and how the registry persists changes. Migration-evolution mechanics live in `migrations.md`.

## The three setting tiers

JellyRock distinguishes three categories of "settings":

1. **Global settings** — device-wide, shared across all users on this Roku. Stored in the registry section `"JellyRock"`. Examples: `globalRememberMe`, `globalSplashScreen`, `globalTranslationLocale`. Most are consumed post-login, but `globalTranslationLocale` (the device-wide sign-in-screen language, twin of the per-user `translationLocale`) is read at **bootstrap, pre-login** by the locale cascade — `getSetting` works with no signed-in user, which is what lets it localize the server-select / user-select screens (see `translations.md`).
2. **User settings** — per-user, stored in a registry section keyed by the Jellyfin user ID. Examples: theme colors, playback bitrate limit, subtitle preferences.
3. **Server config** — server-authoritative, fetched from Jellyfin on login, never written back to the registry. Lives in `m.global.user.config` and `m.global.user.policy`. **Home section ordering** (`homeSection0` through `homeSection6`) is also server-authoritative — populated from `Jellyfin`'s `DisplayPreferences` API, not the local registry. (See `migrations.md` for the cleanup migration that removes any stale per-user `homeSection*` entries left over from earlier versions.)

Defaults for tiers 1 and 2 live exclusively in `settings/settings.json`. Tier 3 has no defaults — the server is the source of truth.

## `settings/settings.json` — single source of truth

A nested JSON tree describing every `JellyRock-managed` setting:

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
- **`min` / `max`** (optional, integer only) — a declared range, enforced when the value is **saved**

### Declared ranges are enforced at SAVE, not at use

An `integer` entry may declare `min` and `max`. The Settings screen (`onKeyGridSubmit` in
[`components/settings/settings.bs`](../../components/settings/settings.bs)) parses the typed
value, clamps it with `clampToSettingRange`, and — if clamping changed it — raises a confirm
dialog naming both the range and what will be stored instead. Declining returns focus to the
keypad; confirming saves the clamped value and updates the displayed text. An in-range value
is stored **normalized** (`"016"` → `"16"`), so what the user sees next time is what is held.

The alternative — let any number be stored and guard where it is read — is what
`playbackBitrateLimit` does, and it is why that setting can show a number the app is not
using. Enforcing once at the boundary keeps the stored value and the applied value the same
thing, and tells the user when they differ instead of silently diverging.

**Both bounds, and both as numbers.** `settingRangeBounds` returns `invalid` for anything
else. This is not tidiness — it is the only thing standing between a JSON typo and a crashed
Settings screen, because `Int()` faults on both alternatives and the fault fires when the
user *opens* the setting. Two ways in, both measured on device:

| malformed entry | what `Int()` gets | measured |
|---|---|---|
| `"min": 1` with no `max` | `Int(invalid)` | Type Mismatch |
| `"min": "1", "max": "100"` | `Int("1")` | Type Mismatch |

The second is the likelier typo, because `default` in the same entry **is** a string by
convention (`"32"`) — so `"min": "1"` reads as consistent with its neighbor. BrighterScript
cannot catch it: `settingRangeBounds` takes the entry `as object`, so the bounds are `dynamic`.

A malformed entry therefore degrades to *declares no range* — the setting still saves, it is
just unbounded — rather than taking the screen down. That is a floor, not enforcement: it
makes the bad entry silent. [`tests/scripts/unit/settings-schema.test.js`](../../tests/scripts/unit/settings-schema.test.js)
is what makes it loud, failing the PR on a half-declared range, a string bound, `min > max`,
a default outside its own range, or a range declared on a non-`integer` entry. It runs in
`npm run test:scripts`, so it gates every push without needing hardware.

An entry declaring no range takes the pre-existing path untouched, raw text and all. This is
a capability entries opt into; it did not change any setting that existed before it.
`npm run docs:settings` prints a **Range** row for entries that declare one, so the bound is
discoverable without typing an out-of-range value to find it.

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

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for settings / registry entries.
