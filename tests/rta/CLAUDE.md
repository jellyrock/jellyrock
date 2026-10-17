# Rules for `tests/rta/`

On-device **RTA functional tests** (roku-test-automation): Node ESM under Vitest that drives a real Roku from the dev machine over ECP and ODC. [docs/dev/rta-tests.md](../../docs/dev/rta-tests.md) is the how-to.

**This is not Rooibos.** The `tests/` rules for Rooibos don't apply here: this is Node under Vitest, not BrightScript compiled into the app. Don't put `.spec.js` files under `tests/source/**` (that tree is compiled as BrightScript); RTA tests live here.

## ⭐ The north star: establish the state that makes an action or a read meaningful, before doing it

If you remember one thing when writing or editing an RTA test, remember this. It is the largest single source of flakes in this suite, and each instance first looked like an app bug.

It has four shapes:

- **Driving input too early.** The app swallows keys on purpose while loading: the player ignores Up until `stateAllowsOSD()` passes. A loop that starts pressing right after a Play press spends its whole window pressing at a component built not to answer. These windows are longer than they look: playback start takes several seconds and tracks stream start, not device speed.
- **Reading too early.** A screen can render before its data arrives, so a gate proving "something is there" can be satisfied by placeholders, and a field can be stale rather than wrong. `waitHome()` passes on skeleton rows whose tiles carry no `.id` yet, and `rowItemFocused` / `itemFocused` **keep their last value while the list is not focused**, so "grid loaded" is not "grid focused", and a walk started too early reads `[0,0]` forever while pressing at whatever does hold focus.
- **Acting from a position the app gates on.** `Home.onKeyEvent` hands focus to the overhang only when the active row list reports `rowItemFocused[0] = 0`; at any other index Up returns false and the key goes nowhere. Home is fully loaded and answering, so every "loaded" gate passes. A healthy Home and a stuck one show the same focused keyPath (`#homeRows`); only the row index tells them apart, which is why the failure dump keeps it.
- **A walk that decides whether to press from its own read of a lagging field.** `waitFor` runs `action()` and then its predicate read, so an action can read `[0,1]` while the device is already at `[0,2]`, send a Right, and the predicate's read then returns `[0,2]` and satisfies the wait, with an extra Right still in flight. On `.177` (2026-09-07) that extra press opened a different library about one run in four, after a check of the tile at the walked-to cell had passed. **No read taken before the press can catch this:** the press has to be bracketed.

**The tell:** a timeout that blames a component ("tile not found", "screen never loaded") when the real cause is that the test acted before the app could respond. If a failure says something is missing, ask whether it was ever asked at a moment it could have answered.

**How to satisfy it:**

- Gate on the state that makes the step meaningful (`state = playing`, focus inside `#itemGrid`), settle, then act. Not on a proxy for it.
- Poll a scan inside a bounded wait instead of scanning once, and put the retry in the **shared helper** so every caller inherits it.
- Tell **"not there yet"** (retry) from **"wrong"** (throw now): an ambiguous match across several libraries can't be fixed by waiting, so it still fails fast.
- Never cover it with a longer timeout or a fixed `sleep`. The wait was not timing out; it was succeeding too early.
- **A walk presses through [`scrollFocus`](lib/steps.js),** which sends the exact distance as one burst and re-presses only a key it can show was dropped (the index unchanged across a whole tick). If you are writing a loop that reads an index and presses toward a target, you are writing the fourth shape; use the helper. Where a stray key does damage a retry can't undo (a surplus Up from row 0 leaves Home), pass `stepped: true` and `within`, the list the walk must not leave; the walk then ends by checking focus is still there, because the index keeps its last value after a key leaves.
- **A guarded re-press re-sends the key still owed.** `focusOverhangIcon` once pressed Up and then re-sent Right, which walks the row instead of leaving Home, so one lost Up could never be recovered (reproduced 2026-08-18). `overhangWalkKey` in [`lib/steps.js`](lib/steps.js) now picks the key from the focused node, and `focusOverhangIcon` warns when it had to re-press, because a silent recovery tells you nothing next time.

The references: `waitOsdUp` ([`lib/steps.js`](lib/steps.js)) for input, `findHomeLibraryTile` ([`lib/nav.js`](lib/nav.js)) for a scan, the focus gates in `navLibraryByType`, `navMovieDetails` and `openChildDetailByRowType` for stale reads, and `walkHomeToFirstRow` ([`lib/steps.js`](lib/steps.js), unit-tested against a mocked device in `steps.test.js`) for the gated position.

### Name a dynamically created node by `subtype`, never by `id` or `#name`

RTA builds each keyPath segment from `node.id` when it is set and from the child **index** otherwise, so a node created without an id can be addressed only by position, and a predicate keyed on its name silently falls through to its `else` branch. That regression has no failure of its own: it quietly restores the bug you fixed. `JROverhang` appends its `JRTabBar` with no id, which is why `overhangWalkKey` matches `HOME_ROW_LIST_SUBTYPES` and not `#homeRows`.

Home's row list is the other case: only one list is in the scene at a time, because `Home.onTabChanged` removes the old one before building the new, so under another tab `#homeRows` is absent outright and a read of it resolves to `undefined`, which a scan then reports as "0 rows". The reads resolve the active list instead, and [`lib/home-list.js`](lib/home-list.js) records the mechanism and the measurements.

**Never name Home's row list by id.** `jellyrock-rta/home-list-resolved` ([rule](../../scripts/lint/eslint-rules/rta-home-list-resolved.js)) allows `#homeRows` and `#favoritesRows` only in [`lib/home-list.js`](lib/home-list.js), at a fixed count of two. Ask instead:

- **"Where do I read Home's content?"** Use `homeListId()` ([`lib/steps.js`](lib/steps.js)). It reads `subtype()` off both candidate ids in one round trip and returns whichever is in the scene, whatever tab is selected. Absence becomes a named failure (`HOME_LIST_ABSENT`) instead of an `undefined` a caller turns into zero rows.
- **"Is focus inside Home's content?"** Use `focusIsInHomeContent` or `waitFocusInHomeContent`, which ask the focused node its `subtype`. Probed on `.177` (2026-09-08), the focused node is the row list at every state the walks reach, so asking by subtype is no weaker than the keyPath test it replaced.

### Ask "is focus inside X?" through `focusIsInside`

Use `focusIsInside` / `waitFocusInside`, never a hand-written `keyPath.includes(...)`. A container id always fills a whole keyPath segment, so a substring test is weaker than the question: `#options` is a substring of `#optionsPanelOverlay`, the reparenting host in [`components/JRScene.xml`](../../components/JRScene.xml), so a substring gate could report the options dialog focused for focus anywhere in that overlay. That is the north-star failure hidden twice: it succeeds early, so the blame lands on whatever times out next, and naming a node introduces it, so no test diff shows it. `focusIsInside` adds a missing `#` for you (`dialogs.spec.js` asks for `jrDialog`), and [`lib/steps.test.js`](lib/steps.test.js) gates it against keyPaths taken from a device.

## Why every wait polls

`roku-test-automation` ships a field observer (`onFieldChangeOnce`), and this harness polls instead. That departs from the library's documented practice, so the standing bar is that **every wait either follows that practice or says why it departs**. "It works" is not a reason; "the library's primitive is wrong here because X" is.

The failure being guarded is quiet. **A poll can only miss a state that is a one-shot pulse,** entered and left inside one interval. Such a wait doesn't fail loudly, it fails rarely, and the timeout blames whatever it watched rather than the wait that sampled between frames. That is the symptom [#785](https://github.com/jellyrock/jellyrock/issues/785) recorded as unattributable, and why "it passes" doesn't count as evidence.

Each category below carries its reason. `FN`, `ABS` and `ACT` are properties of the call and prove themselves from the syntax; the rest are properties of the field or of focus. The token opening each row is the gate's category name and is what `npm run lint:rta-waits` keys on: the label beside it can be reworded, the token is a contract.

<!-- rta-wait-inventory:start -->

| Category | n | Why a poll, not an observer |
|---|---|---|
| `FN` Function `keyPath` | 25 | ODC observes a **field**. `getChildCount()` and `subtype()` are calls, not fields, so the primitive can't apply. |
| `ABS` Waits for absence | 1 | The node is gone, and a departed node has no field left to observe. This is `waitDialogClosed`, whose JSDoc carries the argument for the dialog-dismiss sites that route through it. |
| `ACT` `action:` retry loops | 6 | The re-press on each tick **is** the mechanism (see `resendIfSwallowed`). An observer would sit and watch for a key that never landed. |
| `SETTLE` Plain field settle | 77 | The primitive could apply; it is ruled out below. |
| `DYN` Dynamic `keyPath` | 2 | `scrollFocus`, whose keyPath is its caller's, and `waitHome`'s rows gate, whose list id is resolved at run time. Syntax can't classify them, so each carries a rule disable naming the reason, and the argument lives in its docblock. |
| `FOCUS_INSIDE` Focus containment (`waitFocusInside`) | 41 | ODC has no "observe global focus" primitive. Its requests offer `getFocusedNode`, `hasFocus` and `isInFocusChain`, all reads, and one observer, `onFieldChange`, which needs a node keyPath and a field name and so can't express "wherever focus now is". |
| `FOCUS_SUBTYPE` Focus containment by subtype (`waitFocusInHomeContent`) | 7 | No primitive, as above. A separate row because the question differs: Home's content is whichever of `HomeRows` and `FavoritesRows` the selected tab put in the scene, so it can't be asked by container id at all. |
| `FOCUS_IDENTITY` Focus identity (`waitFocused`) | 20 | No primitive, as above, and focus stays where it landed until the next key. There is no pulse to miss. |

<!-- rta-wait-inventory:end -->

*(Counts are call sites, which is what the gate sees; one call can stand for several waits. `FOCUS_IDENTITY` counts sites that call `waitFocused` directly: the calls inside `waitFocusInside` and `waitFocusInHomeContent` are those rows' implementations.)*

**Every `n` above is checked by [`npm run lint:rta-waits`](../../scripts/lint/rta-wait-inventory.js), so update a row only through that gate.** It imports `classifyWait` from the `wait-justified` rule and runs ESLint with the repo's config, so the counts and the categories can't disagree. Hand-kept counts here were wrong several times before the gate; a stale row now fails a lint instead of being believed. Add a category and the check fails until its row exists.

### The plain-field waits, and the gate that keeps them honest

These are the waits an observer could serve, so they need the real argument. Each target field was read in the app source, and **none is a one-shot pulse.** Each is either:

- **terminal**, held until the next user action (`#osd.visible`, `#jrDialog.sections`, `#videoTitle.text`, the focus-index fields), or
- **recurrent**, entered again if a tick misses it. `state` is the one case: Roku's `Video.state` returns to `playing` after a rebuffer, so it is not terminal, but a tick that misses it gets another chance.

Two looked like animations a poll could sample between frames, and neither is: `#buttonBorder.blendColor` is assigned directly on focus change ([`TextButton.bs`](../../components/ui/button/TextButton.bs)) with no interpolator, and `#scrollContent.translation` is a direct assignment too ([`OverviewDialog.bs`](../../components/OverviewDialog.bs)).

**The one real pulse in the suite is `loadState === 'skeleton'`,** and it is not waited for bare: `genre-skeleton.spec.js` widens the window first through the `rtaSkeletonHoldMs` hook ([`LoadItemsTask2.bs`](../../components/ItemGrid/LoadItemsTask2.bs), compiled only under `ENABLE_RTA`). Widening the window in the app beats observing it from the harness, because it keeps one answer to "how do we wait".

**This is gated.** `jellyrock-rta/wait-justified` ([`rta-wait-justified.js`](../../scripts/lint/eslint-rules/rta-wait-justified.js)) fails `lint:js` on a `waitFor` it can't place. It proves `FN`, `ABS` and `ACT` from the syntax, but "this field is not a pulse" is a fact about how the app writes the field, so it ratchets on the **field**, not the call site: a keyPath in `VERIFIED_SETTLE_KEYPATHS` inherits its check, and one not there trips the gate. Another `#osd.visible` wait costs nothing; a wait on a field nobody has read the app source for is exactly when the check is owed, and that is when it fires. A wait whose keyPath is a run-time value can't be classified: its reason goes in the owning helper's JSDoc, and the call site disables the rule with that reason. The gate covers [`scripts/capture-screenshots.js`](../../scripts/capture-screenshots.js) too, since it uses the same `waitFor` on the same device.

## Why the surviving sleeps are not arbitrary waits

`roku-test-automation`'s README says arbitrary waiting "is almost never needed", and [the north star](#-the-north-star-establish-the-state-that-makes-an-action-or-a-read-meaningful-before-doing-it) says never to cover a flake with a fixed `sleep`. So every `sleep()` either has no signal to gate on, or it is a defect.

**Many are not waits at all.** A `sleep` inside a bounded loop that exits on its own predicate is a poll tick: it sets the sampling rate and nothing else. [`lib/steps.js`](lib/steps.js), which owns every wait primitive, has sleeps but no arbitrary waits.

The bare ones fall into six categories:

| Category | Why no signal was available |
|---|---|
| Paint or texture settle | A `waitFor` gate has already passed, and this waits for **pixels**. The app's only load-completion signal is the `cellLoad*` counter family, compiled only under `perfTiming`, which [`scripts/harden-prod-manifest.js`](../../scripts/harden-prod-manifest.js) forces off in `build:prod`. These navs are shared with `screenshots:capture`, which runs that build, so on the path they serve there is no field to read. |
| Timer window | Waiting out a period to prove a **non-event**. [`deeplink.spec.js`](specs/deeplink.spec.js) says so: `Assert we never leave Home (a non-event, so a bounded wait).` The only signal would be the thing being disproved, and a dialog that must survive its own auto-hide can't be gated on the timer under test. |
| App lifecycle | [`lib/driver.js`](lib/driver.js)'s `bootMs` and `exitMs`. The channel is down or starting, so ODC can't answer. |
| Measurement window | The wait is the quantity being measured (a baseline phase, an extras-launch window, `navGridScroll`'s rest before and drain after its timed scroll). Gating it would change what is measured. |
| Async teardown | `retainedAfter` in `leaks.spec.js`: no app field reports that the teardown the last Back started has finished. |
| Demo footage | `hold(ms, label)` in [`demos/run.mjs`](demos/run.mjs) is a beat in the shot list, not a wait on app state, and not a test. |

### Signals that replace a fixed settle

A fixed wait before an action usually stands in for a state you can read. These are the ones the suite uses:

| Before | Wait for | Why it is the right signal |
|---|---|---|
| `ecp.sendText` | `waitFocusInside('#searchKey')` | `sendText` types into whatever holds focus, and `SearchResults.bs` focuses the keyboard in `onScreenShown`, a later turn of the event loop. |
| The first OSD press | `waitOsdUp`'s state gate | `stateAllowsOSD()` reads `m.top.state` on the player node, and `VideoPlayerView` stamps that node with the item id, so the key's precondition is readable. |
| Reading `#buttons.buttonFocused` | `waitFocusInside('#buttons')` | `onGroupFocusChanged` re-asserts the group's index when it takes focus, so focus arriving is what makes the index meaningful. |
| Reading focus after a dialog closes | `waitFocusInside` on the opener | The dialog restores focus to its opener, so waiting for focus to arrive there can only pass once that has happened. |
| Recording a scroll position | `scrollFocus` | It sends the exact distance and re-presses only a dropped key, so the position it returns has stopped moving. |

Two waits look like gates and are not:

- **`#buttons.buttonFocused` is not a gate.** Polling until it reads as a number can't fail, because [`JRButtonGroup.bs`](../../components/ui/buttongroup/JRButtonGroup.bs) sets it to `0` in `init()`. The wait returns on its first tick having proved nothing, and the read after it describes the group's previous index. Gate on focus.
- **Waiting for a state to stop being true is not a gate either.** "Focus is not on the dialog" is satisfied by focus being nowhere at all, so it passes on the very state it exists to catch. Wait for focus to arrive at the opener, and keep the "not on the dialog" assertion beside it: they catch different failures.

### The gate

`jellyrock-rta/sleep-budgeted` ([`rta-sleep-budgeted.js`](../../scripts/lint/eslint-rules/rta-sleep-budgeted.js)) holds the bare sleeps to a declared count per file (its `BUDGETS` table); a file with no entry has a budget of zero. Poll ticks prove themselves from the syntax and are never counted.

**Why a count rather than a tag on each site.** The sibling rule ratchets on the field because "this field is not a pulse" is reusable: check `#osd.visible` once and every wait on it inherits the check. An arbitrary wait has no such key: the argument belongs to the call site's purpose, and most sites are anonymous spec arrows with no stable name. A `// sleep: <category>` tag on each would be the same per-site annotation the plain-field waits rejected, saying nothing a reader of the code needs. A count can't say which argument a site claims (the table above does that per category), but it makes adding an arbitrary wait a deliberate act with a second file to edit and a diff a reviewer sees. That is the failure being guarded: a covering `sleep(2000)` and a real paint settle are the same three tokens, and review can't tell them apart.

**The match is exact, not a ceiling.** Removing a sleep fails the rule until the budget is lowered, emptying a file included, so the table stays an inventory instead of drifting upward into permission.

## The loops that are not `waitFor`, and why

`waitFor`, `waitFocused`, `scrollFocus` (and the `steppedWalk` it runs), `waitCellsQuiet` and `waitRowsSettled` are the polling layer, so the question doesn't apply to them. The loops below sit outside `waitFor`, and so outside `jellyrock-rta/wait-justified`, so each needs its reason written down.

The reasons are structural. `waitFor` polls one keyPath, on ODC, and throws through `diagnosedError`, which reads the device to attach a state dump. A loop that breaks any of those three can't use it.

| Loop | Why not `waitFor` |
|---|---|
| `findHomeLibraryTile` ([`lib/nav.js`](lib/nav.js)) | A multi-read **scan**: several reads per tick over a tree that changes under it, with a third exit for real ambiguity. `waitFor` polls one keyPath and has two outcomes. |
| `openChildDetailByRowType` ([`lib/nav.js`](lib/nav.js)) | The same scan shape. |
| `waitMediaPlaying` ([`lib/steps.js`](lib/steps.js)) | Reads the OS media player over **ECP** (`ecp.getMediaPlayer()`). There is no keyPath because there is no node. |
| `stopPlayback` ([`lib/steps.js`](lib/steps.js)) | The same ECP transport, and it does not throw on purpose: it is cleanup on the way out of a step that already passed or failed, and a throw here would replace a real failure with a teardown one. `waitFor` always throws. |
| `waitSceneAnswering` ([`lib/driver.js`](lib/driver.js)) | Polls for the scene answering at all, before the app has a screen. `diagnosedError` reads the device, so its diagnostic would fail on the same condition and bury the real message. |
| the `gaaProbeResult` poll ([`specs/gaa-thread-scope.spec.js`](specs/gaa-thread-scope.spec.js)) | Polls the return value of a `callFunc`, a Task's own state, not a field. |
| `startPolling` ([`specs/task-thread-peak.spec.js`](specs/task-thread-peak.spec.js)) | Not a wait: a sampler with no exit predicate that collects a series until told to stop. The series is the measurement. |
| `ensureOdcReachable` ([`lib/driver.js`](lib/driver.js)) | Polls a raw TCP connect, not ODC: it runs before the registry reads that open a run, to show a component is there to call. Like `waitSceneAnswering`, `waitFor` would have to reach the device to poll and again to diagnose, on exactly the condition being tested. |

A loop with one keyPath, one predicate and one reader that throws on timeout belongs in `waitFor`; give it its own `kind` so its failures keep their own bucket (`waitGridLoaded` uses `grid-load-timeout`). Share a loop two specs need instead of copying it: two copies of "wait until the scene answers" once disagreed about whether to throw, so a scene that never answered failed later and blamed the wrong step. Both now use `waitSceneAnswering`, which throws.

**`waitSceneAnswering` is not a replacement for `bootMs`.** `relaunch()` also runs against `ENABLE_RTA=false` builds, where ODC never answers, so polling there would burn the whole timeout on every call instead of sleeping once.

## Focus is walked, never teleported

`odc.focusNode` sets focus straight onto a node. That skips the key handler that would have moved it there, so a spec can arrange a state the remote can't reach and still pass, which is the one failure a device suite exists to rule out. The suite doesn't use it, and `no-restricted-syntax` in `eslint.config.js` bans it. Walk with `walkFocusInto(key, containerId)` from [`lib/steps.js`](lib/steps.js).

The paths are real and reachable both ways:

- UserSelect focuses `UserRow` in `UserRow.init()`, and one Down reaches the button group (the `"down"` branch of `UserSelect.onKeyEvent()`).
- ItemDetails has two branches. Up from the button group goes to an interactive track dropdown when there is one and to the description when there isn't (the `"up"` branch of `ItemDetails.onKeyEvent()`, through `pickTrackDropdownFromButtons()`). Up from a closed dropdown arrives through `requestFocusReturn` and `ItemDetails.onDropdownRequestUp()`. So the number of presses depends on the fixture's tracks, not on the app.

That is why a walk is a guarded loop, not a counted run of presses: a fixed number of Ups is right on one server and wrong on another, and pressing until focus arrives is right on both.

**Two properties make a walk safe, and both live in `walkFocusInto`.** It presses only while focus is not yet inside the target, so arriving stops it before it can press into whatever the target opens. And its containment test goes through `focusIsInside`, never a substring match. Its unit tests gate both.

**A walk costs a tick per press.** A site that used to teleport has to budget for the presses instead of keeping the timeout an instant `focusNode` was happy with (the description sites in `dialogs.spec.js` use 8 s for this reason). A converted site that kept its old timeout is the shape that goes flaky on the slower device.

## Why the ODC transport config is left unset

[`lib/driver.js`](lib/driver.js)'s `setupRtaEnv()` gives the device entry only `host`, `password` and `screenshotFormat`. The library's three transport settings, `defaultTimeout`, `timeoutMultiplier` and `disableCallOriginationLine`, stay unset, and the last one must.

**`disableCallOriginationLine` stays off; it is not a deferred optimization.** The library builds an `Error` per request to capture a stack, and that buys what this suite needs: on a failed request the client rejects with that error, so the stack names your call site instead of the library's async internals. Turning it off would trade attributable failures for about a microsecond and a half per request (measured 2026-09-09). Read any capability list that calls it a pending win as already answered: no.

**`defaultTimeout` and `timeoutMultiplier` have no value worth setting.** Unset, every request gets a 10 s ceiling, far above a healthy round trip (a few milliseconds on `.177`, measured 2026-08-12). Raising it only delays a failure no run has recorded; lowering it is not a question per device, which is what `timeoutMultiplier` is for. And the failure that does take a device out, `rta-odc-connect-hang` in [`docs/signals-backlog.md`](../../docs/signals-backlog.md), is a socket handshake that never settles, while the timeout wraps the request. Neither setting reaches it.

**What does reach it sits outside the config, in two pieces covering different halves.** Neither is enough alone, so don't delete one on the strength of the other:

- `ensureOdcReachable` ([`lib/driver.js`](lib/driver.js)) refuses to make the registry reads that open a run until a raw TCP probe finds the component. It is the only thing that handles the common case: a connect RTA can't complete rejects a promise the library then orphans through its own unattached `.finally()` (in `OnDeviceComponent.setupClientSocket()`), and an unhandled rejection is a hard `exit 1`, even for a caller that awaits and catches (measured 2026-09-06). Our code can't reach the orphan, so no `try`/`catch` or `withTimeout` fixes it: the call must not be made. [`scripts/lib/odc-probe.js`](../../scripts/lib/odc-probe.js) has the mechanism and the control that proved it.
- `REGISTRY_READ_TIMEOUT_MS` ([`lib/registry.js`](lib/registry.js)) then bounds the read itself, because the probe answers "is the port open" and the hang happens with the port open (measured 2026-09-09: the probe answered `true` at once against a socket that accepts and never replies, while the ODC call beside it was still pending).

**The 10 s ceiling is longer than some of the waits that contain it.** `waitFor` checks its deadline at the top of a tick and then awaits a read the loop doesn't bound, and many waits have budgets of 5 or 8 s. So one request that times out can outlast the whole wait, and a `waitFor(…, {timeout: 5000})` can report `waitedMs: 10500`. That is two layers keeping their own clocks, not a broken wait, and the message says which one moved: a read that didn't complete is counted and named (`readErrors=n`). It stays as it is because no run has recorded such a timeout, and a ceiling low enough to fit the shortest wait would be a guess with no device baseline behind it.

A few calls set their own timeout: `readIdentity` in [`scripts/measurement-guard.js`](../../scripts/measurement-guard.js) at 5 s, and the bench specs' long `callFunc`s at 10 to 30 s. Every other ODC call runs on the 10 s default.

## The ODC capability inventory: what we use, and why we don't use the rest

`roku-test-automation`'s client exposes the public methods on `OnDeviceComponent` listed below, and this suite calls a few of them. The bar: *an unused primitive is fine with a recorded reason, and a defect without one.* "We never needed it" is a reason; silence is not.

**It is gated.** `npm run lint:rta-capabilities` reads the method names from the installed `client/dist/OnDeviceComponent.d.ts` and fails if any is missing from the block below, or if a table row names a method the library no longer ships. The second direction matters most: the library once removed `getNodeReferences` for `getNodesInfo`, which is how an inventory written once drifts into fiction.

<!-- rta-capability-inventory:start -->

### Used

| Primitive | Where, and what for |
|---|---|
| `getValues` | The batch reader every wait goes through (`getVals`, `getActiveVals`). A keyPath that doesn't resolve comes back `found: false` instead of failing the batch, so one fixed request set covers every screen. |
| `getValue` | Single reads in [`lib/driver.js`](lib/driver.js) and [`lib/steps.js`](lib/steps.js) where there is one keyPath. |
| `getFocusedNode` | Every focus predicate (`focusIsInside`, `waitFocused`, `focusIsInHomeContent`) and the failure dump. |
| `callFunc` | The bench and probe specs' harness nodes (`task-ledger-bench`, `task-ledger-screen-cost`, `task-thread-peak`, `gaa-thread-scope`). |
| `setValue` | Arranging state the app can't be walked into: [`lib/nav.js`](lib/nav.js), [`lib/failRequests.js`](lib/failRequests.js) (requests made to fail), `dialogs.spec.js`, `genre-skeleton.spec.js`. |
| `createChild` / `removeNode` | The bench and probe specs create a measurement node under the scene and remove it again, in pairs, since a node left behind would read as an app leak in the leak gate. `capture-screenshots.js` creates one too. |
| `readRegistry` / `writeRegistry` / `deleteRegistrySections` | [`lib/registry.js`](lib/registry.js)'s snapshot and verified restore, [`lib/seed.js`](lib/seed.js)'s session seeds, and a few specs that set or read one key (`dialogs`, `still-watching`, the playback specs). |
| `getRootsCount` / `getAllCount` | The leak gate's two censuses (`specs/leaks.spec.js`). `getRoots()` is asserted; `getAll()` is recorded but not asserted, and that file says why. |
| `storeNodeReferences` | [`lib/resolution.js`](lib/resolution.js)'s node-resolution audit (one whole-scene census per audited read, behind `RTA_AUDIT_RESOLUTION=1`, report-only), and `assertOneScreenShowing` ([`lib/steps.js`](lib/steps.js)), one census per screen in `screens.spec.js`, which throws unless the router shows exactly one view. |
| `writeFile` | `capture-screenshots.js` pushing an image to the device: the only device filesystem call this repo makes. |

### Evaluated and rejected

These look like they should be used. Each was tried or read against the device and turned down for a reason.

| Primitive | Why not |
|---|---|
| `focusNode` | Teleports focus, skipping the key handler a viewer's remote exercises. `no-restricted-syntax` bans it; see [Focus is walked, never teleported](#focus-is-walked-never-teleported). |
| `onFieldChangeOnce` | The library's observer primitive and the obvious answer to "why poll?". Ruled out per category in [Why every wait polls](#why-every-wait-polls); decision `rta-waits-poll-not-observe`. |
| `isInFocusChain` / `hasFocus` | Both resolve through the same recursive id lookup, which a suspended Home's hidden `OptionsSlider` wins, so `isInFocusChain` is wrong at the `#options` site. `focusIsInside` answers locally, off the keyPath the focus read already returned, with no extra round trip. |
| `disableScreenSaver` | Declined in favor of detecting a running screensaver in the failure dump. It adds a hidden `Video` node whose effect outside the render tree was never measured, must be sent again after every relaunch, and would delete the signal the dump reports. Decision `rta-screensaver-detect-not-suppress`. |
| `isShowingOnScreen` | Looks made for the resolution audit and answers quickly, but **hung indefinitely on one probe run with no cause found**. The `storeNodeReferences` census carries `visible` and `opacity` anyway, so it would add nothing but an unexplained hang in the wait path. |
| `getNodesWithProperties` | Needs a prior whole-tree `storeNodeReferences` walk and returns `nodeRefs`, never the `[row, col]` a focus walk needs. |
| `getNodesInfo` | Its purpose is field-type introspection for the VS Code SceneGraph Inspector, and a field's declared type is in the app's own XML. Worse, it dumps every field: on `.177` (2026-09-08) it returned `m.global.user`'s `authToken` with its live value, and expands node-valued fields one level. That is the whole-node read [`lib/diagnostics.js`](lib/diagnostics.js) refuses, because `runs.jsonl` is never reset. `getValues` covers batch reads without it. |

### Not applicable

Grouped, because the argument is per family.

**Device filesystem: `createDirectory`, `deleteFile`, `getDirectoryListing`, `getVolumeList`, `readFile`, `renameFile`, `statPath`.** These address the device's storage, not the SceneGraph. The suite asserts UI state; its one filesystem need, pushing a screenshot to the device, is `writeFile`. Artifacts are written on the dev machine by [`scripts/run-record.js`](../../scripts/run-record.js).

**Responsiveness testing: `startResponsivenessTesting`, `getResponsivenessTestingData`, `stopResponsivenessTesting`.** Undocumented in the library README, and the repo already has a measurement stack (`scripts/measure*.js`, the task-ledger benches, the app's own instrumentation) whose numbers compare across the historical record. A second, undocumented one would fork that record.

**Node-reference lifecycle: `assignElementIdOnAllNodes`, `deleteNodeReferences`, `convertKeyPathToSceneKeyPath`.** The audit takes its census under one fixed `nodeRefKey` (and `assertOneScreenShowing` under its own, `screenSwap`), and the device replaces that array on each call, so references can't pile up and there is nothing to delete between censuses. A census left holding nodes does not inflate the leak gate's roots count (measured on `.177`, 2026-09-08), because it walks from the scene and can capture only parented nodes, which `getRoots()` excludes. It doesn't cover a census taken while a view is open and the view then closed, which would leave an unparented node in the array; the leak gate prevents that ordering with the `hardRelaunch()` at the head of each measurement and a walk that ends on Home. **If the audit is ever asserted on, or its census budget is raised so it can run out mid-walk, `deleteNodeReferences` becomes owed.** `assignElementIdOnAllNodes` serves `base: 'elementId'`, which nothing here uses, and `convertKeyPathToSceneKeyPath` converts `appUI` paths, which nothing here produces.

**Coordinate hit-testing: `findNodesAtLocation`.** Answers "what is at x,y". A Roku is driven by a directional remote, not a pointer, so a test asserting by screen position would assert something no user can do and break on every layout change.

**Component-private state: `getComponentGlobalAAKeyPath`, `setComponentGlobalAAKeyPath`.** These read and write a component's own `m`. Coupling assertions to private state is the opposite of the north star: a test that reads `m` passes on a component whose declared interface is broken. `m.global` is different and is used through `getValue` and `setValue`: it is a declared surface the app owns.

**Client and transport lifecycle: `cancelRequest`, `setSettings`, `shutdown`, `getServerHost`.** The client drives these itself: `setSettings` is part of RTA's handshake after connecting, `cancelRequest` backs its request bookkeeping, and `getServerHost` reports a host we configured. [`scripts/rta-run.js`](../../scripts/rta-run.js) ends a run by process exit after restoring the registry, so the suite never calls `shutdown`.

**Whole-registry deletion: `deleteEntireRegistry`.** Never issued. `lib/registry.js` restores by explicit section with `APP_OWNED_KEYS` kept out, and a blanket wipe once destroyed a device's registry beyond recovery, since no run record holds the registry as it was before the run. The narrower `deleteRegistrySections` is what restore needs.

**Repeating observer: `onFieldChange`.** The repeating sibling of `onFieldChangeOnce`, retired by the same argument (see [Why every wait polls](#why-every-wait-polls)), and further still from polling, since a repeating observer also has to be torn down.

**Redundant with a cheaper read: `isSubtype`, `getApplicationStartTime`.** `isSubtype` answers about one node per request, while `subtype()` is a function keyPath that rides inside an existing `getValues` batch: `homeListId()` reads it off both candidate ids in one round trip, which would cost two `isSubtype` calls. `getApplicationStartTime` exposes `roAppManager.getUptime()` for performance work the app's instrumentation and `bootMs` already cover; it is the one entry here with a plausible future use, if boot timing ever needs the device's own clock.

**Node surgery: `removeNodeChildren`.** The bench specs own one node each and remove it whole with `removeNode`. Stripping a node's children while leaving it in the tree is an app operation, and this suite doesn't reach into the app's structure to do it.

<!-- rta-capability-inventory:end -->

## Layout

- `config.js`: `RTA_CONFIG` (demo server, hero movie, seek position, locales), shared with the store screenshot generator.
- `screens.js`: the **screen registry** (`SCREENS`), the single source for both the tests and the screenshots. Add a screen here.
- `lib/`: `driver` (environment, deploy, relaunch), `steps` (press, reads, `waitFor`, `waitFocused`, the shared media-player waits and the Home preconditions `waitHome` and `walkHomeToFirstRow`), `seed` (registry seeds), `registry` (whole-registry snapshot and verified restore), `jellyfin` (demo server REST), `nav` (per-screen navigation), `diagnostics` (the device-state dump at failure, and `FAILURE_KINDS`). The run record it writes into (directories, lifecycle, ledger, summary) lives in [`scripts/run-record.js`](../../scripts/run-record.js), shared with the Rooibos runner and knowing nothing about devices.
- `specs/`: the Vitest specs. Screens run in a `for` loop over `SCREENS`, not `it.each`: `it.each` passes only the case object, so a case can't skip itself at run time, and screens that depend on content need that.
- `capture.js`, `setup/`: the `RTA_CAPTURE` raw-capture helper and the Vitest global and per-worker setup.
- `demos/`: hands-free **video-capture** takes (`npm run demo`). `run.mjs` owns the privacy-safe lifecycle (snapshot, record, restore and relaunch); each `takes/*.js` declares only its choreography. These are not tests: they drive the device for marketing and PR demos against the public demo server only, and the runner refuses any other host.

## Rules

- **Run `npm run test:rta` to check for navigation and screen regressions** after touching `tests/rta/`, `scripts/capture-screenshots.js`, or app navigation and screens. It needs a device and `.env` (`ROKU_IP`, `ROKU_PASSWORD`); run `npm run device:check` first, and if the probe fails, say so: don't claim a pass.
- **CI runs this suite only on a push to a release branch, or by hand** ([`rta-functional-tests.yml`](../../.github/workflows/rta-functional-tests.yml)): there is one CI device and a full pass is long, so it is not a gate on each PR. That makes your local run the only feedback a PR gets; a regression you miss surfaces at release, after several merged PRs, where it is much harder to bisect ([`rta-tests.md`](../../docs/dev/rta-tests.md#when-ci-runs-it)).
- **Use `npm run test:rta:capture` (or `RTA_CAPTURE=1`) to see the screens** when changing or designing UI: it writes `out/rta-captures/<screen>.png`. The OSD's video plane is black there, as expected; the polished store images come from `screenshots:capture`.
- **Every wait lands in a justified category** ([Why every wait polls](#why-every-wait-polls)). For a new plain-field wait on a keyPath `jellyrock-rta/wait-justified` doesn't know, read where the app writes that field, confirm the target state is not a one-shot pulse, then add it to `VERIFIED_SETTLE_KEYPATHS`. Never add a keyPath you haven't checked: an unchecked entry is worse than a red lint, because it looks checked.
- **A fixed `sleep` is never the fix for a flake** ([Why the surviving sleeps are not arbitrary waits](#why-the-surviving-sleeps-are-not-arbitrary-waits)). The wait was succeeding too early, so gate on the state that makes the next step meaningful. `jellyrock-rta/sleep-budgeted` makes a new arbitrary wait a change to its budget table, and removing one fails the rule until the budget is lowered.
- **`waitFor` and `waitFocused` throw on timeout: that is the assertion.** Don't wrap them in `expect`. Use `expect` only for value checks (label text, focus subtype).
- **A predicate that compares one device read with another must check the second was read.** Reading a value off the screen and waiting for something to equal it is a good pattern (`dialogs.spec.js` finds the confirm buttons by their rendered labels, so it survives a locale change). But an absent read is `undefined`, and so is a focused node without that field: `f.node?.text === confirmLabel` with `confirmLabel` unread is `undefined === undefined`, so the wait passes on its first tick with focus anywhere, and everything built on it proves nothing. It takes only one absent read: a dialog with one button leaves `#buttonRow.1.text` undefined while `.0.text` reads fine. Check the reads before comparing, and check they differ where the test tells them apart. Not gated: the existing guards use different idioms, so if this recurs, move them onto one shared guarded reader and gate on that.
- **An ordering assertion over `indexOf` or `findIndex` must also check its operands were found.** `-1` is less than every real index, so `expect(a.indexOf(x)).toBeLessThan(b.indexOf(y))` passes when `x` is absent. `jellyrock-tests/ordering-asserts-presence` ([rule](../../scripts/lint/eslint-rules/ordering-asserts-presence.js)) gates this across `tests/**/*.{test,spec}.js`, this directory's `*.test.js` files included, with no escape hatch, because the fix is one line: `expect(haystack).toContain(needle)`, or `expect(idx).toBeGreaterThan(-1)` for a `findIndex`.
- **A spec that measures across a journey must assert the journey happened.** A number collected while the app is driven has a second precondition: that the driving occurred. Record a phase failure instead of throwing when the sample series is the deliverable (losing every sample to one missed focus gate is worse), but then assert the recorded failures are empty, after the artifact is written. Unasserted, it is a gate that proves nothing, and a worse one because it reads as coverage. On `.177` (2026-09-08), both journey phases of [`task-thread-peak.spec.js`](specs/task-thread-peak.spec.js) timed out returning to Home, the test passed, and it reported a peak below the band [`global-state.md`](../../docs/architecture/global-state.md) documents, because the peak was taken over an app sitting still. That spec is the primary defense against the `&h29` fan-out class ([ADR 0031](../../docs/adr/0031-task-thread-ceiling.md)). A quiet, unexpectedly low measurement is the signature: suspect the driving before you believe the number.
- **Preconditions before actions and reads:** see [the north star](#-the-north-star-establish-the-state-that-makes-an-action-or-a-read-meaningful-before-doing-it). It is the rule most worth learning before you touch a nav.
- **A timeout must report what it saw: throw through `diagnosedError`, never a bare `new Error`.** `lib/diagnostics.js` attaches the device's actual state (the active view and its `loadState`, the app shell's `isLoading` and `isRemoteDisabled`, the focused node, row counts, the seeded server and user) and appends a record to the run's `failures.jsonl`, which the run record folds into `run-meta.json` at the end of the run ([`scripts/run-record.js`](../../scripts/run-record.js)). The capture runs only at the throw, after a poll loop has given up, so it costs nothing when the wait succeeds. This applies to **timeouts**; a fail-fast that already names its cause (the ambiguous-library refusal in `nav.js`) can stay a plain throw.
  - **This is enforced.** A `no-restricted-syntax` rule in [`eslint.config.js`](../../eslint.config.js) fails `lint:js` on a `throw new …` in `lib/nav.js`, `lib/steps.js`, `screens.js`, `demos/` and `scripts/capture-screenshots.js`. A real fail-fast disables it on that line with a reason. Add a new lib file that grows a wait to that list; `specs/` stays out, because most spec-level throws are assertions, not timeouts.
  - **In a take, use `ctx.waitFor` rather than a hand-written poll:** it already throws through `diagnosedError`, so you get the dump for free.
  - **`kind` comes from the frozen `FAILURE_KINDS` set, never an inline string:** a flake baseline groups by it, and an invented slug splits a group. An unregistered one is recorded and called out in the run summary.
  - **Prefer passing state the loop already read as `observed`** over reading it again: that is what turns `2 row(s) present` into `rowTypes=[Chapter, Person]`, the difference between late and absent.
  - **`loadState=—` on a detail screen is correct:** that field is `BaseGridView`'s, and `ItemDetails` extends `JRScreen`. Read `detail=<n>` and the shell fields there instead. `input=BLOCKED` means `JRScene.onKeyEvent` was swallowing every key sent, the north-star failure made visible.
  - **Never dump a whole node into a record:** `JellyfinUser` carries `authToken`, so read identity by named field.
  - The full shape is in [`rta-tests.md`](../../docs/dev/rta-tests.md#when-a-wait-times-out-it-reports-what-it-saw).
- **Guard every repeated `action`, and never let one fail silently.** Press only while the target state is not yet reached (the focus-walk navs and `waitOsdUp` read first): a blind re-press can disturb a UI that already responded. `waitFor` and `waitFocused` count actions that throw and name them in the timeout message; keep that, because "the key never landed" and "the screen never rendered" otherwise look the same.
- **A read that never completed is not a field that never changed, and the waits count both.** `getVal` and `getActiveVal` still turn a failed read into `undefined` (right for a poll: the loop retries and `waitFor` owns the timeout), but `waitFor` and `waitFocused` count reads that didn't complete and name them (`readErrors=<n>` in the message and in `observed`). The distinction is real on the wire: ODC answers `found: false` for a keyPath it resolved and didn't find, and rejects only when the request itself failed, so an ordinary "not there yet" timeout reports `readErrors=0`. **A custom `read` gets no attribution** (only `getVal` and `getActiveVal` are mapped); add a new shared reader worth attributing to `ATTRIBUTING_READS` in [`lib/steps.js`](lib/steps.js) instead of wrapping it at a call site. This came from [#785](https://github.com/jellyrock/jellyrock/issues/785), where degrading runs left only `last=undefined` and couldn't be attributed.
- **A one-shot assertion reads the screen in one batch, not field by field.** Use `getActiveVals([...])` from [`lib/steps.js`](lib/steps.js): ODC's `getValues` handles every request in one on-device message, so many keyPaths cost one round trip. **This is a correctness rule, not a speed win.** The suite's run time doesn't change noticeably; what shrinks is the observation window. Reads taken one after another observe a still-settling screen across hundreds of milliseconds, so the 50th field need not describe the same frame as the first (measured 2026-08-12 on `.177`: 303 ms for 57 sequential reads, 58 ms batched). Poll loops keep the single-read `getActiveVal`: they retry by design, and `waitFor` owns their timeout.
- **Never swallow a failed server request into an empty result: report absence only from a request that succeeded.** `lib/jellyfin.js` throws a typed `JellyfinRequestError` on any non-2xx or transport error; don't wrap a call in `.catch(() => null)` or `.catch(() => [])` to tolerate a flaky fixture. A sentinel looks exactly like a real empty result, and every caller reads an empty result as a fact about the demo server, so the failure surfaces as a confident false statement, not an error. Both ways it landed were seen on 2026-08-12: a swallowed 401 in `getLibraries` made `libraryIdFor` return `null`, which drove `screens.spec.js`'s fixture-shortfall skip and reported the run green; and a session evicted partway through `genreItemNames`' loop produced a coherent, fictional picture of a shrunken demo server that was written up as a finding. Returning `{ index: 0, id: '' }` or `[]` is still right **after the server answers**. A run that failed with a `server-request-failed` record folds as `outcome: blocked` instead of failed, so a broken fixture leaves the flake population instead of counting as app flake.
- **Authenticate with your own role; never share a `DeviceId`.** `authenticate(server, { role, deviceKey })` builds `jellyrock-<role>-<deviceKey>`. Jellyfin keys a session to its `DeviceId`, and a second sign-in under the same one ends the first token, so two tools (or one tool on two devices) sharing an id silently sign each other out mid-run. A new entry point passes its own `role`; see decision `session-identity-per-role-and-device` in [`decisions.md`](../../docs/decisions.md).
- **Check an assertion that depends on content against the demo server's actual content before writing it, and make it throw when it verified nothing.** The demo library is small and shrinks, and an assertion keyed on content it never has passes forever while reading as coverage. A genre-row check once keyed on the `View All` child, which no demo genre was large enough to show, so it never checked anything. Query the server first (`getJson` in `lib/jellyfin.js`), then assert, with a `verified` counter that throws at zero.
- **Library navs target a library by id.** Pass `libraryIdFor(ctx.libraries, ct)` into `navLibraryByType`, and pass `ctx` through every chained nav. Matching on `collectionType` alone picks the first Home tile of that type, while seeding picks the first `/UserViews` entry; on a server with several libraries of one type they disagree, and a screen seeded for library A gets driven to library B, silently. The demo server has one library per type, so **the suite can't catch this**: it shows up only on a real server with several.
- **Add a screen** with one entry in `screens.js` and a `nav` in `lib/nav.js`. It becomes a functional test and, if `capture.eligible`, a store screenshot. Keep navs free of screenshot concerns (no backdrop or ffmpeg work: that is the store orchestrator's job).
- **After any registry write, relaunch with `hardRelaunch()`, not `relaunch()`.** A plain `relaunch()` only brings a running channel to the front, so the app saves its in-memory session over the seed and the suite silently drives the wrong server; it shows up as dozens of unrelated timeouts, not as a seed error. `assertSeedTookEffect()` (in `lib/seed.js`) guards each seed: keep calling it. The same rule holds in `scripts/capture-screenshots.js`, where the failure silently captures the wrong library into the store set.
- **Seeds write the real registry.** They write the real `JellyRock` registry, not `test-*` sections, because the app reads real keys to pick a screen. This is the accepted exception to the `tests/CLAUDE.md` `test-*` rule, which governs in-process Rooibos tests.
- **Never put the device-registry lifecycle in a spec.** Specs seed; they don't snapshot or restore. [`scripts/rta-run.js`](../../scripts/rta-run.js) owns that for the whole run: it snapshots the whole registry before any seeding, runs Vitest as a child, and restores and verifies afterward, on Ctrl-C too. A per-spec `afterAll` can't do this: it never runs on a killed process, and Vitest exits shortly after its own SIGINT handler fires, too soon for a restore to finish (measured 2026-08-10: a SIGINT partway through a run left `.178` signed in to the demo server). A new RTA entry point snapshots through `lib/registry.js` from the main process, never from a spec.
- **Build flavor:** tests run against the dev build (`npm run build`); store screenshots use prod (`build:prod`). Never use `build:prod` for a path that needs source maps or logs for debugging.
