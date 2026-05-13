#!/usr/bin/env bash
# Claude Code SessionStart hook — advisory nudge when local journal / handoff
# state suggests actionable work waits.
#
# Sibling to check-progress-cursor.sh (Stop hook). Both wrap a .cjs nudge
# script that exits 0 silently when state is clean, prints one line when not.
#
# Why this exists: per CLAUDE.md's catchup-discipline rule, /catchup (or
# /focus for triage) should run at the start of any genuine new session. The
# rule is documented but easy to forget. This hook surfaces a soft nudge at
# the moment the session begins, only when state actually warrants
# attention — silent on clean repos so it doesn't become noise.
#
# Local-only by design: no `gh` calls, no network. Network-dependent banners
# (failed CI, PR review requested) surface in /focus itself when invoked.
# Cheap + offline-tolerant; can't slow session start or hit rate limits.
#
# Failure mode: this hook MUST NOT block or fail session start. The
# underlying script always exits 0; this wrapper does too.

set +e

# Drain stdin without using it. Claude Code sends a JSON payload but the
# underlying check script reads filesystem directly, not stdin.
cat >/dev/null

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

LOG_DIR="${JELLYROCK_TELEMETRY_DIR:-${HOME}/.claude/jellyrock-telemetry}"
LOG_FILE="$LOG_DIR/session-start-nudge-errors.log"
mkdir -p "$LOG_DIR" 2>/dev/null

# Stdout flows to Claude Code (surfaced in initial session context); stderr
# is captured to disk for postmortem on silent breakage.
node scripts/lint/session-start-nudge.cjs 2>>"$LOG_FILE"

exit 0
