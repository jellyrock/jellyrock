#!/usr/bin/env bash
#
# journal.sh — the one tool that reads and writes this repo's followup journal. /log adds, /done
# closes, /catchup lists and counts; the model only picks the category and writes the words, and
# this script does everything that has one right answer: where an entry goes, its markers, the
# date line, the checks, and the path-restricted commit.
# Shared code: maintained upstream and updated in place. A local edit is not overwritten
# silently — it is reviewed (kept, or taken upstream) at the next update.
#
# The format. Under `## Open followups`, each `### Category` holds entries; an entry is a `####`
# heading, then its body up to the next heading. Nothing is numbered, so nothing renumbers:
#
#   #### <title> `[fid: <id>]` `[captured YYYY-MM-DD]` `[prompt: /<command> …]` `[pinned]`
#
#   fid       the entry's identity: lowercase letters, digits and hyphens, at most 64, never
#             reused in this repo (not in the journal now, and never in its history). Refer to an
#             entry by its fid, never by its position. A `[fid: x]` in a body is a reference.
#   captured  the UTC date it was captured; written once, never edited.
#   prompt    optional: the command a future session should open with.
#   pinned    optional: this followup outranks project work when the next move is picked.
# Text between `## Open followups` and the first category, and between a category heading and its
# first entry, is intro and is kept. Headings inside fenced blocks are text, not structure.
#
# Where the journal is. docs/cursor.md with a bold `**Last updated**:` line, unless journal.conf
# beside this script says otherwise (key=value lines, `#` comments):
#   file=<path>               the journal, relative to the repo root
#   date=bold|frontmatter     the date line: `**Last updated**: …` or a frontmatter `last-updated:`
#   commit=yes|no             no: journal writes ride in the commit of the change that prompted them
#   subject=<prefix>          the commit subject prefix for journal writes (default: cursor)
#
# Usage: bash .claude/skills/log/journal.sh <command> …   (run anywhere inside the repo)
#   path                                     print the journal's path
#   list [--tsv]                             every entry: category, fid, captured, age, prompt, title,
#                                            pinned
#   show <fid>                               print one entry
#   stats                                    count and oldest age (days), per category and TOTAL
#   date                                     the date on the journal's date line (YYYY-MM-DD)
#   add --category <c> --fid <f> --title <t> --body-file <p> [--prompt "<command>"] [--pinned]
#                                            append an entry at the end of its category (made if new)
#   replace <fid> [--title <t>] [--body-file <p>] [--pin | --unpin]
#                                            rewrite one entry's title or body, or set or clear its
#                                            pin; its other markers stay
#   close <fid>                              remove the entry, and its category if now empty
#   commit --intent "<words>" [--closes <fid>] [--body-file <p>] [<path>…]
#                                            commit the journal as "<prefix>: <words>"
#   commit --subject "<subject>" [--closes <fid>] [--body-file <p>] <path>…
#                                            commit exactly these paths with this subject
#   check                                    the format gate: every entry has a valid unique fid
#                                            and captured date; nothing numbered outside entries
#   migrate --plan                           the old numbered or `- ` items, one TSV row each,
#                                            dated from git, existing fids kept (fill in the rest)
#   migrate --apply <plan.tsv> [--dry-run]   convert them to entries, using the filled-in plan
# add, replace and close bump the date line, and take [--allow-dirty]: where this repo commits
# journal writes (journal.conf commit=yes, the default), each refuses a journal that already has
# uncommitted edits, which the commit after it would take along; --allow-dirty writes anyway. Exit: 0 done · 1 refused, with the reason · 2 usage or
# setup error. JOURNAL_TODAY=YYYY-MM-DD overrides today's date (tests).

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
die()    { printf 'journal.sh: %s\n' "$*" >&2; exit 2; }
refuse() { printf 'journal.sh: %s\n' "$*" >&2; exit 1; }
usage()  { sed -n '/^# Usage:/,/^# setup error/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 2; }

FILE=docs/cursor.md; DATE=bold; COMMIT=yes; SUBJECT=cursor
conf="$here/journal.conf"
if [ -f "$conf" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"; val="${line#*=}"
    case "$key" in
      file) FILE="$val" ;;
      date) case "$val" in bold|frontmatter) DATE="$val" ;; *) die "journal.conf: date must be bold or frontmatter, not '$val'" ;; esac ;;
      commit) case "$val" in yes|no) COMMIT="$val" ;; *) die "journal.conf: commit must be yes or no, not '$val'" ;; esac ;;
      subject) SUBJECT="$val" ;;
      *) die "journal.conf: unknown key '$key' (known: file, date, commit, subject)" ;;
    esac
  done <"$conf"
fi

top="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository"
J="$top/$FILE"
TODAY="${JOURNAL_TODAY:-$(date -u +%F)}"
[[ $TODAY =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "JOURNAL_TODAY must be YYYY-MM-DD, not '$TODAY'"
FID_RE='^[a-z0-9][a-z0-9-]*$'
DATE_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
MARKER_END_RE='\[(fid|captured|prompt|pinned)[^]]*\]`?[[:space:]]*$'

# The journal intro that came before this script, and its replacement: literal Markdown
# (backticks and all), handed to awk through the environment so nothing reinterprets it.
# shellcheck disable=SC2016,SC2089,SC2090
export OLD_INTRO='> Captured via `/log followup`, closed via `/done`. Group by category (one `### Category` heading per area); number the bullets within each category so `/done` can address them by position. Keep each bullet a self-contained "what + why + where" so a future session can act on it cold.' \
  NEW_INTRO='> Captured via `/log followup`, closed via `/done`, both through `.claude/skills/log/journal.sh`. Group by category (one `### Category` heading per area). Each followup is a `####` heading ending in its `[fid: …]` and `[captured …]` markers, with its body below it; refer to one by its fid, never by its position. Keep each a self-contained "what + why + where" so a future session can act on it cold.'

# --- reading -----------------------------------------------------------------------------------
# The index of the journal, one record per line (tab-separated):
#   E line end category fid captured prompt title pinned   an entry (end: its last line, blanks
#                                                           included; pinned: 1 or empty)
#   C line end entries name                          a category
#   P line message                                   a problem only `check` reports
#   S sections start end                             the Open followups section (last line printed)
# shellcheck disable=SC2016  # awk code, not shell
PARSE_AWK='
function clean(s) { gsub(/\t/, " ", s); return s }
function flush_entry(endl) {
  if (eline) { printf "E\037%d\037%d\037%s\037%s\037%s\037%s\037%s\037%s\n", eline, endl, clean(ecat), efid, ecap, clean(epr), clean(etitle), epin; ncatent++; eline = 0 }
}
function flush_cat(endl) {
  flush_entry(endl)
  if (cline) { printf "C\037%d\037%d\037%d\037%s\n", cline, endl, ncatent, clean(cname); cline = 0 }
}
function heading(h,   t, g) {
  t = substr(h, 6); sub(/[ \t]+$/, "", t)
  efid = ""; ecap = ""; epr = ""; epin = ""
  while (match(t, /[ \t]`?\[(fid|captured|prompt|pinned)[^]`]*\]`?$/)) {
    g = substr(t, RSTART + 1); t = substr(t, 1, RSTART - 1); sub(/[ \t]+$/, "", t)
    sub(/^`?\[/, "", g); sub(/\]`?$/, "", g)
    if (g ~ /^fid/) { sub(/^fid:?[ \t]*/, "", g); efid = g }
    else if (g ~ /^captured/) { sub(/^captured:?[ \t]*/, "", g); ecap = g }
    else if (g ~ /^pinned/) { if (g == "pinned") epin = 1; else printf "P\037%d\037a [pinned] marker takes no value (found [%s])\n", NR, g }
    else { sub(/^prompt:?[ \t]*/, "", g); epr = g }
  }
  etitle = t
}
{
  isfence = ($0 ~ /^[ \t]*(```|~~~)/)
  if (!insec) {
    if (!fence && $0 ~ /^## Open followups[ \t]*$/) { nsec++; if (nsec == 1) { insec = 1; sstart = NR; next } }
    if (isfence) fence = !fence
    next
  }
  if (!fence && $0 ~ /^##?[ \t]/) {
    flush_cat(NR - 1); send = NR - 1; insec = 0
    if ($0 ~ /^## Open followups[ \t]*$/) nsec++
    next
  }
  if (!fence && $0 ~ /^### /) {
    flush_cat(NR - 1); cline = NR; ncatent = 0
    cname = $0; sub(/^### +/, "", cname); sub(/[ \t]+$/, "", cname); next
  }
  if (!fence && $0 ~ /^#### /) {
    flush_entry(NR - 1); eline = NR; ecat = cname; heading($0)
    if (!cline) printf "P\037%d\037an entry before any ### category\n", NR
    next
  }
  if (!eline && !fence && $0 ~ /^[0-9]+\.[ \t]/) printf "P\037%d\037a numbered item outside an entry (migrate it, or make it an entry)\n", NR
  if (isfence) fence = !fence
}
END { if (insec) { flush_cat(NR); send = NR }; printf "S\037%d\037%d\037%d\n", nsec, sstart, send }
'
index_journal() { awk "$PARSE_AWK" "$J"; }

need_journal() { # the journal exists and has exactly one Open followups section
  [ -f "$J" ] || die "no journal at $J (set file= in $conf if it lives elsewhere)"
  IDX="$(index_journal)"
  local n; n="$(awk -F'\037' '$1=="S" { print $2 }' <<<"$IDX")"
  [ "$n" = 1 ] || die "$FILE needs exactly one '## Open followups' section (found ${n:-0})"
}
entry_rec() { awk -F'\037' -v f="$1" '$1=="E" && $5==f "" { print; exit }' <<<"$IDX"; }
line_of()   { sed -n "$1p" "$J"; }
# not_open <fid>: refuse, telling a fid that was closed (it left the journal in some commit) from one
# that never existed
not_open() {
  local last=""
  git -C "$top" ls-files --error-unmatch -- "$FILE" >/dev/null 2>&1 \
    && last="$(git -C "$top" log -1 --format='%h (%cs)' -S"[fid: $1]" -- "$FILE")"
  [ -z "$last" ] || refuse "fid '$1' is not open: it left $FILE in commit $last"
  refuse "no entry with fid '$1' in $FILE"
}
plural()    { if [ "$1" = 1 ]; then printf '%s %s' "$1" "$2"; else printf '%s %s' "$1" "$3"; fi; }

# ages in days, pure arithmetic (no date(1) per entry)
# shellcheck disable=SC2016
AGE_AWK='
function jdn(s,   y, m, d, a) { y = substr(s, 1, 4) + 0; m = substr(s, 6, 2) + 0; d = substr(s, 9, 2) + 0
  a = int((14 - m) / 12); y = y + 4800 - a; m = m + 12 * a - 3
  return d + int((153 * m + 2) / 5) + 365 * y + int(y / 4) - int(y / 100) + int(y / 400) - 32045 }
function age(s) { return (s ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/) ? jdn(today) - jdn(s) : "?" }
'

# --- writing -----------------------------------------------------------------------------------
# replace_lines <from> <to> <file-with-new-lines>: lines from..to (inclusive) become the file's
# lines; from > to inserts before `from`. Written in place, so the file keeps its mode.
replace_lines() {
  local tmp; tmp="$(mktemp)"
  awk -v a="$1" -v b="$2" -v ins="$3" '
    NR == a { while ((getline l < ins) > 0) print l; close(ins) }
    NR >= a && NR <= b { next }
    { print }
    END { if (a > NR) while ((getline l < ins) > 0) print l }' "$J" >"$tmp" && cat "$tmp" >"$J"
  rm -f "$tmp"
}
bump_date() {
  local tmp; tmp="$(mktemp)"
  awk -v mode="$DATE" -v today="$TODAY" '
    function stamp(prefix) { if (!sub(/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/, today)) $0 = prefix today; done = 1 }
    mode == "bold" && !done && /^\*\*Last updated\*\*:/ { stamp("**Last updated**: ") }
    mode == "frontmatter" && NR == 1 && /^---[ \t]*$/ { fm = 1; print; next }
    mode == "frontmatter" && fm && /^---[ \t]*$/ { fm = 0 }
    mode == "frontmatter" && fm && !done && /^last-updated:/ { stamp("last-updated: ") }
    { print }
    END { if (!done) print "NOTE: no date line to bump (date=" mode ")" > "/dev/stderr" }' "$J" >"$tmp" && cat "$tmp" >"$J"
  rm -f "$tmp"
}
# body_ok <file>: no heading line outside a fenced block
body_ok() {
  awk '/^[ \t]*(```|~~~)/ { f = !f; next } !f && /^#+[ \t]/ { bad = 1 } END { exit bad }' "$1"
}
# trimmed <file>: the file without leading or trailing blank lines
trimmed() { awk 'NF { for (; blank > 0; blank--) print ""; started = 1; print; next } started { blank++ }' "$1"; }

# writable <allow-dirty 0|1>: refuse a write that its commit would mix with uncommitted journal
# edits. Never where writes ride with the change (commit=no), nor for a journal git does not track yet.
writable() {
  [ "$COMMIT" = yes ] && [ "$1" = 0 ] || return 0
  git -C "$top" rev-parse -q --verify HEAD >/dev/null || return 0
  git -C "$top" ls-files --error-unmatch -- "$J" >/dev/null 2>&1 || return 0
  git -C "$top" diff --quiet HEAD -- "$J" && return 0
  refuse "$FILE has uncommitted edits, which this write's commit would take along: commit or discard them first, or pass --allow-dirty to write anyway and leave this write uncommitted with them"
}

fid_ok() { # <fid> [--new] : refuse a bad or (with --new) used fid
  local f="$1"
  [[ $f =~ $FID_RE ]] || refuse "fid '$f' must be lowercase letters, digits and hyphens, starting with a letter or digit"
  [ "${#f}" -le 64 ] || refuse "fid '$f' is ${#f} characters; at most 64"
  [ "${2:-}" = --new ] || return 0
  [ -z "$(entry_rec "$f")" ] || refuse "fid '$f' is already in $FILE; pick another"
  if git -C "$top" ls-files --error-unmatch -- "$FILE" >/dev/null 2>&1; then
    local used; used="$(git -C "$top" log --format='%h %cs' -S"[fid: $f]" -- "$FILE" | tail -1)"
    [ -z "$used" ] || refuse "fid '$f' was used before in $FILE (commit $used); fids are never reused, pick another"
  fi
}

# --- commands ----------------------------------------------------------------------------------
cmd="${1:-}"; [ $# -gt 0 ] && shift
case "$cmd" in
  path) printf '%s\n' "$J" ;;

  list)
    tsv=0; [ "${1:-}" = --tsv ] && tsv=1
    need_journal
    awk -F'\037' -v today="$TODAY" -v tsv="$tsv" "$AGE_AWK"'
      $1 != "E" { next }
      tsv { printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", $4, $5, $6, age($6), $7, $8, ($9 ? "pinned" : ""); next }
      $4 != last "" { print $4; last = $4 }
      { printf "  %s  %s  %sd  %s%s%s\n", $5, $6, age($6), $8, ($7 != "" ? "  [prompt: " $7 "]" : ""), ($9 ? "  [pinned]" : "") }' <<<"$IDX"
    ;;

  show)
    [ -n "${1:-}" ] || die "show needs a fid"
    need_journal; rec="$(entry_rec "$1")"; [ -n "$rec" ] || not_open "$1"
    IFS=$'\037' read -r _ a b _ <<<"$rec"
    sed -n "${a},${b}p" "$J" | trimmed /dev/stdin
    ;;

  date)
    [ -f "$J" ] || die "no journal at $J (set file= in $conf if it lives elsewhere)"
    d="$(awk -v mode="$DATE" '
      mode == "bold" && /^\*\*Last updated\*\*:/ { line = $0 }
      mode == "frontmatter" && NR == 1 && /^---[ \t]*$/ { fm = 1; next }
      mode == "frontmatter" && fm && /^---[ \t]*$/ { exit }
      mode == "frontmatter" && fm && /^last-updated:/ { line = $0 }
      line != "" { if (match(line, /[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/)) print substr(line, RSTART, RLENGTH); exit }' "$J")"
    [ -n "$d" ] || refuse "no date line in $FILE (date=$DATE: $([ "$DATE" = bold ] && echo 'a **Last updated**: line' || echo 'a frontmatter last-updated: field'))"
    printf '%s\n' "$d"
    ;;

  stats)
    need_journal
    awk -F'\037' -v today="$TODAY" "$AGE_AWK"'
      $1 != "E" { next }
      !($4 in n) { order[++k] = $4 }
      { a = age($6); n[$4]++; if (a != "?" && (!($4 in old) || a > old[$4])) old[$4] = a; t++; if (a != "?" && a > tot) tot = a }
      END { print "category\tentries\toldest_days"
            for (i = 1; i <= k; i++) printf "%s\t%d\t%s\n", order[i], n[order[i]], old[order[i]]
            printf "TOTAL\t%d\t%d\n", t, tot }' <<<"$IDX"
    ;;

  check)
    [ -f "$J" ] || die "no journal at $J"
    IDX="$(index_journal)"; problems=(); declare -A seen=(); ne=0; nc=0
    IFS=$'\037' read -r _ nsec _ _ < <(awk -F'\037' '$1=="S"' <<<"$IDX")
    [ "$nsec" = 0 ] && problems+=("$FILE: no '## Open followups' section")
    [ "$nsec" -gt 1 ] && problems+=("$FILE: $nsec '## Open followups' sections; there must be one")
    while IFS=$'\037' read -r kind a b c d e _ g _; do
      case "$kind" in
        E) ne=$((ne+1))
           if [ -z "$d" ]; then problems+=("$FILE:$a: no [fid: …] marker on the entry heading")
           elif ! [[ $d =~ $FID_RE ]] || [ "${#d}" -gt 64 ]; then problems+=("$FILE:$a: fid '$d' is not lowercase letters, digits and hyphens (at most 64)")
           elif [ -n "${seen[$d]:-}" ]; then problems+=("$FILE:$a: duplicate fid '$d' (also line ${seen[$d]})")
           else seen[$d]="$a"; fi
           [[ $e =~ $DATE_RE ]] || problems+=("$FILE:$a: no valid [captured YYYY-MM-DD] marker (found '${e}')")
           [ -n "$g" ] || problems+=("$FILE:$a: an entry with no title") ;;
        C) nc=$((nc+1)); [ "$c" = 0 ] && problems+=("$FILE:$a: category '$d' has no entries (remove the heading)") ;;
        P) problems+=("$FILE:$a: $b") ;;
      esac
    done < <(awk -F'\037' '$1!="S"' <<<"$IDX")
    if [ "${#problems[@]}" -gt 0 ]; then printf '%s\n' "${problems[@]}"; refuse "check failed: $(plural "${#problems[@]}" problem problems)"; fi
    echo "check: ok — $(plural "$ne" entry entries) in $(plural "$nc" category categories)"
    ;;

  add)
    category=""; fid=""; title=""; body=""; prompt=""; pinned=0; dirty=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --category) category="${2:-}"; shift 2 ;;
        --fid) fid="${2:-}"; shift 2 ;;
        --title) title="${2-}"; shift 2 ;;
        --body-file) body="${2:-}"; shift 2 ;;
        --prompt) prompt="${2:-}"; shift 2 ;;
        --pinned) pinned=1; shift ;;
        --allow-dirty) dirty=1; shift ;;
        *) die "add: unknown argument '$1'" ;;
      esac
    done
    [ -n "$category" ] || die "add needs --category"; [ -n "$fid" ] || die "add needs --fid"
    [ -n "$body" ] || die "add needs --body-file (use /dev/null for a title-only entry)"
    [ -r "$body" ] || die "add: cannot read --body-file $body"
    [ -n "$title" ] || refuse "add: the title is empty"
    [[ $title == *$'\n'* || $category == *$'\n'* ]] && refuse "add: the title and category must be one line"
    [[ $title =~ $MARKER_END_RE ]] && refuse "add: the title ends in something that reads as a marker ([fid|captured|prompt|pinned …]); reword the title"
    [[ $category == '#'* ]] && refuse "add: the category is its name, without the ### "
    body_ok "$body" || refuse "add: the body has a heading line outside a fenced block; it would split the entry"
    need_journal; writable "$dirty"; fid_ok "$fid" --new
    head="#### $title \`[fid: $fid]\` \`[captured $TODAY]\`"; [ -n "$prompt" ] && head="$head \`[prompt: $prompt]\`"; [ "$pinned" = 1 ] && head="$head \`[pinned]\`"
    new="$(mktemp)"; total="$(wc -l <"$J")"
    crec="$(awk -F'\037' -v c="$category" '$1=="C" && $5==c "" { print; exit }' <<<"$IDX")"
    if [ -n "$crec" ]; then IFS=$'\037' read -r _ from to _ <<<"$crec"
    else IFS=$'\037' read -r _ _ from to < <(awk -F'\037' '$1=="S"' <<<"$IDX"); fi
    last="$(awk -v a="$from" -v b="$to" 'NR >= a && NR <= b && NF { l = NR } END { print l }' "$J")"
    { echo; [ -z "$crec" ] && printf '### %s\n\n' "$category"; printf '%s\n' "$head"
      b="$(trimmed "$body")"; [ -n "$b" ] && printf '\n%s\n' "$b"
      [ "$to" -lt "$total" ] && echo; } >"$new"
    replace_lines "$((last+1))" "$to" "$new"; rm -f "$new"
    bump_date
    echo "added $fid under '$category' in $FILE"
    ;;

  replace)
    fid="${1:-}"; [ -n "$fid" ] || die "replace needs a fid"; shift
    title=""; body=""; have=0; pin=""; dirty=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --title) title="${2-}"; have=1; shift 2 ;;
        --body-file) body="${2:-}"; have=1; shift 2 ;;
        --pin|--unpin) [ -n "$pin" ] && [ "$pin" != "$1" ] && die "replace takes --pin or --unpin, not both"; pin="$1"; have=1; shift ;;
        --allow-dirty) dirty=1; shift ;;
        *) die "replace: unknown argument '$1'" ;;
      esac
    done
    [ "$have" = 1 ] || die "replace needs --title, --body-file, --pin or --unpin"
    need_journal; writable "$dirty"; rec="$(entry_rec "$fid")"; [ -n "$rec" ] || not_open "$fid"
    IFS=$'\037' read -r _ a b _ _ _ _ old _ <<<"$rec"
    heading="$(line_of "$a")"; markers="${heading#"#### $old"}"
    # the pin is always written last: take it out, then put it back unless --unpin
    pinned="$(awk -F'\037' '{ print $9 }' <<<"$rec")"; markers="${markers/ \`\[pinned\]\`/}"
    case "$pin" in --pin) pinned=1 ;; --unpin) pinned="" ;; esac
    [ "$pinned" = 1 ] && markers="$markers \`[pinned]\`"
    if [ -n "$title" ]; then
      [[ $title == *$'\n'* ]] && refuse "replace: the title must be one line"
      [[ $title =~ $MARKER_END_RE ]] && refuse "replace: the title ends in something that reads as a marker; reword it"
    else title="$old"; fi
    heading="#### $title$markers"
    if [ -n "$body" ]; then
      [ -r "$body" ] || die "replace: cannot read --body-file $body"
      body_ok "$body" || refuse "replace: the body has a heading line outside a fenced block"
      text="$(trimmed "$body")"
    else text="$(sed -n "$((a+1)),${b}p" "$J" | trimmed /dev/stdin)"; fi
    new="$(mktemp)"
    { printf '%s\n' "$heading"; [ -n "$text" ] && printf '\n%s\n' "$text"; [ "$b" -lt "$(wc -l <"$J")" ] && echo; } >"$new"
    replace_lines "$a" "$b" "$new"; rm -f "$new"
    bump_date
    echo "replaced $fid in $FILE"
    ;;

  close)
    fid="${1:-}"; [ -n "$fid" ] || die "close needs a fid"; shift; dirty=0
    while [ $# -gt 0 ]; do
      case "$1" in --allow-dirty) dirty=1; shift ;; *) die "close: unknown argument '$1'" ;; esac
    done
    need_journal; writable "$dirty"; rec="$(entry_rec "$fid")"; [ -n "$rec" ] || not_open "$fid"
    IFS=$'\037' read -r _ a b cat _ <<<"$rec"
    crec="$(awk -F'\037' -v c="$cat" '$1=="C" && $5==c "" { print; exit }' <<<"$IDX")"
    IFS=$'\037' read -r _ ca cb cn _ <<<"$crec"
    if [ "${cn:-0}" -le 1 ] && [ -n "$ca" ]; then a="$ca"; b="$cb"; fi
    empty="$(mktemp)"; replace_lines "$a" "$b" "$empty"; rm -f "$empty"
    bump_date
    echo "closed $fid in $FILE"
    ;;

  commit)
    intent=""; subject=""; closes=""; bodyf=""; paths=()
    while [ $# -gt 0 ]; do
      case "$1" in
        --intent) intent="${2:-}"; shift 2 ;;
        --subject) subject="${2:-}"; shift 2 ;;
        --closes) closes="${2:-}"; shift 2 ;;
        --body-file) bodyf="${2:-}"; shift 2 ;;
        --) shift; paths+=("$@"); break ;;
        -*) die "commit: unknown argument '$1'" ;;
        *) paths+=("$1"); shift ;;
      esac
    done
    if [ -n "$intent" ] && [ -n "$subject" ]; then die "commit takes --intent or --subject, not both"; fi
    if [ -n "$intent" ]; then subject="$SUBJECT: $intent"; [ "${#paths[@]}" -gt 0 ] || paths=("$J")
    elif [ -z "$subject" ]; then die "commit needs --intent or --subject"
    elif [ "${#paths[@]}" -eq 0 ]; then die "commit --subject needs the paths to commit"; fi
    if [ -n "$bodyf" ] && [ ! -r "$bodyf" ]; then die "commit: cannot read --body-file $bodyf"; fi
    if [ "$COMMIT" = no ]; then
      echo "not committed: this repo commits journal writes with the change that prompted them (journal.conf: commit=no)"; exit 0
    fi
    for p in "${paths[@]}"; do
      git ls-files --error-unmatch -- "$p" >/dev/null 2>&1 || git add -- "$p" || die "commit: cannot stage $p"
    done
    msg=(-m "$subject"); [ -n "$bodyf" ] && msg+=(-m "$(cat "$bodyf")"); [ -n "$closes" ] && msg+=(-m "Closes fid: $closes")
    if ! out="$(git commit "${msg[@]}" -- "${paths[@]}" 2>&1)"; then
      printf '%s\n' "$out"; refuse "the commit was refused (a hook, most likely): nothing was committed"
    fi
    echo "committed as $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"
    ;;

  migrate)
    # One-time: the old numbered (`N. `) or `- ` items under each category become entries. --plan
    # lists them for a person to give each a fid; --apply converts using that list, refusing
    # anything that would lose or change a word. Nothing numbered is left behind.
    sub="${1:-}"; [ $# -gt 0 ] && shift
    [ -f "$J" ] || die "no journal at $J"
    case "$sub" in
      --plan) planfile="" ;;
      --apply) planfile="${1:-}"; [ -n "$planfile" ] || die "migrate --apply needs the plan file"; shift
               [ -r "$planfile" ] || die "cannot read the plan $planfile" ;;
      *) die "migrate needs --plan or --apply <plan.tsv>" ;;
    esac
    dry=0; [ "${1:-}" = --dry-run ] && dry=1
    res="$(mktemp)"; sum="$(mktemp)"
    PLANFILE="$planfile" SUMFILE="$sum" awk -v mode="${sub#--}" '
      function norm(s) { gsub(/\*\*/, "", s); gsub(/[ \t]+/, " ", s); sub(/^ /, "", s); sub(/ $/, "", s); return s }
      function boldend(s,   i, c, code) {
        for (i = 3; i < length(s); i++) { c = substr(s, i, 1)
          if (c == "`") code = !code
          else if (!code && substr(s, i, 2) == "**") return i }
        return 0 }
      function cut(s, part,   i) { i = index(s, part); return (part == "" || !i) ? s : substr(s, 1, i - 1) substr(s, i + length(part)) }
      function trimblank(arr, cnt, out,   a, b, i, k) {
        a = 1; while (a <= cnt && arr[a] ~ /^[ \t]*$/) a++
        b = cnt; while (b >= a && arr[b] ~ /^[ \t]*$/) b--
        k = 0; for (i = a; i <= b; i++) out[++k] = arr[i]; return k }
      FILENAME == ENVIRON["PLANFILE"] { if (FNR > 1) { split($0, r, "\t"); rows++; pcat[rows] = r[2]; pcap[rows] = r[3]; pfid[rows] = r[4]; ptitle[rows] = r[5] } next }
      { line[++n] = $0 }
      END {
        for (i = 1; i <= n; i++) {
          s = line[i]; isf = (s ~ /^[ \t]*(```|~~~)/)
          if (!insec) {
            if (!fence && !sstart && s ~ /^## Open followups[ \t]*$/) { insec = 1; sstart = i; continue }
            if (isf) fence = !fence
            continue
          }
          if (!fence && s ~ /^##?[ \t]/) { send = i - 1; insec = 0; break }
          if (!fence && s ~ /^### /) { nc++; cn[nc] = s; sub(/^### +/, "", cn[nc]); sub(/[ \t]+$/, "", cn[nc]); cur = 0; continue }
          if (!fence && s ~ /^#### /) { nent++; continue }
          if (nc && !fence && s ~ /^([0-9]+\.|-)[ \t]/ && s !~ /^- \(none\)[ \t]*$/) {
            nit++; ic[nit] = nc; citems[nc]++; match(s, /^([0-9]+\.|-)[ \t]+/); w[nit] = RLENGTH
            first[nit] = substr(s, RLENGTH + 1); raw[nit] = first[nit]; line1[nit] = first[nit]; nb[nit] = 0; cur = nit
            if (isf) fence = !fence
            continue
          }
          if (nc && !cur && s ~ /^[ \t]*(- )?\(none\)[ \t]*$/) continue
          if (cur) {
            t = s
            if (s ~ /^[ \t]/ || s == "") { k = 0; while (k < w[cur] && substr(t, 1, 1) == " ") { t = substr(t, 2); k++ } }
            else if (!fence && !isf) loose[cur] = 1
            b[cur, ++nb[cur]] = t; raw[cur] = raw[cur] " " s
          } else if (nc) ci[nc, ++nci[nc]] = s
          else si[++nsi] = s
          if (isf) fence = !fence
        }
        if (insec) send = n
        if (!sstart) { print "STATUS\tnosection"; exit 3 }
        if (!nit) { print "STATUS\t" (nent ? "already" : "none") "\t" nent; exit 3 }
        if (nent) { print "STATUS\tmixed\t" nent; exit 3 }
        # per item: identity fid and prompt out of the text, then title and body
        for (k = 1; k <= nit; k++) {
          fstr[k] = ""; pstr[k] = ""; fid[k] = ""; pr[k] = ""
          for (j = 0; j <= nb[k]; j++) {
            s = (j ? b[k, j] : first[k])
            if (fstr[k] == "" && match(s, /[ \t]*`?\[fid:[ \t]*[a-z0-9][a-z0-9-]*\]`?[ \t]*$/)) {
              fstr[k] = substr(s, RSTART, RLENGTH); f = fstr[k]; sub(/^[ \t]*`?\[fid:[ \t]*/, "", f); sub(/\]`?[ \t]*$/, "", f); fid[k] = f
              s = substr(s, 1, RSTART - 1)
            }
            if (pstr[k] == "" && match(s, /[ \t]*`?\[prompt\]`?[ \t]+`[^`]+`[ \t]*$/)) {
              pstr[k] = substr(s, RSTART, RLENGTH); p = pstr[k]; sub(/^[ \t]*`?\[prompt\]`?[ \t]+`/, "", p); sub(/`[ \t]*$/, "", p); pr[k] = p
              s = substr(s, 1, RSTART - 1)
            }
            if (j) b[k, j] = s; else first[k] = s
          }
          # a leading [HIGH] or [URGENT] tag, alone in bold or opening the bold lead, is the pin, not
          # the title: it becomes the [pinned] marker, and only the tag leaves the text
          f = first[k]; tag[k] = ""
          if (match(f, /^\*\*\[(HIGH|URGENT)\]\*\*[ \t]+/)) { tag[k] = substr(f, 1, RLENGTH); f = substr(f, RLENGTH + 1) }
          else if (match(f, /^\*\*\[(HIGH|URGENT)\][ \t]+/)) { tag[k] = substr(f, 3, RLENGTH - 2); f = "**" substr(f, RLENGTH + 1) }
          # the title is the bold lead (its closing ** found outside code spans). A lead that ends
          # mid-sentence ("**…**, so …") keeps its whole first line in the body, the title a copy.
          rest = ""; dup[k] = 0
          x = (f ~ /^\*\*/) ? boldend(f) : 0
          if (f ~ /^\*\*/ && x == 0) { print "STATUS\twrap\t" k "\t" f; exit 3 }
          if (x > 3) {
            title[k] = substr(f, 3, x - 3); rest = substr(f, x + 2); sub(/^[ \t]+/, "", rest)
            if (rest ~ /^[,;:)]/) { dup[k] = 1; rest = f }
          } else title[k] = f
          gsub(/\t/, " ", title[k]); sub(/[ \t]+$/, "", title[k])
          m = 0; if (rest != "") tmp[++m] = rest
          for (j = 1; j <= nb[k]; j++) tmp[++m] = b[k, j]
          nbody[k] = trimblank(tmp, m, body1); for (j = 1; j <= nbody[k]; j++) body[k, j] = body1[j]
          delete tmp; delete body1
          note[k] = (loose[k] ? "loose text after it is attached: check it belongs" : "")
          if (dup[k]) note[k] = note[k] (note[k] != "" ? "; " : "") "the bold lead ends mid-sentence: its first line is kept whole in the body"
          if (tag[k] != "") { tn = tag[k]; gsub(/[^A-Z]/, "", tn); note[k] = note[k] (note[k] != "" ? "; " : "") "pinned (from [" tn "])" }
          key[k] = (fid[k] != "" ? "[fid: " fid[k] "]" : substr(line1[k], 1, 50))
        }
        if (mode == "plan") {
          print "STATUS\tok"
          for (k = 1; k <= nit; k++) printf "%d\037%s\037%s\037%s\037%s\037%s\n", k, cn[ic[k]], key[k], fid[k], title[k], note[k]
          exit 0
        }
        # apply: the plan must match the journal item for item, and every word must survive
        if (rows != nit+0) err[++ne] = "the plan has " rows " rows but the journal has " nit " items; re-run --plan"
        for (k = 1; k <= nit && k <= rows; k++) {
          if (pcat[k] != cn[ic[k]] "" || ptitle[k] != title[k] "") err[++ne] = "plan row " k " does not match item " k " (" title[k] "); re-run --plan"
          if (pfid[k] == "") err[++ne] = "plan row " k ": no fid"
          else if (pfid[k] !~ /^[a-z0-9][a-z0-9-]*$/ || length(pfid[k]) > 64) err[++ne] = "plan row " k ": fid " pfid[k] " is not lowercase letters, digits and hyphens (at most 64)"
          else if (pfid[k] in used) err[++ne] = "plan row " k ": fid " pfid[k] " is used twice (also row " used[pfid[k]] ")"
          else used[pfid[k]] = k
          if (pcap[k] !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/) err[++ne] = "plan row " k ": captured " pcap[k] " is not YYYY-MM-DD"
          before = norm(cut(cut(cut(raw[k], fstr[k]), pstr[k]), tag[k]))
          after = (dup[k] ? "" : title[k]); for (j = 1; j <= nbody[k]; j++) after = after " " body[k, j]
          if (norm(after) != before) err[++ne] = "item " k " (" title[k] "): its text would change; fix it by hand, then re-run"
        }
        for (c = 1; c <= nc; c++) if (!citems[c]) { for (j = 1; j <= nci[c]; j++) if (ci[c, j] !~ /^[ \t]*$/) err[++ne] = "category " cn[c] " has intro text but no items; move or remove it first"; dropped = dropped (dropped ? ", " : "") cn[c]; ndrop++ }
        if (ne) { for (e = 1; e <= ne; e++) print "migrate: " err[e]; exit 3 }
        for (i = 1; i < sstart; i++) out[++no] = line[i]
        out[++no] = line[sstart]; out[++no] = ""
        k = trimblank(si, nsi, intro); for (j = 1; j <= k; j++) out[++no] = (intro[j] == ENVIRON["OLD_INTRO"] ? ENVIRON["NEW_INTRO"] : intro[j])
        if (k) out[++no] = ""
        for (c = 1; c <= nc; c++) {
          if (!citems[c]) continue
          out[++no] = "### " cn[c]; out[++no] = ""
          delete cit; for (j = 1; j <= nci[c]; j++) cit[j] = ci[c, j]
          k = trimblank(cit, nci[c], intro); for (j = 1; j <= k; j++) out[++no] = intro[j]
          if (k) out[++no] = ""
          for (it = 1; it <= nit; it++) {
            if (ic[it] != c+0) continue
            h = "#### " title[it] " `[fid: " pfid[it] "]` `[captured " pcap[it] "]`"; if (pr[it] != "") h = h " `[prompt: " pr[it] "]`"; if (tag[it] != "") h = h " `[pinned]`"
            out[++no] = h; out[++no] = ""
            for (j = 1; j <= nbody[it]; j++) out[++no] = body[it, j]
            if (nbody[it]) out[++no] = ""
          }
        }
        if (send == n+0) while (no > 0 && out[no] == "") no--
        for (i = send + 1; i <= n; i++) out[++no] = line[i]
        for (i = 1; i <= no; i++) print out[i]
        printf "migrated %d item%s in %d categor%s", nit, (nit == 1 ? "" : "s"), nc - ndrop, (nc - ndrop == 1 ? "y" : "ies") > ENVIRON["SUMFILE"]
        if (ndrop) printf "; dropped %d empty categor%s: %s", ndrop, (ndrop == 1 ? "y" : "ies"), dropped > ENVIRON["SUMFILE"]
      }' ${planfile:+"$planfile"} "$J" >"$res"
    rc=$?
    if [ "$rc" = 3 ]; then
      st="$(head -1 "$res")"
      case "$st" in
        STATUS$'\t'already*) rm -f "$res" "$sum"; refuse "$FILE is already migrated (${st##*$'\t'} entries, no old items)" ;;
        STATUS$'\t'none*) rm -f "$res" "$sum"; refuse "$FILE has no old items to migrate" ;;
        STATUS$'\t'mixed*) rm -f "$res" "$sum"; refuse "$FILE mixes entries and old items; convert the rest by hand" ;;
        STATUS$'\t'nosection*) rm -f "$res" "$sum"; die "$FILE has no '## Open followups' section" ;;
        STATUS$'\t'wrap*) IFS=$'\t' read -r _ _ wk wl <<<"$st"; rm -f "$res" "$sum"; refuse "migrate: item $wk opens a bold lead that wraps onto the next line (\"$wl\"); put the lead on one line, or shorten it, by hand, then re-run" ;;
        *) cat "$res"; rm -f "$res" "$sum"; refuse "migrate --apply refused: nothing was changed" ;;
      esac
    fi
    [ "$rc" = 0 ] || { rm -f "$res" "$sum"; die "migrate failed (awk exit $rc)"; }
    if [ "$sub" = --plan ]; then
      tracked=0; git -C "$top" ls-files --error-unmatch -- "$FILE" >/dev/null 2>&1 && tracked=1
      printf 'n\tcategory\tcaptured\tfid\ttitle\tnote\n'
      tail -n +2 "$res" | while IFS=$'\037' read -r k c key f t nt; do
        d=""; [ "$tracked" = 1 ] && d="$(git -C "$top" log --reverse --format=%cs -S"$key" -- "$FILE" | head -1)"
        [ -n "$d" ] || nt="${nt:+$nt; }no date found in git: fill in captured"
        printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$k" "$c" "$d" "$f" "$t" "$nt"
      done
      rm -f "$res" "$sum"; exit 0
    fi
    if [ "$dry" = 1 ]; then cat "$res"; { cat "$sum"; echo " (dry run: nothing written)"; } >&2
    else cat "$res" >"$J"; bump_date; cat "$sum"; echo; fi
    rm -f "$res" "$sum"
    ;;

  *) usage ;;
esac
