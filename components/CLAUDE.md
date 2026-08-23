# Rules for `components/`

Roku Scene Graph (RSG) components — XML interface + paired BrighterScript backing file. See [docs/architecture/navigation.md](../docs/architecture/navigation.md) for the full scene-stack and lifecycle model, and [docs/architecture/global-state.md](../docs/architecture/global-state.md) for the `typed-ContentNode` data layer.

## File pairing and scoping

- A component is `Foo.xml` + `Foo.bs` with the same base name in the same directory. They auto-scope together — no `<script>` tag required.
- **XML files are only allowed under `components/`.** `source/` is BS-only.
- Use `import "pkg:/source/..."` in a component's BS to pull in shared utilities. `import` is the only mechanism — do NOT add `<script>` tags.
- Subfolders organize by feature (`video/`, `login/`, `settings/`, …). Cross-feature usage is fine; component instantiation is by name (`createObject("roSGNode", "Foo")`), not path.

## Component hierarchy

- Every full-screen scene extends **`JRScreen`** (which extends `JRGroup`).
- Every sub-panel / dialog extends **`JRGroup`**.
- The root scene (one for the lifetime of the app) is **`JRScene`**.
- See [docs/architecture/navigation.md](../docs/architecture/navigation.md) for `JRGroup`'s field surface (`lastFocus`, overhang fields, etc.) — don't duplicate that field list anywhere else.

## Lifecycle hooks (JRScreen subclasses)

- Override `onScreenShown()` — restore focus, refresh data on revisit.
- Override `onScreenHidden()` — pause Tasks, hide UI, but keep state.
- Override `onDestroy()` — release Task nodes, unobserve fields, drop large data structures. The base `onDestroy()` is a no-op; missing it leaks observers and tasks across navigation. Two BSC plugins enforce this; opt-out comments are documented in [build-and-tooling.md](../docs/architecture/build-and-tooling.md).
- **A routed screen owns its own load spinner.** If a screen fetches data on open, it `startLoadingSpinner()`s when the fetch begins and `stopLoadingSpinner()`s when data arrives — callers just navigate. Don't stop a spinner synchronously right after a `navigateTo` to a *different* view: the nav is async (settles at `NavigationEnd`) so `activeRoutedView` is still the outgoing view, and stopping re-shows it for a frame. See [navigation.md → Loading spinners across navigation](../docs/architecture/navigation.md).

## Render thread protection

- Roku's render thread runs the UI. Anything I/O — network, registry I/O, large file reads — **MUST run on a Task thread**. Which thread is which (there are three, and main ≠ render), plus the measured list of what is actually constructible where: [threading.md](../docs/architecture/threading.md).
- For HTTP, use the API task pool via `GetApi().Build*Request()` + `fetchRes()` / `submitApiRequest()`. See [docs/architecture/api.md](../docs/architecture/api.md).
- Single `m.global.<child>` reads are fine (cheap). Multiple reads in a hot path: cache locally first (`globalUser = m.global.user; globalUser.foo; globalUser.bar`).
- Bulk field updates: `node.setFields({ a: 1, b: 2 })` over individual assignments.
- **Crossing the thread boundary costs a rendezvous — count the CROSSINGS, not the bytes.** A Task writing a field on, or appending a child to, a render-thread-owned node parks until that thread is ready, then marshals the payload. Both bullets above are instances of the same rule. When handing data from a Task to the UI, **batch it** and **send the cheapest representation** — strings/AAs marshal far more cheaply than node trees, so prefer letting the render thread build its own nodes. Measured: re-shaping one grid handoff into 8 per-row handoffs (identical data) took `emit` from 220 ms to 734 ms. Full cost model + evidence in [async.md](../docs/architecture/async.md#crossing-the-thread-boundary-costs-a-rendezvous--budget-crossings-not-bytes).

## Starting a Task thread

- **Start every Task through `launchTask(node)`** (`source/utils/tasks.bs`; add `import "pkg:/source/utils/tasks.bs"`). A raw `node.control = "RUN"` is a **build error** — the `no-raw-run` BSC plugin enforces it.
- Why: Roku OS caps the app at 100 concurrent threads and raises `&h29` past it (epic #728). `launchTask()` is the one place a thread starts, so in debug builds the live count is measurable — see [`printTaskThreads()`](../docs/architecture/debug-tools.md).
- **An invalid node is a silent no-op, not a crash.** A raw `m.someTask.control = "RUN"` faulted when `m.someTask` was invalid; `launchTask` returns `false` instead. Better for users (a row that doesn't load beats an app that dies), worse for diagnosis — so debug builds print `[TASKS] launchTask() called with an invalid node`. Check the return only where you have something useful to do with a failed launch; no call site does today.
- **Stopping needs no wrapper.** `node.control = "STOP"` stays as-is: the count is derived from each node's `state`, so a stop is picked up for free.
- `control` is not Task-only — `Animation` (`"start"` / `"pause"`) and `Video` (`"play"` / `"rewind"`) use the same field name and are untouched by the rule.

## Input handling — `onKeyEvent`

- Signature: `function onKeyEvent(key as string, press as boolean) as boolean`.
- `return true` consumes the event; no further bubbling.
- `return false` (or no return) bubbles to the parent.
- Convention: child components return `false` for `press = false` so key-release events can bubble. **Do not build features on key-ups reaching `JRScene`, though** — verified on-device (2026-07): Roku built-ins (e.g. `RowList`) consume releases for keys they handle, and the vendored sgRouter `Outlet` consumes every release that bubbles out of a routed view. This is why the up-up-down-down debug cheat code no longer fires on routed screens; see `docs/dev/debug-flags.md` for working toast-test paths.

## Showing a dialog

- **Always go through `source/utils/dialogs.bs`** — `showAlertDialog`, `showConfirmDialog`, `showChoiceDialog`, `showListDialog`, `showInfoDialog`, `showKeyboardDialog`. `import "pkg:/source/utils/dialogs.bs"` and call one. Canonical call sites: `ItemDetails.onWatchedButtonPressed` / `onDeleteButtonPressed`. **No hand-rolled `appendChild` overlay is left** — the helpers are the only path that stamps the shared overlay id, and anything that skips them is invisible to `isOverlayDialogOpen` / `isDialogOpen` / `cancelOpenDialog`. Pass `returnFocusTo` when you ARE the opener and already hold the node (see `FocusableOverview`); omit it and the helper derives one from current focus.
- The result arrives on the **dialog node's own `result` field**, shape `{ cancelled, confirmed, buttonIndex, buttonText, optionIndex, value }`. Pass `onResult` (a function name in *your* scope) and the helper wires the scoped observer; keep the returned node so the callback can read `.result`.
- **From MAIN-THREAD code** (`source/*.bs` running in `Main()`'s scope) there is no component scope, so omit `onResult` and observe with the port instead: `dialog.observeField("result", m.port)`. Hold the node and compare it against the event's (`node.isSameNode(m.myDialog)`) before acting — identity is what keeps two main-thread dialogs from cross-firing, since they all arrive on one port under the same field name. `replayRoute.onServerSwitchDialogResult` is the reference.
- **`SceneManager` has no dialog methods left** — `userMessage`, `showConfirmationDialog`, `dismissDialog`, the shared `returnData` / `isDataReturned` fields and the `isPending*` flags are deleted. `isDialogOpen` is the one survivor, and it is a *query*, not a way to show anything.
- **Tearing one down: two verbs, and they are not interchangeable.** `abandonDialog(dialog)` delivers NOTHING — right in your `onDestroy`, where the scope that would receive the result is going away. `cancelOpenDialog()` delivers a **cancelled** result — right when you need the screen clear but someone else owns the dialog and is holding state until it answers. Getting them the wrong way round strands a flow with no symptom at the call site.
- Overlay dialogs are appended to the **scene**, not to your screen, so they survive your `onDestroy`. A screen that opens one owns tearing it down.
- **Exactly ONE overlay dialog is on screen at a time, and `presentOverlayDialog` keeps it that way.** Opening a second one SUPERSEDES the first: the incumbent is cancelled through its own resolve guard, so its owner gets the same `cancelled` result a `Back` press would have produced. You don't need a re-entrancy guard at your call site, and a main-thread owner doesn't need one either — port delivery is async, so its own identity check rejects the superseded dialog's late result. Roku's MODAL channel (`m.scene.dialog`) is deliberately *not* superseded. It has three writers, not just `showKeyboardDialog` — `QuickConnectDialog` and the player's `showPlaybackErrorDialog` are also there — and each has its own reason to be left alone (typed text, an auth handshake, a close handler that navigates). See [`dialog-channels-unarbitrated`](../docs/architecture/tech-debt.md#dialog-channels-unarbitrated).
- **Chrome and layout are shared — don't re-derive either.** The panel, edge, title and accent rule come from `JRDialogPanel`; the vertical flow comes from `source/utils/dialogLayout.bs` (pure, unit-tested). A dialog supplies its body and footer only. Three private copies of this is how the app ended up with two dialog looks that every gate passed.
- **`showListDialog` has no Cancel button** — the rows are the only focusable thing in it. `OK` commits, the list wraps in both directions, and `Back` is the exit. The model is `listDialogKeyAction` in `source/utils/dialogKeys.bs`; don't re-implement it in `onKeyEvent`, and don't hand the list back to Roku's `fixedFocusWrap` (it consumes both keys the dialog needs).
- Full contract: [navigation.md → The standard dialog system](../docs/architecture/navigation.md).

## Theme colors — which one means what

The theme palette encodes **interaction state**, not just hue. Picking by "what
looks right" is how the meaning drifts.

| Constant | Use for | Never |
|---|---|---|
| `colorPrimary` | Things the user can **focus or act on** — focus rings, the selected item indicator, active-state chrome | Static decoration |
| `colorSecondary` | **Non-focusable** visual highlights — accent rules, emphasis marks, decorative dividers | Anything focusable |
| `colorBackgroundPrimary` | Panel / surface fills | — |
| `colorBackgroundSecondary` | Structural separators, subtle borders, footprints behind focus | — |
| `colorTextPrimary` / `colorTextSecondary` / `colorTextDisabled` | Text by emphasis level | — |

The distinction matters most where both appear in one frame. `JRDialog` shows it:
the button focus ring is `colorPrimary` (focusable) and the accent rule under the
title is `colorSecondary` (not focusable). If the rule used `colorPrimary` it
would read as something you could move focus to.

Users can re-theme every one of these (Settings → Theme → Custom), so a color
picked for its appearance in the default theme will be wrong in someone else's.
Pick by meaning and it survives any palette.

### Border weights — 3px static, 6px focusable

Same principle for the 9-patch border assets: the weight encodes interaction state. `border-3px.9.png` is for **static panel edges** — the `components/dialogs/` family and `OverviewDialog`'s panel. `border-6px.9.png` is for **focusable things** — `TextButton`'s focus ring, `FocusableOverview`, grid focus indicators. The thick border is part of the "you can focus this" signal; keep the weights distinct so it stays readable.

## Common patterns

- **`isValid(x)`** for nil/invalid checks — never compare to `invalid` directly with `=`.
- **`alwaysNotify="true"`** on interface fields to force observers to fire even when the value didn't change.
- **Set-then-clear single-shot pattern** (`field = node; field = invalid`): use to fire the same value twice in a row. Canonical explanation: [docs/architecture/user-journey.md](../docs/architecture/user-journey.md).
- **Custom subtype inheritance:** XML `extends="JRScreen"`. Inherits all parent interface fields and component children.
- **`callFunc` requires an interface declaration.** To invoke a component method via `node.callFunc("methodName")` (e.g. main-thread → render-thread delegation, as in `main.bs`'s button router), the method MUST be exposed in the component's XML `<interface>` as `<function name="methodName" />`. Without it the call is a **silent no-op** — no compile error, no runtime error, the method simply never runs. The transpiler will not flag a missing declaration; the `callfunc-interface` BSC plugin does (build **error**). Canonical: `ItemDetails.toggleFavorite` / `toggleWatched` and their `<function>` lines in `ItemDetails.xml`.

## `RowList` / grid item components (focus-indicator layout)

Building or changing the `itemComponentName` for a `RowList` / `MarkupGrid` (a poster with a title below it)? The focus indicator pins to the poster slot (`rowItemSize`/`itemSize`) **only when `rowHeights` is set taller than the slot**. Without `rowHeights` it wraps the item's full bounding box (poster **+ title**), so the border extends past the image and swallows the title. Set `rowHeights = rowItemSize height + a title area`, fill the poster at a top offset, put the title below. Canonical: `JRRowItem` + `HomeRows`. This wastes a session every time it's rediscovered — full contract + evidence in [docs/architecture/list-grid-item-layout.md](../docs/architecture/list-grid-item-layout.md).

## What does NOT belong here

- No synchronous network calls from a component — always go through the task pool.
- No direct registry access — use the helpers in `source/utils/config.bs`.
