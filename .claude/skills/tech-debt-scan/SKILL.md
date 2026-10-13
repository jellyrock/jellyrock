---
name: tech-debt-scan
description: At the end of a feature or fix, scan docs/architecture/tech-debt.md for entries whose area matches the files this branch touched. Surfaces each candidate for a call (resolved removes the entry, still applies keeps it, defer further narrows it) and asks about new debt the PR defers. Walks the user through each, applies the diffs, and re-runs npm run lint:docs to confirm anchor references still resolve. AGENTS.md's followup-discipline rule routes internal debt with a slug and severity here; /pr runs it as a sub-agent. Use before opening a PR for any non-trivial change.
model: sonnet
effort: low
---

# /tech-debt-scan: a debt sweep before a PR

[`docs/architecture/tech-debt.md`](../../../docs/architecture/tech-debt.md) is the inventory of known debt. `AGENTS.md`'s followup-discipline rule sends internal debt with a slug and a severity here: work a PR defers and mentions only in its body is forgotten once it merges. This skill gives every PR a deliberate sweep, in two halves:

1. **Did this PR resolve an existing entry?** Then remove it in the same PR. The closed issue and the file's git history are the record.
2. **Did this PR defer new debt?** Then add an entry with a stable slug.

## Step 1: Identify the changed files

```bash
# Files changed on this branch. Use origin/main: local main is often stale.
git diff origin/main...HEAD --name-only

# Uncommitted and untracked files, when scanning before committing
git diff HEAD --name-only
git ls-files --others --exclude-standard
```

Combine the two. This is the territory the PR touched.

## Step 2: Scan `tech-debt.md` for area matches

Entries sit under `### High`, `### Medium` and `### Low`, each headed by its slug in backticks:

```markdown
#### `slug-name`

- **area**: the files or symbols it covers
- **issue**: what is wrong
- **direction**: what the fix looks like
```

Every entry has `area` and `issue`; most have `direction`. Some add a `- **severity**:` bullet (why it has that grade), a `- **github**:` bullet (its issue number) or a bullet of their own (`enforced`, `headroom`). List the entries with:

```bash
grep -nE "^#### " docs/architecture/tech-debt.md
```

For each entry, check whether a changed file's full path appears in its body, or whether its area covers that file's folder. Match on the full path: a bare file name such as `CLAUDE.md` matches entries about other folders' files. Match generously: a borderline candidate the user dismisses costs less than a missed one. The user makes the call, not the matching.

## Step 3: Ask the user about each candidate

Present each match like this:

```markdown
**[`<slug>`](docs/architecture/tech-debt.md#<slug>)** (<High, Medium or Low>)

> <the first sentence or two of the entry's issue bullet>

Files this PR touched that overlap: <list>

What's the call? `resolved` / `still applies` / `defer further` / `skip`
```

- **`resolved`:** this PR fixed it. Remove the entry. If its `github` field names an issue, the user comments on it ("closed by #N") and closes it.
- **`still applies`:** this PR didn't touch that part; the entry stays.
- **`defer further`:** the PR fixes part of it. Rewrite the entry to say what is left.
- **`skip`:** a false positive.

Walk them one at a time; don't batch.

## Step 4: Ask about new debt

Separately from Step 3, ask: "Did this PR defer any work? Anything marked out of scope, TODO, follow-up or will fix later?"

For each, draft an entry in the file's schema:

```markdown
#### `<stable-kebab-slug>`

- **area**: <files or symbols>
- **issue**: <what is wrong and what was deferred, in two to four sentences>
- **direction**: <what the fix would look like; leave the bullet out if nobody knows yet>
```

Put it under the `### High`, `### Medium` or `### Low` heading the file's severity rubric gives. Keep the issue bullet first after area: `scripts/catchup-state.js` reads the slug, the section and the first `issue` bullet to brief `/catchup`. The slug must be unique and stable, since commits, PRs and decisions cite it.

## Step 5: Apply the diff and verify

Apply the removals and additions with `Edit`. Then check the anchors:

```bash
npm run lint:docs
```

It fails on a `tech-debt.md#<slug>` link whose entry you removed. Fix it by the file it is in:

- **An architecture or dev doc:** update the link or drop it.
- **A journal (`docs/decisions.md`, `docs/progress.md`) or an ADR:** neither can be hand-edited (journals change through `/log` and `/done`; ADRs never change). Stop and ask the user how to keep the link working.

## Step 6: Link new entries from the PR

When `/pr` opens the PR, its **Follow-ups** section links each new slug. A relative link does not resolve from a PR body, so use the full URL:

```markdown
## Follow-ups
- [`itemdetails-size`](https://github.com/jellyrock/jellyrock/blob/main/docs/architecture/tech-debt.md#itemdetails-size): split the per-type renderers into modules
```

## When not to use

- A trivial change (a typo fix, a dependency bump): no scan needed.
- You're not opening a PR: mid-feature, the slugs aren't stable yet.
- The PR exists to resolve an existing slug: remove the entry in it (Step 3's `resolved`). Scan only if the work found new debt.

## Sub-agent invocation

To run it from a sub-agent, the parent passes `Read .claude/skills/tech-debt-scan/SKILL.md and follow the steps; surface candidate slugs and ask about new debt but do not apply edits` in the Agent prompt. The sub-agent this section starts never applies tech-debt edits: those are the user's calls.
