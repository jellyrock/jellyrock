---
name: open-pr
model: sonnet
effort: medium
description: "Open or update a pull request for this project the way it asks. Reads the repository's PR template, contributing guide and title rule live, runs the title check it names, drafts the title and body from your branch and your own words without inventing anything, and flags private details. On your ok it pushes the branch, then opens GitHub's new pull request page with the draft filled in, so you check the diff and press Create pull request. With a PR already open, it shows what changed and applies it on your ok. Needs the GitHub CLI (gh), signed in."
---

# /open-pr: open or update a pull request on GitHub

## Contract

**Goal.** Turn the commits on your branch into a pull request the maintainers can review, titled and described the way the project asks. The skill reads the project's PR template and rules as they are today, drafts the title and body from your words and your branch, and gives you a link that opens GitHub's new pull request page with the draft filled in. You read the real diff there and press **Create pull request**: the skill opens nothing itself. With a PR already open from the branch, it brings that PR's title and body up to date with the branch.

**Inputs.** The arguments (optional) say what the change does and why, and what you ran to test it. Through `gh` and git, the skill reads the repository the PR goes to (the upstream one when this checkout is a fork), its default branch, its PR template, its contributing guide, its merge settings when your account can read them, the open PRs from this branch, and the branch's commits and diff.

**Outputs.** On the create path: the draft (repository, base and head, title, body, each check run and its result, what was taken out as private, and that the maintainers add labels), a push of the branch on your `ok`, then the link alone in a `text` block. On the update path: the title and body compared section by section with the open PR's, and on your `ok` the edit.

**Success criteria.**

- The PR goes to the upstream repository; in a fork, the summary says so.
- The title passes the check the template names, or follows the rule it states, and the summary says which. On a one-commit branch where the commit's subject is what lands, that subject is checked too.
- The body keeps the template's headings in order, fills each section only from your words and from the branch's commits and diff, and names each required section left empty.
- The Overview's reason keeps the words you, a commit or the open PR gave. With none, it says only what changed. Every draft offers `edit: <text>` to add or reword the reason, in the same words whether or not one was given.
- A Testing section says only what you said you ran. What else the template asks for there is listed beside the draft, never filled in.
- Nothing private reaches the title, body or link. A private-looking line in the diff stops the run for you to decide.
- Nothing is pushed, opened or edited without your `ok`. The only `gh` call that writes is `gh pr edit` on the update path.
- No labels are set.

**Failure modes to avoid.**

- **Inventing a test run, a device or a version, or saying one was not run.** A claim nobody made misleads the reviewer. Leave the section empty and name it.
- **Making up or rewording why.** A cause, an effect, who was affected, or a claim that something was undocumented is the contributor's to make. Keep their words, or leave the why out: the `edit: <text>` offer covers adding one.
- **Filing through `gh pr create`.** The person opens the PR after reading the diff. Give the link instead.
- **Setting labels.** They need triage access, and a `labels=` link parameter without it fails. The maintainers label the PR.
- **Working from a copied template.** Headings, hints and title rules come from the live template, read in this run.
- **Rewording the user's account until the detail is lost.** Keep their wording where it fits.
- **Building the link by hand.** Encoding by eye mangles a value with a `&`, a `#` or a newline in it. The script builds it.
- **Amending, rebasing or force-pushing the user's branch.** Print the command and let them run it.
- **Opening a file the user mentions.** A notes or log file holds more than they chose to publish. Name what to paste instead.
- **Repeating a private value in anything you show.** A home folder path, an email address, a token or a name, whether it came from the diff, the commits or the user's own words, never appears in the draft or the summary. Say what kind of thing it was instead.

**When not to use.**

- You are reporting a bug or an idea and have no code yet: use `/report-issue`.
- You want to comment on someone else's PR: do it on GitHub.
- You found a security vulnerability: follow the project's security policy before any public PR.

## Implementation

`{{repo}}` is the upstream repository as `owner/name`, `{{name}}` its name, `{{default}}` its default branch, `{{owner}}` its owner, `{{login}}` your GitHub login, `{{branch}}` the current branch and `{{base}}` the ref the branch is compared with. The only `gh` call that writes is `gh pr edit` in Step 7.

A title, body, commit subject, pattern, branch, head, base or default branch enters a command only as the body of a quoted here-document with a distinctive delimiter, read into a `"$variable"` or passed on standard input; the current branch is `branch="$(git branch --show-current)"`. Bash runs `$(…)` and backticks written into command text, so that holds for every command, one you add yourself included: never type those words between double quotes, after a flag, into an `echo` or into `node -e` code, and never type the branch's name: a checker gets it as `@branch` (Step 5). Shell variables do not last between tool calls, so each command block sets what it uses.

Never open, list or check a file outside this checkout that the user mentions, and never type or show its path: call it what it is, such as "your notes file", and say they can paste the useful part with `edit: <text>`. The draft comes from their message and the branch.

### Step 1: Find the repositories and the branch

```sh
bash .claude/skills/report-issue/issue-link.sh --auth && gh repo view --json nameWithOwner,isFork,parent,defaultBranchRef,viewerPermission && git rev-parse --abbrev-ref HEAD && bash .claude/skills/open-pr/pr-title.sh changes
```

When its output has no `AUTH ready` line, the sign-in check stopped it and nothing else ran: the output is the whole message for the user, already in Markdown. Make it your reply as it is, outside any code block, and stop. Add no command or reason of your own: `gh`'s own advice is wrong inside a sandbox. On `AUTH ready {{login}}`, take `{{login}}` from that line, and read the rest: the repository, then the current branch, then the tree.

When `gh repo view` fails because `gh` cannot tell which repository this is, read `git remote -v` and take `owner/name` from a `github.com` URL, the remote named `upstream` first, then `origin`, then any other. Run the same line with that name after `gh repo view`. When no remote names a GitHub repository, ask in chat for the `owner/name` the PR goes to.

When `isFork` is true, the PR goes to the parent: say so in one line, and read the parent with the same command plus its name. `{{repo}}` is that upstream, `{{default}}` its default branch.

Pre-flight, each a stop with its reason:

- The current branch, the line `git rev-parse` printed, is `{{default}}`: say to create a branch first, with `git switch -c {{a short branch name}}` alone in a `text` block.
- It is `HEAD`: the checkout is detached, so say to switch to a branch.
- The `pr-title.sh changes` lines do not end with `TREE clean`. For `CHANGED` lines, list the files and say to commit or stash them first. For a `MASKED` line, say the sandbox hides that file, so whether it changed cannot be checked here: the user runs `git status` in their own terminal, or runs `/open-pr` in a session that can read it. When it printed neither, show its error.

A `SKIPPED` line stops nothing: keep it for the summary.

The base ref `{{base}}`: for each remote, take `owner/name` from the end of its URL (the last two path parts, `.git` dropped, any host). Fetch the remote that names `{{repo}}` and use `{{remote}}/{{default}}`:

```sh
IFS= read -r remote <<'OPEN_PR_REMOTE_END'
{{remote}}
OPEN_PR_REMOTE_END
IFS= read -r default <<'OPEN_PR_DEFAULT_END'
{{default}}
OPEN_PR_DEFAULT_END
git fetch "$remote" "$default"
```

When no remote names it, use `origin/{{default}}` when it exists, and say in one line that the base is read from `origin`.

### Step 2: Find an open PR from this branch

```sh
branch="$(git branch --show-current)"
gh pr list -R {{repo}} --head "$branch" --state all --json number,url,state,title,body,author,headRepositoryOwner --limit 20
```

`--head` takes a branch name only, so keep only the PRs whose `headRepositoryOwner.login` is the owner of the remote the branch pushes to (the fork's owner, or the upstream's owner when you push there; when that is not known yet, `{{login}}`).

- **`OPEN`:** the update path (Step 7) after the draft. Keep `{{number}}`, `{{url}}`, `{{title}}`, `{{body}}` and `{{author}}`. When `{{author}}` is not `{{login}}`, say the PR is someone else's, and stop.
- **`MERGED`:** say it merged, and that new work goes on a new branch from a fresh `{{default}}`. Stop.
- **`CLOSED`, with nothing open:** say it was closed, and that it can be reopened on GitHub or the work moved to a new branch. Stop.
- **None:** the create path.

### Step 3: Read the project's rules, live

Read the PR template from `{{repo}}`'s default branch, never from the local checkout. Take the first of `.github/pull_request_template.md`, `pull_request_template.md` and `docs/pull_request_template.md` (any letter case) that this returns:

```sh
gh api repos/{{repo}}/contents/{{path}} --jq '.content | @base64d'
```

With a `PULL_REQUEST_TEMPLATE/` folder instead, list its files, pick the one whose name fits the change, and ask in chat when two fit. Else try the same paths in `{{owner}}/.github`. With none, the body has a `## Overview`, a `## Changes` and, when the user gave one, a `## Testing` section.

Read the contributing guide the same way (`CONTRIBUTING.md` at the root, in `.github/`, in `docs/`, else in `{{owner}}/.github`), and any developer guide it links for pull requests: take what they say about PRs and titles.

### Step 4: Gather the branch and the user's account

```sh
IFS= read -r base <<'OPEN_PR_BASE_END'
{{base}}
OPEN_PR_BASE_END
bash .claude/skills/open-pr/pr-title.sh gather "$base" {{repo}}
```

It reads the merge settings and prints what lands, a sentence per line under `=== what lands`: never work that out yourself. Only when a line says it is not known or could not be read do the template's comments decide. When the commit message is the PR body, write the body for someone reading `git log`; otherwise it is for the reviewer.

Read the diff itself where the body needs it. The user's words come from the arguments. When neither they, the commits nor the diff show what the change does, ask in chat once. When the template has a testing section and the user did not say what they ran, ask in the same question. A missing why never stops the draft: Step 7's `edit: <text>` offer covers adding one. An answer of nothing is written as "Not tested" with their reason, as the template asks.

### Step 5: Draft and check the title

Write one line under 70 characters, in the form the template's first comment and the contributing guide state. Synthesize it from every commit, typed by what the change does to the product. Then check it:

- **The comment, the guide or a workflow names a script in this checkout that checks a title** (it exists, and its header, the comment or the workflow shows how it takes one): run it only through `pr-title.sh check`, which reads the draft on standard input and checks the commit subject from git in the same call. Never run the checker yourself, not even to try a title or the subject first: that call reports both. In the checker's command write `@title` where the title goes, `@body` where a file of the body goes and `@branch` where the branch's name goes (`bash {{script}} @title`, or `node {{script}} --pr-title @title --body-file @body`). The script fills each one in, and refuses a command with the branch's name typed into it. It always needs the body, so run it once the body is drafted (Step 6). It also scans the title and body for private material and prints that scan's `HIT` and `EMPTY` lines, then `SCAN exit <n>`:

```sh
bash .claude/skills/open-pr/pr-title.sh check bash {{script}} @title <<'OPEN_PR_DRAFT_END'
=== title
{{title}}
=== body
{{body}}
OPEN_PR_DRAFT_END
```

- **It names a file that only defines the rule** (a module listing the allowed types): read the rule there and check the title against it. A command you run to test it takes the title from a `"$title"` variable read as in the next block.
- **It names a workflow that holds a pattern:** copy the pattern from the file as written and test the title with this:

```sh
IFS= read -r title <<'OPEN_PR_TITLE_END'
{{title}}
OPEN_PR_TITLE_END
IFS= read -r pattern <<'OPEN_PR_PATTERN_END'
{{pattern}}
OPEN_PR_PATTERN_END
printf '%s' "$title" | grep -q -E -e "$pattern"
```

- **Nothing is named:** follow the stated form.

The summary says which of these happened.

On a one-commit branch where the commit's subject is what lands (Step 4's lines under `=== what lands`), check that subject too: with a script, the result is that call's `SUBJECT` line; otherwise hold what `git log -1 --format=%s` prints to the same rule, without typing it into a command.

When it fails or differs from the title, say what lands (the line under `=== what lands` about the subject, word for word). Run the block below, then print the one line it prints, as it is, alone in a `text` block, adding that it replaces the commit's whole message and that the user runs it, then runs `/open-pr` again:

```sh
bash .claude/skills/open-pr/pr-title.sh amend <<'OPEN_PR_TITLE_END'
{{title}}
OPEN_PR_TITLE_END
```

Then let the script decide the push; never decide it from the lines yourself. `{{subject}}` is the number on the `SUBJECT exit` line, or, when no script checks titles, `0` when the commit's subject follows the rule and `1` when it does not; on a branch with more than one commit, use `0`:

```sh
IFS= read -r base <<'OPEN_PR_BASE_END'
{{base}}
OPEN_PR_BASE_END
bash .claude/skills/open-pr/pr-title.sh push "$base" {{repo}} {{subject}}
```

It prints one line. On `PUSH hold`, offer no push and give no reason beyond the one that line states: end the draft with the command and "Reply `edit: <text>` to change the draft, such as adding or rewording why you made the change." On `PUSH offer`, follow Step 7's push question.

Never amend.

### Step 6: Draft the body and sweep for private material

Start from the template. Keep each heading it has, in its order and spelling, and fill each section the way its hint comment asks, then remove the hint comments.

- **Overview:** what changed, from the user's words, the commits and the diff. Then why, only when the user, a commit message or the open PR's current Overview says why, and in those words, first person included: "I got stuck" stays "I got stuck", never "a newcomer gets stuck". Add no cause, effect, audience, purpose or problem of your own, and never that something was missing or undocumented unless they said so, even when it is true. With no why, the Overview says only what changed, even where the hint asks for why.
- **Changes:** from the user's words and from what the commits and the diff show.
- **Testing:** only from what the user said. When they said nothing ran, the section says so in their words, or as "Not tested" with their reason when the hint asks for that. The hint's items they didn't mention stay out of the section altogether, neither as not run nor as not stated, because silence doesn't say what they did. List those items beside the draft as "The template also asks", for the user to add with `edit: <text>`.
- **Issues:** only from a reference the user or a commit gives. Write `Fixes #N` when the PR closes it and `Ref #N` when it is related, and confirm each with `gh issue view -R {{repo}} {{N}} --json number,title,state`.
- **A section nothing covers:** a required one stays, empty, and is named in the summary. An optional one is removed, heading included, unless its hint says to mark it (for example `None`).

A bare `#N` is always `{{repo}}`'s issue N; write another repository's as `owner/name#N`. Links are absolute `https://github.com/{{repo}}/blob/{{default}}/{{path}}` URLs for files already on the default branch; name a file the PR adds in backticks.

Then sweep and check. Pass the diff through the scan:

```sh
IFS= read -r base <<'OPEN_PR_BASE_END'
{{base}}
OPEN_PR_BASE_END
git diff "$base"...HEAD | bash .claude/skills/report-issue/issue-link.sh --scan
```

When Step 5 ran no checker script, pass the title and body through the scan too:

```sh
bash .claude/skills/report-issue/issue-link.sh --scan <<'OPEN_PR_DRAFT_END'
{{title}}

{{body}}
OPEN_PR_DRAFT_END
```

When Step 5 did run one, the scan of the title and body is the `HIT` and `EMPTY` lines in `pr-title.sh check`'s output, and running it again means running that `check` command again. A `HIT` line from the diff is a line of it that looks private (a home folder path, an email address, a token or key). Show each and ask in chat whether it belongs in the PR: that is the user's call, since it is their code. A `HIT` line from the draft is a private value you wrote: take it out. An `EMPTY` line is a heading with nothing under it: remove that section, heading included, when it is optional and its hint does not say to mark it; a required one stays and is named in the summary. Run the draft through the scan again until it prints no `HIT` line and an `EMPTY` line only for a required section. The scan cannot see a person's name, a private host or an address: read the title and body yourself for those, and take out what is private. Whatever you take out, say what kind of thing it was and never quote it. The same holds for the user's own words: a path or a name they gave is never repeated in what you show.

### Step 7: Hand over

Show, in this order: the repository (and that it is the fork's upstream, when it is), base and head, the title alone in a `text` block (a title may hold backticks), the body, what the template also asks for in Testing (when something is missing), what lands (each line under `=== what lands`, word for word and without the heading, with nothing of your own about what lands; the template's comments only when a line says it is not known or could not be read), the push state (the push target's line under `=== push state`, word for word: the branch is not pushed until Step 7's push has run), each check run and its result, what was taken out, and "Labels: the maintainers add them." Then follow the path Step 2 chose.

Only when Step 1 printed a `SKIPPED` line, add one line: "Skipped as masked by the sandbox:" and the names. With no such line, say nothing about skipping, masking or a sandbox.

The first question you ask after the draft, whatever it asks, offers "`edit: <text>` to change the draft, such as adding or rewording why you made the change", in those words. Write it the same way whether or not the Overview has a why, and never say whether a reason was given. When the path asks nothing before the link, the link's closing sentence covers it.

**Create path.** Find the push target. It is the remote whose URL names `{{login}}/{{name}}` (the fork). Else, when `viewerPermission` is `ADMIN`, `MAINTAIN` or `WRITE`, it is the remote that names `{{repo}}`. Else, when `viewerPermission` is `READ` or `TRIAGE`, read `gh api repos/{{repo}} --jq '{private, allow_forking}'`: when `private` is true and `allow_forking` is false, the user can neither push nor fork, so say to ask a maintainer for write access and run `/open-pr` again after, and stop. Else, when a remote names `{{repo}}` and none names a fork, print this alone in a `text` block, say it makes a fork under the user's account and points `origin` at it (the upstream's remote becomes `upstream`), and stop for them to run it and run `/open-pr` again:

```text
gh repo fork --remote
```

Else ask in chat which remote the branch goes to. `{{head}}` is `{{login}}:{{branch}}` for a fork and `{{branch}}` for the upstream itself.

`{{n}}` is the count on that remote's line under `=== push state` from `gather` (run `gather` again after the branch or the remotes change). When that line says the push would be refused or the remote cannot be read, say so and stop.

Unless Step 6 held the push, when the branch has commits the remote lacks, ask in chat: "Reply `ok` to push `{{branch}}` to `{{remote}}` ({{n}} commit(s)), or `edit: <text>` to change the draft, such as adding or rewording why you made the change." On `ok`, run `git push -u {{remote}} HEAD`. When the push exits non-zero, show git's message and stop. After one that exits 0, run `bash .claude/skills/open-pr/pr-title.sh upstream {{remote}}`, since a sandbox can refuse the upstream and still exit 0. On `UPSTREAM not set`, say the branch was pushed but a plain `git push` will not know where to go, print the command it printed alone in a `text` block for the user to run in their own terminal, and go on. On `UPSTREAM set`, an error about writing the upstream needs nothing.

Then build the link, with the draft on standard input as `=== title` and the title, then `=== body` and the body:

```sh
IFS= read -r default <<'OPEN_PR_DEFAULT_END'
{{default}}
OPEN_PR_DEFAULT_END
IFS= read -r head <<'OPEN_PR_HEAD_END'
{{head}}
OPEN_PR_HEAD_END
bash .claude/skills/report-issue/issue-link.sh --compare {{repo}} "$default" "$head" <<'OPEN_PR_DRAFT_END'
=== title
{{title}}
=== body
{{body}}
OPEN_PR_DRAFT_END
```

A `HIT` line means the sweep missed something: take it out and run it again. An `EMPTY` line for an optional section means the same: remove that section, heading included, and run it again. On exit 3 (`TOO LONG`), build the link with the title alone, and show the body in a fenced block to paste. Print the link alone in a `text` block, then say: "Open it, read the diff GitHub shows, change the title or description there if you want to (such as adding why you made the change), then press **Create pull request**."

**Update path.** Push first, as on the create path (its upstream check included), when the branch has commits the PR lacks. Compare the new title and body with `{{title}}` and `{{body}}`. When nothing changed, say the PR is up to date, give `{{url}}`, and stop. Otherwise show the title change and the body section by section, marking each section where the PR's current text holds something the new draft lacks as "possibly edited by hand on GitHub". Ask in chat for `apply`, `skip` (print `{{url}}` and stop) or `edit: <text>` to change the draft, such as adding or rewording why you made the change (then show the diff again). On `apply`, run this. When the title did not change, leave out the `read` with its here-document and `--title "$title"`. When the body did not change, leave out `--body-file -` with its here-document.

```sh
IFS= read -r title <<'OPEN_PR_TITLE_END'
{{title}}
OPEN_PR_TITLE_END
gh pr edit {{number}} -R {{repo}} --title "$title" --body-file - <<'OPEN_PR_BODY_END'
{{body}}
OPEN_PR_BODY_END
```

Print `{{url}}`, and say the earlier description stays in the PR's **edited** history.

A reply of `edit: <text>` at any gate changes the draft and runs its checks again.
