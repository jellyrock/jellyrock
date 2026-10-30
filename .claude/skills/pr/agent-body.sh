#!/usr/bin/env bash
#
# agent-body.sh tells a change's agent files from its other files, and writes the bare body that
# names them: one fixed line and the file list, nothing else. In a public repo the agent part of a
# PR body is always this bare form.
#
# Agent files are the default list below plus the paths in the `### Agent paths` slot of the repo's
# Repo facts (AGENTS.md at the repo root), each in backticks; `none` there adds nothing. A path that
# ends in `/` is a folder, matched at any depth; a bare file name is matched at any depth; any other
# path is matched from the repo root.
#
# Usage: bash .claude/skills/pr/agent-body.sh <command> [--all] [<file>]
#   title   the title of an agent-only PR or commit in a public repo, which also has no other text;
#           takes no option or input, and needs no repository
#   paths   the agent paths, one per line
#   split   each input line, led by `agent` or `other` and a tab
#   kind    `agent-only`, `mixed` or `none`
#   list    the agent files as a Markdown list; a removed file says `(removed)`
#   body    the fixed line, a blank line, then the list; nothing when there is no agent file
# The input is git's name-status (`git diff --name-status <base>...HEAD`), from <file> or standard
# input; a rename or copy is judged by its new path. --all counts every file as an agent file, for
# a change made only of agent files by construction.
# Exit 2, with nothing on stdout, on a usage error, a line that is not name-status, or a folder
# with no repository: never a guess.

set -euo pipefail

LINE='Update the agent skills and rules.'
TITLE='chore(agents): Update the agent skills and rules'
DEFAULTS=(.claude/ AGENTS.md CLAUDE.md .voice-baseline.tsv .voice-ignore .worktreeinclude)

die() { printf 'agent-body: %s\n' "$1" >&2; exit 2; }
usage="usage: agent-body.sh title | agent-body.sh paths | agent-body.sh {split|kind|list|body} [--all] [<file>]"

cmd="${1:-}"; [ $# -gt 0 ] && shift
all=0; file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --all) all=1 ;;
    -*) die "unknown option $1; $usage" ;;
    *) [ -z "$file" ] || die "one input file only; $usage"; file="$1" ;;
  esac
  shift
done
case "$cmd" in title|paths|split|kind|list|body) ;; *) die "$usage" ;; esac
if [ "$cmd" = title ]; then
  [ "$all" = 0 ] && [ -z "$file" ] || die "title takes no option or input; $usage"
  printf '%s\n' "$TITLE"; exit 0
fi

root="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository"

# the slot's paths: every backticked token between `### Agent paths` and the next heading
slot=()
if [ -f "$root/AGENTS.md" ]; then
  while IFS= read -r p; do [ -n "$p" ] && slot+=("$p"); done < <(awk '
    { sub(/\r$/, "") }
    /^### Agent paths[ \t]*$/ { s = 1; next }
    s && /^#/ { exit }
    s { l = $0
        while (match(l, /`[^`]+`/)) { print substr(l, RSTART + 1, RLENGTH - 2); l = substr(l, RSTART + RLENGTH) } }' "$root/AGENTS.md")
fi
PATHS=("${DEFAULTS[@]}" "${slot[@]+"${slot[@]}"}")

if [ "$cmd" = paths ]; then printf '%s\n' "${PATHS[@]}"; exit 0; fi

# is_agent <path> -> true when the path is an agent file
is_agent() {
  local p="$1" e
  [ "$all" = 1 ] && return 0
  for e in "${PATHS[@]}"; do
    case "$e" in
      */) case "$p" in "$e"*|*/"$e"*) return 0 ;; esac ;;
      */*) [ "$p" = "$e" ] && return 0 ;;
      *) case "$p" in "$e"|*/"$e") return 0 ;; esac ;;
    esac
  done
  return 1
}

if [ -n "$file" ]; then
  [ -f "$file" ] || die "no such file: $file"
  input="$(cat "$file")"
else
  input="$(cat)"
fi

# read every line first, so a bad one prints nothing at all
sides=(); stats=(); news=(); lines=()
while IFS= read -r l; do
  [ -n "$l" ] || continue
  IFS=$'\t' read -r st a b <<<"$l"
  [[ "$st" =~ ^[A-Z][0-9]*$ ]] && [ -n "${a:-}" ] || die "not a name-status line: $l"
  case "$st" in R*|C*) [ -n "${b:-}" ] || die "a rename or copy needs two paths: $l"; p="$b" ;; *) p="$a" ;; esac
  if is_agent "$p"; then sides+=(agent); else sides+=(other); fi
  stats+=("$st"); news+=("$p"); lines+=("$l")
done <<<"$input"

n=${#lines[@]}; na=0
for ((i = 0; i < n; i++)); do [ "${sides[i]}" = agent ] && na=$((na + 1)); done

case "$cmd" in
  split) for ((i = 0; i < n; i++)); do printf '%s\t%s\n' "${sides[i]}" "${lines[i]}"; done ;;
  kind)
    if [ "$na" -eq 0 ]; then echo none
    elif [ "$na" -eq "$n" ]; then echo agent-only
    else echo mixed; fi ;;
  list|body)
    [ "$na" -gt 0 ] || exit 0
    [ "$cmd" = body ] && printf '%s\n\n' "$LINE"
    for ((i = 0; i < n; i++)); do
      [ "${sides[i]}" = agent ] || continue
      # shellcheck disable=SC2016  # literal Markdown backticks
      if [ "${stats[i]}" = D ]; then printf -- '- `%s` (removed)\n' "${news[i]}"
      else printf -- '- `%s`\n' "${news[i]}"; fi
    done ;;
esac
