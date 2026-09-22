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
last-reviewed: 2026-09-22
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

`scripts/lint/language-coverage.cjs` catches three classes of silent regression in the resolver:

1. An alias maps `tib` → `bo` but `bo` is missing from tiers 1 and 2 — user sees raw `bo`.
2. A new `LanguageX` key is added to tier 1 but `xxx` → `x` alias coverage is forgotten — ffmpeg-tagged audio in that language falls through to the English fallback in every UI locale, **including the user's own**.
3. An English fallback exists for a code that's already covered by a translation key — wasted maintenance, inconsistent output.
4. The matching-only map overlaps the display alias map, or holds something other than a 3-letter → 2-letter code — one of the two copies is dead, and they can silently disagree.

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

**A second `PersonKind` table in the same file is NOT gated.** `creditRowKinds()` — the details
screen's credits row, decision [`credit-row-kinds-in-people`](../decisions.md) — names
`PersonKind` values too, but the gate locates its tables by FUNCTION NAME, so that one is invisible
to it. Nothing is parsed wrongly (it is an array of AAs, not an AA), but an upstream rename or removal of
`Creator` would silently empty the "Created by" line with every check green — the same shape as the
failure below, in the one table the gate does not read. Tracked as an open followup in
[progress.md](../progress.md).

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

Translations are crowdsourced via Weblate (an open-source translation platform). The CI workflow `jellyrock-bot.yml` runs on every push to `main` and:

- Removes orphaned keys (keys that exist in non-English files but not in `en_US.json`)
- Sorts all locale files
- Pushes changes back to Weblate (and pulls translator updates back into the repo)

So the developer-side workflow is just: edit `en_US.json`, the bot keeps everything else in sync, and translators do their work in Weblate.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for translation entries.
