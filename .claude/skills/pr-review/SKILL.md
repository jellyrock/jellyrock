---
name: pr-review
description: Investigate unresolved code review comments on a JellyRock PR end-to-end. Fetches the PR's review comments via gh, sorts by file:line, groups co-located comments, writes a handoff packet to `.claude/handoffs/`, and continues into the per-comment investigation contract at sibling [`INVESTIGATION.md`](INVESTIGATION.md) — read code, validate, root-cause, present options, wait, implement. Dedup-first: a recent unchanged triage on the same PR (no new commits, no new comments) short-circuits to the existing handoff. Distinct from /pr (which CREATES a pull request).
model: opus
effort: high
user-invocable: true
allowed-tools: Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh api:*), Bash(git log:*), Bash(git diff:*), Bash(git status:*), Bash(git rev-parse:*), Bash(date:*), Bash(ls:*), Read, Write
---

# /pr-review `<N>` — investigate PR review comments

Single-file workflow: prep + investigation, end-to-end on opus, in main thread, no Task delegation. The mechanical prep (Steps 1-5) produces a handoff packet that's written to `.claude/handoffs/` for cross-session resume + compaction recovery + `/catchup` discovery. The per-comment investigation contract is in sibling [`INVESTIGATION.md`](INVESTIGATION.md) and is followed in main thread once Step 5 completes.

## Contract

**Goal.** Take the unresolved code-review comments on a pull request and drive them to resolution end-to-end, in one main-thread session. The mechanical prep — fetch every line comment, filter to top-level unresolved, sort by `file:line`, group co-located comments, and freeze the result into a handoff packet — feeds the per-comment investigation contract in sibling `INVESTIGATION.md` (read the code, validate the comment, root-cause, present options, wait, implement). It runs on Opus because per-comment investigation is genuine code-reasoning work, not template fill: each comment can hide a real design question, and the skill must judge intent from untruncated threads. It is dedup-first — a recent unchanged triage on the same PR (head SHA unchanged, cited files untouched, no new review activity) short-circuits to the existing handoff instead of re-prepping. Reach for it when a PR has reviewer comments you want to work through; it's the investigate-comments counterpart to `/pr`'s create-or-update.

**Inputs.** `$ARGUMENTS` is the required PR number (e.g., `547`); if empty, prompt for it. The skill reads the PR's metadata and review comments via `gh` (REST `pulls/<N>/comments`, optionally the GraphQL review-thread resolved-state), the current branch state via `git`, and any prior handoff at `.claude/handoffs/pr-review-<N>-*.md` for the dedup check.

**Outputs.** A handoff packet written to `.claude/handoffs/pr-review-<N>-<timestamp>.md` with YAML frontmatter (`created`, `target`, `branch`, `sha`, `cited-files`) and a body listing the ordered unresolved comments, co-located groups, and full untruncated comment threads — durable for cross-session resume, compaction recovery, and `/catchup` discovery; a one-line confirmation of the saved path and counts; and then the in-thread per-comment investigation itself per `INVESTIGATION.md`. On a clean dedup hit, no new file is written — the prior handoff path is surfaced with resume/re-triage/cancel options.

**Success criteria.**

- The dedup check runs first and short-circuits correctly: all three signals clean (head SHA unchanged, cited files untouched on the PR head, no new comments) → surface the prior handoff and STOP for the user's pick; any signal changed → proceed.
- Only top-level unresolved comments are treated as investigation units (replies captured as thread context, not as separate units); resolved threads filtered where the GraphQL signal is available, else degraded gracefully to "treat all as unresolved."
- Comments are ordered by `(path, line)` and co-located comments (same path, within ±2 lines) grouped as single investigations — the only grouping criterion (semantic similarity is NOT a grouping signal).
- The handoff is written with valid frontmatter and untruncated comment bodies, then the skill continues immediately into `INVESTIGATION.md` as one motion.

**Failure modes to avoid.**

- **Re-prepping over a clean dedup hit.** If all three signals are clean, do not write a new file — surface the prior handoff and wait for the user's pick.
- **Truncating comment bodies.** Keep top-level bodies and replies full — intent can't be judged from a summary.
- **Grouping by semantic similarity.** Co-location (±2 lines, same file) is the only grouping criterion; merging "related-looking" comments across files breaks the contract.
- **Treating fuzzy resolved-state as ground truth.** If the GraphQL resolved signal is unavailable or noisy, fall back to all-unresolved and let the code-read surface already-addressed comments — don't silently drop comments.
- **Stopping after the handoff.** Step 5 is "save the handoff AND continue into investigation" as one motion; don't write the file and wait.

**When NOT to use.**

- The PR has zero unresolved review comments — there's nothing to investigate.
- You want to CREATE a PR — that's `/pr`, not `/pr-review`.
- The user pasted a single specific review comment and wants a quick read — the full investigator is overkill; just read the code and answer directly.
- The PR is huge and the comments span unrelated areas — consider splitting into multiple `/pr-review` invocations focused on a subset of comments.

## Implementation

### Inputs

`$ARGUMENTS`: required PR number (e.g., `547`). If empty, prompt for it.

### Step 0 — Check for prior triage (dedup)

Before any prep, look for a recent handoff on this PR:

```bash
ls -t .claude/handoffs/pr-review-<N>-*.md 2>/dev/null | head -1
```

If a prior handoff exists, `Read` it. The handoff has a YAML frontmatter with `created`, `branch`, `sha`, `cited-files`. Check three signals:

1. **PR head SHA unchanged?** `gh pr view <N> --json headRefOid` — compare to the frontmatter's `sha` (which captured the PR head at last triage). If unchanged, no new commits were pushed.
2. **Cited files unchanged on the PR head?** `git log <sha>..<head-sha> -- <cited-files>` — empty means no commits touched them on the PR.
3. **No new comments since last triage?** `gh pr view <N> --json updatedAt` — compare to the frontmatter's `created`.

If all three are clean, **do not write a new file**. Surface to the user:

> Prior PR-review triage exists at `.claude/handoffs/pr-review-<N>-<timestamp>.md` from <relative-time>. PR head unchanged, cited files unchanged on it, and no new review activity. Options:
> - **(a) Resume from the existing triage** — Read the handoff and follow [`INVESTIGATION.md`](INVESTIGATION.md) from there
> - **(b) Re-triage anyway** — fresh prep, new handoff file
> - **(c) Cancel**

Then **STOP**. Wait for the user's pick before proceeding.

If any signal shows change (or no prior handoff exists), proceed to Step 1.

### Step 1 — Pre-flight

```bash
gh pr view <N> --json number,title,state,headRefName,baseRefName,reviewDecision
```

If the PR is closed/merged, ask the user whether to proceed (sometimes you want to address comments after a merge for follow-up; usually not). If `reviewDecision` is `APPROVED` and there are zero unresolved comments, surface that and stop — there's nothing to investigate.

### Step 2 — Fetch unresolved review comments

```bash
gh api "repos/{owner}/{repo}/pulls/<N>/comments?per_page=100" --paginate
```

Returns every line comment. Each entry has:

- `path` — file the comment is on
- `line` (or `original_line` if the line was deleted) — line number
- `body` — comment text
- `user.login` — reviewer
- `commit_id` — the commit the comment was anchored to
- `in_reply_to_id` — set if this is a thread reply

Filter to top-level comments only (drop entries with `in_reply_to_id`). Replies provide context but the top-level comment is the unit of investigation. Capture the full thread (top + all replies) per comment so the agent can read the conversation.

For PRs that use the GraphQL review-thread API to mark "resolved," the REST `comments` endpoint still returns them. If you want to filter to unresolved-only:

```bash
gh api graphql -f query='query { repository(owner:"<o>",name:"<r>"){pullRequest(number:<N>){reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{databaseId}}}}}}}'
```

Cross-reference the resulting `databaseId` set with the REST results. If GraphQL is unavailable or noisy, fall back to "treat all line comments as unresolved" — the agent will surface comments that have already been addressed when it reads the code.

### Step 3 — Order + group

Sort comments by `(path, line)` ascending. Walk the sorted list and group consecutive entries that share the same `path` AND have line ranges within ±2 lines of each other (overlapping or adjacent). That's the only grouping criterion — semantic similarity is NOT a grouping signal (per the agent's contract).

State the count and order before handing off:

> Found N unresolved comments across M files. Order: file:line walk. Co-located groups: [list, or "none"].

### Step 4 — Build the handoff packet

Construct the packet with a YAML frontmatter (so future Step-0 dedup checks can read it) plus the prep body:

```markdown
---
created: <ISO-8601 UTC timestamp from `date -u +%Y-%m-%dT%H:%M:%SZ`>
target: pr-review-<N>
branch: <git rev-parse --abbrev-ref HEAD>
sha: <PR head SHA from `gh pr view <N> --json headRefOid`>
cited-files:
  - <path-1>
  - <path-2>
---

PR <N>: <title>
Branch: <head> → <base>

Unresolved comments (ordered by file:line, N total):
  1. <path>:<line> — @<reviewer>: <one-line summary, ~80 chars>
  2. <path>:<line> — @<reviewer>: <one-line summary>
  ...

Co-located groups (treat as one investigation):
  Group A: comments #2, #3 (both on <path>:45-50)
  (or "none")

Full comment threads:

### Comment 1 — <path>:<line> — @<reviewer>
> <full top-level body, untruncated>
<reply 1, if any>
<reply 2, if any>

### Comment 2 — ...
```

Keep bodies untruncated — full text is needed to judge intent.

### Step 5 — Write the handoff and continue into investigation

1. Compute the timestamp once: `date +%Y%m%d-%H%M%S` (filename) and `date -u +%Y-%m-%dT%H:%M:%SZ` (frontmatter).

2. Write the packet to `.claude/handoffs/pr-review-<N>-<YYYYMMDD-HHMMSS>.md`.

3. Output a single confirmation line, this exact shape:

   > Handoff saved: `.claude/handoffs/pr-review-<N>-<timestamp>.md` (<count> unresolved comments across <M> files; <co-located-groups> co-located groups). Now following [`INVESTIGATION.md`](INVESTIGATION.md), one comment at a time.

4. Then **continue immediately** into the investigation contract at sibling [`INVESTIGATION.md`](INVESTIGATION.md). Don't stop or wait — Step 5's "save the handoff + continue" is one motion.

## Sub-agent invocation

To invoke from a parent sub-agent (rare): parent passes `Read .claude/skills/pr-review/SKILL.md and follow Steps 0-5 for $ARGUMENTS=<PR-number>; write the handoff file but stop before INVESTIGATION.md — surface the handoff path so the parent can decide next` in the Task prompt. Sub-agents only run the prep; they don't follow INVESTIGATION.md (which is interactive). If you discover any decisions or followups during this work, surface them at the end of your report as a `Captures for /log` section. I'll invoke /log for each. Do not write to docs/ directly.
