---
name: end-session
model: opus
effort: medium
description: This skill should be used when the user explicitly types "/end-session" — the mandatory final step of any session started or resumed with /start-project or /resume-project, which the agent prints alone in its own block as the session's last line for the user to type, never invoking it directly. It updates the active project's PLAN.md (Status, kickoff, log), checks the PLAN against itself, and commits+pushes. Do NOT auto-invoke on vague phrases mid-session.
---

# End Session

## This repo

- **Journal writes are not committed here** (`commit=no`): a tail `/log` writes rides the next code PR, and a journal-only change gets no PR of its own ([No standalone journal PR](../../../AGENTS.md#capture--state-discipline)). When the project is paused and no code PR is coming, keep the tail in the PLAN.

## Contract

**Goal.** Close out the current session on the active project and hand off cleanly, so the next session can resume cold. This is the **mandatory final step** of any project-tracked session — the soft enforcement point of the whole lifecycle. It updates the project's `PLAN.md` (Status as live state, dated decisions, open questions and waits, a kickoff rewritten in the template's skeleton, an appended Session-log line), sweeps the session for deferred tails and routes the cross-cutting ones to `/log`, sets the project's end-of-session status, checks the PLAN against itself with a script before committing, commits and pushes, proves the handoff loads cold, and releases the session's claim on the project. The work is judgment-heavy synthesis — distilling a whole session into an accurate status delta and a kickoff a memoryless reader can act on, plus careful commit hygiene in a possibly-shared working tree — so the skill runs at the judgment-grade tier; the mechanical checks are scripts.

**Inputs.** Any arguments are ignored. The skill identifies the project from the session: whatever was loaded via `/start-project` or `/resume-project`, else the single `active` project (ask if several are). It expects the project's `PLAN.md` to be readable and the session's actual work to be verifiable against `git log` / `git status`.

**Outputs.**

- An updated `PLAN.md`: Status holding live state only (the current phase with its id first, one line per phase, today's dated decisions prepended with the ones past the list's size moved — never deleted — to `DECISIONS.md` beside the PLAN, open questions still open, `waits-on:` current, `last-updated:` today), detail moved to its `## Reference` section, a kickoff rewritten in the template's skeleton, and one appended Session-log line.
- Cross-cutting deferred tails routed through `/log` (written to the journal and committed on their own, or left to ride with the change that prompted them where this repo commits journal writes that way) — project-scoped tails stay in the PLAN, not double-booked — and a `Cross-cutting tails routed: <N>` line.
- The project's end-of-session status set (`active` by default; `paused` / `completed` / `abandoned` only on a real signal, with archival for the terminal states).
- A PLAN that passes `resume-state.sh --check`, committed and pushed by explicit pathspec in the repo that holds the projects folder (nothing to commit where that folder is gitignored), a clean cold load, and the claim released.

**Success criteria.**

- Status reflects what *actually* shipped — verified against `git log`, never aspirational. Invented progress is the cardinal sin here.
- The kickoff and Status cannot contradict each other: the kickoff's `Starts at` names Status's current phase, that phase is in Phase progress and not ✅, and the check that says so ran and passed before the commit.
- The kickoff is self-contained and in the skeleton: a reader with no memory of this session can act on it cold, each fact written once in its owner's place (phase state in Status, the plan for next time in the kickoff).
- Every landmine the last kickoff carried is still there, or the Session log says why it stopped being true.
- Deferred tails are sorted by scope, and every cross-cutting one is actually written to the journal — never claimed-captured in the PLAN narrative but lost at the boundary.
- The commit lands on the intended branch, staged by explicit pathspec, with no foreign files swept in; a terminal close moves the project directory into `_archive/` inside that same commit, both paths staged.
- The end-of-session status is correct and low-friction: `active` is inferred silently when obvious; the choice is asked in chat only on a genuine ending or pausing signal.
- The next `/resume-project` would load with no banner: this skill ran the reader itself and fixed what it named.

**Failure modes to avoid.**

- **Inventing progress.** Status records what shipped, confirmed against `git log` — not what was hoped or intended. If it didn't land, it isn't done.
- **Committing a PLAN that contradicts itself.** A kickoff that still starts at a phase Status marks done sends the next session off the stale half. The check is a script, run before the commit; a failure is fixed in the PLAN, never committed as is.
- **A kickoff that assumes session memory.** Write it for a cold reader. "Continue where we left off" is useless; "Phase D is next; templates are missing at X; read Y first" is actionable.
- **A kickoff check the next session can't actually run.** When the kickoff asks the reader to verify something ("did the plan land?", "did the backfill finish?"), key it on the **artifact** — a symbol in the source, a row in the data, a file on disk — never on a branch name, a commit subject, or a `git log -N` window. Branches get deleted or squashed, subjects get reworded, and a log window slides past the commit, so those checks answer "not done" about work that shipped and send the next session back at it.
- **A stated count that rots.** A value that can change after the close (a count, a queue, a state) is written as the command that measures it and the value it showed, never as a bare number.
- **Dropping a landmine silently.** Each one was learned by getting it wrong once; drop one and the next session relearns it the expensive way.
- **Letting Status grow into a history.** Every resume prints Status in full. The session's story belongs in the Session log, findings and finished-phase detail in Reference — moved, never deleted, since a gitignored PLAN has no history to recover them from.
- **Deleting a decision to make room.** The decisions list keeps the newest few; every older one moves to `DECISIONS.md`. The move is scripted, and the script refuses to write when its count of decisions would change. A decision `/log` already added this session is not added again.
- **Double-booking a tail, or letting a cross-cutting one die at the boundary.** Project-scoped tails belong in the PLAN; cross-cutting ones in the journal, written through `/log` and confirmed landed. A missing journal or `/log` is a defect to fix, never a reason to record "no tails".
- **Sweeping foreign files into the commit.** In a shared working tree a parallel agent can switch the branch or stage its own files. Verify branch + staging first; commit by explicit pathspec; re-check the branch after.
- **The pathspec-commit footguns.** In `git commit -m "msg" -- <paths>`, `-m` must come before `--`; new files must be `git add`'d first (the `-- <paths>` form commits only tracked paths); an archive move needs both the old and the new path in the pathspec, or the deletion silently drops out of the commit.
- **Prompting for the status every session.** Default to `active` silently; ask only on a real ending or pausing signal. A question every session is friction that erodes the skill.
- **Running it yourself, or never printing it.** There is no Stop hook: the close happens only when the agent prints `/end-session` alone in its own block as the session's last line and the user types it. Started by the agent, it runs at the session's model and effort instead of its own pins; never printed, it never runs, and the PLAN is left stale and the next session blind.

**When NOT to use.**

- The session never loaded a tracked project (pure ad-hoc work). Capture any tail via `/log followup` and commit normally — there's no PLAN to close.
- You want to capture a single followup mid-session without closing. That's `/log`, not `/end-session`.
- You're pausing for a coffee break, not ending the session. Don't churn the PLAN for a non-gap.
- Do not auto-invoke, on vague mid-session phrases or at a project session's end. This runs when the user types `/end-session`; a project-tracked session prints it as its last line for them to type.

## Implementation

Every read of the PLAN goes through `bash .claude/skills/resume-project/resume-state.sh` (the reader `/resume-project` uses, so the close sees what the next resume will see); the projects folder is whatever `bash .claude/skills/start-project/projects-dir.sh` prints. Repo facts this skill reads: [this repo's capture types](../../../AGENTS.md#capture-types) and [its public posture](../../../AGENTS.md#public-posture); anything else this repo needs at a close (a hook that regenerates a file, a check before a push that deploys, a harvest before archiving) is in this skill's `## This repo`, when it has one.

### Step 1 — Identify the project

If this session loaded one via `/start-project` or `/resume-project`, use that slug. Otherwise run `bash .claude/skills/resume-project/resume-state.sh --check` with no slug: it picks the single active project, or lists the active ones (exit 2) so you can ask in chat which.

### Step 2 — Read what you will rewrite

Run `bash .claude/skills/resume-project/resume-state.sh <slug>`. It prints Status, the kickoff, the last Session-log line, what the project waits on, and the commits made since the PLAN was saved (this session's work, for the log line); read any other section by its heading. Never read the whole PLAN: it can pass 100KB, and a part read is enough to edit it. A `sed`, `awk` or `head` slice of the PLAN, or a `git log` range you picked, is no substitute: it skips what the reader adds (the save commit, what the project waits on, the size flag), and a Status rewritten from memory instead of from this output drifts from the PLAN.

### Step 3 — Update Status: live state only

- **Current phase** starts with the phase's id (`D — the build`), the one the kickoff will start at.
- **Rewriting Status whole:** put it in place with `replace-section.sh` (Step 4 shows the call; the section name is `"Status"`), and before running `move-old-decisions.sh` below, since a later rewrite could undo its move.
- **Phase progress:** one line per phase, ✅ / 🚧 / ⬜ first after the id. A finished phase is one line: `- C ✅ done (commits a1b2..c3d4) — <outcome in a clause>`, its range (first and last commit) taken from `git log --oneline`, never from memory; as a git range `a1b2..c3d4` leaves out `a1b2`, so a command built from it (a revert, a diff) says `a1b2^..c3d4` (a phase that made no commits says `no commits` and where its result lives); its detail moves to `## Reference` under a heading naming the phase.
- **Decisions:** prepend today's, dated, a few lines each (the full reasoning lives in the commit message), skipping any `/log decision` already added this session. Then run `bash .claude/skills/end-session/move-old-decisions.sh <project-dir>/PLAN.md`: it keeps the newest few and moves the rest to `DECISIONS.md`, never deleting one. If it refuses (a duplicate, no decisions heading), fix what it names and run it again; never trim the list by hand.
- **Open questions / blockers:** delete the ones this session answered. A blocker only a person or an outside event can clear is tagged `[external-gate: <reason, with a date when known>]`; remove the tag when it clears.
- **`waits-on:`** in the frontmatter lists what another project or a followup must finish first, comma-separated: `<slug>` (met when that project completes), `<slug>:<phase id>` (met when that phase is ✅), `fid:<id>` (met when the followup closes), `<repo>/<slug>` (another repo's project; recorded, not checkable here). Add one when this session found such a wait; remove each reference the reader showed as met.
- **Punch-list:** tick off the items this session cleared (`- [x]`), add the ones it surfaced.
- `last-updated:` in the frontmatter is today, from `date +%F`.
- **Size:** when the reader flagged Status as over 15KB, trim it now: findings, measurements and finished-phase detail to `## Reference`, the story of past sessions to the Session log. Move text, never delete it.

### Step 4 — Rewrite the kickoff in the skeleton

Write the whole section in the template's shape, for a reader with no memory of this session, then put it in place with the script below (the body only: the script keeps the heading):

```markdown
**Starts at:** <Current phase's id> — <the step to start with>

**Last session stopped:** <where it stopped and why, in a sentence or two>

**Unanswered:** <questions put to the operator that got no reply, or "none">

### Verify first

- `<command>` → `<the one line it printed at the close>` <what its numbers mean, when the line does not say>

### Next, in order

1. <step>

### Required reading

- <file or section, and why>

### Landmines

- <a trap that bites inside this project, and how to avoid it>
```

```text
bash .claude/skills/end-session/replace-section.sh <project-dir>/PLAN.md "Next-session kickoff" <body file, or - for a quoted heredoc>
```

It replaces exactly one `## ` section and leaves the rest of the PLAN byte for byte; it refuses, writing nothing, a name that matches no section or several, an empty body, and a body with a `#` or `##` heading outside a code block. If it refuses, fix what it names and run it again; never splice a section by hand.

- **Each fact has one owner.** What this session did is stated in Status and the log with its evidence (a commit, an artifact), not re-described here. A value that can change after the close goes in **Verify first** as `` `command` → `the line it printed` `` — only the ones the next work depends on. The command prints one line, and a note after the backticked value may say what each number in it means; a command cut down with `| tail` or `| grep` keeps that meaning in the note, since the next session cannot read a column whose header was cut off. Run each command first and copy what it printed: Step 8 runs every one again and fails a value that differs. Work that lands out of band (a plan executed by another session that never closes) is checked by an artifact: ✅ a symbol the change adds, a row it writes, a file it creates; ❌ a branch name (merges delete branches), a `git log -N` window (it slides past the commit), a commit-message trailer (not every landing carries one).
- **Landmines carry forward.** Keep every one the last kickoff had unless it has stopped being true, and add the ones this session found. A trap that bites outside this project is not a landmine here: Step 6 routes it.
- A part with nothing in it holds the single line `none` (no bullet): the check reads every bullet under Verify first as a command and its value.
- Cite a followup by its fid (`[fid: …]`), never by its position in the journal.

### Step 5 — Append one line to the Session log

Dated; a second session the same day is `(s2)`, and so on. A session that began with `/start-project` already wrote its line: extend that line rather than adding a second. Say what shipped (with its commit range), what was found, and what went wrong or had to be redone: a log that records only successes is useless for a cold read. Name any landmine you dropped and why it stopped being true.

### Step 6 — Route the deferred tails

Sweep the session for loose ends that surfaced but won't be done here. **Project-scoped** ones already live in the PLAN (Steps 3–4); do not also route them through `/log`, which double-books them. **Cross-cutting** ones — a fix elsewhere in the repo, a "we should look at X" outside the phases, an audit item for later — go through `/log followup`; a trap that bites outside this project goes through `/log` with the type that fits from [this repo's capture types](../../../AGENTS.md#capture-types). Confirm each landed. If the journal or `/log` is missing, that is a defect to fix before this step can pass, never a reason to route nothing. Close the step with the line, printed whatever the count:

```text
Cross-cutting tails routed: <N>
```

Carry this line into the session's final summary too. A close whose Steps 3–5 went in as one scripted edit tends to jump from the PLAN to the commit, and a summary that lists what was logged without the count has skipped this step.

### Step 7 — Set the end-of-session status

Default to `active`: no change, and no question, while phases are still in progress or pending. Ask in chat only on a real signal that the project is ending or pausing — the final phase just shipped, every phase is ✅, or the user said "we're done" / "let's pause this" / "this isn't working" — with the options and a recommendation:

- **paused** — `status: paused` in the frontmatter and on its row in the projects folder's `README.md`; it stays in the Active table (`/resume-project` won't auto-select it). No archival.
- **completed** — `status: completed`; move the project directory into the projects folder's `_archive/` (`git mv` where the folder is tracked, plain `mv` where it is gitignored); move its README row to the Archived list with a one-line closing summary and the date.
- **abandoned** — as completed, plus a one-line reason in Status and on the archived row.

For a terminal close, the kickoff becomes one line, `Project closed <date>: <why>`, put in place with `replace-section.sh` as in Step 4. After an archive move, search the whole repo (not only the docs) for the old path and re-point every hit in the same commit: a moved PLAN breaks links, registries and tests that name it. Decide this before Step 8 so every change lands in one commit.

### Step 8 — Check the PLAN

Run `bash .claude/skills/resume-project/resume-state.sh --check <slug>`. Every `FAIL:` line is a contradiction or a missing part: fix it in the PLAN and run the check again until it prints `RESULT: ok`. A `Verify first:` FAIL is a value that differs from what its command prints now: copy the printed line, never edit the command to match the value. The check runs each command (60 seconds each at most), so a Verify first command only reads. A `REVIEW:` line asks for a reason, not a fix: a landmine dropped since the last commit is justified in the Step 5 log line (or put back); an oversized Status is trimmed (Step 3). A `NOTE:` line informs.

### Step 9 — Commit and push

The PLAN is committed in the repo that holds the projects folder. If `git -C <projects folder> check-ignore -q .` succeeds, the folder is gitignored: there is no PLAN commit, never `git add -f` it, and the PLAN must be the last thing written this session — after every other commit — because the next resume dates an untracked PLAN by its file time and reads any later commit as work the kickoff has not seen. Otherwise:

1. `git -C <repo> branch --show-current` is the intended branch, and `git -C <repo> status --short` shows nothing staged that isn't yours (a parallel session may share the tree). Commit by explicit pathspec, never `-a`.
2. `git add` any new file first (`DECISIONS.md`, an archive's new path). Stage the PLAN, `DECISIONS.md`, the README when Step 7 changed it, and for an archive move both the old and the new directory; `git diff --cached --name-status` must show the move as `R` (or a `D` for every old path).
3. `git commit -m "<subject naming the project and the session's outcome>" -- <paths>` (`-m` before `--`). When [this repo's public posture](../../../AGENTS.md#public-posture) is `public`, re-read the subject and body first: no other repository or host, no person, email or home path, no secret. If a hook refuses, fix what it names and commit again, never `--no-verify`.
4. Push, then re-check the branch. If the commit landed on the wrong branch, cherry-pick it onto the right one and move the stray branch back.

### Step 10 — Prove it loads cold, then release the claim

Run `bash .claude/skills/resume-project/resume-state.sh <slug>` once more: it is what the next session will see. Every `BANNER:` line is something to fix now (a dirty tree, an unpushed commit, a commit after the PLAN's save, a PLAN check), not to hand on. After a terminal close the read refuses by design (exit 2, `archived: <folder> (closed; not resumable)` and a `did not resolve` banner): no session can resume a closed project, so that refusal is the cold load and the one `BANNER:` to leave. Check the rest by hand: `git status --short` lists nothing of yours, and `git status -sb` shows no `ahead`. Then `bash .claude/skills/resume-project/resume-state.sh --release <slug>`, so the next session is not warned about this one.

### Notes

- **Split planning and execution.** When a planning session hands a plan to a separate executing session (a `/focus` plan picked up fresh), the planning session ends with `/end-session` right after the hand-off, printed for the user to type: the PLAN's log keeps the design narrative, `git log` the execution. The kickoff then checks the plan's landing by its artifact (Step 4).
