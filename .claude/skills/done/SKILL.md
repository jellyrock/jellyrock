---
name: done
description: Close-loop completion for journal entries. Three modes — `running` (special keyword: moves the `## Currently running` paragraph in `docs/progress.md` to `## Recently shipped` dated today and clears the cursor), or polymorphic slug/keyword match (searches `docs/progress.md` "Open followups" first via substring against bullet text; falls through to `docs/signals-backlog.md` exact `### <slug>:` match). For followups: removes the bullet, prepends a "Recently shipped" entry with today's date, bumps `last-updated:`. For signals: flips `status:` to `completed` and bumps `last_checked:` + file `last-updated:` to today. Edit-only — never commits. If no match, suggests `/tech-debt-scan` (for tech-debt removals) or `gh issue close <N>` (for issues). Distinct from `/log` (which CREATES entries).
model: sonnet
---

# /done `<slug-or-keyword>` — close a journal entry

The completion side of the capture/completion ritual. `/log` adds; `/done` closes. Operates on `progress.md` (followups → recently shipped) and `signals-backlog.md` (status flip). Tech-debt removal stays via [`/tech-debt-scan`](../tech-debt-scan/SKILL.md); GitHub issues stay via `gh issue close`.

**Auto-close-loop note:** the `running` cursor close-loop fires automatically when a PR merges to main via [`.github/workflows/journal-sync.yml`](../../../.github/workflows/journal-sync.yml). You only need to invoke `/done running` manually when the work shipped via a path that bypasses the workflow (direct push to main, squash-merge with a heavily edited title, the workflow being skipped by label). For the normal `/pr` → review → merge path, the cursor close happens for you.

## Inputs

`$ARGUMENTS`: a slug or keyword identifying what's done. Must be present.

- For followups: the input is matched as a case-insensitive substring against bullet text under `## Open followups`. So `/done aggregator perf` matches `- Verify aggregator perf on slow networks`.
- For signals: the input is matched as an exact `### <slug>:` heading in `signals-backlog.md`. So `/done jellyfin-server-stable` matches `### jellyfin-server-stable: Jellyfin server stable channel`.

If `$ARGUMENTS` is empty: list pending followups (top 5) + signals with `status: action_pending` (top 5) and ask which one.

## The capture rule

Same as [`/log`](../log/SKILL.md): this skill is the ONLY sanctioned write path for `docs/progress.md` and `docs/signals-backlog.md` completion edits. Agents do NOT use `Write` or `Edit` directly on those files outside this skill. The diff-and-wait pattern is mandatory; auto-applied edits to load-bearing journal state are silent corruption.

## Step 1 — Match polymorphically

The literal token `running` is a reserved keyword that maps to the Currently-running cursor (Step 2-R below); it short-circuits the polymorphic match. Otherwise, search in this order; first hit wins:

### Running keyword (progress.md `## Currently running`)

If `$ARGUMENTS` is exactly the token `running` (case-insensitive, optionally with trailing whitespace): proceed to Step 2-R. Skip the followup / signal searches entirely — `running` never matches a followup bullet by accident because it isn't typical bullet text, and reserving it as a keyword keeps the contract clean.

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

Two distinct lifecycles depending on whether the signal is auto-managed or manually-managed.

### Auto-managed slugs (`jellyfin-server-stable`, `jellyfin-server-rc`, `roku-os`)

These signals are perpetual — the upstream isn't going to stop existing. `/done` here means "I've reviewed the new upstream version", which clears the stale flag. It does NOT flip status to `completed`.

Compose the diff:

1. Find the `### <slug>:` block in `signals-backlog.md`.
2. Read the row's current `**latest_upstream**:` value.
3. If `**latest_acknowledged**:` already equals `**latest_upstream**:`, tell the user "nothing to acknowledge — already up to date" and stop.
4. Otherwise update fields:
   - `**latest_acknowledged**:` → the current `**latest_upstream**:` value
   - If `**status**:` is `action_pending`, flip to `watching` (the work that the action_pending tracked has presumably shipped).
5. Bump file frontmatter `last-updated:` to today.

Note: this skill does NOT bump `**last_checked**:` — that's the aggregator's territory and reflects "last time we asked upstream", not "last time we acknowledged". Don't overwrite it.

### Manually-managed slugs (any other slug added via `/log signal`)

The original close-loop lifecycle — flip status to `completed` and the row stays as a historical record.

Compose the diff:

1. Find the `### <slug>:` block in `signals-backlog.md`.
2. Update fields:
   - `**status**:` → `completed`
   - `**latest_acknowledged**:` → the current `**latest_upstream**:` value (so the historical record is consistent)
   - Optionally update `**latest_upstream**:` and `**current**:` if the user provides new values; otherwise leave unchanged.
3. Bump file frontmatter `last-updated:` to today.

Surface the diff. Wait for confirmation. Apply via `Edit`.

Note: a signal in `completed` status stays in the file as a record of past work. If the file accumulates many `completed` rows over time, archive them by hand (move to a "## Completed" subsection) — not yet automated.

## Step 2-R — Running cursor completion (when `$ARGUMENTS == running`)

The in-flight cursor shipped — promote it to `## Recently shipped` and clear the cursor.

Compose the diff:

1. Read the current paragraph between `## Currently running` and the next `## ` heading in `docs/progress.md`. If the paragraph is empty (already cleared), tell the user "no Currently-running cursor to close" and stop — don't pad Recently shipped with a blank entry.
2. Prepend a new bullet at the top of `## Recently shipped`: `- YYYY-MM-DD — <currently-running text>` using today's ISO date and the paragraph verbatim. If the paragraph is multi-line, collapse internal whitespace to single spaces so the bullet stays one line.
3. Replace the `## Currently running` body with a blank-line pair (clears the cursor; leaves the section heading intact).
4. Bump `last-updated:` frontmatter to today.

Surface the diff. Wait for confirmation. Apply via `Edit`.

If the in-flight work was multi-step and only part of it shipped, ask the user: "Promote the whole cursor to Recently shipped, or replace it with a follow-on description?" The latter is `/log running "<new text>"` — `/done running` only handles full closure.

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
