# Decision notes (sub-ADR)

Lightweight notes for **sub-architectural** decisions — narrow, single-component,
or implementation-level choices that still carry a non-obvious *why* worth
keeping, but don't rise to an architectural / hard-to-reverse / cross-component
**Architecture Decision Record**. Those live as numbered, immutable ADRs in
[`docs/adr/`](adr/) — see [`docs/adr/README.md`](adr/README.md) for the index.

## When to add a note here

- **Has a non-obvious rationale** that wouldn't be apparent from the code alone.
- **Closes off alternatives** that someone else might reasonably re-propose.
- **Has a constraint or trade-off** worth re-evaluating later.

…but is **local in blast radius** (one component / file / tooling surface). If a
decision is architectural, hard-to-reverse, or cross-component, it's an **ADR**,
not a note. If every decision became an ADR, no decision would be architectural.

Don't add an entry for routine bug fixes, obvious choices, or time-bound state.

## Format

Each note is its own `H2` section: `## decision-id: <stable-kebab-slug>`, then
`**date**` / `**status**` (`accepted` | `superseded` | `withdrawn`), optional
`**supersedes**` / `**superseded-by**` / `**related-files**`, then 1-2 short
paragraphs. **Notes are append-only** — a superseded note gets a new note that
references it; the old one is never mutated.

## decision-id: signals-backlog-scope

**date**: 2026-05-08
**status**: accepted
**related-files**: docs/signals-backlog.md, scripts/catchup-state.js, scripts/lib/signals-fetch.cjs

`docs/signals-backlog.md` tracks external platform and upstream version signals (Jellyfin server, Roku OS) but explicitly excludes npm package dependencies. The exclusion holds because Renovate already tracks and proposes bumps for npm packages (`brighterscript`, `rooibos`, `roku-log` and the rest) — two systems tracking the same thing produces noise, not signal. The signal rows that were deleted (`brighterscript`, `rooibos`, `roku-log`) were manual-update-only and always stale; Renovate PRs surface the same information more reliably and sooner.

The auto-maintained design (aggregator fetches `latest_upstream` each `/catchup` run) required a second user-controlled field, `latest_acknowledged`, to separate "what's out there" from "what a human reviewed". A row is stale (banner-worthy) only when `latest_upstream != latest_acknowledged` and `status == watching` — this lets the aggregator update freely without triggering false-positive banners on rows the user already reviewed. The `--no-network` flag makes the aggregator testable offline. Considered: manual-only `last_checked` staleness (the prior approach — worked for Renovate-covered deps but failed for platform signals because no Renovate bot tracks Roku OS or Jellyfin server major bumps).

## decision-id: placeholder-logo-tint

**date**: 2026-05-15
**status**: accepted
**related-files**: components/ItemDetails.bs

`ItemDetails` surfaces placeholder PNGs in the logo slot (via `getPlaceholderImagePath`) when no server image resolves. Unlike real server images — which render in their native colors and should stay white-blend — placeholder glyphs at logo size compete visually with the nearby title text when left at full-white. `onLogoLoadStatusChanged` tints any logo whose URI starts with `pkg:/images/placeholders/` to `colorBackgroundSecondary`, making it recede like a watermark rather than dominate the composition.

Detection via `Left(uri, 24)` prefix was chosen over a `m.isPlaceholder` flag because the flag would need to be cleared and reset at each `setItemLogo` call site (8+ branches) and could fall out of sync if the logo URI is reassigned without going through `setItemLogo`. The prefix is an invariant of the asset layout — every placeholder PNG lives under `pkg:/images/placeholders/` by build-pipeline convention — so the check is always accurate without coordination. Constraint worth re-evaluating if the placeholder asset directory is ever reorganized.

## decision-id: multichannel-audio-fallback-codec

**date**: 2026-06-03
**status**: accepted
**related-files**: source/api/items.bs, source/utils/deviceCapabilities.bs

When `optimizeAudioCodecListForSource` would strip every codec from a video transcoding profile's `AudioCodec` list for a multichannel (>2ch) source, it leads the list with the user's `playbackPreferredMultichannelCodec` (default `eac3`) rather than falling back to stereo `aac` (PR #574's first approach, for issue #573). The empty-list condition only ever fires on a passthrough device playing surround content, so `aac` — a stereo-output codec the optimizer exists to strip — merely avoids the crash while abandoning the bitstream surround path the hardware was set up for; a surround codec preserves it. The same logic also rescues the `truehd,opus` mp4 shape, which the server otherwise resolves to `opus` (an on-device-decode path, not bitstream surround).

The fallback is clamped to `{eac3, ac3}`. `dts` is excluded even though the setting offers it: the Jellyfin server emits no audio stream for a `dts` transcode target (its ffmpeg encoder is experimental — verified via `/Items/{id}/PlaybackInfo` probes against 10.11), so a `dts` fallback would itself re-trigger the empty-`AudioCodec` → `m3u8` server fallback that is issue #573. Both `eac3` and `ac3` are valid HLS audio targets in every video transcoding container (ts and mp4), so no per-container clamp is needed. Ruled out: the `aac` fallback (preserves no surround); honoring `dts` literally (unencodeable, re-triggers the bug).

## decision-id: rta-screenshot-store-website-split

**date**: 2026-06-10
**status**: accepted
**related-files**: tests/rta/screens.js, scripts/capture-screenshots.js, scripts/screenshots-store.js, docs/screenshots/screenshots.json, docs/dev/rta-tests.md

The RTA screen registry originally conflated "captured" with "ships in the Roku store" — every `capture.eligible` screen landed in `docs/screenshots/<locale>/` and `screenshots-store.js` bundled whole locale folders. The Roku store caps a listing at **6 screenshots** (we have exactly 6), but we want to grow the captured set well past 6 for a website screenshot *gallery* (a UX preview users can browse/share) plus functional-test regression coverage — which would silently push the store bundle past its cap. Split the one flag into two: `capture.eligible` (captured at all — written to `docs/screenshots/<locale>/` for the website gallery + dumped by `RTA_CAPTURE`) and `capture.store` (additionally part of the frozen Roku-store / homepage 6). `screenshots.json` now emits `screens` (the full gallery superset, in registry order) and `storeScreens` (the curated 6); `screenshots-store.js` copies only store-flagged screens, so `out/store/` stays at 6 regardless of how many gallery screens are added. The website renders the full `screens` set on its gallery page and the ordered `storeScreens` on the homepage.

Ruled out: keeping one flat `eligible` set and curating the store bundle by hand (or by locale only) — that re-introduces the silent-overflow risk every time a screen is added. Adding a 7th store screen is now a deliberate Developer-Portal decision (flip `store: true` on one screen), not a code default. Extends `rta-functional-tests-vitest`; landed alongside the first website-gallery-only screens (Server Select, Settings), with more gallery screens (library views, the grid options dialog, per-item-type detail screens) following on the same branch. This supersedes the earlier intent (the #642 progress followup) to make capture-the-default turn *every* covered screen into a store image — the split deliberately decouples gallery breadth from the frozen store 6.

## Migrated to ADRs

These decisions were promoted to numbered ADRs on the operating-model
convergence (audit-before-migrate). Old `decision-id` references resolve here:

| former decision-id | now |
|---|---|
| `triage-opus-inline-investigation` | [ADR 0001](adr/0001-triage-opus-inline-investigation.md) |
| `four-pillar-journal-reshape` | [ADR 0002](adr/0002-four-pillar-journal-reshape.md) |
| `icons-material-rounded-house-style` | [ADR 0003](adr/0003-icons-material-rounded-house-style.md) |
| `icons-outlined-by-default` | [ADR 0004](adr/0004-icons-outlined-by-default.md) |
| `jrplaceholder-themed-composition` | [ADR 0005](adr/0005-jrplaceholder-themed-composition.md) |
| `per-issue-crash-enrichment` | [ADR 0006](adr/0006-per-issue-crash-enrichment.md) |
| `server-upgrade-anchor-strategy` | [ADR 0007](adr/0007-server-upgrade-anchor-strategy.md) |
| `server-upgrade-issue-filing` | [ADR 0008](adr/0008-server-upgrade-issue-filing.md) |
| `server-upgrade-proactive-ci` | [ADR 0009](adr/0009-server-upgrade-proactive-ci.md) |
| `server-upgrade-phase5-maturation` | [ADR 0010](adr/0010-server-upgrade-phase5-maturation.md) |
| `server-upgrade-phase6` | [ADR 0011](adr/0011-server-upgrade-phase6.md) |
| `promise-native-interface-fetchres-exception` | [ADR 0012](adr/0012-promise-native-interface-fetchres-exception.md) |
| `auto-abandon-promises-bsc-plugin` | [ADR 0013](adr/0013-auto-abandon-promises-bsc-plugin.md) |
| `non-pool-http-stays-task-blocking` | [ADR 0014](adr/0014-non-pool-http-stays-task-blocking.md) |
| `server-upgrade-anchor-vs-resolved-decoupling` | [ADR 0015](adr/0015-server-upgrade-anchor-vs-resolved-decoupling.md) |
| `global-signin-language` | [ADR 0016](adr/0016-global-signin-language.md) |
| `rta-functional-tests-vitest` | [ADR 0017](adr/0017-rta-functional-tests-vitest.md) |
