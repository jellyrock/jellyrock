# Architecture Decision Records

Numbered, dated, **immutable** records of architectural / hard-to-reverse /
cross-component decisions. ADRs are **superseded, not edited** — a later
decision that changes an earlier one is written as a new ADR that references
(and flips the status of) the one it supersedes. The old record stays as the
historical account of what was believed, and why, when it was made.

Sub-architectural decisions — narrow, single-component, or implementation-level
choices that still have a non-obvious *why* worth keeping — live as lightweight
notes in [`../decisions.md`](../decisions.md), not here.

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](0001-triage-opus-inline-investigation.md) | Triage skills run Opus inline with a sibling INVESTIGATION contract | Accepted | 2026-05-06 |
| [0002](0002-four-pillar-journal-reshape.md) | Adopt the four-pillar journal system | Accepted | 2026-05-06 |
| [0003](0003-icons-material-rounded-house-style.md) | Icon house style — Material Symbols Rounded, weight 500, `24px` | Accepted | 2026-05-09 |
| [0004](0004-icons-outlined-by-default.md) | Icons default to outlined (fill 0), with documented fill-1 exceptions | Accepted | 2026-05-09 |
| [0005](0005-jrplaceholder-themed-composition.md) | Placeholder cards as runtime themed SceneGraph composition | Accepted | 2026-05-09 |
| [0006](0006-per-issue-crash-enrichment.md) | Crash workflow split — per-issue enrichment, not bulk | Accepted | 2026-05-20 |
| [0007](0007-server-upgrade-anchor-strategy.md) | Server-upgrade join diffs committed spec fingerprints, never a live fetch | Accepted | 2026-05-29 |
| [0008](0008-server-upgrade-issue-filing.md) | Server-upgrade issue filing — version-independent dedup, script-owned template, all human-gated | Accepted | 2026-05-29 |
| [0009](0009-server-upgrade-proactive-ci.md) | Server-upgrade proactive-CI tracker — one announce-only digest issue | Accepted | 2026-05-30 |
| [0010](0010-server-upgrade-phase5-maturation.md) | Server-upgrade Phase 5 — coverage-symmetry check and graduation semantics | Accepted | 2026-05-30 |
| [0011](0011-server-upgrade-phase6.md) | Server-upgrade Phase 6 — per-version release-triage digest and endpoint-availability registry | Accepted | 2026-05-30 |
| [0012](0012-promise-native-interface-fetchres-exception.md) | Promise-native async interface over the existing task pool (Option A), retaining blocking `fetchRes` | Accepted | 2026-06-05 |
| [0013](0013-auto-abandon-promises-bsc-plugin.md) | Auto-abandon promises via a build-time BSC plugin | Superseded by 0021 | 2026-06-05 |
| [0014](0014-non-pool-http-stays-task-blocking.md) | Non-pool HTTP consumers stay blocking Tasks; no generic `roUrlTransfer`-to-promise wrapper | Accepted | 2026-06-06 |
| [0015](0015-server-upgrade-anchor-vs-resolved-decoupling.md) | Decouple the server-upgrade diff anchor from the review cursor | Accepted | 2026-06-07 |
| [0016](0016-global-signin-language.md) | Separate device-wide sign-in language setting, pre-login only | Accepted | 2026-06-07 |
| [0017](0017-rta-functional-tests-vitest.md) | RTA functional tests in Node/Vitest, not Rooibos | Accepted | 2026-06-08 |
| [0018](0018-deep-link-cast-contract.md) | Deep-link / cast contract + validate-before-navigate resolution | Accepted | 2026-06-20 |
| [0019](0019-jrscreen-lifecycle-bridge.md) | Keep the `JRScreen` lifecycle bridge, not raw `sgRouter` View overrides | Accepted | 2026-06-23 |
| [0020](0020-router-settle-primitive.md) | Replace an active player off `navigateTo`'s promise, not a `routerState` settle observer | Accepted | 2026-06-23 |
| [0021](0021-remove-jrgroup-promise-abandon-floor.md) | Remove the `JRGroup`/`JRScreen` promise-abandon floor | Accepted | 2026-07-04 |
