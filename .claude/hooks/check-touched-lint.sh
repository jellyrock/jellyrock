#!/usr/bin/env bash
# Claude Code Stop hook — runs lint categories the IDE doesn't cover, scoped
# to files the agent changed in this session. Sibling to
# check-touched-related-files.sh; both fire at end-of-turn.
#
# Why this exists: CLAUDE.md tells the agent not to run `npm run lint:*`
# manually. That rule incidentally leaves the agent blind to spelling /
# markdown / JSON failures until `git push` time — by which point the agent
# has already reported "done" and the user has to debug. This hook closes
# the gap by surfacing those failures *during* the session, in time for the
# agent to fix before declaring done.
#
# Failure mode: this hook MUST NOT block or fail an agent's turn. The
# underlying script always exits 0; this wrapper does too. Hard enforcement
# is the pre-push hook.

set +e

# Drain stdin without using it. Claude Code sends a JSON payload but the
# underlying check script reads git directly, not stdin.
cat >/dev/null

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

# Match the per-USER telemetry dir convention from log-tool-use.sh so all
# hook diagnostics live in one place.
LOG_DIR="${JELLYROCK_TELEMETRY_DIR:-${HOME}/.claude/jellyrock-telemetry}"
LOG_FILE="$LOG_DIR/check-touched-lint-errors.log"
mkdir -p "$LOG_DIR" 2>/dev/null

# Stdout flows to Claude Code (surfaced in next-turn context); stderr is
# captured to disk for postmortem on silent breakage.
node scripts/lint/check-touched-lint.cjs --quiet 2>>"$LOG_FILE"

exit 0
