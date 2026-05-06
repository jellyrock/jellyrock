---
name: translation-add
description: Add a new translation key to JellyRock's custom JSON i18n system. Walks locale/CLAUDE.md (pick the right key prefix, add to locale/custom/en_US.json alphabetically, handle plurals via Zero/One/Many suffixes, handle placeholders via indexed {0} {1}, add ISO-639-2 aliases for track-language keys, run npm run lint:translations + lint:language-coverage). Use when adding a new user-visible string. The BSC plugin watches en_US.json and regenerates the translationKeys constants live, so the BS-side reference becomes available without a manual codegen step.
model: sonnet
---

# /translation-add — guided workflow

Wraps [`locale/CLAUDE.md`](../../../locale/CLAUDE.md) and [`docs/dev/translations.md`](../../../docs/dev/translations.md). Translation data lives in `locale/custom/<locale>.json`; English (`en_US.json`) is the source of truth, the Weblate bot keeps non-English locales in sync.

## Step 1 — Pick the key prefix

Per `locale/CLAUDE.md`, keys are PascalCase with a category prefix:

| Prefix | For |
|---|---|
| `Button*` | Button labels |
| `Label*` | UI labels and headings |
| `Message*` | Longer descriptive text |
| `Error*` | Error messages |
| `Setting*` | Setting titles and descriptions |
| `Tab*` | Tab labels |
| `Header*` | Section headers |
| `Tooltip*` | Tooltip text |
| `Language*` | Track language names (audio / subtitle labels) |

If none fit cleanly, pick the closest match — don't invent a new prefix without a `decisions.md` entry. The convention is enforced by `npm run lint:translations`.

## Step 2 — Add the key to `en_US.json` (alphabetically)

Edit [`locale/custom/en_US.json`](../../../locale/custom/en_US.json). Keys must be alphabetically sorted (the lint enforces this). For a single non-plural key:

```json
"ButtonSaveChanges": "Save changes",
```

Match the surrounding entries' indentation and quote style. Don't reformat the file — `npm run lint:translations -- --fix` handles sort drift if you misplace it.

## Step 3 — Handle plurals (if applicable)

JellyRock uses a simple zero/one/many model — three keys per logical phrase:

```json
"LabelEpisodeCountZero": "no episodes",
"LabelEpisodeCountOne": "{0} episode",
"LabelEpisodeCountMany": "{0} episodes",
```

Languages with richer plural forms (Polish, Russian, Arabic) read this approximately — full Unicode CLDR plural support is a known limitation. Don't add `Few` / `Two` / etc. variants without a decisions.md entry that broadens the rule project-wide.

In BS, call `translatePlural(translationKeys.LabelEpisodeCount, count, [stri(count).trim()])`. Note: pass the BASE key (no suffix); `translatePlural` picks the right variant.

## Step 4 — Handle placeholders (if applicable)

Use indexed placeholders: `{0}`, `{1}`, `{2}`. Every locale file MUST preserve the same placeholder set as `en_US.json` — placeholder parity is enforced by `npm run lint:translations`.

```json
"ErrorTypeNotYetSupported": "Type {0} is not yet supported on this device",
```

In BS: `translate(translationKeys.ErrorTypeNotYetSupported, [itemType])`.

## Step 5 — Track-language keys (Language* prefix only)

If your new key is in the `Language*` family (audio/subtitle track labels), you also need to add the corresponding 3-letter ISO 639-2 codes to [`source/utils/languages.bs`](../../../source/utils/languages.bs)'s alias map. Without this, ffmpeg-tagged tracks for that language fall through to the English label in every UI locale.

`npm run lint:language-coverage` enforces this — the build fails if alias coverage is missing. So skipping this step gets caught at build time, not at runtime.

## Step 6 — Use the key in BS

The BSC translation-keys plugin ([`scripts/bsc-plugins/translation-keys.cjs`](../../../scripts/bsc-plugins/translation-keys.cjs)) watches `en_US.json` and regenerates the `translationKeys` virtual file live. After your edit, the new key is available immediately — no manual codegen step.

```brightscript
m.label.text = translate(translationKeys.ButtonSaveChanges)
```

The `translate(...)` and `translatePlural(...)` helpers live in [`source/utils/translate.bs`](../../../source/utils/translate.bs).

## Step 7 — Verify

```bash
npm run lint:translations         # sort + parity
npm run lint:language-coverage    # only relevant for Language* keys
npm run validate                  # confirms the BS reference resolves
```

If any fail with auto-fixable issues, run `npm run lint:translations -- --fix`. The pre-push hook also runs these so a missed run gets caught at push time.

## Step 8 — Don't touch non-English locale files

Don't manually edit `locale/custom/<other>.json`. The Weblate bot syncs them on push to main: orphaned keys removed, new keys propagated as untranslated. Translators handle the actual translation downstream. Manual edits create merge conflicts when Weblate runs.

## When NOT to use

- The string is dev-only (debug log, error message that only an agent would see) — don't translate. Use a plain English string in the source.
- The string is a path / identifier / API field name — those are not translatable; they're protocol-level constants.
- You're translating an existing key — that's Weblate's job, not yours. Just edit `en_US.json` if the source-of-truth English needs revision.

## Sub-agent invocation

To invoke from a sub-agent: parent passes `Read .claude/skills/translation-add/SKILL.md and follow the steps for $ARGUMENTS=<key-name-or-string>; surface the diff against locale/custom/en_US.json but do NOT commit` in the Task prompt.
