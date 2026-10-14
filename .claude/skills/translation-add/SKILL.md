---
name: translation-add
description: Add a new translation key to JellyRock's custom JSON i18n system. Walks locale/CLAUDE.md (pick the right key prefix, add to locale/custom/en_US.json alphabetically, handle plurals via Zero/One/Many suffixes, handle placeholders via indexed {0} {1}, add ISO-639-2 aliases for track-language keys, run npm run lint:translations + lint:language-coverage). Use when adding a new user-visible string. The BSC plugin watches en_US.json and regenerates the translationKeys constants live, so the BS-side reference becomes available without a manual codegen step.
model: sonnet
effort: low
---

# /translation-add: a guided workflow

Wraps [`locale/CLAUDE.md`](../../../locale/CLAUDE.md) and [`docs/dev/translations.md`](../../../docs/dev/translations.md). Translations live in `locale/custom/<locale>.json`. English (`en_US.json`) is the source of truth: every push to `main` sends it to Weblate, and translations come back at release prep.

## Step 1: Pick the key prefix

Keys are PascalCase and start with a prefix that says what kind of text they hold. The prefixes and an example of each are in [`docs/dev/translations.md`](../../../docs/dev/translations.md#key-names). No lint checks the prefix, so pick it by what the string is on screen. If none fits, pick the closest; a new prefix needs a `/log decision` first.

## Step 2: Add the key to `en_US.json`, sorted

Edit [`locale/custom/en_US.json`](../../../locale/custom/en_US.json) and put the key in sorted order; `npm run lint:translations` fails on an unsorted file. The lint sorts by character code, so capitals come before lowercase (`LabelTrackCount` before `LabelTracks`). A button label is Title Case, everything else sentence case (`locale/CLAUDE.md`). For a single key:

```json
"ButtonSaveChanges": "Save Changes",
```

Match the surrounding entries' indentation and quoting, and don't reformat the file.

⚠️ **Use the key in code (Step 6) before running `npm run update-translations` or pushing.** Fix mode removes every `en_US.json` key the code doesn't use, and the pre-push hook runs it whenever a `.bs` or `locale/` file changed. A key added but not yet used is deleted.

## Step 3: Plurals, if the string has a count

JellyRock uses a zero/one/many model, three keys per phrase. These are the existing episode keys, whose Title Case values predate the casing rule; a new count phrase is sentence case:

```json
"LabelEpisodeCountZero": "No episodes",
"LabelEpisodeCountOne": "1 Episode",
"LabelEpisodeCountMany": "{0} Episodes",
```

Languages with more plural forms (Polish, Russian, Arabic) read this approximately; full Unicode CLDR plural support is a known limitation. Don't add `Few`, `Two` or other variants without a `/log decision` that changes the rule for the whole project.

In BrighterScript, call `translatePlural(translationKeys.LabelEpisodeCount, count, [stri(count).trim()])`. Pass the base key, with no suffix: `translatePlural` picks the variant. `npm run lint:translations` fails when one of the three keys is missing.

## Step 4: Placeholders, if the string has values

Use indexed placeholders: `{0}`, `{1}`, `{2}`. Every locale file keeps the same placeholders as `en_US.json`, and `npm run lint:translations` fails on a missing or extra one.

```json
"MessageCouldNotReachServer": "Couldn't reach '{0}'.",
```

In BrighterScript: `translate(translationKeys.MessageCouldNotReachServer, [serverUrl])`.

## Step 5: Track-language keys (`Language*` only)

A new `LanguageX` key also needs its 3-letter ISO 639-2 codes in the alias map in [`source/utils/languages.bs`](../../../source/utils/languages.bs). Without them, tracks that ffmpeg tags with the 3-letter code show the English name in every UI locale. `npm run lint:language-coverage` fails when an alias is missing.

## Step 6: Use the key in BrighterScript

The translation-keys BSC plugin ([`scripts/bsc-plugins/translation-keys.cjs`](../../../scripts/bsc-plugins/translation-keys.cjs)) watches `en_US.json` and regenerates the `translationKeys` constants live, so the new key is available as soon as you save.

```brightscript
m.label.text = translate(translationKeys.ButtonSaveChanges)
```

`translate()` and `translatePlural()` live in [`source/utils/translate.bs`](../../../source/utils/translate.bs).

## Step 7: Look for an existing translation in another Jellyfin client

Another Jellyfin client's community has often translated the same string already. Check before the key ships untranslated in every locale. `suggest` reads the key from `en_US.json`, so save Step 2 first, and run it once per key (each of a plural's three):

```bash
npm run translations:seed -- suggest --key <YourKey>
```

If a candidate means the same thing and has the same shape (a bare label against `Codec: %1$s`; a standalone label against a word from inside a sentence), add a reviewed entry to [`locale/seed/keymap.yml`](../../../locale/seed/keymap.yml), run `npm run translations:seed` (a dry run; only `--write` writes) and read the values it would write. Release prep seeds the key from then on. Full checklist: [`docs/dev/translations.md`](../../../docs/dev/translations.md#seeding-translations-from-other-jellyfin-clients). No candidate is a normal outcome: Weblate translators take it from there.

## Step 8: Verify

```bash
npm run lint:translations         # sort order, unused keys, placeholders, plurals
npm run lint:language-coverage    # only for Language* keys
npm run validate                  # the BrighterScript reference resolves
```

An unused-key error means Step 6 hasn't used the key yet. For a sort-order failure, run `npm run update-translations` (only after Step 6). The pre-push hook runs `update-translations` and `validate`, and `lint:language-coverage` when its inputs changed, so a missed run is caught at push.

## Step 9: Don't touch non-English locale files

Don't edit `locale/custom/<other>.json` by hand. Translators own the wording in Weblate; the only other writers are `translations:seed` (Step 7) and release prep's merge.

## When not to use

- The string is for developers only (a debug log, an error only an agent sees): don't translate it. Use a plain English string in the source.
- The string is a path, an identifier or an API field name: these are protocol constants, not text.
- You want to change an existing key's translation: that is the translators' job, in Weblate. Edit `en_US.json` only when the English needs revising.

## Sub-agent invocation

To run it from a sub-agent, the parent passes `Read .claude/skills/translation-add/SKILL.md and follow the steps for the key or string <key-name-or-string>; surface the diff against locale/custom/en_US.json but do not commit` in the Agent prompt.
