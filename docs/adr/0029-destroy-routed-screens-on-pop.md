# ADR 0029: Routed screens suspend while covered and are destroyed on pop; never `keepAlive`

**Status:** Accepted
**Date:** 2026-08-14

**related-files**: `components/JRScene.bs`, `components/ItemGrid/BaseGridView.bs`, `components/search/SearchResults.bs`, `docs/architecture/navigation.md`, `tests/rta/specs/leaks.spec.js`

> Amends an aside in [ADR 0027](0027-screen-readiness-ledger.md), which describes the details
> route as `keepAlive`. Its argument (one ledger per mount, since each navigation is a fresh
> component) is unaffected — that follows from the absence of `allowReuse`, not from `keepAlive`.

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

### The user pays for a fresh load on re-entry, knowingly

Re-entering a screen the user fully backed out of is now a fresh mount, not a resumed
cache. The cost is narrower than "everything resets", because most of what feels like
screen state is registry-backed rather than view-backed:

| On re-entry | Before | After |
|---|---|---|
| Grid data | resumed from cache (re-fetched only if `contentVersion` bumped) | fresh fetch + spinner |
| Scroll position / focused tile | preserved | **lost** — a fresh mount focuses tile 0 |
| View mode, sort, filter | preserved | preserved — persisted via `getLibraryDisplaySetting`, not held on the view |
| Search query + results | preserved | **lost** |

Both losses are accepted: a fresh load per entry is the intended shape, and `/search` was
called out explicitly as a route that must not cache. **The re-entry latency this adds was
not measured** — the demo fixture cannot produce a large library, and the one incidental
data point (`items 11 … task 274 wait 232 emit 26`, i.e. 274 ms for 11 items) says nothing
about one with thousands. If re-entry cost is ever reported as a complaint, that is the
measurement to take, not a reason to reach back for `keepAlive`.

### Every routed screen's `onDestroy` becomes load-bearing

A popped screen is destroyed, so teardown that previously never ran now runs on every
back-out — and must fully release. Removing the cache exposed a second, previously-masked
defect: `BaseGridView` held a retain cycle (`view → m.data → GridItem scope → m.gridView →
view`) that the cache had hidden by reusing one grid instance forever.

The same cell shape recurs wherever an `ArrayGrid` cell caches its content root, and the
three routed screens land differently on it. `ItemDetails` was already safe: it cascades
`m.extrasGrid.callFunc("onDestroy")` into `ExtrasRowList.onDestroy`, which is why it
released cleanly even before the grid fix. `SearchResults` was not — its `SearchRow` cells
are `BrowseRowItem` (a `JRRowItem`, which caches `m.contentRoot` and never calls
`unobserveField` on it) with no cascade and no content drop — so it takes the same explicit
release `BaseGridView` does. Both clear content *after* dropping their observers: emptying
an `ArrayGrid` can move `itemFocused`, and the focus handlers read `.content` with no
validity guard.

Because a leak of this class moves no timing and fails no functional test, correctness is
held by a census gate ([`tests/rta/specs/leaks.spec.js`](../../tests/rta/specs/leaks.spec.js))
asserting zero retained views after a back-out, rather than by review.

### Measured

A walk of Home → library → back → library → six distinct details → Home went from **1,936
unparented roots to 458**, against a 519-root cold-Home baseline, with growth across the six
round trips going from monotonic (946 → 1,884) to flat. `getRootsCount` counts nodes with no
parent — those held only by a BrightScript reference — so this is a census of *retained*
nodes, not of every live node; and cold Home versus returned-to Home are different app
states, so the flatness is the result, not the sub-baseline absolute.

Per-type roots were dumped before the fix (`BaseGridView 1`, `JRRowItem 8`, plus fixtures)
but not after, so the aggregate `totalNodes` is what carries the post-fix claim. The gate closes that
gap differently: it compares `totalNodes` between a one-screen and a six-screen walk, so
anything retained per visit shows as their difference regardless of node type.
