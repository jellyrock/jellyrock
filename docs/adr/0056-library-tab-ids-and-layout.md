# ADR 0056: Library tabs have JellyRock's own ids, and layout is a setting of its own

**Status:** Accepted
**Partially superseded by:** [ADR 0058](0058-library-layout-saved-per-view.md) (the layout is saved per view, not per library)
**Date:** 2026-11-05

**related-files**: `source/GridView/libraryTab.bs`, `source/GridView/GridPresenterBase.bs`, `components/ItemGrid/BaseGridView.bs`, `source/migrations.bs`

A library's views are tabs, and each tab has a JellyRock id (`movies`, `shows`, `networks`, `studios`, `albums`, `albumartists`, `artists`, `genres`, `collections`, `channels`, `guide`, `photos`) named for what it shows. The ids are the app's own, so a tab the web client lacks (a History tab, say) is added like any other. Most match the web client's `LibraryTab` ids where the web has the same tab, because those names read well. A value read from the server's display preferences (the web's `landing-<libraryId>` default tab, its per-tab sort) is translated into these ids where it is read. A rename on the web side then changes that one table, never a setting stored on a Roku. Presenters list their tabs in the web's order where the web has the same tabs.

How a tab is drawn is a second axis, the per-library `layout` display setting (`comfortable` for the poster grid, `presentation` for the movie panel; `compact` and `posters` to come), passed to the presenters beside the view. The old view names mixed the two (`Movies` was the presentation panel, `MoviesGrid` the grid), which would have doubled every later per-tab setting. The layout is per library, so a library left in presentation still draws Studios in its own grid. `LIBRARY_TAB_MIGRATION_VERSION` rewrites each saved `landing` and writes the layout an old name implied. `libraryTab.isKnown` is case-sensitive, and every id is lowercase: the legacy `Movies` folds to `movies`, and exact case is what keeps the migration idempotent on sideloaded builds, which rerun it at every launch. Until the options dialog is retired, its View list shows a tab once per layout (`optionsViewList`).

**Ruled out:** adopting the web's ids as the vocabulary, which would tie stored settings to another client's naming and leave no room for tabs only JellyRock has; a prefix on ids only JellyRock uses, which would give one tab two ids if the web later adds it; layout per tab, since no tab but Movies has a choice; carrying layout inside the view id.
