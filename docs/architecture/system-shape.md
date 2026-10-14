---
topic: system-shape
related-files:
  - CLAUDE.md
  - docs/progress.md
  - docs/signals-backlog.md
  - docs/adr/README.md
  - docs/decisions.md
  - docs/architecture/tech-debt.md
  - .claude/skills/log/SKILL.md
  - .claude/skills/done/SKILL.md
  - .claude/skills/catchup/SKILL.md
  - .claude/skills/focus/SKILL.md
  - .claude/skills/ramp/SKILL.md
  - .claude/skills/tech-debt-scan/SKILL.md
  - .claude/skills/pr/SKILL.md
  - .husky/pre-push
  - scripts/catchup-state.js
  - scripts/journal-sync.js
  - scripts/lint/docs-check.cjs
  - scripts/lint/docs-stale-blocking.cjs
  - scripts/lint/decision-shape-nudge.cjs
  - scripts/lint/pr-body-check.js
  - scripts/lint/progress-cursor-nudge.cjs
  - scripts/lint/session-start-nudge.cjs
  - .github/workflows/journal-sync.yml
  - .github/workflows/journal-sync-precheck.yml
  - .github/workflows/_lint-docs.yml
  - .github/workflows/docs-stale-tracker.yml
last-reviewed: 2026-10-10
---

# System shape

How this repo records and surfaces project state (the journals, the skills that write them and the checks that keep them honest), and why it is shaped that way. It covers the dev process, not the app. For the app, start at the [topic map](README.md).

The rules themselves live in [`CLAUDE.md`](../../CLAUDE.md), the journals under [`docs/`](../), the skills in [`.claude/skills/`](../../.claude/skills/) and the checks in [`scripts/lint/`](../../scripts/lint/). This doc names the pattern those parts make up.

## In one paragraph

The system is an engineering journal for one developer working with AI agents. It has four pillars:

1. An information architecture for static knowledge, loosely after Diátaxis.
2. Five journal surfaces, one per kind of project state, grouped by how fast that state goes out of date.
3. Skills for the daily work of capturing, closing and catching up.
4. Hooks, pre-push checks and CI that close drift loops so nobody has to remember to.

[ADR 0002](../adr/0002-four-pillar-journal-reshape.md) records its adoption from a sister project.

## The four pillars

### 1. Information architecture (Diátaxis-lite)

Static knowledge lives in four folders under [`docs/`](../), borrowed loosely from Daniele Procida's [Diátaxis framework](https://diataxis.fr):

| Folder | Diátaxis type | What lives here |
|---|---|---|
| [`docs/architecture/`](../architecture/) | Explanation | The why and the shape of each subsystem, plus this doc and [`tech-debt.md`](tech-debt.md). Every doc but the topic map carries `last-reviewed:`, and CI blocks a PR that touches a stale doc's territory. |
| [`docs/dev/`](../dev/) | How-to and tutorial, mixed | Task guides ("add a setting", "write a migration") and setup guides ([`DEVGUIDE.md`](../dev/DEVGUIDE.md), [`unit-tests-tdd.md`](../dev/unit-tests-tdd.md)). |
| [`docs/user/`](../user/) | Reference and how-to | Pages for people using the app: the generated app settings list, the server feature matrix, and guides such as subtitles and deep linking. |
| [`docs/admin/`](../admin/) | Process reference | Releases, the changelog and translations, for maintainers. |

It is not strict Diátaxis. There is no tutorial folder, because `DEVGUIDE.md` already plays that role. Splitting `docs/dev/` by type would make a reader pick a folder before they can find anything, which costs more than purity is worth at this size.

### 2. Five surfaces for project state

| File | Job | Goes stale in | Written by |
|---|---|---|---|
| [`docs/progress.md`](../progress.md) | The live cursor: currently running, recently shipped, open followups | Hours to days | `/log followup` and `/log running`; `/done`, which adds a Recently shipped line on `main` (on a branch, `journal-sync` writes it after the merge) |
| [`docs/adr/`](../adr/README.md) | Numbered architecture decision records for choices that are architectural, hard to reverse or cross-component | Never. A record is superseded, not edited: the supersede updates the older record's `**Status:**` line. | `/log decision` (ADR grade) |
| [`docs/decisions.md`](../decisions.md) | Append-only notes for narrow, single-component decisions below the ADR bar | Never while the note is true. A supersede is the one field edit to an older note; `/log decision --revise=<slug>` corrects a note whose text is wrong about what shipped. | `/log decision` (below the bar) |
| [`docs/signals-backlog.md`](../signals-backlog.md) | Upstream version watching (Jellyfin, Roku OS, BrighterScript, dependencies), one row per upstream | Slowly | `/log signal`, `/done <slug>` |
| [`docs/architecture/tech-debt.md`](tech-debt.md) | Internal refactor candidates, each with a slug and a severity | Slowly | [`/tech-debt-scan`](../../.claude/skills/tech-debt-scan/SKILL.md), which adds and removes entries |

Each file has one job. A file with several jobs makes every update raise "what else needs changing?", and that friction kills the habit of updating it.

The ADRs follow Michael Nygard's [2011 essay](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions). The backlogs borrow from [Getting Things Done](https://gettingthingsdone.com) (David Allen): queues with a status per entry and a named blocker.

GitHub issues stay the backlog for issue-shaped work: bugs, features and public requests. The journals hold what is not issue-shaped yet: decisions, deferred internal work, upstream watching and debt.

### 3. Skills for the daily work

Rules without skills drift. A rule that says "remember to update file X at moment Y" fails sooner or later, so each such moment has a skill:

| Skill | When | What it does |
|---|---|---|
| [`/catchup`](../../.claude/skills/catchup/SKILL.md) | The start of a session, after a gap of days, or "what is the state of things?" | Runs the shared state reader (git, the followup journal, projects). That reader runs [`scripts/catchup-state.js`](../../scripts/catchup-state.js), named in `catchup.conf`, for GitHub, signals, decisions and tech debt. It ranks both readers' warnings in one list: a stale journal, stale signal rows, failing CI. |
| [`/focus`](../../.claude/skills/focus/SKILL.md) | The same moments, when several things look actionable and you want one picked | Uses the same readers and ranks what is actionable by a fixed order. It recommends one next move with the rule that picked it and one to three alternatives, then prints the one command to take it. An ad-hoc fix becomes a saved plan that a Sonnet sub-agent runs. Pinned to Opus, since picking is judgment. |
| [`/log <type>`](../../.claude/skills/log/SKILL.md) | Any new entry: `decision`, `followup`, `signal` or `running` | Writes the entry to the right journal in its template. A followup is a `####` entry with a permanent id (`fid`), written by `.claude/skills/log/journal.sh`, which also bumps `last-updated:`. The mechanical types apply directly. Only `decision` shows a diff and asks first, because routing a decision is a judgment. |
| [`/done <slug>`](../../.claude/skills/done/SKILL.md) | Work landed: a followup finished, a signal handled, the cursor closed by hand | Proves the work landed, then closes the entry with no confirm step. A followup goes through `journal.sh close`, which removes it. A signal flips to `completed`, except the three auto-managed rows, which record the acknowledged version and go back to `watching`. The `running` cursor normally closes itself through [`journal-sync.yml`](../../.github/workflows/journal-sync.yml); `/done running` is the manual path. |
| [`/pr`](../../.claude/skills/pr/SKILL.md) | Opening a PR | Runs the three judgment passes (tech-debt scan, decision-shape check, followup capture) so journal updates land in the same change set as the code. |

`/log decision --revise=<slug>` exists because a supersede cannot fix a note whose text was wrong from the start. A supersede asserts a decision that never happened and leaves the false text as the first thing a reader sees. A revise corrects the record and leaves `status` alone, since the decision's standing did not change. Changing your mind is still a supersede.

[`/ramp <area>`](../../.claude/skills/ramp/SKILL.md) is the area-scoped variant: it runs the same aggregator with `--area=<name>` and adds the area's scoped `CLAUDE.md`, architecture doc and recent commits. `/pr` starts `/tech-debt-scan` as part of shipping.

The full index is [`.claude/skills/README.md`](../../.claude/skills/README.md), and authoring conventions are in [`.claude/skills/CLAUDE.md`](../../.claude/skills/CLAUDE.md).

### 4. Enforcement, so rules don't depend on memory

Seven layers, fastest feedback first:

| Layer | What runs | What it does |
|---|---|---|
| Session start | [`session-start-nudge.sh`](../../.claude/hooks/session-start-nudge.sh), a `SessionStart` hook calling [`session-start-nudge.cjs`](../../scripts/lint/session-start-nudge.cjs) | Prints one advisory line when local state needs action (pending handoffs, a stale `progress.md`, a broken journal schema). Silent on clean state. It makes no network calls, so it stays cheap and works offline. |
| End of turn | Three `Stop` hooks: [`check-touched-related-files.sh`](../../.claude/hooks/check-touched-related-files.sh), [`check-touched-lint.sh`](../../.claude/hooks/check-touched-lint.sh), [`check-progress-cursor.sh`](../../.claude/hooks/check-progress-cursor.sh) | Name the architecture docs and dev guides that claim a touched file, the lint that covers it, and a stale `progress.md` or a Currently running cursor that shipped commits overlap. All advisory. |
| Pre-push | [`.husky/pre-push`](../../.husky/pre-push) | Runs validation and lint scoped to the push range, plus two nudges: [`decision-shape-nudge.cjs`](../../scripts/lint/decision-shape-nudge.cjs) (a decision-shaped commit with no `docs/adr/` or `decisions.md` change) and [`progress-cursor-nudge.cjs`](../../scripts/lint/progress-cursor-nudge.cjs) (the same check as the `Stop` hook). Checks abort the push; nudges never do. |
| PR | [`journal-sync-precheck.yml`](../../.github/workflows/journal-sync-precheck.yml), job `precheck`, a required check on `main` | Spell-checks the Recently shipped line the PR title will become, and runs [`pr-body-check.js`](../../scripts/lint/pr-body-check.js). See below. |
| Post-merge | [`journal-sync.yml`](../../.github/workflows/journal-sync.yml) running [`journal-sync.js`](../../scripts/journal-sync.js) | The mechanical close: adds a Recently shipped line, clears the Currently running cursor when at least two of its words appear in the PR title, bumps `last-updated:` and prunes Recently shipped lines older than 14 days. |
| CI | [`lint-docs.yml`](../../.github/workflows/lint-docs.yml), which calls [`_lint-docs.yml`](../../.github/workflows/_lint-docs.yml) | The journal and doc gates. See below. |
| Weekly | [`docs-stale-tracker.yml`](../../.github/workflows/docs-stale-tracker.yml), Mondays on `main` | Keeps one `docs:stale` issue open while the `progress.md` cursor is more than 7 days old with non-maintenance commits since, from `progress-cursor-nudge.cjs --json`, the same computation as the local nudges. |

**The PR check exists because the repo merges squash-only.** The PR title becomes the commit's first line and the description becomes its body. The title's type places the change in `CHANGELOG.md`: the types are defined once in [`scripts/lib/pr-title.js`](../../scripts/lib/pr-title.js), which `changelog-syncer.js` reads too. So `pr-body-check.js` fails a title with no known type, a description that is still the unfilled template, and a `repo#N` reference to another repo, which GitHub leaves unlinked. A bare `#N` always links to this repo, so text alone can't judge it; `/pr` resolves those with `--list-refs` before posting. The workflow runs on `opened`, `edited`, `synchronize` and `reopened`. `edited` matters most: a title or description fixed in the GitHub UI re-runs the check with no new push.

The spell-check and description check skip the PRs `journal-sync` skips (`shouldSkip()` in `journal-sync.js`): bot authors, the `dependencies`, `documentation`, `docs-only`, `ci`, `automated` and `chore-only` labels, and dependency-bump, Weblate translation and `chore(agents):` titles. The title check skips only bot PRs and release branches, because a `documentation` PR's title still reaches the changelog.

**The CI layer** runs, in order:

- `journal.sh check`, the followup format in `progress.md`.
- [`docs-check.cjs`](../../scripts/lint/docs-check.cjs), the doc reference and journal schema checks listed below.
- `doc-citation-ratchet.js`, the line-number and house-voice ratchet ([writing style](../dev/writing-style.md#what-the-gate-checks)).
- The check that the generated `docs/dev/` table in the [topic map](README.md) matches the folder.
- [`docs-stale-blocking.cjs`](../../scripts/lint/docs-stale-blocking.cjs), which fails a PR that touches a stale architecture doc's territory without updating the doc.
- Two workflow-consistency checks: the dependency workflow sync and the check that CI runs every `npm run lint` member.

**`progress.md` staleness is not a PR gate.** How old its date is says something about `main`, not about the PR under review, so a gate on it failed unrelated dependency and docs PRs. The weekly tracker carries it instead. `docs-check.cjs` checks only that `last-updated:` is present and well formed.

**Doc freshness is contextual.** The `Stop` hook and the 120-day PR gate fire when you touch a doc's territory, which is when re-reading it is cheap. There is no calendar backlog of old docs, since that asks for a cold re-read with no work behind it. `npm run docs:stale` lists the review cadence on demand. [ADR 0033](../adr/0033-contextual-doc-freshness.md) records the decision.

`docs-check.cjs` checks the journals like this:

- **`signals-backlog.md`:** every row has its required bullets, a valid `status`, an ISO `last_checked` date and a positive `staleness_days`.
- **`docs/adr/` and `decisions.md`:** links and tech-debt anchors resolve. No staleness check, since both are immutable or append-only.
- **The `decisions.md` supersede chain:** it fails on a duplicate slug, a missing or repeated field, an invalid `status`, a pointer that does not resolve in the file, a one-sided full or partial supersede pair, a full supersede whose target is not `superseded`, a `partially-*` value without its scope, a `superseded` note naming no successor, a `withdrawn` note at either end of a supersede, or a note pointing at itself. A supersede is a hand edit in several places, and a half-applied one would leave the chain wrong without anyone noticing. ADRs state the same relationship in prose, which nothing checks.

## The principles

**Shape:**

- **One job per file.** A file with several jobs gathers update friction and goes stale.
- **Group by how fast things go stale.** A fast-changing section in a slow file doesn't get updated, and a slow section in a fast file gets overwritten by accident.
- **One source of truth per fact.** A copy drifts.
- **Journals move forward.** History is append-only, with a supersede link instead of an edit. A supersede is for a decision that changed. A record that was wrong from the start gets `/log decision --revise`, because moving forward protects history, not misinformation.

**Use:**

- **One way in for capture** (`/log`) and **one for state** (`/catchup`).
- **Capture and closing are different moments:** `/log` for new entries, `/done` for existing ones.
- **Retrieval leans to action:** `/catchup` names what can ship today and flags drift, not only the current state.

**Enforcement:**

- **Automation closes loops; rules that need memory drift.**
- **Friction at the cause, not the symptom:** a pre-push nudge on a decision-shaped commit, not a quarterly cleanup.
- **Drift shows at retrieval,** as warnings, not as sentences buried in a file.
- **Confirmation goes where the judgment is.** `/log decision` shows a diff and waits, because whether and where to record a decision is a judgment. Mechanical captures and proven closures apply directly. When they go wrong, the fix is auditing the skill's runs, not a prompt in every session.
- **Two scripts write journals outside the skills, both mechanically.** `journal-sync.yml` writes the post-merge close to `progress.md` from merged-PR data. `catchup-state.js` writes `last_checked` and `latest_upstream` on the three auto-managed signal rows from the upstream versions it fetches. Neither makes a judgment, so neither carries the risk of an invented entry.

**Iteration:**

- **Build less first:** fewer files, sharper roles.
- **Don't defer enforcement.** Deferred things get forgotten, which is the drift this system exists to stop.
- **Sub-agents capture through their parent.** A sub-agent surfaces an entry for the parent to write with `/log`. The one exception is a `/sonnet` sub-agent its parent supervises, which carries out the journal writes its saved plan names.

## Lineage

None of this is new. It combines established patterns with an emerging layer for working with agents:

- **ADRs** for decisions: Michael Nygard, 2011 ([essay](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)).
- **Diátaxis** for static knowledge: Daniele Procida ([diataxis.fr](https://diataxis.fr)).
- **Docs as code** for the lint, CI and versioning.
- **GTD and personal knowledge management** for queues and next actions: David Allen's [Getting Things Done](https://gettingthingsdone.com), Tiago Forte's [Building a Second Brain (PARA)](https://www.buildingasecondbrain.com), Niklas Luhmann's Zettelkasten.
- **Project memory for agents:** `CLAUDE.md`, `AGENTS.md`, Cursor rules and skills as encoded workflows. It has no settled name yet.

In one phrase: an agent-collaborative engineering journal with ADRs, Diátaxis and skill-driven capture and closing.

## Who it is tuned for

The system is tuned for one developer and their AI agents. The dense terms, the large `CLAUDE.md` tree and the missing tutorial folder would be wrong for a project with many active contributors. They are right here because the audience is one person and their agents.

JellyRock is public, but few outside contributors arrive today. If more do, add an onboarding layer on top and keep the internals: a friendlier [`CONTRIBUTING.md`](../../CONTRIBUTING.md), and a tutorial that takes a newcomer from `git clone` to a first build and a first PR. The public changelog already exists: `CHANGELOG.md` is generated from PR titles ([changelog](../admin/changelog.md)).

## Why this doc is in `architecture/`

`docs/architecture/` holds explanation: the why and shape of subsystems. The journal system is a subsystem that happens to work on prose files instead of BrightScript. Living here gives it the same freshness checks as every other architecture doc.

## When to update this doc

Change this doc in the same commit as a change to the system's shape: adding or retiring a journal surface, changing the core skills, adding or removing a pillar or an enforcement layer, or changing the lineage. A tactical change (a workflow-specific skill, a tighter lint check) does not need it; the skill's own docs and the root [`CLAUDE.md`](../../CLAUDE.md) cover those.
