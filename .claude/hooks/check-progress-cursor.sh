#!/usr/bin/env bash
# Claude Code Stop hook — advisory nudge when docs/progress.md is stale or
# the Currently-running cursor likely points at shipped work.
#
# Sibling to check-touched-related-files.sh and check-touched-lint.sh; all
# three fire at end-of-turn. Fully advisory — exits 0 always; the user (or
# next-turn agent) decides whether to act.
#
# Why this exists: per CLAUDE.md's capture-discipline rule, the four
# journals (progress / decisions / signals / tech-debt) are load-bearing
# state. The mechanical close-loop on PR merge ships via
# .github/workflows/journal-sync.yml, but mid-session the cursor can drift
# (working on a new branch without /log running, or the previous work
# shipped and the cursor wasn't closed). This hook surfaces that drift
# during the agent's natural work cycle, before /catchup has to flag it.
#
# Failure mode: this hook MUST NOT block or fail an agent's turn. The
# underlying script always exits 0; this wrapper does too.

set +e

# Drain stdin without using it. Claude Code sends a JSON payload but the
# underlying check script reads git directly, not stdin.
cat >/dev/null

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

LOG_DIR="${JELLYROCK_TELEMETRY_DIR:-${HOME}/.claude/jellyrock-telemetry}"
LOG_FILE="$LOG_DIR/check-progress-cursor-errors.log"
mkdir -p "$LOG_DIR" 2>/dev/null

# Stdout flows to Claude Code (surfaced in next-turn context); stderr is
# captured to disk for postmortem on silent breakage.
node scripts/lint/progress-cursor-nudge.cjs --quiet 2>>"$LOG_FILE"

exit 0
