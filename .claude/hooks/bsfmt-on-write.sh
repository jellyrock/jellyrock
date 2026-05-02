#!/usr/bin/env bash
# Claude Code PostToolUse hook — auto-format .bs / .brs files immediately
# after the agent writes them. The agent's equivalent of "format on save"
# for human devs using the BrighterScript extension.
#
# Why per-edit (not just pre-commit): the agent has no live editor
# integration. Without this hook, formatting drift accumulates across
# multiple edits and only surfaces at commit time (when lint-staged runs
# bsfmt --write). Per-edit format means the agent's *next* read of the
# file shows the canonical form — no surprise diff at commit, no risk of
# the agent writing more code based on a soon-to-be-rewritten layout.
#
# Why bsfmt only (not bslint / validate): bsfmt is fast (~500ms-1s) and
# operates on a single file with no project context. bslint and bsc
# require full project context (slow + the agent's mid-refactor state
# would surface lots of expected-transient errors); they stay at pre-push.
#
# Failure mode: silent on success (no context noise). On bsfmt parse
# error, surface stderr to stdout so the agent sees the issue in the
# next-turn context. Always exits 0 so this hook never blocks an edit.

set +e

# Drain stdin (Claude Code sends a JSON event payload). We need it for the
# file path, so capture instead of discard.
INPUT=$(cat)

# jq is the only dep beyond bsfmt. Skip silently if missing.
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Only act on .bs / .brs files. Anything else: silent no-op.
case "$FILE" in
  *.bs|*.brs) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" || exit 0

# Confirm the file exists at the expected path. bsfmt receives whatever the
# agent wrote (absolute or repo-relative). Resolve via the project dir.
if [ ! -f "$FILE" ]; then
  exit 0
fi

# Per-USER log for postmortem on silent breakage; matches the convention
# used by log-tool-use.sh and check-touched-related-files.sh.
LOG_DIR="${JELLYROCK_TELEMETRY_DIR:-${HOME}/.claude/jellyrock-telemetry}"
LOG_FILE="$LOG_DIR/bsfmt-on-write-errors.log"
mkdir -p "$LOG_DIR" 2>/dev/null

if ! command -v node >/dev/null 2>&1 || [ ! -x "./node_modules/.bin/bsfmt" ]; then
  # Tooling not present (no node, no node_modules) — nothing we can do.
  exit 0
fi

# Run bsfmt. If it fails (parse error, unwriteable file), surface stderr
# to the agent. Successful runs are silent — bsfmt --write outputs progress
# noise we don't want in the next-turn context.
ERR=$(./node_modules/.bin/bsfmt --write "$FILE" 2>&1)
EXIT=$?
if [ "$EXIT" -ne 0 ]; then
  echo "⚠️  bsfmt could not auto-format $FILE (exit $EXIT):"
  echo "$ERR"
  echo "[$(date -u +%FT%TZ)] $FILE exit=$EXIT" >>"$LOG_FILE"
  echo "$ERR" >>"$LOG_FILE"
fi

exit 0
