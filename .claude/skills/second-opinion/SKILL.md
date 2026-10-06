---
name: second-opinion
model: opus
effort: high
description: Get a second opinion from a reviewer with a clean context. Runs only when the user types /second-opinion (with what to review), or replies second-opinion on a decision screen; never on its own. One item comes back improved (ranked problems with evidence, fixes, what is missing); several come back compared without bias (neutral shuffled labels, criteria written before the options are seen, a winner and what would flip it, an option nobody listed). The report is shown word for word, then a point-by-point response, then the screen again with changes marked. NOT for bugs in a code diff (use /code-review) or for how a skill ran (a skill audit).
---

# /second-opinion — a clean-context review of one item or a choice between several

## Contract

**Goal.** The session that drafted a plan, a document or a decision screen is the worst-placed reviewer of it: it knows what it meant, it has a favorite, and its reasoning is in its context. This skill sends the work to a reviewer that has none of that — an Explore sub-agent on Opus, which starts without the conversation and without the repo's instruction files — through a brief shaped like a contract: the parent fills in the items and the context (audience, decision, constraints, evidence, standards), withholds everything that would lean the reviewer, and the skill's fixed text sets the reviewer's job and the shape of its reply. With one item the job is to improve it; with several it is to compare them fairly, which is why the reviewer writes its weighted criteria in a first turn before it sees any item, and gets the items in a second turn under neutral labels in shuffled order. Both ways it is asked for what the parent cannot see from inside: blind spots, options nobody listed, conventions it applied and how sure it is of each. The parent then shows the report whole and answers it point by point, so the user decides with both views in front of them. Every review records its token cost, so the choice of reviewer model can later be tested against real spend.

**Inputs.** The arguments name what to review: a file, a section of one, a draft in the conversation, or several options to choose between. Or the user replies `second-opinion` on a decision screen with two or more options (the parent starts this skill through the Skill tool, never by reading its file: only then is the run recorded as this skill's, for an audit to find), and the screen's options are the items and its question the decision. The parent has the context: who will read or use the result, what is being decided, what must hold, and the evidence behind it. The Collaboration style and Decisions and reviews sections of the user-wide instructions the parent has loaded are the standards; this skill's `## This repo` may add the repo's own.

**Outputs.**

- A brief outside the repo, checked by `review-run.sh check` (every field filled; no withheld phrase; no item's label outside its own item) and split into the reviewer's two turns and a label key the reviewer never sees.
- The reviewer's report, shown word for word, with the key (which neutral label is which option) right after it.
- The parent's point-by-point response: each point agreed (and what changes), disputed (with evidence), or left open (what would settle it).
- The screen shown again with every change marked, or for a single item the changes it would make, for the user to decide.
- One line of the review's token cost, logged by `review-run.sh cost`.
- Journal-worthy items the reviewer surfaced, passed on as captures for `/log`, never written by it.

**Success criteria.**

- The reviewer never sees the parent's reasoning, recommendation, verdict columns, authorship or option labels: the brief passes `check`, and on a reread no paraphrase of a leaning survived either.
- With several items, the criteria come back before any item is sent, and the items arrive under `P`, `Q`, … in the order `split` shuffled.
- The report reaches the user whole; the response answers every point in it; the user sees the key.
- The cost is recorded once per review, from the reviewer's own transcript.
- The skill ran because the user asked for it: typed, or the screen's `second-opinion` reply.

**Failure modes to avoid.**

- **Leaning leaking into the brief.** The bias travels through what the parent writes, not through the reviewer. "The safer first option", a Recommended line, a verdict column, "my draft", an option label mentioned in another option's text: each tells the reviewer what the parent thinks. `check` catches the phrases; a paraphrase it cannot catch, so reread the brief as the reviewer would before splitting it.
- **Weakening the brief to pass the check.** A PROBLEM is fixed by rewording the leak out or filling the field, never by dropping evidence or a constraint the reviewer needs.
- **Summarizing the report.** The user reads the reviewer's words, not the parent's account of them; a trimmed or paraphrased report is the parent reviewing its own work again.
- **Defending the original.** The response concedes what the evidence supports. Disputing a point needs evidence, not preference, and "I already considered that" is not evidence.
- **Showing the reviewer the items early, or the key ever.** Turn 1 carries no item; the key stays with the parent. An Explore agent can read files, so the brief's content goes into its prompt and messages, never the path of the review folder.
- **The wrong reviewer.** A general-purpose sub-agent starts with the repo's instruction files, and whatever of the parent's thinking they hold; the reviewer is an Explore sub-agent with its model set to Opus.
- **Running on its own.** A hard decision is not a reason to start a review; only the user's `/second-opinion` or `second-opinion` reply is.
- **Treating the verdict as the decision.** The reviewer informs; the user decides, on the screen shown again.

**When NOT to use.**

- A choice with one viable answer: that is decided, not reviewed.
- Bugs in a code change: `/code-review`.
- How a skill's run went: a skill audit.
- Anything a test, a linter or a script can check: run it.

## Implementation

The mechanics are one script, [`review-run.sh`](review-run.sh): `check` a brief, `split` it, and `cost` a finished review. The reviewer's prompts are in `## Sub-agent invocation`, word for word.

### Step 1 — Gather the items

From a screen's `second-opinion` reply: the items are the screen's options, each item's text its row's description of what the option is (not the matrix cells, which are verdicts), each item's label its option label; the decision is the screen's question; the evidence is the screen's Where and Evidence. The Recommended line, its why and the options table's verdict columns are withheld. Typed with a target: one item is the target itself (a file or section is pasted, not linked: the reviewer must not need the repo to read it); several are the options the arguments name. When the arguments do not say what to review, ask in chat.

### Step 2 — Write the brief

In the session's scratch folder, never in the repo, write `brief.md` with these fields as `## ` headings, in this order: `## Items` (each item a `### Item: <label>`, its text below), `## Audience` (who reads or uses the result, and what they need from it), `## Decision` (what is being decided, as a question, or for one item what it is for; then what form the items take: the options of a decision screen, each a few lines on what it would do, with the screen's verdict columns left out so they are judged as options, not as table rows; or a whole draft), `## Constraints` (what must hold), `## Evidence` (the facts measured, each with its source: a file and line, a commit, or the command that measured it; a file in another repo by a path the reviewer can open, never by the repo's name alone; and the one real example the screen showed), and last `## Standards`: the Collaboration style and Decisions and reviews sections of the user-wide instructions you have loaded, word for word with their headings, then any standards this skill's `## This repo` lists. Leave out your reasoning, your recommendation, any verdict, who wrote what, and every option label outside its own item.

### Step 3 — Check and split

Run `bash .claude/skills/second-opinion/review-run.sh check <brief>`. Each `PROBLEM:` line is fixed in the brief (Failure modes: reword the leak out, never drop what the reviewer needs) until it prints `ok`. Then reread the brief as the reviewer will, for a leaning no phrase list catches, and run `… split <brief> <folder>`: it writes `criteria.md` (turn 1), `items.md` (turn 2) and `labels.txt` (the key).

### Step 4 — Turn 1: the criteria

Start an Explore sub-agent with its model set to Opus (the Agent tool's `model` parameter), in the foreground, with the turn 1 prompt from `## Sub-agent invocation` followed by the contents of `criteria.md`, word for word. Its reply, the weighted criteria, may come back as a message from the agent rather than as the tool's result; the sender is its agent id, which the next steps need. If it asks about the brief instead, answer only from the brief's facts.

### Step 5 — Turn 2: the items

Resume the same sub-agent with `SendMessage` to its id (when it is a deferred tool, load it first with ToolSearch `select:SendMessage`): the turn 2 message from `## Sub-agent invocation` followed by the contents of `items.md`, word for word. It resumes in the background with its turn 1 context, and its report arrives as a message from it: wait for that, never poll or ask whether it is done.

### Step 6 — Record the cost

Run `bash .claude/skills/second-opinion/review-run.sh cost <agent id> --note "<what was reviewed, in a few words>"`. The output is `n/a` when the sub-agent's transcript holds no final count; the review is still recorded.

### Step 7 — Show it

In one message: the report word for word; the key (`P` = `<label>`, …); then your response, one line per point of the report: `agree` and what changes, `dispute` and the evidence, or `open` and what would settle it; then the screen again with each change marked, or for one item the changes you would make, with its usual reply key; then the cost line. Pass any captures the report carries to `/log` as the user decides.

## Sub-agent invocation

The reviewer is an Explore sub-agent: it starts with no instruction files, so every prompt below is complete in itself, and the capture types are spelled out from [this repo's capture types](../../../AGENTS.md#capture-types) where the sentence says so.

**Turn 1** (the Agent tool, `subagent_type` Explore, `model` opus), followed by the contents of `criteria.md`: `You are reviewing work for someone who will make a decision, and you get the brief in two turns. This turn has the context and the standards below, and no item: the items come in the next message, so do not search for them or read any file now. Write the criteria a good answer must meet for this audience and this decision, fitting the form the Decision field says the items take: for each, one line on what it asks and why it matters here, and a weight, the weights summing to 100. Base them on the context and the standards only. If the brief is unclear, say what you are assuming. Reply with the criteria and nothing else.`

**Turn 2** (`SendMessage` to the same agent), followed by the contents of `items.md`: `Here are the items, under neutral labels in no particular order; do not guess who wrote which or which is favored. Review them against your criteria; change a criterion only by saying which and why. Read repository files only to check a claim an item or the brief makes. If there is one item, reply with its problems ranked most serious first, each with its evidence (a quote, or a file and line), then a fix for each, then what is missing. If there are several, reply with a score per item on each criterion, the winner and what would flip it, a combination worth making or "none", and an option nobody listed or "none found". Then, either way: blind spots (what the brief's author seems not to have considered); each convention you applied, marked sure or unsure; each ambiguity in the brief and how you read it; and what you could not verify. Plain language, no jargon without a plain gloss. End your report with a "Captures for /log" section: one "- <type>: <title> — <body>" bullet per journal-worthy item this work surfaced, where <type> is one of <this repo's capture types, spelled out>; omit the section if there are none, and never write to journals yourself.`
