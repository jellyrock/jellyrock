#!/usr/bin/env bash
#
# catchup-state.sh — the one read /catchup makes (and /focus through it). It prints the repo's git
# position, the journal, the projects, this repo's own reader, the recent commits and, when this
# machine keeps a mailbox, the open messages other repos left this one,
# then one CANDIDATES block: every check that fired, as a typed line, ranked in code, so the model
# takes the first line instead of ordering banners itself. Sections are labeled `=== NAME ===` and
# read top to bottom.
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
#   - Copied journal text is never altered, but a printed line (fenced code aside) that starts like
#     this script's own lines (ERROR, BANNER, PIN, SLOT, FIX, INFO, CAVEAT or NOTE, then a colon or
#     a tab, after an indent, list marker or checkbox) reads as a live check, so a NOTE under its
#     section's header names it as journal text. It is never a candidate.
#   - Read-only: nothing in the repo is written, and no fetch is made (unpushed commits are counted
#     against the last fetch). The own reader may read the network, never write: a change to the
#     tree while it ran is reported as an ERROR candidate naming each changed path.
#   - A repo's own state (CI, PRs, pipelines, disk) is its own reader's job, not this one's.
#
# CANDIDATES: typed, tab-separated lines (free text never breaks the parse), only in that block. Each
# leads with its class and a tab (the one score /focus-all ranks every repo by): 1 on fire (ERROR,
# fire), 2 pinned (PIN), 3 resume (resume, SLOT 3), 4 overdue, 5 the judgment slot SLOT 5-6, 7 debt
# (debt, SLOT 7), `-` for FIX, INFO and CAVEAT; a detail line has none. After it:
#   ERROR<TAB><section><TAB><text>
#   BANNER<TAB><id><TAB><text><TAB><route: what to run; empty = /focus>
#   PIN<TAB><fid><TAB><title>             a pinned followup (journal.sh list), the oldest captured first
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
#   mail-pinned: pinned (class 2)  an open message its sender pinned; ranked with the pinned followups by date
#   mail-open: overdue            an open message from another repo about no project, once
#                                 CATCHUP_MAIL_OVERDUE_DAYS (14) old or undated; debt before that
#   followup-unblocked: overdue   an unpinned followup whose every waits-on wait is met (a pinned one
#                                 is a PIN line); its waits-on is then to be dropped or kept on purpose
#   followup-wait-broken: overdue a followup whose waits-on names nothing found, or an abandoned
#                                 project; never a PIN line. A followup still waiting is held out of
#                                 the ranking, pinned or not, and listed under Held followups.
#   followup-recheck: overdue     an unpinned followup whose only waits left are ones no script can
#                                 check, and every after: re-check date among them has passed (a
#                                 pinned one is a PIN line); check on it, then set a new date
#   project-recheck: overdue      the same for a project: its waits-on and [external-gate:] tags
#   cadence-unfilled: debt        the cadence table still holds its placeholder row
#   wait-no-recheck: debt         a followup or project waiting on something no script can check (a
#                                 person, an outside event, another repo's project outside a projects
#                                 home) with no after: re-check date; the followup is held meanwhile
#   wait-in-prose: debt           a followup title that names a date or a time after a wait word
#                                 (after, until, not before, on or after, at or after) and has no
#                                 waits-on marker; one line for all, a detail per followup
#   verify-first-format: debt     a PLAN's Verify first lines not in the `command` prints `value`
#                                 shape, one line per PLAN (the rest of the PLAN check is
#                                 plan-contradicts)
#   off-branch, unpushed, gate-missing, journal-shaped (a NOTE named a journal line): FIX
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
# WAITS_NOW=<time> sets the clock the after: waits read (resume-state.sh); a test that moves the
# date sets both.
# SKILLS_CONFIG_DIR=<a repo's .claude/skills folder> reads that repo's catchup.conf and journal.conf
# in place of the ones beside this script: a copy of it reading another repo (/focus-all).
# Exit: 0 read; 2 no journal to brief from, or not a git repository (the ERROR candidates say which),
# or the log skill's md-skip.awk is missing (said on stderr).

set -uo pipefail # not -e: one failed section must not stop the rest

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
journal_sh="$here/../log/journal.sh"
resolver="$here/../start-project/projects-dir.sh"
resume_sh="$here/../resume-project/resume-state.sh"
mailbox_sh="$here/../start-project/mailbox.sh"
conf_file="$here/catchup.conf"; [ -n "${SKILLS_CONFIG_DIR:-}" ] && conf_file="$SKILLS_CONFIG_DIR/catchup/catchup.conf"
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
declare -A SHARED=([dirty-tree]="2 1" [work-running]="4 1" [project-unblocked]="4 2" [mail-project]="4 3" [mail-pinned]="3 0"
  [journal-stale]="5 1" [wait-unknown]="5 2" [plan-contradicts]="5 3" [project-dormant]="5 4"
  [cadence-overdue]="5 5" [followups-unreviewed]="5 6" [mail-open]="5 7" [followup-unblocked]="5 8" [followup-wait-broken]="5 9"
  [followup-recheck]="5 10" [project-recheck]="5 11"
  [cadence-unfilled]="7 1" [verify-first-format]="7 2" [wait-no-recheck]="7 3" [wait-in-prose]="7 4"
  [off-branch]="9 1" [unpushed]="9 2" [gate-missing]="9 3" [journal-shaped]="9 4")
shared() { # <id> <text> [project slug] [detail...]: a shared check that fired, with its route;
  # AT="<rank> <position>" before the call ranks this one firing elsewhere (a message's age)
  local id="$1" r p route type=BANNER
  read -r r p <<<"${AT:-${SHARED[$id]}}"
  case "$id" in
    dirty-tree) route="look at it first: finish and commit it, or /resume-project {{slug}} if it is a project's" ;;
    work-running) route="check on it" ;;
    project-unblocked|wait-unknown|plan-contradicts|verify-first-format|project-dormant|mail-project|project-recheck) route="/resume-project $3" ;;
    mail-open) route="read it (bash .claude/skills/start-project/mailbox.sh show $3), act on it, then /done message $3" ;;
    mail-pinned) route="read it (bash .claude/skills/start-project/mailbox.sh show $3), act on it, then /done message $3${MPROJ:+; it is about project $MPROJ: /resume-project $MPROJ}" ;;
    followup-unblocked) route="act on it (journal.sh show $3); when you keep it, drop its waits: journal.sh replace $3 --waits-on \"\"" ;;
    followup-wait-broken) route="fix its waits-on: journal.sh replace $3 --waits-on \"{{list}}\"" ;;
    followup-recheck) route="check on what it waits on (journal.sh show $3), then set a new after: date (journal.sh replace $3 --waits-on \"…\") or close it" ;;
    wait-no-recheck) route="add a re-check date: for a followup, journal.sh replace {{fid}} --waits-on \"{{list}}, after:YYYY-MM-DD\"; for a project, after:YYYY-MM-DD in its waits-on at its next /end-session" ;;
    wait-in-prose) route="add the wait: journal.sh replace {{fid}} --waits-on \"after:YYYY-MM-DD\" (a time: after:YYYY-MM-DDTHH:MM with Z or an offset); or reword a title that only tells what happened" ;;
    journal-stale) route="/log what landed, or /done what finished" ;;
    followups-unreviewed) route="re-read each against today's state, then /done followup {{fid}}, or keep it with a dated Re-checked YYYY-MM-DD note (journal.sh replace)" ;;
    cadence-overdue) route="run the command its row names" ;;
    cadence-unfilled) route="fill the table (or say there are none)" ;;
    off-branch) route="confirm the branch" ;;
    unpushed) route="git push" ;;
    gate-missing) route="pre-commit install --allow-missing-config" ;;
    journal-shaped) route="reword each one in $3" ;;
    *) route="" ;;
  esac
  [ "$r" = 9 ] && type=FIX
  cand "$r" 1 "$p" "$type$TAB$id$TAB$2$TAB$route" "${@:4}"
}
finish() { # print the CANDIDATES block and END, and exit
  section "CANDIDATES"
  cand 6 0 0 "SLOT${TAB}5-6"; cand 8 0 0 "SLOT${TAB}7"
  # each line leads with its class, from its rank: the score /focus-all ranks every repo by
  printf '%s\n' "${CANDS[@]}" | LC_ALL=C sort -t "$TAB" -k1,1n -k2,2n -k3,3n -k4,4n \
    | awk -F'\t' 'BEGIN { split("1 1 2 3 4 5 7 7 - - -", c, " ") }
        { r = $1; for (i = 1; i <= 4; i++) sub(/^[^\t]*\t/, ""); print c[r] "\t" $0 }' | tr '\036' '\n'
  section "END"
  echo "Read-only: nothing here writes. Thresholds: journal ${stale_days:-14} days, project ${dormant_days:-21} days, message ${mail_days:-14} days (CATCHUP_JOURNAL_STALE_DAYS, CATCHUP_PROJECT_DORMANT_DAYS, CATCHUP_MAIL_OVERDUE_DAYS)."
  exit "$rc"
}

today="${CATCHUP_TODAY:-$(date -u +%F)}"
[[ $today =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { rc=2; serr REPO "CATCHUP_TODAY must be YYYY-MM-DD, not '$today'"; finish; }
stale_days="$(num CATCHUP_JOURNAL_STALE_DAYS "${CATCHUP_JOURNAL_STALE_DAYS:-14}" 14)"
dormant_days="$(num CATCHUP_PROJECT_DORMANT_DAYS "${CATCHUP_PROJECT_DORMANT_DAYS:-21}" 21)"
mail_days="$(num CATCHUP_MAIL_OVERDUE_DAYS "${CATCHUP_MAIL_OVERDUE_DAYS:-14}" 14)"
today_s="$(date -u -d "$today" +%s)"
# days_since <YYYY-MM-DD> -> whole days before today, or nothing if it is not a date
days_since() { local s; s="$(date -u -d "$1" +%s 2>/dev/null)" && echo $(( (today_s - s) / 86400 )); }
day_start() { date -u -d "$today - $1 days" +%FT00:00:00Z; } # the start of the day N days ago

# --- catchup.conf: read before the reader starts; its notes print under OWN READER ---
reader=""; reader_timeout=30; conf_notes=(); declare -A cls=() clspos=(); np=0
if [ ! -f "$conf_file" ]; then
  if [ -n "${SKILLS_CONFIG_DIR:-}" ]; then conf_notes+=("NOTE: no catchup.conf in ${conf_file%/*}: no own reader runs")
  else conf_notes+=("NOTE: no catchup.conf beside the shared reader: no own reader runs"); fi
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
# tree_state <array>: each path git status lists -> its status line and a content hash (hash-object
# without -w writes nothing; a deleted path has none), so a path changed again while dirty differs too
tree_state() {
  local -n _ts="$1"; local e p o=""
  _ts=()
  while IFS= read -r -d '' e; do
    p="${e:3}"; o=""
    case "${e:0:2}" in *[RC]*) IFS= read -r -d '' o ;; esac
    _ts["$p"]="$e|$o|$(git hash-object --no-filters -- "$p" 2>/dev/null)"
  done < <(git status --porcelain -z --untracked-files=all 2>/dev/null)
}
declare -A tree_before=() tree_after=()
if [ -n "$reader" ]; then
  if ! command -v timeout >/dev/null; then oerr "OWN READER" "no timeout command (coreutils): the own reader is not run"
  else
    tree_state tree_before
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
    # pinned followups, the oldest captured first, then in journal order (list still lists when check
    # fails: the error above says its counts are n/a, and the pins it does find are not hidden)
    if lst="$(jr list --tsv)"; then
      # its fields: category, fid, captured, age, prompt, title, pinned, waits-on; the prompt is
      # often empty, so the row is split on a separator that is not whitespace (read would merge
      # the empty field away). The PIN position is the captured date as a number; an undated pin
      # sorts last.
      lst="$(tr "$TAB" '\037' <<<"$lst")"
      # followups with a waits-on list: resolved in one call by /resume-project's reader (the one
      # resolver), which says free (every wait met), held, broken (a wait names nothing found or
      # an abandoned project), recheck (only waits no script can check are left, and every after:
      # date has passed) or unchecked (a wait no script can check, with no after: date) for each
      declare -A wst=() wdt=()
      wrows="$(awk -F'\037' '$8 != "" { print $2 "\t" $8 }' <<<"$lst")"
      if [ -n "$wrows" ]; then
        wl=""; wrc=0
        if [ ! -f "$resume_sh" ]; then echo "NOTE: no resume-state.sh beside this skill: followup waits are not resolved"
        else
          wl="$(bash "$resume_sh" --waits-list <<<"$wrows" 2>&1)"; wrc=$?
          [ "$wrc" = 0 ] || { wl=""; echo "NOTE: resume-state.sh --waits-list failed (exit $wrc): update /resume-project's script; followup waits are not resolved"; }
        fi
        while IFS=$'\t' read -r wf ws wd; do
          case "$ws" in free|held|broken|recheck|unchecked) wst[$wf]="$ws"; wdt[$wf]="$wd" ;; esac
        done <<<"$wl"
      fi
      npin=0; nheld=0; held_lines=()
      while IFS=$'\037' read -r _ wf wcap _ _ wt wp ww; do
        [ -n "$wf" ] || continue
        if [ -n "$ww" ] && [ -z "${wst[$wf]:-}" ]; then wst[$wf]=held; wdt[$wf]="not resolved"; fi
        case "${wst[$wf]:-none}" in
          held|broken|unchecked)
            nheld=$((nheld + 1)); held_lines+=("  $wf  ${wst[$wf]}  ${wdt[$wf]}${wp:+  [pinned]}")
            [ "${wst[$wf]}" = broken ] && shared followup-wait-broken "followup $wf waits on something not found or abandoned: ${wdt[$wf]}" "$wf"
            [ "${wst[$wf]}" = unchecked ] && shared wait-no-recheck "followup $wf waits on something no script can check, with no re-check date: ${wdt[$wf]}" "$wf" ;;
          *)
            if [ -n "$wp" ]; then
              wd="${wcap//-/}"; [[ $wd =~ ^[0-9]{8}$ ]] || wd=99999999
              cand 3 1 "$wd" "PIN$TAB$wf$TAB$wt"; npin=$((npin + 1))
            elif [ "${wst[$wf]:-none}" = free ]; then
              shared followup-unblocked "followup $wf no longer waits: every wait is met (${wdt[$wf]}): $wt" "$wf"
            elif [ "${wst[$wf]:-none}" = recheck ]; then
              shared followup-recheck "followup $wf: its re-check date passed (${wdt[$wf]}): $wt" "$wf"
            fi ;;
        esac
      done <<<"$lst"
      echo "pinned: $npin"
      echo "--- Held followups ($nheld) ---"
      if [ "$nheld" -gt 0 ]; then printf '%s\n' "${held_lines[@]}"; else echo "Nothing held."; fi
      # a title with no waits-on marker that names a time after a wait word: the wait was written in
      # prose only. A keyword as a whole word, then a date or a time within 30 characters, with no
      # "." or ";" between (plain tolower/index/substr/match: the same under gawk and mawk)
      mapfile -t prose_hits < <(awk -F'\037' '
        function hit(l, kw,   from, p, n, rest) {
          from = 1
          while ((p = index(substr(l, from), kw)) > 0) {
            p += from - 1
            if (substr(l, p - 1, 1) !~ /[a-z0-9_]/ && substr(l, p + length(kw), 1) !~ /[a-z0-9_]/) {
              rest = substr(l, p + length(kw), 30)
              n = index(rest, "."); if (n) rest = substr(rest, 1, n - 1)
              n = index(rest, ";"); if (n) rest = substr(rest, 1, n - 1)
              if (match(rest, /[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/) || match(rest, /[0-9]:[0-9][0-9]/)) return 1
            }
            from = p + length(kw)
          }
          return 0
        }
        $8 == "" && $2 != "" {
          l = " " tolower($6)
          if (hit(l, "after") || hit(l, "until") || hit(l, "not before") || hit(l, "on or after") || hit(l, "at or after"))
            print "  " $2 ": " $6
        }' <<<"$lst")
      if [ "${#prose_hits[@]}" -gt 0 ]; then
        shared wait-in-prose "${#prose_hits[@]} followup title(s) name a time with no waits-on marker" "" "${prose_hits[@]}"
      fi
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
    # and the cadence table are checked here: a check that fires is a \037-led "<id><TAB><text>" line;
    # a copied line shaped like this script's own findings is a \037-led "copied<TAB><line>" line,
    # printed under the section's header, before its text
    jout="$(awk -v today="$today" "$MD_LIB"'
      function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
      # shaped(l): l starts, after its indent, an optional list marker and an optional checkbox,
      # with a word this script types its own lines with, then a colon or a tab
      function shaped(l,   t) {
        t = l; sub(/^[ \t]+/, "", t); sub(/^([-*+]|[0-9]+\.)[ \t]+/, "", t); sub(/^\[[ xX]\][ \t]+/, "", t)
        return t ~ /^(ERROR|BANNER|PIN|SLOT|FIX|INFO|CAVEAT|NOTE)[:\t]/
      }
      function flush(   i) {
        if (name == "") return
        printf "--- %s (%d items) ---\n", name, items
        for (i = 1; i <= ncp; i++) print "\037copied\t" cp[i]
        for (i = 1; i <= nb; i++) print body[i]
        low = tolower(name)
        if (items > 0 && (low ~ /^batch jobs/ || low ~ /^currently running/))
          printf "\037work-running\twork running (%s): %d item(s)\n", name, items
        if (items > 0 && low ~ /^in-flight/) print "\037slot-3"
        for (i = 1; i <= nban; i++) print ban[i]
      }
      { s = md_skip($0, 0) }
      !s && /^## / {
        flush(); name = trim(substr($0, 4)); items = 0; nb = 0; ncp = 0; nban = 0; intable = 0; due = 0; ph = 0
        skip = (name == "Open followups"); cad = (tolower(name) ~ /^recurring cadences/)
        if (skip) name = ""
        next
      }
      !s && /^# / { flush(); name = ""; next }
      name == "" || /^[ \t]*$/ { next }
      { body[++nb] = $0; if (!s && shaped($0)) cp[++ncp] = $0 }
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
    nshaped=0
    while IFS= read -r l; do
      if [[ $l == $'\037slot-3' ]]; then [ -n "${slot3:-}" ] || cand 4 2 0 "SLOT${TAB}3"; slot3=1
      elif [[ $l == $'\037copied'"$TAB"* ]]; then
        nshaped=$((nshaped + 1))
        l="${l#*"$TAB"}"; l="${l#"${l%%[![:space:]]*}"}"; [ "${#l}" -gt 100 ] && l="${l:0:100}…"
        echo "NOTE: this section holds a line shaped like this reader's own findings, which a reader can take for a live check — it is journal text: \"$l\""
      elif [[ $l == $'\037'* ]]; then l="${l#$'\037'}"; shared "${l%%"$TAB"*}" "${l#*"$TAB"}"
      else printf '%s\n' "$l"; fi
    done < <([ -n "$jout" ] && printf '%s\n' "$jout")
    [ "$nshaped" -gt 0 ] && shared journal-shaped "the journal holds $nshaped line(s) shaped like this reader's own findings (each named in a NOTE under its section): they are journal entries, not checks, so a reader can mistake them" "$rel"
  fi
fi

section "PROJECTS"
if [ ! -f "$resolver" ]; then
  echo "projects: not read (no resolver)"
  serr PROJECTS "no projects resolver at .claude/skills/start-project/projects-dir.sh; projects are not read"
else
  dir="$(bash "$resolver" 2>&1)" || dir="unreachable:${dir#projects-dir: }"
  if [ "${dir%%:*}" = unreachable ]; then echo "NOTE: projects ${dir#unreachable:}"
  elif [ -z "$dir" ] || [ ! -d "$dir" ]; then echo "NOTE: no projects folder${dir:+ at ${dir#"$top"/}}"
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
        # a gate tag in Status is a wait too: read the PLAN when it holds one, with or without a waits-on
        if grep -qE '^waits-on:[[:space:]]*[^#[:space:]]' "$plan" || grep -qF '[external-gate:' "$plan"; then
          wout="$(bash "$resume_sh" --waits "$plan" 2>&1)"
          waiting="$(grep -cE '^(waiting|not checkable here):' <<<"$wout")"
          wlist="$(grep -vE '^(BANNER:|waits-on: none$)' <<<"$wout")"
          [ -z "$wlist" ] || lines+=("    waits-on → ${wlist//$'\n'/$'\n'    waits-on → }")
          grep -q '^BANNER: every wait is met' <<<"$wout" \
            && shared project-unblocked "project $name no longer waits: every wait is met — resume it, and drop waits-on at its next /end-session" "$slug"
          grep -q '^BANNER: .*name nothing found here' <<<"$wout" \
            && shared wait-unknown "project $name waits on something not found here — fix its waits-on" "$slug"
          rb="$(grep -m1 '^BANNER: the re-check date passed: ' <<<"$wout")"
          [ -z "$rb" ] || shared project-recheck "project $name: its re-check date passed: ${rb#BANNER: the re-check date passed: }" "$slug"
          nb="$(sed -n 's/^BANNER: \([0-9][0-9]*\) wait(s) no script can check have no re-check date.*/\1/p' <<<"$wout")"
          [ -z "$nb" ] || shared wait-no-recheck "project $name: $nb wait(s) no script can check have no re-check date" "$slug"
        fi
        # the PLAN check as a resume shows it: a real contradiction only; a kickoff older than the
        # skeleton is the writer's to fix at its next close, not a candidate here
        # A Verify first line in an older format is a kickoff to rewrite, not a contradiction: one
        # debt line per PLAN, counting them
        if pout="$(bash "$resume_sh" --plan-check "$plan" 2>&1)"; then
          vf=0
          while IFS= read -r b; do
            b="${b#BANNER: PLAN check: }"
            if [[ $b == "a Verify first line is not \`command\` prints \`value\`"* ]]; then vf=$((vf + 1))
            else shared plan-contradicts "project $name: its PLAN contradicts itself: $b" "$slug"; fi
          done < <(grep '^BANNER: PLAN check: ' <<<"$pout")
          [ "$vf" -gt 0 ] && shared verify-first-format "project $name: $vf Verify first line(s) are not \`command\` prints \`value\` (resume-state.sh --plan-check lists them)" "$slug"
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
  # a path that appeared, vanished or changed since before the reader started: a reader never writes
  tree_state tree_after; changed=()
  for p in "${!tree_before[@]}"; do [ "${tree_after[$p]-}" = "${tree_before[$p]}" ] || changed+=("$p"); done
  for p in "${!tree_after[@]}"; do [ -n "${tree_before[$p]+x}" ] || changed+=("$p"); done
  if [ "${#changed[@]}" -gt 0 ]; then
    mapfile -t changed < <(printf '%s\n' "${changed[@]}" | LC_ALL=C sort -u | sed 's/^/  /')
    oerr "OWN READER" "the tree changed while this repo's own reader ran (readers never write)" "${changed[@]}"
  fi
fi

section "RECENT COMMITS"
git log --oneline -10 2>/dev/null || serr "RECENT COMMITS" "git log failed"

# The open messages other repos left this one (the mailbox), through the shared helper: nothing on
# a machine with no mailbox. One about a project ranks with work to resume, any other as overdue.
# --pin adds the seventh column (pinned or empty); a backend from before it exits 2, and then the
# six-column list is read with every message unpinned.
m_out=""; m_nopin=0
if [ -f "$mailbox_sh" ]; then
  m_out="$(bash "$mailbox_sh" list --tsv --pin 2>/dev/null </dev/null)"; m_rc=$?
  if [ "$m_rc" = 2 ]; then m_nopin=1; m_out="$(bash "$mailbox_sh" list --tsv 2>/dev/null </dev/null)"; fi
fi
if [ -n "$m_out" ]; then
  section "MAILBOX"
  [ "$m_nopin" = 0 ] || echo "NOTE: the mailbox script has no --pin: pinned messages rank as unpinned; update the global setup"
  while IFS= read -r row; do
    # a tab is whitespace to read, which merges empty columns: split on a separator that is not
    IFS=$'\037' read -r mid mfrom msent mdays mproj mtitle mpin <<<"$(tr "$TAB" '\037' <<<"$row")"
    when="sent $msent, $mdays day(s) ago"; age="$mdays day(s) old"
    [ -n "$msent" ] || { when="undated"; age="undated"; }
    printf 'mail: %s from %s (%s)%s: %s%s\n' "$mid" "$mfrom" "$when" "${mproj:+, about $mproj}" "$mtitle" "${mpin:+  [pinned]}"
    if [ -n "$mpin" ]; then
      # ranked with the pinned followups: the position is the sent date as a number, undated last
      md="${msent//-/}"; [[ $md =~ ^[0-9]{8}$ ]] || md=99999999
      AT="3 $md" MPROJ="${mproj#[0-9][0-9][0-9][0-9]-[0-9][0-9]-}" shared mail-pinned "a pinned message from $mfrom, $age: $mtitle${mproj:+, about $mproj} (mail: $mid)" "$mid"
    elif [ -n "$mproj" ]; then
      shared mail-project "an open message from $mfrom about $mproj, $age: $mtitle (mail: $mid)" "${mproj#[0-9][0-9][0-9][0-9]-[0-9][0-9]-}"
    elif [ -n "$msent" ] && [[ $mdays =~ ^[0-9]+$ ]] && [ "$mdays" -lt "$mail_days" ]; then
      # younger than the threshold: debt; once it is that old, or undated, overdue
      AT="7 3" shared mail-open "an open message from $mfrom, $age: $mtitle (mail: $mid)" "$mid"
    else
      shared mail-open "an open message from $mfrom, $age: $mtitle (mail: $mid)" "$mid"
    fi
  done <<<"$m_out"
fi

finish
