# ADR 0037: A Task run that can restart gets a new node, and its handler ignores events from nodes it replaced

**Status:** Accepted
**Date:** 2026-09-18

**related-files**: `source/utils/tasks.bs`, `tests/source/unit/utils/tasks.spec.bs`, `scripts/bsc-plugins/no-same-node-relaunch.cjs`, `components/search/SearchResults.bs`, `components/ItemDetails.bs`, `components/home/FavoritesRows.bs`, `components/music/AudioPlayerView.bs`, `tests/source/unit/platform/TaskRelaunch.spec.bs`, `tests/source/unit/platform/TaskRelaunchBlockModes.spec.bs`

Stopping a running Task and relaunching the same node in one callback does not reliably start
it: the launch is dropped and the work silently never happens. Measured 2026-09-17 on two Streaming
Stick 4K units (OS 15.3.4), the run was lost in 0–10 of every 10 trials, varying with suite context
and unit, and the stopped run was never carried to completion against the new input
([threading.md](../architecture/threading.md#measured-findings)). A new node always starts.
Replacing the node creates a second hazard: Roku documents `unobserveField` only as removing the
connection, so an event already queued by the old node can still reach the handler after the
field points at the replacement — and a handler that reads the field then reads the new run's
empty output and unobserves it, losing the real delivery.

## Decision

Every run that can restart mid-flight is created with
`m.task = replaceTask(m.task, type, observedField, inputs)`, and its handler takes the event and
checks `isCurrentTaskEvent(event, m.task)` as its first statement — before any
`screenLoad.resolve` or spinner stop. The `no-same-node-relaunch` build rule treats
`releaseTask` / `replaceTask` as stopping their first argument, so dropping the result and
relaunching stays a build error; the gate's own design is the
[`same-node-relaunch-gate`](../decisions.md#decision-id-same-node-relaunch-gate) note. Sites are
migrated even when the failure cannot be reproduced there: `SearchResults` passed 18 device
runs, and at the measured loss rates that pass is unexplained, not safe. The rate itself is a
`measurement`-tagged suite that `test:unit` / `test:all` skip, because it is slow and cannot
fail on the number it prints; the properties the design depends on — a new node starts, a
stopped run makes no progress, including one parked in a single long `wait()` — stay gated in
`TaskRelaunch.spec.bs`.

## Ruled out

- **An `isValid(m.task)` guard** — it fires only at teardown; on a supersede the field already
  holds the new node.
- **Keeping the same node and relying on the stop** — the race loses the run.
- **Per-component helper copies** — three identical copies existed and would drift, and the
  build rule could not see a stop inside them.
- **Running the rate sweep in CI** — ~152 s of a 222 s device run, asserting nothing it
  measured.
- **Swapping the node in place at the four remaining sites** — `BaseGridView`, `schedule` and
  `HomeRows` read state back off the node, and `VideoPlayerView.captionTask` is a live playback
  bridge; each needs its own design (tracked in [`docs/progress.md`](../progress.md)). All four
  have since landed. Captions were the last, and took the shape this bullet anticipated rather
  than a node swap: the fetch was split into `LoadCaptionTask` (a new node per subtitle change)
  and the bridge stayed put as the long-lived `CaptionRenderer`, which owns the fetch node — so
  `VideoPlayerView` no longer launches a Task for captions at all.
