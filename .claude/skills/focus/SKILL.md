---
name: focus
description: Session-start triage + routing. Reads the same `scripts/catchup-state.js` aggregator that `/catchup` uses, ranks 3–5 next-move candidates across five tiers (Resume / Blocked / Drift / Hot / Momentum), presents a numbered menu with a "Recommended" call that cites the rule, then routes the user pick to the right path: in-thread domain triage (`/issue-triage`, `/ci-triage`, `/runtime-triage`, `/pr-review`) for investigations; the matching recipe skill (`/new-setting`, `/new-migration`, …) for "add an X" work (the recipe IS the plan); `/done` / `/log` for captures; an ad-hoc quick-fix → plan-file → `/sonnet` hand-off for procedural one-offs with no recipe skill; and `/start-project` / `/resume-project <slug>` for project-shaped work. Read-only apart from the one plan file the quick-fix route writes — routing is by printing the exact invocation, not by invoking other skills. Distinct from `/catchup` (state briefing, one suggestion) and `/ramp` (area-scoped deep-dive). Use when starting a fresh session and you want help picking *which* of several plausible next moves to take, and the right path to take it down; for a state-only briefing prefer `/catchup`.
model: opus
effort: high
---

# /focus — triage the next move

## Contract

**Goal.** Turn a cold session-start into the right next move — rank what's actionable from observed state, surface a short menu with a recommended call, then route the chosen pick down the path that fits its shape. JellyRock has a rich domain-skill set, so `/focus` is a **tier-ranking router**: it ranks 3–5 candidates across five tiers (Resume / Blocked / Drift / Hot / Momentum), presents a numbered menu with a "Recommended" line that cites the ranking rule, and on the user's pick routes to the right path. Most picks route **in-thread** to a domain skill — an investigation (CI / crash-log / issue / PR-comments) to the matching triage skill, an "add a setting / migration / api-version / translation" to the matching recipe skill (the committed recipe IS the better plan — don't re-derive it), a stale signal or cursor to `/done` / `/log`. Two routes are heavier: an **ad-hoc procedural one-off with no dedicated recipe skill** becomes a written, agreed-upon plan saved to disk and handed off to a fresh `/sonnet` session — planning is judgment-heavy and context-heavy while implementation is procedural, so splitting the two across sessions is cheaper (the implementation session runs at the Sonnet tier via `/sonnet`), more accurate (no context bleed between "what to do" and "how to do it"), and leaves a re-runnable artifact; and **project-shaped work** (spans multiple sessions, crosses a phase boundary, or carries a decision worth recording) routes to `/start-project` (new) or `/resume-project <slug>` (forward motion on a tracked project). This skill ships at the judgment-grade tier — ranking the menu, making the recommended call, and (on the quick-fix route) interrogating the plan fork-by-fork are all judgment, and the cost of guessing wrong is a plan or a route that sends the next session into the wrong shape.

**Inputs.** `$ARGUMENTS`: optional `--area=<name>` to scope triage to one subsystem (mirrors `/ramp`). Valid areas are the list `scripts/catchup-state.js` accepts (`components`, `components/video`, `components/data`, `source`, `source/api`, `source/utils`, `tests`, `locale`, `scripts`). Omit for global triage. If you already know the route — a specific project to resume, a new project to start, or a one-off you can plan directly — invoke the explicit command (`/resume-project <slug>`, `/start-project`, or plan mode) and skip `/focus`; its value is the triage half, the ranking call, and the clean route.

**Outputs.**

- A numbered **triage menu** (3–5 candidates, each carrying its tier label in brackets and ending in the exact invocation to run if picked) plus a **Recommended** line that names the pick and cites the ranking rule that chose it. The user replies with a number, free-form context, `skip`, or `none` before anything executes.
- On a triage / capture / recipe pick: a 1–5 line **session-context preamble** surfaced in the conversation, then the exact downstream invocation — `/focus` routes by **printing** the invocation, not by invoking the other skill itself.
- On the **quick-fix** route only: a written plan file saved at `.claude/plans/focus-YYYY-MM-DD-<slug>.md` with the standard sections — Context (the why — which banner / followup / pick surfaced the work), Approach (single recommended approach, not a menu), Critical files (scope envelope as a table), Verification (numbered checklist with JellyRock's canonical npm wrappers), What this plan deliberately does NOT do (scope boundaries) — rendered as the user's approval preview via the plan-mode dialog (the user edits the markdown inline before approving), followed by a copy-paste `/sonnet <plan-path>` hand-off block naming the saved file.
- On a **scaffold / resume** route: once the route is confirmed, the matching lifecycle invocation (`/start-project` / `/resume-project <slug>`) is named for the user to run — `/focus` writes no plan file in this case.
- A `Captures for /log` tail listing any followups / decisions surfaced during triage or research that aren't yet journaled. Omit if nothing surfaced; do not pad.

**Success criteria.**

- The menu ranks candidates by the fixed tier rubric (Resume > Blocked > Drift > Hot > Momentum; ties break on recency), caps each category so no one tier crowds the menu, and never lets a Tier-1/Tier-2 blocker fall off the end.
- A **Recommended** line is always present — even on close calls — and cites the *rule* that picked the winner ("blockers > drift > hot > momentum"), so the reasoning is transparent and overridable.
- Each pick is routed to exactly the path that fits its shape: investigation → in-thread domain triage; "add an X" → the recipe skill (not a re-derived plan); stale signal/cursor → `/done` / `/log`; ad-hoc procedural one-off with no recipe → quick-fix plan → `/sonnet`; project-shaped → `/start-project` / `/resume-project <slug>` (resume names the slug).
- On the quick-fix route: every design choice with two or more viable answers is resolved via `AskUserQuestion` (never free-form prose), plan content is drafted INTERNALLY and first rendered in the plan-mode dialog (the sole preview surface), the Approach is a single recommended path, and the Verification section names JellyRock's canonical npm wrappers (`npm run validate` / `test:scripts` / `test:tdd` / `lint`), never bare runners.
- The implementation tier is classified by `/focus` (default `/sonnet`; the judgment-grade tier only when a plan step needs in-flight judgment the plan can't pre-specify) and reflected in the hand-off block — the choice is made here, where the full plan context lives, not punted to the fresh session.
- Routing happens by **printing** the exact downstream invocation; `/focus` writes nothing except the one plan file on the quick-fix route, and never auto-invokes a route before the user picks it.
- The Recommended line and the routing preamble cite specific state — a named handoff, a failed CI run, a stale signal slug, a hot issue number — never "it feels like the next thing."

**Failure modes to avoid.**

- **Re-deriving a plan for work that already has a recipe skill.** "Add a setting / migration / api-version / translation" routes to the committed recipe (`/new-setting`, …) — the recipe IS the plan. Writing a fresh quick-fix plan for it duplicates a maintained artifact and drifts from it. The quick-fix → plan → `/sonnet` route earns its keep ONLY on ad-hoc procedural work with no dedicated skill.
- **Rendering plan content to conversation before EnterPlanMode** (quick-fix route). Any user-facing text before the `EnterPlanMode` call that contains plan markdown headers, a critical-files table, numbered verification steps, before/after code blocks, or any phrasing equivalent to "I'll show it inline first" / "does this look right before plan mode" is a structural failure — it double-gates approval and doubles token cost. Self-check before sending any text during plan-drafting: would it be load-bearing without the plan-mode dialog? If yes, you're re-rendering; delete it.
- **Free-form questions in place of `AskUserQuestion`** (quick-fix route). Conversation prose like "want me to Y?" / "two confirmations before plan mode" / "which would you prefer" is the same anti-pattern with different wording. The trigger is mechanical: if you catch yourself drafting text containing `?`, `let me know`, `should we Y` — STOP and convert it into an `AskUserQuestion` call, or decide it yourself if it's genuinely not a fork.
- **Guessing on forks.** The No-fabrication rule applies in spades to plan content because the plan becomes the spec `/sonnet` executes against. A guessed api-version, a guessed BrightScript component path, a guessed scope boundary ships as a fact and corrupts the implementation. When the answer isn't load-bearing-obvious from the research, ask via `AskUserQuestion`.
- **Auto-implementing in the same session** (quick-fix route). The planning / implementation context-split is load-bearing. Once the plan lands and the hand-off block is printed, STOP — don't start executing the plan in this session.
- **Punting the impl-model choice downstream.** Deciding the implementation tier (`/sonnet` vs the judgment-grade tier) is `/focus`'s call, made here where the full plan context lives — NOT deferred to the fresh session, which has *less* context and tends to default to the expensive tier by reflex. A fork-free "apply these edits, run these gates" plan is `/sonnet`; reserve the judgment-grade tier only for a step the plan cannot pre-specify (a perf rewrite shaped by a live run, an unknown-root-cause debug).
- **Bare-runner verification steps** (quick-fix route). A Verification step that names `bsc` / `vitest` / `markdownlint-cli2` directly instead of JellyRock's npm wrapper (`npm run validate` / `test:scripts` / `test:tdd` / `lint`) breaks on a clean machine — the wrappers encode the bsc project files, lint chain, and Roku-deploy conventions — and pushes the implementing agent into environmental yak-shaving. Spell out the wrapper.
- **Skipping the hand-off block** (quick-fix route). The closing `/sonnet <plan-path>` copy-paste block is the load-bearing artifact for the cross-session pattern. Without it the user has to construct the implementation-session prompt themselves; always print it.
- **Writing journals or invoking downstream skills.** Apart from the one quick-fix plan file, `/focus` is read-only: it doesn't bump frontmatter, doesn't create handoffs, doesn't auto-invoke `/ci-triage` / `/start-project` / `/resume-project`. It routes by printing the exact invocation for the user to run; the downstream skill owns the writes that follow.
- **Pre-executing a route before the pick.** Always end the turn after the menu. Don't start an investigation, write a plan, or invoke a lifecycle command before the user replies — Step 5 is the user's call.

**When NOT to use.**

- You're mid-task and want to know "what's the state of X?" → answer directly or use `/catchup`; don't run an opus triage cycle.
- You're context-switching into a specific subsystem after a long time away → use `/ramp <area>` for the deep-dive briefing, then `/focus --area=<name>` if you also need to triage what's actionable there.
- Same session, you already ran `/focus` and picked a route — don't re-run; follow the route you picked.
- **You already know the route.** If you know you want to resume a specific project, run `/resume-project <slug>` directly; if the work is a new tracked project, run `/start-project`; if you have a one-off you can plan yourself, use plan mode. `/focus`'s value is the triage half — it points at the right command, it doesn't replace the direct entry points.
- The aggregator failed (`_errors` populated for `git` or every major section) → fix the underlying breakage first; `/focus` on broken state produces noise.

## Implementation

> The Contract above is the stable surface. The steps below are JellyRock's concrete triage + routing mechanics — the `scripts/catchup-state.js` reads, the tier rubric tuned to JellyRock's domain skills, and the per-pick routing. Edit these freely; the Contract is the audit target.

When you've been away for a day or a week and multiple things look actionable — a pending handoff, red CI, a stale signal row, a high-engagement bug, a procedural cleanup, a project to resume — `/focus` ranks them against a fixed rubric, surfaces a 3–5 item menu, makes a "Recommended" call you can override, then routes the chosen path. Distinct from siblings:

- `/catchup` (sonnet, read-only briefing) — "What's the state of the world?" Single-shot, one "Suggested next" line. Use when you want context, not a deliberation.
- `/ramp <area>` (sonnet, area-scoped briefing) — "Re-load me into this subsystem." Same aggregator with `--area=`; not a triage menu.
- `/focus` (opus, triage + routing) — "Help me pick the right next move from several candidates, and the right path to take it down."

### Step 1 — Pull state in one call

The aggregator at [`scripts/catchup-state.js`](../../../scripts/catchup-state.js) returns one JSON document with every dynamic-state input the triage needs. One Bash call:

```bash
node scripts/catchup-state.js --pretty                # global
node scripts/catchup-state.js --pretty --area=<name>  # area-scoped
```

Top-level keys: `meta`, `git`, `prs`, `issues`, `ci`, `handoffs`, `progress`, `signals`, `decisions`, `tech_debt`, `docs_stale`, `_errors`. If `_errors[<section>]` is populated, surface it as a Tier 3 (Drift / schema-broken) candidate rather than letting the section silently disappear.

The aggregator surfaces handoffs + `progress.md` but **not** `docs/projects/`, so project-shaped resumes don't appear as a menu tier — they route via a free-form redirect in Step 5 (the user names the project, or `none` → "start/resume a project"). That's deliberate: wiring `docs/projects/` into the aggregator is a separate enhancement, not part of routing.

### Step 2 — Rank candidates into tiers

Build the candidate list from the JSON. Higher tier wins on tie; ties within a tier break on recency (most recent first). **Categories:**

| Tier | Category | Inputs | Cap | "Why now" template |
|---|---|---|---|---|
| 1. Resume | Pending handoff | `handoffs.pending[]` (already sorted recent-first) | 2 | "Investigation paused mid-flight — resume from `.claude/handoffs/<name>` (<age_days>d ago)" |
| 2. Blocked | Failed CI on this branch | `ci.current_branch_runs[]` where `conclusion != 'success'` | 1 | "CI run `<name>` <conclusion> (<relative createdAt>)" |
| 2. Blocked | PR review requested | `prs.review_requested[]` | 1 | "#<N> waiting on your review since <relative updatedAt>" |
| 3. Drift | Stale signal | `signals.rows[]` where `stale=true` | 1 | row with `digest` set (stable, open triage digest): "`<slug>`: open release-triage digest #<digest.number>"; else "`<slug>`: upstream moved <latest_acknowledged> → <latest_upstream>" |
| 3. Drift | Stale progress.md | `progress.days_since > 7 && progress.commits_since > 0` | 1 | "Cursor is <days_since>d stale, <commits_since> commit(s) since" |
| 3. Drift | Schema-broken journal | `_errors.progress` / `_errors.signals` (non-null) | 1 | "Parser error in <file>: <msg>" |
| 4. Hot | High-engagement bug | `issues.high_engagement_bugs[]` (top 1 by comments) | 1 | "#<N> — <title> (<comments> comments, last touched <relative>)" |
| 4. Hot | Recent bug report | `issues.recent_bug_reports[]` (top 1, last 7d) | 1 | "#<N> — <title> (filed <relative>)" |
| 5. Momentum | Top tech-debt slug | `tech_debt.top_3[0]` | 1 | "[<severity>] `<slug>` — <issue_oneline>" |

**Selection rules:**

- At most 5 candidates total in the menu. Sort by tier ascending; take the first 5.
- Always include at least one Tier 1 or Tier 2 item if any exists — never let blockers fall off the end.
- Per-category caps prevent one hot category from crowding the menu.
- Empty everywhere? Skip directly to Step 5's "nothing-urgent" branch and stop.

### Step 3 — Present the menu

Format short. Bullets carry the tier label in brackets for instant pattern recognition. Each line ends with the **exact** invocation the user should run if they pick it.

```markdown
**Triage — pick one:**

1. [Resume] `<handoff-name>` — Investigation paused mid-flight (<age>d ago). Suggested route: read `.claude/handoffs/<handoff-name>` and follow the sibling INVESTIGATION.md for that skill.
2. [Blocked] CI run `<name>` — <conclusion> (<relative>). Suggested route: `/ci-triage <run-id>`
3. [Hot] #<N> — <title> (<comments> comments, last touched <relative>). Suggested route: `/issue-triage <N>`
4. [Drift] `<slug>` signal — upstream moved <ack> → <latest>. Suggested route: `/done <slug>` after reviewing the changelog
5. [Momentum] [<severity>] `<slug>` — <issue_oneline>. Suggested route: read [tech-debt.md#<slug>](../../../docs/architecture/tech-debt.md#<slug>), then conversation

**Recommended:** #<N> (<one-sentence reason that cites the rule — e.g., "blockers > drift > hot > momentum">).

Which? Reply with the number, "skip" to dump full state via `/catchup`, "none" if nothing here lines up, or name a project / one-off you'd rather pick up.
```

**Recommended-line rules:**

- **Always include**, even on close calls. The whole point is to make the triage call.
- When the top two candidates share a tier, acknowledge the closeness: "Recommended: #3 narrowly — #2 is also reasonable if you'd rather close the loop on the in-flight handoff first."
- Cite the *rule* that picked the winner ("blockers > drift > hot > momentum"; "Tier 1 in-flight resume beats Tier 4 hot bug"). Transparent reasoning is overridable reasoning.

Then **end the turn**. Do not pre-execute any route — Step 5 is the user's call.

### Step 4 — Wait for the pick

User replies with a number, `skip`, `none`, or free-form ("3, but also remind me about #5"; "none — I want to start the offline-mode project"). The next turn handles routing.

**Don't** call `AskUserQuestion` here — the menu format is richer than the 4-option cap and the user may want to add free-form context to their pick. Just stop after Step 3 and let the user reply.

### Step 5 — Route with session context

When the user replies with a pick, branch on its shape:

#### Triage-shaped pick (Resume / Blocked CI / Blocked PR-review / Hot bug)

Surface a 3–5 line **session-context preamble** in the conversation, then name the exact downstream invocation. Example for "#2, the CI failure":

```markdown
**Session context for `/ci-triage <run-id>`:**

- Other candidates considered: <one-line each, top 2 alternates>
- Relevant journal state: <progress.md `## Currently running` summary if non-null; otherwise "(cursor unset)">
- In-flight handoffs in this area: <count + most-recent name, or "(none)">

Now invoke `/ci-triage <run-id>` to start the investigation. The triage skill will write its own handoff packet to `.claude/handoffs/`.
```

The downstream triage skill runs in the **same conversation**, so the preamble is naturally part of its context — no handoff-packet schema extension needed.

#### Recipe-shaped pick ("add a setting / migration / api-version / translation")

These don't appear as menu candidates (the aggregator doesn't surface them), but a free-form pick / redirect often is one. Route to the committed recipe skill — **the recipe IS the plan; don't re-derive it into a quick-fix plan file:**

```markdown
That's a recipe-skill job — `/new-setting` (or `/new-migration` / `/new-api-version` / `/translation-add`) carries the numbered steps + the npm verify gates for exactly this. Run `/new-setting <name>`; it's a better plan than anything I'd re-derive here.
```

#### Capture-shaped pick (Stale signal / Stale progress / Schema-broken journal)

Give the exact invocation with prefilled args. One line of context (why this matters now), then hand back. Routing depends on the row:

- **`jellyfin-server-stable` with `row.digest` set** — a candidate-bearing release left an open triage digest (clean releases auto-close theirs and never reach this tier). Route to `/server-upgrade`; that triage is what advances the anchor. Example:

```markdown
Release-triage digest #<row.digest.number> is open — the server-upgrade tracker found changes that intersect code we ship. Run `/server-upgrade` to investigate each candidate against real app usage (it edits the digest with verdicts and files sub-issues). Note: a mechanically-clean release would have auto-closed its digest, so this one genuinely needs eyes.
```

- **Any other stale row** (RC, roku-os) — the close-loop string compare fired. Example:

```markdown
Upstream moved <latest_acknowledged> → <latest_upstream>. Review the release notes first, then:

- If no JellyRock change needed: `/done <slug>` (bumps `latest_acknowledged` and clears the stale flag).
- If a JellyRock change is needed: `/log signal <slug>` to flip `status` to `action_pending` first.
```

#### Project-shaped pick (resume an active project / start new tracked work)

Forward motion on an existing tracked project, or new work that meets the project test (spans multiple sessions, crosses a phase boundary, or carries a decision worth recording). These arrive via a free-form pick / `none` redirect (they're not a menu tier — see Step 1). Recommend-then-confirm, then **name** the lifecycle invocation (don't auto-invoke):

- **Resume** — forward motion on an `active` project in `docs/projects/`. Confirm the slug, then: "That's forward motion on the `<slug>` project — run `/resume-project <slug>`; it loads the PLAN + context and binds the session to `/end-session`."
- **Scaffold** — new project-shaped work. "That's project-shaped (multi-session / phase boundary / decision worth recording) — run `/start-project <slug>` to scaffold the PLAN and Charter."

When the route is genuinely ambiguous (a one-off that *might* grow), default to the quick-fix route below and let the work prove it needs tracking — a stub project can be scaffolded later. Don't over-scaffold.

#### Ad-hoc procedural one-off (no recipe skill, not project-shaped) — quick-fix plan route

A momentum / tech-debt cleanup or a free-form procedural task with no dedicated recipe skill and not big enough to track as a project. This is the only route that writes. Hand it to a fresh `/sonnet` session via a plan file — see Step 6.

#### "skip"

Print the standard `/catchup` briefing format inline (or tell the user "invoke `/catchup` for the full state template — `/focus` is the triage cousin"). Don't auto-invoke `/catchup` — let the user pick.

#### "none"

Acknowledge: "Nothing here lines up. Last commit `<sha>`, tree <clean | dirty>. Pick something off `tech_debt.top_3` (<list>), name a project to resume, or call it a day." Exit.

#### Empty-everywhere from Step 2

Skip the menu entirely: "Nothing urgent. Last commit `<sha>`, tree clean, no pending handoffs, no failed CI, no stale signals, no hot bugs in the last 60 days. Pick something off `tech_debt.top_3` (<list>), start a project, or take the day off."

### Step 6 — Quick-fix plan route (the one route that writes)

Reached only from Step 5's ad-hoc-procedural-one-off branch. The goal: produce a written, fork-free plan a fresh `/sonnet` session can execute without further judgment.

1. **Research inline.** A few targeted `Grep` + `Read` calls to ground the approach in JellyRock's real conventions for the touched area. Inline research is the right shape for the typical 1–3-area task; only reach for a sub-agent when the work spans more than three distinct areas each needing deep reads.
2. **Resolve every fork via `AskUserQuestion`.** Any design choice with two or more viable answers — never free-form prose. The plan must be fork-free by construction, because that's what makes the implementation procedural (and so `/sonnet`-eligible).
3. **Draft the plan INTERNALLY**, then surface it via `EnterPlanMode` → `ExitPlanMode`. The plan-mode dialog is the SOLE preview surface — never render plan markdown to the conversation first. Sections: **Context** (the why — which pick / banner / followup surfaced it), **Approach** (a single recommended path, not a menu), **Critical files** (scope envelope as a table — CREATE / Edit / Delete per file), **Verification** (numbered checklist using JellyRock's npm wrappers: `npm run validate` for the BrightScript typecheck, `npm run test:scripts` for the vitest suite, `npm run test:tdd` for Roku device tests when in scope, `npm run lint` for the lint gate — never bare runners), **What this plan deliberately does NOT do** (scope boundaries).
4. **Save** the approved plan to `.claude/plans/focus-YYYY-MM-DD-<slug>.md` (the path `/sonnet` reads; gitignored, like `.claude/handoffs/`).
5. **Classify the implementation tier.** Default `/sonnet` for a fork-free procedural plan; reserve the judgment-grade tier only when a plan step needs in-flight judgment the plan can't pre-specify (a perf rewrite shaped by a live run, an unknown-root-cause debug, a step flagged "approach TBD pending discovery"). The choice is made here, not punted downstream.
6. **Print the hand-off block** and STOP — do not implement in this session:

```text
Plan saved: .claude/plans/focus-YYYY-MM-DD-<slug>.md

To implement in a fresh session:
  /sonnet .claude/plans/focus-YYYY-MM-DD-<slug>.md

(Or, if the plan needs in-flight judgment: `Implement the plan at <path>` on the judgment-grade tier.)
```

### Read-only apart from the quick-fix plan file

`/focus` doesn't write to journals, doesn't create handoffs, doesn't bump frontmatter, and doesn't auto-invoke downstream skills. Routing happens by **printing the exact invocation the user should run** (`/ci-triage`, `/new-setting`, `/done`, `/start-project`, `/resume-project`, …), not by invoking it. The single exception is Step 6's quick-fix route, which writes one plan file to `.claude/plans/` (gitignored). Downstream skills own every other write.

If a sub-agent invokes `/focus` and the menu surfaces a capture-shaped finding, the sub-agent ends its report with a "Captures for /log" section so the parent can invoke `/log` — same pattern `/catchup` uses.

## Sub-agent invocation

To invoke from a sub-agent: parent passes `Read .claude/skills/focus/SKILL.md and follow Steps 1–3 for $ARGUMENTS=<area-or-empty>; report the menu and Recommended line — do NOT execute Step 5/6 routing. If you discover any decisions or followups during this work, surface them at the end of your report as a "Captures for /log" section; I'll invoke /log for each. Do not write to journals directly.` in the Task prompt. Sub-agents surface candidates; the parent + user own the pick and the route.
