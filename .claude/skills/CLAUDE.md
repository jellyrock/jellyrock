# Rules for authoring and editing skills

Loaded automatically when working in `.claude/skills/`. The skill index and the steps for adding a skill (frontmatter shape, body structure, README row, sub-agent test) are in [`README.md`](README.md). This file holds the rules an agent has to know before editing or creating any `SKILL.md`: mistakes that look fine to a human reviewer but break the agent's contract.

## Formatting for an agent reader

An agent runs a `SKILL.md`; a person reads it to improve it or to do the task by hand. Format for both:

- **Don't hard-wrap paragraphs.** Each paragraph is one long line. Wrapping at 72 or 80 characters adds line breaks that help neither reader, and markdownlint doesn't check line length here (`MD013` is off).
- **Keep the sub-agent prompt on one source line.** A skill that can run from a sub-agent ends with a `## Sub-agent invocation` section holding the prompt a parent passes word for word. Never wrap that prompt across lines.
- **Code fences and bullets stay structural.** Don't fold them into prose to avoid line breaks: the agent reads the structure.

The same rules apply to the other agent files in this tree: nested `CLAUDE.md` files and the agent definitions under [`.claude/agents/`](../agents/).

## Before adding a new skill

Read [How to add a new skill](README.md#how-to-add-a-new-skill) in this directory's README. Don't derive the conventions from a single existing skill: sample at least three, since the body shape varies by skill type.

## Model fit

Every skill pins a model in frontmatter (`model: opus | sonnet | haiku`). The choice tracks the actual reasoning load. Procedural workflows (checklists and step-by-step recipes such as `/pr`, `/log` and `/new-setting`) belong on sonnet. Judgment-heavy skills (`/runtime-triage`, `/ci-triage`) belong on opus. Pure data assembly with no judgment could go on haiku; no skill here uses it. After a few real runs, check whether the assigned model still fits.

## When you change a skill

- A new helper script under `.claude/skills/<name>/`? `Bash(node .claude/skills/*)` in `.claude/settings.json` already allows a Node helper. For any other command shape the helper introduces (a `bash` script, a `gh` subcommand), add an allow rule to `.claude/settings.json` in the same change, so the permission prompt doesn't fire mid-skill. Project settings reach every contributor; personal overrides go in `.claude/settings.local.json`.
- Changed a step's intent? Update the skill's row in [`README.md`](README.md).
- Touched a file listed in an architecture doc's `related-files:` frontmatter? The [Doc maintenance discipline](../../CLAUDE.md#doc-maintenance-discipline) in the root `CLAUDE.md` applies. The skills tree is not architecture-doc territory itself, but a skill change can touch a file that is (a validator `/docs-lint` runs, for example).

## When you retire a skill

1. Confirm it's obsolete, which is a judgment call: nobody invokes it any more, its workflow is automated elsewhere, or audits of its runs show it never finds anything useful.
2. Find every reference: `grep -rn "/<name>" CLAUDE.md docs/ .claude/`. Fix or remove each one.
3. `git rm -r .claude/skills/<name>/`.
4. Remove its row from [`README.md`](README.md).
5. Invoke `/log decision` with slug `retire-<name>-skill` to record why. The Capture-discipline rule in the root [`CLAUDE.md`](../../CLAUDE.md) requires it.
6. Run `npm run lint:docs`. It catches a broken link to the removed files; only the grep in step 2 catches a plain mention.
