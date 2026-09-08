# Rules for `tests/rta/`

On-device **RTA functional tests** (roku-test-automation). Node/ESM that drives a
real Roku from the dev machine via ECP + ODC. See
[docs/dev/rta-tests.md](../../docs/dev/rta-tests.md) for the full how-to.

**This is NOT Rooibos.** The `tests/` (Rooibos) rules do NOT apply here — this is
Node/ESM under Vitest, not BrightScript compiled into the app. Don't put `.spec.js`
files under `tests/source/**` (that tree is BrightScript-compiled); RTA tests live
here.

## ⭐ The north star: establish the state that makes an action or a read meaningful, BEFORE doing it

If you remember one thing when writing or editing an RTA test, remember this. It is the
single largest source of flakes in this suite: **five separate instances were found in one
day**, every one of them a test that acted before the app could answer, and every one of
them initially misread as an app bug.

It has two shapes, and the second is the one people miss:

- **Driving input too early.** The app legitimately swallows keys in load states — the
  player ignores Up until `stateAllowsOSD()` passes. A loop that starts pressing right
  after a Play press spends the whole window pressing at a component designed not to
  answer. These windows are longer than they look: playback start measured **~5-7 s on
  every device tested**, and it tracks stream start, not device speed.
- **Reading too early.** A screen can RENDER before its data arrives, so a gate proving
  "something is there" can be satisfied by placeholders, and a field can be stale rather
  than wrong. `waitHome()` passes on skeleton rows whose tiles carry no `.id` (measured
  window: **~1.35 s**), and `rowItemFocused` / `itemFocused` **retain their last value
  when the list is not focused** — so "grid loaded" is not "grid focused", and a walk
  started too early reads `[0,0]` forever while pressing at whatever does hold focus.

**The tell:** a timeout that blames a component — "tile not found", "screen never
loaded" — when the real cause is that we acted before it could respond. If a failure says
something is missing, ask whether it was ever asked at a moment it could have answered.

**How to satisfy it:**

- Gate on the state that makes the step meaningful (`state = playing`, focus inside
  `#itemGrid`), settle, then act. Not on a proxy for it.
- Poll the scan inside a bounded wait rather than scanning once, and put the retry in the
  **shared helper** so every caller inherits it instead of one call site.
- Distinguish **"not there YET"** (retry) from **"genuinely wrong"** (throw now) — an
  ambiguous multi-library match cannot be fixed by waiting, so it still fails fast.
- Never paper over it with a longer timeout or a fixed `sleep`. The wait was not timing
  out; it was succeeding too early.

There is a third shape, and it is the one that reads least like a harness bug: **acting
from a position the app gates on.** `Home.onKeyEvent` releases focus to the overhang only
when the active row list reports `rowItemFocused[0] = 0`; at any other index Up returns
false, the key bubbles away, and the walk that follows spends its whole timeout pressing at
a list that is not listening. Nothing about the state is "not ready" — Home is fully loaded
and answering — so every gate that means "loaded" passes. Two investigations of a
`focusOverhangIcon` timeout dead-ended here, because a healthy Home and a stuck one produce
an IDENTICAL focused keyPath (`#homeRows`) and only the row index tells them apart; that
field is now kept in the failure dump for exactly that reason.

Canonical examples: `waitOsdUp` (input, in [`lib/steps.js`](lib/steps.js)), `findHomeLibraryTile` ([`lib/nav.js`](lib/nav.js))
(scan), and the focus gates in `navLibraryByType` / `navMovieDetails` /
`openChildDetailByRowType` (stale reads). For the third shape, `walkHomeToFirstRow` in
[`lib/steps.js`](lib/steps.js) — shared rather than inlined at its one call site precisely
because the next Home-relative press will need it too, and it is unit-tested there against a
mocked device.

**A fourth shape, and the one that cost the most to find: a WALK that decides whether to
press from its own read of a lagging field.** `walkHomeRowsTo`'s column half used to do
exactly that, and it could stack a press on a key already in flight — `waitFor` runs
`action()` and THEN its predicate read, so the action read `[0,1]` while the device was
already at `[0,2]`, sent a Right, and the predicate's read then returned `[0,2]` and
satisfied the wait. The walk exited "successful" with an extra Right in flight, which landed
after the caller's probe and before its `Ok`.

Measured on `.177` 2026-09-07 with the press bracketed: focus reported `[0,2]`, the tile
there WAS the library asked for, Home's row structure was unchanged — and `rowItemSelected`
came back `[0,3]`, opening a different library. It fires in roughly one run in four. Note
what this defeats: a gate on the tile's content at the walked-to coordinates was tried and
**passed**, because it read the right cell and the press landed on the next one. **No
reading taken before the press can catch this** — the press has to be bracketed.

So a walk presses through [`scrollFocus`](lib/steps.js), which sends the exact distance as
one burst and re-presses ONLY for a key it can prove was dropped (the index unchanged across
a whole tick, then re-armed). If you are writing a loop that reads an index and presses
toward a target, you are writing this bug; reach for the helper. The one deliberate holdout
is `walkHomeRowsTo`'s ROW half, because `Home.onKeyEvent` releases focus to the overhang on
Up from row 0 — there an overshoot leaves Home rather than landing on the wrong tile, so it
was not converted on the strength of a column measurement.

**A guarded re-press must re-send the key that is actually still owed.** `waitOsdUp` re-sends
`Up` until the OSD is up; `focusOverhangIcon` pressed `Up` once and then re-sent `Right`, which
walks the row rather than leaving Home — so one lost `Up` could never be recovered and surfaced
as "the screen never loaded" (reproduced on `main`, 2026-08-18). `overhangWalkKey` in
[`lib/steps.js`](lib/steps.js) picks the key from the focused node for that reason, and warns
when it had to re-press, because a silently recovered escape tells you nothing the next time.

**Identify a dynamically-created node by `subtype`, never by `id` or a `#name` in its keyPath.**
RTA builds each keyPath segment from `node.id` while it is non-empty and from the child INDEX
otherwise, so a node created without an id is addressable only by POSITION, and a predicate
keyed on its name falls through to whatever its `else` branch does. That is a regression with
no failure mode of its own — it just quietly restores the bug you fixed. The live example is
`JROverhang`, which appends its `JRTabBar` via `CreateObject` and assigns no id — on the
`focusOverhangIcon` walk's own path, which is why `overhangWalkKey` matches
`HOME_ROW_LIST_SUBTYPES` rather than `#homeRows`. Home's row lists are the other example, and
#864 (2026-08-26) closed less of it than was claimed: assigning both ids at creation fixed the
tab ROUND TRIP, but only ONE list is in the scene at a time — `onTabChanged` `removeChild`s the
old one before building the new — so under another tab `#homeRows` is absent outright. Measured
on `.177` 2026-09-07: a focus gate and a `rowItemFocused` wait both THROW naming the real focus,
while `#homeRows.content.getChildCount()` **resolved in 8 ms to `undefined`**, which
`scanHomeLibraryTiles` turned into "0 rows" and reported as `home library tile not found` —
blaming a tile on a Home that was healthy under a different tab. That is fixed: the reads all
resolve the active list now, and the mechanism plus the measurements are recorded in
[`lib/home-list.js`](lib/home-list.js) and the rule that holds the line
([`rta-home-list-resolved.js`](../../scripts/lint/eslint-rules/rta-home-list-resolved.js)).

**Never name Home's row list by id.** `jellyrock-rta/home-list-resolved` permits `#homeRows`
/ `#favoritesRows` in exactly one module — [`lib/home-list.js`](lib/home-list.js), at a fixed
cap of two, one per id in `HOME_ROW_LIST_IDS` — and nowhere else. The 30 sites that used to
name one are now zero. Ask instead:

- **"where do I read Home's content?"** → `homeListId()` ([`lib/steps.js`](lib/steps.js)).
  It batch-reads `subtype()` off BOTH candidate ids in one round trip and returns whichever
  is in the scene, so the answer is independent of the selected tab. Absence becomes a named
  failure (`HOME_LIST_ABSENT`) instead of the `undefined` a caller turns into zero rows.
- **"is focus inside Home's content?"** → `focusIsInHomeContent` / `waitFocusInHomeContent`,
  which ask the FOCUSED node its `subtype`, as `overhangWalkKey` already did.

Probed on `.177` 2026-09-08: the focused node IS the row list at every state the walks reach
(after `waitHome`, after the containment gate, after a Down and after a Right), so asking by
subtype is not weaker than the keyPath containment test it replaced.

**Ask "is focus inside X?" through `focusIsInside` / `waitFocusInside`, never a hand-rolled
`keyPath.includes(...)`.** A container id always occupies a WHOLE keyPath segment (see the rule
above), so a substring test is strictly weaker than the question being asked: `#options` is a
substring of `#optionsPanelOverlay` — the reparenting host in
[`components/JRScene.xml`](../../components/JRScene.xml) — so the grid-options gate could report
the dialog focused for focus anywhere in that overlay. That is the north-star failure made
invisible twice over: it succeeds EARLY, so the blame lands on whatever times out next, and it
is introduced by NAMING a node rather than by touching a test, so no test diff reveals it.
`focusIsInside` normalises a missing `#` (`dialogs.spec.js` asks for `jrDialog`), so there is no
reason to reach past it. Gated in [`lib/steps.test.js`](lib/steps.test.js) against keyPaths
captured off `.178`, not invented ones.

## Why every wait polls

`roku-test-automation` ships a field OBSERVER (`onFieldChangeOnce`), and this harness
polls instead — 93 times. That is a deviation from the library's documented practice, so
the standing bar is that **every wait either follows that practice or says why it
deviates**. "It works" is not a justification; "the library's primitive is wrong here
because X" is.

The failure being guarded is quiet by construction. **A poll can only miss a state that is
a one-shot PULSE** — entered and left inside one interval. Such a wait does not fail
loudly, it fails *rarely*, and the timeout blames whatever it was watching rather than the
wait that sampled between frames. That is the symptom
[#785](https://github.com/jellyrock/jellyrock/issues/785) recorded as unattributable, and
it is why "it passes" was ruled out as evidence.

Six categories carry the justifications. The first three are properties of the CALL and
prove themselves; the rest are properties of the FIELD or of focus.

| Category | n | Why a poll, not an observer |
|---|---|---|
| Function `keyPath` | 12 | ODC observes a **field**. `getChildCount()` / `subtype()` are calls, not fields, so the primitive cannot apply at all. |
| Waits for absence | 1 | The node is gone. A departed node has no field left to observe. This is `waitDialogClosed`, whose JSDoc carries the argument on behalf of the ten dialog-dismiss sites that route through it. |
| `action:` retry loops | 7 | The per-tick re-press **is** the mechanism (see `resendIfSwallowed`). An observer would sit and watch for a key that never landed. |
| Plain field settle | 36 | The primitive could apply; it is ruled out below. |
| Dynamic `keyPath` | 2 | `scrollFocus`, whose keyPath is its caller's, and `waitHome`'s rows gate, whose list id is RESOLVED rather than named. Unclassifiable from syntax, so each carries a rule disable naming the reason and the argument lives in its docblock. |
| Focus containment (`waitFocusInside`) | 18 | ODC has no "observe global focus" primitive. Its request table (`RTA_OnDeviceComponent.brs`) offers `getFocusedNode` / `hasFocus` / `isInFocusChain` — all READS — and one observer, `onFieldChange`, which needs a node keyPath and a field name and so cannot express "wherever focus now is". |
| Focus containment by subtype (`waitFocusInHomeContent`) | 4 | Same absence of a primitive. Separate row because the QUESTION differs: Home's content is whichever of `HomeRows` / `FavoritesRows` the selected tab put in the scene, so it cannot be asked by container id at all. |
| Focus identity (`waitFocused`) | 15 | Same absence of a primitive, and focus is inherently terminal: it stays where it landed until the next key. There is no pulse to miss. |

*(12 + 1 + 7 + 36 + 2 = 58 `waitFor` CALLS, plus 18 + 4 + 15 focus waits = 95. Counts are
call sites, which is what the gate sees; a call is not always one wait. `waitDialogClosed`
issues one on behalf of ten sites, and `waitOsdUp` issues two on behalf of three.
Re-derived from the AST — never `grep`, which has now produced five wrong figures in this
project's history. The Home-list conversion moved three categories and **only those were
touched**: `waitHome`'s rows gate left `Function keyPath` for `Dynamic keyPath` (its id is
resolved now, so the syntax no longer shows the call), `homeListId`'s new `subtype()` wait
took its place in `Function keyPath`, and three containment waits moved to the subtype row.
Totals were derived from those known deltas rather than re-counted, because an ad-hoc
counter written for the occasion misclassified `scrollFocus` — whose keyPath is an
identifier — which is how a sixth wrong figure would have entered this file.)*

### The 36 plain-field waits, and the gate that keeps them honest

These are the ones an observer genuinely could serve, so they need the real argument.
Every one was checked against the app source, and **no target state is a one-shot pulse**
— each is either

- **terminal**, held until the next user action (`#osd.visible`, `#jrDialog.sections`,
  `#videoTitle.text`, the focus-index fields, …), or
- **recurrent**, re-entered if a tick misses it. `state` is the only one: Roku's
  `Video.state` re-enters `playing` after a mid-stream rebuffer, so it is *not* terminal,
  but a tick that misses it gets another.

Two were worth checking rather than assuming, because either could have been an animation
a poll samples between frames, and neither is: `#buttonBorder.blendColor` is assigned
directly on focus change ([`TextButton.bs`](../../components/ui/button/TextButton.bs)) with
no interpolator, and `#scrollContent.translation` is likewise a direct assignment
([`OverviewDialog.bs`](../../components/OverviewDialog.bs)).

**The one real pulse in the suite is `loadState === 'skeleton'`**, and it is not waited for
bare — `genre-skeleton.spec.js` widens the window first through the `rtaSkeletonHoldMs`
hook ([`LoadItemsTask2.bs`](../../components/ItemGrid/LoadItemsTask2.bs), compiled in only
under `ENABLE_RTA`). Widening the window in the app beats observing it from the harness,
because it keeps one answer to "how do we wait" instead of two.

**This is gated, not eyeballed.** `jellyrock-rta/wait-justified`
([`scripts/lint/eslint-rules/rta-wait-justified.js`](../../scripts/lint/eslint-rules/rta-wait-justified.js))
fails `lint:js` on a `waitFor` that lands in none of the four `waitFor` categories. The
first three it proves from the syntax; "this field is not a pulse" it cannot, because that
is a fact about how the APP writes the field. So it ratchets on the **field**, not the call
site: a keyPath in `VERIFIED_SETTLE_KEYPATHS` inherits its check for free, and one that is
not there trips the gate. Adding a sixth `#osd.visible` wait costs nothing; adding a wait
on a field nobody has read the app source for is exactly when the verification is owed, and
that is when it fires. A wait whose keyPath is a runtime value cannot be classified at all
— its justification goes in the owning helper's JSDoc and the call site disables the rule
with that reason.

The gate covers [`scripts/capture-screenshots.js`](../../scripts/capture-screenshots.js)
too: it imports the same `waitFor` and drives the same device, so a wait that hangs there
burns a device run just the same.

## Why the surviving sleeps are not arbitrary waits

`roku-test-automation`'s README says arbitrary waiting *"is almost never needed"*, and
[the north star](#-the-north-star-establish-the-state-that-makes-an-action-or-a-read-meaningful-before-doing-it)
above says it harder: never paper over a flake with a fixed `sleep`, because the wait was
not timing out — it was succeeding too early. So the same bar the waits carry applies
here: every `sleep()` either has no signal available to gate on, or it is a defect.

**Most of them are not waits at all.** Of **37** `sleep()` calls (derived from the AST),
**13 are poll ticks**: a `sleep` lexically inside a bounded loop that exits on its own
predicate. The interval sets sampling cadence and nothing else, and raising or lowering it
is a separate question this project puts out of scope. Worth stating plainly because it
reads as a surprise: [`lib/steps.js`](lib/steps.js), the file that owns every wait
primitive, contains **seven** `sleep()` calls and **zero** arbitrary waits.

That leaves **24 bare** ones, and they fall in six categories.

| Category | n | Why no signal was available |
|---|---|---|
| Paint / texture settle | 11 | After a `waitFor` gate has already passed, waiting for PIXELS. The app's only load-completion signal is the `cellLoad*` counter family — and it is `#if perfTiming`, which [`scripts/harden-prod-manifest.js`](../../scripts/harden-prod-manifest.js) forces OFF in `build:prod`. These navs are shared with `screenshots:capture`, which runs exactly that build, so on the path they serve there is provably no field to read. |
| Timer window | 5 | Out-waiting a period to prove a NON-EVENT. [`deeplink.spec.js`](specs/deeplink.spec.js) names it: *"Assert we never leave Home (a non-event → a bounded wait)."* Ungateable by construction — the only signal would be the very thing being disproven, and a dialog that must survive its own 5 s auto-hide cannot be gated on the timer under test. |
| App lifecycle | 4 | [`lib/driver.js`](lib/driver.js)'s `bootMs` / `exitMs`. The channel is down or coming up, so ODC cannot answer at all — there is no device to read from until the app exists. |
| Measurement window | 2 | The dwell IS the quantity being measured (a baseline phase, an extras-launch window). Gating it on a signal would change what is measured. |
| Async teardown | 1 | `retainedAfter`'s docblock states it: the teardown the last Back press started is finished by no app field that reports it. |
| Demo footage dwell | 1 | `hold(ms, label)` in [`demos/run.mjs`](demos/run.mjs) is a shot-list beat for the camera, not a wait on app state. Not a test. |

### The eight pre-action settles, and what replaced them

**They are gone — converted, not argued away.** A previous pass recorded eight
pre-action / pre-read settles as the unjustified residue: a fixed wait before `sendText`,
before sending input to a just-started player, before reading `buttonFocused` after a
forced focus, before reading focus back after a dialog closes. Each waited for a state
that plausibly HAD a readable signal, which is why they earned a conversion attempt rather
than a category argument. Every one of them did have a signal:

| Was | n | Is | The signal |
|---|---|---|---|
| before `ecp.sendText` | 1 | `waitFocusInside('#searchKey')` | `sendText` types into whatever holds focus, and `SearchResults.bs` only focuses the keyboard in `onScreenShown` — "nothing has focus until the router shows the view", a later turn of the event loop. |
| before the first OSD press | 3 | `waitOsdUp`'s state gate | The app's `stateAllowsOSD()` reads `m.top.state` on the player node, and `VideoPlayerView` stamps that node with the item id. So the precondition for the key is readable by id. |
| after walking focus into `#buttons` | 1 | `waitFocusInside('#buttons')` | `onGroupFocusChanged` re-asserts the group's index when it TAKES focus, so focus arriving is what makes the index read meaningful. |
| after a dialog closes | 2 | `waitFocusInside` on the opener | The dialog restores focus to its opener; waiting for it to ARRIVE can only pass by the restoration happening. |
| before recording a scroll position | 1 | `scrollFocus` | Covered below — the cause was removed rather than out-waited. |

*(1 + 3 + 1 + 2 + 1 = 8.)*

Two of them were not the conversion they looked like, and both are worth keeping in mind
before writing the next one:

- **`#buttons.buttonFocused` is not a gate.** The obvious wait — poll until it reads as a
  number — cannot fail, because
  [`JRButtonGroup.bs`](../../components/ui/buttongroup/JRButtonGroup.bs) sets it to `0` in
  `init()`. It answers long before any focus lands, so the wait returns on its first tick
  having proven nothing, and the read after it describes the group's PREVIOUS index. One
  site in `quick-connect.spec.js` had already been "converted" to exactly that shape —
  a no-op wearing a wait's clothes, which is why it never appeared in the sleep inventory
  at all. It now gates on focus like the rest.
- **Waiting for a state to STOP being true is not a gate either.** The settle after a
  dialog closes was followed by "focus is not on the dialog" — so polling for that would
  be satisfied by focus being nowhere at all, passing on the very state it exists to
  catch. The waits gate on focus ARRIVING at the opener, and the original assertion is
  kept beside them: different failures.

The last row was a different shape again — it waited out an in-flight keypress before
recording a scroll position in `genre-skeleton.spec.js`. That one routes through
[`scrollFocus`](lib/steps.js), which sends the exact distance as one burst and only
re-presses for a key it can prove was DROPPED, so the position it returns has stopped
moving. The cause was removed rather than out-waited.

### The gate

`jellyrock-rta/sleep-budgeted`
([`scripts/lint/eslint-rules/rta-sleep-budgeted.js`](../../scripts/lint/eslint-rules/rta-sleep-budgeted.js))
holds the bare-wait population to a declared per-file count, and a file with no entry has
a budget of zero. Poll ticks prove themselves from syntax and are never counted.

**Why a count rather than a per-site tag.** The sibling rule ratchets on the FIELD because
"this field is not a pulse" is reusable — verify `#osd.visible` once and every wait on it
inherits the check. An arbitrary wait has no such key: the argument is a property of the
call site's purpose, and most of the sites are anonymous spec arrows with no stable name
to key on. The alternative was a `// sleep: <category>` tag on every one, which is the shape
[Phase 3 already rejected](#the-37-plain-field-waits-and-the-gate-that-keeps-them-honest)
for the settle waits — annotations that say nothing a reader of the code needs.

A count cannot say WHICH argument a site claims; the table above does that per category.
What it does is make adding a thirty-third arbitrary wait a deliberate act with a second
file to edit and a reviewer-visible diff — which is the whole failure being guarded, since
a papering-over `sleep(2000)` and a legitimate paint settle are the same three tokens and
review cannot tell them apart.

**The match is exact, not a ceiling.** Removing a sleep is meant to fail the rule until
the budget is lowered, so the table stays an inventory rather than drifting upward into
permission. That includes emptying a file completely.

## The loops that are not `waitFor`, and why

Fourteen loops in the suite poll by hand. Five of them **are** the polling layer —
`waitFor`, `waitFocused`, `scrollFocus`, `waitCellsQuiet`, `waitRowsSettled` — and the
question does not apply to them. The other nine sites sit outside `waitFor`, which means
they are outside `jellyrock-rta/wait-justified` too, so each needs a reason written down
rather than a gate.

The reasons are structural, not preference. `waitFor` polls ONE keyPath, on ODC, and
throws through `diagnosedError`, which reads the device to attach a state dump. A loop that
breaks any of those three cannot use it.

| Loop | Why not `waitFor` |
|---|---|
| `findHomeLibraryTile` ([`lib/nav.js`](lib/nav.js)) | A multi-read SCAN: N reads per tick over a tree that changes under it, with a third exit for genuine ambiguity. `waitFor` polls one keyPath and has two outcomes. |
| `openChildDetailByRowType` ([`lib/nav.js`](lib/nav.js), two loops) | Same scan shape. |
| `waitMediaPlaying` ([`lib/steps.js`](lib/steps.js)) | Reads the OS media player over **ECP** (`ecp.getMediaPlayer()`). There is no keyPath, because there is no node — it is a different transport answering about a different thing. |
| `stopPlayback` ([`lib/steps.js`](lib/steps.js)) | Same ECP transport, and it deliberately does NOT throw: it is cleanup, run on the way out of a step that already succeeded or already failed, and a throw here would replace a real failure with a teardown one. `waitFor` always throws. |
| `waitSceneAnswering` ([`lib/driver.js`](lib/driver.js)) | Polls for the scene answering AT ALL, before the app has a screen. `diagnosedError` reads the device, so the diagnostic would fail on the same condition as the wait and bury the real message. |
| the `gaaProbeResult` poll ([`specs/gaa-thread-scope.spec.js`](specs/gaa-thread-scope.spec.js)) | Polls the return value of a `callFunc` — a Task's own state — not a field. Same reason the function-`keyPath` category exists: ODC observes fields, and a call is not one. |
| `startPolling` ([`specs/task-thread-peak.spec.js`](specs/task-thread-peak.spec.js)) | Not a wait at all. It is a SAMPLER with no exit predicate: it runs until told to stop and collects a series, and the series is the measurement. |
| `ensureOdcReachable` ([`lib/driver.js`](lib/driver.js)) | Polls a raw TCP connect, not ODC — it is what runs BEFORE the first ODC call of a run, to establish that there is a component to call. Same shape as `waitSceneAnswering` one layer earlier, and for the same reason: `waitFor` would have to reach the device to poll and again to diagnose, on exactly the condition being tested. |

**One was convertible and has been converted.** `waitGridLoaded` hand-rolled its poll for
no reason that survived being written down — one keyPath, one predicate, one reader,
throws on timeout. It now routes through `waitFor`, which is what gave `waitFor` its
optional `kind`: converting without one would have merged `grid-load-timeout` into the
bucket every other wait shares.

**One was a duplicate, and the duplication hid a defect.** Two specs had each written out
"wait until the scene answers". They were recorded as byte-identical and were not — the
bench spec threw on timeout, and the other ran a bounded `for` that simply fell through, so
a scene that never answered went on to `createChild` and failed there, blaming the child
for the app not being up. They now share `waitSceneAnswering`, which throws. That the two
copies disagreed about failure behaviour, of all things, is the argument for sharing them.

**`waitSceneAnswering` is not a replacement for `bootMs`.** `relaunch()` also runs against
`ENABLE_RTA=false` builds, where ODC never answers — polling there would burn the full
timeout on every call instead of sleeping once. The app-lifecycle sleeps stay.

## Focus is walked, never teleported

`odc.focusNode` sets focus straight onto a node. That skips the key handler which would
have moved it there — so a spec can arrange a state the remote cannot actually reach and
still pass green, which is the one failure a device suite exists to make impossible. The
suite therefore does not use it, and `no-restricted-syntax` says so in `eslint.config.js`:
walk with `walkFocusInto(key, containerId)` from [`lib/steps.js`](lib/steps.js).

**It used to use it four times, and the inventory recorded that as zero.** The Appendix's
"correctly unused" row was wrong from the day it was written; the four sites were
`quick-connect.spec.js` (into `#buttons`) and `dialogs.spec.js` (into `#buttons`, and
twice into `#itemDescription`). Every one now presses the keys a viewer presses.

**What the teleports were standing in for turned out to be untested app code.** The
ladders are real and reachable in both directions:

- UserSelect focuses `UserRow` in `init()` (`UserRow.bs:8`), and one Down reaches the
  button group (`UserSelect.bs:564`). Unconditional — a single rung.
- ItemDetails is two-branched. Up from the button group targets an interactive track
  dropdown when there is one and falls through to the description when there is not
  (`ItemDetails.bs:4271`); Up from a CLOSED dropdown arrives via `requestFocusReturn` ->
  `onDropdownRequestUp` (`ItemDetails.bs:3898`). So the rung COUNT is a property of the
  fixture's tracks, not of the app.

That second point is why the walks are guarded loops rather than counted presses. A fixed
number of Ups is right on one server and wrong on another; pressing until focus ARRIVES is
right on both, and it is the same shape `focusOverhangIcon` already uses for the overhang.

**Two properties make a walk safe, and both live in `walkFocusInto`.** It presses only
while focus is not yet inside the target, so arriving stops it and it cannot press on into
whatever the target opens. And the containment test goes through `focusIsInside`, never a
hand-rolled `keyPath.includes(...)` — substring matching reports `#options` as inside
`#optionsPanelOverlay`, and consolidating that onto one predicate was its own phase of
work. Its unit tests gate both, including the substring case.

**A walk costs a tick per rung.** A site converted from a teleport has to budget for the
presses instead of inheriting the timeout an instant `focusNode` was happy with — the two
description sites went 5 s -> 8 s for exactly this reason. Watch for it in review: a
converted site that kept its old timeout is the shape that goes flaky on the slower device
rather than on the one it was written against.

## Why the ODC transport config is left unset

[`lib/driver.js`](lib/driver.js)'s `setupRtaEnv()` hands the device only `host`,
`password` and `screenshotFormat`. Three transport knobs the library offers —
`defaultTimeout`, `timeoutMultiplier` and `disableCallOriginationLine` — are deliberately
unset, and the first of those must stay that way.

**`disableCallOriginationLine` stays off, and it is not a deferred optimization.** The
library bills it as a small overhead: it builds an `Error` per request purely to capture a
stack. What that `Error` buys is the reason this suite exists — on a failed request the
client rejects with THAT error instead of one constructed inside its own socket callback,
so the stack names your call site rather than the library's async internals. Enabling it
would trade attributable failure for **1.54 µs per request** (measured; the `.stack` string
is only materialized on the failure path, at 6.22 µs). Even at a wildly generous 100k
requests in a suite that is 154 ms. Read the row in any capability inventory that calls
this a pending win as already answered: the answer is no.

**`defaultTimeout` and `timeoutMultiplier` have no value worth setting.** Unset, every
request gets a 10 s ceiling. On `.177` — the *slower* of the two devices — a healthy round
trip is ~5.4 ms, and the two-round-trip failure capture runs a median 21 ms (18–30 ms,
n=20). The ceiling therefore sits some 1800× above the thing it bounds, with no tail at
n=20 to argue about. Scaling it *up* only delays a failure no run has recorded; scaling it
*down* is not a per-device question, which is what `timeoutMultiplier` is for. And the
failure that genuinely takes a device out — `rta-odc-connect-hang` in
[`docs/signals-backlog.md`](../../docs/signals-backlog.md) — is a socket handshake that
never settles, while the per-request timeout wraps the *request*. Neither field can reach
it.

**What DOES reach it sits outside the config, in two pieces that cover different halves.**
Neither is sufficient alone, so do not delete one on the strength of the other:

- `ensureOdcReachable` ([`lib/driver.js`](lib/driver.js)) refuses to make a run's first ODC
  call until a raw TCP probe says the component is there. That is the only thing that
  handles the common case, because a connect RTA cannot complete does not merely fail — it
  rejects a promise the library then orphans through its own unattached `.finally()`
  (`OnDeviceComponent.js:1080`), and an unhandled rejection is a hard `exit 1`. Measured
  2026-09-06: a caller that awaits, catches and carries on still dies. The orphan is
  unreachable from our code, so this is not a thing a `try`/`catch` or a `withTimeout` can
  be added to fix — the call has to not be made. Mechanism and the control that proved it
  are in [`scripts/lib/odc-probe.js`](../../scripts/lib/odc-probe.js).
- `REGISTRY_READ_TIMEOUT_MS` ([`lib/registry.js`](lib/registry.js)) then bounds the read
  itself, because the probe answers "is the port open" and the hang above happens with the
  port **open** — measured `true` in ~1 ms against a socket that accepts and never replies,
  while the ODC call beside it was still pending at 45 s.

**Know this about the 10 s ceiling: it is longer than some of the waits that contain it.**
`waitFor` checks its deadline at the top of a tick and then awaits a read the loop does not
bound, and 23 wait sites carry a total budget under 10 s (8 at 5 s, 15 at 8 s). So a single
request that times out can outlast the whole wait, and a `waitFor(…, {timeout: 5000})` can
report `waitedMs: 10500`. That is not a wait misbehaving — it is two layers keeping
independent clocks, and the message already says which one moved: a read that did not
complete is counted and named (`readErrors=n`), which is precisely what that counter was
added for. It is left as-is rather than tightened because no run has ever recorded such a
timeout, and a ceiling low enough to fit the shortest wait would be picked with no device
baseline to justify it — inventing the flake class this harness exists to remove.

The one call that sets its own ceiling is `readIdentity` in
[`scripts/measurement-guard.js`](../../scripts/measurement-guard.js), at 5 s; the value
carries no recorded reason. Every other ODC call in the repo runs on the 10 s default.

## The ODC capability inventory — what we use, and why we don't use the rest

`roku-test-automation`'s client exposes **47 public methods** on `OnDeviceComponent`. This
suite calls 14 of them. The bar this section exists to hold is the charter's: *an unused
primitive is fine when there is a recorded reason, and a defect when there is not.* "We
never needed it" is a reason; silence is not.

It is **gated**, so it cannot go stale the way it already did once: `npm run
lint:rta-capabilities` reads the method names straight out of the installed
`client/dist/OnDeviceComponent.d.ts` and fails if any is missing from the block below, or
if the block names a method the library no longer ships. That second direction is the one
that matters — the library removed `getNodeReferences` and replaced it with `getNodesInfo`
in a past release (its README records the swap), which is exactly how an inventory written
once drifts into fiction.

<!-- rta-capability-inventory:start -->

### Used (14)

| Primitive | Where, and what for |
|---|---|
| `getValues` | The batch reader every wait routes through (`getVals` / `getActiveVals`). A keyPath that does not resolve comes back `found: false` rather than failing the batch, which is what lets one fixed request set cover every screen. |
| `getValue` | Single reads in [`lib/driver.js`](lib/driver.js) / [`lib/steps.js`](lib/steps.js) where there is genuinely one keyPath. |
| `getFocusedNode` | Every focus predicate — `focusIsInside`, `waitFocused`, `focusIsInHomeContent`, and the failure dump. |
| `callFunc` | The bench specs' harness nodes, and [`scripts/crash-report.js`](../../scripts/crash-report.js). |
| `setValue` | Arranging state the app cannot be walked into — [`lib/nav.js`](lib/nav.js), `dialogs.spec.js`, `genre-skeleton.spec.js`. |
| `createChild` / `removeNode` | The four bench specs create a measurement node under the scene and tear it down again; `capture-screenshots.js` creates one too. Paired on purpose — a bench that leaves its node behind would be caught by the leak gate as an app defect. |
| `readRegistry` / `writeRegistry` / `deleteRegistrySections` | [`lib/registry.js`](lib/registry.js)'s snapshot / verified-restore, and [`lib/seed.js`](lib/seed.js)'s session seeds. |
| `getRootsCount` / `getAllCount` | The leak gate's two censuses (`specs/leaks.spec.js`). `getRoots()` is the assertion; `getAll()` is recorded but not asserted — see that file for why both. |
| `storeNodeReferences` | [`lib/resolution.js`](lib/resolution.js)'s node-resolution audit — one whole-scene census per audited read, behind `RTA_AUDIT_RESOLUTION=1`, report-only. |
| `writeFile` | `capture-screenshots.js` pushing an image to the device. The only filesystem call this repo makes. |

### Evaluated and rejected (8)

These are the ones that *look* like they should be used. Each was tried or read against the
device and turned down for a reason, not skipped.

| Primitive | Why not |
|---|---|
| `focusNode` | Teleports focus, skipping the key handler a viewer's remote would exercise. All four former sites now walk with real presses through `walkFocusInto`; `no-restricted-syntax` bans it. See *Focus is walked, never teleported*. |
| `onFieldChangeOnce` | The library's observer primitive, and the obvious answer to "why poll?". Ruled out per-category in *Why every wait polls* — recorded as `rta-waits-poll-not-observe`. |
| `isInFocusChain` / `hasFocus` | Both resolve by the same recursive id lookup that a suspended Home's hidden `OptionsSlider` wins, so `isInFocusChain` is *wrong* at the `#options` site. `focusIsInside` answers the same question locally, off the keyPath the focus read already returned, at no extra round trip. |
| `disableScreenSaver` | Declined in favour of DETECTING a running screensaver in the failure dump. It works by adding a hidden `Video` node whose effect outside the render tree was never measured, must be re-issued after every relaunch, and would delete the very signal the dump reports. Recorded as `rta-screensaver-detect-not-suppress`. |
| `isShowingOnScreen` | Looks purpose-built for the resolution audit and answers in 5–10 ms, but **hung indefinitely on one probe run with no mechanism found**. The `storeNodeReferences` census carries `visible` / `opacity` anyway, so depending on it would buy nothing and import an unexplained hang into the wait path. |
| `getNodesWithProperties` | Needs a prior whole-tree `storeNodeReferences` walk and returns `nodeRefs`, never the `[row, col]` a focus walk needs. |
| `getNodesInfo` | Its documented purpose is field-TYPE introspection for the vscode SceneGraph Inspector; a declared field type is in the app's own XML, readable at authoring time for free. Worse, it dumps EVERY field: measured on `.177` 2026-09-08, `getNodesInfo` on `m.global.user` returned `authToken` **with a live 32-character value**, and node-valued fields expand one level (`config` 29 + `policy` 47 + `settings` 77 keys, a 16-field node producing 5963 bytes). That is exactly the whole-node read [`lib/diagnostics.js`](lib/diagnostics.js) refuses under *What it never reads*, because `runs.jsonl` is never reset. `getValues` covers the batch-read need without it. |

### Not applicable (25)

Grouped, because the argument is per family rather than per method.

**Device filesystem — `createDirectory`, `deleteFile`, `getDirectoryListing`, `getVolumeList`, `readFile`, `renameFile`, `statPath`.** These address the device's storage (`tmp:/`, volumes), not the SceneGraph. This suite asserts UI state; its one filesystem need is pushing a screenshot *to* the device, which `writeFile` covers. Nothing here reads device files back — artifacts are written on the dev machine by [`scripts/run-record.js`](../../scripts/run-record.js).

**Responsiveness testing — `startResponsivenessTesting`, `getResponsivenessTestingData`, `stopResponsivenessTesting`.** Undocumented in the library README (they exist in the client but have no section), and this repo already has a purpose-built measurement stack — `scripts/measure*.js`, the task-ledger benches, and the app's own instrumentation — whose numbers are comparable across the historical record. Adopting a second, undocumented one would fork that record.

**Node-reference lifecycle — `assignElementIdOnAllNodes`, `deleteNodeReferences`, `convertKeyPathToSceneKeyPath`.** The audit takes its census under one fixed `nodeRefKey`, and the device *replaces* that array on each call (`processStoreNodeReferencesRequest` clears before it walks), so references cannot accumulate and there is nothing to delete between censuses. The obvious worry — that a census left holding nodes would inflate the leak gate's roots count — was **measured on `.177` 2026-09-08 and does not occur: 108 nodes stored, roots 14 → 14 → 14, zero inflation**, because `buildTree` walks from `m.top.getScene()` and can therefore only capture *parented* nodes, which `getRoots()` excludes by definition. What that does NOT cover is a census taken while a view is open and the view then closed, which would leave the array holding an unparented node; in the leak gate that ordering is prevented by the `hardRelaunch()` at the head of each measurement and by the walk ending on Home. **If the audit is ever asserted on, or its 200-census budget is raised so it can exhaust mid-walk, `deleteNodeReferences` becomes owed.** `assignElementIdOnAllNodes` serves `base: 'elementId'`, which nothing here uses, and `convertKeyPathToSceneKeyPath` converts `appUI` paths, which nothing here produces.

**Coordinate hit-testing — `findNodesAtLocation`.** Answers "what is at x,y". A Roku is driven by a directional remote, not a pointer, so a test that asserted by screen position would assert something no user can do and would break on every layout change. The suite's whole input model is *walk focus with real presses*.

**Component-private state — `getComponentGlobalAAKeyPath`, `setComponentGlobalAAKeyPath`.** Read and write a component's own `m`. That is implementation-private state, and coupling assertions to it is the opposite of the north star: a test that reads `m` passes on a component whose declared interface is broken. `m.global` is different and IS used via `getValue`/`setValue` — it is an app-owned, declared surface.

**Client and transport lifecycle — `cancelRequest`, `setSettings`, `shutdown`, `getServerHost`.** The client drives these itself: `setSettings` is part of RTA's own post-connect handshake, `cancelRequest` backs its request bookkeeping, and `getServerHost` reports a host we configured in the first place. Teardown is owned by [`scripts/rta-run.js`](../../scripts/rta-run.js), which ends the run by process exit after restoring the registry, so there is no point at which the suite would call `shutdown` itself.

**Whole-registry destruction — `deleteEntireRegistry`.** Deliberately never issued. `lib/registry.js` restores by explicit section with `APP_OWNED_KEYS` carved out, and a blanket wipe is precisely the operation that destroyed a device's registry during Phase 7 — unrecoverable, because no run record captures the pre-run registry shape. The narrower `deleteRegistrySections` is what restore needs and all it gets.

**Repeating observer — `onFieldChange`.** The repeating sibling of `onFieldChangeOnce`, and the same argument retires it: see *Why every wait polls*. It is strictly further from the polling model, since a repeating observer also has to be torn down.

**Redundant with a cheaper read — `isSubtype`, `getApplicationStartTime`.** `isSubtype` answers about one node per request, while `subtype()` is a function keyPath that rides inside an existing `getValues` batch — `homeListId()` reads it off *both* candidate ids in a single round trip, which `isSubtype` would cost two calls to do. `getApplicationStartTime` exposes `roAppManager.getUptime()` for perf work that the app's own instrumentation and `bootMs` already cover; it is the one row here with a plausible future use, if boot timing ever needs device-side truth rather than the harness's wall clock.

**Node surgery — `removeNodeChildren`.** The bench specs own exactly one node each and remove it whole with `removeNode`. Stripping a node's children while leaving it in the tree is an app operation, and this suite does not reach into the app's structure to perform one.

<!-- rta-capability-inventory:end -->

## Layout

- `config.js` — `RTA_CONFIG` (demo server, hero movie, seek position, locales). Shared with the store screenshot generator.
- `screens.js` — the **screen registry**, the single source of truth for both the tests and the screenshots. Add a screen here.
- `lib/` — `driver` (env + deploy + relaunch), `steps` (press/getVal/waitFor/waitFocused, plus the shared media-player waits used by both the deep-link spec and the demo runner, and the shared Home preconditions `waitHome` / `walkHomeToFirstRow`), `seed` (registry seeds), `registry` (whole-registry snapshot/verified restore), `jellyfin` (demo REST), `nav` (per-screen navigation), `diagnostics` (failure-time device-state dump + the `FAILURE_KINDS` registry). The run record it writes into — directories, lifecycle, ledger, summary — lives in [`scripts/run-record.js`](../../scripts/run-record.js), which is shared with the Rooibos runner and knows nothing about devices.
- `specs/` — the Vitest specs (a `for` loop over `SCREENS`, not `it.each`: `it.each` passes only the case object, so a case can't skip itself at runtime, and content-dependent screens need exactly that).
- `capture.js`, `setup/` — the `RTA_CAPTURE` raw-capture helper and Vitest global/per-worker setup.
- `demos/` — hands-free **video-capture** takes (`npm run demo`). `run.mjs` owns the privacy-safe lifecycle (snapshot → record gates → restore + relaunch); each `takes/*.js` declares only its choreography. NOT tests — these drive the device for marketing/PR demos against the public demo server only (the runner refuses any non-demo host).

## Rules

- **Run `npm run test:rta` to verify no RTA/nav regressions** after touching `tests/rta/`, `scripts/capture-screenshots.js`, or app navigation/screens. Needs hardware + `.env` (`ROKU_IP`/`ROKU_PASSWORD`); if no device, say so — don't claim a pass.
- **CI runs this suite only on the release-prep branch** ([`rta-functional-tests.yml`](../../.github/workflows/rta-functional-tests.yml)) — there is one physical device and a full pass is ~10–15 min, so it is not a per-PR gate. That makes the local run above the *only* feedback a PR gets: a regression you don't catch here surfaces at release, after N merged PRs, where bisecting it is much harder. See [`docs/dev/rta-tests.md`](../../docs/dev/rta-tests.md#when-ci-runs-it).
- **Use `npm run test:rta:capture` (or `RTA_CAPTURE=1`) to view the GUI** when modifying or designing UI — it dumps `out/rta-captures/<screen>.png`. The OSD's video plane is black there (expected); the polished store images come from `screenshots:capture`.
- **Every wait must land in a justified category — see [Why every wait polls](#why-every-wait-polls).** The harness polls where the library offers an observer, so each wait says why. `jellyrock-rta/wait-justified` fails `lint:js` on a `waitFor` that fits none of the four, and a new plain-field wait on an unverified keyPath is the case it fires for: read where the app writes that field, confirm the target state is not a one-shot pulse, then add it to `VERIFIED_SETTLE_KEYPATHS`. Never add a keyPath you have not checked — an unverified entry is worse than a red lint, because it looks like it was checked.
- **A fixed `sleep` is never the fix for a flake — see [Why the surviving sleeps are not arbitrary waits](#why-the-surviving-sleeps-are-not-arbitrary-waits).** The wait was not timing out, it was succeeding too early, so gate on the state that makes the next step meaningful instead. `jellyrock-rta/sleep-budgeted` holds each file's bare-`sleep` count to a declared budget (a `sleep` inside a poll loop is a tick and is never counted), so a thirty-third arbitrary wait cannot land without someone editing the table and saying which category it falls in. **Removing one also fails the rule** until the budget is lowered — the table is an inventory, not a ceiling.
- **`waitFor`/`waitFocused` throw on timeout — that IS the assertion.** Don't wrap them in `expect`. Use `expect` only for value checks (label text, focus subtype).
- **A predicate that compares one device read against ANOTHER must assert the second one was read.** Reading a value off the screen and then waiting for something to equal it is a good pattern — `dialogs.spec.js` identifies the confirm buttons by their rendered labels rather than hardcoding translated strings, which is why it survives a locale change. But an absent read answers `undefined`, and so does a focused node that simply has no such field: `f.node?.text === confirmLabel` with `confirmLabel` unread is `undefined === undefined`, so the wait passes on its first tick with focus **anywhere**, and every assertion built on it is vacuous. It needs only ONE of the two to be absent — a dialog that renders one button leaves `#buttonRow.1.text` undefined while `.0.text` reads fine. Assert the reads before comparing anything to them, and assert they DIFFER where the test distinguishes them (two labels that matched each other would break a wrap assertion the same way). Audited by AST 2026-09-07: ten sites compare against a device read, and the guard was already present at three of the four — [`deeplink.spec.js`](specs/deeplink.spec.js) throws from a setup loop, [`demos/takes/server-switch.js`](demos/takes/server-switch.js) throws on the identical pair of label reads, and the colour comparison in [`dialogs.spec.js`](specs/dialogs.spec.js) asserts the two differ. Only the label pair beside it had drifted. **Not gated** — the three guards use three different idioms and one of them is a `for…of Object.entries` loop, so a rule would be pattern-matching prose; if this recurs, the fix is to normalise onto one shared guarded reader and gate on *that*, not to teach a linter three shapes.
- **An ordering assertion over `indexOf` / `findIndex` must also assert its operands were found** — `-1` is less than every real index, so `expect(a.indexOf(x)).toBeLessThan(b.indexOf(y))` passes when `x` is absent entirely. This is gated repo-wide (`jellyrock-tests/ordering-asserts-presence`, [rule](../../scripts/lint/eslint-rules/ordering-asserts-presence.js)), including this directory's `*.test.js` files, and it has no escape hatch because the fix is always one line: `expect(haystack).toContain(needle)`, or `expect(idx).toBeGreaterThan(-1)` for a `findIndex`.
- **A spec that MEASURES across a journey must assert the journey happened.** A gate whose number is collected while the app is driven has a second precondition beyond its bound: that the driving actually occurred. Record a phase failure instead of throwing when the sample series is the deliverable — that part is right, and losing every sample to one missed focus gate is the worse trade — but then ASSERT the recorded failures are empty, after the artifact is written, so the series survives the throw. Left unasserted it is a vacuous gate of the same family as the two rules above, and a worse one, because it reads as coverage of a crash class. Real case (`.177`, 2026-09-08): both journey phases of [`task-thread-peak.spec.js`](specs/task-thread-peak.spec.js) timed out returning to Home, the test PASSED, and it reported `peakLive: 7` — *below* the 9-11 that [`global-state.md`](../../docs/architecture/global-state.md) documents, because the peak was taken over an app sitting still. The run that proved nothing looked the healthiest, and this spec is the PRIMARY defense against the `&h29` fan-out class per [ADR 0031](../../docs/adr/0031-task-thread-ceiling.md) — the compile-time ratchets cannot see an aggregate. A quiet, out-of-band-LOW measurement is the signature; suspect the driving before you believe the number.
- **Preconditions before actions and reads** — see [the north star](#-the-north-star-establish-the-state-that-makes-an-action-or-a-read-meaningful-before-doing-it) at the top of this file. It is the rule most worth internalizing before you touch a nav.
- **A timeout must report what it SAW, so throw via `diagnosedError`, never a bare `new Error`.** `lib/diagnostics.js` attaches the state the device was actually in (active view + `loadState`, the app shell's `isLoading` / `isRemoteDisabled`, focused node, row counts, seeded server/user identity) and appends a record to the run's `failures.jsonl` that the run's `close()` folds into `run-meta.json` (see [`scripts/run-record.js`](../../scripts/run-record.js)). The capture runs only at the throw site, after a poll loop has given up — never inside a tick — so it costs nothing on the success path (measured on `.177`: median 21 ms, n=20). This applies to **timeouts**; a fail-fast that already names its cause (the ambiguous-library refusal in `nav.js`) can stay a plain throw.
  - **This is enforced, not just written down.** An ESLint `no-restricted-syntax` rule scoped to `lib/nav.js`, `lib/steps.js` and **all of `demos/`** fails `lint:js` on a bare `throw new Error` there. A legitimate fail-fast disables it on that line **with a reason**. A new lib file that grows a wait should be added to that glob in [`eslint.config.js`](../../eslint.config.js); `specs/` stays out, because most spec-level throws are assertions rather than timeouts.
  - **In a take, reach for `ctx.waitFor` rather than a hand-rolled poll** — it already throws through `diagnosedError`, so you inherit the dump instead of re-deriving it. A take that polls its own loop is the shape that produced both of the unconverted waits this rule was written for.
  - **`kind` comes from the frozen `FAILURE_KINDS` set, never an inline string** — it is the key a flake baseline aggregates by, and an invented slug forks a bucket. An unregistered one is recorded and called out in the run summary rather than silently counted.
  - **Prefer passing state the loop *already read* as `observed`** over re-reading it; that is what turns `2 row(s) present` into `rowTypes=[Chapter, Person]`, i.e. the difference between *late* and *absent*.
  - **`loadState=—` on a detail screen is correct** — that field is `BaseGridView`'s, and `ItemDetails` extends `JRScreen`. Read `detail=<n>` and the shell fields there instead; `input=BLOCKED` means `JRScene.onKeyEvent` was swallowing every key we sent, which is the north-star failure mode made visible.
  - **Never dump a whole node into a record** — `JellyfinUser` carries `authToken`; read identity by named field.
  - Full shape in [`docs/dev/rta-tests.md`](../../docs/dev/rta-tests.md#when-a-wait-times-out-it-reports-what-it-saw).
- **Guard every repeated `action`, and never let one fail silently.** Press only while the target state is *not* yet reached (the focus-walk navs and `waitOsdUp` both read first) — a blind re-press can perturb a UI that already responded. `waitFor`/`waitFocused` count actions that throw and name them in the timeout message; keep that, because "the key never landed" and "the screen never rendered" are otherwise indistinguishable and cost hours to tell apart after the fact.
- **A read that never completed is not a field that never changed — the waits count both.** `getVal`/`getActiveVal` still swallow a failed read to `undefined` (right for a poll: the loop retries, and `waitFor` owns the timeout), but `waitFor`/`waitFocused` now tally reads that did not COMPLETE and name them — `readErrors=<n>` in the message and in `observed`. Same reasoning as the `action` counter one line up, and the distinction is real on the wire, not inferred: ODC answers `found: false` for a keyPath it resolved and did not find, and only rejects when the request itself failed, so an ordinary "not there yet" timeout still reports `readErrors=0`. **A custom `read` gets no attribution** (only `getVal`/`getActiveVal` are mapped) — that is deliberate, not an oversight, and a new shared reader worth attributing should be added to `ATTRIBUTING_READS` in [`lib/steps.js`](lib/steps.js) rather than wrapped at a call site. Written against [#785](https://github.com/jellyrock/jellyrock/issues/785), where four degrading suites produced only `last=undefined` and could not be attributed afterwards.
- **A one-shot assertion reads the screen in ONE batch, not field by field.** Use `getActiveVals([...])` from [`lib/steps.js`](lib/steps.js) — ODC's `getValues` loops the requests inside a single on-device message, so N keyPaths cost one round trip. **This is a correctness rule, and the measurement says so explicitly: it is NOT a speed win.** On `.177`, 57 sequential reads take a median 303 ms against 58 ms batched (~5.4 ms per round trip), which is ~245 ms inside a ~20 s test — before/after suite runs showed no wall-clock change at all. What shrinks is the OBSERVATION WINDOW: 57 sequential reads observe a still-settling screen across 303 ms, so the field read 50th need not describe the same frame as the field read 1st, and batching collapses that to 58 ms. Same class of fix as the north-star rule, applied to reads instead of input. `assertGenreRowsOwnTheirItems` went from 57 reads to 3, and the failure record got richer for free — the whole view is already in memory to pass as `observed`. Poll loops keep the single-read `getActiveVal`: they retry by design, and `waitFor` already owns their timeout.
- **Never swallow a failed server request into an empty result — absence is only ever reported from a request that SUCCEEDED.** `lib/jellyfin.js` throws a typed `JellyfinRequestError` on any non-2xx or transport error; do not wrap a call to it in `.catch(() => null)` / `.catch(() => [])` to "tolerate" a flaky fixture. A sentinel is indistinguishable from a real empty result, and every caller here reads an empty result as a fact about the demo server — so the failure does not surface as an error, it surfaces as a *confident false statement*. Two ways that lands, both observed on 2026-08-12: a swallowed 401 in `getLibraries` (called once per spec file, in `beforeAll`) made `libraryIdFor` return `null`, which drove `screens.spec.js`'s legitimate fixture-shortfall skip and reported the run **green** with `server has no "movies" library`; and a session evicted partway through `genreItemNames`' sequential loop produced a coherent, entirely fictional picture of a demo server whose content had thinned to two genres, which was written up as a finding and reasoned from before anyone re-measured. Returning `{ index: 0, id: '' }` or `[]` is still correct **after the server answers** — that is a fixture fact a caller may act on. A run whose failures include a `server-request-failed` record folds as `outcome: blocked` (a NON-sample), so a broken fixture leaves the flake population instead of being counted as app flake.
- **Authenticate with your own role — never share a `DeviceId`.** `authenticate(server, { role, deviceKey })` mints `jellyrock-<role>-<deviceKey>`. Jellyfin keys a session to its `DeviceId` and a second auth under the same one **evicts the first token**, so two tools (or one tool on two devices) sharing an id silently log each other out mid-run. A new entry point passes its own `role`; see [`decisions.md`](../../docs/decisions.md) → `session-identity-per-role-and-device`.
- **Check a content-dependent assertion against the demo server's ACTUAL content before writing it, and make it throw when it verified nothing.** The demo library is small and shrinks; an assertion keyed on content it never has passes vacuously forever and reads as coverage. Real case: the natural genre-row check keys on the `View All` child, which only exists above 5 items per genre — and no demo genre has more than 4, so it would never have checked anything. Query the server first (`getJson` in `lib/jellyfin.js`), then assert; a `verified` counter that throws at zero is what turns a silent no-op into a red test.
- **Library navs must target a library BY ID** — pass `libraryIdFor(ctx.libraries, ct)` into `navLibraryByType`, and thread `ctx` through every chained nav. Matching on `collectionType` alone picks the first Home *tile* of that type, while the seeding side picks the first `/UserViews` entry; on a server with several libraries of one type those disagree and a screen seeded for library A gets navigated to library B, silently. The demo server has one library per type, so **the suite cannot catch this** — it only shows up against a real multi-library server.
- **Add a screen** by adding ONE entry to `screens.js` (+ a `nav` in `lib/nav.js`). It becomes both a functional test and (if `capture.eligible`) a store screenshot. Keep nav free of screenshot concerns (no backdrop/ffmpeg — that's the store orchestrator's job).
- **After ANY registry write, relaunch with `hardRelaunch()`, not `relaunch()`.** A plain `relaunch()` only foregrounds a running channel, so the app re-persists its in-memory session over the seed and the suite silently drives the wrong server — it presents as ~30 unrelated timeouts, not as a seed error. `assertSeedTookEffect()` guards each seed; keep calling it. Same rule in `scripts/capture-screenshots.js`, where the failure silently captures the wrong library into the store set.
- **Real-registry exception**: seeds write the real `JellyRock` registry (not `test-*`) because the app reads real keys to pick a screen. This is the accepted exception to the `tests/CLAUDE.md` `test-*` rule (which governs in-process Rooibos tests).
- **Never put the device-registry lifecycle in a spec.** Specs seed; they do NOT snapshot or restore. [`scripts/rta-run.js`](../../scripts/rta-run.js) owns it for the whole run — it snapshots the WHOLE registry before any seeding, runs Vitest as a child, and restores + verifies afterwards, including on Ctrl-C. A per-spec `afterAll` cannot do this: it never runs on a killed process, and Vitest exits on a 1 ms timer from its own SIGINT handler, so nothing armed inside Vitest can finish a ~30 s restore. Measured 2026-08-10 — a SIGINT 15 s into a run left `.178` signed into the demo server. If you add a new RTA entry point, snapshot via `lib/registry.js` from the MAIN process, never from a spec.
- **Build flavor**: tests run against the dev build (`npm run build`); store screenshots use prod (`build:prod`). Never `build:prod` for a path that needs source maps/logs for debugging.
