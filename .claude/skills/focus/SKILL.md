---
name: focus
description: Session-start triage + routing. Reads the same `scripts/catchup-state.js` aggregator that `/catchup` uses, ranks 3–5 next-move candidates across five tiers (Resume / Blocked / Drift / Hot / Momentum), presents a numbered menu with a "Recommended" call that cites the rule, then routes the user pick to the right downstream skill (`/issue-triage`, `/ci-triage`, `/runtime-triage`, `/pr-review`, `/done`, `/log`, `/tech-debt-scan`) with a short session-context preamble so the reasoning that selected the candidate carries into the investigation. Read-only — never `Edit` / `Write`; routing is by prompt instruction, not by invoking other skills. Distinct from `/catchup` (state briefing, one suggestion) and `/ramp` (area-scoped deep-dive). Use when starting a fresh session and you want help picking *which* of several plausible next moves to take; for a state-only briefing prefer `/catchup`.
model: opus
---

# /focus — triage the next move

When you've been away for a day or a week and multiple things look actionable — a pending handoff, red CI, a stale signal row, a high-engagement bug — `/focus` ranks them against a fixed rubric, surfaces a 3–5 item menu, makes a "Recommended" call you can override, then hands the chosen path off to the right downstream skill with the surrounding context attached.

Distinct from siblings:

- `/catchup` (sonnet, read-only briefing) — "What's the state of the world?" Single-shot, one "Suggested next" line. Use when you want context, not a deliberation.
- `/ramp <area>` (sonnet, area-scoped briefing) — "Re-load me into this subsystem." Same aggregator with `--area=`; not a triage menu.
- `/focus` (opus, triage + routing) — "Help me pick the right next move from several candidates."

## Inputs

`$ARGUMENTS`: optional `--area=<name>` to scope triage to one subsystem (mirrors `/ramp`). Valid areas: same list `catchup-state.js` accepts (`components`, `components/video`, `components/data`, `source`, `source/api`, `source/utils`, `tests`, `locale`, `scripts`). Omit for global triage.

## Step 1 — Pull state in one call

The aggregator at [`scripts/catchup-state.js`](../../../scripts/catchup-state.js) returns one JSON document with every dynamic-state input the triage needs. One Bash call:

```bash
node scripts/catchup-state.js --pretty                # global
node scripts/catchup-state.js --pretty --area=<name>  # area-scoped
```

Top-level keys: `meta`, `git`, `prs`, `issues`, `ci`, `handoffs`, `progress`, `signals`, `decisions`, `tech_debt`, `docs_stale`, `_errors`. If `_errors[<section>]` is populated, surface it as a Tier 3 (Drift / schema-broken) candidate rather than letting the section silently disappear.

## Step 2 — Rank candidates into tiers

Build the candidate list from the JSON. Higher tier wins on tie; ties within a tier break on recency (most recent first). **Categories:**

| Tier | Category | Inputs | Cap | "Why now" template |
|---|---|---|---|---|
| 1. Resume | Pending handoff | `handoffs.pending[]` (already sorted recent-first) | 2 | "Investigation paused mid-flight — resume from `.claude/handoffs/<name>` (<age_days>d ago)" |
| 2. Blocked | Failed CI on this branch | `ci.current_branch_runs[]` where `conclusion != 'success'` | 1 | "CI run `<name>` <conclusion> (<relative createdAt>)" |
| 2. Blocked | PR review requested | `prs.review_requested[]` | 1 | "#<N> waiting on your review since <relative updatedAt>" |
| 3. Drift | Stale signal | `signals.rows[]` where `stale=true` | 1 | "`<slug>`: upstream moved <latest_acknowledged> → <latest_upstream>" |
| 3. Drift | Stale progress.md | `progress.days_since > 7 && progress.commits_since > 0` | 1 | "Cursor is <days_since>d stale, <commits_since> commit(s) since" |
| 3. Drift | Schema-broken journal | `_errors.progress` / `_errors.signals` (non-null) | 1 | "Parser error in <file>: <msg>" |
| 4. Hot | High-engagement bug | `issues.high_engagement_bugs[]` (top 1 by comments) | 1 | "#<N> — <title> (<comments> comments, last touched <relative>)" |
| 4. Hot | Recent bug report | `issues.recent_bug_reports[]` (top 1, last 7d) | 1 | "#<N> — <title> (filed <relative>)" |
| 5. Momentum | Top tech-debt slug | `tech_debt.top_3[0]` | 1 | "[<severity>] `<slug>` — <issue_oneline>" |

**Selection rules:**

- At most 5 candidates total in the menu. Sort by tier ascending; take the first 5.
- Always include at least one Tier 1 or Tier 2 item if any exists — never let blockers fall off the end.
- Per-category caps prevent one hot category from crowding the menu.
- Empty everywhere? Skip directly to Step 5's "nothing-urgent" branch and stop.

## Step 3 — Present the menu

Format short. Bullets carry the tier label in brackets for instant pattern recognition. Each line ends with the **exact** invocation the user should run if they pick it.

```markdown
**Triage — pick one:**

1. [Resume] `<handoff-name>` — Investigation paused mid-flight (<age>d ago). Suggested route: read `.claude/handoffs/<handoff-name>` and follow the sibling INVESTIGATION.md for that skill.
2. [Blocked] CI run `<name>` — <conclusion> (<relative>). Suggested route: `/ci-triage <run-id>`
3. [Hot] #<N> — <title> (<comments> comments, last touched <relative>). Suggested route: `/issue-triage <N>`
4. [Drift] `<slug>` signal — upstream moved <ack> → <latest>. Suggested route: `/done <slug>` after reviewing the changelog
5. [Momentum] [<severity>] `<slug>` — <issue_oneline>. Suggested route: read [tech-debt.md#<slug>](../../../docs/architecture/tech-debt.md#<slug>), then conversation

**Recommended:** #<N> (<one-sentence reason that cites the rule — e.g., "blockers > drift > hot > momentum">).

Which? Reply with the number, "skip" to dump full state via `/catchup`, or "none" if nothing here lines up.
```

**Recommended-line rules:**

- **Always include**, even on close calls. The whole point is to make the triage call.
- When the top two candidates share a tier, acknowledge the closeness: "Recommended: #3 narrowly — #2 is also reasonable if you'd rather close the loop on the in-flight handoff first."
- Cite the *rule* that picked the winner ("blockers > drift > hot > momentum"; "Tier 1 in-flight resume beats Tier 4 hot bug"). Transparent reasoning is overridable reasoning.

Then **end the turn**. Do not pre-execute any route — Step 4 is the user's call.

## Step 4 — Wait for the pick

User replies with a number, `skip`, `none`, or free-form ("3, but also remind me about #5"). The next turn handles routing.

**Don't** call `AskUserQuestion` here — the menu format is richer than the 4-option cap and the user may want to add free-form context to their pick. Just stop after Step 3 and let the user reply.

## Step 5 — Route with session context

When the user replies with a pick, branch on its shape:

### Triage-shaped pick (Resume / Blocked CI / Blocked PR-review / Hot bug)

Surface a 3–5 line **session-context preamble** in the conversation, then name the exact downstream invocation. Example for "#2, the CI failure":

```markdown
**Session context for `/ci-triage <run-id>`:**

- Other candidates considered: <one-line each, top 2 alternates>
- Relevant journal state: <progress.md `## Currently running` summary if non-null; otherwise "(cursor unset)">
- In-flight handoffs in this area: <count + most-recent name, or "(none)">

Now invoke `/ci-triage <run-id>` to start the investigation. The triage skill will write its own handoff packet to `.claude/handoffs/`.
```

The downstream triage skill runs in the **same conversation**, so the preamble is naturally part of its context — no handoff-packet schema extension needed.

### Capture-shaped pick (Stale signal / Stale progress / Schema-broken journal)

Give the exact `/done <slug>` or `/log followup` invocation with prefilled args. One line of context (why this matters now), then hand back. Example for "#4, the stale jellyfin-server-stable signal":

```markdown
Upstream moved 10.11.8 → 10.11.9. Review the release notes first (https://github.com/jellyfin/jellyfin/releases/tag/v10.11.9), then:

- If no JellyRock change needed: `/done jellyfin-server-stable` (bumps `latest_acknowledged` and clears the stale flag).
- If a JellyRock change is needed: `/log signal jellyfin-server-stable` to flip `status` to `action_pending` first.
```

### Tech-debt momentum pick

Surface the slug's tech-debt entry, the related-files list, and the relevant scoped CLAUDE.md (if one exists for the touched area). Hand the conversation back; the cleanup is regular code work that goes through `/pr` at the end.

### "skip"

Print the standard `/catchup` briefing format inline (or tell the user "invoke `/catchup` for the full state template — `/focus` is the triage cousin"). Don't auto-invoke `/catchup` — let the user pick.

### "none"

Acknowledge: "Nothing here lines up. Last commit `<sha>`, tree <clean | dirty>. Pick something off `tech_debt.top_3` (<list>) or call it a day." Exit.

### Empty-everywhere from Step 2

Skip the menu entirely: "Nothing urgent. Last commit `<sha>`, tree clean, no pending handoffs, no failed CI, no stale signals, no hot bugs in the last 60 days. Pick something off `tech_debt.top_3` (<list>) or take the day off."

## Read-only — never Edit / Write

`/focus` doesn't write to journals, doesn't create handoffs, doesn't bump frontmatter. Routing happens by **printing the exact invocation the user should run**, not by invoking another skill itself. Downstream skills (`/issue-triage`, `/ci-triage`, `/done`, etc.) own the writes that follow.

If a sub-agent invokes `/focus` and the menu surfaces a capture-shaped finding, the sub-agent ends its report with a "Captures for /log" section so the parent can invoke `/log` — same pattern `/catchup` uses.

## When NOT to use

- You're mid-task and want to know "what's the state of X?" → answer directly or use `/catchup`, don't run an opus triage cycle.
- You're context-switching into a specific subsystem after >2 weeks away → use `/ramp <area>` for the deep-dive briefing, then `/focus --area=<name>` if you also need to triage what's actionable there.
- Same session, you already ran `/focus` and picked a route — don't re-run; just follow the route you picked.
- The aggregator failed (`_errors` populated for `git` or every major section) → fix the underlying breakage first; `/focus` on broken state produces noise.

## Sub-agent invocation

To invoke from a sub-agent: parent passes `Read .claude/skills/focus/SKILL.md and follow Steps 1–3 for $ARGUMENTS=<area-or-empty>; report the menu and Recommended line — do NOT execute Step 5 routing` in the Task prompt. Sub-agents surface candidates; the parent + user own the pick.
