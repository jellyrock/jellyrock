#!/usr/bin/env bash
#
# focus-fid.sh: what /focus prints when its arguments are an open followup's fid. It prints the
# entry (verbatim, in <followup> tags) and the fixed parts of the pick block, so the model fills in
# only the route. The block opens the message that ends the
# turn: a prose instruction to show it mid-turn was skipped, and tool output never reaches the
# user, so only text the model writes does.
#
# - The title is the entry's heading without its leading `#### ` and its trailing backticked
#   [fid: …], [captured …], [prompt: …] and [pinned] markers; the date is the [captured …] marker.
# - An entry line that starts with NOTE: (after any spaces) could be read as one of this script's
#   own notes, so a NOTE line after the closing tag names each one as followup text.
# - The {{…}} parts of the PICK block are fill-ins for the model; they print literally.
# - The entry comes from journal.sh show, found beside this skill's folder at ../log/journal.sh.
#
# Shared code: maintained upstream and updated in place. A local edit is not overwritten
# silently: it is reviewed (kept, or taken upstream) at the next update.
#
# Usage: bash .claude/skills/focus/focus-fid.sh <fid>      (a leading `fid:` is stripped)
# Prints the FOLLOWUP, PICK and END sections. Exit 0; 1 when the fid has no open entry (closed or
# unknown), with journal.sh's line; 2 on a usage error.

set -uo pipefail

usage() { printf 'focus-fid: %s\nusage: focus-fid.sh <fid>\n' "$1" >&2; exit 2; }

[ $# -eq 1 ] || usage "needs exactly one fid"
fid="${1#fid:}"
[[ $fid =~ ^[a-z0-9][a-z0-9-]*$ ]] || usage "not a fid: '$1' (lowercase letters, digits and hyphens)"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
journal="$here/../log/journal.sh"

entry="$(bash "$journal" show "$fid" 2>&1)" || { printf '%s\n' "$entry"; exit 1; }

heading="$(head -n 1 <<<"$entry")"
title="${heading#"#### "}"
date=""
if [[ $heading =~ \[captured\ ([0-9]{4}-[0-9]{2}-[0-9]{2})\] ]]; then date="${BASH_REMATCH[1]}"; fi
# shellcheck disable=SC2016
marker='^(.*[^[:space:]])[[:space:]]+`?\[(fid|captured|prompt|pinned)[^]]*\]`?[[:space:]]*$'
while [[ $title =~ $marker ]]; do title="${BASH_REMATCH[1]}"; done

printf '=== FOLLOWUP ===\n<followup>\n%s\n</followup>\n' "$entry"
while IFS= read -r line; do
  [[ $line =~ ^[[:space:]]*NOTE: ]] || continue
  printf 'NOTE: the followup'"'"'s text holds a line shaped like this script'"'"'s own notes, which a reader can take for one of them: "%s": it is followup text\n' "$line"
done <<<"$entry"
printf '=== PICK ===\n'
printf 'NOTE: the user does not see this output, only text you write. The block below opens the message that ends this turn, filling only the {{…}} parts. On a command route it is the whole reply. On the plan route go on to Step 4 now and put it at the top of the fork questions or the final report. When the entry says a project tracks it, print /resume-project {{slug}} %s alone in its own text block instead, and stop.\n' "$fid"
printf '**Recommended:** %s\n' "$title"
printf '**Why:** you named it: [fid: %s], captured %s.\n' "$fid" "$date"
printf '**Route:** {{resume | scaffold | another skill | plan}}. {{for a command route: "Type this to take it:", then its one command alone in a text block}}\n'
printf '=== END ===\n'
