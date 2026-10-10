---
topic: async
related-files:
  - source/api/apiPromise.bs
  - source/api/apiPool.bs
  - components/JRScreen.bs
  - components/JRGroup.bs
  - scripts/bsc-plugins/auto-abandon-promises.cjs
  - scripts/lint/promise-ratchet.cjs
last-reviewed: 2026-10-10
---

# Async and promises

How asynchronous work is shaped in JellyRock: a `Promise` as the one async interface, laid over the task-pool engine that already existed. For how to write it (call shape, when to use it, what to avoid), see [`promises.md`](../dev/promises.md). The pool itself is in [`api.md`](./api.md).

## Why this exists

Before promises, async work on the render thread meant a tangle of observers: `submitApiRequest` returned an `ApiResultNode`, you called `observeField("isDone", "someGlobalHandler")`, the handler read `result`, and you unobserved on teardown. That pattern repeated across the `main.bs` event loop, then over 1,300 lines, and a fleet of one-fetch Task components. A `Promise` replaces it with one async vocabulary: `fetchAsync(req, id).then(...).catch(...)`.

The key decision ([ADR 0012](../adr/0012-promise-native-interface-fetchres-exception.md)) is that the promise is only the interface. The pool engine (the `ApiQueueTask` coordinator, the result nodes delivered as children to dodge coalescing, the startup ready cascade and the `ApiTask` pool) is the most delicate code in the app, and it has nothing to do with promises. It was not rewritten; promises sit on top of it.

## The adapter: `apiPromise.bs`

[`source/api/apiPromise.bs`](../../source/api/apiPromise.bs) is the bridge. `fetchAsync()` wraps `submitApiRequest()`, whose `ApiResultNode` already fires `isDone` on the render thread, and solves five things the promises library does not:

1. **An observer with no closure.** A render-thread `observeField` calls a handler by name, with no closure, so the callback cannot capture the promise. Instead each pending request is kept in a registry on the calling component's `m` (`m.__apiPromisePending`, keyed by request id), and one shared handler (`__onApiPromiseDone`) looks the entry up and settles it. The handler runs with the component's `m` because that is where `observeField` was called.
2. **A timeout.** `submitApiRequest()` has no deadline, unlike `fetchRes()`. A Timer per request rejects after the wait `fetchRes()` uses, `apiTimeout.waitMs(req)`: `timeouts.API_WAIT_MS`, unless the request carries its own `timeoutMs`. So a slot that never answers cannot hang a promise forever.
3. **Resolve or reject.** Like `fetch()`, any HTTP response resolves, and a transport failure or a timeout rejects. That rule is the pure `apiPromiseShouldResolve(res)`: a `statusCode` above 0 resolves.
4. **Cleanup.** Settling unobserves `isDone`, stops and unobserves the timer, drops the registry entry and releases the nodes, so nothing leaks per request. The entry is removed first, so a timeout that fires just after `isDone` does nothing.
5. **Cancellation.** The component's `m` owns each pending entry, so teardown can abandon them (next section).

The code that changes the registry takes it as an argument: `settleApiPromiseIn(pending, id)`, `timeoutApiPromiseIn(pending, id)` and `abandonApiPromisesIn(pending)`. The handlers pass their component's `m.__apiPromisePending`, and `abandonApiPromises()` is the one wrapper bound to `m`. The split exists because a bare global call from a Rooibos class method does not share the instance's `m`, so the unit tests drive the versions that take the registry. [`apiPipeline.bs`](../../source/api/apiPipeline.bs) is split the same way for the same reason: its slot accounting, take and drain are pure functions over a state AA passed in, with only submit, wait and unobserve in the shell.

## Cancellation: auto-abandon

A pending promise must never run a callback in a destroyed node. `abandonApiPromises()` removes the observer on every pending request, stops its timer and clears the registry, so a late pool response settles nothing. It also marks each request abandoned, so one still waiting in the pool's queue is skipped instead of sent ([api.md](api.md#a-request-nobody-is-waiting-for)); a promise that times out does the same.

**The part that is easy to miss:** a SceneGraph component's `onDestroy` does not chain to its base. The router closes a routed view through `JRScreen.beforeViewClose()`, which calls `onDestroy()`; that runs the most-derived `onDestroy`, and no screen calls its parent's. So abandoning cannot live in a base `onDestroy`: for every screen that overrides it, nearly all of them, the base never runs.

So the mechanism (decision `auto-abandon-promises-bsc-plugin`, [ADR 0013](../adr/0013-auto-abandon-promises-bsc-plugin.md)) is a BSC plugin, [`scripts/bsc-plugins/auto-abandon-promises.cjs`](../../scripts/bsc-plugins/auto-abandon-promises.cjs), built like `roku-log.cjs`'s compile-time insertion:

- **It inserts** `abandonApiPromises()` as the first statement of `onDestroy()` in any codebehind that calls `fetchAsync`, once. Developers write nothing.
- **It fails the build** (`auto-abandon-promises-needs-on-destroy`, an error, with `bsc-disable-file` as the way out) when a component codebehind calls `fetchAsync` but has no `onDestroy` to insert into: that is a certain leak, so it cannot ship.
- **It runs in the app configs**, `bsconfig.json` and `bsconfig-prod.json` (which `bsconfig-analysis.json` extends), as `roku-log` does. The test configs leave out plugins that rewrite code, on purpose.

[`JRScreen.bs`](../../components/JRScreen.bs) and the minimal [`JRGroup.bs`](../../components/JRGroup.bs) also call `abandonApiPromises()` in their own `onDestroy`, as a floor for the few components that do not override it and so inherit the base.

## Two models, on purpose (and when that ends)

JellyRock runs two async models at once:

- **Promises** on the render thread, and wherever a call must not block.
- **Blocking `fetchRes()` and `fetchJson()`** on Task threads, for the startup path and for orchestrators whose steps branch. A Task thread can block safely, and branching steps read worse as a flat `.then` chain.

This is Option A in [ADR 0012](../adr/0012-promise-native-interface-fetchres-exception.md), not "promises everywhere". Reopen it when BrighterScript ships async and await: `await fetchAsync(...)` would make one model the right answer. The abandon mechanism's decision is [ADR 0013](../adr/0013-auto-abandon-promises-bsc-plugin.md).

### Where `fetchAsync` can be called: the render thread only

`fetchAsync` connects to the pool with an `observeField("isDone", "...")` that names a function, and Roku delivers those only inside a SceneGraph component, on the render thread. So:

- **Render-thread component code** (`init()`, observer handlers, `callFunc` methods) calls `fetchAsync` directly. This is the common case.
- **`Main()` in `main.bs` runs on the main thread** (`wait(0, m.port)`), where observers by name never fire, which is why every observer there uses the port. It cannot use `fetchAsync` directly. A main-thread caller hands the work to a render-thread component method through `callFunc`, which crosses to the render thread. The reference is `loginRouter` calling `m.scene.callFunc("routerNavigate", …)`: `JRScene.routerNavigate()`'s `navigateThenFocus()` consumes the promise from `sgrouter.navigateTo` on the render thread. That is preferred over adding `promises.setMessagePort` and `wait2` to the main loop: it changes nothing underneath and keeps one async vocabulary.
- **Task threads** do not use promises. Blocking `fetchRes()` is the default. When a Task has several independent requests, [`apiPipeline`](../../source/api/apiPipeline.bs) keeps several in flight on that one thread without a Task per request (pattern 5 in [api.md](./api.md)). Both look blocking to the caller, which is why neither needs promises. A Task that truly must consume a promise uses `setMessagePort` and `wait2`.

<a id="crossing-the-thread-boundary-costs-a-rendezvous--budget-crossings-not-bytes"></a>

## Crossing a thread boundary costs a rendezvous: count the crossings, not the bytes

Every time one thread touches a node another thread owns (a Task writing a field on a render-thread node, adding a child to one, or calling `callFunc` on a component), SceneGraph performs a rendezvous. The caller waits until the owning thread reaches a safe point, then the data is copied across. The price depends first on how often you cross and only second on how much you carry, and both cost far more than the same operation on one thread.

**Who owns the node decides which side you are on.** Nodes belong to the render thread by default, `m.global` and every Task node included, so render-thread code pays nothing, and the same read from a Task thread costs about 46 times as much. The measured table, and the finding that removing a rendezvous still leaves about 20 µs per entry of interpreter work, are in [threading.md](threading.md#measured-findings).

That is the reason behind several rules stated elsewhere without their price: cache `m.global.user` in a local instead of reading it per item ([components/CLAUDE.md](../../components/CLAUDE.md)), prefer `node.setFields({...})` to a run of single assignments, and use `transformBaseItemArray()` over a `transformBaseItem()` per item, which reads `m.global.server.version` each time, one rendezvous per item. `translate()` belongs on the list: it reads `m.global.translations`, which from a Task copies the whole translation table across on every call. Resolve a label once per batch, not once per item.

**A worked example, measured 2026-08-08 on a Streaming Stick 4K.** The item grid's Genres view delivers several rows of about 7 item nodes each. Delivered as one `m.top.content` write, the Task thread's `emit` took about 220 ms. Delivered a row at a time as each arrived (the same data and nodes, but 8 crossings instead of 1), `emit` rose to about 734 ms, and the whole Task from 520 ms to 1403 ms. Going back to one write brought `emit` back to about 235 ms. The data never changed; only the number of crossings did.

What that means when you design a hand-off from a Task to the UI:

- **Deliver in one batch.** Delivering per item or per row is the expensive shape. Collect, then hand over once, unless showing results as they arrive is worth a measured price.
- **Send the cheapest thing that works.** Strings and small AAs copy far more cheaply than node trees. The grid sends `[{ id, title }]` and lets the render thread build its own placeholder `ContentNode`s; sending the built nodes instead cost about 136 ms for that one crossing. `HomeRows.createSkeletonRows()` splits the work the same way.
- **Expect a busy render thread to slow the Task down too.** In the same experiment the pipeline's network wait grew about 200 ms only because the render thread was laying out rows during the run instead of after it. Under constant interaction it is far worse. While the TV guide scrolled at one row per 400 ms, every Task crossing waited on the moving grid, so a program transform that crossed twice per item went from 1.4 s to 51.8 s (measured 2026-09-21 on a Stick 4K; the row is in [threading.md](threading.md#measured-findings)). A crossing per item that costs nothing on an idle screen becomes the whole cost once the user is moving.
- **Where a hand-off must be frequent,** copy the API queue's pattern of delivering each result as a child node. It exists to stay correct when SceneGraph merges field changes (see [api.md](./api.md)); it does not make the crossings free.

## Risk and coexistence

The pool engine is untouched, so adopting promises can only break the interface layer. Observer-based and promise-based call sites live side by side during migration, which is expected. At worst, a migration batch is reverted and the pool keeps working.

### The ratchet against new observer code

While both styles coexist, the risk is new observer code. [`scripts/lint/promise-ratchet.cjs`](../../scripts/lint/promise-ratchet.cjs) counts the banned shape, a raw `.observeField("isDone", …)` on a `submitApiRequest()` result in app code, leaving out the pool engine and the adapter. It fails when the count rises above the number committed in [`.promise-ratchet-baseline`](../../.promise-ratchet-baseline): CI's `_lint-brightscript.yml` blocks on it, and the pre-push hook only warns. The count only goes down, since each migration batch lowers the baseline, and at `0` the ratchet becomes a plain ban. The baseline names no files; it is just a count.

> **History.** This section used to say the ratchet "fails in `npm run lint`, so CI-blocking". That was wrong: CI never runs the `npm run lint` aggregate, so the ratchet blocked nothing until it was added to `lint-brightscript`. `npm run lint:ci-parity` now fails the build if any member of the aggregate loses its CI home again.
