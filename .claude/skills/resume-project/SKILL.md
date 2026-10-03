---
name: resume-project
model: sonnet
effort: low
audit-span: read-only
description: This skill should be used ONLY when the user explicitly types "/resume-project" (optionally with a slug). It loads an existing tracked project under docs/projects/ and the surrounding context so work can continue cleanly, using the project's Next-session kickoff as the starting prompt. Do NOT auto-invoke when the user merely opens the repo or mentions past work.
---

# Resume Project

## Contract

**Goal.** Pick up an existing tracked project and bind the session to its lifecycle, loading enough context that work continues cold without re-reading everything by hand. The skill selects the project, reads the parts of its `PLAN.md` a resume needs, runs a continuity check that the prior session ended cleanly, and adopts the PLAN's "Next-session kickoff" as the effective starting prompt — or the starting point the user named after the slug. The work is read-and-orient — selecting, loading, sanity-checking, and reconciling the kickoff against the commits — light judgment rather than heavy reasoning, so the skill runs at the light-judgment tier, and one tested script does the reading. It is **read-only by contract** (`audit-span: read-only`): its own steps load and present state, then yield to the working session; it never changes the project, and the one thing it writes is this session's claim on the project, outside the repo.

**Inputs.** The arguments are an optional project slug, then optionally where to start. With a slug, the skill picks the project whose folder is `YYYY-MM-<slug>`. Without one, it reads each project's `status:` and auto-selects when exactly one is `active`, asks when several are, and stops (routing to `/start-project`) when none are. Anything after the slug is this session's starting point in place of the kickoff's: an open followup's fid (as `/focus` hands off a pinned item a project tracks), or the user's own words. The skill expects the project's `PLAN.md` to carry a current Status section and a "Next-session kickoff."

**Outputs.**

- The selected project's context loaded into the session: its Status, open punch-list, Next-session kickoff and last session-log entry read in full, what it waits on resolved, and any starting point from the arguments; any other PLAN section read by its heading when the work needs it, never the whole file; recent commits surfaced. The repo's root instructions and working-norms rules are already in scope.
- This session recorded as the project's holder, with a warning when another live session already holds it.
- A continuity report: any anomalies from the check (a dirty working tree, commits never pushed, commits made since the PLAN was last saved — those naming the project mean the last session did not close — an unexpected branch, a PLAN whose kickoff contradicts its Status) surfaced as warnings for the user to weigh.
- The starting point confirmed with the user: the one the arguments named, else the kickoff's, anchored to the current phase.
- The session-binding statement surfaced (this session must end with `/end-session`).

**Success criteria.**

- The right project is selected: an explicit slug is honored; a single active project is auto-picked; multiple actives prompt a choice; zero actives stop and redirect to `/start-project`; a slug matching nothing says so and lists the active projects.
- The continuity check runs and *reports* — it never blocks. A dirty tree, unpushed commits, work since the PLAN was saved, a surprising branch, another live session on the project, or a PLAN that contradicts itself is surfaced as a warning the user decides on, not a refusal to load.
- A starting point the user gave wins over the kickoff's, and the skill says in one line what of the kickoff it puts off.
- A project still waiting on something unmet is said to be waiting before any work starts; one whose every wait is met is said to be unblocked.
- Documented facts (paths, flags, service names, counts) are treated as possibly stale and verified against the live repo before they're acted on.
- When the kickoff has drifted from recent commits, the commits win and the drift is flagged (it gets corrected when `/end-session` rewrites the kickoff).
- The session is explicitly bound to end with `/end-session`.

**Failure modes to avoid.**

- **Blocking on a continuity anomaly.** The check is advisory. Surface the dirty tree or the unclosed session, ask whether to proceed, and let the user decide — do not refuse to load the project.
- **Reading the whole PLAN.** A long-running project's PLAN passes 100KB, mostly session log and old detail; a whole read costs tens of thousands of tokens or is cut off. Read the sections the resume needs, and any other one by its heading.
- **Trusting stale documentation as fact.** PLAN narrative and docs can lag reality. A path, flag, service name or count read from the PLAN is a hypothesis to verify against the current repo, not ground truth; when the kickoff hands you a command to measure something, run it.
- **Adopting a drifted kickoff verbatim.** If recent commits show the kickoff is out of date, say so and trust the commits — don't march the session off a stale prompt.
- **Mutating project state during the load.** No edits, no commits, no kickoff rewrites, no `waits-on:` change — that's `/end-session`'s job. This skill loads and presents (its claim is kept outside the repo), then yields.
- **Starting at the kickoff when the user named a start.** Words after the slug are where this session begins; the kickoff is context for them, not a competing plan.
- **Treating another session's claim as a stop.** It is a warning: say which tab holds the project and how long it has been idle, and let the user decide. Two sessions closing one PLAN overwrite each other's close, which is what the warning is for.
- **Skipping the session binding.** If the close discipline isn't surfaced, the resumed session can drift into an un-closed state and its work never gets written back to the PLAN.

**When NOT to use.**

- No tracked project applies — you want a breadth briefing across all state surfaces. That's `/catchup` (whole cursor + all active projects + recent commits), not `/resume-project` (depth on one project).
- You're starting genuinely new tracked work. That's `/start-project`; `/resume-project` loads what already exists.
- You're mid-task in a session that already loaded the project. Re-running the full load is noise; just keep working.
- The user merely opened the repo or mentioned past work without asking to resume. Do not auto-invoke — this skill runs only on an explicit `/resume-project`.

## Implementation

Every read goes through one script, [`resume-state.sh`](resume-state.sh): it finds the projects folder (through `start-project/projects-dir.sh`), picks the project, records this session's claim on it, prints the PLAN sections a resume needs in full, resolves what the project waits on, and runs the continuity checks and the PLAN check. Nothing it finds stops a resume. **This skill is read-only too:** no PLAN edits, no `status:` or `waits-on:` change, no kickoff rewrite, no commit; `/end-session` owns all of that.

### Step 1 — Run the state read

Run `bash .claude/skills/resume-project/resume-state.sh`, adding the slug when the user gave one, and after it every word the user put after the slug (the starting point). Its exit code routes the skill:

| Exit | Meaning | Do |
|---|---|---|
| `0` | a project was picked; every section printed | Step 2 |
| `2` | no project could be picked | Read the SELECTION lines. Several active projects, or a slug matching several: list them, ask which, run again with the slug. A slug matching nothing: say so and show the active projects it lists (an `archived:` match is closed, not resumable). No active project, or no projects folder: stop and route to `/start-project`. |
| `3` | the picked PLAN cannot be read | Stop and say so; do not improvise a substitute. |

Don't replace what the script prints with reads of your own. If its output is too long for the shell and is saved to a file, read that file.

### Step 2 — Read what it printed

The sections arrive in this order, to be read top to bottom: SELECTION, CLAIM, WORKTREE, CONTINUITY, PLAN CHECK, WAITS, PLAN — STATUS, PLAN — OPEN PUNCH-LIST, START (only when the arguments named a starting point), PLAN — NEXT-SESSION KICKOFF, PLAN — LAST SESSION LOG ENTRY, RECENT COMMITS, END. The repo's `AGENTS.md` and `.claude/rules/` load in every session, so they are already in scope: don't re-read them.

An `ERROR:` line in place of a PLAN section means its heading was not found (renamed, most likely): read that section from the PLAN by its heading. Read any other section (the Charter, the Phases) the same way when the work needs it, never the whole PLAN.

### Step 3 — Continuity check (report, never block)

Every `BANNER:` line is advice. Surface it, say what it probably means, and let the user decide:

- **Working tree DIRTY** — show the paths and ask before building on them. When the WORKTREE section notes that the projects folder is not tracked (or lives outside the repo), a PLAN edit never shows there, so everything listed is real work a prior session left uncommitted.
- **Commits not pushed** — say so before any branch is cut: a new branch carries them, so a diff against the local branch is not the diff its PR will have.
- **Commits since the PLAN was saved that name this project** — the last session most likely ended without `/end-session`, and the kickoff has not seen that work (Step 4). "Other work since" is information, not an anomaly: say what landed, one line per commit, each described from its files (`git show --stat`), never from its subject alone. Its "other work on paths the kickoff names" lines are the overlap: for each, name the path, say what the kickoff plans there, and read the newest commit's change to that path (`git show <sha> -- <path>`) before building on it. While an overlap line is unaddressed, never say nothing touched the kickoff's paths.
- **The PLAN's last commit is not on this branch** — confirm which branch the work belongs on.
- **Status is not `active`** — confirm this is the project meant.
- **Status is N KB** — say so: `/end-session` should trim it, since every resume pays for it.
- **Another live session holds this project** — name the tab and how long it has been idle, and ask before working: two sessions closing one PLAN overwrite each other's close. A `NOTE:` that the holder has ended, or is idle for hours, needs no question.
- **PLAN check: …** — the PLAN contradicts itself (the kickoff starts at a phase Status does not have in progress, or every phase is ✅). Say which half the commits support and start from that one; `/end-session` fixes the PLAN. A `NOTE:` that the kickoff predates the skeleton means: read it as prose.
- **Every wait is met** — the project is unblocked: say what it was waiting on, now done. **Waits naming nothing found** — say which, and leave the fix to `/end-session`. A WAITS line still `waiting:` means the work this kickoff plans may be blocked: say so before starting.

### Step 4 — Adopt the starting point, checked against the commits

When a START section printed, it is this session's starting point. One word shaped like a fid (kebab-case, `fid:` optional) is looked up: `fid: <id>` and the entry below it mean an open followup, and its entry is the task; a `NOTE:` that it is closed or is no followup means ask what the user meant before starting. Anything else prints as `words: <the user's words>`: that is the task, as they wrote it. Say in one line what of the kickoff it puts off ("the kickoff's Starts at, <its phase and step>, waits"), and keep the kickoff as context. Otherwise the kickoff is this session's starting prompt. Before adopting either, reconcile it with the commits since the PLAN was saved, RECENT COMMITS, and the open punch-list. Where they disagree, the commits win: say so out loud rather than march off a stale prompt. `/end-session` corrects the kickoff at close; the job here is to flag the drift, not fix it.

A count, path, flag, command or service name in the kickoff is a claim, not a fact. Where the kickoff hands you a command to measure something, run it; check that anything else it names exists before acting on it. When a result differs from the kickoff's value, know what each number in it means before naming a cause: read the kickoff's note on it, or run the command without the `| tail` or `| grep` that cut its header off. If Status names a blocker the kickoff's work would walk into, raise it now, before the work starts. Then confirm with the user what to tackle, anchored to the kickoff and the current phase.

### Step 5 — Bind the session

State to the user, and hold for the rest of the session:

> **This project session MUST end with `/end-session`, typed by you.** It is the final step before this task is considered complete: when the work is done, it is printed as the last line for you to type, and the work is not reported done until it has run and its commit is pushed.

Hold to that: when the work is done, print `/end-session` alone in its own `text` block as the last thing in the message, and never invoke it yourself (a skill's `model:` and `effort:` pins apply only when the user types it).
