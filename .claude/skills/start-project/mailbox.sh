#!/usr/bin/env bash
#
# mailbox.sh: messages between repos, for the skills that read and send them (/catchup,
# /resume-project, /log message and /done). It runs the script the per-machine git setting
# mailbox.script names, with the same arguments, and prints what it prints. With no setting this
# machine has no mailbox: a list (list, handled, or requests with nothing or only flags after it)
# prints nothing, and anything else says so.
#
# Usage: bash .claude/skills/start-project/mailbox.sh list [--tsv [--pin [--landing]]] [--project <folder>]
#        bash .claude/skills/start-project/mailbox.sh show <id>
#        bash .claude/skills/start-project/mailbox.sh requests [--tsv [--landing]] [--project <folder>]
#        bash .claude/skills/start-project/mailbox.sh requests show <id>
#        bash .claude/skills/start-project/mailbox.sh send <owner/name> --id <id> --title <title> --body-file <file> [--project <folder>] [--commit <rev>] [--pinned]
#        bash .claude/skills/start-project/mailbox.sh send <owner/name> --from <fid> [--project <folder>] [--pinned]
#        bash .claude/skills/start-project/mailbox.sh close <id> --note <one line> [--commit <rev>]
#        bash .claude/skills/start-project/mailbox.sh handled <branch>
# Exit: the script's (0 done, 2 usage, 3 refused, 4 not written: try again); 3 when this machine has
# no mailbox, except a list (0).

set -uo pipefail

# listing <args> -> whether the arguments ask for a list, which prints nothing when there is no mailbox
listing() { [ "${1:-}" = list ] || [ "${1:-}" = handled ] || { [ "${1:-}" = requests ] && case "${2:-}" in ""|--*) true ;; *) false ;; esac; }; }
none() { listing "$@" && exit 0; exit 3; }
script="$(git config --type=path --get mailbox.script 2>/dev/null)" || {
  listing "$@" || echo "mailbox: no mailbox on this machine (the setting mailbox.script is missing); the global setup writes it"
  none "$@"
}
[ -f "$script" ] || {
  listing "$@" || echo "mailbox: the setting mailbox.script names a file that does not exist; run the global setup again"
  none "$@"
}
exec bash "$script" "$@" </dev/null
