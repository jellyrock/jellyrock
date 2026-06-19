---
name: end-session
model: opus
effort: low
description: This skill should be used when the user explicitly types "/end-session", AND it MUST also be run by the agent as the final step of any session that was started or resumed with /start-project or /resume-project — before the task is considered complete. It updates the active project's PLAN.md (Status, kickoff, log) and commits+pushes. Do NOT auto-invoke on vague phrases mid-session.
---

# End Session

## Contract

**Goal.** Close out the current session on the active project and hand off cleanly, so the next session can resume cold. This is the **mandatory final step** of any project-tracked session — the soft enforcement point of the whole lifecycle. It updates the project's `PLAN.md` (Status markers, dated decisions, open questions, a rewritten Next-session kickoff, an appended Session-log line), sweeps the session for deferred tails and routes the cross-cutting ones to `/log`, sets the project's end-of-session status, then commits and pushes. The work is judgment-heavy synthesis — distilling a whole session into an accurate status delta and a kickoff a memoryless reader can act on, plus careful commit hygiene in a possibly-shared working tree — so the skill runs at the judgment-grade tier.

**Inputs.** `$ARGUMENTS` is ignored. The skill identifies the project from the session: whatever was loaded via `/start-project` or `/resume-project`, else the single `active` project in `docs/projects/README.md` (ask if ambiguous). It expects the project's `PLAN.md` to be readable and the session's actual work to be verifiable against `git log` / `git status`.

**Outputs.**

- An updated `PLAN.md`: Status section (phase markers with commit ranges, today's dated decision(s) prepended to the running list and trimmed, refreshed open questions/blockers, `last-updated:` set to today), a fully rewritten Next-session kickoff, and one appended Session-log line.
- Cross-cutting deferred tails routed through `/log followup` (written to `docs/progress.md`, committed standalone) — project-scoped tails stay in the PLAN, not double-booked.
- The project's end-of-session status set (`active` by default; `paused` / `completed` / `abandoned` only on a real signal, with archival for the terminal states).
- A committed-and-pushed change staged by explicit pathspec.

**Success criteria.**

- Status reflects what *actually* shipped — verified against `git log`, never aspirational. Invented progress is the cardinal sin here.
- The Next-session kickoff is self-contained: a reader with no memory of this session can act on it cold (what's done, what's next, required reading, landmines).
- Deferred tails are sorted by scope: project-scoped tails live in the PLAN's open-questions/kickoff; cross-cutting tails are routed to `/log` and actually written to `docs/progress.md` — never claimed-captured in the PLAN narrative but lost at the boundary.
- The commit lands on the intended branch, staged by explicit pathspec, with no foreign files swept in.
- The end-of-session status is correct and low-friction: `active` is inferred silently when obvious; the 4-way prompt fires only on a genuine ending/pausing signal.
- For terminal states (`completed`/`abandoned`), the project directory is `git mv`'d into `_archive/` and its README entry moved, all inside the same close commit.

**Failure modes to avoid.**

- **Inventing progress.** Status records what shipped, confirmed against `git log` — not what was hoped or intended. If it didn't land, it isn't done.
- **A kickoff that assumes session memory.** Write it for a cold reader. "Continue where we left off" is useless; "Phase D is next; templates are missing at X; read Y first" is actionable.
- **Double-booking a tail.** A project-scoped tail belongs in the PLAN, not also in `docs/progress.md` via `/log`. A cross-cutting tail belongs in `docs/progress.md`, not orphaned in PLAN prose. Pick one surface per tail.
- **Letting a cross-cutting tail die at the boundary.** A tail claimed-captured in the PLAN narrative but never written to `docs/progress.md` is exactly how these get lost, resurfacing a session or two later. Route it through `/log` and confirm it landed.
- **Sweeping foreign files into the commit.** In a shared working tree a parallel agent can switch the branch or stage its own files. Verify branch + staging first; commit by explicit pathspec; re-check the branch after.
- **The pathspec-commit footgun.** In `git commit -m "msg" -- <paths>`, `-m` must come before `--`; new files must be `git add`'d first (the `-- <paths>` form commits only tracked paths).
- **Prompting the 4-way status every session.** Default to `active` silently; surface the non-`active` choice only on a real ending/pausing signal. A question every session is friction that erodes the skill.
- **Skipping the skill.** There is no Stop hook — running `/end-session` is instruction-following. A session that does the work but never closes leaves the PLAN stale and the next session blind.

**When NOT to use.**

- The session never loaded a tracked project (pure ad-hoc work). Capture any tail via `/log followup` and commit normally — there's no PLAN to close.
- You want to capture a single followup mid-session without closing. That's `/log`, not `/end-session`.
- You're pausing for a coffee break, not ending the session. Don't churn the PLAN for a non-gap.
- Do not auto-invoke on vague mid-session phrases. This runs on an explicit `/end-session`, or as the deliberate final step of a project-tracked session.

## Implementation

Close out the current session on the active project and hand off cleanly. This is the mandatory final step of any project-tracked session.

### Step 1 — Identify the project

If this session loaded one via `/start-project` or `/resume-project`, use that. Otherwise read `docs/projects/README.md` and use the single `active` project; if ambiguous, ask the user.

### Step 2 — Read its `PLAN.md` in full before editing

### Step 3 — Update the Status section with the user

- Phase progress markers (✅ done / 🚧 in progress / ⬜ pending), with commit ranges where known.
- Prepend today's dated decision(s) to "Last 5 decisions"; trim to the most recent 5.
- Refresh "Open questions / blockers".
- Set `last-updated:` in the frontmatter to today's date.

### Step 4 — Rewrite the "Next-session kickoff"

Overwrite the previous one as a self-contained prompt the next session can act on cold: what is done, what is next, required reading, and any landmines. Assume the reader has no memory of this session.

### Step 5 — Append one dated line to the Session log

Append-only, summarizing this session's work.

### Step 6 — Capture deferred tails

Before committing, sweep the session for loose ends that surfaced but won't be done here, and sort them by scope. **Project-scoped tails** — work that belongs to this project's own future phases — are already handled by steps 3-4: they live in the PLAN's "Open questions / blockers" and "Next-session kickoff," not in `docs/progress.md`. Do NOT also route those through `/log`; that double-books the same tail in two surfaces. This step is for **cross-cutting tails** — loose ends that outlive or fall outside this project: a one-line fix elsewhere in the repo, a "we should look at X" note unrelated to the current phases, an audit item deferred to later. Surface the cross-cutting list to the user and route each confirmed one through `/log followup` (it writes to `docs/progress.md` and commits it standalone). Don't let a cross-cutting tail die at the session boundary — a tail claimed-captured in the PLAN narrative but never actually written to `docs/progress.md` is exactly how these get lost, surfacing only a session or two later. If nothing cross-cutting surfaced, say "no deferred tails" and move on; "none" is a positive signal, not silence.

### Step 7 — Commit + push

**JellyRock is a public repo, so `docs/projects/` is gitignored** — `PLAN.md`s are local agent-continuity (like `.claude/handoffs/`/`.claude/plans/`), not committed. So there is **nothing to commit for the PLAN**: do NOT `git add -f` it. The session's actual code/doc commits already landed via normal work, and cross-cutting followups commit via `/log`. This step is therefore a no-op for the PLAN itself on JR — update the local `PLAN.md` (Steps 3-5) so the next session resumes cold, but leave it uncommitted. (If a session produced committable project *artifacts* outside `docs/projects/`, commit those normally by explicit pathspec.)

- **Verify the branch + staging first (shared working tree).** A parallel agent in the same directory can switch the branch or stage its own files under you. Before committing, run `git branch --show-current` to confirm you're on the intended branch and `git status --short` to see what's staged. If files that aren't yours are staged, commit by **explicit pathspec** so you don't sweep them in. The real fix for parallel work is a separate `git worktree`/clone per agent — this check is the fallback for when that wasn't done.
- **Pathspec-commit footguns.** In `git commit -m "msg" -- <paths>`, `-m` MUST come *before* the `--` — everything after `--` is treated as a pathspec, so `-m` after `--` fails with `pathspec '-m' did not match`. The `-- <paths>` form commits only *tracked* paths, so `git add` any new file first. After committing, re-check `git branch --show-current`; if it landed on the wrong branch, recover with a cherry-pick onto the right branch + `git branch -f` to drop the stray commit.

### Step 8 — Set the project's end-of-session status

Default to `active` — the project continues, no frontmatter change, it stays in the Active-projects table. **Do NOT prompt when `active` is obvious** (phases still in progress or pending, no completion signal): infer it silently and move on. A 4-way question every single session is friction — the bar for surfacing the choice via `AskUserQuestion` is a real signal the project is ending or pausing: the final phase just shipped, all phases are ✅, or the user said something like "we're done" / "let's pause this" / "this isn't working." Only when such a signal is present, surface the non-`active` outcomes:

- **paused** — set `status: paused` in the PLAN frontmatter and on the project's row in the `docs/projects/README.md` Active-projects table (it stays in that table — `/resume-project` won't auto-select a non-`active` row, but it remains visible and resumable). No archival.
- **completed** — set `status: completed`; `git mv` the project directory into `docs/projects/_archive/`; move its README entry to the Archived list.
- **abandoned** — prompt for a one-line reason; record it in the PLAN's Status section; set `status: abandoned`; `git mv` into `docs/projects/_archive/`; move its README entry to the Archived list, noted as abandoned.

Make this determination *before* running the step-7 commit so any frontmatter / README / archival changes land in that same commit. For `completed` / `abandoned`, the kickoff rewritten in step 4 is moot — replace it with a one-line "project closed" note.

### Notes

- This skill is the soft enforcement point of the lifecycle. There is no Stop hook — running it is a matter of instruction-following. Do not skip it.
- Do not invent progress. Status reflects what actually shipped (verify against `git log`), not what was hoped.
- **Split planning/execution flows.** This skill CAN run before the work it describes is executed. When a planning session produces a plan that's handed off to a separate execution session (e.g. a `/focus` plan picked up by a fresh session), run `/end-session` in the planning session right after the hand-off — don't wait for execution to finish. The PLAN.md session log captures the design/decision narrative (the planning session); `git log` captures the execution narrative (the executing session's commits).
