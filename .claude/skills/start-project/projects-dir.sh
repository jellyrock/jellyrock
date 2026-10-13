#!/usr/bin/env bash
#
# projects-dir.sh: where this repo's tracked projects live. Every lifecycle skill and script asks
# this one place instead of writing the path itself, so the folder can move without touching them.
# Shared code: maintained upstream and updated in place. A local edit is not overwritten
# silently: it is reviewed (kept, or taken upstream) at the next update.
#
# The answer, first match wins:
#   1. The per-machine git setting projects.<owner>.home is set: <home>/<owner>/<name>/projects,
#      keyed by the repo's origin (repo-key.sh, beside this script). The home must be an absolute
#      path (a leading ~ is expanded) to a folder that exists, or the projects are unreachable.
#      Write <owner> in lowercase, as repo-key.sh prints it.
#   2. git ignores docs/projects: unreachable. Projects kept out of this repo need the setting.
#   3. The repo's own docs/projects (it may not exist yet).
#
# Usage: bash .claude/skills/start-project/projects-dir.sh [<dir>]
#   dir:  any folder inside the repo (default: the current one)
# Prints the absolute path of the projects folder. Exit 2, printing nothing, when <dir> is not
# inside a git repository; exit 3, printing nothing on stdout and the reason on stderr, when the
# projects are unreachable. A reason names no absolute path.

set -euo pipefail

unreachable() { printf 'projects-dir: unreachable: %s\n' "$1" >&2; exit 3; }

dir="${1:-.}"
root="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" \
  || { printf 'projects-dir: %s is not inside a git repository\n' "$dir" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$here/repo-key.sh" ] || unreachable "repo-key.sh is missing beside projects-dir.sh"

key="$(bash "$here/repo-key.sh" "$root" 2>/dev/null)" || key=""
if [ -n "$key" ]; then
  owner="${key%%/*}"; setting="projects.$owner.home"
  if home="$(git -C "$root" config --type=path --get "$setting")"; then
    case "$home" in /*) ;; *) unreachable "$setting is not an absolute path" ;; esac
    [ -d "$home" ] || unreachable "$setting names a folder that does not exist"
    printf '%s/%s/projects\n' "${home%/}" "$key"; exit 0
  fi
fi

if git -C "$root" check-ignore -q docs/projects/.probe; then
  [ -n "$key" ] || unreachable "docs/projects is ignored here and the repo has no origin to key a home by"
  unreachable "docs/projects is ignored here; set $setting to the folder that holds this repo's projects"
fi
printf '%s/docs/projects\n' "$root"
