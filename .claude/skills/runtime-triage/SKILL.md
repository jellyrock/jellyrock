---
name: runtime-triage
description: Triage a JellyRock runtime failure (crash, freeze, unexpected behavior) from a pasted Roku log tail / crash report. The skill (sonnet) does mechanical prep — parses the log, classifies the failure category (render-thread-crash / task-crash / api-error / registry-corruption / nav-error / unknown), maps to the probable code area, and assembles initial file context — then delegates to the runtime-investigator agent (opus) for root-cause analysis and either a semi-auto fix or 2-3 tradeoff'd options. Use when you have a Roku BrightScript log, debug-console output, or a crash report and want a focused investigation.
model: sonnet
user-invocable: true
allowed-tools: Bash(git log:*), Bash(git ls-files:*), Bash(grep:*), Read, Grep, Task
---

# /runtime-triage — paste a Roku log, get a focused investigation

Mechanical prep for the [`runtime-investigator`](../../agents/runtime-investigator.md) agent. Takes a pasted Roku log / crash report, extracts the failure signal, classifies the category, maps to the probable code area, and hands off a structured packet.

## Inputs

`$ARGUMENTS`: the pasted log content (BrightScript console output, error traceback, or a verbal-but-specific failure description). If empty, prompt for the paste.

## Step 1 — Extract the failure signal

The full log paste can be hundreds of lines; the agent needs the relevant ~10-line excerpt around the error line. Walk the paste:

1. Find the line that names the error. BrightScript errors typically look like:
   - `Sub or function not found`
   - `Type Mismatch`
   - `Member Function Not Found`
   - `Array Out of Bounds`
   - `BRIGHTSCRIPT_ERR_*`
   - HTTP status codes like `Status code: 401` / `Status code: 500`
   - `Task <name> failed` or `thread terminated`
2. Capture 5-10 lines of context above + below the error line.
3. Note the file/function path if it's in the log (BrightScript stack traces include `pkg:/...`).

If no clear error line exists, the paste might be a **behavioral** failure (UI didn't respond as expected, no crash). Treat the whole paste as the signal in that case.

## Step 2 — Classify

Match the failure signal to one category:

| Category | Tells |
|---|---|
| `render-thread-crash` | `Sub or function not found`, `Type Mismatch`, `Member Function Not Found`, `Array Out of Bounds`, `BRIGHTSCRIPT_ERR_*` |
| `task-crash` | `Task <name>` plus failure language (exited, terminated, error), or stacktrace inside a Task BS file |
| `api-error` | HTTP status `4xx` / `5xx`, `timeout`, `ECONNREFUSED`, `unable to reach`, Jellyfin-API path strings |
| `registry-corruption` | `Registry section`, `ReadAsciiFile failed`, migration log lines (`migration v<N>`) |
| `nav-error` | No crash, but UI-state confusion: focus stuck, back button no-op, OSD didn't auto-hide, dialog won't dismiss |
| `unknown` | None of the above match cleanly |

If multiple match, pick the most specific. State the category once, briefly. If `unknown`, the agent will work with a broader scope.

## Step 3 — Identify probable area

Map the failure path or symbol to a JellyRock area. Use the same area map as `/issue-triage` (Step 4 of [`issue-triage/SKILL.md`](../issue-triage/SKILL.md)):

| Keywords / paths in the log | Probable area |
|---|---|
| `pkg:/components/video/*`, `VideoPlayerView`, `OSD`, `Trickplay` | `components/video` |
| `pkg:/components/data/*`, `SceneManager`, `ContentNode` | `components/data` |
| `pkg:/source/api/*`, `ApiTask`, `ApiClient`, `apiPool` | `source/api` |
| `pkg:/source/utils/*`, registry, config, translation | `source/utils` |
| `migrations.bs`, `migration v<N>` | `source` |
| `pkg:/components/<other>/*` | `components` |

If the path isn't in the log (often the case for nav errors), use the same keyword map as `/issue-triage` against the user's verbal description.

## Step 4 — Assemble initial file context

For the probable area, surface 2-5 files the investigator should read first:

```bash
# Files in the probable area
git ls-files <area>/ | head -20

# Recent commits in the area (regressions often correlate with recent changes)
git log --oneline -10 -- <area>/

# Architecture topic doc
grep -lE "^  - <area>" docs/architecture/*.md
```

For `render-thread-crash` and `task-crash`, the BS file named in the stack trace is almost certainly the right starting point. For `api-error`, the relevant `source/api/*.bs` file plus the corresponding Task in `components/api/`. For `registry-corruption`, `source/migrations.bs` + the affected setting's read/write site.

## Step 5 — Build the handoff packet

```markdown
Runtime failure
Source: pasted log / crash report

Classification: <category>
Probable area: <area>
Initial file context:
  - <path>:<line range or whole-file> — <one-line why-relevant>
  - ...

Failure signal (relevant log excerpt):
  <key error line + 5-10 lines of surrounding context>

Full pasted log (untruncated):
<paste verbatim>
```

## Step 6 — Delegate to runtime-investigator

```text
You are the runtime-investigator agent. The /runtime-triage skill has
done the mechanical prep below. Validate the diagnosis, identify root
cause, and either implement a semi-auto fix (stop before commit) or
present 2-3 tradeoff'd options if architectural — per your operating
contract. Do NOT re-parse — the prep is authoritative.

<handoff packet>
```

Invoke via the Task tool with `subagent_type: runtime-investigator`.

## When NOT to use

- The paste isn't a runtime failure — it's a CI failure log → use `/ci-triage`.
- The paste is a GitHub issue body that contains a log → use `/issue-triage <N>` (the issue-investigator will read the embedded log).
- The paste is just a user description with no log/error info — the investigator can work from description-only, but a log dramatically narrows the scope. Ask for one if available.

## Sub-agent invocation

To invoke from a parent sub-agent: parent passes `Read .claude/skills/runtime-triage/SKILL.md and follow the steps for $ARGUMENTS=<pasted-log>; build the handoff packet but do NOT delegate to runtime-investigator — surface the packet for review` in the Task prompt.
