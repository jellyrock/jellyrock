---
last-updated: 2026-05-29
---

# Signals backlog

External version-watching journal. Tracks upstreams JellyRock depends on or cares about; when an upstream moves, the `action_when_moves` field tells us what to do.

Distinct from [tech-debt.md](architecture/tech-debt.md) (internal debt) and [decisions.md](decisions.md) (ADRs). Three rows, all auto-maintained by the [`/catchup` aggregator](../scripts/catchup-state.js): `latest_upstream` and `last_checked` are fetched + written back on each `/catchup`. The `current` field stays as static prose describing JellyRock's posture toward the upstream (e.g. "minimum supported is X.Y") — it does NOT track upstream movement. The `latest_acknowledged` field is the close-loop counterpart to `latest_upstream`: bump it via `/done <slug>` when you've reviewed the new upstream version. A row goes "stale" (banner-worthy) when `latest_upstream != latest_acknowledged` AND status is `watching` — i.e., upstream moved past the last version you acknowledged. Use `/log signal <slug>` only to add new rows; existing rows update themselves.

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

## Watching

### jellyfin-server-stable: Jellyfin server stable channel

- **watching**: latest stable release on api.jellyfin.org/openapi/stable/
- **current**: 10.7.0 minimum supported; latest tested per [user/jellyfin-server-feature-matrix.md](user/jellyfin-server-feature-matrix.md)
- **latest_upstream**: 10.11.10
- **latest_acknowledged**: 10.11.8
- **last_checked**: 2026-05-29
- **action_when_moves**: run [`/server-upgrade`](../.claude/skills/server-upgrade/SKILL.md) to triage the release (mechanical report → agent investigation → human-gated issue filing); the proactive tracker issue maintained by [.github/workflows/server-upgrade-tracker.yml](../.github/workflows/server-upgrade-tracker.yml) nudges this with candidate counts. If a new minor introduces a breaking endpoint shape, the triage adds a v3 dispatcher per [dev/jellyfin-server-versioning.md](dev/jellyfin-server-versioning.md)'s "Adding Support for New Server Versions" section
- **status**: watching

### jellyfin-server-rc: Jellyfin server release candidate channel

- **watching**: pre-release builds on api.jellyfin.org/openapi/stable/ whose base version is greater than the latest stable (sparse — only present while a new release is in flight)
- **current**: n/a (we don't pre-test against RCs by default)
- **latest_upstream**: (no RC in flight)
- **latest_acknowledged**: (no RC in flight)
- **last_checked**: 2026-05-29
- **action_when_moves**: spin up the RC against a test library; file findings as GitHub issues if breakage is detected before the stable release
- **status**: watching

### roku-os: Roku OS firmware

- **watching**: rokudev/dev-doc release notes — the first `## Roku OS X.Y` heading wins (file order is newest-first)
- **current**: not pinned in source; we run on whatever Roku OS the device ships — review when the latest jumps a major
- **latest_upstream**: 15.2
- **latest_acknowledged**: 15.2
- **last_checked**: 2026-05-29
- **action_when_moves**: review video pipeline + scene graph capability changes; update [architecture/playback.md](architecture/playback.md) if a codec / DRM / OSD change affects JellyRock
- **status**: watching
