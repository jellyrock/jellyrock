---
name: catchup
description: Session-start briefing — "where did I leave off, what's currently happening, what needs attention?" Single-call aggregator at scripts/catchup-state.js returns one JSON document with git state, open PRs, high-engagement bugs, recent bug reports, active discussion, current-branch CI runs, pending handoffs, the four journals (progress.md state cursor, signals-backlog watchlist age, recent decisions, tech-debt focus), and architecture-doc staleness. Banner detection is deterministic JSON compares (no agent text-parsing). Surfaces ship-today candidates from open followups + signals; flags stale progress.md and stale signal rows. Outputs a "Suggested next" line that hands off to /log / /done / /issue-triage / /runtime-triage / /ci-triage. Mandated by AGENTS.md's catchup-discipline rule — invoke at the start of any genuine new session, after a multi-day gap, or whenever you ask "what's the state of the world?"
model: sonnet
effort: low
audit-span: read-only
---

# /catchup — start-of-session brief

## Contract

**Goal.** Turn a cold session-start into ~30 seconds of "I know where I left off, what's running, what's open against the repo, and what to do next." This is the **daily-ritual entry point** — the thing you type first when you sit down. It exists so nothing important rots between sessions: a paused in-flight cursor, a deferred followup, a failed CI run, a stale upstream-version signal, or a high-engagement bug that the prior session never got to all surface in one read instead of being discovered piecemeal. The reasoning load is bounded — banner-checks are deterministic JSON compares against the `scripts/catchup-state.js` aggregator, and the triage half is "pick which surfaced item is the highest signal" — so this skill ships at the Sonnet tier; reserve the judgment-grade tier for what comes after (a `/focus` triage, or a direct dive into the work).

**Inputs.** None. `$ARGUMENTS` is ignored — the whole point is that the briefing comes from observed state rather than from your direction. If you already know what you want to look at, ask the targeted question directly; don't pay the briefing cost. The skill expects the repo's state surfaces to exist: the `scripts/catchup-state.js` aggregator (one JSON document over git/PRs/issues/CI/handoffs/journals/doc-staleness), plus `docs/progress.md` (state cursor + open followups), `docs/signals-backlog.md` (upstream-version watchlist), and `docs/adr/` (recent ADRs). If the aggregator errors a section, that section comes back `null` and surfaces as a banner rather than being silently dropped.

**Outputs.**

- A single structured briefing rendered to conversation, with any urgent banners (failed CI, stale journals, stale signals, action-pending signals, review-requested PRs, schema-broken journals) at the top and the routine session-state block below.
- A short `Suggested next` line at the end naming exactly one concrete move, with the jr sibling skill that's the right next step (e.g., `/issue-triage <N>`, `/ci-triage <run-id>`, `/server-upgrade`, `/pr-review <N>`, `/log followup`, `/done <slug>`).
- A `Captures for /log` tail (only when a sub-agent invokes it, or when a journal-worthy item surfaced during the read that wasn't already captured). Omit the tail if nothing surfaced; do not pad.

**Success criteria.**

- The briefing is single-pass and read-only — no write actions kicked off, no journal updates applied, no fixes attempted inline.
- Every banner check is deterministic against the aggregator JSON — never "I think this might be broken" from prose interpretation; always "this counter exceeds this threshold" against a concrete state read.
- The `Suggested next` line names jr sibling skills by their actual command names, not generic verbs. The reader should be able to copy-paste the suggestion.
- Stale or missing state surfaces (a `progress.md` older than the staleness threshold with commits since, an aggregator section that errored to `null`, a stale signal row) surface as their own banner rather than being silently dropped.
- The total wall-clock cost stays bounded (target: well under a minute on cached state). Live-recompute paths are opt-in via explicit flag, never the default.

**Failure modes to avoid.**

- **Drilling instead of briefing.** A banner like "CI run X failed" gets copied into the briefing and a "Suggested next: `/ci-triage <run-id>`" line — NOT a multi-tool investigation of why X failed. Drilling here turns a 30-second briefing into a 30-minute investigation; that's what the triage sibling skills are for. Even when the fix is obvious, surface it as a suggestion and let the user pick.
- **Improvising raw fetches when the aggregator's data is missing.** If a banner-check needs data `catchup-state.js` doesn't expose, the fix is structural — extend the aggregator and ship that in the same change. Reaching for raw `gh` / `git` / shell calls to fetch the missing piece inline produces guessed paths, brittle one-offs, and a briefing slower than the original (the aggregator exists precisely to replace ~13 parallel calls with one).
- **Auto-invoking write actions.** No `/log`, no `/done`, no `/issue-triage`, no fix-attempts, no commits. /catchup is read-only by contract. The "Suggested next" line names the right write skill; the user invokes it.
- **Asserting state from training knowledge instead of reading it.** If the briefing claims a signal is up to date, a PR is in review, a CI run passed, etc., those claims MUST come from the aggregator read this invocation performed — not from "I remember from last session." Sessions get compacted; "I remember" is hallucination dressed up as confidence.
- **Silently dropping a missing or errored state section.** If `_errors[<section>]` is populated (the section is `null`), or `progress.md` is older than the staleness threshold, that's a banner. Skipping it because "nothing to show" produces a briefing that looks clean while hiding the real signal.
- **Briefing on micro-resumes.** If the user typed `/catchup` two minutes ago and the only delta is one commit, respond with the one-line delta (`still here, last commit X`) — don't re-run the full briefing every time.

**When NOT to use.**

- You're mid-task and have a specific question — answer the question directly; don't dump a global briefing.
- You just typed `/catchup` after a 2-minute coffee break — respond "still here, last commit `<sha>`" and stop. State hasn't moved; the full briefing is noise.
- You just context-switched into a specific area (`components/video`, `source/api`, etc.) after >2 weeks — use `/ramp <area>` instead. `/catchup` is global breadth across all surfaces in one read; `/ramp` is scoped (same aggregator with `--area=`).
- You want the next move *picked and routed* for you, not just a state dump — that's `/focus` (ranks 3–5 candidates with a "Recommended" call and hands off to the right downstream skill). `/catchup` briefs; it doesn't decide.
- The user has already triaged the next move and just wants to start working. Skip the ritual; go.

## Implementation

### Step 1 — Pull state in one call

The aggregator at [`scripts/catchup-state.js`](../../../scripts/catchup-state.js) returns a single JSON document with every dynamic-state input the briefing needs. One Bash call replaces the previous ~13 parallel calls — deterministic, no agent text-parsing of mixed gh/git output, no permission-prompt-per-fetch.

```bash
node scripts/catchup-state.js --pretty
```

Top-level keys returned: `meta`, `git`, `prs`, `issues`, `ci`, `handoffs`, `progress`, `signals`, `decisions`, `tech_debt`, `docs_stale`, `_errors`. If `_errors[<section>]` is populated, that section's value is `null`; surface the error in the briefing rather than pretending the section is clean.

Optional Read calls for full-text context (parallel; only when the JSON's summary isn't enough):

- `Read docs/progress.md` (~50 lines) — the "where you left off" sentence already comes from `progress.currently_running_summary` in the JSON; only Read if you need to see specific open followups verbatim
- `Read docs/adr/<NNNN>-*.md` for a recent ADR's body — the JSON gives adr number + title + date + status for the most-recent 3 (highest number = newest); Read the body if a recent decision looks relevant to a banner

### Step 2 — Detect drift and elevate to banners

Every banner check is a deterministic compare against the aggregator JSON. **Banner-check is mandatory** — never skip silently. If a section is `null` due to `_errors`, surface that as its own banner (`⚠ catchup-state: <section> failed — <error>`) rather than letting it vanish.

Banners (top of briefing, before the template):

- **Stale `progress.md`**: when `state.progress.days_since > 7 && state.progress.commits_since > 0` → `⚠ progress.md stale — last updated <progress.last_updated>, <progress.commits_since> commit(s) since. Bump it via /log followup or /done.`
- **Stale signal rows**: when `state.signals.stale_count > 0` → `⚠ signals-backlog: <stale_count> row(s) need attention (<list slugs from rows where stale=true>).` Then, per stale row, give the right action: a row carrying `row.digest` (only `jellyfin-server-stable` does — it means an OPEN server-upgrade triage digest exists) → `<slug>: open release-triage digest #<row.digest.number> — run /server-upgrade`; any other stale row → `<slug>: upstream ahead of latest_acknowledged — run /done <slug> after reviewing (bumps latest_acknowledged, clears the flag).` Note: a mechanically-clean stable release is NOT stale (its digest auto-closed), so it never appears here — only a candidate-bearing release does.
- **Action-pending signals**: when `state.signals.action_pending_count > 0` → `📌 <count> signal(s) in action_pending status (<slugs>). These need a JellyRock change.`
- **Failed CI on this branch**: for each run in `state.ci.current_branch_runs` where `conclusion != 'success'` → `⚠ CI run "<name>" <conclusion> (<createdAt>). Suggested next: /ci-triage.`
- **Pending review-requested PRs**: when `state.prs.review_requested.length > 0` → `📥 <count> PR(s) awaiting your review: <list #N — title>.`
- **Stale architecture docs**: when `state.docs_stale.architecture.length > 0` → `📅 <count> architecture doc(s) stale: <list file (Nd)>.` (Informational only — the blocking gate fires only when a stale doc's territory is touched.)
- **Schema-broken journals**: from `_errors` for `progress` or `signals` → name the file + parser error.

### Step 3 — Compose the briefing

Format short. Banners (if any) at top, then this template — sections collapse to "(none)" when empty so the shape is consistent:

```markdown
[banner block, if any]

**Branch:** `<git.branch>` — <git.status_porcelain summary OR "clean">

**Last session activity:** <git.last_commit.subject> (`<sha>`, <relative committed_at>)

**Where you left off** (from progress.md `## Currently running`):
<progress.currently_running_summary, or "(no progress.md cursor set)">

**Open followups** (from progress.md):
- <progress.open_followups_total> open across <Object.keys(open_followups_by_area).length> areas (<area: count, area: count, ...>)
  (If 0: "(none)")

**Signals watchlist** (from signals-backlog.md; `latest_upstream` auto-fetched on each /catchup):
- <signals.rows.length> watching, <stale_count> needing attention, <action_pending_count> action_pending
  (For each row in rows: "  <slug> [status] — latest=<latest_upstream>, ack=<latest_acknowledged>" + " ← REVIEW NEEDED" suffix when row.stale; for the stable row append "(open digest #<row.digest.number>)" when row.digest is set)

**Recent decisions** (last 3 ADRs from docs/adr/):
- <YYYY-MM-DD> ADR <NNNN> <title> [<status>]

**Your open PRs:**
- #<N> — <title> (<draft? | review state>)

**PRs awaiting your review:**
- #<N> — <title> by @<author> (updated <relative>)

**High-engagement bugs** (label:bug, excluding upstream/wontfix, active in last 60d):
- #<N> — <title> (<comment count> comments, labels: <label names>, last touched <relative>)

**Recent bug reports** (label:bug, last 7d):
- #<N> — <title> (<relative date>)

**Recent discussion** (any label, comments in last 30d):
- #<N> — <title> (<comment count> recent comments, label: <primary>)

**CI on this branch** (last 3 runs):
- <run name>: <conclusion> (<relative date>)

**Tech debt focus** (top <tech_debt.top_3.length> of <high_count + medium_count + low_count>: <high_count> High / <medium_count> Medium / <low_count> Low):
  For each item in `tech_debt.top_3`: `- [<severity>] \`<slug>\` — <issue_oneline>`
  (or "(none)" when top_3 is empty)

**Pending handoffs:** <handoffs.pending.length> pending (<handoffs.pruned_count> pruned this run). Most recent: `<name>` <age_days>d ago. (or "(none)"). If count >= 10, append: "Cleanup hint: many handoffs accumulating — consider `rm`-ing the ones whose investigations are complete; >30d auto-prune handles the rest."

**Suggested next:** <one or two action items, see Step 4>
```

If nothing has changed since your last session AND the working tree is clean, surface that explicitly: "Clean tree, nothing new since `<sha>`. Probably a coffee-break resume — pick up where you left off."

### Step 4 — Hand-off to the right next-skill

Read the JSON. If something looks like an alert or a decision point, name the right next-skill in the **Suggested next** line:

- **Stale progress.md banner** → "bump it: `/log followup` to add the next deferred item, or `/done <slug-or-keyword>` to close one that shipped"
- **Stale signal rows** → for a row with `row.digest` (the `jellyfin-server-stable` row when an open server-upgrade digest exists) → "`/server-upgrade` to triage release digest #<row.digest.number>" (this is the only thing that bumps the stable anchor — clean releases auto-resolve and never appear here). For any other stale row → "review the upstream change, then `/done <slug>` to bump `latest_acknowledged`. If the change requires JellyRock work, flip `status` to `action_pending` first via `/log signal <slug>` (the action_pending banner will keep it visible until you ship)."
- **Pending handoff for an in-flight triage** → `Read .claude/handoffs/<path>.md` and follow the sibling `INVESTIGATION.md` for that skill (resume from where you parked)
- **High-engagement bug** → `/issue-triage <N>` (a label:bug issue with comment traction is the strongest "focus here next" signal)
- **Recent bug report you haven't read yet** → `/issue-triage <N>`
- **Recent discussion (non-bug) heating up** → read the issue; if it surfaces an architectural decision, capture it via `/log decision`. Don't `/issue-triage` an enhancement — that flow is bug-shaped.
- **Failed CI run on this branch** → `/ci-triage <run-id>`
- **You have a Roku log tail / crash handy** → `/runtime-triage` with the log pasted
- **PR awaiting your review** → `/pr-review <N>`
- **Stale architecture doc whose territory you're about to touch** → re-read the doc, decide whether to update or just bump `last-reviewed`

Pick at most ONE suggestion. Two means you couldn't decide; better to surface the highest-leverage item.

### Step 5 — Don't apply, just brief

This is a READ-ONLY skill. Even if a fix is obvious, surface it as the **Suggested next** line — don't kick off `/log`, `/done`, `/issue-triage`, `/runtime-triage`, or any write actions from inside `/catchup`. The user picks the next move.

If a sub-agent invokes /catchup and surfaces a capture-shaped finding (a decision was made mid-session, an idea worth tracking, a followup to defer), that sub-agent does NOT write to journals directly — it ends its report with a "Captures for /log" section so the parent can invoke `/log` for each.

## Sub-agent invocation

To invoke from a sub-agent: parent passes `Read .claude/skills/catchup/SKILL.md and follow the steps; report the briefing. Surface any capture-shaped findings in a "Captures for /log" section — do NOT write to journals directly` in the Task prompt.
