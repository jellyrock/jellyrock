# issue-triage — audit log

Per-skill audit log per the convention in [`.claude/skills/audit-skill/SKILL.md`](../audit-skill/SKILL.md). Captures each `/audit-skill issue-triage` run's friction findings + applied fixes. Architectural-grade decisions also surface in [`docs/decisions.md`](../../../docs/decisions.md).

## 2026-05-06 — opus single-file refactor + handoff infrastructure (session `07074348`)

**Friction surfaced:** 1 UX-shape (auto-Task delegation prevents direct interactive work + mid-investigation scope adjustment); not detected by mechanical extractors (0 findings) — surfaced via user feedback. The mechanical model-fit profile (27 turns, 16 Bash, 1 sub-agent, 0 TodoWrite, 0 AskUserQuestion, 3KB text) said "sonnet fits the prep" but missed the broken cross-model handoff in the VSCode extension: `model: sonnet` is enforced for the skill, but the active model does NOT auto-revert when the skill exits, and `/model opus` mid-conversation is unreliable in that environment. Net: the original sonnet-prep-then-opus-investigation design couldn't actually deliver the interactive opus investigation it promised.

**Model fit:** current `model: opus` (changed from `sonnet`). Reason: the cross-model handoff was structurally broken in this codebase's environment; running the whole flow on opus eliminates the boundary at the cost of ~$0.13/invocation. Same change applied to the three sibling triage skills (`/pr-review`, `/runtime-triage`, `/ci-triage`).

**Fixes applied:**

- All four triage skills (`/issue-triage`, `/pr-review`, `/runtime-triage`, `/ci-triage`): frontmatter `model: sonnet` → `model: opus`; description rewritten to drop the "(sonnet) → opus agent" framing.
- All four triage skills: replaced auto-Task hand-off step with "write handoff file + one-line confirmation + continue immediately into INVESTIGATION.md". Anti-pattern callout removed (structural enforcement supersedes prose).
- Three of four triage skills (`/issue-triage`, `/pr-review`, `/ci-triage`): added Step 0 dedup check — if a recent prior handoff exists on the same target AND cited files unchanged AND target itself unchanged (issue updatedAt / PR head SHA / run-id is immutable), short-circuit to the existing handoff with "(a) resume / (b) re-triage / (c) cancel" choice. `/runtime-triage` skipped — each crash log is unique enough that dedup would be friction.
- Handoff file format: YAML frontmatter (`created`, `target`, `branch`, `sha`, `cited-files`) + packet body. Filename: `<skill>-<id>-YYYYMMDD-HHMMSS.md`.
- Investigation contracts moved from `.claude/agents/<name>-investigator.md` to sibling `.claude/skills/<name>/INVESTIGATION.md`. Co-located with the skill, no Task-invocable frontmatter (since they're never Task-invoked under the new design).
- Four investigator agent files deleted (`issue-investigator`, `pr-review-investigator`, `runtime-investigator`, `ci-investigator`). Structural enforcement of the team policy "no Task delegation for triage; human-in-the-loop the entire investigation."
- `.claude/handoffs/` gitignored ([.gitignore](../../../.gitignore)). New directory for transient handoff files.
- `/catchup` Step 1 gains a silent auto-prune (`find .claude/handoffs -name '*.md' -mtime +30 -delete`) and lists the 5 most-recent handoffs.
- `/catchup` Step 2 briefing template gains a "Pending handoffs" line; cleanup hint when count ≥ 10.
- `/catchup` Step 3 hand-off table prepended with a "pending handoff resume" suggestion.
- `/ramp` Step 1 + briefing template gain area-scoped handoff surfacing (grep handoff bodies for area keyword).
- `.claude/skills/README.md`: investigation-flows section header + intro rewritten ("single-file opus skills" instead of "sonnet skill → opus agent"); agents table reduced to `log-reviewer` + `pattern-finder` (the genuinely sub-agent-shaped ones); the four investigator agent rows removed.

**Deferred / dropped:**

- A CLAUDE.md rule codifying "no Task delegation for triage" was considered and dropped — structural enforcement (no agent files exist to invoke) is sufficient.
- A SessionStart hook that surfaces pending handoffs was discussed as mitigation for "must run `/catchup` to discover handoffs" — deferred; can be added later if discoverability proves a real problem.

**Source transcript:** `~/.claude/projects/-home-charlie-PROJECTS-JellyRock-jellyrock/07074348-9877-4142-b097-1e4cf6a70a55.jsonl`

**Related architectural decision:** captured separately in `docs/decisions.md` (slug TBD via `/log decision`).
