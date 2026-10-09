# Translation maintenance

This page covers what a maintainer looks after in JellyRock's translation system. How the system works, including the full release-prep merge, is in [Translations (i18n)](../architecture/translations.md).

## What runs on its own

CI handles these, with no one stepping in:

- **Key order and language list.** On every push to `main`, the bot sorts `en_US.json` and adds new locale files to `languages.json`, so they appear in the language picker.
- **New English text to Weblate.** On every push to `main`, the bot copies `en_US.json` and `languages.json` to the `weblate` branch.
- **Translations back at release.** Release prep locks Weblate, merges its translations into the release key by key, fills gaps from other Jellyfin clients, and sends the result back to the `weblate` branch. See [Weblate sync](../architecture/translations.md#weblate-sync).
- **Key safety at build time.** A BrighterScript plugin generates the `translationKeys` constants from `en_US.json`, so code that names a missing key fails to compile.
- **Checks on every PR.** `npm run lint:translations` fails when `en_US.json` is unsorted, has keys no code uses, or lacks a key the code uses. It also fails on an incomplete plural set, a placeholder that differs from the English, a `translate("Key")` call with a literal key instead of a `translationKeys` constant, and a locale file missing from `languages.json`. Keys in a locale file that `en_US.json` no longer has are a warning only.

## What you look after

### The `weblate` branch

The bot and release prep both need the `weblate` branch on the remote. If it is missing, both workflows fail.

- Never delete it. It is where developers' and translators' work meets.
- Don't commit to it by hand. Only the bot, release prep and Weblate write to it.
- Don't re-cut it from `main` to clear GitHub's "behind" count. The count is expected, and re-cutting deletes the marker the next release merge needs ([why](../architecture/translations.md#weblate-sync)).

### Weblate settings

Weblate must:

- Watch the `weblate` branch.
- Use `locale/custom/en_US.json` as the source language file.
- Use `locale/custom/*.json` as the translation file pattern.
- Push translated files back to the `weblate` branch.

Release prep also needs the `WEBLATE_TOKEN` secret to lock Weblate. Setup and renewal are in [Weblate token setup](../architecture/translations.md#weblate-token-setup).

### Locale files

- **Add a language:** put a `<code>.json` file in `locale/custom/`. The bot adds it to `languages.json` on the next push to `main`. `scripts/lint/update-translations.cjs` knows the names of about a hundred locale codes. For any other code, it uses the code as the display name and prints a warning.
- **Remove a language:** delete its `.json` file from `locale/custom/`, remove its entry from `languages.json`, and remove it from the Weblate project.
- **Regional locales:** a regional file (for example `fr_CA.json`) layers over its base language (`fr.json`) at runtime, with nothing to configure. Chinese uses script codes (`zh_Hans.json`, `zh_Hant.json`, `zh_Hant_HK.json`) and loads in three layers.

### Settings text

Every entry in `settings/settings.json` has `titleKey` and `descriptionKey` fields. When you add or change a setting:

1. Make sure both keys exist in `en_US.json`.
2. Make the English `title` and `description` in `settings.json` match the `en_US.json` values. The app shows the `en_US.json` text, and [App settings](../user/app-settings.md) is generated from `settings.json`.

CI checks that every key exists. Nothing checks that the English text matches.

## Commands

| Command | What it does |
| --- | --- |
| `npm run update-translations` | Sorts `en_US.json`, removes keys no code uses, updates `languages.json`, then runs the checks |
| `npm run lint:translations` | Runs the checks only, and fails on an error |

`npm run lint` runs `lint:translations`.

## Where the pieces are

```text
locale/custom/en_US.json                  ← English source text
locale/custom/<locale>.json               ← Translated locale files
locale/languages.json                     ← Language list (kept by the bot)
source/utils/translate.bs                 ← Runtime: translate(), translatePlural(), loadTranslations()
source/utils/translateLocale.bs           ← Picks the locale to load
scripts/bsc-plugins/translation-keys.cjs  ← BrighterScript plugin: generates the translationKeys constants
scripts/lint/update-translations.cjs      ← Checks (default) and fixes (--fix)
```
