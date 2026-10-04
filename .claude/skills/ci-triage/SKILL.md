---
name: ci-triage
description: "Diagnose a failed CI workflow run and fix it the /snag way. A tested read-only script fetches the run, reports every failed job and step with the log region around its errors (not the post-job cleanup), and classifies each against this repo's gates.tsv, printing the banner a gate carries when its obvious fix is the wrong one. Then: re-run only what is transient, reproduce locally, find the root cause, and show one decision screen; the chosen fix is built test-first and committed on a fix branch, never pushed. Use when a CI run failed on a pull request or on the default branch."
model: opus
effort: high
user-invocable: true
allowed-tools: Bash(gh run view:*), Bash(gh run list:*), Bash(git log:*), Bash(git diff:*), Bash(git ls-files:*), Bash(git status:*), Bash(git rev-parse:*), Bash(date:*), Bash(ls:*), Read, Write, Grep
---

# /ci-triage — diagnose a failed CI run

## This repo

- **Local commands** (Step 5): each lint and test step runs an `npm run <script>` that runs the same locally after `npm ci`; the step's `##[group]Run …` line names it. `npm run lint` runs every lint check in one go.
- **Not a CI run:** a log pasted from a Roku is `/runtime-triage`.

## Contract

**Goal.** Take a failed CI run from red to a chosen, verified fix in one session. A tested script does the mechanical read (fetch the run, find every failed job and step, cut each job's log to the region around its errors, classify each step against this repo's `gates.tsv`), so the session's effort goes to the diagnosis: is it transient, does it reproduce locally, what is the root cause. From there it follows `/snag`'s method: a decision screen with the evidence and at least two candidate fixes, the user's pick, the fix built test-first and committed, never pushed. It runs on Opus because reading an unfamiliar failure correctly is real judgment, and a wrong call sends the fix the wrong way or loosens a gate that was right to fail.

**Inputs.** The arguments are a run id or a run URL (the id is the number after `/runs/`); with none, the skill lists the newest failed runs on the current branch and asks which. It reads the run through `ci-triage-state.sh`, the step map and banners in this skill's `gates.tsv` (the repo's own file), each gate's local command in this skill's `## This repo`, and the code and history the failure points at.

**Outputs.** The state read's report in the conversation; for a transient failure, the re-run command for the user to run; otherwise `/snag`'s decision screen, then on the user's pick either a fix (its test, one commit on a `fix/ci-<run id>` branch when it started on the default branch, and `/snag`'s report) or a filed followup. A step `gates.tsv` did not know gets its line proposed.

**Success criteria.**

- Every failed job is diagnosed, not only the first; jobs that share one root cause are said to.
- The category and any banner come from the script; nothing it reports is re-derived by hand.
- A transient failure is re-run before any code is changed, and a failure that points at code is never just re-run.
- A failure that reproduces locally is reproduced before any theory; one that cannot is said to.
- The root cause is named at a file and line, and the screen separates what was measured from what was not.
- The fix is the user's pick, built test-first, committed on its own paths, and not pushed.

**Failure modes to avoid.**

- **Turning a gate green by loosening it.** Allowlisting a secret finding, extending a security baseline or grace period, bumping a review date, skipping a test or raising a timeout makes the check pass and leaves the cause. Such a change is only ever a named option on the screen with its reason, never the reflexive fix; a gate's banner says when it is the wrong one.
- **Treating a leaked secret as a red check.** The credential is the emergency: rotate it first. Deleting the finding or rewriting history to hide it is not a fix; one that reached the default branch is disclosed.
- **Stopping at the first failed job.** A second failure hides behind the first and is the next red run.
- **Reading cleanup as the failure.** A job's last lines are mostly post-job cleanup; the diagnosis is at its `##[error]` lines, which is the region the script prints.
- **Forcing a category.** A step `gates.tsv` does not know is `unknown`: classify it from the tail and propose its line, never guess one of the known categories.
- **Re-running, or pushing, on the user's behalf.** A re-run spends CI and a push lands work; both are the user's to run.
- **Re-running a failure that points at code, or theorizing about one that is transient.** Decide which it is from the tail first.

**When NOT to use.**

- The run is still in progress, or did not fail: there is nothing to triage yet.
- The failure is not a CI run: a flaw found mid-work is `/snag`, and a log from the running app goes to whatever this repo uses for runtime failures.
- The fix is already known and trivial (a typo the log names): fix it directly.

## Implementation

Two repo-owned parts: `gates.tsv` beside the script maps each CI step to a category, an optional sub-check pattern and a banner (its header says the format); this skill's `## This repo` gives each gate's local command and anything the repo's gates need beyond the shared steps.

### Step 1 — Which run

A run URL gives its id after `/runs/`. With no arguments, list the newest failures and ask in chat which one:

```sh
gh run list --branch "$(git branch --show-current)" --status failure --limit 5 --json databaseId,workflowName,displayTitle,createdAt,url
```

None on this branch: say so, and offer the same list for the default branch (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`).

### Step 2 — The state read

```sh
bash .claude/skills/ci-triage/ci-triage-state.sh <run id>
```

| Exit | Meaning | Do |
|---|---|---|
| `0` | the run failed; each failed job is reported | Step 3 |
| `2` | the run did not fail, or has not finished | Say which, and stop. |
| `3` | the run could not be fetched or read | Read its `gh said:` or `jq said:` lines: a rejected field or an expired token reads nothing like a bad id. Stop. |

Never re-fetch what it printed with your own `gh` calls. Its output is the evidence the decision screen cites.

### Step 3 — Read each failed job

For each `FAILED JOB` section: the step, the category, the sub-check when the gate wraps several checks in one step (the sub-check, not the step name, is the finding), any `BANNER:` line, and the tail. A banner outranks the obvious fix; follow it. Several failed jobs often share one cause (a build failure that fails every job after it): name which, and diagnose the cause once. A step reported `unknown`: classify it from the tail, and carry the line `gates.tsv` should get into the decision screen.

### Step 4 — Transient or code?

Transient: a platform outage, a runner that never started, a network fetch or tool install that failed upstream, a device or service the job needs that was unreachable, or a time limit hit with nothing in the tail pointing at code. Then print the re-run command alone in its own block, say why it looks transient, and stop: triage it only if it fails again.

```text
gh run rerun <run id> --failed
```

Anything else is code or configuration: continue.

### Step 5 — Reproduce locally

Run the gate's local command from this skill's `## This repo`; with none there, the command in the tail's `##[group]Run …` line. Keep the command and the lines that show the failure. It fails in CI but passes locally: the difference between the two environments is the finding, never a reason to change the check. It cannot be run here (it needs a network service, a tool or a device this machine lacks): say so, and work from the tail.

### Step 6 — Root cause

Read the file and line the tail names, and the change that brought it in:

```sh
git log --oneline -10 -- <path>
git diff "origin/$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)...HEAD" -- <path>
```

For a failing test, read the test and the code it covers. Ask whether the diagnostic is the cause or a symptom of one upstream (a type error at a call site whose contract changed), and name the cause at a file and line.

### Step 7 — Decide and build, the `/snag` way

Read `.claude/skills/snag/SKILL.md` and follow its Steps 2 to 7, carrying in what Steps 2 to 6 here found (the reproduction and the root cause are done; finish its Step 2 with the history, what depends on the code, and at least two fixes). Three differences:

- The screen's first line is `**CI run:** <workflow> <run id>: <job> / <step> (<category>)`, with one such line per failed job, and its options include the `gates.tsv` line a step reported `unknown` needs.
- Before its Step 5 builds anything on the default branch, create the fix branch: `git switch -c fix/ci-<run id>`. On any other branch, commit there.
- Its report ends with one more line: **Next:** push the branch (`/pr` opens its pull request); the push re-runs the workflow.

## Sub-agent invocation

A parent that wants a failed run diagnosed without the conversation starts a sub-agent with `model: "opus"` and this Task prompt; the parent then shows `/snag`'s decision screen itself:

`Read .claude/skills/ci-triage/SKILL.md and follow Steps 2 to 6 for run <run id>. Edit nothing, commit nothing, and do not run gh run rerun or push. Report each failed job with its step, category, sub-check and banners; whether the failure looks transient and why; the reproduction command and what it showed, or why it could not run; the root cause at a file and line with the evidence; and at least two candidate fixes with their footprint and risk. End your report with a "Captures for /log" section: one "- <type>: <title> — <body>" bullet per journal-worthy item this work surfaced, where <type> is one of [this repo's capture types](../../../AGENTS.md#capture-types); omit the section if there are none, and never write to journals yourself.` A parent writing that prompt for an Explore sub-agent (which loads no instruction files) spells the types out from the slot in place of the link.
