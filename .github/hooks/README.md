# `.github/hooks/`

Hook configuration for the **GitHub Copilot Coding Agent** — the GitHub-hosted agent variant that runs on the platform's infrastructure (e.g., when a Copilot-assigned issue produces a PR).

This is **not** consumed by in-IDE Copilot Chat. The IDE variant has no end-of-session hook surface; for it, the only enforcement is at PR time via [`.github/workflows/lint-docs.yml`](../workflows/lint-docs.yml).

## What's here

[`hooks.json`](hooks.json) wires two `sessionEnd` entries — both informational, both surface output to the agent's next-turn context, both call tool-agnostic Node scripts that the Claude Code wrappers in [`.claude/hooks/`](../../.claude/hooks/) also use:

1. [`scripts/lint/check-touched-related-files.cjs`](../../scripts/lint/check-touched-related-files.cjs) — prints a reminder for any architecture doc whose `related-files:` list intersects the files touched this session, when the doc itself wasn't also updated. Mirrored at [`.claude/hooks/check-touched-related-files.sh`](../../.claude/hooks/check-touched-related-files.sh).
2. [`scripts/lint/check-touched-lint.cjs`](../../scripts/lint/check-touched-lint.cjs) — runs spelling / markdown / JSON lint on changed files so failures surface *during* the agent session instead of at `git push` time. Mirrored at [`.claude/hooks/check-touched-lint.sh`](../../.claude/hooks/check-touched-lint.sh).

## Why these exist

Both reminders are informational, not blocking. Hard enforcement lives in the PR-time CI gates and the pre-push hook. The end-of-session hooks are *soft prompts* that land at the moment the agent is deciding whether work is done — the goal is for the agent to fix issues in-context, not for the user to discover them at `git push` time.

See [`docs/architecture/build-and-tooling.md`](../../docs/architecture/build-and-tooling.md) (the "Doc-maintenance enforcement" and "End-of-turn lint feedback for agents" sections) for the design rationale.

## Schema reference

The Coding Agent's hook schema is documented at <https://docs.github.com/en/copilot/reference/hooks-configuration>. Supported events include `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, and `errorOccurred`. Each entry takes `type`, `bash` / `powershell`, and optional `cwd`, `timeoutSec`, `env`, `comment`.
