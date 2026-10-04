---
topic: translations
related-files:
  - source/utils/translate.bs
  - source/utils/translateLocale.bs
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
  - .github/workflows/release-management.yml
last-reviewed: 2026-10-04
---

# Translations (i18n)

JellyRock's custom JSON translation system, the locale fallback cascade, and the BSC plugin that gives compile-time key safety.

## Why a custom system

Roku ships a built-in `tr()` function that reads from a fixed XML format. JellyRock replaces it with a custom JSON-based system because:

- **Speed** — translations are loaded once into a flat `roAssociativeArray` for O(1) lookups. `tr()` parses the XML on every call.
- **Fallback control** — JellyRock layers regional locales over base languages (e.g. `fr_CA` over `fr`) and falls back to en_US for any missing key, so users always see something.
- **Build-time validation** — a custom BSC plugin generates `translationKeys` constants from `en_US.json` at compile time. Typos become build errors.
- **Community workflow** — translations live in plain JSON files compatible with Weblate, the open-source translation platform.

Many locale files live under `locale/custom/*.json` covering a wide range of languages.

## File layout

```text
locale/
├── custom/                    ← one JSON file per locale
│   ├── en_US.json             ← always loaded as fallback
│   ├── fr.json
│   ├── fr_CA.json             ← regional overlay on fr.json
│   ├── zh.json
│   ├── zh_Hans.json           ← Simplified Chinese (script code, not region)
│   ├── zh_Hant.json           ← Traditional Chinese
│   ├── zh_Hant_HK.json        ← Hong Kong Traditional (3-layer over zh + zh_Hant)
│   └── ...
└── languages.json             ← list of supported languages for the in-app picker

source/utils/
├── translate.bs               ← translate(), translatePlural(), loadTranslations(), loadLocaleFile()
└── translateLocale.bs         ← resolveTranslationLocale() — the fallback cascade
                                  separated because it imports config.bs (only available in source/ scope)

scripts/
└── bsc-plugin-translation-keys.cjs   ← BSC plugin: generates pkg:/source/translationKeys.bs
                                        from en_US.json at build time
```

`languages.json` is a hand-maintained list with `{code, name, nativeName}` per entry. The first entry has `code: ""` and `name: "Automatic"`, meaning "use the device locale".

## Lookup chain

Two `roAssociativeArray` objects live on `m.global` for the lifetime of the app:

- **`m.global.translations`** — the active locale (or en_US if no locale was selected)
- **`m.global.translationsFallback`** — always en_US

If the active locale is en_US, both reference the same AA (no double memory).

`translate(key, params)` tries each in order:

```brightscript
function translate(key as string, params = invalid as object) as string
  if key = invalid or key = "" then return ""

  value = m.global.translations[key]                ' 1. active locale
  if value = invalid
    value = m.global.translationsFallback[key]      ' 2. en_US fallback
  end if
  if value = invalid
    return key                                       ' 3. key itself (visible during dev)
  end if

  ' Substitute indexed placeholders {0}, {1}, etc.
  if params <> invalid and type(params) = "roArray" and params.Count() > 0
    for i = 0 to params.Count() - 1
      value = value.Replace("{" + i.toStr() + "}", params[i])
    end for
  end if

  return value
end function
```

Returning the key itself when nothing is found is intentional — during development, an untranslated string shows up as `LabelEpisodeCount` in the UI, immediately visible.

## Plurals — `translatePlural`

Uses a Zero/One/Many suffix convention:

```brightscript
function translatePlural(baseKey, count, params) as string
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

So a `LabelEpisodeCount` translation needs three keys in en_US.json: `LabelEpisodeCountZero`, `LabelEpisodeCountOne`, `LabelEpisodeCountMany`. The convention is intentionally simpler than full Unicode CLDR plural rules — sufficient for English-speaking developers, may need refinement for languages with more plural forms (Russian, Polish, Arabic).

Usage:

```brightscript
translate(translationKeys.ButtonPlay)
translate(translationKeys.MessageCouldNotReachServer, [serverUrl])
translatePlural(translationKeys.LabelEpisodeCount, count, [stri(count).trim()])
```

## Key naming convention

Keys are PascalCase with a category prefix:

| Prefix | For |
|---|---|
| `Button*` | Button labels (`ButtonPlay`, `ButtonResume`) |
| `Label*` | UI labels and headings (`LabelEpisodeCount`, `LabelSelectAudio`) |
| `Message*` | Longer descriptive text (`MessageVideoStartsIn`, `MessageAreYouSureYouWantTo`) |
| `Error*` | Error messages (`ErrorImageTypeNotSupported`) |
| `Setting*` | Setting titles and descriptions |
| `Tab*` | Tab labels |
| `Header*` | Section headers |
| `Tooltip*` | Tooltip text |

The convention is enforced by `npm run lint:translations` (see CI section below).

## Locale loading

`loadTranslations(locale)` is called from `Main()` (with the device-resolved locale) and again after login (with the user-resolved locale). It:

1. Loads `en_US.json` into the fallback AA.
2. If `locale = "en_US"`, makes the active AA the same reference (no copy).
3. Otherwise, calls `loadLocaleFile(locale)` — which handles regional and Chinese layering.
4. Sets `m.global.translations`, `m.global.translationsFallback`, `m.global.translationLocale` atomically via `setFields`.

### Regional layering — `loadLocaleFile`

For a locale like `fr_CA`:

1. Load `fr.json` into a base AA.
2. Load `fr_CA.json` into a regional AA.
3. `baseAA.Append(regionalAA)` — regional values overwrite base values where they conflict.
4. Return the merged AA.

This means `fr_CA` users see Canadian French where translators provided it, falling back to base French elsewhere, and falling back to English in the active-translate function if neither has a key.

### Chinese script layering — `loadChineseLocaleFile`

Chinese is special-cased because it uses script codes (Hans = Simplified, Hant = Traditional) rather than region codes:

```text
zh_Hans:    zh.json → zh_Hans.json    (2 layers)
zh_Hant:    zh.json → zh_Hant.json    (2 layers)
zh_Hant_HK: zh.json → zh_Hant.json → zh_Hant_HK.json  (3 layers)
```

The layering means a Hong Kong user gets HK-specific translations where available, falls back to Traditional Chinese, then to base Chinese, then to English.

## Locale resolution cascade — `translateLocale.bs`

`resolveTranslationLocale(isPostLogin, serverLanguage)` resolves which locale to use:

1. **User setting** (post-login only) — `getUserSetting("translationLocale")`. If the user picked a language explicitly, use it.
2. **Server language** (post-login only) — Jellyfin server `CustomPrefs.language`. Normalized via `normalizeLocaleCode()` because Jellyfin may send `zh-CN`, `pt-BR` (dashes), etc.
3. **Global sign-in language** (pre-login only) — `getSetting("globalTranslationLocale")`, the device-wide twin of the per-user `translationLocale` (a `global*` setting, so it lives in the `JellyRock` registry section). Read via `getSetting` (not `getUserSetting`) so it resolves **with no signed-in user** — this is what localizes the pre-login server-select / user-select screens. **Deliberately skipped post-login:** a signed-in user's session is governed by their own setting / server pref / device locale, so a home screen never inherits the device-wide sign-in default.
4. **Roku device locale** — `m.global.device.locale`. Mapped by `mapRokuLocaleToTranslationLocale()` which special-cases Chinese (Roku sends `zh_CN` → we use `zh_Hans`).
5. **Hardcoded fallback** — `"en_US"`.

Pre-login, only steps 3–5 run (no user context, so 1–2 are skipped) — `globalTranslationLocale` is the only lever that localizes the sign-in screens. Post-login, steps 1, 2, 4, 5 run and step 3 is skipped, so post-login resolution is **identical to the behavior before `globalTranslationLocale` existed** (the global sign-in default never reaches a signed-in session). The pre-login locale is resolved at the `appStart` login-flow entry in `main.bs` — reached both at cold start AND on re-entry from Sign Out / Change Server / Change User (which re-enter the login flow in place via `reenterLogin`) — so a changed `globalTranslationLocale` takes effect on the next sign-in **without an app restart**; a single resolution covers both the server-select and user-select screens, and the next reload is at `user.Login()`.

## Track language name resolution — `source/utils/languages.bs`

A separate (and structurally distinct) localization concern: media stream language codes — what Jellyfin sends as `MediaStream.Language` for an audio or subtitle track — need to be displayed as the user's localized language name in the `TrackDropdown` cluster, OSD menus, and `ItemDetails`.

The codes are messy: ffmpeg/Jellyfin pass through whatever the container says, so the same language can arrive as ISO 639-2/T (`fra`), 639-2/B (`fre`), or 639-1 (`fr`). `languages.bs` resolves these via a **3-tier cascade**:

1. **Alias** — `mediaLanguageAliases()` maps 3-letter codes (`fra`, `fre`) to a canonical 2-letter base (`fr`).
2. **Translation key** — `languageTranslationKeys()` maps the base code to a `LanguageX` translation key (`fr` → `LanguageFr`), which goes through `translate()` and renders in the user's UI locale.
3. **English fallback** — `languageEnglishFallbacks()` covers ISO 639-2 codes the app doesn't have a UI translation for (e.g., `lat` Latin, `swa` Swahili). These display in English in any UI locale — translating thousands of less-common language names into every UI locale wasn't worth the maintenance cost.

Track names tagged `und` ("undetermined") and `zxx` ("no linguistic content") are intentionally omitted from labels — there's nothing meaningful to localize.

### Matching codes across forms — `languageBaseCode()` / `languagesMatch()`

Track *selection* needs the same normalization for a different reason: a preference or an item's `OriginalLanguage` (ISO 639-1, `ko`) has to find a track tagged in another form (`kor`). `languageBaseCode()` reduces a code to one form through `mediaLanguageAliases()` and then `mediaLanguageMatchAliases()`, a second map holding only the ISO 639-2 codes the first leaves out.

The two maps are kept apart on purpose. `mediaLanguageAliases()` covers only UI locales, and display depends on that gap: tier 3 is keyed by the 3-letter code, so aliasing `swa` → `sw` there would show Swahili as the raw `swa`. The matching map can therefore cover every language without touching labels. Which codes count as a match for a given track list — exact code first, same language only as a fallback — is selection policy, and lives with it in `streamSelection.bs` (`matchingLanguageCodes()`).

### CI lint — `npm run lint:language-coverage`

`scripts/lint/language-coverage.cjs` catches several classes of silent regression in the resolver and in the person-label tables:

1. An alias maps `tib` → `bo` but `bo` is missing from tiers 1 and 2 — user sees raw `bo`.
2. A new `LanguageX` key is added to tier 1 but `xxx` → `x` alias coverage is forgotten — ffmpeg-tagged audio in that language falls through to the English fallback in every UI locale, **including the user's own**.
3. An English fallback exists for a code that's already covered by a translation key — wasted maintenance, inconsistent output.
4. The matching-only map overlaps the display alias map, or holds something other than a 3-letter → 2-letter code — one of the two copies is dead, and they can silently disagree.
5. A `PersonKind` value has no label row, or a credit row names a kind no supported server sends — see Person role labels below.

These all pass type-check and unit tests but produce silent gaps for non-English users — the lint is the only catch.

## Person role labels — `source/utils/people.bs`

The third localization concern, and structurally a sibling of the language resolver above:
`BaseItemPerson.Type` (a `PersonKind` enum value) and `.Role` (a TMDB job title, or an actor's
character) arrive as raw English and are rendered as the Cast & Crew card's subtitle.

They have to be resolved **client-side, on every server version**. Jellyfin 12.0 added
per-request localization via the `Accept-Language` header ([jellyfin#16488](https://github.com/jellyfin/jellyfin/pull/16488)),
but it covers only the server's own resource strings — neither `PersonKind` values nor TMDB job
names are among them, so no server will ever send these translated.

`personCreditLabel()` follows `jellyfin-web`'s `getPeopleRoleOrTypeLabel` rule:

1. **Character** — an `Actor` or `GuestStar` with a `Role` renders `LabelPersonRoleAs` ("as {0}").
2. **Type** — no `Role`, or a `Role` that merely restates the `Type`, renders the `LabelPersonKindX`
   key for that enum value, or **nothing at all** when `unlabeledPersonKinds()` covers it. `Unknown`
   is the only such kind today: it is the value the enum serializes by default, so it means "the server did
   not say", which must read the same as no type at all rather than as the literal word. (`jellyfin-web`
   translates it instead — a deliberate divergence.) A kind in neither table passes through verbatim,
   which the gate below exists to stop.
3. **Job** — anything else renders the `Role`, through `LabelPersonJobX` for the jobs we carry a
   string for (`Screenplay`, `Novel` — the two the server files under `Writer`), and verbatim
   otherwise. An untranslated real job beats a translated generic one, which is also what web does.

**The cache is keyed on the translation KEY, not on the credit.** That is the load-bearing detail:
this resolver runs on a Task thread (`LoadExtrasRowsTask`), where each `translate()` reads
`m.global.translations` — one rendezvous at ~93 µs against ~2 µs from the render thread, plus a
second read of `m.global.translationsFallback` only when the key misses, which for `en_US` it never
does (see
[async.md](async.md#crossing-the-thread-boundary-costs-a-rendezvous--budget-crossings-not-bytes)).
An actor's label differs per character, so a credit-keyed cache would miss on every actor and leave
a large cast making one `translate()` per person. Resolving `"as {0}"` once and substituting the
character thread-locally bounds a whole cast to at most one call per distinct key.

### Coverage is gated, not remembered

The kind table is **closed** — it is keyed off a server enum — so completeness is a checkable
property, and `npm run lint:language-coverage` checks it: every `PersonKind` value in the committed
[spec fingerprints](spec-fingerprints/) must appear in either `personKindTranslationKeys()` or
`unlabeledPersonKinds()`, the two must be disjoint, and neither may carry a row for a value no
supported server sends.

**The second `PersonKind` table in the same file is gated too, and it needed its own parser.**
`creditRowKinds()` — the details screen's credits row, decision
[`credit-row-kinds-in-people`](../decisions.md) — names `PersonKind` values as well, but it is
ORDERED (the credit lines render in array order), so it is an array of AAs rather than an AA. The
gate finds its tables by FUNCTION NAME *and* parses an AA, so for a while this one was invisible to
it: nothing was parsed wrongly, but an upstream rename or removal of `Creator` would have silently
emptied the "Created by" line with every check green. `parseAAArray()` reads the ordered shape, and
the check holds every named kind to the committed fingerprints' enum and every `messageKey` to
`en_US.json`.

That parser distinguishes **absence from failure**, which is the whole reason the gap could exist
unnoticed. A missing function, a missing array literal, an entry missing either field, and a literal
holding content it reads no entries from are all loud; only a provably empty `[]` is quiet. Keying
that "is it empty?" test on brace shape would have let a re-authoring to bare strings parse to zero
entries and pass, so it keys on whether the literal holds any content at all. Without the split, a shape change to
the table would disable the check silently — which is exactly how the table escaped the gate to
begin with.

**This gate replaced a claim that was false.** The section used to argue no lint was needed because
"a missing entry is a compile error (the key would not exist in `translationKeys`)". It is not. The
compiler catches a *typo in a key that is in the map*; a value with **no row at all** has no
expression to fail on. Nine of the twenty-six values shipped that way, rendering raw English, and
nothing caught it — including a review and a full on-device test run. The count is deliberately not
written down here: `lint:language-coverage` prints it, and a number in prose would only rot.

The gate reads the fingerprints rather than `.api-watch/cache/`, because the cache is gitignored and
so does not exist in CI. It takes the **union** across fingerprints, not the newest, since the app
talks to 10.7 → 12.x simultaneously and a value on any supported line has to render. It fails loudly
when no fingerprint defines the enum at all — a silent skip would be indistinguishable from full
coverage, which is the exact failure being prevented.

The **job** table is not gated and cannot be: TMDB job strings are an open-ended space with no enum,
so its fall-through to the raw `Role` is the design rather than a gap.

## Compile-time key safety — the BSC plugin

`scripts/bsc-plugins/translation-keys.cjs` is a custom BrighterScript compiler plugin that generates a virtual `pkg:/source/translationKeys.bs` file at build time from `locale/custom/en_US.json`. The generated file looks like:

```brightscript
namespace translationKeys
  const ButtonPlay = "ButtonPlay"
  const ButtonResume = "ButtonResume"
  const LabelEpisodeCountZero = "LabelEpisodeCountZero"
  ' ...one constant per key in en_US.json
end namespace
```

Application code calls `translate(translationKeys.ButtonPlay)` instead of `translate("ButtonPlay")`. Benefits:

- **Typo detection** — `translate(translationKeys.BtuonPlay)` is a compile error, not a silent runtime failure.
- **IDE autocomplete** — typing `translationKeys.` shows the full list.
- **Refactoring safety** — renaming a key in `en_US.json` regenerates the constants; missed call sites become build errors.

The plugin uses `fs.watch` to detect `en_US.json` edits in the language server, because BrighterScript's `Program.setFile` doesn't trigger revalidation on JSON edits by default.

The generated file is virtual (`program.setFile`) — never written to disk. The build artifact is what gets shipped.

## CI lint — `npm run lint:translations`

`scripts/lint/update-translations.cjs` runs in lint and CI modes. It enforces:

- **Sort order** — keys in `en_US.json` must be alphabetically sorted (canonical).
- **Completeness** — every other locale file must have the same keys as en_US (or empty values for missing translations — but the keys must exist).
- **Placeholder parity** — if `en_US` says `"Hello {0}, you have {1} items"`, every locale must have the same `{0}` and `{1}` placeholders.
- **Coverage** — count untranslated strings per locale (reported, not enforced).

`npm run update-translations` (with `--fix`) auto-fixes sortable issues and removes orphaned keys.

## Weblate sync

Translations are crowdsourced on a self-hosted Weblate (`translate.jellyrock.app`, project `jellyrock`, component `roku`), which commits to the `weblate` branch. Two workflows move files between that branch and `main`:

| When | Workflow | What moves |
|---|---|---|
| every push to `main` | `jellyrock-bot.yml` | `en_US.json` and `languages.json`, `main` → `weblate`, so translators see new keys |
| release prep (push to `release-X.Y.Z`) | `release-management.yml` → `merge-translations` | every locale file, both ways |

**The `weblate` branch is always far "behind" `main`, and that is expected.** Nothing ever merges `main` into it: both workflows copy files, so `main`'s code commits never enter its history and GitHub's behind count only grows. Weblate reads only `locale/`, and that is what the two workflows keep in step; the rest of the branch is stale code that nothing builds. Re-cutting the branch from `main` to reset the count would also delete the `Translations-Release` marker the next merge needs (see [The merge rules](#the-merge-rules)).

Release prep, in order:

1. **Lock and flush Weblate** — `scripts/weblate-sync.js lock-and-flush` locks the component and makes Weblate commit and push what it holds, so the branch read next is complete and nothing lands on it mid-merge. It refuses a component that is already locked (by an admin, or by Weblate itself after a repository error), and fails without the `WEBLATE_TOKEN` secret: the push-back in step 5 is only safe under this lock.
2. **Cherry-pick translator commits** (`Translated using Weblate (…)`), each keeping the `Co-authored-by` trailers Weblate wrote for its translators.
3. **Merge key by key, three-way** — `npm run translations:merge -- release` (rules below).
4. **Seed** whatever is still missing from other Jellyfin clients (next section). After the merge, so a translator's work always comes first. Optional: if a source can't be fetched, the release goes ahead without it.
5. **Push the result back to `weblate`** — `npm run translations:merge -- push-back`, merged into the branch's *current* state, so Weblate receives every seeded or main-side translation and translators don't redo them. Its commit carries a `Translations-Release: X.Y.Z` trailer, which makes it the next run's ancestor.
6. **Pull into Weblate and unlock** — runs whenever step 1's lock is ours, even after a failure, so a failed release can't leave translators locked out. It never runs otherwise, so it can't undo someone else's lock.

**Translator credit** needs nothing extra. Release PRs are squash-merged with the PR body as the message, and GitHub appends a `Co-authored-by` trailer for every author and co-author of the PR's commits, so each cherry-picked translator is credited on `main`. Checked 2026-10-04 on a throwaway repo with the same squash settings, merged both with `gh pr merge --squash` and from the web page.

### The merge rules

Each key is compared with the **ancestor**, the last state the release and the `weblate` branch agreed on:

| On the release (`main`) | In Weblate | Result |
|---|---|---|
| unchanged | unchanged | kept |
| changed, added or deleted | unchanged | the release's change |
| unchanged | changed, added or deleted | the change made in Weblate |
| changed | changed differently | **Weblate wins**, and the run lists it |

Keys no longer in `en_US.json` are dropped, as the Weblate Cleanup add-on does; `en_US.json` itself is never merged (main owns it).

The ancestor is the newest push-back commit on `weblate` (step 5) whose release shipped (tag `vX.Y.Z` exists) or is the release in progress. An abandoned release doesn't count: its push-back reached `weblate` but never `main`, so `main` would look as if it had deleted everything that release merged. With no such commit (the first release on this scheme, or a re-cut `weblate` branch), the merge falls back to the two-way union with Weblate winning, warns, and deletions start syncing from the next release.

**Why three-way.** Release prep used to run `git checkout origin/weblate -- locale/custom/`, and nothing sent main's locale files to `weblate`, so the `weblate` branch owned every non-English file and anything added on main was silently reverted at the next release. (The #531 CLDR seed survived only because the `weblate` branch happened to be re-cut from main right after it merged.) A two-way merge fixes additions but can't tell "deleted here" from "added there": a removed translation always came back, and a fix made on main lost to the older value in Weblate. Comparing both sides with the ancestor settles each key.

### Removing a translation

Delete it, on `main` or in Weblate. The merge carries the deletion to the other side at the next release, and the seed ledger (`locale/seed/seeded.json`) stops the seeder from filling a cell it filled before. To stop a key from ever being seeded in a locale, add `exclude: { <locale>: <reason> }` to its `keymap.yml` entry.

### Weblate token setup

`WEBLATE_TOKEN` is a **project** API token, not a user account, so no bot login is needed. A project admin creates it in the `jellyrock` project's **API access** tab (Weblate docs: **Operations → Users**, then that tab) and adds it to a team whose only role is **Manage repository** (the default `VCS` team, if its role matches), which covers commit, push, update and lock. Check it read-only with `WEBLATE_TOKEN=… node scripts/weblate-sync.js check`, then store it with `gh secret set WEBLATE_TOKEN -R jellyrock/jellyrock`. If it expires, release prep stops at step 1 with these steps in the error.

## Seeding from other Jellyfin clients

`npm run translations:seed` fills missing translations from other open-source Jellyfin clients' community translations — `jellyfin-web`, `jellyfin-androidtv`, `jellyfin-roku`, `jellyfin-android`, Swiftfin, `streamyfin` and the Jellyfin server, in that priority order. The how-to is in [`docs/dev/translations.md`](../dev/translations.md#seeding-translations-from-other-jellyfin-clients); the shape and the constraints:

- **Sources are config, not code** (`locale/seed/sources.yml`): repo, tag pinned to a commit SHA, license, file format, placeholder style, locale-code overrides. A new project is one entry, plus a parser in `scripts/lib/translation-formats.cjs` only when its file format is new.
- **A reviewed map, never English-text matching** (`locale/seed/keymap.yml`). The same English means different things across projects — web's "Idle" is a process priority; the audio-channel "Channels" and the Live TV "Channels" are different words in French — and a source's own translation can be wrong for its key. Each entry records the English both sides had when it was reviewed, so it stops seeding when either changes; refused candidates are recorded with a reason.
- **License allowlist: `GPL-2.0-only`, `GPL-2.0-or-later`, `MPL-2.0`.** JellyRock is `GPL-2.0-only`. `MPL-2.0` §1.12 names `GPL-2.0` a Secondary License, so `MPL` text may be combined unless a file is marked "Incompatible With Secondary Licenses", which the seeder refuses. `GPL-3.0` sources (`jellyfin-vue`, `jellyfin-kodi`, `findroid`) can never be added. The LICENSE file at the pinned commit is checked against the declared license on every fetch.
- **Fill only, once per cell.** Every fill is recorded in `locale/seed/seeded.json` (locale → key → `source@commit`), and a recorded cell is never filled again, so a removal sticks. The ledger is also the provenance record: the seed commit's `Translation-Source:` lines do not survive a squash merge.
- **Nothing the runtime would show anyway.** It never overwrites; it refuses a different placeholder set, new markup or line breaks, a value equal to the English, and a regional value equal to its base locale's (runtime layering already shows it, and a copy would shadow later fixes to the base).
- **No re-casing.** Title Case is an English convention, and case tests misread unicameral scripts (Georgian letters upper-case to a separate all-caps alphabet). A lowercase-first translation in a cased script is flagged in the dry run for review instead.
- **Runs at every release prep** (step 4 above), so a newly mapped key, or a locale a source adds, fills without anyone remembering to.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for translation entries.
