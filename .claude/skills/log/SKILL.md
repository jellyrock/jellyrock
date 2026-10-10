---
name: log
description: "Single-entry-point capture for the journals this repo keeps: `decision` (agent-gated: ADR-grade becomes a numbered record in `docs/adr/`, sub-architectural a note in `docs/decisions.md`, trivia is declined; `--revise=<slug>` corrects a note that misdescribes what shipped, which is not a supersede), `followup` (an open entry in `docs/progress.md`, written by the journal script with a permanent fid; `--area=<name>` picks its category), `signal` (a `docs/signals-backlog.md` upstream version-watch row) or `running` (the `## Currently running` paragraph in `docs/progress.md`). Routes by the first argument. Mechanical types apply directly with no confirmation prompt; `decision` is agent-classified: the agent drafts, applies a significance gate (architectural / hard-to-reverse / cross-component?), routes it, and shows a diff-and-confirm before writing, with one-tap human override. The only sanctioned write path for these journals. Pure local-file edits; it commits nothing, the change that prompted the entry carries it. Use when you have something to write down. NOT for status flips on existing entries (use /done) and not for half-formed thoughts (refine first, /log once the shape is clear)."
model: sonnet
effort: low
---

# /log — single-entry-point capture

## This repo

- **Types beyond `followup` and `decision`:** `signal` and `running`; their steps, and this repo's decision routing and `--revise=<slug>`, are in [jellyrock.md](jellyrock.md): read it before any `decision`, `signal` or `running` capture.
- **Capture rule:** agents never raw-edit `docs/decisions.md`, `docs/progress.md` or `docs/signals-backlog.md`; a capture goes through this skill and a closure through `/done` ([AGENTS.md](../../../AGENTS.md), Capture & state discipline). The post-merge journal-sync workflow is the one other writer to `progress.md`.
- **`followup` category:** `--area=<name>` in the arguments is the category. The areas are the `### ` headings under `## Open followups` in `docs/progress.md` (`journal.sh list`); with no `--area`, infer it from the files the work touched, and ask before adding a new one.
- **Nothing is committed by `/log` here** (`commit=no`): an entry rides in the commit of the change that prompted it, so a journal file with uncommitted edits is normal: `journal.sh` never refuses for it, and skip Step 1's check for a decision's file too.
- **Check after every write**, a `signal`, `running` or `decision` write included: `npm run lint:docs`.
- **Not here:** internal tech debt goes to `/tech-debt-scan` (`docs/architecture/tech-debt.md`); a user-facing bug or feature request goes to a GitHub issue (`/create-issue`).

## Contract

**Goal.** Be the single capture entry point for every kind of journal write this repo keeps, so instead of remembering which file each entry lives in and which format it uses, the user types `/log <type> <body>` and the skill routes to the right place in the right format. There are **two capture modes.** *Mechanical* types (`followup` and most domain types) apply **directly** — no per-invocation gate, because routing is mechanical and the corrective loop for systematic wrongness is an audit of the skill's runs, not a confirmation prompt every session. A followup is written by the journal script (`journal.sh`), which does everything with one right answer — the entry's place, its markers, the date line, the checks and the commit — so the model carries only the judgment: which category, the title, the fid, the words. The *agent-gated* `decision` type is the deliberate exception: the agent drafts the record, applies a **significance gate** (is this architectural, hard-to-reverse, or cross-component?), routes it (numbered ADR vs. the tracked project's decision list vs. decline-as-trivia), and shows a **diff-and-confirm** the human can override in one tap — here the gate is right because the agent is confirming a *classification judgment*, not gating a mechanical append. Capture stays frictionless for the human, who classifies nothing; the deliberation moved to the agent. The mechanical path is light, but the `decision` flow's significance-classification + supersede judgment is a plausible-wrong trap, so the skill is pinned at the **Sonnet tier with `effort: low`** — a model-axis comparison measured a cheaper-tier tail (a fraction of runs fabricate a supersede of a non-existent record / wrongly flip a near-miss), which disqualifies the cheapest tier for this journal-of-record skill; effort is `low` because the classification correlates information already present in the input rather than generating absent information. Started by the agent it runs on the session's own model and effort; its pin applies when it is typed.

**Inputs.** The arguments are `<type> [optional title or body]`. The first whitespace-separated token is the type; the rest is passed to the type-specific flow. The recognized types are this repo's capture types (a Repo facts slot in `AGENTS.md`), the one list every capture sentence also reads. If there are no arguments, the skill prompts for the type, listing the valid ones. Unrecognized type → list the valid types and ask; never guess.

**Outputs.**

- For a `/log followup`: a new entry in the followup journal, written by `journal.sh add` — a `####` heading carrying the title, a `[fid: …]` identity and a `[captured …]` date, with the body below it — and the journal's date line bumped. Or, when an open entry already covers the same thing, that entry extended instead. For an item an agent proposed, Step 2's entry test may give a fix commit or a one-line drop in place of an entry.
- For a `/log decision`: depending on the agent's routing, either a **new numbered ADR file** (`docs/adr/NNNN-*.md`, drafted from the captured content + session context), a dated line in the tracked project's decision list, or a one-line decline (written nowhere) — surfaced as a **diff-and-confirm** before writing, with the proposed routing shown so the human can override it in one tap.
- A standalone path-restricted commit of just the written files, made by `journal.sh commit` — unless this repo commits journal writes together with the change that prompted them, which the script knows and says.
- A one-line confirmation after the write (and after any commit), so the user has the new HEAD's short SHA or the equivalent confirmation that the entry landed.

**Success criteria.**

- **Mechanical captures** are applied directly — no per-invocation diff-then-confirm gate. Trust the skill, and if outputs go wrong, audit the skill's runs to surface the friction and fix the SKILL.md. Per-invocation confirmation is the wrong corrective loop for *systematic* capture issues — it adds friction every session and masks the systematic problem audit would catch.
- **The `decision` type is the one exception to the no-gate rule** — it surfaces a diff-and-confirm because the agent is confirming a *classification + routing judgment* (Is this ADR-grade? Which surface does it land in?), not gating a mechanical append.
- For `/log decision`, **the agent applies the significance gate itself and the human classifies nothing.** ADR-grade decisions (architectural / hard-to-reverse / cross-component) become numbered ADRs; sub-threshold decisions made inside a tracked project go to its decision list; trivia is declined. The human only confirms or overrides the proposed routing. ADR creep is prevented by the agent's filter, not by removing the capability or by asking the human to predict ADR-grade at capture time.
- Every followup has an identity that never changes and is never reused: its fid. It is referred to by that fid everywhere — commits, other entries, code comments — never by its position, so closing one entry never changes what another reference points at.
- The journal's format is the script's, not re-derived by the model: an entry the script did not write, or a hand edit that breaks the format, is caught by `journal.sh check`.
- A followup is filed once: an open entry that already covers the same file, symbol or error is extended, not duplicated.
- A followup an agent proposed passes the entry test first (fix, drop or file); only `file` writes an entry, and every outcome is reported with its why.
- Path-restricted commits leave every other change in the working tree alone, including other uncommitted edits in the same file (the skill asks first when there are any).
- The skill is pure local-file edits — no remote calls, no external API hits, no service restarts. Capture is fast and offline-safe.
- When the type-specific flow needs information the user didn't supply AND can't be inferred (a category, a Requires field), the skill asks for it in chat (the choices and a recommendation) and waits. The bar is "genuinely ambiguous, multiple equally-valid choices" — not "any uncertainty." Routine captures with inferable fields don't earn a prompt.

**Failure modes to avoid.**

- **Adding friction prompts in place of audit-driven fixes.** If *mechanical* captures consistently land in the wrong category or with hallucinated content, the corrective loop is an audit of the skill's runs → fix the SKILL.md → re-dogfood. NOT "add a confirmation prompt to gate every invocation." (The `decision` type's diff-and-confirm is **not** this anti-pattern — it gates an agent classification judgment, not a mechanical append.)
- **Hand-editing the journal instead of running the script.** A followup added, revised or closed with an editor skips the fid and date checks and the date line, and can break the format every reader depends on. Every followup write goes through `journal.sh`.
- **Referring to a followup by its position** ("#3 under Tooling"). Positions move whenever an entry closes; a reference by position silently comes to mean a different item. Use the fid.
- **A category named for the work that surfaced the item.** A category named after a slice, a project or a session becomes a dumping ground for unrelated items. File by the area whose code the fix changes.
- **Letting the human predict ADR-grade at capture time.** `/log decision` must NOT ask the human "is this an ADR?" up front — that re-imports the prediction-at-capture friction the agent-gate exists to remove, and a tired human under-classifies.
- **ADR creep — auto-filing every decision as a numbered ADR.** A decision that isn't architectural, hard-to-reverse, or cross-component is NOT an ADR. If every decision becomes an ADR, the high-signal ones drown.
- **Inventing missing fields when they're not inferable.** If the user said "log a followup" with no body or no inferable category, ask — don't pick a plausible-looking placeholder.
- **Misrouting a followup as a decision (or vice versa).** A "remember to do X next session" is a `followup`; a "we chose X over Y because Z" is a `decision`. When the body is genuinely ambiguous between the two, ask rather than guess — the two land in different places with different gates.
- **Filing a one-off as a followup.** A slip with no recurring shape, or a few-line fix that could be made now, filed as an entry, is noise every later triage reads past until someone closes it. The entry test drops or fixes it.
- **Routing to the wrong type on ambiguous input.** When the first argument could plausibly be a type name OR the first word of the body ("decision on X is still open"), surface the ambiguity and ask.
- **Folding a closure into a `/log` capture.** `/log` only adds (or extends) an entry. Don't close or mark done any entry during a `/log` run. Closure is `/done`'s job, as a separate invocation: finish the `/log`, then run `/done`.
- **Committing more than the journal write.** Unrelated changes in the working tree MUST stay out of a journal commit — bundling them creates conflicts when the journal commit is later cherry-picked or deployed on its own. The same holds inside the file: if it already has uncommitted edits before the capture, say so and ask rather than sweep them in.

**When NOT to use.**

- The capture is actually a normal commit message body. Just write the commit; don't pile a `/log` on top.
- The capture is a half-thought. Write it down somewhere informal first, refine it, THEN `/log` once the shape is clear. Premature `/log` produces noise the next `/catchup` has to wade through.
- The change is to an existing entry's status (open → closed). That's `/done`, not `/log`.
- The capture is a tactical bug fix with no journal entry to make — just commit it normally.
- You're deliberately writing a heavyweight ADR by hand (a long Context / Alternatives section). `/log decision` is the fast-capture path, not a requirement: a hand-written ADR is a normal commit.
- The capture belongs to one tracked project (a phase note, not cross-cutting). It goes in that project's PLAN: resume the project (`/resume-project`) and record it there.

## Implementation

Every followup read and write goes through `bash .claude/skills/log/journal.sh` (run from anywhere in the repo; `journal.sh` with no arguments prints its commands). It finds the journal itself — `docs/cursor.md` unless this repo's `.claude/skills/log/journal.conf` names another — so no step here names the file. A type other than `followup` and `decision` is this repo's own: its steps are in this skill's `## This repo`.

### Step 1 — Parse the type

The first whitespace-separated token of the arguments is the type; the rest is the body. The valid types are [this repo's capture types](../../../AGENTS.md#capture-types); `followup` also answers to `f` and `todo`, `decision` to `d`, and a type of this repo's own to the aliases its `## This repo` gives.

- No arguments → list the valid types and ask in chat which, then wait.
- A first token that is not a valid type → list the valid types and ask; never guess a type.
- A first token that is a type name, but the rest reads as a sentence starting with that word ("decision on the backup schedule is still open") → ask whether it is that type or a body.

**Before any write:** the path-restricted commit in Step 5 would take along any uncommitted edits already in the file it commits. `journal.sh add` and `replace` refuse a journal that has some, where this repo commits journal writes (the refusal says so): show those edits and ask: commit them first, or run the write again with `--allow-dirty` and leave this capture uncommitted (no Step 5 commit). For a decision, check the file about to change yourself (`git diff --quiet HEAD -- <file>`) and ask the same way.

### Step 2 — `followup`

1. **Entry test, for an item an agent proposed** (a sub-agent's capture, an item in a skill's report, one you noticed yourself). Skip it when the user asked for this followup in their own words. Give the item exactly one outcome:
   - **fix**: the fix is a few lines in one file of this repo and needs no new test. Make it now, as its own commit, in place of an entry.
   - **drop**: nothing shows it will happen again (a one-off slip, already handled, or nothing anyone would act on). Write nothing.
   - **file**: it will recur or matters later, and cannot be done now (it needs a test, a design choice, another repo, or the user). Go on to the next item, and say in the body why not now.

   Report each outcome with its one-line why (in the caller's report, or in Step 5's confirmation), so a wrong `drop` or `fix` is seen and can be overridden: the user's override files it.
2. **Look for a duplicate first.** `journal.sh list` shows every open entry. Search the journal for the file, symbol or error text the new item is about (`grep -n '<file-or-symbol>' "$(bash .claude/skills/log/journal.sh path)"`). If an open entry already covers it, `journal.sh show <fid>`, then add what is new to that entry with `journal.sh replace <fid> --body-file <file>` instead of adding a second one.
3. **Pick the category** from `list`: the area whose code the fix changes, not the work that surfaced it. Never file under a category named for a slice, a project or a session. A new category only for a durable area that none fits; ask in chat only when two fit equally.
4. **Write the entry:**
   - **Title** — one line naming the problem, readable on its own.
   - **Fid** — a few distinctive words from the title, lowercase and hyphenated, at most 64 characters. It is permanent and never reused; the script refuses one that is malformed, already in the journal, or ever used before in its history — then pick another.
   - **Body** — what + why + where, self-contained for a cold session: the evidence that surfaced it (commit, file, session) and the action that closes it. No heading lines in it.
   - **Prompt** (optional) — when the item is meant as a future session's opening command, pass it with `--prompt "/<command> <args>"`.
   - **Pin** (optional) — only when the user says this followup comes first: pass `--pinned`. A pinned followup outranks all project work when the next move is picked. To pin or unpin an existing entry: `journal.sh replace <fid> --pin` (or `--unpin`).
5. **Add it.** Write the body to a temporary file with a quoted heredoc (`cat >"$tmp" <<'EOF'`) so nothing in it is escaped, then run `bash .claude/skills/log/journal.sh add --category "<category>" --fid <fid> --title "<title>" --body-file "$tmp"` (plus `--prompt` and `--pinned` when set). It stamps the entry's `captured` date and bumps the journal's date line.
6. **Read it back** with `journal.sh show <fid>`: the Markdown must read as meant (a stray backslash from an escaped backtick is the usual fault).

Then Step 4.

### Step 3 — `decision` (agent-gated)

The human supplies content; the agent does the rest:

1. **Draft** from the body + session context: what was decided, why, over what alternative, what it affects or supersedes. A count or measurement in the draft is run again now, with the command that defines it (the checker's own rule, not a grep for part of the text), never carried over from earlier in the session: the record outlives the session that could correct it.
2. **Significance gate.** Architectural, hard-to-reverse, or cross-component? Negative filter: if every decision is architectural, none is.
3. **Route on the verdict:**
   - **ADR-grade** → a new `docs/adr/NNNN-<slug>.md`, numbered after the last in `ls docs/adr/`, written in the header style and sections of the newest ADR there. If `docs/adr/README.md` has an index table, add its row. With no `docs/adr/` yet, start at `0001` with `# ADR 0001 — <title>`, a `- **Status:** Accepted` / `- **Date:** <today>` / `- **Deciders:** …` header, and `## Context` / `## Decision` / `## Consequences` / `## Alternatives considered` — unless this skill's `## This repo` names the repo's own decision log, which then takes the place of `docs/adr/`. Made inside a tracked project, it also gets a one-line pointer (date, title, where the record lives) prepended to that PLAN's decisions list, in the same commit: `/end-session` skips a decision this run recorded, so a missing pointer leaves the PLAN without it.
   - **Supersede.** A full supersede flips the old record's status and adds a pointer banner to it, in the same commit. A partial one says what moved, on both records, and leaves both accepted.
   - **Sub-threshold, inside a tracked project** (the one this session resumed, or another the decision is plainly about) → prepend one dated line to that PLAN's decisions list, in the list's own shape, then run `bash .claude/skills/end-session/move-old-decisions.sh <project-dir>/PLAN.md`: it keeps the newest few and moves older ones to `DECISIONS.md` beside the PLAN. The projects folder is what `bash .claude/skills/start-project/projects-dir.sh` prints.
   - **Sub-threshold, outside any project** → fold it into the followup it concerns (`journal.sh replace`), or decline it in one line — unless this skill's `## This repo` names a note surface for these.
   - **Trivia** → decline in one line ("below the ADR bar; not recorded") and write nothing.
4. **Diff-and-confirm.** Before showing the draft, check it for what Step 4's checks reject and you can see (a `/<skill>` this repo does not have, a link to a missing file), so the text the human confirms is the text committed; a fix Step 4 still needs after the reply is shown again before the commit. Show the proposed routing and the drafted text. If the decision changes a choice the human approved earlier, put that change on its own line above the draft, as its own question: a line inside the record is not consent. The human confirms or redirects in one reply; nothing is written before that.
5. **Apply** only what was confirmed, then Step 4.

### Step 4 — Check before committing

- **Public posture.** When [this repo's public posture](../../../AGENTS.md#public-posture) is `public`, re-read the exact text about to be committed: it names no other repository or host, no person, email or home path, and no secret, token or address. Describe an outside dependency by its role, not its name.
- **Checks.** Run `journal.sh check` after a followup write, and [this repo's docs check](../../../AGENTS.md#docs-check) unless it is `none`. Surface every FAIL or WARN; fix what a write of this run caused.

### Step 5 — Commit

`journal.sh commit` makes the path-restricted commit (`-m` before `--`), stages a file the write created, and prints `committed as <sha> on <branch>`. When this repo commits journal writes together with the change that prompted them, it commits nothing and says so; pass that on.

- `followup` → `bash .claude/skills/log/journal.sh commit --intent "<one-line intent>"` (the script adds this repo's subject prefix).
- `decision`, ADR → `… commit --subject "ADR NNNN: <title>" docs/adr/NNNN-<slug>.md` plus the superseded ADR and the PLAN when those changed.
- `decision`, project → `… commit --subject "<project-slug>: decision — <one-line title>" <project-dir>/PLAN.md` plus `DECISIONS.md` when it changed — and no commit at all when `git check-ignore -q` says the PLAN is not tracked.
- `decision`, declined → nothing to commit.

If a hook refuses the commit, nothing was committed: fix what it names and commit again; never `--no-verify`. Skip the commit only when the user said "don't commit" / "leave it for me".

## Sub-agent invocation

To invoke from a sub-agent, the parent passes: `Read .claude/skills/log/SKILL.md and follow the steps with the arguments <type and body>; run journal.sh list to pick a category, then return the drafted entry and the exact journal.sh add command — never run add, replace or commit. End your report with a "Captures for /log" section: one "- <type>: <title> — <body>" bullet per journal-worthy item this work surfaced, where <type> is one of [this repo's capture types](../../../AGENTS.md#capture-types); omit the section if there are none, and never write to journals yourself.` A parent writing that prompt for an Explore sub-agent (which loads no instruction files) spells the types out from the slot in place of the link. A sub-agent this section starts NEVER applies a journal write: the journal is what `/catchup` reads first every session, so an unconfirmed entry misleads every session after it. The one grant is elsewhere: a `/sonnet` sub-agent its parent supervises carries out the journal writes its saved plan names, as the plan's own steps, and the parent reviews them before any push. For `decision` the bar is higher still: a sub-agent surfaces the proposed routing + drafted record and waits; it never files an ADR, since a numbered ADR is a durable, supersede-only record.
