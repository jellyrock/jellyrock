<!-- Your title should be short, descriptive, and in the imperative mood (Fix X, Change Y, instead of Fixed X, Changed Y) -->
<!-- This description BECOMES the squash commit message on main (squash_merge_commit_message=PR_BODY),
     so unfilled sections would land in `git log` permanently. CI gates that: scripts/lint/pr-body-check.js. -->
# Overview
<!-- Brief overview of PR -->

## Changes
<!-- Unordered list of changes made -->
-

## Follow-ups
<!-- Anything explicitly out of scope / deferred. Each item must have a tech-debt.md entry — link the slug. Default to None. -->
<!-- - [`slug-name`](docs/architecture/tech-debt.md#slug-name) — one-line description -->
None

## Issues
<!-- Fixes #123 -->
<!-- Ref #123 -->

## Docs / context updates

<!-- Most PRs need none. The few that do tend to be important — please tick if applicable.
Architecturally-significant files (tend to need doc updates):
  source/main.bs · source/migrations.bs · components/data/SceneManager.bs ·
  source/api/ApiClient.bs · components/data/jellyfin/*.xml ·
  any new component under components/{video,manager,api}/ -->

- [ ] **Architecture doc** updated if a system's *shape* or *why* changed → `docs/architecture/<topic>.md`
- [ ] **`docs/dev/` how-to** updated if a workflow / recipe changed (adding a setting, writing a migration, etc.)
- [ ] **Subdir `CLAUDE.md`** updated if a per-area rule / convention changed
- [ ] **`docs/adr/`** ADR added if an architectural / hard-to-reverse / cross-component decision was made (sub-architectural choice → **`docs/decisions.md`** note)
- [ ] **`docs/architecture/tech-debt.md`** entry removed if this PR fixes a listed item, or added if this PR introduces new debt or defers a follow-up
- [ ] None — this PR doesn't change any of the above
