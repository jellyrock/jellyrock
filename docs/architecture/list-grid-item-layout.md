---
topic: list-grid-item-layout
related-files:
  - components/subtitles/SubtitlePanel.xml
  - components/ui/rowlist/JRRowList.bs
  - components/ui/rowitem/JRRowItem.bs
  - components/ItemGrid/GridItem.bs
  - components/ItemGrid/BaseGridView.xml
  - components/home/HomeRows.bs
  - source/utils/listTheme.bs
  - source/utils/textureManager.bs
last-reviewed: 2026-10-10
---

# `RowList` and grid item layout, and the focus indicator

How a custom item component (the `itemComponentName` of a `RowList` or `MarkupGrid`) must be laid out so the built-in focus indicator frames the poster and the title below it stays visible. **This trap keeps coming back: read this before you build or change a list or grid item component.**

## The one thing that bites everyone

> **The focus indicator is pinned to the item's poster slot (`rowItemSize` or `itemSize`) only when `rowHeights` is set taller than that slot. Without `rowHeights`, the indicator wraps the item component's whole bounding box, including a title placed below the poster, so it reaches past the image and covers the title.**

The indicator is Roku's built-in 9-patch: the app only recolors it (`focusBitmapBlendColor`) and supplies no bitmap. It is drawn behind the items, since `drawFocusFeedbackOnTop` defaults to false.

## The layout contract

For an item component that shows a poster with a title below it:

1. **`rowItemSize`** is the poster slot, the area the focus indicator frames.
2. **`rowHeights`** (`RowList`) is the slot height plus a title area. Setting it taller than `rowItemSize` is what pins the indicator to the slot and leaves the title outside it. A `MarkupGrid` gets the same from its presenter's `rowHeights` and `itemSize`.

   **One `rowHeights` entry covers every row, but keep `itemSize.y` equal to it anyway.** Roku's [`RowList` reference](https://github.com/rokudev/dev-doc/blob/v2.0/docs/REFERENCES/scenegraph/list-and-grid-nodes/rowlist.md) says rows past the end of the array fall back to `itemSize.y`, unlike `rowItemSize`, `rowLabelOffset` and `rowItemSpacing`, which repeat their last value. Measured 2026-08-09 on an Ultra, it repeats like the others: `rowHeights="[415]"` with `itemSize.y` forced to `200` left rows 2 and 3 at a 455-pixel pitch, not 240. So the app relies on behavior the docs do not promise, and a second `rowHeights` entry would bring the documented fallback back. Keeping the two equal is correct under either reading.
3. **The poster fills the slot.** The two item components do it two ways:
   - `GridItem` places the poster `POSTER_TOP_OFFSET` below the slot's top, so it runs past the slot's bottom and the indicator, drawn behind, shows a clear margin above the image.
   - `JRRowItem` places the poster at the slot's origin, the same size as the slot.
4. **The title sits below the poster**, in the title area `rowHeights` added, outside the indicator: at `POSTER_TOP_OFFSET` plus the poster height plus `TITLE_GAP` in `GridItem`, and at the poster height plus `FOCUS_PADDING` in `JRRowItem`.

## Don't hand-roll focus chrome in a custom row

A `MarkupList` with an `itemComponentName` still draws its own focus indicator. Drawing one inside the row instead is the trap, and it does not look like a bug: the list seems to work until you notice the focus never travels.

> **`drawFocusFeedback` defaults to `true`.** Turning it off means the list draws no indicator, so the row has to. A per-row indicator can only switch on and off, while the list's own indicator glides between rows. That difference is what reads as lag.

The subtitle panel used to set `drawFocusFeedback="false"`, and each row toggled a `filled-rounded.9.png` and `border-6px.9.png` pair. Those are the same two images and the same two theme colors `applyListFocusChrome()` already applies: identical pixels, no animation, two extra posters per row and a second copy of the focus styling.

**Use [`applyListFocusChrome(list)`](../../source/utils/listTheme.bs)** and leave `drawFocusFeedback` alone. Three things follow, all measured on a Stick 4K:

1. **The indicator is drawn about 10 pixels outside the row:** a row 72 tall had a ring 92 tall. With rows touching, its edge lands on the next row's first line of text, so the list needs an `itemSpacing` at least that large. The 9-patch has no padding to read this from; it was measured from a screen capture.
2. **Keep `rowHeight + itemSpacing` divisible by 3.** The UI is designed at 1080 lines and shown at 720, so only an edge on a multiple of 3 lands on a whole 720p line, and the pitch carries the list's origin down each row. See the `PIXEL_GRID` note in `dialogLayout.bs`: it only helps if the absolute origin is on the grid too.
3. **Two focusable lists on one screen? Hide the footprint.** `focusFootprintBitmapUri` draws on a list's focused item while that list does not have focus. A screen with one focusable list never shows it. With two, the idle one shows a permanent `colorBackgroundSecondary` fill, the color that means focused on a `TextButton`. Set it to `pkg:/images/1px-transparent.png`, as `Alpha.bs` does.

## Texture lifecycle: which cells hold a poster

Cells free their poster texture when the user is not about to see it, and load it again when they are. [`textureManager.bs`](../../source/utils/textureManager.bs) keeps the inputs on the list's content root, and each cell ([`JRRowItem`](../../components/ui/rowitem/JRRowItem.bs), [`GridItem`](../../components/ItemGrid/GridItem.bs)) observes them and decides for itself.

**States** (`textureManagerState` on the content root):

| State | Cells do | Set by |
|---|---|---|
| `init` | nothing: layout is still moving, and `renderTracking` changes are noise | `initTextureManager` |
| `active` | apply the row range and column window below | `activateTextureManager` (first content, and every return to the screen) |
| `hidden` | nothing: textures stay loaded so coming back is instant | `hideTextureManager` in `onScreenHidden` |
| `destroyed` | unload, whatever else holds | `destroyTextureManager` in `onDestroy` |

**Rows:** `loadedRowRange = [bufferStart, visibleStart, visibleEnd, bufferEnd]` holds the visible rows plus `TEXTURE_BUFFER_ROWS` (2) on each side. A cell in a buffer row keeps its texture; a cell outside the range follows `renderTracking`.

**Columns:** a window applies only on a `RowList` row with more than `TEXTURE_BUFFER_THRESHOLD` (20) items, and only while that row is visible. The window is exactly 20 columns: the visible slots (`calculateTextureVisibleItemCount`, which counts a partly visible slot) plus the rest of the budget split left and right, the odd item going right. It wraps, because `JRRowList` uses `fixedFocusWrap`, so at column 0 the left half is the row's tail: the item drawn in the `focusXOffset` gap, one Left press away. The geometry is `isColumnInTextureWindow`, and its unit tests assert column sets read off a device, so change the tests only with a new device reading. Every shape loads 20: portrait and square show 7 and buffer 6 left and 7 right; wide shows 4 and buffers 8 and 8.

**The cell pool bounds memory, not the item count.** `RowList` creates cells only around the focus (28 to 30 on a row of 32 or 100 items), and a texture can only live on a cell. A buffer row has no 20-column cap, yet on a 100-item row it held 7 textures across its 8 cells. So counting evictions by items predicts too many: a cell `RowList` reuses for another item takes the new poster without passing through `unloadTexture`, and `unloadsWindow` reads below "items that left the window".

**Three paths clear a poster URI on purpose:**

- `unloadTexture(reason)`: a row-range or window eviction, and the only one the ledger counts.
- `forceUnloadTexture`: teardown.
- `deferTextureLoad`: a cell bound outside its window never requests the image.

After an unload Roku reports the poster's `loadStatus` as `failed`. That is the cleared URI, not a broken image: both load-status observers return early on `isTextureUnloaded`, and `loadsFailed` does not move.

**A failed image clears the URI too, and must not reload.** `showPlaceholder` clears the URI to show the type icon underneath, with the real URL still cached, so by `currentUri <> cachedUri` alone a failed cell looks like an evicted one. `isTextureUnloaded` tells them apart: the three paths above set it and `showPlaceholder` does not, and `shouldReloadTexture` reloads only when it is set. Asking again for a known-broken image would wipe the icon off a cell that is sitting still and then fail again, so a failed image retries only at its next unload or rebind, never on scroll (decision `failed-poster-no-scroll-retry` in [`decisions.md`](../decisions.md)).

## Canonical examples

- [`JRRowItem`](../../components/ui/rowitem/JRRowItem.bs) with [`HomeRows`](../../components/home/HomeRows.bs): `setRowItemSize()` in `HomeRows` sets each row's `rowHeights` to the slot plus a 90-pixel text area (library tiles get the slot only), and `JRRowItem` puts its title `FOCUS_PADDING` below the poster. `SearchRow` and `FavoritesRows` do the same in their `applyRowSizes()`.
- [`GridItem`](../../components/ItemGrid/GridItem.bs) in the genre `RowList` (`genreList` in [`BaseGridView.xml`](../../components/ItemGrid/BaseGridView.xml)): `rowItemSize="[[213, 320]]"` and `rowHeights="[415]"`, with `itemSize="[1702, 415]"` to match. The comment above the list in the markup says why those numbers.
- Roku's [`RowList` sample](https://github.com/rokudev/samples/tree/master/ux%20components/lists%20and%20grids/RowListExample) uses `rowItemSize=[536,308]` with the poster inset to 512×288, another way to keep the indicator off the image.

## Why this doc exists

On 2026-06-03, while moving `GridItem` into the genre `RowList`, the `genreList` set `rowItemSize` but never `rowHeights`. The focus border wrapped the cell's whole bounding box, covering the poster and pushing the title off screen. Several wrong turns (insetting the poster, moving offsets, growing the row) chased the symptom; the fix was one field, `rowHeights`. Earlier sessions hit the same wall. If a focus border reaches too far, or a title disappears on focus, look for a missing or wrong `rowHeights` first.
