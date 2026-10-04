---
name: start-project
model: opus
effort: medium
description: This skill should be used ONLY when the user explicitly types "/start-project" (optionally with a slug). It begins a new tracked JellyRock project under docs/projects/ — running scaffold-project.sh to create PLAN.md from docs/projects/_TEMPLATE.md and index it in the projects README, then walking the user through the Charter. For multi-session work that crosses a phase boundary or carries a decision worth recording as an ADR in docs/adr/. Do NOT auto-invoke on vague phrases like "let's start something"; for a single-session fix just do the work and capture any tail via /log followup.
---

# Start Project

## Contract

**Goal.** Begin a new tracked, multi-session project in the projects folder and bind the session to the project lifecycle. This is the front door for work that's too big for a single ad-hoc fire: it spans two or more sessions, crosses at least one phase boundary, or carries at least one decision worth recording. The PLAN starts as a **lightweight stub that grows** — just enough structure to track the work, not a heavyweight charter ceremony. The skill splits along the cost boundary: the deterministic scaffold (collision-check, create the dir, copy the template, fill dated frontmatter, index the README row) is a zero-cost script; the load-bearing **judgment** — co-designing the **Charter** (Goal / Success criteria / Out of scope / Phases) interactively with the user — stays in skill prose. That Charter co-design is genuine reasoning work: scoping a multi-session effort, drafting from incomplete information, iterating until the boundaries are right — which is why the skill is pinned at the judgment-grade tier even though its mechanics are scripted. Started by the agent it runs on the session's own model and effort; its pin applies when it is typed. Getting the Charter wrong front-loads drift across every session that follows.

**Inputs.** The arguments are an optional kebab-case slug. If present, use it. If absent, propose a short kebab-case slug from the work the user describes and confirm it before scaffolding. The projects folder is wherever `start-project/projects-dir.sh` says (`docs/projects/` unless this machine maps the repo elsewhere); the script creates its template and index when they are missing. The skill also expects the user to be available to co-design the Charter — this is not a fire-and-forget scaffold.

**Outputs.**

- A new `YYYY-MM-<slug>/PLAN.md` in the projects folder (where `YYYY-MM` is the current month), scaffolded from the project template, with the Charter filled in collaboratively, the Phases roughed in, Status at the first phase, and a kickoff in the template's skeleton. Where the projects folder is committed, the scaffold is committed at creation (a template stub; the Charter body commits later via `/end-session`).
- Frontmatter set: `project:` = slug, `status: active`, `created:` and `last-updated:` = today (real dates from `date`, not a model guess), and `waits-on:` when the project cannot start until something else finishes.
- A one-line entry in the projects folder's `README.md` active-projects table.
- A first dated line in the Session log, a PLAN that passes `resume-state.sh --check`, and this session's claim on the project recorded.
- The session-binding statement surfaced to the user (this session, and every future session on this project, must end with `/end-session`).

**Success criteria.**

- A duplicate slug is caught before anything is scaffolded — by the scaffold script's own rule, an existing `YYYY-MM-<slug>/` directory (including under `_archive/`) stops the skill and routes the user to `/resume-project`; a slug that only ends another project's name is not a duplicate.
- The Charter is co-designed, not invented: Goal/Success/Out-of-scope are drafted from what's known and then iterated with the user; scope the skill is unsure about is asked, never assumed.
- The PLAN is a single file — Charter, Phases, Status, kickoff, Reference and log all live in `PLAN.md`, never split across files (only `DECISIONS.md` sits beside it, and `/end-session` makes that).
- `status: active` and the README index entry are both written, so the state-briefing and resume skills can find the project.
- A project that waits on another project or a followup says so in `waits-on:`, and a project spun off from another is added to that project's `waits-on:` when it holds the parent up, so the briefing can show when either is unblocked.
- Where the projects folder is committed, the scaffold `PLAN.md` and README row are committed at creation (path-restricted, not pushed), so nothing pushed before `/end-session` can link to a PLAN missing from the tree; where it is gitignored, there is nothing to commit.
- The session is explicitly bound to the lifecycle, and the user is told `/end-session` is the mandatory close.

**Failure modes to avoid.**

- **Scaffolding over an existing slug.** Always check for a collision (active *and* archived) with the script first. A silent overwrite destroys a real project's history.
- **A pre-check that disagrees with the scaffold.** A hand-written glob (`*-<slug>`) flags a slug that merely ends another project's name; the script's `--check` uses the scaffold's own rule.
- **Inventing scope to fill the Charter.** If the Goal or Success criteria aren't clear from the conversation, ask a clarifying question in chat — do not guess a scope and write it as if confirmed. A fabricated Charter is worse than an empty one.
- **Splitting the PLAN.** Charter, Phases, Status, kickoff, Reference and log stay in one `PLAN.md`. Don't break them into sibling files for tidiness.
- **Silently rewriting the Charter as scope drifts.** Intent stays mutable under the lightweight model — there's no mandatory immutability flip. But scope changes are recorded as dated decisions in the Status section (a big shift gets an explicit scope-cut decision), not by quietly editing the Charter in place — that preserves the original intent as an anchor you can diff against.
- **Forgetting to bind the session.** The session-end discipline is the whole point of the lifecycle. If the binding statement isn't surfaced, the project can drift into an un-closed session and its state never gets written back.
- **Reaching for `/start-project` on work that's actually ad-hoc.** A single-session fix doesn't earn a PLAN. Over-scaffolding turns a 20-minute job into lifecycle ceremony.

**When NOT to use.**

- The work fits in one session, doesn't cross a phase boundary, and carries no decision worth recording. Just do it; capture any deferred tail via `/log followup`.
- The project already exists. Use `/resume-project <slug>` to pick it up — `/start-project` refuses duplicates by design.
- You want to triage what to work on next rather than commit to a new tracked effort. That's `/focus` (or `/catchup` for a state briefing) — `/start-project` assumes the decision to start is already made.
- The "project" is really a decision that needs deliberation, not multi-session execution. A decision is recorded with `/log decision`; only wrap it in a project if the *execution* spans sessions.

## Implementation

The mechanics are scripts beside this skill: `scaffold-project.sh` (the collision check and the scaffold) and `projects-dir.sh` (where projects live), plus `/resume-project`'s `resume-state.sh` for the PLAN check and the claim. Repo facts this skill reads: [this repo's public posture](../../../AGENTS.md#public-posture); anything else a new project needs here (a file a hook regenerates from the projects folder, a risk every Charter in this repo should name) is in this skill's `## This repo`, when it has one.

### Step 1 — Determine the slug

Use the slug the user passed. If none, propose a short kebab-case slug from the work they describe and confirm it; the script adds the `YYYY-MM-` prefix itself.

### Step 2 — Check the slug is free

Run `bash .claude/skills/start-project/scaffold-project.sh --check <slug>`. It writes nothing. Exit 1 with "already exists" means the project is there: stop and route the user to `/resume-project <slug>`. Exit 1 for a bad slug: propose another. Exit 0: go on. (The scaffold re-checks atomically in Step 4; this check only keeps the Charter co-design from being spent on a taken slug.)

### Step 3 — Co-design the Charter with the user (the judgment)

Work through the three Charter fields — Goal (one sentence), Success criteria (bulleted, verifiable), Out of scope (bulleted) — and rough in the Phases, each with an id (`A`, `B`, … or `1`, `2`, …). Draft from what is known, then iterate with the user; ask in chat when unsure, never assume. Also raise, when they apply:

- **Posture.** When [this repo's public posture](../../../AGENTS.md#public-posture) is `public` and the work will touch committed files, say so now: every commit it makes must name no other repository or host, no person, and no secret.
- **Waits.** Does this project need another project, one of its phases, or a followup to finish first? Those become its `waits-on:` (Step 5). Is it spun off from a project that cannot continue until this one lands? That project's `waits-on:` gets this slug.

**Settle the one-line Goal before Step 4**: the script writes it into the README row.

### Step 4 — Scaffold via the script (the mechanics)

```bash
bash .claude/skills/start-project/scaffold-project.sh <slug> "<one-line goal>"
```

It re-checks the collision, creates the directory, copies the project template, fills `project:` / `status: active` / `created:` / `last-updated:` with real dates, and appends the README row; with no template or README in the projects folder (a gitignored tree on a fresh clone) it creates the shared ones first. If it exits non-zero, fix the cause and re-run — never hand-scaffold around it.

### Step 5 — Commit the scaffold stub (where the projects folder is committed)

If `git -C <projects folder> check-ignore -q .` succeeds, the folder is gitignored: nothing to commit, skip to Step 6. Otherwise check `git -C <repo> branch --show-current` is the intended branch (another session may share the working tree), then commit the new PLAN and the README row now, path-restricted, in the repo that holds the folder, so nothing pushed before `/end-session` can link to a PLAN missing from the tree. `git add` the new PLAN first (the `-- <paths>` form commits only tracked paths), keep `-m` before `--`, and stage any file this repo's hooks regenerate from the projects folder as this skill's `## This repo` says (when it has one). The subject names the slug in this repo's commit style; the one below is an example:

```bash
git -C <repo> add <projects folder>/<YYYY-MM-slug>/PLAN.md <projects folder>/README.md
git -C <repo> commit -m "start-project: scaffold <slug> PLAN" -- <projects folder>/<YYYY-MM-slug>/PLAN.md <projects folder>/README.md
```

Do not push: that stays with `/end-session`. If a hook fails, fix the cause and re-commit, never `--no-verify`.

### Step 6 — Fill the PLAN

Write into the scaffolded `PLAN.md`, replacing each placeholder:

- The Charter and Phases from Step 3.
- `waits-on:` from Step 3 (`<slug>`, `<slug>:<phase id>`, `fid:<id>`, `<repo>/<slug>`), or leave it empty. When this project holds up a parent, add this slug to the parent's `waits-on:` too.
- Status: `**Current phase:** A — <name>`, Phase progress with the first phase 🚧 and the rest ⬜, and "none" for open questions until there are some. Leave the decisions list's placeholder line as it is: the decision script drops it when the first real decision arrives, and a `- none` line would be kept as a decision. A project that will keep a findings queue gets a `## 📋 Punch-list` section right after Status, one `- [ ]` line per item.
- The kickoff in the template's skeleton, for a session with no memory of this one: `Starts at` the first phase and its first step, what this session stopped at, questions still unanswered, then Verify first, Next in order, Required reading and Landmines as far as they are known; a part with nothing yet holds the single line `none` (no bullet).
- The first dated line in the Session log.

### Step 7 — Check it, claim it, bind the session

Run `bash .claude/skills/resume-project/resume-state.sh --check <slug>` and fix every `FAIL:` it names; then `bash .claude/skills/resume-project/resume-state.sh <slug>`, which records this session's claim on the project and shows the PLAN as the next session will see it. Its DIRTY and not-pushed banners are expected here (the filled PLAN commits and pushes at `/end-session`); any other banner is worth a look. From this point, this session — and every future session on this project — is governed by the lifecycle. State to the user, and hold for the rest of this session:

> **This project session MUST end with `/end-session`, typed by you.** It is the final step before this task is considered complete: when the work is done, it is printed as the last line for you to type, and the work is not reported done until it has run and its commit is pushed.

Hold to that: when the work is done, print `/end-session` alone in its own `text` block as the last thing in the message, and never invoke it yourself (a skill's `model:` and `effort:` pins apply only when the user types it).
