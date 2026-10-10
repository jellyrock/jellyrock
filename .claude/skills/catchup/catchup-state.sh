#!/usr/bin/env bash
#
# catchup-state.sh — the one read /catchup makes (and /focus through it). It prints the repo's git
# position, the journal, the projects and this repo's own reader, then one CANDIDATES block: every
# check that fired, as a typed line, ranked in code, so the model takes the first line instead of
# ordering banners itself. Sections are labeled `=== NAME ===` and read top to bottom.
# Shared code: maintained upstream and updated in place. A local edit is not overwritten
# silently — it is reviewed (kept, or taken upstream) at the next update.
#
# Rules this script keeps:
#   - A section it cannot read is an ERROR candidate; it is never left out silently, since silence
#     reads as "checked and fine". A check that cannot apply says so in a NOTE line.
#   - Counts come from code, never from the model: followups from journal.sh, commits from git.
#     When journal.sh cannot vouch for its counts (its check fails), they are n/a, never a zero.
#   - The journal's followup bodies are never printed (they are most of its size); every other
#     `## ` section is printed as written.
#   - Read-only: nothing in the repo is written, and no fetch is made (unpushed commits are counted
#     against the last fetch). The own reader may read the network, never write.
#   - A repo's own state (CI, PRs, pipelines, disk) is its own reader's job, not this one's.
#
# CANDIDATES: typed, tab-separated lines (free text never breaks the parse), only in that block:
#   ERROR<TAB><section><TAB><text>
#   BANNER<TAB><id><TAB><text><TAB><route: what to run; empty = /focus>
#   PIN<TAB><fid><TAB><title>             a pinned followup (journal.sh list)
#   SLOT<TAB>5-6 | SLOT<TAB>7             where /focus weighs what no check forces; always printed
#   SLOT<TAB>3                            the journal's in-flight section has items: one no project
#                                         tracks is the pick here; printed only then
#   FIX<TAB><id><TAB><text><TAB><route>   a quick tree fix: never the pick, said before anything
#   INFO<TAB><id><TAB><text>              never a candidate
#   CAVEAT<TAB><id><TAB><text>            never a candidate; quoted on what it affects
#     <detail line: two spaces, under the typed line it belongs to>
# Ranked: ERROR, then BANNERs of class fire, PINs, class resume, SLOT 3, class overdue, SLOT 5-6,
# class debt, SLOT 7; then FIX, INFO, CAVEAT. So the first line is always the pick. Within a class: the
# own reader's lines before the shared ones, then each id's position (shared: SHARED below; own:
# catchup.conf line order), then print order.
#
# Shared checks (id: class; thresholds in days, an environment variable overrides one for a run):
#   dirty-tree: fire              the working tree has changes
#   work-running: resume          a Batch jobs / Currently running section has items
#   project-unblocked: resume     a project whose every wait is met
#   journal-stale: overdue        its date line older than CATCHUP_JOURNAL_STALE_DAYS (14), and
#                                 commits within that many days that landed since it last changed
#   wait-unknown: overdue         a wait that names nothing found here
#   plan-contradicts: overdue     resume-state.sh --plan-check (the check a resume shows)
#   project-dormant: overdue      status active, no wait unmet, and neither last-updated nor the
#                                 PLAN's last commit within CATCHUP_PROJECT_DORMANT_DAYS (21)
#   cadence-overdue: overdue      a Recurring cadences row past its next-due date
#   followups-unreviewed: overdue journal.sh review: followups not re-read within journal.conf's
#                                 review_days (off without it); the oldest three as details
#   cadence-unfilled: debt        the cadence table still holds its placeholder row
#   off-branch, unpushed, gate-missing: FIX
#
# This repo's own reader: catchup.conf beside this script (the repo's own file, never overwritten
# by an update), one key=value per line, `#` comments:
#   reader=<command>          run with bash -c from the repo root, after the tree is read, in
#                             parallel with the rest; absent: no own reader
#   reader_timeout=<seconds>  default 30; past it the reader is stopped and is an ERROR
#   class.<id>=<class>        fire, resume, overdue or debt, one line per own BANNER id; their
#                             order is the within-class order. FIX, INFO and CAVEAT need none.
# The reader prints typed lines as above (not PIN or SLOT); every other line passes through under
# OWN READER. A non-zero exit, a timeout, an id with no class, a malformed line or a line in the
# old `BANNER: …` shape is an ERROR; this script still exits 0.
#
# Usage: bash .claude/skills/catchup/catchup-state.sh   (from inside the repo)
# CATCHUP_TODAY=YYYY-MM-DD overrides today's date (tests); dates are UTC, as journal.sh's are.
# Exit: 0 read; 2 no journal to brief from, or not a git repository (the ERROR candidates say which),
# or the log skill's md-skip.awk is missing (said on stderr).

set -uo pipefail # not -e: one failed section must not stop the rest

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
journal_sh="$here/../log/journal.sh"
resolver="$here/../start-project/projects-dir.sh"
resume_sh="$here/../resume-project/resume-state.sh"
conf_file="$here/catchup.conf"
# MD_LIB: the awk function md_skip, the one rule for what is not a heading (CommonMark fenced code),
# read from the log skill's md-skip.awk, which every script that reads headings shares.
[ -r "$here/../log/md-skip.awk" ] || { echo "catchup-state: cannot read $here/../log/md-skip.awk: the log skill is incomplete" >&2; exit 2; }
MD_LIB="$(cat "$here/../log/md-skip.awk")"$'\n'
rc=0
TAB=$'\t'

section() { printf '\n=== %s ===\n' "$1"; }
num() { case "$2" in ''|*[!0-9]*) echo "NOTE: $1 must be a whole number of days, not '$2'; using $3" >&2; echo "$3" ;; *) echo "$2" ;; esac; }

# --- the candidate list: each record is "rank<TAB>owner<TAB>position<TAB>seq<TAB>line", its detail
# lines joined on \036; finish sorts them and prints the block ---
CANDS=(); seq=0
cand() { # <rank> <owner: 0 own, 1 shared> <position> <line> [detail...]
  local r="$1" o="$2" p="$3" l="$4" d; shift 4
  for d in "$@"; do l+=$'\036'"$d"; done
  CANDS+=("$r$TAB$o$TAB$p$TAB$((++seq))$TAB$l")
}
serr() { local s="$1" t="$2"; shift 2; cand 1 1 0 "ERROR$TAB$s$TAB$t" "$@"; } # a shared error
oerr() { local s="$1" t="$2"; shift 2; cand 1 0 0 "ERROR$TAB$s$TAB$t" "$@"; } # an own error
declare -A RANK=([fire]=2 [resume]=4 [overdue]=5 [debt]=7)
# shared ids: "<rank> <position>"; a shared id's class is fixed (catchup.conf cannot move it)
declare -A SHARED=([dirty-tree]="2 1" [work-running]="4 1" [project-unblocked]="4 2"
  [journal-stale]="5 1" [wait-unknown]="5 2" [plan-contradicts]="5 3" [project-dormant]="5 4"
  [cadence-overdue]="5 5" [followups-unreviewed]="5 6" [cadence-unfilled]="7 1"
  [off-branch]="9 1" [unpushed]="9 2" [gate-missing]="9 3")
shared() { # <id> <text> [project slug] [detail...]: a shared check that fired, with its route
  local id="$1" r p route type=BANNER
  read -r r p <<<"${SHARED[$id]}"
  case "$id" in
    dirty-tree) route="look at it first: finish and commit it, or /resume-project <slug> if it is a project's" ;;
    work-running) route="check on it" ;;
    project-unblocked|wait-unknown|plan-contradicts|project-dormant) route="/resume-project $3" ;;
    journal-stale) route="/log what landed, or /done what finished" ;;
    followups-unreviewed) route="re-read each against today's state, then /done followup <fid>, or keep it with a dated Re-checked YYYY-MM-DD note (journal.sh replace)" ;;
    cadence-overdue) route="run the command its row names" ;;
    cadence-unfilled) route="fill the table (or say there are none)" ;;
    off-branch) route="confirm the branch" ;;
    unpushed) route="git push" ;;
    gate-missing) route="pre-commit install" ;;
    *) route="" ;;
  esac
  [ "$r" = 9 ] && type=FIX
  cand "$r" 1 "$p" "$type$TAB$id$TAB$2$TAB$route" "${@:4}"
}
finish() { # print the CANDIDATES block and END, and exit
  section "CANDIDATES"
  cand 6 0 0 "SLOT${TAB}5-6"; cand 8 0 0 "SLOT${TAB}7"
  printf '%s\n' "${CANDS[@]}" | LC_ALL=C sort -t "$TAB" -k1,1n -k2,2n -k3,3n -k4,4n | cut -f5- | tr '\036' '\n'
  section "END"
  echo "Read-only: nothing here writes. Thresholds: journal ${stale_days:-14} days, project ${dormant_days:-21} days (CATCHUP_JOURNAL_STALE_DAYS, CATCHUP_PROJECT_DORMANT_DAYS)."
  exit "$rc"
}

today="${CATCHUP_TODAY:-$(date -u +%F)}"
[[ $today =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { rc=2; serr REPO "CATCHUP_TODAY must be YYYY-MM-DD, not '$today'"; finish; }
stale_days="$(num CATCHUP_JOURNAL_STALE_DAYS "${CATCHUP_JOURNAL_STALE_DAYS:-14}" 14)"
dormant_days="$(num CATCHUP_PROJECT_DORMANT_DAYS "${CATCHUP_PROJECT_DORMANT_DAYS:-21}" 21)"
today_s="$(date -u -d "$today" +%s)"
# days_since <YYYY-MM-DD> -> whole days before today, or nothing if it is not a date
days_since() { local s; s="$(date -u -d "$1" +%s 2>/dev/null)" && echo $(( (today_s - s) / 86400 )); }
day_start() { date -u -d "$today - $1 days" +%FT00:00:00Z; } # the start of the day N days ago

# --- catchup.conf: read before the reader starts; its notes print under OWN READER ---
reader=""; reader_timeout=30; conf_notes=(); declare -A cls=() clspos=(); np=0
if [ ! -f "$conf_file" ]; then conf_notes+=("NOTE: no catchup.conf beside the shared reader: no own reader runs")
else
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
    case "$line" in ''|'#'*) continue ;; *=*) ;; *) oerr catchup.conf "not a key=value line: '$line'"; continue ;; esac
    key="${line%%=*}"; val="${line#*=}"
    case "$key" in
      reader) reader="$val" ;;
      reader_timeout)
        if [[ $val =~ ^[1-9][0-9]*$ ]]; then reader_timeout="$val"
        else oerr catchup.conf "reader_timeout must be a whole number of seconds, 1 or more, not '$val'"; fi ;;
      class.?*)
        id="${key#class.}"
        if [ -n "${SHARED[$id]:-}" ]; then conf_notes+=("NOTE: catchup.conf: class.$id is ignored: a shared id's class is fixed")
        elif [ -z "${RANK[$val]:-}" ]; then oerr catchup.conf "class.$id must be fire, resume, overdue or debt, not '$val'"
        elif [ -n "${cls[$id]:-}" ]; then oerr catchup.conf "class.$id is set twice"
        else cls[$id]="$val"; clspos[$id]=$((++np)); fi ;;
      *) oerr catchup.conf "unknown key '$key' (known: reader, reader_timeout, class.<id>)" ;;
    esac
  done <"$conf_file"
  [ -n "$reader" ] || conf_notes+=("NOTE: catchup.conf names no reader")
fi

section "REPO"
top="$(git rev-parse --show-toplevel 2>/dev/null)" || { rc=2; serr REPO "not inside a git repository"; finish; }
cd "$top" || exit 2
branch="$(git symbolic-ref -q --short HEAD)" || branch="(detached HEAD)"
default=""; from=""
if ref="$(git symbolic-ref -q --short refs/remotes/origin/HEAD)"; then default="${ref#origin/}"; from="origin/HEAD"
else
  for b in main master; do
    git show-ref -q --verify "refs/remotes/origin/$b" && { default="$b"; from="origin/$b"; break; }
  done
fi
if [ -n "$default" ] && [ "$branch" != "$default" ]; then
  echo "branch: $branch (not the default $default)"
  shared off-branch "on branch $branch, not the default $default"
else echo "branch: $branch"; fi
if [ -n "$default" ]; then echo "default branch: $default (from $from)"
else echo "NOTE: no default branch known (no origin/HEAD, origin/main or origin/master); the branch is not checked"; fi

dirty="$(git status --porcelain 2>/dev/null)"
# the own reader starts only now, after the tree is read: a reader that writes cannot make the
# dirty tree come and go between runs. Its output goes to a file outside the repo.
own_pid=""; own_out=""
if [ -n "$reader" ]; then
  if ! command -v timeout >/dev/null; then oerr "OWN READER" "no timeout command (coreutils): the own reader is not run"
  else
    own_out="$(mktemp)"; trap 'rm -f "$own_out"' EXIT
    timeout "$reader_timeout" bash -c "$reader" >"$own_out" 2>&1 </dev/null &
    own_pid=$!
  fi
fi
if [ -n "$dirty" ]; then
  n="$(wc -l <<<"$dirty")"
  echo "worktree: DIRTY ($n files)"
  printf '%s\n' "$dirty" | sed 's/^/  /'
  shared dirty-tree "working tree is DIRTY ($n files) — a session may have ended without closing"
else echo "worktree: clean"; fi

if up="$(git rev-parse -q --abbrev-ref '@{upstream}' 2>/dev/null)"; then :
elif [ -n "$default" ] && git show-ref -q --verify "refs/remotes/origin/$default"; then up="origin/$default"
else up=""; fi
if [ -n "$up" ]; then
  ahead="$(git rev-list --count "$up..HEAD" 2>/dev/null || echo "?")"
  if [ "$ahead" = 0 ]; then echo "unpushed: 0 (against $up, as of the last fetch)"
  else
    echo "unpushed: $ahead (against $up, as of the last fetch)"
    git log --oneline "$up..HEAD" 2>/dev/null | head -10 | sed 's/^/  /'
    shared unpushed "$ahead commit(s) not pushed to $up (as of the last fetch)"
  fi
else echo "NOTE: no upstream and no origin default branch; unpushed commits are not checked"; fi

if [ -f .pre-commit-config.yaml ]; then
  hooks="$(git config core.hooksPath)" || hooks="$(git rev-parse --git-path hooks)"
  if [ -f "$hooks/pre-commit" ]; then echo "commit gate: installed"
  else
    echo "commit gate: configured, not installed"
    shared gate-missing ".pre-commit-config.yaml is here but its hook is not installed"
  fi
else echo "commit gate: none configured"; fi
echo "last commit: $(git log -1 --format='%h %s (%cs)' 2>/dev/null || echo NONE)"
echo "commits: $(git rev-list --count --since="$(day_start 7)" HEAD) in 7 days, $(git rev-list --count --since="$(day_start 14)" HEAD) in 14 days"

section "JOURNAL"
if [ ! -f "$journal_sh" ]; then
  echo "journal: not read (no journal script)"
  serr JOURNAL "no journal script at .claude/skills/log/journal.sh (the /log skill ships it); the journal is not read"
else
  jr() { JOURNAL_TODAY="$today" bash "$journal_sh" "$@" 2>&1; }
  if ! J="$(jr path)"; then echo "journal: not found"; serr JOURNAL "journal.sh could not find the journal: $J"
  elif rel="${J#"$top"/}"; echo "path: $rel"; [ ! -f "$J" ]; then
    echo "no journal at $rel"
    serr JOURNAL "no journal at $rel — bootstrap it with /log (followups, in-flight work, cadences) before /catchup can brief"
    rc=2
  else
    # its date, and the work that has landed since it last changed. Stale means work is landing
    # now that the journal has not seen: a repo gone quiet since is shown the count, not a
    # candidate (it would fire every run until someone edits the journal).
    if jdate="$(jr date)"; then
      age="$(days_since "$jdate")"; echo "last-updated: $jdate ($age days ago)"
    else age=""; echo "last-updated: n/a"; serr JOURNAL "${jdate#journal.sh: }"; fi
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
      [ "$recent" -gt 0 ] && shared journal-stale "the journal is $age days old and $recent commit(s) in the last $stale_days days landed since it last changed"
    fi

    echo "--- followups (journal.sh stats: category, entries, oldest in days) ---"
    if chk="$(jr check)"; then jr stats
    else
      probs="$(grep -v '^journal.sh:' <<<"$chk")"
      echo "followups: n/a"
      head -3 <<<"$probs" | sed 's/^/  /'
      serr JOURNAL "followup counts n/a — journal.sh check failed ($(grep -c . <<<"$probs") problem(s)); fix them, or convert an old journal with journal.sh migrate"
    fi
    # pinned followups, in journal order (list still lists when check fails: the error above says
    # its counts are n/a, and the pins it does find are not hidden)
    if lst="$(jr list --tsv)"; then
      # its fields: category, fid, captured, age, prompt, title, pinned; the prompt is often empty,
      # so split by awk (read would merge the empty field away)
      npin=0
      while IFS= read -r p; do cand 3 1 0 "PIN$TAB$p"; npin=$((npin+1)); done \
        < <(awk -F'\t' '$7 == "pinned" { print $2 "\t" $6 }' <<<"$lst")
      echo "pinned: $npin"
    else serr JOURNAL "pinned followups n/a — journal.sh list failed: ${lst#journal.sh: }"; fi

    # followups not re-read within the repo's review bound: journal.sh review's rows (fid, category,
    # reviewed, days, title; oldest first) and TOTAL (unreviewed, entries, review_days)
    if ! rv="$(jr review)"; then
      echo "followup review: n/a"; serr JOURNAL "followup review n/a — journal.sh review failed: ${rv#journal.sh: }"
    elif [[ $rv == "review: off"* ]]; then echo "followup review: off (review_days in journal.conf)"
    else
      IFS=$'\t' read -r _ nrev nent rdays < <(grep '^TOTAL'"$TAB" <<<"$rv")
      summary="$nrev of $nent followups not re-read in over $rdays days"
      echo "followup review: $summary"
      if [ "${nrev:-0}" -gt 0 ]; then
        rows="$(sed '1d;$d' <<<"$rv")"
        bycat="$(awk -F'\t' '!($2 in n) { o[++k] = $2 } { n[$2]++ } END { for (i = 1; i <= k; i++) printf "%s%s %d", (i > 1 ? ", " : ""), o[i], n[o[i]] }' <<<"$rows")"
        mapfile -t oldest < <(head -3 <<<"$rows" | awk -F'\t' '{ printf "  %sd: %s [fid: %s]\n", $4, $5, $1 }')
        shared followups-unreviewed "$summary: $bycat" "" "${oldest[@]}"
      fi
    fi

    # every other `## ` section as written (blank lines dropped), with its item count; running work
    # and the cadence table are checked here: a check that fires is a \037-led "<id><TAB><text>" line
    jout="$(awk -v today="$today" "$MD_LIB"'
      function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
      function flush(   i) {
        if (name == "") return
        printf "--- %s (%d items) ---\n", name, items
        for (i = 1; i <= nb; i++) print body[i]
        low = tolower(name)
        if (items > 0 && (low ~ /^batch jobs/ || low ~ /^currently running/))
          printf "\037work-running\twork running (%s): %d item(s)\n", name, items
        if (items > 0 && low ~ /^in-flight/) print "\037slot-3"
        for (i = 1; i <= nban; i++) print ban[i]
      }
      { s = md_skip($0, 0) }
      !s && /^## / {
        flush(); name = trim(substr($0, 4)); items = 0; nb = 0; nban = 0; intable = 0; due = 0; ph = 0
        skip = (name == "Open followups"); cad = (tolower(name) ~ /^recurring cadences/)
        if (skip) name = ""
        next
      }
      !s && /^# / { flush(); name = ""; next }
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
          if (!ph++) ban[++nban] = "\037cadence-unfilled\tthe Recurring cadences table still holds its <cadence-name> placeholder row — nothing tracks this repo'"'"'s periodic work"
          next }
        split($0, c, "|"); nm = trim(c[2]); nd = trim(c[due]); d = nd
        gsub(/[~*` \t]/, "", d)
        if (due && d ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/ && substr(d, 1, 10) < today)
          ban[++nban] = "\037cadence-overdue\tcadence overdue: " nm " (next due " nd ")"
        next
      }
      { intable = 0 }
      END { flush() }' "$J")"
    # SLOT 3: something is in flight, and whether a project already tracks it is the model's call
    # (an item is prose, often a pointer to its project): after every resume line, before overdue
    while IFS= read -r l; do
      if [[ $l == $'\037slot-3' ]]; then [ -n "${slot3:-}" ] || cand 4 2 0 "SLOT${TAB}3"; slot3=1
      elif [[ $l == $'\037'* ]]; then l="${l#$'\037'}"; shared "${l%%"$TAB"*}" "${l#*"$TAB"}"
      else printf '%s\n' "$l"; fi
    done < <([ -n "$jout" ] && printf '%s\n' "$jout")
  fi
fi

section "PROJECTS"
if [ ! -f "$resolver" ]; then
  echo "projects: not read (no resolver)"
  serr PROJECTS "no projects resolver at .claude/skills/start-project/projects-dir.sh; projects are not read"
else
  dir="$(bash "$resolver" 2>/dev/null)"
  if [ -z "$dir" ] || [ ! -d "$dir" ]; then echo "NOTE: no projects folder${dir:+ at ${dir#"$top"/}}"
  else
    echo "folder: ${dir#"$top"/}"
    lines=(); declare -A count=()
    for plan in "$dir"/*/PLAN.md; do
      [ -f "$plan" ] || continue
      name="$(basename "$(dirname "$plan")")"; slug="${name#[0-9][0-9][0-9][0-9]-[0-9][0-9]-}"
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
            && shared project-unblocked "project $name no longer waits: every wait is met — resume it, and drop waits-on at its next /end-session" "$slug"
          grep -q '^BANNER: .*name nothing found here' <<<"$wout" \
            && shared wait-unknown "project $name waits on something not found here — fix its waits-on" "$slug"
        fi
        # the PLAN check as a resume shows it: a real contradiction only; a kickoff older than the
        # skeleton is the writer's to fix at its next close, not a candidate here
        if pout="$(bash "$resume_sh" --plan-check "$plan" 2>&1)"; then
          while IFS= read -r b; do
            shared plan-contradicts "project $name: its PLAN contradicts itself: ${b#BANNER: PLAN check: }" "$slug"
          done < <(grep '^BANNER: PLAN check: ' <<<"$pout")
        else
          prc=$?
          [ -n "${pc_noted:-}" ] || { lines+=("NOTE: the PLAN check did not run (resume-state.sh --plan-check exit $prc): update /resume-project's script"); pc_noted=1; }
        fi
      fi
      newest="$lu"; [ -n "$lc" ] && [[ $lc > ${newest:-} ]] && newest="$lc"
      quiet="$(days_since "${newest:-x}")"
      if [ "$st" = active ] && [ "$waiting" -eq 0 ] && [ -n "$quiet" ] && [ "$quiet" -gt "$dormant_days" ]; then
        shared project-dormant "active project $name has not moved in $quiet days (last-updated ${lu:-?}, last commit ${lc:-not committed}; threshold $dormant_days days)" "$slug"
      fi
    done
    summary=""; for s in active paused draft; do [ -n "${count[$s]:-}" ] && summary+="${count[$s]} $s, "; done
    for s in "${!count[@]}"; do case "$s" in active|paused|draft) ;; *) summary+="${count[$s]} $s, " ;; esac; done
    summary="${summary%, }"; echo "${summary:-0 open}"
    [ "${#lines[@]}" -gt 0 ] && printf '%s\n' "${lines[@]}"
  fi
fi

section "OWN READER"
[ "${#conf_notes[@]}" -gt 0 ] && printf '%s\n' "${conf_notes[@]}"
if [ -n "$own_pid" ]; then
  echo "reader: $reader"
  wait "$own_pid"; own_rc=$?
  # its typed lines become candidates, each with the two-space detail lines under it; every other
  # line passes through here
  cur=""; ln=""; dets=()
  flush_own() { [ -n "$cur" ] && cand "${cur%%"$TAB"*}" 0 "$(cut -f2 <<<"$cur")" "$ln" "${dets[@]}"; cur=""; dets=(); }
  split_tab() { local s="$1"; F=(); while [[ $s == *"$TAB"* ]]; do F+=("${s%%"$TAB"*}"); s="${s#*"$TAB"}"; done; F+=("$s"); }
  malformed() { flush_own; cur="1${TAB}0"; ln="ERROR${TAB}OWN READER${TAB}malformed $1 line: it takes $2, tab-separated"; dets=("  $3"); }
  while IFS= read -r l || [ -n "$l" ]; do
    if [ -n "$cur" ] && [[ $l == "  "* ]]; then dets+=("$l"); continue; fi
    flush_own
    case "$l" in
      BANNER"$TAB"*|FIX"$TAB"*)
        split_tab "$l"; t="${F[0]}"
        if [ "${#F[@]}" -lt 3 ] || [ "${#F[@]}" -gt 4 ] || [ -z "${F[1]}" ] || [ -z "${F[2]}" ]; then
          malformed "$t" "an id, a text and an optional route" "$l"; continue; fi
        ln="$t$TAB${F[1]}$TAB${F[2]}$TAB${F[3]:-}"
        if [ "$t" = FIX ]; then cur="9${TAB}0"
        elif [ -n "${cls[${F[1]}]:-}" ]; then cur="${RANK[${cls[${F[1]}]}]}$TAB${clspos[${F[1]}]}"
        else cur="1${TAB}0"; dets=("  $l"); ln="ERROR${TAB}catchup.conf${TAB}no class for ${F[1]}"; fi ;;
      INFO"$TAB"*|CAVEAT"$TAB"*)
        split_tab "$l"; t="${F[0]}"
        if [ "${#F[@]}" -ne 3 ] || [ -z "${F[1]}" ] || [ -z "${F[2]}" ]; then malformed "$t" "an id and a text" "$l"; continue; fi
        ln="$l"; if [ "$t" = INFO ]; then cur="10${TAB}0"; else cur="11${TAB}0"; fi ;;
      ERROR"$TAB"*)
        split_tab "$l"
        if [ "${#F[@]}" -ne 3 ] || [ -z "${F[1]}" ] || [ -z "${F[2]}" ]; then malformed ERROR "a section and a text" "$l"; continue; fi
        ln="$l"; cur="1${TAB}0" ;;
      BANNER:*|ERROR:*|FIX:*|INFO:*|CAVEAT:*)
        cur="1${TAB}0"; dets=("  $l")
        ln="ERROR${TAB}OWN READER${TAB}old-style line (${l%%:*}: …): a reader prints tab-separated typed lines (see catchup-state.sh)" ;;
      *) printf '%s\n' "$l" ;;
    esac
  done <"$own_out"
  flush_own
  if [ "$own_rc" = 124 ]; then oerr "OWN READER" "the own reader did not finish within $reader_timeout s: $reader"
  elif [ "$own_rc" != 0 ]; then oerr "OWN READER" "the own reader exited $own_rc: $reader"; fi
fi

section "RECENT COMMITS"
git log --oneline -10 2>/dev/null || serr "RECENT COMMITS" "git log failed"

finish
