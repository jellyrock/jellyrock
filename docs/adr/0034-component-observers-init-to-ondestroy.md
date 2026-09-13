# ADR 0034: A component's own observers live from `init()` to `onDestroy()`; handlers gate, observers never toggle

**Status:** Accepted
**Date:** 2026-09-13

**related-files**: `scripts/bsc-plugins/field-observer-wiring.cjs`, `tests/scripts/unit/bsc-plugins/field-observer-wiring.test.js`, `tests/source/unit/platform/ObserverRegistry.spec.bs`, `components/testing/ObserverProbeHost.bs`, `components/testing/ObserverProbeSubject.bs`, `tests/rta/specs/playback-advance.spec.js`, `components/video/VideoPlayerView.bs`, `components/data/jellyfin/JellyfinUserSettings.bs`, `components/ui/poster/JRPoster.bs`, `components/keyboards/IntegerKeyboard.bs`, `components/CLAUDE.md`, `docs/architecture/playback.md`, `docs/architecture/settings.md`, `docs/architecture/build-and-tooling.md`

Every observer rule in this repo treated a registration as private to the component that made it.
It is not: on device, a component calling `m.top.unobserveField(f)` — or `m.top.unobserveFieldScoped(f)` —
removed the plain observer its **parent** held on `f`. `ObserverRegistry.spec.bs` records that, plus
a render-thread self-write running the component's own handler before the next statement, for one
narrow parent/child configuration on OS 15.3.4. **It is a record, not a model.** Its scoped rows
disagree with Roku's `ifSGNodeField` page, but `observeFieldScoped` is not understood beyond that one
configuration, and this decision is built so that nothing depends on it.

PR #898 followed the house rule of the time ("put an `unobserveField` immediately before
the `observeField`") to stop `VideoPlayerView` accumulating `state` registrations across reloads. On `m.top`
that removed `PlayerHostView`'s `state` observer — the one that advances the queue — so on `main` after
v2.28.0 every natural episode end left a stopped player mounted on a black screen, with the Next Episode
notification still holding focus. `playback-advance.spec.js` reproduces it red on `main`.

## Decision

For `m.top`, an observer with a handler is registered **only in `init()`** and removed **only in
`onDestroy()`**. When a handler must sometimes not act, it checks a flag — readiness, the component's own
write in progress, or a mode — instead of the observer being toggled. Both halves are build errors in
`field-observer-wiring`: `top-observer-outside-init` (placement, not reachability, so a helper called from
`init()` has to move into it) and `top-unobserve-outside-ondestroy` (any field argument, since the name does not
change who loses their observer). Both treat the plain and scoped forms identically, on purpose.
Message-port observers and the vendored trees are outside the population. Child nodes only the
component itself observes keep the two existing shapes — register-once or balanced toggle.

The introducing change flagged exactly 25 sites in four components, all converted: `VideoPlayerView`
(`m.isContentLoaded`, `m.isApplyingOwnSelection`, `m.hasPlaybackFailed`), `JellyfinUserSettings`
(`m.isAutoSyncEnabled`), `JRPoster` (`m.isResettingBadge`) and `IntegerKeyboard` (inlined). Registering
every settings field from `init()` on the shared `m.global.user.settings` node was measured rather than
assumed free: `SaveDefaults()` median 779 ms unobserved vs 781 ms observed, 58 handler runs per call.

Alternatives ruled out:

- **Delete #898's unobserve.** Restores the host observer and the duplicate `onState` dispatch #898
  measured on every reload.
- **Guard a late registration with a per-field "already observed" flag.** Correct for `state` alone, but it
  is lazily initialized state a linter cannot check, and it leaves the other sites that unobserve their own node in place.
- **Switch `PlayerHostView` to `observeFieldScoped`.** A scoped parent observer did survive the child
  unobserving its own field in the recorded configuration — but that would rest the fix on semantics seen in one
  test and not otherwise understood, create a single scoped site with no rule behind it (291 plain
  cross-node observers vs 4 scoped), and protect one parent while leaving the trap armed for every other.
- **Use `unobserveFieldScoped` on `m.top` instead.** In the recorded configuration it removed the parent's
  plain observer just the same.
- **Allow helpers reachable only from `init()`.** Needs a call graph with the helper-mediated blind spots
  the sibling plugins already document, to save moving two calls into `init()`.

If `ObserverRegistry.spec.bs` goes red on a firmware change, re-examine before touching the expectation.
The rule only depends on its first result — a child unobserving its own field removing the parent's plain
observer — and would stay correct (merely conservative) if that result ever stopped reproducing.
