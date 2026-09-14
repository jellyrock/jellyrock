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
last-reviewed: 2026-09-14
---

# `RowList` / grid item layout & the focus indicator

How a custom item component (the `itemComponentName` of a `RowList` / `MarkupGrid`)
must be laid out so the built-in focus indicator frames the poster cleanly and the
title below it stays visible. **This is a recurring trap — read it before building or
changing any list/grid item component.**

## The one thing that bites everyone

> **The focus indicator is pinned to the item's poster slot (`rowItemSize` /
> `itemSize`) _only_ when `rowHeights` is set taller than that slot. Without
> `rowHeights`, the indicator wraps the item component's _full bounding box_ —
> including any title/label positioned below the poster — so it extends past the
> image and swallows the title.**

The focus indicator is Roku's built-in 9-patch (we only re-color it via
`focusBitmapBlendColor`; we don't supply a bitmap). It is drawn **behind** the item
(`drawFocusFeedbackOnTop` is false by default).

## The layout contract

For an item component that shows a **poster with a title below it**:

1. **`rowItemSize`** = the poster/focus-slot size. This is what the focus indicator
   frames.
2. **`rowHeights`** (`RowList`) = `rowItemSize` height **+ a title area**. Setting it
   taller than `rowItemSize` is what pins the indicator to the slot and puts the title
   _outside_ the indicator. `MarkupGrid` gets the equivalent from its presenter's
   `rowHeights`/`itemSize`.

   **A one-entry `rowHeights` covers every row — but keep `itemSize.y` equal to it
   anyway.** Roku's [`RowList` reference](https://github.com/rokudev/dev-doc/blob/v2.0/docs/REFERENCES/scenegraph/list-and-grid-nodes/rowlist.md)
   says rows past the end of the array fall back to `itemSize.y`, unlike `rowItemSize` /
   `rowLabelOffset` / `rowItemSpacing`, which repeat their last value. Measured
   2026-08-09 on an Ultra: it repeats like the others — `rowHeights="[415]"` with
   `itemSize.y` forced to `200` left rows 2 and 3 at the 455-pixel pitch, not 240. So we
   rely on undocumented behavior, and a second `rowHeights` entry would re-arm the
   documented fallback. Keeping the two in step is correct under either reading.
3. **Poster fills the slot at a top offset** (`POSTER_TOP_OFFSET`), so the poster
   overflows the slot bottom and the indicator (drawn behind) shows a clean top margin
   and does **not** overlap the image. Poster flush at `[0,0]` makes the indicator's
   9-patch draw right on the image edge → overlap.
4. **Title** sits at `offset + posterHeight + gap`, landing in the `rowHeights` title
   area, below the indicator.

## Don't hand-roll focus chrome in a custom row

A `MarkupList` with an `itemComponentName` still draws its **own** focus indicator.
Drawing one inside the row instead is the trap, and it does not look like a bug —
it looks like a list that works, until you notice the focus never travels.

> **`drawFocusFeedback` defaults to `true`.** Turning it off means the list draws
> no indicator at all, so the row has to. A per-row indicator can only switch on
> and off; the list's own one **floats** between rows. That difference is what
> reads as lag.

The subtitle panel had `drawFocusFeedback="false"` and each row toggled a
`filled-rounded.9.png` + `border-6px.9.png` pair — the same two assets and the same
two theme colors `applyListFocusChrome()` already applies. Identical pixels, no
animation, two extra Posters per row, and a second copy of the focus vocabulary.

**Use [`applyListFocusChrome(list)`](../../source/utils/listTheme.bs)** and leave
`drawFocusFeedback` alone. Three things follow from that, all measured on a
Stick 4K:

1. **The indicator is drawn about 10 pixels OUTSIDE the row** — a row 72 tall
   had a ring spanning 92. With rows flush, its edge lands on the neighboring
   row's first line of text, so the list needs `itemSpacing` of at least that much. There is no
   padding in the 9-patch to read this from; it was measured from a capture.
2. **Keep `rowHeight + itemSpacing` divisible by 3.** 1080/720 means an absolute
   edge divisible by 3 lands on a 720p output row; the pitch is what carries the
   column's origin down the list. See `dialogLayout.bs`'s `PIXEL_GRID` note — the
   constant only helps if the absolute origin is on the grid too.
3. **Two focusable lists on one screen? Suppress the footprint.**
   `focusFootprintBitmapUri` draws on a list's focused item _while that list does
   not have focus_. Every other caller has one focusable list so it never renders;
   with two, the idle one shows a permanent `colorBackgroundSecondary` fill — the
   color that means _focused_ on a `TextButton`. Set it to
   `pkg:/images/1px-transparent.png`, as `Alpha.bs` does.

## Texture lifecycle — which cells hold a poster

Cells free their poster texture when the user cannot see it soon, and restore it when they
can. [`textureManager.bs`](../../source/utils/textureManager.bs) owns the decision inputs on
the list's content root; each cell ([`JRRowItem`](../../components/ui/rowitem/JRRowItem.bs),
[`GridItem`](../../components/ItemGrid/GridItem.bs)) observes them and decides for itself.

**State machine** (`textureManagerState` on the content root):

| State | Cells do | Set by |
|---|---|---|
| `init` | nothing — layout is still moving, and `renderTracking` flips are spurious | `initTextureManager` |
| `active` | apply the ranges below | `activateTextureManager` (first content, and every return to the screen) |
| `hidden` | nothing — textures stay loaded so returning is instant | `hideTextureManager` in `onScreenHidden` |
| `destroyed` | force-unload unconditionally | `destroyTextureManager` in `onDestroy` |

**Vertical range** — `loadedRowRange = [bufferStart, visibleStart, visibleEnd, bufferEnd]`,
the visible rows plus **2 rows each side**. A cell in a buffer row keeps its texture; a cell
outside the range follows `renderTracking`.

**Horizontal window** — only on a `RowList` row with more than `TEXTURE_BUFFER_THRESHOLD`
(20) items, and only while that row is visible. The window is exactly 20 columns: the visible
slots (`calculateTextureVisibleItemCount`, counting a partly visible slot) plus the remaining
budget split left/right, the odd item to the right, **wrapping** because `JRRowList` uses
`fixedFocusWrap`. At column 0 the left half is the row's tail — the item drawn in the
`focusXOffset` gap and one Left press away. The geometry is `isColumnInTextureWindow`, and
its unit tests assert the column sets read off a device, so change the tests only with a new
device reading. Every shape loads 20: portrait/square show 7 and buffer 6 left / 7 right;
wide shows 4 and buffers 8 / 8.

**What bounds memory is the cell pool, not the item count.** `RowList` creates cells only
around focus (~28-30 on a 32- or 100-item row), and a texture can only live on a cell. A
buffer row has no 20-column cap, yet on a 100-item row it held 7 textures across its 8 cells.
Counting evictions by items therefore over-predicts: a cell `RowList` reuses for another item
takes its new poster without ever passing through `unloadTexture`, so `unloadsWindow` reads
below "items that left the window".

**Three paths clear a poster URI** — `unloadTexture(reason)` (range or window eviction; the
only one the ledger counts), `forceUnloadTexture` (teardown), and `deferTextureLoad` (a cell
bound outside its window never requests the image). After an unload Roku reports the poster's
`loadStatus` as `failed`; that is the cleared URI, not a broken image — both load-status
observers return early on `isTextureUnloaded`, and `loadsFailed` does not move.

**A fourth path clears it too, and must NOT reload: a failed image.** `showPlaceholder`
clears the URI to reveal the type glyph underneath, with the real URL still cached — so from
`currentUri <> cachedUri` a failed cell looks exactly like an evicted one. `isTextureUnloaded`
separates them: the three paths above set it and `showPlaceholder` does not, and
`shouldReloadTexture` gates the reload on it. Re-requesting a known-broken image would wipe
the glyph off a cell that is sitting still and then fail again, so a failed image retries only
at its next unload or rebind, never on scroll — see `failed-poster-no-scroll-retry` in
[`decisions.md`](../decisions.md).

## Canonical examples

- [`JRRowItem`](../../components/ui/rowitem/JRRowItem.bs) + [`HomeRows`](../../components/home/HomeRows.bs):
  `HomeRows` sets `rowHeights = rowItemSize + 90` (see the comment at `HomeRows.bs`
  near `setRowItemSize`); `JRRowItem` fills the slot and places its title below.
  `applyRowSizes` is the equivalent in `SearchRow` / `FavoritesRows`, not here.
- [`GridItem`](../../components/ItemGrid/GridItem.bs) in the genre `RowList`
  ([`BaseGridView.xml`](../../components/ItemGrid/BaseGridView.xml) `genreList`):
  `rowItemSize="[[213,320]]"`, `rowHeights="[415]"` (and `itemSize="[1702,415]"` to
  match), poster filled at `POSTER_TOP_OFFSET`, title below. Why those numbers: the
  comment beside the fields in the markup.
- Roku's official [`RowList` sample](https://github.com/rokudev/samples/tree/master/ux%20components/lists%20and%20grids/RowListExample)
  uses `rowItemSize=[536,308]` with the poster inset to `512×288` — another way to keep
  the indicator off the image.

## Why this doc exists (evidence)

2026-06-03, unifying `GridItem` into the genre `RowList`: the `genreList` set
`rowItemSize` but never `rowHeights`, so the focus border wrapped the cell's full
bounding box — overlapping the poster and bumping the title off-screen. Many wrong
turns (insetting the poster, moving offsets, growing the row) chased the symptom; the
fix was one field, `rowHeights`. Past sessions hit the same wall. If you're fighting a
focus border that "extends too far" or a title that "disappears on focus," it is almost
certainly a missing or wrong `rowHeights`.
