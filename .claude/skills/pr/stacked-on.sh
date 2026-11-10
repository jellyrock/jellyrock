#!/usr/bin/env bash
#
# stacked-on.sh names the remote branches the current branch is built on, so /pr opens a stacked
# branch against its real base and not against the default branch by assumption. A branch counts as
# the base when the commit it shares with HEAD is not on the default branch: HEAD then carries that
# branch's own commits. A branch built on this one shares HEAD itself and is left out, as is the
# current branch's own upstream and the default branch.
#
# Usage: bash .claude/skills/pr/stacked-on.sh <default branch>
# Prints each such branch on origin, one per line, without the `origin/` prefix. Prints nothing when
# there is none. It reads the last fetch and makes no forge call.
# Exit 2 on a usage error; exit 1 when origin's default branch is not fetched.

set -euo pipefail

[ $# -eq 1 ] || { echo "Usage: stacked-on.sh <default branch>" >&2; exit 2; }
default="$1"
pre="refs/remotes/origin/"
git rev-parse --verify -q "$pre$default" >/dev/null \
  || { echo "stacked-on.sh: $pre$default does not exist: fetch first (git fetch origin)" >&2; exit 1; }

head_sha="$(git rev-parse HEAD)"
upstream="$(git rev-parse --symbolic-full-name '@{upstream}' 2>/dev/null || true)"

while IFS= read -r ref; do
  case "$ref" in "$pre"HEAD|"$pre$default"|"$upstream") continue ;; esac
  mb="$(git merge-base HEAD "$ref" 2>/dev/null)" || continue
  [ "$mb" != "$head_sha" ] || continue
  ! git merge-base --is-ancestor "$mb" "$pre$default" || continue
  echo "${ref#"$pre"}"
done < <(git for-each-ref --format='%(refname)' "$pre")
