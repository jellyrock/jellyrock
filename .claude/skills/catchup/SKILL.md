---
name: catchup
description: Session-start briefing — "where did I leave off, what's currently happening, what needs attention?" Pulls git state, recent commits, open PRs (yours + awaiting your review), high-engagement bugs (label:bug + comment-sorted), recent bug reports (last 7d), recently-active discussion (any label, last 30d), current-branch CI runs, stale architecture docs, and the top of tech-debt.md. Outputs a concise briefing plus a "suggested next" line that hands off to /issue-triage / /runtime-triage / /ci-triage when an alert-shaped item surfaces. Invoke at the start of any genuine new session, especially after a multi-day gap, or whenever you ask "what's the state of the world?"
model: sonnet
---

# /catchup — start-of-session brief

Quick state-load skill. Goal: in <30 seconds, surface what you were working on last, what's open against the repo (PRs, high-engagement issues, recent bug reports), what's running on CI, and what needs a decision.

Distinct from `/ramp <area>`: `/catchup` is global; `/ramp` is area-scoped (used after >2 weeks not touching a specific subsystem).

## Step 1 — Pull state in parallel

```bash
# Local working state
git status --porcelain
git rev-parse --abbrev-ref HEAD
git log --oneline -5

# Open PRs awaiting your review (strongest blocker signal)
gh pr list --state open --search 'review-requested:@me' --limit 5 --json number,title,author,updatedAt

# Your own open PRs (drafts, in-flight)
gh pr list --state open --search 'author:@me' --limit 5 --json number,title,isDraft,updatedAt,reviewDecision

# High-engagement BUGS — actionable signal (filtered to label:bug to skip the
# noise from all-time-discussed enhancements / upstream-blocked items that
# can't be acted on locally)
gh issue list --state open --label bug --search 'sort:comments-desc' --limit 5 --json number,title,comments,updatedAt

# Recent bug reports (last 7 days) — fresh inbox
gh issue list --state open --label bug --search "created:>=$(date -d '7 days ago' +%Y-%m-%d)" --limit 5 --json number,title,createdAt

# Recently-active discussion (any label, last 30d, has comments) — what's
# heating up regardless of type. Surface secondary; the top signal is bugs.
gh issue list --state open --search "comments:>0 updated:>=$(date -d '30 days ago' +%Y-%m-%d)" --limit 5 --json number,title,comments,labels,updatedAt

# Recent CI runs on the current branch
gh run list --branch "$(git rev-parse --abbrev-ref HEAD)" --limit 3 --json status,conclusion,name,createdAt,event

# Architecture-doc staleness (informational signal)
npm run docs:stale --silent 2>&1 | tail -20

# Top of tech-debt.md (current debt focus)
head -50 docs/architecture/tech-debt.md

# Skills + agents added in the last 7 days
git log --since='7 days ago' --oneline -- .claude/skills/ .claude/agents/
```

Run these in parallel where possible (single message, multiple Bash calls).

## Step 2 — Compose the briefing

Format short. Use this template — sections collapse to "(none)" when empty so the shape is consistent:

```markdown
**Branch:** `<current branch>` — <clean / N file(s) modified>

**Last session activity:** <last commit subject> (`<short hash>`, <relative date>)

**Your open PRs:**
- #<N> — <title> (<draft? | review state>)

**PRs awaiting your review:**
- #<N> — <title> by @<author> (updated <relative>)

**High-engagement bugs** (label:bug, sort by comments):
- #<N> — <title> (<comment count> comments, last touched <relative>)

**Recent bug reports** (label:bug, last 7d):
- #<N> — <title> (<relative date>)

**Recent discussion** (any label, comments in last 30d):
- #<N> — <title> (<comment count> recent comments, label: <primary>)

**CI on this branch** (last 3 runs):
- <run name>: <conclusion> (<relative date>)

**Stale architecture docs:** <count>, oldest <topic> (<days old>)

**Tech debt focus:** top entries — <slug-1>, <slug-2>, <slug-3>

**New skills/agents in last 7d:** <count, with notable subjects>

**Suggested next:** <one or two action items, see Step 3>
```

If nothing has changed since your last session AND the working tree is clean, surface that explicitly: "Clean tree, nothing new since `<short hash>`. Probably a coffee-break resume — pick up where you left off."

## Step 3 — Hand-off to the right next-skill

Read the gathered state. If something looks like an alert or a decision point, name the right next-skill in the **Suggested next** line:

- **High-engagement bug** → `/issue-triage <N>` (a label:bug issue with comment traction is the strongest "focus here next" signal)
- **Recent bug report you haven't read yet** → `/issue-triage <N>`
- **Recent discussion (non-bug) heating up** → read the issue; if it surfaces an architectural decision, capture it via `/add-decision`. Don't `/issue-triage` an enhancement — that flow is bug-shaped.
- **Failed CI run on this branch** → `/ci-triage <run-id>`
- **You have a Roku log tail / crash handy** → `/runtime-triage` with the log pasted
- **PR awaiting your review** → `pr-review-analyzer` (agent) on the PR number
- **Stale architecture doc whose territory you're about to touch** → re-read the doc, decide whether to update or just bump `last-reviewed`

Pick at most ONE suggestion. Two means you couldn't decide; better to surface the highest-leverage item.

## Step 4 — Don't apply, just brief

This is a READ-ONLY skill. Even if a fix is obvious, surface it as the **Suggested next** line — don't kick off `/issue-triage`, `/runtime-triage`, or any write actions from inside `/catchup`. The user picks the next move.

## When NOT to use

- You're mid-task and asking a specific question → answer directly, don't dump a full briefing.
- You just typed `/catchup` after a 2-minute coffee break → respond "still here, last commit `<hash>`" and stop. Save the full state load for genuine session-start moments.
- You just context-switched into a specific area (`components/video`, `source/api`, etc.) after >2 weeks → use `/ramp <area>` instead. `/catchup` is global; `/ramp` is scoped.

## Sub-agent invocation

To invoke from a sub-agent: parent passes `Read .claude/skills/catchup/SKILL.md and follow the steps; report the briefing` in the Task prompt. Sub-agents should treat the briefing as authoritative for current session state.
