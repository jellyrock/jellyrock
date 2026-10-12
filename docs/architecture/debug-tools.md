---
topic: debug-tools
related-files:
  - components/data/DebugFlags.xml
  - components/JRScene.bs
  - components/JRScene.xml
  - source/utils/globals.bs
  - source/utils/tasks.bs
last-reviewed: 2026-10-10
---

# Debug tools

How the debug-only tools are built: the failure switches on `m.global.debug`, the `testToast` field, the toast key sequence, and the Task-thread readout. To use them from the console, see [`debug-flags.md`](../dev/debug-flags.md). Logging is in [`logging.md`](logging.md), tests in [`testing.md`](testing.md).

## Debug flags: `m.global.debug`

Switches that force an error path, so it can be seen on a device without a broken server. They exist only in a debug build (`bs_const=debug=true` in `manifest`; the committed value is `false`), and the device's compiler drops every `#if debug` block when building anything else, so a release build carries none of the code.

`components/data/DebugFlags.xml` is a `ContentNode` whose fields are the switches. Most are booleans, one per failure it can force (`shouldForceFiltersFail`, `shouldForceFavoriteFail`, `shouldForceWatchedFail`). A field does not have to be either: `extraButtonCount` is an integer that pads a button row, so a feature real data cannot reach can be seen on a device. What every field shares is that it does nothing at its default and is compiled out of a release build.

`setGlobalNodes()` in `globals.bs` creates the node, inside `#if debug`, and prints each switch to the debug console at startup. Code that honors a switch wraps the check in `#if debug` too:

```brighterscript
#if debug
  if m.global.debug.shouldForceFiltersFail
    m.top.getScene().testToast = "error|Filters failed (debug)"
    return
  end if
#end if
```

The list of switches, what each does and the steps to add one are in [`debug-flags.md`](../dev/debug-flags.md).

## Toast testing: the `testToast` field

`JRScene` has a `testToast` string field (`alwaysNotify`). It is in every build, and `JRScene.init()` observes it in every build. Setting it shows a toast at once. The value is `"type|message"`, where the type is `error`, `success`, `warning` or `info`; without a `|`, the whole value is the message and the type is `error`.

`onTestToast()` splits the value and calls the same `showToast()` every real toast goes through, so what appears is what a user would see. Setting the field from the console depends on the thread the console paused on; the forms for each, and the RTA way to set it without pausing, are in [`debug-flags.md`](../dev/debug-flags.md#show-a-toast).

## The Up, Up, Down, Down sequence (unreliable)

In a debug build, `JRScene.onKeyEvent()` shows the next test toast (error, then success, warning, info) when it sees Up, Up, Down, Down with no more than 2 seconds between presses. It counts key releases, because children in this app return `false` for a release so it can bubble up.

That once worked anywhere. It no longer does on routed screens (checked on a device in 2026-07): Roku's built-in lists such as `RowList` keep the releases of keys they handle, and the router's `Outlet` keeps every release that bubbles out of a routed view. So the sequence registers only while the focus is outside the outlet, on the overhang for example. Use `testToast` instead.

## Task-thread readout: `printTaskThreads()`

Roku OS allows an app 100 threads at once and raises `&h29` past that, the crash behind epic #728. The Task-thread ledger answers "how many Task threads are live?" on a real device, so that limit is measured, not argued about.

### The ledger is in every build

`launchTask()` in `source/utils/tasks.bs` is the one place a Task thread starts; the `no-raw-run` BSC plugin makes a bare `control = "RUN"` anywhere else a build error. Every launch is recorded in `m.global.taskLedger`, in every build. ([`global-state.md`](global-state.md#task-thread-ledger-mglobaltaskledger) says why it lives in a node field and not the much cheaper `GetGlobalAA()`.) The count is worked out when needed, from each recorded node's `state`. A finished thread stops counting toward Roku's limit even though its node is still valid, so `state` is the true signal, and a `control = "STOP"` needs no bookkeeping of its own.

Above `TASK_THREAD_WATERMARK` (50) live threads, `launchTask()` queues a launch until a thread frees ([ADR 0041](../adr/0041-task-launch-queue.md)), and refuses only once `TASK_QUEUE_CAP` launches already wait. `m.global.taskLaunchQueued`, the current queue depth, is in every build too.

### What each build shows

**`printTaskThreads()` and the `[TASKS] REFUSED` print are `#if debug`**, so a normal sideload does not have them: seeing either takes `debug=true` and a rebuild. These fields need no rebuild. They are `#if perfTiming`, which is `true` in the committed `manifest`, and `harden-prod-manifest.js` turns it off for release builds:

```brightscript
?m.global.taskLaunchQueuedTotal   ' how many launches have waited in the queue
?m.global.taskLaunchQueuePeak     ' the deepest the queue has been
?m.global.taskLedgerRefusals      ' how many launches were refused (queue full, or no queue yet)
?m.global.taskLedgerFirstRefused  ' the subtype of the FIRST refused node, the one that names the fan-out
```

Check those first when asking whether the ceiling fired: they need no rebuild and last the whole session instead of scrolling past in the console. A `taskLaunchQueuedTotal` above zero already means the app reached the watermark. A queued launch is late, not lost, but something is launching too many Tasks.

In a debug build, from the BrightScript console with the app paused:

```brightscript
printTaskThreads()
```

```text
[TASKS] live=2 tracked=2
[TASKS]   ServerReachableTask id=probeA state=run
[TASKS]   ServerReachableTask id=probeB state=run
[TASKS] (app launches only — excludes main, render, and any thread not started via launchTask)
```

It reads the ledger from whichever thread the console paused on, usually the render thread, where screens launch their Tasks.

### What the number leaves out

- **Threads the app did not start with `launchTask()`.** The ledger sees only those, not the main and render threads or the vendored `WebSocketClient` that `RemoteControlTask` starts on its own thread. Add about three for the total Roku counts.
- **An entry lost to a race.** Recording a launch reads, changes and writes a shared `m.global` field, and launches happen on the main thread as well as the render thread (`setGlobalNodes`, the font tasks in `main.bs`, `replayRoute.performServerSwitch`). Two launches at once on different threads can lose an entry, so the count can be one low, and both can be admitted past the watermark. What the ledger did record, it counts exactly: the count is a read of each node's `state`, with no counter to drift.

**Don't measure performance on a debug build.** `#if debug` also attaches the whole raw API answer to every transformed item (`JellyfinDataTransformer`), so a debug build does more work and holds more memory per item ([`home-first-paint-performance.md`](../dev/home-first-paint-performance.md)).

The ledger's arithmetic (`pruneTaskLedger`, `countLiveTaskThreads`, `taskThreadIsLive`) is written as pure functions that take the ledger as an argument and touch no globals, so Rooibos can test it.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md): search its `area` lines for `JRScene` and `tasks.bs`.
