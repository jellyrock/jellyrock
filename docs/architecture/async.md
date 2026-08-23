---
topic: async
related-files:
  - source/api/apiPromise.bs
  - source/api/apiPool.bs
  - components/JRScreen.bs
  - components/JRGroup.bs
  - scripts/bsc-plugins/auto-abandon-promises.cjs
  - scripts/lint/promise-ratchet.cjs
last-reviewed: 2026-08-07
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
explicit-registry cores are what the unit tests drive. [`apiPipeline.bs`](../../source/api/apiPipeline.bs)
is split the same way and for the same reason — its slot accounting, take and drain are pure over an
explicitly-passed state AA, with only submit / wait / unobserve in the shell.

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
- **Task threads** — don't use promises. Blocking `fetchRes` (above) is the default; when a Task has
  N *independent* requests, [`apiPipeline`](../../source/api/apiPipeline.bs) keeps several in flight
  on that one thread without spawning a Task per request (call pattern 5 — see
  [api.md](./api.md)). Both are blocking-shaped from the caller's point of view, which is why
  neither needs promises. If you genuinely must consume a promise on a Task thread, that's the
  `setMessagePort` + `wait2` path.

## Crossing the thread boundary costs a rendezvous — budget CROSSINGS, not bytes

Every time one thread touches a node another thread owns — a Task writing a field on a
render-thread node, appending a child to it, or `callFunc`-ing into a component — SceneGraph
performs a **rendezvous**: the caller parks until the owning thread reaches a safe point, then the
data is marshaled across. It is priced by **how often you cross** first and how much you carry
second, and both are far more expensive than the same operation done thread-locally.

**Which side of the boundary you are on is decided by who OWNS the node.** Nodes are render-owned
by default — `m.global` and every Task node included — so render-thread code pays nothing, and the
identical read from a Task thread costs ~46× more. The measured per-operation table (and the
corollary that removing a rendezvous still leaves ~20 µs/entry of interpreter cost) lives in
[threading.md](threading.md#measured-findings).

That is the reason behind rules stated elsewhere without their price tag: cache `m.global.user`
in a local instead of re-reading it per item ([components/CLAUDE.md](../../components/CLAUDE.md)),
prefer `node.setFields({...})` to a run of individual assignments, and use
`transformBaseItemArray` over a per-item `transformBaseItem` (which re-reads
`m.global.server.version` — one rendezvous per item).

**Worked example, measured on a Streaming Stick 4K.** The item grid's Genres view delivers N rows
of ~7 item nodes. Delivered as ONE `m.top.content` write it costs ~220 ms of task-thread `emit`.
Re-shaped to deliver each row as it arrived — same total data, same nodes, just **8 crossings
instead of 1** — `emit` went to ~734 ms, and `task` from 520 ms to 1403 ms. Reverting to a single
batched handoff put `emit` back to ~235 ms. The payload never changed; only the crossing count did.

Practical consequences when designing a Task → UI handoff:

- **Batch the delivery.** Per-item or per-row handoffs are the expensive shape. Accumulate and hand
  over once, unless progressive display is worth a measured price.
- **Send the cheapest thing that works.** Strings and small AAs marshal far more cheaply than node
  trees. The grid ships `[{ id, title }]` and lets the render thread build its own skeleton
  `ContentNode`s — shipping the built nodes instead cost ~136 ms for that single crossing.
  `HomeRows.createSkeletonRows()` is the same split.
- **Expect a busy render thread to slow the Task down**, not just the other way round. In the same
  experiment the pipeline's *network* wait grew ~200 ms purely because the render thread was laying
  out rows during the run instead of after it.
- Where a handoff must be frequent, `apiQueue`'s children-as-vehicle pattern is the shape to copy —
  it exists for correctness under coalescing (see [api.md](./api.md)), and it does **not** make the
  crossings free.

## Risk & coexistence

The pool engine is untouched, so the blast radius of promise adoption is the *interface* layer
only. Observer-based and promise-based call sites **coexist** during migration — expected and fine.
Worst case for any migration batch: revert it; the pool keeps working.

### Anti-backslide ratchet

While the two paradigms coexist, the danger is *net-new* spaghetti. [`scripts/lint/promise-ratchet.cjs`](../../scripts/lint/promise-ratchet.cjs)
counts the banned signature — a raw `.observeField("isDone", …)` on a `submitApiRequest` result, in
app code, excluding the pool engine + adapter — and fails (blocking in the `lint-brightscript` CI
workflow; advisory at pre-push) when the count rises above the committed integer in
[`.promise-ratchet-baseline`](../../.promise-ratchet-baseline). The count only moves **down**: each
migration batch lowers the baseline. When it reaches `0` the ratchet is automatically a hard
grep-zero guard. The baseline never names which files are "done" — it's a pure count.

> **Historical note.** This paragraph used to read "fails in `npm run lint`, so CI-blocking." That
> inference was wrong — CI never runs the `npm run lint` aggregate — so the ratchet blocked nothing
> from the day it landed until it was wired into `lint-brightscript`. `npm run lint:ci-parity` now
> fails the build if any aggregate member loses its CI home again.
