---
topic: design-system
related-files:
  - components/JROverhang.bs
  - components/JROverhang.xml
  - components/Clock.bs
  - components/Clock.xml
  - components/ui/button/IconButton.xml
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
  - source/utils/tabStrip.bs
  - source/utils/buttonOverflow.bs
  - source/utils/pixelGrid.bs
  - source/utils/textMetrics.bs
  - source/utils/iconBarNav.bs
  - resources/icons/icons.json
  - components/ui/listposition/ListPosition.bs
  - components/ui/listposition/ListPosition.xml
  - source/utils/listPosition.bs
  - components/ItemGrid/LibraryHeaderStrip.bs
  - components/ItemGrid/LibraryHeaderStrip.xml
  - source/utils/headerStrip.bs
last-reviewed: 2026-11-25
---

# Design system

The visual rules every screen follows, in one place, so a new screen takes them instead of rediscovering them. Each rule says what it is, why, and where the code enforces it. The icon pipeline's own rules (which Material variant, when a glyph is filled) are in [resources/icons/README.md](../../resources/icons/README.md); the dialog standard is [dialogs.md](dialogs.md); grid and list item layout is [list-grid-item-layout.md](list-grid-item-layout.md).

Design pixels throughout: the app lays out at 1920 by 1080 and the OS scales it. **Every size and every drawn position is a multiple of 3**, the position counted as the sum of the translations above it, so a 720p device (two thirds) draws it on whole pixels. A width that follows text is rounded up onto the grid (`snapToGrid` in `source/utils/pixelGrid.bs`, which the dialogs use too); only the text's own ink is exempt, since the font decides it.

## Theme colors: which one means what

The palette encodes interaction state, not only hue. Pick by meaning and the choice survives any palette, since a viewer can change every color (**Settings → User Interface → General → Theme**, then **Custom**).

| Constant | Use for | Never |
|---|---|---|
| `colorPrimary` | What the viewer can focus or act on: focus rings, active-state chrome | Static decoration |
| `colorSecondary` | Highlights nothing can focus: the selected-tab underline, accent rules, emphasis marks, decorative dividers. Also a toggle's on-state glyph, focused or not: `IconButton`'s selected state (Watched, Favorite) and the SyncPlay icon | A focusable control's focus or resting chrome |
| `colorBackgroundPrimary` | Panel and surface fills | |
| `colorBackgroundSecondary` | Structural separators, subtle borders, the fill behind a focused button | |
| `colorTextPrimary`, `colorTextSecondary`, `colorTextDisabled` | Text by emphasis level; a focused control's text and glyph take primary, a resting one secondary, a control that cannot act disabled (a disabled overhang icon, focused or not) | |

It matters most where two appear in one frame. In a dialog the button focus ring is `colorPrimary` and the accent rule under the title `colorSecondary`; an accent rule in `colorPrimary` would read as focusable. In the overhang the focus ring is `colorPrimary` and the underline `colorSecondary`, under the selected tab or under the title of a screen with no tabs: the underline marks where you are, the ring what you are on.

## Border weights: 3 pixels static, 6 pixels focusable

The 9-patch borders encode the same state. `border-3px.9.png` is for static panel edges (`JRDialogPanel`, every dialog's frame). `border-6px.9.png` is for focusable things: `TextButton`'s focus ring, `IconButton`, `FocusableOverview`, the dropdowns, the list and grid focus indicators, the overhang's icons. The thick border is part of the "you can focus this" signal, so keep the two weights distinct.

## The overhang row

One row, the same elements in the same order on every screen that shows them (`JROverhang`): the logo (before sign-in only), the screen's tabs or its title in their place, the user dropdown, the fixed cluster (SyncPlay, Search, Settings), the clock. Every signed-in screen starts its tabs or title at the left edge (x 96), so nothing moves sideways between screens. What rides in the overhang is decided by one rule: **the overhang holds what every screen has; a screen holds what only it has.** A control one screen alone has (a library's layout, sort and filter) belongs on that screen, next to the state it changes.

| Element | Size | Rule |
|---|---|---|
| Icon button (`JROverhangIcon`) | a 78 pixel square focus box around the 42 pixel glyph; the row lays out by 60 pixel slots 6 apart, so the box overhangs its slot by 9 and overlaps its invisible neighbors | The focus ring is the 6 pixel border; the resting glyph is `colorTextSecondary`, focused `colorTextPrimary`, disabled `colorTextDisabled` in both states |
| SyncPlay icon (the cluster's first entry) | the same box; an 18 pixel badge (`overhangRow.BADGE_SIZE`) on the glyph's top-right | One icon is the membership's state and its control. In a group, the filled `groups` glyph is drawn in `colorSecondary`, focused or not; its outlined variant differs from the filled one only by two small holes, which nobody tells apart at ten feet. Outside a group, while a group exists to join, a `colorSecondary` dot sits on the white glyph (`JROverhangIcon.hasBadge`), as the jellyfin-web toolbar marks it. The two states differ in shape (a tinted glyph or a dot), not in color alone, so they hold in any theme. An account whose SyncPlay access is None never sees it: Search and Settings keep their place at the right. Neither does anyone until the server's push channel to the Roku is known; without one (an HTTPS server with no companion plugin) the icon is shown disabled (`isDisabled`, a gray glyph) with no dot, and a press explains that the plugin is needed. A press opens a dialog, never a route |
| Tab (`JRTab`) | the Large font in a 78 pixel box, 15 pixels at the sides (`TAB_PADDING`, so the focus border sits 9 pixels clear of the text) | Text only: few views have a symbol a viewer reads at a glance, and a glyph costs a tab's width. The 6 pixel underline under the selected tab's text is `colorSecondary` |
| User dropdown (`JRDropdown`) | a 42 pixel avatar, the name, a 24 pixel chevron, 9 pixels apart, in a 78 pixel box with 9 pixels at the sides | The box hugs its content, the name's width rounded up onto the grid; the box never crosses the row's line (below), so a long name is cut with an ellipsis. The name drops 3 pixels in its box, as a text box does (below) |
| Logo | 180 by 39 at y 51 | Shown while no user is signed in (the sign-in screens, which have no tabs or title), decided by `JRScene`, not declared by a screen. Its capitals and baseline sit on the tab text's |
| Text box (tabs, the title, the clock) | the row's 78 pixels, 3 pixels below the row's top (y 30 to 108) | A label centers its line box, and caps and digits sit about 7% of the font size above that box's middle, so text in this box centers on the row's line. The title takes the same box as a tab's text, so it sits where the tabs' text does |
| Title (`JROverhang` `title`) | the Large font in primary color in the tabs' place, shown on a screen with no tabs, with a 6 pixel `colorSecondary` line under its text (`overhangRow.TITLE_UNDERLINE`) | The name of what was opened and nothing else: a library screen's count and what narrows it are on its header strip. The line is a selected tab's underline, placed by the same arithmetic (`underlineTop` in `source/utils/textMetrics.bs`), so the row marks where the viewer is the same way with tabs or without. It is as wide as the text, never wider than the title's slot, and not focusable |
| Status (`JROverhang` `status`) | the Large font in secondary color, 9 pixels (`TITLE_STATUS_GAP`) after the title's text, taking what the slot has left | A screen's state next to its name, never a control: the search screen's submitted query while its keyboard is closed. Scrolls when long; hidden when the title alone fills the slot |
| Clock | right-aligned at x 1824 in a 150 pixel slot, in the text box (`Clock`'s `boxY` and `boxHeight`, whose defaults are the video player's) | Everything else is placed from the slot's left edge |
| Box gap | none between tabs, whose boxes touch (`TAB_SPACING`), 6 pixels on the right (before the dropdown, before and inside the cluster) | A tab's padding is its air, and a glyph's canvas pads the glyph, so the two give one visible rhythm; the row's elements line up from the right edge in, so the cluster sits at the same place on every screen |
| Row | boxes 78 tall from design y 27 to 105, every static element's ink centered on y 66 (a focus ring may sit above or below that line); content starts at 104 (Home's row label) and at 111 on a library (its [header strip](#the-library-header-strip)) | There is no room for a second row: measured on a Stick 4K (2026-10-25), content starts right under the row's bottom edge. Put a screen's own status text on the screen |

### A tab strip that can outgrow its slot

Every tab strip (`JRTabBar`) is clipped to its slot, the span from its left edge to the gap before the user dropdown or the cluster, and follows one rule. A strip that fits never moves, so Home's two tabs and a long library's eight behave alike.

The rule: the **active tab** is the focused tab while the bar has focus, and the selected tab otherwise. It sits at the start of the slot with a little of the tab before it showing, and the strip never scrolls past its last tab. So a strip that fits never moves. On one that does not, each Left or Right press moves the strip one tab until it reaches an end, and the strip returns to the selected tab when focus leaves the bar. Right from the last tab and Left from the first leave the strip for the next element in the row.

A tab the slot's edge cuts is drawn dimmed, which tells the viewer more tabs lie that way. There is no fade: the overhang sits over a backdrop, so a painted gradient would show as a band, and a fade to transparent needs a `MaskGroup`, which a player without OpenGL draws unmasked.

Only a focus move slides the strip. A new set of tabs, a new screen and a change in the slot's width place it at once. The slot's width counts the clock as at least `CLOCK_PROVISIONAL_WIDTH` wide (`overhangRow.tabSlotWidth`), so the strip holds still while the digits change width.

The rule is one pure function, `tabStrip.window` in `source/utils/tabStrip.bs`, with the peek width, the cut tab's opacity and the slide's length beside it.

### The line between the row's two sides

The tabs, or the title and its status, may always run to the row's line (`overhangRow.LINE_X`, x 1068), which leaves them more than half the row. The user dropdown never crosses it: `overhangRow.menuMaxWidth` gives the dropdown its widest box (`JRDropdown.maxWidth`), and a name too long for it ends in an ellipsis (300 pixels of name with SyncPlay shown and the clock at its allowance). A short name leaves its room to the tabs. The limit counts the clock at its allowance, as the tab slot does, so a name is not cut afresh each minute.

The dropdown shows on Home, Settings and Search only (`shouldShowUserDropdown`). A name has no known width, so the screens that need their room for tabs, a library above all, leave it out.

Left and Right walk the row as one and wrap at both ends; Down returns to the screen; Up from a screen's top enters the row at the element used last on that visit, else the first shown (the selected tab on a screen with tabs, the dropdown on Settings and Search, the first cluster icon elsewhere). The cluster shows on every screen once a user is signed in, except a player, which has no now-playing control to come back to. A cluster icon for the screen on show (Search on Search, Settings on Settings) does nothing, as a selected tab does: the screen's underlined title already says where the viewer is. A screen's own controls stay on the screen: the search screen's query box lives in its keyboard overlay, and while the keyboard is closed the overhang shows the submitted query as dim status text after the title. A library's sort and filter are on its header strip, which sits between the row and the content: Up from the content's top lands on the strip, and Up from the strip enters the row.

## The library header strip

Every library screen has one row under the overhang (`LibraryHeaderStrip`, fed by `BaseGridView`). It is where a library's own controls live, and it answers one question on its left: what is focused.

| Part | Rule |
|---|---|
| The row | 54 pixels tall from y 111, x 96 to 1824. It sits midway between the selected tab's underline and the first row's focus ring: 13 pixels from each, measured on a Roku Ultra capture (2026-11-15). The ring is the reference, not the poster: the ring is what the eye meets |
| Title | The focused item's name in the Medium font, bold, primary color. It is a caption under the tabs, so it stays smaller than them on every layout. The details screen's title is that page's heading and is larger on purpose |
| Metadata | One line after the title in the Small font, secondary color: a movie's year, rating and runtime, a series' years and rating, an album's artist and year, a channel's number and program (`itemSummary.line`). It is built as the details screen builds an info row, items 9 pixels each side of a bold bullet, and cut by the same rule (`fitTextRow`) |
| Narrowed by | "Filtered by: …" in Small secondary text before the library's name, while a voice search or a letter narrows the tab |
| Library name | The library's own name in Small secondary text before the chips, on a screen with tabs. Tabs take the overhang title's place, so without it two libraries of one type look the same once open. A screen with no tabs shows its name as the overhang title and none here. It takes at most 300 pixels (`headerStrip.NAME_MAX_WIDTH`) and ends in an ellipsis past that |
| Count | "12 of 240" in Small secondary text, the string every position readout uses. It ends at the row's right edge, under the clock's last digit, as a row's counter does on Home. Its box is as wide as the count with every digit of the place drawn as the font's widest digit, and the text is right-aligned in it (`headerStrip.reservedPosition`). Digits differ in width, so a box sized by the text itself moved the chips at almost every step; this way they shift only when the place gains or loses a digit. A setting, on by default; with it off the chips end at the edge |
| Chips | `TextButton`s the row's height: padding 15, a 30 pixel glyph (a 63/45 asset, so about 21 pixels of ink, the Medium font's cap height) and a 9 pixel gutter. Sort names the field and points an arrow its way; Filter counts the values set. A chip shows only where it does something: the TV guide takes no sort |
| Text drop | The row's text is drawn 3 pixels low (`headerStrip.TEXT_DROP`, `TextButton.textDrop`). A label centers its line box and caps sit above that box's middle, which shows in a box only a little taller than its text (measured: caps 3 pixels high in the chip) |
| When room runs out | The title is cut first, and the metadata never takes more than half of the left side. Before the left side falls under 480 pixels the library's name is cut and then hidden, then the count hides, then the narrowed-by text is cut. No part is drawn over another (`headerStrip.fit`, pure, with a spec) |

Where a layout has a panel that describes the focused item, the strip gives up what the panel says better. In the presentation layout the strip shows the title alone, and the panel under it writes the metadata as the details screen does. On the TV guide the strip names the focused program, and the guide's pane starts with what follows.

Left and Right walk the chips and stop at the ends. Down returns to the content. Sort opens an anchored picker: the fields with the one in force marked, then an Order row that flips the direction. Filter opens a menu of categories that combine, with Clear filters first while anything narrows the tab. Star on a library does what the settings icon does. Sort and Filter are reached from the top row: Replay goes to the first item from anywhere, and Up from there reaches the strip.

### The letter rail: the one thing in the margin

Everything a viewer needs is inside the 5% zone. A shortcut may use the margin, and the letter rail is the one that does: it stays at x 52 with its full alphabet. The rail is a filter, not a jump: a press narrows the tab to names starting with that letter, under any sort. A TV that clips the margin loses that filter, because nothing inside the zone offers the letters. This gap is accepted: the rail has been at the left edge since the library grid existed. At 6 or fewer per row, a library grid's second row of titles also draws in the bottom margin, since the strip names the focused item inside the zone ([list-grid-item-layout.md](list-grid-item-layout.md#the-library-grids-cells)).

## A list that hides rows: the position line

A list that shows only some of its rows says so with a position line (`ListPosition`): the count "3 of 12" in secondary small text, between an up and a down arrowhead. It answers the two things a clipped list leaves open: whether there is more and which way, and how many there are.

| Part | Rule |
|---|---|
| When it shows | Only while the list hides rows. A list seen whole has already answered the question |
| The count | The focused row and the total, in the string every position readout uses (`LabelPositionOfTotal`) |
| An arrowhead | `colorTextSecondary` when rows are hidden that way, `colorTextDisabled` when none are. It stays in place either way, so the count does not move as focus does |
| Where it sits | Its own line beside the list, never on a title's line: a long title in another language would meet it. In a dialog it is the footer slot, under the list |
| Size | A 36 pixel line, 24 pixel arrowheads, 12 pixels between an arrowhead and the count (`listPosition.bs`) |
| Focus | None. It is read, never focused |

**Wrapping is never signaled.** A list that wraps would light both arrowheads on every row, and a mark that never changes says nothing about where you are. The wrap is a shortcut a viewer finds by pressing, and nothing is lost by never finding it.

Roku's lists report the focused row and not which rows are on screen, so `listPosition.firstVisibleAfter()` follows the window from the focus moves. Roku moves the window the least it must, whether focus stepped, paged (FF and Rewind) or jumped, so one rule covers all three. It is pure and has a spec.

The list dialog (`JRListDialog`) is the first to use it. The subtitle panel and the search suggestions each draw a count of their own, older than this rule; moving them onto `ListPosition` is followup `position-line-across-lists`. Home's rows show Roku's own row counter (`showRowCounter`), which is a row list's and stays. The tab strip's dimmed cut tab is the same idea for a strip with no room for a line.

## A glyph beside text, and in a button

| Context | Glyph | Gutter to the text | Why |
|---|---|---|---|
| `TextButton` with the Medium font (the subtitle panel) | 24 pixels (`iconSize`, the default) | 12 pixels (`iconGutter`, the default) | The sizes the app's buttons were drawn at |
| A header strip chip, Medium font | 30 pixels | 9 pixels | A 63/45 asset at 30 draws about 21 pixels of ink, the font's cap height. A glyph whose ink is narrow is pinned larger so its side padding matches its neighbor's (`sort` is 63/51) |
| `IconButton` (details, the players' controls) | a 63 pixel square load box, drawn 1:1 from a 63 pixel canvas | caption below | The box sets the plate (123 pixels) and the row's overflow budget (`ICON_BUTTON_ICON_SIZE` in `buttonOverflow.bs`). A smaller canvas is not scaled up and gives a narrower plate, so its icons are built at 63 in `icons.json` |
| An overhang icon button | 42 pixels in a 78 pixel square box | none | The glyph is the content |

**Density.** Every overhang glyph (the cluster's, the avatar fallback `person`) is pinned in `icons.json` at 63/45: a 63 pixel canvas with the glyph's longer side 45 pixels, so the shape fills about 71% of its poster. Both numbers are on the grid, and so is everything that follows from them: the HD copy is 42/30, and a 42 pixel poster draws the canvas at exactly two thirds, a 30 pixel glyph with 6 pixels of padding each side. The pipeline's default 96/54 fills 56%, which draws visibly smaller at the same poster size (measured 2026-10-25: `home` at the default drew 22 pixels of ink in a 42 pixel poster where `search` drew 32). Pin 63/45 when adding a glyph to the overhang.

**Fill.** Outlined by default; the recorded exceptions are the fill rules in the icon README.

## Where the numbers are enforced

The row's shared numbers live in one file, `source/utils/overhangRow.bs`: three chosen (the row's height, the glyph size, the padding inside a box), a tab's own padding and spacing, the gaps (after the title, between the right-hand elements, and before the clock's digits, which the group mark in the player's OSD keeps too) and the text drop, and the rest derived from them. The components read it; `leftOfClock()` places whatever ends at the clock, and `CLOCK_PROVISIONAL_WIDTH` stands in for its digits until it reports their width; what only one component uses stays there (`LOGO_Y` in `JROverhang.bs`, the avatar, chevron and part gap in `JRDropdown`). Change a number there and this page, not the other way round. Where a label's caps sit in its box is one function, `capsAboveCenter` in `source/utils/textMetrics.bs`, which `TextButton`'s icon and the name in the user dropdown use; `textMetrics.spec.bs` fails if the row's text drop stops matching it.

Two checks hold it, and one measurement. The Rooibos spec `JROverhangLayout.spec.bs` fails on any box the overhang places off the grid, or off the row's edges. On hardware, `RTA_BENCH=1 npm run test:rta -- overhang-ink` writes where each element's ink sits on Home and on Settings, and each box's position, to `out/rta-captures/*.ink.json` (through `tests/rta/lib/ink.js`); it gates nothing, so judge a layout change by diffing the tables of two runs. The RTA specs `search-navigation`, `overhang-clock` and `home-failure` walk the row. `tabStrip.spec.bs` holds the scrolling rule and `overhangRowTabSlot.spec.bs` the slot's width; `RTA_BENCH=1 npm run test:rta -- tab-strip` walks a strip of eight tabs on hardware and fails if the focused tab is ever cut, the strip scrolls past its end, or Right from the last tab stays in the strip.
