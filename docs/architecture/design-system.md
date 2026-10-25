---
topic: design-system
related-files:
  - components/JROverhang.bs
  - components/JROverhang.xml
  - components/Clock.bs
  - components/Clock.xml
  - components/ui/button/JROverhangIcon.bs
  - components/ui/button/JROverhangIcon.xml
  - components/ui/button/JROverhangIconBar.bs
  - components/ui/button/JROverhangIconBar.xml
  - components/ui/button/TextButton.bs
  - components/ui/button/TextButton.xml
  - components/ui/tabbar/JRTab.bs
  - components/ui/tabbar/JRTab.xml
  - components/ui/tabbar/JRTabBar.bs
  - components/ui/tabbar/JRTabBar.xml
  - components/ui/dropdown/JRDropdown.xml
  - components/ui/dropdown/JRDropdown.bs
  - source/utils/overhangRow.bs
  - source/utils/pixelGrid.bs
  - source/utils/iconBarNav.bs
  - resources/icons/icons.json
last-reviewed: 2026-10-25
---

# Design system

The visual rules every screen follows, in one place, so a new screen takes them instead of rediscovering them. Each rule says what it is, why, and where the code enforces it. The icon pipeline's own rules (which Material variant, when a glyph is filled) are in [resources/icons/README.md](../../resources/icons/README.md); the dialog standard is [dialogs.md](dialogs.md); grid and list item layout is [list-grid-item-layout.md](list-grid-item-layout.md).

Design pixels throughout: the app lays out at 1920 by 1080 and the OS scales it. **Every size and every drawn position is a multiple of 3**, the position counted as the sum of the translations above it, so a 720p device (two thirds) draws it on whole pixels. A width that follows text is rounded up onto the grid (`snapToGrid` in `source/utils/pixelGrid.bs`, which the dialogs use too); only the text's own ink is exempt, since the font decides it.

## Theme colors: which one means what

The palette encodes interaction state, not only hue. Pick by meaning and the choice survives any palette, since a viewer can change every color (**Settings → User Interface → General → Theme**, then **Custom**).

| Constant | Use for | Never |
|---|---|---|
| `colorPrimary` | What the viewer can focus or act on: focus rings, active-state chrome | Static decoration |
| `colorSecondary` | Highlights nothing can focus: the selected-tab underline, accent rules, emphasis marks, decorative dividers | Anything focusable |
| `colorBackgroundPrimary` | Panel and surface fills | |
| `colorBackgroundSecondary` | Structural separators, subtle borders, the fill behind a focused button | |
| `colorTextPrimary`, `colorTextSecondary`, `colorTextDisabled` | Text by emphasis level; a focused control's text and glyph take primary, a resting one secondary, a control that cannot act disabled (a disabled overhang icon, focused or not) | |

It matters most where two appear in one frame. In a dialog the button focus ring is `colorPrimary` and the accent rule under the title `colorSecondary`; an accent rule in `colorPrimary` would read as focusable. In the overhang the focus ring is `colorPrimary` and the selected tab's underline `colorSecondary`: the underline marks where you are, the ring what you are on.

## Border weights: 3 pixels static, 6 pixels focusable

The 9-patch borders encode the same state. `border-3px.9.png` is for static panel edges (`JRDialogPanel`, every dialog's frame). `border-6px.9.png` is for focusable things: `TextButton`'s focus ring, `IconButton`, `FocusableOverview`, the dropdowns, the list and grid focus indicators, the overhang's icons. The thick border is part of the "you can focus this" signal, so keep the two weights distinct.

## The overhang row

One row, the same elements in the same order on every screen that shows them (`JROverhang`): the logo, the screen's tabs or its title in their place, the user dropdown, the fixed cluster (Search, Settings), the clock. What rides in the overhang is decided by one rule: **the overhang holds what every screen has; a screen holds what only it has.** A control one screen alone has (a library's layout, sort and filter) belongs on that screen, next to the state it changes.

| Element | Size | Rule |
|---|---|---|
| Icon button (`JROverhangIcon`) | a 78 pixel square focus box around the 42 pixel glyph; the row lays out by 60 pixel slots 6 apart, so the box overhangs its slot by 9 and overlaps its invisible neighbors | The focus ring is the 6 pixel border; the resting glyph is `colorTextSecondary`, focused `colorTextPrimary`, disabled `colorTextDisabled` in both states |
| Tab (`JRTab`) | the Large font in a 78 pixel box, 9 pixels at the sides, a 42 pixel glyph, a 6 pixel icon gutter | The glyph is outlined until the tab is selected, then filled; the 6 pixel underline under glyph and text is `colorSecondary` |
| User dropdown (`JRDropdown`) | a 42 pixel avatar, the name, a 24 pixel chevron, 9 pixels apart, in a 78 pixel box with 9 pixels at the sides | The box hugs its content, the name's width rounded up onto the grid; a name past 300 pixels is cut with an ellipsis. The name drops 3 pixels in its box, as a text box does (below) |
| Logo | 180 by 39 at y 51 | Its capitals and baseline sit on the tab text's |
| Text box (tabs, the title, the clock) | the row's 78 pixels, 3 pixels below the row's top (y 30 to 108) | A label centers its line box, and caps and digits sit about 7% of the font size above that box's middle, so text in this box centers on the row's line. The title takes the same box as a tab's text, so it sits where the tabs' text does |
| Clock | right-aligned at x 1824 in a 150 pixel slot, in the text box (`Clock`'s `boxY` and `boxHeight`, whose defaults are the video player's) | Everything else is placed from the slot's left edge |
| Box gap | 9 pixels between tabs, 6 pixels on the right (before the dropdown, before and inside the cluster) | Text has no air of its own, a glyph's canvas does, so two numbers give one visible rhythm; the row's elements line up from the right edge in, so the cluster sits at the same place on every screen |
| Row | boxes 78 tall from design y 27 to 105, every static element's ink centered on y 66 (a focus ring may sit above or below that line); content starts at 104 (Home's row label) and near 125 (a grid's tiles) | There is no room for a second row: measured on a Stick 4K (2026-10-25), content starts right under the row's bottom edge. Put a screen's own status text on the screen |

Left and Right walk the row as one and wrap at both ends; Down returns to the screen; Up from a screen's first row enters the row at the element used last, else the selected tab.

## A glyph beside text, and in a button

| Context | Glyph | Gutter to the text | Why |
|---|---|---|---|
| `TextButton` with the Medium font (details, player controls) | 24 pixels (`iconSize`, the default) | 12 pixels (`iconGutter`, the default) | The sizes the app's buttons were drawn at |
| A tab with the Large font | 42 pixels | 6 pixels | A 42 pixel poster of a 64/46 asset pads about 6 pixels itself, so 12 pixels stays visible |
| An overhang icon button | 42 pixels in a 78 pixel square box | none | The glyph is the content |

**Density.** An overhang glyph (tabs and the cluster) is built at the 64/46 density in `icons.json`: a 64 pixel canvas with a 46 pixel glyph, so the drawn shape fills about 72% of its poster. The pipeline's default 96/54 fills 56%, which draws visibly smaller at the same poster size: measured 2026-10-25, `search` and `settings` at 64/46 and `home` at the default were 32 pixels and 22 pixels of ink in the same 42 pixel poster. Pin the density when adding a glyph to the overhang.

**Fill.** Outlined by default; the recorded exceptions are the fill rules in the icon README. A navigation destination's glyph follows selection: outlined while not selected, filled while selected, never tied to focus (rule 8 there).

## Where the numbers are enforced

The row's shared numbers live in one file, `source/utils/overhangRow.bs`: three chosen (the row's height, the glyph size, the padding inside a box), the two gaps and the text drop, and the rest derived from them. The components read it; what only one component uses stays there (`CLOCK_SLOT` and `LOGO_Y` in `JROverhang.bs`, the avatar, chevron and part gap in `JRDropdown`). Change a number there and this page, not the other way round.

Three checks hold it. The Rooibos spec `JROverhangLayout.spec.bs` fails on any box the overhang places off the grid, or off the row's edges. On hardware, `tests/rta/lib/ink.js` reports where each element's ink sits in a capture, and each box's grid position, so a layout change is judged by comparing two runs. The RTA specs `search-navigation`, `overhang-clock` and `home-failure` walk the row.
