# Translation System Maintenance

This document covers the ongoing maintenance tasks for JellyRock's translation system.

## What's Automated

These tasks are handled by CI and require no manual intervention:

- **Key sort order** — The bot keeps `en_US.json` keys sorted alphabetically on every push to main
- **Language registry** — The bot auto-adds new locale files to `languages.json` so they appear in the language picker
- **Weblate sync** — The bot pushes updated source strings to the `weblate` branch after every main push
- **Release translation merge** — The release workflow auto-merges translations from the `weblate` branch into release prep PRs
- **Build-time key safety** — The `BSC` plugin generates `translationKeys` constants from en_US.json, so missing keys are compile errors (caught before code reaches main)
- **Validation** — CI rejects PRs with orphaned translations, placeholder mismatches, or hardcoded string literals

## What Needs Manual Maintenance

### Weblate Branch

The `weblate` branch must exist on the remote for the bot to sync source strings and for the release workflow to merge translations. If it is deleted, the bot workflow will fail.

- **Created once** before the first merge of the translation system
- **Should never be deleted** — it is the long-lived integration point between developers and translators
- **One-way sync from main** — developers never commit directly to the `weblate` branch; only the bot and Weblate write to it

### Weblate Configuration

Weblate needs to be configured to:

- Watch the `weblate` branch
- Use `locale/custom/en_US.json` as the source language file
- Use `locale/custom/*.json` as the translation file pattern
- Push translated files back to the `weblate` branch

### Locale Files

- **Adding a new language** — Drop a `<code>.json` file in `locale/custom/`. The bot will auto-add it to `languages.json` on the next push to main. The language metadata map in `scripts/lint/update-translations.cjs` covers 100+ locale codes; unknown codes will use the code as the display name (a warning is printed).
- **Removing a language** — Delete the `.json` file from `locale/custom/` and remove its entry from `languages.json`. Also remove it from the Weblate project.
- **Regional locales** — Regional files (e.g. `fr_CA.json`) automatically layer over their base language (`fr.json`). No configuration needed — this is handled by the runtime. Chinese locales use script codes (`zh_Hans.json`, `zh_Hant.json`, `zh_Hant_HK.json`) with 3-layer loading for maximum coverage.

### Settings Translation Keys

Every entry in `settings/settings.json` has `titleKey` and `descriptionKey` fields. When adding or modifying settings, ensure:

1. The key exists in `en_US.json`
2. The `title` / `description` English text in settings.json matches the en_US.json value (settings.json is the human-readable source of truth; the keys are what the app actually renders)

CI validates that all referenced keys exist.

## Maintenance Scripts

| Command | Purpose |
| --- | --- |
| `npm run update-translations` | Auto-fix: sort en_US.json, remove orphans, sync languages.json, then validate |
| `npm run lint:translations` | Validate all translation files, code references, placeholders, and coverage (exits 1 on error) |

Both run as part of `npm run lint` (lint mode only).

## Architecture at a Glance

```text
locale/custom/en_US.json          ← Source of truth (455 keys)
locale/custom/<locale>.json       ← Community-translated locale files
locale/languages.json             ← Language registry (auto-managed)
source/utils/translate.bs         ← Runtime: translate(), translatePlural(), loadTranslations()
source/utils/translateLocale.bs   ← Locale resolution cascade
scripts/bsc-plugins/translation-keys.cjs  ← BSC plugin: generates translationKeys namespace
scripts/lint/update-translations.cjs   ← All-in-one: lint (default) + fix (--fix)
```
