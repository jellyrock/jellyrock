---
name: log
description: Append/update an entry in one of the project journals — `decision` (`docs/decisions.md`, ADR-grade rationale that closes off alternatives or has a constraint behind it), `followup` (`docs/progress.md` open followups, deferred work not yet issue-shaped or tech-debt-shaped), `signal` (`docs/signals-backlog.md`, an external version-watch row), or `running` (`docs/progress.md` `## Currently running` paragraph; replaces the in-flight cursor). Routes by first $ARGUMENTS token. Mechanical types (followup, signal, running) apply directly via Edit — no per-invocation confirmation prompt; the decision type drafts the entry, checks significance, and surfaces a diff to confirm. The sole sanctioned capture path for these three journals; raw markdown edits are not permitted (per AGENTS.md capture-discipline rule).
model: sonnet
effort: low
---

# /log `<type>` — append a journal entry

## Contract

**Goal.** Be the single capture entry point for every kind of journal write JellyRock keeps, so instead of remembering which file each entry lives in and which format it uses, you type `/log <type> <body>` and the skill routes to the right journal with the right format. It covers **four types** across three fast/medium-decay journals: `decision` (`docs/decisions.md`), `followup` (`docs/progress.md` open followups), `signal` (`docs/signals-backlog.md` upstream version-watch rows), and `running` (the `## Currently running` in-flight cursor in `docs/progress.md`). There are **two capture modes.** *Mechanical* types (`followup`, `signal`, `running`) apply **directly** via Edit — no per-invocation gate, because routing is mechanical and the corrective loop for systematic wrongness is `/audit-skill log`, not a confirmation prompt every session. The `decision` type is the deliberate exception: it checks the entry against the decision-discipline bar, then surfaces a **diff-and-confirm** the human can override — here the gate is right because it's confirming a *significance + routing judgment*, not gating a mechanical append. This is the sole sanctioned write path for those three journals; raw `Write`/`Edit` on them is not permitted (per the root AGENTS.md capture-discipline rule). The mechanical path is light, but the decision flow's significance judgment is a plausible-wrong call, so the skill is pinned at the **Sonnet tier with `effort: low`**.

**Inputs.** `$ARGUMENTS` is `<type> [optional title or body]` — the first whitespace-separated token is the type (`decision` / `followup` / `signal` / `running`); the rest is passed to the type-specific flow. If `$ARGUMENTS` is empty or the type isn't recognized, the skill lists the four valid types and asks; it never guesses.

**Outputs.**

- For a mechanical `/log` (`followup`/`signal`/`running`): the append (or cursor replacement) applied directly via Edit to the target journal, plus the `last-updated:` frontmatter bump on `docs/progress.md` / `docs/signals-backlog.md` so the staleness banner stays accurate.
- For `/log decision`: a slug-based entry appended to `docs/decisions.md` (append-only — never insert mid-file or rewrite older entries), with any supersede-chain update applied to the older entry — surfaced as a **diff-and-confirm** before writing.
- A `npm run lint:docs` pass after the write, confirming the journal's schema + staleness gate.
- The skill is pure local-file edits — no commit (the user owns that), no remote calls, no service restarts.

**Success criteria.**

- **Mechanical captures** (`followup`, `signal`, `running`) are applied directly via Edit — no per-invocation diff-then-confirm gate. Trust the skill; if outputs go systematically wrong, run `/audit-skill log` to fix the SKILL.md (`git reset --soft HEAD~1` recovers a rare bad capture). Per-invocation confirmation is the wrong corrective loop for *systematic* issues — it adds friction every session and masks the problem the audit would catch.
- **The `decision` type is the one exception to the no-gate rule** — it surfaces a diff-and-confirm because it's confirming a *significance + routing judgment* (does this clear the decision-discipline bar? does it supersede an existing slug?), not gating a mechanical append.
- A decision entry is added only when it clears the bar (non-obvious rationale / closes off alternatives / has a constraint worth re-evaluating) — routine bug fixes, obvious choices, and time-bound state are declined rather than padding the log.
- The diff shape of the appended entry matches the surrounding entries in the target file — the skill reads the file's existing format and matches it; it does not invent a new shape.
- Decision slugs are checked for uniqueness before append (`grep '^## decision-id: <slug>'`); a collision surfaces the existing entry and asks (different slug / supersede / abort).
- When a type-specific flow needs information the user didn't supply and can't infer (an area pick, a slug, a signal field), the skill elicits it — the bar is "genuinely ambiguous, multiple equally-valid choices," not "any uncertainty."

**Failure modes to avoid.**

- **Adding friction prompts in place of audit-driven fixes.** If *mechanical* captures consistently land wrong, the corrective loop is `/audit-skill log` → fix the SKILL.md → re-dogfood — NOT a confirmation prompt gating every invocation. Per-session friction is the worse pathology than a rare wrong capture. (The `decision` type's diff-and-confirm is **not** this anti-pattern — it gates a classification judgment, not a mechanical append.)
- **Decision-log creep.** The decision-discipline bar is load-bearing: a routine fix, an obvious choice, or time-bound state is NOT a decision entry. If everything becomes an entry, the high-signal ones drown.
- **Inventing missing fields when they're not inferable.** If the user said "log a followup" with no body or inferable area, ask — don't pick a plausible-looking placeholder. The bar is "genuinely ambiguous," not "any uncertainty."
- **Folding a closure into a `/log` capture.** `/log` only *appends* a new entry. Don't strike-through, ✅-mark, or otherwise "close" an existing bullet during a `/log` run, and don't touch a *different* bullet than the one you're appending. Closure is `/done`'s job, as a separate invocation.
- **Bumping multiple journals when only one was meant.** Each type's flow has a defined write surface; cross-bumping is a smell (the one sanctioned cross-write is the `last-updated:` bump that keeps the staleness banner honest).
- **Manually bumping auto-maintained signal fields.** The `latest_upstream` + `last_checked` fields for aggregator-managed slugs (`jellyfin-server-stable`, `jellyfin-server-rc`, `roku-os`) are owned by `scripts/catchup-state.js`; don't hand-edit them.

**When NOT to use.**

- The capture is actually a normal commit message body — just write the commit; don't pile a `/log` on top.
- The capture is a half-thought — write it down informally first, refine it, THEN `/log` once the shape is clear. Premature `/log` produces noise the next `/catchup` has to wade through.
- The flip is a status change on an existing entry (open → closed, watching → re-checked) — that's `/done`, not `/log`. `/log` is for new entries.
- Internal tech debt (a deferred refactor, a design intent that shouldn't be casually reformed) → `/tech-debt-scan` owns `docs/architecture/tech-debt.md`.
- A user-facing bug or feature request → file a GitHub issue (`gh issue create` or `/create-issue`).

## Implementation

The unified capture surface for the three fast/medium-decay journals: decisions, progress followups, signals. Replaces `/add-decision` (the decision route here is the literal port of that skill's logic).

### Inputs

`$ARGUMENTS`: `<type> <rest...>` where `<type>` is one of `decision`, `followup`, `signal`, `running`.

If `$ARGUMENTS` is empty or `<type>` isn't recognized: list the four valid types with one-line descriptions and ask which one. Don't guess.

### The capture rule

This skill is the ONLY sanctioned write path for `docs/decisions.md`, `docs/progress.md`, and `docs/signals-backlog.md`. Per the root [`AGENTS.md`](../../../AGENTS.md) capture-discipline rule: agents do NOT use raw `Write` or `Edit` on those three files — captures flow through `/log`, closures through `/done`. Mechanical captures (`followup`, `signal`, `running`) apply directly — no per-invocation confirmation prompt; trust the skill, and fix systematic wrongness via `/audit-skill log` (a per-session diff-confirm is the wrong corrective loop, and `git reset --soft HEAD~1` recovers a rare bad capture). The `decision` type is the exception — it surfaces a diff-and-confirm because the gate is confirming a *significance + routing judgment*, not a mechanical append. (A sub-agent invoking `/log` always surfaces and never auto-applies — its context dies at exit; see Sub-agent invocation.)

### Step 1 — Route by type

Inspect the first whitespace-separated token of `$ARGUMENTS`:

- `decision` → Step 2-D
- `followup` → Step 2-F
- `signal` → Step 2-S
- `running` → Step 2-R

Anything else (including missing): tell the user the four valid types and ask.

### Step 2-D — Decision

Appends a slug-based entry to [`docs/decisions.md`](../../../docs/decisions.md). This is the canonical port of the prior `/add-decision` body.

#### Confirm this warrants an entry

Per [`docs/decisions.md`](../../../docs/decisions.md)'s "When to add an entry":

- ✅ **Has a non-obvious rationale** that wouldn't be apparent from the code alone (e.g., "task pool children-as-vehicles dodge for SceneGraph event coalescing").
- ✅ **Closes off alternatives** that someone else might reasonably re-propose (e.g., "we use a custom translation system, not Roku's `tr()`").
- ✅ **Has a constraint or trade-off** worth re-evaluating later (e.g., "we hardcode `30s` API timeout").
- ❌ **Routine bug fix** — the commit message + the code is enough.
- ❌ **Obvious decision** — "we used a `for each` loop here" — no.
- ❌ **Time-bound state** — "Charlie is on vacation" is a memory, not a decision.

If the change doesn't clear the bar, stop and tell the user. Don't pad the log.

#### Schema

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

#### Capture

Elicit (or derive from the rest of `$ARGUMENTS`):

- **slug** (≤5 words, kebab-case, stable). Used as `decision-id:` and as the cross-reference key in commits, PRs, and other entries.
- **status** (default `accepted`).
- **supersedes** (optional): if this entry replaces an older decision, name the older slug AND prepare to flip the older entry's `**status**:` to `superseded` plus add `**superseded-by**: <this-slug>`.
- **related-files** (optional): repo-relative paths whose existence depends on this decision.
- **body**: 1-2 paragraphs.

If only a free-form description was passed, propose a slug and ask before locking it (slugs are stable references and renaming later is painful).

#### Slug uniqueness

Before appending, `grep -n '^## decision-id: <slug>$' docs/decisions.md`. If it exists, surface the existing entry to the user and ask whether they want to (a) pick a different slug, (b) supersede the old one (which triggers the supersede-chain handling above), or (c) abort.

#### Surface the diff, then apply

Use `Edit` to insert after the last existing entry's closing blank line. The file is append-only — never insert mid-file or rewrite older entries.

If `**supersedes**` was used, ALSO update the older entry: flip `**status**: accepted` → `**status**: superseded` and add `**superseded-by**: <this-slug>` immediately below the status line. The older entry stays in place — don't move or rewrite it.

#### Verify

```bash
npm run lint:docs
```

This validates: every `tech-debt.md#anchor` ref resolves, every relative markdown link in `docs/decisions.md` resolves, the supersede chain is consistent. Exit 0 = clean.

### Step 2-F — Followup

Appends a bullet to a `### <area>` subsection of `## Open followups` in [`docs/progress.md`](../../../docs/progress.md), then bumps the file's `last-updated:` frontmatter to today.

#### Capture

Elicit (or derive from `$ARGUMENTS`):

- **text**: the followup description (one line, ~80 chars max). May be quoted in `$ARGUMENTS`.
- **area**: one of the recognized areas (`scripts`, `components`, `source`, `tests`, `docs`, `claude`, etc. — match an existing `### <area>` subsection in progress.md, OR propose adding a new subsection).

If `--area=<name>` is not in `$ARGUMENTS`, infer from the recent working context (last commit's touched files map to an area; an open editor file's path) or ask. Don't guess silently.

#### Compose the diff

- If the target area subsection contains a `(none)` placeholder line, REMOVE that line and insert the new bullet `- <text>` in its place.
- Otherwise, insert `- <text>` as the last bullet under the area heading (preserving any existing bullets above).
- ALSO update the frontmatter: `last-updated: YYYY-MM-DD` → today's ISO date. Use `date +%Y-%m-%d` to get today.

If the target area doesn't exist as a subsection, propose adding `### <area>\n\n- <text>` at the bottom of the `## Open followups` section. Ask before applying.

#### Surface, apply, verify

Apply directly via `Edit` — no confirmation prompt for this mechanical capture (trust the skill; `/audit-skill log` is the corrective loop for systematic issues). After apply, run `npm run lint:docs` to confirm the staleness gate passes (it will — `last-updated:` was just bumped to today).

### Step 2-S — Signal

Appends an `H3` row block to [`docs/signals-backlog.md`](../../../docs/signals-backlog.md) under `## Watching`, then bumps `last-updated:` to today.

#### Scope

This skill is for **adding new watch rows** OR for manually editing an existing row's prose fields (`current`, `action_when_moves`, etc). The three currently-tracked rows — `jellyfin-server-stable`, `jellyfin-server-rc`, `roku-os` — have their `latest_upstream` + `last_checked` auto-maintained by [`scripts/catchup-state.js`](../../../scripts/catchup-state.js) on each `/catchup` run. Don't manually bump those two fields for auto-managed slugs; the aggregator owns them.

#### Schema (mirrors signals-backlog.md preamble)

```markdown
### <slug>: <one-line label>

- **watching**: <what we're watching upstream>
- **current**: <static prose describing JellyRock's posture toward this upstream>
- **latest_upstream**: <last known upstream version>
- **latest_acknowledged**: <last upstream version reviewed via /done; seed = latest_upstream at row creation>
- **last_checked**: YYYY-MM-DD
- **action_when_moves**: <what triggers a JellyRock change>
- **status**: watching | action_pending | completed
```

#### Capture

Elicit (or derive from `$ARGUMENTS`):

- **slug** (kebab-case, stable). Reuses the same hygiene rules as decision slugs.
- **label** (one short phrase to follow the slug).
- The 7 bullet fields above.
- Default `last_checked` to today's ISO date.
- Default `latest_acknowledged` to whatever the user provides for `latest_upstream` (so the row starts non-stale; the next genuine upstream bump fires the banner once).
- Default `status` to `watching`.

#### Slug uniqueness

`grep -n '^### <slug>:' docs/signals-backlog.md`. If present, surface the existing row and ask whether to (a) pick a different slug, (b) update the existing row via `/done` or another `/log signal` to bump `last_checked`, or (c) abort.

#### Surface, apply, verify

Insert the new H3 block at the bottom of the `## Watching` section (newest at end). Bump `last-updated:` frontmatter. Apply directly via `Edit` — no confirmation prompt for this mechanical capture.

`npm run lint:docs` runs the schema validator — every required bullet present, valid `status` enum, valid ISO `last_checked`, valid positive-int `staleness_days`. Catches typos at write time.

### Step 2-R — Running

Replaces the single paragraph under `## Currently running` in [`docs/progress.md`](../../../docs/progress.md). The "in-flight cursor" — what you're actively working on right now. Distinct from open followups (deferred work) and recently-shipped (closed work). Replacing the cursor when the in-flight work changes is the path; closing the cursor when work ships is `/done running`.

#### Forms

- `/log running "<text>"` — replace the paragraph with `<text>` (1-2 sentences, free-form prose).
- `/log running --clear` — blank the paragraph (leaves the section heading; the catchup parser surfaces "(no progress.md cursor set)").

If `<text>` is missing AND `--clear` isn't passed, ask: "What's currently in flight?" Don't guess.

#### Compose the diff

1. Locate `## Currently running` in `docs/progress.md`.
2. Replace every line between that heading and the next `## ` heading (excluding both headings themselves) with: a leading blank line, the new `<text>` paragraph, a trailing blank line. For `--clear`, the body is just two blank lines (heading-blank-blank-next-heading).
3. Bump `last-updated:` frontmatter to today.

#### Surface, apply, verify

Apply directly via `Edit` — no confirmation prompt for this mechanical capture. After apply, run `npm run lint:docs` to confirm the staleness gate passes.

The Currently-running paragraph itself isn't schema-validated — it's free-form prose — so `lint:docs` only catches the frontmatter staleness signal here.

### Step 3 — Don't commit

This skill drafts + appends but does NOT `git commit`. After apply, surface "appended to `<path>` — review and commit when ready." The commit (with the actual code change that motivated the journal entry) is the user's call, not this skill's.

For decisions specifically: the conventional commit message style is `docs(decisions): record <slug>` per the existing log. For followups / signals, no specific convention — fold the journal edit into the commit that motivated it where possible.

## Sub-agent invocation

Read .claude/skills/log/SKILL.md and surface the proposed entry text for $ARGUMENTS=<type> <args>; do NOT apply the edit — return the proposed diff for the parent to confirm.
