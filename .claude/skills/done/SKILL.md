---
name: done
description: Close-loop completion for journal entries. Three modes — `running` (special keyword: moves the `## Currently running` paragraph in `docs/progress.md` to `## Recently shipped` dated today and clears the cursor), or polymorphic slug/keyword match (searches `docs/progress.md` "Open followups" first via substring against bullet text; falls through to `docs/signals-backlog.md` exact `### <slug>:` match). For followups: removes the bullet, prepends a "Recently shipped" entry with today's date, bumps `last-updated:`. For signals: flips `status:` to `completed` and bumps `last_checked:` + file `last-updated:` to today. Edit-only — never commits. If no match, suggests `/tech-debt-scan` (for tech-debt removals) or `gh issue close <N>` (for issues). Distinct from `/log` (which CREATES entries).
model: sonnet
effort: low
---

# /done `<slug-or-keyword>` — close a journal entry

## Contract

**Goal.** Be the single closure entry point for every kind of journal entry this repo keeps. When a piece of work lands — a followup is done, an upstream-version signal is acknowledged or completed, the in-flight cursor shipped — the user types `/done <thing>` and the skill detects what kind of thing it is, finds the existing entry in the right journal (`docs/progress.md` or `docs/signals-backlog.md`), and applies the closure writes (bullet-remove + Recently-shipped move / signal-field flip / cursor promote) directly via Edit — no per-invocation diff-then-confirm gate (see Success criteria). Companion to `/log`: same journal system, different moment — `/log` captures NEW entries; `/done` closes EXISTING ones. It ships at the **Sonnet** tier rather than the cheapest because the `signals-backlog.md` dual-lifecycle — *acknowledging* a perpetual upstream watch vs *completing* a one-off signal — carries a counterintuitive rule (acknowledge is not completion; the auto-fetched `last_checked` field is off-limits) that rewards careful instruction-following over a tier that just does the "obvious" closure.

**Inputs.** `$ARGUMENTS` is `<slug-or-keyword>`, required. The literal token `running` is a reserved keyword that maps to the `## Currently running` cursor and short-circuits the polymorphic match. Otherwise the input is matched polymorphically, first hit wins: a case-insensitive substring against open-followup bullet text in `docs/progress.md`, then an exact `### <slug>:` heading match in `docs/signals-backlog.md`. If `$ARGUMENTS` is empty, the skill lists the top pending followups + the `action_pending` signals and asks which one. If the input matches more than one entry, the skill surfaces the candidates and asks — it never silently picks.

**Outputs.**

- The closure writes applied directly via `Edit`: for a **followup** — remove the bullet from `## Open followups` (restore the `(none)` placeholder if the area empties), prepend a dated `- YYYY-MM-DD — <text>` entry to `## Recently shipped`, bump `last-updated:`; for a **signal** — the auto-managed-vs-manual field updates (see Success criteria); for **running** — promote the cursor paragraph to a dated `## Recently shipped` bullet, clear the cursor body, bump `last-updated:`.
- A one-line confirmation after the writes, so the user can see what landed.
- A verification pass (`npm run lint:docs`) confirming the file stays lint-clean (staleness gate + signals schema).
- **No commit.** `/done` is edit-only — it surfaces "edited `<path>` — review and commit when ready." The commit (carrying the actual code change that closed the work) is the user's call.

**Success criteria.**

- The closure is applied directly via `Edit` — no per-invocation diff-then-confirm gate. The skill is dead-simple closure; trust it, and if outputs go wrong, run `/audit-skill done` to fix the SKILL.md. Per-invocation confirmation is the wrong corrective loop for systematic issues — it adds friction every session and the user can always `git reset --soft HEAD~1` to recover a rare mis-closure.
- Closure writes reflect reality, not optimism. If the journal claim depends on the work actually shipping, don't `/done` it until the work has landed.
- Closed followups are REMOVED from `## Open followups` (moved to `## Recently shipped`), never annotated in place with a `✅`-style marker — git is the shipping history; the open section tracks open work.
- Auto-managed signals (`jellyfin-server-stable`, `jellyfin-server-rc`, `roku-os`) are ACKNOWLEDGED — clear the stale flag, set `latest_acknowledged` to the current `latest_upstream`, flip `action_pending`→`watching` if set — and are NOT flipped to `completed` (they are perpetual), and `last_checked` is left untouched (it is the aggregator's field). Only manually-managed signals flip to `completed`.
- Disambiguation surfaces candidates and asks ONLY when the input genuinely matches more than one entry; unambiguous pointers apply directly. The skill never silently picks among ambiguous matches, but it also doesn't gate unambiguous ones with a confirmation prompt.
- Pure local-file edits — the only remote-ish call is the lint verify, which reads but never writes.

**Failure modes to avoid.**

- **Pre-marking optimistically.** "I think it shipped, let me close it." If the closure depends on the work landing, wait until it has — a premature `/done` is a future audit failure.
- **Flipping a perpetual signal to `completed` (or touching `last_checked`).** The signals dual-lifecycle trap: for an auto-managed slug, `/done` means "I reviewed the new upstream" — acknowledge, don't complete; never bump `last_checked` (the aggregator owns it). Flipping it to `completed` corrupts the watchlist that drives `/catchup` banners and `/server-upgrade`.
- **Replacing a closed followup with a `✅`-marked line.** Closed work is REMOVED from the open section and moved to Recently shipped. A `✅` annotation in the open list breaks the open/closed distinction and fails the docs-lint.
- **Silent ambiguous-pointer resolution.** When the input matches multiple candidates, surface them and ask. Picking the first match, the most recent, or the highest-priority is silent corruption — the user knew which one they meant.
- **Adding friction prompts in place of audit-driven fixes.** If closures consistently land wrong, the corrective loop is `/audit-skill done` → fix the SKILL.md → re-dogfood — NOT bolting a per-invocation confirmation prompt back on. Per-session friction is a worse pathology than rare mis-closures (`git reset --soft HEAD~1` recovers those).
- **Committing from inside `/done`.** The skill is edit-only; the commit (with the code change that closed the work) is the user's call. Bundling a journal closure into the skill's own commit is the wrong shape here.
- **Editing `progress.md` / `signals-backlog.md` with raw `Write`/`Edit` outside this skill.** `/done` (closure) and `/log` (capture) are the only sanctioned write paths for these journals.

**When NOT to use.**

- The work hasn't actually shipped yet — capture it via `/log followup` first; close via `/done` later when it lands.
- An open GitHub issue closed in the PR → `gh issue close <N>` (or "Closes #N" in the commit body). `/done` doesn't touch GitHub state.
- A tech-debt entry to remove → `/tech-debt-scan` walks tech-debt entries one-by-one and applies removals.
- A `decision` entry to revise → decisions are append-only; file a new `/log decision` with `**supersedes**: <old-slug>` (which flips the old entry to `superseded`).
- The capture is a NEW entry, not a closure of an existing one. That's `/log`, not `/done`.

## Implementation

The completion side of the capture/completion ritual. `/log` adds; `/done` closes. Operates on `progress.md` (followups → recently shipped) and `signals-backlog.md` (status flip). Tech-debt removal stays via [`/tech-debt-scan`](../tech-debt-scan/SKILL.md); GitHub issues stay via `gh issue close`.

**Auto-close-loop note:** the `running` cursor close-loop fires automatically when a PR merges to main via [`.github/workflows/journal-sync.yml`](../../../.github/workflows/journal-sync.yml). You only need to invoke `/done running` manually when the work shipped via a path that bypasses the workflow (direct push to main, squash-merge with a heavily edited title, the workflow being skipped by label). For the normal `/pr` → review → merge path, the cursor close happens for you.

### Inputs

`$ARGUMENTS`: a slug or keyword identifying what's done. Must be present.

- For followups: the input is matched as a case-insensitive substring against bullet text under `## Open followups`. So `/done aggregator perf` matches `- Verify aggregator perf on slow networks`.
- For signals: the input is matched as an exact `### <slug>:` heading in `signals-backlog.md`. So `/done jellyfin-server-stable` matches `### jellyfin-server-stable: Jellyfin server stable channel`.

If `$ARGUMENTS` is empty: list pending followups (top 5) + signals with `status: action_pending` (top 5) and ask which one.

### The capture rule

Same as [`/log`](../log/SKILL.md): this skill is the ONLY sanctioned write path for `docs/progress.md` and `docs/signals-backlog.md` completion edits. Agents do NOT use raw `Write` / `Edit` on those files outside this skill — closures flow through `/done`, captures through `/log`. Within the skill, the closure applies directly (no per-invocation confirmation prompt); systematic wrongness is fixed via `/audit-skill done`, and `git reset --soft HEAD~1` recovers a rare mis-closure. (A sub-agent invoking `/done` is the exception — it surfaces the proposed edit and never auto-applies, because its context dies at exit; see Sub-agent invocation.)

### Step 1 — Match polymorphically

The literal token `running` is a reserved keyword that maps to the Currently-running cursor (Step 2-R below); it short-circuits the polymorphic match. Otherwise, search in this order; first hit wins:

#### Running keyword (progress.md `## Currently running`)

If `$ARGUMENTS` is exactly the token `running` (case-insensitive, optionally with trailing whitespace): proceed to Step 2-R. Skip the followup / signal searches entirely — `running` never matches a followup bullet by accident because it isn't typical bullet text, and reserving it as a keyword keeps the contract clean.

#### Followup match (progress.md)

```bash
grep -in '<keyword>' docs/progress.md
```

Restrict matches to lines BETWEEN `## Open followups` and the next `## ` heading. Skip any `(none)` placeholder lines. If exactly 1 bullet matches, proceed. If 0 matches, fall through to signal match. If >1 matches, surface all matches and ask which one.

#### Signal match (signals-backlog.md)

```bash
grep -n '^### <slug>:' docs/signals-backlog.md
```

Exact match on the `### <slug>:` heading. If 1 hit, proceed. If 0 hits, fall through to the no-match branch.

#### No match

Tell the user no journal entry matched, then suggest:

- For internal tech debt: `/tech-debt-scan` (handles add + remove for `docs/architecture/tech-debt.md`)
- For GitHub issues: `gh issue close <N>` (the closed issue is its own audit trail)
- For arbitrary file edits: just edit the file directly — `/done` is journal-scoped

### Step 2-F — Followup completion (when a followup matched)

Compose the diff:

1. Remove the matched bullet from the area subsection under `## Open followups`. If removing the bullet leaves the area subsection empty, restore the `(none)` placeholder line.
2. Prepend a new bullet at the top of `## Recently shipped`: `- YYYY-MM-DD — <followup text>` using today's ISO date and the followup's text verbatim.
3. Bump `last-updated:` in the frontmatter to today.

Apply directly via `Edit` (no confirmation prompt — trust the skill; `/audit-skill done` is the corrective loop for systematic issues).

### Step 2-S — Signal completion (when a signal matched)

Two distinct lifecycles depending on whether the signal is auto-managed or manually-managed.

#### Auto-managed slugs (`jellyfin-server-stable`, `jellyfin-server-rc`, `roku-os`)

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

#### Manually-managed slugs (any other slug added via `/log signal`)

The original close-loop lifecycle — flip status to `completed` and the row stays as a historical record.

Compose the diff:

1. Find the `### <slug>:` block in `signals-backlog.md`.
2. Update fields:
   - `**status**:` → `completed`
   - `**latest_acknowledged**:` → the current `**latest_upstream**:` value (so the historical record is consistent)
   - Optionally update `**latest_upstream**:` and `**current**:` if the user provides new values; otherwise leave unchanged.
3. Bump file frontmatter `last-updated:` to today.

Apply directly via `Edit` (no confirmation prompt — trust the skill; `/audit-skill done` is the corrective loop for systematic issues).

Note: a signal in `completed` status stays in the file as a record of past work. If the file accumulates many `completed` rows over time, archive them by hand (move to a "## Completed" subsection) — not yet automated.

### Step 2-R — Running cursor completion (when `$ARGUMENTS == running`)

The in-flight cursor shipped — promote it to `## Recently shipped` and clear the cursor.

Compose the diff:

1. Read the current paragraph between `## Currently running` and the next `## ` heading in `docs/progress.md`. If the paragraph is empty (already cleared), tell the user "no Currently-running cursor to close" and stop — don't pad Recently shipped with a blank entry.
2. Prepend a new bullet at the top of `## Recently shipped`: `- YYYY-MM-DD — <currently-running text>` using today's ISO date and the paragraph verbatim. If the paragraph is multi-line, collapse internal whitespace to single spaces so the bullet stays one line.
3. Replace the `## Currently running` body with a blank-line pair (clears the cursor; leaves the section heading intact).
4. Bump `last-updated:` frontmatter to today.

Apply directly via `Edit` (no confirmation prompt — trust the skill; `/audit-skill done` is the corrective loop for systematic issues).

If the in-flight work was multi-step and only part of it shipped, ask the user: "Promote the whole cursor to Recently shipped, or replace it with a follow-on description?" The latter is `/log running "<new text>"` — `/done running` only handles full closure.

### Step 3 — Verify

```bash
npm run lint:docs
```

Both edits should keep the file lint-clean: progress.md staleness gate passes (last-updated bumped to today); signals schema validator passes (all required bullets still present, valid status enum).

### Step 4 — Don't commit

`/done` drafts + applies but does NOT `git commit`. Surface "edited `<path>` — review and commit when ready." The commit (with the actual code change that closed the followup or moved the signal) is the user's call.

## Sub-agent invocation

Read .claude/skills/done/SKILL.md and surface the proposed completion edit for $ARGUMENTS=<slug-or-keyword>; do NOT apply the edit — return the proposed diff for the parent to confirm.
