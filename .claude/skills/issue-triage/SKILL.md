---
name: issue-triage
description: "Investigate one GitHub issue and act on it the /snag way. Fetches the issue and its comments, first checks it is still true (everything it names still exists), reads it through the repo's issue forms, classifies it (bug, feature, enhancement, or a design decision), checks whether it is real, reproducible and not already fixed, maps it to an area, reproduces it and finds the root cause, then shows one decision screen; the chosen fix is built test-first and committed on a fix branch, never pushed. Anything posted on the issue is drafted and shown first. Use when you have an issue number you want to act on."
model: opus
effort: high
user-invocable: true
allowed-tools: Bash(bash .claude/skills/pr/forge.sh issue view:*), Bash(bash .claude/skills/pr/forge.sh issue list:*), Bash(bash .claude/skills/pr/forge.sh pr list:*), Bash(git log:*), Bash(git ls-files:*), Bash(git status:*), Bash(git rev-parse:*), Bash(date:*), Bash(ls:*), Read, Write, Grep
---

# /issue-triage — investigate one GitHub issue

## This repo

- **Area map** (Step 5), also used by `/runtime-triage`:

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

- **Expected behavior** (Step 4): [`docs/user/app-settings.md`](../../../docs/user/app-settings.md) and [`docs/user/jellyfin-server-feature-matrix.md`](../../../docs/user/jellyfin-server-feature-matrix.md).
- **The fix** (`/snag`'s build): a change that touches logging gets the `log-reviewer` agent, never blanket-added logs.

## Contract

**Goal.** Take one GitHub issue from filed to acted on in one session: a fix built, a decision put to the user, a reply asking the reporter for what is missing, or a recommendation to close. It checks before it fixes, stopping at the first check that settles it: is the issue still true (everything it names still exists), is it expected behavior, is it already fixed, is it reproducible. Then it reproduces it, names the root cause and follows `/snag`'s method: a decision screen, the user's pick, the fix built test-first and committed, never pushed. It runs on Opus because classification, validation and root cause are judgment over real code.

**Inputs.** The arguments are an issue number; with none, ask for it. The skill reads the issue and its comments, the repo's issue forms, its issues and merged pull requests (duplicates, earlier fixes), the code and history the issue points at, and this skill's `## This repo` (the area map, the docs that say what is expected behavior, how to reproduce here).

**Outputs.** One of: `/snag`'s decision screen and, on the user's pick, a fix (its test, one commit on a `fix/issue-<N>` branch when it started on the default branch, and `/snag`'s report); a comment drafted for the issue (missing detail, a duplicate, a support answer, or a recommendation to close citing the commit that removed its premise), posted only on approval; or a design question routed to a project.

**Success criteria.**

- A stale premise, expected behavior, a duplicate, an earlier fix and a support question are each caught before any fix and answered as such.
- The classification rests on the issue's shape first and its labels second; the area on this repo's area map; an ambiguous call is shown, not forced.
- The issue's own acceptance criteria, when it states them, are what done means.
- The fix is the user's pick, built test-first, committed on its own paths, not pushed; nothing reaches the issue without approval.

**Failure modes to avoid.**

- **Reproducing a ghost.** A mechanism run against a path or setting that was since removed can still "reproduce" (a pattern matches a path whether or not the file exists). Check that what the issue names exists first.
- **Fixing before validating.** User error, expected behavior, or a fix in a newer release is answered with a reply, not a change.
- **Inventing what the reporter left out.** Ask on the issue for a missing version or repro step; never assume it.
- **Forcing a classification or an area.** Surface the ambiguity; a wrong call misdirects everything after it.
- **Cutting the issue short.** Read the whole body and every comment: the decisive detail is often in a later one.
- **Acting on the issue without asking.** A comment, label, close or edit is public at once: draft it and show it first.
- **Claiming a test that did not run.** A test that needs hardware, a service or credentials this machine lacks is reported as not run, and why.
- **Filing a followup for what the issue already tracks.** The issue is the record; unbuilt findings go on it as a drafted comment, if anywhere.

**When NOT to use.**

- The issue is a support question: answer it with the contact links, no investigation.
- You want to file a new issue: that is `/create-issue`.
- A failed CI run: that is `/ci-triage`. A flaw found mid-work with no issue: that is `/snag`.

## Implementation

This skill's `## This repo` holds the repo's own parts: the area map (what words in an issue point at which paths), the user docs that say what is expected behavior, how to reproduce in this repo (and what needs hardware or a service), and any routing its areas carry. Where a step needs one, it says so.

### Step 1 — Fetch

```sh
bash .claude/skills/pr/forge.sh issue view <N>
```

Never add `2>/dev/null`: forge.sh passes the forge's own message on whole. Keep the body and every comment whole. A closed issue: say how it closed (`stateReason`, `closedByPullRequestsReferences`; both `null` means the forge records neither, as Forgejo does, so say that rather than guess) and ask in chat whether to revisit it before going on.

### Step 2 — Is it still true?

For every path, file, function, setting, command or workflow the issue names, check it exists now:

```sh
git ls-files | grep -iF '<name>'                     # a tracked file or folder
git grep -n -F '<name>'                              # a symbol, setting or command
git log --oneline --diff-filter=D -- '<path>'         # gone: which commit removed it
git log --oneline -S'<name>' | head -5               # gone: which commits last touched the text
```

Prefer `git ls-files` over `ls`: an untracked leftover must not answer for a tracked file. **Premise gone:** the outcome is a recommendation to close, citing the commit that removed it; go to Step 7 to draft that comment, and stop. **Premise intact:** continue.

### Step 3 — Read and classify

When the repo has issue forms, read them live (`.github/ISSUE_TEMPLATE/*.yml`, never a copied field list): each field appears in the body as `### <its attributes.label>`, so the body splits into named fields. Without forms the body is plain Markdown. When the issue states acceptance criteria, keep them: they are what done means.

Classify, from the body's shape first and the labels second (and the shape alone when the repo has no labels): `bug` (something behaves wrongly, with steps or versions), `feature` (a new capability), `enhancement` (a change to an existing one), or `arch-decision-needed` (its options differ in architecture, even when filed as a bug). Ambiguous: show the two candidates and why. A support question (how something works): draft an answer with the contact links in `.github/ISSUE_TEMPLATE/config.yml`, if the repo has them, go to Step 7, and stop.

Search for a duplicate, open and closed:

```sh
bash .claude/skills/pr/forge.sh issue list --state all --search "<2-3 keywords>" --limit 10
```

A likely duplicate: show it in one line with its state, and ask in chat whether to draft a pointer comment (Step 7) or go on.

### Step 4 — Validate

Answer in order, each in a sentence with its evidence; stop at the first that settles it:

1. **Expected behavior?** Read the user docs this skill's `## This repo` names. Expected: draft the explaining reply (Step 7), and stop.
2. **Already fixed?** Its `closedByPullRequestsReferences`, then `bash .claude/skills/pr/forge.sh pr list --state merged --search "<keywords>" --limit 10`, and `git log --oneline -S'<symbol>'` on the code it names. Fixed in a release newer than the reporter's version: the answer is to upgrade (Step 7), not a new fix.
3. **Reproducible?** Are the steps specific enough to run? Not: draft a comment asking for exactly what is missing (Step 7); never fill the gap with a guess.
4. **Scope?** Just the named spot, its area, or a pattern that repeats elsewhere. Say so honestly; a narrowed fix names what it leaves.

A `feature` or `enhancement` is validated the same way in spirit: does it already exist, does it fit the project, what does done look like. An `arch-decision-needed` issue, or anything too big for one session, goes to Step 8 as options, where `later` routes it.

### Step 5 — Area and context

Match the issue's words against the area map in this skill's `## This repo`. List every matching area, or say `uncertain area` and search. Pick 2 to 5 files that matter (the code the issue names, its tests, the area's recent history: `git log --oneline -10 -- <area>`); read more as the work needs it.

### Step 6 — Reproduce and find the root cause

Reproduce it for real (this skill's `## This repo` says how in this repo, and what needs a device or a service): run it, keep the command and what it showed. When it cannot run here, say what is missing. Then name the root cause at a file and line, not the first symptom; when the same cause likely sits elsewhere, search and list those places as a scope question.

### Step 7 — Anything posted on the issue

A comment, a label, a close or an edit is drafted, never sent. Write a comment to `"$(git rev-parse --git-dir)/issue-comment.md"` (it can never be committed there). When [this repo's public posture](../../../AGENTS.md#public-posture) is `public`, sweep it as `/create-issue`'s Step 7 does (a home path, a person's name or email, a secret, another repository's or host's name) and remove what is private. Show it, and ask in chat: `post`, `edit: <text>` or `cancel`. On `post`: `bash .claude/skills/pr/forge.sh issue comment <N> --body-file "$(git rev-parse --git-dir)/issue-comment.md"`; a close is `bash .claude/skills/pr/forge.sh issue close <N> --reason not-planned` (or `duplicate`, or `completed`) only on its own approval.

### Step 8 — Decide and build, the `/snag` way

Read `.claude/skills/snag/SKILL.md` and follow its Steps 2 to 7, carrying in what Steps 2 to 6 here found (finish its Step 2 with the history, what depends on the code, and at least two options). Four differences:

- The screen's first line is `**Issue:** #<N> <title> (<classification>)`; when the issue states acceptance criteria, the screen lists them under **Evidence**.
- `asap` and `later` file no followup: the issue already tracks the work. Offer instead to draft a comment carrying the findings (Step 7). Work that needs its own design or several sessions gets `/start-project` printed alone in its own block.
- Before its Step 5 builds anything on the default branch, create the fix branch: `git switch -c fix/issue-<N>`. On any other branch, commit there. The commit body names the issue as `#<N>`.
- Its report ends with one more line, by [this repo's forge](../../../AGENTS.md#forge) `prs:` value: `always` gives **Next:** push the branch (`/pr` opens its pull request, which links the issue). `on-request` gives **Next:** push as this repo's Landing says (`/pr` when you want a pull request).

## Sub-agent invocation

A parent that wants an issue investigated without the conversation (another skill handing on an issue it filed) starts a sub-agent with `model: "opus"` and this Task prompt; the parent then shows `/snag`'s decision screen, and any drafted comment, itself:

`Read .claude/skills/issue-triage/SKILL.md and follow Steps 1 to 6 for issue <N>. Edit nothing, commit nothing, and post, label or close nothing on the issue. Report whether the issue is still true (and the commit that removed its premise if not), its classification and why, each validation answer with its evidence, the areas and the 2 to 5 files that matter, the reproduction command and what it showed or why it could not run, the root cause at a file and line, at least two options with their footprint and risk, and the text of any comment the issue should get. End your report with a "Captures for /log" section: one "- <type>: <title> — <body>" bullet per journal-worthy item this work surfaced, where <type> is one of [this repo's capture types](../../../AGENTS.md#capture-types); omit the section if there are none, and never write to journals yourself.` A parent writing that prompt for an Explore sub-agent (which loads no instruction files) spells the types out from the slot in place of the link.
