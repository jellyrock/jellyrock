#!/usr/bin/env bash
# Claude Code Stop hook — invokes the tool-agnostic reminder script.
#
# Fires when the agent finishes its turn. Reminds the agent if files
# touched in this session are in any architecture doc's related-files,
# and that doc itself wasn't updated. The reminder is informational —
# the hook always exits 0 so it never blocks turn-end. Hard enforcement
# lives at PR time via scripts/docs-stale-blocking.cjs.
#
# Why a shell wrapper rather than calling node directly from
# settings.json: Claude Code passes JSON event data on stdin (we don't
# need it here, so it's discarded), and we want a stable point at which
# to add tool-specific behavior later if needed (e.g., short-circuit on
# certain session types). Same pattern as log-tool-use.sh.
#
# Failure mode: this hook MUST NOT block or fail an agent's turn.
# Every error path exits 0. Stderr is appended to a log file (rather
# than discarded) so a quietly-broken hook is diagnosable — without that
# log, a regression in the underlying script would silently stop firing
# reminders and you'd only notice when CI started rejecting PRs.

set +e

# Drain stdin without using it. Claude Code sends a JSON payload but
# the underlying check script reads git directly, not stdin.
cat >/dev/null

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

# Match the per-USER telemetry dir convention from log-tool-use.sh so
# all hook diagnostics live in one place.
LOG_DIR="${JELLYROCK_TELEMETRY_DIR:-${HOME}/.claude/jellyrock-telemetry}"
LOG_FILE="$LOG_DIR/check-touched-errors.log"
mkdir -p "$LOG_DIR" 2>/dev/null

# Run the reminder. Stdout flows to Claude Code (surfaced in next-turn
# context); stderr is captured to disk for postmortem on silent breakage.
node scripts/check-touched-related-files.cjs --quiet 2>>"$LOG_FILE"

exit 0
