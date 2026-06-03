---
last-updated: 2026-06-03
---

# Progress

Live state cursor — repo-scoped, ~14-day rolling. The "where did I leave off, what just shipped, what's open" surface.

Sections:

- **Currently running** — 1-2 sentences on what's actively in flight
- **Recently shipped** — newest first; bullets older than 14 days are pruned automatically by the post-merge journal-sync
- **Open followups** — grouped by area; deferred work that's not yet issue-shaped or tech-debt-shaped

This file is updated through skills, not raw markdown edits:

- `/log followup "<text>" --area=<name>` to add an open followup
- `/done <slug-or-keyword>` to flip a followup → recently-shipped
- `/log decision` for ADR-grade decisions (lands in [decisions.md](decisions.md), not here)

Drift is gated by `npm run lint:docs` — **FAILs** when `last-updated` is >7 days old AND there are commits since.

## Currently running

Investigating issue #573 (surround audio fails to play; the server emits a bad ffmpeg audio argument). Reworked PR #574 so the playback audio logic prefers the user's chosen surround format setting instead of falling back to stereo — fixing the crash and keeping surround output intact. Verified against a live Jellyfin 10.11 server and on Roku hardware (50 of 50 audio specs); next is the PR description update and asking the reporter to retest.

## Recently shipped

Newest first. Prepended by the post-merge journal-sync (and `/done`). Bullets older than 14 days are pruned automatically by that same sync; `/catchup` is only a backstop.

- 2026-06-03 — fix(playback): preserve surround on multichannel transcode fallback
- 2026-06-03 — Skip Roku device tests when only Node tests change
- 2026-06-03 — Auto-prune the shipped log and backtick code identifiers in PR titles
- 2026-06-03 — Unify `GridItem`/`GridItemSmall` and fix genre grid rendering
- 2026-06-03 — Fix photo selection opening the viewer behind `ItemDetails`
- 2026-06-02 — Support RC + unstable/master channels in server-upgrade automation
- 2026-06-01 — Add proactive PR-time floor-coverage lint
- 2026-06-01 — Proactive PR-time floor-coverage lint: run the server-upgrade floor check (backward + symmetry, minus the endpoint-availability ledger) on PRs so a NEW floor gap introduced by our own code surfaces immediately, instead of waiting for the next Jellyfin release to open a digest. (Phase 6 followup — the digest model only surfaces floor findings on release-triggered runs.)
- 2026-06-01 — Version-guard the Lyrics request on Jellyfin 10.9+
- 2026-05-31 — chore(ci): harden journal-sync workflow against PR-title injection
- 2026-05-31 — Fix server-upgrade digest counts + harden CI command injection
- 2026-05-31 — Fix server-upgrade tracker issue writes (REST) + digest legend & nudge
- 2026-05-30 — Server-upgrade automation, Phases 0–6 built + committed on `feat/server-upgrade-automation` — **no PR yet, by design: the whole initiative ships as ONE PR at the very end.** Phase 6 (just built) replaced the per-finding issue burst + single rolling tracker with the **per-version release-triage digest** model (one auto-opened digest per release; CI opens-then-closes a mechanically-clean release as a persistent audit record; `/server-upgrade` edits the digest with verdicts + files per-finding **sub-issues**; never CI-closed once it bears a candidate) and added the **endpoint-availability registry** ([`jellyfin-endpoint-availability.yml`](dev/jellyfin-endpoint-availability.yml) + `.cjs` loader + `lint:endpoint-availability`) — a validated disposition ledger that resolves the 5 recurring floor findings (`MediaSegments`/Lyrics/`QuickConnect`/`GET /items`) at the source so they stop reappearing every release. All offline/tooling-tier; `npm run test:scripts` green (675 tests); see the `server-upgrade-phase6` decision. **Next: open the single PR for Phases 0–6 via `/pr`.**
- 2026-05-29 — Expand placeholder coverage to grids, audio player, and item details
- 2026-05-22 — Add /crash-report + /crash-backtrace for weekly Roku crash triage
- 2026-05-21 — vscode: associate dotfiles to stop markdownlint false positives

## Open followups

Grouped by area. Append via `/log followup "<text>" --area=<name>`. Close via `/done <slug-or-keyword>`. If the area you need isn't here, add a new `###` subsection.

### scripts

(none)

### components

(none)

### source

(none)

### tests

(none)

### docs

(none)

### claude

(none)
