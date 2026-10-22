# Rules for `components/`

Roku SceneGraph components: an XML interface paired with a BrighterScript code-behind. [docs/architecture/navigation.md](../docs/architecture/navigation.md) has the router and the screen lifecycle, and [docs/architecture/global-state.md](../docs/architecture/global-state.md) the typed `ContentNode` data layer.

## File pairing and scoping

- A component is `Foo.xml` and `Foo.bs`, with the same base name in the same directory. They scope together with no `<script>` tag.
- Component XML lives only under `components/`; `source/` holds only `.bs` files.
- Pull in shared code with `import "pkg:/source/..."` in the component's `.bs`. First-party components use `import` only; don't add `<script>` tags (vendored components under `roku_modules/` and `vendor/` keep theirs).
- Subfolders group by feature (`video/`, `login/`, `settings/`). Using a component from another feature is fine: components are created by name (`createObject("roSGNode", "Foo")`), not by path.

## Component hierarchy

- The root scene, one for the app's lifetime, is `JRScene`.
- Every full-screen view extends `JRScreen`, which extends `JRGroup`, which extends the router's `sgrouter_View`.
- Overlay panels and dialogs that need `JRGroup`'s fields extend it (`JRDialog`, `JRListDialog`, `OverviewDialog`, `QuickConnectDialog`, `SubtitlePanel`). Building blocks inside them extend `Group` (`JRDialogPanel`, the `ui/` widgets).
- [navigation.md](../docs/architecture/navigation.md) lists `JRGroup`'s fields (`lastFocus`, the overhang fields, `loadingWaits`). Don't copy that list anywhere else.

## Lifecycle hooks (`JRScreen` subclasses)

- Override `onScreenShown()` to restore focus and refresh data when the screen is shown again. The base version restores focus.
- Override `onScreenHidden()` to pause Tasks and hide UI while keeping state. The base version does nothing.
- Override `onDestroy()` to release Task nodes, unobserve fields and drop large data. SceneGraph never chains `onDestroy()` to a base class, so the base version (which calls `abandonApiPromises()`) runs only for a screen that has none of its own. A component that calls `fetchAsync` gets `abandonApiPromises()` added to its own `onDestroy()` at build time by the `auto-abandon-promises` plugin, and `jrscreen-on-destroy` warns about a `JRScreen` subclass with no `onDestroy()`. **Unobserve everything before you release anything:** see the ordering rule under Input handling. Opt-out comments for these plugins are in [build-and-tooling.md](../docs/architecture/build-and-tooling.md#convention-plugins).
- **A routed screen owns its own load spinner.** A screen that fetches data on open starts the wait when the fetch begins and ends it when the data arrives; callers only navigate. Don't stop a spinner right after a `navigateTo` to a different view: navigation settles at `NavigationEnd`, so `activeRoutedView` is still the outgoing view and stopping shows it again for a frame ([navigation.md](../docs/architecture/navigation.md#loading-spinners-across-navigation)).
- **Name the wait by its kind.** A screen waiting on the server for its own data opens a named wait on itself, `screenWaits.begin(m.top, "results")`, and ends it on every exit path with `screenWaits.finish(m.top, "results")`. The scene shows it only while that screen is active, so it can't outlive the screen, be ended by another, or vanish when the viewer comes back.
- **Starting playback is not a screen's wait.** Open it with `QueueManager.beginPlaybackStart(label)`, or through `launchItem` (for a playable item), `launchQuickPlayAction` or `launchShuffle`, which do. Never use a spinner of your own: the player that mounts takes the wait and ends it, and leaving before a player exists fails it (`source/utils/appWaits.bs`). While the wait hides the screen it was pressed on, `AppWaitHost` holds the remote focus, so don't give that screen focus or keys meanwhile. `startLoadingSpinner()` is the plain spinner for call sites not yet given a kind. With the remote disabled it holds the remote focus in `AppWaitHost` too, so the hidden screen takes no keys. The kinds and their rules for Back and text are in [navigation.md](../docs/architecture/navigation.md#what-kind-of-wait-a-spinner-is).

## Observing a field on a long-lived node

**An observer registration is not private to the component that made it.** On a device, a component calling `m.top.unobserveField` (or `unobserveFieldScoped`) on its own field removed the plain observer its parent held on that field. That is the #898 regression, recorded in [`ObserverRegistry.spec.bs`](../tests/source/unit/platform/ObserverRegistry.spec.bs).

⚠️ **That spec records one narrow configuration; it is not a model of how observers work.** Its header lists what it covers and what it doesn't. In particular, `observeFieldScoped` is not understood here: some scoped rows in the spec disagree with Roku's `ifSGNodeField` page, and one configuration is no ground for a rule. So the rules below treat `observeField` and `observeFieldScoped` the same, and nothing may depend on scoped behavior ("switch the parent to scoped so it survives") until that case is measured.

So who else can observe the node decides what you may do.

### `m.top`: register in `init()`, release in `onDestroy()`, nothing in between

Any parent can observe your node, and nothing inside the component can tell. #898 shows the cost: `VideoPlayerView` re-registered `state` with "unobserve, then observe" to avoid duplicates, which also removed `PlayerHostView`'s `state` observer, the one that advances the queue. An episode that ended left a stopped player on a black screen (fixed in #913).

- Call `m.top.observeField` or `observeFieldScoped` with a handler only in `init()`, which runs once per node: that placement is what guarantees one registration. A helper called from `init()` counts as outside it, so inline it.
- Call `m.top.unobserveField` or `unobserveFieldScoped` only in `onDestroy()`, where the node is going away with its observers anyway.
- When a handler must sometimes not act, gate it with a flag instead of toggling the observer: readiness (`VideoPlayerView`'s `m.isContentLoaded`), the component's own write (`VideoPlayerView`'s `m.isApplyingOwnSelection`, `JRPoster`'s `m.isResettingBadge`), or a mode (`JellyfinUserSettings`' `m.isAutoSyncEnabled`).

**Both halves are build errors:** `top-observer-outside-init` and `top-unobserve-outside-ondestroy` in [`field-observer-wiring`](../docs/architecture/build-and-tooling.md#convention-plugins). Message-port observers (the pool Tasks' request loops) are outside its scope.

### A child node only this component observes: two shapes

A member bound once from `m.top.findNode()` (a `Timer`, say) is private to the component, so toggling its observer is allowed. It must still be wired in exactly one of two shapes. Anything else piles up registrations, and the handler then runs once per registration on every notification. That stays silent while the handler is idempotent, which is why these bugs survive for months.

- **Register once in `init()`** and never again; drive the timer with `control` alone, and unobserve only at teardown. [`PhotoDetails.slideshowTimer`](photos/PhotoDetails.bs) is the reference: observed in `init()`, started and stopped from several handlers, unobserved only in `onDestroy()`. `VideoPlayerView`'s `playbackTimer` is a second example. It once unobserved in `onState`'s `stopped` and `finished` branches and never registered again, so any reload (an audio, subtitle or source change, `retryPlayback`) left the 10-second progress timer running with no listener (#907).
- **Balanced toggle:** observe on the way in and `unobserveField` on every exit path, not only the common one. [`OSD.inactivityTimer`](video/OSD.bs) is the reference: `onVisibleChanged` observes in the `true` branch and unobserves in the `false` branch.

If a toggle has an exit that can't unobserve (an `else` for an unhandled state, an early return), put an `unobserveField` right before the `observeField`, so the registration stays single whatever the caller does. `VideoPlayerView`'s `bufferCheckTimer` does both. **This is safe only on a node nobody else observes, never on `m.top`** (see above).

**The register-once half is a build gate.** [`register-once-observer`](../scripts/bsc-plugins/register-once-observer.cjs) fails the build when a member bound from `m.top.findNode()` in `init()`, and observed exactly once there, is unobserved anywhere but `onDestroy()`. It recognizes the register-once shape first and only then checks where the detach is, so toggles never enter its scope (`bufferCheckTimer` is invisible to it). One site in the tree is flagged and suppressed: `ResumeButton.buttonIcon`, whose suppression states the two facts the gate can't see (a static URI, a node that is not recycled).

**The balanced-toggle half is convention only.** Deciding whether every exit path unobserves needs control-flow analysis, and nothing gates it. `bufferCheckTimer.fire` (one of three causes in #899) and `playbackTimer.fire` above are the cases so far. (#896 `position` and #898 `state` were the same pile-up on `m.top`, which the section above now gates.)

## Render thread protection

- Roku's render thread runs the UI. Network and large file I/O **must run on a Task thread**. A small registry write on a user action (a setting, a recent search) is the exception; a large or repeated one goes on a Task too (decision `search-history-render-thread-write`). Which thread is which (there are three, and main is not render), and the measured list of what can be created where, are in [threading.md](../docs/architecture/threading.md).
- For HTTP from a component, build the request with `GetApi().Build*Request()` and send it with `fetchAsync()`, which returns a promise ([api.md](../docs/architecture/api.md)). `fetchRes()` blocks and is for Task threads only.
- One `m.global.<child>` read is fine. For several reads in a hot path, keep the node in a local first (`globalUser = m.global.user`, then `globalUser.foo`, `globalUser.bar`).
- For bulk field updates, prefer `node.setFields({ a: 1, b: 2 })` to a run of assignments.
- **Crossing the thread boundary costs a rendezvous: count the crossings, not the bytes.** A Task writing a field on, or appending a child to, a node the render thread owns waits until that thread is ready, then copies the payload. The two bullets above follow from this. When handing data from a Task to the UI, batch it and send the cheapest form: strings and small AAs copy far more cheaply than node trees, so let the render thread build its own nodes. The cost model and its measurements are in [async.md](../docs/architecture/async.md#crossing-the-thread-boundary-costs-a-rendezvous--budget-crossings-not-bytes).
- **Component code runs on the render thread, so `m.global` and Task nodes are cheap for you to touch.** The crossing cost falls on Task-thread code. That doesn't make loops free: a walk over many nodes is still interpreter work no thread placement removes, so budget the loop as well as the crossing ([threading.md](../docs/architecture/threading.md#measured-findings)).

## Starting a Task thread

- **Start every Task through `launchTask(node)`** (`source/utils/tasks.bs`; add `import "pkg:/source/utils/tasks.bs"`). A raw `node.control = "RUN"` is a build error from the `no-raw-run` plugin.
- Why: Roku OS caps an app at 100 concurrent threads and raises `&h29` past it (epic #728). `launchTask()` is the one place a thread starts, so debug builds can count the live threads with [`printTaskThreads()`](../docs/architecture/debug-tools.md).
- **Never launch one Task per item.** A `launchTask()` inside a `for`, `for each` or `while` is a build error from the `no-task-fanout` plugin, unless its argument is a fixed `m.<field>` slot the loop doesn't rebind. Parking a fresh node in an `m.` slot each turn is flagged too, as is a loop calling a same-file helper that launches a new node per call. #728 took one thread per library, and correct teardown doesn't help: the crash is many launches at once inside one screen load, not threads leaked across navigation. The fix is one orchestrator Task serving every item through [`apiPipeline`](../source/api/apiPipeline.bs); [`LoadLatestRowsTask`](home/LoadLatestRowsTask.bs) is the reference. If a helper keeps at most one run live however often it is called (a guard, or a cancel first), say so on its launch line: `' bsc-disable-next-line no-task-fanout <the bound>` (`HomeRows.startResumeLoad` is the model).
- **An invalid node is a silent no-op, not a crash.** `launchTask` returns `false`, where a raw `RUN` on an invalid node faulted. A row that doesn't load beats an app that dies, but it is harder to diagnose, so debug builds print a `[TASKS] launchTask() called with an invalid node` line. Check the return only where a failed launch needs handling, typically a loading flag that only the run's delivery clears (`m.isLoadingResume = launchTask(…)` in `HomeRows`).
- **Past the thread watermark a launch waits, and `launchTask` still returns `true`** ([ADR 0041](../docs/adr/0041-task-launch-queue.md)). The node waits in `m.global.taskLaunchQueue` reading `state = "init"` until a slot frees, so `false` means only an invalid node or a full queue. **To ask "is my run still going?", call `isTaskInFlight(node)`, not `node.state = "run"`,** which calls a waiting run finished; replacing it then sends the new run to the back of the queue (`PlayerHostView.onPlaybackInfoRefreshDue`). A node STOPped while it waits is dropped, except a node relaunched after a finished run, which reads `"stop"` either way and starts late (the ADR lists those sites).
- **Stopping needs no wrapper.** `node.control = "STOP"` stays as it is: the count comes from each node's `state`, so a stop is picked up on its own.
- **A run that can restart mid-flight needs a new Task node, not a relaunch.** `STOP` then `launchTask` on the same node in one callback, while its function is still running, is a race: sometimes the launch is silently ignored and sometimes it starts. A new node launched in that callback always starts, and the stopped function makes no more progress, so threads don't stack up. Two more shapes fail the same way ([threading.md](../docs/architecture/threading.md#measured-findings) has the measurements):
  - **Relaunching from the Task's own delivery handler.** Inside the observer for the field the Task writes last, the node still reads `run`, and the relaunch is dropped (the TV guide's channel pages), so each page needs a new node.
  - **Keeping one node for a component's whole life and launching it again from a later callback** (write the input, `launchTask`, no STOP). If the previous run hasn't returned, the launch is ignored every time and nothing is queued, and a Task that reads its input again after its request can deliver a result mixing the two runs (`MoviePresenter.loadLogo` did, fixed in #997). Only a site that waits for `state = "stop"` before relaunching is safe this way (`TrickplayCarousel`, which says so on a suppression).

  **Use `m.task = replaceTask(m.task, "<Type>", "<observedField>", { inputs })`** (`source/utils/tasks.bs`), and make `isCurrentTaskEvent(event, m.task)` the handler's first statement. Roku doesn't promise that `unobserveField` cancels an event already queued, so without the guard a replaced run's event reads the new node's empty output and unobserves it. First means before a `screenLoad.resolve` or a spinner stop too. **The guard rejects only a replaced run's event,** so where the context changes (a new song, a new item) and the new context may start no run of its own, release the old run there; otherwise it is still the current node and its late delivery passes the guard. `AudioPlayerView.pageContentChanged` does this on every track change, because a fully tagged song starts no metadata fetch (decision `audio-metadata-release-on-track-change`); the build gate can't see this case. `SearchScreen.runFullSearch` and its handler `onFullSearchResults` are the reference, and `tests/source/unit/platform/TaskRelaunch.spec.bs` pins the behavior.

  **The `no-same-node-relaunch` plugin makes these build errors:** a STOP then `launchTask` of the same node in one function (or after a same-file helper, `releaseTask` or `replaceTask` that STOPs it, with the result not assigned back); a `launchTask(m.x)` with no new node assigned to `m.x` earlier in the function; and a handler of a `replaceTask` node, in the same file, that doesn't open with `isCurrentTaskEvent` (logging aside). Suppress a launch that provably can't overlap a running one on its line, with the reason. The plugin's `PENDING_MIGRATIONS` parks sites older than the rule, or older than a change that lets it see a new shape, and never a new launch. It has been empty since 2026-10-13.
- `control` is not Task-only: `Animation` (`"start"`, `"pause"`) and `Video` (`"play"`, `"rewind"`) use the same field name, and the rule leaves them alone.

## Input handling: `onKeyEvent`

- Signature: `function onKeyEvent(key as string, press as boolean) as boolean`.
- `return true` consumes the event; it goes no further.
- `return false` (or no return) passes it to the parent.
- By convention, child components return `false` for `press = false` so key releases can travel up. **Don't build a feature on key releases reaching `JRScene`,** though: Roku built-ins (`RowList`, for example) consume releases for keys they handle, and the vendored sgRouter `Outlet` consumes every release that comes out of a routed view. That is why the up-up-down-down debug code rarely works on routed screens; [`debug-flags.md`](../docs/dev/debug-flags.md) has toast-test paths that do.
- **A key event can arrive after your `onDestroy`, and `m.isDestroyed` is already handled for you.** sgRouter leaves a closing view mounted, visible and in the focus chain until a removal it defers to a later turn of the message loop, so a screen whose `onDestroy` has released its node references can still get one more key press, and every bare `m.someNode.…` in `onKeyEvent` is an `&hec` waiting to happen. The [`auto-destroyed-guard`](../docs/architecture/build-and-tooling.md#scriptsbsc-pluginsauto-destroyed-guardcjs) plugin adds the flag and the early return at build time to any component declaring both `onDestroy` and `onKeyEvent`, so don't write it by hand. Don't rely on `isValid(m.node.field)` either: it guards the field, not the node.
- **In `onDestroy`, detach every observer before releasing any reference.** This window mirrors the one above: a writer can deliver an observed field one last time while your `onDestroy` is still running, and if you have already released a reference that handler uses, it throws `&hec` (#733). The writer isn't always outside the component (a Task thread, the native playback engine): **the component's own pending async work counts too,** a `fetchAsync().then()` or a Task observer of its own that resolves after teardown starts. Do it in two phases, in this order: every `unobserveField`, then every `= invalid`. [`unobserve-before-release`](../docs/architecture/build-and-tooling.md#convention-plugins) warns when you interleave them in a way that can bite. Reorder to clear the warning instead of adding an early return to the handler, because some observers must run during teardown (stop reporting, dialog cleanup) and a guard would skip those too.
- **Wire an interface field to its handler once, and let `onDestroy` decide which form.** Declaring both an XML `onChange` and an `m.top.observeField()` registers two observers and runs the handler twice on every write. It stays silent while the handler is idempotent, which is how `OSD.itemData` and `IconButton.isButtonSelected` carried it for months. One structural question decides the form:
  - **No `onDestroy` in the code-behind: use XML `onChange`.** The component releases nothing, so none of its handlers can use a released reference, and the observer dies with the node. Most components that use `onChange` are this case.
  - **An `onDestroy` in the code-behind: use `m.top.observeField()` in `init()`,** with a matching `unobserveField()` before every release in `onDestroy`. An `onDestroy` declares that the component releases state, and from then on any handler that can still run is a hazard; an XML `onChange` is the one form that can't be detached.

  ⚠️ **`unobserveField` does not appear to remove an XML `onChange`,** so a field wired that way can't be detached at teardown, and `unobserveField` returns `true` anyway, so its return value won't tell you. Treat this as the safe assumption, not settled platform behavior: Roku's own docs say an `onChange` "is equivalent to calling ... `m.top.ObserveField()`", and only current firmware has been tested, while the app supports Roku OS 15.1 and later. If you need a handler detached, use `observeField`.

  ⚠️ **Why the rule keys on `onDestroy` rather than on "can a writer of this field outlive teardown?"** The second is the truer statement of the risk, but no linter can decide it, so every site would rest on someone's memory. The structural question is provable, checkable by a script, and errs on the safe side. The cost is that adding an `onDestroy` for an unrelated reason (stopping a Task, say) also means converting that component's `onChange` fields, which is exactly when the hazard becomes real.

  All three halves are build errors in [`field-observer-wiring`](../docs/architecture/build-and-tooling.md#convention-plugins): an `onChange` in a component that tears down (`undetachable-observer`), a field wired twice (`duplicate-field-observer`), and an `unobserveField` on a field only an XML `onChange` registers (`ineffective-unobserve`).

  ⚠️ If you audit this with a regex instead, `observeField\("x"` also matches `unobserveField("x")`: guard it with `(?<!un)`, or every component that unobserves correctly shows up as a hit. The plugin walks the AST and doesn't have this problem.

## Showing a dialog

**The full contract and its reasons are in [`docs/architecture/dialogs.md`](../docs/architecture/dialogs.md).** Read it before building or restyling a dialog. What follows is what you need so you don't get it wrong by accident.

- **Always go through `source/utils/dialogs.bs`:** `showAlertDialog`, `showConfirmDialog`, `showChoiceDialog`, `showStillWatchingDialog`, `showListDialog`, `showOverflowMenu`, `showInfoDialog`, `showReportDialog`, `showKeyboardDialog`, `showQuickConnectDialog` ([navigation.md](../docs/architecture/navigation.md#the-standard-dialog-system-sourceutilsdialogsbs) says which component each shows). The helpers are the only path that stamps the shared overlay id; a dialog that skips them is invisible to `isOverlayDialogOpen`, `SceneManager`'s `isDialogOpen` and `cancelOpenDialog`. The `no-hand-rolled-dialog` plugin makes a hand-built overlay a build error. Reference call sites: `ItemDetails.onWatchedButtonPressed` and `onDeleteButtonPressed`.
- **Never build your own chrome or layout.** Chrome comes from `JRDialogPanel`, geometry from `source/utils/dialogLayout.bs` (pure and unit-tested). A dialog supplies a body and a footer, nothing else. Private copies of this are how the app once had two dialog looks that passed every gate.
- **The result arrives on the dialog node's own `result` field,** shaped `{ cancelled, confirmed, buttonIndex, buttonText, optionIndex, value, externallyCancelled }`. **Read `externallyCancelled` if your handler acts:** it is true when code closed the dialog (`cancelOpenDialog`, or `presentOverlayDialog` replacing it) rather than the user, which `cancelled` alone can't tell you. It works for overlay dialogs only: the keyboard dialog resolves through Roku's modal `close`, which can't tell the two apart, so it reports `false` even when `cancelOpenDialog` closed it. Don't build an acting handler on a keyboard dialog. From a component, pass `onResult` (a function name in your scope) and the helper wires the scoped observer. Main-thread code (`source/*.bs` in `Main()`'s scope) has no component scope: leave out `onResult`, observe with `dialog.observeField("result", m.port)`, and compare node identity (`node.isSameNode(m.myDialog)`) before acting. `replayRoute.onServerSwitchDialogResult` is the reference.
- **Set every text field before presenting, never after.** A dialog lays out once, when `renderTracking` first reports it fully rendered, so text set later draws over the old layout.
- **Tearing one down takes one of two verbs, and they are not interchangeable.** `abandonDialog(dialog)` delivers nothing: right in your `onDestroy`, where the scope that would receive the result is going away. `cancelOpenDialog()` delivers a cancelled result: right when you need the screen clear but someone else owns the dialog and is holding state until it answers. The wrong one strands a flow with no symptom at the call site. **If your result handler acts (navigates, changes state), order matters too:** abandon yours before anything else can cancel it, because a cancel looks the same as the user pressing Back and would fire your action inside someone else's flow. The rule and its test are in [`dialogs.md`](../docs/architecture/dialogs.md#presenting-and-tearing-down).
- **Overlay dialogs are appended to the scene,** not to your screen, so they survive your `onDestroy`. A screen that opens one owns tearing it down. Only one is on screen at a time: `presentOverlayDialog` replaces the current one, so your call site needs no re-entry guard.
- **Key behavior belongs in `source/utils/dialogKeys.bs`,** not in a component's `onKeyEvent`: it is pure, so a test can reach it. `listDialogKeyAction` and `buttonDialogKeyAction` are the models.
- **`SceneManager` has no dialog methods left** except `isDialogOpen`, which is a query.

## Theme colors: which one means what

The theme palette encodes **interaction state**, not only hue. Picking by what looks right is how the meaning drifts.

| Constant | Use for | Never |
|---|---|---|
| `colorPrimary` | What the user can **focus or act on**: focus rings, the selected-item indicator, active-state chrome | Static decoration |
| `colorSecondary` | **Non-focusable** highlights: accent rules, emphasis marks, decorative dividers | Anything focusable |
| `colorBackgroundPrimary` | Panel and surface fills | |
| `colorBackgroundSecondary` | Structural separators, subtle borders, footprints behind focus | |
| `colorTextPrimary`, `colorTextSecondary`, `colorTextDisabled` | Text by emphasis level | |

It matters most where both appear in one frame, as in a dialog: the button focus ring is `colorPrimary` (focusable), and the accent rule under the title is `colorSecondary` (not focusable). An accent rule in `colorPrimary` would read as something you could move focus to.

Users can change every one of these (**Settings → User Interface → General → Theme**, then **Custom**), so a color picked for how it looks in the default theme will be wrong in someone else's. Pick by meaning and it survives any palette.

### Border weights: 3 pixels static, 6 pixels focusable

The 9-patch border images follow the same principle: the weight encodes interaction state. `border-3px.9.png` is for static panel edges: `JRDialogPanel`, the frame of every dialog. `border-6px.9.png` is for focusable things: `TextButton`'s focus ring, `IconButton`, `FocusableOverview`, the dropdowns, and the list and grid focus indicators. The thick border is part of the "you can focus this" signal, so keep the weights distinct.

## Common patterns

- **`isValid(x)`** for invalid checks; never compare to `invalid` with `=`.
- **`alwaysNotify="true"`** on an interface field makes its observers fire even when the value didn't change.
- **Set then clear** (`field = node`, then `field = invalid`) fires the same value twice in a row on a field without `alwaysNotify`. [user-journey.md](../docs/architecture/user-journey.md) explains it.
- **Inheritance:** XML `extends="JRScreen"` inherits every parent interface field and child.
- **`callFunc` needs an interface declaration.** To call a component method with `node.callFunc("methodName")` (main-thread code delegating to the render thread, as in `loginRouter`'s `m.scene.callFunc("routerNavigate", …)`), the component's XML `<interface>` must declare `<function name="methodName" />`. Without it the call does nothing, with no compile or runtime error. The `callfunc-interface` plugin fails the build when a `callFunc("X")` names a method a component defines but no component's interface declares. Reference: `JRScene.routerNavigate` and its `<function>` line in `JRScene.xml`.

## `RowList` and grid item components (focus-indicator layout)

Building or changing the `itemComponentName` for a `RowList` or `MarkupGrid` (a poster with a title below it)? The focus indicator pins to the poster slot (`rowItemSize` or `itemSize`) **only when `rowHeights` is taller than the slot**. Without `rowHeights` it wraps the item's whole bounding box, poster and title, so the border reaches past the image and covers the title. Set `rowHeights` to the slot height plus a title area and put the title below the poster, in that area. `JRRowItem` with `HomeRows` is the reference: the poster fills the slot from its origin, and the title sits `FOCUS_PADDING` below it. The full contract and its evidence are in [list-grid-item-layout.md](../docs/architecture/list-grid-item-layout.md); this has been rediscovered the hard way more than once.

## Custom list rows: let the list draw the focus indicator

Building an `itemComponentName` for a `MarkupList`? **Don't draw focus chrome in the row.** `drawFocusFeedback` defaults to `true`, and the list's own indicator glides between rows; a border per row can only blink on and off, which reads as lag. Call [`applyListFocusChrome(list)`](../source/utils/listTheme.bs) and leave the flag alone.

Three consequences follow, all measured in [list-grid-item-layout.md](../docs/architecture/list-grid-item-layout.md):

- The indicator draws outside the row, so give the list enough `itemSpacing` to keep it off the next row's text.
- Keep `rowHeight + itemSpacing` divisible by 3 for the 720p grid.
- On a screen with two focusable lists, set `focusFootprintBitmapUri` to `pkg:/images/1px-transparent.png`: the footprint draws only while a list lacks focus, so otherwise the idle one sits filled and reads as selected.

## What does not belong here

- No synchronous network call from a component: always go through the task pool.
- No direct registry access: use the helpers in `source/utils/config.bs`.
