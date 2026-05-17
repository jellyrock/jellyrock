---
topic: crash-reports
related-files:
  - scripts/crash-report.js
  - bsconfig-analysis.json
  - .claude/skills/crash-report/SKILL.md
  - tests/scripts/unit/crash-report.test.js
last-reviewed: 2026-05-17
---

# Weekly Roku crash-report workflow

Roku emails the JellyRock developers an aggregate "Crash Reporting" CSV every week (default window: the last 7 days). Each row is a unique crash signature with occurrence counts, distinct-device counts, OS release, app version, and a `pkg:/path/file.brs(line)` reference. Without a workflow these reports get manually reviewed or — more often — forgotten. The [`/crash-report`](../../.claude/skills/crash-report/SKILL.md) skill turns each above-threshold unique crash into a tracked GitHub issue so nothing falls through the cracks.

This page documents the workflow for human contributors. The skill itself documents the agent-facing steps.

## Who runs it

Anyone with `gh` authenticated to the JellyRock repo. The skill writes GH issues, which are the team-shared artifact. The local run-summary file in `.claude/handoffs/` is a personal convenience (resume-on-crash + audit log) — teammates rely on the issues, not the local file.

## When to run it

- **As soon as the weekly email arrives** is the simplest cadence. The skill is idempotent — running it again on the same CSV is a no-op because the GH dedup search matches the just-created issues.
- **After a notable release** — even outside the weekly cadence, run it on a fresh report if you want to see whether a release introduced new crash signatures or regressed previously-fixed ones.

## How to run it

```text
/crash-report path/to/weekly-report.csv
```

Or with a zip Roku sent (the script extracts the zip to a temporary directory, walks for files matching the Roku crash-report CSV header shape, and ignores anything else — release notes, JSON, PDFs):

```text
/crash-report path/to/weekly-bundle.zip
```

You can also paste the CSV inline if you don't want to save it to disk.

## What the skill does

1. Parses the CSV (or unzips + filters to matching CSVs only — header-based, not by filename).
2. Groups rows by crash signature (`pkg:/path.brs(line)` + function name).
3. Applies the threshold (see below). Below-threshold crashes are listed in the summary but not filed.
4. Checks out the cited app version in a temporary git worktree.
5. Generates `bsconfig-analysis.json` from the worktree's own `bsconfig-prod.json` (so plugin lists track the tagged commit) and runs `npx bsc` against it to produce source maps.
6. Uses [`roku-report-analyzer`](https://github.com/rokucommunity/roku-report-analyzer) to resolve each `.brs:line` to its original `.bs:line`.
7. Reads a 5-line code snippet around the resolved location and runs a small set of regex heuristics to infer a suspected category (`global-state-race`, `null-node-ref`, `array-bounds`, `callback-exception`, `event-handler-nil-arg`, `unknown`).
8. Searches GitHub for an existing issue per signature (matched by the stable `<basename>.brs:<line>` substring and the `[crash]` title prefix).
9. Renders a plan table and asks the user to confirm before any GH writes happen.
10. Performs `gh issue create` for new signatures, `gh issue comment` for already-open matches, and `gh issue reopen` + comment for closed matches (regressions).
11. Writes a run-summary handoff to `.claude/handoffs/crash-report-<timestamp>.md`.

## Threshold (default: file when ≥2 devices OR ≥2 distinct dates)

Filing every single-device, single-date crash creates noise — many of those are hardware-flaky one-offs. The default threshold files a crash when **either** of these conditions is met:

- **Max devices on any single date ≥ 2** — captures "wide" crashes hitting multiple devices in a single report window.
- **Distinct dates ≥ 2** — captures "persistent" crashes that keep happening across days even if they hit only one device at a time.

Override with `--min-devices N` or `--min-dates N` to widen or narrow the filter. To file everything: `/crash-report report.csv --min-devices 1 --min-dates 1`.

## Issue shape

Each filed issue has:

- **Title**: `[crash] <function>() in <basename>.brs:<line> (v<version>)` — deterministic from the CSV row so dedup is reliable across runs.
- **Body**: matches the [`bug_report.yml`](../../.github/ISSUE_TEMPLATE/bug_report.yml) field headers (`### What happened?`, `### Steps to reproduce`, `### JellyRock client version`, etc.) so it renders consistently with manually-filed bugs. Includes the resolved source location, code snippet, suspected category, occurrence stats table, and a pointer to run `/issue-triage <N>` for deeper investigation.
- **Labels**: `bug`, `crash`, `needs-triage`.

## Dedup behavior

Per-signature search uses `gh issue list --state all --search "<basename>.brs:<line>" in:title`. Only titles starting with the `[crash]` prefix match — manually-filed issues that happen to mention the same file:line in their title won't false-match. From there:

- **No match** → file a new issue (`create`).
- **Open match** → add a comment listing the new occurrence dates/counts (`comment`).
- **Closed match** → reopen the issue and add a regression comment (`reopen`). This is the strong signal for re-emergence after a supposed fix.

## One-time setup

Once per repo (not per run):

```bash
gh label create crash --color e11d48 --description "Filed automatically by /crash-report from Roku's weekly crash report"
```

The skill's preflight step checks the label exists and prints this command if it's missing.

## What the script can't do (and how to handle it)

- **Specific device models / users** — Roku's aggregate report doesn't include them. Issue body notes this; reproduction has to come from a separate channel (user report, dev-mode capture).
- **Reproduce the crash** — telemetry only tells you where it crashed, not why or how to trigger it. After filing, anyone on the team can run `/issue-triage <N>` against the created issue for a deeper investigation handoff.
- **Crashes from intermediate (untagged) commits** — the manifest version doesn't bump for every commit. If `v2.17.0` was released but several commits landed before `v2.18.0`, all of them ship as version 2.17.0 to Roku. The script falls back to the highest matching `v<major>.<minor>.*` tag and notes the inexact match in the issue body. The resolved source location may be slightly off from the actual commit that shipped to the user.
- **Source maps for already-shipped builds** — the production build that crashed on the user's device was built without source maps (intentionally — they're not shipped). The script builds the tagged version locally *with* source maps (using a generated `bsconfig-analysis.json` that mirrors prod) to recover the mapping. Functionally identical because logs are stripped in both configs.

## When the build step fails

If `npm ci` or `bsc` fails in the worktree, the affected signatures get an unresolved source location (the issue body says so explicitly and shows the transpiled file:line as a fallback). The build errors are listed in the run summary so you can investigate separately. Common causes: a tag too old to have `bsconfig-prod.json`, a dep version mismatch the lockfile doesn't reconcile, or a transient registry hiccup.

## Re-running on the same report

Safe — the skill is idempotent. New issues won't be duplicated (dedup matches them); open matches get a duplicate "new occurrences" comment (visible noise, harmless). Prefer running once per weekly report on the freshest CSV.

## Tests

The script's deterministic logic (CSV parse, grouping, threshold, category inference, body rendering, dedup search parsing) is covered by [`tests/scripts/unit/crash-report.test.js`](../../tests/scripts/unit/crash-report.test.js). Run with `npm run test:scripts -- crash-report`. The build + GH integration paths are exercised manually against the sample CSV at `tasks/sample-crash-report.csv` (gitignored).
