---
name: ci-triage
description: Triage a JellyRock CI failure (failed GitHub Actions workflow run) end-to-end. Fetches the run via gh, identifies which job/step failed, extracts the failure tail, classifies the category (lint-fail / build-fail / device-test-fail / docs-stale-blocking / language-coverage-fail), assembles initial file context, writes a handoff packet to `.claude/handoffs/`, and continues into the investigation contract at sibling [`INVESTIGATION.md`](INVESTIGATION.md). Dedup-first: a recent unchanged triage on the same run-id (cited files unchanged) short-circuits to the existing handoff. Use when a CI workflow failed on a PR or on main.
model: opus
effort: high
user-invocable: true
allowed-tools: Bash(gh run view:*), Bash(gh run list:*), Bash(git log:*), Bash(git diff:*), Bash(git ls-files:*), Bash(git status:*), Bash(git rev-parse:*), Bash(date:*), Bash(ls:*), Read, Write, Grep
---

# /ci-triage `<run-id>` — investigate a failing CI run

Single-file workflow: prep + investigation, end-to-end on opus, in main thread, no Task delegation. The mechanical prep (Steps 1-6) produces a handoff packet that's written to `.claude/handoffs/` for cross-session resume + compaction recovery + `/catchup` discovery. The investigation contract is in sibling [`INVESTIGATION.md`](INVESTIGATION.md) and is followed in main thread once Step 6 completes.

## Contract

**Goal.** Take a failing CI run and drive it from "red" to root-caused end-to-end, in one main-thread session. The mechanical prep — fetch the run, find the failed job/step, extract the failure tail, classify the category (lint-fail / build-fail / device-test-fail / docs-stale-blocking / language-coverage-fail), and assemble initial file context — feeds the investigation contract in sibling `INVESTIGATION.md`. It runs on Opus because classifying an unfamiliar failure tail and mapping it to the right code area is genuine diagnostic judgment over real build/test output, not template fill — a misclassified failure sends the fix the wrong way. It is dedup-first: a CI run-id is immutable, so a recent unchanged triage on the same run-id (cited files untouched) short-circuits to the existing handoff. Reach for it when a CI workflow failed on a PR or on `main`.

**Inputs.** `$ARGUMENTS` is the required run ID or URL (e.g., `1234567890` or a full `/actions/runs/<id>` URL — extract the run-id from `/runs/(\d+)`); if empty, prompt or list recent failures with `gh run list --status failure --branch <current> --limit 5`. The skill reads the run and its failed-step logs via `gh run view`, the codebase and recent diffs via `git`, and any prior handoff at `.claude/handoffs/ci-<run-id>-*.md` for the dedup check.

**Outputs.** A handoff packet written to `.claude/handoffs/ci-<run-id>-<timestamp>.md` with YAML frontmatter (`created`, `target`, `branch`, `sha`, `cited-files`) and a body carrying the classification, failed step, 2-5 cited initial-context files, and the failure tail (last 50-100 lines of the failed step) — durable for cross-session resume, compaction recovery, and `/catchup` discovery; a one-line confirmation of the saved path, classification, failed step, and file count; and then the in-thread investigation per `INVESTIGATION.md`. On a clean dedup hit, no new file is written — the prior handoff is surfaced with resume/re-triage/cancel options.

**Success criteria.**

- The dedup check runs first and short-circuits correctly: both signals clean (cited files untouched, working tree clean for them) → surface the prior handoff and STOP for the user's pick; any signal changed → proceed.
- The failed job and step are correctly identified (walk `.jobs[]`/`.steps[]` for `conclusion == "failure"`); in-progress runs and succeeded runs are surfaced and stopped on, not triaged.
- The failure is classified by step name first, then by failure-tail content when the step name doesn't match a known shape; genuinely unmatched failures classified `unknown` for the investigator.
- The failure tail keeps the diagnostic region (last ~50-100 lines plus extra context above a stack trace) and drops the setup boilerplate.
- The handoff is written with valid frontmatter, then the skill continues immediately into `INVESTIGATION.md` as one motion.

**Failure modes to avoid.**

- **Re-prepping over a clean dedup hit.** If both signals are clean, do not write a new file — surface the prior handoff and wait for the user's pick.
- **Triaging an in-progress or succeeded run.** Wait for completion; `/ci-triage` is for failures only.
- **Capturing the wrong log region.** Drop the workflow-setup/checkout/npm-install boilerplate; keep the diagnostic tail (and 5-10 lines above a named error or stack trace).
- **Forcing a classification.** When neither the step name nor the tail content matches a known shape, classify `unknown` rather than guessing wrong.
- **Triaging transient infra failures.** If the failure is a GitHub Actions outage / runner-unavailable, re-run first; only triage code if it repeats.
- **Stopping after the handoff.** Step 7 is "save the handoff AND continue into investigation" as one motion; don't write the file and wait.

**When NOT to use.**

- The run is in-progress — wait for it to complete.
- The run succeeded — there's nothing to triage.
- The failure is a transient infra issue (Actions outage, runner unavailable) — re-run first; triage code only if it repeats.
- The pasted text is a Roku runtime log, not a CI log — use `/runtime-triage`.
- The failure is a docs-stale-blocking whose fix is purely mechanical (bump `last-reviewed`, no shape change) — fix directly without the investigation contract.

## Implementation

### Inputs

`$ARGUMENTS`: required run ID or URL (e.g., `1234567890` or `https://github.com/jellyrock/jellyrock/actions/runs/1234567890`). If empty, prompt or list recent failures: `gh run list --status failure --branch <current> --limit 5`.

If the input is a URL, extract the run-id (`/runs/(\d+)`).

### Step 0 — Check for prior triage (dedup)

Before any prep, look for a recent handoff on this run-id:

```bash
ls -t .claude/handoffs/ci-<run-id>-*.md 2>/dev/null | head -1
```

If a prior handoff exists, `Read` it. The handoff has a YAML frontmatter with `created`, `branch`, `sha`, `cited-files`. The run-id itself is immutable (CI runs don't change), so check two signals:

1. **Cited files unchanged?** `git log <sha>..HEAD -- <cited-files>` — empty output means no commits touched them on this branch.
2. **Working tree clean for cited files?** `git status --porcelain -- <cited-files>` — empty means no uncommitted changes.

If both are clean, **do not write a new file**. Surface to the user:

> Prior CI triage exists at `.claude/handoffs/ci-<run-id>-<timestamp>.md` from <relative-time>. Cited files unchanged since then. Options:
> - **(a) Resume from the existing triage** — Read the handoff and follow [`INVESTIGATION.md`](INVESTIGATION.md) from there
> - **(b) Re-triage anyway** — fresh prep (use this if a re-run of the workflow produced different output)
> - **(c) Cancel**

Then **STOP**. Wait for the user's pick before proceeding.

If any signal shows change (or no prior handoff exists), proceed to Step 1.

### Step 1 — Fetch the run

```bash
gh run view <run-id> --json status,conclusion,name,event,headBranch,jobs,createdAt,htmlUrl
```

If the run is still in-progress, surface that and stop — there's nothing to triage yet. If the run succeeded, surface that too — `/ci-triage` is for failures.

Find the failed job(s) by walking `.jobs[]` and filtering `conclusion == "failure"`. Each job has `.steps[]` — find the failed step (also `conclusion == "failure"`).

### Step 2 — Extract the failure tail

```bash
gh run view <run-id> --log-failed --job <job-id>
```

This streams the failed step's log. Capture the last ~50-100 lines — that's where the diagnostic message lives. Drop the leading boilerplate (workflow setup logs, git checkout, npm install) — the user doesn't need them.

If the failure shows a stack trace or named diagnostic, capture 5-10 extra lines of context above the error line.

### Step 3 — Classify

Match the failed step's name + the failure tail to a category:

| Failed step name | Category |
|---|---|
| `lint`, `lint:*`, `check-formatting`, `validate`, `format:check` | `lint-fail` |
| `build`, `build:*` | `build-fail` |
| `test:tdd`, `test:unit`, `test:integration`, `test:all`, `device-tests` | `device-test-fail` |
| `lint:docs`, `docs:check`, `docs-stale*` | `docs-stale-blocking` (or `lint-fail` if it's a docs-check broken-ref, not a stale-blocking) |
| `lint:language-coverage`, `language-coverage` | `language-coverage-fail` |
| `lint:translations` | `lint-fail` (translations subcategory) |

If the step name doesn't match a known shape, use the failure-tail content to classify:

- `BRIGHTSCRIPT_ERR_*`, BSC errors → likely `build-fail` or `lint-fail`
- `[Rooibos Result]: FAIL` → `device-test-fail`
- `stale doc ... related-files` → `docs-stale-blocking`
- ESLint output → `lint-fail`

If still ambiguous, classify as `unknown` — the investigator will sort it out.

### Step 4 — Identify probable area

The failed step often points at the area:

- `lint:bs` / `validate` / `build` failures: the BSC error names file:line. The file path → area mapping is the same as `/runtime-triage`'s "Identify probable area" step (uses `pkg:/components/...` or `pkg:/source/...`).
- `lint:docs` failures: the validator's stdout names the broken doc + path.
- `device-test-fail`: the Rooibos output names the test file (`tests/source/unit/<area>/...`).
- `docs-stale-blocking`: names the stale architecture doc.

### Step 5 — Assemble initial file context

For the probable area, surface 2-5 files:

```bash
# Recent commits scoped to the failing file's area — regressions often
# correlate with a recent change
git log --oneline -10 -- <file-or-area>

# Diff between this branch and main (what's NEW vs the baseline)
git diff main...HEAD -- <file-or-area>
```

For test failures, include the test file + the SUT it tests.

### Step 6 — Build the handoff packet

Construct the packet with a YAML frontmatter (so future Step-0 dedup checks can read it) plus the prep body:

```markdown
---
created: <ISO-8601 UTC timestamp from `date -u +%Y-%m-%dT%H:%M:%SZ`>
target: ci-<run-id>
branch: <git rev-parse --abbrev-ref HEAD>
sha: <git rev-parse --short HEAD>
cited-files:
  - <path-1>
  - <path-2>
---

CI failure
Run: <run-id> (<workflow name>)
Branch: <branch>
Triggered by: <event>
URL: <htmlUrl>

Classification: <category>
Failed step: <step name>
Initial file context:
  - <path>:<line range or whole-file> — <one-line why-relevant>
  - ...

Failure tail (last 50-100 lines of the failed step):

  <log excerpt>
```

### Step 7 — Write the handoff and continue into investigation

1. Compute the timestamp: `date +%Y%m%d-%H%M%S` (filename) and `date -u +%Y-%m-%dT%H:%M:%SZ` (frontmatter).

2. Write the packet to `.claude/handoffs/ci-<run-id>-<YYYYMMDD-HHMMSS>.md`.

3. Output a single confirmation line, this exact shape:

   > Handoff saved: `.claude/handoffs/ci-<run-id>-<timestamp>.md` (classification: <X>, failed step: <step>, <count> files cited). Now following [`INVESTIGATION.md`](INVESTIGATION.md) — adjust scope freely.

4. Then **continue immediately** into the investigation contract at sibling [`INVESTIGATION.md`](INVESTIGATION.md). Don't stop or wait.

## Sub-agent invocation

To invoke from a parent sub-agent (rare): parent passes `Read .claude/skills/ci-triage/SKILL.md and follow Steps 0-7 for $ARGUMENTS=<run-id>; write the handoff file but stop before INVESTIGATION.md — surface the handoff path so the parent can decide next` in the Task prompt. Sub-agents only run the prep; they don't follow INVESTIGATION.md (which is interactive). If you discover any decisions or followups during this work, surface them at the end of your report as a `Captures for /log` section. I'll invoke /log for each. Do not write to docs/ directly.
