---
name: pr
description: Create OR update a pull request — a typed title (`fix:`, `feat:` … from `scripts/lib/pr-title.js`, which places the change in CHANGELOG.md), category labels chosen by judgment, a concise body from `.github/pull_request_template.md` that reads as the squash commit message, and one skill-owned "review notes" comment for the detail reviewers want but `git log` doesn't. Detects an existing open PR for the current branch and routes to update-mode (diff title/labels/body/comment, ask, then apply) instead of duplicating; aborts cleanly on merged/closed PRs. Scans branch + commits for related issues, falls back to `gh` issue search, surfaces architecture docs whose related-files were touched, and runs the four-pillar judgment passes (tech-debt scan, decision-shape detect, followup capture) so journal hygiene is part of shipping rather than a separate manual step. Required for all PRs in this repo — supersedes any default PR-creation flow.
model: sonnet
effort: low
user-invocable: true
allowed-tools: Bash(gh pr view:*), Bash(gh issue list:*), Bash(gh issue view:*), Bash(gh search issues:*), Bash(gh api user --jq .login), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git rev-parse:*), Bash(git rev-list:*), Bash(git merge-base --is-ancestor:*), Bash(node scripts/lint/check-touched-related-files.cjs:*), Bash(node scripts/lint/decision-shape-nudge.cjs:*), Bash(node scripts/lint/pr-body-check.js:*), Bash(gh label list:*), Read, Task
---

# Create or Update a Pull Request

## This repo

- **Merge settings fallback** (Step 3): squash only; `squash_merge_commit_title=PR_TITLE`, `squash_merge_commit_message=PR_BODY`: the title is the commit subject and the changelog line, the body the permanent commit message, so reviewer detail goes in the notes comment.
- **Title gate and types** (Steps 5, 6, 9): read `scripts/lib/pr-title.js` (`TITLE_TYPES`: each type and the CHANGELOG.md section it lands in; CI checks against it, so read it rather than recall it). `scripts/changelog-syncer.js` places the change by the title's type. Product paths (the app a viewer runs): `components/`, `source/`, `locale/`, `images/`, `settings/`, `manifest` → `feat` new capability or setting, `fix` behavior that was wrong, `update` behavior changed on purpose, `perf` same behavior faster, `refactor` a restructure meant to change nothing (still listed: a refactor can regress), `remove`, `revert`. A scope names the PR's one area in its usual name (`fix(video):`, `chore(skills):`) and shows in the changelog line as `(video) …`; CI rejects an empty scope (`fix():`). Tooling (`scripts/`, `.github/`, `.claude/`, `tests/`, `docs/`, dev dependencies) → `chore`, `ci`, `build`, `test` or `docs`: `fix(skills):` once put a `/pr` change in the users' Fixed section (#998). The changelog reads the PR's current title, so a wrong title can be fixed after merge by editing the PR and re-syncing, until the release is cut; after that the released section is fixed text. A race fixed inside a restructure is user-visible whether or not it was reproduced ([ADR 0037](../../../docs/adr/0037-task-run-replacement.md)); #1010's first title dropped one, and #996 merged with a title that predated a credits row added in review.
- **Title spelling:** the post-merge journal-sync writes the title verbatim into `docs/progress.md`, and [`journal-sync-precheck.yml`](../../../.github/workflows/journal-sync-precheck.yml) spell-checks it at PR time: a bare identifier fails it, so backtick it (backticks render as code in `progress.md`; GitHub shows them literally in the title, the accepted trade-off).
- **Own journal passes** (Step 4):
  - **Tech debt:** spawn [`/tech-debt-scan`](../tech-debt-scan/SKILL.md) as an Agent sub-agent, `subagent_type: general-purpose`, `model: sonnet`, never `Read docs/architecture/tech-debt.md` inline. Prompt: `Read .claude/skills/tech-debt-scan/SKILL.md and follow the steps; scope the changed-files set to git diff <lower>..HEAD --name-only so only file areas that became relevant since the last /pr render are considered; surface candidate slugs + ask about new debt but do NOT apply edits — return the proposed diff for the parent to confirm.` Surface its diffs one at a time, `apply / skip / edit`; apply with `Edit` only on accept.
  - **Decision shape:** `node scripts/lint/decision-shape-nudge.cjs --range=<lower>..HEAD`; walk each match with the user (does it close off alternatives?) before `/log decision`.
  - **Followups** follow `AGENTS.md`'s Followup-discipline rule (`/log followup`, `/tech-debt-scan`'s Step 4 for a refactor slug, or `/log signal`); the rule decides, not preference.
- **Gather** (Step 5): `node scripts/lint/check-touched-related-files.cjs --base main` — architecture docs whose `related-files:` were touched; name them in the notes' Docs and journals line.
- **Sections** (Step 8): **Overview** (required) 1–5 sentences, the problem first: a reader should know from it alone whether this is the commit they want. **Changes** (required) one bullet per logical change, not per file, naming the symbols a reader would grep. **Testing** (when something was verified) 1–4 lines: what ran, where, the result (`test:unit 4503/4503 on a Roku Ultra`): the durable record of the proof ([`prove-dont-dismiss`](../../rules/prove-dont-dismiss.md)); the full matrix goes in the notes. **Follow-ups** (when something is deferred) each bullet points at its entry: a `docs/architecture/tech-debt.md` slug or a `docs/progress.md` followup; most PRs have none. `pr-body-check.js` fails an optional section that is present but empty.
- **PR checks** (Step 9): `node scripts/lint/pr-body-check.js --pr-title "<title>" --body-file <body-file>` must exit 0; `node scripts/lint/pr-body-check.js --list-refs --pr-title "<title>" < <body-file>` (and over the notes) prints each reference's resolved type, state and title for the Step 9 read; a non-zero exit is a shorthand or missing reference, and a `?` line is not a pass.
- **Labels** (Step 7): also `new-setting` (adds a user-facing setting; with `new-feature` when the setting is how a new capability is reached) and `accessibility` (added beside the main label whenever a deliverable changes what screen-reader, audio-guide or caption users get, even in one clause; never a deliverable of its own). Nothing automated reads the category labels: CHANGELOG.md goes by title type, and journal-sync skips only on `dependencies`, `documentation`, `docs-only`, `ci`, `automated`, `chore-only`. Automation's labels, never touched: `dependencies` (Renovate), `release-prep`, `merge-conflict`, and the issue-triage labels. Rulings on real PRs (two blind agents, differences settled): #1033 failed library, recovery, "#" crash, "never narrates or toasts over" → `bug-fix`, `accessibility` (the dialog-delay consolidation and RTA hooks are Changes bullets only); #1029 a song crash → `bug-fix` (the `applyItemArtwork()` merge was needed by the fix); #1024 a subtitle parser crash → `bug-fix`, `accessibility`; #991 "only the first 25 channels" + "loading programs near the focus" → `bug-fix`, `general-improvement`; #847 reskin, engine rewrite fixing "three known defects", "first functional coverage" → `general-improvement`, `bug-fix`, `dev-improvement` (the rewrite is HOW the defects were fixed, so no `code-cleanup`); #987 a `fix:` touching only bsconfig, scripts and tests → `dev-improvement`.
- **After** (Step 11), create path only and not on a trivial change: say once that [`journal-sync.yml`](../../../.github/workflows/journal-sync.yml) adds the PR to `docs/progress.md`'s Recently shipped on merge and clears `## Currently running` when its text overlaps the title; `/done running` is needed only to close it before merge.

## Contract

**Goal.** Be the single, mandatory path for opening or updating a pull request in this repo. The skill reads what a squash merge keeps (the repo's merge settings, read live), titles the PR for the place its title ends up, renders the body from the repo's PR template for whoever reads it (the permanent commit message, or a reviewer only), labels each deliverable, and runs the journal passes (decision and followup, plus any this repo adds) BEFORE anything is posted, so journal hygiene lands in the same change set rather than as separate manual chores. It is create-or-update aware: an existing open PR for the branch routes to update-mode (diff the current title, labels, body and notes against a fresh render, confirm, back up, then apply), and merged or closed PRs abort cleanly instead of opening a duplicate. It ships at the Sonnet tier because the work is template-fill and structured signal-gathering with bounded judgment; a pass that walks a large ledger runs as its own sub-agent with an explicit model. Supersede any default PR-creation flow with this skill; never call `gh pr create` or `gh pr edit` directly outside it.

**Inputs.** No arguments — the skill operates on the current branch and its commits. It expects a non-default, non-detached branch with a clean working tree; the pre-flight pushes the branch and any unpushed commits. It reads the repo's PR template, its squash-merge settings, the branch's commit log and diff against the default branch, an existing PR's title, labels, body and notes comment (when one is open) including the render marker, and this skill's `## This repo` for the repo's title rules, labels, own journal passes, PR checks and required sections.

**Outputs.** A created or updated pull request with: a title that passes the repo's title gate, names every user-visible change and backticks code identifiers; one label per kind of deliverable; a body that is the filled template, written for the reader the merge settings give it; when the body becomes the commit message, one notes comment for reviewer-only detail; and a hidden render marker (a full `sha` and an ISO-8601 UTC timestamp) that lets the next run narrow the journal passes to "since last render". Also: drafted journal entries surfaced per candidate for the user to accept into `/log`; on the update path, a backup of the prior body and notes inside the git directory; and the PR URL printed. No journal entry is written without a per-candidate accept, and nothing on the PR is overwritten without confirmation.

**Success criteria.**

- The pre-flight gates hold: not on the default branch, not detached, clean tree, branch and commits pushed — hard failures stop and report; an obvious push is not gated behind a verbal question.
- Existing-PR routing is correct: open → update path (diff, confirm, back up, apply); merged or closed → abort with the right recovery instruction; none → create path.
- What reaches `git log` is read from the repo's settings, not assumed: the body is written as a commit message only when the merge keeps it, and the title gets the most care where the merge keeps it.
- The journal passes run against the resolved lower-bound commit (the prior render marker on update, the default branch on create), so the user isn't re-asked about candidates already handled, and each candidate is confirm/skip per item.
- The title passes the repo's title gate, backticks code identifiers and names every user-visible change; on the update path it is re-derived from the whole PR.
- Labels come from the deliverables the title and the body's summary name, each shown to the user beside the phrase that earned it; tooling-only work is `dev-improvement`, `documentation` goes only on a PR that changes nothing but docs, and labels this skill does not manage are never removed.
- The body passes the repo's own PR checks before it is posted, every issue reference points where its sentence means, and in a public repo nothing private is posted.
- `gh pr create`, `gh pr edit` and `gh pr comment` permission prompts are left intact — they are the user's gate on what gets posted, not friction to allowlist away.

**Failure modes to avoid.**

- **Writing for the wrong reader.** A body written as a reviewer's note when the merge makes it the permanent commit message, or a commit-message body on a repo whose merge discards it. Read the settings first.
- **Polluting the skill's context with a ledger walk.** A pass that reads a large ledger runs as a sub-agent with an explicit model; reading the ledger inline is the context pollution the sub-agent exists to prevent, and narrating a sub-agent while the transcript shows an inline read is a false report.
- **Auto-applying journal entries.** The passes produce drafts only; invoke `/log` (or apply a ledger edit) only on an explicit per-candidate accept.
- **Overwriting a PR without confirmation or backup.** On the update path, always diff, confirm and back up the prior body and notes before `gh pr edit`; if an edit fails, the backup is the recovery path — surface it, don't claim success.
- **Opening a duplicate on a merged or closed PR.** Abort with the recovery instruction; never silently create a second PR.
- **A title that names only part of the PR.** Where the title becomes the commit subject or a changelog line it cannot be fixed after merge; re-derive it from every user-visible change, on the update path too. The likeliest omission is a behavioral fix delivered inside a refactor.
- **A type picked by habit.** Where the title's type places the change (a changelog section, a release note), choose it from what the PR delivers: a tooling-only change given a user-facing type lands in the users' notes, and a product change given a housekeeping type drops out of them.
- **Labeling a PR's ingredients instead of its purposes.** A helper the fix needed, or the tests and docs that prove or explain it, earn no label of their own; a label with no title or summary phrase to point to is dropped.
- **Detail stuffed into a commit-message body.** Measurement tables, device or host matrices and reviewer asides belong in the notes comment, with a one-line summary of the evidence left in the body.
- **Dropping a code reference to pass a check.** When a title or spelling check rejects an identifier, backtick it; rephrasing the reference away is the wrong fix.
- **Inventing a `gh --json` field, or silencing `gh`.** Ask only for fields this skill names; an unknown field fails the whole call, and `2>/dev/null` turns gh's exact error into a guess.
- **Creating a label to fit the PR.** A new label for each PR fragments the repo's label set; a missing label is replaced by the closest existing one first, and `gh label create` is proposed only as the last option, never run silently.
- **Suppressing the create, edit or comment permission prompts** by allowlisting them — they are intentional user gates.

**When NOT to use.**

- There is no branch to ship (on the default branch, or nothing committed) — there's nothing to open a PR for.
- You need to bypass the journal passes for a genuinely trivial change — that's still in scope (skip the passes with one confirmation), not a reason to call `gh pr create` directly.

## Implementation

This skill's `## This repo` holds the repo's own parts: the title gate and its types, the product paths that separate product work from tooling, labels beyond the shared table and the labels automation owns, any journal pass of its own, the PR checks to run before posting, guidance for each template section, what to say after posting, and the merge-settings fallback line. Where a step needs one of them, it says so.

### Step 1 — Pre-flight (abort if any fails)

Run in parallel:

- `git rev-parse --abbrev-ref HEAD` — must not be the default branch (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, called `<default>` below) and must not be `HEAD` (detached: ask the user to check out a branch).
- `git status --porcelain` — must be empty.
- `git rev-parse --abbrev-ref --symbolic-full-name @{u}` — no upstream → `git push -u origin HEAD`.
- `git rev-list --count @{u}..HEAD` — non-zero → `git push`.

A failed hard check (default branch, detached, dirty tree) stops with which one and why. Pushing a feature branch to open its PR is obvious: don't ask first.

### Step 2 — Detect an existing PR (route create vs update)

`gh pr view --json number,url,state,author,title,labels,body,headRefOid` for the current branch. These field names are checked against `gh`; never add one, and never add `2>/dev/null` (gh's own message names a bad field exactly).

- **`MERGED`** — abort: `PR #<N> is already merged at <url>. Switch to <default> and pull before opening a follow-up PR.`
- **`CLOSED`** — abort: `PR #<N> at <url> was closed without merging. Reopen it with gh pr reopen <N>, or start a new branch.`
- **`OPEN`** — the update path. Keep `<N>`, `<url>`, `<author>`, `<title>`, `<labels>`, `<body>`.
- **No PR** (`gh pr view` exits non-zero with "no pull requests found") — the create path; `<lower>` is `<default>`.

On the update path:

1. **Author note** — `gh api user --jq .login`; when it differs from `<author>`, print one line: `Note: PR #<N> was opened by <author>. Edits will appear under your account.` If the call fails, skip the note.
2. **Find the notes comment** — `gh pr view <N> --json comments --jq '.comments[] | select(.body | startswith("<!-- /pr notes -->")) | {url, author: .author.login, body}'`; keep the last match authored by you as `<notes>`. Its numeric id is the `#issuecomment-<id>` suffix of its `url` (the `id` field is a GraphQL node id the REST call cannot use).
3. **Resolve `<lower>`**, the lower bound for the journal passes:
   1. The last `<!-- /pr render: sha=([0-9a-f]{40}) ts=(\S+) -->` in `<notes>`, else in `<body>`; use its sha when `git merge-base --is-ancestor <sha> HEAD` exits 0.
   2. Else the PR's first commit, `gh pr view <N> --json commits --jq '.commits[0].oid'`, when it is an ancestor of `HEAD`.
   3. Else `<default>`, and print: `Note: the last render's commit is not in this branch (rebase or force-push?); the journal passes cover the whole branch.`

### Step 3 — Read what the merge keeps

`gh api 'repos/{owner}/{repo}' --jq '[.squash_merge_commit_title, .squash_merge_commit_message] | @tsv'` (gh fills `{owner}/{repo}` from the checkout). These fields come back only with enough rights on the repo; when they are empty, use the merge-settings line in this skill's `## This repo`, and when that is missing too, ask in chat which of the readings below holds. The result decides two things:

- **The title.** `PR_TITLE`: the title becomes the commit subject on `<default>`. `COMMIT_OR_PR_TITLE`: it does on a multi-commit PR, but a single-commit PR keeps the commit's own subject, so on a one-commit branch the care goes into that subject (the title is still gated). Those are the only two values the API defines.
- **The body.** `PR_BODY`: the body is the permanent commit message, so it is written for someone reading `git log` a year from now, and reviewer-only detail goes in the notes comment (Step 8), which also carries the render marker. `COMMIT_MESSAGES` or `BLANK` (the API's other two values): the body never reaches `git log`, so it is written for a reviewer, holds the detail itself, and ends with the render marker; no notes comment.

### Step 4 — Journal passes (before drafting the body)

Each pass surfaces journal entries the user should write, one-line confirm/skip per candidate; drafts only, applied through `/log` on accept. One confirmation skips the whole step on a trivial change (a typo, a dependency bump, docs only). Every pass covers `<lower>..HEAD`, so candidates handled on an earlier render are not raised again.

- **Decision** — commits that close off alternatives or carry a non-obvious rationale (architectural, hard to reverse, cross-component). On accept, `/log decision`, which applies its own significance gate.
- **Followup** — anything the branch defers, half-does or leaves for later, including what you are about to write as a follow-up in the body. On accept, `/log followup`, and the body cites the entry by its fid or title, never by its position in a list.
- **This repo's own passes**, from this skill's `## This repo`, only for [capture types](../../../AGENTS.md#capture-types) or ledgers this repo keeps. A pass that reads a large ledger runs as a sub-agent with an explicit `model`, never as an inline read.

### Step 5 — Gather context (in parallel)

- `git log <default>..HEAD --pretty=format:"%h %s%n%b%n---"` — the full commit history on the branch.
- `git diff <default>...HEAD --stat` and `--name-only` — what changed.
- The PR template (`.github/pull_request_template.md`, or the path this skill's `## This repo` gives) — read it, hints included.
- Anything this skill's `## This repo` lists for this step (a title-type definition, a related-docs check).

### Step 6 — Title

`type: Imperative summary` or `type(scope): Imperative summary`, under 70 characters, passed with `--title`; the types and the gate that checks them are in this skill's `## This repo`. Synthesize it from all the commits, not the latest. Pick the type by what the PR does to the product (this skill's `## This repo` names the product paths): a change to the product takes a product type; a change only to the tooling around it takes a tooling type, even when it fixes something; a PR with both is typed by its product change. Scope is optional; never write an empty one.

**Name every user-visible change.** List the changes a user of the product would notice, then check the title names each; when they don't fit, name the outcome that covers them all rather than the biggest alone. A refactor that changes behavior is not a refactor here: if you can say "X used to sometimes fail, now it doesn't", it is user-visible, and a commit subject that joins a fix to a restructure with "and" needs each half checked. On the update path, re-derive the title from the whole PR; a PR that grew in review is when a title goes stale.

**Backtick every code identifier** (a component, file or function name). When a check rejects it, keep the backticks; never rephrase the reference away.

### Step 7 — Labels

Labels are for finding PRs in the forge's list: a label is right when someone filtering by it would want this PR. Pick them after the body is final:

1. **Find the deliverables.** Read the title and the body's summary section. A deliverable is something they present as what the PR **does**; something presented only as how or why another deliverable works is part of that one. A change that appears only in the list of changes (a refactor the fix needed, the tests or docs that prove or explain a deliverable) earns no label.
2. **Label each deliverable** with the one best label below, or one this skill's `## This repo` adds. A PR with different kinds of deliverable gets several labels.
3. **Tooling is not the product.** `new-feature`, `general-improvement`, `bug-fix` and `code-cleanup` describe the product (the paths in this skill's `## This repo`). A deliverable that changes only tooling is `dev-improvement`, whether it fixes, adds or tidies something; a PR that changes only tooling is `dev-improvement` alone.
4. **Name the evidence.** Show the user each label beside the title or summary phrase that earned it, before create or edit, so it can be overruled in one reply. A label with no phrase to point to is dropped.

| Label | The deliverable… |
|---|---|
| `new-feature` | adds a capability the product's users can use |
| `general-improvement` | makes behavior that was working better on purpose: UX, speed, wording, robustness |
| `bug-fix` | makes the product do what it should have done already |
| `code-cleanup` | restructures or tidies product code as a goal of the PR, meant to change nothing a user sees |
| `dev-improvement` | changes only tooling (rule 3) |
| `documentation` | the PR changes **only** docs; never on a PR that also changes code |

Check each chosen label exists (`gh label list --limit 500 --json name,description`; the default lists only 30). For a missing one, in this order: use the existing label whose name and description fit the same deliverable, shown beside the label it replaces; else leave it off and say so; and only when the user wants it and nothing existing fits, show the `gh label create <name> --description "<text>"` command for them to run or approve. Never create a label silently. Leave alone the labels automation owns (this skill's `## This repo` lists them) and any label not in the table.

### Step 8 — Build the body (and the notes comment)

Start from the template. Fill each section the way its hint comment asks (a section the hint marks required is never left empty; an optional one is left out or marked `None` as that hint says), then remove the hint comments. Keep the headings you use exactly as the template spells them. This skill's `## This repo` has the repo's guidance per section. Fill checkboxes from what the diff and Step 4 actually produced, never from intent.

- **Links are absolute URLs** to the default branch (`https://github.com/<owner>/<repo>/blob/<default>/<path>`): a repo-relative link is emitted as written and 404s from the PR page. Link the default branch, not the PR branch (deleted on merge); a file the PR adds is named in backticks instead.
- **A bare `#N` is always this repo's issue N**, whatever repo the sentence names. Write another repo's issue or PR as `owner/repo#N` or a full URL. They usually arrive by copying a commit message: rewrite them on the way in.
- **Related issues.** First the branch name (a number in it) and the commit messages (`(?i)(fix|fixes|close|closes|resolve|resolves|ref|refs|see)\s*#(\d+)`), each confirmed with `gh issue view <N> --json number,title,state`. Only when that finds nothing: 2–4 keywords from the title, `gh issue list --state open --search "<keywords>" --limit 10 --json number,title`, read as candidates, not answers. Render `Fixes #N` when the PR closes it, `Ref #N` when only related; several plausible candidates you can't judge → list them and ask.

**When the body is the commit message (Step 3):** keep it to what a `git log` reader needs (the problem and the change, the symbols a reader would grep for, a one-line summary of the evidence), and put the rest in one notes comment:

```markdown
<!-- /pr notes -->
## Review notes

**Docs and journals:** <what this PR updated — docs, decision records, journal entries — or "none", from `git diff <default>...HEAD --name-only`, not intent.>

<Verification detail: matrices, measurements, before/after output, the reasoning behind a non-obvious call. Omit a part with nothing to say. Absolute URLs only.>

<!-- /pr render: sha=<full-40-char-HEAD-sha> ts=<ISO-8601-UTC> -->
```

`<!-- /pr notes -->` stays the first line: it is how the update path finds the comment. **Otherwise** the body holds the detail and ends with the render marker line. Either way, fill the marker from `git rev-parse HEAD` and `date -u +%Y-%m-%dT%H:%M:%SZ`, never by hand.

### Step 9 — Check before posting

1. **This repo's PR checks**, from this skill's `## This repo` (a title gate, a body linter), on the rendered title, body and notes: each must pass; fix what it reports and run it again.
2. **Issue references.** Read every bare `#N` in the body and notes against the sentence it sits in, with `gh issue view <N> --json title,state` (an issue or a PR): a title that doesn't match the sentence means it belongs to another repo and becomes `owner/repo#N`. A reference you could not resolve is not a pass: check it by hand.
3. **Public repo.** When [this repo's public posture](../../../AGENTS.md#public-posture) is `public`, sweep the title, body, notes and the branch diff for a home path, a person's email, a secret or another repository's name: `git diff <default>...HEAD | grep -nEi '/home/|/Users/|@[a-z0-9.-]+\.[a-z]{2,}|BEGIN [A-Z ]*PRIVATE KEY'` for the diff, and a read for the text you wrote. Read each hit; remove what is private, and stop to ask about anything in the diff itself.

### Step 10 — Create or update

**Create path:**

```sh
gh pr create --base <default> --title "<title>" --label "<label>" [--label "<label>" …] --body-file <body-file>
gh pr comment <N> --body-file <notes-file>    # only when Step 3 calls for a notes comment
```

Default to non-draft; use `--draft` only when the work is genuinely incomplete and you want CI early, and say so.

**Update path:**

1. **Render** the title, labels, body and notes the same way; the body describes the whole PR (`<default>..HEAD`), not the delta since the last render.
2. **Compare** each with what the PR has now. Everything unchanged (with the marker's timestamp ignored) → print `PR #<N> already up to date at <url>` and stop: no backup, no edit. Otherwise show a diff for each part that changed (title, labels added and removed, the body section by section, the notes), and say which body sections a person likely edited by hand.
3. **Confirm** — ask in chat: `apply`, `skip` (print `<url>` and stop) or `edit` (take the user's changes, then ask again).
4. **Back up** the prior body, then the prior notes if any, to `"$(git rev-parse --git-dir)/pr-backup-<N>-<date -u +%Y%m%dT%H%M%SZ>.md"`: inside the git directory it can never be committed.
5. **Apply** only the parts that changed: `gh pr edit <N> [--title "<title>"] [--add-label "<a>,<b>"] [--remove-label "<c>"] [--body-file <body-file>]` (remove only a label from Step 7's table, or this repo's additions, that no longer applies); edit the notes comment by id with `gh api -X PATCH 'repos/{owner}/{repo}/issues/comments/<id>' -F body=@<notes-file>`, or create it with `gh pr comment` when there was none. Never `gh pr comment --edit-last`: it edits whichever comment you wrote last, which may be a reply to a reviewer. If an edit fails, give the backup path and stop; the body is restored with `gh pr edit <N> --body-file <backup>` after trimming the notes off its end.

### Step 11 — After

Print the PR URL; don't summarize the body. Apply the accepted journal drafts through `/log`. Then anything this skill's `## This repo` asks for after posting.
