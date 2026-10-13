#!/usr/bin/env bash
#
# mailbox.sh: messages between repos, for the skills that read and send them (/catchup,
# /resume-project, /log message and /done). It runs the script the per-machine git setting
# mailbox.script names, with the same arguments, and prints what it prints. With no setting this
# machine has no mailbox: list prints nothing, and anything else says so.
# Shared code: maintained upstream and updated in place. A local edit is not overwritten
# silently: it is reviewed (kept, or taken upstream) at the next update.
#
# Usage: bash .claude/skills/start-project/mailbox.sh list [--tsv] [--project <folder>]
#        bash .claude/skills/start-project/mailbox.sh show <id>
#        bash .claude/skills/start-project/mailbox.sh send <owner/name> --id <id> --title <title> --body-file <file> [--project <folder>] [--commit <rev>]
#        bash .claude/skills/start-project/mailbox.sh send <owner/name> --from <fid> [--project <folder>]
#        bash .claude/skills/start-project/mailbox.sh close <id> --note <one line> [--commit <rev>]
# Exit: the script's (0 done, 2 usage, 3 refused, 4 not written: try again); 3 when this machine has
# no mailbox, except list (0).

set -uo pipefail

none() { [ "${1:-}" = list ] && exit 0; exit 3; }
script="$(git config --type=path --get mailbox.script 2>/dev/null)" || {
  [ "${1:-}" = list ] || echo "mailbox: no mailbox on this machine (the setting mailbox.script is missing); the global setup writes it"
  none "$@"
}
[ -f "$script" ] || {
  [ "${1:-}" = list ] || echo "mailbox: the setting mailbox.script names a file that does not exist; run the global setup again"
  none "$@"
}
exec bash "$script" "$@" </dev/null
