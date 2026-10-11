---
name: ramp
description: Area-scoped deep-dive briefing for context-switching into a JellyRock subsystem. Loads the scoped CLAUDE.md, the matching architecture topic doc, area-relevant tech-debt slugs, recent commits scoped to the area, and skills/agents that mention the area. Use when switching into `components`, `components/video`, `components/data`, `source`, `source/api`, `source/utils`, `tests`, `locale`, or `scripts` after >2 weeks not touching it, or when a sub-agent needs scoped briefing before research. Complements /catchup (which is global).
model: sonnet
effort: low
---

# /ramp `<area>`: an area-scoped briefing

`AGENTS.md`'s catchup-discipline rule calls for it when you come back to a subsystem after more than two weeks away. Where `/catchup` covers the whole repo, `/ramp` zooms into one subsystem's rules, recent commits and tech debt.

## Inputs

The arguments name one area. The recognized areas are the folders with a scoped `CLAUDE.md`: `components`, `components/video`, `components/data`, `source`, `source/api`, `source/utils`, `tests`, `locale`, `scripts`.

With no arguments, list the recognized areas and ask which one. For an area not in the list, treat the question as cross-cutting and suggest `/catchup`, or the closest matching area.

## Step 1: Load state through the aggregator and targeted reads

The briefing's state comes from two sources:

1. **One aggregator call.** `scripts/catchup-state.js` with `--area=<area>` returns JSON: PRs and issues filtered by the area's keywords (the map below), plus the current branch's CI, pending handoffs, the full list of watched signals, recent decisions, tech-debt counts and stale docs.

   ```bash
   node scripts/catchup-state.js --area=<area> --pretty
   ```

2. **Targeted file reads** for area content the aggregator doesn't carry:

   ```bash
   # Recent activity: the last 10 commits in the area
   git log --oneline -10 -- <area>

   # Scoped rules, full content
   cat <area>/CLAUDE.md 2>/dev/null

   # Architecture docs whose related-files name the area: find, then Read
   grep -lE "^  - <area>" docs/architecture/*.md

   # Area-relevant tech-debt slugs (substring match on the area keyword)
   grep -B1 -A4 "^#### " docs/architecture/tech-debt.md | grep -i -B1 -A4 "<keyword>"

   # Skills / agents that mention this area
   grep -l "<area>" .claude/skills/*/SKILL.md .claude/agents/*.md 2>/dev/null

   # Pending handoffs whose content mentions an area keyword
   grep -l "<keyword>" .claude/handoffs/*.md 2>/dev/null | head -5
   ```

Substitute `<area>` and a search keyword from this map. It copies `AREA_KEYWORDS` in `scripts/catchup-state.js`; when the two differ, the script is right.

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

## Step 2: Compose the briefing

Output one markdown briefing that a person and a sub-agent can both read. Use plain file references and no decoration:

```markdown
# Ramp briefing: <area>

## Scoped rules (auto-loaded when working in `<area>/`)

<full text of <area>/CLAUDE.md, or note "no scoped CLAUDE.md exists yet">

## Architecture topic doc

<topic-name>: [`docs/architecture/<topic>.md`](docs/architecture/<topic>.md), last reviewed YYYY-MM-DD
<a one-paragraph summary of the doc's opening section>

(If multiple topic docs match the area: list each.)

## Active tech debt for this area

- [`<slug>`](docs/architecture/tech-debt.md#<slug>): <one-line summary>
- ...

## Recent activity (last 10 commits in `<area>/`)

<git log --oneline output>

## Open issues / PRs touching this area

- Issues: #N, <title>; ...
- PRs: #N, <title> by @author; ...

## Related skills and agents

- [`/<skill>`](.claude/skills/<skill>/SKILL.md): <one-line description>
- [`<agent>`](.claude/agents/<agent>.md): <one-line description>

## Pending handoffs touching this area

- `<path>`: <skill>, <relative-time>
- (or "(none)")

## Suggested entry points

<two or three files to read first for the work likely needed; the architecture doc's `related-files:` is the strongest hint>
```

An empty section reads "(none)", so the shape stays the same.

## Step 3: Hand off

If the briefing turns up something to act on (an open issue with traction, a tech-debt slug the user recently touched), name the next skill in a closing line: `/issue-triage <N>`, `/tech-debt-scan` (when finishing a feature in this area) or `/runtime-triage` (when a recent crash log is at hand).

This skill only reads. Don't edit anything: surface and summarize.

## When NOT to use

- Starting a fresh session: use `/catchup` first. `/ramp` is for switching areas within a session.
- The area isn't in the recognized list: ask the user, or treat it as cross-cutting and use `/catchup`.
- A specific question that doesn't need a full briefing: answer it directly.

## Sub-agent invocation

To run it from a sub-agent, the parent passes `Read .claude/skills/ramp/SKILL.md and follow the steps for the area <area>; report the briefing` in the Agent prompt. The sub-agent treats the briefing as authoritative for that area's rules and recent state.
