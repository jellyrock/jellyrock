#!/usr/bin/env bash
#
# plan-run.sh — the mechanical parts of running a written plan. /sonnet's steps, and the parent that
# supervises a /sonnet sub-agent, call it instead of doing these by hand.
# Shared code: maintained upstream and updated in place. A local edit is not overwritten
# silently — it is reviewed (kept, or taken upstream) at the next update.
#
# Usage (from inside the repo):
#   bash .claude/skills/sonnet/plan-run.sh check <plan>
#       before any edit: whether the plan is for this repo (a vote over its Critical files: each Edit
#       or Delete row's file must be here, Create rows do not vote), which sections it has, and
#       whether its **Project:** line names a PLAN that can take the landing record. Plans kept in
#       one folder for every repo look alike, so a plan for another repo is a real risk.
#   … check --list <plan folder>
#       no plan named: the plans in that folder whose Critical files are all here, newest first
#   … scope <plan> <base>
#       after the run: every file changed in <base>..HEAD with its lines added and removed, and
#       any left uncommitted, against the plan's Critical files (the project PLAN's landing record
#       is expected, not out of plan); and where a push goes: the branch, its upstream, and how far
#       ahead and behind it is as of the last fetch (this script never fetches)
#   … land <plan> [--commit <rev>] [--dry-run]
#       the landing line in the Session log of the plan's project, last-updated bumped, committed
#       alone (a local edit where the projects folder is gitignored). Nothing when this session
#       holds the project: /end-session records the work then.
# Exit: check  0 LOCAL; 2 no plan named (--list printed the candidates); 3 the plan cannot be read;
#              4 locality FOREIGN, MIXED or UNKNOWN: confirm before any edit
#       scope  0 matches the plan; 1 differs; 3 an unreadable plan, or no base
#       land   0 recorded, already recorded, nothing to record, or left to /end-session;
#              2 cannot record (the message says the fix); 3 an unreadable plan
# Judgment stays with the caller: BANNER lines are what to raise, NOTE lines inform.
# PLAN_RUN_TODAY (YYYY-MM-DD) dates the landing line in tests.

set -uo pipefail # not -e: a failed section must not stop the rest

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
resolver="$here/../start-project/projects-dir.sh"
resume="$here/../resume-project/resume-state.sh"

section() { printf '\n=== %s ===\n' "$1"; }
die() { printf 'ERROR: %s\n' "$2"; exit "$1"; }

root="$(git rev-parse --show-toplevel 2>/dev/null)" || die 3 "not inside a git repository"

# abs <path>: the path made absolute from where the caller stands (before any cd)
abs() { case "$1" in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$PWD" "$1" ;; esac; }

# crit_rows <plan> -> "<KIND>\t<path>" per Critical files row, "UNPARSED\t<cell>" for a row with no
# backticked path. Read cell by cell, never by one anchored pattern: a File cell may carry prose
# after its path, and a row the parser cannot read must be reported, not dropped from the vote.
crit_rows() {
  awk -F'|' '
    /^## Critical files/ { f = 1; next }
    f && /^## / { exit }
    !f || !/^[[:space:]]*[|]/ || NF < 3 { next }
    {
      file = $2; change = $3
      if (file ~ /^[[:space:]]*File[[:space:]]*$/) next
      if (file ~ /^[[:space:]]*:?-+:?[[:space:]]*$/) next
      if (match(file, /`[^`]+`/)) path = substr(file, RSTART + 1, RLENGTH - 2)
      else { gsub(/^[[:space:]]+|[[:space:]]+$/, "", file); print "UNPARSED\t" file; next }
      kind = change; sub(/^[^A-Za-z]*/, "", kind); sub(/[^A-Za-z].*$/, "", kind)
      kind = toupper(kind); if (kind == "") kind = "UNKNOWN"
      print kind "\t" path
    }' "$1"
}
label() { local k="$1"; printf '%s%s' "${k:0:1}" "$(printf '%s' "${k:1}" | tr '[:upper:]' '[:lower:]')"; }

# project_line <plan> -> the **Project:** value from the header (before the first ## section), so
# a body that quotes the line is never mistaken for it; nothing when there is none
project_line() {
  awk '/^## / { exit } /^\*\*Project:\*\*/ { v = $0; sub(/^\*\*Project:\*\*[ \t]*/, "", v); sub(/[ \t].*$/, "", v); print v; exit }' "$1"
}

frontmatter() { awk -v f="$2" 'NR==1 && $0!="---" { exit } NR>1 && $0=="---" { exit } NR>1 && $1==f":" { print $2; exit }' "$1"; }

# resolve <value>: sets PSTATE (na|none|found|archived|unknown|ambiguous), PPLAN, PNAME, PMSG
resolve() {
  local v="$1" dir d n hits=() act=()
  PSTATE="" PPLAN="" PNAME="" PMSG=""
  if [ -z "$v" ]; then PSTATE=none; return; fi
  if [ "$v" = n/a ]; then PSTATE=na; return; fi
  dir="$(bash "$resolver" "$root" 2>/dev/null)" || dir="$root/docs/projects"
  matches() { [[ "$1" == "$v" ]] || { [[ "$1" =~ ^[0-9]{4}-[0-9]{2}-(.+)$ ]] && [[ "${BASH_REMATCH[1]}" == "$v" ]]; }; }
  for d in "$dir"/*/; do
    n="$(basename "$d")"; [ -f "$d/PLAN.md" ] || continue
    case "$n" in _*) continue ;; esac
    matches "$n" && hits+=("$n")
    [ "$(frontmatter "$d/PLAN.md" status)" = active ] && act+=("$n")
  done
  if [ "${#hits[@]}" -eq 1 ]; then
    PSTATE=found; PNAME="${hits[0]}"; PPLAN="$dir/$PNAME/PLAN.md"; return
  fi
  if [ "${#hits[@]}" -gt 1 ]; then
    PSTATE=ambiguous; PMSG="$v matches more than one project ($(IFS=,; l="${hits[*]}"; echo "${l//,/, }")); use the full name"; return
  fi
  for d in "$dir"/_archive/*/; do
    [ -d "$d" ] && matches "$(basename "$d")" && { PSTATE=archived; PMSG="project $v is archived, so its PLAN is closed: set the plan's **Project:** to n/a"; return; }
  done
  PSTATE=unknown; PMSG="no active project named $v under ${dir#"$root"/}. Active: $(IFS=,; l="${act[*]:-none}"; echo "${l//,/, }")"
}

# vote <plan> -> "<hit> <vote>" over the Critical files that are expected to exist
vote() {
  local kind path hit=0 n=0
  while IFS=$'\t' read -r kind path; do
    [ -n "$path" ] || continue
    case "$kind" in UNPARSED|CREATE) continue ;; esac
    n=$((n+1)); [ -e "$root/$path" ] && hit=$((hit+1))
  done < <(crit_rows "$1")
  echo "$hit $n"
}

# --- check -------------------------------------------------------------------------------------

do_list() {
  local dir="$1" all=() cands=() p h n
  section "SELECTION"
  [ -d "$dir" ] || { echo "ERROR: no plan folder at $dir"; echo "BANNER: no plan to offer: ask for the plan's path"; exit 2; }
  mapfile -t all < <(ls -1t "$dir"/*.md 2>/dev/null)
  for p in "${all[@]}"; do
    read -r h n < <(vote "$p")
    [ "$n" -gt 0 ] && [ "$h" -eq "$n" ] && cands+=("$p")
  done
  echo "plan folder: $dir (${#all[@]} plan(s), ${#cands[@]} local to this repo)"
  if [ "${#cands[@]}" -eq 0 ]; then echo "BANNER: no plan here is for this repo: ask for its path, or write one with /focus"; exit 2; fi
  printf 'candidate: %s\n' "${cands[@]}"
  echo "BANNER: no plan named: ask which of the ${#cands[@]} candidate(s) to run"
  exit 2
}

do_check() {
  local plan="$1" rows kind path hit=0 n=0 new=0 unp=0 miss="" locality want
  section "SELECTION"
  [ -f "$plan" ] && [ -r "$plan" ] || { echo "ERROR: no such plan file: $plan"; echo "BANNER: the named plan cannot be read: do not improvise a substitute"; exit 3; }
  echo "plan: $plan"
  echo "modified: $(date -r "$plan" '+%F %R' 2>/dev/null || echo unknown)"
  echo "size: $(wc -l <"$plan") lines, $(wc -c <"$plan") bytes"

  section "LOCALITY"
  rows="$(crit_rows "$plan")"
  if [ -z "$rows" ]; then
    echo "NOTE: no parseable Critical files table"; locality=UNKNOWN
    echo "BANNER: locality UNKNOWN: confirm this plan is for this repo before any edit"
  else
    while IFS=$'\t' read -r kind path; do
      [ -n "$path" ] || continue
      case "$kind" in
        UNPARSED) unp=$((unp+1)); printf 'UNPARSED  %s\n' "$path" ;;
        CREATE) new=$((new+1)); printf 'NEW   %s\n' "$path" ;;
        *) n=$((n+1))
           if [ -e "$root/$path" ]; then hit=$((hit+1)); printf 'HIT   %s\n' "$path"
           else printf 'MISS  %s\n' "$path"; miss="$miss $path"; fi ;;
      esac
    done <<<"$rows"
    echo "ratio: $hit/$n existing (plus $new to be created)"
    [ "$unp" -gt 0 ] && echo "BANNER: $unp Critical files row(s) could not be parsed: read them by hand; the vote ran WITHOUT them"
    [ "$n" -gt 0 ] && [ "$new" -gt "$n" ] && echo "BANNER: more files are created than exist to vote on: locality rests on thin evidence; confirm the repo"
    if [ "$n" -eq 0 ]; then locality=UNKNOWN; echo "BANNER: every Critical file is a Create: locality UNKNOWN, confirm the repo"
    elif [ "$hit" -eq "$n" ]; then locality=LOCAL
    elif [ "$hit" -eq 0 ]; then locality=FOREIGN
      echo "BANNER: locality FOREIGN: no Critical file is here, so this plan is almost certainly for another repo. Do NOT execute it; stop and confirm."
    else locality=MIXED
      echo "BANNER: locality MIXED: missing:$miss. Either the plan spans repos, or it edits a file that is not here: resolve each MISS before any edit."
    fi
  fi
  echo "locality: $locality"

  section "SECTIONS"
  for want in Context Approach 'Critical files' Verification 'Landing & closeout' 'does NOT do'; do
    if grep -qiE "^## .*$want" "$plan"; then echo "present: $want"; else echo "MISSING: $want"; fi
  done
  grep -qiE '^## .*Verification' "$plan" || echo "BANNER: no Verification section: the plan has no regression floor; run this repo's verification commands as the tail"

  section "PROJECT"
  resolve "$(project_line "$plan")"
  case "$PSTATE" in
    na) echo "project: n/a (nothing to record)" ;;
    none) echo "BANNER: the plan has no **Project:** line: ask which project it advances (or n/a) and add the line under its title" ;;
    found) echo "project: ${PNAME#[0-9][0-9][0-9][0-9]-[0-9][0-9]-} → ${PPLAN#"$root"/}"
           git -C "$root" check-ignore -q "$PPLAN" 2>/dev/null && echo "NOTE: the projects folder is gitignored: the landing record is a local edit" ;;
    archived) echo "BANNER: $PMSG" ;;
    unknown) echo "BANNER: no project named $(project_line "$plan") here (active: ${PMSG##*Active: })" ;;
    ambiguous) echo "BANNER: $PMSG" ;;
  esac

  section "END"
  echo "The plan is read in full by the caller, not by this script. This script writes nothing."
  [ "$locality" = LOCAL ] && exit 0
  exit 4
}

# --- scope -------------------------------------------------------------------------------------

do_scope() {
  local plan="$1" base="$2" rows kind path diff=0 landing="" f
  declare -A planned=() seen=()
  [ -f "$plan" ] && [ -r "$plan" ] || die 3 "no such plan file: $plan"
  git -C "$root" rev-parse -q --verify "$base^{commit}" >/dev/null || die 3 "not a commit: $base"
  resolve "$(project_line "$plan")"; [ "$PSTATE" = found ] && landing="${PPLAN#"$root"/}"
  rows="$(crit_rows "$plan")"
  while IFS=$'\t' read -r kind path; do
    [ -n "$path" ] || continue
    [ "$kind" = UNPARSED ] && { echo "UNPARSED  $path: compare it by hand"; continue; }
    planned["$path"]="$kind"
  done <<<"$rows"

  section "BRANCH"
  local br up counts
  br="$(git -C "$root" symbolic-ref --short -q HEAD)"
  up="$(git -C "$root" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"
  if [ -z "$br" ]; then echo "branch: none (a detached HEAD): a push needs a branch"
  elif [ -z "$up" ]; then echo "branch: $br has no upstream: the first push sets one (git push -u)"
  else
    counts="$(git -C "$root" rev-list --left-right --count "$up...HEAD")"
    echo "branch: $br → $up: ${counts##*[[:space:]]} ahead, ${counts%%[[:space:]]*} behind (as of the last fetch)"
  fi

  section "COMMITTED SINCE $(git -C "$root" rev-parse --short "$base")"
  local add del size
  while IFS=$'\t' read -r add del path; do
    [ -n "$path" ] || continue
    seen["$path"]=1
    if [ "$add" = - ]; then size="binary"; else size="+$add -$del"; fi
    if [ -n "${planned[$path]:-}" ]; then echo "in plan: $path ($size)"
    elif [ "$path" = "$landing" ]; then echo "landing record: $path ($size)"
    else echo "NOT IN PLAN: $path ($size)"; diff=1; fi
  done < <(git -C "$root" diff --numstat --no-renames "$base" HEAD)
  for path in "${!planned[@]}"; do
    [ -n "${seen[$path]:-}" ] || { echo "untouched: $path ($(label "${planned[$path]}"))"; diff=1; }
  done

  section "UNCOMMITTED"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    echo "uncommitted: ${f:3}"; diff=1
  done < <(git -C "$root" status --porcelain)

  section "END"
  if [ "$diff" -eq 0 ]; then echo "RESULT: matches the plan"; exit 0; fi
  echo "RESULT: differs from the plan: each line above that is not 'in plan' is for the caller to explain"
  exit 1
}

# --- land --------------------------------------------------------------------------------------

do_land() {
  local plan="$1" rev="$2" dry="$3" v rel sha subject today line tmp ignored=0 slug
  [ -f "$plan" ] && [ -r "$plan" ] || die 3 "no such plan file: $plan"
  v="$(project_line "$plan")"; resolve "$v"
  case "$PSTATE" in
    none) die 2 "$plan has no **Project:** line in its header. Add **Project:** <project slug> under the title, or **Project:** n/a when the plan advances no tracked project" ;;
    na) echo "Project: n/a — nothing to record"; exit 0 ;;
    archived|unknown|ambiguous) die 2 "$PMSG" ;;
  esac
  rel="${PPLAN#"$root"/}"; slug="${PNAME#[0-9][0-9][0-9][0-9]-[0-9][0-9]-}"
  if [ -f "$resume" ] && (cd "$root" && bash "$resume" --holder "$slug" >/dev/null 2>&1); then
    echo "NOTE: this session holds $PNAME: /end-session records it; nothing written"; exit 0
  fi
  sha="$(git -C "$root" rev-parse --short "$rev" 2>/dev/null)" || die 2 "not a commit: $rev"
  subject="$(git -C "$root" log -1 --format=%s "$rev")"
  if grep -qF "\`$sha\`" "$PPLAN"; then echo "\`$sha\` is already recorded in $rel"; exit 0; fi
  git -C "$root" check-ignore -q "$PPLAN" 2>/dev/null && ignored=1
  if [ "$ignored" -eq 0 ] && [ -n "$(git -C "$root" status --porcelain -- "$PPLAN")" ]; then
    die 2 "$rel has uncommitted edits; commit or set them aside first, because this commits the PLAN on its own"
  fi
  grep -qE '^## .*Session log' "$PPLAN" || die 2 "$rel has no Session log section to append to"
  today="${PLAN_RUN_TODAY:-$(date +%F)}"
  line="- $today — **Landed from a /focus plan, outside a project session:** \`$sha\` $subject (plan \`$(basename "$plan")\`). Status and the kickoff were not updated; /resume-project reconciles them against git log."
  if [ "$dry" = 1 ]; then printf 'would append to %s:\n%s\n' "$rel" "$line"; exit 0; fi

  # the line goes after the Session log's last non-blank line (the section ends at the next # or ##
  # heading); an empty log gets a blank line, then the line. last-updated changes in the frontmatter only.
  tmp="$(mktemp)"
  LINE="$line" TODAY="$today" awk '
    { l[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) if (l[i] ~ /^## .*Session log/) { s = i; break }
      e = NR + 1
      for (i = s + 1; i <= NR; i++) if (l[i] ~ /^##? /) { e = i; break }
      first = s + 1; past = NR + 1
      at = e; while (at > s + 1 && l[at - 1] ~ /^[[:space:]]*$/) at--
      fm = (l[1] == "---"); done = 0
      for (i = 1; i <= NR; i++) {
        if (i == at + 0) { if (at == first + 0) print ""; print ENVIRON["LINE"] }
        if (fm && i > 1 && l[i] == "---") fm = 0
        if (fm && !done && l[i] ~ /^last-updated:/) { print "last-updated: " ENVIRON["TODAY"]; done = 1; continue }
        print l[i]
      }
      if (at == past + 0) { if (at == first + 0) print ""; print ENVIRON["LINE"] }
    }' "$PPLAN" >"$tmp" && cat "$tmp" >"$PPLAN"; rm -f "$tmp"

  if [ "$ignored" -eq 1 ]; then
    echo "recorded \`$sha\` in $rel as a local edit (the projects folder is gitignored): not committed"; exit 0
  fi
  local out
  if ! out="$(git -C "$root" commit -q -m "$slug: log a /focus plan landing ($sha)" -- "$PPLAN" 2>&1)"; then
    printf '%s\n' "$out"
    die 2 "the commit failed; the PLAN edit stays in the tree: fix what the hook found and commit $rel by hand"
  fi
  echo "recorded \`$sha\` in $rel as $(git -C "$root" rev-parse --short HEAD)"
}

# --- dispatch ----------------------------------------------------------------------------------

cmd="${1:-}"; [ $# -gt 0 ] && shift
case "$cmd" in
  check)
    case "${1:-}" in
      --list) [ -n "${2:-}" ] || die 2 "check --list <plan folder>"; do_list "$(abs "$2")" ;;
      "") section "SELECTION"; echo "ERROR: name the plan, or --list <plan folder>"; exit 2 ;;
      *) do_check "$(abs "$1")" ;;
    esac ;;
  scope)
    [ -n "${1:-}" ] && [ -n "${2:-}" ] || die 3 "usage: plan-run.sh scope <plan> <base>"
    do_scope "$(abs "$1")" "$2" ;;
  land)
    plan="${1:-}"; [ -n "$plan" ] || die 3 "usage: plan-run.sh land <plan> [--commit <rev>] [--dry-run]"; shift
    rev=HEAD dry=0
    while [ $# -gt 0 ]; do
      case "$1" in --commit) rev="${2:-}"; shift 2 ;; --dry-run) dry=1; shift ;; *) die 3 "unknown option: $1" ;; esac
    done
    do_land "$(abs "$plan")" "$rev" "$dry" ;;
  *) die 3 "usage: plan-run.sh check <plan> | check --list <folder> | scope <plan> <base> | land <plan> [--commit <rev>] [--dry-run]" ;;
esac
