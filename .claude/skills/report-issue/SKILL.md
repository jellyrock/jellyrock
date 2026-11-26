---
name: report-issue
model: sonnet
effort: medium
description: "Report a bug or suggest a feature for this project. Reads the repository's issue forms (or its organization's defaults) live, sends questions and security reports to the right place, searches open and closed issues for duplicates, drafts each field from your own words without inventing anything, flags private details, and opens the issue form in your browser with the draft filled in, so you check it and press Submit on GitHub. Needs the GitHub CLI (gh), signed in. Use when you want to open an issue here."
---

# /report-issue: draft an issue and open it on GitHub

## Contract

**Goal.** Turn what you noticed (a bug, an idea, a change to something that exists) into an issue the maintainers can act on, filed the way the project asks. The skill reads the project's issue forms as they are today, drafts each field from your words, and gives you a link that opens the form on GitHub with the draft filled in. You check it there and press **Submit new issue**: GitHub applies the form's labels and its required-field checks. The skill files nothing itself.

**Inputs.** The arguments (optional) are your report in your own words; if empty, ask for it. Through `gh`, the skill reads the repository the issue belongs to (the upstream one when this checkout is a fork), its issue forms and their `config.yml` (else its organization's defaults in the `.github` repository), its security policy, and its open and closed issues.

**Outputs.** A summary (the form, the title, each drafted field, the choices to pick on the form, the fields to fill there, what looked private and what was done about it, possible duplicates) and a link that opens the form with every field a link can fill already filled. For a question, a pointer to the project's discussions or contact links instead; for a security vulnerability, a pointer to its security policy.

**Success criteria.**

- The issue goes to the repository it belongs to; in a fork, that is the upstream repository, and the summary says so.
- A question goes to the discussions or contact links, and a security vulnerability to the security policy, never into a public issue.
- The form is picked from the forms' own names, descriptions and intro text; when two fit equally, the user picks.
- Possible duplicates among open and closed issues are listed beside the link, so the user can comment on one instead.
- Each filled field holds only what the user said. A required field they didn't cover is left empty and named, so GitHub asks for it.
- Nothing private (a home folder path, an email address, a token or key, a person's name) reaches the link, a search or anything you show.
- A file the report mentions is never opened: the user pastes what they choose to make public.
- The skill makes no `gh` call that writes: the user submits on GitHub.

**Failure modes to avoid.**

- **Inventing a value.** A device model, a version or a step the user didn't give, written in to satisfy a required field, misleads whoever triages it. Leave the field empty and name it.
- **Filing through the API.** `gh issue create` drops the form's labels for anyone without write access, and skips the form's required-field checks. Give the link instead.
- **Working from a copied form.** Field ids, required fields and options come from the form as it is today, read in this run.
- **Rewording the report.** Keep the user's wording where it fits: a polished summary loses the details that find the bug.
- **Building the link by hand.** Encoding by eye mangles a value with a `&`, a `#` or a newline in it. The script builds it.
- **Opening a file the report mentions.** A log or a notes file holds more than the user chose to publish. Name the field to paste the useful part into.
- **Repeating a private value.** A path or a name from the report never appears in a command, the draft or the summary. Say what kind of thing it was, such as "your notes file".
- **Stopping for a possible duplicate.** List the candidates beside the link; the user decides on GitHub.

**When not to use.**

- You want to add to an existing issue: open it on GitHub and comment there.
- You're asking how something works: use the project's discussions or the contact links on its new-issue page.
- You found a security vulnerability: follow the project's security policy, never a public issue.

## Implementation

Every `gh` call here reads. `{{repo}}` is the repository Step 1 finds, as `owner/name`, and `{{owner}}` is its owner.

Words from the report, and words you write from them (keywords, a title, a field), enter a command only as the body of a quoted here-document, read into a `"$variable"` or passed on standard input. That holds for every command, a second search included: never type them between double quotes or after a flag, because bash runs `$(…)` and backticks written into command text.

Never open, list or check a file the report mentions, and never type or show its path: call it what it is, such as "your notes file". Files this skill names are read as its steps say.

### Step 1: Find the repository

```sh
bash .claude/skills/report-issue/issue-link.sh --auth && gh repo view --json nameWithOwner,isFork,parent,hasIssuesEnabled,hasDiscussionsEnabled
```

When its output has no `AUTH ready` line, the sign-in check stopped it and nothing else ran: the output is the whole message for the user, already in Markdown. Make it your reply as it is, outside any code block, and stop. Add no command or reason of your own: `gh`'s own advice is wrong inside a sandbox. On `AUTH ready`, read the rest.

When `gh repo view` fails because `gh` cannot tell which repository this is (no remote on GitHub, or several remotes and no default), read `git remote -v` and take `owner/name` from a `github.com` URL, the remote named `upstream` first, then `origin`, then any other. Run the same line with that name after `gh repo view`. When no remote names a GitHub repository, ask in chat for the `owner/name` the issue belongs to.

When `isFork` is true, the issue belongs on the parent, `{{parent.owner.login}}/{{parent.name}}`: say so in one line, and read the parent's settings with the same command plus its name. When `hasIssuesEnabled` is false, say the project takes no issues on GitHub and stop.

### Step 2: Read the forms

The form folder is the first of these that answers, in {{repo}} and then in `{{owner}}/.github` (the organization's defaults): `.github/ISSUE_TEMPLATE`, `ISSUE_TEMPLATE`, `docs/ISSUE_TEMPLATE`.

```sh
gh api repos/{{repo}}/contents/.github/ISSUE_TEMPLATE --jq '.[] | select(.type == "file") | .name'
```

Read each file in it with `gh api repos/{{repo}}/contents/{{folder}}/{{file}} --jq '.content | @base64d'` (the organization's repository in place of {{repo}} when the folder came from there). A `.yml` or `.yaml` file other than `config.yml` is a form; `config.yml` holds `blank_issues_enabled` and `contact_links`. With no form folder anywhere, there are no forms.

### Step 3: Is it an issue?

- **A question:** point to `https://github.com/{{repo}}/discussions` when discussions are on, and to the `contact_links` in `config.yml`; stop.
- **A security vulnerability:** never in a public issue. Find the security policy: `SECURITY.md` at the root, in `.github/` or in `docs/` of {{repo}}, else in `{{owner}}/.github` (`gh api repos/{{owner}}/.github/contents/SECURITY.md --jq '.content | @base64d'`). Give its link and what it says to do, and stop. With no policy, say to reach the maintainers privately, and stop.

Otherwise continue.

### Step 4: Pick the form

Read each form's `name`, `description` and its intro `markdown` block: they say what each is for. Match the report to one. When two fit equally, show both with why and ask in chat which; that is the one question this skill asks. When none fits and `blank_issues_enabled` is false, name the forms there are, give `https://github.com/{{repo}}/issues/new/choose`, and stop. When none fits and blank issues are allowed, or there are no forms, continue without a form.

### Step 5: Search for duplicates

Search open and closed issues with two or three keywords from the report, none of them private, through the script only: never type `gh issue list` yourself. It takes one search on each line and runs each by title, then broadly. To try other or more keywords, put them in the here-document, as a line of their own:

```sh
bash .claude/skills/report-issue/issue-link.sh --search {{repo}} <<'REPORT_ISSUE_KEYWORDS_END'
{{keywords}}
REPORT_ISSUE_KEYWORDS_END
```

On `SEARCH FAILED`, say in the summary that the search for duplicates did not work, never that there are none.

Keep each likely match (number, state, title, link) for the summary. A match closed as fixed may mean a regression: say so there. Never stop here: the user decides on GitHub.

### Step 6: Draft the fields

Walk each field in the form's `body`, skipping `type: markdown`:

- **`input` and `textarea`:** fill from the report, keeping its wording. Numbered steps hold only the steps it gives, in its order. Fill an optional field only when the report covers it.
- **`dropdown` and `checkboxes`:** a link cannot fill them. When the report answers one, note the option to pick, spelled as the form spells it; otherwise note the field to fill.
- **`upload`, or a field with no `id`:** a link cannot fill it; note it to fill (a field with no `id` with its draft, to paste).
- **A file the report mentions** (a log, notes, a screenshot): leave it out of the draft, and note which field to paste its useful part into or attach it to, or the body when there is no form.
- **A required field the report doesn't cover:** leave it out of the draft and note it to fill. Never write a guess or a placeholder.

The title is one line that names the problem or the change specifically: what fails, and where.

With no form, the draft is a `title` and a `body`. The body has a `### What happened`, `### How to see it`, `### What you expected` and `### Version` section, each only when the report covers it.

### Step 7: Build the link

Pass the draft to the script: a line `=== title` and the title, then for each filled field a line `=== {{its id}}` and its text (with no form, `=== body` and the body). Give the form's file name as the second argument; with no form, leave it off.

```sh
bash .claude/skills/report-issue/issue-link.sh {{repo}} {{form file}} <<'REPORT_ISSUE_DRAFT_END'
=== title
{{title}}
=== {{field id}}
{{text}}
REPORT_ISSUE_DRAFT_END
```

It prints a `HIT {{field}}: {{line}}` line for each line that looks private, then `LENGTH` and `URL`. Take out of the draft each hit that is private (a home folder path, an email address, a token or key: describe it instead, such as "my log file"), read the draft yourself for a person's name or a private host or address, and run the script again. A hit that is not private, such as an API path that starts `/Users/`, stays: say why in the summary. On exit 3 (`TOO LONG`), move the longest optional field out of the draft, note it to paste on the form, and run it again.

### Step 8: Hand it over

Show, in this order: the repository (and that it is your fork's upstream, when it is), the form, the title, each filled field, "Pick on the form" (each dropdown or checkbox answer, then "Make these picks on the form."; "nothing" when there are none), "Fill on the form" (each required field left empty, each upload, each field moved out of the link), what looked private (its kind, never the value) and what was done, and the possible duplicates, each with its link, and when it lists any, "If one of them is yours, comment there instead." Then the link alone in a `text` block, and: "Open it, check each field, then press **Submit new issue**."

A reply of `edit: <text>` changes the draft: run Step 7 again and show the new link.
