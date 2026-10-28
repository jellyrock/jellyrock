#!/usr/bin/env bash
#
# resume-state.sh — the one read /resume-project makes. It picks the project, records this
# session's claim on it, prints the PLAN sections a resume needs in full (Status, the open
# punch-list, the kickoff, the last session-log entry), resolves what the project waits on, says
# the open messages other repos left about it when this machine keeps a mailbox, names the files another worktree of the repo has also changed (overlap.sh),
# and runs the continuity checks and the PLAN check, so the model orients
# instead of gathering. Sections are labeled `=== NAME ===` and read top to bottom; text copied from the PLAN, git or the operator's
# words sits inside an XML tag (`<kickoff>`…`</kickoff>`), so it reads as data, never as this
# script's own BANNER, NOTE or ERROR lines, which stay outside every tag. The same PLAN check, run by /end-session before it
# commits (--check), is the gate that keeps a kickoff from contradicting its own Status.
# Shared code: maintained upstream and updated in place. A local edit is not overwritten
# silently — it is reviewed (kept, or taken upstream) at the next update.
#
# Why not read the whole PLAN: a long-running project's PLAN grows past 100KB (its session log and
# Status), and a whole read either costs tens of thousands of tokens or is cut off.
#
# Rules this script keeps:
#   - A section it cannot find prints an ERROR line; it is never left out silently, since silence
#     reads as "checked and fine".
#   - At a resume, findings are BANNER lines: advice the skill reports and the operator decides on.
#     Nothing gates a resume. Only --check exits non-zero on a finding, for the writer to fix.
#   - A PLAN the check cannot read (no phase id, no phase marks, a kickoff older than the skeleton)
#     gets a NOTE, never a failure at a resume.
#   - Heading-like lines inside the frontmatter or a fenced code block are not headings (CommonMark
#     fences; the same rule as /end-session's replace-section.sh).
#   - Status and the kickoff are printed word for word: they are the prompt, not a summary.
#   - Copied PLAN text is never altered, but a printed line (Status, the open punch-list, the
#     kickoff, the last session-log entry; fenced code aside) that starts like this script's own
#     findings (BANNER:, NOTE:, ERROR:, FAIL:, REVIEW:, WARN:, after an indent, list marker or
#     checkbox) is itself a PLAN check finding: it reads as a live check, so it is named outside
#     the tags, and --check fails it for the writer to reword.
#   - It writes only its claim, outside the repo (under $XDG_STATE_HOME/project-claims): no project
#     state, no commits. /end-session owns project state. A resume fetches the branch's remote
#     first (remote-tracking refs only, under a timeout, RESUME_FETCH_SECONDS, default 10), unlike
#     /sonnet's reader: it loads the PLAN a session works from, and a checkout behind
#     its remote loads an old one. No timeout command, or a failed fetch: a NOTE, then the last fetch.
#
# Usage (from inside the repo):
#   bash .claude/skills/resume-project/resume-state.sh [<slug> [<starting point>…]]
#       the resume read. <slug> is a project's short slug (hub) or its whole folder name (2026-10-hub), which picks that folder alone. Words after the slug are where this session starts instead of the
#       kickoff's Starts at: one open followup's fid (optionally fid:<fid>), or one open work request
#       part's id naming this repo (optionally request:<id>), is shown in full; an id that is both is
#       said, to ask which; anything else is the operator's words.
#   … --check [<slug>]     the PLAN check alone: FAIL lines exit 1; REVIEW lines ask the writer to
#                          justify something (a landmine dropped since the last commit); NOTEs inform
#   … --release [<slug>]   remove this session's claim (another session's is left alone). Like a
#                          resume, it acts on the project's worktree when run in the main checkout
#   … --holder [<slug>]    which session holds the project; only reads (a sub-agent asks as its
#                          parent session, so "this session" means /end-session will close it)
#   … --waits <PLAN path>  only what that PLAN waits on, resolved (for other readers)
#   … --waits-list        wait values from stdin, one line `<id><TAB><waits value>` each, resolved the
#                          same way; one line back each:
#                          `<id><TAB>free|held|recheck|unchecked|broken<TAB><detail>`
#                          (free: every wait met; recheck: only waits no script can check are left and
#                          every after: re-check date has passed; unchecked: a wait no script can check
#                          and no after: date; broken: a wait names nothing found or an abandoned
#                          project; needs no PLAN or projects folder; for other readers: /catchup)
#   … --plan-check <PLAN path>  only the PLAN check, as a resume shows it: BANNER lines for a
#                          contradiction, NOTEs, else ok; exit 0 (for other readers: /catchup)
#   … --section <name> <slug>  only that PLAN section (the heading after its emoji starts with
#                          <name>, case ignored), inside a `<plan_section>` tag, or the ERROR line
#                          when the PLAN has none; the project is picked as a resume picks it, but
#                          nothing is claimed, fetched or written (for other readers: /focus)
#   … --claims             every claim on this machine an open tab holds, one tab-separated line
#                          each: the PLAN's path, the tab's name, and busy, idle <n> min or this
#                          session; only reads, and needs no repo (for other readers: /focus-all)
# WAITS_NOW=<time>: the clock the after: waits read instead of now (any time date -u -d reads; for
# tests and dry runs). A value date cannot read is an ERROR and exit 2.
# Exit: 0 done (a resume: a project was picked and every section printed; --holder: this session
# holds it); 1 --check found a FAIL, or --holder: another session or none holds it; 2 no project could be picked (none active, several active, a slug matching none or several,
# no projects folder, not a git repo: the SELECTION lines say which; --section with no name or no slug: a usage ERROR; --check run by a Verify first command: an ERROR); 3 the picked PLAN cannot be
# read.
#
# Claims: a session is known by CLAUDE_CODE_SESSION_ID and CLAUDE_PID, which every command a
# Claude Code session runs carries, and ~/.claude/sessions/<pid>.json (CLAIMS_SESSIONS_DIR in
# tests), which holds its tab name and busy/idle. A holder idle 55 minutes or more is taken for an
# abandoned tab: an agent waiting on its own work wakes well within that, so a watcher never
# looks that idle. A claim is advice: a resume always proceeds.

set -uo pipefail # not -e: one failed section must not stop the rest

mode=resume
case "${1:-}" in --check) mode=check; shift ;; --release) mode=release; shift ;; --holder) mode=holder; shift ;; --claims) mode=claims; shift ;; --waits) mode=waits; shift ;; --waits-list) mode=waitslist; shift ;; --plan-check) mode=plancheck; shift ;;
  --section) mode=section; shift; secname="${1:-}"; [ $# -gt 0 ] && shift
    [ -n "$secname" ] && [ -n "${1:-}" ] || { echo "ERROR: usage: resume-state.sh --section <name> <slug>"; exit 2; } ;;
esac
# A Verify first command that runs --check again would recurse without end: verify_first marks its commands.
[ "$mode" = check ] && [ -n "${RESUME_STATE_IN_CHECK:-}" ] && { echo "ERROR: a Verify first command runs the PLAN check itself"; exit 2; }
slug="${1:-}"; [ $# -gt 0 ] && shift
start_words=("$@") # kept as given: a redirect passes them on
start="$*"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
journal="$here/../log/journal.sh"
if [ -n "${WAITS_NOW:-}" ] && ! date -u -d "$WAITS_NOW" +%s >/dev/null 2>&1; then
  echo "ERROR: WAITS_NOW is not a time date can read"; exit 2
fi
WARM_MINUTES=55
RELAUNCH_QUIET_S=10 # a launch settles to idle within about a second (seen: 186 ms); 10 s leaves wide margin

section() { printf '\n=== %s ===\n' "$1"; }

# MD_LIB: the awk function md_skip, the one rule for what is not a heading (frontmatter, CommonMark
# fenced code), read from the log skill's md-skip.awk, which every script that reads headings shares.
[ -r "$here/../log/md-skip.awk" ] || { echo "resume-state: cannot read $here/../log/md-skip.awk: the log skill is incomplete" >&2; exit 1; }
MD_LIB="$(cat "$here/../log/md-skip.awk")"$'\n'

# frontmatter <file> <field> -> the field's first word, read from the leading --- block only
frontmatter() {
  awk -v f="$2" 'NR==1 && $0!="---" { exit } NR>1 && $0=="---" { exit } NR>1 && $1==f":" { print $2; exit }' "$1"
}

# plan_section <file> <name> -> every `## ` section whose heading, after its leading emoji, starts
# with <name> (case ignored), heading line included. The words are the contract; the emoji varies.
plan_section() {
  awk -v want="$2" "$MD_LIB"'
    { s = md_skip($0, 1) }
    !s && /^## / { h=$0; sub(/^## /, "", h); sub(/^[^A-Za-z]*/, "", h)
             inside=(index(tolower(h), tolower(want))==1) }
    !s && /^# / { inside=0 }
    inside { print }' "$1"
}

# punch_open_items <Punch-list section on stdin> -> what the resume prints of it: each open item,
# under its ### heading
punch_open_items() {
  awk "$MD_LIB"'{ s = md_skip($0, 0) } !s && /^### / { h=$0; next } !s && /^- \[ \]/ { if (h!="") { print h; h="" } print }'
}

# last_log_entry <Session log section on stdin> -> its last entry, with the indented lines after it
last_log_entry() {
  awk "$MD_LIB"'{ s = md_skip($0, 0) } s { if (/^[ \t]+[^ \t]/ && e!="") e=e "\n" $0; next } /^- / { e=$0; next } /^[ \t]+[^ \t]/ && e!="" { e=e "\n" $0; next } END { if (e!="") print e }'
}

# log_order_break <Session log section on stdin> -> "<date> <date>" for the first dated top-level
# entry that is earlier than one before it (the entry's date, then the latest date before it), else
# nothing. A date is YYYY-MM-DD right after `- `, optionally inside `**`; other entries are skipped.
log_order_break() {
  awk "$MD_LIB"'{ s = md_skip($0, 0) } s { next }
    /^- / { l=substr($0, 3); sub(/^\*\*/, "", l)
      if (!match(l, /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/)) next
      d=substr(l, 1, 10)
      if (mx != "" && d < mx) { print d " " mx; exit }
      if (mx == "" || d > mx) mx=d }'
}

# shaped_lines <text on stdin> -> each line (outside fenced code) that starts, after its indent, an
# optional list marker and an optional checkbox, with a prefix this script's own findings use
shaped_lines() {
  awk "$MD_LIB"'{ s = md_skip($0, 0) } s { next }
    { t = $0; sub(/^[ \t]+/, "", t); sub(/^([-*+]|[0-9]+\.)[ \t]+/, "", t); sub(/^\[[ xX]\][ \t]+/, "", t)
      if (t ~ /^(BANNER|NOTE|ERROR|FAIL|REVIEW|WARN):/) print }'
}

# tagged <tag> <text>: the text between a <tag> line and a </tag> line
tagged() { printf '<%s>\n%s\n</%s>\n' "$1" "$2" "$1"; }

# print_section <file> <name> <tag>: the section in full inside its tag, or an ERROR line naming it
print_section() {
  local body; body="$(plan_section "$1" "$2")"
  if [ -n "$body" ]; then tagged "$3" "$body"
  else echo "ERROR: no \"$2\" section — renamed? read it from the PLAN by its heading"; fi
}

# names_slug <slug>: stdin lines whose text names the slug as a whole word
names_slug() { grep -E -- "(^|[^a-z0-9-])$1(\$|[^a-z0-9-])" || true; }

# field_value <file> <field> -> the whole frontmatter value, its `# comment` and spaces dropped
field_value() {
  awk -v f="$2" 'NR==1 && $0!="---" { exit } NR>1 && $0=="---" { exit }
    NR>1 && $1==f":" "" { v=$0; sub(/^[^:]*:/, "", v); sub(/[ \t]+#.*$/, "", v); sub(/^#.*$/, "", v)
      gsub(/^[ \t]+|[ \t]+$/, "", v); print v; exit }' "$1"
}

# phase_id <text> -> the phase id the text starts with (A, C1, 3, 3d; after an optional "Phase "), or
# nothing when it starts with anything else ("ALL FOUR PHASES SHIP" has none)
phase_id() {
  local t="$1"; t="${t#"${t%%[![:space:]*]*}"}"; t="${t#Phase }"; t="${t#phase }"
  if [[ "$t" =~ ^([A-Z][0-9]?|[0-9]+[a-z]?)([^A-Za-z0-9]|$) ]]; then printf '%s' "${BASH_REMATCH[1]}"; fi
}

# phase_marks <Status text on stdin> -> "id<TAB>mark" for each Phase progress line, the mark being
# the first of ✅ 🚧 ⬜ on the line (later text may mention another)
phase_marks() {
  awk "$MD_LIB"'{ s = md_skip($0, 0) } s { next }
    /^\*\*Phase progress/ { p=1; next } p && (/^\*\*/ || /^## /) { p=0 }
    p && /^- / { l=substr($0, 3); sub(/^[Pp]hase /, "", l)
      if (!match(l, /^([A-Z][0-9]?|[0-9]+[a-z]?)/)) next
      id=substr(l, 1, RLENGTH); if (substr(l, RLENGTH+1, 1) ~ /[A-Za-z0-9]/) next
      m=""; best=0; n=split("✅ 🚧 ⬜", M, " ")
      for (i=1; i<=n; i++) { k=index(l, M[i]); if (k > 0 && (best == 0+0 || k < best+0)) { best=k; m=M[i] } }
      print id "\t" m }'
}

# bold_value <text on stdin> <label> -> what follows the first `**<label>:**` line
bold_value() { awk -v l="**$1:**" 'index($0, l)==1 { v=substr($0, length(l)+1); sub(/^[ \t]+/, "", v); print v; exit }'; }

# sub_section <text on stdin> <### heading> -> the lines under that ### heading, up to the next
sub_section() { awk -v h="### $1" "$MD_LIB"'{ s = md_skip($0, 0) } !s && /^### / { p=(index($0, h)==1); next } !s && /^## / { p=0 } p'; }

# landmine_keys <kickoff text on stdin> -> one key per Landmines bullet: its bold lead when it has
# one, else its first 60 characters (so an edited explanation is not a dropped landmine)
landmine_keys() {
  sub_section "Landmines" | awk "$MD_LIB"'{ s = md_skip($0, 0) } !s && /^- / { l=substr($0, 3)
    if (substr(l, 1, 2) == "**" "") { k=substr(l, 3); e=index(k, "**"); if (e > 0+0) { print substr(k, 1, e-1); next } }
    if (substr(l, 1, 1) != "<" "") print substr(l, 1, 60) }'
}

# plan_check <plan> <resume|check>: the PLAN's own consistency. Prints FAIL/REVIEW/NOTE lines
# (check) or BANNER/NOTE lines (resume); returns the number of FAILs.
plan_check() {
  local plan="$1" how="$2" st kick status cur sa starts marks cm allok n=0 prev rel k
  local -a out=()
  fail() { n=$((n+1)); if [ "$how" = check ]; then out+=("FAIL: $1"); else out+=("BANNER: PLAN check: $1"); fi; }
  note() { out+=("NOTE: $1"); }
  # The writer's gate runs each Verify first command from the repo and compares its one printed
  # line with the backticked value: a value written before its command ran is caught here, not at
  # the next resume. A resume never runs one. The value is a code span: a value whose text holds a
  # backtick is written in double backticks.
  verify_first() {
    local line="$1" cmd val got rc lines t="${RESUME_VERIFY_TIMEOUT:-60}"
    # A value holding a backtick is a double-backtick code span (CommonMark): it ends at the first
    # run of exactly two, and one space is stripped from each end when both ends have one.
    local dbl=0 hint=""
    if [[ "$line" =~ ^-\ \`([^\`]+)\`\ prints\ \`\`(([^\`]|\`[^\`])*)\`\`([^\`]|$) ]]; then
      dbl=1; val="${BASH_REMATCH[2]}"
      [[ "$val" == " "*" " && "$val" == *[!\ ]* ]] && { val="${val# }"; val="${val% }"; }
    elif [[ "$line" =~ ^-\ \`([^\`]+)\`\ prints\ \`([^\`]*)\` ]]; then val="${BASH_REMATCH[2]}"
    else fail "a Verify first value is not in backticks (write \`command\` prints \`what it printed\`): $line"; return; fi
    cmd="${BASH_REMATCH[1]}"
    if command -v timeout >/dev/null; then got="$(RESUME_STATE_IN_CHECK=1 timeout "$t" bash -c "$cmd" 2>&1)"; rc=$?
    else got="$(RESUME_STATE_IN_CHECK=1 bash -c "$cmd" 2>&1)"; rc=$?; fi
    [ "$rc" = 124 ] && { fail "Verify first: \`$cmd\` did not finish in ${t}s"; return; }
    lines="$(grep -c '' <<<"$got")"; got="${got%"${got##*[![:space:]]}"}"
    if [ "$lines" -gt 1 ]; then fail "Verify first: \`$cmd\` printed $lines lines: narrow it to the one line the value is"
    elif [ "$got" != "$val" ]; then
      [ "$dbl" = 0 ] && [[ "$got" == *\`* ]] && hint="; the output holds a backtick: write the value in double backticks (\`\` … \`\`)"
      fail "Verify first: \`$cmd\` printed \`$got\`, the kickoff says \`$val\`$hint"
    fi
  }
  st="$(frontmatter "$plan" status)"
  if [ "$st" = completed ] || [ "$st" = abandoned ]; then
    note "status is $st: the kickoff and phase rules do not apply"; printf '%s\n' "${out[@]}"; return 0
  fi
  kick="$(plan_section "$plan" "Next-session kickoff")"; status="$(plan_section "$plan" "Status")"
  starts="$(bold_value "Starts at" <<<"$kick")"
  local has_starts=0; grep -q '^\*\*Starts at:\*\*' <<<"$kick" && has_starts=1
  if [ "$has_starts" = 0 ] && [ "$how" = resume ]; then
    note "the kickoff predates the skeleton (no **Starts at:** line): read it as prose; /end-session rewrites it"
  else
    [ "$has_starts" = 1 ] || fail "the kickoff has no **Starts at:** line (write the kickoff in the template's skeleton)"
    grep -q '^\*\*Last session stopped:\*\*' <<<"$kick" || fail "the kickoff has no **Last session stopped:** line"
    grep -q '^\*\*Unanswered:\*\*' <<<"$kick" || fail "the kickoff has no **Unanswered:** line"
    grep -q '^[0-9][0-9]*\. ' <<<"$(sub_section "Next, in order" <<<"$kick")" \
      || fail "the kickoff has no ### Next, in order section with a numbered step"
    while IFS= read -r k; do
      [[ "$k" =~ ^-\ \`[^\`]+\`\ prints\ .+ ]] || { fail "a Verify first line is not \`command\` prints \`value\`: $k"; continue; }
      [ "$how" = check ] && verify_first "$k"
    done < <(sub_section "Verify first" <<<"$kick" | grep '^- ')
  fi
  cur="$(phase_id "$(bold_value "Current phase" <<<"$status")")"
  marks="$(phase_marks <<<"$status")"
  if [ -z "$cur" ]; then note "no phase id at the start of Status's Current phase: the phase checks are skipped"
  elif [ -z "$marks" ]; then note "no Phase progress marks in Status: the phase checks are skipped"
  else
    cm="$(awk -F'\t' -v c="$cur" '$1 == c "" { print $2; exit }' <<<"$marks")"
    allok=1; awk -F'\t' '$2 != "✅" "" { bad=1 } END { exit bad }' <<<"$marks" || allok=0
    if ! awk -F'\t' -v c="$cur" '$1 == c "" { f=1 } END { exit !f }' <<<"$marks"; then
      fail "Current phase $cur is not in Phase progress"
    elif [ "$allok" = 1 ]; then fail "every phase is ✅: close the project (status completed) or add the next phase"
    elif [ "$cm" = "✅" ]; then fail "Current phase $cur is marked ✅"; fi
  fi
  if [ "$has_starts" = 1 ]; then
    sa="$(phase_id "$starts")"
    if [ -z "$starts" ]; then fail "the kickoff's **Starts at:** line is empty"
    elif [ -z "$sa" ]; then note "no phase id at the start of the kickoff's Starts at: not compared with Status"
    elif [ -n "$cur" ] && [ "$sa" != "$cur" ]; then fail "the kickoff starts at $sa, but Status's Current phase is $cur"; fi
  fi
  # A resume prints these sections word for word, so a PLAN line shaped like this script's own
  # findings (BANNER:, NOTE:, …) reads as a live check. Name each one here, outside the tags.
  local lbl sec l
  for lbl in "Status" "the open punch-list" "the kickoff" "the last session-log entry"; do
    case "$lbl" in
      Status) sec="$status" ;;
      "the open punch-list") sec="$(plan_section "$plan" "Punch-list" | punch_open_items)" ;;
      "the kickoff") sec="$kick" ;;
      *) sec="$(plan_section "$plan" "Session log" | last_log_entry)" ;;
    esac
    while IFS= read -r l; do
      l="${l#"${l%%[![:space:]]*}"}"; [ "${#l}" -gt 100 ] && l="${l:0:100}…"
      fail "$lbl holds a line shaped like this script's own findings, which a reader can take for a live check — it is PLAN text: \"$l\""
    done < <(shaped_lines <<<"$sec")
  done
  # The reader shows the last Session log entry, so the log must be oldest first. A resume only
  # notes it (a banner would become a ranked candidate in /catchup); /end-session's --check fails it.
  local ob; ob="$(plan_section "$plan" "Session log" | log_order_break)"
  if [ -n "$ob" ]; then
    ob="the Session log is not oldest first (an entry dated ${ob% *} follows one dated ${ob#* }): put the entries in date order, newest at the bottom, where /end-session adds them"
    if [ "$how" = check ]; then fail "$ob"; else note "$ob"; fi
  fi
  if [ "$how" = check ]; then
    rel="$(git -C "$(dirname "$plan")" ls-files --full-name -- "$(basename "$plan")" 2>/dev/null)"
    if [ -n "$rel" ] && prev="$(git -C "$(dirname "$plan")" show "HEAD:$rel" 2>/dev/null)"; then
      local pk; pk="$(awk "$MD_LIB"'{ s = md_skip($0, 1) } !s && /^## /{ h=$0; sub(/^## /, "", h); sub(/^[^A-Za-z]*/, "", h); p=(index(tolower(h), "next-session kickoff")==1) } !s && /^# /{ p=0 } p' <<<"$prev")"
      while IFS= read -r k; do
        [ -n "$k" ] && out+=("REVIEW: landmine dropped since the last commit: $k (say in the session log why it stopped being true)")
      done < <(grep -vxF -f <(landmine_keys <<<"$kick"; echo) <(landmine_keys <<<"$pk"))
    else note "the PLAN is not committed: a landmine dropped since the last close cannot be listed"; fi
    local sb; sb="$(wc -c <<<"$status")"
    [ "$sb" -gt 15000 ] && out+=("REVIEW: Status is $((sb/1000))KB: trim it to live state (detail to Reference, the story to the Session log)")
  fi
  [ "${#out[@]}" -gt 0 ] && printf '%s\n' "${out[@]}"
  return "$n"
}

# now_epoch: the clock in seconds, UTC. WAITS_NOW (checked once at the top) stands in for it when set.
now_epoch() { if [ -n "${WAITS_NOW:-}" ]; then date -u -d "$WAITS_NOW" +%s; else date -u +%s; fi; }

# resolve_project <ref> <slug[:phase]> <folder>: one project wait resolved in <folder> (a projects
# folder, local or another repo's), one line printed that names the whole reference. Returns as
# resolve_wait does.
resolve_project() {
  local r="$1" s ph p pst mk x folder="$3"
  s="${2%%:*}"; ph=""; [ "$s" != "$2" ] && ph="${2#*:}"
  if [ -z "$folder" ] || [ ! -d "$folder" ]; then echo "UNKNOWN: $r (no projects folder here)"; return 2; fi
  p=""; for x in "$folder"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-"$s"/PLAN.md "$folder"/_archive/[0-9][0-9][0-9][0-9]-[0-9][0-9]-"$s"/PLAN.md; do
    [ -f "$x" ] && { p="$x"; break; }; done
  if [ -z "$p" ]; then echo "UNKNOWN: $r (no such project here, active or archived)"; return 2; fi
  pst="$(frontmatter "$p" status)"
  if [ "$pst" = abandoned ]; then echo "ENDED: $r (abandoned: this wait will never be met — drop or replace it)"; return 3
  elif [[ "$p" == "$folder"/_archive/* ]]; then echo "met: $r (archived)"; return 0
  elif [ "$pst" = completed ]; then echo "met: $r (completed)"; return 0
  elif [ -z "$ph" ]; then echo "waiting: $r (${pst:-no status})"; return 1
  fi
  mk="$(plan_section "$p" "Status" | phase_marks | awk -F'\t' -v c="$ph" '$1 == c "" && !f { print ($2 == "" "" ? "no mark" : $2); f=1 } END { if (!f) print "?" }')"
  if [ "$mk" = "?" ]; then echo "UNKNOWN: $r (no phase $ph in $s's Phase progress)"; return 2
  elif [ "$mk" = "✅" ]; then echo "met: $r (✅)"; return 0
  else echo "waiting: $r ($mk)"; return 1; fi
}

# resolve_wait <ref>: one wait reference resolved, one line printed. A reference: after:<time> (met
# once that time passes), <slug> (met when completed or archived), <slug>:<phase> (met when that
# phase is ✅), fid:<id> (met when the followup is closed), <owner>/<name>/<slug>[:<phase>] (another
# repo's project, read where projects-dir.sh --repo finds its projects), <repo>/<slug> (another
# repo's project, not checkable here). Returns 0 met, 1 waiting, 2 unknown (names nothing found),
# 3 ended (abandoned: never met), 4 not checkable here (only a person, an outside event or a repo
# this machine keeps no projects of can say).
resolve_wait() {
  local r="$1" v e t o rest nm sp pout prc msg
  local date_re='^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  local time_re='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?(Z|[+-][0-9]{2}:[0-9]{2})$'
  case "$r" in
    after:*)
      v="${r#after:}"; t=""
      if [[ "$v" =~ $date_re ]]; then t="$v 00:00:00 UTC"; elif [[ "$v" =~ $time_re ]]; then t="$v"; fi
      if [ -z "$t" ] || ! e="$(date -u -d "$t" +%s 2>/dev/null)"; then
        echo "UNKNOWN: $r (not a date, or a time with Z or an offset)"; return 2
      elif [ "$(now_epoch)" -ge "$e" ]; then echo "met: $r (passed)"; return 0
      else echo "waiting: $r (until $(date -u -d "@$e" '+%Y-%m-%d %H:%M') UTC)"; return 1; fi ;;
    */*/*)
      o="${r%%/*}"; rest="${r#*/}"; nm="${rest%%/*}"; sp="${rest#*/}"
      if [[ "$sp" == */* ]]; then echo "UNKNOWN: $r (not <owner>/<name>/<slug>)"; return 2; fi
      pout="$(bash "$here/../start-project/projects-dir.sh" --repo "$o/$nm" 2>&1)"; prc=$?
      if [ "$prc" != 0 ]; then echo "not checkable here: $r (${pout#projects-dir: })"; return 4; fi
      resolve_project "$r" "$sp" "$pout"; return $? ;;
    */*) echo "not checkable here: $r (another repo's project: check it there)"; return 4 ;;
    fid:*)
      if [ ! -f "$journal" ]; then echo "not checkable here: $r (no journal.sh beside this skill)"; return 4
      elif msg="$(bash "$journal" show "${r#fid:}" 2>&1)"; then echo "waiting: $r (open)"; return 1
      elif [[ "$msg" == *"is not open"* ]]; then echo "met: $r (closed in commit ${msg##* commit })"; return 0
      else echo "UNKNOWN: $r (no such followup)"; return 2; fi ;;
  esac
  resolve_project "$r" "$r" "${dir:-}"
}

# gate_reasons <plan>: the reason of each [external-gate: <reason>] tag in the PLAN's Status (with
# or without backticks around it; fenced code is skipped), one per line. A reason written as an
# unfilled <placeholder> (the PLAN template's own example) is no gate.
gate_reasons() {
  plan_section "$1" "Status" | awk "$MD_LIB"'{ s = md_skip($0, 0) } s { next }
    { t = $0
      while (match(t, /\[external-gate: [^]]*\]/)) {
        r = substr(t, RSTART + 16, RLENGTH - 17); gsub(/^[ \t]+|[ \t]+$/, "", r)
        if (r !~ /^<.*>$/) print r
        t = substr(t, RSTART + RLENGTH) } }'
}

# wait_state <total> <met> <waiting> <bad> <unchecked> <after> <after met>: the one classification
# of a list of waits, from the counts of its items by resolve_wait code (met 0, waiting 1, bad 2 or 3,
# unchecked 4) and of its after: items. The first rule that fits:
#   broken     any item unknown or ended
#   free       every item met
#   recheck    nothing waiting, something unchecked, and every after: item met: the day to look
#   unchecked  something unchecked and no after: item: nobody will look
#   held       anything else
wait_state() {
  if [ "$4" -gt 0 ]; then echo broken
  elif [ "$2" = "$1" ]; then echo free
  elif [ "$3" = 0 ] && [ "$5" -gt 0 ] && [ "$6" -gt 0 ] && [ "$7" = "$6" ]; then echo recheck
  elif [ "$5" -gt 0 ] && [ "$6" = 0 ]; then echo unchecked
  else echo held; fi
}

# waits_report <plan>: each waits-on reference resolved, one line each, then each [external-gate:]
# tag in Status (a wait no script can check), then banners: every wait met, names nothing found, the
# re-check date passed (recheck), or waits no script can check with no re-check date (unchecked).
waits_report() {
  local plan="$1" v r rc g total=0 met=0 waiting=0 bad=0 unknown=0 unchk=0 aft=0 aftmet=0 refs="" state
  v="$(field_value "$plan" waits-on)"
  while IFS= read -r r; do
    r="${r#"${r%%[![:space:]]*}"}"; r="${r%"${r##*[![:space:]]}"}"; [ -n "$r" ] || continue
    total=$((total+1))
    resolve_wait "$r"; rc=$?
    case "$rc" in 0) met=$((met+1)) ;; 1) waiting=$((waiting+1)) ;; 2) unknown=$((unknown+1)); bad=$((bad+1)) ;; 3) bad=$((bad+1)) ;; 4) unchk=$((unchk+1)); refs="${refs:+$refs, }$r" ;; esac
    case "$r" in after:*) aft=$((aft+1)); [ "$rc" = 0 ] && aftmet=$((aftmet+1)) ;; esac
  done < <(tr ',' '\n' <<<"$v")
  while IFS= read -r g; do
    total=$((total+1)); unchk=$((unchk+1)); refs="${refs:+$refs, }external-gate: $g"
    echo "not checkable here: external-gate: $g (only a person or an outside event clears it)"
  done < <(gate_reasons "$plan")
  if [ "$total" = 0 ]; then echo "waits-on: none"; return; fi
  [ "$met" = "$total" ] && echo "BANNER: every wait is met — remove waits-on at the next /end-session"
  [ "$unknown" -gt 0 ] && echo "BANNER: $unknown wait(s) name nothing found here — fix waits-on at the next /end-session"
  state="$(wait_state "$total" "$met" "$waiting" "$bad" "$unchk" "$aft" "$aftmet")"
  case "$state" in
    recheck) echo "BANNER: the re-check date passed: check on $refs, then set a new after: date or clear the wait at the next /end-session" ;;
    unchecked) echo "BANNER: $unchk wait(s) no script can check have no re-check date: add after:<date> to waits-on at the next /end-session" ;;
  esac
  return 0
}

# waits_list: stdin lines `<id><TAB><waits value>`, one output line each: `<id><TAB><state><TAB><detail>`.
# The state is wait_state's: broken, free, recheck, unchecked or held. The detail is each item's
# resolution line, joined with "; ". A `# comment` is dropped, as field_value drops it from a PLAN.
waits_list() {
  local id v r rc n line total met waiting bad unchk aft aftmet detail
  while IFS=$'\t' read -r id v || [ -n "$id" ]; do
    v="${v%%[[:blank:]]#*}"; [[ "$v" == \#* ]] && v=""
    n=0; met=0; waiting=0; bad=0; unchk=0; aft=0; aftmet=0; detail=""
    while IFS= read -r r; do
      r="${r#"${r%%[![:space:]]*}"}"; r="${r%"${r##*[![:space:]]}"}"; [ -n "$r" ] || continue
      n=$((n+1))
      line="$(resolve_wait "$r")"; rc=$?
      detail="${detail:+$detail; }$line"
      case "$rc" in 0) met=$((met+1)) ;; 1) waiting=$((waiting+1)) ;; 4) unchk=$((unchk+1)) ;; *) bad=$((bad+1)) ;; esac
      case "$r" in after:*) aft=$((aft+1)); [ "$rc" = 0 ] && aftmet=$((aftmet+1)) ;; esac
    done < <(tr ',' '\n' <<<"$v")
    if [ "$n" = 0 ]; then printf '%s\tbroken\tERROR: no waits value\n' "$id"
    else printf '%s\t%s\t%s\n' "$id" "$(wait_state "$n" "$met" "$waiting" "$bad" "$unchk" "$aft" "$aftmet")" "$detail"; fi
  done
}

# --- claims: which session holds a project (per machine) ---
claims_dir="${XDG_STATE_HOME:-$HOME/.local/state}/project-claims"
sessions_dir="${CLAIMS_SESSIONS_DIR:-$HOME/.claude/sessions}"
json_str() { grep -o "\"$2\":\"[^\"]*\"" "$1" 2>/dev/null | sed -n 1p | sed 's/^"[^"]*":"//; s/"$//'; }
json_num() { grep -o "\"$2\":[0-9]*" "$1" 2>/dev/null | sed -n 1p | sed 's/^"[^"]*"://'; }
session_file() { grep -l "\"sessionId\":\"$1\"" "$sessions_dir"/*.json 2>/dev/null | sed -n 1p; }
claim_file() { printf '%s/%s' "$claims_dir" "$(readlink -m "$1" | sed 's#/#%#g')"; }
my_name() { local n=""; [ -n "${CLAUDE_PID:-}" ] && n="$(json_str "$sessions_dir/$CLAUDE_PID.json" name)"; printf '%s' "${n:-this session}"; }

# holder_state <claim file>: sets hid, hname, hplan, idle and hstate, the one judgment of whether an
# open tab holds the claim: none (empty claim), mine, ended, relaunched, busy, warm (idle under
# WARM_MINUTES) or abandoned
holder_state() {
  local hf hs hu hst cts me="${CLAUDE_CODE_SESSION_ID:-}"
  hid=""; hname=""; hplan=""; idle=0; hstate=none
  IFS=$'\t' read -r hid hname cts hplan <"$1"
  [ -n "$hid" ] || return 0
  if [ "$hid" = "$me" ]; then hstate=mine; return 0; fi
  hf="$(session_file "$hid")"
  if [ -z "$hf" ]; then hstate=ended; return 0; fi
  hname="$(json_str "$hf" name)"; hs="$(json_str "$hf" status)"; hu="$(json_num "$hf" statusUpdatedAt)"; hst="$(json_num "$hf" startedAt)"
  idle=$(( ( $(date +%s) - ${hu:-0} / 1000 ) / 60 ))
  # A relaunch (startedAt after the claim) resets statusUpdatedAt, so idle time alone calls an unused
  # tab live. Its status changing within RELAUNCH_QUIET_S of launch is the launch itself settling.
  if [ "$hs" != busy ] && [ -n "$hst" ] && [ "${cts:-0}" -lt $(( hst / 1000 )) ] && [ $(( ${hu:-0} - hst )) -lt $(( RELAUNCH_QUIET_S * 1000 )) ]; then
    hstate=relaunched
  elif [ "$hs" = busy ]; then hstate=busy
  elif [ "$idle" -lt "$WARM_MINUTES" ]; then hstate=warm
  else hstate=abandoned; fi
}

# claim_take <plan>: warn about another holder, then record this session as the holder
claim_take() {
  local cf hid hname hplan idle hstate me="${CLAUDE_CODE_SESSION_ID:-}"
  cf="$(claim_file "$1")"
  if [ -f "$cf" ]; then
    holder_state "$cf"
    case "$hstate" in
      ended) echo "NOTE: the last claim was by a session that has ended (${hname:-unnamed}): taking it over" ;;
      relaunched) echo "NOTE: claimed by ${hname:-unnamed} before it was relaunched, unused since: taking it over" ;;
      busy) echo "BANNER: another live session holds this project: ${hname:-unnamed} (busy) — two sessions closing one PLAN overwrite each other; confirm before working" ;;
      warm) echo "BANNER: another live session holds this project: ${hname:-unnamed} (idle $idle min) — two sessions closing one PLAN overwrite each other; confirm before working" ;;
      abandoned) echo "NOTE: claimed by ${hname:-unnamed}, idle $((idle/60)) h: probably an abandoned tab; taking it over" ;;
    esac
  fi
  if [ -z "$me" ]; then echo "NOTE: no session id in the environment: the claim is not recorded"; return; fi
  mkdir -p "$claims_dir" && printf '%s\t%s\t%s\t%s\n' "$me" "$(my_name)" "$(date +%s)" "$1" >"$cf" \
    && echo "claimed by this session ($(my_name))" || echo "ERROR: could not write the claim at $cf"
}

# claim_release <plan>: remove this session's claim; leave another's
claim_release() {
  local cf hid hname hf me="${CLAUDE_CODE_SESSION_ID:-}"
  cf="$(claim_file "$1")"
  if [ ! -f "$cf" ]; then echo "no claim to release"; return; fi
  IFS=$'\t' read -r hid hname _ <"$cf"
  if [ -n "$me" ] && [ "$hid" = "$me" ]; then rm -f "$cf" && echo "released"
  else
    hf="$(session_file "$hid")"; [ -n "$hf" ] && hname="$(json_str "$hf" name)"
    echo "NOTE: held by ${hname:-another session}, not this session: left alone"
  fi
}

# claim_holder <plan>: who holds the project; 0 when it is this session
claim_holder() {
  local cf hid hname hf me="${CLAUDE_CODE_SESSION_ID:-}"
  cf="$(claim_file "$1")"
  if [ ! -f "$cf" ]; then echo "holder: none"; return 1; fi
  IFS=$'\t' read -r hid hname _ <"$cf"
  if [ -n "$me" ] && [ "$hid" = "$me" ]; then echo "holder: this session"; return 0; fi
  hf="$(session_file "$hid")"; [ -n "$hf" ] && hname="$(json_str "$hf" name)"
  echo "holder: ${hname:-another session}"; return 1
}

if [ "$mode" = claims ]; then
  for cf in "$claims_dir"/*; do
    [ -f "$cf" ] || continue
    holder_state "$cf"
    case "$hstate" in
      busy) printf '%s\t%s\tbusy\n' "$(readlink -m "$hplan")" "${hname:-unnamed}" ;;
      warm) printf '%s\t%s\tidle %s min\n' "$(readlink -m "$hplan")" "${hname:-unnamed}" "$idle" ;;
      mine) printf '%s\t%s\tthis session\n' "$(readlink -m "$hplan")" "$(my_name)" ;;
    esac
  done
  exit 0
fi

given_plan="" # --waits and --plan-check take a PLAN path, read before the cd below
case "$mode" in waits|plancheck) given_plan="$(readlink -f "$slug" 2>/dev/null)" ;; waitslist) ;; *) section "SELECTION" ;; esac
top="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: not inside a git repository"; echo "BANNER: nothing to resume here"; exit 2; }
cd "$top" || exit 2
dir="$(bash "$here/../start-project/projects-dir.sh" 2>&1)" || {
  pdrc=$?
  # --waits-list needs no projects folder: a project item is then unknown, a fid item still resolves
  [ "$mode" != waitslist ] && [ "$pdrc" = 3 ] && { echo "ERROR: projects ${dir#projects-dir: }"; echo "BANNER: nothing to resume here until the projects are reachable"; exit 2; }
  dir=""; }
if [ "$mode" = waitslist ]; then [ -d "$dir" ] || dir=""; waits_list; exit 0; fi
if [ -z "$dir" ] || [ ! -d "$dir" ]; then
  echo "ERROR: no projects folder at ${dir:-(the resolver answered nothing)}"
  echo "BANNER: nothing to resume; use /start-project"; exit 2
fi
case "$mode" in waits|plancheck)
  [ -n "$given_plan" ] && [ -r "$given_plan" ] || { echo "ERROR: no readable PLAN at '$slug'"; exit 3; }
  if [ "$mode" = waits ]; then waits_report "$given_plan"
  else pc="$(plan_check "$given_plan" resume)"; echo "${pc:-ok}"; fi
  exit 0 ;;
esac

# project_plans <folder>: the PLAN of each project in <folder> the argument names: the folder
# it names in full (YYYY-MM-<slug>) when there is one, else each folder ending in -<slug>
project_plans() {
  local p
  if [[ "$slug" =~ ^[0-9]{4}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*$ ]] && [ -e "$1/$slug/PLAN.md" ]; then
    printf '%s\n' "$1/$slug/PLAN.md"; return
  fi
  for p in "$1"/*-"$slug"/PLAN.md; do [ -e "$p" ] && printf '%s\n' "$p"; done
  return 0
}

active_list() { # the active projects' folders, one per line
  local p; for p in "$dir"/*/PLAN.md; do
    [ -f "$p" ] && [ "$(frontmatter "$p" status)" = active ] && basename "$(dirname "$p")"
  done
}

plan=""
if [ -n "$slug" ]; then
  mapfile -t hits < <(project_plans "$dir")
  # a terminal close archives the PLAN before /end-session checks it: --check reads the archived one
  [ ${#hits[@]} -eq 0 ] && [ "$mode" = check ] && mapfile -t hits < <(project_plans "$dir/_archive")
  case ${#hits[@]} in
    1) plan="${hits[0]}"; echo "requested: $slug" ;;
    0) if [ "$mode" = release ]; then
         # a terminal close archives the PLAN first: its claim is keyed on the path it had before
         mapfile -t arch < <(project_plans "$dir/_archive")
         if [ ${#arch[@]} -gt 0 ]; then
           echo "requested: $slug (archived)"; section "CLAIM"
           for p in "${arch[@]}"; do claim_release "$dir/$(basename "$(dirname "$p")")/PLAN.md"; done; exit 0
         fi
       fi
       echo "ERROR: no project matches '$slug'"
       arch_hit=0; while IFS= read -r p; do
         [ -e "$p" ] && { arch_hit=1; echo "archived: $(basename "$(dirname "$p")") (closed; not resumable)"; }; done < <(project_plans "$dir/_archive")
       echo "active projects:"; active_list | sed 's/^/  /'
       # a closed project is not a slug to ask about: a terminal /end-session reads this on purpose
       if [ "$arch_hit" = 1 ]; then echo "BANNER: '$slug' is closed (archived): nothing to resume"
       else echo "BANNER: '$slug' did not resolve — ask which"; fi; exit 2 ;;
    *) echo "BANNER: '$slug' matches ${#hits[@]} projects — ask which"
       for p in "${hits[@]}"; do echo "  $(basename "$(dirname "$p")")"; done; exit 2 ;;
  esac
else
  mapfile -t act < <(active_list)
  case ${#act[@]} in
    1) plan="$dir/${act[0]}/PLAN.md"; echo "the single active project" ;;
    0) echo "NOTE: no project has status: active"
       echo "BANNER: nothing active to resume; use /start-project"; exit 2 ;;
    *) echo "BANNER: ${#act[@]} active projects — ask which"; printf '  %s\n' "${act[@]}"; exit 2 ;;
  esac
fi
if [ ! -r "$plan" ]; then echo "ERROR: $plan is not readable"; exit 3; fi
# --section reads one section and stops: before the claim, the fetch and every other read
[ "$mode" = section ] && { print_section "$plan" "$secname" plan_section; exit 0; }

name="$(basename "$(dirname "$plan")")"; pslug="${name#[0-9][0-9][0-9][0-9]-[0-9][0-9]-}"
st="$(frontmatter "$plan" status)"; lu="$(frontmatter "$plan" last-updated)"

# A resume, --release or --holder run in the repo's main checkout acts on the project's worktree:
# the worktree holds the newer PLAN, and the claim and every check belong to the folder the work
# happens in, so a release or a holder question must look where the resume recorded the claim. The
# script runs again there, with the picked folder's name so an auto-pick picks the same project
# (a re-exec rather than a swapped path: every later line then reads one folder, whole).
# RESUME_STATE_REDIRECTED names the worktree it was sent to: it stops a second hop and lets that run
# say where it came from. The other modes returned above or never get here.
main_checkout=""
if [ "$(cd "$(git rev-parse --git-dir)" && pwd -P)" = "$(cd "$(git rev-parse --git-common-dir)" && pwd -P)" ]; then main_checkout=1; fi

# project_worktree: prints the picked project's worktree and returns 0 when this run should go there:
# the main checkout, a status of active, paused or draft, and .claude/worktrees/<slug> a real worktree
# of this repo (it shares the common git dir and has a git dir of its own), not the one already sent to.
project_worktree() {
  local wt common
  common="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
  [ -n "$main_checkout" ] || return 1
  case "$st" in active|paused|draft) ;; *) return 1 ;; esac
  wt="$top/.claude/worktrees/$pslug"; [ -d "$wt" ] || return 1
  [ "$(cd "$(git -C "$wt" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" 2>/dev/null && pwd -P)" = "$common" ] || return 1
  [ "$(cd "$(git -C "$wt" rev-parse --path-format=absolute --git-dir 2>/dev/null)" 2>/dev/null && pwd -P)" != "$common" ] || return 1
  wt="$(cd "$wt" && pwd -P)"
  [ "${RESUME_STATE_REDIRECTED:-}" != "$wt" ] || return 1
  printf '%s\n' "$wt"
}
case "$mode" in resume|release|holder)
  if wt="$(project_worktree)"; then
    flag=""; [ "$mode" = resume ] || flag="--$mode"
    cd "$wt" && RESUME_STATE_REDIRECTED="$wt" exec bash "${BASH_SOURCE[0]}" ${flag:+"$flag"} "$name" ${start_words[@]+"${start_words[@]}"}
  fi ;;
esac
age=""; e="$(date -d "$lu" +%s 2>/dev/null)" && age="$(( ($(date +%s) - e) / 86400 )) days ago"
echo "project: $name"
echo "plan: $plan"
echo "status: ${st:-UNREADABLE}"
echo "last-updated: ${lu:-UNREADABLE}${age:+ ($age)}"
[ "$st" = active ] || echo "BANNER: status is '${st:-?}', not 'active' — confirm this is the project meant"

case "$mode" in
  release) section "CLAIM"; claim_release "$plan"; exit 0 ;;
  holder) section "CLAIM"; claim_holder "$plan"; exit $? ;;
  check)
    section "CHECK"; plan_check "$plan" check; nf=$?
    if [ "$nf" -eq 0 ]; then echo "RESULT: ok"; exit 0; fi
    echo "RESULT: $nf failure(s): fix them in the PLAN before committing"; exit 1 ;;
esac

section "CLAIM"
claim_take "$plan"

section "WORKTREE"
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
echo "branch: ${branch:-UNKNOWN}"
dirty="$(git status --short 2>/dev/null)"
if [ -n "$dirty" ]; then
  echo "BANNER: working tree is DIRTY — a clean /end-session leaves nothing here"; printf '%s\n' "$dirty"
else echo "clean"; fi
# A project works in its own worktree under .claude/worktrees, not in the repo's main checkout: a
# resume that runs in the main checkout (git dir and common dir are the same folder) says so.
case "$st" in active|paused|draft)
  if [ "$main_checkout" = 1 ]; then
    if [ -d "$top/.claude/worktrees/$pslug" ]; then
      echo "BANNER: this resume runs in the repo's main checkout, and project $pslug's work belongs in its worktree: $top/.claude/worktrees/$pslug — tell the user to continue there"
    else
      echo "BANNER: this resume runs in the repo's main checkout, and project $pslug has no worktree yet: its work belongs in .claude/worktrees/$pslug, created on branch worktree-$pslug (claude --worktree $pslug) — tell the user before building here"
    fi
  elif [ "${RESUME_STATE_REDIRECTED:-}" = "$top" ]; then
    echo "NOTE: this resume ran in the repo's main checkout, so it was read from the project's worktree ($top): work continues there"
  fi ;;
esac
case "$plan" in
  "$top"/*) git check-ignore -q "$plan" && echo "NOTE: the projects folder is not tracked here: a PLAN edit never shows above, so anything listed is real work" ;;
  *) echo "NOTE: the projects folder is outside this repo: a PLAN edit never shows above"
     # A projects home: a write that could not push (projects-write.sh keeps the files, uncommitted)
     # or a commit made there by hand is a pending sync, read from the clone's own git state.
     pdir="$(dirname "$plan")"
     if ptop="$(cd "$(git -C "$pdir" rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null && pwd -P)"; then
       prel="$(cd "$pdir" && pwd -P)"; prel="${prel#"$ptop"/}"
       pdirty="$(git -C "$ptop" status --porcelain -- "$prel" 2>/dev/null)"
       pahead="$(git -C "$ptop" rev-list --count '@{upstream}..HEAD' -- "$prel" 2>/dev/null || echo 0)"
       if [ -n "$pdirty" ] || [ "${pahead:-0}" != 0 ]; then
         echo "BANNER: a sync to the projects home is pending: this project's files there are not on its remote (an /end-session or landing that could not push, or work there by hand); push them before working"
         if [ -n "$pdirty" ]; then
           printf '%s\n' "$pdirty"
           echo "  push them: (cd $ptop && bash $top/.claude/skills/start-project/projects-write.sh --subject \"$pslug: push a pending PLAN change\" -- $prel)"
         fi
         [ "${pahead:-0}" = 0 ] || echo "  $pahead commit(s) there not pushed: git -C $ptop push"
       fi
     fi ;;
esac
if up="$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)"; then
  # Fetch first: a checkout behind its remote would load an old PLAN and kickoff with no word of
  # it. Bounded, never prompting; a fetch that fails or cannot be bounded is said, never a stop.
  remote="$(git config "branch.$branch.remote" 2>/dev/null)"; secs="${RESUME_FETCH_SECONDS:-10}"
  if [ "${remote:-.}" = . ]; then :
  elif ! command -v timeout >/dev/null; then
    echo "NOTE: no timeout command here: not fetched, so the checks below are as of the last fetch"
  elif GIT_TERMINAL_PROMPT=0 timeout "$secs" git fetch -q "$remote" >/dev/null 2>&1 </dev/null; then
    echo "fetched $remote"
  else echo "NOTE: could not fetch $remote within $secs s: the checks below are as of the last fetch"; fi
  behind="$(git rev-list --count 'HEAD..@{upstream}' 2>/dev/null)"
  [ "${behind:-0}" -gt 0 ] && echo "BANNER: $behind commit(s) on $up not in this checkout — pull before trusting this PLAN or running its Verify first commands: both are as of the old checkout"
  unpushed="$(git log --oneline '@{upstream}..HEAD' 2>/dev/null)"
  if [ -n "$unpushed" ]; then
    echo "BANNER: $(wc -l <<<"$unpushed") commit(s) not pushed to $up — a branch cut now carries them"
    printf '%s\n' "$unpushed"
  fi
else echo "NOTE: ${branch:-this branch} has no upstream; unpushed commits not checked"; fi

# The PLAN's last save: its last commit in the repo that holds it, else its file time. Commits made
# in this repo after it are the work the kickoff has not seen; those naming the project mean the
# last session did not close with /end-session.
# kickoff_overlap -> for each repo path the kickoff names in backticks (a `file:line` counts as its
# file), the other work since the save that touched it: count and newest commit. A backticked
# /<name> (a word after it ignored) counts as .claude/skills/<name>/ when that folder exists, and
# its line says (as /<name>). Reads `since`, `mine` and `plan` from CONTINUITY; prints nothing
# when no named path was touched.
kickoff_overlap() {
  local tok p as name cnt newest line hdr="" seen=$'\n'
  # shellcheck disable=SC2016  # a literal backtick pattern, nothing to expand
  while IFS= read -r tok; do
    as=""
    if [ "${tok#/}" != "$tok" ]; then
      name="${tok%% *}"; name="${name#/}"
      case "$name" in ""|*[!a-z0-9-]*) continue ;; esac
      p=".claude/skills/$name/"; as=" (as /$name)"
    else
      p="${tok%%:*}"; p="${p%%#*}"
    fi
    case "$p" in ""|-*|*" "*|*'$'*|*'<'*) continue ;; esac
    case "$seen" in *$'\n'"$p"$'\n'*) continue ;; esac; seen+="$p"$'\n'
    [ -n "$(git -C "$top" ls-tree HEAD -- "$p" 2>/dev/null)" ] || continue
    cnt=0; newest=""
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      grep -qxF -- "$line" <<<"$mine" && continue
      cnt=$((cnt+1)); [ -n "$newest" ] || newest="$line"
    done < <(git -C "$top" log --format='%h %s' "${since[@]}" -- "$p" 2>/dev/null)
    [ "$cnt" -gt 0 ] || continue
    [ -n "$hdr" ] || { hdr=1; echo "other work on paths the kickoff names (check it against the kickoff):"; }
    echo "  $p$as: $cnt commit(s), newest: $newest"
  done < <(plan_section "$plan" "Next-session kickoff" | grep -o '`[^`]*`' | tr -d '`')
}

# The files this checkout and another worktree of the repo have both changed (overlap.sh, after
# the fetch above): nothing, and no section, with no other worktree. Paths come from git: tagged.
o_out=""; [ -f "$here/overlap.sh" ] && o_out="$(bash "$here/overlap.sh" 2>/dev/null </dev/null)"
if [ -n "$o_out" ]; then
  section "OVERLAP"
  o_hits="$(grep -v '^NOTE:' <<<"$o_out")"
  if [ -n "$o_hits" ]; then
    echo "BANNER: $(cut -f1 <<<"$o_hits" | sort -u | grep -c .) file(s) this checkout changed are also changed in another worktree of this repo: read that work before building on it (git -C {{worktree}} diff origin/HEAD...HEAD -- {{path}}, and its git status)"
    tagged overlap "$o_hits"
  fi
  grep '^NOTE:' <<<"$o_out"
fi

section "CONTINUITY"
pdir="$(dirname "$plan")"; since=()
if last="$(git -C "$pdir" log -1 --format='%H%x09%ct%x09%h %s' -- "$(basename "$plan")" 2>/dev/null)" && [ -n "$last" ]; then
  IFS=$'\t' read -r lsha lct lsub <<<"$last"
  echo "PLAN last saved: $(date -d "@$lct" '+%F %R') (commit $lsub)"
  if [ "$(git -C "$pdir" rev-parse --show-toplevel)" = "$top" ]; then
    if git merge-base --is-ancestor "$lsha" HEAD 2>/dev/null; then since=("$lsha..HEAD")
    else echo "BANNER: the PLAN's last commit is not on this branch — confirm the branch"; since=("--since=@$((lct+1))"); fi
  else since=("--since=@$((lct+1))"); fi
else
  mt="$(stat -c %Y "$plan")"
  echo "PLAN last saved: $(date -d "@$mt" '+%F %R') (file time; the PLAN is not committed)"
  since=("--since=@$((mt+1))")
fi
after="$(git log --format='%h %s' "${since[@]}" 2>/dev/null)"
n=0; [ -n "$after" ] && n="$(wc -l <<<"$after")"
echo "$n commit(s) since"
if [ "$n" -gt 0 ]; then
  mine="$(names_slug "$pslug" <<<"$after")"; k=0; [ -n "$mine" ] && k="$(wc -l <<<"$mine")"
  if [ "$k" -gt 0 ]; then
    echo "BANNER: $k commit(s) since the PLAN was saved name this project — the last session may have ended without /end-session, and the kickoff has not seen them"
    printf '%s\n' "$mine" | sed 's/^/  /'
  fi
  if [ "$((n-k))" -gt 0 ]; then
    echo "other work since: $((n-k)) commit(s)"
    grep -vxF -f <(printf '%s\n' "$mine") <<<"$after" | sed -n 1,10p | sed 's/^/  /'
    [ "$((n-k))" -gt 10 ] && echo "  … and $((n-k-10)) more"
    kickoff_overlap
  fi
fi

section "PLAN CHECK"
# The writer's gate (/end-session runs --check before committing), shown at every resume too, so a
# PLAN written before the gate existed still gets its contradictions named.
pc="$(plan_check "$plan" resume)"
echo "${pc:-ok}"

section "WAITS"
waits_report "$plan"

# The open messages other repos left about this project (the mailbox), through the shared helper:
# nothing, and no section, on a machine with no mailbox. Their titles are other repos' text: tagged.
m_out=""; [ -f "$here/../start-project/mailbox.sh" ] \
  && m_out="$(bash "$here/../start-project/mailbox.sh" list --project "$name" 2>/dev/null </dev/null)"
if [ -n "$m_out" ]; then
  section "MAILBOX"
  echo "BANNER: $(grep -c . <<<"$m_out") open message(s) from other repos about this project: read each (bash .claude/skills/start-project/mailbox.sh show {{id}}) before starting, and close it with /done message {{id}} once handled"
  tagged mailbox "$m_out"
fi

# The work request parts naming this repo about this project (ADR 0012 item 3): another repo decided
# each change, so the banner says to make it or decline it, not to weigh it as a message. A backend
# from before `requests` exits 2: one NOTE.
r_out=""; r_none=0
if [ -f "$here/../start-project/mailbox.sh" ]; then
  r_out="$(bash "$here/../start-project/mailbox.sh" requests --project "$name" 2>/dev/null </dev/null)" \
    || { [ $? != 2 ] || r_none=1; r_out=""; }
fi
if [ -n "$r_out" ] || [ "$r_none" = 1 ]; then
  section "REQUESTS"
  [ "$r_none" = 0 ] || echo "NOTE: the mailbox script has no requests: work requests are not listed; update the global setup"
  if [ -n "$r_out" ]; then
    echo "BANNER: $(grep -c . <<<"$r_out") open work request part(s) from other repos about this project: another repo decided each change. Read each (bash .claude/skills/start-project/mailbox.sh requests show {{id}}) before starting; make the change, or decline it with a reason, and close it with /done request {{id}}"
    tagged request "$r_out"
  fi
fi

section "PLAN — STATUS"
# Printed in full whatever its size (its blockers are at the end), but an overgrown one is flagged:
# past about 15KB it costs every resume more than the rest of the read does.
sbytes="$(plan_section "$plan" "Status" | wc -c)"
[ "$sbytes" -gt 15000 ] && echo "BANNER: Status is $((sbytes/1000))KB, which makes every resume expensive — trim it at the next /end-session"
print_section "$plan" "Status" plan_status

section "PLAN — OPEN PUNCH-LIST"
punch="$(plan_section "$plan" "Punch-list")"
if [ -z "$punch" ]; then echo "NOTE: this PLAN has no punch-list"
else
  open="$(awk "$MD_LIB"'{ s = md_skip($0, 0) } !s && /^- \[ \]/ { n++ } END { print n+0 }' <<<"$punch")"
  closed="$(awk "$MD_LIB"'{ s = md_skip($0, 0) } !s && /^- \[[xX]\]/ { n++ } END { print n+0 }' <<<"$punch")"
  echo "$open open / $((open+closed)) total"
  # a ### heading only when an open item follows it
  items="$(punch_open_items <<<"$punch")"
  [ -z "$items" ] || tagged punch_list "$items"
fi

if [ -n "$start" ]; then
  section "START (from the arguments: this session starts here; the kickoff below is context)"
  if [[ "$start" =~ ^(fid:|request:)?[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
    # one id: an open followup, or an open work request part naming this repo (ADR 0012 item 5);
    # fid: or request: picks one kind, and a bare id that is both is said and asked about
    f="${start#fid:}"; f="${f#request:}"; want=both
    case "$start" in fid:*) want=fid ;; request:*) want=request ;; esac
    mbox="$here/../start-project/mailbox.sh"; isreq=0; fok=1; msg=""
    if [ "$want" != fid ] && [ -f "$mbox" ] && bash "$mbox" requests --tsv 2>/dev/null </dev/null \
      | awk -F'\t' -v id="$f" '$1 == id "" { found = 1 } END { exit !found }'; then isreq=1; fi
    if [ "$want" != request ] && [ -f "$journal" ]; then msg="$(bash "$journal" show "$f" 2>&1)"; fok=$?; fi
    if [ "$isreq" = 1 ] && [ "$fok" = 0 ]; then
      echo "NOTE: '$f' is both an open followup and an open work request part for this repo: ask the operator which they meant (fid:$f or request:$f)"
      tagged operator_words "$start"
    elif [ "$isreq" = 1 ]; then echo "request: $f"; tagged request "$(bash "$mbox" requests show "$f" 2>/dev/null </dev/null)"
    elif [ "$want" = request ]; then echo "NOTE: '$f' is no open work request part for this repo: taken as the operator's words"; tagged operator_words "$start"
    elif [ ! -f "$journal" ]; then echo "NOTE: no journal.sh beside this skill: '$start' is taken as words"; tagged operator_words "$start"
    elif [ "$fok" = 0 ]; then echo "fid: $f"; tagged followup "$msg"
    elif [[ "$msg" == *"is not open"* ]]; then
      echo "NOTE: followup '$f' is closed: ${msg#*: }"
      c="${msg##* commit }"; c="${c%% *}"; git log -1 --format='  %h %s' "$c" 2>/dev/null
      tagged operator_words "$start"
    else echo "NOTE: '$start' is not an open followup, nor an open work request part for this repo: taken as the operator's words"; tagged operator_words "$start"; fi
  else tagged operator_words "$start"; fi
fi

section "PLAN — NEXT-SESSION KICKOFF (word for word: this is the prompt)"
print_section "$plan" "Next-session kickoff" kickoff

section "PLAN — LAST SESSION LOG ENTRY"
log="$(plan_section "$plan" "Session log")"
if [ -z "$log" ]; then echo "ERROR: no \"Session log\" section — renamed? read it from the PLAN by its heading"
else
  entry="$(last_log_entry <<<"$log")"
  if [ -n "$entry" ]; then tagged session_log_entry "$entry"; else echo "NOTE: the session log has no entries yet"; fi
fi

section "RECENT COMMITS"
if commits="$(git log --oneline -10 2>/dev/null)"; then tagged recent_commits "$commits"; else echo "ERROR: git log failed"; fi

section "END"
echo "PLAN: $plan ($(wc -c <"$plan") bytes). Read any other section by its heading, never the whole file."
echo "Writes only its claim, outside the repo; /end-session writes project state."
