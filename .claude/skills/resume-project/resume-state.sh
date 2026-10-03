#!/usr/bin/env bash
#
# resume-state.sh — the one read /resume-project makes. It picks the project, records this
# session's claim on it, prints the PLAN sections a resume needs in full (Status, the open
# punch-list, the kickoff, the last session-log entry), resolves what the project waits on, and runs
# the continuity checks and the PLAN check, so the model orients instead of gathering. Sections are
# labeled `=== NAME ===` and read top to bottom. The same PLAN check, run by /end-session before it
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
#   - Status and the kickoff are printed word for word: they are the prompt, not a summary.
#   - It writes only its claim, outside the repo (under $XDG_STATE_HOME/project-claims): no project
#     state, no commits. /end-session owns project state.
#
# Usage (from inside the repo):
#   bash .claude/skills/resume-project/resume-state.sh [<slug> [<starting point>…]]
#       the resume read. Words after the slug are where this session starts instead of the
#       kickoff's Starts at: one open followup's fid (optionally fid:<fid>) is shown in full;
#       anything else is the operator's words.
#   … --check [<slug>]     the PLAN check alone: FAIL lines exit 1; REVIEW lines ask the writer to
#                          justify something (a landmine dropped since the last commit); NOTEs inform
#   … --release [<slug>]   remove this session's claim (another session's is left alone)
#   … --holder [<slug>]    which session holds the project; only reads (a sub-agent asks as its
#                          parent session, so "this session" means /end-session will close it)
#   … --waits <PLAN path>  only what that PLAN waits on, resolved (for other readers)
#   … --plan-check <PLAN path>  only the PLAN check, as a resume shows it: BANNER lines for a
#                          contradiction, NOTEs, else ok; exit 0 (for other readers: /catchup)
# Exit: 0 done (a resume: a project was picked and every section printed; --holder: this session
# holds it); 1 --check found a FAIL, or --holder: another session or none holds it; 2 no project could be picked (none active, several active, a slug matching none or several,
# no projects folder, not a git repo: the SELECTION lines say which); 3 the picked PLAN cannot be
# read.
#
# Claims: a session is known by CLAUDE_CODE_SESSION_ID and CLAUDE_PID, which every command a
# Claude Code session runs carries, and ~/.claude/sessions/<pid>.json (CLAIMS_SESSIONS_DIR in
# tests), which holds its tab name and busy/idle. A holder idle 55 minutes or more is taken for an
# abandoned tab: an agent waiting on its own work wakes well within that, so a watcher never
# looks that idle. A claim is advice: a resume always proceeds.

set -uo pipefail # not -e: one failed section must not stop the rest

mode=resume
case "${1:-}" in --check) mode=check; shift ;; --release) mode=release; shift ;; --holder) mode=holder; shift ;; --waits) mode=waits; shift ;; --plan-check) mode=plancheck; shift ;; esac
slug="${1:-}"; [ $# -gt 0 ] && shift
start="$*"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
journal="$here/../log/journal.sh"
WARM_MINUTES=55
RELAUNCH_QUIET_S=10 # a launch settles to idle within about a second (seen: 186 ms); 10 s leaves wide margin

section() { printf '\n=== %s ===\n' "$1"; }

# frontmatter <file> <field> -> the field's first word, read from the leading --- block only
frontmatter() {
  awk -v f="$2" 'NR==1 && $0!="---" { exit } NR>1 && $0=="---" { exit } NR>1 && $1==f":" { print $2; exit }' "$1"
}

# plan_section <file> <name> -> every `## ` section whose heading, after its leading emoji, starts
# with <name> (case ignored), heading line included. The words are the contract; the emoji varies.
plan_section() {
  awk -v want="$2" '
    /^## / { h=$0; sub(/^## /, "", h); sub(/^[^A-Za-z]*/, "", h)
             inside=(index(tolower(h), tolower(want))==1) }
    /^# / { inside=0 }
    inside { print }' "$1"
}

# print_section <file> <name> <label>: the section in full, or an ERROR line naming it
print_section() {
  local body; body="$(plan_section "$1" "$2")"
  if [ -n "$body" ]; then printf '%s\n' "$body"
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

# phase_id <text> -> the phase id the text starts with (A, C1, 3; after an optional "Phase "), or
# nothing when it starts with anything else ("ALL FOUR PHASES SHIP" has none)
phase_id() {
  local t="$1"; t="${t#"${t%%[![:space:]*]*}"}"; t="${t#Phase }"; t="${t#phase }"
  if [[ "$t" =~ ^([A-Z][0-9]?|[0-9]+)([^A-Za-z0-9]|$) ]]; then printf '%s' "${BASH_REMATCH[1]}"; fi
}

# phase_marks <Status text on stdin> -> "id<TAB>mark" for each Phase progress line, the mark being
# the first of ✅ 🚧 ⬜ on the line (later text may mention another)
phase_marks() {
  awk '/^\*\*Phase progress/ { p=1; next } p && (/^\*\*/ || /^## /) { p=0 }
    p && /^- / { l=substr($0, 3); sub(/^[Pp]hase /, "", l)
      if (!match(l, /^([A-Z][0-9]?|[0-9]+)/)) next
      id=substr(l, 1, RLENGTH); if (substr(l, RLENGTH+1, 1) ~ /[A-Za-z0-9]/) next
      m=""; best=0; n=split("✅ 🚧 ⬜", M, " ")
      for (i=1; i<=n; i++) { k=index(l, M[i]); if (k > 0 && (best == 0+0 || k < best+0)) { best=k; m=M[i] } }
      print id "\t" m }'
}

# bold_value <text on stdin> <label> -> what follows the first `**<label>:**` line
bold_value() { awk -v l="**$1:**" 'index($0, l)==1 { v=substr($0, length(l)+1); sub(/^[ \t]+/, "", v); print v; exit }'; }

# sub_section <text on stdin> <### heading> -> the lines under that ### heading, up to the next
sub_section() { awk -v h="### $1" '/^### / { p=(index($0, h)==1); next } /^## / { p=0 } p'; }

# landmine_keys <kickoff text on stdin> -> one key per Landmines bullet: its bold lead when it has
# one, else its first 60 characters (so an edited explanation is not a dropped landmine)
landmine_keys() {
  sub_section "Landmines" | awk '/^- / { l=substr($0, 3)
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
  # the next resume. A resume never runs one.
  verify_first() {
    local line="$1" cmd val got rc lines t="${RESUME_VERIFY_TIMEOUT:-60}"
    [[ "$line" =~ ^-\ \`([^\`]+)\`\ →\ \`([^\`]*)\` ]] \
      || { fail "a Verify first value is not in backticks (write \`command\` → \`what it printed\`): $line"; return; }
    cmd="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    if command -v timeout >/dev/null; then got="$(timeout "$t" bash -c "$cmd" 2>&1)"; rc=$?
    else got="$(bash -c "$cmd" 2>&1)"; rc=$?; fi
    [ "$rc" = 124 ] && { fail "Verify first: \`$cmd\` did not finish in ${t}s"; return; }
    lines="$(grep -c '' <<<"$got")"; got="${got%"${got##*[![:space:]]}"}"
    if [ "$lines" -gt 1 ]; then fail "Verify first: \`$cmd\` printed $lines lines: narrow it to the one line the value is"
    elif [ "$got" != "$val" ]; then fail "Verify first: \`$cmd\` printed \`$got\`, the kickoff says \`$val\`"; fi
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
    sub_section "Next, in order" <<<"$kick" | grep -q '^[0-9][0-9]*\. ' \
      || fail "the kickoff has no ### Next, in order section with a numbered step"
    while IFS= read -r k; do
      [[ "$k" =~ ^-\ \`[^\`]+\`\ →\ .+ ]] || { fail "a Verify first line is not \`command\` → value: $k"; continue; }
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
  if [ "$how" = check ]; then
    rel="$(git -C "$(dirname "$plan")" ls-files --full-name -- "$(basename "$plan")" 2>/dev/null)"
    if [ -n "$rel" ] && prev="$(git -C "$(dirname "$plan")" show "HEAD:$rel" 2>/dev/null)"; then
      local pk; pk="$(awk '/^## /{ h=$0; sub(/^## /, "", h); sub(/^[^A-Za-z]*/, "", h); p=(index(tolower(h), "next-session kickoff")==1) } /^# /{ p=0 } p' <<<"$prev")"
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

# waits_report <plan>: each waits-on reference resolved, one line each, and a banner when every
# wait is met. A reference: <slug> (met when completed or archived), <slug>:<phase> (met when that
# phase is ✅), fid:<id> (met when the followup is closed), <repo>/<slug> (another repo: not
# checkable here).
waits_report() {
  local plan="$1" v r s ph p pst mk total=0 met=0 unknown=0 msg
  v="$(field_value "$plan" waits-on)"
  if [ -z "$v" ]; then echo "waits-on: none"; return; fi
  while IFS= read -r r; do
    r="${r#"${r%%[![:space:]]*}"}"; r="${r%"${r##*[![:space:]]}"}"; [ -n "$r" ] || continue
    total=$((total+1))
    case "$r" in
      */*) echo "not checkable here: $r (another repo's project: check it there)" ;;
      fid:*)
        if [ ! -f "$journal" ]; then echo "not checkable here: $r (no journal.sh beside this skill)"
        elif msg="$(bash "$journal" show "${r#fid:}" 2>&1)"; then echo "waiting: $r (open)"
        elif [[ "$msg" == *"is not open"* ]]; then met=$((met+1)); echo "met: $r (closed in commit ${msg##* commit })"
        else unknown=$((unknown+1)); echo "UNKNOWN: $r (no such followup)"; fi ;;
      *)
        s="${r%%:*}"; ph=""; [ "$s" != "$r" ] && ph="${r#*:}"
        p=""; for x in "$dir"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-"$s"/PLAN.md "$dir"/_archive/[0-9][0-9][0-9][0-9]-[0-9][0-9]-"$s"/PLAN.md; do
          [ -f "$x" ] && { p="$x"; break; }; done
        if [ -z "$p" ]; then unknown=$((unknown+1)); echo "UNKNOWN: $r (no such project here, active or archived)"; continue; fi
        pst="$(frontmatter "$p" status)"
        if [ "$pst" = abandoned ]; then echo "ENDED: $r (abandoned: this wait will never be met — drop or replace it)"
        elif [[ "$p" == "$dir"/_archive/* ]]; then met=$((met+1)); echo "met: $r (archived)"
        elif [ "$pst" = completed ]; then met=$((met+1)); echo "met: $r (completed)"
        elif [ -z "$ph" ]; then echo "waiting: $r (${pst:-no status})"
        else
          mk="$(plan_section "$p" "Status" | phase_marks | awk -F'\t' -v c="$ph" '$1 == c "" { print ($2 == "" "" ? "no mark" : $2); f=1; exit } END { if (!f) print "?" }')"
          if [ "$mk" = "?" ]; then unknown=$((unknown+1)); echo "UNKNOWN: $r (no phase $ph in $s's Phase progress)"
          elif [ "$mk" = "✅" ]; then met=$((met+1)); echo "met: $r (✅)"
          else echo "waiting: $r ($mk)"; fi
        fi ;;
    esac
  done < <(tr ',' '\n' <<<"$v")
  [ "$total" -gt 0 ] && [ "$met" = "$total" ] && echo "BANNER: every wait is met — remove waits-on at the next /end-session"
  [ "$unknown" -gt 0 ] && echo "BANNER: $unknown wait(s) name nothing found here — fix waits-on"
  return 0
}

# --- claims: which session holds a project (per machine) ---
claims_dir="${XDG_STATE_HOME:-$HOME/.local/state}/project-claims"
sessions_dir="${CLAIMS_SESSIONS_DIR:-$HOME/.claude/sessions}"
json_str() { grep -o "\"$2\":\"[^\"]*\"" "$1" 2>/dev/null | head -1 | sed 's/^"[^"]*":"//; s/"$//'; }
json_num() { grep -o "\"$2\":[0-9]*" "$1" 2>/dev/null | head -1 | sed 's/^"[^"]*"://'; }
session_file() { grep -l "\"sessionId\":\"$1\"" "$sessions_dir"/*.json 2>/dev/null | head -1; }
claim_file() { printf '%s/%s' "$claims_dir" "$(readlink -f "$1" | sed 's#/#%#g')"; }
my_name() { local n=""; [ -n "${CLAUDE_PID:-}" ] && n="$(json_str "$sessions_dir/$CLAUDE_PID.json" name)"; printf '%s' "${n:-this session}"; }

# claim_take <plan>: warn about another holder, then record this session as the holder
claim_take() {
  local cf hid hname hf hs hu hst idle cts me="${CLAUDE_CODE_SESSION_ID:-}"
  cf="$(claim_file "$1")"
  if [ -f "$cf" ]; then
    IFS=$'\t' read -r hid hname cts _ <"$cf"
    if [ -n "$hid" ] && [ "$hid" != "$me" ]; then
      hf="$(session_file "$hid")"
      if [ -z "$hf" ]; then echo "NOTE: the last claim was by a session that has ended (${hname:-unnamed}): taking it over"
      else
        hname="$(json_str "$hf" name)"; hs="$(json_str "$hf" status)"; hu="$(json_num "$hf" statusUpdatedAt)"; hst="$(json_num "$hf" startedAt)"
        idle=$(( ( $(date +%s) - ${hu:-0} / 1000 ) / 60 ))
        # A relaunch (startedAt after the claim) resets statusUpdatedAt, so idle time alone calls an unused
        # tab live. Its status changing within RELAUNCH_QUIET_S of launch is the launch itself settling.
        if [ "$hs" != busy ] && [ -n "$hst" ] && [ "${cts:-0}" -lt $(( hst / 1000 )) ] && [ $(( ${hu:-0} - hst )) -lt $(( RELAUNCH_QUIET_S * 1000 )) ]; then
          echo "NOTE: claimed by ${hname:-unnamed} before it was relaunched, unused since: taking it over"
        elif [ "$hs" = busy ]; then
          echo "BANNER: another live session holds this project: ${hname:-unnamed} (busy) — two sessions closing one PLAN overwrite each other; confirm before working"
        elif [ "$idle" -lt "$WARM_MINUTES" ]; then
          echo "BANNER: another live session holds this project: ${hname:-unnamed} (idle $idle min) — two sessions closing one PLAN overwrite each other; confirm before working"
        else echo "NOTE: claimed by ${hname:-unnamed}, idle $((idle/60)) h: probably an abandoned tab; taking it over"; fi
      fi
    fi
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

given_plan="" # --waits and --plan-check take a PLAN path, read before the cd below
case "$mode" in waits|plancheck) given_plan="$(readlink -f "$slug" 2>/dev/null)" ;; *) section "SELECTION" ;; esac
top="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: not inside a git repository"; echo "BANNER: nothing to resume here"; exit 2; }
cd "$top" || exit 2
dir="$(bash "$here/../start-project/projects-dir.sh" 2>/dev/null)"
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

active_list() { # the active projects' folders, one per line
  local p; for p in "$dir"/*/PLAN.md; do
    [ -f "$p" ] && [ "$(frontmatter "$p" status)" = active ] && basename "$(dirname "$p")"
  done
}

plan=""
if [ -n "$slug" ]; then
  hits=(); for p in "$dir"/*-"$slug"/PLAN.md; do [ -e "$p" ] && hits+=("$p"); done
  case ${#hits[@]} in
    1) plan="${hits[0]}"; echo "requested: $slug" ;;
    0) echo "ERROR: no project matches '$slug'"
       for p in "$dir"/_archive/*-"$slug"/PLAN.md; do
         [ -e "$p" ] && echo "archived: $(basename "$(dirname "$p")") (closed; not resumable)"; done
       echo "active projects:"; active_list | sed 's/^/  /'
       echo "BANNER: '$slug' did not resolve — ask which"; exit 2 ;;
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

name="$(basename "$(dirname "$plan")")"; pslug="${name#[0-9][0-9][0-9][0-9]-[0-9][0-9]-}"
st="$(frontmatter "$plan" status)"; lu="$(frontmatter "$plan" last-updated)"
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
case "$plan" in
  "$top"/*) git check-ignore -q "$plan" && echo "NOTE: the projects folder is not tracked here: a PLAN edit never shows above, so anything listed is real work" ;;
  *) echo "NOTE: the projects folder is outside this repo: a PLAN edit never shows above" ;;
esac
if up="$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)"; then
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
# file), the other work since the save that touched it: count and newest commit. Reads `since`,
# `mine` and `plan` from CONTINUITY; prints nothing when no named path was touched.
kickoff_overlap() {
  local tok p cnt newest line hdr="" seen=$'\n'
  # shellcheck disable=SC2016  # a literal backtick pattern, nothing to expand
  while IFS= read -r tok; do
    p="${tok%%:*}"; p="${p%%#*}"
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
    echo "  $p: $cnt commit(s), newest: $newest"
  done < <(plan_section "$plan" "Next-session kickoff" | grep -o '`[^`]*`' | tr -d '`')
}

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
    grep -vxF -f <(printf '%s\n' "$mine") <<<"$after" | head -10 | sed 's/^/  /'
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

section "PLAN — STATUS"
# Printed in full whatever its size (its blockers are at the end), but an overgrown one is flagged:
# past about 15KB it costs every resume more than the rest of the read does.
sbytes="$(plan_section "$plan" "Status" | wc -c)"
[ "$sbytes" -gt 15000 ] && echo "BANNER: Status is $((sbytes/1000))KB, which makes every resume expensive — trim it at the next /end-session"
print_section "$plan" "Status"

section "PLAN — OPEN PUNCH-LIST"
punch="$(plan_section "$plan" "Punch-list")"
if [ -z "$punch" ]; then echo "NOTE: this PLAN has no punch-list"
else
  open="$(grep -c '^- \[ \]' <<<"$punch")"; closed="$(grep -c '^- \[[xX]\]' <<<"$punch")"
  echo "$open open / $((open+closed)) total"
  # a ### heading only when an open item follows it
  awk '/^### / { h=$0; next } /^- \[ \]/ { if (h!="") { print h; h="" } print }' <<<"$punch"
fi

if [ -n "$start" ]; then
  section "START (from the arguments: this session starts here; the kickoff below is context)"
  if [[ "$start" =~ ^(fid:)?[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
    f="${start#fid:}"
    if [ ! -f "$journal" ]; then echo "NOTE: no journal.sh beside this skill: '$start' is taken as words"; echo "words: $start"
    elif msg="$(bash "$journal" show "$f" 2>&1)"; then echo "fid: $f"; printf '%s\n' "$msg"
    elif [[ "$msg" == *"is not open"* ]]; then
      echo "NOTE: followup '$f' is closed: ${msg#*: }"
      c="${msg##* commit }"; c="${c%% *}"; git log -1 --format='  %h %s' "$c" 2>/dev/null
      echo "words: $start"
    else echo "NOTE: '$start' is not an open followup: taken as the operator's words"; echo "words: $start"; fi
  else echo "words: $start"; fi
fi

section "PLAN — NEXT-SESSION KICKOFF (word for word: this is the prompt)"
print_section "$plan" "Next-session kickoff"

section "PLAN — LAST SESSION LOG ENTRY"
log="$(plan_section "$plan" "Session log")"
if [ -z "$log" ]; then echo "ERROR: no \"Session log\" section — renamed? read it from the PLAN by its heading"
else
  entry="$(awk '/^- / { e=$0; next } /^[ \t]+[^ \t]/ && e!="" { e=e "\n" $0; next } END { if (e!="") print e }' <<<"$log")"
  echo "${entry:-NOTE: the session log has no entries yet}"
fi

section "RECENT COMMITS"
git log --oneline -10 2>/dev/null || echo "ERROR: git log failed"

section "END"
echo "PLAN: $plan ($(wc -c <"$plan") bytes). Read any other section by its heading, never the whole file."
echo "Writes only its claim, outside the repo; /end-session writes project state."
