---
name: pr
description: Create OR update a pull request using the JellyRock template at `.github/pull_request_template.md`. Detects an existing open PR for the current branch and routes to update-mode (diff body, ask, then `gh pr edit`) instead of duplicating; aborts cleanly on merged/closed PRs. Scans branch + commits for related issues, falls back to `gh` issue search, surfaces architecture docs whose related-files were touched, and runs the four-pillar judgment passes (tech-debt scan, decision-shape detect, followup capture) so journal hygiene is part of shipping rather than a separate manual step. Required for all PRs in this repo — supersedes any default PR-creation flow.
model: sonnet
effort: low
user-invocable: true
allowed-tools: Bash(gh pr view:*), Bash(gh issue list:*), Bash(gh issue view:*), Bash(gh search issues:*), Bash(gh api user --jq .login), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git rev-parse:*), Bash(git rev-list:*), Bash(git merge-base --is-ancestor:*), Bash(node scripts/lint/check-touched-related-files.cjs:*), Bash(node scripts/lint/decision-shape-nudge.cjs:*), Read, Task
---

# Create or Update a Pull Request

Open a PR whose body comes from `.github/pull_request_template.md`, with the Issues and Docs sections filled in from real signal on the branch, and run the four-pillar judgment passes BEFORE pushing so journal hygiene lands in the same change set. If a PR already exists for the current branch, route to update-mode: diff the current body against the freshly-rendered one, ask before applying, and use `gh pr edit` instead of `gh pr create`. This replaces the generic PR-creation flow — do not call `gh pr create` or `gh pr edit` directly outside this skill.

## Contract

**Goal.** Be the single, mandatory path for opening or updating a pull request in this repo. The skill renders the PR body from `.github/pull_request_template.md`, fills the Issues and Docs sections from real branch signal (not intent), and runs three judgment passes — tech-debt scan, decision-shape detect, followup capture — BEFORE the body is pushed, so journal hygiene lands in the same change set rather than as separate manual chores. It is create-or-update aware: an existing open PR for the branch routes to update-mode (diff the current body against a fresh render, confirm, then `gh pr edit`), and merged/closed PRs abort cleanly instead of opening a duplicate. It ships at the Sonnet tier because the work is template-fill + structured signal-gathering with bounded judgment, with the genuinely judgment-heavy tech-debt walk delegated to its own sub-agent — supersede any default PR-creation flow with this skill; never call `gh pr create`/`gh pr edit` directly outside it.

**Inputs.** No `$ARGUMENTS` — the skill operates on the current branch and its commits. It expects a non-`main`, non-detached branch with a clean working tree and an upstream it can push (the pre-flight establishes these, pushing the branch where needed). It reads the PR template, the branch's commit log and diff vs `main`, an existing PR's body (when one is open) including the embedded `<!-- /pr render: sha=... -->` marker, and the architecture-docs related-files lint.

**Outputs.** A created or updated pull request whose body is the filled template (section headings and HTML comments preserved) ending in a hidden `<!-- /pr render: sha=<40-char> ts=<ISO-8601-UTC> -->` marker that lets the next invocation narrow judgment-pass scope to "since last render"; an imperative-mood title with code identifiers backticked; drafted journal entries (tech-debt / decision / followup) surfaced per-candidate for the user to accept into `/log`; on the update path, a pre-render backup of the prior body in `.claude/handoffs/`; and the PR URL printed. No journal entry is written without per-candidate user accept; no body is overwritten without confirmation.

**Success criteria.**

- The pre-flight gates hold: not on `main`, not detached, clean tree, branch pushed — hard failures stop and report; an obvious push is not gated behind a verbal question.
- Existing-PR routing is correct: open → update-path (diff, confirm, `gh pr edit`); merged or closed → abort with the right recovery instruction; none → create-path.
- The four-pillar judgment passes run against the resolved `<lower>` SHA (prior render marker on update, `main` on create) so the user isn't re-asked about already-handled candidates, and each candidate is confirm/skip per-item.
- The Issues section always contains something (a real `Fixes`/`Ref #N`, or `None`); the title backticks code identifiers; the Docs checkboxes reflect the actual diff, not intent.
- `gh pr create` / `gh pr edit` / `Write` permission prompts are left intact — they are the user's gate on body content and backup creation, not suppressed.

**Failure modes to avoid.**

- **Polluting the skill's context with the tech-debt walk.** Never `Read docs/architecture/tech-debt.md` inline from inside `/pr` — that inline read IS the context pollution Pass 1 exists to prevent. Spawn `tech-debt-scan` as a `Task` sub-agent with an explicit `model: sonnet`, and never narrate sub-agent invocation while the transcript shows a `Read`.
- **Auto-applying journal entries.** The judgment passes produce drafts only; apply a tech-debt edit or invoke `/log` only on explicit per-candidate accept.
- **Overwriting a PR body without confirmation or backup.** On the update path, always diff-then-confirm and write the prior body to `.claude/handoffs/` before `gh pr edit`; if `gh pr edit` fails, the backup is the recovery path — surface it, don't claim success.
- **Opening a duplicate on a merged/closed PR.** Abort with the recovery instruction; never silently create a second PR.
- **Rephrasing the title to drop a code reference** when the spell-check precheck fails — backtick the identifier instead; dropping the reference is the wrong fix.
- **Suppressing the create/edit/Write permission prompts** by allowlisting them — they are intentional user gates.

**When NOT to use.**

- You want to investigate review comments on an existing PR — that's `/pr-review`, not `/pr` (which CREATES or updates a PR).
- There is no branch to ship (on `main`, or nothing committed) — there's nothing to open a PR for.
- You need to bypass the journal-hygiene passes for a genuinely trivial change — that's still in-scope (skip the judgment block with one confirmation), not a reason to call `gh pr create` directly.

## Implementation

`gh pr edit` and `Write` are intentionally NOT pre-approved in this skill's frontmatter — the permission prompts they trigger are the user-approval gate for body overwrites and local backup file creation. Don't try to suppress them.

The mechanical close-loop side (move `## Currently running` → `## Recently shipped`, bump `last-updated:`) runs automatically after the PR merges via [`.github/workflows/journal-sync.yml`](../../../.github/workflows/journal-sync.yml). This skill does NOT touch that — its job is the judgment side: tech-debt entries, decision entries, and followup entries that need a human call.

### Pre-flight (abort if any fails)

Run in parallel:

- `git rev-parse --abbrev-ref HEAD` — must NOT be `main`, must NOT be `HEAD` (detached). If detached, abort and ask the user to check out a branch first.
- `git status --porcelain` — must be empty (no uncommitted changes).
- `git rev-parse --abbrev-ref --symbolic-full-name @{u}` — if no upstream, run `git push -u origin <branch>`. The permission prompt is the gate; don't ask verbally.
- `git rev-list --count @{u}..HEAD` — if non-zero, run `git push`.

If a hard check (on `main` / detached HEAD / dirty tree) fails, stop and report. Pushing a feature branch to open its PR is obvious — don't gate it behind a verbal question.

### Detect existing PR (route create vs update)

Run `gh pr view --json number,url,state,isDraft,author,body,headRefOid` for the current branch. Branch on `state`:

- **`MERGED`** — abort. Print: `PR #<N> is already merged at <url>. Switch off this branch (e.g. `git switch main && git pull`) before opening a follow-up PR.` Don't try to update or open a duplicate.
- **`CLOSED`** (not merged) — abort. Print: `PR #<N> at <url> was closed without merging. Reopen manually with `gh pr reopen <N>` if you want to revive it, or start a new branch.` Don't silently open a duplicate.
- **`OPEN`** — enter the **update path**. Capture `<N>`, `<url>`, `<author.login>`, `<body>`, and `<headRefOid>` for later steps.
- **No PR exists** (`gh pr view` exits non-zero with "no pull requests found for branch") — enter the **create path** (today's flow).

#### Update-path setup (skip on create path)

1. **Author warn** (best-effort) — run `gh api user --jq .login`. If the result differs from the captured `<author.login>`, print one line: `Note: PR #<N> was opened by <other-user>. Body edits will appear under your account.` Don't abort. If `gh api user` fails (auth/rate limit), skip the warn silently — it's informational only.
2. **Resolve lower-bound SHA** — this becomes the input range for judgment passes (so the user isn't re-asked about candidates already accepted/skipped on the prior /pr render):
   1. Parse the PR body for the marker `<!-- /pr render: sha=([a-f0-9]{40}) ts=(\S+) -->`. If multiple markers exist (rare — copy-paste), take the LAST match.
   2. If a marker SHA is found AND `git merge-base --is-ancestor <sha> HEAD` exits 0 → use that SHA.
   3. Otherwise, fall back: `gh pr view --json commits --jq '.commits[0].oid'`. If that SHA is also reachable from HEAD, use it.
   4. Ultimate fallback (force-push edge case where neither prior SHA is reachable): use `main` — same scope as the create path. Print one line so the user knows the narrow scope was lost: `Note: prior /pr render SHA unreachable from HEAD (rebase or force-push?). Falling back to full-branch scope for judgment passes.`
3. The resolved SHA is referenced as `<lower>` throughout the rest of this skill. On the **create path**, `<lower>` is `main`.

### Four-pillar judgment passes (before drafting the PR body)

Three quick passes that surface journal entries the user should write — each with one-line confirm/skip per candidate. Drafts only; the user accepts before any /log invocation. Skip the whole block (with one user "skip judgment passes" confirmation) if the change is trivial (typo / dep bump / docs-only).

Both pass 1 and pass 2 use the `<lower>` SHA resolved in "Detect existing PR" above as their lower bound. On the create path that's `main` (today's behavior). On the update path it's the prior /pr render SHA — so the user isn't re-asked about candidates already accepted/skipped on a previous /pr invocation against the same PR.

#### Pass 1 — Tech-debt scan

Invoke [`/tech-debt-scan`](../tech-debt-scan/SKILL.md) as a sub-agent (not inline) to keep its candidate-walk from polluting the /pr skill's context. Spawn it with an explicit `model: sonnet` (matching `tech-debt-scan`'s own frontmatter pin) — a sub-agent with no model override inherits the *session* model, and if that session is a 1M-context model the spawn hits the "usage credits required for 1M context" gate and the pass fails. The tech-debt walk is a structured area-match + diff-propose task that sonnet handles correctly, so the explicit pin is the intended model, not a downgrade. Pass (substitute the resolved SHA for `<lower>`):

```
Read .claude/skills/tech-debt-scan/SKILL.md and follow the steps; scope the changed-files set to `git diff <lower>..HEAD --name-only` so only file areas that became relevant since the last /pr render are considered; surface candidate slugs + ask about new debt but do NOT apply edits — return the proposed diff for the parent to confirm.
```

**Anti-pattern: do not narrate "running the tech-debt scan sub-agent" while reading [`docs/architecture/tech-debt.md`](../../../docs/architecture/tech-debt.md) inline via `Read`.** That inline read IS the context-pollution this step is designed to prevent. If you find yourself about to call `Read` on `tech-debt.md` from inside `/pr`, stop and call `Task` with `subagent_type: general-purpose` AND `model: sonnet` instead. The sub-agent's job is to walk the entry list and return a diff; the parent's job is to surface that diff to the user. Never conflate the two — and never claim sub-agent invocation in narration when the JSONL will show a `Read` instead of a `Task` tool_use.

If the sub-agent returns proposed diffs (existing slugs to remove, new slugs to add), surface them to the user one at a time with `apply / skip / edit` per candidate. Apply via `Edit` only on user accept.

#### Pass 2 — Decision-shape detect

Run the existing nudge against the in-scope commit log (substitute the resolved SHA for `<lower>`):

```bash
node scripts/lint/decision-shape-nudge.cjs --range=<lower>..HEAD
```

If it surfaces matches, walk them with the user: "this commit message has decision-shape language — does it close off alternatives or have a non-obvious rationale worth recording?" If yes, invoke [`/log decision`](../log/SKILL.md) for that commit. If no (the keyword was incidental), move on. Don't draft entries for commits the user dismisses.

#### Pass 3 — Followup capture from PR body

While drafting the PR body's "Follow-ups" section (Step 4 below), if you find yourself writing a deferral that doesn't already have a `tech-debt.md` anchor, invoke [`/log followup`](../log/SKILL.md) for it (or [`/tech-debt-scan`](../tech-debt-scan/SKILL.md) Step 4 if it's a refactor candidate that warrants a stable slug). Reference the new slug from the PR body.

The CLAUDE.md `Followup-discipline rule` governs which journal each deferral lands in. Follow it strictly — the rule's branching logic (`/log followup` vs `/tech-debt-scan` vs `/log signal`) is the answer, not the user's preference.

### Gather context (in parallel)

- `git log main..HEAD --pretty=format:"%h %s%n%b%n---"` — full commit history on the branch.
- `git diff main...HEAD --stat` — files changed summary.
- `git diff main...HEAD --name-only` — file list.
- `node scripts/lint/check-touched-related-files.cjs --base main` — architecture docs whose `related-files:` were touched.
- `Read .github/pull_request_template.md` — the template you'll fill.

### Build the body

Start from the template literally. Keep all section headings and HTML comments intact so future editors see the same hints humans get.

#### Title
Imperative mood, < 70 chars. Synthesize from commits, not just the latest. Passed via `--title`, not in the body.

**Backtick every code identifier in the title** — class/component/file names like `` `GridItem` ``, `` `BaseGridView.bs` ``, `` `ItemDetails` ``. The post-merge journal-sync writes the title verbatim into `docs/progress.md` and the PR-time precheck ([`journal-sync-precheck.yml`](../../../.github/workflows/journal-sync-precheck.yml)) spell-checks it; a bare identifier fails that check. Synthesizing from commit subjects (which don't backtick) yields a bare title, so add the backticks yourself. When the precheck fails, **backtick the identifier — never rephrase the title to drop the reference** (that's the wrong fix, even though the old error message led with it). Backticks render as code in `progress.md`; GitHub shows them literally in the title, which is the accepted trade-off.

#### Overview
1–5 sentences describing *what* changed and *why*. Synthesize from the full commit log, not the last commit.

#### Changes
Bulleted list. One line per logical change, not per file. Group related edits.

#### Follow-ups — required

Mirrors the Issues-section pattern: write `None` (no bullet) when nothing is deferred; use bulleted lines only when listing actual follow-ups. Each follow-up must have a stable slug in `docs/architecture/tech-debt.md` — link the anchor inline, e.g. `- [\`itemdetails-size\`](../docs/architecture/tech-debt.md#itemdetails-size) — split per-item-type renderers into separate modules`. If a deferred item doesn't have a tech-debt entry yet, add it as part of this PR or drop the line. Don't invent deferrals to fill the section — `None` is the right answer most of the time.

#### Issues — required, must contain something

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

#### Docs / context updates — required

Render every checkbox from the template; tick only those that genuinely apply (i.e. you actually edited a file in that category). Use `git diff main...HEAD --name-only` as ground truth, not intent.

### Create or update the PR

#### Marker line (both paths)

The rendered body always ends with a hidden HTML-comment marker so subsequent /pr invocations against the same PR can narrow the judgment-pass scope to "since last render." Format, with a blank line above it:

```
<!-- /pr render: sha=<full-40-char-HEAD-sha> ts=<ISO-8601-UTC> -->
```

Resolve `<full-40-char-HEAD-sha>` via `git rev-parse HEAD`. Resolve `<ISO-8601-UTC>` via `date -u +%Y-%m-%dT%H:%M:%SZ`. The marker survives most manual body edits (it's the last line, visually unobtrusive); if a user deletes it the next /pr update degrades to PR-first-commit fallback — no harm done.

#### Create path

```sh
gh pr create \
  --title "<title>" \
  --body "$(cat <<'EOF'
<filled template — section headings exactly as in the template>

<!-- /pr render: sha=<sha> ts=<ts> -->
EOF
)"
```

Default to non-draft. Use `--draft` only when work is genuinely incomplete and you want CI early — and say so explicitly to the user. The `gh pr create` permission prompt is the user's gate on body content; that's intentional and not allowlisted.

#### Update path

1. **Render** the new title and body the same way as the create path (template + marker line at the bottom). The body describes the FULL PR (the gather-context commands run against `main..HEAD`), not just the delta since last render.
2. **Compare** the freshly-rendered title and body to the captured `<body>` and the PR's current title from the existing-PR detection step:
   - If both are byte-for-byte unchanged after re-render (modulo the marker timestamp, which always changes — strip it for the comparison) → print `PR #<N> already up to date at <url>` and stop. No backup, no `gh pr edit` call, no permission prompt.
   - Otherwise, show the user a unified diff for the title (only if changed) and a section-by-section diff for the body so they can scan it quickly. Highlight whether the change is to auto-rendered sections (Issues / Docs checkboxes) or to human-curated sections (Overview / Changes / Follow-ups) — the latter are likelier to have manual edits worth preserving.
3. **Confirm** — ask the user `apply / skip / edit-then-apply`:
   - `skip` — print `<url>` and stop. The PR body is unchanged.
   - `edit-then-apply` — let the user revise the proposed body (paste edits, or have them dictate the change) before re-prompting.
   - `apply` — proceed to backup + apply.
4. **Backup** (apply path only) — write the captured prior `<body>` to `.claude/handoffs/pr-<N>-pre-render-<ISO-8601-compact-ts>.md`. The `Write` tool will trigger a permission prompt; that's expected — it's the user's last gate before the body is overwritten. The backup file is gitignored and auto-pruned by `/catchup` after 30 days.
5. **Apply** via:

   ```sh
   gh pr edit <N> [--title "<new-title>"] --body "$(cat <<'EOF'
   <filled template + marker>
   EOF
   )"
   ```

   Pass `--title` only if it actually changed. The `gh pr edit` permission prompt is the second user gate; it's intentionally NOT allowlisted in this skill's frontmatter.

   If `gh pr edit` fails (network, auth, conflict): the backup file is still on disk — the previous body wasn't lost. Tell the user the backup path and abort. They can recover by running `gh pr edit <N> --body-file <backup-path>` manually.

### After creating or updating

Print the PR URL. Do not summarize the body — the user can read it.

On the **create path**, mention once (one short line): the [`journal-sync.yml`](../../../.github/workflows/journal-sync.yml) workflow will move `## Currently running` → `## Recently shipped` automatically when this PR merges. The user does not need to run `/done running` manually unless they want to close the cursor before merge.

On the **update path**, skip that line — the user already saw it on the initial /pr.

Skip the journal-sync line when the change was trivial too (the journal-sync workflow will skip on its own — bot/dep/docs labels, Renovate-shaped titles).
