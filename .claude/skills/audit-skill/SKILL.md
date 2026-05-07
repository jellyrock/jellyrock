---
name: audit-skill
description: Audit a specific skill's recent execution against the current Claude Code session transcript. Runs the mechanical extractor at .claude/skills/audit-skill/extract-friction.cjs which produces JSON findings (repeated-command, failed-recovery, confusion-marker, lint-spam, changelog-edit-attempt, tasks-leakage, test-claim-without-evidence, hardware-claim-mismatch) plus a model-fit profile. The skill prose then classifies findings, proposes concrete edits to the audited skill's SKILL.md or supporting infra, and assesses whether the skill's `model:` setting still fits the actual reasoning load. Use after a session that revealed friction in a specific skill, or when a skill's `model:` feels miscalibrated.
model: opus
---

# /audit-skill — extract → classify → recommend → apply

Meta-skill that audits another skill's actual execution. Reads the JSONL session transcript at `~/.claude/projects/<sanitized-cwd>/<session>.jsonl` (the dir is auto-derived from the current working directory; override with `--transcripts-dir`), runs the mechanical detectors at [`extract-friction.cjs`](extract-friction.cjs), classifies the findings with judgment, and proposes concrete edits to the audited skill's SKILL.md or supporting infra.

The load-bearing trick: when proposing fixes, **name the anti-pattern explicitly** in the SKILL.md callout so future agents recognize the failure shape and skip directly to the right approach. Generic "be careful here" wording isn't enough — call out the specific bash invocation pattern, the specific phrasing, the specific tool sequence that failed.

## Inputs

`$ARGUMENTS`: required skill name (e.g., `pr`, `log`, `catchup`, `runtime-triage`). Optional `--session <id>` after the skill name to override the default-most-recent transcript.

## Step 1 — Locate the transcript

If `$ARGUMENTS` includes `--session <id>`, use that. Otherwise the helper auto-picks the most-recent transcript that contains the named skill (by mtime). If multiple recent transcripts contain the skill and they look like distinct work streams, list them and confirm with the user before proceeding (a stale session is rarely the right one to audit).

## Step 2 — Run the extraction helper

The helper does mechanical work only — pattern matching over the JSONL, JSON output. Don't try to interpret the raw output yet; just confirm it parsed cleanly.

```bash
node .claude/skills/audit-skill/extract-friction.cjs <skill> [--session <id>]
```

Exit codes: `0` = findings produced (zero is valid; means clean run), `1` = parse error (malformed JSONL line; stderr names the file + line), `2` = bad inputs (transcript not found, skill never invoked in any transcript). On exit 2 report no transcript found and stop. On exit 1 surface the parse error — likely a corrupt transcript line; check by grepping the failing line number from stderr.

## Step 3 — Classify findings

Read the JSON. For each finding, decide: real friction worth fixing → keep; noise (e.g., a confusion-marker that's legitimate questioning, not actual confusion) → drop; duplicate of another finding (multiple symptoms of one root cause) → merge. Group by **root cause**, not by category. Each root cause gets a one-paragraph diagnosis.

For confusion-marker clusters: the helper flags by regex; you decide if surrounding context shows actual agent floundering or normal narration. Heuristic: "would adding text to the SKILL.md have prevented this turn?" If yes, keep; if no, drop.

For repeated-command and failed-recovery: the helper finds shape matches; you decide if the SKILL.md could have shortcut the dead end.

For lint-spam, changelog-edit-attempt, tasks-leakage, test-claim-without-evidence, hardware-claim-mismatch: each maps to a specific load-bearing rule in [`/CLAUDE.md`](../../../CLAUDE.md). The finding's `ruleViolated.anchor` field names which rule. These are usually high-confidence — the rule was violated; the question is *why* (was the SKILL.md missing a clear callout? was the rule unclear? did the agent have to re-derive the rule from context?).

## Step 4 — Propose edits

For each retained root cause, write a concrete fix proposal targeting ONE of:

- **The audited skill's SKILL.md** (most common — add a callout, rename a step, name an anti-pattern explicitly).
- **A new helper script** under `.claude/skills/<name>/` (allowlist the new bash shape in `.claude/settings.json` in the same change set per [`.claude/skills/CLAUDE.md`](../CLAUDE.md)'s "When you change a skill" section).
- **`.claude/settings.json`** — a new allowlist entry that removes a permission prompt friction.
- **Root [`/CLAUDE.md`](../../../CLAUDE.md) or an area-scoped CLAUDE.md** (only if friction reflects a missing rule, not a missing skill detail).

Format each proposal as: **Root cause** (one sentence); **Target** (file path + anchor); **Diff** (exact before/after, not pseudocode — the same content you'd pass to `Edit`); **Rationale** (why this prevents recurrence; **name the anti-pattern explicitly** so future agents recognize it); **Verification** (how to confirm the fix lands — usually `grep -n` for the new wording, or running the audited skill against a freshly-paired transcript).

### Step 4b — Model-fit assessment

Read the `modelFit` block from the helper's output. The profile reports sub-agent invocations, TodoWrite use, AskUserQuestion use, total assistant-text length, distinct edited files, confusion clusters, and failed-recoveries — all mechanical signals about the reasoning load the audited skill actually encountered. Compare to the audited skill's current `model:` frontmatter setting:

- **Profile shows verbose reasoning + sub-agents + judgment-tool use (TodoWrite, AskUserQuestion)** → opus or sonnet are appropriate. If the current setting is haiku, propose **upgrade**.
- **Profile is "clean mechanical run" with high tool-to-text ratio and zero sub-agent / TodoWrite / AskUserQuestion calls** → the work is procedural. If the current setting is opus, propose **downgrade** to sonnet (or haiku if the workflow is purely mechanical with no judgment seams). Cheaper + faster with no quality loss.
- **Profile shows confusion clusters + failed-recoveries** → the model may be struggling. If the current setting is haiku or sonnet, propose **upgrade-candidate** flag. (Could also be a SKILL.md problem, not a model problem — surface both possibilities.)

A single audit is a weak signal. Recommend a model change only when the profile is unambiguous; otherwise note it as a "watch" for the next audit. Format as a separate "Model fit" block in the proposal output: `**Model fit**: current model: <X>. Profile: <one-line summary>. Recommendation: keep | downgrade to <Y> | upgrade to <Y> | watch (with reason).`

Surface ALL proposals at once (friction fixes + model-fit), ranked by severity. Don't apply yet.

## Step 5 — Apply approved edits

After the user marks each proposal `apply` / `defer` / `drop`, apply approved ones via `Edit`. Keep one diff per Edit call (don't batch unrelated changes). For new helper scripts, also add the corresponding allowlist line to `.claude/settings.json` in the same change set. For model-fit changes, edit the audited skill's frontmatter `model:` line.

## Step 6 — Capture the audit conclusion

Two-tier so the architectural-decision log doesn't get diluted with routine wording fixes.

### 6a — Always: append to the audited skill's AUDIT-LOG.md

Every audit (regardless of size) gets one section in `.claude/skills/<audited-skill>/AUDIT-LOG.md` (create the file if absent — first audit of the skill). Format:

```markdown
## YYYY-MM-DD — <one-line summary> (session <short-id>)

**Friction surfaced:** <comma-list of categories with counts; e.g., 2 lint-spam, 1 confusion cluster, 1 test-claim-without-evidence>.

**Model fit:** current `model: <X>` — <keep | downgrade to Y | upgrade to Y | watch>. Reason: <one line>.

**Fixes applied:**
- <one-line per applied fix; reference the file:anchor changed>

**Deferred / dropped:** <one-line per item, with brief reason>

**Source transcript:** `~/.claude/projects/.../<session>.jsonl`
```

This stays out of [`docs/decisions.md`](../../../docs/decisions.md). Future agents reading the audited skill can grep `.claude/skills/<name>/AUDIT-LOG.md` for the running history without diluting the architectural-decision log.

### 6b — Conditionally: invoke /log decision for architectural-grade audits

Only when the audit produces ONE of: a NEW helper script under `.claude/skills/<name>/`; a model change on the audited skill (opus ↔ sonnet ↔ haiku); skill retired entirely; a new `.claude/hooks/*.sh` hook; a change to a load-bearing rule in [`/CLAUDE.md`](../../../CLAUDE.md) or an area-scoped CLAUDE.md. Routine wording fixes, anti-pattern callouts, allowlist-only additions, and model-fit "watch" notes do NOT trigger `/log decision` — they live only in the per-skill AUDIT-LOG.md. When triggered, invoke `/log decision` with slug like `audit-of-<skill>-<one-line-architectural-fix>`.

## Step 7 — Don't auto-commit

This skill drafts proposals + applies approved edits, but does NOT commit. The user owns the actual git commit (typically alongside any code change that motivated the audit). When the user asks for a commit, follow the JellyRock conventional-commit style (`type(scope): subject`), no `Co-Authored-By` footer.

## Detector reference

| Category | What it flags | Maps to rule in CLAUDE.md |
|---|---|---|
| `repeated-command` | Same Bash command in two consecutive tool_use calls | — (friction signal) |
| `failed-recovery` | is_error: true tool_result followed within 3 turns by a meaningfully-similar command | — (friction signal) |
| `confusion-marker` | Cluster of ≥3 self-narration markers ("let me check", "hmm", "wait,", etc.) in a 10-turn window | — (friction signal) |
| `lint-spam` | ≥2 lint/validate/build/format invocations within a 10-turn window without a failure between them | "Don't compulsively re-run lint / build / format mid-work" |
| `changelog-edit-attempt` | Edit/Write/MultiEdit on `CHANGELOG.md` | "Cannot modify `CHANGELOG.md` — CI-controlled" |
| `tasks-leakage` | `tasks/<path>` substring inside a `git commit` body, `gh pr create` body, or `gh issue create` body | "Don't reference `tasks/` paths in shared artifacts" |
| `test-claim-without-evidence` | Assistant text claims tested/verified but no `npm run test:*` Bash call appears in the invocation range | "Run tests to verify fixes — don't commit based on reasoning alone" |
| `hardware-claim-mismatch` | Assistant claims tested but the most-recent `npm run test:*` invocation failed (is_error: true) without a follow-up successful run | "When hardware isn't reachable, say so explicitly" |

## When NOT to use this skill

- **Clean session.** Skill ran, produced expected outcome, no friction noticed. Audit will pattern-match noise.
- **Recently audited.** Same skill audited within ~7 days on a different session. Wait for new friction.
- **Brand-new skill.** ≤2 invocations total. Auditing first uses hardens against normal stumbling, not real friction patterns.
- **Transient infra cause.** Friction was a network blip, hardware not reachable, debugger contention — fixing the skill won't help.
- **Cross-skill chaos.** Session bounced between five skills in a confused way. Fix the workflow / `/catchup` / `/issue-triage` first; per-skill audit is the wrong granularity.

## Sub-agent invocation

To invoke from a sub-agent: parent passes `Read .claude/skills/audit-skill/SKILL.md and follow the steps for $ARGUMENTS=<skill-name>; surface findings + edit proposals; do NOT apply edits` in the Task prompt. Sub-agents shouldn't apply — they surface, the user decides.
