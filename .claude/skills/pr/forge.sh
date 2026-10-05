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
#   api: <URL>             (forgejo, optional: the API root when it is not https://<host>/api/v1)
#
# Contract with the skills:
#   * Output keeps gh's shape: a JSON verb prints exactly what `gh ... --json <its fields>` prints,
#     on every backend; a text verb prints one value (a branch, a login, a URL, a log).
#   * The forge's own error message reaches stderr whole. Nothing is silenced.
#   * Write verbs take --body-file, never an inline body.
#
# Exit codes:
#   0  done
#   1  the forge refused or failed (its message is on stderr), a tool it needs is missing (gh;
#      curl and jq on Forgejo), or the Forgejo token file is missing
#   2  usage: an unknown verb or flag, a missing or bad argument, a body file that does not exist
#   3  no `### Forge` slot, no backend: in it, a backend it does not know, not in a git repo, or
#      (forgejo) no origin remote to read the host and repo from
#   4  `pr view` only: the branch has no pull request
#   5  the verb is not available on this backend
#
# Usage: bash forge.sh <noun> <verb> [args]      bash forge.sh --help      bash forge.sh <noun> <verb> --help

# shellcheck disable=SC2016 # single-quoted jq programs: their $names are jq variables
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
repo file-url;<path>;text: the URL;The web URL of <path> (a file path from the repo root) on the repo's default branch.
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
issue list;[--state open|closed|all] [--search <q>] [--label <l>]... [--limit <n>];JSON: $F_ISSUE_LIST;Issues matching a search and having every given label.
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
  echo "Forgejo: the API is https://<the origin remote's host>/api/v1 unless the slot has an api: <URL> line;"
  echo 'the token is the curl config at $FORGEJO_CURLRC, else ~/.config/forgejo/<host>.curlrc.'
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

# uri_path <path>: sets fpath to the path with each character outside A-Za-z0-9._~- as %XX, the /
# between segments kept (byte-wise under LC_ALL=C, so UTF-8 is fine); the caller's LC_ALL is left alone
uri_path() {
  local LC_ALL=C i c enc=""
  for ((i = 0; i < ${#1}; i++)); do
    c="${1:i:1}"
    case "$c" in [A-Za-z0-9._~/-]) enc+="$c" ;; *) printf -v c '%%%02X' "'$c"; enc+="$c" ;; esac
  done
  fpath="$enc"
}

case "$cmd" in
  "repo default-branch"|"repo merge-settings"|"user login"|"label list")
    parse "" "$@"; positional 0 0 ;;
  "repo file-url")
    parse "" "$@"; positional 1 1
    fpath="${pos[0]}"; fpath="${fpath#./}"
    case "$fpath" in /*) die 2 "$cmd: <path> is from the repo root, not absolute ('${pos[0]}')" ;; esac
    required "<path>" "$fpath"
    uri_path "$fpath" ;;
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
    parse "--state --search --label --limit" "$@"; positional 0 0
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
# <1 when the slot was found, else 0>, <its backend: value>, <its api: value>, <how many backend: lines>,
# <how many api: lines>, split on \037 (a tab would collapse an empty field)
slot="$(awk '
  { sub(/\r$/, "") }
  /^### Forge[ \t]*$/ { s = 1; next }
  s && /^#/ { exit }
  s { l = $0; gsub(/`/, "", l)
      if (l ~ /^[ \t]*backend:/) { sub(/^[ \t]*backend:[ \t]*/, "", l); sub(/[ \t]+$/, "", l); v = l; nb++ }
      if (l ~ /^[ \t]*api:/) { sub(/^[ \t]*api:[ \t]*/, "", l); sub(/[ \t]+$/, "", l); a = l; na++ } }
  END { printf "%d\037%s\037%s\037%d\037%d\n", s, v, a, nb, na }' "$facts")"
IFS=$'\037' read -r found backend api_line n_backend n_api <<<"$slot"
[ "$found" = 1 ] || die 3 "no ### Forge slot in $facts; $fix"
[ "$n_backend" -le 1 ] || die 3 "the ### Forge slot in $facts has $n_backend backend: lines; keep one"
[ "$n_api" -le 1 ] || die 3 "the ### Forge slot in $facts has $n_api api: lines; keep one"
case "$backend" in
  github|forgejo) ;;
  "") die 3 "the ### Forge slot in $facts has no backend: line; $fix" ;;
  *) die 3 "unknown backend '$backend' in the ### Forge slot of $facts: use github or forgejo" ;;
esac

# --------------------------------------------------------------------------- Forgejo (curl + jq)
# The API is https://<the origin remote's host>/api/v1, or the slot's api: line (the API root, for a
# forge on another port, scheme or path). The token is a curl config file, passed to curl and never
# read here: $FORGEJO_CURLRC, else ~/.config/forgejo/<the origin remote's host>.curlrc.
# Output keeps gh's field names (see the contract above); a field Forgejo does not record is null.
if [ "$backend" = forgejo ]; then
  # What Forgejo cannot do, refused before any setup or call.
  case "$cmd" in
    run\ *) die 5 "'$cmd' is not available on the Forgejo backend: its API has no Actions logs or rerun, so the run verbs wait for it" ;;
    "issue create") [ -z "$opt_parent" ] || die 5 "Forgejo has no sub-issues: drop --parent and add \"Part of #$opt_parent\" to the body" ;;
    "repo merge-settings")
      # Forgejo keeps no squash commit templates: both null, as gh gives without enough rights.
      echo '{"squash_merge_commit_title":null,"squash_merge_commit_message":null}'; exit 0 ;;
  esac
  # --search: plain words, ANDed here (Forgejo ORs them), and GitHub's in:title honored here.
  words=(); title_only=0
  if [ -n "$opt_search" ]; then
    read -ra sw <<<"$opt_search"
    for w in "${sw[@]}"; do
      if [ "$w" = "in:title" ]; then title_only=1
      elif [[ "$w" =~ ^[A-Za-z-]+:.+ ]]; then
        die 5 "search qualifier '$w' is GitHub search syntax: on Forgejo, --search takes plain words and in:title"
      else words+=("$w"); fi
    done
  fi

  for t in curl jq; do command -v "$t" >/dev/null 2>&1 || die 1 "$t is required by the Forgejo backend but is not installed"; done
  remote="$(git -C "$root" remote get-url origin 2>/dev/null)" \
    || die 3 "the Forgejo backend reads the host and repo from the origin remote, and this repo has none"
  case "$remote" in
    *://*) rest="${remote#*://}"; rest="${rest#*@}"; hostport="${rest%%/*}"; rpath="${rest#*/}" ;;
    *:*)   rest="${remote#*@}"; hostport="${rest%%:*}"; rpath="${rest#*:}" ;;
    *)     rpath="" ;;
  esac
  rpath="${rpath%/}"; rpath="${rpath%.git}"; host="${hostport%%:*}"
  repo="${rpath##*/}"; owner="${rpath%/*}"; owner="${owner##*/}"
  [ -n "$host" ] && [ -n "$owner" ] && [ -n "$repo" ] && [ "$owner" != "$rpath" ] \
    || die 3 "cannot read host/owner/repo from the origin remote '$remote'"
  base="${api_line:-https://$host/api/v1}"; base="${base%/}"
  rapi="$base/repos/$owner/$repo"
  curlrc="${FORGEJO_CURLRC:-$HOME/.config/forgejo/$host.curlrc}"
  [ -f "$curlrc" ] && [ -r "$curlrc" ] \
    || die 1 "no Forgejo token file at $curlrc: a curl config holding the token header (header = \"Authorization: token <token>\"), or point FORGEJO_CURLRC at one"

  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  resp="$tmp/resp" hdr="$tmp/hdr" req="$tmp/req" err="$tmp/err"
  # fj <METHOD> <URL> [<JSON body>]: the answer's body lands in $resp. curl's own error, or an HTTP
  # status outside 2xx with Forgejo's message, is exit 1.
  fj() {
    local m="$1" u="$2" code body=()
    if [ $# -ge 3 ]; then printf '%s' "$3" >"$req"; body=(-H 'Content-Type: application/json' --data-binary "@$req"); fi
    code="$(curl -sS --config "$curlrc" -X "$m" -H 'Accept: application/json' ${body[@]+"${body[@]}"} \
      -D "$hdr" -o "$resp" -w '%{http_code}' "$u" 2>"$err")" || { cat "$err" >&2; exit 1; }
    case "$code" in 2??) return 0 ;; esac
    local msg; msg="$(jq -r '.message // empty' "$resp" 2>/dev/null)"
    [ -n "$msg" ] || msg="$(head -c 500 "$resp")"
    die 1 "Forgejo answered HTTP $code to $m ${u#"$base"}: $msg"
  }
  next_link() { tr ',' '\n' <"$hdr" | tr -d '\r' | grep -i 'rel="next"' | sed -n 's/.*<\([^>]*\)>.*/\1/p' | head -1; }
  # pages <URL> <max, 0 for all> <jq filter: a page's array to the items kept>: follows the Link
  # header's next page until max items are kept, into $tmp/list as one array. JQ_ARGS go to the
  # filter. It and label_ids write files, never stdout: a die inside $(...) would end only the
  # subshell, and a failed scan would read as "nothing found".
  JQ_ARGS=()
  pages() {
    local u="$1" max="$2" f="$3"
    echo '[]' >"$tmp/list"
    while [ -n "$u" ]; do
      fj GET "$u"
      jq -c ${JQ_ARGS[@]+"${JQ_ARGS[@]}"} "$f" "$resp" >"$tmp/page" || die 1 "unreadable answer from GET ${u#"$base"}"
      jq -cs '.[0] + .[1]' "$tmp/list" "$tmp/page" >"$tmp/list.n" && mv "$tmp/list.n" "$tmp/list"
      [ "$max" -gt 0 ] && [ "$(jq length "$tmp/list")" -ge "$max" ] && break
      u="$(next_link)"
    done
    [ "$max" -gt 0 ] || return 0
    jq -c ".[:$max]" "$tmp/list" >"$tmp/list.n" && mv "$tmp/list.n" "$tmp/list"
  }
  uri() { jq -rn --arg s "$1" '$s|@uri'; }
  # label_ids <name>...: the labels' ids into $tmp/ids as a JSON array; an unknown name is exit 1,
  # before any write
  label_ids() {
    JQ_ARGS=(); pages "$rapi/labels?limit=50" 0 '[.[] | {id, name}]'
    jq -c --slurpfile all "$tmp/list" '$ARGS.positional | map(. as $n | ($all[0] | map(select(.name == $n)) | .[0].id) // ("missing:" + $n))' \
      -n --args "$@" >"$tmp/ids"
    local missing; missing="$(jq -r '[.[] | strings | ltrimstr("missing:") | "'"'"'\(.)'"'"'"] | join(", ")' "$tmp/ids")"
    [ -z "$missing" ] || die 1 "no label $missing on this repo (forge.sh label list shows the ones there are)"
  }
  # The filter that keeps a page's items matching every search word (title only with in:title)
  matches='map(select(. as $i | all($words[]; ascii_downcase as $w
    | (($i.title // "") + (if $t == 1 then "" else "\n" + ($i.body // "") end)) | ascii_downcase | contains($w))))'
  search_args() { JQ_ARGS=(--argjson labs "$(jq -cn '$ARGS.positional' --args ${labs[@]+"${labs[@]}"})" --argjson words "$(jq -cn '$ARGS.positional' --args ${words[@]+"${words[@]}"})" --argjson t "$title_only"); }
  has_labs='map(select(. as $i | all($labs[]; . as $l | any($i.labels[]?; .name == $l))))'
  q=""; [ "${#words[@]}" = 0 ] || q="&q=$(uri "${words[*]}")"
  # A client-side filter thins every page, so those ask for full pages (issue list --label too)
  page_for() { if [ "${#words[@]}" -gt 0 ] || [ "${#labels[@]}" -gt 0 ] || [ "$title_only" = 1 ] || [ "$1" = merged ]; then echo 50; else echo "$2"; fi; }
  who='{login: .user.login, name: (.user.full_name // "")}'
  lbl='[.labels[]? | {name, description, color}]'
  # Forgejo keeps a draft in the title (a WIP: or [WIP] prefix, any case); gh keeps it out, so a draft's title loses one
  unwip='def unwip(d): if d then .title |= sub("^(\\[wip\\]|wip:) *"; ""; "i") else . end;'
  prmap="$unwip unwip(.draft) | {number, url: .html_url, state: (if .merged then \"MERGED\" elif .state == \"open\" then \"OPEN\" else \"CLOSED\" end),
    author: $who, title, labels: $lbl, body: (.body // \"\"), headRefOid: .head.sha}"
  cmap='[.[] | {author: {login: .user.login}, body, createdAt: .created_at, url: .html_url}]'
  state='(if .state == "open" then "OPEN" else "CLOSED" end)'
  n="${pos[0]:-}"
  body_json() { jq -n --rawfile body "$opt_body_file" "$@"; }

  case "$cmd" in
    "repo default-branch") fj GET "$rapi"; jq -r .default_branch "$resp" ;;
    "repo file-url")
      fj GET "$rapi"
      url="$(jq -er '(.html_url // empty) + "/src/branch/" + .default_branch' "$resp")" || die 1 "the repo answer has no html_url or default_branch"
      printf '%s/%s\n' "$url" "$fpath" ;;
    "user login")          fj GET "$base/user"; jq -r .login "$resp" ;;
    "pr view")
      if [ -n "$n" ]; then fj GET "$rapi/pulls/$n"; jq -c "$prmap" "$resp"; exit 0; fi
      branch="$(git branch --show-current)"
      [ -n "$branch" ] || die 1 "pr view: not on a branch (detached HEAD): give the PR number"
      JQ_ARGS=(--arg b "$branch" --arg full "$owner/$repo" --arg sha "$(git rev-parse HEAD)")
      # gh's pick: the branch's open PR, else its newest closed one; a merged PR whose branch was
      # deleted lost its name (head.ref is refs/pull/<N>/head), so its head commit finds it.
      mine='map(select((.head.ref == $b and .head.repo.full_name == $full) or (.merged and (.head.ref | startswith("refs/pull/")) and .head.sha == $sha)))'
      pages "$rapi/pulls?state=open&limit=50" 0 "$mine"; found="$(jq -c 'max_by(.number) // empty' "$tmp/list")"
      if [ -z "$found" ]; then pages "$rapi/pulls?state=closed&limit=50" 0 "$mine"; found="$(jq -c 'max_by(.number) // empty' "$tmp/list")"; fi
      [ -n "$found" ] || { printf 'no pull requests found for branch "%s"\n' "$branch" >&2; exit 4; }
      jq -c "$prmap" <<<"$found" ;;
    "pr comments")  fj GET "$rapi/issues/$n/comments"; jq -c "{comments: $cmap}" "$resp" ;;
    "pr commits")
      # Forgejo lists newest first; gh lists the first commit first
      pages "$rapi/pulls/$n/commits?stat=false&files=false&verification=false&limit=50" 0 \
        '[.[] | {oid: .sha, messageHeadline: (.commit.message | split("\n")[0]),
                 messageBody: (.commit.message | sub("^[^\n]*\n*"; "")),
                 authoredDate: .commit.author.date, committedDate: .commit.committer.date}]'
      jq -c '{commits: reverse}' "$tmp/list" ;;
    "pr list"|"issue list")
      st="${opt_state:-open}"; lim="${opt_limit:-30}"
      # an unknown label would be ignored by the server (every issue back), so check the names first
      lq=""; labs=()
      if [ "$cmd" = "issue list" ] && [ "${#labels[@]}" -gt 0 ]; then
        label_ids "${labels[@]}"; labs=("${labels[@]}")
        lq="&labels="; for l in "${labels[@]}"; do lq+="$(uri "$l"),"; done; lq="${lq%,}"
      fi
      search_args
      if [ "$cmd" = "pr list" ]; then
        type=pulls; keep="$matches"; [ "$st" != merged ] || keep="map(select(.pull_request.merged)) | $matches"
        out="$unwip [.[] | unwip(.pull_request.draft) | {number, title, mergedAt: (.pull_request.merged_at // null)}]"
      else
        type=issues; keep="$matches | $has_labs"; out="[.[] | {number, title, state: $state, labels: $lbl}]"
      fi
      fst="$st"; [ "$st" != merged ] || fst=closed
      pages "$rapi/issues?type=$type&state=$fst&limit=$(page_for "$st" "$lim")$q$lq" "$lim" "$keep"
      jq -c "$out" "$tmp/list" ;;
    "pr create")
      branch="$(git branch --show-current)"
      [ -n "$branch" ] || die 1 "pr create: not on a branch (detached HEAD)"
      ids='[]'; [ "${#labels[@]}" = 0 ] || { label_ids "${labels[@]}"; ids="$(cat "$tmp/ids")"; }
      # Forgejo has no draft flag: a title prefix marks one (WORK_IN_PROGRESS_PREFIXES, WIP: by default)
      title="$opt_title"; [ -z "$opt_draft" ] || title="WIP: $title"
      fj POST "$rapi/pulls" "$(body_json --arg base "$opt_base" --arg head "$branch" --arg title "$title" --argjson labels "$ids" \
        '{base: $base, head: $head, title: $title, body: $body} + (if ($labels | length) > 0 then {labels: $labels} else {} end)')"
      jq -r .html_url "$resp" ;;
    "pr edit")
      IFS=, read -ra add <<<"$opt_add_label"; IFS=, read -ra del <<<"$opt_remove_label"
      [ "$(( ${#add[@]} + ${#del[@]} ))" = 0 ] || label_ids ${add[@]+"${add[@]}"} ${del[@]+"${del[@]}"}
      url=""; title="$opt_title"
      if [ -n "$opt_title" ]; then
        # a draft's title carries its WIP prefix: a new title keeps it, or the edit would undraft the PR
        fj GET "$rapi/pulls/$n"
        title="$(jq -r --arg t "$opt_title" 'def pre: "^(\\[wip\\]|wip:)";
          if .draft and ($t | test(pre; "i") | not) and (.title | test(pre; "i")) then (.title | capture("(?<p>" + pre + ")"; "i").p) + " " + $t else $t end' "$resp")" || die 1 "unreadable answer from GET pulls/$n"
      fi
      if [ -n "$opt_title$opt_body_file" ]; then
        patch="$(jq -n --arg title "$title" 'if $title == "" then {} else {title: $title} end')"
        [ -z "$opt_body_file" ] || patch="$(body_json --argjson p "$patch" '$p + {body: $body}')"
        fj PATCH "$rapi/pulls/$n" "$patch"; url="$(jq -r .html_url "$resp")"
      fi
      [ "${#add[@]}" = 0 ] || fj POST "$rapi/issues/$n/labels" "$(jq -cn '{labels: $ARGS.positional}' --args "${add[@]}")"
      for l in ${del[@]+"${del[@]}"}; do fj DELETE "$rapi/issues/$n/labels/$(uri "$l")"; done
      [ -n "$url" ] || { fj GET "$rapi/pulls/$n"; url="$(jq -r .html_url "$resp")"; }
      echo "$url" ;;
    "pr comment"|"issue comment")
      fj POST "$rapi/issues/$n/comments" "$(body_json '{body: $body}')"; jq -r .html_url "$resp" ;;
    "pr reopen")    fj PATCH "$rapi/pulls/$n" '{"state":"open"}'; jq -r .html_url "$resp" ;;
    "comment edit") fj PATCH "$rapi/issues/comments/$n" "$(body_json '{body: $body}')"; jq -r .html_url "$resp" ;;
    "issue view")
      fj GET "$rapi/issues/$n"; cp "$resp" "$tmp/issue"
      fj GET "$rapi/issues/$n/comments"
      jq -c --slurpfile c "$resp" "{number, title, body: (.body // \"\"), state: $state, stateReason: null, labels: $lbl,
        author: $who, comments: (\$c[0] | $cmap), createdAt: .created_at, updatedAt: .updated_at,
        closedByPullRequestsReferences: null, url: .html_url}" "$tmp/issue" ;;
    "issue create")
      ids='[]'; [ "${#labels[@]}" = 0 ] || { label_ids "${labels[@]}"; ids="$(cat "$tmp/ids")"; }
      fj POST "$rapi/issues" "$(body_json --arg title "$opt_title" --argjson labels "$ids" \
        '{title: $title, body: $body} + (if ($labels | length) > 0 then {labels: $labels} else {} end)')"
      jq -r .html_url "$resp" ;;
    "issue close")
      fj PATCH "$rapi/issues/$n" '{"state":"closed"}'
      [ "$opt_reason" = completed ] || printf '%s: Forgejo records no close reason: closed, "%s" not kept\n' "$prog" "$opt_reason" >&2
      jq -r .html_url "$resp" ;;
    "label list")   pages "$rapi/labels?limit=50" 500 '[.[] | {name, description}]'; cat "$tmp/list" ;;
    "label create")
      # gh picks a random color when none is given; Forgejo requires one
      color="$(printf '#%06x' $(( (RANDOM << 15 | RANDOM) & 0xFFFFFF )))"
      fj POST "$rapi/labels" "$(jq -n --arg name "$n" --arg d "$opt_description" --arg c "$color" '{name: $name, color: $c, description: $d}')"
      jq -r .name "$resp" ;;
  esac
  exit 0
fi

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
  "repo file-url")
    url="$(gh repo view --json url,defaultBranchRef --jq '.url + "/blob/" + .defaultBranchRef.name' 2>"$err")" || { cat "$err" >&2; exit 1; }
    cat "$err" >&2
    printf '%s/%s\n' "$url" "$fpath" ;;
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
    for l in ${labels[@]+"${labels[@]}"}; do extra+=(--label "$l"); done
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
