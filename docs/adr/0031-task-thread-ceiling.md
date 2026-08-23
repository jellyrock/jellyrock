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

**The real cost is 2.6 ms on an `ItemDetails` open** — 7–8 launches at 320–367 µs each, measured
on the screen rather than computed. An earlier figure of 21 ms was wrong twice over: "38
launches" counted `launchTask()` *call sites* rather than runtime launches, and 555.7 µs was
the bench at ledger depth 10 while the app runs at depth ~5–6.

The watermark is ~4.5× the measured real-world peak of **9–11** (4-library and 13-library
servers both), so it cannot fire in normal use — only when something is fanning out. Peak
barely moves with library count, which is `no-task-fanout` working as intended.

`tasks.spec.bs` asserts `watermark + untracked threads < 100` so a future edit to either
constant cannot quietly break the bound; a comment would not fail, and raising the watermark
to 95 leaves everything green while the app still dies at 100.

Per-launch cost grows with ledger depth, so it is highest near the watermark — accepted,
because that only happens in the state the ceiling exists to stop, and refusal caps it there.

If a future Roku OS ever made `GetGlobalAA()` thread-scoped, the ledger could move there and
get ~500× cheaper; `gaa-thread-scope.spec.js` is kept as the regression gate that would notice.
