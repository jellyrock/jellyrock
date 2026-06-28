---
name: tech-debt-scan
description: At the end of a feature or fix, scan docs/architecture/tech-debt.md for entries whose area matches the files this branch touched. Surfaces each candidate with three options — resolved (remove the entry), still applies (no change), or add new (file a new entry for deferred work the PR introduces). Walks the user through each, applies the diffs, and re-runs npm run lint:docs to confirm anchor refs still resolve. Mandated by CLAUDE.md's "PR follow-ups land in tech-debt.md" rule. Use before opening a PR for any non-trivial change.
model: sonnet
effort: low
---

# /tech-debt-scan — pre-PR debt sweep

[`docs/architecture/tech-debt.md`](../../../docs/architecture/tech-debt.md) is the canonical inventory of known issues. Per JellyRock's [CLAUDE.md](../../../CLAUDE.md): **PR follow-ups land in tech-debt.md, not just the PR body** — deferrals evaporate the moment the PR merges if they're only mentioned in the description. This skill ensures every PR gets a deliberate sweep.

Two halves of the sweep:

1. **Did this PR resolve any existing tech-debt entries?** If yes, REMOVE them. The closed GitHub issue (or just the git history) becomes the audit trail.
2. **Did this PR introduce or defer any new debt?** If yes, ADD entries with stable slugs.

## Step 1 — Identify the changed files

```bash
# Files touched on this branch vs main
git diff main...HEAD --name-only

# Files in the working tree (uncommitted) — include if you're scanning
# before committing
git status --porcelain | awk '{print $2}'
```

Combine the two. This is the "territory" the PR has touched.

## Step 2 — Scan tech-debt.md for area matches

The tech-debt file groups entries under `### High` / `### Medium` / `### Low`. Each entry has a slug, an area / file mention, and a description. Walk the file:

```bash
# Extract candidate entries (each starts with ## or ### slug-name)
grep -nE "^##+ " docs/architecture/tech-debt.md
```

For each entry, check whether ANY changed-file path appears in the entry's body, or whether the entry's described area matches the changed-file's parent dir. Be liberal with matching — better to surface a borderline candidate than miss a relevant one. The user makes the keep / remove call, not the matcher.

## Step 3 — For each candidate, ask the user

Present each match like:

```markdown
**[`<slug>`](docs/architecture/tech-debt.md#<slug>)** (severity: <high/med/low>)

> <first 2 lines of the entry body — the description>

Files this PR touched that overlap: <comma list>

What's the call? `resolved` / `still applies` / `defer further` / `skip`
```

- **`resolved`** — this PR fixed it. Remove the entry from tech-debt.md. If a GitHub issue was tracking the slug, the user comments on that issue ("closed by PR #N") and closes it.
- **`still applies`** — this PR didn't touch that part of the slug; the entry stays.
- **`defer further`** — the PR partially addresses but leaves work for later. Update the entry's description to reflect what's now resolved vs what remains.
- **`skip`** — false positive; the slug doesn't actually overlap with this PR.

Walk one at a time. Don't batch.

## Step 4 — Ask about NEW debt

Independently of Step 3, ask: "Did this PR defer any new work? Things explicitly marked 'out of scope', 'TODO', 'follow-up', or 'will fix later'?"

For each, draft a new tech-debt entry:

```markdown
## <stable-kebab-slug>

**Severity**: high | med | low
**Area**: <area or file paths>

<2-4 sentence description: what's wrong, what was deferred, what the
fix would look like (if known). Don't pad — short and specific.>
```

Place the entry under the matching `### High` / `### Medium` / `### Low` heading. Slug should be unique and stable (used as cross-reference in commits, PRs, decisions.md).

## Step 5 — Apply the diff + verify

Apply the resolved-removals and new-debt-additions via `Edit`. Then verify the anchor chain still resolves:

```bash
npm run lint:docs
```

The lint catches `tech-debt.md#<slug>` references that no longer resolve (when you removed a slug another doc was citing). Two fix shapes:

- **Reference is in `docs/architecture/`** → update the citing doc to drop or rename the reference.
- **Reference is in `decisions.md`** → don't edit the decision (it's append-only); add a new decision noting that the previous one's referenced slug was resolved.

## Step 6 — Cross-link to the PR (when one exists)

When you open the PR via `/pr`, the **Follow-ups** section of the body should link any new tech-debt slugs you added. Example:

```markdown
## Follow-ups
- [`itemdetails-size`](../docs/architecture/tech-debt.md#itemdetails-size) — split per-item-type renderers into separate modules
```

The `/pr` skill scans the diff and reminds about this; `/tech-debt-scan` setting up the entry first means the PR body has something concrete to link.

## When NOT to use

- The change is trivial (typo fix, dependency bump) — no scan needed.
- You're not opening a PR — `/tech-debt-scan` is pre-PR. Mid-feature, the slugs aren't stable yet.
- The PR is a deferred-work follow-up itself — that PR's job is RESOLVING an existing slug; the slug-removal happens automatically on merge. No fresh scan needed unless the work uncovered NEW debt.

## Sub-agent invocation

To invoke from a sub-agent: parent passes `Read .claude/skills/tech-debt-scan/SKILL.md and follow the steps; surface candidate slugs + ask about new debt but do NOT apply edits` in the Task prompt. Sub-agents shouldn't apply tech-debt edits — those are user calls.
