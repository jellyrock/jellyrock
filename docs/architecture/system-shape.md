---
topic: system-shape
related-files:
  - CLAUDE.md
  - docs/progress.md
  - docs/signals-backlog.md
  - docs/decisions.md
  - docs/architecture/tech-debt.md
  - .claude/skills/log/SKILL.md
  - .claude/skills/done/SKILL.md
  - .claude/skills/catchup/SKILL.md
  - .claude/skills/focus/SKILL.md
  - .claude/skills/ramp/SKILL.md
  - .claude/skills/tech-debt-scan/SKILL.md
  - .claude/skills/pr/SKILL.md
  - scripts/catchup-state.js
  - scripts/journal-sync.js
  - scripts/lint/docs-check.cjs
  - scripts/lint/progress-cursor-nudge.cjs
  - scripts/lint/session-start-nudge.cjs
  - .github/workflows/journal-sync.yml
last-reviewed: 2026-05-13
---

# System shape — how this repo's dev-process is structured and why

High-level orientation for a human or agent landing in this repo and asking "why is the dev-process / journal / skill system shaped like this?" The ground-truth artifacts are the load-bearing rules in [`CLAUDE.md`](../../CLAUDE.md), the four journals at [`docs/`](../), the skills at [`.claude/skills/`](../../.claude/skills/), and the lint at [`scripts/lint/docs-check.cjs`](../../scripts/lint/docs-check.cjs). This doc names the shape those pieces compose into so a reader understands the pattern, not just the parts.

This doc is about the *meta* layer (how project state is captured and surfaced), not about JellyRock's product code. For the latter, start with [`README.md`](README.md)'s topic map.

## What this is, in one paragraph

A solo + AI-collaborative engineering journal: four append-mostly journal files for the four categories of project state that decay at different rates, three skills for the daily ritual of capture / completion / catchup, an information architecture (Diátaxis-lite) for the static knowledge, and an enforcement layer (pre-push hooks + CI lint + post-tool-use advisory hooks) that closes drift loops automatically rather than depending on memory. The whole thing is tuned for **one developer + AI agents** as the primary audience, with a thin OSS-readability surface on top.

## The four pillars

### 1. Information architecture — Diátaxis-lite

Static project knowledge lives under [`docs/`](../) in four buckets borrowed loosely from Daniele Procida's [Diátaxis framework](https://diataxis.fr):

| Bucket | Diátaxis equivalent | What lives here |
|---|---|---|
| [`docs/architecture/`](../architecture/) | explanation | The *why* and *shape* of each subsystem (api, navigation, playback, etc.). Includes this doc + [`tech-debt.md`](tech-debt.md). All have `last-reviewed:` frontmatter; CI-blocked when stale + territory touched. |
| [`docs/dev/`](../dev/) | how-to + tutorial mixed | Task-oriented guides ("how to add a setting", "how to write a migration") and zero-to-running tutorials ([`DEVGUIDE.md`](../dev/DEVGUIDE.md), [`unit-tests-tdd.md`](../dev/unit-tests-tdd.md)). Pragmatic blend; no strict separation. |
| [`docs/user/`](../user/) | reference | End-user reference (auto-generated app settings, server feature matrix). |
| [`docs/admin/`](../admin/) | process reference | Release / changelog / translation-ops reference for maintainers. |

This is **Diátaxis-lite**, not strict Diátaxis: there's no `docs/tutorial/` bucket because [`DEVGUIDE.md`](../dev/DEVGUIDE.md) already serves that role and splitting `docs/dev/` by Diátaxis type would force users to know which bucket they want before they can navigate. The cost of strict purity is higher than the value at JellyRock's current scale.

### 2. Four journals for project state

| File | Job | Decay rate | Update via |
|---|---|---|---|
| [`docs/progress.md`](../progress.md) | Live state cursor — currently running, recently shipped, open followups | Hours / days | `/log followup` (auto-bumps), `/done` (auto-prepends shipped) |
| [`docs/decisions.md`](../decisions.md) | Append-only ADR log (Context / Decision / Consequences / Status) | Never (forward-only) | `/log decision` |
| [`docs/signals-backlog.md`](../signals-backlog.md) | External version-watching (Jellyfin, Roku OS, BrighterScript, deps) — slow-decay, one row per upstream | Slow | `/log signal`, `/done <slug>` |
| [`docs/architecture/tech-debt.md`](tech-debt.md) | Internal refactor candidates (severity-classified, slug-based) | Slow | [`/tech-debt-scan`](../../.claude/skills/tech-debt-scan/SKILL.md) (handles both add + remove) |

Each file has **one job**. When a file does multiple jobs, every update prompts "what else needs updating?" and the friction kills the cadence. One job per file = bounded update friction.

ADR pattern follows Michael Nygard's [original 2011 essay](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions). Backlog patterns are GTD-flavored ([Getting Things Done](https://gettingthingsdone.com), David Allen) — append-only queues with status enums and named blockers.

GitHub issues remain JellyRock's primary backlog for issue-shaped work (bugs, features, public-facing requests). The four journals hold work that's *not* yet issue-shaped: ADRs, deferred internal followups, external watch state, and slow-decay debt.

### 3. Skills for the daily ritual

The central principle: **rules without skills drift**, because every rule that requires "remember to update X file at Y moment" eventually fails. Four skills cover the journal ritual:

| Skill | When | What it does |
|---|---|---|
| [`/catchup`](../../.claude/skills/catchup/SKILL.md) | Start of session, after multi-day gap, "what's the state of the world?" | Reads all 4 journals + GH state via the [`scripts/catchup-state.js`](../../scripts/catchup-state.js) aggregator (one Node call → JSON); banner-detects on stale `progress.md`, stale signal rows, failing CI, etc. |
| [`/focus`](../../.claude/skills/focus/SKILL.md) | Same moments as `/catchup`, but when multiple things look actionable and you want help picking | Same aggregator; ranks 3–5 next-move candidates across five tiers (Resume / Blocked / Drift / Hot / Momentum), surfaces a numbered menu with a "Recommended" call that cites the rule, then routes the user pick to the right downstream skill (`/issue-triage`, `/ci-triage`, `/done`, `/log`, `/tech-debt-scan`) with a session-context preamble. Opus (judgment-heavy); read-only |
| [`/log <type>`](../../.claude/skills/log/SKILL.md) | Any new entry: `decision`, `followup`, `signal`, `running` | Routes to the right journal with templated format; auto-bumps `last-updated:` on followup/signal append; diff-and-wait (never auto-applies) |
| [`/done <slug>`](../../.claude/skills/done/SKILL.md) | Any work landing: followup completed, signal resolved, cursor manually closed | Polymorphic match (followups first, then signals); for followups: removes bullet + prepends to "Recently shipped"; for signals: flips status → `completed`; bumps `last-updated:`. The `running` cursor close-loop normally fires automatically via [`journal-sync.yml`](../../.github/workflows/journal-sync.yml); manual `/done running` is the bypass path. |
| [`/pr`](../../.claude/skills/pr/SKILL.md) | Ship moment — opening a PR | Bundles the four-pillar judgment passes (tech-debt scan, decision-shape detect, followup capture from PR body) so journal hygiene lands in the same change set as the code |

Plus area-scoped variant [`/ramp <area>`](../../.claude/skills/ramp/SKILL.md) which uses the same aggregator with `--area=<name>` and adds area-specific file reads (scoped CLAUDE.md, matching architecture doc). Plus [`/tech-debt-scan`](../../.claude/skills/tech-debt-scan/SKILL.md) which handles the tech-debt journal independently and is invoked by `/pr` as part of the ship ritual.

The full skill index is at [`.claude/skills/README.md`](../../.claude/skills/README.md). Skill authoring conventions are in [`.claude/skills/CLAUDE.md`](../../.claude/skills/CLAUDE.md).

### 4. Enforcement (so rules don't depend on memory)

Five layers, fastest feedback first:

- **Session-start (SessionStart hook)**: [`session-start-nudge.sh`](../../.claude/hooks/session-start-nudge.sh) (calls [`scripts/lint/session-start-nudge.cjs`](../../scripts/lint/session-start-nudge.cjs)) prints a single advisory line at session start when local state is actionable (pending handoffs, stale `progress.md`, schema-broken journals); silent on clean state. Local-only — no network calls so it stays cheap and offline-tolerant. Surfaces the catchup-discipline rule at the one moment it applies.
- **Edit-time (Stop hook)**: three sibling hooks fire at end-of-turn — [`check-touched-related-files.sh`](../../.claude/hooks/check-touched-related-files.sh) (architecture-doc reminder), [`check-touched-lint.sh`](../../.claude/hooks/check-touched-lint.sh) (file-scoped lint surface), and [`check-progress-cursor.sh`](../../.claude/hooks/check-progress-cursor.sh) (stale `progress.md` + Currently-running cursor that overlaps with shipped commits). All three are advisory; never block.
- **Pre-push (husky)**: [`.husky/pre-push`](../../.husky/pre-push) runs the full validate / lint suite scoped to the push range PLUS two advisory nudges — [`decision-shape-nudge.cjs`](../../scripts/lint/decision-shape-nudge.cjs) (decision-shape commits without a `decisions.md` change) and [`progress-cursor-nudge.cjs`](../../scripts/lint/progress-cursor-nudge.cjs) (same checks as the Stop hook). Check steps abort the push; nudges never do.
- **Post-merge (GitHub Action)**: [`journal-sync.yml`](../../.github/workflows/journal-sync.yml) fires on PR merge to main and runs [`scripts/journal-sync.js`](../../scripts/journal-sync.js) — the *mechanical* close-loop side. Prepends a Recently shipped bullet, conditionally clears the Currently-running cursor (token-overlap heuristic), bumps `last-updated:`. Skips on `dependencies` / `documentation` / `ci` / `automated` labels and Renovate/Dependabot/bot authors. This layer is what turns the four-pillar pattern from "remember to invoke `/done running`" into automatic — judgment-bearing entries (decisions, tech-debt, followups) still flow through `/pr` → `/log`.
- **CI**: [`.github/workflows/lint-docs.yml`](../../.github/workflows/_lint-docs.yml) re-runs [`docs-check.cjs`](../../scripts/lint/docs-check.cjs) (broken refs + `progress-stale` + `signals-schema-invalid`) and [`docs-stale-blocking.cjs`](../../scripts/lint/docs-stale-blocking.cjs) (architecture-doc territory gate). Hard pressure at PR time.

Specifically for the journal layer:

- `progress.md` staleness gate — `docs-check.cjs` FAILs when `last-updated` is >7 days old AND there are commits since (the territory-touched logic is implicit: any commit means the cursor moved). The post-merge auto-sync layer is what keeps this gate quiet — without it, `last-updated:` only moves when the user remembers to invoke `/log` or `/done`.
- `signals-backlog.md` schema validator — `docs-check.cjs` FAILs on missing required bullets, invalid `status` enum, malformed `last_checked` ISO date, or non-positive `staleness_days`.
- `decisions.md` doesn't get a staleness gate (it's append-only — staleness is meaningless), but its body links + tech-debt anchors are validated.

## The principles

Distilled from the source-project's audit + reshape that preceded JellyRock's adoption:

**Architecture (the shape):**

- **One job per file** — multi-job files accumulate update-friction and silently rot.
- **Group by decay rate** — fast-decay sections in slow-decay files don't get updated; slow-decay in fast-decay get accidentally rewritten.
- **Single source of truth per concept** — duplication = drift.
- **Forward-only journals** — append-only history with `superseded by` linkage; don't retro-edit.

**UX (how you interact):**

- **Single capture entry point** (`/log`) — one ritual routes any kind of write.
- **Single retrieval entry point** (`/catchup`) — one ritual surfaces all state.
- **Capture and completion are different moments** — `/log` for new, `/done` for closing existing.
- **Action bias on retrieval** — `/catchup` surfaces ship-today candidates and banners drift, not just current state.

**Enforcement (what makes it stick):**

- **Automation closes loops; memory-dependent rules drift** — every rule the source-project's audit found broken was memory-dependent.
- **Friction at the cause-point, not the symptom** — pre-push nudge for decision-shaped commits, not a quarterly cleanup.
- **Drift surfaces visibly at retrieval** — banners, not buried sentences.
- **Agent tools NEVER auto-apply captures; CI mechanical sync is the sole exception** — `/log` and `/done` always surface a diff and wait. The journals are load-bearing project state, and a hallucinated entry written without confirmation is silent corruption. The post-merge [`journal-sync.yml`](../../.github/workflows/journal-sync.yml) workflow is the only non-skill writer to `progress.md` — it performs only the mechanical close-loop (deterministic, not judgment-bearing) using merged-PR metadata as input. The "no agent text-corruption" risk that motivated the diff-and-wait rule doesn't apply to deterministic CI on stable input.

**Meta (the iteration discipline):**

- **Build less first** — fewer files, sharper roles.
- **Don't defer enforcement** — the pattern that caused drift is "deferred things get forgotten."
- **Sub-agent capture rule** — delegated work has the same capture discipline; sub-agents NEVER write to journals directly, always surface for the parent to invoke `/log`.

## Lineage — what we borrow from

This system isn't novel; it's a hybrid of established patterns plus an emerging agent-collaborative layer:

- **ADRs** for the decisions log — Michael Nygard, 2011 ([essay](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions))
- **Diátaxis** for the static-knowledge IA — Daniele Procida ([diataxis.fr](https://diataxis.fr))
- **Docs-as-code** for the lint + CI + versioning discipline — broad GitOps-adjacent movement
- **GTD / PKM** for the backlog / queue / "next action" patterns — David Allen's [Getting Things Done](https://gettingthingsdone.com), Tiago Forte's [Building a Second Brain (PARA)](https://www.buildingasecondbrain.com), Niklas Luhmann's Zettelkasten
- **Agent-collaborative project memory** — emerging convention; `CLAUDE.md` / `AGENTS.md` / Cursor rules / skills as encoded workflows. No canonical name yet.

If forced to label the union in one phrase: **"agent-collaborative engineering journal with ADR + Diátaxis + skill-driven capture/completion."** The shorter shape: **"four-journal + skill-driven workflow."**

## Audience tuning

This shape is optimized for **one developer + AI agents** (Charlie + Claude Code + sub-agents). The compressed jargon, the heavy CLAUDE.md tree, the lack of a strict tutorial bucket — all of these would be wrong for an open-source project with multiple active contributors. They're right here because the audience is one human and his AI collaborators, not a public team.

JellyRock IS public OSS, but the contributor flow is currently low. If outside-contributor pressure shows up, the right move is **add an onboarding surface on top, don't replace the internals**: a more contributor-friendly `CONTRIBUTING.md`, at least one strict-tutorial walkthrough taking a stranger from `git clone` → first successful build → first PR, and possibly a public-facing `CHANGELOG.md` distinct from the internal "Recently shipped" prose. Internals stay solo+AI optimized.

## Why this doc lives in `architecture/`

`docs/architecture/` is for *explanation* (Diátaxis terminology) — the why and shape of subsystems. The dev-process journal system IS a subsystem; it just happens to operate on prose files instead of BrightScript. Living here means it gets the same `last-reviewed` freshness gate as other architecture docs.

## When this doc is wrong

When the system shape changes, this doc changes in the same commit. Specifically: adding / retiring a journal, reshaping the skill triplet, adding / removing a load-bearing pillar, or changing the lineage citations. Tactical edits (adding a workflow-specific skill, tightening a lint check) don't require updating here — the per-skill READMEs and root [`CLAUDE.md`](../../CLAUDE.md) cover those.

`last-reviewed` frontmatter triggers `npm run docs:stale` WARN at 90 days and the CI-blocking gate at 120 days when this file's territory is touched.
