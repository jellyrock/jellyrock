# ADR 0051: Upstream watches are CI issues, and the server-upgrade anchor is the newest committed fingerprint

**Status:** Accepted. Partially supersedes [ADR 0002](0002-four-pillar-journal-reshape.md) (its signals journal; the other surfaces stand) and [ADR 0015](0015-server-upgrade-anchor-vs-resolved-decoupling.md) (where the anchor is stored; the anchor still trails clean releases)
**Date:** 2026-10-20

**related-files**: `scripts/generate/spec-fingerprint.js`, `scripts/server-upgrade-tracker.js`, `scripts/roku-os-watch.js`, `scripts/catchup-state.js`, `.github/workflows/server-upgrade-tracker.yml`, `.github/workflows/roku-hardware-sync.yml`, `.claude/skills/server-upgrade/SKILL.md`, `docs/architecture/system-shape.md`

`docs/signals-backlog.md` is retired. Its rows went stale because only a hand-run `/catchup` refreshed them: on 2026-10-20 the `roku-os` row still read 15.3 while the release notes said 16.0. A scheduled job now opens one issue when an upstream moves, so the nudge reaches the review queue whether or not anyone runs a briefing. `server-upgrade-tracker.yml` opens one `server-upgrade:rc` issue per Jellyfin release candidate beside its per-release digests, and a `roku-os` job in `roku-hardware-sync.yml` opens one issue per Roku OS release. Each issue is found by exact title in any state, so it is opened once, and closing it is the acknowledgment. The six hand-managed rows became followups, and `/catchup` shows each open watch issue as a banner.

The `/server-upgrade` diff anchor was `latest_acknowledged` on the `jellyfin-server-stable` row. It is now `reviewedAnchor()`: the newest stable version with a committed fingerprint. The two always moved together, because a triage commits the `<to>` fingerprint and moves the row in one change (#928 for 12.0, #597 for 10.11.8), so storing the anchor twice only let the copies disagree. ADR 0015's rule that a committed fingerprint means a person reviewed that version is what makes this sound. It also keeps CI from moving the anchor, since CI never commits a fingerprint.

**Ruled out:** a hand-set anchor file (one more hand step per triage, and a second record of "reviewed" that can drift from the fingerprints); working the anchor out from the closed digest issues (it needs the network, and a stray label would move it); keeping one signals row for the anchor (the file, its docs check and the `/done` signal close would all stay alive for one value).

**Risk:** a stable fingerprint committed outside a triage moves the anchor silently. `/server-upgrade` and the fingerprint generator say that committing one is the acknowledgment. During a triage the anchor already reads `<to>` once Step 0 writes its fingerprint, so Step 0 reads `<from>` first.
