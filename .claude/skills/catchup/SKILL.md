---
name: catchup
description: "Session-start briefing: where did I leave off, what is in flight, what needs attention. One tested script reads git, the journal (followups, running work, cadences) and tracked projects and prints every fixed-threshold check that fires; JellyRock's own aggregator adds open PRs, high-engagement bugs, recent bug reports, current-branch CI, pending handoffs, the signals watchlist, recent ADRs, tech debt and architecture-doc staleness. Ends with one Suggested next move that hands off to /log, /done, /issue-triage, /runtime-triage, /ci-triage or /server-upgrade. Mandated by AGENTS.md's catchup-discipline rule: run at the start of any genuine new session, after a multi-day gap, or whenever you ask what the state of the world is."
model: sonnet
effort: low
audit-span: read-only
---

# /catchup — daily-ritual state load

## This repo

- **Own reader:** `node scripts/catchup-state.js --typed --pretty` ([source](../../../scripts/catchup-state.js)), which the shared reader runs from `catchup.conf`. Its banners and errors come back ranked in the CANDIDATES block, each with its route; its JSON (PRs, issues, CI, handoffs, signals, decisions, tech debt, doc staleness, and `_errors`) follows the `=== STATE ===` line under `=== OWN READER ===`.
- **Extra sections:** [jellyrock.md](jellyrock.md), for its sections only: its banners are the reader's typed lines now (`scripts/lib/catchup-typed.cjs`), ranked in the CANDIDATES block.
- **Handoffs:** pending handoffs are `.claude/handoffs/*.md` (untracked): a paused `/runtime-triage` resumes from its `INVESTIGATION.md`; `/crash-report` and `/server-upgrade` leave run summaries there.
- **Known write exceptions of the reader (to remove, so the tree stays clean):** it rewrites tracked `docs/signals-backlog.md` (`latest_upstream` and `last_checked` lines) and deletes handoffs older than 30 days. A dirty tree whose only change is those signal lines is this rewrite: report it as such, not as unfinished work.
- **Area re-entry:** after more than two weeks away from one subsystem, `/ramp <area>` instead of this briefing.

## Contract

**Goal.** Turn a cold session-start into ~60 seconds of "I know where I left off, what's running, what's queued, and what to do next." This is the **daily-ritual entry point** — the thing you type first when you sit down, and the state load `/focus` runs before it picks a move. It exists so nothing important rots between sessions: a paused project, a deferred followup, a failed background job, or a queued attention-item that the prior session captured as "deal with this tomorrow" all surface in one read instead of being discovered piecemeal. The reads and counts are done by a tested script, and the checks that fire come back as one list ranked in code, so the model's part is bounded — compose the briefing and take the list's first line as the next move — and this skill ships at the Sonnet tier; reserve the judgment-grade tier for what comes after (a `/focus` triage + plan-mode session, or a direct dive into the work).

**Inputs.** None. Any arguments are ignored — the whole point is that the briefing comes from observed state rather than from your direction. If you already know what you want to look at, ask the targeted question directly; don't pay the briefing cost. The skill expects this repo to have a journal (the followup journal `/log` writes: open followups plus in-flight non-project work, running jobs and recurring cadences) and reads any state beyond it (pipelines, builds, deploys) through this repo's own reader, which the shared reader runs when `catchup.conf` beside it names one. If the journal doesn't exist yet, the skill stops at Step 1 and tells the user to bootstrap it.

**Outputs.**

- A single structured briefing rendered to conversation, with any urgent banners (failures, drift, pressure, queued attention) at the top and the routine session-state block below.
- A short `Suggested next` line at the end naming exactly one concrete move, from the first line of the reader's ranked list, with the sibling skill that's the right next step (e.g., "investigate the failed pipeline via this repo's triage skill" or "pick up the project via `/resume-project <slug>`"). Choosing among options is `/focus`'s job: when that line is a pinned followup or a judgment slot, the one move is `/focus`.
- A `Captures for /log` tail listing anything journal-worthy that surfaced during the read but wasn't already captured, using the types `/log` records (for example, work noticed in passing, or recent commits that imply an unrecorded choice). Omit the tail if nothing surfaced; do not pad.

**Success criteria.**

- The briefing is single-pass and read-only — no write actions kicked off, no journal updates applied, no fixes attempted inline. The readers it runs change no tracked file either.
- Every banner check is deterministic against state — never "I think this might be broken" from prose interpretation; always "this counter exceeds this threshold" against a concrete state read.
- The `Suggested next` line names the exact thing to run — a sibling skill by its command name in this repo, or the exact command — not a generic verb. The reader should be able to copy-paste the suggestion.
- Stale or missing state surfaces (a journal that wasn't updated while work landed, a reader section that errored, an active project with no recent activity, a cadence past its next-due date) surface as their own banner rather than being silently dropped.
- The total wall-clock cost stays bounded (target: well under a minute on cached state). Live-recompute paths (re-running a coverage suite, re-fetching remote state) are opt-in via explicit flag, never the default.

**Failure modes to avoid.**

- **Drilling instead of briefing.** A banner like "pipeline X failed at step Y" gets copied into the briefing and a "Suggested next: invoke triage skill on X" line — NOT a multi-tool investigation of why X failed. Drilling here turns a 60-second briefing into a 30-minute investigation; that's what the triage / debug sibling skill is for. Even when the fix is obvious, surface it as a suggestion and let the user pick the next move.
- **Improvising raw fetches when a reader's data is missing.** If a banner-check needs data no reader exposes, the fix is structural — extend the reader (the shared one for state every repo has; this repo's own for the rest) and ship that in the same change. Reaching for raw shell / ssh / API calls to fetch the missing piece inline produces guessed paths, brittle one-offs, and a briefing that's slower than the original.
- **Re-ranking the list.** The reader ranks every check that fired, in code, by its kind; moving a line up because it sounds urgent (or down because it looks routine) makes the briefing and its `Suggested next` disagree with the list `/focus` picks from. The block's order is the briefing's order, and its first line is the move.
- **Counting by hand.** A count the briefing shows (followups, commits, projects) comes from a reader's output, never from the model tallying lines: hand counts have been wrong in exactly this briefing.
- **Auto-invoking write actions.** No `/log`, no `/done`, no fix-attempts, no commits. /catchup is read-only by contract, and so are the readers it runs: one that refreshes or rewrites a tracked file on every run leaves the tree dirty and trains everyone to ignore the dirty-tree banner. The "Suggested next" line names the right write skill; the user invokes it.
- **Asserting state from training knowledge instead of reading it.** If the briefing claims a service is healthy, a backlog row is at status X, a coverage check passed, etc., those claims MUST come from a state read this invocation performed — not from "I remember from last session." Sessions get compacted; "I remember" is hallucination dressed up as confidence.
- **Silently dropping a missing or errored state section.** If a reader prints an error for a section, or the journal is stale, that's a banner. Skipping it because "nothing to show" produces a briefing that looks clean while hiding the real signal. A failure (pipeline, build, deploy, scheduled job) is never *fully* suppressed either: one that looks auto-recovered still shows, at minimum, as a one-line info entry.
- **Briefing on micro-resumes.** If the user typed `/catchup` two minutes ago and the only delta is one commit, respond with the one-line delta (`still here, last commit X`) — don't re-run the full briefing every time.

**When NOT to use.**

- You're mid-task and have a specific question — answer the question directly; don't dump a global briefing.
- You're resuming after a coffee break, not a real gap. State hasn't moved; the briefing is noise.
- You want one project's context in depth — that's `/resume-project <slug>`; `/catchup` is breadth across all of them.
- You want the next move picked and routed, not just the state — that's `/focus`; `/catchup` briefs, it doesn't decide.
- The user is asking "what shipped this week?" or any other periodic-digest question. That's a different skill (a weekly / digest companion, if this repo keeps one); this one is the daily entry point, not a retrospective.
- The user is asking about one specific area or service in depth. That's a scoped ramp / deep-dive skill, not the global briefing; /catchup's value is breadth across all surfaces in one read.
- The user has already triaged the next move and just wants to start working. Skip the ritual; go.

## Implementation

The reader is `bash .claude/skills/catchup/catchup-state.sh` (run from anywhere in the repo; its header lists every check, threshold and line type). It also runs this repo's own reader, the command `catchup.conf` beside it names, and ranks both readers' checks into one `=== CANDIDATES ===` block at the end of its output. This repo's extra briefing sections are in this skill's `## This repo`, when it has any.

### Step 1 — Read state, once

Run the reader. Its exit code routes the skill:

| Exit | Meaning | Do |
|---|---|---|
| `0` | read (an `ERROR` line in CANDIDATES is still a banner, an own reader's failure included: Step 2) | Step 2 |
| `2` | no journal, or not a git repository (its `ERROR` lines say which) | Say so and stop; a missing journal is bootstrapped first (`/log` writes it). |
| anything else | the reader itself failed | Show what it printed and stop: the fix is the reader, never a read by hand in its place. |

Run it once and read what it printed. Never re-run its calls by hand, and never re-run the reader: if the Bash tool moves the call to the background, wait for it and read its output file. Don't read the journal file: followups are counted, not read (one entry is `bash .claude/skills/log/journal.sh show <fid>`, when needed), and every other journal section is already in the output.

### Step 2 — Banners

The `=== CANDIDATES ===` block holds every check that fired, one tab-separated line each, already ranked; a line indented two spaces under one is its detail. `ERROR` and `BANNER` lines are banners, word for word, with the value that fired them. `PIN` lines are pinned followups (fid and title). `SLOT` lines mark where judgment comes in, and are never shown as banners. `FIX` lines are quick tree fixes, said in a **Before anything** line with each one's command. `INFO` lines are one-line info entries below the banners. A `CAVEAT` line is quoted word for word on whatever it affects (a count, a section, a banner). Banners are mandatory: skipping a fired banner because it "isn't important right now" defeats the skill, and a quiet banner is a missed signal.

A failed run that a later run recovered comes as an `INFO` line, never dropped: a job that fails and recovers every night is itself a signal. A check another gate already enforces (a CI job, a pre-commit hook) shows through that gate's result, never through a second parse of what it checks.

### Step 3 — Compose the briefing

First the `ERROR`, `BANNER` and `PIN` lines in the block's order, never re-ordered: the reader set each line's place by its kind, never by how urgent it sounds. Then the **Before anything** line (when there are `FIX` lines), then the `INFO` lines. Then these sections in order, **each rendered even when empty** — an explicit "Batch jobs: none" or "Open followups: 0" is the signal that it was checked and is clean, not noise to elide:

- **Last session activity** — the last commit, and where the journal's in-flight section and the active projects' phases say you left off.
- **Active projects** — each open project's folder, status and current phase, and what it waits on, from the reader.
- **Open followups** — the total and per-category counts with the oldest age, from the reader; when it says the counts are n/a, "n/a" and a pointer to that banner (never a zero).
- **In-flight work / running jobs / recurring cadences** — the journal's other sections, as the reader printed them.
- **This repo's own sections** — what the reader printed under `=== OWN READER ===`, per `## This repo` (none, and no heading, when it names none).
- **Recent commits** — the reader's 7- and 14-day counts, then its 10 recent commits, listed. Nothing here knows when the last session was, so never call a count "since last session".
- **Suggested next** — Step 5.

Use this repo's actual vocabulary: service names, command names, file paths. The reader of the briefing is you (or a fresh sub-agent) in the next moment; concrete is faster to act on than abstract.

### Step 4 — Don't drill, don't write, just brief

The briefing is single-pass and read-only. If a banner fires, name what fired and suggest the right sibling skill — do not start investigating, do not start fixing, do not write to any journal, do not kick off any background job or live re-computation. Even when the fix looks obvious from the banner alone, surface it as `Suggested next` and let the user pick the move.

### Step 5 — Suggested next, and the captures tail

Exactly one move, from the first line of the CANDIDATES block:

- **`ERROR`** → fix what it names (followup counts n/a → the problems `journal.sh check` lists, or `journal.sh migrate` for an old journal; an own reader's failure or a `catchup.conf` problem → that reader or that file).
- **`BANNER`** → its route, the line's last field (`<slug>` in it is the project's folder name without the `YYYY-MM-` prefix); an empty route → `/focus`.
- **`PIN`** → `/focus`: it reads the followup and routes it.
- **`SLOT 3`** → an item in the journal's in-flight section that no project tracks: resume or check on it. When every item there is a project's, take the next line instead.
- **`SLOT 5-6`** or **`SLOT 7`** → `/focus`: what comes next is judgment.

Then, if anything journal-worthy surfaced during the read but wasn't already captured (work the user mentioned in passing, a commit that implies an unrecorded choice), append a `Captures for /log` tail with one `- <type>: <title> — <body>` bullet per item, where `<type>` is one of [this repo's capture types](../../../AGENTS.md#capture-types). The user invokes `/log` for each; `/catchup` itself never writes to journals.

## Sub-agent invocation

To invoke from a sub-agent, the parent passes: `Read .claude/skills/catchup/SKILL.md and follow the steps; report the briefing. Run the reader once and keep its CANDIDATES block in its order; don't re-run its calls by hand. The briefing is the deliverable — render it in full, don't summarize, and render every section even when empty. Leave out anything the journals already hold. End your report with a "Captures for /log" section: one "- <type>: <title> — <body>" bullet per journal-worthy item this work surfaced, where <type> is one of [this repo's capture types](../../../AGENTS.md#capture-types); omit the section if there are none, and never write to journals yourself.` A parent writing that prompt for an Explore sub-agent (which loads no instruction files) spells the types out from the slot in place of the link. A sub-agent this section starts treats the briefing as authoritative for current session state and never writes to journals.
