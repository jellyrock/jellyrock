---
name: pr
description: Create a pull request using the JellyRock template at `.github/pull_request_template.md`. Scans branch + commits for related issues, falls back to `gh` issue search, surfaces architecture docs whose related-files were touched, and runs the four-pillar judgment passes (tech-debt scan, decision-shape detect, followup capture) so journal hygiene is part of shipping rather than a separate manual step. Required for all PRs in this repo — supersedes any default PR-creation flow.
model: sonnet
user-invocable: true
allowed-tools: Bash(gh pr view:*), Bash(gh issue list:*), Bash(gh issue view:*), Bash(gh search issues:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git rev-parse:*), Bash(git rev-list:*), Bash(node scripts/lint/check-touched-related-files.cjs:*), Bash(node scripts/lint/decision-shape-nudge.cjs:*), Read
---

# Create a Pull Request

Open a PR whose body comes from `.github/pull_request_template.md`, with the Issues and Docs sections filled in from real signal on the branch, and run the four-pillar judgment passes BEFORE pushing so journal hygiene lands in the same change set. This replaces the generic PR-creation flow — do not call `gh pr create` directly outside this skill.

The mechanical close-loop side (move `## Currently running` → `## Recently shipped`, bump `last-updated:`) runs automatically after the PR merges via [`.github/workflows/journal-sync.yml`](../../../.github/workflows/journal-sync.yml). This skill does NOT touch that — its job is the judgment side: tech-debt entries, decision entries, and followup entries that need a human call.

## Pre-flight (abort if any fails)

Run in parallel:

- `git rev-parse --abbrev-ref HEAD` — must NOT be `main`.
- `git status --porcelain` — must be empty (no uncommitted changes).
- `git rev-parse --abbrev-ref --symbolic-full-name @{u}` — if no upstream, run `git push -u origin <branch>`. The permission prompt is the gate; don't ask verbally.
- `git rev-list --count @{u}..HEAD` — if non-zero, run `git push`.

If a hard check (on `main` / dirty tree) fails, stop and report. Pushing a feature branch to open its PR is obvious — don't gate it behind a verbal question.

## Four-pillar judgment passes (before drafting the PR body)

Three quick passes that surface journal entries the user should write — each with one-line confirm/skip per candidate. Drafts only; the user accepts before any /log invocation. Skip the whole block (with one user "skip judgment passes" confirmation) if the change is trivial (typo / dep bump / docs-only).

### Pass 1 — Tech-debt scan

Invoke [`/tech-debt-scan`](../tech-debt-scan/SKILL.md) as a sub-agent (not inline) to keep its candidate-walk from polluting the /pr skill's context. Pass:

```
Read .claude/skills/tech-debt-scan/SKILL.md and follow the steps; surface candidate slugs + ask about new debt but do NOT apply edits — return the proposed diff for the parent to confirm.
```

If the sub-agent returns proposed diffs (existing slugs to remove, new slugs to add), surface them to the user one at a time with `apply / skip / edit` per candidate. Apply via `Edit` only on user accept.

### Pass 2 — Decision-shape detect

Run the existing nudge against the branch's commit log:

```bash
node scripts/lint/decision-shape-nudge.cjs --range=main..HEAD
```

If it surfaces matches, walk them with the user: "this commit message has decision-shape language — does it close off alternatives or have a non-obvious rationale worth recording?" If yes, invoke [`/log decision`](../log/SKILL.md) for that commit. If no (the keyword was incidental), move on. Don't draft entries for commits the user dismisses.

### Pass 3 — Followup capture from PR body

While drafting the PR body's "Follow-ups" section (Step 4 below), if you find yourself writing a deferral that doesn't already have a `tech-debt.md` anchor, invoke [`/log followup`](../log/SKILL.md) for it (or [`/tech-debt-scan`](../tech-debt-scan/SKILL.md) Step 4 if it's a refactor candidate that warrants a stable slug). Reference the new slug from the PR body.

The CLAUDE.md `Followup-discipline rule` governs which journal each deferral lands in. Follow it strictly — the rule's branching logic (`/log followup` vs `/tech-debt-scan` vs `/log signal`) is the answer, not the user's preference.

## Gather context (in parallel)

- `git log main..HEAD --pretty=format:"%h %s%n%b%n---"` — full commit history on the branch.
- `git diff main...HEAD --stat` — files changed summary.
- `git diff main...HEAD --name-only` — file list.
- `node scripts/lint/check-touched-related-files.cjs --base main` — architecture docs whose `related-files:` were touched.
- `Read .github/pull_request_template.md` — the template you'll fill.

## Build the body

Start from the template literally. Keep all section headings and HTML comments intact so future editors see the same hints humans get.

### Title
Imperative mood, < 70 chars. Synthesize from commits, not just the latest. Passed via `--title`, not in the body.

### Overview
1–5 sentences describing *what* changed and *why*. Synthesize from the full commit log, not the last commit.

### Changes
Bulleted list. One line per logical change, not per file. Group related edits.

### Follow-ups — required

Mirrors the Issues-section pattern: write `None` (no bullet) when nothing is deferred; use bulleted lines only when listing actual follow-ups. Each follow-up must have a stable slug in `docs/architecture/tech-debt.md` — link the anchor inline, e.g. `- [\`itemdetails-size\`](../docs/architecture/tech-debt.md#itemdetails-size) — split per-item-type renderers into separate modules`. If a deferred item doesn't have a tech-debt entry yet, add it as part of this PR or drop the line. Don't invent deferrals to fill the section — `None` is the right answer most of the time.

### Issues — required, must contain something

**Tier 1 — local scan (always):**
- Branch name: extract any `\d+` (e.g. `fix/482-stuck-resume` → candidate #482).
- Commit messages: regex `(?i)(fix|fixes|close|closes|resolve|resolves|ref|refs|see)\s*#(\d+)` over the full log.

Confirm each candidate exists with `gh issue view <N> --json number,title,state`.

**Tier 2 — open-issue search (only if Tier 1 found nothing):**
- Extract 2–4 keywords from the PR title (skip stop words and the conventional-commit prefix).
- `gh issue list --state open --search "<keywords>" --limit 10 --json number,title,labels`
- Treat results as **candidates, not answers** — the search is fuzzy. Judge relevance from titles.

**Render:**
- Closes the issue → `Fixes #N`
- Related but not closed → `Ref #N`
- Nothing credible found → write `None` on its own line.

Never silently omit this section. If multiple plausible candidates surface and you can't judge confidently, list them and ask the user.

### Docs / context updates — required

Render every checkbox from the template; tick only those that genuinely apply (i.e. you actually edited a file in that category). Use `git diff main...HEAD --name-only` as ground truth, not intent.

## Create the PR

```sh
gh pr create \
  --title "<title>" \
  --body "$(cat <<'EOF'
<filled template — section headings exactly as in the template>
EOF
)"
```

Default to non-draft. Use `--draft` only when work is genuinely incomplete and you want CI early — and say so explicitly to the user.

## After creating

Print the PR URL. Do not summarize the body — the user can read it.

Mention once (one short line): the [`journal-sync.yml`](../../../.github/workflows/journal-sync.yml) workflow will move `## Currently running` → `## Recently shipped` automatically when this PR merges. The user does not need to run `/done running` manually unless they want to close the cursor before merge.

Skip that line when the change was trivial (the journal-sync workflow will skip too — bot/dep/docs labels, Renovate-shaped titles).
