---
topic: translations
related-files:
  - source/utils/translate.bs
  - source/utils/translateLocale.bs
  - source/utils/languages.bs
  - source/utils/mediaDisplayTitle.bs
  - source/utils/people.bs
  - scripts/bsc-plugins/translation-keys.cjs
  - scripts/lint/update-translations.cjs
  - scripts/lint/language-coverage.cjs
  - locale/languages.json
  - locale/seed/sources.yml
  - locale/seed/keymap.yml
  - locale/seed/seeded.json
  - scripts/translations-seed.js
  - scripts/translations-merge.js
  - scripts/weblate-sync.js
  - scripts/lib/locale-files.cjs
  - scripts/lib/translation-formats.cjs
  - .github/workflows/jellyrock-bot.yml
  - .github/workflows/release-management.yml
last-reviewed: 2026-10-10
---

# Translations (i18n)

How JellyRock looks up translated strings, picks a locale, labels languages and people, keeps keys safe at compile time, and moves translations between `main` and Weblate. The how-to for adding a string is in [`docs/dev/translations.md`](../dev/translations.md).

## Why a custom system

Roku's built-in `tr()` looks strings up in a `translations.xml` file in the package. JellyRock uses its own JSON system instead, for four reasons:

- **One lookup per string.** Each locale is loaded once into a flat `roAssociativeArray`, so a translation is a single key lookup.
- **Fallback control.** A regional locale is layered over its base language (`fr_CA` over `fr`), and any key still missing falls back to `en_US`, so users always see text.
- **Build-time key checks.** A BrighterScript plugin turns `en_US.json` into `translationKeys` constants, so a misspelled key fails the build.
- **Community workflow.** The files are plain JSON, which Weblate reads and writes.

## File layout

```text
locale/
├── custom/                  one JSON file per locale
│   ├── en_US.json           the source of truth, and always loaded as the fallback
│   ├── fr.json
│   ├── fr_CA.json           regional overlay on fr.json
│   ├── zh_Hans.json         Simplified Chinese (a script code, not a region)
│   ├── zh_Hant.json         Traditional Chinese
│   ├── zh_Hant_HK.json      Hong Kong, layered over zh_Hant
│   └── ...
├── languages.json           the languages the in-app picker offers
└── seed/                    sources, key map and ledger for seeding (see below)

source/utils/
├── translate.bs             translate(), translateCached(), translatePlural(),
│                            loadTranslations(), loadLocaleFile(), loadChineseLocaleFile()
├── translateLocale.bs       resolveTranslationLocale(), mapRokuLocaleToTranslationLocale(),
│                            normalizeLocaleCode()
├── languages.bs             the media-language tables
├── mediaDisplayTitle.bs     resolveLanguageName(), the media-language resolver
└── people.bs                personCreditLabel() and the person-label tables

scripts/bsc-plugins/
└── translation-keys.cjs     generates pkg:/source/translationKeys.bs from en_US.json
```

Each `languages.json` entry is `{code, name, nativeName}`. The first has `code: ""` and `name: "Automatic"`, which means "use the device locale". `npm run update-translations` adds an entry for any locale file the list lacks, and the JellyRock bot runs it on every push to `main`.

## Lookup chain

Two translation tables live on `m.global` for the life of the app:

- **`m.global.translations`**: the active locale.
- **`m.global.translationsFallback`**: always `en_US`.

When the active locale is `en_US`, `loadTranslations()` passes the same AA to both fields.

`translate(key, params)` tries the active locale, then `en_US`, then returns the key itself:

```brightscript
function translate(key as string, params = invalid as object) as string
  if key = invalid or key = "" then return ""

  value = m.global.translations[key]
  if value = invalid
    value = m.global.translationsFallback[key]
  end if
  if value = invalid
    return key
  end if

  if params <> invalid and type(params) = "roArray" and params.Count() > 0
    for i = 0 to params.Count() - 1
      value = value.Replace("{" + i.toStr() + "}", params[i])
    end for
  end if

  return value
end function
```

Returning the key makes a missing string visible: it shows up on screen as `LabelEpisodeCount`.

### Translating a batch on a Task thread: `translateCached()`

From a Task thread, each `translate()` copies `m.global.translations` across the thread boundary ([async.md](async.md#crossing-the-thread-boundary-costs-a-rendezvous--budget-crossings-not-bytes)). Code that labels many items on a Task calls `translateCached(key, cache)` instead, which keeps each key's value for the rest of one batch. The caller picks the seed by how many distinct keys the batch needs:

- **An empty AA** when the batch needs only a few keys. The cast labels in `people.bs` need a handful, and copying the whole table cost more than those calls.
- **`m.global.translations` itself, read once**, when it needs many. `sortSubtitles()` in `subtitles.bs` needs a language name per subtitle track, often dozens. A key missing from the locale still falls back through `translate()`, and the miss is written only into the local copy.

The cache lives for one batch and no longer, because the locale can change mid-session.

## Plurals: `translatePlural()`

A plural is three keys with the suffixes `Zero`, `One` and `Many`:

```brightscript
function translatePlural(baseKey as string, count as integer, params = invalid as object) as string
  if count = 0
    suffix = "Zero"
  else if count = 1
    suffix = "One"
  else
    suffix = "Many"
  end if
  return translate(baseKey + suffix, params)
end function
```

So `LabelEpisodeCount` needs `LabelEpisodeCountZero`, `LabelEpisodeCountOne` and `LabelEpisodeCountMany` in `en_US.json`. This is simpler than Unicode's CLDR plural rules, so languages with more plural forms (Russian, Polish, Arabic) read approximately: [`plural-forms-zero-one-many-only`](tech-debt.md#plural-forms-zero-one-many-only).

```brightscript
translate(translationKeys.ButtonPlay)
translate(translationKeys.MessageCouldNotReachServer, [serverUrl])
translatePlural(translationKeys.LabelEpisodeCount, count, [stri(count).trim()])
```

Key names start with a prefix that says what kind of text they hold. The prefixes are listed in [the dev guide](../dev/translations.md#key-names); no lint checks them.

## Locale loading

`loadTranslations(locale)` runs at four points:

| Caller | When | Which locale |
|---|---|---|
| `Main()` in `main.bs` | Cold start, before the scene exists | The sign-in locale |
| `reenterLogin()` in `loginRouter.bs` | Every entry to the sign-in flow: cold start, change server, change user, sign out | The sign-in locale |
| `user.LoadUserPreferences()` in `session.bs` | After sign-in, from `user.Login()` | The signed-in locale, if it differs from the current one |
| `onLanguagePickerSelected()` in `components/settings/settings.bs` | The user picks a display language | The picked locale, if it differs |

It then:

1. Loads `en_US.json` into the fallback AA.
2. For `en_US`, uses that same AA as the active one.
3. Otherwise calls `loadLocaleFile(locale)`, which layers regional and Chinese locales. If no file is found, the active locale becomes `en_US`.
4. Sets `translations`, `translationsFallback` and `translationLocale` on `m.global` in one `setFields` call.

### Regional layering: `loadLocaleFile()`

For a locale like `fr_CA`, `loadLocaleFile()` loads `fr.json`, then `fr_CA.json`, and appends the regional AA onto the base, so regional values win. If only one of the two files exists, that one is used. A `fr_CA` user sees Canadian French where translators provided it, base French elsewhere, and English for a key neither has.

### Chinese layering: `loadChineseLocaleFile()`

Chinese locales use script codes (`Hans` for Simplified, `Hant` for Traditional) rather than regions, so `loadChineseLocaleFile()` layers them its own way. It always tries a base `zh.json` first, and `zh_Hant_HK` adds `zh_Hant` in the middle:

| Locale | Files tried, in order |
|---|---|
| `zh_Hans` | `zh.json`, `zh_Hans.json` |
| `zh_Hant` | `zh.json`, `zh_Hant.json` |
| `zh_Hant_HK` | `zh.json`, `zh_Hant.json`, `zh_Hant_HK.json` |

No `zh.json` ships today, so that layer is skipped. A Hong Kong user gets Hong Kong strings where they exist, then Traditional Chinese, then English.

## Locale resolution: `resolveTranslationLocale()`

`resolveTranslationLocale(isPostLogin, serverLanguage)` in `translateLocale.bs` picks the locale from the first source that has one:

| Step | Source | Before sign-in | After sign-in |
|---|---|---|---|
| 1 | The user's **Display Language** setting (`translationLocale`, read with `getUserSetting`) | Skipped | Used |
| 2 | The server's language, `CustomPrefs.language`, through `normalizeLocaleCode()` (Jellyfin sends `zh-CN`, `pt-BR`) | Skipped | Used |
| 3 | The device-wide **Sign-in Screen Language** setting (`globalTranslationLocale`, read with `getSetting`) | Used | Skipped |
| 4 | The Roku's locale, through `mapRokuLocaleToTranslationLocale()` (`zh_CN` becomes `zh_Hans`, `zh_TW` becomes `zh_Hant`, `zh_HK` becomes `zh_Hant_HK`) | Used | Used |
| 5 | `en_US` | Used | Used |

`globalTranslationLocale` is the only thing that localizes the sign-in screens. It is skipped after sign-in, so a user's session follows their own setting, their server's language or the device, and never the device-wide sign-in default.

The sign-in locale is resolved in `reenterLogin()`, which runs at cold start and every time the sign-in flow is entered again. A changed `globalTranslationLocale` therefore applies at the next sign-out or change of user, with no restart, which is why picking it in Settings does not reload the current session.

The signed-in locale is resolved in `user.LoadUserPreferences()`, inside the branch that runs when the server's display preferences come back with `CustomPrefs`. If that request fails or has no `CustomPrefs`, the session keeps the sign-in locale.

## Track language name resolution

Media stream language codes (what Jellyfin sends as `MediaStream.Language` for an audio or subtitle track) are shown as language names in the user's locale. The codes come in whatever form the container used, so one language can arrive as ISO 639-2/T (`fra`), ISO 639-2/B (`fre`), ISO 639-1 (`fr`) or with a region (`fr-CA`).

`resolveLanguageName()` in `mediaDisplayTitle.bs` resolves them against the tables in `languages.bs`:

1. **Normalize.** Lowercase the code and drop any region. `und` ("undetermined") and `zxx` ("no linguistic content") return an empty label, since there is nothing to name. `mediaLanguageAliases()` then maps a 3-letter code (`fra`, `fre`) to its 2-letter base (`fr`).
2. **Tier 1, translation key.** `languageTranslationKeys()` maps the base to a `LanguageX` key (`fr` to `LanguageFr`), translated in the user's locale.
3. **Tier 2, English fallback.** `languageEnglishFallbacks()` covers codes the app has no translation key for, such as `lat` (Latin) and `swa` (Swahili). These show in English in every locale: translating thousands of rare language names into every locale was not worth the upkeep.
4. **Tier 3, the raw code.** Anything else shows as it arrived.

The callers are `ItemDetails.bs`, `SubtitlePanel.bs`, `PlayerHostView.bs`, and `sortSubtitles()` in `subtitles.bs` on `LoadVideoContentTask`.

### Matching codes across forms: `languageBaseCode()` and `languagesMatch()`

Track selection needs the same normalization for a different reason. A preference or an item's `OriginalLanguage` (ISO 639-1, `ko`) has to find a track tagged in another form (`kor`). `languageBaseCode()` reduces a code to one form through `mediaLanguageAliases()`, then `mediaLanguageMatchAliases()`, a second map holding only the ISO 639-2 codes the first leaves out.

The two maps stay apart on purpose. `mediaLanguageAliases()` covers only languages with a translation key, and the labels depend on that gap: tier 2 is keyed by the 3-letter code, so aliasing `swa` to `sw` in the display map would show Swahili as the raw `swa`. The matching map can therefore cover every language without changing any label. Which codes count as a match for a given track list (the exact code first, the same language only as a fallback) is selection policy, and lives with it in `streamSelection.bs` (`matchingLanguageCodes()`).

### CI lint: `npm run lint:language-coverage`

`scripts/lint/language-coverage.cjs` catches gaps in these tables that type checks and unit tests pass and only a non-English user would see:

| Check | What fails it | What the user would see |
|---|---|---|
| 1 | A display alias points at a base in neither tier 1 nor tier 2 | The raw 2-letter code |
| 2 | A tier 1 language lacks an alias for one of its 3-letter codes | That language in English in every locale, the user's own included |
| 3 | A tier 1 key is missing from `en_US.json` | The key name |
| `3b` | The matching map overlaps the display map, or holds something other than a 3-letter to 2-letter code | Nothing at first; the two copies can drift apart |
| 4 | A `PersonKind` value has no label row, or a person-label row or credit line names a kind no supported server sends | See [Person role labels](#person-role-labels-sourceutilspeoplebs) |

The script's name predates check 4: [`language-coverage-script-misnamed`](tech-debt.md#language-coverage-script-misnamed).

## Person role labels: `source/utils/people.bs`

The third localization concern is a sibling of the language resolver. `BaseItemPerson.Type` (a `PersonKind` enum value) and `.Role` (a TMDB job title, or an actor's character) arrive as raw English and become the subtitle on a Cast & Crew card.

They are resolved in the app on every server version. Jellyfin 12.0 added per-request localization through the `Accept-Language` header ([jellyfin#16488](https://github.com/jellyfin/jellyfin/pull/16488)), but it covers the server's own resource strings, and neither `PersonKind` values nor TMDB job names are among them.

`personCreditLabel()` follows the rule of `jellyfin-web`'s `getPeopleRoleOrTypeLabel`:

1. **Character.** An `Actor` or `GuestStar` with a `Role` shows `LabelPersonRoleAs` ("as {0}").
2. **Type.** With no `Role`, or a `Role` that only repeats the `Type`, it shows the `LabelPersonKindX` key for that kind, or nothing when `unlabeledPersonKinds()` lists the kind. `Unknown` is the only such kind today. It is the value the enum serializes by default, so it means "the server did not say", and it should read like no type at all rather than as the word. (`jellyfin-web` translates it; JellyRock differs on purpose.) A kind in neither table passes through as raw text, which the gate below prevents.
3. **Job.** Anything else shows the `Role`: through `LabelPersonJobX` for the jobs with a string (`Screenplay` and `Novel`, the two the server files under `Writer`), and as raw text otherwise. An untranslated real job beats a translated generic one, which is also what web does.

**The cache is keyed on the translation key, not on the credit.** This resolver runs on a Task thread (`LoadExtrasRowsTask`), where each `translate()` crosses the thread boundary ([async.md](async.md#crossing-the-thread-boundary-costs-a-rendezvous--budget-crossings-not-bytes)). An actor's label differs per character, so a cache keyed on the credit would miss on every actor and make one `translate()` per person. Resolving "as {0}" once and filling in the character on the Task thread limits a whole cast to one call per distinct key.

### Coverage is gated, not remembered

The kind table is keyed off a server enum, so it is closed, and whether it is complete can be checked. `npm run lint:language-coverage` checks it:

- Every `PersonKind` value in the committed [spec fingerprints](spec-fingerprints/) appears in `personKindTranslationKeys()` or `unlabeledPersonKinds()`.
- The two tables do not overlap.
- Neither has a row for a value no supported server sends.

The compiler cannot do this. It catches a misspelled key in a row that exists, but a value with no row has no expression to fail on. Values have shipped as raw English this way, and nothing else caught them.

`creditRowKinds()`, the details screen's credit lines (decision [`credit-row-kinds-in-people`](../decisions.md)), names `PersonKind` values too. Its lines render in array order, so it is an array of AAs rather than an AA, and `parseAAArray()` reads that shape. The check holds every kind it names to the fingerprints' enum and every `messageKey` to `en_US.json`. Without it, an upstream rename of `Creator` would empty the "Created by" line with every check green.

The parser tells an absent table from one it cannot read. A missing function, a missing array literal, an entry missing a field, or a literal with content but no entries it can read all fail the run. Only a literal that is provably empty (`[]`) passes quietly. The empty test looks at whether the literal holds any content, not at its braces, so rewriting the entries as bare strings fails rather than parsing to zero entries.

The gate reads the fingerprints rather than `.api-watch/cache/`, which is gitignored and so missing in CI. It takes the union across all fingerprints, since the app talks to every server from 10.7 to 12.x and a value from any of them has to render. It fails when no fingerprint defines the enum at all, because a silent skip would look the same as full coverage.

The job table is not gated and cannot be: TMDB job names have no enum, so falling through to the raw `Role` is the design.

## Compile-time key safety: the BSC plugin

`scripts/bsc-plugins/translation-keys.cjs` is a BrighterScript compiler plugin. At build time it reads `locale/custom/en_US.json` and adds a virtual `pkg:/source/translationKeys.bs` to the program:

```brightscript
namespace translationKeys
  const ButtonPlay = "ButtonPlay"
  const ButtonResume = "ButtonResume"
  const LabelEpisodeCountZero = "LabelEpisodeCountZero"
  ' ...one constant per key in en_US.json

  ' Plural base keys — use with translatePlural()
  const LabelEpisodeCount = "LabelEpisodeCount"
end namespace
```

The plural base constants exist for each key whose `Zero`, `One` and `Many` forms are all present, so `translatePlural(translationKeys.LabelEpisodeCount, …)` is checked too.

Code calls `translate(translationKeys.ButtonPlay)`, not `translate("ButtonPlay")`, which gives three things:

- **A misspelled key fails the build** instead of showing the key on screen.
- **The editor completes key names** after `translationKeys.`.
- **A renamed key breaks every stale call site at build time.**

The file is never written to disk (`program.setFile`). In the editor's language server, the plugin watches `en_US.json` with `fs.watch`, because BrighterScript does not check the program again after a JSON edit by itself.

## CI lint: `npm run lint:translations`

`scripts/lint/update-translations.cjs` checks `en_US.json`, the code's key references and every locale file. The full list is in [the dev guide's Checks](../dev/translations.md#checks). Two things it does not check:

- **Key prefixes.** The convention is not enforced.
- **Completeness.** A locale file holds only the keys translated into it, and a missing key falls back to `en_US` at runtime. The script reports average coverage across the locale files and fails nothing on it.

`npm run update-translations` runs it with `--fix`: it removes `en_US` keys no code uses, sorts `en_US.json`, and adds missing locales to `languages.json`. A key in a locale file that `en_US.json` no longer has is a warning.

## Weblate sync

Translations are crowdsourced on a self-hosted Weblate (`translate.jellyrock.app`, project `jellyrock`, component `roku`), which commits to the `weblate` branch. Two workflows move files between that branch and `main`:

| When | Workflow | What moves |
|---|---|---|
| Every push to `main`, except the bot's own | `jellyrock-bot.yml` | `en_US.json` and `languages.json`, from `main` to `weblate`, so translators see new keys |
| Release prep (push to `release-X.Y.Z`) | `release-management.yml`, job `merge-translations` | Every locale file, both ways |

**The `weblate` branch is always far "behind" `main`, and that is expected.** Nothing ever merges `main` into it: both workflows copy files, so `main`'s commits never enter its history and GitHub's behind count only grows. Weblate reads only `locale/`, which the two workflows keep in step; the rest of the branch is old code that nothing builds. Re-cutting the branch from `main` to reset the count would also delete the `Translations-Release` marker the next merge needs (see [The merge rules](#the-merge-rules)).

Release prep, in order:

1. **Lock and flush Weblate.** `scripts/weblate-sync.js lock-and-flush` locks the component and makes Weblate commit and push what it holds, so the branch read next is complete and nothing lands on it mid-merge. It refuses a component that is already locked (by an admin, or by Weblate itself after a repository error), and fails without the `WEBLATE_TOKEN` secret: the push-back in step 5 is only safe under this lock.
2. **Cherry-pick translator commits** (`Translated using Weblate (…)`), each keeping the `Co-authored-by` trailers Weblate wrote for its translators.
3. **Merge key by key, three-way:** `npm run translations:merge -- release` (rules below).
4. **Seed** whatever is still missing from other Jellyfin clients (next section). This comes after the merge, so a translator's work always wins. It is optional: if a source can't be fetched, the release goes ahead without it.
5. **Push the result back to `weblate`:** `npm run translations:merge -- push-back`, merged into the branch's current state, so Weblate receives every seeded or main-side translation and translators don't redo them. Its commit carries a `Translations-Release: X.Y.Z` trailer, which makes it the next run's ancestor.
6. **Pull into Weblate and unlock.** This runs whenever step 1's lock is ours, even after a failure, so a failed release can't leave translators locked out. It never runs otherwise, so it can't undo someone else's lock.

The job also checks the branch, runs `lint:translations` and pushes the release branch before step 5.

**Translator credit** needs nothing extra. Release PRs are squash-merged with the PR body as the message, and GitHub appends a `Co-authored-by` trailer for every author and co-author of the PR's commits, so each cherry-picked translator is credited on `main`. Checked 2026-10-04 on a throwaway repo with the same squash settings, merged both with `gh pr merge --squash` and from the web page.

### The merge rules

Each key is compared with the **ancestor**, the last state the release and the `weblate` branch agreed on:

| On the release (`main`) | In Weblate | Result |
|---|---|---|
| Unchanged | Unchanged | Kept |
| Changed, added or deleted | Unchanged | The release's change |
| Unchanged | Changed, added or deleted | The change made in Weblate |
| Changed | Changed differently | **Weblate wins**, and the run lists it |

Keys no longer in `en_US.json` are dropped, as the Weblate Cleanup add-on does. `en_US.json` itself is never merged: `main` owns it.

The ancestor is the newest push-back commit on `weblate` (step 5) whose release shipped (tag `vX.Y.Z` exists) or is the release in progress. An abandoned release doesn't count: its push-back reached `weblate` but never `main`, so `main` would look as if it had deleted everything that release merged. With no such commit (the first release on this scheme, or a re-cut `weblate` branch), the merge falls back to a two-way union with Weblate winning, warns, and deletions start syncing from the next release.

A three-way merge is the only kind that tells "deleted here" from "added there", which is what lets a change on either side survive. [ADR 0048](../adr/0048-translation-seeding-and-weblate-merge.md) has the history: release prep used to overwrite `main`'s locale files with the copies from Weblate.

### Removing a translation

Delete it, on `main` or in Weblate. The merge carries the deletion to the other side at the next release, and the seed ledger (`locale/seed/seeded.json`) stops the seeder from filling a cell it filled before. To stop one source from seeding a key in a locale, add `exclude: { <locale>: <reason> }` under that source in the key's `keymap.yml` entry. The exclusion is per source, so another source mapped for the key can still fill the cell.

### Weblate token setup

`WEBLATE_TOKEN` is a **project** API token, not a user account, so no bot login is needed. A project admin creates it in the `jellyrock` project's **API access** tab (Weblate docs: **Operations → Users**, then that tab). They add it to a team whose only role is **Manage repository** (the default `VCS` team, if its role matches), which covers commit, push, update and lock. Check it read-only with `WEBLATE_TOKEN=… node scripts/weblate-sync.js check`, then store it with `gh secret set WEBLATE_TOKEN -R jellyrock/jellyrock`.

With the secret unset, release prep stops at step 1 and the error gives these steps. An expired or revoked token also stops it at step 1, with the `HTTP 401` reply from Weblate as the error; renew it the same way.

## Seeding from other Jellyfin clients

`npm run translations:seed` fills missing translations from other open-source Jellyfin clients' community translations: `jellyfin-web`, `jellyfin-androidtv`, `jellyfin-roku`, `jellyfin-android`, Swiftfin, `streamyfin` and the Jellyfin server, in that priority order. The how-to is in [`docs/dev/translations.md`](../dev/translations.md#seeding-translations-from-other-jellyfin-clients). The shape and the constraints:

- **Sources are config, not code** (`locale/seed/sources.yml`): repo, tag pinned to a commit SHA, license, file format, placeholder style, locale-code overrides. A new project is one entry, plus a parser in `scripts/lib/translation-formats.cjs` only when its file format is new.
- **A reviewed map, never English-text matching** (`locale/seed/keymap.yml`). The same English means different things across projects: web's "Idle" is a process priority, and the audio-channel "Channels" and the Live TV "Channels" are different words in French. A source's own translation can also be wrong for its key. Each entry records the English both sides had when it was reviewed, so it stops seeding when either changes. Refused candidates are recorded with a reason.
- **License allowlist: `GPL-2.0-only`, `GPL-2.0-or-later`, `MPL-2.0`.** JellyRock is `GPL-2.0-only`. `MPL-2.0` §1.12 names `GPL-2.0` a Secondary License, so `MPL` text may be combined unless a file is marked "Incompatible With Secondary Licenses", which the seeder refuses. `GPL-3.0` sources (`jellyfin-vue`, `jellyfin-kodi`, `findroid`) can never be added. Every run checks the LICENSE file at the pinned commit against the declared license.
- **Fill only, once per cell.** Every fill is recorded in `locale/seed/seeded.json` (locale, then key, then `source@commit`), and a recorded cell is never filled again, so a removal sticks. The ledger is also the provenance record: the seed commit's `Translation-Source:` lines do not survive a squash merge.
- **Nothing the runtime would show anyway.** It never overwrites. It refuses a different placeholder set, new markup or line breaks, a value equal to the English, and a regional value equal to its base locale's (runtime layering already shows it, and a copy would hide later fixes to the base).
- **No re-casing.** Title Case is an English convention, and case tests misread scripts without letter case (Georgian letters upper-case to a separate all-caps alphabet). A lowercase-first translation in a cased script is still written, and the run's report lists it for review.
- **Runs at every release prep** (step 4 above), so a newly mapped key, or a locale a source adds, fills without anyone remembering to.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md): search by `area` for translation entries.
