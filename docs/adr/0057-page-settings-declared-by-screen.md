# ADR 0057: Page settings are declared by a screen and presented by the scene

**Status:** Accepted
**Date:** 2026-11-12

**related-files**: `components/JRScreen.bs`, `components/JRScreen.xml`, `components/JRScene.bs`, `components/JROverhang.bs`, `source/utils/pageSettings.bs`, `source/utils/iconBarNav.bs`, `source/utils/dialogLayout.bs`, `components/ItemGrid/BaseGridView.bs`, `docs/architecture/navigation.md`

A page setting is one whose value belongs to the screen on show, such as how one library view is drawn. It is offered on that screen only, from the overhang's settings icon, and never in the Settings screen, which has no library to apply it to. An app-wide setting lives in Settings only, so no setting has two homes. A screen declares its page settings and nothing more: `JRScreen.pageSettingsEntries()` returns `{ id, title, options, selected }` per setting, asked at the press, and `onPageSettingChanged(id, value)` saves and applies a pick. The scene presents them through one function, `JRScene.openPageMenu()`: a menu that hangs under the icon with the page's entries above **All settings**, then a list of the chosen entry's options, with Back there returning to the menu on that entry's row. A screen that declares none opens Settings in one press, as before. The menu hangs below the icon because `computeDialogLayout` now derives the direction from the anchor, as it already derived the side. Past about three entries a menu hanging off an icon gets long, and the entries move into one Page settings dialog behind a single row.

Any screen adopts this by writing two functions, with no dialog code and no knowledge of where the icon is, so every page's menu, picker and Back rule are the same one. The contract fits a setting picked from a list; a setting that ticks several values needs one more flag on the entry when the first one arrives.

**Ruled out:** each screen showing its own menu from `onOverhangAction`, which needs the icon's position (the overhang is the scene's) and a copy of the scene's steps into Settings, and would leave Back handled differently per screen; a `screens` tag on `settings.json` with a filtered Settings screen, which shows a per-library value on a screen with no library; a centered list as the SyncPlay icon opens, which covers the grid the setting is about.
