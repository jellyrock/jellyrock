# Rules for `locale/`

Translation files for the custom JSON i18n system. See [docs/architecture/translations.md](../docs/architecture/translations.md) for the full lookup chain (active → en_US fallback → key) and locale-resolution cascade.

## Edit `en_US.json` only

- `locale/custom/en_US.json` is the source of truth. Add / rename / remove keys here, never in non-English locale files directly.
- The Weblate bot keeps non-English locales in sync with `en_US.json` (orphaned keys removed, keys sorted) on every push to `main`.
- `npm run update-translations` (with `--fix` via the npm script) auto-fixes sortable issues locally.

## Key naming convention

Keys are PascalCase with a category prefix:

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
| `Language*` | Track language names (used by `source/utils/languages.bs` 3-tier resolver) |

The convention is enforced by `npm run lint:translations`. Keys must be alphabetically sorted (canonical).

## Value casing — buttons Title Case, everything else sentence case

**A button label is Title Case** (`"Mark Watched"`, `"Quick Connect"`, `"Manage Subtitles"`). **Everything else is sentence case** — headings, status phrases, badges and prose (`"On this item"`, `"Direct playing"`, `"Hearing impaired"`, `"Blur images of unwatched episodes."`).

This is **not** checked by any lint, so it rests on the convention being written
down. It was derived from the file rather than imposed on it: `Button*` values
are 7 Title Case to 1 sentence case, while the sentence-case `Label*` mass is
dominated by descriptions and status phrases where Title Case reads wrong. The
split follows what the file already does in each role.

Two things the rule does **not** claim:

- **It is not a mandate to retrofit.** `Label*` overall is roughly 135 Title /
  66 sentence / 23 mixed, because it drifted for a long time before anyone stated
  a rule. Fix a value's casing when you are already editing that key; a sweep is
  its own change, not a rider on a feature.
- **The prefix does not decide it, the ROLE does.** `LabelManageSubtitles` is
  Title Case because it labels an `IconButton`, not because of its prefix. Ask
  what the string *is* on screen.

Known outlier, deliberately left: `ButtonSignOut` is `"Sign out"` next to
`ButtonSignIn`'s `"Sign In"`.

## Plurals

Use `Zero` / `One` / `Many` suffixes — three keys per logical phrase:

- `LabelEpisodeCountZero`, `LabelEpisodeCountOne`, `LabelEpisodeCountMany`

This is intentionally simpler than full Unicode CLDR plural rules. Languages with more plural forms (Polish, Russian, Arabic) read approximately; full plural support is a known limitation.

## Placeholders

- Use indexed placeholders: `"Hello {0}, you have {1} items"`.
- Every locale file MUST preserve the same placeholders as `en_US.json`. Drift (missing or extra `{N}`) is enforced by `npm run lint:translations` (placeholder parity check).

## Language name aliases

- Track-language localization (audio/subtitle labels) goes through `source/utils/languages.bs` (3-tier: alias → translation key → English fallback).
- When you add a new `LanguageX` key in `en_US.json`, **also add the 3-letter ISO 639-2 aliases** in `languages.bs`. Otherwise ffmpeg-tagged tracks for that language fall through to English in every UI locale, including the user's own.
- `npm run lint:language-coverage` enforces this; the build fails if alias-coverage is missing.

## Don't commit

- A new locale file unless `languages.json` is updated to expose it in the in-app picker.
- An `en_US.json` change without `npm run update-translations` (sorts keys, removes orphans).

## Documentation

- `docs/dev/translations.md` — i18n workflow, the full key lifecycle.
- [docs/architecture/translations.md](../docs/architecture/translations.md) — the why and the architecture.
