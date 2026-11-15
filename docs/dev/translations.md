---
topic: translations-howto
related-files:
  - locale/languages.json
  - source/utils/translate.bs
  - source/utils/translateLocale.bs
  - source/utils/languages.bs
  - scripts/bsc-plugins/translation-keys.cjs
  - scripts/lint/update-translations.cjs
  - scripts/lint/language-coverage.cjs
  - scripts/translations-seed.js
  - locale/seed/sources.yml
  - locale/seed/keymap.yml
  - locale/seed/seeded.json
last-reviewed: 2026-10-09
---

# Translations

JellyRock has its own translation system in place of Roku's `tr()` and XML locale files. Each language is a flat JSON file in `locale/custom/`, loaded into `m.global` as an associative array, so looking up a key is a single read.

## Quick reference

```brightscript
' A plain string
translate(translationKeys.ButtonPlay)

' With placeholders
translate(translationKeys.MessageCouldNotReachServer, [serverUrl])

' Plurals (zero, one, many)
translatePlural(translationKeys.LabelEpisodeCount, count, [stri(count).trim()])
```

## Add a translated string

1. Add the key to `locale/custom/en_US.json`, in alphabetical order:

   ```json
   "MyNewKey": "My new string with {0} placeholder"
   ```

2. Rebuild. A BrighterScript compiler plugin generates `translationKeys.MyNewKey` from `en_US.json`, so the constant appears in your editor's autocomplete with no other step.

3. Use it in code:

   ```brightscript
   translate(translationKeys.MyNewKey, ["value"])
   ```

4. Run `npm run lint:translations` to check the key and its use.

## Key names

Keys are PascalCase and start with a prefix that says what kind of text they hold:

| Prefix | For | Example |
| --- | --- | --- |
| `Button` | Button labels | `ButtonPlay`, `ButtonCancel` |
| `Label` | UI labels and headings | `LabelCinemaMode`, `LabelEpisodeCountOne` |
| `Message` | Longer text | `MessageRememberMe` |
| `Error` | Error messages | `ErrorFailedToUpdateFavorite` |
| `Setting` | Setting titles, and `SettingDesc` for setting and group descriptions | `SettingHomeRowSize`, `SettingDescCinemaMode` |
| `Desc` | Descriptions of the custom theme color settings | `DescThemeColorPrimary` |
| `Day` | Day names | `DayMonday` |
| `Language` | Names of audio and subtitle languages | `LanguageAf` |

After the prefix, name the key for what the string is for, not for its first words: `MessageConfirmExit`, not `MessageAreYouSureYouWantTo`. A name built from the text says nothing once the text changes, and two strings that start alike end up as `…To` and `…To2`. A setting's description is `SettingDesc` plus a short name for the setting (`SettingDescCinemaMode`).

## Rename a key

Rename a key with the rename mode, never by editing `en_US.json` alone:

```bash
npm run update-translations -- --rename OldKey=NewKey [--rename Old2=New2 …]
```

It renames the key in `en_US.json` and in every locale file, so its translations move with it. It also renames the key in the seed map (`keymap.yml`) and ledger, in `settings/settings.json`, and in every `translationKeys.OldKey` in code and tests. If any pair is wrong (an unknown key, a plural key, or a new name a locale file, the seed map or the ledger already holds), it renames nothing. It runs only in fix mode: `npm run lint:translations` refuses `--rename`. It then lists other files that still mention the old name, such as docs and comments, for you to fix by hand.

Before it renames anything, it fetches the `weblate` branch and refuses if Weblate changed a translation of an old key since the last release. That work is not on `main` yet, and release prep drops a key `main` no longer has, so renaming now would lose it. The refusal lists each translation: rename after the next release brings them to `main`. It also refuses when it cannot read `weblate` (offline, for example); `--skip-weblate-check` renames without the check, and loses any such work. Merge the rename soon after running it: a translator who edits the old key before the merge reaches Weblate is not caught.

Release prep carries the rename to Weblate with no step of your own: `main` deleted the old key and added the new one, and the three-way merge takes `main`'s change (see [Weblate sync](../architecture/translations.md#weblate-sync)). Until then Weblate shows the new key as untranslated. If a translator translates it in that window, their translation wins at release prep, and the merge log lists it.

Plural keys are not supported yet, because code names them by their base (`translationKeys.LabelEpisodeCount`).

## Plurals

A plural string has three keys in `en_US.json`, ending in `Zero`, `One` and `Many`:

```json
"LabelEpisodeCountZero": "No episodes",
"LabelEpisodeCountOne": "1 Episode",
"LabelEpisodeCountMany": "{0} Episodes"
```

Call `translatePlural()` with the base key, without the ending:

```brightscript
translatePlural(translationKeys.LabelEpisodeCount, item.childCount, [stri(item.childCount).trim()])
```

`translatePlural()` picks `Zero`, `One` or `Many` from the count, then calls `translate()` to look the key up and fill in the placeholders. The compiler plugin generates the base key constant (`LabelEpisodeCount`) from the three variants.

## Placeholders

Write `{0}`, `{1}` and so on in the translated text, and pass the values as an array of strings:

```brightscript
' en_US.json: "MessageCouldNotReachServer": "Couldn't reach '{0}'."
translate(translationKeys.MessageCouldNotReachServer, [serverUrl])
```

## Imports in components

Files in `source/` share one scope, so `translate()` and `translationKeys` work there without imports.

Files in `components/` need both imports:

```brightscript
import "pkg:/source/utils/translate.bs"
import "pkg:/source/translationKeys.bs"
```

`translationKeys.bs` is generated by the compiler plugin. It isn't on disk, but the compiler resolves it.

## Settings

Every entry in `settings/settings.json` has `titleKey` and `descriptionKey` fields, which name keys in `en_US.json`. The settings screen shows `translate(item.titleKey)` and `translate(item.descriptionKey)`.

Give a new setting both fields:

```json
{
  "title": "Cinema Mode",
  "description": "Bring the theater experience straight to your living room with the ability to play custom intros before the main feature.",
  "settingName": "playbackCinemaMode",
  "type": "bool",
  "default": "false",
  "titleKey": "LabelCinemaMode",
  "descriptionKey": "SettingDescCinemaMode"
}
```

The `title` and `description` fields keep the English text beside the keys. See [adding a user setting](new-user-setting.md) for the whole process.

## Locale file names

Locale files are named the way Weblate expects:

| Kind | Name | Example |
| --- | --- | --- |
| Base language | Lowercase code | `fr.json`, `de.json` |
| Regional variant | Underscore and uppercase region | `fr_CA.json`, `es_MX.json` |
| Chinese | Underscore and script code | `zh_Hans.json`, `zh_Hant.json`, `zh_Hant_HK.json` |
| Numeric region | Underscore and number | `es_419.json` |

## Fallbacks

`translate()` looks a key up in three places, in order:

1. The active locale, such as `fr_CA.json`.
2. English, `en_US.json`.
3. The key itself, so a missing translation is easy to spot.

A regional locale such as `fr_CA` is layered over its base language (`fr`), so users see as many translated strings as possible. `zh_Hant_HK` is layered over `zh_Hant` the same way.

## Choosing the locale

The app picks the locale at two points:

- **Before sign-in:** the **Sign-in Screen Language** setting, else the Roku's language, else `en_US`.
- **After sign-in:** the user's setting, else the Jellyfin server's language, else the Roku's, else `en_US`.

`normalizeLocaleCode()` converts the server's language codes to the file names above: `zh-CN` becomes `zh_Hans`, and `pt-BR` becomes `pt_BR`.

A language change takes effect when the user leaves Settings, which rebuilds the home screen.

## Checks

Two scripts check translations. Both are part of `npm run lint`, and CI runs them:

| Command | What it checks |
| --- | --- |
| `lint:translations` | `en_US.json` is sorted and has no unused keys. Every `translationKeys.*` reference in the code exists, and no code passes a key as a string (`translate("Key")`). Every locale file is valid JSON with matching placeholders and complete plurals. Coverage, and that `languages.json` matches the locale files. |
| `lint:language-coverage` | The tables that map codes to translation keys stay complete: the media-language resolver in `languages.bs`, the person-label table in `people.bs`, and `creditRowKinds()` in the same file. Every `PersonKind` value in the committed spec fingerprints must have a label or be listed as blank on purpose. Every kind a credit line names must still be one some supported server sends, and its `messageKey` must exist. |

If `lint:language-coverage` fails after a Jellyfin upgrade refreshed the fingerprints, read which check failed, because each has a different fix:

- **A `PersonKind` value has no row:** a new one appeared upstream. Add a `LabelPersonKind…` key and a row to `personKindTranslationKeys()`, or a row to `unlabeledPersonKinds()` if it should show nothing.
- **A `creditRowKinds()` kind is not a `PersonKind` value:** one was renamed or removed upstream, so that credit line would show nothing. Change the kind in `creditRowKinds()` to the new spelling, or remove the line if the kind is gone. Never delete the check to silence it: an empty credit line is the bug, and nothing shows it at runtime.
- **The credit-row table could not be read:** someone rewrote the table in a form the check's parser doesn't know. Put back the `{ kind: "x", messageKey: translationKeys.Y }` shape, or teach `parseAAArray()` the new one. The parser fails rather than skipping, because a table it can't read is a check that silently stops working. For why this is a lint and not a compile error, see [translations.md](../architecture/translations.md#coverage-is-gated-not-remembered).

## Automation

The JellyRock bot (`jellyrock-bot.yml`) runs on every push to `main`. It:

1. Removes unused keys from `en_US.json`.
2. Sorts `en_US.json`.
3. Adds new locale files to `languages.json`, so they appear in the language picker.
4. Pushes `en_US.json` and `languages.json` to the `weblate` branch for the community translators.

To do steps 1 to 3 yourself, run `npm run update-translations`.

A key that doesn't exist fails the build, because `translationKeys` is generated from `en_US.json` and the compiler rejects an unknown constant.

Translations move back from the `weblate` branch to `main` only at release prep (`release-management.yml`). The merge works key by key, in three ways: whichever side changed a key since the last release wins, deletions included, and Weblate wins when both did. Release prep then seeds missing translations from other Jellyfin clients (below) and pushes the result back to `weblate`. For why and how, see [Weblate sync](../architecture/translations.md#weblate-sync).

## Seeding translations from other Jellyfin clients

A new key starts untranslated in every language, but another Jellyfin client's community has often translated the same string already. `npm run translations:seed` copies those translations in. It only fills empty cells, only from a reviewed map, and only from projects whose license allows it. Release prep runs it, so mapping a key is enough for it to fill at the next release. Run it yourself to see the result in your pull request.

A plural form (a `Zero`, `One` or `Many` key) is seeded only when its language ends up with all three forms, so a language never shows part of a count in English.

```bash
npm run translations:seed                           # dry run: per-key/per-locale coverage, refusals, casing flags
npm run translations:seed -- suggest --key LabelX   # candidate source keys for a key, as YAML stubs
npm run translations:seed -- suggest --rank --limit 50   # unmapped keys ranked by cells they would fill
npm run translations:seed -- suggest --key LabelX --show fr,de   # add each candidate's own translations
npm run translations:seed -- context --source jellyfin-web --key AddedOnValue   # where a source's code uses a key
npm run translations:seed -- --write                # apply to locale/custom/ and record each fill in locale/seed/seeded.json
```

The first run downloads each pinned source (a shallow, partial clone) into the gitignored `.cache/translation-seed/`. Later runs work offline.

### Map a key

To map a batch, highest payoff first, run [`/translation-import`](../../.claude/skills/translation-import/SKILL.md): it applies these steps to each key and reports every decision for review.

1. `suggest --key <Key>` lists source keys with the same English text. Treat it as a starting point, not an answer. To pick which keys to map first, `suggest --rank` orders every unmapped key by the cells it would fill, counted with the seeder's own refusals, so the highest payoff comes first. The count is what a mapping could be worth, not a sign its candidate is right.
2. Check each candidate's **meaning** and **shape** in context. `--show` prints its own translations in languages you can read, and `context` shows where the source's code uses it (a full checkout of the source at its pinned commit, fetched on first use). Meaning is what the source key's name says it is for: web's `MediaInfo*` keys label its media-info panel, and `PriorityIdle` is a process priority. Shape is whether it is the same kind of string: a bare label or `Codec: %1$s`, a standalone label or a word from inside a sentence. Punctuation is part of shape: a trailing period, a colon or an ellipsis that only one side has is a mismatch. Pick the key whose context matches yours.
3. Add the entry to `locale/seed/keymap.yml`. Copy both English strings exactly: if either side changes later, the entry stops seeding. List candidates you turned down under `reject:` with a reason, so `suggest` never offers them again.
4. Do a dry run and **read the values**, at least in languages you can check. A source's translation can be wrong even for its own key: web's `MediaInfoChannels` reads "Chaînes" (TV channels) in French. Drop a bad cell with `exclude: { <locale>: <reason> }`. If the value was already written, also delete it from the locale file. The seed ledger (`locale/seed/seeded.json`) then keeps it from coming back, and the next release's merge removes it from Weblate too.
5. Review the **Casing to review** list. Nothing is re-cased for you. Exclude a cell when a better-cased value comes from the base language; otherwise keep it, since a lowercase word in the user's language beats English.

### Move a source forward, or add one

- **To move a source forward**, change `ref` and `commit` together in `locale/seed/sources.yml`, then do a dry run. Entries whose source English changed are listed under **Needs re-review**.
- **To add a project**, its license must be `GPL-2.0-only`, `GPL-2.0-or-later` or `MPL-2.0`. The seeder refuses anything else, and checks the LICENSE file at the pinned commit. A new file format needs a parser in `scripts/lib/translation-formats.cjs`, with a fixture test.
