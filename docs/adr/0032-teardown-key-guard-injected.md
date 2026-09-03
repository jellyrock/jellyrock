# ADR 0032: Key events after teardown are guarded by transpile-time injection, not per-screen discipline

**Status:** Accepted
**Date:** 2026-09-02

**related-files**: `scripts/bsc-plugins/auto-destroyed-guard.cjs`, `scripts/bsc-plugins/unobserve-before-release.cjs`, `tests/scripts/unit/bsc-plugins/auto-destroyed-guard.test.js`, `tests/scripts/unit/bsc-plugins/unobserve-before-release.test.js`, `bsconfig.json`, `bsconfig-prod.json`, `bsconfig-analysis.json`, `components/CLAUDE.md`, `docs/architecture/build-and-tooling.md`, `docs/architecture/tech-debt.md`

`sgrouter_closeView` runs a view's `_beforeViewClose` hook — which reaches `JRScreen.beforeViewClose`
-> `onScreenHidden()` + `onDestroy()` — and removes the node only once the returned promise resolves.
Resolution goes through the promise's observed `promiseState` field, so the removal lands on a **later
message-loop turn**, and the router deliberately leaves the view visible in the meantime. For that turn
the screen is still mounted and still in the focus chain while every node reference it owns is already
`invalid`. The next key press dots into `invalid` and throws `&hec`.

A v2.27.0 crash report (#881) made it concrete: `settings.onKeyEvent`, `key = "left"`, at
`components/settings/settings.bs:894` — `if (key = "back" or key = "left") and
isValid(m.settingsMenu.focusedChild) and …`. `isValid()` guards the **field** the dot produces, not the
**receiver** being dotted, so it never protected `m.settingsMenu` at all. This was the third instance of
the class: #733 guarded `VideoPlayerView.onPositionChanged` the same way and the tech-debt entry it left
behind predicted the next one.

Auditing every component that clears references in `onDestroy` showed the shape is not a straggler but the
default: **all 10 routed screens declaring an `onKeyEvent` read a field their own `onDestroy` nulls**,
between 1 and 38 unguarded sites each. Settings was not unlucky; it was simply the first to be handed a
`left` press inside the window.

## Decision

A BrighterScript plugin injects the guard at transpile time into every component codebehind that declares
both `onDestroy` and `onKeyEvent`:

| Site | Injected |
|---|---|
| `init()` | `m.isDestroyed = false` |
| `onDestroy()` | `m.isDestroyed = true` |
| `onKeyEvent()` | `if m.isDestroyed = true then return false` |

Each site is independently idempotent, so a file that already manages the flag by hand keeps its own code
and receives only what it is missing — `VideoPlayerView` supplies both halves itself and gains just the
`onKeyEvent` guard #733 omitted.

**A base-class fix is not available.** SceneGraph `onDestroy` and `onKeyEvent` do not chain to a parent
component — there is no `super` — which is the same constraint that made `auto-abandon-promises.cjs` an
injecting plugin rather than a line in `JRScreen`. Injection is the only mechanism that reaches every
component without per-file discipline.

**`= true`, not a bare truthiness test.** Roku treats `invalid` as neither true nor false — "An `invalid`
value is not considered false", BrightScript reference — so `if m.isDestroyed then` *throws* when the flag
was never initialized, converting a rare teardown race into a crash on every key press. The `init()`
injection makes that unreachable and the comparison form is the second layer; a component with both hooks
and no `init()` to initialize the flag in is a build **error**.

Two alternatives were ruled out. **Hand-editing each screen** is what produced a third instance: it leaves
screen #11 to remember, and the audit shows the shape is universal rather than exceptional. **Dropping
focus before `onDestroy`** would be a single edit in `JRScreen`, but the router focuses the incoming view
only after `closeView` resolves, so the fix would race the router's own focus handoff, and it would not
cover components the router does not mount.

The guard is deliberately **not** extended to observer callbacks. Returning `false` from a destroyed
screen's `onKeyEvent` is unambiguously correct — the key belongs to whatever the router focuses next. An
early return in an observer callback is not: some legitimately run during teardown (stop-reporting,
dialog cleanup), so a blanket injection would silently change behavior. The observer half is also far
smaller than a read count suggests: its real property is cross-reference ordering inside `onDestroy`
(is a reference released while a handler that dereferences it is still attached?), which found **three** live
sites, all fixed by reordering rather than guarding.

That half is closed by a **diagnostic** rather than an injection:
[`unobserve-before-release`](../../scripts/bsc-plugins/unobserve-before-release.cjs) reports an unobserve that
runs after a release its handler dereferences, and the fix it asks for is to move the unobserve up. Reordering
suppresses nothing, which is the property an early return cannot offer here. It is **severity 2**, matching
`observe-without-on-destroy`: the house split is that structural-absence rules error while inference-heavy ones
warn, and this one infers a handler binding through an alias graph.

Precision came from three refinements, measured rather than argued — the naive "any unobserve after any release"
rule reports 62 hits, effectively all noise. Binding handlers by **(target, field)** rather than field name alone,
counting only **receiver-position** uses, and exempting a handler that `isValid`-checks the reference itself take
it to **exactly the three known-real sites on the tree as it stood before those fixes, and zero on the
fixed one**.

## Consequences

Twenty component codebehinds gain the guard at build time. Diffing a build with the plugin against one
without it shows only the three injected forms added and **zero lines removed**, and the on-device RTA
navigation suite passes unchanged, so the guard does not fire spuriously on a live screen.

The behavior is invisible in source — the same tradeoff `roku-log` and `auto-abandon-promises` already
make. A reader of `onKeyEvent` will not see the guard, so `components/CLAUDE.md` and
`build-and-tooling.md` carry the pointer, and `' bsc-disable-file auto-destroyed-guard` is the opt-out.

The rule keys on a top-level `onDestroy`. A component that tears down under some other method name gets
no guard; `onDestroy` is the project-wide convention and both existing teardown plugins already assume it.

The observer diagnostic's gaps all fall toward **false negatives** — detachment reached through a helper
(`ExtrasRowList.onDestroy` delegates to `cancelInFlightChain()`), a handler named by a non-literal, an `isValid`
on any path clearing the reference. That is the safe direction for a rule whose whole value is that a hit means
something; a warning that cried wolf would be turned off.
