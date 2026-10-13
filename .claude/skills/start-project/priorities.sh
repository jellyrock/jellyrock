#!/usr/bin/env bash
#
# priorities.sh: where this work sits on your ranked priorities list, for the skills that say so
# (/resume-project, /focus, /catchup, /start-project and a close). It runs the reader the
# per-machine git setting priorities.reader names, with the same arguments, and prints what it
# prints. With no setting it prints nothing: this machine keeps no list, and nothing changes.
# Shared code: maintained upstream and updated in place. A local edit is not overwritten
# silently: it is reviewed (kept, or taken upstream) at the next update.
#
# Usage: bash .claude/skills/start-project/priorities.sh line <dir> --project <folder> | --fid <id> | --none
#        bash .claude/skills/start-project/priorities.sh top <dir> [--all]
# Exit 0, except a usage error from the reader (2).

set -uo pipefail

reader="$(git config --type=path --get priorities.reader 2>/dev/null)" || exit 0
[ -f "$reader" ] || { echo "priorities: NOTE: the setting priorities.reader names a file that does not exist; run the global setup again"; exit 0; }
exec bash "$reader" "$@" </dev/null
