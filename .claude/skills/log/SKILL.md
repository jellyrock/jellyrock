---
name: log
description: Append/update an entry in one of the project journals — `decision` (agent-gated: ADR-grade → a numbered record in `docs/adr/`, sub-architectural → a `docs/decisions.md` note, trivia declined), `followup` (`docs/progress.md` open followups, deferred work not yet issue-shaped or tech-debt-shaped), `signal` (`docs/signals-backlog.md`, an external version-watch row), or `running` (`docs/progress.md` `## Currently running` paragraph; replaces the in-flight cursor). Routes by first $ARGUMENTS token. Mechanical types (followup, signal, running) apply directly via Edit — no per-invocation confirmation prompt. The `decision` type is agent-gated: the agent drafts the record, applies a significance gate (architectural / hard-to-reverse / cross-component?), routes it (ADR vs. sub-ADR note vs. decline), and diff-confirms before writing, with one-tap human override — the human classifies nothing. The sole sanctioned capture path for these journals; raw markdown edits are not permitted (per AGENTS.md capture-discipline rule).
model: sonnet
effort: low
---

# /log `<type>` — append a journal entry

## Contract

**Goal.** Be the single capture entry point for every kind of journal write JellyRock keeps, so instead of remembering which file each entry lives in and which format it uses, you type `/log <type> <body>` and the skill routes to the right journal with the right format. It covers **four types**: `decision` (agent-routed to a numbered ADR in `docs/adr/` or a sub-ADR note in `docs/decisions.md`), `followup` (`docs/progress.md` open followups), `signal` (`docs/signals-backlog.md` upstream version-watch rows), and `running` (the `## Currently running` in-flight cursor in `docs/progress.md`). There are **two capture modes.** *Mechanical* types (`followup`, `signal`, `running`) apply **directly** via Edit — no per-invocation gate, because routing is mechanical and the corrective loop for systematic wrongness is `/audit-skill log`, not a confirmation prompt every session. The `decision` type is the deliberate exception and the one flow where the agent does classification work: it drafts the record, applies a **significance gate** (architectural / hard-to-reverse / cross-component?), and routes it — ADR-grade → a new numbered ADR in `docs/adr/`, sub-architectural → a note in `docs/decisions.md`, trivia → declined — then surfaces a **diff-and-confirm** the human can override in one tap. Here the gate is right because the agent is confirming a *significance + routing judgment*, not gating a mechanical append; the human classifies nothing. This is the sole sanctioned write path for those three journals; raw `Write`/`Edit` on them is not permitted (per the root AGENTS.md capture-discipline rule). The mechanical path is light, but the decision flow's significance judgment is a plausible-wrong call, so the skill is pinned at the **Sonnet tier with `effort: low`**.

**Inputs.** `$ARGUMENTS` is `<type> [optional title or body]` — the first whitespace-separated token is the type (`decision` / `followup` / `signal` / `running`); the rest is passed to the type-specific flow. If `$ARGUMENTS` is empty or the type isn't recognized, the skill lists the four valid types and asks; it never guesses.

**Outputs.**

- For a mechanical `/log` (`followup`/`signal`/`running`): the append (or cursor replacement) applied directly via Edit to the target journal, plus the `last-updated:` frontmatter bump on `docs/progress.md` / `docs/signals-backlog.md` so the staleness banner stays accurate.
- For `/log decision`: depending on the agent's significance verdict, either a **new numbered ADR** (`docs/adr/NNNN-<slug>.md` in the house style, plus its row in the `docs/adr/README.md` index table) for an ADR-grade decision, or a slug-based **sub-ADR note** appended to `docs/decisions.md` (append-only — never insert mid-file or rewrite older notes) for a sub-architectural one, or a one-line decline for trivia — with any supersede-chain update applied to the superseded record. Surfaced as a **diff-and-confirm** before writing, with the proposed routing shown for one-tap override.
- A `npm run lint:docs` pass after the write, confirming the journal's schema + staleness gate.
- The skill is pure local-file edits — no commit (the user owns that), no remote calls, no service restarts.

**Success criteria.**

- **Mechanical captures** (`followup`, `signal`, `running`) are applied directly via Edit — no per-invocation diff-then-confirm gate. Trust the skill; if outputs go systematically wrong, run `/audit-skill log` to fix the SKILL.md (`git reset --soft HEAD~1` recovers a rare bad capture). Per-invocation confirmation is the wrong corrective loop for *systematic* issues — it adds friction every session and masks the problem the audit would catch.
- **The `decision` type is the one exception to the no-gate rule** — it surfaces a diff-and-confirm because it's confirming a *significance + routing judgment* (does this clear the decision-discipline bar? does it supersede an existing slug?), not gating a mechanical append.
- **For `/log decision`, the agent applies the significance gate itself and the human classifies nothing.** ADR-grade decisions (architectural / hard-to-reverse / cross-component) become numbered ADRs in `docs/adr/`; sub-architectural ones (non-obvious rationale / closes off alternatives / a constraint worth re-evaluating, but local blast radius) become `docs/decisions.md` notes; routine bug fixes, obvious choices, and time-bound state are declined rather than padding either log. The human only confirms or overrides the proposed routing.
- The diff shape of the appended entry matches the surrounding entries in the target file — the skill reads the file's existing format and matches it; it does not invent a new shape.
- Decision slugs are checked for uniqueness before append (`grep '^## decision-id: <slug>'`); a collision surfaces the existing entry and asks (different slug / supersede / abort).
- When a type-specific flow needs information the user didn't supply and can't infer (an area pick, a slug, a signal field), the skill elicits it — the bar is "genuinely ambiguous, multiple equally-valid choices," not "any uncertainty."

**Failure modes to avoid.**

- **Adding friction prompts in place of audit-driven fixes.** If *mechanical* captures consistently land wrong, the corrective loop is `/audit-skill log` → fix the SKILL.md → re-dogfood — NOT a confirmation prompt gating every invocation. Per-session friction is the worse pathology than a rare wrong capture. (The `decision` type's diff-and-confirm is **not** this anti-pattern — it gates a classification judgment, not a mechanical append.)
- **Decision-log creep + ADR creep.** The significance bar is load-bearing at two levels: a routine fix, an obvious choice, or time-bound state is NOT a decision entry at all; and a decision that's local in blast radius is a `docs/decisions.md` note, NOT a numbered ADR. If everything becomes an entry the high-signal ones drown; if every decision becomes an ADR, no decision is architectural.
- **Letting the human predict ADR-grade at capture time.** `/log decision` must NOT ask the user "is this an ADR?" up front — that re-imports the prediction-at-capture friction the agent-gate exists to remove. The agent classifies with full session context and routes; the human only confirms or overrides the proposed routing in one tap.
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

The unified capture surface for JellyRock's project journals: decisions, progress followups, signals. The `decision` route supersedes the old `/add-decision` skill — it keeps that skill's discipline bar but moves classification to the agent (ADR-grade vs. sub-ADR note vs. decline) instead of a static human-read checklist.

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

### Step 2-D — Decision (agent-gated)

The one flow where the agent does classification work, not mechanical routing. The user supplies content; the agent drafts, classifies, routes, and confirms. JellyRock keeps a **two-tier** decision surface: ADR-grade decisions are numbered, immutable records in [`docs/adr/`](../../../docs/adr/README.md); sub-architectural decisions are lightweight notes in [`docs/decisions.md`](../../../docs/decisions.md). Supersedes the old `/add-decision` skill's static human-read checklist.

#### 1. Draft

From the rest of `$ARGUMENTS` + full session context, draft the decision record: what was decided, why, what was considered and ruled out, any constraint or trade-off behind the choice.

#### 2. Apply the significance gate

First, does it clear the decision bar at all? (Per [`docs/decisions.md`](../../../docs/decisions.md)'s "When to add a note":)

- ✅ **Has a non-obvious rationale** not apparent from the code alone (e.g., "task pool children-as-vehicles dodge for SceneGraph event coalescing").
- ✅ **Closes off alternatives** someone might reasonably re-propose (e.g., "custom translation system, not Roku's `tr()`").
- ✅ **Has a constraint / trade-off** worth re-evaluating later (e.g., "hardcoded `30s` API timeout").
- ❌ **Routine bug fix / obvious choice / time-bound state** — the commit + code is enough; not a decision.

Then classify the blast radius — the negative filter ("if every decision is architectural, none is"):

- **ADR-grade** — architectural, hard-to-reverse, OR cross-component.
- **Sub-architectural** — clears the bar but is local (one component / file / tooling surface).
- **Trivia** — doesn't clear the bar at all.

#### 3. Route on the verdict

- **ADR-grade** → draft a new numbered ADR at `docs/adr/NNNN-<slug>.md` (next number in sequence; `ls docs/adr/*.md` to find it) in JellyRock's house style: `# ADR NNNN: <title>`, then `**Status:** Accepted` / `**Date:** <today>` (use `date +%Y-%m-%d`) / optional `**related-files**:` line, then 1-2 tight prose paragraphs (why; what was considered; what was ruled out; constraints). ALSO add the row to the `docs/adr/README.md` index table. If it supersedes an existing ADR, write it as a new ADR that flips the older one's `**Status:**` to `Superseded` and adds a `>` pointer banner — the old record stays in place (ADRs are superseded, not edited).
- **Sub-architectural** → append a slug-based note to [`docs/decisions.md`](../../../docs/decisions.md) using the schema below. Insert after the last `## decision-id:` note's closing blank line — which may NOT be the file's last section: a trailing `## Migrated to ADRs` table sits at the end, so append after the last *note*, never after that table. The file is append-only for notes — never insert mid-file or rewrite older notes.
- **Trivia** → decline in one line ("below the decision bar; not recorded"). Write nothing.

The sub-ADR note schema (`docs/decisions.md`):

```markdown
## decision-id: <stable-kebab-case-slug>

**date**: YYYY-MM-DD
**status**: accepted | superseded | withdrawn

[optional, in this order, only when applicable:]
**supersedes**: <other-slug>
**superseded-by**: <other-slug>
**related-files**: <comma-or-list of repo-relative paths>

[body: 1-2 short paragraphs. Why; what we considered; what we ruled out;
any constraints or trade-offs. If it grows long, it's probably an ADR.]
```

#### 4. Slug uniqueness

The slug (≤5 words, kebab-case, stable — the cross-reference key in commits, PRs, and other entries) must be unique on its target surface:

- For an ADR: scan `ls docs/adr/` for an existing `NNNN-<slug>.md`.
- For a note: `grep -n '^## decision-id: <slug>$' docs/decisions.md`.

If it collides, surface the existing record and ask: (a) pick a different slug, (b) supersede the old one (triggers the supersede-chain handling above), or (c) abort. If only a free-form description was passed, propose a slug and ask before locking it — slugs are stable references and renaming later is painful.

#### 5. Diff-and-confirm, then apply

Surface the proposed **routing** (ADR / note / decline) plus the drafted content as a diff. The user confirms, or **overrides the routing in one tap** (promote a note to an ADR, demote an ADR to a note, redirect). No file is written before confirmation — this is the one `/log` path with a gate, and it gates the agent's *judgment*, not a mechanical append. Then apply the confirmed write via `Edit` (the note and/or the README index row) or by writing the new ADR file. For a sub-ADR note that uses `**supersedes**`, ALSO flip the older note's `**status**: accepted` → `superseded` and add `**superseded-by**: <this-slug>` below its status line — the older note stays in place.

#### 6. Verify

```bash
npm run lint:docs
```

This validates: every `tech-debt.md#anchor` ref resolves, every relative markdown link in the touched record (`docs/adr/*.md` and `docs/decisions.md`) resolves, and — for `docs/decisions.md` notes — the supersede chain is consistent (valid `status` enum, both `supersedes` / `superseded-by` targets resolve to real slugs, the pointers are symmetric, the superseded note actually reads `superseded`, no self-supersede). Exit 0 = clean.

**ADR supersede chains are NOT machine-checked.** ADRs express supersession as prose in a `**Status:**` line (`Superseded by [ADR 0024](…)`, and the `**Partially superseded by:** ADR 0011 (per-finding-default output only)` variant), which has no field to validate. Get the ADR side right by hand.

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

Read .claude/skills/log/SKILL.md and surface the proposed entry text for $ARGUMENTS=<type> <args>; do NOT apply the edit — return the proposed diff for the parent to confirm. Sub-agents NEVER auto-apply: a hallucinated entry written without confirmation corrupts the journal that `/catchup` reads as authoritative. For the `decision` type the bar is higher still — surface the proposed *routing + drafted record* (ADR / note / decline) and wait; never auto-file a numbered ADR, since an unconfirmed ADR is a durable, supersede-only artifact.
