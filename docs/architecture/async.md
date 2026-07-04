---
topic: async
related-files:
  - source/api/apiPromise.bs
  - source/api/apiPool.bs
  - components/JRScreen.bs
  - scripts/bsc-plugins/auto-abandon-promises.cjs
  - scripts/lint/promise-ratchet.cjs
last-reviewed: 2026-07-04
---

# Async & Promises

The shape of asynchronous work in JellyRock: a `Promise` as the universal async **interface**,
layered over the *existing* task-pool engine. For how-to and style (call shape, when to use,
patterns to avoid), see [`../dev/promises.md`](../dev/promises.md). For the pool itself, see
[`api.md`](./api.md).

## Why this exists

Before promises, render-thread async meant **observer spaghetti**: `submitApiRequest` returns an
`ApiResultNode`, you `observeField("isDone", "someGlobalHandler")`, the handler reads `result`,
and you unobserve on teardown — repeated across a 1,300-line `main.bs` god-loop and a fleet of
bespoke one-fetch Task components. A `Promise` replaces that calling convention with one async
vocabulary: `fetchAsync(req, id).then(...).catch(...)`.

The key architectural decision ([ADR 0012](../adr/0012-promise-native-interface-fetchres-exception.md))
is that the promise is **only the interface**. The pool
engine — the `ApiQueueTask` coordinator, the children-as-vehicles coalescing dodge, the
ready-cascade, the three-slot `ApiTask` pool — is the cleverest, most regression-sensitive code in
the app and is **orthogonal** to promises. It is *not* rewritten. Promises sit on top.

## The adapter — `apiPromise.bs`

[`source/api/apiPromise.bs`](../../source/api/apiPromise.bs) is the bridge. `fetchAsync` wraps
`submitApiRequest` (which already returns an `ApiResultNode` firing `isDone` on the render thread —
the natural bridge point) and solves the five things the promises library does **not** solve for
us:

1. **No-closure observer→promise bridge.** Render-thread `observeField` calls a *global-named*
   handler with no closure, so you can't capture the promise in the callback. Instead each pending
   request is held in a registry on the owning component's `m` (`m.__apiPromisePending`, keyed by
   `requestId`), and a shared global handler (`__onApiPromiseDone`) looks the entry up and resolves
   it. The handler runs in the component's `m` because that's where `observeField` was called.
2. **Timeout.** `submitApiRequest` has *no* deadline (unlike `fetchRes`'s `API_WAIT_MS`). A Timer
   per request rejects after `timeouts.API_WAIT_MS` so a never-answered slot can't hang forever.
3. **Reject-vs-resolve.** The `fetch()`-convention error contract (decision #5) — any HTTP response
   resolves; transport failure / timeout rejects. Isolated as the pure `apiPromiseShouldResolve(res)`
   (`statusCode > 0` → resolve).
4. **Cleanup.** On settle: unobserve `isDone`, stop + unobserve the timer, drop the registry entry,
   release the nodes. No per-request leak. Idempotent (entry removed first), so a timeout firing
   just after `isDone` is a no-op.
5. **Cancellation.** Each pending entry is owned by the component's `m`, so teardown can abandon
   them — see below.

The registry-mutating logic is split into `settleApiPromiseIn(pending, id)` /
`abandonApiPromisesIn(pending)` cores that take the registry explicitly, with thin `m`-bound
wrappers (`settleApiPromise` / `abandonApiPromises`) for the production handlers. The split exists
because bare global calls from a Rooibos **class method** don't share the instance `m`, so the
explicit-registry cores are what the unit tests drive.

## Cancellation — auto-abandon

A pending promise must never fire a callback into a destroyed node. `abandonApiPromises()` removes
the observer on every pending request, stops its timer, and clears the registry — after which a late
pool response settles nothing.

**The non-obvious part:** SceneGraph component `onDestroy` does **not** chain to a base class.
`SceneManager` tears down via `group.callFunc("onDestroy")`, which dispatches to the *most-derived*
`onDestroy`, and no subclass calls `super.onDestroy()`. So abandon can't simply live in a base
`onDestroy` — for every screen that overrides it (essentially all of them) that base call never
runs.

The mechanism (decision `auto-abandon-promises-bsc-plugin`) is therefore a **BSC plugin**,
[`scripts/bsc-plugins/auto-abandon-promises.cjs`](../../scripts/bsc-plugins/auto-abandon-promises.cjs),
modeled on `roku-log.cjs`'s transpile-time injection:

- **Injects** `abandonApiPromises()` as the first statement of `onDestroy()` in any codebehind that
  calls `fetchAsync` (idempotent). Developers write nothing.
- **Errors** at build time (`auto-abandon-promises-needs-on-destroy`, severity 1, `bsc-disable-file`
  escape hatch) when a *component* codebehind calls `fetchAsync` but has no `onDestroy` to inject
  into — a guaranteed leak, made impossible to ship.
- Wired into `bsconfig` / `bsconfig-prod` / `bsconfig-analysis` (the app configs, same as
  `roku-log`; the test configs deliberately exclude transforming plugins).

~~Base `JRScreen.bs` and the minimal `JRGroup.bs` carry `abandonApiPromises()` in their `onDestroy`
as a readable floor for the rare components that don't override `onDestroy`~~ — removed (ADR 0021).
An audit found zero components relying on it: every real `fetchAsync` caller already defines its
own `onDestroy` (plugin-injected or hand-written), and nothing reaches `fetchAsync` only through a
shared helper. The floor's only effect in practice was pulling `promises.brs` into the inherited
script scope of every `JRGroup`/`JRScreen` descendant — i.e. nearly every screen and panel —
whether or not it used a promise. The plugin's own direct-call detection + build-time enforcement
(above) is unaffected and remains the sole abandon-on-destroy guarantee.

## The two-model split (and when it ends)

JellyRock deliberately runs **two** async models at once:

- **Promises** on the render thread (and wherever non-blocking is required).
- **Blocking `fetchRes` / `fetchJson`** inside Task threads for the bootstrap path and
  linear/branching orchestrators (Task threads can block safely; flattening branching orchestrators
  onto `.then` chains reads worse).

This is **Option A** (not "promises everywhere"). The split is a tracked, deliberate trade-off —
re-open it when BrighterScript **async/await** ships, at which point `await fetchAsync(...)` makes
the single-model convergence the right call. Both the interface decision ([ADR 0012](../adr/0012-promise-native-interface-fetchres-exception.md))
and the abandon-mechanism decision ([ADR 0013](../adr/0013-auto-abandon-promises-bsc-plugin.md)) live in [`../adr/`](../adr/README.md).

### Where `fetchAsync` can be called from — render thread only

`fetchAsync` bridges the pool with a **named-function** `observeField("isDone", "...")`, which Roku
only dispatches inside a SceneGraph component (the render thread). So:

- **Render-thread component code** (init, observer handlers, `callFunc` methods) — call `fetchAsync`
  directly. The common case.
- **`main.bs`'s `Main()` loop runs on the main BrightScript thread** (`wait(0, m.port)`), where named
  observers never fire — which is why every observation there is port-based. It **cannot** consume
  `fetchAsync` directly. A main-thread caller **delegates to a render-thread component method via
  `callFunc`** (which rendezvouses to the render thread); the canonical example is `main.bs`'s button
  router calling `group.callFunc("toggleFavorite")` → `ItemDetails.toggleFavorite` (issue #551,
  Phase `3c`). This is preferred over wiring `promises.setMessagePort`/`wait2` into the main loop —
  delegation needs no foundation change and keeps the one async vocabulary.
- **Task threads** — don't use promises; use blocking `fetchRes` (above). If you ever must, that's
  the `setMessagePort` + `wait2` path.

## Risk & coexistence

The pool engine is untouched, so the blast radius of promise adoption is the *interface* layer
only. Observer-based and promise-based call sites **coexist** during migration — expected and fine.
Worst case for any migration batch: revert it; the pool keeps working.

### Anti-backslide ratchet

While the two paradigms coexist, the danger is *net-new* spaghetti. [`scripts/lint/promise-ratchet.cjs`](../../scripts/lint/promise-ratchet.cjs)
counts the banned signature — a raw `.observeField("isDone", …)` on a `submitApiRequest` result, in
app code, excluding the pool engine + adapter — and fails (in `npm run lint`, so CI-blocking; advisory
at pre-push) when the count rises above the committed integer in
[`.promise-ratchet-baseline`](../../.promise-ratchet-baseline). The count only moves **down**: each
migration batch lowers the baseline. When it reaches `0` the ratchet is automatically a hard
grep-zero guard. The baseline never names which files are "done" — it's a pure count.
