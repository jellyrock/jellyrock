#!/usr/bin/env bash
#
# end-session decision mover: the deterministic mechanics behind trimming a PLAN.md's
# "Last N decisions" list. Shared code: maintained upstream and updated in place. A local edit is
# not overwritten silently; it is reviewed (kept, or taken upstream) at the next update. Keep it
# present in this directory: a SKILL.md that names a co-located script missing from its own dir
# is broken on arrival.
#
# The list keeps the newest N decisions (N is read from the heading, `**Last 5 decisions ...`).
# Every older one MOVES to DECISIONS.md beside the PLAN, newest first, above the entries already
# there; nothing is ever deleted. Together the two files are the project's full decision record,
# and each decision is in exactly one of them. /end-session and /log run this after they add a
# decision to the list.
#
#   - An item is a `- ` line plus any indented lines under it; the list ends at the first blank or
#     other line after its items.
#   - The template's placeholder item (`- YYYY-MM-DD: <decision + why>`) is dropped once a real
#     decision is in the list; it is never moved.
#   - An item already in DECISIONS.md (a run interrupted between its two writes) is not added
#     twice. DECISIONS.md is written first, so an interruption can duplicate but never lose one.
#   - Once DECISIONS.md exists, the heading says where older decisions went.
#   - Before replacing anything the script counts every decision in both files; a mismatch
#     aborts with both files untouched.
#
# PORTABLE AS-IS: plain bash + POSIX awk (tested under gawk and mawk); no slots to fill.
#
# Usage: bash .claude/skills/end-session/move-old-decisions.sh <path/to/PLAN.md>
# Exit 0: done (or nothing to move). Exit 1, nothing written: bad usage, no "Last N decisions"
# heading, an exact duplicate inside the list, or the count check failed.

set -euo pipefail

die() { printf 'move-old-decisions: %s\n' "$1" >&2; exit 1; }

[ $# -eq 1 ] || die "usage: move-old-decisions.sh <path/to/PLAN.md>"
PLAN="$1"
[ -f "$PLAN" ] || die "no such file: $PLAN"
LOG="$(dirname "$PLAN")/DECISIONS.md"
PLACEHOLDER='- YYYY-MM-DD: <decision + why>'
LABEL_TAIL='(newest first, dated; older ones move to `DECISIONS.md`):**'

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
if [ -f "$LOG" ]; then cp "$LOG" "$work/log.old"; else : >"$work/log.old"; fi

# Pass 1 (log.old): collect its items so a moved item already there is not added twice.
# Pass 2 (PLAN): split the list into kept and moved items; write the new PLAN and the moved items.
# Items are joined with \n inside awk; RS-free so gawk and mawk agree.
awk -v placeholder="$PLACEHOLDER" -v newplan="$work/plan.new" -v moved="$work/moved" \
    -v logexists="$([ -f "$LOG" ] && echo 1 || echo 0)" -v label_tail="$LABEL_TAIL" '
  function flush_log() { if (li != "") inlog[li] = 1; li = "" }
  FILENAME == ARGV[1] {
    if ($0 ~ /^- /) { flush_log(); li = $0 }
    else if (li != "" && $0 ~ /^[ \t]+[^ \t]/) li = li "\n" $0
    else flush_log()
    next
  }
  FNR == 1 { flush_log() }
  state == 0 && /^\*\*Last [0-9]+ decisions/ {
    found = 1; n = $0; sub(/^\*\*Last /, "", n); sub(/ .*/, "", n); n = n + 0
    header = $0; state = 1; next
  }
  state == 0 { pre[++npre] = $0; next }
  state == 1 && /^[ \t]*$/ && nitems == 0 { gap[++ngap] = $0; next }
  state == 1 && /^- / { items[++nitems] = $0; next }
  state == 1 && nitems > 0 && /^[ \t]+[^ \t]/ { items[nitems] = items[nitems] "\n" $0; next }
  state == 1 { state = 2 }
  { post[++npost] = $0 }
  END {
    if (!found) exit 4
    if (ngap > 0 && nitems == 0) { for (i = 1; i <= ngap; i++) post2[i] = gap[i]; npost2 = ngap } # no list at all
    for (i = 1; i <= nitems; i++) {
      if (seen[items[i]]++) { printf "duplicate decision in the list: %s\n", items[i] > "/dev/stderr"; exit 3 }
    }
    real = 0
    for (i = 1; i <= nitems; i++) if (items[i] != placeholder) real++
    k = 0
    for (i = 1; i <= nitems; i++) {
      if (items[i] == placeholder && real > 0) continue
      k++
      if (k <= n) keep[++nkeep] = items[i]
      else if (!(items[i] in inlog)) { print items[i] > moved; nmoved++ }
      else ndup++
    }
    if (nmoved > 0 || logexists) {
      if (index(header, "DECISIONS.md") == 0) header = "**Last " n " decisions " label_tail
    }
    for (i = 1; i <= npre; i++) print pre[i] > newplan
    print header > newplan
    for (i = 1; i <= ngap && nitems > 0; i++) print gap[i] > newplan
    for (i = 1; i <= nkeep; i++) print keep[i] > newplan
    for (i = 1; i <= npost2; i++) print post2[i] > newplan
    for (i = 1; i <= npost; i++) print post[i] > newplan
    printf "%d %d\n", nmoved + 0, ndup + 0
  }
' "$work/log.old" "$PLAN" >"$work/counts" || {
  rc=$?
  [ "$rc" = 4 ] && die "no '**Last N decisions' heading in $PLAN"
  [ "$rc" = 3 ] && die "fix the duplicate above in $PLAN, then run again (nothing written)"
  die "awk failed (exit $rc); nothing written"
}
read -r nmoved ndup <"$work/counts"
[ -f "$work/moved" ] || : >"$work/moved"

# The new DECISIONS.md: its existing text with the moved items inserted above its first item
# (newest first), or a new file with a short header.
project="$(basename "$(cd "$(dirname "$PLAN")" && pwd)")"
if [ "$nmoved" -gt 0 ]; then
  if [ -s "$work/log.old" ]; then
    awk -v moved="$work/moved" '
      !done && /^- / { while ((getline l < moved) > 0) print l; done = 1 }
      { print }
      END { if (!done) while ((getline l < moved) > 0) print l }
    ' "$work/log.old" >"$work/log.new"
  else
    {
      printf '# Decisions: %s\n\n' "$project"
      cat <<'HEADER_EOF'
Older decisions, moved here from the decisions list in `PLAN.md` once it passed its size; never
deleted. Newest first. Together with that list, this file is the project's full decision record.

HEADER_EOF
      cat "$work/moved"
    } >"$work/log.new"
  fi
fi

# Count check: every decision before is somewhere after (minus a dropped placeholder).
count_items() { awk '/^- /{c++} END{print c+0}' "$@"; }
list_items() { awk '/^\*\*Last [0-9]+ decisions/{f=1;next} f&&/^- /{c++;next} f&&c>0&&!/^[ \t]+[^ \t]/{exit} END{print c+0}' "$1"; }
list_ph() { awk -v p="$PLACEHOLDER" '/^\*\*Last [0-9]+ decisions/{f=1;next} f&&$0==p{c++} f&&/^- /{n++;next} f&&n>0&&!/^[ \t]+[^ \t]/{exit} END{print c+0}' "$1"; }
before_list="$(list_items "$PLAN")"; before_ph="$(list_ph "$PLAN")"
after_list="$(list_items "$work/plan.new")"; after_ph="$(list_ph "$work/plan.new")"
before_log="$(count_items "$work/log.old")"
if [ -f "$work/log.new" ]; then after_log="$(count_items "$work/log.new")"; else after_log="$before_log"; fi
want=$(( before_list - (before_ph - after_ph) + before_log - ndup ))
got=$(( after_list + after_log ))
[ "$want" -eq "$got" ] || die "count check failed (expected $want decisions after, found $got); nothing written"

# DECISIONS.md first: an interruption between the two writes duplicates, never loses.
# Each file is replaced by a rename from its own directory, so neither is ever half-written.
replace() { cp "$1" "$2.tmp.$$" && mv "$2.tmp.$$" "$2"; }
if [ -f "$work/log.new" ]; then replace "$work/log.new" "$LOG"; fi
# A PLAN without a final newline keeps it that way (awk ends every line with one).
if [ -n "$(tail -c1 "$PLAN")" ]; then printf "%s" "$(cat "$work/plan.new")" >"$work/plan.nonl"; mv "$work/plan.nonl" "$work/plan.new"; fi
cmp -s "$work/plan.new" "$PLAN" || replace "$work/plan.new" "$PLAN"

if [ "$nmoved" -gt 0 ]; then
  printf 'Moved %s decision(s) to %s\n' "$nmoved" "$LOG"
else
  printf 'No decisions to move (%s)\n' "$PLAN"
fi
[ "$ndup" -gt 0 ] && printf 'Already in %s, dropped from the list: %s\n' "$LOG" "$ndup"
exit 0
