---
name: log
description: Append a new entry to one of the project journals — `decision` (`docs/decisions.md`, ADR-grade rationale that closes off alternatives or has a constraint behind it), `followup` (`docs/progress.md` open followups, deferred work not yet issue-shaped or tech-debt-shaped), or `signal` (`docs/signals-backlog.md`, an external version-watch row). Routes by first $ARGUMENTS token. Diff-and-wait — drafts the entry and surfaces the proposed diff; NEVER writes without user confirmation. The sole sanctioned capture path for these three journals; raw markdown edits are not permitted (per CLAUDE.md capture-discipline rule).
model: sonnet
---

# /log `<type>` — append a journal entry

The unified capture surface for the three fast/medium-decay journals: decisions, progress followups, signals. Replaces `/add-decision` (the decision route here is the literal port of that skill's logic).

## Inputs

`$ARGUMENTS`: `<type> <rest...>` where `<type>` is one of `decision`, `followup`, `signal`.

If `$ARGUMENTS` is empty or `<type>` isn't recognized: list the three valid types with one-line descriptions and ask which one. Don't guess.

## The capture rule

This skill is the ONLY sanctioned write path for `docs/decisions.md`, `docs/progress.md`, and `docs/signals-backlog.md`. Per the root [`CLAUDE.md`](../../../CLAUDE.md) capture-discipline rule: agents do NOT use `Write` or `Edit` directly on those three files. If a journal entry is wanted, this skill drafts it; the user reviews the diff; the user (or this skill, after confirmation) applies. A hallucinated entry written without confirmation is silent corruption of load-bearing project state.

## Step 1 — Route by type

Inspect the first whitespace-separated token of `$ARGUMENTS`:

- `decision` → Step 2-D
- `followup` → Step 2-F
- `signal` → Step 2-S

Anything else (including missing): tell the user the three valid types and ask.

## Step 2-D — Decision

Appends a slug-based entry to [`docs/decisions.md`](../../../docs/decisions.md). This is the canonical port of the prior `/add-decision` body.

### Confirm this warrants an entry

Per [`docs/decisions.md`](../../../docs/decisions.md)'s "When to add an entry":

- ✅ **Has a non-obvious rationale** that wouldn't be apparent from the code alone (e.g., "task pool children-as-vehicles dodge for SceneGraph event coalescing").
- ✅ **Closes off alternatives** that someone else might reasonably re-propose (e.g., "we use a custom translation system, not Roku's `tr()`").
- ✅ **Has a constraint or trade-off** worth re-evaluating later (e.g., "we hardcode `30s` API timeout").
- ❌ **Routine bug fix** — the commit message + the code is enough.
- ❌ **Obvious decision** — "we used a `for each` loop here" — no.
- ❌ **Time-bound state** — "Charlie is on vacation" is a memory, not a decision.

If the change doesn't clear the bar, stop and tell the user. Don't pad the log.

### Schema

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

### Capture

Elicit (or derive from the rest of `$ARGUMENTS`):

- **slug** (≤5 words, kebab-case, stable). Used as `decision-id:` and as the cross-reference key in commits, PRs, and other entries.
- **status** (default `accepted`).
- **supersedes** (optional): if this entry replaces an older decision, name the older slug AND prepare to flip the older entry's `**status**:` to `superseded` plus add `**superseded-by**: <this-slug>`.
- **related-files** (optional): repo-relative paths whose existence depends on this decision.
- **body**: 1-2 paragraphs.

If only a free-form description was passed, propose a slug and ask before locking it (slugs are stable references and renaming later is painful).

### Slug uniqueness

Before appending, `grep -n '^## decision-id: <slug>$' docs/decisions.md`. If it exists, surface the existing entry to the user and ask whether they want to (a) pick a different slug, (b) supersede the old one (which triggers the supersede-chain handling above), or (c) abort.

### Surface the diff, then apply

Use `Edit` to insert after the last existing entry's closing blank line. The file is append-only — never insert mid-file or rewrite older entries.

If `**supersedes**` was used, ALSO update the older entry: flip `**status**: accepted` → `**status**: superseded` and add `**superseded-by**: <this-slug>` immediately below the status line. The older entry stays in place — don't move or rewrite it.

### Verify

```bash
npm run lint:docs
```

This validates: every `tech-debt.md#anchor` ref resolves, every relative markdown link in `docs/decisions.md` resolves, the supersede chain is consistent. Exit 0 = clean.

## Step 2-F — Followup

Appends a bullet to a `### <area>` subsection of `## Open followups` in [`docs/progress.md`](../../../docs/progress.md), then bumps the file's `last-updated:` frontmatter to today.

### Capture

Elicit (or derive from `$ARGUMENTS`):

- **text**: the followup description (one line, ~80 chars max). May be quoted in `$ARGUMENTS`.
- **area**: one of the recognized areas (`scripts`, `components`, `source`, `tests`, `docs`, `claude`, etc. — match an existing `### <area>` subsection in progress.md, OR propose adding a new subsection).

If `--area=<name>` is not in `$ARGUMENTS`, infer from the recent working context (last commit's touched files map to an area; an open editor file's path) or ask. Don't guess silently.

### Compose the diff

- If the target area subsection contains a `(none)` placeholder line, REMOVE that line and insert the new bullet `- <text>` in its place.
- Otherwise, insert `- <text>` as the last bullet under the area heading (preserving any existing bullets above).
- ALSO update the frontmatter: `last-updated: YYYY-MM-DD` → today's ISO date. Use `date +%Y-%m-%d` to get today.

If the target area doesn't exist as a subsection, propose adding `### <area>\n\n- <text>` at the bottom of the `## Open followups` section. Ask before applying.

### Surface, apply, verify

Same diff-and-wait shape as decision. After apply, run `npm run lint:docs` to confirm the staleness gate passes (it will — `last-updated:` was just bumped to today).

## Step 2-S — Signal

Appends an `H3` row block to [`docs/signals-backlog.md`](../../../docs/signals-backlog.md) under `## Watching`, then bumps `last-updated:` to today.

### Schema (mirrors signals-backlog.md preamble)

```markdown
### <slug>: <one-line label>

- **watching**: <what we're watching upstream>
- **current**: <version JellyRock pins / supports>
- **latest_upstream**: <last known upstream version>
- **last_checked**: YYYY-MM-DD
- **action_when_moves**: <what triggers a JellyRock change>
- **status**: watching | action_pending | completed
- **staleness_days**: <optional override; default 30>
```

### Capture

Elicit (or derive from `$ARGUMENTS`):

- **slug** (kebab-case, stable). Reuses the same hygiene rules as decision slugs.
- **label** (one short phrase to follow the slug).
- The 6 (or 7 with optional `staleness_days`) bullet fields above.
- Default `last_checked` to today's ISO date.
- Default `status` to `watching`.

### Slug uniqueness

`grep -n '^### <slug>:' docs/signals-backlog.md`. If present, surface the existing row and ask whether to (a) pick a different slug, (b) update the existing row via `/done` or another `/log signal` to bump `last_checked`, or (c) abort.

### Surface, apply, verify

Insert the new H3 block at the bottom of the `## Watching` section (newest at end). Bump `last-updated:` frontmatter. Surface diff, wait, apply.

`npm run lint:docs` runs the schema validator — every required bullet present, valid `status` enum, valid ISO `last_checked`, valid positive-int `staleness_days`. Catches typos at write time.

## Step 3 — Don't commit

This skill drafts + appends but does NOT `git commit`. After apply, surface "appended to `<path>` — review and commit when ready." The commit (with the actual code change that motivated the journal entry) is the user's call, not this skill's.

For decisions specifically: the conventional commit message style is `docs(decisions): record <slug>` per the existing log. For followups / signals, no specific convention — fold the journal edit into the commit that motivated it where possible.

## When NOT to use

- Routine bug fix or obvious choice that doesn't meet the decision-discipline bar → no journal entry needed.
- Internal tech debt (deferred refactor, code smell, design intent that should NOT be casually reformed) → use [`/tech-debt-scan`](../tech-debt-scan/SKILL.md) — it's the canonical surface for `docs/architecture/tech-debt.md`.
- A user-facing bug or feature request → file a GitHub issue via `gh issue create` or [`/create-issue`](../create-issue/SKILL.md).
- A version-watch row that already exists in signals-backlog.md and you just want to update `last_checked` after re-checking → use `/done <slug>` (it's the close-loop side; if status is still `watching`, `/done` won't flip it but will bump the date).

## Sub-agent invocation

Read .claude/skills/log/SKILL.md and surface the proposed entry text for $ARGUMENTS=<type> <args>; do NOT apply the edit — return the proposed diff for the parent to confirm.
