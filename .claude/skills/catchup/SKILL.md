---
name: catchup
description: Session-start briefing — "where did I leave off, what's currently happening, what needs attention?" Single-call aggregator at scripts/catchup-state.js returns one JSON document with git state, open PRs, high-engagement bugs, recent bug reports, active discussion, current-branch CI runs, pending handoffs, the four journals (progress.md state cursor, signals-backlog watchlist age, recent decisions, tech-debt focus), and architecture-doc staleness. Banner detection is deterministic JSON compares (no agent text-parsing). Surfaces ship-today candidates from open followups + signals; flags stale progress.md and stale signal rows. Outputs a "Suggested next" line that hands off to /log / /done / /issue-triage / /runtime-triage / /ci-triage. Mandated by CLAUDE.md's catchup-discipline rule — invoke at the start of any genuine new session, after a multi-day gap, or whenever you ask "what's the state of the world?"
model: sonnet
---

# /catchup — start-of-session brief

Quick state-load skill. Goal: in <30 seconds, surface what you were working on last, what's open against the repo, what's running on CI, what's accumulating in the journals, and what needs a decision.

Distinct from `/ramp <area>`: `/catchup` is global; `/ramp` is area-scoped (used after >2 weeks not touching a specific subsystem). `/ramp` uses the same aggregator with `--area=<name>`.

## Step 1 — Pull state in one call

The aggregator at [`scripts/catchup-state.js`](../../../scripts/catchup-state.js) returns a single JSON document with every dynamic-state input the briefing needs. One Bash call replaces the previous ~13 parallel calls — deterministic, no agent text-parsing of mixed gh/git output, no permission-prompt-per-fetch.

```bash
node scripts/catchup-state.js --pretty
```

Top-level keys returned: `meta`, `git`, `prs`, `issues`, `ci`, `handoffs`, `progress`, `signals`, `decisions`, `tech_debt`, `docs_stale`, `_errors`. If `_errors[<section>]` is populated, that section's value is `null`; surface the error in the briefing rather than pretending the section is clean.

Optional Read calls for full-text context (parallel; only when the JSON's summary isn't enough):

- `Read docs/progress.md` (~50 lines) — the "where you left off" sentence already comes from `progress.currently_running_summary` in the JSON; only Read if you need to see specific open followups verbatim
- `Read docs/decisions.md` last ~80 lines — the JSON gives slug + date + status for the most-recent 3; Read for the body if a recent decision looks relevant to a banner

## Step 2 — Detect drift and elevate to banners

Every banner check is a deterministic compare against the aggregator JSON. **Banner-check is mandatory** — never skip silently. If a section is `null` due to `_errors`, surface that as its own banner (`⚠ catchup-state: <section> failed — <error>`) rather than letting it vanish.

Banners (top of briefing, before the template):

- **Stale `progress.md`**: when `state.progress.days_since > 7 && state.progress.commits_since > 0` → `⚠ progress.md stale — last updated <progress.last_updated>, <progress.commits_since> commit(s) since. Bump it via /log followup or /done.`
- **Stale signal rows**: when `state.signals.stale_count > 0` → `⚠ signals-backlog: <stale_count> upstream(s) ahead of `latest_acknowledged` (<list slugs from rows where stale=true>). Run /done <slug> after reviewing each — that bumps latest_acknowledged and clears the stale flag.`
- **Action-pending signals**: when `state.signals.action_pending_count > 0` → `📌 <count> signal(s) in action_pending status (<slugs>). These need a JellyRock change.`
- **Failed CI on this branch**: for each run in `state.ci.current_branch_runs` where `conclusion != 'success'` → `⚠ CI run "<name>" <conclusion> (<createdAt>). Suggested next: /ci-triage.`
- **Pending review-requested PRs**: when `state.prs.review_requested.length > 0` → `📥 <count> PR(s) awaiting your review: <list #N — title>.`
- **Stale architecture docs**: when `state.docs_stale.architecture.length > 0` → `📅 <count> architecture doc(s) stale: <list file (Nd)>.` (Informational only — the blocking gate fires only when a stale doc's territory is touched.)
- **Schema-broken journals**: from `_errors` for `progress` or `signals` → name the file + parser error.

## Step 3 — Compose the briefing

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
- <signals.rows.length> watching, <stale_count> with upstream ahead of latest_acknowledged, <action_pending_count> action_pending
  (For each row in rows: "  <slug> [status] — latest=<latest_upstream>, ack=<latest_acknowledged>" + " ← REVIEW NEEDED" suffix when row.stale)

**Recent decisions** (last 3 from decisions.md):
- <YYYY-MM-DD> <slug> [<status>]

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

## Step 4 — Hand-off to the right next-skill

Read the JSON. If something looks like an alert or a decision point, name the right next-skill in the **Suggested next** line:

- **Stale progress.md banner** → "bump it: `/log followup` to add the next deferred item, or `/done <slug-or-keyword>` to close one that shipped"
- **Stale signal rows** → "review the upstream change, then `/done <slug>` to bump `latest_acknowledged`. If the change requires JellyRock work, flip `status` to `action_pending` first via `/log signal <slug>` (the action_pending banner will keep it visible until you ship)."
- **Pending handoff for an in-flight triage** → `Read .claude/handoffs/<path>.md` and follow the sibling `INVESTIGATION.md` for that skill (resume from where you parked)
- **High-engagement bug** → `/issue-triage <N>` (a label:bug issue with comment traction is the strongest "focus here next" signal)
- **Recent bug report you haven't read yet** → `/issue-triage <N>`
- **Recent discussion (non-bug) heating up** → read the issue; if it surfaces an architectural decision, capture it via `/log decision`. Don't `/issue-triage` an enhancement — that flow is bug-shaped.
- **Failed CI run on this branch** → `/ci-triage <run-id>`
- **You have a Roku log tail / crash handy** → `/runtime-triage` with the log pasted
- **PR awaiting your review** → `/pr-review <N>`
- **Stale architecture doc whose territory you're about to touch** → re-read the doc, decide whether to update or just bump `last-reviewed`

Pick at most ONE suggestion. Two means you couldn't decide; better to surface the highest-leverage item.

## Step 5 — Don't apply, just brief

This is a READ-ONLY skill. Even if a fix is obvious, surface it as the **Suggested next** line — don't kick off `/log`, `/done`, `/issue-triage`, `/runtime-triage`, or any write actions from inside `/catchup`. The user picks the next move.

If a sub-agent invokes /catchup and surfaces a capture-shaped finding (a decision was made mid-session, an idea worth tracking, a followup to defer), that sub-agent does NOT write to journals directly — it ends its report with a "Captures for /log" section so the parent can invoke `/log` for each.

## When NOT to use

- You're mid-task and asking a specific question → answer directly, don't dump a full briefing.
- You just typed `/catchup` after a 2-minute coffee break → respond "still here, last commit `<sha>`" and stop. Save the full state load for genuine session-start moments.
- You just context-switched into a specific area (`components/video`, `source/api`, etc.) after >2 weeks → use `/ramp <area>` instead. `/catchup` is global; `/ramp` is scoped (uses the same aggregator with `--area=`).

## Sub-agent invocation

To invoke from a sub-agent: parent passes `Read .claude/skills/catchup/SKILL.md and follow the steps; report the briefing. Surface any capture-shaped findings in a "Captures for /log" section — do NOT write to journals directly` in the Task prompt.
