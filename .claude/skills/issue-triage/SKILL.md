---
name: issue-triage
description: Investigate a JellyRock GitHub issue. The skill (sonnet) does mechanical prep — fetches the issue body and comments via gh, parses the YAML-form fields, classifies (bug / feature / enhancement / arch-decision-needed), identifies the probable code area from labels + body keywords, and assembles initial file context — then delegates to the issue-investigator agent (opus) for the deep judgment work (validate, root-cause, semi-auto fix, or 2-3 tradeoff'd options for architectural calls). Use when you have an issue number and want to act on it (fix or present options).
model: sonnet
user-invocable: true
allowed-tools: Bash(gh issue view:*), Bash(gh issue list:*), Bash(gh search issues:*), Bash(git log:*), Bash(git ls-files:*), Read, Grep, Task
---

# /issue-triage `<N>` — investigate a GitHub issue

Mechanical prep step before per-issue judgment work. The actual investigation (validate, diagnose, implement-or-present-options) is delegated to the [`issue-investigator`](../../agents/issue-investigator.md) agent (opus), which gets a structured handoff packet from this skill.

## Inputs

`$ARGUMENTS`: required issue number (e.g., `419`). If empty, prompt for it.

## Step 1 — Fetch the issue

```bash
gh issue view <N> --json number,title,body,state,labels,author,comments,createdAt,updatedAt,closedAt
```

If the issue is closed, ask whether to proceed (sometimes you want to revisit a closed issue; usually not). If the issue is a question (the YAML schema doesn't fit either bug/feature/enhancement and the body is a question for support), surface that and suggest the user direct the reporter to the contact links in `.github/ISSUE_TEMPLATE/config.yml` — `/issue-triage` isn't the right tool for support questions.

## Step 2 — Parse the YAML-form fields

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

## Step 3 — Classify

Map labels + body shape to a classification:

- **bug** — `bug` label is present OR body shape matches bug_report.yml (has repro steps + version info). Subcategory: `arch-decision-needed` if the bug crosses architectural seams (multiple components, cross-cutting concerns, or the diagnosis would force a choice between minimal-fix and refactor).
- **feature** — `feature-request` label OR body shape matches feature_request.yml (has problem + proposed solution).
- **enhancement** — `enhancement` label OR body shape matches enhancement_request.yml.

If two labels conflict (`bug` AND `enhancement`), trust the body shape over the labels. If neither label fits, surface that and ask the user to disambiguate.

## Step 4 — Identify probable area

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

## Step 5 — Assemble initial file context

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

## Step 6 — Build the handoff packet

Format as markdown the agent can ingest:

```markdown
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

Keep bodies untruncated. The agent needs full text to diagnose.

## Step 7 — Delegate to issue-investigator

Invoke via the Task tool with `subagent_type: issue-investigator`. Pass the handoff packet from Step 6 as the prompt, prefixed with the standard sub-agent boilerplate:

```text
You are the issue-investigator agent. The /issue-triage skill has done
the mechanical prep below. Validate the report, identify root cause,
and either implement a semi-auto fix (stop before commit) or present
2-3 tradeoff'd options if architectural — per your operating contract.
Do NOT re-fetch via gh — the prep is authoritative.

<handoff packet>
```

The agent then walks its own contract: validate, diagnose, semi-auto-fix or present-options.

## When NOT to use

- The issue is a support question (user is asking how a feature works, not reporting a bug or proposing a feature) — direct the reporter to the contact links in `.github/ISSUE_TEMPLATE/config.yml` (app settings docs, server feature matrix). Don't run the investigator on questions.
- The issue is a duplicate — if a quick search shows it duplicates an existing issue, comment to consolidate rather than triage.
- The issue is closed and was resolved — there's nothing to investigate. If the user wants to revisit, ask them to clarify why.
- The issue body is empty (filed via the old templates) — comment requesting more info before triage.

## Sub-agent invocation

To invoke from a parent sub-agent: parent passes `Read .claude/skills/issue-triage/SKILL.md and follow the steps for $ARGUMENTS=<issue-number>; build the handoff packet but do NOT delegate to the issue-investigator agent — surface the packet for review` in the Task prompt. Sub-agents shouldn't auto-delegate; the user picks when to invoke the deeper agent.
