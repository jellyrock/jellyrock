---
name: ramp
description: Area-scoped deep-dive briefing for context-switching into a JellyRock subsystem. Loads the scoped CLAUDE.md, the matching architecture topic doc, area-relevant tech-debt slugs, recent commits scoped to the area, and skills/agents that mention the area. Use when switching into `components`, `components/video`, `components/data`, `source`, `source/api`, `source/utils`, `tests`, `locale`, or `scripts` after >2 weeks not touching it, or when a sub-agent needs scoped briefing before research. Complements /catchup (which is global).
model: sonnet
effort: low
---

# /ramp `<area>` — area-scoped deep-dive briefing

Mandated by the JellyRock onboarding discipline for area-switches >2 weeks. Complements `/catchup` (global) by zooming into a specific subsystem's rules, recent commits, and tech-debt.

## Inputs

`$ARGUMENTS`: area name. Recognized areas (auto-loaded scoped CLAUDE.md tree): `components`, `components/video`, `components/data`, `source`, `source/api`, `source/utils`, `tests`, `locale`, `scripts`.

If `$ARGUMENTS` is empty, list the recognized areas and ask which one. If it's not in the list, treat as cross-cutting and tell the user to use `/catchup` instead (or pick the closest matching area).

## Step 1 — Load state via the aggregator + targeted reads

State for the briefing comes from two sources:

1. **Single aggregator call** — `scripts/catchup-state.js` with `--area=<area>` returns area-scoped JSON: PRs/issues filtered by the area→keyword map (mirrors the map below), git commits scoped via `git log -- <area>`, plus the four journals (progress.md followups filtered to this area, full signals watchlist, recent decisions, tech-debt severity counts, pending handoffs):

   ```bash
   node scripts/catchup-state.js --area=<area> --pretty
   ```

2. **Targeted file reads** for area-specific content the aggregator doesn't carry (file-content data, not state):

   ```bash
   # Scoped rules (auto-load convention) — full content
   cat <area>/CLAUDE.md 2>/dev/null

   # Area-matching architecture topic doc(s) — find then Read
   grep -lE "^  - <area>" docs/architecture/*.md

   # Area-relevant tech-debt slugs (substring match on the area keyword)
   grep -B1 -A4 "^#### " docs/architecture/tech-debt.md | grep -i -B1 -A4 "<keyword>"

   # Skills / agents that mention this area
   grep -l "<area>" .claude/skills/*/SKILL.md .claude/agents/*.md 2>/dev/null

   # Pending handoffs whose content mentions an area keyword
   grep -l "<keyword>" .claude/handoffs/*.md 2>/dev/null | head -5
   ```

Substitute `<area>` and a sensible search keyword. Area → keyword map (mirrors `scripts/catchup-state.js` `AREA_KEYWORDS`; if these drift, re-sync to the aggregator):

| Area | Keywords |
|---|---|
| `components/video` | `video\|playback\|player\|osd\|trickplay\|transcode` |
| `components/data` | `scenemanager\|ContentNode\|library` |
| `components` | `component\|scene\|focus\|navigation` |
| `source/api` | `api\|jellyfin\|task\|http\|auth` |
| `source/utils` | `util\|helper\|registry\|config` |
| `source` | `migration\|bootstrap\|main` |
| `tests` | `test\|rooibos\|spec` |
| `locale` | `translation\|locale\|i18n\|en_US` |
| `scripts` | `bsc\|plugin\|lint\|generate` |

## Step 2 — Compose the briefing

Output a single structured markdown briefing optimized for both human + sub-agent ingestion. Pure file refs, no decorative chrome:

```markdown
# Ramp briefing: <area>

## Scoped rules (auto-loaded when working in `<area>/`)

<full text of <area>/CLAUDE.md, or note "no scoped CLAUDE.md exists yet">

## Architecture topic doc

<topic-name>: [`docs/architecture/<topic>.md`](docs/architecture/<topic>.md) — last-reviewed YYYY-MM-DD
<one-paragraph summary from the doc's "How [subsystem] works" or equivalent intro section>

(If multiple topic docs match the area: list each.)

## Active tech debt for this area

- [`<slug>`](docs/architecture/tech-debt.md#<slug>) — <one-line summary>
- ...

## Recent activity (last 10 commits in `<area>/`)

<git log --oneline output>

## Open issues / PRs touching this area

- Issues: #N — <title>; ...
- PRs: #N — <title> by @author; ...

## Related skills + agents

- [`/<skill>`](../.claude/skills/<skill>/SKILL.md) — <one-line description>
- [`<agent>`](../.claude/agents/<agent>.md) — <one-line description>

## Pending handoffs touching this area

- `<path>` — <skill>, <relative-time>
- (or "(none)")

## Suggested entry points

<2-3 concrete files to read first based on the type of work likely needed —
the architecture doc's `related-files:` is the strongest hint for this>
```

Section collapses to "(none)" when empty so the shape stays consistent.

## Step 3 — Hand-off

If the briefing surfaces something action-shaped (an open issue with traction, a tech-debt slug the user just touched), name the right next-skill in a closing line: `/issue-triage <N>`, `/tech-debt-scan` (when finishing a feature in this area), `/runtime-triage` (when a recent crash log is handy).

This is a READ-ONLY skill. Don't apply edits — surface and summarize only.

## When NOT to use

- Starting a fresh session → use `/catchup` first; `/ramp` is for *area-switches within* a session.
- The area isn't in the recognized list → ask the user, or treat as cross-cutting and use `/catchup`.
- Specific question that doesn't need a full ramp → answer directly.

## Sub-agent invocation

To invoke from a sub-agent: parent passes `Read .claude/skills/ramp/SKILL.md and follow the steps for $ARGUMENTS=<area>; report the briefing` in the Task prompt. Sub-agents should treat the briefing as authoritative for that area's rules + recent state.
