---
name: done
description: Close-loop completion for journal entries. Polymorphic match on `<slug-or-keyword>`: searches `docs/progress.md` "Open followups" first (substring match against bullet text); falls through to `docs/signals-backlog.md` (exact `### <slug>:` match). For followups: removes the bullet, prepends a "Recently shipped" entry with today's date, bumps `last-updated:`. For signals: flips `status:` to `completed` and bumps `last_checked:` + file `last-updated:` to today. Edit-only — never commits. If no match, suggests `/tech-debt-scan` (for tech-debt removals) or `gh issue close <N>` (for issues). Distinct from `/log` (which CREATES entries).
model: sonnet
---

# /done `<slug-or-keyword>` — close a journal entry

The completion side of the capture/completion ritual. `/log` adds; `/done` closes. Operates on `progress.md` (followups → recently shipped) and `signals-backlog.md` (status flip). Tech-debt removal stays via [`/tech-debt-scan`](../tech-debt-scan/SKILL.md); GitHub issues stay via `gh issue close`.

## Inputs

`$ARGUMENTS`: a slug or keyword identifying what's done. Must be present.

- For followups: the input is matched as a case-insensitive substring against bullet text under `## Open followups`. So `/done aggregator perf` matches `- Verify aggregator perf on slow networks`.
- For signals: the input is matched as an exact `### <slug>:` heading in `signals-backlog.md`. So `/done jellyfin-server-stable` matches `### jellyfin-server-stable: Jellyfin server stable channel`.

If `$ARGUMENTS` is empty: list pending followups (top 5) + signals with `status: action_pending` (top 5) and ask which one.

## The capture rule

Same as [`/log`](../log/SKILL.md): this skill is the ONLY sanctioned write path for `docs/progress.md` and `docs/signals-backlog.md` completion edits. Agents do NOT use `Write` or `Edit` directly on those files outside this skill. The diff-and-wait pattern is mandatory; auto-applied edits to load-bearing journal state are silent corruption.

## Step 1 — Match polymorphically

Search in this order; first hit wins:

### Followup match (progress.md)

```bash
grep -in '<keyword>' docs/progress.md
```

Restrict matches to lines BETWEEN `## Open followups` and the next `## ` heading. Skip any `(none)` placeholder lines. If exactly 1 bullet matches, proceed. If 0 matches, fall through to signal match. If >1 matches, surface all matches and ask which one.

### Signal match (signals-backlog.md)

```bash
grep -n '^### <slug>:' docs/signals-backlog.md
```

Exact match on the `### <slug>:` heading. If 1 hit, proceed. If 0 hits, fall through to the no-match branch.

### No match

Tell the user no journal entry matched, then suggest:

- For internal tech debt: `/tech-debt-scan` (handles add + remove for `docs/architecture/tech-debt.md`)
- For GitHub issues: `gh issue close <N>` (the closed issue is its own audit trail)
- For arbitrary file edits: just edit the file directly — `/done` is journal-scoped

## Step 2-F — Followup completion (when a followup matched)

Compose the diff:

1. Remove the matched bullet from the area subsection under `## Open followups`. If removing the bullet leaves the area subsection empty, restore the `(none)` placeholder line.
2. Prepend a new bullet at the top of `## Recently shipped`: `- YYYY-MM-DD — <followup text>` using today's ISO date and the followup's text verbatim.
3. Bump `last-updated:` in the frontmatter to today.

Surface the diff. Wait for confirmation. Apply via `Edit`.

## Step 2-S — Signal completion (when a signal matched)

Compose the diff:

1. Find the `### <slug>:` block in `signals-backlog.md`.
2. Update fields:
   - `**status**:` → `completed`
   - `**last_checked**:` → today's ISO date
   - Optionally update `**latest_upstream**:` and `**current**:` if the user provides new values; otherwise leave unchanged.
3. Bump file frontmatter `last-updated:` to today.

Surface the diff. Wait for confirmation. Apply via `Edit`.

Note: a signal in `completed` status stays in the file as a record of past work. If the file accumulates many `completed` rows over time, archive them by hand (move to a "## Completed" subsection) — not yet automated.

## Step 3 — Verify

```bash
npm run lint:docs
```

Both edits should keep the file lint-clean: progress.md staleness gate passes (last-updated bumped to today); signals schema validator passes (all required bullets still present, valid status enum).

## Step 4 — Don't commit

`/done` drafts + applies but does NOT `git commit`. Surface "edited `<path>` — review and commit when ready." The commit (with the actual code change that closed the followup or moved the signal) is the user's call.

## When NOT to use

- The work hasn't actually shipped yet — capture it via `/log followup` first; close via `/done` later when it lands.
- An open GitHub issue closed in the PR → `gh issue close` (or close via "Closes #N" in the commit body) is the correct mechanism. `/done` doesn't touch GitHub state.
- A tech-debt entry to remove → `/tech-debt-scan` walks tech-debt entries one-by-one and applies removals.
- A `decision` entry to revise → decisions are append-only; if a decision needs revisiting, file a new `/log decision` entry with `**supersedes**: <old-slug>` (which automatically flips the old entry's status to `superseded`).

## Sub-agent invocation

Read .claude/skills/done/SKILL.md and surface the proposed completion edit for $ARGUMENTS=<slug-or-keyword>; do NOT apply the edit — return the proposed diff for the parent to confirm.
