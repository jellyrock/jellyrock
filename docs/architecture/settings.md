---
topic: settings
related-files:
  - settings/settings.json
  - source/utils/config.bs
  - source/utils/globals.bs
  - source/utils/session.bs
  - components/data/jellyfin/JellyfinUserSettings.xml
  - components/data/jellyfin/JellyfinUserSettings.bs
last-reviewed: 2026-10-10
---

# Settings

How `settings/settings.json` defines every setting, how settings reach `m.global.user.settings`, and how a change is saved to the registry. How stored settings change shape between versions is in [`migrations.md`](migrations.md); adding a setting is [`new-user-setting.md`](../dev/new-user-setting.md).

## Three kinds of setting

1. **Global settings** apply to every user on the Roku and live in the registry section `JellyRock`: `globalRememberMe`, `globalSplashScreen` and `globalTranslationLocale`. Most are read after sign-in. `globalTranslationLocale`, the language of the sign-in screens and the twin of the per-user `translationLocale`, is read at startup before anyone signs in: `getSetting()` needs no signed-in user, which is what lets it translate the server and user selection screens (see [`translations.md`](translations.md)).
2. **User settings** belong to one Jellyfin user and live in a registry section named by that user's ID: theme colors, the bitrate limit, subtitle preferences.
3. **Server config** comes from Jellyfin at sign-in and is never written to the registry. It lives in `m.global.user.config` and `m.global.user.policy`. The order of Home's sections is server data too: one `homeSection<N>` field per slot, `homeSlots.SLOT_COUNT` slots to match the web client, filled from Jellyfin's `DisplayPreferences` API. A migration removes old per-user `homeSection*` keys ([`migrations.md`](migrations.md)).

Defaults for the first two live only in `settings/settings.json`. Server config has no defaults: the server decides.

## `settings/settings.json`, the one definition

A tree of categories and settings. Its top level is three categories, Global, Playback and User Interface, and categories nest to any depth (Playback, then Bitrate Limit, then the switch and the limit itself). The Settings screen draws itself from the tree, so adding a setting starts with one entry here. Two entries from the Global category:

```json
{
  "title": "Remember Me?",
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
```

Every setting entry has:

- **`settingName`** (lowerCamelCase): the field on `m.global.user.settings`, and the registry key.
- **`type`**: `bool`, `integer`, `radio`, `text`, `alpha` (the custom audio and subtitle language codes) or `languagePicker` (the two app-language settings).
- **`default`**: always a string in the JSON, converted to the field's type when it loads.
- **`titleKey` and `descriptionKey`**: translation keys, so the Settings screen shows translated text.
- **`options`** (`radio` only): the values to choose from.
- **`min` and `max`** (optional, `integer` only): a range, enforced when the value is saved.

`settings.json` also holds the theme color defaults (read by `loadThemeColorDefaults()` in `globals.bs`), and `npm run docs:settings` generates [`docs/user/app-settings.md`](../user/app-settings.md) from it.

### A declared range is enforced when the value is saved

An `integer` entry may declare `min` and `max`. The Settings screen (`onKeyGridSubmit()` in [`components/settings/settings.bs`](../../components/settings/settings.bs)) parses the typed value and clamps it with `clampToSettingRange()`. If clamping changed the value, a dialog names the range and the value it will store instead: declining returns to the keypad, and confirming saves the clamped value and updates the text shown. A value in range is stored normalized (`"016"` becomes `"16"`), so what the user sees next time is what is stored.

The other way is to store any number and guard it where it is read, which is what `playbackBitrateLimit` does: it declares no range. Enforcing once, at save, keeps the stored value and the applied value the same, and tells the user when they would differ instead of letting them drift apart.

**Both bounds, and both as numbers.** `settingRangeBounds()` returns `invalid` for anything else. That is what keeps a JSON typo from crashing the Settings screen, because `Int()` faults on both alternatives, and the fault fires when the user opens the setting. Two ways in, both measured on a device:

| Malformed entry | What `Int()` gets | Measured |
|---|---|---|
| `"min": 1` with no `max` | `Int(invalid)` | Type Mismatch |
| `"min": "1", "max": "100"` | `Int("1")` | Type Mismatch |

The second is the likelier typo, because `default` in the same entry is a string by convention (`"32"`), so `"min": "1"` looks consistent with it. BrighterScript cannot catch it: `settingRangeBounds()` takes the entry `as object`, so the bounds are `dynamic`.

So a malformed entry falls back to declaring no range: the setting still saves, without a bound, and the Settings screen stays up. That makes the bad entry silent. [`tests/scripts/unit/settings-schema.test.js`](../../tests/scripts/unit/settings-schema.test.js) makes it loud: it fails on a half-declared range, a string bound, `min` above `max`, a default outside its own range, or a range on an entry that is not `integer`. It runs in `npm run test:scripts`, so the pre-push hook and CI run it with no device.

An entry with no range takes the path it always took, raw text and all; a range is something an entry opts into. `npm run docs:settings` prints a **Range** row for an entry that declares one, so the bound can be found without typing a value outside it.

## Registry persistence

Roku's `roRegistrySection` is a string key-value store, split into named sections. JellyRock uses two kinds:

- **`JellyRock`**, the global section, holds every `global*` setting.
- **One section per Jellyfin user**, named by the user ID, holds the `playback*`, `ui*` and other user settings.

Tests use `test-global` and `test-<id>` sections instead, so test data never mixes with a real user's.

The read and write functions are in `source/utils/config.bs`:

```brighterscript
function getSetting(key, defaultValue = invalid)    ' read from JellyRock (global)
sub setSetting(key, value)                           ' write to JellyRock (global)
sub unsetSetting(key)                                ' delete from JellyRock (global)
function getUserSetting(key as string) as dynamic    ' read from the current user's section
sub setUserSetting(key as string, value as dynamic)  ' write to the current user's section
sub unsetUserSetting(key as string)                  ' delete from the current user's section
function GetConfigTree()                             ' parse settings.json
function findConfigTreeKey(key as string, tree)      ' find a setting's entry in the tree
```

And the section-level helpers: `registryRead()`, `registryWrite()`, `registryDelete()` and `RegistryReadAll()`, which returns a whole section as an AA. `valueToString()` turns a value into the string the registry stores: `true` and `false` for booleans, and the number's text for integers and floats.

**Defaults are never written to the registry.** A setting missing from the registry gets its default from `settings.json` through `user.settings.SaveDefaults()`. So when a default changes, every user who never chose a value gets the new one.

## Startup, for a signed-in user

```text
Main()
  setGlobals()                       creates m.global.user.settings, a JellyfinUserSettings node
  user.settings.SaveDefaults()       writes every default from settings.json onto the node,
                                     then loads the global settings from the registry
  enableAutoSync                     from here on, a field write is also saved to the registry
  runGlobalMigrations()              may rename, delete or change global registry keys
  runRegistryUserMigrations()        the same for each user's section
  CreateScene("JRScene"), show()
  setGlobalNodes()
  reenterLogin()                     the sign-in flow in loginRouter.bs; the user signs in
  user.Login()                       a new settings node with the defaults, then the user's
                                     saved values on top
  loadHomeScreen()
```

After that, code reads settings straight from `m.global.user.settings.<field>`, typed by the `JellyfinUserSettings` node, and writes them the same way.

## Auto-sync: `JellyfinUserSettings.bs`

`init()` observes every setting field once, for the life of the node. `enableAutoSync()` and `disableAutoSync()` do not touch the observers. They set a flag the handlers check, so the bulk loads that run while sync is off (defaults at startup, the user's values at sign-in, defaults again on a reset) are never written back:

```brighterscript
sub init()
  m.isAutoSyncEnabled = false
  m.top.observeField("displaySettings", "onDisplaySettingsChanged")
  for each fieldName in m.top.getFields()
    if not inArray(excludedFields, fieldName)
      m.top.observeField(fieldName, "onSettingChanged")
    end if
  end for
end sub

sub enableAutoSync()
  m.previousDisplaySettings = deepCopyAA(m.top.displaySettings) ' baseline to diff against
  m.isAutoSyncEnabled = true
end sub

sub onSettingChanged(event as object)
  if not m.isAutoSyncEnabled then return
  registryWrite(event.getField(), valueToString(event.getData()), ...) ' save it
end sub
```

**Why a flag, and not observing in `enableAutoSync()` and unobserving in `disableAutoSync()`.** This node is the shared `m.global.user.settings`, and `m.top.unobserveField` can remove observers other components hold on the field, not only this node's own. It did in the case [`ObserverRegistry.spec.bs`](../../tests/source/unit/platform/ObserverRegistry.spec.bs) records, so toggling could silently cut off anything else watching a setting. The flag costs nothing measurable: measured 2026-09-13 on a Roku Ultra, `SaveDefaults()` took a median 779 ms with the fields unobserved and 781 ms with every field observed (58 handler runs per call). Calling either function twice is also harmless now, where it used to register every observer twice.

So application code never deals with saving:

```brighterscript
m.global.user.settings.uiThemeColorPrimary = "8b5cf6"
' updates the node and saves it to the registry
```

Writing to the field is the whole interface: saving, type conversion and observers all follow from it.

## Loading at sign-in: `user.Login()` in `source/utils/session.bs`

`user.Login()` gives `m.global.user` a new `JellyfinUserSettings` node and writes the defaults onto it with `user.settings.SaveDefaults()`. Then it reads the user's registry section (`RegistryReadAll(userId)`) and lays every saved value over the defaults, so only the fields the user changed differ.

Each key that names a settings field goes through `user.settings.Save()`, which converts the stored string to the field's type: registry values are always strings, and `JellyfinUserSettings` fields are typed. No per-setting code is needed. The loop skips:

- global keys, which `user.settings.LoadGlobals()` loads;
- `display.*` keys, which `user.settings.TransformDisplaySettings()` nests;
- `homeSection*`, which is server data;
- the credentials the sign-in flow sets itself.

Tests load settings the same way through `BaseTestSuite.loadSettingsFromRegistry()`, and `tests/source/integration/registry/` tests the save and load round trip. The skip rules have no test yet (followup `login-registry-load-routing-untested`).

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md): search its `area` lines for `config.bs`, `session.bs` and `JellyfinUserSettings`.
