---
name: start-project
model: opus
effort: low
description: This skill should be used ONLY when the user explicitly types "/start-project" (optionally with a slug). It begins a new tracked JellyRock project under docs/projects/ — running scaffold-project.sh to create PLAN.md from docs/projects/_TEMPLATE.md and index it in the projects README, then walking the user through the Charter. For multi-session work that crosses a phase boundary or carries a decision worth recording as an ADR in docs/adr/. Do NOT auto-invoke on vague phrases like "let's start something"; for a single-session fix just do the work and capture any tail via /log followup.
---

# Start Project

## Contract

**Goal.** Begin a new tracked, multi-session project under `docs/projects/` and bind the session to the project lifecycle. This is the front door for work that's too big for a single ad-hoc fire: it spans two or more sessions, crosses at least one phase boundary, or carries at least one decision worth recording. The PLAN starts as a **lightweight stub that grows** — just enough structure to track the work, not a heavyweight charter ceremony. The skill splits along the cost boundary: the deterministic scaffold (collision-check, create the dir, copy the template, fill dated frontmatter, index the README row) is mechanical and should be carried by a zero-cost script; the load-bearing **judgment** — co-designing the **Charter** (Goal / Success criteria / Out of scope / Phases) interactively with the user — stays in skill prose. That Charter co-design is genuine reasoning work: scoping a multi-session effort, drafting from incomplete information, iterating until the boundaries are right — which is why the skill runs at the judgment-grade tier even though its mechanics are scripted. Getting the Charter wrong front-loads drift across every session that follows.

**Inputs.** `$ARGUMENTS` is an optional kebab-case slug. If present, use it. If absent, propose a short kebab-case slug from the work the user describes and confirm it before scaffolding. The skill expects `docs/projects/` to exist with a project template to copy and a `README.md` to index into. It also expects the user to be available to co-design the Charter — this is not a fire-and-forget scaffold.

**Outputs.**

- A new `docs/projects/YYYY-MM-<slug>/PLAN.md` (where `YYYY-MM` is the current month), scaffolded from the project template, with the Charter filled in collaboratively and the Phases roughed in.
- Frontmatter set: `project:` = slug, `status: active`, `created:` and `last-updated:` = today (real dates from `date`, not a model guess).
- A one-line entry in the `docs/projects/README.md` active-projects table.
- An initial "Next-session kickoff" section and a first dated line in the Session log.
- The session-binding statement surfaced to the user (this session, and every future session on this project, must end with `/end-session`).

**Success criteria.**

- A duplicate slug is caught before anything is scaffolded — an existing `*-<slug>/` directory (including under `_archive/`) stops the skill and routes the user to `/resume-project`.
- The Charter is co-designed, not invented: Goal/Success/Out-of-scope are drafted from what's known and then iterated with the user; scope the skill is unsure about is asked, never assumed.
- The PLAN is a single file — Charter, Phases, Status, kickoff, and log all live in `PLAN.md`, never split across files.
- `status: active` and the README index entry are both written, so the state-briefing and resume skills can find the project.
- The session is explicitly bound to the lifecycle, and the user is told `/end-session` is the mandatory close.

**Failure modes to avoid.**

- **Scaffolding over an existing slug.** Always check for a `*-<slug>/` collision (active *and* archived) first. A silent overwrite destroys a real project's history.
- **Inventing scope to fill the Charter.** If the Goal or Success criteria aren't clear from the conversation, ask a clarifying question — do not guess a scope and write it as if confirmed. A fabricated Charter is worse than an empty one.
- **Splitting the PLAN.** Charter, Phases, Status, kickoff, and log stay in one `PLAN.md`. Don't break them into sibling files for tidiness.
- **Silently rewriting the Charter as scope drifts.** Intent stays mutable under the lightweight model — there's no mandatory immutability flip. But scope changes are recorded as dated decisions in the Status section (or, for a big shift, an explicit scope-cut / supersede-decision), not by quietly editing the Charter in place — that preserves the original intent as an anchor you can diff against.
- **Forgetting to bind the session.** The session-end discipline is the whole point of the lifecycle. If the binding statement isn't surfaced, the project can drift into an un-closed session and its state never gets written back.
- **Reaching for `/start-project` on work that's actually ad-hoc.** A single-session fix doesn't earn a PLAN. Over-scaffolding turns a 20-minute job into lifecycle ceremony.

**When NOT to use.**

- The work fits in one session, doesn't cross a phase boundary, and carries no decision worth recording. Just do it; capture any deferred tail via `/log followup`.
- The project already exists under `docs/projects/`. Use `/resume-project <slug>` to pick it up — `/start-project` refuses duplicates by design.
- You want to triage what to work on next rather than commit to a new tracked effort. That's `/focus` (or `/catchup` for a state briefing) — `/start-project` assumes the decision to start is already made.
- The "project" is really a decision that needs deliberation, not multi-session execution. An architectural decision lands as a numbered ADR in `docs/adr/` via `/log decision`; only wrap it in a project if the *execution* spans sessions.

## Implementation

Begin a new tracked project in `docs/projects/` and bind this session to the project lifecycle.

### Step 1 — Determine the slug

Use the slug the user passed. If none, propose a short kebab-case slug from the work they describe and confirm it. The project directory is `docs/projects/YYYY-MM-<slug>/`, where `YYYY-MM` is the current month (e.g. `2026-05-ansible-modernization`).

### Step 2 — Pre-check for duplicates

Cheaply confirm no `*-<slug>/` directory already exists under `docs/projects/` (including `_archive/`). If one does, stop and route the user to `/resume-project <slug>`. (Make the scaffold step re-check this atomically and abort without mutating, so this pre-check just avoids wasting the Charter co-design on a taken slug.)

### Step 3 — Co-design the Charter with the user (the judgment)

Work through the three Charter fields — Goal (one sentence), Success criteria (bulleted), Out of scope (bulleted). Draft a proposal from what is known, then iterate with the user. Also rough in the Phases list. Do not invent scope; ask when unsure. **This is the load-bearing judgment work** — settle the one-line Goal before scaffolding, since the scaffold needs it for the README row.

### Step 4 — Scaffold via a script (the mechanics)

The deterministic scaffold — collision re-check, create the dir, copy the project template, fill dated frontmatter (`project:` = slug, `status: active`, `created:`/`last-updated:` = today's real dates from `date`), append the README active-projects row — is mechanical with exactly one correct output. Run the co-located script rather than re-improvising it each run (deterministic, regression-testable, free; see [`cost-efficiency.md`](../../rules/cost-efficiency.md)):

```bash
bash .claude/skills/start-project/scaffold-project.sh <slug> "<one-line goal>"
```

If the script exits non-zero (collision, missing template/README, bad slug), fix the cause and re-run — don't hand-scaffold around it.

### Step 5 — Fill the Charter body into the PLAN

Write the co-designed Charter (Goal / Success / Out-of-scope), the Phases, an initial "Next-session kickoff", and a first dated line in the Session log into the scaffolded `PLAN.md`.

### Step 6 — Bind the session

From this point, this session — and every future session on this project — is governed by the lifecycle. State to the user, and hold for the rest of this session:

> **This project session MUST end with `/end-session`.** Running `/end-session` is the final step before this task is considered complete. Do not conclude the session, hand off, or report the work done until `/end-session` has been run and its commit pushed.

### Notes

- One file per project: `PLAN.md` holds Charter, Phases, Status, kickoff, and log. Do not split it.
- Intent stays mutable (lightweight model — no immutability flip). Record scope changes as dated decisions in Status, or a supersede-decision / explicit scope-cut for a big shift — don't quietly rewrite the Charter in place.
- Keep the mechanical scaffold in a script and reserve the skill (and Opus) for the Charter co-design. See [`cost-efficiency.md`](../../rules/cost-efficiency.md).
