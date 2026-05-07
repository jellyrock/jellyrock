---
name: ci-triage
description: Triage a JellyRock CI failure (failed GitHub Actions workflow run) end-to-end. Fetches the run via gh, identifies which job/step failed, extracts the failure tail, classifies the category (lint-fail / build-fail / device-test-fail / docs-stale-blocking / language-coverage-fail), assembles initial file context, writes a handoff packet to `.claude/handoffs/`, and continues into the investigation contract at sibling [`INVESTIGATION.md`](INVESTIGATION.md). Dedup-first: a recent unchanged triage on the same run-id (cited files unchanged) short-circuits to the existing handoff. Use when a CI workflow failed on a PR or on main.
model: opus
user-invocable: true
allowed-tools: Bash(gh run view:*), Bash(gh run list:*), Bash(git log:*), Bash(git diff:*), Bash(git ls-files:*), Bash(git status:*), Bash(git rev-parse:*), Bash(date:*), Bash(ls:*), Read, Write, Grep
---

# /ci-triage `<run-id>` — investigate a failing CI run

Single-file workflow: prep + investigation, end-to-end on opus, in main thread, no Task delegation. The mechanical prep (Steps 1-6) produces a handoff packet that's written to `.claude/handoffs/` for cross-session resume + compaction recovery + `/catchup` discovery. The investigation contract is in sibling [`INVESTIGATION.md`](INVESTIGATION.md) and is followed in main thread once Step 6 completes.

## Inputs

`$ARGUMENTS`: required run ID or URL (e.g., `1234567890` or `https://github.com/jellyrock/jellyrock/actions/runs/1234567890`). If empty, prompt or list recent failures: `gh run list --status failure --branch <current> --limit 5`.

If the input is a URL, extract the run-id (`/runs/(\d+)`).

## Step 0 — Check for prior triage (dedup)

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

## Step 1 — Fetch the run

```bash
gh run view <run-id> --json status,conclusion,name,event,headBranch,jobs,createdAt,htmlUrl
```

If the run is still in-progress, surface that and stop — there's nothing to triage yet. If the run succeeded, surface that too — `/ci-triage` is for failures.

Find the failed job(s) by walking `.jobs[]` and filtering `conclusion == "failure"`. Each job has `.steps[]` — find the failed step (also `conclusion == "failure"`).

## Step 2 — Extract the failure tail

```bash
gh run view <run-id> --log-failed --job <job-id>
```

This streams the failed step's log. Capture the last ~50-100 lines — that's where the diagnostic message lives. Drop the leading boilerplate (workflow setup logs, git checkout, npm install) — the user doesn't need them.

If the failure shows a stack trace or named diagnostic, capture 5-10 extra lines of context above the error line.

## Step 3 — Classify

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

## Step 4 — Identify probable area

The failed step often points at the area:

- `lint:bs` / `validate` / `build` failures: the BSC error names file:line. The file path → area mapping is the same as `/runtime-triage`'s Step 3 (uses `pkg:/components/...` or `pkg:/source/...`).
- `lint:docs` failures: the validator's stdout names the broken doc + path.
- `device-test-fail`: the Rooibos output names the test file (`tests/source/unit/<area>/...`).
- `docs-stale-blocking`: names the stale architecture doc.

## Step 5 — Assemble initial file context

For the probable area, surface 2-5 files:

```bash
# Recent commits scoped to the failing file's area — regressions often
# correlate with a recent change
git log --oneline -10 -- <file-or-area>

# Diff between this branch and main (what's NEW vs the baseline)
git diff main...HEAD -- <file-or-area>
```

For test failures, include the test file + the SUT it tests.

## Step 6 — Build the handoff packet

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

## Step 7 — Write the handoff and continue into investigation

1. Compute the timestamp: `date +%Y%m%d-%H%M%S` (filename) and `date -u +%Y-%m-%dT%H:%M:%SZ` (frontmatter).

2. Write the packet to `.claude/handoffs/ci-<run-id>-<YYYYMMDD-HHMMSS>.md`.

3. Output a single confirmation line, this exact shape:

   > Handoff saved: `.claude/handoffs/ci-<run-id>-<timestamp>.md` (classification: <X>, failed step: <step>, <count> files cited). Now following [`INVESTIGATION.md`](INVESTIGATION.md) — adjust scope freely.

4. Then **continue immediately** into the investigation contract at sibling [`INVESTIGATION.md`](INVESTIGATION.md). Don't stop or wait.

## When NOT to use

- The run is in-progress — wait for it to complete.
- The run succeeded — there's nothing to triage.
- The failure is a transient infra issue (GitHub Actions outage, runner unavailable) — re-run the workflow first; only triage code if the failure repeats.
- The pasted text is a Roku log, not a CI log → use `/runtime-triage`.
- The failure is a docs-stale-blocking and the fix is mechanical (just bump `last-reviewed` because no shape change occurred) → fix directly without invoking the investigation contract.

## Sub-agent invocation

To invoke from a parent sub-agent (rare): parent passes `Read .claude/skills/ci-triage/SKILL.md and follow Steps 0-7 for $ARGUMENTS=<run-id>; write the handoff file but stop before INVESTIGATION.md — surface the handoff path so the parent can decide next` in the Task prompt. Sub-agents only run the prep; they don't follow INVESTIGATION.md (which is interactive).
