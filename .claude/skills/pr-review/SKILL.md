---
name: pr-review
description: Investigate unresolved code review comments on a JellyRock PR. The skill (sonnet) does mechanical prep — fetches the PR's review comments via gh, sorts by file:line, groups co-located comments, and builds a structured handoff packet — then delegates to the pr-review-investigator agent (opus) for the per-comment judgment work (read code, validate, root-cause, present options, wait, implement). Use when you provide a PR number and want to systematically address review feedback one comment at a time. Distinct from /pr (which CREATES a pull request).
model: sonnet
user-invocable: true
allowed-tools: Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh api:*), Bash(git log:*), Bash(git diff:*), Bash(git status:*), Bash(git rev-parse:*), Read, Task
---

# /pr-review `<N>` — investigate PR review comments

This skill is the mechanical prep step before per-comment judgment work. The actual investigation (reading code, validating intent, presenting options) is delegated to the [`pr-review-investigator`](../../agents/pr-review-investigator.md) agent (opus), which gets a structured handoff packet from this skill.

## Inputs

`$ARGUMENTS`: required PR number (e.g., `547`). If empty, prompt for it.

## Step 1 — Pre-flight

```bash
gh pr view <N> --json number,title,state,headRefName,baseRefName,reviewDecision
```

If the PR is closed/merged, ask the user whether to proceed (sometimes you want to address comments after a merge for follow-up; usually not). If `reviewDecision` is `APPROVED` and there are zero unresolved comments, surface that and stop — there's nothing to investigate.

## Step 2 — Fetch unresolved review comments

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

## Step 3 — Order + group

Sort comments by `(path, line)` ascending. Walk the sorted list and group consecutive entries that share the same `path` AND have line ranges within ±2 lines of each other (overlapping or adjacent). That's the only grouping criterion — semantic similarity is NOT a grouping signal (per the agent's contract).

State the count and order before handing off:

> Found N unresolved comments across M files. Order: file:line walk. Co-located groups: [list, or "none"].

## Step 4 — Build the handoff packet

Format as markdown the agent can ingest:

```markdown
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

Keep bodies untruncated — the agent needs full text to judge intent.

## Step 5 — Delegate to the pr-review-investigator agent

Invoke via the Task tool with `subagent_type: pr-review-investigator`. Pass the handoff packet from Step 4 as the prompt, prefixed with the standard sub-agent boilerplate:

```text
You are the pr-review-investigator agent. The /pr-review skill has done
the mechanical prep below. Walk each comment in the order given, one at
a time, per your operating contract. Do NOT re-fetch via gh — the prep
is authoritative.

<handoff packet>
```

The agent then walks each comment per its SKILL.md contract: validate, root-cause, present 2-3 options, wait for explicit approval, implement only on approval, move to the next.

## When NOT to use

- The PR has zero unresolved review comments — there's nothing to investigate.
- You want to CREATE a PR — that's `/pr`, not `/pr-review`.
- The user pasted a single specific review comment and wants a quick read — the full investigator agent is overkill for one comment in isolation. Just read the code and answer directly.
- The PR is huge and the comments span unrelated areas — consider splitting the investigation into multiple `/pr-review` invocations focused on a subset of comments (e.g., re-run with a narrower PR, or filter the handoff packet to a single area).

## Sub-agent invocation

To invoke from a parent sub-agent: parent passes `Read .claude/skills/pr-review/SKILL.md and follow the steps for $ARGUMENTS=<PR-number>; build the handoff packet but do NOT delegate to the pr-review-investigator agent — surface the packet for review` in the Task prompt. Sub-agents shouldn't auto-delegate; the user picks when to invoke the deeper agent.
