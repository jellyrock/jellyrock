# JellyRock skills + agents

Project-local skills and agents that wrap recurring JellyRock workflows. Skills live at `.claude/skills/<name>/SKILL.md` and are invoked via `/<name>` (slash commands). Agents live at `.claude/agents/<name>.md` and are invoked via the Task tool with `subagent_type: <name>`.

This file is the index. The authoring conventions live in [`CLAUDE.md`](CLAUDE.md). For the *why* and *shape* of each subsystem the skills target, load the relevant doc from [`docs/architecture/`](../../docs/architecture/).

## Skills

### Daily / per-task

| Skill | Model | One-line | When |
|---|---|---|---|
| [`/pr`](pr/SKILL.md) | sonnet | Create OR update a PR using the JellyRock template + run the four-pillar judgment passes (tech-debt scan, decision-shape detect, followup capture). Detects existing open PR for the branch and routes to update-mode (diff body, ask, `gh pr edit`); aborts on merged/closed PRs. Judgment passes scope to since-last-render via a hidden body marker on update. Mechanical close-loop fires after merge via [`journal-sync.yml`](../../.github/workflows/journal-sync.yml). | Anytime you'd otherwise run `gh pr create` or `gh pr edit` directly — the ship moment for the four-pillar journal flow |
| [`/catchup`](catchup/SKILL.md) | sonnet | Session-start briefing via `scripts/catchup-state.js` aggregator (git + GH + four journals) | Start of any genuine new session |
| [`/focus`](focus/SKILL.md) `[--area=<name>]` | opus | Session-start triage — ranked menu of 3–5 next-move candidates across five tiers (Resume / Blocked / Drift / Hot / Momentum), with a "Recommended" call + routing to the right downstream skill. Same aggregator as `/catchup`; read-only | When multiple things look actionable and you want help picking; vs `/catchup` which is state-only |
| [`/ramp`](ramp/SKILL.md) `<area>` | sonnet | Area-scoped deep-dive briefing (uses aggregator with `--area=`) | Switching into an area not touched in >2 weeks |
| [`/log`](log/SKILL.md) `<type>` | sonnet | Append/update a journal entry — routes `decision` / `followup` / `signal` / `running` to the right file. Diff-and-wait. | After a decision-shaped commit, when deferring non-debt work, when adding a new upstream watch row, or when changing what's in flight |
| [`/done`](done/SKILL.md) `<slug-or-running>` | sonnet | Close a journal entry — followup → recently-shipped, signal → completed status, or `running` cursor → recently-shipped | When a deferred followup ships, a watched signal resolves, or in-flight work completes |
| [`/tech-debt-scan`](tech-debt-scan/SKILL.md) | sonnet | Pre-PR debt sweep (resolved + new) | Before opening a PR for any non-trivial change |

### Investigation flows (single-file opus skills)

Each: an opus skill does prep (fetch, parse, classify, build context packet) + writes a handoff file to `.claude/handoffs/` for compaction recovery / `/catchup` discovery / cross-session resume + continues into the per-skill investigation contract at sibling `INVESTIGATION.md`. End-to-end, in main thread, no Task delegation — human-in-the-loop the entire time. Dedup-first: a recent unchanged triage on the same target short-circuits to the existing handoff.

| Skill | Investigation contract | What |
|---|---|---|
| [`/pr-review`](pr-review/SKILL.md) `<N>` | [`pr-review/INVESTIGATION.md`](pr-review/INVESTIGATION.md) | Investigate unresolved PR review comments one at a time |
| [`/issue-triage`](issue-triage/SKILL.md) `<N>` | [`issue-triage/INVESTIGATION.md`](issue-triage/INVESTIGATION.md) | Diagnose + semi-auto-fix or present-options for a GitHub issue |
| [`/runtime-triage`](runtime-triage/SKILL.md) `<paste>` | [`runtime-triage/INVESTIGATION.md`](runtime-triage/INVESTIGATION.md) | Diagnose a Roku log / crash / unexpected behavior |
| [`/ci-triage`](ci-triage/SKILL.md) `<run-id>` | [`ci-triage/INVESTIGATION.md`](ci-triage/INVESTIGATION.md) | Diagnose a failing GitHub Actions run |

### Source-of-truth bridges

| Skill | Model | What |
|---|---|---|
| [`/create-issue`](create-issue/SKILL.md) | sonnet | Draft + submit a GitHub issue from a Reddit/Discord/freeform report, using the YAML form templates |
| [`/crash-report`](crash-report/SKILL.md) `<csv-or-zip-path> [--dashboard-csv <path>]` | opus | Turn Roku's weekly aggregate crash CSV (or a zip containing one or more CSVs) into tracked GH issues — one per above-threshold unique crash. Resolves transpiled `.brs:line` back to source `.bs:line` via source maps built in a temporary git worktree (Mozilla's `source-map` library directly). Dedup-aware (comments on open match, reopens closed match as regression). Per-crash deep-dive offloaded to `/issue-triage <N>`; per-issue backtrace enrichment offloaded to `/crash-backtrace <N>` |
| [`/crash-backtrace`](crash-backtrace/SKILL.md) `[<N>] @<file>...` | sonnet | Attach a multi-frame backtrace + locals snapshot from Roku's analytics dashboard to an already-filed crash issue. Auto-resolves the matching `[crash]` issue from the backtrace's innermost frame signature — issue number is optional. Batch mode: `/crash-backtrace @file1 @file2 @file3` enriches each file's auto-resolved issue in sequence. Accepts via `@file` reference(s) OR inline paste. Pre-enrichment classifier flags known-noise patterns (`timeout-one-off` → close, `timeout-recurring` → enrich + escalate, `global-constants-init-race-suspect` → close as dup of #103). Worktree cache (~1h TTL at `/tmp/jellyrock-crash-wt-cache-<tag>`) makes consecutive same-version enrichments near-instant. The per-issue follow-up to `/crash-report` |
| [`/docs-lint`](docs-lint/SKILL.md) | sonnet | Run docs validators with a structured fix list, grouped by category |
| [`/audit-skill`](audit-skill/SKILL.md) `<name>` | opus | Audit a skill's recent execution, propose SKILL.md edits + assess model fit |

### Workflow guides (procedural — wrap a `docs/dev/*.md` recipe)

| Skill | Model | Wraps |
|---|---|---|
| [`/new-setting`](new-setting/SKILL.md) | sonnet | [`docs/dev/new-user-setting.md`](../../docs/dev/new-user-setting.md) |
| [`/new-migration`](new-migration/SKILL.md) | sonnet | [`docs/dev/registry-migrations.md`](../../docs/dev/registry-migrations.md) |
| [`/translation-add`](translation-add/SKILL.md) | sonnet | [`locale/CLAUDE.md`](../../locale/CLAUDE.md) + [`docs/dev/translations.md`](../../docs/dev/translations.md) |

## Agents

Agents are invoked via the Task tool. The four triage workflows used to have paired investigator agents (`issue-investigator`, `pr-review-investigator`, `runtime-investigator`, `ci-investigator`); those were retired in favor of single-file opus skills with sibling `INVESTIGATION.md` contracts (see the audit log at `.claude/skills/issue-triage/AUDIT-LOG.md`). The remaining agents are genuinely sub-agent-shaped — narrow, scoped, return-and-done.

| Agent | Model | One-line | When |
|---|---|---|---|
| [`log-reviewer`](../agents/log-reviewer.md) | sonnet | Surgical roku-log audit — defaults to AUDIT-ONLY, never blanket-adds | When you want a read on logging adequacy in a file/function |
| [`pattern-finder`](../agents/pattern-finder.md) | sonnet | Find the canonical JellyRock implementation pattern | Before adding new code — surfaces precedent + governing rule |

## Decision matrix — skill vs agent vs runbook vs hook

| Use a... | When... | Lives at... |
|---|---|---|
| **Skill** | Slash-invokable structured workflow with reasoning. Reads state, makes recommendations, optionally applies edits with confirmation. | `.claude/skills/<name>/SKILL.md` |
| **Agent** | Long-running judgment-heavy investigation. Receives prepped context from a skill OR is invoked directly for open-ended work. Returns options or applies a controlled fix. | `.claude/agents/<name>.md` |
| **Runbook** | Mechanical step-by-step checklist for a recurring change shape. Pure how-to, no reasoning. | `docs/how-to/<name>.md` |
| **Hook** | Automatic trigger on a tool event (Edit, Write, etc.). Side effect: nudges the agent or runs a check. | `.claude/hooks/<name>.sh` |

Rule of thumb: if you'd ever type `/<name>` to invoke it → skill. If it's "deep judgment given context" → agent. If it's "follow N steps every time you do X" with no decision-making → runbook. If it should fire automatically on a file pattern → hook.

A workflow can combine these. Example: `/issue-triage` (skill) does prep + investigation end-to-end in main thread; the [`bsfmt-on-write`](../hooks/bsfmt-on-write.sh) hook auto-formats `.bs` files when edits land; deferred work surfaces in the [`tech-debt.md`](../../docs/architecture/tech-debt.md) inventory (de-facto runbook for "track follow-up scope").

## Sub-agent invocation

Sub-agents spawned via the Task tool (Explore / general-purpose / Plan / agents listed above) do NOT auto-inherit the parent's loaded skill manifest — they have their own initial context. To use a project skill from a sub-agent, the parent must hand off explicitly:

```text
Read .claude/skills/<name>/SKILL.md and follow the steps for $ARGUMENTS=<…>.
Report the structured output.
```

Every project skill has a "Sub-agent invocation" section at the bottom of its SKILL.md spelling this out. The convention is load-bearing: skills are designed to be **standalone runbooks** that work whether invoked by a human, the main loop, or a sub-agent reading the file directly.

## How to add a new skill

See the full how-to in [`CLAUDE.md`](CLAUDE.md). Quick version:

1. Decide it's actually a skill (use the decision matrix above).
2. Create `.claude/skills/<name>/SKILL.md` with frontmatter:

   ```yaml
   ---
   name: <kebab-case-name>
   description: <precise trigger language; agents use this to decide when to invoke. Be specific about prerequisites, scope, and what the skill returns.>
   model: sonnet | opus | haiku
   ---
   ```

3. Body: short tagline → Inputs → numbered steps → "When NOT to use" → "Sub-agent invocation".
4. Update this README — add a row to the right table + (if it's a major addition) a per-skill detail section.
5. If the skill introduces new bash shapes, allowlist them in `.claude/settings.json` in the same change set.
6. Smoke-test: spawn an Explore agent with `Read .claude/skills/<name>/SKILL.md and follow the steps for $ARGUMENTS=<test>; report the output`. Confirm structured + actionable output without further hand-holding.
7. `npm run lint:docs` to confirm no broken refs.

## How to add a new agent

Agents are simpler: just `.claude/agents/<name>.md` with frontmatter (`name`, `description`, `model`, `color`) and a system prompt body. Conventions:

- **Color**: pick something distinct from the existing palette (yellow / green / blue / red / cyan / purple are taken).
- **Operating contract**: explicitly list what the agent will and won't do. Critical constraints belong here, not buried in step prose.
- **Handoff shape**: if the agent is paired with a skill, document what the skill hands it. If standalone, document what the user typically passes.
- Update this README's Agents table.
