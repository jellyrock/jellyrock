---
name: create-issue
model: sonnet
effort: low
description: Draft a GitHub issue body for the JellyRock repo from a Reddit/Discord post or free-form bug report and submit it via gh. Reads the YAML form templates under .github/ISSUE_TEMPLATE/ to know which fields are required, fills them by extracting from the input, asks for any missing required fields, validates the body matches the chosen template's schema, then runs gh issue create with the auto-labels the template defines. Use when you have a user report (paste from anywhere) and want to formalize it into a properly-structured GitHub issue.
user-invocable: true
allowed-tools: Bash(bash .claude/skills/pr/forge.sh issue create:*), Bash(bash .claude/skills/pr/forge.sh issue view:*), Bash(bash .claude/skills/pr/forge.sh issue list:*), Bash(bash .claude/skills/pr/forge.sh label list:*), Read
---

# /create-issue — draft + submit a GitHub issue

## This repo

- **Routing** (Step 1): a user-facing bug, feature or enhancement is an issue. Internal tech debt, upstream version watches and other deferred work go where [Capture & state discipline](../../../AGENTS.md#capture--state-discipline) says (`/tech-debt-scan`, `/log signal`, `/log followup`).
- **Regression label** (Step 3): `regression`.
- **Tracking issues** (Step 8): open epics carry the `epic` label (`gh issue list --label epic --state open --json number,title`); offer `--parent <N>` when the report belongs under one.
- **Tooling issues** (Step 6): an issue about tooling only (tests, scripts, CI, dev setup) also gets `dev-improvement`, as #910 did.

## Contract

**Goal.** Turn a raw report — a forum thread, a chat message, an email, a free-form bug description, or a defect found during work — into a well-formed GitHub issue, or route it to the surface this repo actually uses for that kind of work. The skill first checks the report belongs in the issue tracker; then it wraps the repo's YAML issue forms (`.github/ISSUE_TEMPLATE/*.yml`) as a drafting-and-submission API: it picks the right form, fills each required field from the input, marks (never fabricates) the gaps, and submits via `forge.sh issue create` with the form's labels passed explicitly. A repo without forms gets the body shape this skill's `## This repo` gives, else plain Markdown. It ships at the Sonnet tier because the work is extract-and-fill drafting with light classification judgment, not deep investigation.

**Inputs.** The arguments (optional) are the source text — a forum post body, a chat message, an email, or a free-form problem description; if empty, ask the user for it. The skill reads `.github/ISSUE_TEMPLATE/` (forms and `config.yml` contact links), this skill's `## This repo` (a routing table, a body shape, label guidance), the repo's labels, and its open and closed issues to check for duplicates.

**Outputs.** One of: a created issue whose body follows the chosen form (one `### <Field label>` per field, filled where the input supports it, gap-marked where it doesn't) or this repo's body shape, labeled with labels that exist in the repo, its URL printed; a comment on an existing issue when the report is a duplicate the user chose to add to; or a route to another surface (a journal entry, a project, a contact link) with the command to take it. A followup the input also implies is routed through `/log`.

**Success criteria.**

- A report that belongs on another surface is routed there, and that counts as success, not a failure to file.
- The input is matched to the right form from the forms' own names, descriptions and intro text, with an ambiguous call shown to the user as the top two candidates rather than guessed.
- Every required field is either filled from the input or marked as a gap ("Reporter didn't specify; needs follow-up") — never fabricated.
- Duplicates are searched across open and closed issues before drafting; a likely duplicate is the user's call (comment, file and link, or file new).
- Every label passed exists in the repo: a label the form or this skill wants that the repo lacks is matched to an existing label or left off with the user's agreement, and creating one is offered only when no existing label fits.
- In a public repo, nothing private is posted.
- The user confirms the full rendered issue before anything is submitted; the issue URL is printed on success.

**Failure modes to avoid.**

- **Filing what belongs elsewhere.** A followup, a decision or multi-session work filed as an issue in a repo that tracks those in its journal moves work onto a surface nobody reads. Apply this skill's `## This repo` routing before drafting.
- **Fabricating field values.** Don't invent a device model, a version number or repro steps to satisfy a required field — that defeats the form's purpose. Mark the gap.
- **Auto-submitting.** Never call `forge.sh issue create` before the user has confirmed the rendered issue, even if it looks complete.
- **Auto-deciding a duplicate.** Show the candidates and let the user pick; duplicate calls are judgment.
- **Paraphrasing the reporter into corporate-speak.** Lift the reporter's own wording verbatim where possible — a sanitized report loses diagnostic signal.
- **Forgetting the explicit `--label`.** A YAML form's labels are applied only when the issue is filed through the web form; the API cannot see forms, so without `--label` the issue lands unlabeled.
- **Passing a label the repo doesn't have.** `forge.sh issue create --label <missing>` fails the whole create and files nothing. Check every label first.
- **Creating a label to fit the issue.** A new label for each issue fragments the repo's label set; reach for the closest existing label first, and propose `forge.sh label create` only as the last option, never silently.
- **Naming a person in a public issue.** A forwarded report's footer names its channel and links the source when it is public; it never names the reporter.
- **Shell-quoting a body.** A multi-paragraph Markdown body passed through `--body` is one quoting slip from arriving mangled; write it to a file and pass `--body-file`.

**When NOT to use.**

- The user wants to comment on an existing issue, not file a new one — use `bash .claude/skills/pr/forge.sh issue comment <N> --body-file <file>` directly.
- The user is asking a question, not reporting a bug or proposing a change — point them to the contact links in `.github/ISSUE_TEMPLATE/config.yml`, if the repo has them.
- The input is too vague to fill any form — say so and ask for more detail before drafting.

## Implementation

This skill's `## This repo` holds the repo's own parts: a routing table for work the repo tracks outside GitHub, the body shape and title convention when the repo has no forms, label guidance beyond the forms' `labels:` (a regression label, labels automation owns), and anything to do after filing. Where a step needs one of them, it says so.

### Step 1 — Does this belong in the issue tracker?

- **A question** → the contact links in `.github/ISSUE_TEMPLATE/config.yml` (or the repo's docs when it has none); stop.
- **New context for an issue the user names** → `bash .claude/skills/pr/forge.sh issue comment <N> --body-file <file>`, after the same confirm as Step 7.
- **This skill's `## This repo` routing table**, when it has one: a report whose shape the table sends elsewhere is routed there — say which surface and print its command in its own block (for example `/log followup <text>`). That is a successful outcome; stop.

Otherwise continue.

### Step 2 — Pick the form

List `.github/ISSUE_TEMPLATE/*.yml` (skip `config.yml`) and read each form's `name`, `description` and its intro `markdown` block: they say what each form is for (a bug, a new feature, a change to an existing one). Match the input to one; on an ambiguous call, show the top two with why and let the user pick. Read the chosen form in full: its `body` fields (each `attributes.label`, `validations.required`, a dropdown's `options`) and its `labels:`. Never work from a field or label list copied into this file or anywhere else.

No `.github/ISSUE_TEMPLATE/` forms → use the body shape and title convention in this skill's `## This repo`; with none there, a plain Markdown body (what is wrong, how to reproduce it, what done looks like).

### Step 3 — Search for duplicates

Before drafting, search open and closed issues with 2–3 keywords from the input, title first, then broad:

```sh
bash .claude/skills/pr/forge.sh issue list --state all --search "<keywords> in:title" --limit 10
bash .claude/skills/pr/forge.sh issue list --state all --search "<keywords>" --limit 10
```

Show each likely candidate in one line with its state. Before offering to link one, check it is still true (`bash .claude/skills/pr/forge.sh issue view <N> | jq '{title, state, body}'`): an issue whose premise has since changed passes the staleness on. Then ask in chat: `comment` (add the new context to the existing issue), `link` (file new and reference it in the body), or `new` (not a duplicate). A bug that matches a closed, fixed issue may be a regression: say so, and offer the regression label this skill's `## This repo` names, if any.

### Step 4 — Fill the fields

Walk each required field of the form and fill it from the input, lifting the reporter's own wording verbatim. Take what you can for repro steps; mark (never invent) the rest. A dropdown takes one of its `options` exactly as written. Fill an optional field only when the input supports it.

A required field the input does not cover: ask the user to fill it when they are the reporter or can find out; otherwise (a forwarded report whose author is not here) leave the gap marker `Reporter didn't specify; needs follow-up.` in the field. Show both options when it is unclear which applies; never fill a gap to satisfy the form.

### Step 5 — Render the title and body

**Title:** one line that names the defect or the change specifically (what fails, where), not the reporter's subject line; the convention in this skill's `## This repo` when it has one.

**Body:** one `### <Field label>` per filled field, spelled exactly as the form's `attributes.label`, in the form's order; leave out empty optional fields, never an empty heading. For a forwarded report, end with a source line in the additional-context field (or a last paragraph without forms): `Reported via <channel>.`, plus a link when the source is public. Never name the reporter.

Write the body to `"$(git rev-parse --git-dir)/issue-body.md"`: inside the git directory it can never be committed, and it survives a failed create.

### Step 6 — Labels

Start from the chosen form's `labels:` (no form: the guidance in this skill's `## This repo`, else none), plus any label the user asked for or Step 3 offered. Check each exists — the command prints the ones the repo lacks, and nothing when all exist:

```sh
printf '%s\n' <label> [<label> …] | grep -Fxv -f <(bash .claude/skills/pr/forge.sh label list | jq -r '.[].name')
```

For each missing label, in this order:

1. **Use an existing label.** Read `bash .claude/skills/pr/forge.sh label list` and pick the one whose name and description fit what the missing label meant; show it to the user beside the label it replaces.
2. **Leave it off** when nothing fits, and say so.
3. **Create it** only when the user wants it and nothing existing fits: show the `bash .claude/skills/pr/forge.sh label create <name> --description "<text>"` command for them to run or approve. Never create a label silently.

A form that names a missing label is out of date: say so in one line, so the form gets fixed rather than worked around each time.

### Step 7 — Check, then confirm

When [this repo's public posture](../../../AGENTS.md#public-posture) is `public`, sweep the title and body for a home path, a person's name or email, a secret, or another repository's or host's name: `grep -nEi '/home/|/Users/|@[a-z0-9.-]+\.[a-z]{2,}|BEGIN [A-Z ]*PRIVATE KEY' "$(git rev-parse --git-dir)/issue-body.md"`, and a read for the rest. Read each hit and remove what is private; a reporter's quoted text gets the same sweep.

Then show the user the form, the title, the labels (each replacement beside what it replaced), the full body, and the duplicate candidates from Step 3, and ask in chat: `submit`, `edit: <text>` (apply the change, show it again, ask again) or `cancel`. Never submit without `submit`.

### Step 8 — Submit

```sh
bash .claude/skills/pr/forge.sh issue create --title "<title>" --body-file "$(git rev-parse --git-dir)/issue-body.md" [--label <name> [--label <name> …]] [--parent <N>]
```

`--parent <N>` files it as a sub-issue of a tracking issue, when the user says it belongs under one.

### Step 9 — After

Print the issue URL; don't summarize the body. If the input also holds a followup or a decision this session should not lose, route it through `/log`. Then anything this skill's `## This repo` asks for after filing.

## Sub-agent invocation

A parent that has a report to formalize starts a sub-agent with `model: "sonnet"` and this Task prompt; the sub-agent drafts and returns, and the parent runs Steps 7–9 with the user:

`Read .claude/skills/create-issue/SKILL.md and follow Steps 1-6 for this report: <source text>. Do not create an issue or a label: return the chosen form, title, labels (with any replacement and what it replaced), the body file path, the duplicate candidates, and any route Step 1 chose instead. End your report with a "Captures for /log" section: one "- <type>: <title> — <body>" bullet per journal-worthy item this work surfaced, where <type> is one of [this repo's capture types](../../../AGENTS.md#capture-types); omit the section if there are none, and never write to journals yourself.` A parent writing that prompt for an Explore sub-agent (which loads no instruction files) spells the types out from the slot in place of the link.
