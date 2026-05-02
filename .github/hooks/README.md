# `.github/hooks/`

Hook configuration for the **GitHub Copilot Coding Agent** — the GitHub-hosted agent variant that runs on the platform's infrastructure (e.g., when a Copilot-assigned issue produces a PR).

This is **not** consumed by in-IDE Copilot Chat. The IDE variant has no end-of-session hook surface; for it, the only enforcement is at PR time via [`.github/workflows/lint-docs.yml`](../workflows/lint-docs.yml).

## What's here

[`hooks.json`](hooks.json) wires a `sessionEnd` hook that runs [`scripts/check-touched-related-files.cjs`](../../scripts/check-touched-related-files.cjs). The script prints a reminder for any architecture doc whose `related-files:` list intersects the files touched this session — when the doc itself wasn't also updated.

The Claude Code equivalent is [`.claude/hooks/check-touched-related-files.sh`](../../.claude/hooks/check-touched-related-files.sh), wired via the `Stop` event in [`.claude/settings.json`](../../.claude/settings.json). Both wrappers call the same Node script so the reminder logic is tool-agnostic.

## Why two of these exist

The reminder is informational, not blocking. Hard enforcement lives in the PR-time gate ([`scripts/docs-stale-blocking.cjs`](../../scripts/docs-stale-blocking.cjs) wired into the `lint-docs` workflow). The end-of-session hook is the *soft prompt* — it lands the reminder at the moment the agent is deciding whether work is done, so it can update the doc as part of the same change rather than after the fact.

See [`docs/architecture/build-and-tooling.md`](../../docs/architecture/build-and-tooling.md) (the "Doc-maintenance enforcement" section) for the full three-layer model.

## Schema reference

The Coding Agent's hook schema is documented at <https://docs.github.com/en/copilot/reference/hooks-configuration>. Supported events include `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, and `errorOccurred`. Each entry takes `type`, `bash` / `powershell`, and optional `cwd`, `timeoutSec`, `env`, `comment`.
