---
last-updated: 2026-05-30
---

# Progress

Live state cursor — repo-scoped, ~14-day rolling. The "where did I leave off, what just shipped, what's open" surface.

Sections:

- **Currently running** — 1-2 sentences on what's actively in flight
- **Recently shipped** — newest first; items older than ~14 days are pruned during weekly cleanup
- **Open followups** — grouped by area; deferred work that's not yet issue-shaped or tech-debt-shaped

This file is updated through skills, not raw markdown edits:

- `/log followup "<text>" --area=<name>` to add an open followup
- `/done <slug-or-keyword>` to flip a followup → recently-shipped
- `/log decision` for ADR-grade decisions (lands in [decisions.md](decisions.md), not here)

Drift is gated by `npm run lint:docs` — **FAILs** when `last-updated` is >7 days old AND there are commits since.

## Currently running

Server-upgrade automation, Phases 0–6 built + committed on `feat/server-upgrade-automation` — **no PR yet, by design: the whole initiative ships as ONE PR at the very end.** Phase 6 (just built) replaced the per-finding issue burst + single rolling tracker with the **per-version release-triage digest** model (one auto-opened digest per release; CI opens-then-closes a mechanically-clean release as a persistent audit record; `/server-upgrade` edits the digest with verdicts + files per-finding **sub-issues**; never CI-closed once it bears a candidate) and added the **endpoint-availability registry** ([`jellyfin-endpoint-availability.yml`](dev/jellyfin-endpoint-availability.yml) + `.cjs` loader + `lint:endpoint-availability`) — a validated disposition ledger that resolves the 5 recurring floor findings (`MediaSegments`/Lyrics/`QuickConnect`/`GET /items`) at the source so they stop reappearing every release. All offline/tooling-tier; `npm run test:scripts` green (675 tests); see the `server-upgrade-phase6` decision. **Next: open the single PR for Phases 0–6 via `/pr`.**

## Recently shipped

Newest first. Prepended by `/done`. Items older than ~14 days are pruned manually during the next `/catchup`.

- 2026-05-29 — Expand placeholder coverage to grids, audio player, and item details
- 2026-05-22 — Add /crash-report + /crash-backtrace for weekly Roku crash triage
- 2026-05-21 — vscode: associate dotfiles to stop markdownlint false positives
- 2026-05-16 — chore: reduce Renovate PR noise + close dep CI gaps
- 2026-05-09 — Skills overhaul: /catchup, journal sync, /pr update-path, audit-skill
- 2026-05-06 — `docs(decisions): record triage-opus-inline-investigation`
- 2026-05-06 — `chore(claude): update skills README + allowlist for triage refactor`
- 2026-05-06 — `feat(skills): /ramp surfaces area-scoped pending handoffs`
- 2026-05-06 — `feat(skills): /catchup auto-prunes + surfaces pending handoffs`
- 2026-05-06 — Triage skills (`/issue-triage`, `/pr-review`, `/runtime-triage`, `/ci-triage`) refactored to opus + `INVESTIGATION.md` sibling pattern
- 2026-05-06 — `chore(claude): retire investigator agents + gitignore handoffs/`
- 2026-05-06 — `docs(skills): author the skills index README`
- 2026-05-06 — `feat(agents): add pattern-finder`
- 2026-05-06 — `feat(skills): add /tech-debt-scan pre-PR sweep`
- 2026-05-06 — Guided workflow skills added: `/new-setting`, `/new-migration`, `/translation-add`

## Open followups

Grouped by area. Append via `/log followup "<text>" --area=<name>`. Close via `/done <slug-or-keyword>`. If the area you need isn't here, add a new `###` subsection.

### scripts

- Proactive PR-time floor-coverage lint: run the server-upgrade floor check (backward + symmetry, minus the endpoint-availability ledger) on PRs so a NEW floor gap introduced by our own code surfaces immediately, instead of waiting for the next Jellyfin release to open a digest. (Phase 6 followup — the digest model only surfaces floor findings on release-triggered runs.)

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
