---
name: issue-triage
description: Investigate a JellyRock GitHub issue end-to-end. Fetches the issue body and comments via gh, parses YAML-form fields, classifies (bug / feature / enhancement / arch-decision-needed), identifies the probable code area, assembles initial file context, writes a handoff packet to `.claude/handoffs/`, and continues into the investigation contract at sibling [`INVESTIGATION.md`](INVESTIGATION.md) — validate, root-cause, semi-auto fix or 2-3 tradeoff'd options. Dedup-first: a recent unchanged triage on the same issue short-circuits to the existing handoff. Use when you have an issue number and want to act on it.
model: opus
effort: high
user-invocable: true
allowed-tools: Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh search issues:*), Bash(git log:*), Bash(git ls-files:*), Bash(git status:*), Bash(git rev-parse:*), Bash(date:*), Bash(ls:*), Read, Write, Grep
---

# /issue-triage `<N>` — investigate a GitHub issue

Single-file workflow: prep + investigation, end-to-end on opus, in main thread, no Task delegation. The mechanical prep (Steps 1-7) produces a handoff packet that's written to `.claude/handoffs/` for cross-session resume + compaction recovery + `/catchup` discovery. The investigation contract — validate, root-cause, semi-auto-fix or present-options — is in sibling [`INVESTIGATION.md`](INVESTIGATION.md) and is followed in main thread once Step 7 completes.

## Contract

**Goal.** Take a GitHub issue number and drive it from "filed" to "acted on" end-to-end, in one main-thread session. The mechanical prep — fetch the issue and comments, parse the YAML-form fields, classify (bug / feature / enhancement / arch-decision-needed), identify the probable code area, and assemble initial file context — feeds the investigation contract in sibling `INVESTIGATION.md` (validate, root-cause, then a semi-automatic fix or 2-3 tradeoff'd options). It runs on Opus because classification, area-mapping, and root-cause investigation are real judgment over real code, not template fill — a wrong area or a misclassification sends the whole investigation off course. It is dedup-first: a recent unchanged triage on the same issue (cited files untouched, working tree clean, no new issue activity) short-circuits to the existing handoff. Reach for it when you have an issue number you want to act on.

**Inputs.** `$ARGUMENTS` is the required issue number (e.g., `419`); if empty, prompt for it. The skill reads the issue and its comments via `gh issue view`, the codebase via `git ls-files` / `git log` / `Grep`, the architecture topic docs (`docs/architecture/*.md` related-files frontmatter), and any prior handoff at `.claude/handoffs/issue-<N>-*.md` for the dedup check.

**Outputs.** A handoff packet written to `.claude/handoffs/issue-<N>-<timestamp>.md` with YAML frontmatter (`created`, `target`, `branch`, `sha`, `cited-files`) and a body carrying the classification, probable area, 2-5 cited initial-context files, and the full untruncated issue body + comments — durable for cross-session resume, compaction recovery, and `/catchup` discovery; a one-line confirmation of the saved path, classification, area, and file count; and then the in-thread investigation per `INVESTIGATION.md`. On a clean dedup hit, no new file is written — the prior handoff is surfaced with resume/re-triage/cancel options.

**Success criteria.**

- The dedup check runs first and short-circuits correctly: all three signals clean (cited files untouched, working tree clean for them, no new issue activity) → surface the prior handoff and STOP for the user's pick; any signal changed → proceed.
- The issue is classified correctly from labels + body shape (body shape wins on label conflict), with genuinely ambiguous cases surfaced to the user.
- The probable area is identified from the keyword→area map; multiple matches are listed for the investigator rather than forced to one; no match is surfaced honestly as "uncertain area."
- Initial file context is 2-5 genuinely relevant files (quality over quantity, not padded).
- The handoff is written with valid frontmatter and untruncated bodies, then the skill continues immediately into `INVESTIGATION.md` as one motion.

**Failure modes to avoid.**

- **Re-prepping over a clean dedup hit.** If all three signals are clean, do not write a new file — surface the prior handoff and wait for the user's pick.
- **Forcing a classification or area when ambiguous.** Surface conflicting labels (trust body shape), list multiple matching areas, and flag "uncertain area" rather than guessing — a wrong call misdirects the whole investigation.
- **Padding the initial file context.** Pick the 2-5 files that actually matter; the investigator reads more as it goes.
- **Truncating the issue body or comments.** Keep them full — diagnosis needs the complete text.
- **Running the investigator on a support question.** If the body is a how-does-it-work question, redirect to the contact links rather than triaging.
- **Stopping after the handoff.** Step 7 is "save the handoff AND continue into investigation" as one motion; don't write the file and wait.

**When NOT to use.**

- The issue is a support question (how a feature works, not a bug/feature/enhancement) — direct the reporter to the contact links in `.github/ISSUE_TEMPLATE/config.yml`.
- The issue is a duplicate — if a quick search shows it duplicates an existing one, comment to consolidate rather than triage.
- The issue is closed and was resolved — there's nothing to investigate; ask the user to clarify if they want to revisit.
- The issue body is empty (filed via the old templates) — comment requesting more info before triage.

## Implementation

### Inputs

`$ARGUMENTS`: required issue number (e.g., `419`). If empty, prompt for it.

### Step 0 — Check for prior triage (dedup)

Before any prep, look for a recent handoff on this issue:

```bash
ls -t .claude/handoffs/issue-<N>-*.md 2>/dev/null | head -1
```

If a prior handoff exists, `Read` it. The handoff has a YAML frontmatter with `created`, `branch`, `sha`, `cited-files`. Check three signals:

1. **Cited files unchanged?** `git log <sha>..HEAD -- <cited-file-1> <cited-file-2> ...` — empty output means no commits touched them on this branch.
2. **Working tree clean for cited files?** `git status --porcelain -- <cited-files>` — empty means no uncommitted changes.
3. **Issue itself unchanged?** `gh issue view <N> --json updatedAt` — compare to the frontmatter's `created`. If the issue's `updatedAt` is older than `created`, no new activity.

If all three are clean, **do not write a new file**. Surface to the user:

> Prior triage exists at `.claude/handoffs/issue-<N>-<timestamp>.md` from <relative-time>. Cited files unchanged (sha <abc>..HEAD has no commits on them, working tree clean), and the issue has no new activity since. Options:
> - **(a) Resume from the existing triage** — Read the handoff and follow [`INVESTIGATION.md`](INVESTIGATION.md) from there
> - **(b) Re-triage anyway** — fresh prep, new handoff file (use this if you suspect the prior prep itself was wrong, or want a different angle)
> - **(c) Cancel**

Then **STOP**. Wait for the user's pick before proceeding.

If any signal shows change (or no prior handoff exists), proceed to Step 1.

### Step 1 — Fetch the issue

```bash
gh issue view <N> --json number,title,body,state,labels,author,comments,createdAt,updatedAt,closedAt
```

If the issue is closed, ask whether to proceed (sometimes you want to revisit a closed issue; usually not). If the issue is a question (the YAML schema doesn't fit either bug/feature/enhancement and the body is a question for support), surface that and suggest the user direct the reporter to the contact links in `.github/ISSUE_TEMPLATE/config.yml` — `/issue-triage` isn't the right tool for support questions.

### Step 2 — Parse the YAML-form fields

Issues filed via the upgraded YAML templates have predictable structure: each form field renders as `### <Field label>` followed by the user's value. Parse:

For **bug_report.yml** issues:
- Description ("What happened?")
- Steps to reproduce
- JellyRock client version
- Roku device info
- Server connection type
- Jellyfin server version (optional)
- Logs (optional)
- Screenshots (optional)

For **feature_request.yml** / **enhancement_request.yml**: simpler shape (problem + solution, or existing-feature + proposed-change).

If the issue was filed via the OLD markdown templates (`.md`), the structure is more freeform. Extract what you can; the investigator will handle gaps. If the body is genuinely raw text with no structure, just pass it through verbatim.

### Step 3 — Classify

Map labels + body shape to a classification:

- **bug** — `bug` label is present OR body shape matches bug_report.yml (has repro steps + version info). Subcategory: `arch-decision-needed` if the bug crosses architectural seams (multiple components, cross-cutting concerns, or the diagnosis would force a choice between minimal-fix and refactor).
- **feature** — `feature-request` label OR body shape matches feature_request.yml (has problem + proposed solution).
- **enhancement** — `enhancement` label OR body shape matches enhancement_request.yml.

If two labels conflict (`bug` AND `enhancement`), trust the body shape over the labels. If neither label fits, surface that and ask the user to disambiguate.

### Step 4 — Identify probable area

Map keywords in the title + body + labels to JellyRock areas. Use this map as a starting point:

| Keywords | Probable area |
|---|---|
| video, playback, player, OSD, trickplay, transcode, DoVi, AV1, multichannel, surround | `components/video` |
| library, ContentNode, SceneManager, data, items grid | `components/data` |
| api, jellyfin, request, task, http, auth, login | `source/api` |
| translation, locale, language, i18n, en_US | `locale` |
| util, helper, registry, config, global state | `source/utils` |
| component, scene, focus, navigation, dialog, menu, button | `components` |
| migration, bootstrap, main entry | `source` |
| test, rooibos, spec | `tests` |
| build, lint, BSC plugin, generator script | `scripts` |

If multiple areas match, list them and let the investigator decide. If no area matches, surface that as "uncertain area" and let the investigator search.

### Step 5 — Assemble initial file context

For the probable area, surface up to 5 files the investigator should read first:

```bash
# Files in the probable area
git ls-files <area>/ | head -20

# Recent commits in the area (often the right starting point — what changed
# recently might have introduced the bug)
git log --oneline -10 -- <area>/

# Architecture topic doc for the area (find via related-files frontmatter)
grep -lE "^  - <area>" docs/architecture/*.md
```

Pick 2-5 files that look most relevant based on the issue body. Don't pad — quality over quantity. The investigator will read more as it goes.

### Step 6 — Build the handoff packet

Construct the packet with a YAML frontmatter (so future Step-0 dedup checks can read it) plus the prep body:

```markdown
---
created: <ISO-8601 UTC timestamp from `date -u +%Y-%m-%dT%H:%M:%SZ`>
target: issue-<N>
branch: <git rev-parse --abbrev-ref HEAD>
sha: <git rev-parse --short HEAD>
cited-files:
  - <path-1>
  - <path-2>
---

Issue #<N>: <title>
Status: <open | closed>
Labels: <comma list>
Reporter: @<login>
Filed: <date>

Classification: bug | feature | enhancement | arch-decision-needed
Probable area: <area>
Initial file context:
  - <path>:<line range or whole-file> — <one-line why-relevant>
  - ...

Issue body:
<full body, untruncated>

Comments:
<@author>: <body>
<@author>: <body>
```

Keep bodies untruncated — full text is needed to diagnose.

### Step 7 — Write the handoff and continue into investigation

1. Compute the timestamp once: `date +%Y%m%d-%H%M%S` (for the filename) and `date -u +%Y-%m-%dT%H:%M:%SZ` (for the frontmatter).

2. Write the packet to `.claude/handoffs/issue-<N>-<YYYYMMDD-HHMMSS>.md` (gitignored; durable for compaction recovery + cross-session resume + `/catchup` discovery).

3. Output a single confirmation line, this exact shape:

   > Handoff saved: `.claude/handoffs/issue-<N>-<timestamp>.md` (classification: <X>, probable area: <Y>, <count> files cited). Now following [`INVESTIGATION.md`](INVESTIGATION.md) — adjust scope freely.

4. Then **continue immediately** into the investigation contract at sibling [`INVESTIGATION.md`](INVESTIGATION.md). Don't stop or wait — Step 7's "save the handoff + continue" is one motion.

## Sub-agent invocation

To invoke from a parent sub-agent (rare): parent passes `Read .claude/skills/issue-triage/SKILL.md and follow Steps 0-7 for $ARGUMENTS=<issue-number>; write the handoff file but stop before INVESTIGATION.md — surface the handoff path so the parent can decide next` in the Task prompt. Sub-agents only run the prep; they don't follow INVESTIGATION.md (which is interactive). If you discover any decisions or followups during this work, surface them at the end of your report as a `Captures for /log` section. I'll invoke /log for each. Do not write to docs/ directly.
