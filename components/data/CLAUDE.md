# Rules for `components/data/`

Two related but distinct concerns share this folder:

- **`components/data/jellyfin/*`** — typed `ContentNode` schemas for Jellyfin server data (user, server, items, settings, …). The XML *is* the schema.
- **`components/data/*` (parent)** — a wider mix: typed data nodes (`UserData`, `PublicUserData`, `OptionsData`), stateful managers (`SceneManager`), Task helpers (`GetFiltersTask`), debug nodes (`DebugFlags`).

See [docs/architecture/global-state.md](../../docs/architecture/global-state.md) for which nodes hang off `m.global` and when they're initialized.

## ContentNode XML conventions

- Extend `ContentNode` (`extends="ContentNode"`).
- Declare each field with `<field id="…" type="…" />`. Types: `string`, `integer`, `boolean`, `float`, `node`, `assocarray`, `array`, etc.
- Field declarations omit `value="…"` for fields whose default lives elsewhere (e.g., user settings load defaults from `settings/settings.json` at runtime). Declare inline defaults only for fields without an external source of truth.
- `alwaysNotify="true"` for fields where the observer must fire even when the value didn't change.

## Schema files (`components/data/jellyfin/*`) — keep them data-only

- The Jellyfin schema files should be data-only — fields and their types, no behaviour.
- Population belongs in **the transformer** (`source/data/SessionDataTransformer.bs`, `source/data/JellyfinDataTransformer.bs`).
- Settings-loading orchestration (`SaveDefaults`, `LoadGlobals`, etc.) lives in the **`user.settings` namespace in `source/utils/session.bs`** — called as `user.settings.SaveDefaults()` from `main.bs`. Despite the dotted call syntax, that's a namespaced BrighterScript sub, not a method on the JellyfinUserSettings node.
- The single deliberate exception is **`JellyfinUserSettings.bs`** — it implements the auto-sync settings observer and display/library-settings sync (`enableAutoSync`, `disableAutoSync`, `observeAllSettings`, `onSettingChanged`, `onDisplaySettingsChanged`, plus library-settings sync helpers). The XML interface declares only `enableAutoSync` and `disableAutoSync` as `<function>`; everything else is internal.

## Parent-folder nodes (`components/data/*`) — more permissive

- Typed data nodes here (e.g., `UserData`, `PublicUserData`, `OptionsData`, `OptionsButton`) follow the same data-only convention as the Jellyfin schemas above.
- Stateful manager nodes (`SceneManager`) and Task helpers (`GetFiltersTask`) are NOT data containers — they extend `ContentNode` (or `Task`) for the node-mounting machinery, with substantial behaviour in their backing files. That's intentional and pre-existing.
- When in doubt: if you'd describe what you're building as "the X for the Y" (a manager, a coordinator), put it here. If it's "an X" (a row of data), make it a typed schema.

## DebugFlags is debug-only

- `DebugFlags.xml` is created on `m.global.debug` only in `#if debug` builds. Code paths that read flags are wrapped in `#if debug`. Adding a new flag: see [docs/architecture/debug-tools.md](../../docs/architecture/debug-tools.md).

## What NOT to do

- Don't add behaviour to a Jellyfin schema file (the strict rule above) unless you're following the `JellyfinUserSettings.bs` precedent for a similarly deliberate persistence pattern.
- Don't omit `value="…"` for typed fields by accident — Roku's auto-coercion of empty values can surprise.
- Don't store values in registry whose typed shape isn't reflected in a schema. The XML is what BSC validates against; an undocumented field is an untyped field.
