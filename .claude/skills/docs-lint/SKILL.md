---
name: docs-lint
description: Run JellyRock's docs governance checks (broken markdown links, link anchors that match no heading, broken related-files frontmatter paths, stale tech-debt anchor references, journal-schema gates for progress.md / signals-backlog.md / the decisions.md supersede chain, stale-doc detection) and surface a structured fix list grouped by category. Consumes the --json output of scripts/lint/docs-check.cjs and the human-readable output of scripts/lint/docs-stale.cjs. Use when a commit hits the docs-lint pre-push hook, before pushing a PR that touched docs/ or any CLAUDE.md, or when you want a one-shot pass over doc references.
model: sonnet
effort: low
---

# /docs-lint: the docs governance gate, run by a script

Wraps JellyRock's doc validators with structured parsing and fixes proposed through `Edit`. Two layers:

1. **Reference integrity and journal schema:** [`scripts/lint/docs-check.cjs`](../../../scripts/lint/docs-check.cjs), in `--json` mode. It catches broken `related-files:` frontmatter paths, broken inline markdown links, link anchors that match no heading (checked by GitHub's slug rule), stale `tech-debt.md#anchor` references, and three journal-schema gates (`docs/progress.md` frontmatter, `docs/signals-backlog.md` rows, the `docs/decisions.md` supersede chain). It scans `docs/architecture/`, `docs/dev/`, `docs/adr/`, the three journals and every `CLAUDE.md` (the root one included, which links to `AGENTS.md`), but no directory whose name starts with a dot: check a link in `.claude/` or `.github/` by hand.
2. **Staleness:** [`scripts/lint/docs-stale.cjs`](../../../scripts/lint/docs-stale.cjs). An informational list of docs whose `last-reviewed:` is past the threshold (90 days by default). CI runs the blocking variant ([`docs-stale-blocking.cjs`](../../../scripts/lint/docs-stale-blocking.cjs)), which blocks only when a PR touches the territory of an architecture doc more than 120 days old without updating the doc.

## Step 1: Run the validators

```bash
node scripts/lint/docs-check.cjs --json
npm run docs:stale --silent
```

`docs-check.cjs --json` writes a single-line JSON to stdout:

```json
{
  "filesChecked": <n>,
  "errorsCount": 0,
  "errors": [
    {
      "category": "broken-related-file" | "broken-link" | "broken-anchor"
                | "stale-anchor" | "progress-frontmatter"
                | "signals-schema-invalid" | "decisions-supersede-chain",
      "file": "<repo-relative path>",
      "message": "<full diagnostic>",
      "target": "<the broken path or anchor>"
    }
  ]
}
```

Exit 0 means clean, 1 means errors found. `docs:stale` prints a readable list (`<n> doc(s) tracked, <k> stale`); pass its count to the user briefly.

## Step 2: Categorize and propose fixes

For each error in the JSON, find the right fix. The category is a hint, not a rule: read the message before proposing.

### `broken-related-file`

The `related-files:` frontmatter names a path that doesn't exist. Two cases:

- **The file moved** and exists at a new path (`git log --diff-filter=R` over the last few months usually shows it). **Fix:** put the new path in `related-files:`. If the doc's shape or why still describes the file's role, the doc-maintenance rule applies: re-read it, and bump `last-reviewed:` only after that review.
- **The file was deleted.** **Fix:** remove the line from `related-files:`. If the deletion changed the subsystem's shape (the doc now describes something that no longer exists), updating the doc body is a bigger fix: raise it with the user as a separate question.

### `broken-link`

An inline `[text](path)` link points at a missing target. The same two cases as above. **Fix:** put in the new path, remove the link, or restore the target.

### `broken-anchor`

A link's `#fragment` matches no heading or explicit `<a id>` in the target file. The usual cause is a renamed heading: dropping an em dash or a count from a heading changes its slug. **Fix:** point the link at the heading's new slug. If the link sits in a file that can't be edited (an ADR, or a journal, which changes only through `/log` and `/done`), keep the old slug alive with an explicit `<a id="<old-slug>"></a>` above the renamed heading. Find a heading's slug from the rendered page on GitHub, or by GitHub's rule: lowercase, drop punctuation, one hyphen per space.

### `stale-anchor`

A `tech-debt.md#<slug>` citation names an entry that no longer exists in [`docs/architecture/tech-debt.md`](../../../docs/architecture/tech-debt.md). Either the slug was renamed or the entry was removed because the work was done. Two cases:

- **The slug was renamed:** search `tech-debt.md` for the new slug. **Fix:** put the new slug in the citation.
- **The entry was removed:** no replacement exists. **Fix:** remove the citation, or rewrite the sentence without it. A removed entry's slug may be listed under "Recently removed", which is not a heading, so the link still breaks.

### `progress-frontmatter`

[`docs/progress.md`](../../../docs/progress.md) lacks a well-formed `last-updated:` field. This is a structural check only: the age of the date is not gated (it is a property of `main`, not of one PR). **Fix:** restore the field with today's date through `/log running` or `/done running`, not a hand edit. Those are the sanctioned ways to write this journal.

### `signals-schema-invalid`

A [`docs/signals-backlog.md`](../../../docs/signals-backlog.md) row lacks a required bullet, has an invalid `status`, or has a malformed ISO date. **Fix:** `/log signal <slug>` (create or update) or `/done <slug>` (close), again not a hand edit.

### `decisions-supersede-chain`

A [`docs/decisions.md`](../../../docs/decisions.md) note breaks the supersede schema. The message names the note and the field. The cases, and what each means:

- **"still reads `**status**: accepted`; flip it to `superseded`":** the supersede is a three-part edit and only part landed. **Read the note first:** if only part of the old decision was replaced, the fix is the partial pair (`**partially-supersedes**` and `**partially-superseded-by**`, each with a `(scope)` note, both notes staying `accepted`), not the flip. Flipping a partly replaced note to `superseded` passes the gate while making the record wrong, which is the failure this category exists to catch.
- **"records no `**superseded-by**:` pointer":** the status flip landed but neither pointer did. **Fix:** name the successor's slug.
- **A one-sided pair or a dangling target:** one side of the pair is missing, or it names a slug not in the file. **Fix:** add the mirror field, or correct the slug. Pointers resolve within `decisions.md` only: a note superseded by an ADR has no field for it, and that link is plain prose.
- **`withdrawn` involved:** withdrawn is final (abandoned, not replaced). **Fix:** don't supersede a withdrawn note, and don't let one supersede anything. If the decision really was replaced, its status should have been `superseded`.
- **A duplicate slug or field:** **Fix:** rename one slug (slugs are stable cross-reference keys), or drop the extra field line. A note supersedes at most one predecessor.

Make these fixes through [`/log decision`](../log/SKILL.md) where possible: it applies all three parts. A hand edit of this file is not the sanctioned path.

### Stale docs (the `docs:stale` output)

Informational only: the doc's `last-reviewed:` is past the threshold. What to do depends on whether the current work touches the doc's `related-files:`:

- **Touched and stale:** for an architecture doc, CI's [`docs-stale-blocking.cjs`](../../../scripts/lint/docs-stale-blocking.cjs) blocks once it is past 120 days. Re-read the doc against the current code, then update it and bump `last-reviewed:`, or bump only the date if nothing in its shape or why changed.
- **Not touched and stale:** leave it; CI won't block. Mention it as a doc to review soon.

## Step 3: Apply the approved fixes

Walk the list with the user, one fix at a time or in groups (all `broken-link` errors in one file together). Apply each with `Edit`, and run the check again after each batch:

```bash
node scripts/lint/docs-check.cjs --json
```

Repeat until `errorsCount` is 0. Don't go beyond what the diagnostic names: if a `broken-related-file` shows a renamed file that the doc body still mentions, fix the frontmatter line and propose the body change separately.

## Step 4: Don't bump `last-reviewed:` on your own

`last-reviewed:` records a real review against the current code. Bump it only when the user confirms "I read this doc against the current code and its shape and why still hold", or "I updated the body to match the current shape". A date bumped by reflex defeats the field.

## When not to use

- The pre-push hook already showed the failure and the fix is mechanical (one missing path): make the edit yourself. `/docs-lint` helps when there are several failures, when the category is unclear, or when staleness needs a decision.
- You aren't touching docs: let CI report any drift on the PR.

## Sub-agent invocation

To run it from a sub-agent, the parent passes `Read .claude/skills/docs-lint/SKILL.md and follow the steps; report the failures grouped by category with proposed fixes; do not apply edits` in the Agent prompt.
