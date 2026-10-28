# JellyRock skills and agents

Project skills and agents that wrap recurring JellyRock workflows. A skill lives at `.claude/skills/<name>/SKILL.md` and runs as `/<name>`. An agent lives at `.claude/agents/<name>.md` and runs through the Agent tool with `subagent_type: <name>`.

This file is the index. Each skill's own `description` is the full summary; a row here is one line. The rules for writing and changing a skill are in [`CLAUDE.md`](CLAUDE.md). For the *why* and *shape* of the subsystem a skill targets, read its doc in [`docs/architecture/`](../../docs/architecture/).

## Skills

### Daily work

| Skill | Model | What | When |
|---|---|---|---|
| [`/pr`](pr/SKILL.md) | sonnet | Create or update a PR: a typed title, labels, a body that reads as the squash commit, a review-notes comment, and the journal passes (tech debt, decision shape, followups) | Every PR, in place of `gh pr create` |
| [`/catchup`](catchup/SKILL.md) | sonnet | State briefing: git, the journal and projects, plus the `scripts/catchup-state.js` aggregator (GitHub, signals, decisions, tech debt) | The start of a new session |
| [`/focus`](focus/SKILL.md) `[--area=<name>]` | opus | Picks one next move from the same state as `/catchup`, with alternatives and the command to take it | When several things look actionable |
| [`/ramp`](ramp/SKILL.md) `<area>` | sonnet | A briefing on one area: its rules, docs, tech debt and recent commits | Coming back to an area after more than two weeks |
| [`/log`](log/SKILL.md) `<type>` | sonnet | Write a journal entry: `decision`, `followup`, `signal` or `running` | When there is something to record |
| [`/done`](done/SKILL.md) `<fid-or-slug>` | sonnet | Close a journal entry once its work is committed | When a followup, signal or running item is finished |
| [`/snag`](snag/SKILL.md) `<flaw>` | opus | A flaw found mid-work: investigate it read-only, then one decision screen with the fixes and when to make them | The moment a defect surfaces during other work |
| [`/second-opinion`](second-opinion/SKILL.md) `<what>` | opus | A review from a clean context: one item improved, or several compared without bias | When you type it, or reply `second-opinion` on a decision screen |
| [`/sonnet`](sonnet/SKILL.md) `<plan>` | sonnet | Run a procedural plan with no open questions on Sonnet, stopping before push | A plan `/focus` saved, or one you hand it |
| [`/tech-debt-scan`](tech-debt-scan/SKILL.md) | sonnet | Sweep `tech-debt.md` for entries the branch resolved, narrowed or added | Before a PR for any non-trivial change (`/pr` runs it) |

### Tracked projects

| Skill | Model | What |
|---|---|---|
| [`/start-project`](start-project/SKILL.md) | opus | Begin a tracked project in the projects folder, with its PLAN and Charter |
| [`/resume-project`](resume-project/SKILL.md) `<slug>` | sonnet | Load a project and its kickoff, with a continuity check |
| [`/end-session`](end-session/SKILL.md) | opus | Close a project session: update the PLAN, commit and push. The user types it |

### Investigations

Each runs end to end in the main conversation on opus, with the user in the loop throughout. `/issue-triage` and `/ci-triage` investigate, then follow `/snag`'s steps from its decision screen on: the user picks the fix, which is built test-first and committed on a `fix/…` branch, never pushed. `/ci-triage` reads the run through its tested `ci-triage-state.sh`, which classifies each failed step against [`ci-triage/gates.tsv`](ci-triage/gates.tsv). `/runtime-triage` writes a handoff file to `.claude/handoffs/` (for compaction, `/catchup` and resuming in another session) and continues into its `INVESTIGATION.md`.

| Skill | Investigation | What |
|---|---|---|
| [`/issue-triage`](issue-triage/SKILL.md) `<N>` | its Steps 2 to 8, then [`/snag`](snag/SKILL.md)'s | A GitHub issue |
| [`/runtime-triage`](runtime-triage/SKILL.md) `<paste>` | [`runtime-triage/INVESTIGATION.md`](runtime-triage/INVESTIGATION.md) | A Roku log, crash or unexpected behavior |
| [`/ci-triage`](ci-triage/SKILL.md) `<run-id>` | its Steps 2 to 7, then [`/snag`](snag/SKILL.md)'s | A failed GitHub Actions run |

### Bridges to outside sources

| Skill | Model | What |
|---|---|---|
| [`/create-issue`](create-issue/SKILL.md) | sonnet | Draft and file a GitHub issue from a report, using the issue form templates |
| [`/crash-report`](crash-report/SKILL.md) `<csv-or-zip>` | opus | Turn Roku's weekly crash CSV into issues and epic evidence: stage, enrich with pasted backtraces, then file |
| [`/crash-backtrace`](crash-backtrace/SKILL.md) | sonnet | **Deprecated:** `/crash-report`'s `enrich` phase replaced it. Kept only as a redirect |
| [`/server-upgrade`](server-upgrade/SKILL.md) `[<report>]` | opus | Triage a Jellyfin server release against the app's API usage, on its release-triage digest issue |
| [`/dep-major`](dep-major/SKILL.md) `<PR# \| package>` | opus | Review a major dependency bump: changelog, affected call sites, the gate for its type, a go or no-go |
| [`/docs-lint`](docs-lint/SKILL.md) | sonnet | Run the docs validators and propose fixes, grouped by category |

### Guided recipes (each wraps a `docs/dev/` how-to)

| Skill | Model | Wraps |
|---|---|---|
| [`/new-setting`](new-setting/SKILL.md) | sonnet | [`docs/dev/new-user-setting.md`](../../docs/dev/new-user-setting.md) |
| [`/new-migration`](new-migration/SKILL.md) | sonnet | [`docs/dev/registry-migrations.md`](../../docs/dev/registry-migrations.md) |
| [`/new-api-version`](new-api-version/SKILL.md) | sonnet | [`docs/dev/jellyfin-server-versioning.md`](../../docs/dev/jellyfin-server-versioning.md#add-an-api-tier): a new API tier, after `/server-upgrade` finds a breaking shift |
| [`/translation-add`](translation-add/SKILL.md) | sonnet | [`locale/CLAUDE.md`](../../locale/CLAUDE.md) and [`docs/dev/translations.md`](../../docs/dev/translations.md) |

## Agents

An agent runs through the Agent tool. The triage workflows once had paired investigator agents; single-file opus skills with an `INVESTIGATION.md` replaced them (the audit log is `.claude/skills/issue-triage/AUDIT-LOG.md`). The remaining agents are narrow and scoped: they report and finish.

| Agent | Model | What | When |
|---|---|---|---|
| [`log-reviewer`](../agents/log-reviewer.md) | sonnet | Audits roku-log use in a file; audit only by default, never blanket-adds logs | For a read on whether a file's logging is adequate |
| [`pattern-finder`](../agents/pattern-finder.md) | sonnet | Finds the canonical JellyRock pattern for a task, with its governing rule | Before adding new code |

## Skill, agent, how-to or hook?

| Use a... | When... | Lives at... |
|---|---|---|
| **Skill** | A workflow you invoke with a slash command, with reasoning: it reads state, recommends, and may apply edits with confirmation. | `.claude/skills/<name>/SKILL.md` |
| **Agent** | A focused investigation given prepared context, either from a skill or directly. It returns options or applies a controlled fix. | `.claude/agents/<name>.md` |
| **How-to** | Steps for a recurring change, with no decisions to make. | `docs/dev/<name>.md` |
| **Hook** | An automatic trigger on a tool event (Edit, Write and so on) that nudges the agent or runs a check. | `.claude/hooks/<name>.sh`, wired in `.claude/settings.json` |

Rule of thumb: if you'd type `/<name>` to run it, it's a skill. Judgment given context is an agent. "Follow N steps every time you do X" with no decisions is a how-to. Something that should fire on its own is a hook.

They combine. `/issue-triage` (a skill) prepares and investigates in the main conversation; the [`bsfmt-on-write`](../hooks/bsfmt-on-write.sh) hook formats `.bs` files as edits land; and deferred work goes to the [`tech-debt.md`](../../docs/architecture/tech-debt.md) inventory.

## Sub-agent invocation

A sub-agent started through the Agent tool (Explore, general-purpose, Plan, or an agent above) does not inherit the parent's loaded skills: it starts with its own context. To run a project skill in a sub-agent, the parent hands it over explicitly:

```text
Read .claude/skills/<name>/SKILL.md and follow the steps for <the arguments>.
Report the structured output.
```

A skill that can run from a sub-agent ends with a `## Sub-agent invocation` section giving the exact prompt. Skills are written to work the same whether a person runs them, the main conversation does, or a sub-agent reads the file.

## How to add a new skill

The rules for writing one are in [`CLAUDE.md`](CLAUDE.md). The steps:

1. Decide it is a skill (the table above).
2. Create `.claude/skills/<name>/SKILL.md` with frontmatter:

   ```yaml
   ---
   name: <kebab-case-name>
   description: <precise trigger language; agents use it to decide when to invoke. Say what it needs, its scope, and what it returns.>
   model: sonnet | opus | haiku
   ---
   ```

3. The body: a short tagline, Inputs, numbered steps, "When not to use", and "Sub-agent invocation" if it can run from a sub-agent.
4. Add a row to the right table in this README.
5. If the skill runs a new command shape, add an allow rule to `.claude/settings.json` in the same change.
6. Test it: start a sub-agent with `Read .claude/skills/<name>/SKILL.md and follow the steps for <test input>; report the output`, and check the output is structured and usable with no further help.
7. Run `npm run lint:docs`. It doesn't scan `.claude/`, so check the links in this README by hand.

## How to add a new agent

An agent is `.claude/agents/<name>.md` with frontmatter (`name`, `description`, `model`, `color`) and a system prompt as the body:

- **Color:** pick one distinct from the agents already there (cyan and purple are taken).
- **Operating contract:** list what the agent will and won't do. Hard constraints go here, not deep in the steps.
- **What it receives:** if a skill calls the agent, say what the skill hands it; if it stands alone, say what the user usually passes.
- Add a row to the Agents table in this README.
