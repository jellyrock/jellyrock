#!/usr/bin/env bash
#
# catchup-state.sh — the one read /catchup makes (and /focus through it). It prints the repo's git
# position, the journal and the projects, and prints every fixed-threshold check that fires as a
# BANNER line, so the model briefs instead of gathering and counting. Sections are labeled
# `=== NAME ===` and read top to bottom.
# Shared code: maintained upstream and updated in place. A local edit is not overwritten
# silently — it is reviewed (kept, or taken upstream) at the next update.
#
# Rules this script keeps:
#   - A section it cannot read prints an ERROR line; it is never left out silently, since silence
#     reads as "checked and fine". A check that cannot apply says so in a NOTE line.
#   - Counts come from code, never from the model: followups from journal.sh, commits from git.
#     When journal.sh cannot vouch for its counts (its check fails), they are n/a, never a zero.
#   - The journal's followup bodies are never printed (they are most of its size); every other
#     `## ` section is printed as written.
#   - Read-only: no writes, no fetches (unpushed commits are counted against the last fetch).
#   - A repo's own state (CI, PRs, pipelines, disk) is its own reader's job, not this one's.
#
# Banners and their thresholds (days; an environment variable overrides one for a run):
#   journal stale     its date line older than CATCHUP_JOURNAL_STALE_DAYS (14), and commits within
#                     that many days that the journal has not seen (landed since it last changed)
#   project dormant   status active, no wait still unmet, and neither last-updated nor the PLAN's
#                     last commit within CATCHUP_PROJECT_DORMANT_DAYS (21)
#   and, with no threshold: a dirty tree, the wrong branch, unpushed commits, a commit gate
#   configured but not installed, an overdue or never-filled cadence, running work, no journal,
#   a project whose every wait is met (unblocked), a wait that names nothing found, a PLAN that
#   contradicts itself (resume-state.sh --plan-check: the check a resume shows, never the writer's).
#
# Usage: bash .claude/skills/catchup/catchup-state.sh   (from inside the repo)
# CATCHUP_TODAY=YYYY-MM-DD overrides today's date (tests); dates are UTC, as journal.sh's are.
# Exit: 0 read; 2 no journal to brief from, or not a git repository (the ERROR lines say which).

set -uo pipefail # not -e: one failed section must not stop the rest

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
journal_sh="$here/../log/journal.sh"
resolver="$here/../start-project/projects-dir.sh"
resume_sh="$here/../resume-project/resume-state.sh"
rc=0

section() { printf '\n=== %s ===\n' "$1"; }
num() { case "$2" in ''|*[!0-9]*) echo "NOTE: $1 must be a whole number of days, not '$2'; using $3" >&2; echo "$3" ;; *) echo "$2" ;; esac; }

today="${CATCHUP_TODAY:-$(date -u +%F)}"
[[ $today =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "ERROR: CATCHUP_TODAY must be YYYY-MM-DD, not '$today'"; exit 2; }
stale_days="$(num CATCHUP_JOURNAL_STALE_DAYS "${CATCHUP_JOURNAL_STALE_DAYS:-14}" 14)"
dormant_days="$(num CATCHUP_PROJECT_DORMANT_DAYS "${CATCHUP_PROJECT_DORMANT_DAYS:-21}" 21)"
today_s="$(date -u -d "$today" +%s)"
# days_since <YYYY-MM-DD> -> whole days before today, or nothing if it is not a date
days_since() { local s; s="$(date -u -d "$1" +%s 2>/dev/null)" && echo $(( (today_s - s) / 86400 )); }
day_start() { date -u -d "$today - $1 days" +%FT00:00:00Z; } # the start of the day N days ago

section "REPO"
top="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "ERROR: not inside a git repository"; exit 2; }
cd "$top" || exit 2
branch="$(git symbolic-ref -q --short HEAD)" || branch="(detached HEAD)"
echo "branch: $branch"
default=""; from=""
if ref="$(git symbolic-ref -q --short refs/remotes/origin/HEAD)"; then default="${ref#origin/}"; from="origin/HEAD"
else
  for b in main master; do
    git show-ref -q --verify "refs/remotes/origin/$b" && { default="$b"; from="origin/$b"; break; }
  done
fi
if [ -n "$default" ]; then
  echo "default branch: $default (from $from)"
  [ "$branch" = "$default" ] || echo "BANNER: on branch $branch, not the default $default"
else echo "NOTE: no default branch known (no origin/HEAD, origin/main or origin/master); the branch is not checked"; fi

dirty="$(git status --porcelain 2>/dev/null)"
if [ -n "$dirty" ]; then
  echo "BANNER: working tree is DIRTY ($(wc -l <<<"$dirty") files) — a session may have ended without closing"
  printf '%s\n' "$dirty" | sed 's/^/  /'
else echo "worktree: clean"; fi

if up="$(git rev-parse -q --abbrev-ref '@{upstream}' 2>/dev/null)"; then :
elif [ -n "$default" ] && git show-ref -q --verify "refs/remotes/origin/$default"; then up="origin/$default"
else up=""; fi
if [ -n "$up" ]; then
  ahead="$(git rev-list --count "$up..HEAD" 2>/dev/null || echo "?")"
  if [ "$ahead" = 0 ]; then echo "unpushed: 0 (against $up, as of the last fetch)"
  else
    echo "BANNER: $ahead commit(s) not pushed to $up (as of the last fetch)"
    git log --oneline "$up..HEAD" 2>/dev/null | head -10 | sed 's/^/  /'
  fi
else echo "NOTE: no upstream and no origin default branch; unpushed commits are not checked"; fi

if [ -f .pre-commit-config.yaml ]; then
  hooks="$(git config core.hooksPath)" || hooks="$(git rev-parse --git-path hooks)"
  if [ -f "$hooks/pre-commit" ]; then echo "commit gate: installed"
  else echo "BANNER: .pre-commit-config.yaml is here but its hook is not installed — run: pre-commit install"; fi
else echo "commit gate: none configured"; fi
echo "last commit: $(git log -1 --format='%h %s (%cs)' 2>/dev/null || echo NONE)"
echo "commits: $(git rev-list --count --since="$(day_start 7)" HEAD) in 7 days, $(git rev-list --count --since="$(day_start 14)" HEAD) in 14 days"

section "JOURNAL"
if [ ! -f "$journal_sh" ]; then
  echo "ERROR: no journal script at .claude/skills/log/journal.sh (the /log skill ships it); the journal is not read"
else
  jr() { JOURNAL_TODAY="$today" bash "$journal_sh" "$@" 2>&1; }
  if ! J="$(jr path)"; then echo "ERROR: journal.sh could not find the journal: $J"
  elif rel="${J#"$top"/}"; echo "path: $rel"; [ ! -f "$J" ]; then
    echo "ERROR: no journal at $rel"
    echo "BANNER: no journal — bootstrap $rel (followups, in-flight work, cadences) before /catchup can brief"
    rc=2
  else
    # its date, and the work that has landed since it last changed. Stale means work is landing
    # now that the journal has not seen: a repo gone quiet since is shown the count, not a banner
    # (it would fire every run until someone edits the journal).
    if jdate="$(jr date)"; then
      age="$(days_since "$jdate")"; echo "last-updated: $jdate ($age days ago)"
    else age=""; echo "ERROR: ${jdate#journal.sh: }"; fi
    if last="$(git log -1 --format='%H%x09%h%x09%cs' -- "$J" 2>/dev/null)" && [ -n "$last" ]; then
      IFS=$'\t' read -r lsha lh lcs <<<"$last"; range="$lsha..HEAD"
      since="$(git rev-list --count "$range")"
      echo "last changed in commit $lh ($lcs); $since commit(s) since"
    else
      range=HEAD; since=0; [ -n "${jdate:-}" ] && since="$(git rev-list --count --since="${jdate}T00:00:00Z" HEAD)"
      echo "NOTE: the journal has never been committed; $since commit(s) since its date line"
    fi
    if [ -n "$age" ] && [ "$age" -gt "$stale_days" ]; then
      recent="$(git rev-list --count --since="$(day_start "$stale_days")" "$range")"
      [ "$recent" -gt 0 ] && echo "BANNER: the journal is $age days old and $recent commit(s) in the last $stale_days days landed since it last changed"
    fi

    echo "--- followups (journal.sh stats: category, entries, oldest in days) ---"
    if chk="$(jr check)"; then jr stats
    else
      probs="$(grep -v '^journal.sh:' <<<"$chk")"
      echo "ERROR: followup counts n/a — journal.sh check failed ($(grep -c . <<<"$probs") problem(s)); fix them, or convert an old journal with journal.sh migrate:"
      head -3 <<<"$probs" | sed 's/^/  /'
    fi

    # every other `## ` section as written (blank lines dropped), with its item count; running work
    # and the cadence table are checked here
    awk -v today="$today" '
      function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
      function flush(   i) {
        if (name == "") return
        printf "--- %s (%d items) ---\n", name, items
        for (i = 1; i <= nb; i++) print body[i]
        low = tolower(name)
        if (items > 0 && (low ~ /^batch jobs/ || low ~ /^currently running/))
          printf "BANNER: work running (%s): %d item(s)\n", name, items
        for (i = 1; i <= nban; i++) print ban[i]
      }
      /^[ \t]*(```|~~~)/ { fence = !fence }
      !fence && /^## / {
        flush(); name = trim(substr($0, 4)); items = 0; nb = 0; nban = 0; intable = 0; due = 0; ph = 0
        skip = (name == "Open followups"); cad = (tolower(name) ~ /^recurring cadences/)
        if (skip) name = ""
        next
      }
      !fence && /^# / { flush(); name = ""; next }
      name == "" || /^[ \t]*$/ { next }
      { body[++nb] = $0 }
      /^[ \t]*([-*+]|[0-9]+\.)[ \t]/ { items++; intable = 0; next }
      /^\|/ {
        if (!intable) { intable = 1; ncol = split($0, hc, "|")
          for (i = 1; i <= ncol; i++) if (tolower(trim(hc[i])) ~ /^next due/) due = i
          next }
        if ($0 ~ /^\|[-:| \t]+$/) next
        items++
        if (!cad) next
        if ($0 ~ /<cadence-name>/) {
          if (!ph++) ban[++nban] = "BANNER: the Recurring cadences table still holds its <cadence-name> placeholder row — nothing tracks this repo'"'"'s periodic work"
          next }
        split($0, c, "|"); nm = trim(c[2]); nd = trim(c[due]); d = nd
        gsub(/[~*` \t]/, "", d)
        if (due && d ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/ && substr(d, 1, 10) < today)
          ban[++nban] = "BANNER: cadence overdue: " nm " (next due " nd ")"
        next
      }
      { intable = 0 }
      END { flush() }' "$J"
  fi
fi

section "PROJECTS"
if [ ! -f "$resolver" ]; then
  echo "ERROR: no projects resolver at .claude/skills/start-project/projects-dir.sh; projects are not read"
else
  dir="$(bash "$resolver" 2>/dev/null)"
  if [ -z "$dir" ] || [ ! -d "$dir" ]; then echo "NOTE: no projects folder${dir:+ at ${dir#"$top"/}}"
  else
    echo "folder: ${dir#"$top"/}"
    lines=(); banners=(); declare -A count=()
    for plan in "$dir"/*/PLAN.md; do
      [ -f "$plan" ] || continue
      name="$(basename "$(dirname "$plan")")"
      st="$(awk 'NR==1 && $0!="---" { exit } NR>1 && $0=="---" { exit } NR>1 && $1=="status:" { print $2; exit }' "$plan")"
      case "$st" in completed|abandoned) continue ;; esac
      st="${st:-?}"; count[$st]=$(( ${count[$st]:-0} + 1 ))
      lu="$(awk 'NR==1 && $0!="---" { exit } NR>1 && $0=="---" { exit } NR>1 && $1=="last-updated:" { print $2; exit }' "$plan")"
      lc="$(git -C "$(dirname "$plan")" log -1 --format=%cs -- PLAN.md 2>/dev/null)"
      phase="$(grep -m1 -F '**Current phase:**' "$plan" | sed 's/.*\*\*Current phase:\*\*[[:space:]]*//')"
      # a long phase line is cut, and the cut says so: silence would read as the whole line
      [ "${#phase}" -gt 140 ] && phase="${phase:0:140}… [+$(( ${#phase} - 140 )) chars; the PLAN has the rest]"
      lua="$(days_since "${lu:-x}")"; lca="$(days_since "${lc:-x}")"
      line="  $name  status=$st  last-updated ${lu:-?}${lua:+ (${lua}d)}  "
      if [ -n "$lc" ]; then line+="last commit $lc (${lca}d)"; else line+="last commit: not committed"; fi
      lines+=("$line${phase:+ — $phase}")
      # what it waits on, resolved by /resume-project's reader (the one resolver); a project still
      # waiting is quiet by design, so it is never dormant
      waiting=0
      if [ ! -f "$resume_sh" ]; then
        [ -n "${resume_noted:-}" ] || { lines+=("NOTE: no resume-state.sh beside this skill: waits-on and the PLAN check are not run"); resume_noted=1; }
      else
        if grep -qE '^waits-on:[[:space:]]*[^#[:space:]]' "$plan"; then
          wout="$(bash "$resume_sh" --waits "$plan" 2>&1)"
          waiting="$(grep -cE '^(waiting|not checkable here):' <<<"$wout")"
          lines+=("$(grep -v '^BANNER:' <<<"$wout" | sed 's/^/    waits-on → /')")
          grep -q '^BANNER: every wait is met' <<<"$wout" \
            && banners+=("BANNER: project $name no longer waits: every wait is met — resume it, and drop waits-on at its next /end-session")
          grep -q '^BANNER: .*name nothing found here' <<<"$wout" \
            && banners+=("BANNER: project $name waits on something not found here — fix its waits-on")
        fi
        # the PLAN check as a resume shows it: a real contradiction only; a kickoff older than the
        # skeleton is the writer's to fix at its next close, not a banner here
        if pout="$(bash "$resume_sh" --plan-check "$plan" 2>&1)"; then
          while IFS= read -r b; do
            banners+=("BANNER: project $name: its PLAN contradicts itself: ${b#BANNER: PLAN check: }")
          done < <(grep '^BANNER: PLAN check: ' <<<"$pout")
        else
          prc=$?
          [ -n "${pc_noted:-}" ] || { lines+=("NOTE: the PLAN check did not run (resume-state.sh --plan-check exit $prc): update /resume-project's script"); pc_noted=1; }
        fi
      fi
      newest="$lu"; [ -n "$lc" ] && [[ $lc > ${newest:-} ]] && newest="$lc"
      quiet="$(days_since "${newest:-x}")"
      if [ "$st" = active ] && [ "$waiting" -eq 0 ] && [ -n "$quiet" ] && [ "$quiet" -gt "$dormant_days" ]; then
        banners+=("BANNER: active project $name has not moved in $quiet days (last-updated ${lu:-?}, last commit ${lc:-not committed}; threshold $dormant_days days)")
      fi
    done
    summary=""; for s in active paused draft; do [ -n "${count[$s]:-}" ] && summary+="${count[$s]} $s, "; done
    for s in "${!count[@]}"; do case "$s" in active|paused|draft) ;; *) summary+="${count[$s]} $s, " ;; esac; done
    summary="${summary%, }"; echo "${summary:-0 open}"
    [ "${#lines[@]}" -gt 0 ] && printf '%s\n' "${lines[@]}"
    [ "${#banners[@]}" -gt 0 ] && printf '%s\n' "${banners[@]}"
  fi
fi

section "RECENT COMMITS"
git log --oneline -10 2>/dev/null || echo "ERROR: git log failed"

section "END"
echo "Read-only: nothing here writes. Thresholds: journal $stale_days days, project $dormant_days days (CATCHUP_JOURNAL_STALE_DAYS, CATCHUP_PROJECT_DORMANT_DAYS)."
exit "$rc"
