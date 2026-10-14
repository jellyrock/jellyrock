# Rules for `components/data/`

Two related but distinct concerns share this folder:

- **`components/data/jellyfin/*`**: typed `ContentNode` schemas for Jellyfin server data (user, server, items, settings). The XML *is* the schema.
- **`components/data/*` (parent)**: a wider mix. Typed data nodes (`PublicUserData`, `OptionsButton`, `Constants` for `m.global.constants`), nodes with behavior (`SceneManager`, `UserData`), the debug node (`DebugFlags`), and the keyboard layout `CustomAddressKDF.json` that `LanguagePicker` loads.

See [docs/architecture/global-state.md](../../docs/architecture/global-state.md) for which nodes hang off `m.global` and when they're created.

## ContentNode XML conventions

- Extend `ContentNode` (`extends="ContentNode"`).
- Declare each field with `<field id="…" type="…" />`. Types: `string`, `integer`, `boolean`, `float`, `node`, `assocarray`, `array` and the rest Roku allows.
- Leave out `value="…"` for a field whose default lives elsewhere. User settings, for example, take their defaults from `settings/settings.json` at runtime. Declare an inline default only for a field with no other source of truth.
- Use `alwaysNotify="true"` for a field whose observer must fire even when the value didn't change.

## Schema files (`components/data/jellyfin/*`): keep them data-only

- The Jellyfin schema files hold fields and their types, no behavior.
- Population belongs in the transformers: `source/data/JellyfinDataTransformer.bs` for items, and `source/data/SessionDataTransformer.bs` for the user's server-side Configuration and Policy (called by `user.Login()`).
- Settings loading (`SaveDefaults`, `LoadGlobals` and the rest) lives in the `user.settings` namespace in `source/utils/session.bs`, called as `user.settings.SaveDefaults()` from `main.bs`. Despite the dotted call, that is a namespaced BrighterScript sub, not a method on the `JellyfinUserSettings` node.
- The one exception is `JellyfinUserSettings.bs`. It holds the auto-sync settings observer and the display and library settings sync (`enableAutoSync`, `disableAutoSync`, `onSettingChanged`, `onDisplaySettingsChanged` and the library-settings helpers). The XML interface declares only `enableAutoSync` and `disableAutoSync` as `<function>`; the rest is internal.

## Parent-folder nodes (`components/data/*`): more permissive

- Typed data nodes here (`PublicUserData`, `OptionsButton`) follow the same data-only convention as the Jellyfin schemas.
- `SceneManager` and `UserData` are not plain data containers. They extend `ContentNode` and carry behavior in their backing files: `SceneManager` restyles and reloads the scene, and `UserData` parses its `json` field and saves itself to the registry.
- When in doubt: if you'd describe what you're building as "the X for the Y" (a manager, a coordinator), put it here. If it's "an X" (a row of data), make it a typed schema.

## `DebugFlags` is debug-only

- `setGlobalNodes()` creates `DebugFlags` on `m.global.debug` only in `#if debug` builds, and every line that reads a flag sits inside `#if debug`. To add a flag, follow [docs/dev/debug-flags.md](../../docs/dev/debug-flags.md#add-a-flag).

## What not to do

- Don't add behavior to a Jellyfin schema file unless you're following the `JellyfinUserSettings.bs` precedent for a similar persistence pattern.
- Don't leave out `value="…"` by accident. A field without one starts at its type's default (0, an empty string, false), which can't be told from a real value: `resolveHomeRowLimit()` in `config.bs` has to guard an unset integer setting reading 0.
- Don't store a value in the registry whose shape no schema declares. The XML is the one place a reader finds every field and its type. BSC doesn't check assignments against it ([global-state.md](../../docs/architecture/global-state.md#why-typed-nodes)), so an undeclared field is one nobody can find.
