---
topic: crash-reports
related-files:
  - scripts/crash-report.js
  - bsconfig-analysis.json
  - .crash-report/known-noise.yml
  - .claude/skills/crash-report/SKILL.md
  - tests/scripts/unit/crash-report.test.js
last-reviewed: 2026-07-22
---

# Weekly Roku crash-report workflow

Roku emails the JellyRock developers an aggregate "Crash Reporting" CSV every week (window: the last 7 days). Each row is a unique crash signature with occurrence counts, distinct-device counts, OS release, app version, and a `pkg:/path/file.brs(line)` reference. The [`/crash-report`](../../.claude/skills/crash-report/SKILL.md) skill turns each above-threshold unique crash into tracked GitHub state so nothing falls through the cracks.

This page documents the workflow for human contributors. The skill documents the agent-facing steps.

## The core shape: enrich before file (`stage → enrich → file`)

The weekly CSV carries only the crashing function signature — **not the exception code**. But the exception code is exactly what decides whether a crash is a scoped bug, a big-library "too many task threads" crash, or a render-thread execution timeout. That code lives only behind Roku's per-crash dashboard backtrace (7-day window, one click each, no bulk export). So filing straight off the CSV means filing *before* you know what a crash is — and walking back the architectural-class noise afterward.

The workflow reorders around that reality:

1. **`stage`** — parse/filter the CSV, group by signature, apply the threshold, build the cited version(s), source-map `pkg:/…brs:N → .bs:N`, run the GH dedup search, and write a local **worksheet**. Every above-threshold crash starts `pending`; a mechanism hint (`task-launch` / `network` / `other`) only *orders* which to pull first — it never authorizes a file. No GitHub writes.
2. **`enrich`** — paste the dashboard backtraces; the helper extracts each `&hNN`, source-maps the frames, and routes each crash to its disposition. No GitHub writes.
3. **`file`** — perform the GitHub writes: enriched scoped bugs become issues, enriched architectural-class crashes upsert onto their epic. Crashes still unenriched are **held, never filed** — the exception code decides the disposition and lives only in the backtrace, so nothing is filed on a guess (even an ordinary-looking line can be a compute-bound `&h23` timeout).

## The three dispositions

The routing table is [`.crash-report/known-noise.yml`](../../.crash-report/known-noise.yml). Every above-threshold crash routes to exactly one:

| Disposition | Meaning | What happens |
|---|---|---|
| **`file`** | A real, small-scoped bug | New per-signature `[crash]` issue, born enriched (backtrace + exception + source frames) |
| **`aggregate`** | A known architectural class you intend to fix, no small fix exists | One flat record comment per `file·function·line·version` **upserted** onto the class **epic** — never a standalone issue |
| **`watch`** | Accepted noise we won't fix | Counted; silent unless a spike crosses `baseline × multiplier`, then one comment on the tracker |

Anything that matches no pattern is `file`.

### Routing is by exception code **+ context**

`&h29` (too many task threads) and `&h23` (execution timeout) *are* their architectural class regardless of which code site they surface at — so their patterns route on `exception_code` alone. `&hec` ('Dot' operator on an invalid reference) is different: it's the themed-init race **only** when it's `init()` accessing `m.global.constants` (issue #103's class). Bare `&hec` anywhere else is an ordinary scoped null-deref (e.g. caption VTT parsing). That asymmetry is why the init-race pattern gates `&hec` on `function` + `snippet_regex` too. The tool never assumes two different crash *lines* are "the same crash whose line moved" — that's a human call after investigation; distinct records stay distinct on the epic.

## The architectural epics (`aggregate` model)

An epic is a GitHub issue labeled `epic` that holds the **problem statement** (human-owned body) plus **crashlog evidence** (machine-appended record comments). Each unique crash record is one flat comment keyed by a hidden marker `<!-- crashlog-record: v1 key=file|function|line|version -->` with an embedded JSON data block (the source of truth) and rendered markdown derived from it. On each run the `file` phase either creates the comment or edits the existing one (merging occurrence stats, never duplicating; a no-op edit is skipped). The machine only ever rewrites comments it owns — it never touches the epic body you author by hand.

Current epics:

- **`&h29` — big libraries / too-many-task-threads.** Roku caps concurrent SceneGraph Task threads; a very large library saturates the pool and the next `.control = "RUN"` (any of ~25 sites) throws. The fix is architectural (a task budget / back-pressure), not per-site.
- **`&h23` — render-thread execution timeouts.** Roku kills a render-thread callback that runs too long. Always our thread taking too long — trigger is a blocking call *or* heavy synchronous compute (the common case here, since API runs on the task pool) — reframed from "server timeouts" per real crash evidence (ADR 0024). Distinct from "unexpected / malformed server response" crashes (`&h18` etc.) — those are scoped bugs.
- **`&hec` + `init()` + `m.global.constants` — themed-component init race** (issue #103, promoted from a `watch` tracker to an `aggregate` epic).

### Seeding the epics

The two architectural-class patterns ship **commented out** in `known-noise.yml` until their epic issues exist (a pattern pointing at a non-existent issue would fail loud — `tracker_issue` must be a positive integer). One-time seed:

```bash
gh label create epic --color 5319e7 --description "Architectural class tracker — /crash-report aggregates crashlog evidence here"
gh issue create --label epic,bug,crash --title '[epic] Large libraries crash the app — "Too many task threads" (&h29)' --body-file <problem-statement.md>
gh issue create --label epic,bug,crash --title '[epic] Render-thread execution timeouts crash the app — `Execution timeout` (&h23)' --body-file <problem-statement.md>
```

Then uncomment the two patterns in `known-noise.yml` and fill each `tracker_issue` with the new issue number. The `&hec` init-race pattern is already active (tracker #103).

## Known-noise `watch` patterns + spike detection

A `watch` pattern is accepted noise the team lives with. Matched signatures are suppressed (no issue, no comment) and shown in the run summary under "Suppressed (known noise)". When the combined count across matched signatures exceeds `baseline_crashes_per_week × spike_multiplier`, the skill posts ONE spike comment to the tracker — it does **not** reopen (the human decides).

### Config schema

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
      function: <regex>               # e.g. ^init$
      category: <one-of>              # global-state-race | null-node-ref | ...
      file_glob: [components/ui/**]   # list of globs, any-match
      snippet_regex: <regex>          # gate against the code snippet
```

First-match wins. Empty/omitted match fields are wildcards. Because `exception_code` comes from the backtrace, a code-gated pattern only matches during `enrich` — during `stage` (CSV-only) such crashes stay `needs-backtrace`.

## The 7-day dashboard window

Roku's dashboard retains only **7 days** of backtraces, one click per crash line-item, no bulk export. Enrichment must happen within the report's window. When the skill asks you to pull a backtrace it gives the exact `<basename>.brs:<line>` + `date`; anything older than 7 days can never be enriched (file it unenriched, or hold it).

## Threshold (default: file when ≥2 devices OR ≥2 distinct dates)

A crash is above threshold when **either** max-devices-on-any-date ≥ 2 (a "wide" crash) **or** distinct-dates ≥ 2 (a "persistent" crash). Override with `--min-devices N` / `--min-dates N`; file everything with `--min-devices 1 --min-dates 1`.

## The dashboard backtrace format

The per-crash "View report → Backtrace" export is a TSV whose backtrace cell uses `~~` as a flattened newline separator; the exception code is in the first line:

```text
~~Too many task threads (runtime error &h29) in pkg:/components/.../WebSocketClientTask.brs(14) ~~Backtrace: ~~#0  Function init() As $1 file/line: pkg:/.../WebSocketClientTask.brs(15) ~~Local Variables: ~~global  Interface:ifGlobal ~~m  roAssociativeArray refcnt=2 count:2 ~~
```

`normalizeBacktraceText` accepts three interchangeable shapes: the dashboard TSV row, the plaintext "View report → Backtrace" page, and already-`~~`-separated cell text. Roku redacts collection contents (only `refcnt`/`count` shown), so dumping the block into a public issue is safe.

## Issue shape (scoped `file` bugs)

- **Title**: `[crash] <function>() in <basename>.brs:<line> (v<version>)` — deterministic so dedup is reliable across runs.
- **Body**: matches [`bug_report.yml`](../../.github/ISSUE_TEMPLATE/bug_report.yml) headers; includes resolved source location, code snippet, occurrence stats, the appended backtrace (once enriched), and a pointer to `/issue-triage <N>`.
- **Labels**: `bug`, `crash`.

## Dedup behavior (`file` disposition)

Per-signature search: `gh issue list --state all --search "<basename>.brs:<line>" in:title`, filtered to `[crash]`-prefixed titles. No match → `create`; open match → `comment` (new occurrences); closed match → `reopen` + regression comment.

## One-time setup

```bash
gh label create crash --color e11d48 --description "Filed by /crash-report from Roku's weekly crash report"
gh label create known-issue --color cccccc --description "Long-running known bug — tracked but deprioritized"
gh label create epic --color 5319e7 --description "Architectural class tracker — /crash-report aggregates crashlog evidence here"
```

The skill's preflight checks all three and prints the missing commands.

## What the workflow can't do

- **Specific device models / users** — not in Roku's aggregate report.
- **Reproduce the crash** — telemetry says where, not why. Run `/issue-triage <N>` after filing.
- **Crashes from intermediate (untagged) commits** — the manifest version doesn't bump per commit; the script falls back to the highest `v<major>.<minor>.*` tag and notes the inexact match.
- **Source maps for shipped builds** — prod ships without them; the script rebuilds the tagged version locally with a `bsconfig-analysis.json` mirroring prod to recover the mapping.
- **Enrich a crash older than 7 days** — the dashboard window has closed.

## When the build step fails

If `npm ci` / `bsc` fails in the worktree, affected signatures get an unresolved source location (issue body says so, shows the transpiled `file:line`), and the build errors appear in the run summary. Common causes: a tag too old for `bsconfig-prod.json`, a dep mismatch, or a transient registry hiccup.

## Legacy: per-issue enrichment (deprecated)

The old flow filed issues from the CSV first and enriched each one afterward via the standalone `/crash-backtrace` skill. That skill is [deprecated](../../.claude/skills/crash-backtrace/SKILL.md) — enrichment now happens inside `/crash-report`'s `enrich` phase, before filing. The `enrich-issue` script subcommand still exists as an escape hatch for a pre-migration already-filed issue:

```bash
node scripts/crash-report.js enrich-issue --issue <N> --backtrace-file <path>
```

## Tests

The deterministic logic — CSV parse, grouping, threshold, backtrace parse, exception-code routing (`routeCrash`), epic record render/parse/merge/upsert, the file-phase disposition split — is covered by [`tests/scripts/unit/crash-report.test.js`](../../tests/scripts/unit/crash-report.test.js). Run with `npm run test:scripts`. The build + GH integration paths are exercised manually against a sample CSV.
