# ADR 0019: Keep the `JRScreen` lifecycle bridge, not raw `sgRouter` View overrides

**Status:** Accepted
**Date:** 2026-06-23

**related-files**: components/JRScreen.bs, components/CLAUDE.md, docs/architecture/navigation.md

The #550 sgRouter migration **adapts** the router's view lifecycle to JellyRock's existing screen
contract rather than exposing it. sgRouter drives mounted views through `onViewOpen` /
`onViewResume` / `onViewSuspend` / `beforeViewClose` (+ `handleFocus`); `JRScreen.bs` overrides
those and bridges them to the `onScreenShown` / `onScreenHidden` / `onDestroy` virtuals every screen
already implements. Reconsidered during the #550 PR-hardening pass — should screens drop the
JellyRock names and override the router methods directly? — and **kept the adapter**. Four reasons:
(1) **semantic fan-in** — `onScreenShown` is fired by BOTH `onViewOpen` (first mount) AND
`onViewResume` (`keepAlive` return), one concept ("became visible") from two router events; without
the bridge each screen would duplicate that across two methods. (2) **Insulation from a pinned
pre-release dependency** (`@rokucommunity/sgrouter@0.1.3`) — overriding router method names in ~30
screens welds the app's screen contract to an unstable external API; the adapter localizes any
future rename to one file. (3) **Tooling contract** — the `auto-abandon-promises` BSC plugin and
`components/CLAUDE.md` key off `onDestroy` as the override/injection target. (4) **Zero-churn** — the
migration landed with no per-screen lifecycle rewrites precisely because of this adapter; unwinding
it is churn with negative DX value.

Ruled out: migrating every screen to the raw router methods (cross-screen churn, loses the fan-in,
couples to a pre-release API). One deliberate exception stands: `ItemDetails` overrides `onRouteUpdate`
directly (the router's in-place route-update hook) rather than through a bridged `JRScreen` method —
acceptable for a single consumer; a bridged hook would only be added if a second screen needed
in-place route updates.
