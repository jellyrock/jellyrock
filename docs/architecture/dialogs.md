---
topic: dialogs
related-files:
  - components/dialogs/JRDialog.bs
  - components/dialogs/JRDialog.xml
  - components/dialogs/JRListDialog.bs
  - components/dialogs/JRListDialog.xml
  - components/dialogs/JRListDialogRow.bs
  - components/dialogs/JRKeyboardDialog.bs
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
last-reviewed: 2026-09-04
---

# The dialog family

Every modal surface in JellyRock — alerts, confirms, choices, pickers, long-form
readouts, the on-screen keyboard, Quick Connect — is one family with one visual
language, one result contract, and one layout flow. This document is the standard.

For *how to show one* from a component, the short version lives in
[`../../components/CLAUDE.md`](../../components/CLAUDE.md). This document is the
full contract and the reasoning behind it.

## Why this is a standard and not a style guide

The family exists because convention failed. `JRDialog`, `JRListDialog` and
`OverviewDialog` each carried a private copy of the chrome and a private copy of
the layout arithmetic. When the #757 review restyled `JRDialog` — buttons inside
the panel, a 3px edge, a short accent rule instead of a full-width divider — the
other two silently kept the old look. The app shipped **two dialog languages with
every gate green**, because nothing asserted a single position, gap, color or
asset.

So the rules below are backed by code that enforces them, not by agreement:
`JRDialogPanel` owns the chrome, `dialogLayout.bs` owns the geometry and is pure
and unit-tested, and the specs assert against **rendered nodes** rather than
against copies of the constants.

## The five decisions a new dialog does NOT get to make

If you are building a dialog, these are settled. Re-deciding any of them is how
the app grew two looks the first time.

### 1. Chrome comes from `JRDialogPanel`

The dimmed backdrop, the panel, its 3px edge, the title and the short accent rule
under it. You supply a **body** and a **footer**; nothing else.

The ordering is the contract, and it is the only rule the component enforces:

```text
chrome.contentWidth = <panel width minus padding>
chrome.title        = "..."          -> the chrome measures and publishes titleHeight
observe titleHeight -> computeDialogLayout({..., titleHeight: chrome.titleHeight})
                    -> chrome.layout = layout
```

### 2. Geometry comes from `computeDialogLayout`

One vertical flow, and after the fixed-panel and outside-footer modes were
deleted it is the **only** flow there is:

```text
padding | title | TITLE_GAP | accent | BODY_GAP | [subheading | SUBHEADING_GAP |] body | BODY_GAP | footer | padding
```

The function is pure — no node access, no `m`, no globals — because layout was the
part that could not be checked without a device, and it was the part that drifted.

**Never re-derive a gap, an offset or the ceiling in a component.** If you find
yourself adding an offset, the answer is a new field on the layout, not arithmetic
at the call site.

#### Placement: centered, or anchored to something

The flow above is the panel's *inside*. Where the panel goes is the same
function's job, and there are exactly two answers:

| `anchor` | Placement | Used by |
|---|---|---|
| omitted | Centered on screen | Every dialog in the family |
| `{ x, y, width }` | **Left**-aligned to the anchor where it fits, **right**-aligned where it does not, grown **upward** from `anchor.y` | The `More` overflow menus (#788) |

Anchoring exists because a centered panel is the one geometry guaranteed to cover
both the button row a menu belongs to *and* the metadata column beside it — on
`ItemDetails` the row is at `y=800` and the title, date and stream info are all
left of x≈500, so a `900px` centered panel sits on top of every one of them. A
narrow panel anchored to the `More` button covers backdrop art instead.

**The side is derived, never assigned.** Placement is preferred-plus-fallback,
the way an anchored menu is normally positioned: left-aligned is preferred, so
the menu opens under the button that spawned it in the direction the eye is
already moving; it flips to right-aligned only when the panel would not clear
the right margin. The fallback earns its keep because both callers anchor to the
*last* button of a left-to-right row, which sits near the right edge:

| Surface | `More` at | Room rightward | Room leftward |
|---|---|---|---|
| `ItemDetails` | x 1168 | `704px` | `1256px` |
| OSD | x 1530 | `342px` | `1618px` |

So every menu either surface builds today opens leftward under its button, and
only a wide one — a long translation, a longer label set — flips to where the
room actually is. The two surfaces can end up on different sides, and that is the
rule working rather than an inconsistency: the side is a consequence of where the
anchor sits, so nobody has to decide it per surface, and nobody can get it wrong
for a third one.

The flip is content-dependent, so a surface whose labels grow can change sides
between builds. That is the standard behavior for anchored menus and it is what
keeps them on screen; deciding from anchor position alone would be stable but
would put every menu on the same side regardless of whether it fit.

Two consequences worth knowing before adding a third caller:

- **The ceiling moves with the anchor.** An anchored panel may only occupy the
  band between the top margin and `ANCHOR_GAP` above its anchor, so it overflows
  sooner than a centered one. It reports that through the same `overflows` field,
  which is why `JRListDialog` needed no new overflow handling — the
  existing loop that drops rows and lays out again already reacts to it.
- **Upward is an observation, not a law.** Both current callers put their row near
  the bottom of the screen. A row near the top would need a downward variant, and
  it belongs in `computeDialogLayout` beside the horizontal flip — not as a second
  placement mode somewhere else.

Build the anchor with `moreButtonAnchor()` (`source/utils/buttonOverflow.bs`)
rather than measuring the rendered button. It derives the slot from the same
arithmetic that produced the cap, so the anchor cannot drift from the button it
points at, it needs no local-to-screen coordinate conversion, and it answers
before the row has laid out.

### 3. The footer flows INSIDE the panel

Always. There is no outside-footer mode.

`OverviewDialog` was the one exception, on the reasoning that a panel large enough
to dominate the screen still reads as owning a button beneath it. A before/after
capture on device did not support it: the outside button read as floating on the
dimmed backdrop, and the panel above it carried several hundred pixels of dead
space — the space the button now occupies.

The exception also cost a **second ceiling**. A footer below the panel is not part
of `panelHeight`, so `PANEL_MAX_HEIGHT` said nothing about it, and a panel at
exactly the ceiling put a 72-pixel button 18 pixels off the bottom of the screen while
reporting `overflows = false`. With the footer inside, one ceiling covers both.

### 4. The panel is derived from its content, and the BODY is what gets clamped

No dialog fixes its own panel height. `computeDialogLayout` sizes the panel to what
it is given and clamps the **body** so the panel can never exceed
`PANEL_MAX_HEIGHT` (924 — a 78-pixel margin top and bottom).

`OverviewDialog` used to fix its panel, on the reasoning that a scrolling body
cannot decide its own size. That is half true and it was the wrong half: the panel
**width** is what decides where text wraps, and the width is fixed, so the text's
natural height is fully known before any height decision.

`overflows` therefore means **the body did not fit and was clamped**. What to do
about it is the caller's, and the two answers differ:

| Dialog | Reads | Does |
|---|---|---|
| `JRDialog` | `overflows` | truncates the message to `body.height` worth of lines — a confirm that scrolls should have been an info dialog |
| `OverviewDialog` | `body.height` | scrolls its viewport at exactly that height |
| `JRListDialog` | `overflows` | drops rows to what fits and lays out again — the list scrolls, so every option stays reachable |

All three read the same two fields. **None of them re-derives the ceiling** —
that is the whole contract. A dialog asks for the body it measured and is told
what it got; what to do about the difference is the only part that is local.

#### A read-only body may be a paragraph OR structured rows

`OverviewDialog` takes either `overview` (a string) or `sections` (an array of
`{ id, heading, wideLabels, rows: [{ id, label, value }] }`). Both flow through the
same scroll viewport, the same key model and the same narration path — the second
is a body shape, not a second dialog.

This is the test in "When a bespoke dialog is legitimate" coming out the other way:
a two-column technical readout *is* a body the family did not have, but it needed
nothing else the family owns, so it became a field rather than a component. Adding
a `JRPlaybackInfoDialog` would have duplicated the scroll machinery and the
narration — the exact drift this family exists to prevent.

Two things follow from it:

- **`sections` is re-settable, and reconciles.** Setting it again rewrites the text
  of rows matched by `id` and creates or destroys nothing, so the panel height,
  scroll position and focus are untouched. A structurally different array rebuilds.
  This is what lets the playback report refresh live figures behind an open dialog
  without violating "set every text field BEFORE presenting" — that rule exists
  because a dialog never re-lays-out after mount, and rewriting a single-line value
  changes no height.
- **The label columns are fixed widths, not measured.** Measuring the widest label
  needs a rendered pass, and this dialog already learned that nothing may depend on
  which pass it is in. `wideLabels` picks the wider of two constants for rows whose
  labels are Jellyfin reason codes.

#### A list row's gutter holds ONE thing

`JRListDialogRow` reserves a fixed `36px` slot (`LIST_ROW_ICON_SIZE`, inside
`LIST_ROW_CHECK_GUTTER`) on **every** row, so the labels line up whether or not a
row is marked. Two things can want that slot, and they never share it:

| Occupant | Set by | Color | For |
|---|---|---|---|
| the current-option check | `selectedIndex` | `colorSecondary` — a state marker | a picker (audio, subtitles, video source) |
| a leading action icon | the optional `icons` array | `colorTextPrimary` — label content, not state | an ACTION list, e.g. a `More` overflow menu |

The two are mutually exclusive *by construction* — an action list passes
`selectedIndex = -1`, so nothing is ever checked — but the row states which one
draws rather than relying on that, because "cannot happen" is not a layout rule and
the alternative is two posters stacked in the same `36px` slot.

`icons` is a **parallel array positionally paired with `items`**, deliberately not a
richer `items` shape: `items` is a plain string array that three playback pickers
already pass, and a parallel field is additive where a union type is a contract
change. It carries no `onChange`, so callers set it **before** `items` — the same
ordering `defaultIndex` and `selectedIndex` already rely on, since `items` is the
field that triggers the row build. A short array simply leaves later rows without one.

### 5. A dialog has exactly ONE class of focusable thing

Buttons, or rows, or a scroll area plus its dismiss button. Not a mixture. This is
what keeps the key model per dialog type small enough to state in a table.

## Key models

`JRDialog.onKeyEvent` and `OverviewDialog.onKeyEvent` are different, and that
difference is **not** drift — a scrolling body needs up/down for the scroll, which
a button row does not.

| Dialog | left / right | up / down | OK | Back |
|---|---|---|---|---|
| `JRDialog` | step the button row (wraps) | step the row **only when stacked**; otherwise swallowed | resolve with the focused button | canceled result |
| `JRListDialog` | — | step rows, wrapping both ways | commit the row | dismiss (the only exit — there is no Cancel button) |
| `OverviewDialog` | — | scroll the body; past the end, move to OK | dismiss (or move focus to OK) | dismiss |
| `QuickConnectDialog` | no-ops — a one-button row steps back onto itself | swallowed | canceled result | canceled result |

`QuickConnectDialog` runs the same `buttonDialogKeyAction` model as `JRDialog`;
with one button, `cancel` and `resolve` are the same outcome and the two step
actions have nowhere to step. It is on the shared model rather than two
hand-rolled lines because swallowing up/down under modal containment is a
decision worth making on purpose in one place — it was making it by accident.

Two notes that keep being rediscovered:

- **`moveButtonFocus` WRAPS, it does not clamp.** Matching `JRButtonGroup`, the
  app's other horizontal row. A dialog that dead-ends feels broken.
- **A stacked row is navigated vertically.** `applyButtonLayout` switches to
  `layoutDirection = "vert"` when the row would exceed `PANEL_MAX_WIDTH`, and
  `onKeyEvent` maps up/down to the same `moveButtonFocus` in that case only.
  left/right keep working in both orientations, so no caller has to know which
  layout its labels produced. A **horizontal** row still swallows up/down under
  modal containment — moving focus along an axis the user cannot see is its own
  bug.

**Behavior belongs in `dialogKeys.bs`, not in a component's `onKeyEvent`.** The
list dialog's model got this wrong once in a way no test could reach: it found
Cancel by catching a `down` that *bubbled out* of the list, which stopped
happening above 8 rows when the list began wrapping internally.

## When a bespoke dialog is legitimate

Rarely, and never for chrome or layout. The test: **does the dialog need a BODY
the family does not have?**

`QuickConnectDialog` is the reference and the cheapest illustration. It needs a
code rendered at `fontSizeLargest`, because that code is a string the user reads
off a TV and types on another device — a sentence fragment in a `message` would be
wrong. It gets that by putting its instruction in the **subheading slot** (defined
as "a lead line inside the body's space", which is exactly the relationship between
"enter this code" and the code) and the code in the body slot. **It computes no
offsets of its own.**

Everything else Quick Connect has to say — "that code expired", "the server has it
turned off", "save these credentials?" — is an ordinary dialog from `dialogs.bs`.

If you do go bespoke, **gate the resemblance**. `QuickConnectDialog`'s spec compares
its RENDERED panel against a rendered `JRDialog`'s, rather than against either
file-scoped constant — two constants with no compiler relationship will drift.

## Presenting and tearing down

Full helper table and the result contract:
[`navigation.md`](./navigation.md#the-standard-dialog-system-sourceutilsdialogsbs).

`showOverflowMenu` is worth calling out because it looks like a new surface and is
not: it presents the **same** `JRListDialog` — same chrome, same key model, same
result contract, same specs — with three presentation fields set (`anchor`,
`sizeToContent`, `titleVisible = false`). Reach for it for a `More` menu hanging
off a button; reach for `showListDialog` for everything else. If you need a fourth
difference, add a field to `JRListDialog`, not a second component.

Four rules that bite:

- **Set every text field BEFORE presenting, never after.** `renderTracking` fires
  once on the none→full transition and never again, so a dialog never re-lays-out
  after mount and later text draws on top of the old layout. Measured on device —
  [`jrdialog-no-relayout-on-post-mount-change`](./tech-debt.md#jrdialog-no-relayout-on-post-mount-change).
- **Exactly one overlay dialog is on screen**, and `presentOverlayDialog` keeps it
  that way by superseding the incumbent through its own resolve guard.
- **Two teardown verbs, and they are not interchangeable.** `abandonDialog` delivers
  nothing (right in `onDestroy` — the receiving scope is dying); `cancelOpenDialog`
  delivers a canceled result (right when a third party needs the screen clear and
  the owner is alive holding state).
- **A result handler that ACTS makes teardown order load-bearing.** Ask one question of
  your own dialog: *does my result handler do anything besides read a value?* If it
  navigates, or mutates state, or starts work — then its owner must **abandon** it before
  anything else can `cancelOpenDialog()`. Cancel is deliberately indistinguishable from
  the user pressing `Back` (see `JRDialog.cancelDialog`), so a third party clearing the
  screen fires your action, and it fires from inside *their* flow. Abandoning first drops
  the dialog and its observer, so by the time the cancel runs there is nothing left to
  cancel. The player is the first surface to hit this — `PlayerHostView.onPlayerStateChange`
  calls `VideoPlayerView`'s `abandonErrorDialog()` before `cancelOpenDialog()`, reaching
  into the child through an `<interface>` `<function>` because that is the only way to call
  a child component's method in Scene Graph — but nothing about the hazard is
  playback-specific.
- **Being *superseded* is the case abandoning cannot cover, so read
  `result.externallyCancelled`.** `presentOverlayDialog` cancels the incumbent through the
  same path, from a caller that cannot know it should abandon someone else's dialog first —
  so ordering has nothing to work with. The result therefore records *who* closed the
  dialog: `externallyCancelled` is true for `cancelOpenDialog` and for a supersede, false
  for every user resolution including Back. An acting handler returns early on it; the
  reading handlers never look. `OverviewDialog` has no `result` at all, so it carries the
  same signal on a field of its own, set before `closed`. `VideoPlayerView`'s two
  playback-error handlers are the reference for both mechanisms. The keyboard dialog cannot
  report it — Roku's modal `close` reads the same whether the user or code wrote it — and it
  reports `false` rather than nothing, a positive claim that the user closed it. That answer
  is reachable, not theoretical: `presentOverlayDialog` never supersedes the modal channel,
  but `cancelOpenDialog` does close it. Trust the key on the overlay family only, and do not
  build an acting handler on a modal dialog.

## Spacing, color and border weight

- **Spacing is a multiple of 6.** The 6px rhythm is a design convention; *crispness*
  at 720p comes from where an edge finally LANDS, which `snapToGrid()` delivers and
  divisible constants do not. Panel widths step in 6 rather than 3, because centering
  halves the width.
- **Border weight encodes interaction state** — 3px for static panel edges, 6px for
  focusable things. See the theme-color table in
  [`../../components/CLAUDE.md`](../../components/CLAUDE.md).
- **The accent rule is `colorSecondary`, never `colorPrimary`.** `colorPrimary` is the
  theme's focusable color — it is the focus ring on the buttons in the same dialog —
  and the accent rule can never take focus.

## Narration

Every scene-appended overlay is **silent** without explicit narration: a Group gets
only Scene's fallback rule, which speaks the focused descendant, and the things focus
lands on in these dialogs are Groups the platform never announces.

Use `dialogNarration.bs`. The opening announcement is the one place a delay is
unavoidable — the platform's own focus announcement flushes ours, and SceneGraph
exposes no event for "the platform has finished speaking". `OPENING_ANNOUNCEMENT_DELAY`
was established by ear on device; changing it needs an ear, not reasoning.

App-wide narration *verification* is [#759](https://github.com/jellyrock/jellyrock/issues/759)'s,
not a gate on every dialog PR.

## Known cruft

Tracked in [`tech-debt.md`](./tech-debt.md) — search by `area` for dialog entries.
