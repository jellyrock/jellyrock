---
name: resume-project
model: sonnet
effort: low
audit-span: read-only
description: This skill should be used ONLY when the user explicitly types "/resume-project" (optionally with a slug). It loads an existing tracked project under docs/projects/ and the surrounding context so work can continue cleanly, using the project's Next-session kickoff as the starting prompt. Do NOT auto-invoke when the user merely opens the repo or mentions past work.
---

# Resume Project

## Contract

**Goal.** Pick up an existing tracked project from `docs/projects/` and bind the session to its lifecycle, loading enough context that work continues cold without re-reading everything by hand. The skill selects the project, reads its `PLAN.md` plus the always-loaded rules, runs a continuity check that the prior session ended cleanly, and adopts the PLAN's "Next-session kickoff" as the effective starting prompt. The work is read-and-orient — selecting, loading, sanity-checking, and synthesizing the kickoff against recent commits — light judgment rather than heavy reasoning, so the skill runs at the light-judgment tier. It is **read-only by contract** (`audit-span: read-only`): its own steps load and present state, then yield to the working session; it never mutates the project.

**Inputs.** `$ARGUMENTS` is an optional project slug. If present, load `docs/projects/*-<slug>/PLAN.md` directly. If absent, the skill reads `docs/projects/README.md` and auto-selects when exactly one project is `active`, asks when several are, and stops (routing to `/start-project`) when none are. The skill expects the project's `PLAN.md` to carry a current Status section and a "Next-session kickoff."

**Outputs.**

- The selected project's full context loaded into the session: `PLAN.md` read in whole, the repo's root instructions + working-norms rules in scope, recent commits surfaced.
- A continuity report: any anomalies from the check (dirty working tree, last commit unrelated to the project, unexpected branch) surfaced as warnings for the user to weigh.
- The kickoff adopted and confirmed with the user as this session's starting point, anchored to the current phase.
- The session-binding statement surfaced (this session must end with `/end-session`).

**Success criteria.**

- The right project is selected: an explicit slug is honored; a single active project is auto-picked; multiple actives prompt a choice; zero actives stop and redirect to `/start-project`.
- The continuity check runs and *reports* — it never blocks. A dirty tree, an unrelated last commit, or a surprising branch is surfaced as a warning the user decides on, not a refusal to load.
- Documented facts (paths, flags, service names) are treated as possibly stale and verified against the live repo before they're acted on.
- When the kickoff has drifted from recent commits, the commits win and the drift is flagged (it gets corrected when `/end-session` rewrites the kickoff).
- The session is explicitly bound to end with `/end-session`.

**Failure modes to avoid.**

- **Blocking on a continuity anomaly.** The check is advisory. Surface the dirty tree or the unrelated commit, ask whether to proceed, and let the user decide — do not refuse to load the project.
- **Trusting stale documentation as fact.** PLAN narrative and docs can lag reality. A path, flag, or service name read from the PLAN is a hypothesis to verify against the current repo, not ground truth.
- **Adopting a drifted kickoff verbatim.** If recent commits show the kickoff is out of date, say so and trust the commits — don't march the session off a stale prompt.
- **Mutating project state during the load.** No edits, no commits, no kickoff rewrites — that's `/end-session`'s job. This skill loads and presents, then yields.
- **Skipping the session binding.** If the close discipline isn't surfaced, the resumed session can drift into an un-closed state and its work never gets written back to the PLAN.

**When NOT to use.**

- No tracked project applies — you want a breadth briefing across all state surfaces. That's `/catchup` (whole cursor + all active projects + recent commits), not `/resume-project` (depth on one project).
- You're starting genuinely new tracked work. That's `/start-project`; `/resume-project` loads what already exists.
- You're mid-task in a session that already loaded the project. Re-running the full load is noise; just keep working.
- The user merely opened the repo or mentioned past work without asking to resume. Do not auto-invoke — this skill runs only on an explicit `/resume-project`.

## Implementation

Pick up an active project from `docs/projects/` and bind this session to the lifecycle.

### Step 1 — Select the project

- If the user passed a slug, load `docs/projects/*-<slug>/PLAN.md`.
- If no slug, read `docs/projects/README.md`. If exactly one project is `active`, use it. If several are active, list them and ask which. If none are active, stop and tell the user to use `/start-project` instead.

### Step 2 — Load context, in this order

- The project's `PLAN.md` (read the whole file).
- Root `AGENTS.md` (architecture + hard rules; `CLAUDE.md` symlinks to it) and the working-norms rules in `.claude/rules/*.md` that load automatically every session.
- Recent commits: `git log --oneline -20`.

### Step 2.5 — Continuity check (warn, don't block)

Confirm the prior session ended cleanly before building on it:

- `git status --short` — if the working tree is dirty, surface the uncommitted paths and ask whether to proceed. A prior `/end-session` should have left it clean; dirt suggests an interrupted session.
- Confirm the most recent commit references this project (its slug or a `<project>:` prefix). If the last commit is unrelated, flag it — the prior session may not have run `/end-session`.
- Optionally confirm the branch is the expected one (usually `main`).

These are warnings, not gates: report anomalies and let the user decide; don't refuse to load the project.

### Step 3 — Adopt the kickoff

Treat the PLAN.md "Next-session kickoff" section as the effective starting prompt for this session. Confirm with the user what they want to tackle, anchored to that kickoff and the current phase.

### Step 4 — Bind the session

State to the user, and hold for the rest of the session:

> **This project session MUST end with `/end-session`.** Running `/end-session` is the final step before this task is considered complete. Do not conclude the session, hand off, or report the work done until `/end-session` has been run and its commit pushed.

### Notes

- Docs and rules may be stale — verify against the current repo state before acting on any documented fact (paths, flags, service names can have changed).
- If the kickoff is out of date relative to recent commits, trust the commits and flag the drift; it will be corrected when `/end-session` rewrites the kickoff.
