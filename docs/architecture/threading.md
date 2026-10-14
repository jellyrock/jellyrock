---
topic: threading
related-files:
  - source/main.bs
  - source/loginRouter.bs
  - source/remotecontrol/remoteDispatch.bs
  - components/JRScene.bs
  - source/utils/tasks.bs
  - components/video/LoadCaptionTask.bs
  - components/video/CaptionRenderer.bs
  - scripts/bsc-plugins/no-raw-run.cjs
  - scripts/bsc-plugins/no-task-fanout.cjs
  - scripts/bsc-plugins/no-same-node-relaunch.cjs
  - tests/source/unit/platform/TaskRelaunch.spec.bs
  - tests/source/unit/platform/TaskRelaunchBlockModes.spec.bs
  - tests/source/unit/platform/TaskThreadSlots.spec.bs
  - tests/source/unit/platform/TaskStopProgress.spec.bs
  - tests/source/unit/utils/tasks.spec.bs
last-reviewed: 2026-10-10
---

# Threading

Which thread your code runs on, what that thread forbids, and how we find out what it forbids, since Roku does not publish the list.

## There are three threads, not two

"Main" and "render" are different threads. This is the part that keeps getting misremembered. From Roku's [`threads.md`](https://github.com/rokudev/dev-doc/blob/v2.0/docs/DEVELOPER/core-concepts/threads.md):

| Thread | Roku's description | In JellyRock |
|---|---|---|
| **Main BrightScript** | "launched for all Roku applications from the `Main()` … entry point. For SceneGraph applications, the thread is used primarily to create the scene component object, which starts the SceneGraph Render thread" | `Main()` in `source/main.bs` (start-up and the event loop), and the code its loop calls: the sign-in coordinator in `source/loginRouter.bs` and `remoteDispatch` in `source/remotecontrol/remoteDispatch.bs` |
| **SceneGraph Render** | "the main SceneGraph thread that performs all rendering… Certain BrightScript operations and components that might block or modify the SceneGraph in the Render thread cannot be used in this thread" | Every ordinary component's `init()`, field observers, `onKeyEvent` and `callFunc` targets. A `Task` node's `init()` does not share these restrictions (see [Constructing components](#constructing-components)). |
| **Task** | "By creating and running a Task node, you can launch asynchronous Task threads. These threads can perform most typical BrightScript operations" | The function of every `extends="Task"` component, spread across `components/` (`LoadItemsTask2`, `LoadCaptionTask`, `LoadLatestRowsTask`, the API pool and more) |

A `.bs` file in `source/` runs on whichever thread calls it. Code that `Main()` calls runs on the main thread, but the same helper imported by a component runs on the render thread. That is why `source/CLAUDE.md` and `components/CLAUDE.md` both carry render-thread rules.

> Blocking the render thread is fatal, not slow: "production apps will terminate after 10 seconds; sideloaded apps will timeout in 3 seconds."

## Roku does not publish the restricted-component list

Roku's `threads.md` says "the thread usage of these operations and components is listed in BrightScript support". But [`brightscript-support.md`](https://github.com/rokudev/dev-doc/blob/v2.0/docs/DEVELOPER/core-concepts/scenegraph-brightscript/brightscript-support.md) has only its introduction. It says each entry would name the SceneGraph node to use instead, or that the component works only in a Task node, and then the file ends with no entries (checked 2026-10-10 in the `v2.0` repo).

So there is no authority to look this up in. A claim about what a thread can construct is folklore unless someone measured it, and folklore here has already produced one wrong decision record in this repo ([below](#a-correction-worth-keeping)).

**Measure it, then record it here.** A probe is a test-only component whose `init()` attempts the construction, plus a Rooibos spec that reads the result.

## Measured findings

Each row is an on-device measurement, not a reading of the docs. Record the device and OS, because results can differ across hardware.

### Constructing components

| Operation | Thread | Result | Measured on |
|---|---|---|---|
| `CreateObject("roFontRegistry")`, then `GetDefaultFont` and `GetOneLineWidth` | Render | **Works.** The registry and font were valid, and the width was sane. | Streaming Stick 4K, Roku OS 15.2.4, 2026-08-09 |
| `CreateObject("roFileSystem")` in a component's `init()` | Render (a `Group`) and a `Task` node | **Differs by base type.** The same code returned a valid `roFileSystem` in a `Task` component's `init()` and `Invalid` in a `Group` component's `init()`, which faulted `&hec` on the next `fs.Exists()`. | Streaming Stick 4K, Roku OS 15.3.4, 2026-09-22 |
| `CreateObject("roSGNode", "Timer")` | Main, before `m.screen.show()` | **Fails:** returns `Invalid`. | Streaming Stick 4K, Roku OS 15.2.4, 2026-08-02 ([logging.md](logging.md)) |
| A nested `wait(0, port)` message-port loop | Render | **Deadlocks the app.** | Evidence on #287 |

**`roFileSystem`.** This was found while splitting the old `captionTask` into `LoadCaptionTask` and `CaptionRenderer`, where only the base type changed. What was measured is the difference in what each `init()` can construct. Which thread a Task's `init()` runs on was not separated.

What follows for the code: render-thread code that needs to know whether the fallback font reached disk asks a Task. `LoadCaptionTask` writes `fontAvailable` before every `captionData` write, and `CaptionRenderer.applyFont()` reads it on delivery. Reading the settings that trigger the download (`playbackSubsCustom`, `uiFontFallback`) is not equivalent. It was tried and reverted, because the setting starts the download and does not prove it finished. A server with `EnableFallbackFont = False` returns `[]` from `GET /FallbackFont/Fonts`, so `tmp:/font` is never written while the setting stays on (measured 2026-09-22).

**`Timer`.** This is why the log manager starts in `JRScene.init()`, not in `main.bs`. The limit is about when, before the screen shows, not which thread ([logging.md](logging.md)).

**Nested `wait()`.** This is why each dialog delivers its answer on its own `result` field instead of returning it ([navigation.md](navigation.md#the-standard-dialog-system-sourceutilsdialogsbs)).

### Field reads across threads

Each figure is Stick 4K first, then Ultra. All were measured on Roku OS 15.3.4, 2026-08-23, unless the row says otherwise.

| Read | Thread | Result |
|---|---|---|
| A field on a node the reading thread owns | Any | **1.7 µs** / **1.1 µs** |
| A field on a render-owned Task node | Task | **91–118 µs** / **69 µs**, a rendezvous |
| The same Task-node read | Render | **7.1 µs** / **4.5 µs**, no rendezvous |
| An `m.global` field (render-owned) | Task | **93 µs** / **62 µs**, a rendezvous |
| An `m.global` field | Render | **2.0 µs** / **1.3 µs**, the same as a local node |
| Task-side crossings while the user scrolls a `TimeGrid` (400 ms per row) | Task | **Each crossing waits on the animating render thread.** A 700-program transform crossing twice per item took **51.8 s** against **1.4 s** idle (about 37 ms per crossing, derived). A fetch of about 70 ms through the API pool took **2.5–8.8 s**. Streaming Stick 4K only, 2026-09-21. |
| Crossings while the user scrolls a library `MarkupGrid` (Down every 150 ms): `LoadItemsTask2` building a 100-item page with three crossings per item (`m.global.server.version` inside `transformBaseItem`, and `m.top.itemId`) | Task | **A page took 1.5–3.3 s while scrolling and about 0.55 s idle. With the three read once per page: 0.22–0.32 s scrolling, about 0.22 s idle.** Time stuck at the last loaded row over a 20 s scroll went from 4.6–5.4 s to 0–70 ms (3 runs per arm). 512 MB Streaming Stick `3600X`, 2026-09-25. `LoadItemsTask2` now reads them once per page. |

#### What a crossing costs, and the half that surprises people

Two rules follow from these rows. The second is the one people miss.

**1. The price depends on who owns the node, not on how the code looks.** Nodes are render-owned by default, `m.global` and every Task node included. So render-thread code (`init()`, field observers, `onKeyEvent`, `callFunc` targets) reads them cheaply, while the same read from a Task thread costs about 46 times more. `m.global` is the pair to remember: **2.0 µs from the render thread, 93 µs from a Task thread** on a Stick 4K.

**2. Removing the rendezvous does not make it free.** Moving a per-entry walk over Task nodes from a Task thread to the render thread took it from **132.6 µs to 20.1 µs per entry**. That is a 6.6 times win, not the 46 times the read costs predict. What remains is ordinary interpreter work (`isValid`, `LCase`, string compares, rebuilding an array), which no thread placement removes. So "budget crossings, not bytes" ([async.md](async.md#crossing-the-thread-boundary-costs-a-rendezvous--budget-crossings-not-bytes)) is necessary but not enough: **an O(n) loop over nodes is expensive on the render thread too**, only less so. Budget the loop as well as the crossing.

How it was measured: `components/testing/TaskLedgerBench.bs`, driven through the on-device component of `roku-test-automation`, whose `callFunc` runs on the render thread. The Task-thread column came from a Rooibos mirror, `taskLedgerCost.spec.bs`, identical function for function (same iteration count, fixture and subtracted floor), so the two differed only in the thread. The mirror was removed in #849 because a benchmark that asserts nothing does not belong in a per-PR device suite. Its gate survives in `tests/source/unit/utils/tasks.spec.bs`: a thread-local field read must stay cheap, the premise this table rests on. The render-thread placement is proven by the data: a Task node is render-owned, so a cheap read of one can only happen on the render thread.

### Relaunching and stopping a Task

| Operation | Thread | Result | Measured on |
|---|---|---|---|
| `control = "STOP"`, then `launchTask` on the same node in one callback, while its function still runs | Render | **A race.** Run alone, the launch was ignored. In full-suite runs it was sometimes honored and sometimes ignored, on both devices. | Streaming Stick 4K and 512 MB Streaming Stick `3600X`, Roku OS 15.3.4, 2026-09-15 and 16 |
| The same race as a rate: STOP, write the input field, relaunch the same node, by how the task was blocked and when the relaunch lands | Render | **The run is lost often and unpredictably, and the stopped run never finishes against the new input.** | Streaming Stick 4K (`3820RW` and `3820R2`), Roku OS 15.3.4, 2026-09-17 |
| `launchTask` on the same node from its own observer, for the field it writes last before returning, with no STOP | Render | **Dropped.** | Streaming Stick 4K, Roku OS 15.3.4, 2026-09-21 |
| `launchTask` on the same node from a later callback while its function still runs, with no STOP | Render | **Ignored, every time:** 40 of 40. | Streaming Stick 4K and 512 MB Streaming Stick `3600X`, Roku OS 15.3.4, 2026-09-22 |
| STOP on a Task parked in `wait()` (with or without a timeout) or `sleep()`, then a new node launched, past Roku's 100-thread cap | Render | **The stopped thread frees its slot at once**, in every block mode. | Streaming Stick 4K, Roku OS 15.3.4, 2026-09-23 (the gate also on the `3600X`) |
| STOP on a Task that is not parked: its `wait()` has been answered but its thread has not run yet, or it is running code between waits | Render | **It makes no further field write.** | Streaming Stick 4K and 512 MB Streaming Stick `3600X`, Roku OS 15.3.4, 2026-09-26 |

**STOP, then relaunch in one callback.** Either way, the stopped function makes no further progress: it stays blocked in `sleep()` or `wait()`. A new node launched in that callback always starts. The same node relaunches from a later callback, or in the same callback once its function has returned. So never rely on either outcome: launch a new node with `replaceTask()` in [`tasks.bs`](../../source/utils/tasks.bs). Its handlers check `isCurrentTaskEvent()`, so an event the replaced node already queued is ignored rather than read off its successor. [`TaskRelaunch.spec.bs`](../../tests/source/unit/platform/TaskRelaunch.spec.bs) pins this and accepts both outcomes, and the `no-same-node-relaunch` build rule flags the pattern.

**The rate.** Every app site used to STOP, write the input and relaunch the same node. The probe counts trials, of 10 per cell, in which nothing started and nothing delivered, by block mode: one long `wait()` as `fetchJson` does, `sleep()`, or a `wait()` poll loop.

- Spec alone (`test:tdd`), two runs: at 0 ms, `wait` 3, `sleep` 2, poll 3, then 7, 5, 4. `wait` at 100, 300 and 600 ms: 2, 6, 0.
- Full suite (`test:all`, CI): at 0 ms, 10, 8, 10. `wait` at 100, 300 and 600 ms: 9, 9, 4. These runs predate the spec's `measurement` tag; `test:all` now skips it.

No block mode stands apart, and no trend with settle time shows at 10 trials. In no trial did the stopped run finish against the new input, so an ignored relaunch is lost work, never a hidden success. The two sets of runs differ in suite context and device unit (same model and OS), and which of those moves the rate was not separated. [`TaskRelaunchBlockModes.spec.bs`](../../tests/source/unit/platform/TaskRelaunchBlockModes.spec.bs) records it, tagged `measurement`, so only `test:tdd` and `test:complete` run it.

**Relaunch from its own observer.** Inside that handler the node still reads `state = "run"`, and no second run started. The TV guide paged its channel list this way, and page 2 never loaded on 6 of 6 cold opens against a 393-channel server, so the guide showed 25 channels. A new node per page (`replaceTask()`) loads every page, which the guide does now. `no-same-node-relaunch` flags this shape since 2026-09-22: a launch with no new node assigned first.

**Relaunch from a later callback.** Nothing started while the function ran, and nothing started after it returned, since the launch is not queued. The running function finished against the input it had already read, so the newer request is lost. Trials launched at 0 ms and 300 ms into the run. This is not a race, unlike the STOP case. A site that can launch again before its last run returns needs a new node per run (`replaceTask()`). A site that waits for `state = "stop"` first is safe: `TrickplayCarousel` queues its tile requests that way. `TaskRelaunch.spec.bs` pins it, and `no-same-node-relaunch` flags the shape.

**STOP frees the thread slot.** 110 of 110 launches started in each mode, with 6 repeats per mode across two runs, no console thread warning and no `&h29`. The control, the same loop with nothing stopped: the console warned at 51 running tasks, and the 102nd launch threw `&h29` ("Too many task threads") every time, 6 of 6. A `try`/`catch` around the `control = "RUN"` write catches that throw and the app runs on; uncaught, it drops into the debugger. Roku's release notes say only that a thread which has "properly terminated" stops counting, which left the parked case open. `replaceTask()` rests on this, so `TaskRelaunch.spec.bs` gates it in every run with the worst case, a `wait()` with no timeout; it fails at launch 102 with the STOP removed. The rate and the control live in [`TaskThreadSlots.spec.bs`](../../tests/source/unit/platform/TaskThreadSlots.spec.bs), tagged `measurement`.

**STOP on a running Task.** On each device: 0 of 20 Tasks answered and then stopped in the same render-thread callback ran their next write. 0 of 10 stopped partway through a loop of writes wrote again, and 0 of 10 stopped during local work made the write that followed. A field read after the STOP did not return either (0 of 10; the same Task left running printed its line, the control). So a stopped Task sends nothing after the STOP. That is what lets `VideoPlayerView.releaseVideoLoad` close a live stream and stop its load without the load running on against a closed stream ([playback.md](playback.md#a-live-stream-the-player-never-held)). [`TaskStopProgress.spec.bs`](../../tests/source/unit/platform/TaskStopProgress.spec.bs) gates it in every run.

### A correction worth keeping

`docs/decisions.md` once recorded that `roFontRegistry` "is a MAIN|TASK-only component Roku refuses to construct on the render thread". The probe above disproves that on current hardware, and the note `photo-unresolvable-failure-policy` now carries a correction. Two things went wrong:

1. The claim was reasoned from the kind of component (it sits near the graphics APIs, so it "must" be restricted) rather than measured.
2. "MAIN|TASK-only … refuses on the render thread" only parses if main and render are the same thread. They are not, which is the confusion this page exists to end.

The decision it supported, a toast instead of a blocking dialog for a photo that cannot be shown, still stands on its other grounds. A modal interrupts a slideshow the user is watching, and the failure cap behaves better. Only the threading reason was false.

## Rules of thumb

- **I/O goes on a Task.** Network, registry and large file reads never run on the render thread. Start a Task with `launchTask(node)` from `source/utils/tasks.bs`, never a raw `control = "RUN"`. The `no-raw-run` build rule makes the raw form an error, so every launch goes through the thread ledger (#728).
- **`launchTask()` bounds the thread count.** Past `TASK_THREAD_WATERMARK` running threads it queues the launch instead of starting it, and starts it when a slot frees ([ADR 0041](../adr/0041-task-launch-queue.md)). A queued node does not read `state = "run"`, so ask `isTaskInFlight(node)` whether a launch is still pending.
- **One Task per screen, never one per item.** `no-task-fanout` makes a `launchTask()` inside a loop an error unless it names a fixed `m.` slot (`m.loadTask`, `m.view.loadTask`) that the loop does not rebind. The two rules split the job: `no-raw-run` bounds where a thread may start, `no-task-fanout` how many. #728 needed both. Its fan-out went through an ordinary launch site and already tore its tasks down correctly, because the crash came from concurrent launches inside one Home load, not from threads leaked across screens. Fan every item through one orchestrator Task instead (`components/home/LoadLatestRowsTask.bs`).
- **Don't assume a component is forbidden on the render thread because it sounds graphical.** Measure.
- **A rendezvous is per dot.** From a Task, `x.y.z` on a render-owned node is three rendezvous. Use `getFields()` and `setFields()`, or build a whole tree and hand it over once.
- **Observers run on the render thread.** Task nodes are owned by the render thread, so their fields rendezvous from the Task side and their observers fire on the render thread. Roku's one exception is a field on a node the Task thread owns, such as one it created: its observers fire on the Task thread.
