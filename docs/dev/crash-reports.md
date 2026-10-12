---
topic: crash-reports
related-files:
  - scripts/crash-report.js
  - bsconfig-analysis.json
  - .crash-report/known-noise.yml
  - .claude/skills/crash-report/SKILL.md
  - tests/scripts/unit/crash-report.test.js
last-reviewed: 2026-10-09
---

# Weekly Roku crash reports

Every week Roku emails the JellyRock developers a "Crash Reporting" CSV covering the last 7 days. Each row is one crash signature, with its crash and device counts, the Roku OS release, the app version and a `pkg:/path/file.brs(line)` reference. The [`/crash-report`](../../.claude/skills/crash-report/SKILL.md) skill turns each crash above the threshold into tracked GitHub state, so none is lost.

This page explains the workflow for contributors. The skill holds the steps an agent follows.

## Enrich before filing: stage, enrich, file

The CSV names the crashing function but not the exception code. The code is what tells a small bug apart from a big-library "too many task threads" crash or a render-thread timeout, and it is only in the backtrace on Roku's dashboard (kept for 7 days, one click per crash, no bulk export). Filing straight from the CSV would mean filing before you know what a crash is. So the workflow runs in three phases:

1. **`stage`** reads and filters the CSV, groups rows by signature, applies the threshold, builds each cited app version, maps `pkg:/…brs:N` back to `.bs:N`, searches GitHub for existing issues, and writes a local worksheet. Every crash above the threshold starts as `pending`. A hint (`task-launch`, `network` or `other`) only sets the order to pull backtraces in; it never decides a crash. Nothing is written to GitHub.
2. **`enrich`** takes the backtraces you paste from the dashboard. It reads each `&hNN` exception code, maps the frames to source, and routes each crash to its disposition. Nothing is written to GitHub.
3. **`file`** writes to GitHub: scoped bugs become issues, and architectural crashes are recorded on their epic. A crash still without a backtrace is held and never filed. Its disposition depends on the exception code, so nothing is filed on a guess; even an ordinary-looking line can be an `&h23` timeout from heavy computation.

## The three dispositions

[`.crash-report/known-noise.yml`](../../.crash-report/known-noise.yml) is the routing table. Every crash above the threshold gets exactly one disposition:

| Disposition | Meaning | What happens |
| --- | --- | --- |
| **`file`** | A real bug with a small fix | A new `[crash]` issue for the signature, with the backtrace, exception and source frames from the start |
| **`aggregate`** | A known architectural problem we mean to fix, with no small fix | One record comment per `file·function·line·version` on the problem's epic, created or updated; never an issue of its own |
| **`watch`** | Accepted noise we won't fix | Counted, and silent unless a spike passes `baseline × multiplier`, which posts one comment on the tracker |

A crash that matches no pattern is `file`.

### Routing uses the exception code and its context

`&h29` (too many task threads) and `&h23` (execution timeout) belong to their architectural problem wherever they happen, so their patterns route on `exception_code` alone. `&hec` (the `.` operator used on an invalid value) is different: it is the themed-init race only when `init()` reads `m.global.constants` (issue #103). Anywhere else it is an ordinary bug, such as in caption VTT parsing. That is why the init-race pattern also matches on `function` and `snippet_regex`.

The tool never assumes that two different crash lines are one crash whose line moved. Deciding that takes a person's investigation, so each record stays separate on the epic.

## Architectural epics

An epic is a GitHub issue labeled `epic`. Its body, written and kept by a person, states the problem. Below it, the `file` phase keeps one comment per crash record, marked with a hidden `<!-- crashlog-record: v1 key=file|function|line|version -->` line. The comment holds a JSON block, which is the source of truth, and markdown built from it. Each run creates the comment or edits it, merging the counts without duplicating, and skips an edit that would change nothing. The tool only edits its own comments, never the epic's body.

The epics, all active in `known-noise.yml`:

- **`&h29`, too many task threads (#728).** Roku caps how many Task threads run at once. A very large library fills the pool, and the next `.control = "RUN"` anywhere in the app throws. The fix is architectural, a budget on tasks, not a change at each launch.
- **`&h23`, render-thread execution timeouts (#729).** Roku kills a render-thread callback that runs too long. The cause is always our own thread taking too long, through a blocking call or, more often here, heavy computation, since API calls run on the task pool ([ADR 0024](../adr/0024-crash-report-enrich-before-file.md)). Crashes from an unexpected or malformed server response (`&h18` and others) are scoped bugs, not this.
- **`&hec` in `init()` reading `m.global.constants`, the themed-component init race (#103).**

To add an epic, create the issue with the `epic` label, then add an `aggregate` pattern whose `tracker_issue` is its number. `tracker_issue` must be a positive integer.

## `watch` patterns and spikes

A `watch` pattern is noise we accept. Matching crashes get no issue and no comment, and appear in the run summary under "Suppressed (known noise)". When their combined count passes `baseline_crashes_per_week × spike_multiplier`, the skill posts one spike comment on the tracker. It doesn't reopen anything; a person decides.

### Pattern format

```yaml
patterns:
  - id: <kebab-case-slug>            # used in run summary + marker
    disposition: aggregate | watch   # defaults to watch
    notes: |
      Multi-line human description.
    tracker_issue: <positive int>     # epic (aggregate) or noise tracker (watch)
    baseline_crashes_per_week: <int>  # watch only (spike detection)
    spike_multiplier: <float>         # watch only; defaults to 2.0
    match:                            # ALL provided fields must agree (AND)
      exception_code: '&hNN'          # or a list; from the backtrace (enrich phase)
      function: <regex>               # for example ^init$
      category: <one-of>              # global-state-race | null-node-ref | ...
      file_glob: [components/ui/**]   # list of globs, any-match
      snippet_regex: <regex>          # gate against the code snippet
```

The first matching pattern wins. An empty or missing match field matches anything. `exception_code` comes from the backtrace, so a pattern that needs it can only match during `enrich`. During `stage`, which has only the CSV, those crashes stay `needs-backtrace`.

## The 7-day dashboard window

Roku's dashboard keeps backtraces for 7 days only, one click per crash, with no bulk export, so enrich within the report's window. When the skill asks you for a backtrace, it gives the exact `<basename>.brs:<line>` and date. A crash older than 7 days can never be enriched, so it stays held.

## Threshold

A crash is above the threshold when it hit at least 2 devices on one date (a wide crash), or happened on at least 2 different dates (a lasting crash). Change this with `--min-devices N` and `--min-dates N`; `--min-devices 1 --min-dates 1` takes every crash.

## The backtrace format

The dashboard's **View report → Backtrace** export is a TSV row. Its backtrace cell uses `~~` in place of line breaks, and the exception code is on the first line:

```text
~~Too many task threads (runtime error &h29) in pkg:/components/.../WebSocketClientTask.brs(14) ~~Backtrace: ~~#0  Function init() As $1 file/line: pkg:/.../WebSocketClientTask.brs(15) ~~Local Variables: ~~global  Interface:ifGlobal ~~m  roAssociativeArray refcnt=2 count:2 ~~
```

`normalizeBacktraceText` accepts three forms: the TSV row, the plain text of the **View report → Backtrace** page, and cell text already split by `~~`. Roku hides what collections contain (it shows only `refcnt` and `count`), so posting the block in a public issue is safe.

## Issues for `file` crashes

- **Title:** `[crash] <function>() in <basename>.brs:<line> (v<version>)`. It is the same every run, so finding an existing issue is reliable.
- **Body:** follows the headings of [`bug_report.yml`](../../.github/ISSUE_TEMPLATE/bug_report.yml), with the source location, a code snippet, the counts, the backtrace and a pointer to `/issue-triage <N>`.
- **Labels:** `bug` and `crash`.

### Finding existing issues

For each signature, the tool runs `gh issue list --state all --search "<basename>.brs:<line>" in:title` and keeps titles starting with `[crash]`. No match creates an issue. An open match gets a comment with the new crashes. A closed match is reopened, with a comment that it came back.

## One-time setup

The skill's preflight checks that these labels exist, and prints the commands for any that are missing:

```bash
gh label create crash --color e11d48 --description "Filed by /crash-report from Roku's weekly crash report"
gh label create known-issue --color cccccc --description "Long-running known bug — tracked but deprioritized"
gh label create epic --color 5319e7 --description "Architectural class tracker — /crash-report aggregates crashlog evidence here"
```

## What the workflow can't do

- **Name device models or users.** Roku's report doesn't include them.
- **Reproduce a crash.** The report says where it happened, not why. Run `/issue-triage <N>` after filing.
- **Match an exact build between releases.** The manifest version doesn't change on every commit, so the script uses the highest `v<major>.<minor>.*` tag and notes that the match is inexact.
- **Read source maps from a shipped build.** Release builds ship without them, so the script rebuilds the tagged version with `bsconfig-analysis.json`, which mirrors the release build.
- **Enrich a crash older than 7 days.** The dashboard no longer has it.

## When a build fails

If `npm ci` or `bsc` fails while building a cited version, its crashes get no source location. The issue says so and shows the transpiled `file:line`, and the run summary lists the build errors. Common causes are a tag too old for `bsconfig-prod.json`, a dependency mismatch, or a passing registry error.

## Old flow: enrich after filing

The old flow filed issues from the CSV first, then enriched each one with the `/crash-backtrace` skill. That skill is [deprecated](../../.claude/skills/crash-backtrace/SKILL.md): `/crash-report` now enriches before filing. For an issue filed under the old flow, the script still has an `enrich-issue` command:

```bash
node scripts/crash-report.js enrich-issue --issue <N> --backtrace-file <path>
```

## Tests

[`tests/scripts/unit/crash-report.test.js`](../../tests/scripts/unit/crash-report.test.js) covers the logic that always gives the same answer: reading the CSV, grouping, the threshold, reading backtraces, routing by exception code (`routeCrash`), the epic records (render, read, merge, create or update) and how the `file` phase splits crashes by disposition. Run it with `npm run test:scripts`. The build and GitHub steps are tried by hand against a sample CSV.
