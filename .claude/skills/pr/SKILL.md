---
name: pr
description: Create OR update a pull request — a typed title (`fix:`, `feat:` … from `scripts/lib/pr-title.js`, which places the change in CHANGELOG.md), category labels chosen by judgment, a concise body from `.github/pull_request_template.md` that reads as the squash commit message, and one skill-owned "review notes" comment for the detail reviewers want but `git log` doesn't. Detects an existing open PR for the current branch and routes to update-mode (diff title/labels/body/comment, ask, then apply) instead of duplicating; aborts cleanly on merged/closed PRs. Scans branch + commits for related issues, falls back to `gh` issue search, surfaces architecture docs whose related-files were touched, and runs the four-pillar judgment passes (tech-debt scan, decision-shape detect, followup capture) so journal hygiene is part of shipping rather than a separate manual step. Required for all PRs in this repo — supersedes any default PR-creation flow.
model: sonnet
effort: low
user-invocable: true
allowed-tools: Bash(gh pr view:*), Bash(gh issue list:*), Bash(gh issue view:*), Bash(gh search issues:*), Bash(gh api user --jq .login), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git rev-parse:*), Bash(git rev-list:*), Bash(git merge-base --is-ancestor:*), Bash(node scripts/lint/check-touched-related-files.cjs:*), Bash(node scripts/lint/decision-shape-nudge.cjs:*), Bash(node scripts/lint/pr-body-check.js:*), Bash(gh label list:*), Read, Task
---

# Create or Update a Pull Request

Open a PR with a typed title, its category labels, a body from `.github/pull_request_template.md` filled from real signal on the branch, and a review-notes comment, and run the four-pillar judgment passes BEFORE pushing so journal hygiene lands in the same change set. If a PR already exists for the current branch, route to update-mode: diff what is there against a fresh render, ask before applying, and use `gh pr edit` instead of `gh pr create`. This replaces the generic PR-creation flow — do not call `gh pr create` or `gh pr edit` directly outside this skill.

## Contract

**Goal.** Be the single, mandatory path for opening or updating a pull request in this repo. The skill titles the PR with the type that places it correctly in CHANGELOG.md, labels it for the GitHub UI, renders a body that reads well as the squash commit message, puts reviewer-only detail in one review-notes comment, and runs three judgment passes — tech-debt scan, decision-shape detect, followup capture — BEFORE the body is pushed, so journal hygiene lands in the same change set rather than as separate manual chores. It is create-or-update aware: an existing open PR for the branch routes to update-mode (diff the current title, labels, body and notes comment against a fresh render, confirm, then apply), and merged/closed PRs abort cleanly instead of opening a duplicate. It ships at the Sonnet tier because the work is template-fill + structured signal-gathering with bounded judgment, with the genuinely judgment-heavy tech-debt walk delegated to its own sub-agent — supersede any default PR-creation flow with this skill; never call `gh pr create`/`gh pr edit` directly outside it.

**Inputs.** No `$ARGUMENTS` — the skill operates on the current branch and its commits. It expects a non-`main`, non-detached branch with a clean working tree and an upstream it can push (the pre-flight establishes these, pushing the branch where needed). It reads the PR template, the title types in `scripts/lib/pr-title.js`, the branch's commit log and diff vs `main`, an existing PR's title, labels, body and review-notes comment (when one is open) including the `<!-- /pr render: sha=... -->` marker, and the architecture-docs related-files lint.

**Outputs.** A created or updated pull request with: a `type: Imperative summary` title (type from `scripts/lib/pr-title.js`, code identifiers backticked); one or more category labels; a body that is the filled template (hint comments dropped, optional sections present only when they have content — see "Build the body"); and one review-notes comment holding the verification detail, the docs and journals the PR touched, and the hidden `<!-- /pr render: sha=<40-char> ts=<ISO-8601-UTC> -->` marker that lets the next invocation narrow judgment-pass scope to "since last render". Also: drafted journal entries (tech-debt / decision / followup) surfaced per-candidate for the user to accept into `/log`; on the update path, a pre-render backup of the prior body and notes in `.claude/handoffs/`; and the PR URL printed. No journal entry is written without per-candidate user accept; nothing on the PR is overwritten without confirmation.

**Success criteria.**

- The pre-flight gates hold: not on `main`, not detached, clean tree, branch pushed — hard failures stop and report; an obvious push is not gated behind a verbal question.
- Existing-PR routing is correct: open → update-path (diff, confirm, `gh pr edit`); merged or closed → abort with the right recovery instruction; none → create-path.
- The four-pillar judgment passes run against the resolved `<lower>` SHA (prior render marker on update, `main` on create) so the user isn't re-asked about already-handled candidates, and each candidate is confirm/skip per-item.
- The title passes `pr-body-check.js` (a known type, a non-blank scope if any), backticks code identifiers, and names every user-visible change — it becomes the changelog line. Its type follows "Choosing the type" below, not habit.
- Labels come from the deliverables the title and Overview name, each with a quoted phrase shown to the user; tooling-only work is `dev-improvement`, and `documentation` goes only on a docs-only PR (it makes journal-sync and the description check skip the PR). Labels the skill does not manage (`merge-conflict`, `release-prep` …) are never removed.
- The body passes `pr-body-check.js --body-file` before it is posted; related issues found are rendered as `Fixes`/`Ref #N`, and an optional section with nothing to say is left out rather than written as `None`.
- `gh pr create` / `gh pr edit` / `Write` permission prompts are left intact — they are the user's gate on body content and backup creation, not suppressed.

**Failure modes to avoid.**

- **Polluting the skill's context with the tech-debt walk.** Never `Read docs/architecture/tech-debt.md` inline from inside `/pr` — that inline read IS the context pollution Pass 1 exists to prevent. Spawn `tech-debt-scan` as a `Task` sub-agent with an explicit `model: sonnet`, and never narrate sub-agent invocation while the transcript shows a `Read`.
- **Auto-applying journal entries.** The judgment passes produce drafts only; apply a tech-debt edit or invoke `/log` only on explicit per-candidate accept.
- **Overwriting a PR body without confirmation or backup.** On the update path, always diff-then-confirm and write the prior body to `.claude/handoffs/` before `gh pr edit`; if `gh pr edit` fails, the backup is the recovery path — surface it, don't claim success.
- **Opening a duplicate on a merged/closed PR.** Abort with the recovery instruction; never silently create a second PR.
- **A title that names only part of the PR.** The squash subject is the changelog line and cannot be edited after merge; re-derive the title from every user-visible change, on the update path too. The likeliest omission is a behavioral fix delivered *inside* a refactor — the exclusion for refactors is about diffs that change nothing a viewer can observe, not about fixes that happen to arrive as restructuring.
- **A type picked by habit.** `fix:` on a change to the `/pr` skill put "(skills) Make `/pr` titles…" in the user-facing Fixed section (#998): tooling changes take a hidden type. The reverse fails too — an untyped or `chore:` title on an app change drops it from the changelog or files it under Changed.
- **Labeling a PR's ingredients instead of its purposes.** "Every label that honestly applies" gave #1029 `code-cleanup` for a helper its fix needed and #1033 `dev-improvement` + `general-improvement` for the test hooks that proved a bug fix. Labels come from the deliverables the title and Overview name; tests, docs and supporting refactors earn none (see Labels).
- **Detail stuffed into the body.** The body is the permanent commit message; measurement tables, device matrices and reviewer asides belong in the review-notes comment, with a one-line summary of the evidence left in `## Testing`.
- **Rephrasing the title to drop a code reference** when the spell-check precheck fails — backtick the identifier instead; dropping the reference is the wrong fix.
- **Suppressing the create/edit/Write permission prompts** by allowlisting them — they are intentional user gates.

**When NOT to use.**

- You want to investigate review comments on an existing PR — that's `/pr-review`, not `/pr` (which CREATES or updates a PR).
- There is no branch to ship (on `main`, or nothing committed) — there's nothing to open a PR for.
- You need to bypass the journal-hygiene passes for a genuinely trivial change — that's still in-scope (skip the judgment block with one confirmation), not a reason to call `gh pr create` directly.

## Implementation

`gh pr create`, `gh pr edit`, `gh pr comment` and `Write` are intentionally NOT pre-approved in this skill's frontmatter — the permission prompts they trigger are the user-approval gate for what gets posted and for local backup file creation. Don't try to suppress them. Editing the notes comment goes through `gh api`, which the project allowlists, so the skill's own apply/skip confirmation is that write's gate — never edit it without one.

The mechanical close-loop side (move `## Currently running` → `## Recently shipped`, bump `last-updated:`) runs automatically after the PR merges via [`.github/workflows/journal-sync.yml`](../../../.github/workflows/journal-sync.yml). This skill does NOT touch that — its job is the judgment side: tech-debt entries, decision entries, and followup entries that need a human call.

### Pre-flight (abort if any fails)

Run in parallel:

- `git rev-parse --abbrev-ref HEAD` — must NOT be `main`, must NOT be `HEAD` (detached). If detached, abort and ask the user to check out a branch first.
- `git status --porcelain` — must be empty (no uncommitted changes).
- `git rev-parse --abbrev-ref --symbolic-full-name @{u}` — if no upstream, run `git push -u origin <branch>`. The permission prompt is the gate; don't ask verbally.
- `git rev-list --count @{u}..HEAD` — if non-zero, run `git push`.

If a hard check (on `main` / detached HEAD / dirty tree) fails, stop and report. Pushing a feature branch to open its PR is obvious — don't gate it behind a verbal question.

### Detect existing PR (route create vs update)

Run `gh pr view --json number,url,state,isDraft,author,title,labels,body,headRefOid` for the current branch. Branch on `state`:

- **`MERGED`** — abort. Print: `PR #<N> is already merged at <url>. Switch off this branch (e.g. `git switch main && git pull`) before opening a follow-up PR.` Don't try to update or open a duplicate.
- **`CLOSED`** (not merged) — abort. Print: `PR #<N> at <url> was closed without merging. Reopen manually with `gh pr reopen <N>` if you want to revive it, or start a new branch.` Don't silently open a duplicate.
- **`OPEN`** — enter the **update path**. Capture `<N>`, `<url>`, `<author.login>`, `<title>`, `<labels>`, `<body>`, and `<headRefOid>` for later steps.
- **No PR exists** (`gh pr view` exits non-zero with "no pull requests found for branch") — enter the **create path** (today's flow).

#### Update-path setup (skip on create path)

1. **Author warn** (best-effort) — run `gh api user --jq .login`. If the result differs from the captured `<author.login>`, print one line: `Note: PR #<N> was opened by <other-user>. Body edits will appear under your account.` Don't abort. If `gh api user` fails (auth/rate limit), skip the warn silently — it's informational only.
2. **Find the review-notes comment** — `gh pr view <N> --json comments --jq '.comments[] | select(.body | contains("<!-- /pr notes -->")) | {url, author: .author.login, body}'`. Keep the last match authored by the current user as `<notes>`; its numeric id is the `#issuecomment-<id>` suffix of its `url`. None found (a PR opened before this skill posted notes, or by hand) → the create step for notes runs on apply.
3. **Resolve lower-bound SHA** — this becomes the input range for judgment passes (so the user isn't re-asked about candidates already accepted/skipped on the prior /pr render):
   1. Parse `<notes>` for the marker `<!-- /pr render: sha=([a-f0-9]{40}) ts=(\S+) -->`; if there is none, parse the PR body (PRs rendered before the marker moved to the comment carry it there). If multiple markers exist (rare — copy-paste), take the LAST match.
   2. If a marker SHA is found AND `git merge-base --is-ancestor <sha> HEAD` exits 0 → use that SHA.
   3. Otherwise, fall back: `gh pr view --json commits --jq '.commits[0].oid'`. If that SHA is also reachable from HEAD, use it.
   4. Ultimate fallback (force-push edge case where neither prior SHA is reachable): use `main` — same scope as the create path. Print one line so the user knows the narrow scope was lost: `Note: prior /pr render SHA unreachable from HEAD (rebase or force-push?). Falling back to full-branch scope for judgment passes.`
4. The resolved SHA is referenced as `<lower>` throughout the rest of this skill. On the **create path**, `<lower>` is `main`.

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
- `Read scripts/lib/pr-title.js` — `TITLE_TYPES` is the list of types and the CHANGELOG.md section each one lands in. Read it rather than recalling it; it is the definition CI checks against.

### Title

`type: Imperative summary` or `type(scope): Imperative summary`, under 70 characters. Synthesize from commits, not just the latest. Passed via `--title`, not in the body.

#### Choosing the type

The repo squash-merges, so the title is the first line of the commit on `main`, and [`scripts/changelog-syncer.js`](../../../scripts/changelog-syncer.js) places the change in CHANGELOG.md by the title's type (`TITLE_TYPES` in [`scripts/lib/pr-title.js`](../../../scripts/lib/pr-title.js)). A title with no known type fails CI (`pr-body-check.js`). Pick the type by what the PR does to **the app a viewer runs**:

- **It changes the app** (`components/`, `source/`, `locale/`, `images/`, `settings/`, `manifest`) → a changelog type: `feat` for a new capability or setting, `fix` for behavior that was wrong, `update` for behavior that changes on purpose, `perf` for the same behavior faster, `refactor` for a restructure meant to change nothing (it is still listed — a refactor can regress, and developers read the changelog too), `remove` for a feature taken out, `revert` to undo a PR.
- **It only changes tooling around the app** (`scripts/`, `.github/`, `.claude/`, `tests/`, `docs/`, dev dependencies) → a hidden type: `chore`, `ci`, `build`, `test` or `docs`. A fix to a skill, a lint rule or a workflow is `chore`/`ci`, not `fix`: `fix(skills):` put "(skills) Make `/pr` titles…" in the user-facing Fixed section (#998).
- **Both** → type it by the app change; the tooling rides along in the body.

A scope is optional. When the PR sits in one area, name it — `fix(video):`, `chore(skills):` — and keep it to that area's usual name; it appears in the changelog line as `(video) …`. Never write an empty or blank scope; CI rejects `fix():`.

#### Naming every user-visible change

**The title is the changelog line — it must name every user-visible change in the PR.** The changelog reads the PR's **current** title, so a wrong or incomplete title can be corrected after merge by editing the PR and re-syncing, but only until the release is cut: from then on the released section of `CHANGELOG.md` is fixed text, correctable only by hand. Get it right before merge. Before applying a title:

1. List the user-visible changes from the Changes section you are rendering (what a viewer of the app would notice — not refactors, tests, or journal entries).
   **A refactor that changes behavior is not a refactor for this purpose.** Before excluding something as internal, ask what it makes the app *do differently*. If you can state it as "X used to sometimes fail, now it doesn't", it is user-visible and belongs in the title even though the diff reads as restructuring — and it belongs whether or not the old failure was reproduced, since the repo's own policy is to fix these races without a reproduction ([ADR 0037](../../../docs/adr/0037-task-run-replacement.md)). The tell is a commit subject that joins a fix to a restructure with "and": each half needs its own check against the title. Recorded 2026-09-22 — PR #1010's first title named only its teardown fix and dropped the "a subtitle track switch is no longer silently lost" fix, because the component split that carried it classified as a refactor and the list above says to exclude those.
2. Check the title names each of them. When they don't all fit in 70 chars, name the outcome that covers all of them rather than the biggest one alone: two features joined by "and" is fine; dropping one is not.
3. On the **update path**, re-derive the title from the full PR, never keep the old one by default. A PR that grew during review is exactly when a title goes stale: #996 was titled for its logo fit, gained a credits row in review, merged with the old title, and shipped a changelog line that omits the row.

**Backtick every code identifier in the title** — class/component/file names like `` `GridItem` ``, `` `BaseGridView.bs` ``, `` `ItemDetails` ``. The post-merge journal-sync writes the title verbatim into `docs/progress.md` and the PR-time precheck ([`journal-sync-precheck.yml`](../../../.github/workflows/journal-sync-precheck.yml)) spell-checks it; a bare identifier fails that check. Synthesizing from commit subjects (which don't backtick) yields a bare title, so add the backticks yourself. When the precheck fails, **backtick the identifier — never rephrase the title to drop the reference** (that's the wrong fix, even though the old error message led with it). Backticks render as code in `progress.md`; GitHub shows them literally in the title, which is the accepted trade-off.

### Labels

Labels are for finding PRs in the GitHub list — a person filtering by `bug-fix` wants the PRs that fixed app bugs. Nothing automated reads the category labels below: CHANGELOG.md places a PR by its title type, and journal-sync skips only on `dependencies` / `documentation` / `docs-only` / `ci` / `automated` / `chore-only`. So a label is right when someone filtering by it would want this PR, and wrong otherwise.

Pick them AFTER the body is final, from what the PR says it is for:

1. **Read the title and the Overview.** Those name the PR's purposes. A *deliverable* is something they present as what the PR **does** — a clause of the title, an "and …", an "It also …". Something they present only as **how or why** another deliverable works ("rewrites the engine … because a swap alone would have shipped three defects") is part of that deliverable, not one of its own. A change that appears only as a Changes bullet — a small unrelated extra, a refactor the fix needed, the tests or docs that prove or explain a deliverable — is not a deliverable and earns no label, however real it is.
2. **Label each deliverable by what it does**, with the one best label from the table. Several deliverables can share a label; a PR with several different kinds of deliverable gets several labels.
3. **Add `accessibility`** alongside the main label whenever a deliverable changes what screen-reader, audio-guide or caption users get — even when the title or Overview says so in a single clause of a larger deliverable. It is a tag on a deliverable, never a deliverable of its own, so it needs no purpose of its own to qualify.
4. **Tooling is not the app.** `new-feature`, `new-setting`, `bug-fix`, `general-improvement` and `code-cleanup` describe the app a viewer runs (`components/`, `source/`, `locale/`, `images/`, `settings/`, `manifest`). A deliverable that changes only tooling — scripts, CI, tests and test harness, skills, agent config, developer docs — is `dev-improvement`, whether it fixes, adds or tidies something. A PR that changes only tooling is `dev-improvement` alone.
5. **Name the evidence.** Beside each label, quote the title or Overview phrase that earned it. A label you cannot quote a phrase for is dropped.

| Label | The deliverable… |
|---|---|
| `new-feature` | adds an app capability a viewer can use |
| `new-setting` | adds a user-facing setting (with `new-feature` too when the setting is how a new capability is reached) |
| `bug-fix` | makes the app do what it should have done already: a crash, a wrong screen, lost state, a failure shown wrongly |
| `general-improvement` | makes app behavior that was working better on purpose: UX, speed, memory, wording, robustness |
| `code-cleanup` | restructures or tidies app code as a goal of the PR, meant to change nothing a viewer sees |
| `accessibility` | serves screen-reader, audio-guide or caption users (added alongside the main label) |
| `dev-improvement` | changes only tooling (rule 4) |
| `documentation` | the PR changes **only** docs. It makes journal-sync and the description check skip the PR, so never on a PR that also changes code |

Leave alone the labels automation owns — `dependencies` (Renovate), `release-prep`, `merge-conflict` — and the issue-triage labels.

#### Worked examples

Rulings on real PRs, reached by running this rule blind with two separate agents and settling where they differed. Match a new PR against the nearest one.

| PR | What the title/Overview presents | Labels | Why not more |
|---|---|---|---|
| #1033 | failed library shown as failed, recovery, "#" crash; "never narrates or toasts over" another screen | `bug-fix`, `accessibility` | the dialog-delay consolidation and the new RTA hooks are Changes bullets only |
| #1029 | a song crash | `bug-fix` | the `applyItemArtwork()` helper merge is a Changes bullet the fix needed |
| #1024 | a subtitle/caption parser crash | `bug-fix`, `accessibility` | — |
| #991 | "showed only the first 25 channels" + "loading programs near the focus" (title clause) | `bug-fix`, `general-improvement` | — |
| #847 | the reskin, the engine rewrite fixing "three known defects", "It also gives the flow its first functional coverage" | `general-improvement`, `bug-fix`, `dev-improvement` | the rewrite is presented as HOW the defects were fixed ("because …"), so no `code-cleanup` |
| #987 | a `fix:` that touches only bsconfig, scripts and tests | `dev-improvement` | tooling is never `bug-fix`, whatever the title type says |

Before `gh pr create` / `gh pr edit`, show the user each label beside the phrase that earned it, so the reasoning can be overruled in one reply.

On the **update path**, add the labels the render wants and remove only labels from the table above that no longer apply; never remove anything else. `gh label list` shows the repo's labels if you need to check one exists.

### Build the body

The body is the **permanent commit message** of the squash merge (`squash_merge_commit_message=PR_BODY`): write it for someone reading `git log` a year from now, who will not have the PR page. It is also the PR description, so it must stand on its own for a reviewer — which is why detail that only a reviewer needs goes in the review-notes comment, not here.

Start from the template. Keep the headings you use exactly as the template spells them, **drop every `<!-- hint -->` comment**, and **leave out an optional section you have nothing for** — an empty heading, or one that says `None`, is noise in `git log`. `pr-body-check.js` fails an optional section that is present but empty.

#### Overview — required
1–5 sentences: what changed and why, synthesized from the full commit log. Lead with the problem the PR solves; a reader should know from this paragraph alone whether the commit is the one they are looking for.

#### Changes — required
Bulleted list, one line per logical change, not per file. Name the symbols a reader would grep for. Keep each bullet to what changed and the reason it had to; the path you took to get there belongs in the notes comment.

#### Testing — when something was verified
One to four lines summarizing the evidence: what ran, where (device, server version), and the result — `test:unit 4503/4503 on a Roku Ultra`, `the #969 repro keeps the resume point on 12.1 and 10.7.7`. This is the durable record of the proof ([`prove-dont-dismiss`](../../rules/prove-dont-dismiss.md)); the full matrix, measurements and logs go in the notes comment.

#### Follow-ups — when something is deferred
Bulleted, each pointing at its journal entry (see "Pass 3 — Followup capture" above): a stable slug in `docs/architecture/tech-debt.md`, or a `docs/progress.md` open followup. If a deferred item has neither yet, capture it as part of this PR or drop the line. Don't invent deferrals; most PRs have none and leave the section out.

**Links in the PR body and the notes comment must be absolute URLs** — `https://github.com/jellyrock/jellyrock/blob/main/<path>`, e.g. `- [\`itemdetails-size\`](https://github.com/jellyrock/jellyrock/blob/main/docs/architecture/tech-debt.md#itemdetails-size) — split per-item-type renderers into separate modules`. GitHub does not resolve repo-relative links in a PR body: `../docs/…` or `docs/…` is emitted as written and 404s from the PR page. Link `main`, not the PR branch, because the branch is deleted on merge; for a file the PR adds, name it in backticks instead of linking.

#### References to other repositories

**A bare `#N` is always THIS repo's issue N** — GitHub links it here no matter what repo the sentence names. Write another repo's issue or PR as `owner/repo#N` (`jellyfin/jellyfin#17107`, `jellyfin-archive/jellyfin-roku-legacy#669`) or as a full URL. Two forms are wrong and both are permanent, because the body becomes the squash commit: the shorthand `repo#N` (`jellyfin#17107`) renders as plain text, and `legacy PR #669` links to our own unrelated #669. They usually arrive by copying a commit message into the body, so rewrite them on the way in. The shorthand fails CI (`pr-body-check.js`); a mis-aimed bare `#N` can only be caught by reading its title, which is what the check in "Create or update the PR" is for. Recorded 2026-09-23 — #1016 linked "Cast to JellyRock" for the legacy PR it credited, and #940, #1000 and #1002 left Jellyfin issues unlinked.

#### Issues — when related issues exist

**Tier 1 — local scan (always):**
- Branch name: extract any `\d+` (e.g. `fix/482-stuck-resume` → candidate #482).
- Commit messages: regex `(?i)(fix|fixes|close|closes|resolve|resolves|ref|refs|see)\s*#(\d+)` over the full log.

Confirm each candidate exists with `gh issue view <N> --json number,title,state`.

**Tier 2 — open-issue search (only if Tier 1 found nothing):**
- Extract 2–4 keywords from the PR title (skip stop words and the type prefix).
- `gh issue list --state open --search "<keywords>" --limit 10 --json number,title,labels`
- Treat results as **candidates, not answers** — the search is fuzzy. Judge relevance from titles.

**Render:** one line per issue — `Fixes #N` when the PR closes it, `Ref #N` when it is only related. Nothing credible found → leave the section out. If multiple plausible candidates surface and you can't judge confidently, list them and ask the user.

### Review-notes comment

One comment per PR, owned by this skill, for what a reviewer wants and `git log` doesn't. It replaces the Docs checklist the template used to carry. Shape:

```markdown
<!-- /pr notes -->
## Review notes

**Docs and journals:** <what this PR updated — architecture docs, a scoped CLAUDE.md, a decision note or ADR (by slug), tech-debt or progress.md entries — or "none". This is the checklist's job, done from the diff: `git diff main...HEAD --name-only` is the ground truth, not intent.>

<Verification detail: device and server matrices, measurements, before/after output, the reasoning behind a non-obvious call. Omit a part with nothing to say. Absolute URLs only.>

<!-- /pr render: sha=<full-40-char-HEAD-sha> ts=<ISO-8601-UTC> -->
```

`<!-- /pr notes -->` must stay the first line: it is how the update path finds the comment again. Resolve `<full-40-char-HEAD-sha>` via `git rev-parse HEAD` and `<ISO-8601-UTC>` via `date -u +%Y-%m-%dT%H:%M:%SZ`. The render marker lives here, not in the body, so it never reaches `git log`; if it goes missing, the next update degrades to the PR-first-commit fallback — no harm done.

### Create or update the PR

#### Check the title, body and issue references (both paths)

Write the rendered body to a scratch file, then run the same checks CI runs:

```sh
node scripts/lint/pr-body-check.js --pr-title "<title>" --body-file <body-file>
node scripts/lint/pr-body-check.js --list-refs --pr-title "<title>" < <body-file>
```

The first must exit 0; fix what it reports and re-run. The second prints every issue reference with its resolved type, state and title. Read each bare `#N` line against the sentence it came from — a title that doesn't match (`#669 — issue: Cast to JellyRock` for a legacy PR) means the reference belongs to another repo and must become `owner/repo#N`. A non-zero exit means a shorthand or nonexistent reference; fix the body and re-run. A `?` line (gh could not resolve it) is not a pass — check that reference by hand. Run the `--list-refs` check over the notes comment too.

#### Create path

```sh
gh pr create --title "<title>" --label "<label>" [--label "<label>" …] --body-file <body-file>
gh pr comment <N> --body-file <notes-file>
```

Default to non-draft. Use `--draft` only when work is genuinely incomplete and you want CI early — and say so explicitly to the user. The `gh pr create` and `gh pr comment` permission prompts are the user's gate on what gets posted; that's intentional and not allowlisted.

#### Update path

1. **Render** the new title, labels, body and notes comment the same way as the create path. The body describes the FULL PR (the gather-context commands run against `main..HEAD`), not just the delta since last render.
2. **Compare** each against what the PR has now (`<title>`, `<labels>`, `<body>`, `<notes>`):
   - All unchanged (the notes compared with the render marker's timestamp stripped) → print `PR #<N> already up to date at <url>` and stop. No backup, no edit, no permission prompt.
   - Otherwise, show the user a diff for each part that changed — title, labels added/removed, the body section by section, the notes comment. Say which body sections were human-curated (Overview / Changes / Follow-ups), since those are likelier to carry manual edits worth preserving. A body that still carries the old template's Docs checklist or render marker drops them on re-render; say so.
3. **Confirm** — ask the user `apply / skip / edit-then-apply`:
   - `skip` — print `<url>` and stop. The PR is unchanged.
   - `edit-then-apply` — let the user revise the proposal (paste edits, or have them dictate the change) before re-prompting.
   - `apply` — proceed to backup + apply.
4. **Backup** (apply path only) — write the captured prior `<body>`, followed by the prior `<notes>` body if there was one, to `.claude/handoffs/pr-<N>-pre-render-<ISO-8601-compact-ts>.md`. The `Write` tool will trigger a permission prompt; that's expected — it's the user's last gate before the PR is overwritten. The backup file is gitignored and auto-pruned by `/catchup` after 30 days.
5. **Apply** only the parts that changed:

   ```sh
   gh pr edit <N> [--title "<new-title>"] [--add-label "<a>,<b>"] [--remove-label "<c>"] [--body-file <body-file>]
   # notes: edit the existing comment, or create it when there was none
   gh api -X PATCH repos/jellyrock/jellyrock/issues/comments/<id> -F body=@<notes-file>
   gh pr comment <N> --body-file <notes-file>
   ```

   The `gh pr edit` permission prompt is the second user gate; it's intentionally NOT allowlisted in this skill's frontmatter.

   If an edit fails (network, auth, conflict): the backup file is still on disk — the previous body and notes weren't lost. Tell the user the backup path and abort. They can restore the body with `gh pr edit <N> --body-file <backup-path>` after trimming the notes off the end.

### After creating or updating

Print the PR URL. Do not summarize the body — the user can read it.

On the **create path**, mention once (one short line): the [`journal-sync.yml`](../../../.github/workflows/journal-sync.yml) workflow will move `## Currently running` → `## Recently shipped` automatically when this PR merges. The user does not need to run `/done running` manually unless they want to close the cursor before merge.

On the **update path**, skip that line — the user already saw it on the initial /pr.

Skip the journal-sync line when the change was trivial too (the journal-sync workflow will skip on its own — bot/dep/docs labels, Renovate-shaped titles).
