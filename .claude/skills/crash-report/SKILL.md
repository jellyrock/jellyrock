---
name: crash-report
description: "Process a Roku weekly crash-report CSV (or a zip holding one or more CSVs) into tracked GitHub issues and architectural-epic evidence, enriching before filing (stage, then enrich, then file). STAGE parses and filters the CSV, groups by pkg-path signature, builds each cited app version in a temporary git worktree, maps the transpiled `.brs` line back to the source `.bs` line, runs the GitHub dedup search, and writes a local worksheet where every crash starts pending; a mechanism hint (task-launch, network, other) orders which to pull first but never authorizes a file. ENRICH folds in the per-crash backtraces you paste from Roku's dashboard (a 7-day window, one click per crash, no bulk export), extracts each `&hNN` exception code, and routes every crash to a disposition (nothing files or aggregates without a backtrace): `file` (a scoped bug becomes a new per-signature [crash] issue, born enriched), `aggregate` (a known architectural class: `&h29` big-library too-many-task-threads, `&h23` render-thread execution timeouts, the `&hec` init `m.global.constants` race; upserted as one flat record comment per `file·function·line·version` onto the class epic, never a standalone issue), or `watch` (accepted noise, a spike comment only). FILE performs the GitHub writes (create, comment or reopen for scoped bugs; the epic record upsert for architectural classes) and writes a run-summary handoff. Dedup-aware and idempotent. Use when a fresh Roku crash CSV arrives (weekly). A deep dive on one crash goes to `/issue-triage <N>` after filing."
model: opus
effort: high
---

# /crash-report: the weekly Roku crash CSV, into tracked issues and epic evidence

**Enrich before filing: `stage`, then `enrich`, then `file`.** What decides whether a crash is a scoped bug, a big-library too-many-tasks crash or a render-thread timeout is the exception code, and that lives only in Roku's per-crash dashboard backtrace, not in the CSV. So this skill stages a local worksheet first, folds in the backtraces you paste, and only *then* files. Issues are born complete, and architectural-class noise never becomes a standalone issue.

The mechanical work (parsing the CSV, extracting and filtering the zip, resolving each version to its tag, the isolated build, the source-map lookup, parsing backtraces and routing by exception code, the epic-comment upsert, the GitHub dedup search, drafting bodies, the GitHub writes, the run-summary handoff) lives in [`scripts/crash-report.js`](../../../scripts/crash-report.js) (subcommands `stage` / `enrich` / `file`). This skill orchestrates it across the three phases with human gates before any GitHub write.

## The three dispositions

Every above-threshold crash routes to exactly one disposition. The routing table is [`.crash-report/known-noise.yml`](../../../.crash-report/known-noise.yml):

- **`file`:** a real, small-scoped bug becomes a new per-signature `[crash]` issue, born enriched (backtrace + exception + source frames).
- **`aggregate`:** a known architectural class you intend to fix but that has no small-scoped fix (`&h29` big libraries and too many task threads, epic #728; `&h23` render-thread execution timeouts, epic #729; the `&hec`, `init()` and `m.global.constants` themed-init race). Each unique crash record (`file·function·line·version`) is **upserted** as one flat comment onto the class **epic**. Distinct lines are never auto-merged; occurrence stats accumulate. Nothing is ignored: the evidence lands on the epic.
- **`watch`:** accepted noise we've decided *not* to fix. Counted, silent unless a spike crosses `baseline × multiplier`, then one comment on the tracker.

Routing is by exception code **+ context**: `&h29` and `&h23` are their class wherever they happen (the code alone routes them). `&hec` is the init-race epic only in `init()` with `m.global.constants`; a bare `&hec` elsewhere is an ordinary scoped invalid reference, which is why the config also gates `&hec` on the function and a snippet.

## ⚠️ The 7-day dashboard window

Roku's analytics dashboard keeps crash backtraces for **7 days** only, one click per crash, with no bulk export. Enrichment must happen **within the report's window**. Whenever you ask the user to pull a backtrace, give the exact `<basename>.brs:<line>` **and** `date`, and only for crashes inside the current report window: anything older can never be enriched. It stays held: the `file` phase never files a crash without a backtrace.

## Inputs

The arguments: a path to the CSV, a path to a Roku zip (several CSVs and unrelated files are fine; the header filter sorts them), or pasted CSV text. Below, `<input>` stands for it. Threshold overrides: `--min-devices N` (default 2), `--min-dates N` (default 2). Either threshold met files the crash; both must fail to skip it.

## Step 0: Preflight

1. **The labels exist:** `gh label list --search crash`, `--search known-issue`, `--search epic`. For any that is missing, show the user its command and run it on their go-ahead:
   - `gh label create crash --color e11d48 --description "Filed by /crash-report from Roku's weekly crash report"`
   - `gh label create known-issue --color cccccc --description "Long-running known bug — tracked but deprioritized"`
   - `gh label create epic --color 5319e7 --description "Architectural class tracker — /crash-report aggregates crashlog evidence here"`
2. **Dependencies:** `ls node_modules/source-map/source-map.js && ls node_modules/adm-zip/package.json`; run `npm ci` if either is missing.
3. **The epics are open:** each `aggregate` pattern's `tracker_issue` in `known-noise.yml` names a real epic (`gh issue view <N> --json state`). [`docs/dev/crash-reports.md`](../../../docs/dev/crash-reports.md#architectural-epics) describes them.
4. **The working tree:** uncommitted changes are fine, since the build uses `git worktree`. Mention them, but don't stop.

## Step 1: Stage (no GitHub writes)

```bash
WS=$(mktemp /tmp/crash-report-worksheet.XXXXXX.json)   # no --suffix: mktemp rejects it unless the template ends in X
node scripts/crash-report.js stage --input "<input>" --plan-out "$WS"
```

The helper parses and filters the CSV, groups it by signature, applies the threshold, builds each cited version in a temporary worktree, maps each `pkg:/…brs` line back to its `.bs` line, runs the GitHub dedup search, and gives each crash above the threshold a `mechanismHint` (`task-launch`, `network` or `other`). Every crash starts as `pending` and `needs-backtrace`: nothing files or aggregates without a pasted backtrace, because the exception code decides the disposition and lives only there. The `mechanismHint` never authorizes a file; it only **orders** which crashes to pull first. Expect about a minute per cited version.

## Step 2: Show the worksheet

Read `$WS` and show: (1) an **input summary** (kind, source, CSVs found, ignored files, window dates, total rows, unique signatures, above and below the threshold); (2) an **action table**, one row per crash above the threshold, giving the signature and its source, function, mechanism, crashes, devices, dates and dedup match, **ordered by `mechanismHint`** (`task-launch` and `network` first, then `other`); (3) the rows **filtered out** below the threshold, with the reason; (4) any **build errors**, prominently (the affected rows show `—`).

Every crash above the threshold needs a pasted backtrace before it can be filed or aggregated: the CSV and the code alone can't tell a scoped bug from an architectural class (even an ordinary-looking line can be a compute-bound `&h23` timeout). The `mechanismHint` only says what to pull *first*: `task-launch` and `network` sites are the likeliest architectural classes (`&h29`, `&h23`), and `other` sites the likeliest scoped bugs. A backtrace confirms each one, never a guess.

## Step 3: Enrich (no GitHub writes)

For every `needs-backtrace` row, tell the user the exact `<basename>.brs:<line>` on `<date>` to open in Roku's dashboard (**View report → Backtrace**) and paste back, with a reminder of the 7-day window. Batching is fine: collect the pastes (as `@file` references or inline), save each to a temporary file, then:

```bash
node scripts/crash-report.js enrich --worksheet "$WS" <backtrace1.txt> [<backtrace2.txt> ...]
```

`enrich` extracts each `&hNN`, maps the frames to source, and routes each crash: `&h29`, `&h23` and the `&hec` init race go to `aggregate` (marked for their epic, never filed alone); anything else goes to `file` (its issue body gets the backtrace, so it is born complete). One backtrace per signature is enough: the code is stable per site, so you don't need one per date. Read `$WS` again and show the table with each crash's `disposition` and exception code.

## Step 4: Confirm the dispositions (the user's gate)

Present the final plan: which enriched crashes will **file** (new issues), which will **aggregate** (and to which epic), which still lack a backtrace and so are **held** (the `file` phase skips them), and any crashes below the threshold. Ask in chat, with the reply words `proceed`, `restage <thresholds>` and `hold <rows>`, and wait. Nothing has reached GitHub yet.

## Step 5: File (GitHub writes)

```bash
node scripts/crash-report.js file --worksheet "$WS"
```

`file` creates/comments/reopens the `file` crashes, and for each `aggregate` crash upserts one flat record comment onto its epic: a new comment, or an edit of the existing record when its `file·function·line·version` key is already there (adding occurrences, never duplicating; an edit that changes nothing is skipped). It writes a run-summary handoff to `.claude/handoffs/crash-report-<timestamp>.md`.

## Step 6: Report the summary

Read the handoff and recap: N filed (#…), N commented, N reopened, N aggregated to epics (#…), N suppressed, N skipped. Name any action that failed, for a retry by hand. **Next:** for a deep dive on a filed issue, `/issue-triage <N>`. Delete the worksheet: `rm "$WS"`.

## When not to use

- One crash log from a developer's device: use `/runtime-triage`.
- One crash issue someone filed by hand: use `/issue-triage <N>`.
- A CI failure log: use `/ci-triage <run-id>`.

## The weekly cadence

Running the whole flow again on the same report files nothing new (the dedup stops it) and writes epic records to the same comments (edits that change nothing are skipped). Run it once per fresh weekly report, and promptly, because the 7-day backtrace window closes.

## Sub-agent invocation

To run it from a sub-agent, the parent passes `Read .claude/skills/crash-report/SKILL.md and run the stage, enrich and file flow for input <path>; render the worksheet, gather pasted backtraces for the needs-backtrace rows, confirm dispositions, file, and surface the summary path` in the Agent prompt.
