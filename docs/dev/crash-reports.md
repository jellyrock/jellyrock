---
topic: crash-reports
related-files:
  - scripts/crash-report.js
  - bsconfig-analysis.json
  - .crash-report/known-noise.yml
  - .claude/skills/crash-report/SKILL.md
  - tests/scripts/unit/crash-report.test.js
last-reviewed: 2026-05-22
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
6. Walks the source maps emitted alongside each transpiled `.brs` to resolve `pkg:/path.brs:line` back to the original `.bs:line`, using Mozilla's [`source-map`](https://github.com/mozilla/source-map) library directly (one `SourceMapConsumer` per unique map, cached across signatures and across backtrace frames).
7. Reads a 5-line code snippet around the resolved location and runs a small set of regex heuristics to infer a suspected category (`global-state-race`, `null-node-ref`, `array-bounds`, `callback-exception`, `event-handler-nil-arg`, `unknown`).
8. Searches GitHub for an existing issue per signature (matched by the stable `<basename>.brs:<line>` substring and the `[crash]` title prefix).
9. Renders a plan table and asks the user to confirm before any GH writes happen.
10. Performs `gh issue create` for new signatures, `gh issue comment` for already-open matches, and `gh issue reopen` + comment for closed matches (regressions).
11. Writes a run-summary handoff to `.claude/handoffs/crash-report-<timestamp>.md`.

## Known-noise patterns + spike detection

Some crashes are long-running race conditions, hardware-specific bugs, or other "won't fix" classes the team has decided to live with. Filing per-signature issues for these every week is pure noise. The skill consults [`.crash-report/known-noise.yml`](../../.crash-report/known-noise.yml) — each entry binds a class of matching crashes to a tracker issue and a baseline.

**Normal path**: matched signatures are suppressed (no GH issue, no comment). They show up in the run summary under "Suppressed (known noise)" so the run remains fully visible to the human reading the summary.

**Spike path**: when the combined crash count across all matched signatures for a pattern exceeds `baseline_crashes_per_week × spike_multiplier`, the skill posts ONE comment to the tracker issue with the spike details (count, baseline, ratio, per-signature breakdown). The tracker is NOT reopened automatically — the human decides whether the spike warrants reopening, further investigation, or adjusting the baseline.

### Config schema

```yaml
patterns:
  - id: <kebab-case-slug>            # used in run summary + spike comment subject
    notes: |
      Multi-line human description of the class of crashes.
    tracker_issue: <number>           # GH issue that tracks this class
    baseline_crashes_per_week: <int>  # eyeball estimate from observed history
    spike_multiplier: <float>         # defaults to 2.0 if omitted
    match:                            # ALL provided fields must agree (AND)
      function: <regex>               # e.g. `^init$`
      category: <one-of>              # global-state-race | null-node-ref |
                                      #   array-bounds | callback-exception |
                                      #   event-handler-nil-arg | unknown
      file_glob:                      # list of globs, any-match
        - components/ui/**
      snippet_regex: <regex>          # optional gate against code snippet
```

First-match wins when a crash could bind to multiple patterns. Empty / omitted match fields are wildcards.

### Adding a new pattern (workflow)

1. After a `/crash-report` run files a class of issues you decide are "known and accepted":
   - **If a tracker issue doesn't exist yet** for this class: pick one of the filed issues that's most representative, label it `known-issue` (gray), edit its title to a stable description like "Known: `<short description>`", and add a comment summarizing the decision to accept + the rationale.
   - **If a tracker exists**: reopen it (if closed) and apply the `known-issue` label.
2. Add an entry to [`.crash-report/known-noise.yml`](../../.crash-report/known-noise.yml) pointing `tracker_issue` at the tracker.
3. Pick a `baseline_crashes_per_week` from history (eyeball the last 4-6 weekly reports' combined count for this class; round up).
4. Set `spike_multiplier` to `2.0` unless you have reason to be more or less sensitive.
5. Close the duplicate filed issues with a comment linking the tracker.
6. Next `/crash-report` run will suppress matching signatures.

### Tuning the baseline

- **Too noisy** (you keep getting spike-alert comments on the tracker for benign weeks): raise `baseline_crashes_per_week` or `spike_multiplier`.
- **Too quiet** (a real degradation isn't tripping the alert): lower one of them.
- **Spike alert is real, sustained**: re-investigate root cause; consider removing the pattern from the noise config so future crashes flow into the normal file-issue path.

### One-time label setup

Once per repo:

```bash
gh label create known-issue --color cccccc --description "Long-running known bug — tracked but deprioritized; /crash-report uses these as noise dampeners"
```

The skill's preflight checks for the label and prints this command if missing.

## Threshold (default: file when ≥2 devices OR ≥2 distinct dates)

Filing every single-device, single-date crash creates noise — many of those are hardware-flaky one-offs. The default threshold files a crash when **either** of these conditions is met:

- **Max devices on any single date ≥ 2** — captures "wide" crashes hitting multiple devices in a single report window.
- **Distinct dates ≥ 2** — captures "persistent" crashes that keep happening across days even if they hit only one device at a time.

Override with `--min-devices N` or `--min-dates N` to widen or narrow the filter. To file everything: `/crash-report report.csv --min-devices 1 --min-dates 1`.

## Optional: backtrace enrichment from the analytics dashboard

The weekly email CSV carries exactly one frame per crash — the location where the BrightScript runtime detected the failure. Roku's analytics dashboard has a richer per-error view: for each unique crash row you can click "View report" under the Backtrace column to see the full multi-frame backtrace plus a snapshot of local variables at crash time. There is no bulk export — backtraces are pulled one error at a time.

Two workflows attach this data to filed issues:

1. **`enrich-issue` subcommand** (recommended for the per-error click-through reality) — manually pull the plaintext backtrace for ONE filed issue, hand it to the helper, get one enrichment comment posted.
2. **`--dashboard-csv` flag** on `plan` / `execute` — if you ever manage to assemble a TSV containing multiple backtraces in Roku's expected format (e.g. via API access or a future bulk export), pass it once and every matching new or already-open issue is enriched in a single run. Today this is a forward-compatible path, not a daily workflow.

### `/crash-backtrace` workflow

Per weekly batch:

1. Open Roku's analytics dashboard → BrightScript Errors view.
2. For each crash you want to enrich, click "View report" under the Backtrace column.
3. Download the export and save into a folder (e.g. `tasks/bt-2026-05-20/`). Either the "Backtrace" plaintext view or the "Daily Error Key" TSV row works — the helper auto-detects both. Filenames don't matter; the skill auto-resolves the matching issue from each backtrace's innermost frame signature.
4. Invoke the [`/crash-backtrace`](../../.claude/skills/crash-backtrace/SKILL.md) skill against one or many files:

   ```text
   /crash-backtrace @tasks/bt-2026-05-20/file-1.txt @tasks/bt-2026-05-20/file-2.txt @tasks/bt-2026-05-20/file-3.txt
   ```

   Or one at a time via inline paste:

   ```text
   /crash-backtrace

   Execution timeout (runtime error &h23) in pkg:/components/video/OSD.brs(504)
   Backtrace:
   #1  Function onprogresspercentagechanged() ...
   ```

   The skill resolves each backtrace to a `[crash]` issue via `<basename>:<line>` substring search. If the auto-resolve is ambiguous (multiple matches, or a CLOSED match), the skill asks which to use. Pass an explicit issue number to bypass auto-resolve: `/crash-backtrace 582 @tasks/582.txt`.

Under the hood, the skill runs `node scripts/crash-report.js enrich-issue --issue <N> --backtrace-file <path>` (the helper is also available directly if you need to wire it into other automation; both call the same `enrichIssue` function). Worktree builds are cached at `/tmp/jellyrock-crash-wt-cache-<tag>` with a `1h` TTL — so the first enrichment per version pays the `~30-90s` build cost, then subsequent same-version enrichments cost `~1s`.

### Pre-enrichment classification

Before paying the worktree build cost, the skill runs a cheap classifier (`classify-backtrace` subcommand — pure backtrace parsing + issue-body inspection, no build) that flags known-noise patterns the team usually doesn't want enriched:

- **`timeout-one-off`** — `Execution timeout` (runtime error `&h23`) with exactly 1 occurrence per the issue's stats table. Roku OS killed the thread for running too long. Single occurrences are usually transient (server disconnect, network blip, device-specific stall) and not actionable. Recommended action: close as not-actionable with a comment ("one-off timeout — reopen if it recurs").
- **`timeout-recurring`** — same error code/message but ≥2 occurrences. The class of bug the team actually needs to investigate. Recommended action: enrich + escalate to `/issue-triage <N>`.
- **`global-constants-init-race-suspect`** — `init()` with the `'Dot' Operator attempted with invalid BrightScript Component...` error (`&hec`). Belt-and-suspenders behind the `/crash-report` YAML filter for #103 — catches signature variants the YAML pattern missed (e.g., a new themed component whose file glob isn't covered). Recommended action: close as duplicate of #103; optionally extend `.crash-report/known-noise.yml` to cover the new variant.

The skill surfaces the classification + reason + recommended action, then asks the user before proceeding. The user always has the final say (enrich anyway, follow the recommendation, or abort). Classifier code lives in `classifyBacktraceForEnrichment` ([scripts/crash-report.js](../../scripts/crash-report.js)) and is unit-tested in `tests/scripts/unit/crash-report.test.js`. To add a new classification rule (e.g., a `null-node-deref` one-off), edit the function and add a Vitest case — there's no YAML config layer for these checks today.

The helper:

- Reads the issue via `gh issue view <N>` and parses its `[crash] <fn>() in <basename>.brs:<line> (v<version>)` title for the version + signature.
- Cross-checks that the issue carries the `crash` label (refuses to enrich anything else).
- Parses the backtrace via `normalizeBacktraceText`, which accepts three shapes interchangeably: dashboard TSV (header sniff → first data row's `Backtrace Text Formatted` cell wins), plaintext from the per-error "View report → Backtrace" page (handles CRLF, drops blanks), and already-normalized `~~`-separated cell text.
- Warns (but does not abort) if the backtrace's innermost frame doesn't match the issue title's `basename:line` — happens if you grabbed the wrong row.
- Builds a temp git worktree at the issue's cited version, runs `bsc` to get source maps, and resolves every backtrace frame back to its `.bs:line`.
- Posts ONE comment to the issue with the resolved-frame table + locals block under a clear "Backtrace enrichment from Roku analytics dashboard" header.

Each invocation builds its own worktree (~30-90 s). For 4 issues that's a few minutes of wall-clock per weekly batch, which is acceptable for the click-through cadence the dashboard imposes.

#### Plaintext backtrace format expected

```text
'<message>' (runtime error &h<hex>) in pkg:/<path>(<line>)
Backtrace:
#0  Function <name>(<args>) As <returnType> file/line: pkg:/<path>(<line>)
#1  Function ...
Local Variables:
<name>           <type> val:"<value>"
<name>           <type> refcnt=<n> count:<n>
```

Indices are inside-out: `#0` is the entry point, the highest-numbered frame is the crash site. Primitives show their value; collections show metadata only (`refcnt`, `count`). Roku redacts collection contents in the export, so dumping the block verbatim into a public GH issue is safe.

### `--dashboard-csv` (bulk path, forward-compatible)

If you ever have a TSV containing multiple backtraces in the dashboard's expected shape — one row per unique signature, with the `Backtrace Text Formatted` column using `~~` as the in-cell line separator — pass it to `plan`:

```bash
/crash-report path/to/weekly-report.csv --dashboard-csv path/to/backtraces.tsv
```

The weekly CSV still drives all filing decisions (thresholds, dedup, known-noise classification, GH writes). The dashboard CSV is pure enrichment that flows into both new-issue bodies and dedup/regression comments on existing issues. Signatures with no matching backtrace fall back to the single-frame view; dashboard-only signatures (no matching email row) are ignored.

### When to enrich

Worth pulling backtraces when:

- The single-frame email view is ambiguous (e.g. a generic helper failing — you want to know which caller triggered it).
- You're triaging a re-emerging crash and want to see whether the call chain changed since the last occurrence.
- A bug report from a user references a specific feature and you want to confirm the call chain matches that flow.

Skip it when:

- The crash signature is already self-explanatory (single-method failure with a clear cause).
- You're running on weekly cadence and want the fastest path through — file first, enrich on demand if triage stalls.

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

### Backfilling backtraces onto already-filed issues

If a batch of issues was filed without `--dashboard-csv` and you later want to attach the multi-frame backtrace + locals, just re-run with the same email CSV plus `--dashboard-csv <path>`. The dedup search will find each open issue, switch the action from `create` to `comment`, and the comment body includes the backtrace section in addition to the "new occurrences" stats. Closed-match (regression) comments are likewise enriched. Dashboard-only signatures with no matching email row are still ignored (no email row → no occurrence stats → nothing to threshold on).

## Tests

The script's deterministic logic (CSV parse, grouping, threshold, category inference, body rendering, dedup search parsing) is covered by [`tests/scripts/unit/crash-report.test.js`](../../tests/scripts/unit/crash-report.test.js). Run with `npm run test:scripts -- crash-report`. The build + GH integration paths are exercised manually against the sample CSV at `tasks/sample-crash-report.csv` (gitignored).
