# Decisions log

Append-only log of non-obvious design and process decisions made on JellyRock. The intent is **lightweight ADRs without the ceremony** — capture the *why* once, so future-you (and future agents) don't have to re-derive it from the code.

## When to add an entry

Add an entry when you make a decision that:

- **Has a non-obvious rationale** that wouldn't be apparent from the code alone (e.g. "we use task pool children-as-vehicles instead of fields because SceneGraph coalesces field events").
- **Closes off alternatives** that someone else might reasonably re-propose (e.g. "we use a custom translation system, not Roku's `tr()`, because…").
- **Has a constraint or trade-off behind it** that might be worth re-evaluating later (e.g. "we hardcode `30s` API timeout; per-call timeouts are nice-to-have but the cost vs. complexity didn't justify").

Don't add an entry for:

- Routine bug fixes (the commit message + the code is enough).
- Obvious decisions ("we used a `for each` loop here" — no).
- Time-bound state ("Charlie is on vacation" — that's a project memory, not a decision).

## When *not* to update an entry

**Entries are append-only.** If a decision is superseded, write a new entry that references the old one — never mutate the old one. The old entry is the historical record of what we believed when we made it.

```markdown
## decision-id: switched-from-foo-to-bar

**date**: 2026-09-01
**supersedes**: original-foo-decision

[explanation]
```

## Format

Each entry is its own `H2` section. Required fields:

- **id**: a stable kebab-case slug (used to cross-reference from commits / PRs / other entries)
- **date**: when the decision was made (YYYY-MM-DD)
- **status**: `accepted`, `superseded`, or `withdrawn`

Optional:

- **supersedes** / **superseded-by**: cross-reference if applicable
- **related-files**: paths whose existence depends on this decision

Then the body: why, what we considered, what we chose, what we ruled out, and any constraints behind the choice. Keep it short — one or two paragraphs. If it grows long, the entry probably should be a real architecture doc.

---

## decision-id: triage-opus-inline-investigation

**date**: 2026-05-06
**status**: accepted
**related-files**: .claude/skills/issue-triage/SKILL.md, .claude/skills/issue-triage/INVESTIGATION.md, .claude/skills/pr-review/SKILL.md, .claude/skills/pr-review/INVESTIGATION.md, .claude/skills/runtime-triage/SKILL.md, .claude/skills/runtime-triage/INVESTIGATION.md, .claude/skills/ci-triage/SKILL.md, .claude/skills/ci-triage/INVESTIGATION.md

The four triage skills (`/issue-triage`, `/pr-review`, `/runtime-triage`, `/ci-triage`) were redesigned from a "sonnet skill + Task-delegated opus agent" pair to a single opus skill that continues in-thread into a sibling `INVESTIGATION.md` contract. Two discovered constraints forced the change: the VSCode extension does not auto-revert the session model after a skill exits (the session stays on the skill's model), making the intended sonnet→opus handoff unreliable; and Task delegation is one-shot and isolated, preventing mid-investigation scope adjustment and breaking the human-in-the-loop workflow.

Alternatives considered: keep sonnet + Task-only (loses interactive investigation, back to the original friction); keep sonnet + document `/model opus` as a manual step (unreliable in this environment, GUI never reflects the switch). The chosen shape runs full-opus throughout, writes a structured YAML frontmatter handoff file (fields: created, target, branch, sha, cited-files) to `.claude/handoffs/` (gitignored) for compaction recovery, cross-session resume, and `/catchup` discovery, and adds a dedup check (Step 0) that short-circuits to the existing handoff when the target and cited files are unchanged since the prior triage. The four original investigator agent files (`*-investigator.md` under `.claude/agents/`) were deleted; their investigation contracts live as sibling `INVESTIGATION.md` files co-located with each skill, structurally preventing Task delegation from re-emerging.

## decision-id: four-pillar-journal-reshape

**date**: 2026-05-06
**status**: accepted
**related-files**: docs/progress.md, docs/signals-backlog.md, docs/architecture/system-shape.md, scripts/catchup-state.js, scripts/lint/decision-shape-nudge.cjs, .claude/skills/log/SKILL.md, .claude/skills/done/SKILL.md, .claude/skills/catchup/SKILL.md, .claude/skills/ramp/SKILL.md, scripts/lint/docs-check.cjs, scripts/lib/frontmatter.cjs, CLAUDE.md, .claude/skills/CLAUDE.md

Adopted the four-pillar journal pattern from a sister project, tuned for JellyRock conventions. Before this change, JellyRock had strong slow-decay journals ([`docs/decisions.md`](decisions.md), [`docs/architecture/tech-debt.md`](architecture/tech-debt.md)) and strong enforcement (husky + CI lint), but no fast-decay state cursor and no unified capture/completion ritual. Captures were ad-hoc edits or just `/add-decision`; there was no central "where did I leave off / what's open" surface. The reshape adds [`docs/progress.md`](progress.md) (live state cursor — currently running, recently shipped, open followups grouped by area, ~14d rolling), [`docs/signals-backlog.md`](signals-backlog.md) (external upstream watching with schema-validated rows), a Node aggregator at [`scripts/catchup-state.js`](../scripts/catchup-state.js) returning one JSON document for `/catchup` and `/ramp` (replaces ~13 parallel-bash calls; deterministic banner detection), and the unified `/log <type>` + `/done <slug>` skills replacing `/add-decision`. Enforcement: new `progress-stale` and `signals-schema-invalid` lint categories in `docs-check.cjs`; advisory pre-push decision-shape nudge at `decision-shape-nudge.cjs`; root [`CLAUDE.md`](../CLAUDE.md) "Capture & state discipline" subsection making `/log` the only sanctioned write path for the three new-or-touched journals.

Alternatives considered and ruled out: a strict Diátaxis tutorial bucket (existing [`DEVGUIDE.md`](dev/DEVGUIDE.md) covers that role; splitting `docs/dev/` would force users to know a Diátaxis category before they can navigate); a second backlog file for research questions (followups in `progress.md` handle that until volume justifies splitting); a backlog-row-per-dependency-bump auto-detector (low signal-to-noise; manual capture only). What stays unchanged: GitHub issues remain primary backlog for issue-shaped work; [`tech-debt.md`](architecture/tech-debt.md) keeps its slug-based slow-decay role via [`/tech-debt-scan`](../.claude/skills/tech-debt-scan/SKILL.md) (no overlap with `progress.md` followups). The four-pillar shape is documented in [`system-shape.md`](architecture/system-shape.md) — see that doc for principles, lineage citations (Nygard ADR + Procida Diátaxis + GTD + agent-collaborative project memory), and audience tuning (solo + AI + OSS-eventual). Constraint behind the choice: deferring enforcement is the same anti-pattern that creates drift, so `progress-stale` + `signals-schema-invalid` lint gates land in the same change set as the journal files themselves rather than as a "we'll add it later" followup.
