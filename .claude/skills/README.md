# JellyRock skills and agents

Project skills and agents that wrap recurring JellyRock workflows. A skill lives at `.claude/skills/<name>/SKILL.md` and runs as `/<name>`. An agent lives at `.claude/agents/<name>.md` and runs through the Agent tool with `subagent_type: <name>`.

This file is the index. Each skill's own `description` is the full summary; a row here is one line. The rules for writing and changing a skill are in [`CLAUDE.md`](CLAUDE.md). For the *why* and *shape* of the subsystem a skill targets, read its doc in [`docs/architecture/`](../../docs/architecture/).

## Skills

### Contributing

| Skill | Model | What | When |
|---|---|---|---|
| [`/report-issue`](report-issue/SKILL.md) | sonnet | Draft a bug report or feature request from the issue forms, check for duplicates, and open the form with the draft filled in | When you have a bug or an idea to report |
| [`/open-pr`](open-pr/SKILL.md) | sonnet | Draft a pull request from the template and the title rule, and open GitHub's new pull request page with it filled in | When your branch is ready for review |

### Daily work

| Skill | Model | What | When |
|---|---|---|---|
| [`/release-summary`](release-summary/SKILL.md) `[version]` | sonnet | Draft the summary at the top of a release's notes: a short paragraph naming what a user would notice, with the other fixes counted, checked by a script and written into the draft on your ok | When the release's draft is ready, before you publish it |
| [`/ramp`](ramp/SKILL.md) `<area>` | sonnet | A briefing on one area: its rules, docs, tech debt and recent commits | Coming back to an area after more than two weeks |

### Bridges to outside sources

| Skill | Model | What |
|---|---|---|
| [`/crash-report`](crash-report/SKILL.md) `<csv-or-zip>` | opus | Turn Roku's weekly crash CSV into issues and epic evidence: stage, enrich with pasted backtraces, then file |
| [`/server-upgrade`](server-upgrade/SKILL.md) `[<report>]` | opus | Triage a Jellyfin server release against the app's API usage, on its release-triage digest issue |
| [`/dep-major`](dep-major/SKILL.md) `<PR# \| package>` | opus | Review a major dependency bump: changelog, affected call sites, the gate for its type, a go or no-go |

### Guided recipes (each wraps a `docs/dev/` how-to)

| Skill | Model | Wraps |
|---|---|---|
| [`/new-setting`](new-setting/SKILL.md) | sonnet | [`docs/dev/new-user-setting.md`](../../docs/dev/new-user-setting.md) |
| [`/new-migration`](new-migration/SKILL.md) | sonnet | [`docs/dev/registry-migrations.md`](../../docs/dev/registry-migrations.md) |
| [`/new-api-version`](new-api-version/SKILL.md) | sonnet | [`docs/dev/jellyfin-server-versioning.md`](../../docs/dev/jellyfin-server-versioning.md#add-an-api-tier): a new API tier, after `/server-upgrade` finds a breaking shift |
| [`/translation-add`](translation-add/SKILL.md) | sonnet | [`locale/CLAUDE.md`](../../locale/CLAUDE.md) and [`docs/dev/translations.md`](../../docs/dev/translations.md) |
| [`/translation-import`](translation-import/SKILL.md) | opus | [`docs/dev/translations.md`](../../docs/dev/translations.md#map-a-key) and [`locale/seed/keymap.yml`](../../locale/seed/keymap.yml) |

## Agents

An agent runs through the Agent tool. None is tracked today; the table below says when one fits.

## Skill, agent, how-to or hook?

| Use a... | When... | Lives at... |
|---|---|---|
| **Skill** | A workflow you invoke with a slash command, with reasoning: it reads state, recommends, and may apply edits with confirmation. | `.claude/skills/<name>/SKILL.md` |
| **Agent** | A focused investigation given prepared context, either from a skill or directly. It returns options or applies a controlled fix. | `.claude/agents/<name>.md` |
| **How-to** | Steps for a recurring change, with no decisions to make. | `docs/dev/<name>.md` |
| **Hook** | An automatic trigger on a tool event (Edit, Write and so on) that nudges the agent or runs a check. | `.claude/hooks/<name>.sh`, wired in `.claude/settings.json` |

Rule of thumb: if you'd type `/<name>` to run it, it's a skill. Judgment given context is an agent. "Follow N steps every time you do X" with no decisions is a how-to. Something that should fire on its own is a hook.

They combine. `/crash-report` (a skill) stages, enriches and files in the main conversation; the [`bsfmt-on-write`](../hooks/bsfmt-on-write.sh) hook formats `.bs` files as edits land; and deferred work goes to the [`tech-debt.md`](../../docs/architecture/tech-debt.md) inventory.

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

- **Color:** pick one distinct from any agents already there.
- **Operating contract:** list what the agent will and won't do. Hard constraints go here, not deep in the steps.
- **What it receives:** if a skill calls the agent, say what the skill hands it; if it stands alone, say what the user usually passes.
- Add a row to the Agents table in this README.
