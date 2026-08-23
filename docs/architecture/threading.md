---
topic: threading
related-files:
  - source/main.bs
  - components/JRScene.bs
  - source/utils/tasks.bs
last-reviewed: 2026-08-23
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
| **SceneGraph Render** | "the main SceneGraph thread that performs all rendering… Certain BrightScript operations and components that might block or modify the SceneGraph in the Render thread cannot be used in this thread" | every component's `init()`, field observers, `onKeyEvent`, `callFunc` targets |
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
| `CreateObject("roSGNode", "Timer")` | Main, **before** `m.screen.show()` | **Fails** — returns `Invalid`. This is why the log manager can't be stood up in `main.bs`; see [logging.md](logging.md) | Streaming Stick 4K, Roku OS 15.2.4 |
| Nested `wait(0, port)` message-port loop | Render | **Hard-deadlocks the app.** The basis for the per-instance `result` field in the dialog system rather than a synchronous return; see [navigation.md](navigation.md#the-standard-dialog-system-sourceutilsdialogsbs) | Evidence on #287 |
| Field read on a node the READING thread owns | any | **1.7 µs** (Stick 4K) / **1.1 µs** (Ultra) | Stick 4K + Ultra, Roku OS 15.3.4, 2026-08-23 |
| Field read on a render-owned **Task node**, from a Task thread | Task | **91–118 µs** / **69 µs** — a rendezvous | same |
| The same Task-node read, from the **Render** thread | Render | **7.1 µs** / **4.5 µs** — no rendezvous | same |
| `m.global` field read, from a Task thread | Task | **93 µs** / **62 µs** — `m.global` is render-owned, so this rendezvouses | same |
| `m.global` field read, from the **Render** thread | Render | **2.0 µs** / **1.3 µs** — indistinguishable from a local node | same |

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
component, whose `callFunc` runs on the render thread; mirrored function-for-function against
`tests/source/unit/utils/taskLedgerCost.spec.bs`, which does not. Render-thread execution is proven
from the data rather than from the architecture — a Task node is documented render-owned, so a cheap
read of one is only possible on the render thread.

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
