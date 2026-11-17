# ADR 0061: A library grid's size is a count per row, and every cell is derived

**Status:** Accepted. Partially supersedes [ADR 0056](0056-library-tab-ids-and-layout.md) (the named layouts to come) and [ADR 0058](0058-library-layout-saved-per-view.md) (its ruling out of a density apart from the layout).
**Date:** 2026-11-16

**related-files**: `source/GridView/libraryGrid.bs`, `source/GridView/GridPresenterBase.bs`, `components/ItemGrid/BaseGridView.bs`, `components/ItemGrid/GridItem.bs`

How a library grid looks is three axes, not a list of named looks. Layout is the kind of screen: Grid or Grid with details (ids `grid` and `presentation`, saved per view as ADR 0058 says). Size is how many cells a row holds, 3 to 11, picked by the viewer and saved per library and view as `display.<libraryId>.columns_<view>`; until then a portrait grid draws 7 and a square one 6. Titles is one app-wide on or off setting, `itemGridShowTitles`. Every cell comes from `libraryGrid.cell(shape, columns, textLines)`: a designed width per count, the height from the shape, gaps of at least 18 pixels, so no presenter holds a cell's pixels. A pick of any of the three redraws the grid in place (`BaseGridView.relayoutGrid`): the same items and the same item in focus, nothing fetched again, since none changes the query.

Comfortable, Compact and Posters each bundled a size with a titles choice, so every new variant multiplied the list. Wholphin and Finamp give the count itself, Android TV and Moonfin named steps; named steps were tried here and dropped, because three steps were taste while viewers differ for good reasons (screen size, distance, eyesight, library size). The count is shared by both layouts of a view; the presentation layout raises it to 5 without rewriting it.

**Ruled out:** named layouts (above); three named sizes; an app-wide default count; a titles setting per library; hiding titles on narrow cells (an 11-per-row title stays readable on a 720p Stick, measured 2026-11-16); a reload after a pick, which lost the viewer's place.
