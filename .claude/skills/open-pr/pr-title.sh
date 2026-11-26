#!/usr/bin/env bash
#
# pr-title.sh: runs a project's own title check on a draft, so that neither the title nor the commit's
# subject is ever typed into a command, where bash would run a backtick or a substitution in it. It
# also answers what /open-pr needs from git about the branch and the working tree.
#
# changes says whether the tree is clean. Inside Claude Code's sandbox a protected path shows as a
# character device, and so does a file the user blocked from reading. An untracked one cannot be
# committed, so it is skipped and named. A tracked one reads as modified though nobody changed it, so
# it is MASKED and the tree is not clean. upstream says whether this branch tracks its namesake on a
# remote, since in the sandbox a push -u exits 0 without writing that.
# gather lists the branch's commits and changed files, each line indented so that none of them reads
# as a line of this script. Under `=== push state` a line per remote says how many commits a push of
# this branch would send there, so that nobody types the branch's name to find out. Under
# `=== what lands` a line says each thing that lands under the repository's merge settings, which
# have one right answer and so are never worked out by the model. A call that fails is tried 3 times,
# then one line says the settings could not be read. Those lines carry no label, since
# the draft copies them word for word for the contributor to read. NOTE lines then say to copy them
# and how a title is checked.
# push says whether /open-pr may offer the push, from the merge settings read as lands reads them, the
# commits since <base> and the `SUBJECT exit` number that check printed. It prints one line: PUSH hold
# when a squash merge keeps this branch's one commit's subject and that subject fails, or when the settings
# cannot be read and it fails, and PUSH offer otherwise. The model never works this out from the lines.
# check reads the draft on standard input, in issue-link.sh's format: a line `=== title` and the
# title, then a line `=== body` and the body, which every draft needs since the scan reads it too.
# In the checker's command the word @title becomes the title, @body a file holding the body and
# @branch the current branch's name, read from git, each as one argument. A word that is the
# branch's name, or ends in = and the name, is refused: git allows a branch name that bash would
# run, so it is never typed. The checker runs a second time on the last commit's subject, read from
# git. Its words may hold no whitespace, and a word that would run its text as code (eval, or
# @title, @body or @branch right after -c or -e) is refused. Then the title, a blank line and the
# body go through issue-link.sh --scan, found in the report-issue folder beside this one, so the
# draft is typed once for both.
#
# Usage: pr-title.sh changes
#        pr-title.sh upstream <remote>
#        pr-title.sh gather <base> <owner/name>
#        pr-title.sh push <base> <owner/name> <subject exit>
#        pr-title.sh check <checker command, with @title and optionally @body and @branch> <<'OPEN_PR_DRAFT_END'
#        pr-title.sh amend <<'OPEN_PR_TITLE_END'
# Prints the checker's output, then `TITLE exit <n>`, `SUBJECT: <subject>` and `SUBJECT exit <n>`, then
# the scan's `HIT` and `EMPTY` lines as it prints them and `SCAN exit <n>`.
# push prints one line, `PUSH hold: <reason>` or `PUSH offer`.
# Exit: 0 the checks ran (read their exit lines), 2 a usage or draft error.
# amend reads the title as the one line on standard input and prints the amend command with the title
# quoted for the shell, so the title is never quoted by hand.
set -uo pipefail

die() { printf 'pr-title: %s\n' "$1" >&2; exit 2; }
usage="usage: pr-title.sh changes | upstream <remote> | gather <base> <owner/name> | push <base> <owner/name> <subject exit> | check <checker command with @title> | amend"

# is_masked <path>: a character device itself, never a link to one
is_masked() { [ -c "$1" ] && [ ! -L "$1" ]; }

# changes: a CHANGED, MASKED or SKIPPED line for what git status lists, then the TREE line
changes() {
  [ "$#" -eq 0 ] || die "$usage"
  local root untracked=all entry xy path shown skipped='' n=0 state=clean
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not in a git work tree"
  # a collapsed folder would hide the devices in it, but files the user hides stay hidden
  case "$(git config --get status.showUntrackedFiles)" in no|false) untracked=no ;; esac
  file="$(mktemp)" || die "cannot create a temporary file"
  trap 'rm -f "$file"' EXIT
  git status --porcelain -z --untracked-files="$untracked" >"$file" || die "cannot read the working tree"
  while IFS= read -r -d '' entry; do
    xy="${entry:0:2}" path="${entry:3}"
    case "$xy" in *R*|*C*) IFS= read -r -d '' _ ;; esac
    shown="${path//[[:cntrl:]]/?}"
    if [ "$xy" = '??' ] && is_masked "$root/$path"; then
      n=$((n + 1)) skipped="${skipped:+$skipped, }$shown"
      continue
    fi
    state='not clean'
    case "$xy" in
      ' M'|' T') if is_masked "$root/$path"; then echo "MASKED $shown"; continue; fi ;;
    esac
    echo "CHANGED $xy $shown"
  done <"$file"
  [ "$n" -eq 0 ] || echo "SKIPPED $n: $skipped"
  echo "TREE $state"
}

# upstream <remote>: whether the branch tracks its namesake there, and the command when it does not
upstream() {
  [ "$#" -eq 1 ] || die "$usage"
  local remote="$1" name
  name="$(git symbolic-ref -q --short HEAD)" || die "the checkout is detached"
  if [ "$(git config --get "branch.$name.remote")" = "$remote" ] && [ "$(git config --get "branch.$name.merge")" = "refs/heads/$name" ]; then
    echo "UPSTREAM set"
  else
    echo "UPSTREAM not set"
    printf '  git branch --set-upstream-to=%q\n' "$remote/$name"
  fi
}

# unpushed <base>: the push state, a line for each remote
unpushed() {
  local base="$1" ref out tip remote
  ref="$(git symbolic-ref -q HEAD)" || return 0
  echo "=== push state"
  while IFS= read -r remote; do
    out="$(GIT_TERMINAL_PROMPT=0 git ls-remote -- "$remote" "$ref" </dev/null 2>/dev/null)" || { echo "$remote: cannot be read"; continue; }
    tip="$(awk -v ref="$ref" '$2 == ref "" { print $1 }' <<<"$out")"
    if [ -z "$tip" ]; then
      echo "$remote: not pushed, a push sends $(git rev-list --count "$base..HEAD") commit(s)"
    elif git merge-base --is-ancestor "$tip" HEAD 2>/dev/null; then
      echo "$remote: has the branch, a push sends $(git rev-list --count "$tip..HEAD") commit(s)"
    else
      echo "$remote: has commits this branch lacks, a push would be refused"
    fi
  done < <(git remote)
}

# read_settings <owner/name>: sets the caller's got to the merge settings on one line, and read_ok to 1
# when the read worked, after up to 3 tries. lands and push both read through it, so they never disagree.
read_settings() {
  local try
  got='' read_ok=''
  for try in 1 2 3; do
    if got="$(gh api "repos/$1" --jq '[.squash_merge_commit_title, .squash_merge_commit_message, .allow_squash_merge, .allow_rebase_merge, .allow_merge_commit] | map(tostring) | join(" ")' </dev/null 2>/dev/null)"; then read_ok=1; break; fi
    [ "$try" = 3 ] || sleep 1
  done
}

# lands <base> <owner/name>: what lands, each line a whole sentence to copy
lands() {
  local base="$1" got='' title='' message='' squash='' rebase='' merge='' known='' read_ok=''
  read_settings "$2"
  echo "=== what lands"
  if [ -z "$read_ok" ]; then echo "Could not read the merge settings: the PR template's comments say what lands."; return 0; fi
  read -r title message squash rebase merge <<<"$got"
  if [ "$squash" != false ]; then
    case "$title" in
      PR_TITLE) known=1; echo "If squash-merged, the subject is the PR title." ;;
      COMMIT_OR_PR_TITLE)
        known=1
        if [ "$(git rev-list --count "$base..HEAD")" -eq 1 ]; then
          echo "If squash-merged, the subject is this branch's one commit's subject, not the PR title."
        else
          echo "If squash-merged, the subject is the PR title."
        fi ;;
    esac
    case "$message" in
      PR_BODY) known=1; echo "If squash-merged, the commit message is the PR body." ;;
      COMMIT_MESSAGES) known=1; echo "If squash-merged, the commit message is the commits' messages, not the PR body." ;;
      BLANK) known=1; echo "If squash-merged, the commit message is blank." ;;
    esac
  fi
  if [ "$rebase" = true ]; then known=1; echo "If rebase-merged, each commit keeps its own subject and message."; fi
  if [ "$merge" = true ]; then known=1; echo "If merged with a merge commit, each commit keeps its own subject and message."; fi
  [ -n "$known" ] || echo "Not known to your account: the PR template's comments say what lands."
}

# push <base> <owner/name> <subject exit>: one line, PUSH hold or PUSH offer
push() {
  [ "$#" -eq 3 ] || die "$usage"
  local base="$1" repo="$2" rc="$3" got='' title='' message='' squash='' read_ok=''
  [[ "$repo" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || die "the repository is owner/name"
  [[ "$rc" =~ ^[0-9]+$ ]] || die "the subject exit is a non-negative number: $usage"
  git rev-parse -q --verify --end-of-options "$base^{commit}" >/dev/null || die "the base is not a commit here: $base"
  if [ "$rc" -eq 0 ]; then echo "PUSH offer"; return 0; fi
  read_settings "$repo"
  if [ -z "$read_ok" ]; then
    echo "PUSH hold: the merge settings could not be read, so it is not known whether a failing commit subject lands."
    return 0
  fi
  read -r title message squash _ <<<"$got"
  if [ "$squash" != false ] && [ "$title" = COMMIT_OR_PR_TITLE ] && [ "$(git rev-list --count "$base..HEAD")" -eq 1 ]; then
    echo "PUSH hold: a squash merge keeps this branch's one commit's subject, and that subject fails the title rule."
  else
    echo "PUSH offer"
  fi
}

gather() {
  [ "$#" -eq 2 ] || die "$usage"
  local base="$1" repo="$2"
  [[ "$repo" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || die "the repository is owner/name"
  git rev-parse -q --verify --end-of-options "$base^{commit}" >/dev/null || die "the base is not a commit here: $base"
  git log "$base..HEAD" --format='%h %s%n%b' | sed 's/^/  /'
  git diff "$base...HEAD" --stat | sed 's/^/  /'
  unpushed "$base"
  lands "$base" "$repo"
  echo "NOTE: copy into the draft, word for word and without the heading, each line under === what lands and the push target's line under === push state. They are the facts: say nothing of your own about what lands or what is pushed."
  cat <<'NOTE_END'
NOTE: check a title, a body or a subject only with the command below, never by running the project's checker yourself: it keeps their words out of the command text and reads the subject from git.
  bash .claude/skills/open-pr/pr-title.sh check <the checker's command, with @title for the title, @body for a file of the body and @branch for the branch's name> <<'OPEN_PR_DRAFT_END'
  === title
  <the title>
  === body
  <the body, when the checker reads it>
  OPEN_PR_DRAFT_END
NOTE_END
}

# run_checker <title> <body file> <branch> <command word>...: the command with the three words filled in
run_checker() {
  local title="$1" file="$2" branch="$3" word
  local cmd=()
  shift 3
  for word in "$@"; do
    case "$word" in
      @title) cmd+=("$title") ;;
      @body) cmd+=("$file") ;;
      @branch) cmd+=("$branch") ;;
      *) cmd+=("$word") ;;
    esac
  done
  "${cmd[@]}" </dev/null
}

check() {
  [ "$#" -gt 0 ] || die "$usage"
  local word before='' takes_title='' takes_branch='' branch
  branch="$(git symbolic-ref -q --short HEAD)" || branch=''
  case "$1" in eval|source|.|exec|@title|@body|@branch) die "name the checker's program first, not $1" ;; esac
  for word in "$@"; do
    case "$word" in
      *[[:space:]]*) die "the title goes on standard input, not in the command: write @title in its place" ;;
      @title|@body|@branch)
        [[ "$before" =~ ^(-[A-Za-z]*[ce]|--eval)$ ]] && die "$word after $before would run the text as code"
        case "$word" in @title) takes_title=1 ;; @body) ;; *) takes_branch=1 ;; esac ;;
      *)
        if [ -n "$branch" ]; then
          case "$word" in "$branch"|*="$branch") die "write @branch where the checker takes the branch's name, never the name itself" ;; esac
        fi ;;
    esac
    before="$word"
  done
  [ -n "$takes_title" ] || die "write @title where the checker takes the title"
  [ -z "$takes_branch" ] || [ -n "$branch" ] || die "the checkout is detached, so there is no branch name for @branch"
  [ ! -t 0 ] || die "give the draft on standard input"

  file="$(mktemp)" || die "cannot create a temporary file"
  trap 'rm -f "$file"' EXIT
  local part='' title='' line subject rc has_body='' scan
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      '=== title') part=title; continue ;;
      '=== body') part=body; continue ;;
    esac
    if [ "$part" = body ]; then
      printf '%s\n' "$line" >>"$file"
      [ -z "$line" ] || has_body=1
    elif [ -n "$line" ]; then
      [ "$part" = title ] || die "the draft starts with a line === title"
      [ -z "$title" ] || die "the title is one line"
      title="$line"
    fi
  done
  [ -n "$title" ] || die "the draft needs === title and the title"
  [ -n "$has_body" ] || die "the draft needs === body and the body: the scan for private material reads it"
  scan="$(dirname "$0")/../report-issue/issue-link.sh"
  [ -f "$scan" ] || die "the scan is missing: $scan"
  subject="$(git log -1 --format=%s)" || die "cannot read the last commit's subject"

  rc=0; run_checker "$title" "$file" "$branch" "$@" || rc=$?
  echo "TITLE exit $rc"
  echo "SUBJECT: $subject"
  rc=0; run_checker "$subject" "$file" "$branch" "$@" || rc=$?
  echo "SUBJECT exit $rc"
  rc=0; { printf '%s\n\n' "$title"; cat "$file"; } | bash "$scan" --scan || rc=$?
  echo "SCAN exit $rc"
}

amend() {
  [ ! -t 0 ] || die "give the title on standard input"
  local title='' line
  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    [ -z "$title" ] || die "the title is one line"
    title="$line"
  done
  [ -n "$title" ] || die "amend needs the title on standard input"
  printf "git commit --amend -m '%s'\n" "${title//\'/\'\\\'\'}"
}

case "${1:-}" in
  changes) shift; changes "$@" ;;
  upstream) shift; upstream "$@" ;;
  gather) shift; gather "$@" ;;
  push) shift; push "$@" ;;
  check) shift; check "$@" ;;
  amend) shift; amend "$@" ;;
  *) die "$usage" ;;
esac
