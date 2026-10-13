---
name: runtime-triage
description: Triage a JellyRock runtime failure (crash, freeze, unexpected behavior) from a pasted Roku log / crash report end-to-end. Parses the log, classifies the failure category (render-thread-crash / task-crash / api-error / registry-corruption / nav-error / unknown), maps to the probable code area, writes a handoff packet to `.claude/handoffs/`, and continues into the investigation contract at sibling [`INVESTIGATION.md`](INVESTIGATION.md). No dedup check: each runtime log is unique. Use when you have a Roku BrightScript log, debug-console output, or a crash report.
model: opus
effort: xhigh
user-invocable: true
allowed-tools: Bash(git log:*), Bash(git ls-files:*), Bash(git rev-parse:*), Bash(grep:*), Bash(date:*), Read, Write, Grep
---

# /runtime-triage: paste a Roku log, get a focused investigation

One workflow, preparation then investigation, run end to end on opus in the main conversation with no sub-agents. The mechanical preparation (Steps 1 to 6) extracts the failure signal and writes a handoff packet to `.claude/handoffs/`, so the work survives compaction, can resume in another session, and shows in `/catchup`. Then the main conversation follows the investigation contract in [`INVESTIGATION.md`](INVESTIGATION.md).

There is no dedup step: each runtime log is unique enough that scanning earlier handoffs costs more than it finds.

## Inputs

The arguments are the pasted log: debug-console output, a crash report, or a specific description of the failure. With no arguments, ask for the paste.

## Step 1: Extract the failure signal

A paste can run to hundreds of lines; the investigation needs the few lines around the error. Walk the paste:

1. Find the line that names the error. Roku prints a BrightScript runtime error as `<message> (runtime error &hXX) in pkg:/<file>(<line>)`, for example `'Dot' Operator attempted with invalid BrightScript Component or interface reference. (runtime error &hec)`. A component error starts `BRIGHTSCRIPT: ERROR:`. Other signals: an HTTP status (`401`, `500`) on a Jellyfin path, or a Task that stopped mid-run.
2. Keep 5 to 10 lines of context above and below it.
3. Note the `pkg:/` path and line the error names, and the backtrace if the paste has one. The log names the transpiled `.brs`; the source is the `.bs` (or `.xml`) of the same name, and the line is a `.brs` line. Map it with the `.brs.map` beside the file in `build/`, from a build of the same commit. A release build ships without maps: [`crash-reports.md`](../../../docs/dev/crash-reports.md) says how `/crash-report` rebuilds the tagged version.

With no error line, the paste may describe a **behavioral** failure (the UI didn't respond as expected, no crash). Treat the whole paste as the signal then.

## Step 2: Classify

Match the signal to one category:

| Category | Tells |
|---|---|
| `render-thread-crash` | A `runtime error &hXX` line naming a component file or a function the render thread runs |
| `task-crash` | A `runtime error &hXX` line in a Task's file, or a Task that stopped without delivering |
| `api-error` | An HTTP `4xx` or `5xx`, a timeout, an unreachable server, a Jellyfin API path |
| `registry-corruption` | Migration console lines (`Migrating …`, `No … migration needed`), or a setting reading its default when the user had changed it |
| `nav-error` | No crash, but confused UI state: focus stuck, Back does nothing, the OSD doesn't hide, a dialog won't close |
| `unknown` | None of the above fits |

If several fit, pick the most specific. State the category once, briefly. With `unknown`, the investigation starts wider.

## Step 3: Identify the probable area

Map the failing path or symbol to an area, with the area map in [`/issue-triage`'s `## This repo`](../issue-triage/SKILL.md):

| Paths or names in the log | Probable area |
|---|---|
| `pkg:/components/video/`, `VideoPlayerView`, `OSD`, `Trickplay` | `components/video` |
| `pkg:/components/data/`, `SceneManager`, `ContentNode` | `components/data` |
| `pkg:/source/api/`, `ApiTask`, `ApiClient`, `apiPool` | `source/api` |
| `pkg:/source/utils/`, registry, config, translation | `source/utils` |
| `migrations.bs`, migration lines | `source` |
| any other `pkg:/components/` path | `components` |

When the log names no path (often the case for a nav error), apply `/issue-triage`'s keyword map to the user's description.

## Step 4: Gather the first files to read

For the probable area, list two to five files to read first:

```bash
# Files in the area
git ls-files <area>/ | head -20

# Recent commits there (a regression often follows a recent change)
git log --oneline -10 -- <area>/

# The architecture doc that covers it
grep -lE "^  - <area>" docs/architecture/*.md
```

For a crash, the file the error line names is almost always the place to start. For `api-error`, the `source/api/` file that builds the request and the Task in `components/api/` that runs it. For `registry-corruption`, `source/migrations.bs` and the setting's read and write sites.

## Step 5: Build the handoff packet

Give the packet YAML frontmatter, the same shape the other triage skills use in `.claude/handoffs/`:

```markdown
---
created: <ISO-8601 UTC timestamp from `date -u +%Y-%m-%dT%H:%M:%SZ`>
target: runtime
branch: <git rev-parse --abbrev-ref HEAD>
sha: <git rev-parse --short HEAD>
cited-files:
  - <path-1>
  - <path-2>
---

Runtime failure
Source: pasted log / crash report

Classification: <category>
Probable area: <area>
Initial file context:
  - <path> (<function or whole file>): <why it is relevant, in one line>
  - ...

Failure signal (relevant log excerpt):
  <the error line and 5 to 10 lines around it>

Full pasted log (untruncated):
<the paste, verbatim>
```

## Step 6: Write the handoff and continue into the investigation

1. Take the timestamps: `date +%Y%m%d-%H%M%S` for the file name and `date -u +%Y-%m-%dT%H:%M:%SZ` for the frontmatter.
2. Write the packet to `.claude/handoffs/runtime-<YYYYMMDD-HHMMSS>.md`.
3. Print one confirmation line in this shape:

   > Saved the handoff: `.claude/handoffs/runtime-<timestamp>.md` (classification: <X>, probable area: <Y>, <count> files cited). Now following [`INVESTIGATION.md`](INVESTIGATION.md); adjust scope freely.

4. Then **continue at once** into [`INVESTIGATION.md`](INVESTIGATION.md). Don't stop or wait.

## When not to use

- The paste is a CI failure log: use `/ci-triage`.
- The paste is a GitHub issue body with a log in it: use `/issue-triage <N>`, whose investigation reads the log.
- The paste is a description with no log or error: the investigation can work from a description, but a log narrows it a lot. Ask for one if it exists.

## Sub-agent invocation

To run only the preparation from a sub-agent (rare), the parent passes `Read .claude/skills/runtime-triage/SKILL.md and follow Steps 1-6 for the pasted log <pasted-log>; write the handoff file but stop before INVESTIGATION.md, and report the handoff path so the parent can decide what next` in the Agent prompt. The sub-agent this section starts runs only the preparation: `INVESTIGATION.md` needs the user.
