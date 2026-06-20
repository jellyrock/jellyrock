# audit-skill — audit log

Running history of audits against `/audit-skill` itself (meta-audits) and feedback that prompted scope changes. See [`SKILL.md`](SKILL.md) Step 6a for the per-audit entry template.

## 2026-05-08 — broaden audit beyond friction-only signals (session 196269d8)

Triggered by user feedback during a `/audit-skill pr` invocation: *"these audits are shit and need fixed. the mechanical audit is to automatically detect friction but friction is not the only goal. we're also concerned with skill output accuracy, skill clock time, skill token usage, skill permissions for non-destructive stuff (dont prompt the user to run scripts in our repo. trust our own repo files)."* The `/pr` audit ran clean by friction (0 findings) but left two gaps unsurfaced — performance signals (the run took 13m 56s and cost ~$1.00) and permission-gap detection (no detector existed).

**Friction surfaced:** none on the audited `/pr` invocation. The friction-only framing was itself the bug.

**Performance:** `/pr` invocation — 13m 56s, 17984 output tokens, 0.89 cache hit, ~$1.0051 (sonnet). No anomalies — within expected envelope for a judgment-bearing skill, but pre-fix the audit had no way to *say* so.

**Permission gaps:** none on `/pr` (existing `Bash(node .claude/skills/*)` covers the extractor invocation). Detector exists now to catch future cases.

**Output accuracy (eyeball):** `/pr` skill output was accepted on first try; the meta-feedback was about audit-skill's narrow scope, not pr's output.

**Model fit:** audit-skill keeps `model: opus`. Confirmed appropriate — this audit required architectural judgment (extending the extractor's scope, deciding what NOT to mechanize like accuracy).

**Fixes applied:**
- [extract-friction.cjs](extract-friction.cjs) — added `buildPerformance` (clock time, per-model token tally, cache-hit ratio, cost estimate against a versioned PRICING table) and `detectPermissionGap` (cross-references Bash invocations with `.claude/settings.json` + `.claude/settings.local.json` allow lists; flags repo-internal scripts that fall outside; emits suggested allowlist line)
- [SKILL.md](SKILL.md) — frontmatter description rewritten to advertise four-dimension scope; new Step 3b (read `performance` block), Step 3c (read `permission-gap` findings), Step 3d (judge output accuracy by eyeball — explicitly NOT mechanized); detector reference table extended; "When NOT to use" tightened from "clean session" to "clean across all four dimensions"; Step 4 surface line and Step 6a AUDIT-LOG template extended to cover the new dimensions

**Deferred / dropped:**
- Output-accuracy detector — dropped intentionally. No clean mechanical proxy exists; user-correction heuristics are too noisy. SKILL.md Step 3d makes the judgment seam explicit instead.
- `/log decision` — deferred per user (this is per-skill audit-log only; not architectural-grade by Step 6b's bar despite being scope-broadening, since no new helper script / model change / hook / load-bearing-rule change occurred).

**Source transcript:** `~/.claude/projects/<project>/<session>.jsonl` (the meta-audit transcript itself)
