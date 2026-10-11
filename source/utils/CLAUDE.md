# Rules for `source/utils/`

Cross-cutting utilities. The architecture docs hold the *why* of each:

- [translations.md](../../docs/architecture/translations.md): `translate.bs`, `translateLocale.bs`, `languages.bs`, `mediaDisplayTitle.bs`
- [settings.md](../../docs/architecture/settings.md): `config.bs`, `globals.bs`
- [bootstrap.md](../../docs/architecture/bootstrap.md): the two setup phases in `globals.bs`

## Translations

- Use `translate(translationKeys.X)`, never a hard-coded string ID. The BSC plugin generates the `translationKeys` constants from `locale/custom/en_US.json` at build time, so a typo is a compile error.
- Use `translatePlural(translationKeys.X, count, params)` for Zero/One/Many forms, where `X` is the base key without a suffix. `npm run lint:translations` fails when the `Zero`, `One` or `Many` key is missing from `en_US.json`.
- For media stream language codes (audio and subtitle track labels), use `resolveLanguageName()` in `mediaDisplayTitle.bs`. It normalizes the code through the aliases in `languages.bs`, then tries a translation key, then an English name, then shows the raw code. `npm run lint:language-coverage` checks that the aliases and tiers agree.

## Config and registry

- Read a global setting: `getSetting(key, default)`, from the `JellyRock` registry section (`test-global` while a test user is signed in).
- Read a user setting: `getUserSetting(key)`, from the section named by the user's ID. After sign-in, prefer reading `m.global.user.settings.<field>`.
- Write a user setting: assign to `m.global.user.settings.<field>`. `JellyfinUserSettings` observes every setting field and writes the change to the registry once auto-sync is on.
- Direct registry helpers: `registryRead`, `registryWrite` and `registryDelete(key, section)`, and `RegistryReadAll(section)`. Each needs a section: with none, a read returns `invalid` and a write or delete does nothing.
- Test mode: a section name starting with `test-` marks test data. When any `test-` section exists, the migration runner migrates only `test-` sections.

## Globals

- `setGlobals()` runs before `m.screen.show()` and builds the data nodes. `setGlobalNodes()` runs after it and builds the long-running nodes: the Task launch queue, the API pool and `sceneManager`, among others. Both are in `globals.bs`. Read [bootstrap.md](../../docs/architecture/bootstrap.md#the-two-phase-global-setup) before moving work between them: some nodes can't be created on the main thread before the screen shows.
- Theme color override: `applyThemeColorOverrides(userSettings)` writes `m.global.constants`. Then call `refreshThemeColors` and `reloadHome` on `m.global.sceneManager` through `callFunc` to redraw. Each caller runs this chain by hand (see [`manual-theme-cascade`](../../docs/architecture/tech-debt.md#manual-theme-cascade)).

## Common patterns

- **`isValid(x)`**: never compare to `invalid` with `=`.
- **`isValidAndNotEmpty(x)`**: common for strings.
- **`LCase(s)`** for case-insensitive type and state comparisons.
- **`stri(n).trim()`** to turn an integer into a string for user-visible text.

## What not to do

- Don't write the registry directly for a setting that has a `JellyfinUserSettings` field. Write the field and let auto-sync persist it.
- Don't change the `test-` prefix. Migration safety and the test-mode global section depend on it.
