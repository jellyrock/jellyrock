---
name: snag
model: opus
effort: medium
description: Handle a flaw found mid-work without switching gears. Start it the moment a defect, bug, gap or regression surfaces while doing other work, BEFORE any fix is drafted. A trivial slip is fixed on the spot. Anything else is investigated read-only (reproduce, root cause, history of the broken lines, what depends on it), then shown on one decision screen with the candidate fixes, a recommended fix and a recommended timing. The user picks a fix to build now (test-first, committed, never pushed) or files it as a pinned followup (asap) or a plain one (later). Not for picking the next task (use /focus), saving a thought unexamined (use /log), or a pasted Roku log, failed CI run or issue that has its own flow (use /runtime-triage, /ci-triage, /issue-triage).
---

# /snag — investigate a flaw found mid-work; the user chooses the fix and when

## This repo

- **Shared mechanisms** (a change to one is never trivial, Step 1; prove it on one target first): the BrighterScript build plugins `../../../scripts/bsc-plugins/` (compile-time guards such as `no-task-fanout`, `no-raw-run`; one edit changes the build of every `.bs` file); the lint scripts and ESLint rules `../../../scripts/lint/`; the git hooks `../../../.husky/` and the agent hooks `../../hooks/`; the CI workflows `../../../.github/workflows/` (the `_*.yml` files are reusable and called by the others); the API client and its task pool `../../../source/api/` ([its notes](../../../source/api/CLAUDE.md)); the committed ratchet baselines (`.promise-ratchet-baseline`, `.dead-code-baseline.json`, `.doc-citation-baseline.json`); the shared skills.
- **Where failures are read:** a device flaw, in the Roku debug console (`telnet ${ROKU_DEV_TARGET} 8085`, [DEVGUIDE](../../../docs/dev/DEVGUIDE.md#bugcrash-reports)) and the test runners' output (`npm run device:check` first); a CI flaw, in the failed GitHub Actions run (`gh run view <id> --log-failed`); a field crash, in the weekly Roku crash report ([workflow](../../../docs/dev/crash-reports.md), routing table `../../../.crash-report/known-noise.yml`).
- **A pasted Roku log, a failed CI run or an issue** already has a flow: `/runtime-triage`, `/ci-triage`, `/issue-triage`. Use `/snag` for a flaw found mid-work that is not one of those.

## Contract

**Goal.** Turn the moment a flaw surfaces mid-work into a considered response instead of a reflexive first-draft patch, without pulling the user off what they were doing. A trivial slip is fixed on the spot. Anything else is **investigated before anything is decided**: the flaw is reproduced, its actual cause named, the history of the broken lines read, and what depends on it found, all read-only. The result goes to the user on **one fixed decision screen**: the evidence, the candidate fixes, a recommended fix and a recommended timing. **The user always chooses the fix**; no repo setting waives that. They build it now, or file it for later with the investigation attached. A fix built now is test-first, verified on a real target, committed on its own paths and **never pushed**: the user is mid-work, and the fix goes out with their next push. The agent starts it the moment it finds a flaw, or the user types it. Started by the agent it runs on the session's own model and effort; its pin applies when it is typed. The one judgment-heavy sub-step, naming a subtle root cause, may go to a sub-agent at the judgment tier.

**Inputs.** The arguments are an optional short description of the flaw just found (e.g. `the keep-list guard let the sweep clobber protected files`). If absent, the skill takes the most recently surfaced defect in the working context. It expects to be invoked **the moment a flaw is found, before any fix is drafted**.

**Outputs.**

- **A trivial slip:** the correction applied directly and named in one line. No screen, no report.
- **Anything else:** the decision screen of Step 3, every field filled, shown before any edit; then the turn ends.
- **On a fix chosen to build now:** the fix, its tests, one commit on its own paths whose body carries the root cause, the chosen fix and the alternatives rejected; nothing pushed; then the report of Step 7, every field filled.
- **On `asap` or `later`:** a followup holding the cause and the options (pinned for `asap`), and nothing edited.
- Anything journal-worthy that surfaced and is not yet captured, using the types `/log` records. Omit if nothing surfaced; do not pad.

**Success criteria.**

- Nothing is edited before the user replies to the decision screen, except a genuinely trivial slip.
- The screen and the report follow their templates: **every field appears every time**, and a step that was not done says `not done: <why>` instead of being left out.
- The root cause on the screen is the actual cause, backed by a reproduction and by the history of the broken lines; anything stated but not measured is listed under **Not checked**.
- The user chose the fix. With one viable fix the screen still shows it, with why nothing else is viable.
- A fix built now has a test that failed before it and passes after it, was tried on a real target, and is sized to the defect.
- A **destructive or fan-out mechanism is verified on ONE target before it is applied across many**.
- The fix is committed on its own paths and not pushed; a file holding the user's uncommitted work is never committed.

**Failure modes to avoid.**

- **Hacking the first-draft fix.** Shipping the first remedy that comes to mind with nothing forcing a confirmed cause, weighed alternatives and a regression check. If you find yourself editing before the screen, stop.
- **Choosing the fix for the user.** Picking among the candidates and building one because the repo lets a checked change land. A landing level says when a change may ship; it never says which change to build.
- **Deciding the size before knowing the cause.** A fix sized or scheduled on the symptom is a guess: the history of the lines can show the flaw was fixed before and reverted, which changes the right fix.
- **Dropping a field.** Leaving a check out of the screen or the report because it was not run. The empty field is the information: write `not done` and why.
- **Reporting what the run did not show.** "Both new tests failed before the fix" when the runner printed one passing; a figure that was estimated, stated as measured. Quote the runner's own line.
- **Pushing, or sweeping in the user's work.** The user is in the middle of something else. Commit the fix's own paths; never push; never commit a file that holds their uncommitted changes.
- **Fan-out before verifying the mechanism on one target.** A silently failing guard can corrupt every target at once. Verify on one, confirm the result, then fan out.
- **Over-sizing the artifact.** Answering a two-sentence gap with a rewrite, or a one-file defect with a cross-cutting refactor. Bloat is a regression, not thoroughness.
- **Taxing a trivial fix with ceremony.** A screen, a sub-agent or a report for a typo. The trivial path must stay frictionless or the skill becomes something people route around.

**When NOT to use.**

- **Picking what to work on next.** That is the session-start orchestrator's job (`/focus`). `/snag` fires on a flaw already found.
- **Saving something for later without looking into it.** That is `/log`. `/snag` always investigates.
- **A flaw that is really planned new work.** A missing feature or a deliberate design gap is a project or a plan, not a remediation.
- **Shipping a known, already-scoped change.** A config deploy, a secret rotation, a routine update have their own skills. `/snag` is for unexpected defects.

## Implementation

Repo facts this skill reads: [this repo's verification commands](../../../AGENTS.md#verification-commands) (Step 5), [its capture types](../../../AGENTS.md#capture-types), and this skill's `## This repo` when the repo has one: what counts as a shared mechanism here, and where failures are read (logs, hosts). It does not read the repo's landing level: it never lands.

### Step 1 — A trivial slip is fixed now

Trivial means a single obvious correction with no judgment on the cause: a typo, a wrong literal, a broken link. One spot, reversible at a glance, never got wrong. Apply it, name it in one line, and stop. Size by **what the change can break, not line count**: a one-line edit to a shared mechanism (a tool, rule, skill, script, hook, schema, or anything `## This repo` lists) is not trivial. Hesitating over whether it is trivial means it is not.

### Step 2 — Investigate, read-only

No edit in this step. Find, in this order:

1. **The reproduction.** Run the thing that fails and keep the command and what it showed. If it cannot be run here, say why.
2. **The root cause.** The actual cause, not the first symptom, at a file and line. If it needs real reasoning across components, delegate the reading to a sub-agent at the judgment tier (see `## Sub-agent invocation`).
3. **The history of those lines.** `git log -S'<the broken text>' -- <file>` and `git log -p -3 -- <file>`: when it broke, and whether it was fixed before and undone.
4. **What depends on it.** Callers, the tests that cover it (and whether any reaches the broken path), anything it is copied or deployed to.
5. **At least two candidate fixes**, each with its footprint and risk. With one viable fix, the reason nothing else is.

If the cause cannot be confirmed without changing something, stop here anyway: the screen says `not confirmed` and what was ruled out.

### Step 3 — The decision screen

In chat, exactly this shape, real names from the working context, every field present; then end the turn. Never a pop-up.

```text
**Snag:** <the flaw in one line>

**Where:** <file, section, line, as a clickable link>

**Evidence:**
- **Reproduced:** <the command run and what it showed> | not reproduced: <why>
- **Root cause:** <the actual cause> | not confirmed: <what was ruled out>
- **History:** <when it broke; any earlier fix, from both of Step 2's commands; one not run goes under Not checked> | nothing relevant
- **Depends on it:** <callers, tests that cover it, where it is copied or deployed>
- **Not checked:** <anything stated above that was not measured> | nothing

**Options:**

| Fix | What it does | Fixes the cause? | Same result every time? | Your time | Upkeep | Could it break something? |
|---|---|---|---|---|---|---|
| `<label>` | ... <and its footprint: files, tests> | ... | ... | ... | ... | ... |

**Recommended:** `<label>`: <why, and its risk>

**Timing:** <now | asap | later>: <one line of why>

| Reply | What happens |
|---|---|
| `<label>` | Build that fix now, test first, commit it, no push. |
| `ok` | <if timing is now: Build `<label>` now, test first, commit it, no push.; if asap or later: File a followup recommending `<label>` (pinned for asap); to build it now, reply `<label>`.> |
| `asap` | File a pinned followup with this cause and these options; stop. |
| `later` | File a followup with this cause and these options; stop. |
| `edit: <text>` | Change the plan as you say. |
| `second-opinion` | A reviewer with a clean context compares the options first. |
```

In the `ok` row, write only the sentence for this screen's timing, with the recommended fix's label filled in, so it names the one action `ok` triggers.

A label is a short word saying what the fix does (`mark`, `restore`), never a letter. Recommend `now` when the fix fits this session without derailing the work in hand, `asap` when it does not fit but blocks or endangers that work, `later` otherwise, or when it needs its own design or several sessions.

### Step 4 — Act on the reply

- **A fix label, or `ok` with timing `now`** → Step 5 with that fix.
- **`asap`, `later`, or `ok` with that timing** → follow `/log`'s steps for a followup whose body holds the root cause, the options and the recommendation, stating nothing the screen did not (its title too) and carrying the screen's **Not checked** list word for word; for `asap` add `--pinned` to its `journal.sh add`. When the fix needs its own design or several sessions, also print `/start-project` alone in its own block for the user to type. Edit nothing else; stop.
- **`edit: <text>`** → apply it and show the screen again.
- **`second-opinion`** → print `/second-opinion` with the options, alone in its own block, for the user to type.

### Step 5 — Build the chosen fix

1. **Test first.** Write the test that fails on the flaw; run it and keep the runner's line showing which cases failed.
2. **The fix, sized to the defect.** A two-sentence gap gets a two-sentence fix. Trim before committing.
3. **Verify.** Run [this repo's verification commands](../../../AGENTS.md#verification-commands) on what changed, then try it on the **real target**: re-trigger the failure and watch it not happen. A destructive or fan-out mechanism proves itself on ONE target before it is applied across many, and fans out by content-anchored edits (match the text being changed), never by line numbers, which shift once the first target is edited.

**A Sonnet sub-agent builds it, not the main thread:** the prompt in `## Sub-agent invocation`, which hands it 1–3. **Review before Step 6:** read `git diff` against the chosen fix, and the runner lines and each check's output in its report, not only its verdicts. A slip inside the chosen fix goes back to the same sub-agent (`SendMessage`); anything that changes the fix comes back to the user. So does a claim on the screen that the build disproves, when the recommendation or a rejection rested on it: before Step 6, quote the claim and what the run showed, and ask whether the choice stands. Never repeat a disproved claim under **Rejected**.

### Step 6 — Commit, never push

Commit only the fix's own paths (`git commit -- <paths>`), with a body carrying the root cause, the chosen fix and the alternatives rejected: that commit is the record. **Never push**, whatever the repo's landing level: the fix goes out with the user's next push. If a path the fix touches already holds uncommitted work that is not the fix's, do not commit it: leave the fix in the working tree and say so in the report.

### Step 7 — The report

Exactly this shape, every field present. If the build is blocked partway (a check that cannot run, a step that needs the user), the report still takes this shape: the blocker goes under **Not done**, and any question to the user comes after the report, never in place of a field.

```text
**<Fixed, committed, not pushed | Fixed, not committed: <why> | Filed for later>:** <what now behaves differently, or the followup's id> <commit>

**Root cause:** <one or two lines>

**Fix:** `<label>`: <what changed, one line per file>

**Rejected:** <each other option and why it lost>

**Checks:**
- **Failed before the fix:** <which new tests, in the runner's own line>
- **Passing now:** <the runner's summary line>
- **Verification commands:** <each command and its result>
- **Tried on the real target:** <what was run and what it showed>

**Not done:** <each check or step skipped, and why> | nothing

**Undo:** <the command: `git revert <sha>`, or `git reset --soft HEAD~<n>` while unpushed; never `--hard`, which also throws away later uncommitted work>

**Not pushed.** It goes out with your next push.

**Captures:** <each journal-worthy item, by this repo's capture types> | none
```

For each capture, follow `/log`'s steps, one at a time, using [this repo's capture types](../../../AGENTS.md#capture-types). Don't pad with captures that don't exist.

## Sub-agent invocation

`/snag` hands Step 5's build to a general-purpose sub-agent with the Agent tool's `model` set to Sonnet (without it, the sub-agent runs the parent's model), and Step 2's reading of a non-obvious root cause to one at the judgment tier. For the build the parent passes (with worktree isolation if it writes files in parallel with other work):

`A flaw was found: <one-line flaw>. The confirmed root cause is <cause>; the fix the user chose is <fix>. Build it: write the test that fails on the flaw first and keep the runner's line; size the fix to the defect (don't over-edit); verify with [this repo's verification commands](../../../AGENTS.md#verification-commands) and on a real target, and if the fix is a destructive/fan-out mechanism prove it on ONE target before fanning out. Do NOT commit or push. Report what changed per file, the failing-before and passing-after runner lines, each verification command with its result, and anything not done with why. End your report with a "Captures for /log" section: one "- <type>: <title> — <body>" bullet per journal-worthy item this work surfaced, where <type> is one of [this repo's capture types](../../../AGENTS.md#capture-types); omit the section if there are none, and never write to journals yourself.`

A parent writing that prompt for an Explore sub-agent (which loads no instruction files) spells the commands and types out from the slots in place of the links. A sub-agent this section starts NEVER commits, enters plan mode, or writes to journals directly: it proposes; the parent commits.
