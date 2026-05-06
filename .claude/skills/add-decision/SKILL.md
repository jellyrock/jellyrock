---
name: add-decision
description: Append a new decision entry to docs/decisions.md following the JellyRock slug-based schema (id, date, status, optional supersedes/superseded-by/related-files, body). Use after making a non-obvious design or process decision that closes off alternatives, has a constraint or trade-off behind it, or might be worth re-evaluating later. Skip for routine bug fixes, obvious choices, and time-bound state. Pure local-file edit — no remote calls.
model: sonnet
---

# /add-decision — append a decision entry

## Inputs

`$ARGUMENTS` (optional): a stable kebab-case slug (e.g., `task-pool-children-as-vehicles`) or a short free-form description that will be turned into a slug. If empty, prompt for the slug + body via assistant flow.

## Schema

JellyRock's [`docs/decisions.md`](../../../docs/decisions.md) uses an `H2 + bullet metadata + free-form body` shape (defined in the file's preamble — re-read before authoring if unsure):

```markdown
## decision-id: <stable-kebab-case-slug>

**date**: YYYY-MM-DD
**status**: accepted | superseded | withdrawn

[optional, in this order, only when applicable:]
**supersedes**: <other-slug>
**superseded-by**: <other-slug>
**related-files**: <comma-or-list of repo-relative paths>

[body: 1-2 short paragraphs. Why this decision; what we considered; what
we chose; what we ruled out; any constraints or trade-offs behind the
choice. Keep it short — if it grows long, consider promoting to a real
architecture doc instead.]
```

## Step 1 — Confirm this actually warrants an entry

Per [`docs/decisions.md`](../../../docs/decisions.md)'s "When to add an entry":

- ✅ **Has a non-obvious rationale** that wouldn't be apparent from the code alone (e.g., "task pool children-as-vehicles dodge for SceneGraph event coalescing").
- ✅ **Closes off alternatives** that someone else might reasonably re-propose (e.g., "we use a custom translation system, not Roku's `tr()`, because…").
- ✅ **Has a constraint or trade-off** worth re-evaluating later (e.g., "we hardcode `30s` API timeout; per-call timeouts deferred").
- ❌ **Routine bug fix** — the commit message + the code is enough.
- ❌ **Obvious decision** — "we used a `for each` loop here" — no.
- ❌ **Time-bound state** — "Charlie is on vacation" is a memory, not a decision.

If the change doesn't clear the bar, stop and tell the user. Don't pad the log.

## Step 2 — Capture the entry

Elicit (or derive from `$ARGUMENTS`):

- **slug** (≤5 words, kebab-case, stable). Used as `decision-id:` and as the cross-reference key in commits, PRs, and other entries. Examples: `task-pool-children-as-vehicles`, `custom-tr-not-roku-tr`, `manifest-v3-sideload-cutover`.
- **status** (default `accepted`).
- **supersedes** (optional): if this entry replaces an older decision, name the older slug AND flip the older entry's `**status**:` line to `superseded` plus add `**superseded-by**: <this-slug>`.
- **related-files** (optional): repo-relative paths whose existence depends on this decision. Use sparingly — most entries don't need this.
- **body**: 1-2 paragraphs. Why, alternatives, choice, what was ruled out, constraints.

If the user only passed a free-form description, propose a slug; ask before locking it (slugs are stable references and renaming later is painful).

## Step 3 — Append to decisions.md

The file is append-only — newest at bottom. Insert before any closing footer if present (currently there isn't one, but check first). Use `Edit` (find the last `## decision-id:` heading and append after the blank-line gap), or `Write` only if you've Read the file first.

If `**supersedes**` was used, ALSO update the older entry: flip `**status**: accepted` → `**status**: superseded` and add `**superseded-by**: <this-slug>` immediately below the status line. The older entry stays in place — don't move or rewrite it.

## Step 4 — Verify

```bash
npm run lint:docs
```

This validates: every `tech-debt.md#anchor` ref resolves, every relative markdown link in `docs/decisions.md` resolves, and (when applicable) the supersede chain — both entries reference each other correctly. Exit 0 = clean.

If lint fails, the most common cause is a mistyped supersede slug. Re-read both entries and fix.

## Step 5 — Confirm before committing

This skill drafts + appends but does NOT commit. Surface the appended block to the user, say "appended to `docs/decisions.md` — review and commit when ready." The commit (with the actual code change that motivated the decision) is the user's call, not the skill's.

## Sub-agent invocation

To invoke from a sub-agent: parent passes `Read .claude/skills/add-decision/SKILL.md and append a decisions.md entry for $ARGUMENTS=<slug-or-description>; surface the entry text for confirmation before writing` in the Task prompt.
