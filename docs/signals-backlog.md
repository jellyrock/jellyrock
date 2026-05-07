---
last-updated: 2026-05-06
---

# Signals backlog

External version-watching journal. Tracks upstreams JellyRock depends on or cares about; when an upstream moves, the `action_when_moves` field tells us what to do.

Distinct from [tech-debt.md](architecture/tech-debt.md) (internal debt) and [decisions.md](decisions.md) (ADRs). Each row is updated via `/log signal <slug>` (add) or `/done <slug>` (mark completed).

## Schema

Each row is an `H3` block:

```markdown
### <slug>: <one-line label>

- **watching**: <what we're watching upstream>
- **current**: <version JellyRock pins / supports>
- **latest_upstream**: <last known upstream version>
- **last_checked**: YYYY-MM-DD
- **action_when_moves**: <what triggers a JellyRock change>
- **status**: watching | action_pending | completed
- **staleness_days**: <optional override; default 30>
```

Schema is enforced by `npm run lint:docs` (`signals-schema-invalid` category). Stale rows (where `last_checked` is older than `staleness_days`) surface as a banner in `/catchup`.

## Watching

### jellyfin-server-stable: Jellyfin server stable channel

- **watching**: latest stable release on the jellyfin/jellyfin GitHub repo
- **current**: 10.7.0 minimum supported; latest tested per [user/jellyfin-server-feature-matrix.md](user/jellyfin-server-feature-matrix.md)
- **latest_upstream**: ? (not validated at this row's authoring; bump on next `/catchup`)
- **last_checked**: 2026-05-06
- **action_when_moves**: review [dev/jellyfin-server-versioning.md](dev/jellyfin-server-versioning.md); if a new minor introduces a breaking endpoint shape, add a v3 dispatcher per the doc's "Adding Support for New Server Versions" section
- **status**: watching

### jellyfin-server-rc: Jellyfin server RC / beta channel

- **watching**: pre-release builds on jellyfin/jellyfin
- **current**: n/a (we don't pre-test against RCs by default)
- **latest_upstream**: ?
- **last_checked**: 2026-05-06
- **action_when_moves**: spin up the RC against a test library; file findings as GitHub issues if breakage is detected before the stable release
- **status**: watching
- **staleness_days**: 14

### roku-os: Roku OS firmware

- **watching**: firmware releases on developer.roku.com
- **current**: minimum supported set in `manifest` `bs_version`; no specific pin in source
- **latest_upstream**: ?
- **last_checked**: 2026-05-06
- **action_when_moves**: review video pipeline + scene graph capability changes; update [architecture/playback.md](architecture/playback.md) if a codec / DRM / OSD change affects JellyRock
- **status**: watching
- **staleness_days**: 60

### brighterscript: BrighterScript compiler

- **watching**: brighterscript on npm
- **current**: 1.0.0-alpha.50 (devDependencies)
- **latest_upstream**: 1.0.0-alpha.50
- **last_checked**: 2026-05-06
- **action_when_moves**: review release notes; bump devDependencies; verify `npm run validate` and `npm run build` pass; check BSC plugin compatibility (see [../scripts/CLAUDE.md](../scripts/CLAUDE.md))
- **status**: watching

### rooibos: Rooibos test framework

- **watching**: rooibos-roku on npm
- **current**: 6.0.0-alpha.50 (devDependencies)
- **latest_upstream**: 6.0.0-alpha.50
- **last_checked**: 2026-05-06
- **action_when_moves**: review release notes; bump; verify `npm run test:tdd` and `npm run test:scripts` pass on hardware
- **status**: watching

### roku-log: roku-log logging library

- **watching**: roku-log on npm (vendored via ropm)
- **current**: 0.11.1 (dependencies)
- **latest_upstream**: 0.11.1
- **last_checked**: 2026-05-06
- **action_when_moves**: review release notes; bump; review [architecture/logging.md](architecture/logging.md) for shape changes; verify hardware tests still pass
- **status**: watching
