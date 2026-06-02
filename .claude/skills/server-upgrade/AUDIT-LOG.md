# server-upgrade — audit log

Running history of `/audit-skill server-upgrade` runs. Newest first. Architectural-grade conclusions also live in `docs/decisions.md`; routine notes stay here.

## 2026-06-02 — Step 2.8's own example was the counterexample: genuine-removal ≠ behavior-change (session 3f597901)

First run to actually exercise the freshly-added Step 2.8 `renameCandidates` guidance on a real removal (`10.11.10 → master`, pre-release path). The mechanical extraction was clean (0 friction), but dimension-4 surfaced a real guidance flaw — **the skill's canonical "genuine removal → replicate client-side" example is itself a no-op removal that should be `skip`ped.**

**Friction surfaced:** none. 0 findings across all detectors (14 bash calls, 0 repeated-command / failed-recovery / confusion / test-claim / permission-gap).

**Performance:** 16m 34s, 55,872 output tokens (~1,016/turn), 0.91 cache hit, ~$14.64. Anomalies: cost is high but driven by 3.06M *inherited* cache-read tokens (ran mid-large-session, not a fresh load) — not a skill defect. Wall-clock inflated by ~8 rate-limited `gh api` upstream reads, which earned their keep (they flipped the verdict — see below).

**Permission gaps:** none — all `node scripts/...`, `gh api`, `grep`, `mktemp`/`rm`/`date`/`ls` calls allowlist-covered.

**Output accuracy (eyeball):** accepted first try. Correctly took the pre-release path (`master` → datestamp `20260531151854`, relayed), investigated all 6 candidates against cited sites, made zero `gh issue` calls, named the handoff by resolved datestamp, cleaned temps. **Caught a guidance gap the prior audit (below) missed:** that audit concluded `disableFirstEpisode` was a "genuine removal" and stopped; this run read the FROM-tag controller and found it was already `[ParameterObsolete]` + unwired into `NextUpQuery` in `v10.11.10` → master deletes a dead param → **`skip`**, not "replicate client-side." The upstream read is what distinguished real break from dead-code cleanup.

**Model fit:** current `model: opus` — keep. Profile: `judgmentRequired: true`, 4 TodoWrite, verbose reasoning (5,447 chars), 0 confusion/failed-recovery, 0 sub-agent/AskUserQuestion (AskUserQuestion absent because this was the pre-release path; that gate is Step 4, stable-only). Genuine non-mechanizable judgment, incl. the upstream-source-reading path the prior audit only watched.

**Fixes applied:**
- `SKILL.md:101` (Step 2.8) — rewrote the empty-`renameCandidates` bullet to name the anti-pattern explicitly ("empty `renameCandidates` → behavior changed → replicate client-side, without checking the baseline") and add the cheap FROM-version honoring-check (`gh api .../contents/<path>?ref=v<from>`). Replaced the now-wrong `disableFirstEpisode` canonical example with the same example correctly resolved as the *trap* (`[ParameterObsolete]` + unwired → `skip`).

**Deferred / dropped:** cost-pricing gap is now resolved (extractor priced `claude-opus-4-8` this run, `pricingVerifiedDate: 2026-06-02`). High inherited-context cost is intrinsic to running mid-session, not actionable on `server-upgrade`.

**Source transcript:** `~/.claude/projects/-home-charlie-PROJECTS-JellyRock-jellyrock2/3f597901-8891-4474-95cd-3458271a3d6f.jsonl`

## 2026-06-02 — Meta-audit (second pass): the audit under-called dimension 4

Reviewed the run **and** the audit below. The mechanical extraction was right (0 friction — no repeated commands / failed recoveries), and the plumbing fixes from `7ae44e64` (mktemp / fresh `$VERDICTS` / `--stdout`-drop / Read-tool / datestamp handoff) all held end-to-end. **But the audit's dimension-4 (output accuracy) was a rubber-stamp** — it recited what the run did without reading the verdict content, so it missed two real issues:

1. **Investigation depth regressed on the one filed finding.** The run's `DisableFirstEpisode` `draftIssueBody` shipped a hedge — *"confirm whether renamed or genuinely dropped"* — because it never checked upstream. Verified here: the `<to>` spec removes `disableFirstEpisode` and **adds nothing** → genuine removal, not a rename. A spec diff alone can't distinguish the two; the skill had no edge case telling the agent to resolve it. An earlier run (different session) *did* dig into `jellyfin/jellyfin` source and got it right — so depth was luck-of-the-draw.
2. **Pre-release `draftIssueBody` is wasted work.** On the pre-release path the verdict file is `rm`'d; a full issue body there is discarded, and only the handoff survives.

**Fixes applied (this pass):**
- Step 2: new edge case **#8 "Removal vs rename — resolve it, don't hedge"** — for any `*-removed` finding, scan the `<to>` spec for a same-role addition + (when it matters) confirm against the upstream Jellyfin controller/model via `gh api`; rename → map behind dispatch, genuine removal → replicate/handle. A "confirm whether renamed or dropped" `draftIssueBody` is now explicitly *unfinished*.
- Step 0a.4: pre-release `file` verdicts skip the heavy `draftIssueBody`; fix direction goes straight into the handoff worklist.

**Deferred:** the cost-pricing gap (below) is real and still belongs to the auditor's own `extract-friction.cjs`, not `server-upgrade`.

**Lesson for the auditor:** a clean *mechanical* extraction is not a clean *audit*. Dimension 4 requires actually reading the emitted verdicts/`draftIssueBody`, not just confirming the run completed without retries.

## 2026-06-01 — Clean pre-release run; keep opus (session a1375d0d)

**Friction surfaced:** none. 0 findings across all detectors (8 bash calls, 0 repeated-command / failed-recovery / confusion / test-claim / permission-gap).

**Performance:** 9m 54s, 33,465 output tokens (~1,239/turn), 0.89 cache hit, ~$unknown (extractor could not price `claude-opus-4-8` — its pricing table is verified to 2026-05-08, older than the model; 1.34M tokens uncosted). Anomalies: none for a judgment skill on the pre-release path. The cost-pricing gap is an `extract-friction.cjs` staleness issue, not a server-upgrade issue.

**Permission gaps:** none — all `node scripts/...` / `node .claude/skills/...` / `mktemp` / `rm` / `date` calls were allowlist-covered.

**Output accuracy (eyeball):** accepted first try. Correctly took the pre-release path (`10.11.10 unstable`), resolved `unstable` → immutable datestamp `20260531151854` and relayed it, investigated all 6 candidates against cited sites, made zero `gh` calls, named the handoff by the resolved datestamp (not the literal `unstable`, per Step 0a.4), led the proactive worklist with the breaking `DisableFirstEpisode` finding + `/new-api-version` pointer, cleaned temp files. No pushback or rerun.

**Model fit:** current `model: opus` — keep. Profile: verbose judgment reasoning (4,729 chars), `judgmentRequired: true`, 0 sub-agent/TodoWrite/AskUserQuestion (the absent AskUserQuestion is expected — that gate is Step 4, stable-path-only; this was the pre-release path). Investigation core is genuine non-mechanizable judgment. Watch: this run exercised only the lighter pre-release half; revisit if a future audit of the stable plan/execute path shows a clean mechanical profile.

**Fixes applied:** none — clean across all four dimensions.

**Deferred / dropped:** cost-pricing gap deferred to the auditor's own tooling (bump `extract-friction.cjs` pricing table for `claude-opus-4-8`, or audit `audit-skill` itself) — out of scope for editing `server-upgrade`.

**Source transcript:** `~/.claude/projects/-home-charlie-PROJECTS-JellyRock-jellyrock2/a1375d0d-6bbf-4b78-95d5-8dfe43f1a827.jsonl`
