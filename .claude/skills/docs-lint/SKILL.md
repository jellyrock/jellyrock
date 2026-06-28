---
name: docs-lint
description: Run JellyRock's docs governance checks (broken markdown links, broken related-files frontmatter paths, stale tech-debt anchor references, stale-doc detection) and surface a structured fix list grouped by category. Consumes the --json output of scripts/lint/docs-check.cjs and the human-readable output of scripts/lint/docs-stale.cjs. Use when a commit hits the docs-lint pre-push hook, before pushing a PR that touched docs/ or any CLAUDE.md, or when you want a one-shot pass over doc references.
model: sonnet
effort: low
---

# /docs-lint — programmatic docs governance gate

Wraps the JellyRock doc validators with structured parsing and Edit-based fix suggestions. Two layers:

1. **Reference integrity** — [`scripts/lint/docs-check.cjs`](../../../scripts/lint/docs-check.cjs) (`--json` mode). Catches: broken `related-files:` frontmatter paths, broken inline markdown links, stale `tech-debt.md#anchor` references.
2. **Staleness** — [`scripts/lint/docs-stale.cjs`](../../../scripts/lint/docs-stale.cjs). Soft signal — informational list of architecture docs whose `last-reviewed:` is past the threshold (default 90 days). The blocking variant ([`docs-stale-blocking.cjs`](../../../scripts/lint/docs-stale-blocking.cjs)) is what CI runs at PR time and is more conservative — it only blocks if the PR touched a stale doc's territory without updating the doc.

## Step 1 — Run the validators

```bash
node scripts/lint/docs-check.cjs --json
npm run docs:stale --silent
```

`docs-check.cjs --json` writes a single-line JSON to stdout:

```json
{
  "filesChecked": 46,
  "errorsCount": 0,
  "errors": [
    {
      "category": "broken-related-file" | "broken-link" | "stale-anchor",
      "file": "<repo-relative path>",
      "message": "<full diagnostic>",
      "target": "<the broken path or anchor>"
    }
  ]
}
```

Exit 0 = clean, 1 = errors found. `docs:stale` prints a human-readable list ("28 doc(s) tracked, K stale") — keep it terse and forward the WARN/FAIL count to the user.

## Step 2 — Categorize and propose fixes

For each error in the JSON, identify the right fix shape. The category is a hint, not a rule — read the message before proposing.

### `broken-related-file`

The frontmatter `related-files:` list claims a path that doesn't exist. Two shapes:

- **File moved** → the file still exists at a new path. Usually visible in `git log -- '<old-path>'` or `git log --diff-filter=R` over the last few months. **Fix**: substitute the new path in the `related-files:` list. If the architecture doc's *shape* or *why* still describes the renamed file's role, also bump `last-reviewed:` to today.
- **File deleted** → genuinely gone. **Fix**: remove the line from `related-files:`. If the deletion changed the subsystem's shape (the doc is now describing something that no longer exists), the broader fix is updating the doc body too — surface that to the user as a separate question.

### `broken-link`

Inline `[text](path/to/file)` link points to a missing target. Same two shapes (moved / deleted) as above. **Fix**: substitute the new path, or remove the link, or restore the target. Per JellyRock convention, every reference uses `[text](path)` markdown — never bare paths in prose — so fixing one link doesn't ripple.

### `stale-anchor`

A `tech-debt.md#<slug>` citation references an anchor that no longer exists in [`docs/architecture/tech-debt.md`](../../../docs/architecture/tech-debt.md). Likely the slug was renamed or the entry was removed (because the work was done). Two shapes:

- **Slug renamed** → grep `docs/architecture/tech-debt.md` for the new slug. **Fix**: substitute the new slug in the citation.
- **Entry removed** (work completed) → no replacement exists. **Fix**: remove the citation, or rewrite the surrounding sentence to drop the now-irrelevant reference. Per `tech-debt.md`'s preamble, completed entries are removed entirely (no "recently fixed" section), so the citation site is now stale by design.

### Stale architecture docs (`docs:stale` output)

Soft signal — informational. The doc's `last-reviewed:` is past the threshold (default 90 days). Action depends on whether the PR currently underway touches that doc's `related-files:` territory:

- **Touched + stale** → CI's [`docs-stale-blocking.cjs`](../../../scripts/lint/docs-stale-blocking.cjs) will block at 120 days. Re-read the doc against current code; either update it (and bump `last-reviewed:` to today) or, if no shape/why change occurred, just bump `last-reviewed:`.
- **Not touched + stale** → ignore for now; CI won't block. Surface as a "you might want to audit X soon" note.

## Step 3 — Apply approved fixes

Walk the list with the user, fix-by-fix or grouped (e.g., all `broken-link` for one file at once). Use `Edit` to apply. Re-run after each batch:

```bash
node scripts/lint/docs-check.cjs --json
```

Until `errorsCount: 0`. Don't apply blanket fixes that go beyond the diagnostic — if a `broken-related-file` reveals a file *was* renamed and the doc body still references it, fix the frontmatter line but call out the body-level update as a separate proposal.

## Step 4 — Don't auto-bump `last-reviewed:`

The `last-reviewed:` field reflects an actual review against current code. The `/docs-lint` skill MUST NOT bump dates without the user explicitly confirming "I read this doc against current code and the shape/why is still accurate" or "I updated the doc body to match current shape." Reflexive date-bumping defeats the purpose of the field.

## When NOT to use

- The pre-push hook already showed the FAIL list and the fix is mechanical (one missing path) — just apply the Edit. `/docs-lint` adds value when there are multiple FAILs, when categorizing is ambiguous, or when staleness needs decisioning.
- You're not touching docs at all — let CI surface any drift at PR time.

## Sub-agent invocation

To invoke from a sub-agent: parent passes `Read .claude/skills/docs-lint/SKILL.md and follow the steps; report the FAIL list grouped by category with proposed fixes; do NOT apply edits` in the Task prompt.
