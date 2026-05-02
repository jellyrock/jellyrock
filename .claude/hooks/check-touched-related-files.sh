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
# Every error path is silenced and the script exits 0.

set +e

# Drain stdin without using it. Claude Code sends a JSON payload but
# the underlying check script reads git directly, not stdin.
cat >/dev/null

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

# Run the reminder. The script writes to stdout; Claude Code surfaces
# the output in the next-turn context so the agent can act on it.
node scripts/check-touched-related-files.cjs --quiet 2>/dev/null

exit 0
