#!/usr/bin/env bash
#
# overlap.sh: the files this checkout and another worktree of the same repo have both changed, so
# work in one never lands on top of unseen work in another. /resume-project reports them, and a
# commit-time check can warn with them. The main clone counts as a worktree.
#
# - Changed means the net change since the branch left the default branch (git diff
#   origin/HEAD...HEAD, so work already on the default branch is nobody's), plus uncommitted and
#   untracked files. A rename counts both paths; an ignored file never counts.
# - With paths (from the top of the checkout, as git prints them), only those are checked, changed
#   here or not: a commit-time check passes the files the commit holds.
# - With no other worktree, or outside a git checkout, it prints nothing.
# - A repo with no origin/HEAD (one created by git init, then given a remote) or no origin has no
#   default branch to compare with: it says so, with the fix when there is one, and compares
#   uncommitted and untracked files only.
# - A worktree whose folder is gone is skipped.
# Shared code: maintained upstream and updated in place. A local edit is not overwritten
# silently: it is reviewed (kept, or taken upstream) at the next update.
#
# Usage: bash .claude/skills/resume-project/overlap.sh [-C <folder>] [--] [<path>…]
# Prints one line per file and worktree, sorted: <path><TAB><worktree folder><TAB><branch, or
# (detached)>; NOTE: lines say what could not be compared. Exit 0, or 2 on a usage error.

set -uo pipefail

usage() { printf 'overlap: %s\nusage: overlap.sh [-C <folder>] [--] [<path>...]\n' "$1" >&2; exit 2; }

dir=.; paths=()
while [ $# -gt 0 ]; do
  case "$1" in
    -C) [ $# -ge 2 ] || usage "-C needs a folder"; dir="$2"; shift 2 ;;
    --) shift; paths+=("$@"); break ;;
    -*) usage "unknown option $1" ;;
    *) paths+=("$1"); shift ;;
  esac
done

top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || exit 0
top="$(cd "$top" && pwd -P)" || exit 0

# The other worktrees, from git's records: one field per NUL, each record ended by an empty field.
# A folder that is gone is skipped; a bare main repo's folder has no work tree, so git reports no
# change there.
sib=(); sbr=()
wt=""; br=""
while IFS= read -r -d '' field; do
  case "$field" in
    "worktree "*) wt="${field#worktree }"; br="(detached)" ;;
    "branch "*) br="${field#branch refs/heads/}" ;;
    "")
      if [ -n "$wt" ] && real="$(cd "$wt" 2>/dev/null && pwd -P)" && [ "$real" != "$top" ]; then
        sib+=("$wt"); sbr+=("$br")
      fi
      wt="" ;;
  esac
done < <(git -C "$top" worktree list --porcelain -z 2>/dev/null)
[ "${#sib[@]}" -gt 0 ] || exit 0

base=""
if git -C "$top" rev-parse -q --verify refs/remotes/origin/HEAD >/dev/null; then base=origin/HEAD
elif git -C "$top" remote get-url origin >/dev/null 2>&1; then
  echo "NOTE: this repo has no origin/HEAD, so commits are not compared, only uncommitted and untracked files; set it with: git remote set-head origin --auto"
else
  echo "NOTE: this repo has no remote named origin, so it has no default branch to compare commits with: only uncommitted and untracked files are compared"
fi

# changed <checkout>: the files it changed (see the header), one per NUL.
changed() {
  local rec
  [ -z "$base" ] || git -C "$1" diff -z --name-only --no-renames "$base...HEAD" 2>/dev/null
  git -C "$1" status -z --porcelain=v1 --untracked-files=all --no-renames 2>/dev/null \
    | while IFS= read -r -d '' rec; do printf '%s\0' "${rec:3}"; done
}

declare -A want=()
if [ "${#paths[@]}" -gt 0 ]; then
  for p in "${paths[@]}"; do want["$p"]=1; done
else
  while IFS= read -r -d '' p; do want["$p"]=1; done < <(changed "$top")
fi
[ "${#want[@]}" -gt 0 ] || exit 0

for i in "${!sib[@]}"; do
  while IFS= read -r -d '' p; do
    [ -z "${want[$p]:-}" ] || printf '%s\t%s\t%s\n' "$p" "${sib[$i]}" "${sbr[$i]}"
  done < <(changed "${sib[$i]}" | sort -zu)
done | LC_ALL=C sort
exit 0
