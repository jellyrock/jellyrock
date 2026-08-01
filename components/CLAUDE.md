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

- Roku's render thread runs the UI. Anything I/O — network, registry I/O, large file reads — **MUST run on a Task thread**.
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

- **Always go through `source/utils/dialogs.bs`** — `showAlertDialog`, `showConfirmDialog`, `showChoiceDialog`, `showListDialog`, `showInfoDialog`, `showKeyboardDialog`. `import "pkg:/source/utils/dialogs.bs"` and call one. Canonical call sites: `ItemDetails.onWatchedButtonPressed` / `onDeleteButtonPressed`.
- The result arrives on the **dialog node's own `result` field**, shape `{ cancelled, confirmed, buttonIndex, buttonText, optionIndex, value }`. Pass `onResult` (a function name in *your* scope) and the helper wires the scoped observer; keep the returned node so the callback can read `.result`.
- **Do NOT add new `m.global.sceneManager` dialog calls** (`userMessage` / `standardDialog` / `showConfirmationDialog` + the shared `returnData` / `isDataReturned` fields). That path is being retired — remaining consumers are tracked by [`dialog-returndata-shared-global`](../docs/architecture/tech-debt.md#dialog-returndata-shared-global).
- Overlay dialogs are appended to the **scene**, not to your screen, so they survive your `onDestroy`. A screen that opens one owns tearing it down.
- Full contract: [navigation.md → The standard dialog system](../docs/architecture/navigation.md).

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
