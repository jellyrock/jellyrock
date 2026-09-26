---
topic: threading
related-files:
  - source/main.bs
  - components/JRScene.bs
  - source/utils/tasks.bs
last-reviewed: 2026-09-23
---

# Threading

Which thread your code is on, what that forbids, and how we establish the forbidden list — because
Roku does not publish it.

## There are three threads, not two

This is the part that keeps getting misremembered. "Main" and "render" are **not** the same thread.
From Roku's [`threads.md`](https://github.com/rokudev/dev-doc/blob/v2.0/docs/DEVELOPER/core-concepts/threads.md):

| Thread | Roku's description | In JellyRock |
|---|---|---|
| **Main BrightScript** | "launched for all Roku applications from the `Main()` … entry point. For SceneGraph applications, the thread is used primarily to create the scene component object, which starts the SceneGraph Render thread" | `source/main.bs` — bootstrap, the event loop, `loginRouter`, `remoteDispatch` |
| **SceneGraph Render** | "the main SceneGraph thread that performs all rendering… Certain BrightScript operations and components that might block or modify the SceneGraph in the Render thread cannot be used in this thread" | every component's `init()`, field observers, `onKeyEvent`, `callFunc` targets — **but see the `roFileSystem` row below: a `Task` node's `init()` measurably does not share the render thread's restrictions** |
| **Task** | "By creating and running a Task node, you can launch asynchronous Task threads. These threads can perform most typical BrightScript operations" | everything under `components/tasks/`, the API pool |

So a `.bs` file in `source/` runs on whichever thread called it: `main.bs` code is main-thread,
but the same helper imported by a component runs on the render thread. That is why
`source/CLAUDE.md` and `components/CLAUDE.md` both carry render-thread rules.

> The Render thread blocking is fatal, not slow: "production apps will terminate after 10 seconds;
> sideloaded apps will timeout in 3 seconds."

## The restricted-component list is not published

Roku's [`threads.md`](https://github.com/rokudev/dev-doc/blob/v2.0/docs/DEVELOPER/core-concepts/threads.md)
says the per-component thread rules "are listed in BrightScript support" — but
[`brightscript-support.md`](https://github.com/rokudev/dev-doc/blob/v2.0/docs/DEVELOPER/core-concepts/scenegraph-brightscript/brightscript-support.md)
contains only the introduction. It ends mid-sentence at "…with additional information for many,
such as:" and the list never follows. **Both** the `v2.0` repo markdown and the rendered
`developer.roku.com` page truncate at the same point (checked 2026-08-09).

There is therefore no authority to look this up in. Claims about what is or isn't constructible on
a given thread are, in practice, folklore unless someone measured them — and folklore in this area
has already produced at least one wrong decision record in this repo (see below).

**So: measure it, then record it here.** A probe is ~15 lines — a test-only component whose `init()`
(guaranteed render thread) attempts the construction, plus a Rooibos spec that reads the result.

## Measured findings

Each row is an on-device measurement, not a reading of the docs. Include device + OS, because
these can differ across hardware.

| Component / operation | Thread | Result | Measured on |
|---|---|---|---|
| `CreateObject("roFontRegistry")` + `GetDefaultFont` + `GetOneLineWidth` | Render | **Works.** Registry valid, font valid, returned a sane width | Streaming Stick 4K, Roku OS 15.2.4, 2026-08-09 |
| `CreateObject("roFileSystem")` in a component's `init()` | Render (a `Group`) vs a `Task` node | **Differs by base type.** The SAME `setFont()` body returned a valid `roFileSystem` inside a `Task` component's `init()` and `Invalid` inside a `Group` component's `init()`, faulting `&hec` on the next `fs.Exists()`. Found splitting `captionTask` into `LoadCaptionTask` + `CaptionRenderer`: only the base type changed. So **a `Task` node's `init()` does not run under the same restrictions as an ordinary component's**, and the "every component's `init()` → Render" row above should not be read as covering Task nodes. What is measured is the difference in what can be constructed; which thread a Task's `init()` actually runs on was NOT separated here. Render-thread code that needs to know whether the fallback font actually reached disk must have a TASK thread answer it — `LoadCaptionTask` publishes `fontAvailable` before it publishes `captionData`, and `CaptionRenderer.applyFont()` reads it on delivery. Asking the settings that trigger the download (`playbackSubsCustom` / `uiFontFallback`) is NOT equivalent, was tried here, and was reverted: the setting being on is what STARTS the download, not proof it finished — measured 2026-09-22, a server with `EnableFallbackFont = False` returns `[]` from `GET /FallbackFont/Fonts`, so `tmp:/font` is never written while the setting stays on | Streaming Stick 4K, Roku OS 15.3.4, 2026-09-22 |
| `CreateObject("roSGNode", "Timer")` | Main, **before** `m.screen.show()` | **Fails** — returns `Invalid`. This is why the log manager can't be stood up in `main.bs`; see [logging.md](logging.md) | Streaming Stick 4K, Roku OS 15.2.4 |
| Nested `wait(0, port)` message-port loop | Render | **Hard-deadlocks the app.** The basis for the per-instance `result` field in the dialog system rather than a synchronous return; see [navigation.md](navigation.md#the-standard-dialog-system-sourceutilsdialogsbs) | Evidence on #287 |
| Field read on a node the READING thread owns | any | **1.7 µs** (Stick 4K) / **1.1 µs** (Ultra) | Stick 4K + Ultra, Roku OS 15.3.4, 2026-08-23 |
| Field read on a render-owned **Task node**, from a Task thread | Task | **91–118 µs** / **69 µs** — a rendezvous | same |
| The same Task-node read, from the **Render** thread | Render | **7.1 µs** / **4.5 µs** — no rendezvous | same |
| `m.global` field read, from a Task thread | Task | **93 µs** / **62 µs** — `m.global` is render-owned, so this rendezvouses | same |
| `m.global` field read, from the **Render** thread | Render | **2.0 µs** / **1.3 µs** — indistinguishable from a local node | same |
| The same Task-side crossings while the user scrolls a `TimeGrid` (400 ms per row) | Task | **Each waits on the animating render thread.** A 700-program transform crossing twice per item took **51.8 s** against **1.4 s** idle (~37 ms per crossing, derived); a ~70 ms API-pool fetch took **2.5–8.8 s** | Streaming Stick 4K, Roku OS 15.3.4, 2026-09-21 |
| The same crossings while the user scrolls a library `MarkupGrid` (Down every 150 ms): `LoadItemsTask2` building a 100-item page with three crossings per item (`m.global.server.version` inside `transformBaseItem`, and `m.top.itemId`) | Task | **Building a page took 1.5–3.3 s scrolling, ~0.55 s idle; with the three read once per page, 0.22–0.32 s scrolling and ~0.22 s idle.** Time stuck at the last loaded row over a 20 s scroll went from 4.6–5.4 s to 0–70 ms (3 runs per arm) | 512 MB Streaming Stick `3600X`, Roku OS 15.3.4, 2026-09-25 |
| `control = "STOP"` then `launchTask` on the SAME Task node, in one callback, while its function is still running | Render | **Not reliable — a race.** The launch was ignored when the spec ran alone, but in full-suite runs it was sometimes honored (the function started again) and sometimes ignored, on both devices. Either way, the stopped function makes no further progress (blocked in `sleep()` or `wait()`). A NEW node launched in that callback always starts, and the same node relaunches from a later callback, or in the same callback once its function had returned. So never rely on either outcome: launch a new node — `replaceTask()` in [`tasks.bs`](../../source/utils/tasks.bs), whose handlers then check `isCurrentTaskEvent()` so an event the replaced node already queued is ignored rather than read off its successor. Pinned in [`TaskRelaunch.spec.bs`](../../tests/source/unit/platform/TaskRelaunch.spec.bs), which accepts both outcomes. The `no-same-node-relaunch` build rule flags the pattern | Streaming Stick 4K and 512 MB Streaming Stick `3600X`, Roku OS 15.3.4, 2026-09-15/16 |
| The same race as a RATE: STOP, write the input field, relaunch the same node — as every app site did — by how the task was blocked (one long `wait()` as `fetchJson` does, `sleep()`, a `wait()` poll loop) and how far into the run the relaunch lands | Render | **The run is lost often and unpredictably; the stopped run is never carried.** Trials in which nothing started and nothing delivered, of 10 per cell. Spec alone (`test:tdd`), two runs: at 0 ms, `wait` 3 / `sleep` 2 / poll 3, then 7 / 5 / 4; `wait` at 100 / 300 / 600 ms, 2 / 6 / 0. Full suite (`test:all`, CI): at 0 ms 10 / 8 / 10; `wait` at 100 / 300 / 600 ms, 9 / 9 / 4. No block mode stands apart, and no trend with settle time is visible at n=10. In no trial did the stopped run finish against the new input, so an ignored relaunch is lost work, never a hidden success. The spec-alone and full-suite runs differ in suite context and device unit (same model and OS version); which of those moves the rate is not separated. Recorded by [`TaskRelaunchBlockModes.spec.bs`](../../tests/source/unit/platform/TaskRelaunchBlockModes.spec.bs), tagged `measurement` so only `test:tdd` / `test:complete` run it | Streaming Stick 4K (`3820RW` / `3820R2`), Roku OS 15.3.4, 2026-09-17 |
| `launchTask` on the SAME Task node from inside its own observer — the handler for the field the Task writes last, just before its function returns — with no STOP | Render | **The relaunch was dropped.** Inside that handler the node still reads `state = "run"`, and no second run started: the TV guide paged its channel list this way, and page 2 never loaded on 6 of 6 cold opens against a 393-channel server, so the guide showed 25 channels. A new node per page (`replaceTask()`) loads every page. `no-same-node-relaunch` flags this shape since 2026-09-22 (a launch with no new node assigned first) | Streaming Stick 4K, Roku OS 15.3.4, 2026-09-21 |
| `launchTask` on the SAME Task node from a LATER callback while its function is still running, with no STOP — write the input field, then launch, as every site that keeps one node for its whole life does | Render | **Ignored, every time.** Nothing started while the function ran, nothing started after it returned (the launch is not queued), and the running function finished against the input it had already read — so the newer request is simply lost. 40 of 40 trials, launched at 0 ms and 300 ms into the run. Not a race, unlike the STOP case above. A site that can launch again before its last run returns needs a new node per run (`replaceTask()`); a site that waits for `state = "stop"` first (`TrickplayCarousel` queues its tile requests) is safe. Pinned in [`TaskRelaunch.spec.bs`](../../tests/source/unit/platform/TaskRelaunch.spec.bs); `no-same-node-relaunch` flags the shape (a launch with no new node assigned first) | Streaming Stick 4K and 512 MB Streaming Stick `3600X`, Roku OS 15.3.4, 2026-09-22 |
| `control = "STOP"` on a Task whose function is parked in `wait()` (with a timeout, or with none) or `sleep()`, then a NEW node launched — repeated past Roku's 100-thread cap, every stopped node kept referenced | Render | **The stopped thread gives its slot back at once, in every block mode — replacing a node per run does not stack threads.** 110 of 110 launches started in each mode, 6 repeats per mode across two runs, with no console thread warning and no `&h29`. Control, the same loop with nothing stopped: the console warned at 51 running tasks, and the 102nd launch threw `&h29` ("Too many task threads") every time, 6 of 6. A `try`/`catch` around the `control = "RUN"` write CATCHES the throw, and the app ran on afterwards; uncaught, it drops into the debugger. Roku's release notes say only that a thread which has "properly terminated" stops counting, which left the parked case open. This is what `replaceTask()` rests on, so it is gated in every run by [`TaskRelaunch.spec.bs`](../../tests/source/unit/platform/TaskRelaunch.spec.bs) (no-timeout `wait()`, the worst case; it fails at launch 102 with the STOP removed). The rate and the control live in [`TaskThreadSlots.spec.bs`](../../tests/source/unit/platform/TaskThreadSlots.spec.bs), tagged `measurement` | Streaming Stick 4K, Roku OS 15.3.4, 2026-09-23 (gate also on 512 MB Streaming Stick `3600X`, same OS) |

### What a crossing costs, and the half that surprises people

Two rules fall out of the rows above. The second is the one that is easy to miss.

**1. The price depends on WHO OWNS the node, not on how the code looks.** Nodes are render-owned by
default — `m.global` and every Task node included — so render-thread code (`init()`, field
observers, `onKeyEvent`, `callFunc` targets) touches them for free, while the identical read from a
Task thread costs **~46×** more. `m.global` is the pair worth memorizing: **2.0 µs from the render
thread, 93 µs from a Task thread** on a Stick 4K.

**2. Removing the rendezvous does NOT make it free.** Moving a per-entry walk over Task nodes from a
Task thread to the render thread took it from **132.6 µs to 20.1 µs per entry** — a 6.6× win, not
the ~46× the read-cost ratio predicts. What remains is ordinary BrightScript interpreter work
(`isValid`, `LCase`, string compares, rebuilding an array), and no amount of thread placement
touches it. So "budget crossings, not bytes"
([async.md](async.md#crossing-the-thread-boundary-costs-a-rendezvous--budget-crossings-not-bytes))
is necessary but not sufficient: **an O(n) loop over nodes is expensive on the render thread too**,
just less catastrophically. Budget the loop as well as the crossing.

Apparatus: `components/testing/TaskLedgerBench.bs`, driven through `roku-test-automation`'s on-device
component, whose `callFunc` runs on the render thread. The off-thread column came from a Rooibos
mirror of it — `tests/source/unit/utils/taskLedgerCost.spec.bs`, function-for-function identical
(same iteration count, same fixture, same apparatus floor subtracted) so the two tables differed in
exactly ONE variable: which thread the code ran on. **That mirror has since been deleted** — its
numbers are the ones in this table, and a benchmark that asserts nothing does not belong in a per-PR
device suite; see the shipped entry dated 2026-08-23 in `docs/progress.md`. Only its gate survives,
in `tests/source/unit/utils/tasks.spec.bs`, asserting that a thread-local field read stays cheap —
the platform premise this whole table rests on. Render-thread execution is proven from the data
rather than from the architecture — a Task node is documented render-owned, so a cheap read of one
is only possible on the render thread.

### A correction worth keeping

`docs/decisions.md` recorded that `roFontRegistry` "is a MAIN|TASK-only component Roku refuses to
construct on the render thread." The probe above disproves that on current hardware. Two things
went wrong and are worth avoiding again:

1. The claim was reasoned from the *category* of component (it sits near the graphics APIs, so it
   "must" be restricted) rather than measured.
2. The phrasing "MAIN|TASK-only … refuses on the render thread" only parses if main and render are
   the same thread. They aren't — which is the confusion this page exists to end.

The decision that claim supported (toast instead of a blocking dialog for an unresolvable photo)
still stands on its other grounds: a modal interrupts a slideshow the user is passively watching,
and the failure-cap behavior is genuinely better. Only the threading rationale was false.

## Rules of thumb

- **I/O goes on a Task.** Network, registry, large file reads — never the render thread. Start it
  with `launchTask(node)` (`source/utils/tasks.bs`), never a raw `control = "RUN"`; the `no-raw-run`
  BSC plugin makes the raw form a build error so the thread count stays bounded (#728).
- **One Task per screen, never one per item.** `no-task-fanout` makes an in-loop `launchTask()` a
  build error unless it names a fixed `m.<field>` slot the loop doesn't rebind. The two rules split
  the job: `no-raw-run` bounds *where* a thread may start, `no-task-fanout` bounds *how many*. #728
  needed both — its fan-out went through an ordinary launch site and already tore its tasks down
  correctly, because the crash was concurrent launches inside one Home load rather than threads
  leaked across navigation. Fan every item through one orchestrator Task instead
  (`components/home/LoadLatestRowsTask.bs`).
- **Don't assume a component is render-thread-forbidden because it sounds graphical.** Measure.
- **Rendezvous is per-dot.** From a Task, `x.y.z` on a render-thread-owned node is three separate
  rendezvous. Use `getFields()` / `setFields()`, or build a whole tree and hand it over once.
- **Task nodes are owned by the Render thread**, so their fields rendezvous from the Task side and
  their observers fire on the Render thread — unless the observed node is Task-owned.
