---
name: sonnet
model: sonnet
effort: low
description: Execute a procedural implementation plan saved at `.claude/plans/focus-YYYY-MM-DD-slug.md` using the Sonnet model for token savings. Invoked as `/sonnet <plan-path>`, or by a parent agent after `/focus` surfaces an ad-hoc quick-fix hand-off block. Reads the plan top-to-bottom, applies the edits using JellyRock's canonical npm wrappers (`npm run validate`, `npm run test:scripts`, `npm run test:tdd`, `npm run lint`), runs the plan's Verification gates, surfaces a commit proposal, and stops before push for explicit user OK. NOT for judgment-heavy work — if the plan still has open forks, architectural decisions, or "we need to figure out X" gaps, stay on Opus and finish the planning side first via `/focus`. NOT for investigation/recipe work that already has a dedicated skill (`/ci-triage`, `/issue-triage`, `/new-setting`, …) — the recipe is the better plan.
---

# /sonnet — execute a procedural plan with token savings

## Contract

**Goal.** A clear-spec implementation plan doesn't need a judgment-grade model's reasoning budget — it needs careful execution. This skill is the cheap path for that half. Default project model is the judgment-grade model (Opus class) for architectural decisions and anything with a fork in it; when the upstream work has already produced a written plan and the next step is "do what the plan says", `/sonnet <plan-path>` runs the same implementation on Sonnet at a fraction of the token cost. Parents (the user, or a judgment-grade parent agent that just finished `/focus`) decide when to opt in. The skill's `model: sonnet` frontmatter is the load-bearing mechanism — the harness picks up the field and switches model for the invocation.

**Inputs.** `$ARGUMENTS` is the plan-file path. Most commonly a `/focus`-produced plan file at `.claude/plans/focus-YYYY-MM-DD-slug.md`; any markdown plan with the canonical sections (Context / Approach / Critical files / Verification / What this plan deliberately does NOT do) works. If `$ARGUMENTS` is empty, the Implementation surfaces the most recent candidate plan files and asks which one (or whether to cancel).

**Outputs.**

- Edits applied to the files named in the plan's Critical files table — and only those files, unless the user explicitly approves widening scope.
- Verification gates from the plan run end-to-end with output surfaced inline (not paraphrased).
- A drafted commit on the current branch, staged explicitly per the Critical files list.
- A "ready to push" block surfaced to the user, with the commit SHA and a one-line Verification summary.
- A `Captures for /log` tail listing any followups / decisions surfaced during implementation. Omit the tail if nothing journal-worthy surfaced — do not pad.

**Success criteria.**

- The Approach section is walked literally, not reinterpreted on the fly.
- The Critical files table is the scope envelope — no surprise files touched without an explicit surface-and-confirm.
- Every command in the plan's Verification section runs and either passes or has its failure surfaced verbatim; never auto-fixed.
- The commit message reflects the plan's Context (the **why**), not just a restatement of what changed.
- Push happens only after explicit user confirmation ("push" or "yes"). Never auto-push, never push on session end.
- If implementation surfaced anything journal-worthy (a new followup, a decision-shaped choice), the `Captures for /log` tail lists it for the user to invoke `/log` on.

**Failure modes to avoid.**

- **Improvising past a missing-tool error.** "command not found" or "no module named X" → STOP and surface; never substitute an ad-hoc command path or guess at `find ~/.local`. Past audits show 30+ minutes lost to environmental yak-shaving that one user clarification would have answered in seconds.
- **Auto-fixing a Verification failure.** Surface verbatim, let the user choose: (a) extend skill work to fix inline, (b) cancel and revise the plan, (c) commit-with-known-failure noted in the body. Never silently retry-with-tweaks.
- **Widening scope.** A file not in the plan's Critical files table → surface the proposed add and the reason; don't sneak it into the commit.
- **Pushing without explicit OK.** The commit-then-stop boundary is load-bearing; commits are reversible pre-push via `git reset --soft HEAD~1`, pushes are not.
- **Free-form questions in place of `AskUserQuestion`.** If the work has a fork that the plan didn't resolve, use the tool; don't paper over it with conversation prose like "should we Y" or "let me know which".
- **`--no-verify` on a hook failure.** Address the underlying issue and re-stage; never bypass pre-commit hooks.
- **Pre-rendering a verification summary before the gates actually run.** Run each command, surface its output, then summarize — not the other way around. Optimistic summaries that mismatch actual output corrupt the trust signal.

**When NOT to use.**

- The plan still has open architectural forks or unresolved `AskUserQuestion` fences. Stay on the judgment-grade model and finish the planning side first via `/focus`.
- No written plan exists. "Implement feature X" without a spec is judgment-heavy by default; don't reach for `/sonnet`.
- The work is so trivial it doesn't warrant a plan (typo, one-line config edit). Just edit and commit; the skill overhead isn't worth it.
- The plan flags `Risk / blast radius: large` or touches load-bearing infra (migrations, deploy scripts, secret-handling). Stay on the judgment-grade model for the implementation half too — the token savings aren't worth the marginal risk on infra changes.

## Implementation

The plan lives at `.claude/plans/focus-YYYY-MM-DD-slug.md` (gitignored, like `.claude/handoffs/`) — produced by `/focus`'s ad-hoc quick-fix route, or hand-written. Any markdown plan with the canonical sections (Context / Approach / Critical files / Verification / What this plan deliberately does NOT do) works.

### Step 1 — Load the plan and sanity-check state

Read the plan file in full. Pay attention to: the `Context` section (which followup, signal, or banner surfaced this — the "why now"); the `Approach` section (the actual step list); the `Critical files` table (CREATE / Edit / Delete per file); the `Verification` checklist (the regression-floor — every command here must pass before declaring done); the `What this plan deliberately does NOT do` section (scope boundaries — do not widen these).

Run one quick state-drift check before touching anything: `node scripts/catchup-state.js --pretty` (the same aggregator `/catchup` and `/focus` read). If the plan file's mtime is more than 12 hours old AND state has moved since (heuristic: anything unusual in the read — failed CI on this branch, a stale signal row, an in-flight handoff besides this one), surface a one-line note and ask: "the plan is from <X> ago and state has moved — want me to invoke `/catchup` first or proceed with the plan as-is?" Don't auto-invoke; give the user the call.

### Step 2 — Walk the plan

Execute the `Approach` section in order. For each step:

- **File creates / edits:** use `Write` / `Edit` against the paths named in `Critical files`. Don't invent new paths — the plan's path list is the scope. If a file you need to touch isn't in the table, surface to the user before editing: "the plan lists files A, B, C; I also need to touch D for <reason> — want me to add it?"
- **Commands the plan flags** (migrations, builds, ingest test runs, deploy steps): run them via Bash. Surface output inline so the user can spot regressions immediately.
- **`AskUserQuestion` forks:** if the plan still has open questions (a real-world plan can have a "user to confirm X" left over), surface via `AskUserQuestion`. Don't guess — the No-fabrication rule applies in spades to plan execution.

Stay literal. The plan is the spec; bias toward "what does the plan say" over "what would I do if I were planning this." If you find yourself wanting to deviate (a cleaner approach, a missing edge case, a refactor while you're in the file), STOP and surface to the user — that's a plan-revision moment, not a Sonnet-implementation moment.

### Step 3 — Run the Verification gates

Every command in the plan's `Verification` section must run and pass before declaring done. Walk them in order, surface output for each. JellyRock's no-regressions floor (`npm run validate` for the BrightScript typecheck, `npm run test:scripts` for the vitest script suite, `npm run test:tdd` for the Roku TDD suite when device tests are in scope, and `npm run lint` for the full lint gate) is also load-bearing here — if the plan's `Verification` section is light, add the relevant floor commands as a tail.

**Use JellyRock's canonical npm wrappers, not bare runners.** The `package.json` scripts (`npm run validate`, `npm run lint`, `npm run test:*`, `npm run docs:*`) encode the project's bsc project files, lint chain, and Roku-deploy conventions. Bare `bsc` / `vitest` / `markdownlint-cli2` calls are anti-patterns that miss the wrapper's flags and project config. If you hit a "command not found" / "Cannot find module" error: STOP, do NOT improvise with `npx` guesses or `find node_modules`. Run `npm install` first if deps are missing; check the `scripts` block in `package.json`; if still unclear, surface to the user with the failure verbatim.

If a Verification step fails: surface the failure verbatim (don't paraphrase). Don't auto-fix — surface to user with the failure output + a one-line diagnosis. The user decides whether to (a) extend this skill's work to fix it inline, (b) cancel and revise the plan, or (c) commit anyway with the failure noted in the body.

### Step 4 — Commit, surface, wait for push

When Verification is clean (or the user accepted a known-failure path in Step 3), assemble the commit. Stage explicitly per the Critical files list — no `git add -A`. Draft the commit body: subject `<type>(<scope>): <short summary>` matching JellyRock's Conventional-Commits style (skim `git log --oneline -10` for the pattern); body explains the why (the plan's Context section answers this) and references the plan file path as the spec the commit implements.

Run the commit; any configured git hooks fire automatically — let them run. If a hook fails, address inline + re-stage + re-commit. **Never `--no-verify`.** (JellyRock's full lint/test gate runs in CI on the PR, so a green local `npm run lint` + the plan's Verification commands are the bar before pushing.)

After a clean commit, surface a clear "ready to push" block and STOP:

```text
Commit landed: <short-sha> <subject>
Files: <list>
Verification: <one-line summary of what passed>

To push: type "push" (or "yes"). To revise: type "amend with: <change>" or "reset".
```

Wait for explicit "push" before running `git push`. This is the load-bearing stop-point. When the user types push, run `git push` and surface the result.

### Step 5 — Captures (if any)

If implementation surfaced any decisions, followups, or other journal-worthy items not in the plan, list them in a final `Captures for /log` section at the very end of your reply (after the push completes). Format: `- <type>: <title> — <body>`. The user invokes `/log` for each per the Sub-agent capture convention; don't auto-write to journals.

If no captures surfaced, omit the section. Don't pad.

## Sub-agent invocation

To invoke from a sub-agent: parent passes `Read .claude/skills/sonnet/SKILL.md and follow the steps for $ARGUMENTS=<plan-file-path>. Execute the plan, run Verification, commit, surface the ready-to-push block, then STOP. Do NOT push. If you discover any decisions or followups during this work, surface them at the end of your report as a "Captures for /log" section. I'll invoke /log for each. Do not write to journals directly.` in the Task prompt. Parent runs the push after reviewing the sub-agent's surfaced block.
