---
topic: dialogs
related-files:
  - components/dialogs/JRDialog.bs
  - components/dialogs/JRDialog.xml
  - components/dialogs/JRListDialog.bs
  - components/dialogs/JRListDialog.xml
  - components/dialogs/JRListDialogRow.bs
  - components/dialogs/JRListDialogRow.xml
  - components/dialogs/JRKeyboardDialog.bs
  - components/dialogs/JRKeyboardDialog.xml
  - components/dialogs/JRDialogPanel.bs
  - components/dialogs/JRDialogPanel.xml
  - components/dialogs/QuickConnectDialog.bs
  - components/dialogs/QuickConnectDialog.xml
  - components/OverviewDialog.bs
  - components/OverviewDialog.xml
  - source/utils/dialogs.bs
  - source/utils/dialogLayout.bs
  - source/utils/dialogKeys.bs
  - source/utils/dialogResult.bs
  - source/utils/dialogNarration.bs
  - source/utils/buttonOverflow.bs
  - scripts/bsc-plugins/no-hand-rolled-dialog.cjs
last-reviewed: 2026-10-10
---

# The dialog family

JellyRock's overlay dialogs (alerts, confirms, choices, pickers, long read-only text, Quick Connect) are one family, with one look, one result contract and one layout flow. This doc is the standard. The on-screen keyboard shares the result contract but is Roku's own modal dialog ([below](#presenting-and-tearing-down)).

For how to show a dialog from a component, the short version is in [`components/CLAUDE.md`](../../components/CLAUDE.md). This doc is the full contract and the reasons behind it.

Two modal surfaces are still outside the family: `ItemGridOptions`, tracked as [`itemgridoptions-hand-rolled-dialog`](tech-debt.md#itemgridoptions-hand-rolled-dialog), and the subtitle search panel (`SubtitlePanel`), which has its own layout and focus model. The `no-hand-rolled-dialog` build rule stops new ones.

## Why this is a standard, not a style guide

The family exists because convention failed. `JRDialog`, `JRListDialog` and `OverviewDialog` each had a private copy of the chrome and of the layout arithmetic. When the #757 review restyled `JRDialog` (buttons inside the panel, a 3px edge, a short accent rule instead of a full-width divider), the other two kept the old look. The app shipped **two dialog looks with every check green**, because nothing asserted a single position, gap, color or asset.

So code backs the rules below, not agreement. `JRDialogPanel` owns the chrome. `dialogLayout.bs` owns the geometry, and it is pure and unit-tested. The component specs check rendered nodes rather than copies of the constants.

## Five decisions a new dialog does not make

If you are building a dialog, these are settled. Re-deciding any of them is how the app grew two looks the first time.

### 1. Chrome comes from `JRDialogPanel`

`JRDialogPanel` draws the dimmed backdrop, the panel with its 3px edge, the title and the short accent rule under it. You supply a body and a footer, nothing else.

Set its fields in this order. Nothing enforces it; `JRDialogPanel.xml` documents it, and a width set late makes the panel measure the title again.

```text
chrome.contentWidth = <panel width minus padding>
chrome.title        = "..."          -> the chrome measures and publishes titleHeight
observe titleHeight -> computeDialogLayout({..., titleHeight: chrome.titleHeight})
                    -> chrome.layout = layout
```

### 2. Geometry comes from `computeDialogLayout`

There is one vertical flow. The fixed-panel and outside-footer modes are gone:

```text
padding | title | TITLE_GAP | accent | BODY_GAP | [subheading | SUBHEADING_GAP |] body | BODY_GAP | footer | padding
```

The function is pure (no node access, no `m`, no globals), because layout was the part that could not be checked without a device, and it was the part that drifted. `tests/source/unit/utils/dialogLayout.spec.bs` covers it.

**Never work out a vertical gap, an offset or the ceiling in a component.** If you need a new offset, add a field to the layout, not arithmetic at the call site. The one local sum left is horizontal: `JRDialog` and `QuickConnectDialog` each center their button row in `centerButtonRow()`.

#### Placement: centered, or anchored

The flow above is the inside of the panel. Where the panel goes is also this function's job, and there are two answers:

| `anchor` | Placement | Used by |
|---|---|---|
| Omitted | Centered on screen | Every dialog except the overflow menus |
| `{ x, y, width }` | Left-aligned to the anchor when it fits before the right margin, else right-aligned to it, and grown upward from `anchor.y` | The **More** overflow menus (#788) |

Anchoring exists because a centered panel covers both the button row a menu belongs to and the metadata beside it. On `ItemDetails` the row is at y 800, and the title, date and stream lines start at x 96 and run toward the logo. A centered 900-pixel panel (x 510 to 1410) sits on top of them. A narrow panel anchored to the **More** button covers backdrop art instead.

**The side is derived, never assigned.** Left-aligned is preferred: the menu's left edge lines up with the button's, so it extends right, the way the eye already moves along the row. It flips to right-aligned, extending left from the button's right edge, only when the panel would cross the right margin. Both callers anchor to the last button slot of a left-to-right row, near the right edge:

| Surface | **More** at | Room to the right of its left edge | Room to the left of its right edge |
|---|---|---|---|
| `ItemDetails` | x 1168 | `704px` | `1256px` |
| OSD | x 1530 | `342px` | `1618px` |

So a narrow menu extends right on both surfaces, and a wide one (a long translation, longer labels) flips to extend left, where the room is. The two surfaces can end up on different sides, and that is the rule working: the side follows from where the anchor sits, so nobody decides it per surface and nobody can get it wrong for a third one. The flip depends on content, so a menu whose labels grow can change sides between builds. That is the usual behavior for anchored menus, and it keeps them on screen. Deciding from the anchor's position alone would be stable, but it would put every menu on one side whether it fit or not.

Overflow cannot be reached on either surface today (`ItemDetails` has 8 of its 8 buttons, the OSD 7 of 10; see the header of `buttonOverflow.bs`), so only the specs exercise these menus for now.

Before adding a third caller:

- **The ceiling moves with the anchor.** An anchored panel may only fill the band between the top margin and `ANCHOR_GAP` above its anchor, so it overflows sooner than a centered one. It reports that through the same `overflows` field, so `JRListDialog` needed no new overflow handling: its loop that drops rows and lays out again already reacts.
- **Upward is an observation, not a law.** Both callers have their row near the bottom of the screen. A row near the top needs a downward variant, and it belongs in `computeDialogLayout` beside the horizontal flip, not as a second placement mode somewhere else.

Build the anchor with `moreButtonAnchor()` (`source/utils/buttonOverflow.bs`) rather than measuring the rendered button. It derives the slot from the same arithmetic that set the button cap, so the anchor cannot drift from the button. It needs no conversion from local to screen coordinates, and it answers before the row has laid out.

### 3. The footer flows inside the panel

Always. There is no outside-footer mode.

`OverviewDialog` was the one exception, on the idea that a panel big enough to dominate the screen still reads as owning a button beneath it. A before-and-after capture on a device did not bear that out. The outside button looked like it floated on the dimmed backdrop, and the panel above it carried several hundred pixels of empty space, the space the button now uses.

The exception also cost a second ceiling. A footer below the panel is not part of `panelHeight`, so `PANEL_MAX_HEIGHT` did not cover it. A panel at exactly the ceiling put a 72-pixel button 18 pixels off the bottom of the screen while reporting `overflows = false`. With the footer inside, one ceiling covers both.

### 4. The panel follows its content, and the body is what gets clamped

No dialog fixes its own panel height. `computeDialogLayout` sizes the panel to what it is given, and clamps the body so the panel never exceeds `PANEL_MAX_HEIGHT` (924, a 78-pixel margin top and bottom).

`OverviewDialog` used to fix its panel, on the idea that a scrolling body cannot decide its own size. That is half true, and it was the wrong half. The panel width decides where text wraps, and the width is fixed, so the text's full height is known before any height decision.

`overflows` therefore means the body did not fit and was clamped. What to do about it is up to the caller:

| Dialog | Reads | Does |
|---|---|---|
| `JRDialog` | `overflows` and `body.height` | Truncates the message to the lines that fit in `body.height`. A confirm that scrolls should have been an info dialog. |
| `OverviewDialog` | `body.height` | Scrolls its viewport at exactly that height |
| `JRListDialog` | `overflows` and `body.height` | Drops rows to what fits and lays out again. The list scrolls, so every option stays reachable. |

**None of them works out the ceiling itself**, and that is the whole contract. A dialog asks for the body it measured and is told what it got. Only what to do about the difference is local.

#### A read-only body can be a paragraph or rows

`OverviewDialog` takes either `overview` (a string) or `sections` (an array of `{ id, heading, wideLabels, rows: [{ id, label, value }] }`). Both use the same scroll viewport, key model and narration, so the second is a body shape, not a second dialog.

This is the bespoke-dialog test ([below](#when-a-bespoke-dialog-is-legitimate)) coming out the other way. A two-column technical report is a body the family did not have, but it needed nothing else the family owns, so it became a field rather than a component. A separate playback-info dialog would have copied the scroll and narration code, the drift this family exists to prevent.

Two things follow:

- **`sections` can be set again, and reconciles.** When the new array has the same shape (the same ids in the same order), setting it rewrites the value text of each row and creates or destroys nothing. The panel height, scroll position and focus stay put. A different shape rebuilds. This lets the playback report refresh live figures behind an open dialog without breaking "set every text field before presenting": that rule exists because a dialog never lays out again after it mounts, and rewriting a one-line value changes no height.
- **The label columns have fixed widths, not measured ones.** Measuring the widest label needs a rendered pass, and this dialog has already learned that nothing may depend on which pass it is in. `wideLabels` picks the wider of two widths for rows whose labels are Jellyfin reason codes.

#### A list row's gutter holds one thing

`JRListDialogRow` reserves a fixed 36-pixel slot (`LIST_ROW_ICON_SIZE`, inside `LIST_ROW_CHECK_GUTTER`) on every row, so labels line up whether a row is marked or not. Two things can want that slot, and they never share it:

| Occupant | Set by | Color | For |
|---|---|---|---|
| The current-option check | `selectedIndex` | `colorSecondary`, a state marker | A picker (audio, subtitles, video source) |
| A leading action icon | The optional `icons` array | `colorTextPrimary`, part of the label, not a state | An action list, such as a **More** menu |

They cannot both apply: an action list passes `selectedIndex = -1`, so nothing is checked. The row still states which one draws (the check wins), because "cannot happen" is not a layout rule, and the alternative is two images stacked in one slot.

`icons` is a parallel array, paired by position with `items`, rather than a richer `items` shape. `items` is a plain string array the three playback pickers already pass, and a parallel field adds to the contract where a new item shape would change it. It has no `onChange`, so callers set it before `items`, the same order `defaultIndex` and `selectedIndex` rely on, since setting `items` builds the rows. A shorter array leaves the later rows without an icon.

### 5. A dialog has one kind of focusable thing

Buttons, or rows, or a scroll area plus its dismiss button. Not a mixture. That keeps each dialog type's key model small enough to state in a table.

## Key models

`JRDialog` and `OverviewDialog` handle keys differently, and that is not drift: a scrolling body needs up and down for the scroll, which a button row does not.

| Dialog | Left / right | Up / down | OK | Back |
|---|---|---|---|---|
| `JRDialog` | Step the button row (wraps) | Step the row only when stacked; otherwise consumed | Resolve with the focused button | Canceled result |
| `JRListDialog` | None | Step rows, wrapping both ways | Commit the row | Dismiss (the only exit; there is no Cancel button) |
| `OverviewDialog` | None | Scroll the body; past the end, move to OK | Dismiss (or move focus to OK) | Dismiss |
| `QuickConnectDialog` | Nothing: a one-button row steps back onto itself | Consumed | Canceled result | Canceled result |
| `JRDialog` with `anyKeyResolves` | Resolve | Resolve | Resolve | Resolve: every key answers |

`anyKeyResolves` exists for one question, "is anyone there?": the still-watching prompt (`showStillWatchingDialog`), where any press is the answer and making the viewer find a particular button would defeat it. It is a flag on the same model (`buttonDialogKeyAction`), not a second dialog.

`QuickConnectDialog` uses the same `buttonDialogKeyAction` as `JRDialog`. With one button, cancel and resolve are the same outcome, and the step actions have nowhere to go. It uses the shared model rather than two hand-written lines, because consuming up and down to keep focus inside the dialog is a choice worth making in one place. It used to make that choice by accident.

Two notes that keep being rediscovered:

- **`moveButtonFocus` wraps; it does not clamp.** That matches `JRButtonGroup`, the app's other horizontal row. A dialog that dead-ends feels broken.
- **A stacked row is navigated vertically.** `JRDialog.applyLayout` stacks the buttons when the row would be wider than `PANEL_MAX_WIDTH`, and `applyButtonLayout` then sets `layoutDirection = "vert"`. `buttonDialogKeyAction` maps up and down to the same step in that case only. Left and right work in both orientations, so no caller has to know which layout its labels produced. A horizontal row still consumes up and down: moving focus along an axis the user cannot see is its own bug.

**Shared key behavior belongs in `dialogKeys.bs`, not in a component's `onKeyEvent`.** The list dialog got this wrong once, in a way no test could reach. It found Cancel by catching a `down` that bubbled out of the list, which stopped happening above 8 rows when the list began wrapping inside itself. `OverviewDialog`'s scroll keys are its own, since no other dialog scrolls.

## When a bespoke dialog is legitimate

Rarely, and never for chrome or layout. The test: **does the dialog need a body the family does not have?**

`QuickConnectDialog` is the reference. It needs a code shown at `fontSizeLargest`, because the user reads it off a TV and types it on another device; a sentence fragment in a `message` would be wrong. It puts its instruction in the subheading slot, defined as a lead line inside the body's space, which is how "enter this code" relates to the code. The code goes in the body slot. **It works out no vertical offsets of its own.**

Everything else Quick Connect has to say ("that code expired", "the server has it turned off", "save these credentials?") is an ordinary dialog from `dialogs.bs`.

If you do build a bespoke one, **test the resemblance**. `QuickConnectDialog`'s spec compares its rendered panel with a rendered `JRDialog`'s, not with either file's constants: two constants the compiler does not connect will drift.

## Presenting and tearing down

The helpers and the result contract are in [`navigation.md`](./navigation.md#the-standard-dialog-system-sourceutilsdialogsbs).

`showOverflowMenu` looks like a new surface and is not. It presents the same `JRListDialog` (same chrome, key model, result contract and specs) with three presentation fields set: `anchor`, `sizeToContent` and `titleVisible = false`. Use it for a **More** menu hanging off a button, and `showListDialog` for everything else. If you need a fourth difference, add a field to `JRListDialog`, not a second component.

The keyboard (`JRKeyboardDialog`) is Roku's `StandardKeyboardDialog`, themed through `RSGPalette`. It returns the family's result shape but uses Roku's modal channel, not the family's chrome, layout or narration.

The rules that bite:

- **Set every text field before presenting, never after.** `renderTracking` fires once, on the change from none to full, so a dialog never lays out again after it mounts, and later text draws over the old layout. Measured on a device: [`jrdialog-no-relayout-on-post-mount-change`](./tech-debt.md#jrdialog-no-relayout-on-post-mount-change). The exception is a one-line field whose height cannot change: the still-watching prompt rewrites its countdown subheading every second.
- **One overlay dialog is on screen at a time.** `presentOverlayDialog` keeps it that way by canceling the current one through that dialog's own resolve guard.
- **Two teardown verbs, not interchangeable.** `abandonDialog` delivers nothing, which is right in `onDestroy`, where the receiving scope is dying. `cancelOpenDialog` delivers a canceled result, which is right when a third party needs the screen clear and the owner is alive and holding state.
- **A result handler that acts makes teardown order matter.** Ask of your own dialog: *does my result handler do anything besides read a value?* If it navigates, changes state or starts work, its owner must abandon it before anything else can call `cancelOpenDialog()`. A cancel looks exactly like the user pressing **Back** (see `JRDialog.cancelDialog`), so a third party clearing the screen fires your action, from inside their flow. Abandoning first drops the dialog and its observer, so the cancel finds nothing. The player hit this first: `PlayerHostView.prepareToLeaveMount()`, used by `onPlayerStateChange` and the Live TV stall path, calls `VideoPlayerView`'s `abandonErrorDialog()` before `cancelOpenDialog()`. It reaches the child through an `<interface>` `<function>`, the only way to call a child component's method in SceneGraph. Nothing about the hazard is specific to playback.
- **Abandoning cannot cover being replaced, so read `result.externallyCancelled`.** `presentOverlayDialog` cancels the current dialog through the same path, from a caller that cannot know it should abandon someone else's dialog first, so ordering has nothing to work with. The result therefore records who closed the dialog: `externallyCancelled` is true for `cancelOpenDialog` and for a replacement, and false for every user answer, **Back** included. An acting handler returns early on it; a handler that only reads a value ignores it. `OverviewDialog` has no `result`, so it carries the same signal on its own `externallyCancelled` field, set before `closed`. `VideoPlayerView`'s two playback-error handlers (`onPlaybackErrorDialogResult`, `onPlaybackErrorDetailsClosed`) are the reference for both. The keyboard cannot tell: Roku's modal `close` reads the same whether the user or code wrote it, so it reports `false`, a claim that the user closed it. That can happen: `presentOverlayDialog` never replaces the modal channel, but `cancelOpenDialog` does close it. Trust the field on the overlay family only, and do not build an acting handler on a modal dialog.

## Spacing, color and border weight

- **Spacing is a multiple of 6.** The 6-pixel rhythm is a design convention. Crisp edges at 720p come from where an edge finally lands, which `snapToGrid()` delivers and divisible constants do not. Panel widths step in 6 rather than 3, because centering halves the width.
- **Border weight shows interaction:** 3 pixels for static panel edges, 6 for focusable things. See the theme color table in [`components/CLAUDE.md`](../../components/CLAUDE.md).
- **The accent rule is `colorSecondary`, never `colorPrimary`.** `colorPrimary` is the theme's focusable color, the focus ring on the buttons in the same dialog, and the accent rule can never take focus.

## Narration

A scene-appended overlay says nothing unless it narrates explicitly. A Group gets only the scene's fallback rule, which speaks the focused descendant, and the things focus lands on in these dialogs are Groups the platform never announces.

Use `dialogNarration.bs`. The opening announcement is the one place a delay cannot be avoided: the platform's own focus announcement cuts ours off, and SceneGraph has no event for "the platform has finished speaking". The delay is `narration.OPENING_DELAY` in `dialogNarration.bs`, the only copy, used by every overlay dialog and by the library grid's load-failure state. It was set by ear on a device, and changing it needs an ear, not reasoning.

Checking narration across the app is [#759](https://github.com/jellyrock/jellyrock/issues/759)'s job, not a gate on every dialog PR.

## Known cruft

Tracked in [`tech-debt.md`](./tech-debt.md): search by `area` for dialog entries.
