#!/usr/bin/env bash
#
# focus-fid.sh: what /focus prints when its arguments are an open followup's fid, or the id of an
# open work request part naming this repo (ADR 0012 item 5). It prints the entry or the part
# (verbatim, in <followup> or <request> tags) and the fixed parts of the pick block, so the model
# fills in only the route. The block opens the message that ends the
# turn: a prose instruction to show it mid-turn was skipped, and tool output never reaches the
# user, so only text the model writes does.
#
# - A followup's title is the entry's heading without its leading `#### ` and its trailing backticked
#   [fid: …], [captured …], [prompt: …] and [pinned] markers; the date is the [captured …] marker.
#   A part's title, sender, date and project come from its `mailbox.sh requests --tsv` row.
# - A line of the text that starts with NOTE: (after any spaces) could be read as one of this
#   script's own notes, so a NOTE line after the closing tag names each one as followup or request text.
# - The {{…}} parts of the PICK block are fill-ins for the model; they print literally.
# - The entry comes from journal.sh show, found beside this skill's folder at ../log/journal.sh; the
#   part from mailbox.sh requests show, at ../start-project/mailbox.sh.
# - A bare id is looked up as both; one that is both is refused, and fid: or request: picks one.
#
# Shared code: maintained upstream and updated in place. A local edit is not overwritten
# silently: it is reviewed (kept, or taken upstream) at the next update.
#
# Usage: bash .claude/skills/focus/focus-fid.sh <fid> | fid:<fid> | request:<id>
# Prints the FOLLOWUP (or REQUEST), PICK and END sections. Exit 0; 1 when nothing open has the id
# (closed or unknown), with journal.sh's line and, when there is a mailbox, its own; 2 on a usage
# error; 3 when the id is both an open followup and an open part.

set -uo pipefail

usage() { printf 'focus-fid: %s\nusage: focus-fid.sh <fid> | fid:<fid> | request:<id> | message:<id>\n' "$1" >&2; exit 2; }

[ $# -eq 1 ] || usage "needs exactly one fid"
want=all; fid="$1"
case "$fid" in
  fid:*) want=fid; fid="${fid#fid:}" ;;
  request:*) want=request; fid="${fid#request:}" ;;
  message:*) want=message; fid="${fid#message:}" ;;
esac
[[ $fid =~ ^[a-z0-9][a-z0-9-]*$ ]] || usage "not a fid: '$1' (lowercase letters, digits and hyphens)"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
journal="$here/../log/journal.sh"
mbox="$here/../start-project/mailbox.sh"

# the open part with this id, as one `mailbox.sh requests --tsv` row: id, from, sent, days, project,
# title, pinned, landing; nothing when there is none or no mailbox
first_row() { awk -F'\t' -v id="$fid" '$1 == id "" && !f { print; f = 1 }'; }
row=""
if [ "$want" = all ] || [ "$want" = request ]; then
  [ ! -f "$mbox" ] || row="$(bash "$mbox" requests --tsv 2>/dev/null </dev/null | first_row)"
fi
# the open message with this id, as one `mailbox.sh list --tsv --pin` row: id, from, sent, days,
# project, title, pinned
mrow=""
if [ "$want" = all ] || [ "$want" = message ]; then
  [ ! -f "$mbox" ] || mrow="$(bash "$mbox" list --tsv --pin 2>/dev/null </dev/null | first_row)"
fi
fok=1; entry=""
if [ "$want" = all ] || [ "$want" = fid ]; then entry="$(bash "$journal" show "$fid" 2>&1)"; fok=$?; fi

if [ -n "$row" ] && [ "$fok" = 0 ] && [ -z "$mrow" ]; then
  printf "focus-fid: '%s' is both an open followup and an open work request part for this repo: run /focus fid:%s or /focus request:%s\n" "$fid" "$fid" "$fid"
  exit 3
fi
forms=()
[ "$fok" != 0 ] || forms+=("/focus fid:$fid")
[ -z "$row" ] || forms+=("/focus request:$fid")
[ -z "$mrow" ] || forms+=("/focus message:$fid")
if [ "${#forms[@]}" -gt 1 ]; then
  list="${forms[0]}"; for f in "${forms[@]:1}"; do list+=" or $f"; done
  printf "focus-fid: '%s' is open for this repo as more than one kind: run %s\n" "$fid" "$list"
  exit 3
fi
if [ "${#forms[@]}" = 0 ]; then
  [ "$want" != all ] && [ "$want" != fid ] || printf '%s\n' "$entry"
  if [ "$want" = request ] || { [ "$want" = all ] && [ -f "$mbox" ]; }; then
    printf "focus-fid: no open work request part '%s' for this repo\n" "$fid"
  fi
  if [ "$want" = message ] || { [ "$want" = all ] && [ -f "$mbox" ]; }; then
    printf "focus-fid: no open message '%s' for this repo\n" "$fid"
  fi
  exit 1
fi

resume="When the entry says a project tracks it, print /resume-project {{slug}} $fid alone in its own text block instead, and stop."
if [ -n "$row" ]; then
  kind=request; entry="$(bash "$mbox" requests show "$fid" 2>/dev/null </dev/null)"
  IFS=$'\037' read -r _ from sent _ proj title _ <<<"$(tr '\t' '\037' <<<"$row")"
  why="[request: $fid] from $from, sent $sent"; resume=""
  [ -z "$proj" ] || resume="The request says this part is about project $proj: print /resume-project ${proj#[0-9][0-9][0-9][0-9]-[0-9][0-9]-} $fid alone in its own text block instead, and stop."
elif [ -n "$mrow" ]; then
  # the resume command names no id: /resume-project lists a message about its project by itself
  kind=message; entry="$(bash "$mbox" show "$fid" 2>/dev/null </dev/null)"
  IFS=$'\037' read -r _ from sent _ proj title _ <<<"$(tr '\t' '\037' <<<"$mrow")"
  why="[message: $fid] from $from, sent $sent"; resume=""
  [ -z "$proj" ] || resume="The message is about project $proj: print /resume-project ${proj#[0-9][0-9][0-9][0-9]-[0-9][0-9]-} alone in its own text block instead, and stop."
else
  kind=followup
  heading="$(head -n 1 <<<"$entry")"
  title="${heading#"#### "}"
  date=""
  if [[ $heading =~ \[captured\ ([0-9]{4}-[0-9]{2}-[0-9]{2})\] ]]; then date="${BASH_REMATCH[1]}"; fi
  # shellcheck disable=SC2016
  marker='^(.*[^[:space:]])[[:space:]]+`?\[(fid|captured|prompt|pinned)[^]]*\]`?[[:space:]]*$'
  while [[ $title =~ $marker ]]; do title="${BASH_REMATCH[1]}"; done
  why="[fid: $fid], captured $date"
fi

printf '=== %s ===\n<%s>\n%s\n</%s>\n' "${kind^^}" "$kind" "$entry" "$kind"
while IFS= read -r line; do
  [[ $line =~ ^[[:space:]]*NOTE: ]] || continue
  printf 'NOTE: the %s'"'"'s text holds a line shaped like this script'"'"'s own notes, which a reader can take for one of them: "%s": it is %s text\n' "$kind" "$line" "$kind"
done <<<"$entry"
printf '=== PICK ===\n'
printf 'NOTE: the user does not see this output, only text you write. The block below opens the message that ends this turn, filling only the {{…}} parts. On a command route it is the whole reply. On the plan route go on to Step 4 now and put it at the top of the fork questions or the final report.%s\n' "${resume:+ $resume}"
printf '**Recommended:** %s\n' "$title"
printf '**Why:** you named it: %s.\n' "$why"
printf '**Route:** {{resume | scaffold | another skill | plan}}. {{for a command route: "Type this to take it:", then its one command alone in a text block}}\n'
printf '=== END ===\n'
