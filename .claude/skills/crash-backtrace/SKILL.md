---
name: crash-backtrace
description: Attach a multi-frame backtrace + locals snapshot to an already-filed crash issue. Roku's analytics dashboard only exposes backtraces one click at a time (no bulk export), so this is the realistic per-issue enrichment workflow that follows up after `/crash-report` files the issues. Accepts the backtrace via `@file` reference(s) OR inline paste in the prompt, with an OPTIONAL leading issue number — when omitted, the skill auto-resolves the matching `[crash]` issue from the backtrace's innermost frame signature (`<basename>:<line>`). Batch mode supported: `/crash-backtrace @file1 @file2 @file3` enriches each file's auto-resolved issue in sequence, paying the worktree build cost only once per cached version. Reads the issue's cited app version from the title, builds (or reuses a cached) git worktree, source-maps every backtrace frame back to its `.bs:line`, and posts ONE enrichment comment. Pre-enrichment classifier flags known-noise patterns — `timeout-one-off` (`Execution timeout` &h23 with exactly 1 occurrence; usually transient server/network blip), `timeout-recurring` (timeout class to escalate to /issue-triage), and `global-constants-init-race-suspect` (init() with the Dot-operator error &hec; belt-and-suspenders behind the /crash-report YAML filter for #103). For each flagged pattern the user picks: close-as-known-noise / enrich-anyway / abort. Worktree builds are cached at `/tmp/jellyrock-crash-wt-cache-<tag>` with a 1h TTL so consecutive enrichments on the same version cost ~1s after the first ~30-90s build.
model: sonnet
effort: low
user-invocable: true
allowed-tools: Bash(node scripts/crash-report.js:*), Bash(gh issue view:*), Bash(gh issue comment:*), Bash(gh issue close:*), Bash(gh issue reopen:*), Bash(mkdir:*), Bash(mktemp:*), Bash(rm:*), Bash(cat:*), Read, Write, Edit
---

# /crash-backtrace — enrich one filed crash issue with a dashboard backtrace

Single-issue follow-up to `/crash-report`. The orchestrating skill `/crash-report` files issues; `/crash-backtrace` enriches them with the multi-frame backtrace + local-variable snapshot Roku only exposes per-error in its analytics dashboard. See [`docs/dev/crash-reports.md`](../../../docs/dev/crash-reports.md) for the dashboard click-through and the plaintext-backtrace shape.

The mechanical work lives in [`scripts/crash-report.js`](../../../scripts/crash-report.js)'s `enrich-issue` subcommand. This skill orchestrates input handling (parse arg / read file / detect paste) and surfaces the result.

## Inputs

`$ARGUMENTS` shapes (parse the first integer token as the optional issue number; everything else is backtrace text or `@file` references):

| Shape | Example | What to do |
|---|---|---|
| File ref(s), no issue number | `/crash-backtrace @tasks/bt-1.txt @tasks/bt-2.txt` | **Batch mode.** For each file, Read it, auto-resolve the matching GH issue via `resolve-issue` (Step 1.5), then run the full classify + enrich loop (Steps 2–5). The worktree cache means after the first file's build, the rest are ~1s each. |
| Inline paste, no issue number | `/crash-backtrace\n\n'Execution timeout' (runtime error &h23) in pkg:/...` | Single backtrace. Write the pasted text to a temp file, auto-resolve via Step 1.5, then continue. |
| Issue number + file ref | `/crash-backtrace 582 @tasks/582-backtrace.txt` | Single backtrace, explicit issue. Skip Step 1.5 — use the provided number directly. |
| Issue number + inline paste | `/crash-backtrace 582\n\n'Type Mismatch' ...` | Same — single explicit, write paste to temp file. |
| Issue number only | `/crash-backtrace 582` | Ask the user to paste the backtrace text OR provide a file path in their next message. Don't proceed until you have backtrace text. |
| Nothing | `/crash-backtrace` | Ask the user how they want to invoke (file refs, inline paste, or explicit number + paste). |

The helper accepts three input shapes interchangeably — pass any of them as `--backtrace-file` and `normalizeBacktraceText` will route to the right path:

```text
# 1. Plaintext (dashboard "View report → Backtrace" page)
'<message>' (runtime error &h<hex>) in pkg:/<path>(<line>)
Backtrace:
#0  Function <name>(<args>) As <returnType> file/line: pkg:/<path>(<line>)
Local Variables:
<name>           <type> val:"<value>"

# 2. Dashboard TSV export ("Daily Error Key" view; tab-separated, `~~` inside cells)
Daily Error Key\tDate\tBacktrace Formatted\tBacktrace Text Formatted
<key>\t<date>\t...\t'<message>' (runtime error...)~~Backtrace:~~#0  Function ...~~...

# 3. Raw `~~`-separated cell (already-extracted Backtrace Text Formatted content)
```

For dashboard TSV input the helper takes the first data row's cell — multi-error TSVs belong on `plan --dashboard-csv`, not the single-issue subcommands. If the input matches none of these shapes, the helper exits with a parse error; surface its message to the user (they likely grabbed the wrong dashboard view).

**Anti-pattern**: don't accept `<N> @file1 @file2` (explicit number + multiple files). The number applies to one backtrace, not many. Error out asking the user to drop the explicit number OR pick a single file.

## Step 0 — Preflight

For each input that already carries an issue number (explicit form), confirm before doing anything else:

1. **Issue exists and has the `[crash]` shape.** `gh issue view <N> --json title,labels,state` — title must match `[crash] <fn>() in <basename>.brs:<line> (v<version>)`. The helper validates this too, but checking up front gives a clearer error than the helper's stderr.
2. **The `crash` label is present.** Same `gh issue view`. The helper refuses without it.

For auto-resolve inputs (no explicit number), preflight runs after Step 1.5 picks the issue.

## Step 1 — Locate the backtrace text(s)

Per the input shapes above, produce one or more `(issueNumberOrNull, backtraceFilePath)` pairs:

- **`@file` reference(s)**: pass the path straight through to the helper — no `Read` and no reformatting. `normalizeBacktraceText` accepts dashboard TSV, plaintext, and already-normalized cell shapes (see Inputs above). If the file is missing the helper exits with a clear stderr; relay it. Each file becomes one pair with `issueNumberOrNull = null` (unless an explicit number was passed alongside a single file).
- **Inline paste**: write the paste body (everything after the issue-number token, if any) to a temp file via the `Write` tool — name it `/tmp/crash-bt-<short-tag>.txt`. Strip surrounding markdown code fences. Single pair.
- **Nothing**: ask the user once for the backtrace text or file path, then wait. Don't loop.

In all cases, the final state is a list of pairs ready for Step 1.5.

## Step 1.5 — Auto-resolve the issue (only for pairs with `issueNumberOrNull = null`)

For each pair that doesn't have an explicit issue number, run:

```bash
node scripts/crash-report.js resolve-issue --backtrace-file <path>
```

The JSON output looks like:

```json
{
  "innermostFrame": { "function": "onprogresspercentagechanged", "pkgPath": "pkg:/components/video/OSD.brs", "line": 506 },
  "errorCode": "&h23",
  "errorMessage": "Execution timeout",
  "matches": [
    { "number": 583, "title": "[crash] onprogresspercentagechanged() in OSD.brs:506 (v2.17.0)", "state": "CLOSED" }
  ]
}
```

Branch on `matches.length`:

- **0 matches** — print: "No `[crash]` issue found for `<basename>:<line>`. Either run `/crash-report` first to file it, or pass the issue number explicitly: `/crash-backtrace <N> @<file>`." Skip this backtrace from the batch (don't abort other backtraces).
- **1 match, state = OPEN** — one-line confirm: "Auto-resolved to #N: `<title>` — proceeding." Use the number, continue to preflight.
- **1 match, state = CLOSED** — surface via `AskUserQuestion`: this might be a regression (signature reappeared in a fresh report) OR a one-off the team intentionally closed. Options: (a) reopen #N + enrich as a regression comment, (b) pass a different issue number explicitly, (c) skip this backtrace.
- **2+ matches** — surface every candidate via `AskUserQuestion` (number + truncated title + state); user picks which one. Also offer "skip this backtrace" and "pass a different number" options.

Don't auto-decide on closed matches — the user always picks. The recommendation in the question text is fine; the decision is theirs.

Once an issue number is locked for a pair, run **Step 0 preflight** against it before continuing. If preflight fails (wrong title shape, missing `crash` label), surface the error and skip this backtrace.

## Step 2 — (formerly: belt-and-suspenders parse check; now subsumed)

Step 3's `classify-backtrace` is the cheap pre-check — it parses the file (via `normalizeBacktraceText` + `parseBacktraceCell`), validates the shape, and runs without a worktree build. There's no value in doing a redundant regex scan from the skill: it would only catch the same parse failures the helper surfaces, and any handwritten shape-check would have to know about the three input shapes the helper now accepts.

Skip ahead to Step 3.

## Step 3 — Classify before enriching

Cheap pre-check (no worktree build) — surfaces known-noise patterns so the user can decide whether to enrich, close, or escalate. Run:

```bash
node scripts/crash-report.js classify-backtrace --issue <N> --backtrace-file <path-from-step-1>
```

The output is a single JSON document:

```json
{
  "issueNumber": 583,
  "issueState": "OPEN",
  "occurrenceCount": 1,
  "errorCode": "&h23",
  "errorMessage": "Execution timeout",
  "innermostFrame": { "function": "onprogresspercentagechanged", "pkgPath": "pkg:/...", "line": 506 },
  "classification": {
    "kind": "timeout-one-off",
    "reason": "Execution timeout (&h23) with exactly 1 occurrence...",
    "recommendedAction": "close-as-not-actionable"
  }
}
```

**If `classification` is `null`** — proceed straight to Step 4 (enrich).

**If `classification.kind` is set** — surface the classification + reason to the user, then ask via `AskUserQuestion` what to do. Each kind has a recommended action, but the user always has the final say:

| `kind` | Recommended action | Other choices |
|---|---|---|
| `timeout-one-off` | Close the issue as not-actionable with a comment ("one-off timeout — likely transient server/network blip; reopen if it recurs"). Do NOT enrich. | Enrich anyway (if user has signal it's a real bug), Abort |
| `timeout-recurring` | Enrich + escalate: post the backtrace, then suggest the user run `/issue-triage <N>`. | Abort |
| `global-constants-init-race-suspect` | Close as duplicate of #103 with a comment linking the tracker. Optionally update `.crash-report/known-noise.yml` if it's a new file pattern not yet matched (file_glob, snippet_regex). | Enrich anyway (if user has signal it's a different root cause), Abort |

For close-as-X actions: post the comment first (`gh issue comment <N> --body "..."`), then `gh issue close <N>`. Don't double-comment — one comment is enough.

For update-noise-yml: that's a deliberate edit to `.crash-report/known-noise.yml`. Surface the diff, ask for confirmation, then Edit.

## Step 4 — Run the helper

```bash
node scripts/crash-report.js enrich-issue --issue <N> --backtrace-file <path-from-step-1>
```

Surface the helper's log lines as they happen — the worktree-build messages (`creating worktree at v2.17.0`, `installing dependencies`, `building analysis output`) explain the ~30-90s wait. Cache-hit runs print `reusing cached worktree at ... (Ns old)` and finish in ~1s.

On success the helper prints `[crash-report] enriched #<N> with <K> backtrace frame(s)`.

On failure, the helper exits non-zero with a clear message — relay it verbatim. Common failure modes:

- **Title shape mismatch** (`Issue #N title doesn't match the [crash] shape`): the issue wasn't filed by `/crash-report`. Use `gh issue comment` manually instead.
- **Missing label** (`Issue #N is missing the 'crash' label`): same as above.
- **Parse failure** (`Could not parse backtrace text`): the input isn't the expected plaintext shape. Re-run Step 2's sanity check; the dashboard probably exported a different view.
- **Version resolution** (`Could not resolve version X.Y.Z to a git tag`): the issue cites a version that doesn't exist in `git tag`. Could be a typo in the title or an unreleased build.
- **Build failure** (npm/bsc error): the worktree build itself failed. Surface the helper's stderr; common cause is a tag too old to have `bsconfig-prod.json`. The cache for this tag was wiped — re-running won't help without a fix.

## Step 5 — Surface the comment URL

After success, fetch the latest comment URL so the user can click through:

```bash
gh issue view <N> --json comments --jq '.comments | last | .url'
```

Output a one-line confirmation: `Enriched #<N> — <comment-url>`. No further follow-up; the team gets to the data via the GH issue, not a local file.

## Worktree cache notes

Cached builds live at `/tmp/jellyrock-crash-wt-cache-<sanitized-tag>` and survive across invocations within 1h. To force a rebuild on the next call, run `node scripts/crash-report.js clean-cache` (wipes all cached worktrees) or just delete the specific cache dir.

The cache is keyed by the resolved tag, not the version string — so an exact-match version (`2.17.0` → `v2.17.0`) and a fallback-match version (`2.17.4` → `v2.17.0`) hit the same cache entry. Tag-immutability makes this safe.

## When NOT to use

- The issue wasn't filed by `/crash-report` (no `[crash]` title, no `crash` label) → comment manually with `gh issue comment <N>`.
- The crash already has multiple enrichment comments — re-enriching is harmless but creates visible noise.
- You want a *fix* for the crash, not just data → `/issue-triage <N>` instead.
- You don't have a backtrace yet → pull from Roku analytics first; this skill doesn't fetch.

## Sub-agent invocation

To invoke from a parent sub-agent: parent passes `Read .claude/skills/crash-backtrace/SKILL.md and follow Steps 0-5 to enrich GH issue #<N> with the backtrace at <path-or-paste>` in the Task prompt.
