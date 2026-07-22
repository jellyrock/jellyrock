---
name: crash-report
description: Process a Roku weekly crash-report CSV (or a zip containing one or more CSVs) into tracked GitHub issues + architectural-epic evidence, using an enrich-before-file flow (stage → enrich → file). STAGE parses/filters the CSV, groups by pkg-path signature, builds each cited app version in a temporary git worktree, source-maps the transpiled `.brs:line` back to source `.bs:line`, runs the GH dedup search, and writes a local worksheet where every crash starts pending — a mechanism hint (task-launch/network/other) orders which to pull first but never authorizes a file. ENRICH folds in the per-crash backtraces you paste from Roku's dashboard (7-day window, one click per crash — no bulk export), extracts each `&hNN` exception code, and routes every crash to a disposition (nothing files or aggregates without a backtrace): `file` (a scoped bug → a new per-signature [crash] issue, born enriched), `aggregate` (a known architectural class — `&h29` big-library too-many-task-threads, `&h23` server timeouts, `&hec`+init `m.global.constants` race — upserted as one flat record comment per `file·function·line·version` onto the class epic, never a standalone issue), or `watch` (accepted noise, spike-comment only). FILE performs the GitHub writes (create/comment/reopen for scoped bugs; epic record upsert for architectural classes) and writes a run-summary handoff. Dedup-aware and idempotent. Use when a fresh Roku crash CSV arrives (weekly). Per-crash deep dive is offloaded to `/issue-triage <N>` after filing.
model: opus
effort: high
---

# /crash-report — weekly Roku crash CSV → tracked issues + epic evidence

**Enrich-before-file flow: `stage → enrich → file`.** The data that decides whether a crash is a scoped bug, a big-library too-many-tasks crash, or a server timeout is the exception code — and that lives only behind Roku's per-crash dashboard backtrace, not in the CSV. So this skill stages a local worksheet first, folds in the backtraces you paste, and only *then* files. Issues are born complete, and architectural-class noise never becomes a standalone issue.

The mechanical work — CSV parse, ZIP extraction + filtering, version→tag resolution, isolated build, source-map lookup, backtrace parsing + exception-code routing, epic-comment upsert, GH dedup search, body drafting, GH writes, run-summary handoff — lives in [`scripts/crash-report.js`](../../../scripts/crash-report.js) (subcommands `stage` / `enrich` / `file`). This skill orchestrates it across the three phases with human gates before any GitHub write.

## The three dispositions

Every above-threshold crash routes to exactly one disposition. The routing table is [`.crash-report/known-noise.yml`](../../../.crash-report/known-noise.yml):

- **`file`** — a real, small-scoped bug → a new per-signature `[crash]` issue, born enriched (backtrace + exception + source frames).
- **`aggregate`** — a known architectural class you intend to fix but that has no small-scoped fix (`&h29` big libraries / too-many-task-threads; `&h23` server timeouts; `&hec`+`init()`+`m.global.constants` themed-init race). Each unique crash record (`file·function·line·version`) is **upserted** as one flat comment onto the class **epic**. Distinct lines are never auto-merged; occurrence stats accumulate. Nothing is ignored — the evidence lands on the epic.
- **`watch`** — accepted noise we've decided *not* to fix. Counted, silent unless a spike crosses `baseline × multiplier`, then one comment on the tracker.

Routing is by exception code **+ context**: `&h29`/`&h23` are the class regardless of site (code alone routes them); `&hec` is the init-race epic only when it's `init()` + `m.global.constants` — bare `&hec` elsewhere is an ordinary scoped null-deref (that asymmetry is why the config gates `&hec` on function + snippet too).

## ⚠️ The 7-day dashboard window

Roku's analytics dashboard retains only **7 days** of crash backtraces, one click per crash line-item, no bulk export. Enrichment must happen **within the report's window**. Whenever you ask the user to pull a backtrace, give the exact `<basename>.brs:<line>` **and** `date`, and only for crashes inside the current report window — anything older can never be enriched (file it unenriched, or hold it).

## Inputs

`$ARGUMENTS`: a path to the CSV, a path to a Roku zip (multiple CSVs + unrelated files tolerated via header filtering), or pasted CSV text. Threshold overrides: `--min-devices N` (default 2), `--min-dates N` (default 2). Either threshold met files the crash; both must fail to skip it.

## Step 0 — Preflight

1. **Labels exist**: `gh label list --search crash`, `--search known-issue`, `--search epic`. Create any missing:
   - `gh label create crash --color e11d48 --description "Filed by /crash-report from Roku's weekly crash report"`
   - `gh label create known-issue --color cccccc --description "Long-running known bug — tracked but deprioritized"`
   - `gh label create epic --color 5319e7 --description "Architectural class tracker — /crash-report aggregates crashlog evidence here"`
2. **Deps**: `ls node_modules/source-map/source-map.js && ls node_modules/adm-zip/package.json`; `npm install` if missing.
3. **Epics seeded**: the `aggregate` patterns in `known-noise.yml` must reference real epic issues. If the two architectural-class patterns are still commented out (unseeded), seed them first (see [`docs/dev/crash-reports.md`](../../../docs/dev/crash-reports.md) → "Seeding the epics"), then uncomment them and fill each `tracker_issue`.
4. **Working tree**: dirty is fine (the build uses `git worktree`); mention uncommitted changes as a courtesy — don't block.

## Step 1 — Stage (no GitHub writes)

```bash
WS=$(mktemp /tmp/crash-report-worksheet.XXXXXX.json)   # NOTE: no --suffix — mktemp rejects --suffix unless the template ends in X
node scripts/crash-report.js stage --input "$ARGUMENTS" --plan-out "$WS"
```

The helper parses/filters the CSV, groups by signature, applies the threshold, builds each cited version in a temporary worktree, source-maps `pkg:/…brs:N` back to `.bs:N`, runs the GH dedup search, and annotates each above-threshold crash with a `mechanismHint` (`task-launch` / `network` / `other`). Every crash starts `pending` / `needs-backtrace` — nothing files or aggregates without a pasted backtrace (the exception code decides the disposition and lives only in the backtrace). The `mechanismHint` does **not** authorize a file; it only **orders** which crashes to pull first. Expect ~30–90s per unique cited version.

## Step 2 — Render the worksheet

Read `$WS`. Render: (1) an **input summary** (kind, source, CSVs found, ignored files, window dates, total rows, unique signatures, above/below threshold); (2) an **action table**, one row per above-threshold crash with signature → source, function, mechanism, crashes, devices, dates, dedup match — **ordered by `mechanismHint`** (task-launch / network first, then other); (3) the **filtered-out** rows (below threshold) with the reason; (4) any **build errors**, surfaced prominently (affected rows resolve to `—`).

Every above-threshold crash needs a pasted backtrace before it can be filed or aggregated — you can't know from the CSV + code alone whether a crash is a scoped bug or an architectural class (even an ordinary-looking line can be a compute-bound `&h23` timeout). The `mechanismHint` only tells you what to pull *first*: `task-launch` / `network` sites are the likeliest architectural classes (`&h29` / `&h23`); `other` sites are likeliest scoped bugs — but all of them get confirmed by a backtrace, never a guess.

## Step 3 — Enrich (no GitHub writes)

For every `needs-backtrace` row, tell the user the exact `<basename>.brs:<line>` on `<date>` to open in Roku's dashboard ("View report → Backtrace") and paste back — remind them of the 7-day window. Batch is fine: collect the pastes (as `@file` refs or inline), save each to a temp file, then:

```bash
node scripts/crash-report.js enrich --worksheet "$WS" <backtrace1.txt> [<backtrace2.txt> ...]
```

`enrich` extracts each `&hNN`, source-maps the frames, and routes each crash: `&h29`/`&h23`/`&hec`-init → `aggregate` (marked for its epic, will NOT be filed standalone); anything else → `file` (its issue body gets the backtrace appended so it's born complete). One representative backtrace per signature is enough — the code is stable per site; you don't need one per date. Re-read `$WS` and re-render the table with the now-known `disposition` + exception code.

## Step 4 — Confirm dispositions (human gate)

Present the final plan: which enriched crashes will **file** (new issues), which will **aggregate** (→ which epic), which are still un-enriched and will therefore be **held** (never filed without a backtrace — the `file` phase skips them), and any below-threshold skips. Use AskUserQuestion: proceed / adjust thresholds & re-stage / hold specific rows. Nothing has hit GitHub yet.

## Step 5 — File (GitHub writes)

```bash
node scripts/crash-report.js file --worksheet "$WS"
```

`file` creates/comments/reopens the `file` crashes, and for each `aggregate` crash upserts one flat record comment onto its epic — creating a new comment, or editing the existing record when its `file·function·line·version` key is already present (accumulating occurrences, never duplicating; a no-op edit is skipped). It writes a run-summary handoff to `.claude/handoffs/crash-report-<timestamp>.md`.

## Step 6 — Surface the summary

Read the handoff and recap: N filed (#…), N commented, N reopened, N aggregated to epics (#…), N suppressed, N skipped. Call out any per-action errors for manual retry. **Next**: per-crash deep dive on a filed issue → `/issue-triage <N>`. Clean up the worksheet: `rm "$WS"`.

## When NOT to use

- A single developer-device `.text` crashlog → `/runtime-triage`.
- A single manually-filed GH crash issue → `/issue-triage <N>`.
- A CI failure log → `/ci-triage <run-id>`.

## Cron / weekly cadence

Idempotent: re-running the whole flow on the same report re-files nothing (dedup short-circuits) and re-upserts epic records to the same comments (no-op edits skipped). Prefer one run per fresh weekly report — and run it promptly, because the 7-day backtrace window closes.

## Sub-agent invocation

To invoke from a parent sub-agent: parent passes `Read .claude/skills/crash-report/SKILL.md and run the stage → enrich → file flow for input <path>; render the worksheet, gather pasted backtraces for the needs-backtrace rows, confirm dispositions, file, and surface the summary path` in the Task prompt.
