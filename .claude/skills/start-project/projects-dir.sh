#!/usr/bin/env bash
#
# projects-dir.sh — where this repo's tracked projects live. Every lifecycle skill and script asks
# this one place instead of writing the path itself, so the folder can move without touching them.
# Shared code: maintained upstream and updated in place. A local edit is not overwritten
# silently — it is reviewed (kept, or taken upstream) at the next update.
#
# Today it always answers the repo's own docs/projects/. A per-machine setting may later point a
# repo elsewhere; callers need no change when it does.
#
# Usage: bash .claude/skills/start-project/projects-dir.sh [<dir>]
#   dir:  any folder inside the repo (default: the current one)
# Prints the absolute path of the projects folder (it may not exist yet). Exit 2, printing
# nothing, when <dir> is not inside a git repository.

set -euo pipefail

dir="${1:-.}"
root="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" \
  || { printf 'projects-dir: %s is not inside a git repository\n' "$dir" >&2; exit 2; }
printf '%s/docs/projects\n' "$root"
