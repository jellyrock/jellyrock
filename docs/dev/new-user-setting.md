---
topic: new-user-setting
related-files:
  - settings/settings.json
  - components/data/jellyfin/JellyfinUserSettings.xml
  - components/data/jellyfin/JellyfinUserSettings.bs
  - components/settings/settings.bs
  - source/utils/config.bs
  - source/utils/session.bs
last-reviewed: 2026-10-09
---

# Add a setting

How to add a setting to JellyRock's Settings screen: the entry in `settings/settings.json`, the field that holds it, its strings, and the code that reads it. To rename or remove a setting users already have, see [`registry-migrations.md`](registry-migrations.md). The [`/new-setting`](../../.claude/skills/new-setting/SKILL.md) skill walks an agent through the same steps.

## Three kinds of setting

| Kind | Where it lives | Applies to | Named |
| --- | --- | --- | --- |
| User setting | The user's registry section | One user | By area: `playback*`, `ui*`, `itemGrid*` |
| Global setting | The `JellyRock` registry section | Everyone on the device | `global*` |
| User configuration | The Jellyfin server | The user, on every client | Never stored by JellyRock |

The prefix decides where a value is saved. When a setting changes, `onSettingChanged()` in `JellyfinUserSettings.bs` checks `isGlobalSetting()` (`source/utils/config.bs`: the name starts with `global`). A global setting goes to the global section and every other setting to the user's. Keep global settings for behavior that belongs to the device, such as **Remember Me?** (`globalRememberMe`).

Add a setting when a user needs a different value on the Roku than on their other clients, or for a feature only JellyRock has. Don't add one for data the server owns, for state that lasts one session, or for something the app can detect on the device.

## How a setting loads

1. At start-up, `user.settings.SaveDefaults()` fills every field from the `default` values in `settings/settings.json`, and `enableAutoSync` turns on saving.
2. At sign-in, `user.Login()` (`source/utils/session.bs`) runs `SaveDefaults()` again, then loads each key in the user's registry section into the field with the same name. `user.settings.Save()` converts the stored string to the field's type. Global settings load through `user.settings.LoadGlobals()`.
3. Code reads the value from `m.global.user.settings`.

Only a value the user changed is written to the registry. A default stays in `settings.json`, so changing a default reaches every user who never changed the setting.

## 1. Add the entry to `settings.json`

Put the entry in the right category's `children`, in order of `title`. This is `playbackPlayDefaultAudioTrack`:

```json
{
  "title": "Play Default Audio Track",
  "description": "Override web client audio preference. When enabled, use the IsDefault flag to select audio track. When disabled, prefer language match and ignore IsDefault.",
  "settingName": "playbackPlayDefaultAudioTrack",
  "type": "radio",
  "default": "webclient",
  "options": [
    { "title": "Use Web Client Setting", "id": "webclient", "titleKey": "LabelUseWebClientSetting" },
    { "title": "Enabled", "id": "enabled", "titleKey": "LabelEnabled" },
    { "title": "Disabled", "id": "disabled", "titleKey": "LabelDisabled" }
  ],
  "titleKey": "LabelPlayDefaultAudioTrack",
  "descriptionKey": "MessageOverrideWebClientAudioPreferenceWhen"
}
```

- **`settingName`** is the field and registry key: `lowerCamelCase`, with its area's prefix, and specific (`playbackPlayDefaultAudioTrack`, not `playbackAudio`).
- **`titleKey` and `descriptionKey`** name the strings the Settings screen shows, translated; so does each option's `titleKey`. **`title` and `description`** are the English text that [`docs/user/app-settings.md`](../user/app-settings.md) is generated from.
- **`default`** is the value a user has until they change it.

The types the Settings screen handles:

| `type` | The user | Field type |
| --- | --- | --- |
| `bool` | Turns it on or off | `boolean` |
| `radio` | Picks one of `options` | `string` |
| `integer` | Enters a number; with `min` and `max`, a value outside them asks for confirmation | `integer` |
| `text` | Types a value, such as a hex color | `string` |
| `alpha` | Types letters on the on-screen keyboard | `string` |
| `languagePicker` | Picks a language | `string` |

Two optional keys:

- **`visibleWhen`** shows an entry only while another setting has a value, with no code. The **Custom Theme Colors** group uses `"visibleWhen": { "settingName": "uiTheme", "value": "custom" }`. `LoadMenu()` in `components/settings/settings.bs` filters the menu with `isSettingVisible()`, and the menu redraws when the controlling setting changes.
- **`presetValues`**, on a radio option, sets several settings at once when the user picks it. Each `uiTheme` option sets the theme's colors; options without it set only the radio's value.

**An override of a web client setting** uses three options: `webclient` (the default: use the server's value), `enabled` and `disabled`.

## 2. Add the strings

Add each new `titleKey` and `descriptionKey` to `locale/custom/en_US.json`. The rules for keys and their order are in [`translations.md`](translations.md), and the [`/translation-add`](../../.claude/skills/translation-add/SKILL.md) skill applies them. `npm run lint:translations` checks the keys `settings.json` uses.

## 3. Add the field

Add a field to `components/data/jellyfin/JellyfinUserSettings.xml`, in its area's section:

```xml
<field id="playbackPlayDefaultAudioTrack" type="string" alwaysNotify="true" />
```

- **The `id` matches `settingName` exactly.** The value is saved under the field's `id` and loaded back by the same key.
- **The type comes from the table above.** A `radio` setting stored in a `boolean` field never holds `"webclient"`.
- **Give it no `value`.** The default comes from `settings.json`, and a second one here would disagree with it one day.

Nothing else is needed to load or save it: `JellyfinUserSettings.bs` observes every field, and `user.Login()` loads every key that names one.

## 4. Use it

Read the node into a local once, then read the setting from it:

```brighterscript
localUser = m.global.user
playDefault = resolvePlayDefaultAudioTrack(localUser.settings, localUser.config)
```

A plain setting needs no more than `localUser.settings.<settingName>`. When a setting overrides a server value, write one function that decides between them, and call it everywhere. This is `resolvePlayDefaultAudioTrack()` in `source/utils/streamSelection.bs`:

```brighterscript
function resolvePlayDefaultAudioTrack(userSettings as object, userConfig as object) as boolean
  ' Default to true if we can't determine the value
  defaultValue = true

  ' Try to get web client setting
  if isValid(userConfig) and isValid(userConfig.playDefaultAudioTrack)
    ' Ensure it's actually a boolean before using it
    valueType = Type(userConfig.playDefaultAudioTrack)
    if valueType = "roBoolean" or valueType = "Boolean"
      defaultValue = userConfig.playDefaultAudioTrack
    end if
  end if

  ' Check for JellyRock override setting
  if isValid(userSettings) and isValid(userSettings.playbackPlayDefaultAudioTrack) and userSettings.playbackPlayDefaultAudioTrack <> ""
    if userSettings.playbackPlayDefaultAudioTrack = "enabled"
      return true
    else if userSettings.playbackPlayDefaultAudioTrack = "disabled"
      return false
    end if
  end if

  return defaultValue
end function
```

It returns a safe value when either node or field is missing. Search for every place the behavior lives (`git grep -n "<related term>" -- source components`), so the setting changes all of them.

## 5. Test it

Unit-test a resolving function in `tests/source/unit/<area>/`. `tests/source/unit/userSettings/PlaybackPreserveDovi.spec.bs` is an example, and [`unit-tests.md`](unit-tests.md) covers writing one. Cover:

- each option (`enabled`, `disabled`, `webclient`);
- the server's value when the override is `webclient` or empty;
- `invalid` settings or configuration nodes, and an unexpected value.

Run the specs on a Roku: `npm run device:check`, then `npm run test:tdd` with your spec listed ([`unit-tests-tdd.md`](unit-tests-tdd.md)) or `npm run test:unit`.

Then on the device:

1. Open the setting in **Settings** and check its title, description and options.
2. Change it, close the app, reopen it, and check the value stayed.
3. Check the behavior changes for each value, and for each server value if it overrides one.
4. Sign in as a user who never changed it, and check the default applies.

**Reset User Settings** restores every user setting to its default through `SaveDefaults()`, so a new setting resets with no more code.

After the change merges, the `jellyrock-bot` workflow regenerates `docs/user/app-settings.md` from `settings.json` (`npm run docs:settings` does the same locally). Never edit that file by hand.
