---
name: crash-backtrace
description: "DEPRECATED, replaced by the `enrich` phase built into /crash-report. The old flow filed crash issues first and enriched them one by one afterward. The new flow (stage, then enrich, then file) pulls the dashboard backtrace before filing, so issues are born complete and architectural-class crashes go to their epic instead of becoming standalone issues. Do not invoke it for new work: run /crash-report and paste the backtraces during its enrich step. It stays only as a redirect; the `enrich-issue` script subcommand still exists as a legacy escape hatch for a crash issue filed before the change."
model: sonnet
effort: low
user-invocable: true
allowed-tools: Bash(node scripts/crash-report.js:*), Bash(gh issue view:*), Bash(gh issue comment:*), Read
---

# /crash-backtrace: deprecated (use the `enrich` phase of /crash-report)

This skill is deprecated. Backtrace enrichment now happens **inside** [`/crash-report`](../crash-report/SKILL.md), before filing, not as a separate step after.

## Why

The old two-step flow filed issues from the CSV first, then enriched each one from the dashboard. It filed *before* the exception code was known, so architectural-class noise (too many Task threads, server timeouts) got filed as standalone issues and had to be walked back. The reordered `stage → enrich → file` flow folds the pasted backtraces in during `enrich`, extracts each `&hNN`, and routes every crash to its disposition (`file`, `aggregate` or `watch`) *before* any GitHub write. Issues are born complete, and architectural classes upsert onto their epic. Both flows use the same parser for dashboard backtraces in `scripts/crash-report.js`.

## What to do instead

- **Processing a weekly report?** Run [`/crash-report <path>`](../crash-report/SKILL.md) and paste the dashboard backtraces during its **Step 3: Enrich**.
- **Enriching one `[crash]` issue filed before the change** (the only remaining niche)? The legacy script command still works directly:
  ```bash
  node scripts/crash-report.js enrich-issue --issue <N> --backtrace-file <path>
  ```

See [`docs/dev/crash-reports.md`](../../../docs/dev/crash-reports.md) for the dashboard click-through and the plain-text backtrace shape.
