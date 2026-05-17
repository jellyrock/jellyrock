---
name: crash-report
description: Process a Roku weekly crash-report CSV (or a zip containing one or more CSVs) and turn each above-threshold unique crash into a tracked GitHub issue. Parses the CSV, groups crashes by pkg-path signature, builds the cited app version in a temporary git worktree, resolves the transpiled `.brs:line` back to source `.bs:line` via [roku-report-analyzer](https://github.com/rokucommunity/roku-report-analyzer) + source maps from a generated bsconfig-analysis.json. Dedup-aware: comments on already-open matches, reopens closed matches as regressions. Known-noise-aware: crashes matching patterns in `.crash-report/known-noise.yml` are suppressed (no issue, no comment) unless their combined count exceeds `baseline × spike_multiplier`, in which case ONE spike-alert comment lands on the configured tracker issue. Use when a fresh Roku crash CSV arrives (typically once a week — Roku emails them on a weekly cadence with the last 7 days). Per-crash investigation is offloaded — after filing, anyone on the team can run `/issue-triage <N>` to dig in.
model: opus
user-invocable: true
allowed-tools: Bash(node scripts/crash-report.js:*), Bash(gh issue create:*), Bash(gh issue comment:*), Bash(gh issue reopen:*), Bash(gh label create:*), Bash(gh label list:*), Bash(gh issue list:*), Bash(git tag:*), Bash(git worktree:*), Bash(git rev-parse:*), Bash(date:*), Bash(ls:*), Bash(npm:*), Read, Write
---

# /crash-report — turn the weekly Roku crash CSV into tracked GH issues

Single-file workflow. The mechanical work — CSV parse, ZIP extraction + filtering, version-to-tag resolution, isolated build, source-map lookup, GH dedup search, known-noise classification + spike detection, body drafting, GH writes, run-summary handoff — lives in [`scripts/crash-report.js`](../../../scripts/crash-report.js). This skill orchestrates that helper across a two-phase plan/execute split so the user gets to see (and override) the action plan before any GitHub writes happen.

Unlike `/issue-triage`, `/runtime-triage`, `/ci-triage`, and `/pr-review`, this skill has **no sibling `INVESTIGATION.md`** — each created issue IS the team-shared handoff, and per-crash deep-dive investigation is offloaded to `/issue-triage <N>`. The run-summary file in `.claude/handoffs/` exists purely as a resume-on-crash + local audit log for the person running the report; teammates rely on the GH issues, not the local file.

## Known-noise classification

Some crashes are long-running race conditions or hardware-specific bugs the team has accepted as ongoing noise (e.g. issue #103 — `m.global.constants` invalid during themed-component `init()`). Filing per-signature issues for these is pure noise. The skill consults [`.crash-report/known-noise.yml`](../../../.crash-report/known-noise.yml) — each entry binds matching crashes to a tracker issue and a baseline. For matched crashes:

- **Normal path**: no issue created, no comment posted. The signatures show up under "Suppressed (known noise)" in the run summary so they're auditable.
- **Spike path**: when the combined occurrence count across all matched signatures exceeds `baseline_crashes_per_week × spike_multiplier`, the skill posts ONE comment to the tracker issue flagging the spike. Per the design, the tracker is NOT reopened automatically — humans decide whether the spike warrants reopening / investigation / tuning.

The config schema is documented in [`docs/dev/crash-reports.md`](../../../docs/dev/crash-reports.md). Edit the YAML directly when a new class of "known and accepted" crashes emerges; the skill re-reads it every run.

## Inputs

`$ARGUMENTS`: either a path to the CSV (e.g. `tasks/sample-crash-report.csv`), a path to a zip archive Roku emailed you (which may contain multiple CSVs interleaved with unrelated files like release notes — header-based filtering ignores those), or pasted CSV text in the conversation if no path given. Optional override flags accepted in `$ARGUMENTS`: `--min-devices N` (default 2), `--min-dates N` (default 2). Either threshold being met causes a crash to be filed; both must fail for it to be skipped.

## Step 0 — Preflight

Before doing real work, confirm three things:

1. **The `crash` and `known-issue` labels exist in the repo**. Check with `gh label list --search crash` and `gh label list --search known-issue`. If `crash` is missing, surface `gh label create crash --color e11d48 --description "Filed automatically by /crash-report from Roku's weekly crash report"`. If `known-issue` is missing, surface `gh label create known-issue --color cccccc --description "Long-running known bug — tracked but deprioritized; /crash-report uses these as noise dampeners"`. One-time setup per repo.
2. **`roku-report-analyzer` and `adm-zip` are installed**. Quick check: `ls node_modules/roku-report-analyzer/dist/Runner.js && ls node_modules/adm-zip/package.json`. If either is missing, run `npm install` to pick them up from `package.json`'s devDependencies.
3. **Working tree state**. The skill uses `git worktree add` for the build (which is non-destructive to the main checkout), so a dirty working tree is FINE. But if any unstaged changes exist that the user may want to commit first, mention them as a courtesy — don't block.

## Step 1 — Plan

Invoke the helper in `plan` mode, writing the plan JSON to a temp file:

```bash
PLAN_FILE=$(mktemp --suffix=.json /tmp/crash-report-plan.XXXXXX.json)
node scripts/crash-report.js plan --input <user-arg> --plan-out "$PLAN_FILE"
```

The helper does the heavy lifting: parses the CSV (or unzips + filters), groups by signature, applies the threshold, resolves the app version to a git tag, creates a temporary worktree with `git worktree add --detach`, generates `bsconfig-analysis.json` from the worktree's own `bsconfig-prod.json` (so the build always uses the plugin list that existed at the tagged commit), runs `npm ci` + `npx bsc --project bsconfig-analysis.json` in the worktree, hands the resulting `build-analysis/` to roku-report-analyzer for source-map lookup, classifies each crash against `.crash-report/known-noise.yml` (suppressing matches + flagging spikes), then searches GitHub for existing issues among the remaining novel signatures with the stable `<basename>.brs:<line>` substring + `[crash]` prefix.

Expected wall-clock: ~30-90 seconds total per unique app version in the report (most reports cite a single version). Worktree is cleaned up before the helper returns.

## Step 2 — Render plan to user

Read the plan JSON. Render it as four short blocks:

1. **Input summary**: kind (csv / zip / stdin), source path, CSVs found, ignored files (for zips), window dates, total rows, unique signatures.
2. **Action table** — one row per above-threshold novel signature (noise-matched signatures appear in block 3):

   | # | Signature | Action | Existing | Function | Category | Devices | Dates |
   |---|---|---|---|---|---|---|---|
   | 1 | FontDownloadTask.brs:29 | create | — | downloadFallbackFont() | unknown | max 2 | 1 |
   | 2 | SceneManager.brs:83 | reopen #501 | CLOSED | popScene() | callback-exception | max 1 | 1 |

3. **Suppressed (known noise)** — for each pattern in `plan.noiseSuppressed`: pattern id, tracker issue, combined count, baseline, whether the spike threshold was crossed. Each suppressed signature listed underneath. If `plan.spikeAlerts[i].isSpike` is true, this section also notes the spike comment that will be posted to the tracker on execute.
4. **Filtered-out signatures** (below threshold) — one line each with the reason (`1 device, 1 date`). User can override with `--min-devices 1` / `--min-dates 1` and re-run from Step 1.

If the plan has `buildErrors` entries, surface them prominently — the source-resolution column will show "—" for affected signatures and the issue body will note the lookup failed. The user may still want to proceed (issues will be filed without resolved source locations) or abort and investigate the build failure.

## Step 3 — Confirm

Ask the user one of: (a) proceed with the plan as-is, (b) adjust thresholds and re-plan, (c) abort. Use AskUserQuestion. If proceeding, move to Step 4. If adjusting, loop back to Step 1 with the new flags.

## Step 4 — Execute

```bash
node scripts/crash-report.js execute --plan "$PLAN_FILE"
```

The helper performs the GH writes (`gh issue create` / `gh issue comment` / `gh issue reopen` for novel signatures + ONE `gh issue comment` per spike-alert pattern targeting the tracker issue), captures each result (issue number assigned, errors), then writes a run-summary handoff to `.claude/handoffs/crash-report-<YYYYMMDD-HHMMSS>.md` with the input summary, action results, suppressed-noise + spike-alert sections, and any errors.

## Step 5 — Surface the summary

Read the run-summary file from `.claude/handoffs/`. Output a brief recap to the user:

> Filed 2 new issues (#742, #743), commented on 1 open (#618), reopened 1 closed regression (#501). Skipped 5 below threshold. Full summary: `.claude/handoffs/crash-report-<timestamp>.md`. Per-crash deep dive: `/issue-triage <N>`.

If any actions failed (the helper continues on individual GH failures and records them in the results), call those out separately so the user can retry manually.

Clean up the temp plan file: `rm "$PLAN_FILE"`.

## Cron / weekly cadence

Roku's reports are weekly. Two ways to run on cadence:

- **Manual**: keep this skill explicit — you invoke `/crash-report <path-to-fresh-zip>` whenever the email lands.
- **Scheduled via Claude harness**: the cron primitive can schedule `/crash-report --input <path>` on a fixed interval. The skill is idempotent — re-running against the same CSV is a no-op because the GH dedup search matches the just-created issues and short-circuits to comment-on-open (which adds an identical "new occurrences" comment, harmless but noisy). Prefer one weekly run on the freshest report.

## When NOT to use

- The input is a single `.text` crashlog (stack trace from a developer's device, not Roku's aggregate CSV) → use `/runtime-triage` with the pasted log.
- The input is a single GitHub issue someone filed manually about a crash → use `/issue-triage <N>`.
- You want to investigate a specific crash that's already a GH issue → use `/issue-triage <N>`.
- The input is a CI failure log → use `/ci-triage <run-id>`.

## Sub-agent invocation

To invoke from a parent sub-agent (rare; this is a slash-command-shaped skill): parent passes `Read .claude/skills/crash-report/SKILL.md and follow Steps 0-4 for $ARGUMENTS=<input-path>; write the plan + execute it; surface the summary path` in the Task prompt.
