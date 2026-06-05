---
topic: promises
related-files:
  - source/api/apiPromise.bs
  - source/api/apiPool.bs
  - components/JRScreen.bs
  - components/JRGroup.bs
  - scripts/bsc-plugins/auto-abandon-promises.cjs
  - tests/source/unit/api/apiPromise.spec.bs
last-reviewed: 2026-06-05
---

# Promises How-To & Style Guide

How to do async work in JellyRock with `@rokucommunity/promises`, **when** to reach for a
promise vs. blocking `fetchRes`, and the patterns to avoid. For the *why* and *shape* of the
model (and how it layers over the task pool), see [`async.md`](../architecture/async.md).

> **The one-sentence rule:** on the **render thread**, prefer `fetchAsync(...).then(...)`; in a
> **Task thread**, keep using blocking `fetchRes` / `fetchJson` for linear/branching control flow.
> The full rationale is decision `promise-native-interface-fetchres-exception` in
> [`docs/decisions.md`](../decisions.md).

## The canonical call shape

`fetchAsync(req, requestId)` submits a request to the existing task pool and returns a Promise
node. Chain it with `promises.chain(...)`:

```brightscript
import "pkg:/source/api/apiPromise.bs"

sub loadNextEpisode()
  req = GetApi().BuildGetNextEpisodeRequest(m.itemId)
  promises.chain(fetchAsync(req, "nextEpisode-" + m.itemId)) _
    .then(sub(res as object)
      ' Any HTTP response lands here — including 4xx/5xx. Inspect res.ok.
      if res.ok then m.nextEpisode = res.json
    end sub) _
    .catch(sub(err as object)
      ' Only transport failures / timeouts land here (see "Error contract").
      m.log.warn("next-episode fetch failed", err.reason)
    end sub)
end sub
```

- `req` is the AA from any `GetApi().Build*Request()` method (same input `fetchRes` takes).
- `requestId` is a **unique** string per in-flight request — it's the registry key and the id the
  pool echoes back. Reusing an id across two concurrent requests is a bug (same as the pool's
  existing contract). A `"<purpose>-<itemId>"` shape works well.

Defer per-endpoint `GetApi().*Async()` sugar — the single generic `fetchAsync` over the
`Build*Request()` methods is the whole surface. Add wrappers only if call sites ask for them.

## The error contract (decision #5 — `fetch()` convention)

This mirrors the web `fetch()` convention so `.catch` stays meaningful:

| Outcome | Lands in | Why |
|---|---|---|
| `2xx` response | `.then(res)` | success; `res.ok = true` |
| **`4xx` / `5xx` response** | **`.then(res)`** | an HTTP reply *did* arrive; inspect `res.ok` / `res.statusCode`. Expected `404` responses flow as data. |
| Transport failure (no HTTP reply; `statusCode <= 0`) | `.catch(err)` | the request never completed |
| Timeout (`timeouts.API_WAIT_MS`) | `.catch(err)` | the pool slot never answered |
| Pool unavailable / invalid `req` | `.catch(err)` | nothing was submitted |

So **`.then` is not "success"** — it's "the server answered." Branch on `res.ok` inside `.then`
for HTTP-level errors; reserve `.catch` for "the network/pool failed us." The reject value is an
AA with `ok: false`, `statusCode: 0`, and a `reason` (`"timeout"` / `"pool-unavailable"`).

## Render-thread vs. in-Task consumption

- **Render thread (the common case):** chain `.then/.catch` as above. Delivery is automatic — the
  library observes the promise on the render thread and fires your callbacks on the next tick. You
  do **not** manage a message port.
- **In a Task thread:** if you ever consume a promise inside a Task's run loop, use
  `promises.setMessagePort(port)` + `promises.wait2(timeoutMs, port)` so promise events are pumped
  alongside your other events. In practice you rarely need this — Task code should use blocking
  `fetchRes` (see below), not promises.

## Parallel requests

Use `promises.all([...])` when requests are genuinely independent and you need all results:

```brightscript
promises.chain(promises.all([
  fetchAsync(reqA, "a"),
  fetchAsync(reqB, "b")
])).then(sub(results as object)
  ' results[0], results[1] — both resolved (any HTTP response resolves).
  ' all() rejects on the FIRST transport failure / timeout.
end sub)
```

## When to use a promise vs. blocking `fetchRes` (the Option A rule)

Decision `promise-native-interface-fetchres-exception` keeps **two** async tools on purpose:

- **Promise (`fetchAsync`)** — the default for **render-thread** flows and any non-blocking work.
  The render thread must never block, so a promise is the only correct tool there.
- **Blocking `fetchRes` / `fetchJson`** — stays the tool for **Task-internal** control flow:
  - the **bootstrap path** (login / server discovery, before the pool is up), and
  - **linear or branching task orchestrators**. The worked example is `QuickPlayTask.doSeries`: a
    3-branch resume→next-up→shuffle tree. Flattened onto `.then` chains it reads *worse* — you'd
    thread `context.satisfied` guard flags through every stage. Task threads can block safely, so
    blocking is the Roku-idiomatic, more-readable choice there. **Don't** rewrite hot, working
    orchestrators (`QuickPlayTask` ~32 fetches, `LoadItemsTask` ~22, `items.bs`) into `wait2`
    promise-loops — that's pure regression risk for negative readability.

> Long-term: once BrighterScript ships **async/await**, `await fetchAsync(...)` restores linear
> readability *with* the promise model and this two-tool split gets revisited. Until then, the
> split is deliberate.

## Collapsing a pure-fetch Task (decision #4)

The biggest DX win is deleting Task components that exist only to move one `fetchRes` off the
render thread. Collapse criteria:

- **Collapse → render-thread promise:** a Task that does *pure I/O* (one or a few `fetchRes`, no
  heavy transform) consumed via `createObject` + `observeField`. Replace with a
  `fetchAsync(...).then(...)` at the call site and **delete** the `.xml` + `.bs` pair.
- **Keep as a Task:** a Task doing **array processing / heavy data transforms**. That work must
  stay off the render thread — collapsing it would move the transform *onto* the render thread,
  which the render-thread-protection rule forbids. The promise only moves the *I/O wait*, not the
  CPU work.

## Cancellation — you get it for free

A pending promise must never fire a callback into a destroyed node. You don't wire this by hand:
the `auto-abandon-promises` BSC plugin injects `abandonApiPromises()` into your component's
`onDestroy()` at build time (and **errors** if a `fetchAsync`-calling component has no
`onDestroy`). Base `JRScreen.bs` / `JRGroup.bs` carry it as a floor. Just write your normal
`onDestroy()`; abandon is added for you. See [`async.md`](../architecture/async.md#cancellation--auto-abandon)
for the mechanism.

## Patterns to avoid

- **Treating `.then` as "success."** A 404/500 resolves. Branch on `res.ok` inside `.then`.
- **Swallowing rejections in `.finally`.** As of `@rokucommunity/promises` **0.6.0**, `.finally()`
  no longer suppresses a rejection — a rejection still propagates past `.finally`. Put real error
  handling in `.catch`, not `.finally`.
- **Forcing `wait2` into linear Task code.** If it's a Task orchestrator, use `fetchRes`.
- **Reusing a `requestId`** across concurrent in-flight requests.
- **Manually calling `abandonApiPromises()` and also relying on the plugin** — it's idempotent, but
  the plugin already injects it; don't hand-write the call.

## How to test promise-based code

Drive the adapter's resolve/reject decision and the abandon model directly — see
[`tests/source/unit/api/apiPromise.spec.bs`](../../tests/source/unit/api/apiPromise.spec.bs) for the
pattern. Key points:

- `apiPromiseShouldResolve(res)` is the pure resolve-vs-reject decision — assert it for the `2xx` /
  `4xx` / `5xx` / transport / timeout cases with no pool or async pump needed.
- For settle/abandon, populate a registry AA and call `settleApiPromiseIn(pending, requestId)` /
  `abandonApiPromisesIn(pending)` (the registry is an explicit parameter precisely so it's testable
  — bare calls from a Rooibos class method don't share the instance `m`). Assert the promise's
  `promiseState` / `promiseResult` synchronously.
- Run on hardware: `npm run test:tdd` (single spec) → `npm run test:unit` before commit.
