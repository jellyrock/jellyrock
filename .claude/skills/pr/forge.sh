#!/usr/bin/env bash
#
# forge.sh — the one door the forge skills (pr, create-issue, ci-triage, issue-triage) use to reach
# the repo's forge: pull requests, issues, labels, comments and CI runs. Each verb is one fixed
# operation with fixed fields, so a skill never builds a forge call of its own and every repo's
# skills make the same calls.
#
# The backend is read from the `### Forge` slot of the repo's Repo facts (AGENTS.md at the repo
# root), never guessed from the remote:
#   ### Forge
#   backend: github        (or forgejo)
#   prs: always            (read by the skills, not by this script)
#
# Contract with the skills:
#   * Output keeps gh's shape: a JSON verb prints exactly what `gh ... --json <its fields>` prints,
#     on every backend; a text verb prints one value (a branch, a login, a URL, a log).
#   * The forge's own error message reaches stderr whole. Nothing is silenced.
#   * Write verbs take --body-file, never an inline body.
#
# Exit codes:
#   0  done
#   1  the forge refused or failed (its message is on stderr), or gh is missing
#   2  usage: an unknown verb or flag, a missing or bad argument, a body file that does not exist
#   3  no `### Forge` slot, no backend: in it, a backend it does not know, or not in a git repo
#   4  `pr view` only: the branch has no pull request
#   5  the verb is not available on this backend
#
# Usage: bash forge.sh <noun> <verb> [args]      bash forge.sh --help      bash forge.sh <noun> <verb> --help

set -uo pipefail

prog="forge.sh"

# The fields each JSON verb asks for: the ones the skills read, never more.
F_PR_VIEW="number,url,state,author,title,labels,body,headRefOid"
F_PR_LIST="number,title,mergedAt"
F_ISSUE_VIEW="number,title,body,state,stateReason,labels,author,comments,createdAt,updatedAt,closedByPullRequestsReferences,url"
F_ISSUE_LIST="number,title,state,labels"
F_LABEL_LIST="name,description"
F_RUN_LIST="databaseId,workflowName,displayTitle,createdAt,url"
F_RUN_VIEW="status,conclusion,name,event,headBranch,url,createdAt,jobs"

# One line per verb: <noun verb>;<arguments>;<output>;<what it does>
SPEC="repo default-branch;;text: the branch name;The repo's default branch.
repo merge-settings;;JSON: squash_merge_commit_title, squash_merge_commit_message;What a squash merge keeps (empty without enough rights on the repo).
user login;;text: the login;The account this session acts as.
pr view;[<N>];JSON: $F_PR_VIEW;PR <N>, or the current branch's PR; exit 4 when the branch has none.
pr comments;<N>;JSON: comments;The PR's comments.
pr commits;<N>;JSON: commits;The PR's commits.
pr list;[--state open|closed|merged|all] [--search <q>] [--limit <n>];JSON: $F_PR_LIST;PRs matching a search.
pr create;--base <branch> --title <t> [--label <l>]... [--draft] --body-file <file>;text: the PR's URL;Open a PR from the current branch, as a draft with --draft.
pr edit;<N> [--title <t>] [--add-label <l,..>] [--remove-label <l,..>] [--body-file <file>];text: the PR's URL;Change a PR (at least one part).
pr comment;<N> --body-file <file>;text: the comment's URL;Comment on a PR.
pr reopen;<N>;text;Reopen a closed PR.
comment edit;<id> --body-file <file>;text: the comment's URL;Replace a PR or issue comment's body, by its numeric id.
issue view;<N>;JSON: $F_ISSUE_VIEW;Issue <N> (a PR number works too).
issue list;[--state open|closed|all] [--search <q>] [--limit <n>];JSON: $F_ISSUE_LIST;Issues matching a search.
issue create;--title <t> --body-file <file> [--label <l>]... [--parent <N>];text: the issue's URL;File an issue, as a sub-issue of <N> with --parent.
issue comment;<N> --body-file <file>;text: the comment's URL;Comment on an issue.
issue close;<N> --reason completed|not-planned|duplicate;text;Close an issue.
label list;;JSON: $F_LABEL_LIST;Every label (up to 500).
label create;<name> --description <text>;text;Create a label.
run list;[--branch <b>] [--status <s>] [--limit <n>];JSON: $F_RUN_LIST;CI runs.
run view;<id>;JSON: $F_RUN_VIEW;One CI run with its jobs and steps.
run log;<id>;text: the log;The log of the run's failed steps.
run rerun;<id>;text;Re-run the run's failed jobs."

die() { local rc="$1"; shift; printf '%s: %s\n' "$prog" "$*" >&2; exit "$rc"; }

usage() {
  echo "usage: $prog <noun> <verb> [args]     ($prog <noun> <verb> --help for one verb)"
  echo
  printf '%s\n' "$SPEC" | awk -F';' '{ l = sprintf("  %-20s %s", $1, $2); sub(/ +$/, "", l); print l }'
  echo
  echo "The backend comes from the ### Forge slot in the repo's AGENTS.md (backend: github or forgejo)."
}
verb_help() {
  printf '%s\n' "$SPEC" | awk -F';' -v c="$cmd" -v p="$prog" '$1 == c "" {
    printf "usage: %s %s %s\n\n%s\noutput: %s\n", p, $1, $2, $4, $3 }'
  echo "exit: 0 done, 1 the forge refused (its message on stderr), 2 usage, 3 no ### Forge slot, 4 no PR (pr view), 5 not on this backend"
}

# ----------------------------------------------------------------------------------- arguments
[ $# -ge 1 ] || { usage >&2; exit 2; }
case "$1" in --help|-h|help) usage; exit 0 ;; esac
[ $# -ge 2 ] || die 2 "'$1' needs a verb (see: $prog --help)"
cmd="$1 $2"; shift 2
printf '%s\n' "$SPEC" | awk -F';' -v c="$cmd" '$1 == c "" { f = 1 } END { exit !f }' \
  || die 2 "unknown verb '$cmd' (see: $prog --help)"

opt_base="" opt_title="" opt_body_file="" opt_add_label="" opt_remove_label="" opt_parent=""
opt_reason="" opt_description="" opt_draft="" opt_state="" opt_search="" opt_limit="" opt_branch="" opt_status=""
labels=(); pos=()
# parse <the verb's flags> <args...>: sets opt_<flag> (dashes to underscores), labels (--label may
# repeat), opt_draft=1 for --draft (the one flag with no value) and pos (the rest)
parse() {
  local allowed=" $1 " a n; shift
  while [ $# -gt 0 ]; do
    a="$1"; shift
    case "$a" in
      --help|-h) verb_help; exit 0 ;;
      -*)
        case "$allowed" in *" $a "*) ;; *) die 2 "$cmd: unknown flag '$a' (see: $prog $cmd --help)" ;; esac
        [ "$a" = --draft ] && { opt_draft=1; continue; }
        [ $# -gt 0 ] || die 2 "$cmd: $a needs a value"
        if [ "$a" = --label ]; then labels+=("$1")
        else n="${a#--}"; printf -v "opt_${n//-/_}" '%s' "$1"; fi
        shift ;;
      *) pos+=("$a") ;;
    esac
  done
}
# positional <min> <max>: the verb takes between min and max positional arguments
positional() {
  [ "${#pos[@]}" -ge "$1" ] || die 2 "$cmd: missing argument (see: $prog $cmd --help)"
  [ "${#pos[@]}" -le "$2" ] || die 2 "$cmd: unexpected argument '${pos[$2]}'"
}
number() { [[ "$2" =~ ^[0-9]+$ ]] || die 2 "$cmd: $1 must be a number, not '$2'"; }
required() { [ -n "$2" ] || die 2 "$cmd: $1 is required"; }
body_file() {
  required --body-file "$opt_body_file"
  [ -f "$opt_body_file" ] && [ -r "$opt_body_file" ] || die 2 "$cmd: no readable body file at $opt_body_file"
}
one_of() { # <flag> <value> <allowed...>
  local flag="$1" v="$2" a; shift 2
  for a in "$@"; do [ "$v" = "$a" ] && return; done
  die 2 "$cmd: $flag must be one of: $*, not '$v'"
}

case "$cmd" in
  "repo default-branch"|"repo merge-settings"|"user login"|"label list")
    parse "" "$@"; positional 0 0 ;;
  "pr view")
    parse "" "$@"; positional 0 1; [ "${#pos[@]}" = 0 ] || number "<N>" "${pos[0]}" ;;
  "pr comments"|"pr commits"|"pr reopen"|"issue view")
    parse "" "$@"; positional 1 1; number "<N>" "${pos[0]}" ;;
  "run view"|"run log"|"run rerun")
    parse "" "$@"; positional 1 1; number "<id>" "${pos[0]}" ;;
  "pr list")
    parse "--state --search --limit" "$@"; positional 0 0
    [ -z "$opt_state" ] || one_of --state "$opt_state" open closed merged all
    [ -z "$opt_limit" ] || number --limit "$opt_limit" ;;
  "issue list")
    parse "--state --search --limit" "$@"; positional 0 0
    [ -z "$opt_state" ] || one_of --state "$opt_state" open closed all
    [ -z "$opt_limit" ] || number --limit "$opt_limit" ;;
  "run list")
    parse "--branch --status --limit" "$@"; positional 0 0
    [ -z "$opt_limit" ] || number --limit "$opt_limit" ;;
  "pr create")
    parse "--base --title --label --draft --body-file" "$@"; positional 0 0
    required --base "$opt_base"; required --title "$opt_title"; body_file ;;
  "pr edit")
    parse "--title --add-label --remove-label --body-file" "$@"; positional 1 1; number "<N>" "${pos[0]}"
    [ -n "$opt_title$opt_add_label$opt_remove_label$opt_body_file" ] \
      || die 2 "$cmd: nothing to change (give --title, --add-label, --remove-label or --body-file)"
    [ -z "$opt_body_file" ] || body_file ;;
  "pr comment"|"issue comment")
    parse "--body-file" "$@"; positional 1 1; number "<N>" "${pos[0]}"; body_file ;;
  "comment edit")
    parse "--body-file" "$@"; positional 1 1; number "<id>" "${pos[0]}"; body_file ;;
  "issue create")
    parse "--title --body-file --label --parent" "$@"; positional 0 0
    required --title "$opt_title"; body_file
    [ -z "$opt_parent" ] || number --parent "$opt_parent" ;;
  "issue close")
    parse "--reason" "$@"; positional 1 1; number "<N>" "${pos[0]}"
    required --reason "$opt_reason"; one_of --reason "$opt_reason" completed not-planned duplicate ;;
  "label create")
    parse "--description" "$@"; positional 1 1; required --description "$opt_description" ;;
esac

# ------------------------------------------------------------------------------------- backend
root="$(git rev-parse --show-toplevel 2>/dev/null)" \
  || die 3 "not inside a git repository: the backend is read from the repo's AGENTS.md"
facts="$root/AGENTS.md"
fix="add to ## Repo facts in $facts:  ### Forge / backend: github (or forgejo) / prs: always (or on-request)"
[ -f "$facts" ] || die 3 "no AGENTS.md at $root; $fix"
# <1 when the slot was found, else 0><TAB><its backend: value>
slot="$(awk '
  { sub(/\r$/, "") }
  /^### Forge[ \t]*$/ { s = 1; next }
  s && /^#/ { exit }
  s { l = $0; gsub(/`/, "", l)
      if (l ~ /^[ \t]*backend:/) { sub(/^[ \t]*backend:[ \t]*/, "", l); sub(/[ \t]+$/, "", l); v = l; exit } }
  END { printf "%d\t%s\n", s, v }' "$facts")"
backend="${slot#*$'\t'}"
[ "${slot%%$'\t'*}" = 1 ] || die 3 "no ### Forge slot in $facts; $fix"
case "$backend" in
  github) ;;
  forgejo) die 5 "the Forgejo backend is not built yet: '$cmd' cannot run on this repo" ;;
  "") die 3 "the ### Forge slot in $facts has no backend: line; $fix" ;;
  *) die 3 "unknown backend '$backend' in the ### Forge slot of $facts: use github or forgejo" ;;
esac

# -------------------------------------------------------------------------------- GitHub (gh)
command -v gh >/dev/null 2>&1 || die 1 "gh is required by the GitHub backend but is not installed"
err="$(mktemp)"; trap 'rm -f "$err"' EXIT
# gh_run <args...>: gh's stdout and stderr pass through unchanged; any failure is exit 1 (gh's own
# codes are not passed on: its 4 means "log in", not "no PR"), except pr view's "no pull requests"
gh_run() {
  local rc
  gh "$@" 2>"$err"; rc=$?
  cat "$err" >&2
  [ "$rc" = 0 ] && exit 0
  [ "$cmd" = "pr view" ] && grep -qi '^no pull requests found' "$err" && exit 4
  exit 1
}
# the optional flags a verb passes on only when given
optional() { # <flag> <value>
  [ -z "$2" ] || extra+=("$1" "$2")
}
extra=()
n="${pos[0]:-}"

case "$cmd" in
  "repo default-branch") gh_run repo view --json defaultBranchRef --jq .defaultBranchRef.name ;;
  "repo merge-settings") gh_run api 'repos/{owner}/{repo}' --jq '{squash_merge_commit_title, squash_merge_commit_message}' ;;
  "user login")          gh_run api user --jq .login ;;
  "pr view")             gh_run pr view ${n:+"$n"} --json "$F_PR_VIEW" ;;
  "pr comments")         gh_run pr view "$n" --json comments ;;
  "pr commits")          gh_run pr view "$n" --json commits ;;
  "pr list")
    optional --state "$opt_state"; optional --search "$opt_search"; optional --limit "$opt_limit"
    gh_run pr list "${extra[@]}" --json "$F_PR_LIST" ;;
  "pr create")
    for l in "${labels[@]}"; do extra+=(--label "$l"); done
    [ -z "$opt_draft" ] || extra+=(--draft)
    gh_run pr create --base "$opt_base" --title "$opt_title" "${extra[@]}" --body-file "$opt_body_file" ;;
  "pr edit")
    optional --title "$opt_title"; optional --add-label "$opt_add_label"
    optional --remove-label "$opt_remove_label"; optional --body-file "$opt_body_file"
    gh_run pr edit "$n" "${extra[@]}" ;;
  "pr comment")          gh_run pr comment "$n" --body-file "$opt_body_file" ;;
  "pr reopen")           gh_run pr reopen "$n" ;;
  "comment edit")
    gh_run api -X PATCH "repos/{owner}/{repo}/issues/comments/$n" -F "body=@$opt_body_file" --jq .html_url ;;
  "issue view")          gh_run issue view "$n" --json "$F_ISSUE_VIEW" ;;
  "issue list")
    optional --state "$opt_state"; optional --search "$opt_search"; optional --limit "$opt_limit"
    gh_run issue list "${extra[@]}" --json "$F_ISSUE_LIST" ;;
  "issue create")
    for l in "${labels[@]}"; do extra+=(--label "$l"); done
    optional --parent "$opt_parent"
    gh_run issue create --title "$opt_title" --body-file "$opt_body_file" "${extra[@]}" ;;
  "issue comment")       gh_run issue comment "$n" --body-file "$opt_body_file" ;;
  "issue close")         gh_run issue close "$n" --reason "${opt_reason/not-planned/not planned}" ;;
  "label list")          gh_run label list --limit 500 --json "$F_LABEL_LIST" ;;
  "label create")        gh_run label create "$n" --description "$opt_description" ;;
  "run list")
    optional --branch "$opt_branch"; optional --status "$opt_status"; optional --limit "$opt_limit"
    gh_run run list "${extra[@]}" --json "$F_RUN_LIST" ;;
  "run view")            gh_run run view "$n" --json "$F_RUN_VIEW" ;;
  "run log")             gh_run run view "$n" --log-failed ;;
  "run rerun")           gh_run run rerun "$n" --failed ;;
esac
