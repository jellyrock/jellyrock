# Rules for `locale/`

Translation files for the custom JSON i18n system. [docs/architecture/translations.md](../docs/architecture/translations.md) has the full lookup chain (the active locale, then `en_US`, then the key itself) and how the locale is picked.

## Edit `en_US.json` only

- `locale/custom/en_US.json` is the source of truth. Add, rename and remove keys there, never in a non-English locale file.
- **Only two commands write non-English files: `npm run translations:seed` and release prep's `npm run translations:merge`.** Never hand-edit one: translators own the wording in Weblate.
- Every push to `main` sends `en_US.json` and `languages.json` to the `weblate` branch. Translations come back, and seeded ones go out to Weblate, only at release prep. That merge is three-way and per key: whichever side changed a key wins (deletions included), and Weblate wins when both did ([architecture](../docs/architecture/translations.md#weblate-sync)).
- `npm run update-translations` fixes what it can locally: it sorts `en_US.json`, removes unused keys and adds missing locales to `languages.json`.

## Seeding from other Jellyfin clients

- **A new key can be born translated.** Run `npm run translations:seed -- suggest --key <Key>`. If another client already has the string, add a reviewed entry to [`seed/keymap.yml`](seed/keymap.yml), and release prep fills it every release. How-to: [`docs/dev/translations.md`](../docs/dev/translations.md#seeding-translations-from-other-jellyfin-clients).
- **Never map on English text alone.** Check the source key's meaning and shape, and read the dry run's values. Both have caught real errors (see the comments in `keymap.yml`).
- **Only `GPL-2.0` or `MPL-2.0` sources** go in [`seed/sources.yml`](seed/sources.yml). JellyRock is `GPL-2.0-only`, so a `GPL-3.0` project can never be added. The seeder refuses any other license.

## Key names

Keys are PascalCase and start with a prefix that says what kind of text they hold. The prefixes and an example of each are in [`docs/dev/translations.md`](../docs/dev/translations.md#key-names). No lint checks the prefix, so pick it by what the string is.

`npm run lint:translations` fails when `en_US.json` isn't sorted alphabetically.

## Value casing: buttons Title Case, everything else sentence case

**A button label is Title Case** (`"Mark Watched"`, `"Quick Connect"`, `"Manage Subtitles"`). **Everything else is sentence case**: headings, status phrases, badges and prose (`"On this item"`, `"Direct playing"`, `"Hearing impaired"`, `"Blur images of unwatched episodes."`).

No lint checks this, so the convention holds only because it is written down. It was taken from the file rather than imposed on it. When it was written (2026-09-14, in #918), `Button*` values were 7 Title Case to 1 sentence case, while most sentence-case `Label*` values were descriptions and status phrases, where Title Case reads wrong.

Two things the rule does not claim:

- **It is not a mandate to retrofit.** On 2026-09-14, `Label*` values were about 135 Title Case, 66 sentence case and 23 mixed, because the file drifted for a long time before anyone stated a rule. Fix a value's casing when you are already editing that key; a sweep is its own change, not a rider on a feature.
- **The role decides it, not the prefix.** `LabelManageSubtitles` is Title Case because it labels a button on the details screen. Ask what the string *is* on screen.

A known outlier, left as it is: `ButtonSignOut` is `"Sign out"` next to `ButtonSignIn`'s `"Sign In"`.

## Plurals

Use `Zero`, `One` and `Many` suffixes, three keys per phrase:

- `LabelEpisodeCountZero`, `LabelEpisodeCountOne`, `LabelEpisodeCountMany`

This is simpler than the full Unicode CLDR plural rules on purpose. Languages with more plural forms (Polish, Russian, Arabic) read approximately; full plural support is a known limitation.

## Placeholders

- Use indexed placeholders: `"Hello {0}, you have {1} items"`.
- Every locale file keeps the same placeholders as `en_US.json`. `npm run lint:translations` fails on a missing or extra `{N}`.

## Language names

- Audio and subtitle track labels go through `resolveLanguageName()` in `source/utils/mediaDisplayTitle.bs`. It normalizes the code through the aliases in `languages.bs`, then tries a `Language*` translation key, then an English name, then shows the raw code.
- When you add a `LanguageX` key to `en_US.json`, **also add its 3-letter ISO 639-2 aliases** in `languages.bs`. Otherwise tracks that ffmpeg tags with the 3-letter code show the English name in every UI locale, the user's own included.
- `npm run lint:language-coverage` fails when an alias is missing.

## Don't commit

- A new locale file without its entry in `languages.json`, which puts it in the in-app picker. `npm run update-translations` adds the entry.
- An `en_US.json` change without running `npm run update-translations`.

## Documentation

- [docs/dev/translations.md](../docs/dev/translations.md): the i18n workflow and the full key lifecycle.
- [docs/architecture/translations.md](../docs/architecture/translations.md): the why and the architecture.
