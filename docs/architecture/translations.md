---
topic: translations
related-files:
  - source/utils/translate.bs
  - source/utils/translateLocale.bs
  - scripts/bsc-plugins/translation-keys.cjs
  - scripts/lint/update-translations.cjs
  - scripts/lint/language-coverage.cjs
  - locale/languages.json
last-reviewed: 2026-06-07
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

### CI lint — `npm run lint:language-coverage`

`scripts/lint/language-coverage.cjs` catches three classes of silent regression in the resolver:

1. An alias maps `tib` → `bo` but `bo` is missing from tiers 1 and 2 — user sees raw `bo`.
2. A new `LanguageX` key is added to tier 1 but `xxx` → `x` alias coverage is forgotten — ffmpeg-tagged audio in that language falls through to the English fallback in every UI locale, **including the user's own**.
3. An English fallback exists for a code that's already covered by a translation key — wasted maintenance, inconsistent output.

These all pass type-check and unit tests but produce silent gaps for non-English users — the lint is the only catch.

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
