---
name: resume-project
model: sonnet
effort: low
audit-span: read-only
description: This skill should be used ONLY when the user explicitly types "/resume-project" (optionally with a slug). It loads an existing tracked project under docs/projects/ and the surrounding context so work can continue cleanly, using the project's Next-session kickoff as the starting prompt. Do NOT auto-invoke when the user merely opens the repo or mentions past work.
---

# Resume Project

## Contract

**Goal.** Pick up an existing tracked project and bind the session to its lifecycle, loading enough context that work continues cold without re-reading everything by hand. The skill selects the project, reads the parts of its `PLAN.md` a resume needs, runs a continuity check that the prior session ended cleanly, and adopts the PLAN's "Next-session kickoff" as the effective starting prompt. The work is read-and-orient — selecting, loading, sanity-checking, and reconciling the kickoff against the commits — light judgment rather than heavy reasoning, so the skill runs at the light-judgment tier, and one tested script does the reading. It is **read-only by contract** (`audit-span: read-only`): its own steps load and present state, then yield to the working session; it never mutates the project.

**Inputs.** The arguments are an optional project slug. If present, the skill picks the project whose folder ends in `-<slug>`. If absent, it reads each project's `status:` and auto-selects when exactly one is `active`, asks when several are, and stops (routing to `/start-project`) when none are. The skill expects the project's `PLAN.md` to carry a current Status section and a "Next-session kickoff."

**Outputs.**

- The selected project's context loaded into the session: its Status, open punch-list, Next-session kickoff and last session-log entry read in full; any other PLAN section read by its heading when the work needs it, never the whole file; recent commits surfaced. The repo's root instructions and working-norms rules are already in scope.
- A continuity report: any anomalies from the check (a dirty working tree, commits never pushed, commits made since the PLAN was last saved — those naming the project mean the last session did not close — an unexpected branch) surfaced as warnings for the user to weigh.
- The kickoff adopted and confirmed with the user as this session's starting point, anchored to the current phase.
- The session-binding statement surfaced (this session must end with `/end-session`).

**Success criteria.**

- The right project is selected: an explicit slug is honored; a single active project is auto-picked; multiple actives prompt a choice; zero actives stop and redirect to `/start-project`; a slug matching nothing says so and lists the active projects.
- The continuity check runs and *reports* — it never blocks. A dirty tree, unpushed commits, work since the PLAN was saved, or a surprising branch is surfaced as a warning the user decides on, not a refusal to load.
- Documented facts (paths, flags, service names, counts) are treated as possibly stale and verified against the live repo before they're acted on.
- When the kickoff has drifted from recent commits, the commits win and the drift is flagged (it gets corrected when `/end-session` rewrites the kickoff).
- The session is explicitly bound to end with `/end-session`.

**Failure modes to avoid.**

- **Blocking on a continuity anomaly.** The check is advisory. Surface the dirty tree or the unclosed session, ask whether to proceed, and let the user decide — do not refuse to load the project.
- **Reading the whole PLAN.** A long-running project's PLAN passes 100KB, mostly session log and old detail; a whole read costs tens of thousands of tokens or is cut off. Read the sections the resume needs, and any other one by its heading.
- **Trusting stale documentation as fact.** PLAN narrative and docs can lag reality. A path, flag, service name or count read from the PLAN is a hypothesis to verify against the current repo, not ground truth; when the kickoff hands you a command to measure something, run it.
- **Adopting a drifted kickoff verbatim.** If recent commits show the kickoff is out of date, say so and trust the commits — don't march the session off a stale prompt.
- **Mutating project state during the load.** No edits, no commits, no kickoff rewrites — that's `/end-session`'s job. This skill loads and presents, then yields.
- **Skipping the session binding.** If the close discipline isn't surfaced, the resumed session can drift into an un-closed state and its work never gets written back to the PLAN.

**When NOT to use.**

- No tracked project applies — you want a breadth briefing across all state surfaces. That's `/catchup` (whole cursor + all active projects + recent commits), not `/resume-project` (depth on one project).
- You're starting genuinely new tracked work. That's `/start-project`; `/resume-project` loads what already exists.
- You're mid-task in a session that already loaded the project. Re-running the full load is noise; just keep working.
- The user merely opened the repo or mentioned past work without asking to resume. Do not auto-invoke — this skill runs only on an explicit `/resume-project`.

## Implementation

Every read goes through one script, [`resume-state.sh`](resume-state.sh): it finds the projects folder (through `start-project/projects-dir.sh`), picks the project, prints the PLAN sections a resume needs in full, and runs the continuity checks. It is read-only and never gates. **This skill is read-only too:** no PLAN edits, no `status:` change, no kickoff rewrite, no commit; `/end-session` owns all of that.

### Step 1 — Run the state read

Run `bash .claude/skills/resume-project/resume-state.sh`, adding the slug when the user gave one. Its exit code routes the skill:

| Exit | Meaning | Do |
|---|---|---|
| `0` | a project was picked; every section printed | Step 2 |
| `2` | no project could be picked | Read the SELECTION lines. Several active projects, or a slug matching several: list them, ask which, run again with the slug. A slug matching nothing: say so and show the active projects it lists (an `archived:` match is closed, not resumable). No active project, or no projects folder: stop and route to `/start-project`. |
| `3` | the picked PLAN cannot be read | Stop and say so; do not improvise a substitute. |

Don't replace what the script prints with reads of your own. If its output is too long for the shell and is saved to a file, read that file.

### Step 2 — Read what it printed

The sections arrive in this order, to be read top to bottom: SELECTION, WORKTREE, CONTINUITY, PLAN — STATUS, PLAN — OPEN PUNCH-LIST, PLAN — NEXT-SESSION KICKOFF, PLAN — LAST SESSION LOG ENTRY, RECENT COMMITS, END. The repo's `AGENTS.md` and `.claude/rules/` load in every session, so they are already in scope: don't re-read them.

An `ERROR:` line in place of a PLAN section means its heading was not found (renamed, most likely): read that section from the PLAN by its heading. Read any other section (the Charter, the Phases) the same way when the work needs it, never the whole PLAN.

### Step 3 — Continuity check (report, never block)

Every `BANNER:` line is advice. Surface it, say what it probably means, and let the user decide:

- **Working tree DIRTY** — show the paths and ask before building on them. When the WORKTREE section notes that the projects folder is not tracked (or lives outside the repo), a PLAN edit never shows there, so everything listed is real work a prior session left uncommitted.
- **Commits not pushed** — say so before any branch is cut: a new branch carries them, so a diff against the local branch is not the diff its PR will have.
- **Commits since the PLAN was saved that name this project** — the last session most likely ended without `/end-session`, and the kickoff has not seen that work (Step 4). "Other work since" is information, not an anomaly: say how much landed, and check whether any of it touches what the kickoff plans.
- **The PLAN's last commit is not on this branch** — confirm which branch the work belongs on.
- **Status is not `active`** — confirm this is the project meant.
- **Status is N KB** — say so: `/end-session` should trim it, since every resume pays for it.

### Step 4 — Adopt the kickoff, checked against the commits

The kickoff is this session's starting prompt. Before adopting it, reconcile it with the commits since the PLAN was saved, RECENT COMMITS, and the open punch-list. Where they disagree, the commits win: say so out loud rather than march off a stale prompt. `/end-session` corrects the kickoff at close; the job here is to flag the drift, not fix it.

A count, path, flag, command or service name in the kickoff is a claim, not a fact. Where the kickoff hands you a command to measure something, run it; check that anything else it names exists before acting on it. If Status names a blocker the kickoff's work would walk into, raise it now, before the work starts. Then confirm with the user what to tackle, anchored to the kickoff and the current phase.

### Step 5 — Bind the session

State to the user, and hold for the rest of the session:

> **This project session MUST end with `/end-session`.** Running `/end-session` is the final step before this task is considered complete. Do not conclude the session, hand off, or report the work done until `/end-session` has been run and its commit pushed.
