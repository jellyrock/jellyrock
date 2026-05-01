# Rules for `source/utils/`

Cross-cutting utilities. See related architecture docs for the *why* of each:

- [translations.md](../../docs/architecture/translations.md) — `translate.bs`, `translateLocale.bs`, `languages.bs`
- [settings.md](../../docs/architecture/settings.md) — `config.bs`, `globals.bs`
- [bootstrap.md](../../docs/architecture/bootstrap.md) — `globals.bs` setup phases

## Translations

- Use `translate(translationKeys.X)` — never hard-code a string ID. The `translationKeys.X` constants are generated at build time by the BSC plugin from `locale/custom/en_US.json`; typos become compile errors.
- `translatePlural(baseKey, count, params)` for Zero/One/Many forms. The `Zero`/`One`/`Many` keys must all exist in `en_US.json`.
- For media stream language codes (audio/subtitle track labels), use the 3-tier resolver in `languages.bs` (alias → translationKey → English fallback). The `lint:language-coverage` script validates the cascade.

## Config / registry

- Read globals: `getSetting(key, default)` (the `JellyRock` registry section).
- Read user setting: `getUserSetting(key)` (the `<userId>` section). For typed reads after login, prefer `m.global.user.settings.<field>` directly — the auto-sync observer persists writes back to registry automatically.
- Write user setting: usually just assign to `m.global.user.settings.<field>` — auto-sync handles persistence.
- Direct registry helpers: `registryRead/Write/Delete(key, section)`, `RegistryReadAll(section)`. Section-scoped; default section is `"JellyRock"` (global).
- Test mode: section names starting with `"test-"` mark test data. The migration runner skips non-test sections when any `test-*` section is present.

## Globals

- `setGlobals()` runs in **Phase 1** (before `m.screen.show()`) — non-node globals. `setGlobalNodes()` runs in **Phase 2** (after) — Task-backed nodes that need a live scene. Both are in `globals.bs`. Don't move work between phases without understanding why; Roku has firmware-specific issues with observers wired before `screen.show()`.
- Theme color override: `applyThemeColorOverrides(userSettings)` writes to `m.global.constants`. Then call `sceneManager.refreshThemeColors()` and `sceneManager.reloadHome()` to re-render. The cascade is manual (see `tech-debt.md`'s `manual-theme-cascade`).

## Common patterns

- **`isValid(x)`** — never compare to `invalid` directly with `=`.
- **`isValidAndNotEmpty(x)`** — common for strings.
- **`LCase(s)`** for case-insensitive type/state comparisons.
- **`stri(n).trim()`** for clean integer→string conversions in user-visible text.

## What NOT to do

- Don't write directly to registry for settings that have a `JellyfinUserSettings` field; write to the field and let auto-sync persist.
- Don't change the test-mode prefix from `"test-"` — migration safety depends on it.
