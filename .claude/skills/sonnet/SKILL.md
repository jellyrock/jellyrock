---
name: sonnet
model: sonnet
effort: low
description: Execute a procedural implementation plan on the Sonnet model for token savings. Runs when the user types /sonnet with a plan path, or as a Sonnet sub-agent that a parent (usually /focus, right after it saves the plan) starts and supervises. Checks the plan is for this repo, walks its Approach literally, runs its Verification, commits, records the landing in the plan's project, and stops before push for an explicit OK. NOT for judgment-heavy work — if the plan still has open forks, architectural decisions, or "we need to figure out X" gaps, stay on the judgment-grade model and finish the planning side first. NOT for investigation or recipe work that already has a dedicated skill (/ci-triage, /issue-triage, /new-setting, …) — the recipe is the better plan.
---

# /sonnet — execute a procedural plan with token savings

## This repo

- **A landing here is a PR, never a push to `main`.** On `main`, branch before the commit. On `ok` or `push`, run `/pr` in place of `git push` (it pushes the branch and runs the journal passes); never merge, and never open a PR with a bare `gh pr create` ([Landing](../../../AGENTS.md#landing)). After a sub-agent run, the parent runs `/pr`.
- **Commit subjects are Conventional Commits** (`type(scope): summary`) ([Commit messages](../../../AGENTS.md#commit-messages)).
- **Items under To record** go in through `/log` and ride the PR's own change set; a journal edit alone gets no PR ([Capture & state discipline](../../../AGENTS.md#capture--state-discipline)).
- **A `Cannot find module` error** means dependencies are not installed: run `npm ci`, then retry once. Any other missing tool stops the run.

## Contract

**Goal.** A clear-spec implementation plan doesn't need a judgment-grade model's reasoning budget — it needs careful execution, and this skill is the cheap path for that half. There are two ways in. The user types `/sonnet <plan-path>`: the `model: sonnet` pin applies only then (invoked through the Skill tool, the skill would run on the caller's model). Or a parent — usually `/focus`, right after it saves its plan (the user's choices are its fork questions; there is no separate approval) — starts a sub-agent with its model set to Sonnet and these steps as its task, and supervises it: the parent answers what the plan already settles, brings everything else to the user, reviews the result before the user sees it, and turns what the run taught into proposals that improve the next plan. Either way the plan is the spec.

**Inputs.** The arguments are the plan-file path: most often a `/focus` plan at this repo's plan path, but any markdown plan with the sections Context, Approach, Critical files, Verification, Landing & closeout and What this plan deliberately does NOT do works (a project's build spec too). A `/focus` plan carries a `**Project:** <slug | n/a>` line naming the tracked project it advances. With no arguments, the steps list the plans at the plan path that are for this repo and ask which (or whether to cancel).

**Outputs.**

- Edits to the files in the plan's Critical files table — and only those, unless the user approves widening the scope.
- The plan's Verification run end to end, each output surfaced as it came (not paraphrased).
- A commit on the current branch, staged per the Critical files list, whose body gives the plan's why and names the plan by its file name, except in a [public](../../../AGENTS.md#public-posture) repo, where it names no plan file (nobody else can open one) and the why stands alone.
- The landing recorded when the plan's `**Project:**` names a tracked project this session is not closing: one dated Session-log line and a bumped `last-updated` in that project's `PLAN.md`, committed alone as a second local commit (the one push ships both), or left as a local edit where `git check-ignore` says the projects folder is ignored. Status and the kickoff stay `/end-session`'s. A session that holds the project leaves the record to its `/end-session`.
- One ready-to-push message: the commits and how far ahead of the upstream they are, the files with their line counts, each check PASS or FAIL, what happens after the push, anything journal-worthy to record (using the types `/log` records; the section is left out when there is nothing), and one reply table. Then a stop until the user replies. After a supervised run the gate clears (Success criteria), a landed report instead: the push is done, and the reply table only decides the To record items.
- Run as a sub-agent: a report ending in `STATUS: done` or `STATUS: stuck`, in the shape `## Sub-agent invocation` gives; the parent pushes.

**Success criteria.**

- The plan is checked to be for this repo before any edit.
- The Approach section is walked literally, not reinterpreted on the fly.
- The Critical files table is the scope envelope — no surprise files touched without an explicit surface-and-confirm.
- Every command in the plan's Verification section runs and either passes or has its failure surfaced verbatim; never auto-fixed. Its output is read, not only its exit code.
- The commit message reflects the plan's Context (the **why**), not just a restatement of what changed.
- Push happens only after an explicit `ok` or `push`, with one exception: a run a parent supervised, in a repo whose `## Landing` level is `gated`, whose plan says `**Always ask:** none`, whose work matches the plan (`plan-run.sh gate` exits `0`), whose every check passed and whose review found no issue. The parent pushes that one and reports it landed. A typed run always stops; never push on session end; a sub-agent never pushes.
- Production steps follow the plan's `Landing & closeout` exactly: after the push, only a step the plan assigns to the implementing session runs (routine and undoable, with the exact command approved as part of the plan); a step assigned to the operator is shown in the ready-to-push message as the exact command to run, never run here; anything the section does not cover is surfaced, not improvised.
- Run as a sub-agent, every point where the steps stop, ask or surface reaches the parent as `STATUS: stuck` with its evidence; nothing is guessed past.
- Anything journal-worthy is listed under To record with its kind, its file and why, and written only after the user's `ok`, also when the push did not wait for it.

**Failure modes to avoid.**

- **Running a plan written for another repo.** Plans kept in one folder for every repo look alike. A plan whose Critical files are not here is stopped and confirmed before a single edit.
- **Improvising past a missing-tool error.** "command not found" or "no module named X" → STOP and surface; never substitute an ad-hoc command path or guess at `find ~/.local`. Past audits show 30+ minutes lost to environmental yak-shaving that one user clarification would have answered in seconds.
- **Auto-fixing a Verification failure.** Surface verbatim, let the user choose: (a) extend skill work to fix inline, (b) cancel and revise the plan, (c) commit-with-known-failure noted in the body. Never silently retry-with-tweaks.
- **Widening scope.** A file not in the plan's Critical files table → surface the proposed add and the reason; don't sneak it into the commit.
- **Following a plan step that breaks one of this repo's hard rules.** The plan is wrong there: stop and surface it rather than follow it.
- **Pushing without explicit OK where the gate does not clear.** The commit-then-stop boundary is load-bearing: before the push a commit is undone with `git reset --soft HEAD~1`; after it, only by a revert commit everyone sees, and a push that deploys may not be undone at all. One unclear condition (a level not plainly `gated`, an Always ask line missing or naming an item, a file outside the plan, a check not run, an issue in the review) means stop.
- **Loose prose in place of a chat question.** A fork the plan left open is asked as a chat question (the options, a **Recommended** one with why and risk, the reply words), never papered over with "should we Y" or "let me know which"; run as a sub-agent, it is reported as stuck.
- **Bypassing a commit hook.** `--no-verify`, or a hook manager's skip variable: address the finding and re-stage instead.
- **Pre-rendering a verification summary before the gates actually run.** Run each command, surface its output, then summarize — not the other way around. Optimistic summaries that mismatch actual output corrupt the trust signal.

**When NOT to use.**

- The plan still has open architectural forks or unresolved questions. Stay on the judgment-grade model and finish the planning side first via `/focus`.
- No written plan exists. "Implement feature X" without a spec is judgment-heavy by default; don't reach for `/sonnet`.
- The work is so trivial it doesn't warrant a plan (typo, one-line config edit). Just edit and commit; the skill overhead isn't worth it.
- When this repo has a dedicated write skill for the work (a deploy, a secret rotation) with its own verify chain — use that skill. A generic plan run skips the chain it encodes.
- The plan flags `Risk / blast radius: large` or touches load-bearing infra (migrations, deploy scripts, secret-handling, backup and restore paths). Stay on the judgment-grade model for the implementation half too — the token savings aren't worth the marginal risk on infra changes. **This bullet is the one "must not be a Sonnet run" list; `/focus`'s implementation-tier choice checks it rather than keeping its own copy.**

## Implementation

Repo facts this skill reads: [this repo's verification commands](../../../AGENTS.md#verification-commands), [its plan path](../../../AGENTS.md#plan-path) and [its capture types](../../../AGENTS.md#capture-types). The mechanics go through `bash .claude/skills/sonnet/plan-run.sh` (`check`, `scope`, `land`, and `gate` for the parent). **Run as a sub-agent**, wherever a step says to ask the user, stop and report `STATUS: stuck` instead (`## Sub-agent invocation`): a sub-agent cannot ask the user anything.

### Step 1 — Check the plan, then read it

With no arguments, run `bash .claude/skills/sonnet/plan-run.sh check --list <plan path>` and ask in chat which candidate to run (or whether to cancel); it lists only plans whose Critical files are here, newest first. Then, with the plan:

Note the starting commit (`git rev-parse HEAD`): Step 4's scope check compares against it. Run `bash .claude/skills/sonnet/plan-run.sh check <plan>`. Its exit code routes the step:

| Exit | Meaning | Do |
|---|---|---|
| `0` | the plan's Critical files are here | read on |
| `2` | no plan named | ask which of the listed candidates, or for a path |
| `3` | the plan cannot be read | stop and say so; never run a similar-looking plan instead |
| `4` | locality `FOREIGN`, `MIXED` or `UNKNOWN` | stop and confirm before any edit: `FOREIGN` is almost always another repo's plan; a `MIXED` plan names a file that is not here, so resolve every `MISS` first |

Its `BANNER:` lines say what else to raise: a plan with no Verification section has no regression floor of its own (Step 3's floor becomes the whole check); a plan with no `**Project:**` line needs the user to say which project it advances (or `n/a`), and the line added under its title; an archived or unknown project is asked about before Step 4.

Read the plan file in full: the `Context` (the why now, which the commit body needs), the `Approach` (the steps), the `Critical files` (the scope envelope), the `Verification` (the regression floor), the `Landing & closeout` (who lands each production step after the push), and `What this plan deliberately does NOT do` (the boundaries not to widen).

**State drift.** If `/catchup`'s read already ran in this session and nothing has moved since, reuse it; as a sub-agent, that is the read the parent's prompt reports, never assumed. Otherwise run `bash .claude/skills/catchup/catchup-state.sh`. When the plan file is more than 12 hours old and the read shows state moved under it (a failed pipeline, commits touching the plan's files, another hand-off in flight), ask in chat whether to run `/catchup` first or proceed as planned; don't invoke it. If its REPO section says the commit gate is not installed, say so before Step 4 commits.

### Step 2 — Walk the plan

Execute the `Approach` section in order. For each step:

- **File creates / edits:** use `Write` / `Edit` against the paths named in `Critical files`. Don't invent new paths — the plan's path list is the scope. If a file you need to touch isn't in the table, surface it before editing: the plan's files, the extra one, and the reason.
- **Commands the plan flags** (migrations, builds, test runs, deploy steps): run them via Bash, through this repo's wrappers, and surface output inline so regressions show immediately.
- **A step that would break one of this repo's hard rules** (its `AGENTS.md` or `.claude/rules/`): stop and surface it. The plan is wrong there.
- **A commit step in the Approach** (a plan's own "commit" sub-step): hold it. The commit is made in Step 4, after Step 3's gates pass, with the plan's subject and body (and its file name, outside a public repo); committing mid-Approach leaves the checks to run on work already committed.
- **Open questions** the plan left (a "user to confirm X"): ask them in chat. Don't guess — the no-fabrication rule applies in spades to plan execution.

Stay literal. The plan is the spec; bias toward "what does the plan say" over "what would I do if I were planning this." If you find yourself wanting to deviate (a cleaner approach, a missing edge case, a refactor while you're in the file), STOP and surface it — that's a plan-revision moment, not an implementation moment.

### Step 3 — Run the Verification gates

Walk the plan's `Verification` section in order and surface each command's output inline. **Read the output, not just the exit code:** a check can report success because its own pattern errored into a fallback, or a measurement can read zero because an anchor missed. A passing check whose output looks odd is a failing check until shown otherwise. Each check runs in a Bash call of its own, never chained with another command such as `git commit` and never piped through `tail`, `head` or `grep`: a pipe replaces the check's exit code with the pipe's, and a cut output hides what failed above the cut. Read its whole output, and write a PASS line only for what that command itself printed.

If a command in the plan's own Verification fails, stop there — don't go on to the floor. Surface the failure verbatim with a one-line diagnosis, and ask in chat whether to (a) extend this work to fix it inline, (b) cancel and revise the plan, or (c) commit anyway with the failure noted in the body. Never auto-fix, never retry-with-tweaks.

Once the plan's own gates pass, run this repo's no-regressions floor from [its verification commands](../../../AGENTS.md#verification-commands) as the tail, for any of it the plan's list lacks. A part of the floor not run is a `NOT RUN` line under Checks with the reason, never left out and never summed into "all passed". **Use the wrappers that slot names, never the bare runners it replaces.** On "command not found", "no module named X" or a missing network: STOP, don't improvise another path; check the slot and the repo's command help, and if that doesn't answer it, surface the failure verbatim. When the floor command reads committed work (a `--from-ref`/`HEAD` range), it cannot check anything yet: it is not run here; Step 4 passes it to `land`, which runs it after the commit.

### Step 4 — Commit, check the scope, record the landing, stop

When Verification is clean (or the user accepted a known failure in Step 3), stage explicitly per the Critical files list — no `git add -A`. Subject: `<area>: <short summary>` in this repo's commit style (skim `git log --oneline -10`). Body: the why (the plan's Context answers it), and the plan named by its file name, never its path (a path under a home folder is personal information); in a [public](../../../AGENTS.md#public-posture) repo, no plan file at all, since nobody else can open it.

Run the commit and let the repo's hooks run; if one fails, fix what it found, re-stage and commit again. Never bypass a hook (`--no-verify`, or a hook manager's skip variable; the verification-commands slot names this repo's).

Then, in order:

1. `bash .claude/skills/sonnet/plan-run.sh land <plan> --base <starting commit>`, plus `--floor '<the floor command>'` when the repo's floor reads committed work. It runs the floor first and prints its whole output, recording nothing if it fails (exit `4`: handle it as Step 3 says for a failing check, surface it verbatim, ask (a)/(b)/(c), never auto-fix; a fix becomes a new commit, after which this runs again). Then it records the landing. Exit `0` for that: recorded, already recorded, nothing to record (`n/a`), or left to `/end-session` because this session holds the project. Exit `2`: its message says the fix. With no `**Project:**` line, ask which project the plan advances (or `n/a`), add the line under the plan's title, and run it again. Then it prints the scope, after the landing so its count includes that commit: the branch and how far ahead and behind its upstream it is, and every changed file with its lines added and removed. Every line that is not `in plan` (a file outside the plan, a planned file left unchanged, anything uncommitted) is explained in the message below, or fixed first. Do not pipe or cut its output.
2. Show the ready-to-push message, then STOP. Render it as Markdown, never inside a code block, in this shape (the lines marked *parent only* are added by the parent that supervised a sub-agent run):

```markdown
**Push <n> commits to `<upstream>`?** Recommended: `ok`, <record <k> notes, then push | push>. <What happens after the push, in plain words: nothing runs automatically | CI runs | this deploys <what> | then you run one command (below)>.

**Commits** · <n> ahead of `<upstream>`, <m> behind
- `<sha>` <the subject, exactly>
  *<a gloss on its own line, only where the subject alone does not say what it is>*

**Files** · <all planned, none outside the plan | <k> outside the plan | <k> planned files unchanged>
- `<path>` +<added> -<removed>   (tagged NOT IN PLAN or UNCHANGED, with a one-line reason, where one applies)
- `<the project PLAN>` +<added> -<removed>   (landing record, when the landing was committed)

**Checks**
- PASS · the plan's <n>: <each, by what it proves>
- PASS or FAIL · this repo's checks: <each; a failure says where and why in plain words, and what shows it is not this work's>
- NOT RUN · <each check skipped, and why>

**Review (Opus):** <matches the plan's Approach; no issues | each issue>   (parent only)
**Your input:** <each question and the answer you gave | none>. Decided without you: <each | none>   (parent only)
**Why it stopped:** <each STOP line of plan-run.sh gate, a check not passed, or the review's issue>   (parent only, in a `gated` repo)

**To record** · committed, then pushed with the rest
1. <Lesson | Followup | Decision> in `<file>`: <what>. *Why:* <what in this run showed it>.

*Sonnet worked <x> min<, in <k> stretches>*   (parent only)

| Reply | What happens |
|---|---|
| `ok` | record 1–<k>, then push all the commits |
| `push` | push; record nothing |
| `edit n: <text>` | reword item n (`edit n: drop` removes it); this shows again |
| `fix: <what>` | a commit fixing it inside the plan, the checks re-run, and this shows again; a fix that changes the plan is drafted for approval first |
```

- **To record** holds everything journal-worthy this run surfaced: *lessons* (ways the run differed from the plan, fixed where the next plan will read them, so they do not bite again: an edit to [the verification commands](../../../AGENTS.md#verification-commands) or `AGENTS.md` for a repo fact is the fix itself; a followup only when the fix is outside this repo's own text, such as `/focus`'s plan-writing steps) and *followups* or *decisions* for later, using [this repo's capture types](../../../AGENTS.md#capture-types). A step that worked as written is not a lesson. Name the real file each goes to (`journal.sh path` prints the journal). With nothing to record, leave out the section and the `edit` row; `ok` then means push.
- **A failing check the user accepted in Step 3:** the headline says so ("Push 2 commits with 1 failing check you accepted?"), and its FAIL line comes first under Checks, quoting the error's first line.
- **A file outside the plan, or a planned file unchanged, that nothing explains:** recommend `fix`, not `ok`.
- **After the push, a step for the user:** the exact command, alone in its own fenced block, just above the reply table.
- **No upstream yet:** the headline names the one the push creates (`origin/<branch>`).

On `ok`, record each item through `/log`'s steps (reading them; its path-restricted commits), then push; on `push`, push. Surface the result. Then run only the `Landing & closeout` steps the plan assigns to this session, exactly as written, and surface their output; never run a step assigned to the operator. Silence is not a reply: nothing is pushed, and the next session's reader shows the commits as not pushed.

### Step 5 — The session

A session opened with `/resume-project` or `/start-project` still ends with `/end-session`: pushing does not end a tracked session. After the push, say so in one line, and leave running it to the user.

## Sub-agent invocation

**Starting it.** The parent notes the starting commit (`git rev-parse HEAD`), then starts a general-purpose sub-agent with its model set to Sonnet — the Agent tool's `model` parameter; without it the sub-agent runs the parent's model, and a skill's `model:` pin does not apply to a sub-agent — in the foreground (the parent waits for its report; a run past an hour costs the parent one re-write of its cached context, since the sub-agent's requests do not keep it warm), with this prompt: `Read .claude/skills/sonnet/SKILL.md and follow its steps for the plan at <plan path>, starting from commit <sha>, as a sub-agent. State drift: the parent's /catchup read ran at <time>; <nothing has moved since | what moved>. As a sub-agent: never ask the user and never push. Wherever the steps say to ask, stop or surface, stop there and report. End with "STATUS: done" and the facts for the ready-to-push message (the commits, the plan-run.sh land output (its FLOOR, LAND and SCOPE sections), each check and its result, the landing, what the push sets off, and each item to record with its kind, file and why) but no reply table, since the parent writes the one message the user sees; or "STATUS: stuck" with the step, the evidence word for word, the question, its options and your recommendation. End your report with a "Captures for /log" section: one "- <type>: <title> — <body>" bullet per journal-worthy item this work surfaced, where <type> is one of [this repo's capture types](../../../AGENTS.md#capture-types); omit the section if there are none, and never write to journals yourself.` A general-purpose sub-agent starts with the repo's `AGENTS.md`, so the link resolves.

**When it stops.** On `STATUS: stuck`:

- **The plan already settles it** (a wording gap, the one path the plan implies): answer it, resume the same sub-agent with `SendMessage` (it keeps its context), and note the call for the done message.
- **It touches scope, the Critical files, Verification, production or the push:** ask the user in chat — the evidence, the options, a **Recommended** one with why and risk, the reply words — and resume the sub-agent with the answer.
- **The plan is wrong:** end the run, ask the user the choice that makes it wrong (a chat question, as above), revise the saved plan, and start a fresh sub-agent.

On `STATUS: done`, review before the user sees anything: run `plan-run.sh scope <plan> <starting commit>` yourself, read each check's output in the report (not only its verdict), and read `git diff <starting commit>..HEAD` whole against the Approach. The verdict names what the review compared: a diff read truncated or sampled is a spot-check, and is called one. Then show the ready-to-push message of Step 4 with its *parent only* lines: your review's verdict, each question the user answered and each call you made without them, and the time Sonnet worked (the sum of the `duration_ms` the harness reports for each of its stretches, so waiting on the user never counts). Add to To record each lesson the run taught: every way it differed from the plan (a stop, a check that could not pass as written, a missed file, a gotcha), with the home Step 4 gives it.

**Before that message, the gate.** Run `bash .claude/skills/sonnet/plan-run.sh gate <plan> <starting commit>`. The push goes ahead without asking only when it exits `0` and also every check in the report is PASS (none failed or accepted as failing, none `NOT RUN`), your review found no issue, and no question the user answered during the run touched production or the push. Then push (or, where this skill's `## This repo` names what replaces a push here, do that), run only the `Landing & closeout` steps the plan assigns to this session, exactly as written, and show the landed report below in place of the ready-to-push message. Anything else: the ready-to-push message, with its **Why it stopped** line naming each reason in plain words (in a repo whose level is not `gated`, leave the line out).

```markdown
**Landed: <n> commits pushed to `<upstream>`** (`<old>..<new>`), without asking: this repo is `gated` and the plan touches nothing on its Always ask list. <What the push set off, in plain words>.

**Commits**, **Files**, **Checks**, **Review (Opus)**, **Your input** and the time Sonnet worked: as in the ready-to-push message

**Undo:** `git revert --no-edit <old>..<new>`, then push   <a push that deployed: what else undoing it needs, or that it cannot be undone>

**To record** · not written yet
1. <Lesson | Followup | Decision> in `<file>`: <what>. *Why:* <what in this run showed it>.

| Reply | What happens |
|---|---|
| `ok` | record 1–<k>, then push those commits |
| `edit n: <text>` | reword item n (`edit n: drop` removes it); this shows again |
| `skip` | record nothing |
```

With nothing to record, leave out To record and the table: the report ends at Undo. A step for the user after the push goes, as in Step 4, alone in its own block above the table.

On `ok` or `push`, act as Step 4 says (on the landed report, `ok` records the items through `/log`'s steps and pushes their commits); on `fix: <what>`, resume the same sub-agent when the fix is inside the plan, or draft the plan change for approval and start a new one when it is not. In a project session, say after the push that it still ends with `/end-session`.
