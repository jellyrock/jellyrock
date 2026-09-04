# ADR 0033: Doc-freshness pressure is contextual; there is no calendar backlog of stale docs

**Status:** Accepted
**Date:** 2026-09-04

**related-files**: `scripts/lint/check-touched-related-files.cjs`, `scripts/lint/docs-stale-blocking.cjs`, `scripts/lint/docs-stale.cjs`, `.github/workflows/docs-stale-tracker.yml`, `tests/scripts/unit/lint/check-touched-related-files.test.js`, `AGENTS.md`, `docs/architecture/build-and-tooling.md`, `docs/architecture/system-shape.md`

The agent-context system gave every architecture doc and dev guide a `last-reviewed` date, and
enforced it three ways: an end-of-turn reminder when a doc's `related-files` were touched, a 120-day
CI gate on the same overlap, and a weekly GitHub Action publishing a checklist of every doc past 90
days. The first two are **contextual** — they fire while the author is already in the doc's
territory. The third is **calendar-driven**: it asks for a cold re-read with no triggering work.

Four months of the weekly tracker (issue #766) produced **zero reviews**. Every one of the 15
`last-reviewed` bumps in repo history came from a feature PR via the contextual path. Auditing the
tracker's 12 stale entries found **one** real defect — `unit-tests-tdd.md` told contributors to create
tests in `tests/source/tests/unit/`, a directory that does not exist — for a precision of ~8%. The
metric was also decoupled from reality in both directions: `tech-debt.md` had been edited **71 times**
since its `last-reviewed` date, most recently the previous day, while the tracker reported it 93 days
stale; `code-style.md` showed 124 days stale with **zero** commits in its territory. The 2026-05-01
cluster of dates was the creation stamp for that frontmatter, never a review — `unit-tests-tdd.md` was
already broken when it was stamped.

The list could also never be cleared. Forty-three docs on a 90-day cycle requires one review every
two days, forever, before the issue closes — so the `docs:stale` label stayed permanently red and
stopped carrying information.

## Decision

Retire the calendar-driven backlog. `last-reviewed` is a record of the last *contextual* review, not
a countdown clock; `npm run docs:stale` reports the cadence on demand. The weekly workflow keeps only
the `docs/progress.md` journal cursor — a 7-day signal with a one-command fix that local hooks cannot
catch during stretches away from the repo.

The end-of-turn reminder now covers **`docs/dev/` as well as `docs/architecture/`**. Dev guides
previously had *no* PR-time coverage at all — both the reminder and the CI gate were architecture-only
— which is exactly where the one real defect lived, and the commit that introduced it
(`e448a18c`) touched two of that doc's three `related-files` while leaving the doc behind. The stated
objection to covering them was that shared `related-files` would double-prompt; only 63 of 118 dev
related-files overlap architecture, so 55 files gain coverage no other layer provides, and a duplicate
advisory line is cheaper than a missed one.

**The CI gate stays architecture-only.** A how-to that documents a moved path breaks its reader
immediately but changes no subsystem's shape, so it must never block a PR.

Replacing the date with a mechanical accuracy check was tested and rejected. Validating that every
path a doc cites exists yields 20 false positives to 1 real finding; falling back to "the parent
directory exists" yields 30 to 1. Both reproduce the false-positive problem already documented in
`docs-check.cjs` — recipes legitimately cite hypothetical files (`sdkV3.bs`), and `tech-debt.md`
`direction:` fields legitimately name files that do not exist yet.

## Consequences

Doc drift is caught when someone touches the territory, or not at all. That is the trade accepted
here: a doc nobody's code goes near can age indefinitely, which the evidence says costs nothing —
staleness and territory heat are inversely correlated, because hot territory triggers the contextual
prompt that keeps its docs fresh.

`related-files` must exclude pure **content data**. A file that changes on every routine edit without
indicating a shape change makes a doc look drifted whenever anyone does ordinary work. `en_US.json`
was removed from both translations docs for this reason: it accounted for 11 of 11 commits in
`translations.md`'s territory while the subsystem's machinery had zero, and would have detonated the
120-day gate on the next string-addition PR. Machinery files carry that signal instead.

The end-of-turn reminder gets louder — roughly 27% of recent commits (8 of 30) would print at least
one dev guide line. It is advisory and exits 0, and dev guide entries are labeled
`(dev guide — informational)` so a reader can tell which reminders can later become a blocked PR.
