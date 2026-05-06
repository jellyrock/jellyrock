---
name: ci-triage
description: Triage a JellyRock CI failure (failed GitHub Actions workflow run). The skill (sonnet) does mechanical prep — fetches the run via gh, identifies which job/step failed, extracts the failure tail, classifies the category (lint-fail / build-fail / device-test-fail / docs-stale-blocking / language-coverage-fail), and assembles initial file context — then delegates to the ci-investigator agent (opus) for root-cause analysis and either a semi-auto fix or 2-3 tradeoff'd options. Use when a CI workflow failed on a PR or on main and you want a focused investigation.
model: sonnet
user-invocable: true
allowed-tools: Bash(gh run view:*), Bash(gh run list:*), Bash(git log:*), Bash(git diff:*), Bash(git ls-files:*), Read, Grep, Task
---

# /ci-triage `<run-id>` — investigate a failing CI run

Mechanical prep for the [`ci-investigator`](../../agents/ci-investigator.md) agent. Takes a GitHub Actions run ID (or a full run URL — extract the trailing number), fetches the failure detail via `gh`, classifies the category, builds initial file context, and hands off.

## Inputs

`$ARGUMENTS`: required run ID or URL (e.g., `1234567890` or `https://github.com/jellyrock/jellyrock/actions/runs/1234567890`). If empty, prompt or list recent failures: `gh run list --status failure --branch <current> --limit 5`.

If the input is a URL, extract the run-id (`/runs/(\d+)`).

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

```markdown
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

## Step 7 — Delegate to ci-investigator

```text
You are the ci-investigator agent. The /ci-triage skill has done the
mechanical prep below. Validate the diagnosis, identify root cause, and
either implement a semi-auto fix (stop before commit) or present 2-3
tradeoff'd options if architectural — per your operating contract. Do
NOT re-fetch via gh — the prep is authoritative.

<handoff packet>
```

Invoke via the Task tool with `subagent_type: ci-investigator`.

## When NOT to use

- The run is in-progress — wait for it to complete.
- The run succeeded — there's nothing to triage.
- The failure is a transient infra issue (GitHub Actions outage, runner unavailable) — re-run the workflow first; only triage code if the failure repeats.
- The pasted text is a Roku log, not a CI log → use `/runtime-triage`.
- The failure is a docs-stale-blocking and the fix is mechanical (just bump `last-reviewed` because no shape change occurred) → fix directly without invoking `/ci-investigator`.

## Sub-agent invocation

To invoke from a parent sub-agent: parent passes `Read .claude/skills/ci-triage/SKILL.md and follow the steps for $ARGUMENTS=<run-id>; build the handoff packet but do NOT delegate to ci-investigator — surface the packet for review` in the Task prompt.
