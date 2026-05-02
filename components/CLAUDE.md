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

- Override `OnScreenShown()` — restore focus, refresh data on revisit.
- Override `OnScreenHidden()` — pause Tasks, hide UI, but keep state.
- Override `destroy()` — release Task nodes, unobserve fields, drop large data structures. The base `destroy()` is a no-op; missing it leaks observers and tasks across navigation. Two BSC plugins enforce this; opt-out comments are documented in [build-and-tooling.md](../docs/architecture/build-and-tooling.md).

## Render thread protection

- Roku's render thread runs the UI. Anything I/O — network, registry I/O, large file reads — **MUST run on a Task thread**.
- For HTTP, use the API task pool via `GetApi().Build*Request()` + `fetchRes()` / `submitApiRequest()`. See [docs/architecture/api.md](../docs/architecture/api.md).
- Single `m.global.<child>` reads are fine (cheap). Multiple reads in a hot path: cache locally first (`globalUser = m.global.user; globalUser.foo; globalUser.bar`).
- Bulk field updates: `node.setFields({ a: 1, b: 2 })` over individual assignments.

## Input handling — `onKeyEvent`

- Signature: `function onKeyEvent(key as string, press as boolean) as boolean`.
- `return true` consumes the event; no further bubbling.
- `return false` (or no return) bubbles to the parent.
- Convention: child components return `false` for `press = false` so UP-key events reliably bubble up to `JRScene` (used by the up-up-down-down debug cheat code).

## Common patterns

- **`isValid(x)`** for nil/invalid checks — never compare to `invalid` directly with `=`.
- **`alwaysNotify="true"`** on interface fields to force observers to fire even when the value didn't change.
- **Set-then-clear single-shot pattern** (`field = node; field = invalid`): use to fire the same value twice in a row. Canonical explanation: [docs/architecture/user-journey.md](../docs/architecture/user-journey.md).
- **Custom subtype inheritance:** XML `extends="JRScreen"`. Inherits all parent interface fields and component children.

## What does NOT belong here

- No synchronous network calls from a component — always go through the task pool.
- No direct registry access — use the helpers in `source/utils/config.bs`.
