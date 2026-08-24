# ADR 0031: A production Task-thread ceiling that refuses, backed by a pre-ship peak gate

**Status:** Accepted
**Date:** 2026-08-23

**related-files**: `source/utils/tasks.bs`, `tests/source/unit/utils/tasks.spec.bs`, `tests/rta/specs/task-thread-peak.spec.js`, `tests/rta/specs/gaa-thread-scope.spec.js`, `components/testing/TaskLedgerBench.bs`, `docs/architecture/threading.md`, `docs/architecture/global-state.md`

Roku caps an app at 100 concurrent threads and raises `&h29` past it — epic #728. The two
mechanisms that scaled with server data were removed, and `no-raw-run` / `no-task-fanout`
make an unbounded launch a compile error, so the crash is gone. But the charter's last
criterion asked for a **guarantee**, and nothing in a production build counted or refused:
`countLiveTaskThreads()` was called from a single `print` inside `#if debug`. What bounds the
app today is that the offending shapes are absent, which is empirical rather than structural.

The compile-time rules also have documented blind spots — interprocedural fan-out (a loop
calling a helper that launches internally), `components/vendor/**`, and several screens whose
individually-bounded launches sum. Nothing observes the aggregate.

## Decision

`launchTask()` records every launch into `m.global.taskLedger` in **all** builds, and
**refuses** — returning `false`, the contract an invalid node already had — above
`TASK_THREAD_WATERMARK = 50` live threads. The count stays **derived** from each node's
`state` rather than tracked by a counter, which is what avoids an `observeField("state")` per
launch (the unpaired-observer leak shape PR #765 removed).

The **primary** defense against a future fan-out is not this ceiling but
`tests/rta/specs/task-thread-peak.spec.js`, which samples the live count across a scripted
journey and fails above 30. A pre-ship gate names the culprit and gets it fixed; a runtime
ceiling can only degrade silently, because `roku-log` is stripped and `#if debug` excluded in
a store build, so a refusal has no production channel to report on. The ceiling is the
backstop for what the gate's coverage and the compile rules cannot see.

⚠️ **"Primary" describes its authority, not its frequency — the gate fires at RELEASE PREP,
not per-PR.** `rta-functional-tests.yml` triggers only on `push: release-*.*.*` and
`workflow_dispatch`, because there is one physical device shared with the Rooibos suite and
with manual work, and a full pass is ~10–15 minutes of exclusive time; the workflow states
that the trigger surface is deliberately narrow. So a fan-out regression is caught
**already-merged**, possibly stacked behind other PRs, where bisecting costs more. That is a
real weakness of this decision and it is accepted rather than solved here: moving the gate
earlier (per-PR, merge queue, or nightly on `main`) contends for the same single device, so
it is a scheduling trade rather than a free win. Open as a followup in `docs/progress.md`.
The local `npm run test:rta` before opening a PR is, until then, the only feedback a change
gets.

Three measurements decided the shape, all on a Stick 4K render thread:

- **`m.global` is RENDER-owned**, not main-owned as `cellLoad.bs` claimed: a field read costs
  **2.0 µs** from the render thread against **93 µs** from a Task thread (~46×).
- **Thread placement is not the whole story.** Moving a per-entry walk to the render thread
  took it from 132.6 to **20.1 µs/entry** — 6.6×, not the 46× the read costs predict. The
  residue is BrightScript interpreter work no placement removes.
- **`GetGlobalAA()` is ~500× cheaper and cannot be used.** It is scoped per **component**, not
  per thread: launching and counting inside one component reads 1, while two components on the
  *same render thread* read each other as 0. A per-component ledger counts only its own
  component's launches, which is not a thread budget.

A node field is therefore the only cross-component storage SceneGraph offers, and reading one
returns a **copy** — `m.global.taskLedger.push(x)` measured a plausible 58 µs and left the
field unchanged after 200 pushes — so the read-modify-write is unavoidable.

Ruled out: a **dev-only ledger**, which bounds today's code but says nothing about a screen
added later; a **deliberate crash** at the watermark, which converts near-misses into crashes
with no live crash left to diagnose; and an **append-only ledger**, free but incorrect, since
`pruneTaskLedger` is what de-duplicates a relaunched node and `ExtrasRowList` relaunches its
nodes many times — one live thread would otherwise count many times over.

## Consequences

**Measured on the screen rather than computed** (Stick 4K, `.177`):

| path | launches | total | per launch |
|---|---:|---:|---:|
| cold start → Home ready | 12 | **11.56 ms** | **963.6 µs** |
| `ItemDetails` open (incl. extras rows) | 8 | **2.86 ms** | 357 µs |

**The most expensive launches in the app are the seven that happen before the user sees
anything.** `setGlobalNodes()`'s five and `main.bs`'s two run on the MAIN thread, and
`m.global` is render-owned — so they pay the rendezvous that render-thread launches do not,
at ~2.7× the per-launch cost. Cold start is where this change is felt, not navigation.

An earlier figure of 21 ms for `ItemDetails` was wrong twice over: "38 launches" counted
`launchTask()` *call sites* rather than runtime launches, and 555.7 µs was the bench at
ledger depth 10 while the app runs at depth ~5–6. Both errors inflated the same number, which
is why the screen is measured directly (`tests/rta/specs/task-ledger-screen-cost.spec.js`,
behind `RTA_BENCH=1`) instead of multiplying a bench figure by a count.

The watermark is ~4.5× the measured real-world peak of **9–11** (4-library and 13-library
servers both), so it cannot fire in normal use — only when something is fanning out. Peak
barely moves with library count, which is `no-task-fanout` working as intended.

**Why 50 and not something tighter like 30** — asked in review, and the honest answer is that
50 was anchored on Roku's own console warning and justified as "4.5× peak" afterwards; 30 was
never evaluated. Having evaluated it: keep 50, on an argument stronger than the multiple. The
three numbers are deliberately ordered

```text
RTA gate 30  <  watermark 50  <  Roku's cap 100
```

and the separation is the design. The **gate** fires in testing, where it can name the
culprit; the **ceiling** only ever fires in production, where nothing can report. Tightening
the watermark toward the gate collapses them onto one number, so a fixture slightly heavier
than the test journey would begin refusing in production at the very count the gate calls a
regression. What tightening buys is narrow by comparison: it helps only against a slow creep
that *plateaus* between 30 and 50, which against a measured peak of 11 is already pathological
and would trip the gate first — while a genuine runaway blows through both regardless.

`tasks.spec.bs` asserts `watermark + untracked threads < 100` so a future edit to either
constant cannot quietly break the bound; a comment would not fail, and raising the watermark
to 95 leaves everything green while the app still dies at 100.

Per-launch cost grows with ledger depth, so it is highest near the watermark — accepted,
because that only happens in the state the ceiling exists to stop, and refusal caps it there.

**The ledger now retains Task node references in a shipping build, and that is bounded rather
than measured.** Raised in review; the mechanism is what closes it, so no memory measurement was
taken. `pruneTaskLedger` drops every non-live entry on **every** launch, so steady-state
retention is *live threads + whatever finished since the previous launch* — around 11 references
at the measured peak. The unbounded window is only "after the final launch", where that set stays
resident through a quiet period such as playback.

Most entries cost nothing extra, because the owning component holds the same node anyway
(`m.LoadPeopleTask` and friends; `replayRoute.performServerSwitch` assigns
`m.serverReachableTask` before it launches). Exactly **two** call sites launch a node held by
nothing else, both main-thread bootstrap:

- `main.bs:285` `fontDownloadTask` — a local, and `handleFontDownloadCompletion` explicitly
  releases it (`unobserveField`, then `= invalid`). The ledger now outlives that release.
- `main.bs:375` `fontTask` — a local that is unobserved, stopped, and falls out of scope.

The consequence is **memory only**. Both nodes are terminated (`state = "stop"`) by the time
they linger, so a retained one cannot fire an observer again, and both unobserve themselves
regardless. Two inert nodes held until the next launch is the whole cost.

This is not left to prose alone: the two properties it rests on — that pruning keeps live
entries *only*, and that `count()` therefore equals the live count — are both asserted in
`tasks.spec.bs`. If someone makes pruning retain a finished node, those go red before the
retention bound silently widens.

**A refusal leaves a durable trace under `#if perfTiming`** (`taskLedgerRefusals`,
`taskLedgerFirstRefused` on `m.global`), which ships true in the dev manifest and is in
`harden-prod-manifest.js`'s `FORCED_OFF` list. The `#if debug` print alone was not enough: the
manifest ships `debug=false`, so noticing a refusal in a normal dev sideload would have required
a const flip and a rebuild — after the state that caused it was gone. `FirstRefused` keeps the
node that *tipped the app over*, since later refusals are its consequence.

If a future Roku OS ever made `GetGlobalAA()` thread-scoped, the ledger could move there and
get ~500× cheaper; `gaa-thread-scope.spec.js` is kept as the regression gate that would notice.
