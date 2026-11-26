#!/usr/bin/env bash
#
# issue-link.sh: turns a draft into a link that opens a GitHub page with the draft filled in, so the
# person filing it checks it on GitHub and submits it there: the repository's new-issue page, or with
# --compare its page for opening a pull request from one branch into another. With --search it looks
# for that draft's duplicates, so that search words are never typed into a command.
#
# The draft comes on standard input as fields, each starting with a line `=== <key>`: `title`, then
# each form field by its id, or `body` when the repository has no forms or the link opens a pull
# request. A value's blank first and last lines are dropped, and a field with no text is left out of
# the link.
#
# Usage: issue-link.sh <owner/name> [<form file>] <<'DRAFT'
#        issue-link.sh --compare <owner/name> <base branch> <[owner:]head branch> <<'DRAFT'
#        issue-link.sh --scan <text
#        issue-link.sh --search <owner/name> <<'WORDS'
#        issue-link.sh --auth
# --search takes one search on each line of standard input and runs it on the open and closed issues,
# by title and then broadly, under a `SEARCH <n>: <words>` line. It prints `SEARCH FAILED` when gh
# fails, so that a failure never reads as no duplicates.
# --auth checks gh before anything else. It prints AUTH ready <login>, or exits 4 with only the words to
# show the user, in Markdown with no fenced block, so nothing internal can leak and a copy wrapped in a
# code block still reads intact. gh's own advice is wrong inside a sandbox. It never asks gh for the token.
# Prints a `HIT <key>: <line>` line for each draft line that looks private (a home folder path, an
# email address, a token or key), then `LENGTH <n>` and `URL <link>`. When the link passes the length
# limit it prints `TOO LONG` and a `FIELD <key> <encoded length>` line per field, longest first, in
# place of the link. --scan reads any text, such as a diff or a draft, and prints only a `HIT <line
# number>: <line>` line for each line that looks private and an `EMPTY <line number>: <heading>` line for
# each Markdown heading with nothing under it before the next heading or the end. --compare prints the
# same EMPTY lines for the body, numbered from its first line, and still prints the link.
# Exit: 0 the link printed (with --scan, the text read; with --search, each search ran), 1 a search
# failed, 3 the link is too long, 2 a usage or draft error; with --auth, 0 ready and 4 a stop.
set -uo pipefail
export LC_ALL=C

# GitHub documents no number for its link limit, only the "414 URI Too Long" page: this is a chosen cap.
LIMIT=8000

die() { printf 'issue-link: %s\n' "$1" >&2; exit 2; }
usage="usage: issue-link.sh <owner/name> [<form file>] | --compare <owner/name> <base> <[owner:]head> | --scan | --search <owner/name> | --auth"
mode=issue repo='' form='' base='' head=''

# search <owner/name>: each line of standard input searched by title, then broadly
search() {
  local words query n=0 rc=0
  while IFS= read -r words || [ -n "$words" ]; do
    case "$words" in *[![:space:]]*) ;; *) continue ;; esac
    n=$((n + 1))
    echo "SEARCH $n: $words"
    for query in "$words in:title" "$words"; do
      gh issue list -R "$1" --state all --limit 10 --search "$query" </dev/null || { echo "SEARCH FAILED"; rc=1; }
    done
  done
  [ "$n" -gt 0 ] || die "give the search words on standard input, one search a line"
  return "$rc"
}

# command_line <text>: a command for the user to run, as inline code on its own line
command_line() { local tick='`'; printf '\n%s%s%s\n\n' "$tick" "$1" "$tick"; }

# token_remedy: how a signed-in user whose sign-in this session cannot read goes on. The command that
# starts a session comes from the harness (harness.sh launch); with no answer, the advice names none.
token_remedy() {
  local hs cmd=""
  hs="$(git config --type=path --get harness.script 2>/dev/null)" || hs=""
  [ -f "$hs" ] && cmd="$(bash "$hs" launch </dev/null 2>/dev/null | awk -F'\t' '$1 == "command" { print $2 }')"
  if [ -n "$cmd" ]; then
    echo "Start the session again with the token in its environment, which lets every command in that session read it:"
    command_line "GH_TOKEN=\"\$(gh auth token)\" $cmd"
  else
    echo "Start the session again with \`GH_TOKEN=\"\$(gh auth token)\"\` in its environment, which lets every command in that session read it."
  fi
  echo "Or run this in a session without the sandbox."
}

# auth: AUTH ready <login> when gh reads GitHub as someone; otherwise exit 4 with only the words for the
# user (Markdown, no fenced block, no internal line).
# gh's own advice is wrong when a sandbox hides the keyring (it says to sign in) or the network (to
# refresh), so the state comes from gh auth status --json (gh 2.81 or later): the active account's
# token source is "default" when its stored token cannot be read. It never asks gh for the token.
auth() {
  local login err try state who source detail detail2 version
  if ! type -P gh >/dev/null; then
    echo "GitHub CLI (\`gh\`) is not installed. Install it from https://cli.github.com, sign in with \`gh auth login\`, then run this again."
    return 4
  fi
  err="$(mktemp)" || die "cannot create a temporary file"
  for try in 1 2 3; do
    if login="$(gh api user --jq .login </dev/null 2>"$err")" && [ -n "$login" ]; then
      rm -f "$err"; echo "AUTH ready $login"; return 0
    fi
    [ "$try" = 3 ] || sleep 1
  done
  detail="$(grep -m1 . "$err")"; rm -f "$err"
  if ! state="$(gh auth status --hostname github.com --json hosts --jq '.hosts["github.com"][]? | select(.active) | [.state, (.login // ""), (.tokenSource // ""), (.error // "" | split("\n")[0])] | join("\u001f")' </dev/null 2>/dev/null)"; then
    version="$(gh --version </dev/null 2>/dev/null | sed -n '1s/^gh version \([^ ]*\).*/\1/p')"
    echo "\`gh\` could not reach your GitHub account, and \`gh\` ${version:-of this age} is too old to say why (2.81 or later can). It said: ${detail:-nothing}."
    echo "If \`gh\` is signed in, this session may not be able to read that sign-in."
    token_remedy
    echo "Otherwise sign in with \`gh auth login\`."
    return 4
  fi
  IFS=$'\x1f' read -r state who source detail2 <<<"$state"
  [ -z "${detail2:-}" ] || detail="$detail2"
  case "${state:-}:${source:-}:${detail:-}" in
    :*)
      echo "\`gh\` is not signed in to GitHub. Sign in, then run this again:"
      command_line 'gh auth login' ;;
    error:GH_TOKEN:*401*|error:GITHUB_TOKEN:*401*)
      echo "GitHub rejected the token in \`$source\`. Replace it or unset it, then run this again." ;;
    error:default:*401*)
      echo "\`gh\` is signed in as \`$who\`, but this session can't read that sign-in. A sandbox around the session's commands usually blocks the keyring where \`gh\` keeps it."
      token_remedy ;;
    error:*:*401*)
      echo "GitHub rejected \`gh\`'s saved sign-in for \`$who\`. It may have expired or been revoked. Sign in again:"
      command_line 'gh auth login' ;;
    *)
      echo "\`gh\` could not reach GitHub (${detail:-no reason given}). Check the network. A sandbox needs \`github.com\` and \`api.github.com\` allowed. Then run this again." ;;
  esac
  return 4
}

case "${1:-}" in
  --auth) [ "$#" -eq 1 ] || die "$usage"; auth; exit ;;
  --scan) [ "$#" -eq 1 ] || die "$usage"; mode=scan ;;
  --search)
    [ "$#" -le 2 ] || die "the search words go on standard input, not in the command"
    [[ "${2:-}" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || die "$usage"
    search "$2"
    exit
    ;;
  --compare)
    [ "$#" -eq 4 ] || die "$usage"
    mode=compare repo="$2" base="$3" head="$4"
    git check-ref-format --branch "$base" >/dev/null 2>&1 || die "the base is a branch name, not '$base'"
    hb="${head#*:}"
    [ "$hb" = "$head" ] || [[ "${head%%:*}" =~ ^[A-Za-z0-9-]+$ ]] || die "the head is a branch or owner:branch, not '$head'"
    git check-ref-format --branch "$hb" >/dev/null 2>&1 || die "the head is a branch or owner:branch, not '$head'"
    ;;
  *)
    repo="${1:-}" form="${2:-}"
    [ "$#" -le 2 ] || die "$usage"
    [ -z "$form" ] || [[ "$form" =~ ^[A-Za-z0-9._-]+\.ya?ml$ ]] || die "the form is a file name such as bug_report.yml, not '$form'"
    ;;
esac
[ "$mode" = scan ] || [[ "$repo" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || die "$usage"

awk -v mode="$mode" -v repo="$repo" -v form="$form" -v base="$base" -v head="$head" -v limit="$LIMIT" '
function enc(s, keep,   i, c, out) {
  out = ""
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (c ~ /[A-Za-z0-9._~-]/ || (keep != "" && index(keep, c))) out = out c
    else out = out sprintf("%%%02X", ord[c])
  }
  return out
}
function value(k,   a, b, j, s) {
  a = 1; b = cnt[k]
  while (a <= b && lines[k, a] == "") a++
  while (b >= a && lines[k, b] == "") b--
  s = ""
  for (j = a; j <= b; j++) s = s (j > a ? "\n" : "") lines[k, j]
  return s
}
function heading(no, s) {
  if (s ~ /^#+ /) { empty_end(); hn = no; ht = s } else if (s !~ /^[ \t]*$/) hn = 0
}
function empty_end() { if (hn) print "EMPTY " hn ": " ht }
BEGIN {
  for (i = 1; i < 256; i++) ord[sprintf("%c", i)] = i
  priv = "/home/|/users/|[a-z]:\\\\users\\\\|[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z][a-z]+|begin [a-z ]*private key|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|xox[abprs]-|akia[0-9a-z]"
}
mode == "scan" {
  if (tolower($0) ~ priv) print "HIT " NR ": " substr($0, 1, 120)
  heading(NR, $0)
  next
}
err != "" { next }
/^=== / {
  key = substr($0, 5)
  if (key !~ /^[A-Za-z0-9_.-]+$/) { err = "a field key is letters, digits, dots, dashes or underscores, not \"" key "\""; next }
  if (key in cnt) { err = "the field " key " appears twice"; next }
  order[++n] = key; cnt[key] = 0
  next
}
{
  if (n == 0) { if ($0 != "") err = "the draft starts with a line `=== <key>`"; next }
  k = order[n]; lines[k, ++cnt[k]] = $0
  if (tolower($0) ~ priv) hits[++h] = k ": " substr($0, 1, 120)
}
END {
  if (mode == "scan") { empty_end(); exit 0 }
  if (err != "") { printf "issue-link: %s\n", err > "/dev/stderr"; exit 2 }
  if (!("title" in cnt) || value("title") == "") { print "issue-link: the draft needs a `=== title` field with text" > "/dev/stderr"; exit 2 }
  for (j = 1; j <= n; j++)
    if (form == "" && order[j] != "title" && order[j] != "body") { printf "issue-link: %s the draft holds only title and body, not %s\n", (mode == "compare" ? "with --compare" : "with no form"), order[j] > "/dev/stderr"; exit 2 }
  for (j = 1; j <= h; j++) print "HIT " hits[j]
  if (mode == "compare" && ("body" in cnt)) {
    for (j = 1; j <= cnt["body"]; j++) heading(j, lines["body", j])
    empty_end()
  }
  if (mode == "compare") url = "https://github.com/" repo "/compare/" enc(base, "/") "..." enc(head, "/:") "?quick_pull=1&"
  else url = "https://github.com/" repo "/issues/new?"
  if (form != "") url = url "template=" enc(form) "&"
  e = enc(value("title")); url = url "title=" e; f = 1; fk[1] = "title"; fl[1] = length(e)
  for (j = 1; j <= n; j++) {
    k = order[j]; if (k == "title") continue
    v = value(k); if (v == "") continue
    e = enc(v); url = url "&" k "=" e; fk[++f] = k; fl[f] = length(e)
  }
  print "LENGTH " length(url)
  if (length(url) > limit) {
    print "TOO LONG"
    for (a = 1; a <= f; a++) for (b = a + 1; b <= f; b++) if (fl[b] > fl[a]) { t = fl[a]; fl[a] = fl[b]; fl[b] = t; t = fk[a]; fk[a] = fk[b]; fk[b] = t }
    for (a = 1; a <= f; a++) print "FIELD " fk[a] " " fl[a]
    exit 3
  }
  print "URL " url
}'
