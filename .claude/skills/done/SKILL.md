---
name: done
description: "Mark journal work complete — close an existing followup by its fid, acknowledge or complete an upstream-version signal, or ship the in-flight `running` cursor. Companion to /log (which captures NEW entries — /done closes EXISTING entries). Finds the entry, proves the work actually landed, then closes it: a followup through the journal script (the entry is removed; git is the history; on main it also gains a Recently shipped line), a signal or the cursor by a direct edit. Nothing is committed on its own: the closure rides in the commit of the change that prompted it. No confirm gate on a proven closure. Pure local-file edits, apart from read-only checks that the work landed. Use when the work an entry describes is committed on this branch (pushed or merged is not required, since the closure rides in the same change set) and its journal entry needs closing. NOT for capturing NEW entries (use /log) and NOT for work that is still uncommitted, undeployed or partial (don't pre-mark optimistically)."
model: sonnet
effort: low
---

# /done — mark journal work complete

## This repo

- **Two closure types of this repo's own: `running` and `signal`.** Both are direct edits, not `journal.sh` calls, and neither commits (this repo's journal settings already say journal writes ride in the change's commit). A type is picked before the followup match: the literal token `running` (case-insensitive) is the cursor; a pointer that is an exact `### <slug>:` heading in [`docs/signals-backlog.md`](../../../docs/signals-backlog.md) and matches no followup title is a signal.
- **`running`** closes the cursor paragraph under `## Currently running` in [`docs/progress.md`](../../../docs/progress.md). Landing check as for a followup (Step 2). Empty paragraph: say "no Currently-running cursor to close" and stop. Otherwise: on `main` only, prepend `- YYYY-MM-DD: <paragraph, whitespace collapsed to one line>` to `## Recently shipped`; clear the paragraph (keep the heading); bump the file's `last-updated:`. Only part of it shipped: ask whether to promote it whole or replace it, and replace with `/log running`.
- **`signal`** needs no landing check (acknowledging means "I reviewed the upstream", not "work shipped"). Auto-managed slugs `jellyfin-server-stable`, `jellyfin-server-rc`, `roku-os` are perpetual: set `**latest_acknowledged**:` to the current `**latest_upstream**:` (already equal: say "nothing to acknowledge" and stop), flip `**status**:` `action_pending` to `watching`, never to `completed`. Never touch `**last_checked**:` or `**latest_upstream**:` (the aggregator's fields). Any other slug: `**status**:` to `completed` and `**latest_acknowledged**:` to `**latest_upstream**:`. Then bump the file's `last-updated:`.
- **Recently shipped, for a closed followup.** On `main` only, after `journal.sh close`, prepend `- YYYY-MM-DD: <title>` to `## Recently shipped`. On any other branch skip it: the post-merge [`journal-sync`](../../../.github/workflows/journal-sync.yml) writes one line from the PR title (it skips some PRs by label, author or title: `shouldSkip()` in `scripts/journal-sync.js`; git is the record then). A followup that states a problem rather than a deliverable gets a one-line resolution naming what shipped, not its text verbatim under today's date. The `running` close needs the same `main` rule.
- **No journal match:** a tech-debt entry is removed with [`/tech-debt-scan`](../tech-debt-scan/SKILL.md); a GitHub issue with `gh issue close <N>` (`/done` never touches GitHub).

## Contract

**Goal.** Be the single closure entry point for every kind of journal entry this repo keeps. When a piece of work lands — a followup is done, a backlog row is built, a queued item is materialized — the user types `/done <thing>` and the skill finds the existing entry, proves the work landed, and closes it directly — no per-invocation diff-then-confirm gate (see Success criteria). **Landed** means in this branch's history (or deployed, when the entry is about a deploy): it need not be pushed or merged, because the closure commits on the same branch and reaches the default branch only with the fix. So the closure belongs in the fix's own change set, never in a later commit, push or pull request of its own. A followup is closed by the journal script (`journal.sh`), which removes the entry by its fid, bumps the journal's date line and makes the commit, so the model carries only the judgment. Companion to `/log`: same journal system, different moment. `/log` captures NEW entries; `/done` closes EXISTING entries. The reasoning load is **not** uniformly mechanical, and the tier follows the riskiest step rather than the average one. Finding an entry and closing it are mechanical. But deciding that the work *actually landed* (Success criteria: "Closure writes reflect reality, not optimism") is a judgment call with an asymmetric downside: a wrong close **deletes** a known gap and leaves no trace that anything was lost, whereas a wrong *capture* only adds noise a later reader can discard. That is the same plausible-wrong shape that rules the cheapest tier out for `/log`, and it applies with more force here, so this skill is pinned at the **Sonnet tier with `effort: low`** — `low` because the verdict correlates evidence already in front of it (the entry's own closing clause, plus the command output) rather than generating anything absent. Started by the agent it runs on the session's own model and effort; its pin applies when it is typed.

**Inputs.** The arguments are a pointer — a followup's fid, or a few words of its title — optionally preceded by a type (`/done followup <pointer>`; a type of this repo's own takes the pointer form its steps give). An explicit type always wins. A pointer matching more than one entry → the skill shows the candidates and asks in chat which, never silently picks. No arguments → it lists the open entries and asks.

**Outputs.**

- For a followup: the entry removed from the journal by `journal.sh close` (its category too, when it was the last), the journal's date line bumped.
- For a type of this repo's own: that type's closure writes (a status flip, a row move), per this skill's `## This repo`.
- A standalone path-restricted commit made by `journal.sh commit`: its body says what closed the item and how that was checked, and ends with a `Closes fid:` line — unless this repo commits journal writes together with the change that prompted them, which the script knows and says.
- A one-line confirmation after the writes (and after any commit), so the user has the new HEAD's short SHA or the equivalent confirmation that the closure landed.

**Success criteria.**

- A proven closure is applied directly — no per-invocation diff-then-confirm gate. Trust the skill; if outputs go wrong, audit the skill's runs and fix the SKILL.md. Per-invocation confirmation is the wrong corrective loop for systematic issues — it adds friction every session, and `git reset --soft HEAD~1` recovers a rare mis-closure.
- Closure writes reflect reality, not optimism. When the entry's claim depends on work being committed, deployed, materialized or shipped, the skill proves it landed BEFORE closing. Pre-marking optimistically is the failure shape `/done` exists to prevent.
- Closed entries are REMOVED, not annotated with a `✅`-style marker. Git is the history; the journal tracks open work.
- An entry is closed by its fid, the identity it keeps for life. Closing one never changes what any other reference points at, and the closing commit names the fid, so the item's whole history is one `git log --grep` away.
- A fid that is no longer open is reported as closed, with the commit it left in — not as unknown, and never re-closed.
- Disambiguation asks ONLY when the pointer genuinely matches more than one entry. Unambiguous pointers apply directly.
- The skill is pure local-file edits, except for the read-only checks that the work landed.

**Failure modes to avoid.**

- **Pre-marking optimistically.** "I think the deploy went through, let me close it." NO. Check it first. Without evidence, a closure is a future audit failure waiting to surface.
- **Closing on a plausible story.** A narrative that the work is probably done is not evidence: the entry is the only thing standing between a known gap and it being forgotten. When a check can't be run, the result is *inconclusive*, and the user decides.
- **Bypassing a check that errored.** A landed-check tool that fails to run is not a pass. Surface the error; close only on the user's explicit say-so.
- **Closing a partly done item.** If only part of the work landed, revise the entry to say what remains (`journal.sh replace`, the `/log` path) and leave it open.
- **Hand-editing the journal instead of running the script.** It skips the date line and the checks, and can break the format every reader depends on.
- **Closing by position.** "#3 under Tooling" means a different item once anything above it closes. Close by fid.
- **Adding friction prompts in place of audit-driven fixes.** Same as `/log`'s rule: bad outputs get fixed by an audit of the skill's runs → SKILL.md revision → re-dogfood, not by a confirmation gate on every run.
- **Silent ambiguous-pointer resolution.** Picking the first match, the most recent, or the likeliest is silent corruption — the user knew which one they meant; ask.
- **Bundling the closure into an unrelated code commit.** A closure commit is standalone (unless this repo commits journal writes with the change that prompted them); bundling it creates conflicts when the code commit moves on its own.

**When NOT to use.**

- The work isn't done yet: not committed on this branch, or not deployed when the entry is about a deploy. A commit on this branch is done: don't wait for the push or the merge.
- The work is a tactical bug fix with no journal entry to close — just commit normally.
- The entry is deferred, not closed — leave it in place (update its body with the new context via `/log`'s `replace` path if useful).
- Only some pieces of a multi-step landing are done. Revise the entry; `/done` it when the last piece lands.
- The capture is a NEW entry. That's `/log`.
- The thing to close is a decision. Decisions are records, not to-dos: a later `/log decision` supersedes one.
- The thing to close is a project's PLAN milestone (a phase shipped). That's `/end-session` on the project's PLAN.

## Implementation

Every followup read and write goes through `bash .claude/skills/log/journal.sh` (run from anywhere in the repo; with no arguments it prints its commands). A closure type of this repo's own is closed per this skill's `## This repo`.

### Step 1 — Resolve the pointer

- `/done decision …` → say decisions are records, not to-dos (a later `/log decision` supersedes one), and stop.
- A type of this repo's own named first (or plainly meant) → its steps in `## This repo`.
- Otherwise a followup; `followup`, `f` and `todo` may lead. The pointer:
  - **a fid** → `journal.sh show <fid>`. If the script says it is not open, pass that on (it names the commit the entry left in) and stop.
  - **words of the title** → match them against the titles `journal.sh list` prints. One match → its fid. Several → show them and ask in chat which. None → say so and stop: `/done` closes existing entries; new ones are `/log`.
  - **nothing** → show `journal.sh list` and ask which to close.
  - **a position** ("#3", "Tooling #3") → positions are not identities; show that category's entries and ask which fid is meant.

**Before any write:** `journal.sh close` refuses a journal that already has uncommitted edits, where this repo commits journal writes, since the commit after it would take them along (the refusal says so). Show those edits and ask: commit them first, or run the close again with `--allow-dirty` and leave this closure uncommitted.

### Step 2 — Prove the work landed

Read the entry's body for what closes it, and check that:

- **A committed change** (a file, script, config) → find the commit that made it (`git log -S'<the changed text>' --format='%h %s' -- <path>`, or the sha the entry names), then check it is in this branch's history: `git merge-base --is-ancestor <sha> HEAD`. A path's log alone proves only that some commit touched it. Pushed or not does not matter: this close commits on the same branch, on top of the fix, so it can reach the remote only with it. For a behavior fix, run the test that covers it.
- **A deploy, a converged host, a synced change** → this repo's own way of proving it, in this skill's `## This repo`.
- **A fact about a live box or an outside service** → the user reports what they actually saw; never assert it from documentation.
- **An entry that names a pull request** → the forge says it is merged, or it is the one open for this branch and its commits are in this branch's history. Where this repo has `.claude/skills/pr/forge.sh`, `bash .claude/skills/pr/forge.sh pr view <N> | jq -r .state` prints `MERGED` on either forge; without it, the user reports what the pull request's page shows, as for an outside service above.
- **An entry that says it is tracked in a project** → that project's PLAN Status records the work done (the projects folder is what `bash .claude/skills/start-project/projects-dir.sh` prints).
- **"Noticed and dealt with"**, with nothing checkable named → no check; close.

**Pass** → Step 3. **Inconclusive** → show exactly what was and wasn't confirmed, and close only on the user's explicit go-ahead. **Fail** → refuse: show the evidence and say what would make it pass, naming the step ("commit the fix on this branch"); never offer to run it, to push, or to wait for CI yourself. A checking command that errors is inconclusive, never a pass. If only part of the work landed, don't close: revise the entry with `journal.sh replace <fid> --body-file <file>` to say what remains, and stop.

### Step 3 — Close it

`bash .claude/skills/log/journal.sh close <fid>` — it removes the entry (and its category, when it was the last), and bumps the journal's date line. No confirmation: the check in Step 2 is the gate.

### Step 4 — Check, commit, suggest the follow-on

1. Write the commit body to a temporary file with a quoted heredoc: what closed the item (with its commit, when there is one) and how that was checked, in a sentence or two. When [this repo's public posture](../../../AGENTS.md#public-posture) is `public`, re-read the body and the subject: no other repository or host, no person, email or home path, no secret.
2. Run `journal.sh check` and [this repo's docs check](../../../AGENTS.md#docs-check) unless it is `none`. Surface every FAIL or WARN.
3. `bash .claude/skills/log/journal.sh commit --intent "close [fid:<fid>]" --closes <fid> --body-file "$tmp"` — a path-restricted commit of the journal whose body ends with the `Closes fid:` line; it prints `committed as <sha> on <branch>` (or says this repo commits journal writes with the change that prompted them). If a hook refuses, nothing was committed: fix what it names and commit again; never `--no-verify`. Skip the commit only when the user said "don't commit".
4. If closing the work settled a choice nobody recorded (a rule changed, a new pattern, a tool picked), suggest `/log decision`; don't run it. Closing is a common moment for an unrecorded decision to surface.

## Sub-agent invocation

To invoke from a sub-agent, the parent passes: `Read .claude/skills/done/SKILL.md and follow the steps with the arguments <thing>: resolve it to one fid with journal.sh, run the Step 2 check, and report the fid with the evidence that the work landed — never run close or commit. End your report with a "Captures for /log" section: one "- <type>: <title> — <body>" bullet per journal-worthy item this work surfaced, where <type> is one of [this repo's capture types](../../../AGENTS.md#capture-types); omit the section if there are none, and never write to journals yourself.` A parent writing that prompt for an Explore sub-agent (which loads no instruction files) spells the types out from the slot in place of the link. A sub-agent this section starts NEVER applies a closure: a wrong "closed" deletes a known gap from the journal `/catchup` reads first every session, and nothing afterwards shows it was lost. The one grant is elsewhere: a `/sonnet` sub-agent its parent supervises runs the close its saved plan names, as one of the plan's own steps, and the parent reviews it before any push.
