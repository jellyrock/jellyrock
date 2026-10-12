---
topic: promises
related-files:
  - source/api/apiPromise.bs
  - source/api/apiPool.bs
  - components/JRScreen.bs
  - components/JRGroup.bs
  - scripts/bsc-plugins/auto-abandon-promises.cjs
  - tests/source/unit/api/apiPromise.spec.bs
last-reviewed: 2026-10-09
---

# Promises

How to make an API request from the render thread with `@rokucommunity/promises`, when to block on `fetchRes` instead, and the mistakes to avoid. For why the async model is shaped this way and how it sits on the task pool, see [`async.md`](../architecture/async.md).

**The rule:** on the render thread, use `fetchAsync(...)` and chain `.then(...)`. In a Task thread, use blocking `fetchRes` or `fetchJson`. [ADR 0012](../adr/0012-promise-native-interface-fetchres-exception.md) records why.

## Make a request

`fetchAsync(req, requestId)` sends a request to the task pool and returns a promise. Chain it with `promises.chain(...)`. This is `VideoPlayerView.fetchNextEpisode()`, shortened:

```brighterscript
import "pkg:/source/api/apiPromise.bs"

sub fetchNextEpisode()
  req = GetApi().BuildGetEpisodesRequest(m.top.showID, { StartItemId: m.top.id, Limit: 2 })
  promises.chain(fetchAsync(req, "nextEpisode-" + m.top.id)).then(sub(res as object)
    ' Every HTTP response lands here, 4xx and 5xx included.
    if not res.ok then return
    ' ...use res.json
  end sub).catch(sub(err as object)
    ' Only a request that never completed lands here (see "What lands where").
    m.log.warn("next-episode fetch failed", err.reason, err.statusCode)
  end sub)
end sub
```

- `req` is the request AA from any `GetApi().Build*Request()` method, the same input `fetchRes` takes.
- `requestId` must be unique among requests in flight: it is the key the adapter files the request under. Two requests in flight with one id is a bug. `"<purpose>-<itemId>"` works well.
- Keep each `.then(` and `.catch(` on the same line as the `end sub)` before it. A line that starts with `.catch(` is a syntax error, and `_` does not continue a line in BrighterScript.

`fetchAsync` is the whole surface. There are no per-endpoint `*Async()` wrappers; add one only when call sites need it.

### Pass state with a context

BrightScript has no closures. A callback runs with the calling component's `m`, so `m.top` works inside it. Anything else it needs goes in a context AA, passed as the second argument to `promises.chain` and handed to every callback. This is `ItemDetails.toggleFavorite()`, shortened:

```brighterscript
promises.chain(fetchAsync(req, "favoriteToggle-" + item.id), { button: favoriteButton, newState: newState }).then(sub(res as object, ctx as object)
  if res.ok
    ctx.button.isButtonSelected = ctx.newState
  else
    onFavoriteToggleFailed(ctx.button, ctx.newState)
  end if
end sub).catch(sub(err as object, ctx as object)
  onFavoriteToggleFailed(ctx.button, ctx.newState)
end sub)
```

The context is also how a callback drops a stale answer. `ItemDetails.checkTrailerAvailability()` passes the item id it asked about and returns early when `ctx.itemId` no longer matches `m.top.itemId`.

## What lands where

The adapter follows the web `fetch()` convention, so `.catch` fires only when the request never completed:

| Outcome | Lands in | What you get |
| --- | --- | --- |
| `2xx` response | `.then(res)` | `res.ok` is `true` |
| `4xx` or `5xx` response | `.then(res)` | `res.ok` is `false`; read `res.statusCode`. An expected `404` arrives as data. |
| No HTTP reply (`statusCode` 0 or below, or missing) | `.catch(err)` | The pool's response AA |
| No answer within `apiTimeout.waitMs(req)` | `.catch(err)` | `{ requestId, ok: false, statusCode: 0, reason: "timeout" }` |
| Pool not ready, or `req` invalid | `.catch(err)` | `{ requestId, ok: false, statusCode: 0, reason: "pool-unavailable" }` |

So `.then` means "the server answered", not "it worked". Branch on `res.ok` inside `.then`.

A rejection carries a `reason` only when the adapter built it (timeout, pool unavailable). When the pool's own response is rejected, `reason` is missing and `statusCode` tells you what happened. Every rejection has `ok` and `statusCode`.

The timeout is the same wait `fetchRes` uses: `timeouts.API_WAIT_MS`, longer for a request that sets its own `timeoutMs`. A request that times out is also marked abandoned, so the pool skips it if it is still queued.

## Which thread you are on

- **Render thread.** Chain `.then` and `.catch` as above. The library delivers the result to your callbacks; you manage no message port.
- **Main thread (`Main()` in `main.bs`).** You cannot call `fetchAsync` here. The adapter waits with a named-function `observeField`, and Roku only calls those inside a SceneGraph component. `Main()` waits on its own port, so every observer there is port-based. Hand the work to a render-thread component method with `callFunc`, and call `fetchAsync` inside that method. `loginRouter` does this with `m.scene.callFunc("routerNavigate", …)`. Don't add `promises.setMessagePort` and `promises.wait2` to the main loop instead.
- **Task thread.** Use blocking `fetchRes` (see below). If a Task must consume a promise, pump it with `promises.setMessagePort(port)` and `promises.wait2(timeoutMs, port)` alongside its other events.

A method you reach with `callFunc` must be declared in the component's `<interface>`, as `JRScene.xml` declares `<function name="routerNavigate" />`. Without it the call does nothing and reports nothing. The `callfunc-interface` BSC plugin makes a missing declaration a build error.

## Parallel requests

When requests do not depend on each other and you need every result, use `promises.all([...])`:

```brighterscript
promises.chain(promises.all([
  fetchAsync(reqA, "a"),
  fetchAsync(reqB, "b")
])).then(sub(results as object)
  ' results[0] answers reqA and results[1] answers reqB, whatever order they arrived in.
end sub).catch(sub(err as object)
  ' The first request to reject rejects the whole set.
end sub)
```

Inside a Task, run independent requests over `apiPipeline` instead: it keeps several in flight on one thread. See [pattern 5 in `api-patterns.md`](api-patterns.md#pattern-5-apipipeline-many-independent-requests-one-thread).

## Promise or blocking `fetchRes`

The app keeps two async tools ([ADR 0012](../adr/0012-promise-native-interface-fetchres-exception.md)):

- **A promise (`fetchAsync`)** for the render thread and any other work that must not block. The render thread must never block, so a promise is the only correct tool there.
- **Blocking `fetchRes` or `fetchJson`** inside Task threads, for:
  - the sign-in path (login and server discovery), which runs before the pool is up;
  - Tasks whose requests run in sequence or branch. `QuickPlayTask.doSeries()` is the example: it tries resume, then next up, then shuffle. As a `.then` chain it would need a guard flag threaded through every step. A Task thread can block safely, so the blocking version reads better.

Don't rewrite a working Task orchestrator (`QuickPlayTask`, `LoadItemsTask`, `items.bs`) into a `wait2` loop. It reads worse and puts the app's busiest paths at risk.

The split ends when BrighterScript ships async/await: `await fetchAsync(...)` reads like blocking code and keeps the promise model. The tech-debt entry [`two-async-model-split`](../architecture/tech-debt.md#two-async-model-split) tracks it.

## Replace a Task that only fetches

The biggest cleanup is deleting a Task that exists only to move one `fetchRes` off the render thread.

- **Replace it with a promise** when the Task does only I/O (one or a few `fetchRes`, no heavy work on the result) and the caller creates it and observes its output. Call `fetchAsync(...).then(...)` where the caller started the Task, and delete the Task's `.xml` and `.bs`. Example `3a` below did this.
- **Keep the Task** when it loops over arrays or reshapes data. That work must stay off the render thread ([render-thread rules](../../components/CLAUDE.md#render-thread-protection)). A promise moves only the wait, not the work.

A raw `observeField("isDone", …)` on a `submitApiRequest()` result is the pattern promises replace. [`promise-ratchet.cjs`](../../scripts/lint/promise-ratchet.cjs) counts those in app code against [`.promise-ratchet-baseline`](../../.promise-ratchet-baseline) and fails CI when the count rises. The baseline is `0`, so any new one fails.

## Cleanup when a component is destroyed

A pending promise must never call back into a destroyed component. You don't write this cleanup. The `auto-abandon-promises` BSC plugin adds `abandonApiPromises()` to the start of `onDestroy()` in any component that calls `fetchAsync`. A component that calls `fetchAsync` and has no `onDestroy()` fails the build (`auto-abandon-promises-needs-on-destroy`). `JRScreen.bs` and `JRGroup.bs` call it in their own `onDestroy()` for components that inherit it.

Write your `onDestroy()` as usual and don't call `abandonApiPromises()` yourself. How it works: [`async.md`](../architecture/async.md#cancellation-auto-abandon).

## Mistakes to avoid

- **Treating `.then` as success.** A 404 or a 500 resolves. Branch on `res.ok`.
- **Reading `err.reason` as always set.** It is missing when the pool's own response is rejected. Read `err.statusCode` too.
- **Handling errors in `.finally`.** Since `@rokucommunity/promises` 0.6.0, `.finally()` no longer stops a rejection, so it still reaches the next `.catch`. Handle errors in `.catch`.
- **Forcing `wait2` into a Task.** A Task that runs requests in sequence uses `fetchRes`.
- **Reusing a `requestId`** for two requests in flight at once.

## Test promise code

[`apiPromise.spec.bs`](../../tests/source/unit/api/apiPromise.spec.bs) shows the pattern. It tests the adapter's decisions directly, with no pool:

- `apiPromiseShouldResolve(res)` is the resolve-or-reject decision. Assert it for `2xx`, `4xx`, `5xx`, a transport failure and a missing response.
- For settling and cleanup, fill a registry AA and call `settleApiPromiseIn(pending, requestId)`, `timeoutApiPromiseIn(pending, requestId)` or `abandonApiPromisesIn(pending)`. Then assert the promise's `promiseState` and `promiseResult`. These take the registry as a parameter because a bare call from a Rooibos class method does not share the component's `m`.

Run one spec with `npm run test:tdd` ([TDD guide](unit-tests-tdd.md)), then `npm run test:unit` before you commit.

## Examples to copy

Each covers one shape you will meet:

| # | Shape | Where | What it shows |
| --- | --- | --- | --- |
| `3a` | Replace a Task that only fetches | [`VideoPlayerView.fetchNextEpisode()`](../../components/video/VideoPlayerView.bs) | The `GetNextEpisodeTask` component was deleted. Its one `fetchRes` became `fetchAsync().then().catch()` on the render thread. |
| `3b` | Replace a raw result observer | [`ItemDetails.checkTrailerAvailability()`](../../components/ItemDetails.bs) | A `submitApiRequest` result node and its `observeField` became `fetchAsync().then()`. The context drops an answer that lands after the user moved to another item. |
| `3c` | Reach the render thread from the main thread | [`JRScene.routerNavigate()`](../../components/JRScene.bs), called from [`loginRouter`](../../source/loginRouter.bs) | `loginRouter` calls `m.scene.callFunc("routerNavigate", …)`. On the render thread, `navigateThenFocus()` chains the promise `sgrouter.navigateTo` returns. |
| `3d` | Requests that depend on each other | [`UserSelect.startQuickConnect()`](../../components/login/UserSelect.bs) | Start, then poll until approved, then exchange the secret. A `Timer` spaces the polls. It replaced a Task created for every poll. Each poll's outcome is decided in [`quickConnect.bs`](../../source/utils/quickConnect.bs), which tests cover without a pool. |

`ItemDetails.toggleFavorite()` shows the error path: it reverts the button and shows a toast when `res.ok` is false or the request rejects.

Requests that depend on each other are rare on the render thread. Most such sequences live in the Task orchestrators that keep `fetchRes`, and render-thread components usually send one request. Quick Connect is the exception because its middle step waits on a person, which could keep a Task thread blocked for minutes. For a plain sequence, return the next promise from a `.then` callback and the chain waits for it; the library's [chaining example](https://github.com/rokucommunity/promises#chaining) shows the shape.
