---
name: crash-backtrace
description: DEPRECATED — superseded by /crash-report's built-in `enrich` phase. The old flow filed crash issues first and enriched them one-by-one afterward; the new enrich-before-file flow (stage → enrich → file) pulls the dashboard backtrace BEFORE filing, so issues are born complete and architectural-class crashes route to their epic instead of becoming standalone issues. Do not invoke for new work — run /crash-report and paste backtraces during its enrich step. Retained only as a redirect; the `enrich-issue` script subcommand still exists as a legacy escape hatch for a pre-migration already-filed issue.
model: sonnet
effort: low
user-invocable: true
allowed-tools: Bash(node scripts/crash-report.js:*), Bash(gh issue view:*), Bash(gh issue comment:*), Read
---

# /crash-backtrace — DEPRECATED (use /crash-report's `enrich` phase)

This skill is deprecated. Backtrace enrichment now happens **inside** [`/crash-report`](../crash-report/SKILL.md), before filing, not as a separate follow-up after.

## Why

The old two-step flow (file issues from the CSV → then enrich each one from the dashboard) filed *before* the exception code was known, so architectural-class noise (too-many-task-threads, server timeouts) got filed as standalone issues and had to be walked back. The reordered `stage → enrich → file` flow folds the pasted backtraces in during `enrich`, extracts each `&hNN`, and routes every crash to its disposition (`file` / `aggregate` / `watch`) *before* any GitHub write. Issues are born complete; architectural classes upsert onto their epic. The dashboard-backtrace parser is shared — it's the same `scripts/crash-report.js` code both flows used.

## What to do instead

- **Processing a weekly report?** Run [`/crash-report <path>`](../crash-report/SKILL.md) and paste the dashboard backtraces during its **Step 3 — Enrich**.
- **Enriching a single pre-migration already-filed `[crash]` issue** (the only remaining niche)? The legacy script command still works directly:
  ```bash
  node scripts/crash-report.js enrich-issue --issue <N> --backtrace-file <path>
  ```

See [`docs/dev/crash-reports.md`](../../../docs/dev/crash-reports.md) for the dashboard click-through and the plaintext-backtrace shape.
