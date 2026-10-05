#!/usr/bin/env bash
#
# ci-triage-state.sh — the one read /ci-triage makes. Fetches one CI run, finds every job and step
# that failed, prints each failed job's diagnostic tail, and classifies each against this repo's
# gates.tsv, so the session spends its effort on the diagnosis rather than on forge calls and a log
# scroll. What to do about a failure stays with the skill.
#
# gates.tsv (beside this script, the repo's own file): one line per gate, tab-separated:
#   <step pattern>  <category>  [<sub-check pattern> | -]  [<banner>]
# The step pattern is a shell glob matched against the failed step's name. The sub-check pattern is
# an extended regex for a gate that wraps several checks in one step: the text after its last match
# in the job's log is reported as the sub-check. The banner is printed as a BANNER: line, for a
# gate whose obvious fix is the wrong one. Lines starting with # and blank lines are skipped.
#
# Contract with the skill:
#   * Read-only: `forge.sh run view` and `run log` only (forge.sh ships with the pr skill). It
#     never re-runs, cancels or comments on a run.
#   * Anything it cannot fetch or read prints an ERROR: or NOTE: line: silence never reads as clean.
#   * It classifies and never acts. Routing is the skill's.
#
# Exit codes:
#   0  the run failed (failure, timed_out or startup_failure); each failed job is reported
#   2  the run did not fail, or has not finished
#   3  the run could not be fetched or read, or jq is missing, or no run id was given
#
# Usage: bash ci-triage-state.sh <run-id>
# CI_TRIAGE_FIXTURE=<dir> reads <dir>/run.json and <dir>/log.txt in place of forge.sh (the tests);
# CI_TRIAGE_GATES=<file> reads another gates file.

set -uo pipefail # not -e: a section that fails must still let the later ones run

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required by $(basename "${BASH_SOURCE[0]}") but is not installed" >&2
  exit 3
fi

run_id="${1:-}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
gates_file="${CI_TRIAGE_GATES:-$here/gates.tsv}"
forge="$here/../pr/forge.sh"
fixture="${CI_TRIAGE_FIXTURE:-}"
# lines kept before the first error marker, and the most a tail prints
before=40; most=80

if [ -z "$run_id" ] && [ -z "$fixture" ]; then
  echo "usage: bash ci-triage-state.sh <run-id>" >&2
  exit 3
fi

section() { printf '\n=== %s ===\n' "$1"; }
err="$(mktemp)"; trap 'rm -f "$err"' EXIT

fetch_run() {
  if [ -n "$fixture" ]; then cat "$fixture/run.json" 2>"$err"
  else bash "$forge" run view "$run_id" 2>"$err"; fi
}
fetch_log() {
  if [ -n "$fixture" ]; then cat "$fixture/log.txt" 2>/dev/null
  else bash "$forge" run log "$run_id" 2>/dev/null; fi
}

# ------------------------------------------------------------------------------------------ run
section "RUN"
if [ -z "$fixture" ] && [ ! -f "$forge" ]; then
  echo "ERROR: could not fetch run $run_id: no forge.sh at $forge (it ships with the pr skill: install the forge set whole)"
  exit 3
fi
run_json="$(fetch_run)"
if [ -z "$run_json" ]; then
  echo "ERROR: could not fetch run ${run_id:-<fixture>}"
  [ -s "$err" ] && { echo "forge.sh said:"; sed 's/^/  /' "$err"; }
  echo "BANNER: read forge.sh's message above before assuming a bad run id: a missing ### Forge slot, a rejected field or an expired token looks nothing like a missing run"
  exit 3
fi
if ! parsed="$(printf '%s' "$run_json" | jq -r '[.status,.conclusion,.name,.event,.headBranch,.url]|map(. // "")|@tsv' 2>"$err")"; then
  echo "ERROR: could not parse the run payload"
  [ -s "$err" ] && { echo "jq said:"; sed 's/^/  /' "$err"; }
  echo "BANNER: the fetch worked but its JSON did not parse: do NOT read this as a run that is fine"
  exit 3
fi
IFS=$'\t' read -r status conclusion name event branch url <<<"$parsed"
printf 'run:    %s (%s on %s)\n' "$name" "$event" "$branch"
printf 'status: %s / %s\n' "$status" "$conclusion"
printf 'url:    %s\n' "$url"

if [ "$status" != completed ]; then
  echo "BANNER: this run is still $status: wait for it to finish, then triage it"
  exit 2
fi
case "$conclusion" in
  failure|timed_out|startup_failure) ;;
  *)
    echo "BANNER: this run did not fail (conclusion=$conclusion): nothing to triage"
    [ "$conclusion" = cancelled ] && echo "BANNER: a cancelled run is most often a newer push superseding it, not a defect"
    exit 2 ;;
esac
[ "$conclusion" = timed_out ] && echo "BANNER: the run hit a time limit: often a hang or a slow runner; read the tail, and re-run before changing code if nothing in it points at the code"

# ----------------------------------------------------------------------------------------- jobs
section "JOBS"
printf '%s' "$run_json" | jq -r '.jobs[]? | "  \(.conclusion // "?")\t\(.name)"' | sed -E 's/^  (failure|timed_out)/  FAILED (\1)/'

# one line per failed job: <job name><TAB><failed step, or empty>
failed="$(printf '%s' "$run_json" | jq -r '.jobs[]? | select(.conclusion=="failure" or .conclusion=="timed_out")
  | [.name, (first(.steps[]? | select(.conclusion=="failure" or .conclusion=="timed_out") | .name) // "")] | @tsv')"
if [ -z "$failed" ]; then
  if [ "$conclusion" = startup_failure ]; then
    echo "BANNER: the workflow never started: its file most likely does not parse, or a reusable workflow or permission it names is missing; read the run page"
  else
    echo "NOTE: the run failed but no job failed"
    echo "BANNER: the failure is at the workflow level (a cancelled dependency, a startup error, or a required check that never reported): read the run page"
  fi
  section "END"
  echo "Read-only: this script never re-runs, cancels or comments on a run."
  exit 0
fi

# --------------------------------------------------------------------------------------- gates
have_gates=1
if [ ! -f "$gates_file" ]; then
  have_gates=0
  echo "NOTE: no gates.tsv at $gates_file: every step classifies as unknown"
fi
# classify <step>: prints <category>\037<sub-check pattern>\037<banner> of the first matching line
classify() {
  local step="$1" line pat cat sub ban
  if [ "$have_gates" = 1 ] && [ -n "$step" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in ''|'#'*) continue ;; esac
      # \037, not a tab, as the separator read splits on: a tab IFS collapses an empty column
      IFS=$'\037' read -r pat cat sub ban <<<"${line//$'\t'/$'\037'}"
      # shellcheck disable=SC2053 # the pattern is a glob on purpose
      if [[ "$step" == $pat ]]; then
        [ "$sub" = - ] && sub=""
        printf '%s\037%s\037%s\n' "${cat:-unknown}" "$sub" "$ban"
        return
      fi
    done <"$gates_file"
  fi
  printf 'unknown\037\037\n'
}

# ----------------------------------------------------------------------------------------- log
log="$(fetch_log)"
# A gh log line is <job><TAB><step><TAB><timestamp> <text>; a log with no tabs is used whole.
prefixed=0; grep -q $'\t' <<<"$log" && prefixed=1
# job_log <job>: that job's lines, with the prefix, a byte-order mark and color codes removed (as
# escape bytes, and as the text ^[[ that gh writes for a step's echoed script)
job_log() {
  printf '%s\n' "$log" | awk -F'\t' -v job="$1" -v prefixed="$prefixed" '
    prefixed == 1 && $1 != job "" { next }
    {
      line = $0
      if (prefixed == 1) { sub(/^[^\t]*\t[^\t]*\t/, "", line) }
      gsub(/\357\273\277/, "", line)
      gsub(/\033\[[0-9;]*m/, "", line)
      gsub(/\^\[\[[0-9;]*m/, "", line)
      if (prefixed == 1) { sub(/^[0-9][0-9T:.Z-]* ?/, "", line) }
      if (line ~ /^[ \t]*$/ || line ~ /^##\[endgroup\]/) next
      print line
    }'
}
# tail_of: the diagnostic region of a job's log on stdin. With ##[error] markers: from <before>
# lines above the first marker to the last marker. Without: the last lines. At most <most> lines.
tail_of() {
  awk -v before="$before" -v most="$most" '
    { l[NR] = $0; if ($0 ~ /^##\[error\]/) { if (!fe) fe = NR; le = NR } }
    END {
      if (fe) { s = fe - before; e = le } else { e = NR; s = NR - most + 1 }
      if (s < 1) s = 1
      if (e - s + 1 > most + 0) s = e - most + 1
      for (i = s; i <= e; i++) print l[i]
    }'
}
# sub_check <pattern>: the text after the pattern's last match in a job's log on stdin. The pattern
# goes through the environment: -v would turn its backslashes into escapes.
sub_check() {
  SUB_PAT="$1" awk '
    match($0, ENVIRON["SUB_PAT"]) { v = substr($0, RSTART + RLENGTH) }
    END { sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v); print v }'
}

total="$(printf '%s\n' "$failed" | wc -l | tr -d ' ')"
n=0
while IFS=$'\t' read -r job step; do
  n=$((n + 1))
  section "FAILED JOB $n of $total: $job"
  printf 'step:     %s\n' "${step:-<none reported>}"
  IFS=$'\037' read -r cat subpat banner <<<"$(classify "$step")"
  printf 'category: %s\n' "$cat"
  jlog=""; [ -n "$log" ] && jlog="$(job_log "$job")"
  if [ -n "$subpat" ]; then
    sc="$(printf '%s\n' "$jlog" | sub_check "$subpat")"
    if [ -n "$sc" ]; then printf 'sub-check: %s\n' "$sc"
    else echo "BANNER: no line matched this gate's sub-check pattern: find the sub-check in the tail before assuming which check broke"; fi
  fi
  [ -n "$banner" ] && printf 'BANNER: %s\n' "$banner"
  [ "$cat" = unknown ] && [ -n "$step" ] && echo "BANNER: step '$step' is not in gates.tsv: classify it from the tail, and add a line for it to $gates_file"
  [ -z "$step" ] && echo "NOTE: the job failed but reports no failed step: classify it from the tail"
  echo "--- tail ---"
  if [ -z "$log" ]; then
    echo "NOTE: --log-failed returned nothing (logs expire, after 90 days by default)"
    echo "BANNER: no tail: the classification rests on the step name alone"
  elif [ -z "$jlog" ]; then
    echo "NOTE: the log holds no lines for job '$job'"
  else
    printf '%s\n' "$jlog" | tail_of
  fi
done <<<"$failed"

section "END"
echo "Read-only: this script never re-runs, cancels or comments on a run."
