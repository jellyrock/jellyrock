# `.claude/skills/CLAUDE.md` — rules for authoring + editing skills

Loaded automatically when working in `.claude/skills/`. The full authoring conventions (frontmatter shape, body structure, helper-script co-location, README index update, sub-agent invocation pattern) live in [`README.md`](README.md). This file pins the load-bearing rules an agent MUST internalize before editing or creating any SKILL.md — the kind of mistakes that look fine to a human reviewer but rot the agent contract.

## Audience-driven formatting

SKILL.md files are consumed by **agents**, not humans. That changes the formatting calculus:

- **Don't hard-wrap paragraphs.** Prose runs as long flowing lines. Hard wrapping at ~72/80 chars adds extra `\n` tokens that don't aid agent comprehension and only exist as a human-readability affordance the audience doesn't need. Markdownlint's MD013 line-length rule is disabled across the project; respect that.
- **One-line "Sub-agent invocation" tail.** The closing section is a single sentence ending with the backticked invocation string and a brief follow-up. Never wrap the backticked instruction across multiple source lines — it's a literal blob the parent passes verbatim to the Task tool.
- **Code fences and bullets stay structural.** Don't fold them into prose just because "no hard wrap" — they convey intent the agent uses for parsing.

The same rule applies to other agent-targeted markdown in this tree: nested `CLAUDE.md` files, hook documentation comments, and agent definitions under [`.claude/agents/`](../agents/).

## Before adding a new skill

Read the [How to add a new skill](README.md#how-to-add-a-new-skill) section in this directory's README. The frontmatter shape, body structure, README index update, and sub-agent test are all covered there. Don't try to derive the conventions from a single existing skill — sample at least three (the body shape varies by skill type).

## Model-fit hygiene

Every skill pins a model in frontmatter (`model: opus | sonnet | haiku`). The choice should track the actual reasoning load, not aspiration. Procedural workflows (mechanical checklists, structured runbooks like `/pr`, `/log`, `/new-setting`) belong on sonnet; judgment-heavy skills (`/audit-skill`, `/runtime-triage`, `/ci-triage`) belong on opus; pure data assembly with no judgment seams could go on haiku (none currently in JellyRock). After a few real invocations, run [`/audit-skill <name>`](audit-skill/SKILL.md) to assess whether the assigned model still fits — the helper's `model_fit` profile surfaces sub-agent / TodoWrite / AskUserQuestion / verbose-text signals as evidence for downgrade or upgrade.

## When you change a skill

- New helper script under `.claude/skills/<name>/`? Allowlist `Bash(node .claude/skills/<name>/<script>:*)` (or whichever bash shape the helper introduces) in `.claude/settings.json` in the same change set. Project-level settings benefit all contributors; user-local overrides go in `.claude/settings.local.json`.
- New bash shape the skill invokes (e.g., a `gh` subcommand not already in the allowlist)? Same — add it to `.claude/settings.json` so the prompt doesn't fire mid-skill.
- Changed a step's intent? Mirror the change in the at-a-glance row + per-skill detail in [`README.md`](README.md).
- The change is audit-driven (came out of `/audit-skill`)? Append a section to the audited skill's `AUDIT-LOG.md` per the per-skill audit-log convention. Only invoke `/log decision` if the audit produced an architectural-grade change (new agent, model change, new helper script, hook change, or load-bearing-rule change in `CLAUDE.md`).
- Touched a file listed in any architecture doc's `related-files:` frontmatter? Read [`/CLAUDE.md`'s Doc maintenance discipline section](../../CLAUDE.md#doc-maintenance-discipline) — same rule applies here. The skills tree is its own subsystem and lives outside the architecture-doc tree, but if you touched an architecture-doc-territory file as part of a skill change (e.g., updated a validator referenced by `/docs-lint`), the architecture-doc rule fires.

## When you retire a skill

1. Confirm it's actually obsolete — judgment call. Inbound usage dropped to zero, the workflow it codifies has been automated elsewhere, or repeated `/audit-skill` runs show it never surfaces useful friction.
2. Search for inbound references: `grep -rn "/skill-name" CLAUDE.md docs/ .claude/` — fix or remove every backtick reference.
3. `git rm -r .claude/skills/<name>/`.
4. Remove the row from [`README.md`](README.md)'s at-a-glance table + the per-skill detail section.
5. Invoke `/log decision` with slug `retire-<name>-skill` to capture the rationale. Mandated by the Capture-discipline rule in root [`CLAUDE.md`](../../CLAUDE.md).
6. Run `npm run lint:docs` to confirm no orphan references remain.
