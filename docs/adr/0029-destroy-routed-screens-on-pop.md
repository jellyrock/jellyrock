# ADR 0029: Routed screens suspend while covered and are destroyed on pop; never `keepAlive`

**Status:** Accepted
**Date:** 2026-08-14

**related-files**: `components/JRScene.bs`, `components/ItemGrid/BaseGridView.bs`, `docs/architecture/navigation.md`, `tests/rta/specs/leaks.spec.js`

sgRouter exposes two route knobs that look interchangeable and are not. `suspendMode`
governs how a view is held while it is **covered** by a view pushed on top. `keepAlive`
governs whether a view survives being **popped** — upstream documents it as *"retained for
later resumption"*, i.e. a session-lifetime, path-keyed view **cache**. The names invite
reading `keepAlive` as "don't destroy while covered", which is what `/details`, `/library`
and `/search` were configured for, and the two only diverge on the pop path — so the
mistake is invisible in review, in the build, and in the functional suite.

## Decision

Routed screens carry `suspendMode: "detach"` and **never** `keepAlive`. Covered →
suspended out of the tree and re-attached on `goBack`; popped → closed, running
`beforeViewClose` → `onScreenHidden` + `onDestroy`. Every outgoing view is suspended
regardless of any flag and `_goBack` resumes it through `_onViewResume` either way, so back
navigation is unchanged — `detail → /play → back` still restores the launching detail,
which is covered rather than popped.

The cache is not merely redundant, it is unbounded: the only eviction helper
(`sgrouter_collectDetachedViewsToDestroy`) skips `keepAlive` views by design, so nothing
short of `sgrouter.destroy()` at sign-out releases them. Keyed by `route.path`, that meant
one retained `BaseGridView` per library and one `ItemDetails` per item, for the session. A
retained view is not inert: `onScreenHidden` runs on suspend but `onDestroy` does not, and
`onDestroy` is where teardown lives — tasks stopped, observers dropped, textures freed,
promises abandoned, and for `SearchResults` the firmware's global voice route released.

## Consequences

A popped screen is destroyed, so **every routed screen's `onDestroy` is now load-bearing**
and must fully release. Removing the cache exposed a second, previously-masked defect:
`BaseGridView` held a retain cycle (`view → m.data → GridItem scope → m.gridView → view`)
that the cache had hidden by reusing one grid instance forever. Because a leak of this
class moves no timing and fails no functional test, correctness is held by a census gate
([`tests/rta/specs/leaks.spec.js`](../../tests/rta/specs/leaks.spec.js)) asserting zero
retained views after a back-out, rather than by review.

Measured on device: a walk of Home → library → back → library → six distinct details →
Home went from **1,936 live nodes to 458**, against a 519-node cold-Home baseline.
