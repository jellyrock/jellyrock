---
name: audit-skill
description: Audit a specific skill's recent execution against the current Claude Code session transcript. Runs the mechanical extractor at .claude/skills/audit-skill/extract-friction.cjs which produces JSON across four dimensions — friction findings (repeated-command, failed-recovery, confusion-marker, lint-spam, changelog-edit-attempt, tasks-leakage, test-claim-without-evidence, hardware-claim-mismatch, permission-gap), performance (clock time, token usage per model, cache-hit ratio, cost estimate), model-fit profile, and the auditor's judgment of output accuracy (the only dimension the extractor cannot mechanize). The skill prose classifies findings, weighs perf anomalies, proposes concrete edits to the audited skill's SKILL.md or supporting infra, and assesses whether the skill's `model:` setting still fits. Use after any non-trivial skill invocation — friction-clean runs can still be slow, token-bloated, or trigger permission prompts that should be allowlisted.
model: opus
effort: low
---

# /audit-skill — extract → classify → recommend → apply

## Contract

**Goal.** A meta-skill that audits another skill's *actual execution* from its Claude Code session transcript(s). It runs the mechanical extractor at [`extract-friction.cjs`](extract-friction.cjs) over the JSONL, evaluating the run against the skill-evaluation dimensions defined in [`skill-evaluation.md`](skill-evaluation.md) — the behavioral / action-trace, friction findings, performance, model-fit profile, and the one dimension no extractor mechanizes (output-accuracy judgment) — then classifies the findings with judgment, weighs perf anomalies, proposes concrete edits to the audited skill's SKILL.md or supporting infra, and assesses whether the skill's `model:` setting still fits. By default it audits the most-recent session (the natural post-run check); `--last N` / `--all` scan the skill's recent history and add a **cross-session rollup** (median/p90 timing, total cost, and a recurring-friction tally — a category seen across ≥2 sessions is a real pattern, not a one-off) so a model-fit or drift call rests on many sessions instead of a single weak sample. The load-bearing trick is to **name the anti-pattern explicitly** in any proposed callout so future agents recognize the failure shape and skip to the right approach — generic "be careful" wording isn't enough. Recommended after any non-trivial skill invocation, and periodically with `--all` for a strong model-fit/drift call. Ships at the **opus** tier because the classification, accuracy judgment, and model-fit calls are judgment-heavy (the extraction is mechanical and pushed down to the helper).

**Inputs.** `$ARGUMENTS`: a required skill name (e.g. `pr`, `log`, `catchup`, `runtime-triage`), optionally followed by a selection flag — `--last N` (scan the N most-recent sessions containing the skill), `--all` (every session), or `--session <id>` (one specific session); default is the single most-recent session. `--invocation latest|all` controls, per session, which invocation range(s) to read. Expects the JSONL transcripts reachable under `~/.claude/projects/<sanitized-cwd>/`, the extractor present, and (for model-fit + reconciliation context) the audited skill's prior `AUDIT-LOG.md` if any.

**Outputs.**

- The mechanical extraction JSON — per-session `behavioralTrace` / `performance` / `modelFit` / `findings` blocks (each tagged with its `session`), plus a cross-session `aggregate` rollup when more than one invocation is scanned (`null` for a single-session run). The `behavioralTrace` block carries the run's ordered action-trace, per-path file-touch summary, and tool/bash-verb histograms (dimension 1). Each `invocations` entry also carries an over-capture diagnostic (`fullSpan` vs the bounded core span, `firstDownstreamMutation`, `overCaptureSuspected`) for skills that declare `audit-span: read-only` — see Step 3b.
- A classified, root-cause-grouped set of findings — noise dropped, duplicates merged; for multi-session runs, recurring patterns (≥2 sessions) prioritized over one-offs.
- Concrete edit proposals targeting one of: the audited skill's SKILL.md, a new helper script + its allowlist line, `.claude/settings.json`, or a CLAUDE.md rule — each with root cause / target / exact diff / rationale / verification, ranked by severity and surfaced before applying.
- A model-fit recommendation (`keep | downgrade to Y | upgrade to Y | watch`), strengthened by the rollup when run with `--last N`/`--all`.
- Applied approved edits (one diff per Edit call).
- An `AUDIT-LOG.md` section appended to the audited skill (always); an ADR only when an architectural trigger fires.
- **No commit** — the skill drafts + applies; the user owns the git commit.

**Success criteria.**

- Every retained finding is grouped by root cause and carries a concrete fix that **names the anti-pattern explicitly**.
- The `performance` block is inspected even when `findings` is empty — perf anomalies are findings too.
- Each `permission-gap` becomes a `.claude/settings.json` allowlist proposal for a project-owned script.
- Output accuracy is judged by the auditor (the dimension the extractor cannot mechanize).
- Model-fit is assessed against the actual reasoning-load profile and recommended only when the signal is unambiguous; otherwise flagged `watch`.
- The audited skill's `AUDIT-LOG.md` is updated; an ADR is written only when an architectural trigger fires.
- The skill never auto-commits.

**Failure modes to avoid.**

- **Skipping an auditable first run because it's "too new."** Run-count gates *only* the cross-session rollup + a confident model-fit re-pin — never whether to audit. A first run with friction / a perf anomaly / a permission-gap / a thrashy trace / wrong output is auditable; the skip condition is signal-*absence* (a clean run), not run-count.
- **Auditing a genuinely clean run** (no friction + normal perf + no permission-gap + sane trace + correct output) — the audit pattern-matches noise. A friction-clean run *with* a perf anomaly or permission-gap is still worth it.
- **Treating the raw extractor output as findings.** The detectors are recall-tuned; a grep'd string is not an invocation. Confirm each before keeping it.
- **Skipping the performance block when `findings` is empty.** The audit isn't complete until `performance` is inspected.
- **Recommending a model change off a single weak signal.** A lone audit is weak evidence — note `watch` for the next audit unless the profile is unambiguous.
- **Generic "be careful" callouts.** Name the specific bash invocation, phrasing, or tool sequence that failed, so the fix prevents recurrence.
- **Applying edits before the user marks each `apply`/`defer`/`drop`.** Surface all proposals first.
- **Trusting an over-captured span at face value.** `attributionSkill` is sticky (it stays set on every autonomous turn until the agent yields to a human or another skill runs), so a read-only load skill (resume-project, catchup) can "own" a whole downstream working session. When an invocation is `overCaptureSuspected`, treat its perf/cost as session-level (not skill-level) and re-confirm each rule-violation against its actual turn — the violation likely belongs to the downstream work, not the audited skill. **The same sticky-attribution effect hits non-read-only wrap-up skills (e.g. `end-session`), more mildly:** edits the agent makes just before the skill's own commit get swept into its span (content edits the agent made as part of the session, committed by the wrap-up skill, can be misattributed to it). These skills can't be auto-bounded (their first mutation IS their job), so `overCaptureSuspected` won't fire — always confirm each rule-violation against its actual turn before keeping it.
- **Auto-committing.** The skill drafts + applies approved edits; the user owns the commit.

**When NOT to use.**

- **A run clean across every dimension** — no friction AND normal performance AND no permission-gaps AND a sane behavioral trace AND correct output. Auditing such a run pattern-matches noise. **This is the only run-count-independent skip: the trigger is signal-*absence*, not "too few runs."** A *first* run that shows friction, a perf anomaly, a permission-gap, a thrashy/wrong-scope trace, or a wrong output **is** auditable — single-run signal (dimensions 1–4 of [`skill-evaluation.md`](skill-evaluation.md)) surfaces on run 1. What a small sample withholds is **only** the cross-session rollup and a *confident* model-fit re-pin; on few runs you still audit, you just flag model-fit `watch` instead of re-pinning (Step 4b).
- **Recently audited** — same skill within ~7 days on a different session with no new findings or perf anomalies. Wait for new evidence.
- **Transient infra cause** — a network blip, hardware unreachable, debugger contention. Fixing the skill won't help (unless the skill *should* have detected and acknowledged the infra failure — then it's a finding).
- **Cross-skill chaos** — the session bounced between several skills confusedly. Fix the workflow first; per-skill audit is the wrong granularity.
- **Auditing host/server health** (not a skill's execution) → that's a different audit, not this one.

## Implementation

Meta-skill that audits another skill's actual execution. Reads the JSONL session transcript at `~/.claude/projects/<sanitized-cwd>/<session>.jsonl` (the dir is auto-derived from the current working directory; override with `--transcripts-dir`), runs the mechanical detectors at [`extract-friction.cjs`](extract-friction.cjs), classifies the findings with judgment, and proposes concrete edits to the audited skill's SKILL.md or supporting infra. The load-bearing trick: when proposing fixes, **name the anti-pattern explicitly** in the SKILL.md callout so future agents recognize the failure shape and skip directly to the right approach — call out the specific bash invocation pattern, the specific phrasing, the specific tool sequence that failed.

### Inputs

`$ARGUMENTS`: required skill name (e.g., `pr`, `log`, `catchup`, `runtime-triage`). Optional `--session <id>` after the skill name to override the default-most-recent transcript.

### Step 1 — Locate the transcript

If `$ARGUMENTS` includes `--session <id>`, use that. Otherwise the helper auto-picks the most-recent transcript that contains the named skill (by mtime). If multiple recent transcripts contain the skill and they look like distinct work streams, list them and confirm with the user before proceeding (a stale session is rarely the right one to audit).

### Step 2 — Run the extraction helper

The helper does mechanical work only — pattern matching over the JSONL, JSON output. Don't try to interpret the raw output yet; just confirm it parsed cleanly.

```bash
node .claude/skills/audit-skill/extract-friction.cjs <skill> [--session <id>]
```

Exit codes: `0` = findings produced (zero is valid; means clean run), `1` = parse error (malformed JSONL line; stderr names the file + line), `2` = bad inputs (transcript not found, skill never invoked in any transcript). On exit 2 report no transcript found and stop. On exit 1 surface the parse error — likely a corrupt transcript line; check by grepping the failing line number from stderr.

### Step 3 — Classify findings

Read the JSON. For each finding, decide: real friction worth fixing → keep; noise (e.g., a confusion-marker that's legitimate questioning, not actual confusion) → drop; duplicate of another finding (multiple symptoms of one root cause) → merge. Group by **root cause**, not by category. Each root cause gets a one-paragraph diagnosis.

For confusion-marker clusters: the helper flags by regex; you decide if surrounding context shows actual agent floundering or normal narration. Heuristic: "would adding text to the SKILL.md have prevented this turn?" If yes, keep; if no, drop.

For repeated-command and failed-recovery: the helper finds shape matches; you decide if the SKILL.md could have shortcut the dead end.

For lint-spam, changelog-edit-attempt, tasks-leakage, test-claim-without-evidence, hardware-claim-mismatch, permission-gap: each maps to a specific load-bearing rule in [`/CLAUDE.md`](../../../CLAUDE.md) or [`.claude/skills/CLAUDE.md`](../CLAUDE.md). The finding's `ruleViolated.anchor` field names which rule. These are usually high-confidence — the rule was violated; the question is *why* (was the SKILL.md missing a clear callout? was the rule unclear? did the agent have to re-derive the rule from context?). For `permission-gap` specifically, the fix is mechanical — the suggested allowlist line goes straight into [`.claude/settings.json`](../../settings.json); no judgment required beyond confirming the script really is project-owned and non-destructive.

#### Step 3b — Read the `performance` block

Even if `findings` is empty, the audit isn't complete until you've inspected `performance`. Look for anomalies relative to what the skill is supposed to do:

- **`durationSec` / `durationHuman`** — does the wall-clock time fit the skill's purpose? A `/log` invocation taking 5+ minutes is suspicious; a `/runtime-triage` taking 2 minutes is suspiciously fast (probably skipped investigation). Compare to past runs of the same skill if available; flag clear outliers.
- **`totalOutputTokens` / `avgOutputTokensPerTurn`** — large output token counts on procedural skills suggest the SKILL.md is letting the agent over-explain. Mechanical skills should average <500 output tokens/turn; judgment skills can run higher.
- **`cacheHitRatio`** — below 0.5 means the conversation kept invalidating the prompt cache (lots of file reads or context shifts). Often a sign the skill is reading too many files or re-reading the same files. Above 0.9 is healthy.
- **`costEstimateUSD`** — orient on actual spend. A `/pr` run costing $1 is reasonable; a `/log` run costing $1 is broken. Use this to triage which skills to audit next.
- **`perModel`** — confirms the skill's frontmatter `model:` is what actually ran (sub-agents may run on a different model; that's fine, but worth noting).

Anomalies that don't tie to a friction finding still belong in Step 4 as proposals — typically SKILL.md changes that tighten the workflow (fewer file reads, sharper output instructions, narrower scope).

#### Step 3c — Read the `permission-gap` findings

These are mechanical: each gap is a Bash invocation against a repo-internal script that fell outside the allowlist. Every gap becomes a `.claude/settings.json` proposal in Step 4 — paste the `suggestedFix.allowlistLine` value into `permissions.allow`. No judgment beyond confirming the target script is project-owned and non-destructive (it should be, by definition of `repoTarget`). Trust your own repo files; don't make future agents re-confirm permission for them.

#### Step 3d — Judge output accuracy yourself

The extractor cannot mechanize accuracy. Open the audited skill's actual user-visible output for the audited invocation (read the relevant assistant turns near `endLine` from the JSONL, or recall from session memory if you ran the skill in the same session). Ask: did the skill produce the right artifact? Did it follow the SKILL.md's stated steps? Did the user accept the output, or push back / rerun / clarify? If the output was wrong or required correction, that's a finding too — typically a SKILL.md instruction that was ambiguous, or a step that should be guarded (e.g., "verify X before producing Y"). Add it to Step 4 as a judgment-required proposal.

### Step 4 — Propose edits

For each retained root cause, write a concrete fix proposal targeting ONE of:

- **The audited skill's SKILL.md** (most common — add a callout, rename a step, name an anti-pattern explicitly).
- **A new helper script** under `.claude/skills/<name>/` (allowlist the new bash shape in `.claude/settings.json` in the same change set per [`.claude/skills/CLAUDE.md`](../CLAUDE.md)'s "When you change a skill" section).
- **`.claude/settings.json`** — a new allowlist entry that removes a permission prompt friction.
- **Root [`/CLAUDE.md`](../../../CLAUDE.md) or an area-scoped CLAUDE.md** (only if friction reflects a missing rule, not a missing skill detail).

Format each proposal as: **Root cause** (one sentence); **Target** (file path + anchor); **Diff** (exact before/after, not pseudocode — the same content you'd pass to `Edit`); **Rationale** (why this prevents recurrence; **name the anti-pattern explicitly** so future agents recognize it); **Verification** (how to confirm the fix lands — usually `grep -n` for the new wording, or running the audited skill against a freshly-paired transcript).

#### Step 4b — Model-fit assessment

Read the `modelFit` block from the helper's output. The profile reports sub-agent invocations, TodoWrite use, AskUserQuestion use, total assistant-text length, distinct edited files, confusion clusters, and failed-recoveries — all mechanical signals about the reasoning load the audited skill actually encountered. Compare to the audited skill's current `model:` frontmatter setting:

- **Profile shows verbose reasoning + sub-agents + judgment-tool use (TodoWrite, AskUserQuestion)** → opus or sonnet are appropriate. If the current setting is haiku, propose **upgrade**.
- **Profile is "clean mechanical run" with high tool-to-text ratio and zero sub-agent / TodoWrite / AskUserQuestion calls** → the work is procedural. If the current setting is opus, propose **downgrade** to sonnet (or haiku if the workflow is purely mechanical with no judgment seams). Cheaper + faster with no quality loss.
- **Profile shows confusion clusters + failed-recoveries** → the model may be struggling. If the current setting is haiku or sonnet, propose **upgrade-candidate** flag. (Could also be a SKILL.md problem, not a model problem — surface both possibilities.)

A single audit is a weak signal. Recommend a model change only when the profile is unambiguous; otherwise note it as a "watch" for the next audit. Format as a separate "Model fit" block in the proposal output: `**Model fit**: current model: <X>. Profile: <one-line summary>. Recommendation: keep | downgrade to <Y> | upgrade to <Y> | watch (with reason).`

Surface ALL proposals at once (friction fixes + perf-anomaly fixes + permission-gap allowlist additions + accuracy-eyeball findings + model-fit), ranked by severity. Don't apply yet.

### Step 5 — Apply approved edits

After the user marks each proposal `apply` / `defer` / `drop`, apply approved ones via `Edit`. Keep one diff per Edit call (don't batch unrelated changes). For new helper scripts, also add the corresponding allowlist line to `.claude/settings.json` in the same change set. For model-fit changes, edit the audited skill's frontmatter `model:` line.

### Step 6 — Capture the audit conclusion

Two-tier so the architectural-decision log doesn't get diluted with routine wording fixes.

#### 6a — Always: append to the audited skill's AUDIT-LOG.md

Every audit (regardless of size) gets one section in `.claude/skills/<audited-skill>/AUDIT-LOG.md` (create the file if absent — first audit of the skill). Format:

```markdown
## YYYY-MM-DD — <one-line summary> (session <short-id>)

**Friction surfaced:** <comma-list of categories with counts; e.g., 2 lint-spam, 1 confusion cluster, 1 test-claim-without-evidence>. None? say "none".

**Performance:** <durationHuman>, <totalOutputTokens> output tokens, <cacheHitRatio> cache hit, ~$<costEstimateUSD>. Anomalies: <one line, or "none">.

**Permission gaps:** <count, with allowlist lines proposed/applied; or "none">.

**Output accuracy (eyeball):** <one line — accepted on first try / required correction X / regenerated N times / etc.>

**Model fit:** current `model: <X>` — <keep | downgrade to Y | upgrade to Y | watch>. Reason: <one line>.

**Fixes applied:**
- <one-line per applied fix; reference the file:anchor changed>

**Deferred / dropped:** <one-line per item, with brief reason>

**Source transcript:** `~/.claude/projects/.../<session>.jsonl`
```

This stays out of the formal decision record ([`docs/adr/`](../../../docs/adr/README.md) for ADR-grade, [`docs/decisions.md`](../../../docs/decisions.md) for sub-ADR notes). Future agents reading the audited skill can grep `.claude/skills/<name>/AUDIT-LOG.md` for the running history without diluting that record.

#### 6b — Conditionally: invoke /log decision for architectural-grade audits

Only when the audit produces ONE of: a NEW helper script under `.claude/skills/<name>/`; a model change on the audited skill (opus ↔ sonnet ↔ haiku); skill retired entirely; a new `.claude/hooks/*.sh` hook; a change to a load-bearing rule in [`/CLAUDE.md`](../../../CLAUDE.md) or an area-scoped CLAUDE.md. Routine wording fixes, anti-pattern callouts, allowlist-only additions, and model-fit "watch" notes do NOT trigger `/log decision` — they live only in the per-skill AUDIT-LOG.md. When triggered, invoke `/log decision` with slug like `audit-of-<skill>-<one-line-architectural-fix>`.

### Step 7 — Don't auto-commit

This skill drafts proposals + applies approved edits, but does NOT commit. The user owns the actual git commit (typically alongside any code change that motivated the audit). When the user asks for a commit, follow the JellyRock conventional-commit style (`type(scope): subject`), no `Co-Authored-By` footer.

### Detector reference

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
| `permission-gap` | Bash invocation against a repo-internal script (`scripts/`, `.claude/`, `tests/`, `source/`, `components/`, `locale/`) that isn't covered by `.claude/settings.json`'s allow list | `.claude/skills/CLAUDE.md` "When you change a skill" — trust our own repo files |

## Sub-agent invocation

To invoke from a sub-agent: parent passes `Read .claude/skills/audit-skill/SKILL.md and follow the steps for $ARGUMENTS=<skill-name>; surface findings + edit proposals; do NOT apply edits` in the Task prompt. Sub-agents shouldn't apply — they surface, the user decides.
