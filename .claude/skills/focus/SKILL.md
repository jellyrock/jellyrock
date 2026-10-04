---
name: focus
description: 'Session-start orchestrator for JellyRock. Reads the same `scripts/catchup-state.js` state `/catchup` uses, ranks what is actionable by a fixed order, recommends the single best next move (the rule that picked it, the state behind it, 1-3 alternatives), and hands it off by printing the one command to type: `/resume-project <slug>` for a tracked project, `/start-project` for project-shaped new work, a skill that covers the pick (`/ci-triage`, `/issue-triage`, `/runtime-triage`, `/pr-review`, `/server-upgrade` for investigations; `/new-setting`, `/new-migration`, `/new-api-version`, `/translation-add` for recurring "add an X" work; `/done` or `/log` for a journal fix), or, for an ad-hoc one-off, a researched, fork-free plan (forks asked in chat, saved to `.claude/plans/`) run by a Sonnet sub-agent that `/focus` supervises and reviews. Recommend-then-confirm, one command per route. Use at the start of a session when you want the next move picked rather than a state dump; `--area=<name>` scopes it to a subsystem. Distinct from `/catchup` (state briefing, never picks) and `/ramp` (area deep-dive briefing).'
model: opus
effort: high
---

# /focus — triage the next move, then hand it off

## This repo

- **Reader (Step 1).** The repo's own reader is `node scripts/catchup-state.js --pretty` (JSON; `npm run catchup:state` runs the same script), run beside the shared one as `/catchup`'s steps say; with `--area=<name>` it scopes PR and issue queries to that area. It rewrites the tracked `docs/signals-backlog.md` on every run, so that file can show modified right after Step 1: the reader's refresh, not an unclosed session (tracked-for-removal: the reader should not write).
- **Reader sections to ranks.** `_errors[<section>]` non-null or a `ci.current_branch_runs[]` entry with `conclusion != 'success'` → rank 1. `handoffs.pending[]` → rank 3. A `signals.rows[]` entry with `stale=true`, or `prs.review_requested[]` → rank 4. `issues.high_engagement_bugs[]` (most comments first) and `issues.recent_bug_reports[]` → rank 5 (GitHub issues are this repo's backlog). `tech_debt.top_3[0]` (`docs/architecture/tech-debt.md`) → rank 7.
- **Areas** for `--area`: `components`, `components/video`, `components/data`, `source`, `source/api`, `source/utils`, `tests`, `locale`, `scripts`. After a long time away from one, `/ramp <area>` is the deep-dive briefing; `/focus --area=<name>` then triages what is actionable there.
- **Handoffs** are packets in `.claude/handoffs/` (gitignored) written by the triage skills. `/focus` writes none, so it has no packet steps. A paused one is resumed by reading it and following the skill that wrote it.
- **Skills a route can name** (print the command, never run it). Triage: `/ci-triage <run-id>`, `/issue-triage <N>`, `/runtime-triage` (a pasted Roku log), `/pr-review <N>`, `/server-upgrade` (a Jellyfin release digest), `/crash-report` (the weekly crash CSV), `/dep-major` (a major dependency bump). Recipe (the recipe is the plan): `/new-setting`, `/new-migration`, `/new-api-version`, `/translation-add`; also `/tech-debt-scan` and `/docs-lint`. Capture: `/done <slug>`, `/log signal <slug>`.
- **Stale signal rows.** The `jellyfin-server-stable` row with `row.digest` set means an open release-triage digest: route to `/server-upgrade` (a clean release auto-closes its digest and never reaches here). Any other stale row (RC, roku-os): review the release notes, then `/done <slug>` if nothing changes here, or `/log signal <slug>` to set `action_pending` first.
- **Plan Landing & closeout.** A change lands when its PR merges to `main` (the operator approves the merge, per [AGENTS.md Landing](../../../AGENTS.md#landing)); the draft release then updates by itself (`.github/workflows/release-management.yml`); finalizing a release is a tag push, the operator's step. Name any other step (a device check after merge) with its exact command and who runs it.

## Contract

**Goal.** Turn a cold session-start into the right next move: rank what's actionable from observed state by a fixed order, recommend one pick with the rule that chose it, and hand it off down the one route that fits its shape. **Resume:** forward motion on an existing tracked project → `/resume-project <slug>`. **Scaffold:** new work that is project-shaped (spans sessions, crosses a phase boundary, or carries a decision worth recording) → `/start-project`. **Another skill:** a pick one of this repo's skills already covers (a triage skill for an investigation, a recipe skill for recurring "add an X" work, `/done` or `/log` for a journal fix) → that skill. **Plan:** an ad-hoc one-off becomes a written, agreed-upon plan saved to disk and executed by a fresh Sonnet sub-agent that this skill supervises — planning is judgment- and context-heavy, implementation procedural, so splitting them is cheaper (the implementation runs on Sonnet, following `/sonnet`'s steps), more accurate (no context bleed between "what" and "how"), and leaves a re-runnable artifact; the planner reviews the result and turns what the run taught into better plans. Every route but the plan is handed off by **printing the command for the user to type**, never by invoking it: a skill's `model:` pin applies only when the user types it, so an invoked `/resume-project` runs on this skill's tier instead of its own. This skill ships at the judgment-grade tier: ranking, the route call and the fork-by-fork plan interrogation are all judgment, and a wrong call sends the next session into the wrong shape.

**Inputs.** None: the triage comes from observed state, not from direction. The one exception: when this skill's `## This repo` defines areas, `--area=<name>` keeps only candidates in that area. If you already know the route — a project to resume, a new project, a one-off you can plan yourself — run that command (or plan mode) and skip `/focus`; its value is the triage, the route call, the fork interrogation and the clean hand-off.

**Outputs.**

- A triage block: the **Recommended** pick, **Why** (the ranking rule that won, and the state behind it, cited), its route with the one command to type in its own copyable block (or "reply `ok` to plan it"), and 1-3 **Alternatives**, one line each, with a command route's command in its own block under its line. Nothing else happens until the user replies.
- **On a non-plan route:** only that printed command. `/focus` writes nothing.
- **On the plan route:** a plan file at this repo's plan path with a required `**Project:** <slug | n/a>` line and the sections Context, Approach, Critical files, Verification, Landing & closeout, What this plan deliberately does NOT do — saved without a separate approval (the user's choices are the fork questions before it; the push stop is the gate after it), then a hand-off block, in a message of its own before anything runs: the one line to paste in a fresh session, alone in its own block, for the implementation tier `/focus` classified (`/sonnet <plan-path>` by default). On the default tier the run follows at once: a Sonnet sub-agent supervised to a reviewed ready-to-push message (`/sonnet`'s `## Sub-agent invocation`).
- A `Captures for /log` tail listing anything journal-worthy that surfaced and isn't captured yet, using the types `/log` records. Omit it when there are none.

**Success criteria.**

- The pick is ranked by the fixed order in the steps, and **Why** names the rule that won and cites real state (a banner, a fid, a backlog row, a commit) — never "it feels like the next thing", never an invented candidate.
- Each pick is classified into exactly one route; a resume route names the slug. Disclosure stays flat: one recommendation, a command for it and for each command-route alternative, one reply.
- Every command handed to the user sits alone in its own `text` block, so the copy button copies exactly the command.
- Every choice with two or more viable answers is asked as a chat question — the decision, the options, a **Recommended** option with why, the reply words — and the turn ends there. Never a pop-up, never a loose prose question.
- Plan content is drafted internally and never rendered to the conversation: the hand-off links the saved file. Its Approach is one recommended path, not a menu.
- The plan's Verification uses [this repo's verification commands](../../../AGENTS.md#verification-commands), never bare runners, and states their standing gotchas when the plan touches them.
- The implementation tier is classified here, where the full plan context lives (default `/sonnet`), and the hand-off block reflects it.
- A plan whose change must reach production to count as done has a filled-in `Landing & closeout` naming who lands each production step; a plan with no production artifact says `n/a — no production artifact`.

**Failure modes to avoid.**

- **Rendering plan content to conversation.** Plan headers, a critical-files table, numbered verification steps, before/after code of the change, or "I'll show it inline first" re-invent an approval gate and double the token cost. Self-check before any text while drafting: is it a fork question or a status sentence? If not, it belongs in the plan file.
- **Loose prose questions, or a pop-up.** "Want me to Y?", "let me know", "does X feel right" re-invent an approval gate; a pop-up covers the message it refers to. A choice with two or more viable answers is a structured chat question; one with a single viable answer is decided.
- **Guessing on forks.** A plan is the spec a fresh agent executes: a guessed vendor, shape or scope boundary ships as fact. When the research doesn't settle it, ask.
- **Invoking the next skill instead of printing it.** It runs on this skill's tier, not its own pin, and takes the user's choice of when to start it away from them. That includes `/snag` for a flaw found during the triage: it is a candidate (Step 2).
- **Nesting a routing wizard.** One recommendation, one reply; the next skill runs its own flow.
- **Implementing in the planning session's own context, or running a write skill there.** The sub-agent (or the fresh session) implements; this session plans, supervises and reviews. A deploy, a migration or a secret rotation belongs to that run, as the plan's Landing & closeout assigns it.
- **Re-deriving a plan for work a recipe skill covers.** The recipe is the plan; a fresh one duplicates a maintained artifact and drifts from it.
- **Punting the implementation tier downstream.** The implementing run has less context and defaults to the expensive tier by reflex.
- **Reading the whole journal.** Followups are ranked from `journal.sh list`; only the candidates weighed are read in full.
- **Launching sub-agents by default.** Inline research is right for the usual one-to-three-area task; sub-agents only when the work spans more than three areas each with conventions that need several files read.
- **An endpoint-inferred edit-site list.** For a change threaded along a chain (a field passed through layers), enumerate the edit sites mechanically; checking where the value is born and consumed misses the pass-through layers.
- **Bare runners in Verification.** They fail on a clean machine and push the implementing agent into improvising setup.
- **Skipping the hand-off block.** It records the plan and how to run it by hand; always print it, even when the sub-agent runs it.

**When NOT to use.**

- A coffee-break resume on the same task — just continue.
- You already know the route: run `/resume-project <slug>`, `/start-project`, or plan mode directly.
- You already know the work and only need a plan: use plan mode.
- Triaging one pasted alert, failure or finding — that's this repo's scoped triage skill, anchored to one signal.
- Periodic audits and cadences — this repo's audit skill; how a skill's run went — a skill audit.
- "What's been going on this week?" — a digest question; `/focus` is forward-looking.

## Implementation

Repo facts this skill reads: [this repo's plan path](../../../AGENTS.md#plan-path), its `## This repo` (areas; the skills its routes can name; any backlog files; how its own reader's banners map onto the ranks below; handoff packets, if it keeps them), and [this repo's verification commands](../../../AGENTS.md#verification-commands). Journal reads go through `bash .claude/skills/log/journal.sh`.

If `## This repo` keeps handoff packets, follow its packet steps: its check for an unfinished `/focus` (at the point its `## This repo` names), and its write at each step's end.

### Step 1 — Load state

Read `.claude/skills/catchup/SKILL.md` and follow its steps inline: its readers and banners are this triage's input, and the user sees the briefing as it is produced — without its `Suggested next` line, which Step 2's pick replaces (two "next" answers in a row contradict each other), and with its `Captures for /log` items folded into this skill's own tail. If `/catchup` already ran in this session and HEAD and the working tree are unchanged since, reuse that briefing instead (say so in one line).

Then `bash .claude/skills/log/journal.sh list` for every open followup's title, age, pin and prompt. Read an entry in full (`journal.sh show <fid>`) only once it is a candidate being weighed; never read the journal file. For a project candidate, read its PLAN's Next-session kickoff section and the `**Open questions / blockers:**` part of its Status, never the whole PLAN. Read the backlogs `## This repo` names only for their ready rows. With `--area=<name>`, keep only candidates in that area.

### Step 2 — Rank, pick one, classify its route, recommend

Rank every candidate; the first rank wins:

1. **On fire:** a reader `ERROR:`; a failing pipeline, CI run or deploy (this repo's own banners, mapped per `## This repo`); a dirty tree left by an unclosed session.
2. **Pinned followups** (`[pinned]` in `journal.sh list`): above all project work. One its body says a project tracks routes to that project (resume) with the fid after the slug, `/resume-project <slug> <fid>`, so the session starts at the followup rather than the kickoff.
3. **In-flight work to resume:** a paused handoff (where `## This repo` keeps them); an item in the journal's in-flight or running-work sections that no project tracks; a project the reader says no longer waits (every wait met).
4. **Overdue:** an overdue cadence; a dormant active project; a project whose PLAN contradicts itself (a close that should have fixed it: `/resume-project <slug>`).
5. **Cheap unblocks:** a followup whose fix is already named and small (pick the likely ones from their titles, then `show` them to confirm); a ready row in a backlog `## This repo` names.
6. **Project forward motion:** the next step in an active project's kickoff.
7. **Maintenance debt:** known smells no banner is forcing.

**No candidate in any rank:** say so in one line (the last commit, the tree's state) and stop, with no pick and no route; never promote something to fill the block.

A flaw found during this triage (the case `.claude/rules/flaw-found-mid-work.md` covers) is a candidate, not a `/snag` run: rank 1 when it takes a live system down or makes this triage's own input wrong, else rank 7. Its route is another skill, its command `/snag <the flaw in one line: what is wrong, and where>`.

The quick tree fixes the reader bannered — unpushed commits, being off the default branch, the commit gate not installed — are not ranked: they are seconds of work, not the next piece of work, so they go in the block's **Before anything:** line and never displace a pick.

Across the ranks: within one rank, consequence beats age (an item whose failure takes a live system down outranks an older, tidier one). A project whose PLAN carries an `[external-gate: <reason>]` tag (search the PLAN for it), or that the reader lists as still `waiting:` on something, is never the recommendation — show it only as an alternative, naming the gate or the wait. If a fix for the same thing has shipped twice and is failing again, recommend a gate (a test, a check), not a third fix. A candidate drawn from a followup cites its `[fid: …]`, and a count or claim in the entry is dated to its capture ("as of <captured>"), never restated as today's state.

Classify the pick into exactly one route: **resume** (an active or paused tracked project; its slug is the folder name without the `YYYY-MM-` prefix), **scaffold** (new project-shaped work), **another skill** (one that covers it: `/done` or `/log` for a journal fix, or a triage or recipe skill `## This repo` names), or **plan** (everything else). A one-off that *might* grow is a plan; a stub project can come later.

Show it in this shape, with real names only:

````markdown
**Before anything:** <only when the reader bannered one: each quick tree fix in one line, its command in its own block below it, e.g. "2 commits not pushed:" then a block holding `git push`>

**Recommended:** <the pick, one line>

**Why:** rank <n>, <the rule> — <the state behind it: the banner, `[fid: …]`, backlog row or commit, cited>.

**Route:** <resume | scaffold | another skill | plan>. <For a command route:> Type this to take it:

```text
<the one command, e.g. /resume-project <slug>>
```

<For the plan route instead:> Reply `ok` to plan it.

**Alternatives:**
1. <the pick> — <trade-off against the recommendation>; route: <route>

   ```text
   <its command, for a command route>
   ```

2. …

Reply: type a command (the recommendation's or an alternative's); `ok` for a plan-route recommendation; a number for a plan-route alternative; or say what you'd rather do.
````

Render it as Markdown, never inside a code fence of its own: only the command sits in a block, so the copy button copies exactly the command. Then end the turn.

### Step 3 — Act on the reply

- **The user typed the command:** that skill runs; `/focus` is done.
- **A number:** a command route → its command is already printed under it: point to it in one line and end the turn; a plan route → Step 4.
- **`ok`** on a plan route → Step 4.
- **A redirect:** re-rank with what the user said and show Step 2's block again.

### Step 4 — Research (plan route; read-only, inline-first)

Scope the research to the areas the change will touch: skim the three to five files it will edit or sit next to (the closest sibling, the config block to copy, the module in the same slot). A one-file fix with a known cause skips straight to Step 5.

**Enumerate chain and pass-through edit sites mechanically.** When the change threads a field, column or parameter parallel to an existing sibling along a chain, list the edit sites with `grep -rln '<sibling token>' <tree>` or by tracing the reference graph edge by edge; the plan's Critical files come from that enumeration, not a hand-picked subset.

Sub-agents are an escape hatch: at most three Explore sub-agents in parallel, one per area (they inherit the session's model on purpose: their research shapes the plan), only when the work spans more than three areas each with conventions that need several files read. Each prompt ends with the capture sentence — `End your report with a "Captures for /log" section: one "- <type>: <title> — <body>" bullet per journal-worthy item this work surfaced, where <type> is one of …; omit the section if there are none, and never write to journals yourself.` — its types spelled out from [this repo's capture types](../../../AGENTS.md#capture-types), since an Explore sub-agent loads no instruction files. Hold the captures they report for Step 6.

### Step 5 — Draft internally; ask the forks in chat

Draft the plan without rendering any of it. Conversation text in this step is one short status sentence per phase ("Drafting the plan internally — it will be saved and linked when it runs."), plus the fork questions: each a chat question with the decision, its options, a **Recommended** option with why and risk, and its reply words, carrying the context the choice needs and no plan content. Several forks may go in one message; then end the turn and wait.

Draft with this structure:

```markdown
# Plan — <title>

**Project:** <slug of the tracked project this plan advances | n/a>

## Context

<What the problem is, why now (cite the banner, `[fid: …]` or row that surfaced it), the intended outcome. Name files and prior decisions.>

## Approach (recommended only)

<The single approach, step by step, with file:line references to what the research found. No alternatives: they were settled in triage or by a fork question.>

## Critical files

| File | Change |
|---|---|
| `<path>` | <Create / Edit / Delete: one line> |

## Verification

<Numbered checks: which command, what evidence, what must pass — this repo's verification commands, never bare runners, and any standing gotcha they name that this change touches. An exact count or output comes from a dry run against the current files while drafting, never from memory.>

## Landing & closeout

<For a change that must reach production to count as done, each production step and who lands it: it lands by itself (when, and how to verify it did); the implementing session (only a routine, undoable step, the exact command approved here, run after the push); or the operator (the exact command, run right after the push; the implementing session lists it and never runs it). A followup only if the operator defers a step. With no production artifact, exactly `n/a — no production artifact`.>

## What this plan deliberately does NOT do

<Two to four scope boundaries, each with its reason.>
```

The `**Project:**` line is required: a run outside that project's session never reaches its `/end-session`, so the line is how the project's PLAN learns the work landed (`plan-run.sh land` records it, and leaves it to `/end-session` when this session holds the project).

**Classify the implementation tier.** Every fork was settled here, so the plan is fork-free and its implementation procedural: default **`/sonnet`**. Choose the judgment-grade tier only when a step needs in-flight judgment the plan cannot pre-specify (a rewrite shaped by a live measurement, an unknown root cause, a step marked "approach TBD pending <discovery>"), or when the plan meets `/sonnet`'s "must not be a Sonnet run" list (the last bullet of its *When NOT to use*; check it rather than keeping a copy here).

### Step 6 — Save, hand off, run it

Your choices are made at the fork questions (Step 5), and nothing reaches the shared branch without the push stop: there is no separate plan approval.

1. **Captures first.** For each capture held from Steps 4-5, follow `/log`'s steps. Never save the plan with captures outstanding.
2. Write the plan, once, to `<plan path>/focus-YYYY-MM-DD-<task-slug>.md` (today's date from `date +%F`, a two-to-four-word kebab-case slug). A choice that surfaces while writing it is a fork: stop, ask it in chat as Step 5 does, and write the plan after the reply, never with the choice made for the user.
3. Print the hand-off as a message of its own, before anything starts, the command alone in its own block:

   For `/sonnet` (the default): "Plan saved → [`focus-….md`](<plan path>/focus-….md) (procedural → Sonnet). Running it now as a Sonnet sub-agent; to run it yourself instead, stop me and paste this in a fresh session:"

   ```text
   /sonnet <plan path>/focus-YYYY-MM-DD-<task-slug>.md
   ```

   If a fork answer has the user act before the run (an edit only they may make, a box only they can reach), end the turn here and ask in chat: `done` starts the run, `skip` runs without it. Otherwise read `/sonnet`'s `## Sub-agent invocation` (in `.claude/skills/sonnet/SKILL.md`) and follow it: start the sub-agent, handle its stops, review its result (say what the review covered: a truncated or sampled read is a spot-check, and is called one), show the ready-to-push message, and push only on the user's `ok` or `push`. A timestamp any step writes comes from `date -u` at that write, never estimated.

   For the judgment-grade tier: "Plan saved → `<path>` (needs the judgment-grade tier: <one-line reason>). Paste this in a fresh session:"

   ```text
   Implement the plan at <plan path>/focus-YYYY-MM-DD-<task-slug>.md, then after the commit and before pushing, run bash .claude/skills/sonnet/plan-run.sh land on it
   ```

   The line carries the landing record because that route never runs `/sonnet`'s steps; keep it even when `**Project:**` is `n/a`. The user may paste the other variant: the tier is a default, not a lock.
4. **If this session is project-tracked** (it began with `/resume-project` or `/start-project`), it still ends with `/end-session`, typed by the user, never invoked here. On the Sonnet route, say so after the push and leave it to the user (they may take another pick first); on the judgment-grade tier, print `/end-session` alone in its own block right after the hand-off block. This session's PLAN log keeps the design narrative, and on the Sonnet route the landing too.

Never implement in this session's own context: the sub-agent, or the fresh session, does.

## Sub-agent invocation

To invoke from a sub-agent, the parent passes: `Read .claude/skills/focus/SKILL.md and follow Steps 1-2 only: report the Step 2 block (the recommendation, its rule and route, the alternatives) in full. Do not enter plan mode, do not print or run any hand-off, do not write to the plan path. End your report with a "Captures for /log" section: one "- <type>: <title> — <body>" bullet per journal-worthy item this work surfaced, where <type> is one of [this repo's capture types](../../../AGENTS.md#capture-types); omit the section if there are none, and never write to journals yourself.` A parent writing that prompt for an Explore sub-agent (which loads no instruction files) spells the types out from the slot in place of the link. Sub-agents never enter plan mode and never write to journals.
