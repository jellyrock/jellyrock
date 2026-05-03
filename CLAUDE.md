# JellyRock — Agent Rules

JellyRock is a Jellyfin client for Roku, written in **BrighterScript** (`.bs`, transpiled to `.brs`) with **Roku Scene Graph** (`.xml`) for the UI. The Jellyfin REST API is wrapped by an in-house client + persistent task pool — see [`source/api/CLAUDE.md`](source/api/CLAUDE.md) and [`docs/architecture/api.md`](docs/architecture/api.md)

## ⚠️ Mandatory rules

1. DO NOT make stuff up or make assumptions
2. Ask clarifying questions when you are not sure about something
3. Focus on best practices, industry standards, and easy long-term maintenance
4. ALWAYS look for the best possible solution to a problem then provide the user with their best options
5. Iterate on a plan with the user until they approve it, and only then begin coding
6. After finishing a user-approved plan: run automated tests to verify; provide a manual test plan only for UI/runtime behavior tests don't cover, plus any expected debug-log output

## Agent rules

- **Run tests to verify fixes — don't commit based on reasoning alone.** TDD (single spec, fastest): `npm run test:tdd`. Broader: `npm run test:unit | test:integration | test:all`. Setup, credentials, debugger contention: [`docs/dev/unit-tests-tdd.md`](docs/dev/unit-tests-tdd.md).
- **When hardware isn't reachable, say so explicitly** — don't claim a fix was tested when only the build was verified
- **Cannot modify `CHANGELOG.md`** — CI-controlled
- **Don't run `npm run validate`, `npm run lint:*`, `npm run build:*`, `npm run check-formatting`, `npm run format`, or `npm run test:scripts` manually** — pre-commit / pre-push / CI runs them at the right moment and the IDE handles `.bs` live. Exception: debugging a specific lint failure
- **Capture cross-session agent guidance in `CLAUDE.md` (root or scoped), not in agent-private memory** — memory files are per-folder (worktrees / multiple JellyRock checkouts each get their own), aren't committed, and don't reach other contributors. Project rules belong in `CLAUDE.md` so everyone benefits.

## Doc maintenance discipline

When you modify a file listed in any architecture doc's `related-files:` frontmatter, you must also re-read that doc and either:

- **Update it** if the change altered the subsystem's *shape* or *why*. Bump `last-reviewed` in the frontmatter to today's date
- **Explicitly confirm no shape/why change occurred** in your response, leaving the doc untouched. Don't bump `last-reviewed` — that signal must reflect actual review against current code

Two enforcement layers back this up:

- An **end-of-turn hook** (Claude Code `Stop`, Copilot Coding Agent `sessionEnd`) prints which docs claim the files you touched. Informational; doesn't block. Logic in [`scripts/lint/check-touched-related-files.cjs`](scripts/lint/check-touched-related-files.cjs)
- A **CI gate** ([`scripts/lint/docs-stale-blocking.cjs`](scripts/lint/docs-stale-blocking.cjs), wired to [`.github/workflows/lint-docs.yml`](.github/workflows/lint-docs.yml)) fails the PR if a stale (over 120 days) architecture doc's territory was modified without the doc itself being updated. Hard pressure at PR time

Soft prompt during work, hard gate before merge. The CI gate is architecture-only (dev guides under `docs/dev/` are informational — the soft signal in `npm run docs:stale` covers them)

## Where the rules actually live

This file holds only cross-cutting / repo-wide rules. Per-area rules live in scoped `CLAUDE.md` files that auto-load when an agent reads files in that directory:

| Working in… | Auto-loads |
|---|---|
| `components/` (any subfolder) | [`components/CLAUDE.md`](components/CLAUDE.md) |
| `components/video/` | [`components/video/CLAUDE.md`](components/video/CLAUDE.md) (also `components/CLAUDE.md`) |
| `components/data/` | [`components/data/CLAUDE.md`](components/data/CLAUDE.md) |
| `source/` (any subfolder) | [`source/CLAUDE.md`](source/CLAUDE.md) |
| `source/api/` | [`source/api/CLAUDE.md`](source/api/CLAUDE.md) (also `source/CLAUDE.md`) |
| `source/utils/` | [`source/utils/CLAUDE.md`](source/utils/CLAUDE.md) |
| `tests/` | [`tests/CLAUDE.md`](tests/CLAUDE.md) |
| `locale/` | [`locale/CLAUDE.md`](locale/CLAUDE.md) |
| `scripts/` (any subfolder) | [`scripts/CLAUDE.md`](scripts/CLAUDE.md) |

For the *why* and *shape* of each subsystem, load the relevant doc from [`docs/architecture/`](docs/architecture/) (start with [`docs/architecture/README.md`](docs/architecture/README.md)'s topic map). For *how to do X* (writing tests, adding settings, migrations), see [`docs/dev/`](docs/dev/).

Quick task pointers:

- **Adding a user setting?** → [`docs/dev/new-user-setting.md`](docs/dev/new-user-setting.md)
- **Writing tests?** → [`docs/dev/unit-tests.md`](docs/dev/unit-tests.md)
- **Running tests?** → [`docs/dev/unit-tests-tdd.md`](docs/dev/unit-tests-tdd.md)
- **Registry migrations?** → [`docs/dev/registry-migrations.md`](docs/dev/registry-migrations.md)
- **Working in `scripts/` (BSC plugins, doc validators, codegen)?** → [`docs/dev/scripts-development.md`](docs/dev/scripts-development.md)
- **Debug flags / toast testing?** → [`docs/dev/debug-flags.md`](docs/dev/debug-flags.md)
- **Code style?** → [`docs/dev/code-style.md`](docs/dev/code-style.md)

## Workflow

### IDE integration

- `brightscript.projects` (in `.vscode/settings.json`) drives auto-build/validate via the BrighterScript extension during dev
- The IDE's BSC plugin watches `en_US.json` and regenerates `translationKeys` constants live

### Pre-push hook (husky)

`.husky/pre-push` runs on `git push`. Mirrors CI lint, scoped to files in the push range. Auto-fix steps mutate files (combined into one `chore: auto-fix via pre-push hook` commit; never amends); check steps abort the push on failure. Bypass with `git push --no-verify` only as last resort. Full details in [`docs/architecture/build-and-tooling.md`](docs/architecture/build-and-tooling.md).

### Commit messages

Conventional Commits style (matches `git log`): `type(scope): summary`. No `Co-Authored-By` footer

### Pull requests

Use the `/pr` skill — it builds the body from `.github/pull_request_template.md`, scans for related issues, and surfaces architecture docs whose related-files were touched. No `🤖 Generated with Claude Code` footer or any other Claude attribution
