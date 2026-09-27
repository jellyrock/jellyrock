#!/usr/bin/env bash
#
# resume-state.sh — the one read /resume-project makes. It picks the project, prints the PLAN
# sections a resume needs in full (Status, the open punch-list, the kickoff, the last session-log
# entry) and runs the continuity checks, so the model orients instead of gathering. Sections are
# labeled `=== NAME ===` and read top to bottom.
# Shared code: maintained upstream and updated in place. A local edit is not overwritten
# silently — it is reviewed (kept, or taken upstream) at the next update.
#
# Why not read the whole PLAN: a long-running project's PLAN grows past 100KB (its session log and
# Status), and a whole read either costs tens of thousands of tokens or is cut off.
#
# Rules this script keeps:
#   - A section it cannot find prints an ERROR line; it is never left out silently, since silence
#     reads as "checked and fine".
#   - Continuity findings are BANNER lines: advice the skill reports and the operator decides on.
#     Nothing here gates.
#   - Status and the kickoff are printed word for word: they are the prompt, not a summary.
#   - Read-only: no writes, no commits. /end-session owns project state.
#
# Usage: bash .claude/skills/resume-project/resume-state.sh [<slug>]   (from inside the repo)
# Exit: 0 a project was picked and every section printed; 2 no project could be picked (none
# active, several active, a slug matching none or several, no projects folder, not a git repo:
# the SELECTION lines say which); 3 the picked PLAN cannot be read.

set -uo pipefail # not -e: one failed section must not stop the rest

slug="${1:-}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

section "SELECTION"
top="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: not inside a git repository"; echo "BANNER: nothing to resume here"; exit 2; }
cd "$top" || exit 2
dir="$(bash "$here/../start-project/projects-dir.sh" 2>/dev/null)"
if [ -z "$dir" ] || [ ! -d "$dir" ]; then
  echo "ERROR: no projects folder at ${dir:-(the resolver answered nothing)}"
  echo "BANNER: nothing to resume; use /start-project"; exit 2
fi

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
  fi
fi

section "PLAN — STATUS"
# Printed in full whatever its size (its blockers are at the end), but an overgrown one is flagged:
# past about 30KB this section alone gets a resume's output cut off.
sbytes="$(plan_section "$plan" "Status" | wc -c)"
[ "$sbytes" -gt 30000 ] && echo "BANNER: Status is $((sbytes/1000))KB, which makes every resume expensive — trim it at the next /end-session"
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
echo "Read-only: /end-session writes project state."
