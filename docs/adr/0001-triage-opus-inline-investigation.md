# ADR 0001: Triage skills run Opus inline with a sibling INVESTIGATION contract

**Status:** Accepted
**Date:** 2026-05-06

**related-files**: .claude/skills/issue-triage/SKILL.md, .claude/skills/issue-triage/INVESTIGATION.md, .claude/skills/pr-review/SKILL.md, .claude/skills/pr-review/INVESTIGATION.md, .claude/skills/runtime-triage/SKILL.md, .claude/skills/runtime-triage/INVESTIGATION.md, .claude/skills/ci-triage/SKILL.md, .claude/skills/ci-triage/INVESTIGATION.md

The four triage skills (`/issue-triage`, `/pr-review`, `/runtime-triage`, `/ci-triage`) were redesigned from a "sonnet skill + Task-delegated opus agent" pair to a single opus skill that continues in-thread into a sibling `INVESTIGATION.md` contract. Two discovered constraints forced the change: the VSCode extension does not auto-revert the session model after a skill exits (the session stays on the skill's model), making the intended sonnet→opus handoff unreliable; and Task delegation is one-shot and isolated, preventing mid-investigation scope adjustment and breaking the human-in-the-loop workflow.

Alternatives considered: keep sonnet + Task-only (loses interactive investigation, back to the original friction); keep sonnet + document `/model opus` as a manual step (unreliable in this environment, GUI never reflects the switch). The chosen shape runs full-opus throughout, writes a structured YAML frontmatter handoff file (fields: created, target, branch, sha, cited-files) to `.claude/handoffs/` (gitignored) for compaction recovery, cross-session resume, and `/catchup` discovery, and adds a dedup check (Step 0) that short-circuits to the existing handoff when the target and cited files are unchanged since the prior triage. The four original investigator agent files (`*-investigator.md` under `.claude/agents/`) were deleted; their investigation contracts live as sibling `INVESTIGATION.md` files co-located with each skill, structurally preventing Task delegation from re-emerging.
