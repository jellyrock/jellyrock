---
name: pr
description: Create a pull request using the JellyRock template at `.github/pull_request_template.md`. Scans branch + commits for related issues, falls back to `gh` issue search, and surfaces architecture docs whose related-files were touched. Required for all PRs in this repo — supersedes any default PR-creation flow.
model: sonnet
user-invocable: true
allowed-tools: Bash(gh pr view:*), Bash(gh issue list:*), Bash(gh issue view:*), Bash(gh search issues:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git rev-parse:*), Bash(git rev-list:*), Bash(node scripts/lint/check-touched-related-files.cjs:*), Read
---

# Create a Pull Request

Open a PR whose body comes from `.github/pull_request_template.md`, with the Issues and Docs sections filled in from real signal on the branch. This replaces the generic PR-creation flow — do not call `gh pr create` directly outside this skill.

## Pre-flight (abort if any fails)

Run in parallel:

- `git rev-parse --abbrev-ref HEAD` — must NOT be `main`.
- `git status --porcelain` — must be empty (no uncommitted changes).
- `git rev-parse --abbrev-ref --symbolic-full-name @{u}` — if no upstream, run `git push -u origin <branch>`. The permission prompt is the gate; don't ask verbally.
- `git rev-list --count @{u}..HEAD` — if non-zero, run `git push`.

If a hard check (on `main` / dirty tree) fails, stop and report. Pushing a feature branch to open its PR is obvious — don't gate it behind a verbal question.

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
