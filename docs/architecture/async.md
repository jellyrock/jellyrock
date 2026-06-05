---
topic: async
related-files:
  - source/api/apiPromise.bs
  - source/api/apiPool.bs
  - components/JRScreen.bs
  - components/JRGroup.bs
  - scripts/bsc-plugins/auto-abandon-promises.cjs
last-reviewed: 2026-06-05
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

The key architectural decision (`promise-native-interface-fetchres-exception` in
[`../decisions.md`](../decisions.md)) is that the promise is **only the interface**. The pool
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

Base [`JRScreen.bs`](../../components/JRScreen.bs) and the minimal
[`JRGroup.bs`](../../components/JRGroup.bs) carry `abandonApiPromises()` in their `onDestroy` as a
readable floor for the rare components that *don't* override `onDestroy` (which inherit the base).

## The two-model split (and when it ends)

JellyRock deliberately runs **two** async models at once:

- **Promises** on the render thread (and wherever non-blocking is required).
- **Blocking `fetchRes` / `fetchJson`** inside Task threads for the bootstrap path and
  linear/branching orchestrators (Task threads can block safely; flattening branching orchestrators
  onto `.then` chains reads worse).

This is **Option A** (not "promises everywhere"). The split is a tracked, deliberate trade-off —
re-open it when BrighterScript **async/await** ships, at which point `await fetchAsync(...)` makes
the single-model convergence the right call. Both the interface decision and the abandon-mechanism
decision live in [`../decisions.md`](../decisions.md).

## Risk & coexistence

The pool engine is untouched, so the blast radius of promise adoption is the *interface* layer
only. Observer-based and promise-based call sites **coexist** during migration — expected and fine.
Worst case for any migration batch: revert it; the pool keeps working.
