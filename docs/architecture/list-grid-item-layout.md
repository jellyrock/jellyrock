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
last-reviewed: 2026-09-05
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
