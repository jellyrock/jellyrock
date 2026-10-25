---
topic: design-system
related-files:
  - components/JROverhang.bs
  - components/JROverhang.xml
  - components/ui/button/JROverhangIcon.bs
  - components/ui/button/JROverhangIconBar.bs
  - components/ui/button/TextButton.bs
  - components/ui/button/TextButton.xml
  - components/ui/tabbar/JRTab.bs
  - components/ui/tabbar/JRTabBar.xml
  - components/ui/dropdown/JRDropdown.xml
  - components/ui/dropdown/JRDropdown.bs
  - source/utils/iconBarNav.bs
  - resources/icons/icons.json
last-reviewed: 2026-10-25
---

# Design system

The visual rules every screen follows, in one place, so a new screen takes them instead of rediscovering them. Each rule says what it is, why, and where the code enforces it. The icon pipeline's own rules (which Material variant, when a glyph is filled) are in [resources/icons/README.md](../../resources/icons/README.md); the dialog standard is [dialogs.md](dialogs.md); grid and list item layout is [list-grid-item-layout.md](list-grid-item-layout.md).

Design pixels throughout: the app lays out at 1920 by 1080 and the OS scales it. Keep sizes and gaps in multiples of 3, so a 720p device (two thirds) lands on whole pixels.

## Theme colors: which one means what

The palette encodes interaction state, not only hue. Pick by meaning and the choice survives any palette, since a viewer can change every color (**Settings → User Interface → General → Theme**, then **Custom**).

| Constant | Use for | Never |
|---|---|---|
| `colorPrimary` | What the viewer can focus or act on: focus rings, active-state chrome | Static decoration |
| `colorSecondary` | Highlights nothing can focus: the selected-tab underline, accent rules, emphasis marks, decorative dividers | Anything focusable |
| `colorBackgroundPrimary` | Panel and surface fills | |
| `colorBackgroundSecondary` | Structural separators, subtle borders, the fill behind a focused button | |
| `colorTextPrimary`, `colorTextSecondary`, `colorTextDisabled` | Text by emphasis level; a focused control's text and glyph take primary, a resting one secondary | |
| `colorError` | A control that cannot act and says so on a press (a disabled overhang icon) | Emphasis |

It matters most where two appear in one frame. In a dialog the button focus ring is `colorPrimary` and the accent rule under the title `colorSecondary`; an accent rule in `colorPrimary` would read as focusable. In the overhang the focus ring is `colorPrimary` and the selected tab's underline `colorSecondary`: the underline marks where you are, the ring what you are on.

## Border weights: 3 pixels static, 6 pixels focusable

The 9-patch borders encode the same state. `border-3px.9.png` is for static panel edges (`JRDialogPanel`, every dialog's frame). `border-6px.9.png` is for focusable things: `TextButton`'s focus ring, `IconButton`, `FocusableOverview`, the dropdowns, the list and grid focus indicators, the overhang's icons. The thick border is part of the "you can focus this" signal, so keep the two weights distinct.

## The overhang row

One row, the same elements in the same order on every screen that shows them (`JROverhang`): the logo, the screen's tabs or its title in their place, the user dropdown, the fixed cluster (Search, Settings), the clock. What rides in the overhang is decided by one rule: **the overhang holds what every screen has; a screen holds what only it has.** A control one screen alone has (a library's layout, sort and filter) belongs on that screen, next to the state it changes.

| Element | Size | Rule |
|---|---|---|
| Icon button (`JROverhangIcon`) | a 66 pixel button with a 42 pixel glyph (12 pixels inside) | The focus ring is the 6 pixel border; the resting glyph is `colorTextSecondary`, focused `colorTextPrimary`, disabled `colorError` |
| Tab (`JRTab`) | the Large font, 30 pixels padding, a 42 pixel glyph, a 6 pixel icon gutter | The glyph is outlined until the tab is selected, then filled; the 6 pixel underline under glyph and text is `colorSecondary` |
| User dropdown (`JRDropdown`) | a 42 pixel avatar, the name, a 24 pixel chevron, 12 pixels apart, 15 pixels padding | The box hugs its content; a name past 300 pixels is cut with an ellipsis |
| Clock | right-aligned at x 1824 in a 150 pixel slot | Everything else is placed from the slot's left edge |
| Box gap | 12 pixels between every neighboring box in the row | One value for tabs, the dropdown and the cluster; the row's elements line up from the right edge in, so the cluster sits at the same place on every screen |
| Row | buttons from design y 39 to 105; content starts at 104 (Home's row label) and near 125 (a grid's tiles) | There is no room for a second row: the phase D spike measured it (2026-10-25). Put a screen's own status text on the screen |

Left and Right walk the row as one and wrap at both ends; Down returns to the screen; Up from a screen's first row enters the row at the element used last, else the selected tab.

## A glyph beside text, and in a button

| Context | Glyph | Gutter to the text | Why |
|---|---|---|---|
| `TextButton` with the Medium font (details, player controls) | 24 pixels (`iconSize`, the default) | 12 pixels (`iconGutter`, the default) | The sizes the app's buttons were drawn at |
| A tab with the Large font | 42 pixels | 6 pixels | A 42 pixel poster of a 64/46 asset pads about 6 pixels itself, so 12 pixels stays visible |
| An overhang icon button | 42 pixels in a 66 pixel button | none | The glyph is the content |

**Density.** An overhang glyph (tabs and the cluster) is built at the 64/46 density in `icons.json`: a 64 pixel canvas with a 46 pixel glyph, so the drawn shape fills about 72% of its poster. The pipeline's default 96/54 fills 56%, which draws visibly smaller at the same poster size: measured 2026-10-25, `search` and `settings` at 64/46 and `home` at the default were 32 pixels and 22 pixels of ink in the same 42 pixel poster. Pin the density when adding a glyph to the overhang.

**Fill.** Outlined by default; the recorded exceptions are the fill rules in the icon README. A navigation destination's glyph follows selection: outlined while not selected, filled while selected, never tied to focus (rule 8 there).

## Where the numbers are enforced

The sizes above live in the components, not in prose: `OVERHANG_ICON_SIZE` and `OVERHANG_ICON_POSTER_SIZE` in `JROverhangIcon.bs`, `ICON_GAP` in `iconBarNav.bs` (with a Rooibos spec on its geometry), `ELEMENT_GAP`, `CLOCK_SLOT` and the row's y in `JROverhang.bs`, `itemSpacings` in `JRTabBar.xml`, `iconSize` and `iconGutter` on `TextButton`, and the avatar size and spacing of the dropdown in `JRDropdown.xml`. Change a number there and this page, not the other way round. The look is checked on hardware: `npm run test:rta:capture` photographs the screens, and the RTA specs `search-navigation`, `overhang-clock` and `home-failure` walk the row.
