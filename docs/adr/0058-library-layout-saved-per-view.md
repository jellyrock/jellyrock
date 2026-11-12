# ADR 0058: A library's layout is saved per view

**Status:** Accepted. Partially supersedes [ADR 0056](0056-library-tab-ids-and-layout.md) (what the layout is saved against).
**Date:** 2026-11-12

**related-files**: `source/GridView/libraryTab.bs`, `components/ItemGrid/BaseGridView.bs`, `source/migrations.bs`, `components/data/jellyfin/JellyfinUserSettings.bs`

How a library view is drawn is saved per library and view, as the display setting `display.<libraryId>.layout_<view>` (`libraryLayout.settingKey`). The view goes inside the key's third part because only three-part `display.` keys load. The Layout page setting ([ADR 0057](0057-page-settings-declared-by-screen.md)) shows only on a view its presenter lists more than one layout for, so a pick changes the tab on show and never one the viewer is not looking at. A layout change is not a view change: the sort, the filter, the alpha letter and the voice text stay. `LIBRARY_TAB_MIGRATION_VERSION` writes the per-view key from an old view name; nothing shipped with the per-library key, so it needs no migration of its own. Removing a library deletes every key under its prefix, since a list of key names cannot cover keys that carry a view.

ADR 0056 saved one layout per library and ruled out a layout per tab because only Movies had a choice. That stops holding once other views get layouts: a library saved as presentation would have tabs that cannot draw it, and a pick on one tab would erase another's. A presenter already lists layouts per view. Both of the web client's layouts save the view style per library and tab (read from its source on 2026-11-12), and the Android TV client, which has no tabs, saves its grid choices per folder: the choice belongs to the grid on show.

**Ruled out:** keeping one value per library, for the reasons above; splitting it into a per-library density and a separate on-off for the movie panel, which makes two settings of one choice. The cost accepted: making every tab of a library compact takes one pick per tab.
