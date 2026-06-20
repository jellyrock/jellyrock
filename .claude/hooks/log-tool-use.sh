#!/usr/bin/env bash
# Logs PostToolUse events for Read/Grep/Glob/Edit/Write/MultiEdit into a
# per-USER JSONL log (not per-worktree). The aggregator
# (scripts/agent-telemetry-report.cjs) reads the log to surface what files
# agents actually read vs. ignore — the signal we use to decide where to
# expand subdir CLAUDE.md coverage.
#
# Why per-user, not per-worktree: contributors who keep multiple worktrees
# (one per in-flight feature) for parallel work would
# otherwise have to consolidate per-worktree logs by hand before running
# the aggregator. A single user-home path makes "what have my agents been
# touching" a single npm command from any worktree.
#
# Default location: $HOME/.claude/jellyrock-telemetry/tool-use.jsonl
# Override: set JELLYROCK_TELEMETRY_DIR to point elsewhere.
#
# Failure mode: this hook MUST NOT block or fail an agent's tool call.
# Every error path is silenced and the script exits 0.

set +e

LOG_DIR="${JELLYROCK_TELEMETRY_DIR:-${HOME}/.claude/jellyrock-telemetry}"
LOG_FILE="$LOG_DIR/tool-use.jsonl"

mkdir -p "$LOG_DIR" 2>/dev/null

# jq is the only tool we need; if it's missing, log nothing rather than fail.
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

INPUT=$(cat)
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Normalize file/path/pattern across tools. Read/Write/Edit use file_path;
# Grep/Glob use pattern (+ optionally path). MultiEdit also uses file_path.
echo "$INPUT" | jq -c \
  --arg ts "$TIMESTAMP" \
  '{
    tool: (.tool_name // ""),
    file: (.tool_input.file_path // .tool_input.path // ""),
    pattern: (.tool_input.pattern // ""),
    timestamp: $ts,
    session: (.session_id // ""),
    cwd: (.cwd // "")
  }' >> "$LOG_FILE" 2>/dev/null

exit 0
