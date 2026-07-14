---
last-updated: 2026-07-13
---

# Signals backlog

External version-watching journal. Tracks upstreams JellyRock depends on or cares about; when an upstream moves, the `action_when_moves` field tells us what to do.

Distinct from [tech-debt.md](architecture/tech-debt.md) (internal debt), [`docs/adr/`](adr/README.md) (architectural decisions), and [decisions.md](decisions.md) (sub-ADR notes). Three rows, all auto-maintained by the [`/catchup` aggregator](../scripts/catchup-state.js): `latest_upstream` and `last_checked` are fetched + written back on each `/catchup`. The `current` field stays as static prose describing JellyRock's posture toward the upstream (e.g. "minimum supported is X.Y") — it does NOT track upstream movement. The `latest_acknowledged` field is the close-loop counterpart to `latest_upstream`: bump it via `/done <slug>` when you've reviewed the new upstream version. A row goes "stale" (banner-worthy) when `latest_upstream != latest_acknowledged` AND status is `watching` — i.e., upstream moved past the last version you acknowledged. Use `/log signal <slug>` only to add new rows; existing rows update themselves.

npm dependencies (`brighterscript`, `rooibos-roku`, `roku-log`) are NOT tracked here — Renovate covers those, and the journal would just duplicate the dep-bump PR's signal.

## Schema

Each row is an `H3` block:

```markdown
### <slug>: <one-line label>

- **watching**: <what we're watching upstream>
- **current**: <static prose describing JellyRock's posture toward this upstream>
- **latest_upstream**: <fresh upstream version, auto-fetched>
- **latest_acknowledged**: <last upstream version reviewed via /done; seed = latest_upstream at row creation>
- **last_checked**: YYYY-MM-DD
- **action_when_moves**: <what triggers a JellyRock change>
- **status**: watching | action_pending | completed
```

Schema is enforced by `npm run lint:docs` (`signals-schema-invalid` category). A row is "stale" — and surfaces as a banner in `/catchup` — when `latest_upstream != latest_acknowledged` AND `status == watching`. Run `/done <slug>` to acknowledge the new upstream (sets `latest_acknowledged = latest_upstream`).

**Exception — `jellyfin-server-stable`:** its staleness is **not** the version-string compare. The [server-upgrade tracker](../.github/workflows/server-upgrade-tracker.yml) auto-closes the per-release digest for a mechanically-clean release **without** bumping `latest_acknowledged` (CI never writes the journals), so the string compare would false-fire forever after every clean release. For this row `/catchup` treats it as stale only when an **open** `server-upgrade:tracker` digest exists (a candidate-bearing release that needs `/server-upgrade` triage); clean releases close their own digest and never nag. `latest_acknowledged` here is the **diff anchor / last deep review** and advances only on a real `/server-upgrade` triage — it intentionally trails the newest clean release. See [server-upgrade-automation.md](architecture/server-upgrade-automation.md#decisions).

## Watching

### jellyfin-server-stable: Jellyfin server stable channel

- **watching**: latest stable release on api.jellyfin.org/openapi/stable/
- **current**: 10.7.0 minimum supported; latest tested per [user/jellyfin-server-feature-matrix.md](user/jellyfin-server-feature-matrix.md)
- **latest_upstream**: 10.11.11
- **latest_acknowledged**: 10.11.8
- **last_checked**: 2026-06-07
- **action_when_moves**: run [`/server-upgrade`](../.claude/skills/server-upgrade/SKILL.md) to triage the release (mechanical report → agent investigation → human-gated issue filing); the proactive tracker issue maintained by [.github/workflows/server-upgrade-tracker.yml](../.github/workflows/server-upgrade-tracker.yml) nudges this with candidate counts. If a new minor introduces a breaking endpoint shape, the triage adds a v3 dispatcher per [dev/jellyfin-server-versioning.md](dev/jellyfin-server-versioning.md)'s "Adding Support for New Server Versions" section
- **status**: watching

### jellyfin-server-rc: Jellyfin server release candidate channel

- **watching**: pre-release builds on api.jellyfin.org/openapi/stable/ whose base version is greater than the latest stable (sparse — only present while a new release is in flight)
- **current**: n/a (we don't pre-test against RCs by default)
- **latest_upstream**: (no RC in flight)
- **latest_acknowledged**: (no RC in flight)
- **last_checked**: 2026-06-07
- **action_when_moves**: spin up the RC against a test library; file findings as GitHub issues if breakage is detected before the stable release
- **status**: watching

### roku-os: Roku OS firmware

- **watching**: rokudev/dev-doc release notes — the first `## Roku OS X.Y` heading wins (file order is newest-first)
- **current**: not pinned in source; we run on whatever Roku OS the device ships — review when the latest jumps a major
- **latest_upstream**: 15.2
- **latest_acknowledged**: 15.2
- **last_checked**: 2026-06-07
- **action_when_moves**: review video pipeline + scene graph capability changes; update [architecture/playback.md](architecture/playback.md) if a codec / DRM / OSD change affects JellyRock
- **status**: watching

### sgrouter-can-go-back: sgRouter history-depth / `canGoBack()` API

- **watching**: @rokucommunity/sgrouter releases for a public history-depth or `canGoBack()` method (none in 0.1.3; pinned)
- **current**: the `JRScene` back arbiter mirrors navigation-in-progress from the public `routerState` events to avoid a spurious Exit dialog mid-transition (A3). This covers the realistic case but NOT the rarer `goBack` miss when a `keepAlive` view's `nodeId` is stale at non-root, because the router exposes no history depth — `m.__router_historyStack` is private and the vendored copy is regenerated by ropm, so we deliberately did not patch it
- **latest_upstream**: 0.1.3
- **latest_acknowledged**: 0.1.3
- **last_checked**: 2026-06-23
- **action_when_moves**: if an official history-depth / `canGoBack()` API lands, bump the pin and gate the `JRScene` Exit confirmation on it to close the stale `nodeId` edge cleanly (replaces the navigation-in-progress mirror). Consider contributing the API upstream as a PR
- **status**: watching

### bsfmt-multiline-indent-regression: `brighterscript-formatter` multi-line-AA indent regression

- **watching**: `brighterscript-formatter` releases after 1.7.28 that fix the [#140](https://github.com/rokucommunity/brighterscript-formatter/pull/140) "Multi-line Function parameters" indent regression
- **current**: pinned to 1.7.27. 1.7.28 over-indents every statement after a multi-line associative-array call argument (e.g. `fn("...", {\n ... \n})`) — the indent level is never popped, so the over-indent cascades past `end sub`/`end function` into the next top-level declaration. Cosmetic only (BrightScript blocks are keyword-delimited, so it still compiles) but `bsfmt --check` enforces the corruption. Renovate re-proposes 1.7.28 as a patch (no version hold in `renovate.json` by choice); close that PR without merging until a fixed release ships
- **latest_upstream**: 1.7.28
- **latest_acknowledged**: 1.7.28
- **last_checked**: 2026-06-28
- **action_when_moves**: when a release after 1.7.28 ships, format the multi-line-AA reproduction snippet under it (`npx bsfmt --write` on a `fn("x", { k: v })`-across-lines snippet followed by a top-level function); if indentation is correct, merge the Renovate bump and drop the 1.7.27 pin in `package.json`. Link the upstream issue once filed
- **status**: watching

### jellyrock-plugin-server-abi: companion plugin's Jellyfin server ABI pin (#667)

- **watching**: new Jellyfin **server** lines (esp. the **12.0 RC**) against the out-of-tree companion plugin `jellyfin-plugin-jellyrock`, whose `Jellyfin.Controller` / `Jellyfin.Model` package refs + `targetAbi` track the server line, not a stable SDK
- **current**: pinned to 10.11.11. The plugin's session-controller + long-poll endpoint use `ISessionManager` / `SessionInfo` / `ISessionController` surfaces that can shift between server minors (e.g. `EnsureController`, `SessionInfo.SupportsRemoteControl`); the plugin's own CI matrix is the primary breakage signal, this row is the cross-repo reminder
- **latest_upstream**: 10.11.11
- **latest_acknowledged**: 10.11.11
- **last_checked**: 2026-07-13
- **action_when_moves**: re-pin the plugin's `Jellyfin.Controller`/`Jellyfin.Model` + `build.yaml` `targetAbi` to the new line, rebuild in the SDK container, and re-verify the cast and closed app liveness gate on a test server (12.0 RC restructures the API — check `ISessionController` / `SessionInfo` shapes)
- **status**: watching
