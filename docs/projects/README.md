# Projects

Tracked, multi-session work on JellyRock lives here. Each project is a directory `YYYY-MM-<slug>/` containing a single `PLAN.md` (Charter + Phases + Status + next-session kickoff + session log). Completed or abandoned projects move to `_archive/`.

This is a lightweight lifecycle, driven by three skills:

| Skill | When | What it does |
|---|---|---|
| `/start-project <slug>` | Begin new tracked work | Runs `scaffold-project.sh` to create `PLAN.md` from `_TEMPLATE.md`, indexes it here, then co-designs the Charter and activates the project. |
| `/resume-project [slug]` | Continue existing work | Loads the project's `PLAN.md` + `AGENTS.md` + `.claude/rules/` + recent commits; uses the kickoff as the starting prompt. |
| `/end-session` | End of every project session | Updates Status, rewrites the kickoff, appends the log, commits + pushes. Archives the project when complete or abandoned. |

**Binding rule:** any session started or resumed with the skills above MUST run `/end-session` as its final step before the work is considered complete. There is no Stop hook — enforcement is by instruction-following.

A normal session that doesn't touch a project ignores all of this. No ceremony unless a project skill is invoked. Use `/start-project` only when the work spans two or more sessions, crosses a phase boundary, or carries a decision worth recording; otherwise just do the work and capture any deferred tail via `/log followup`.

## Active projects

| Project | Status | Goal |
|---|---|---|

## Archived projects

| Project | Status | Closed |
|---|---|---|
