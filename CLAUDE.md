# JellyRock — Agent Rules

JellyRock is a Jellyfin client for Roku, written in **BrighterScript** (`.bs`, transpiled to `.brs`) with **Roku Scene Graph** (`.xml`) for the UI. The Jellyfin REST API is wrapped by an in-house client + persistent task pool — see [`source/api/CLAUDE.md`](source/api/CLAUDE.md) and [`docs/architecture/api.md`](docs/architecture/api.md)

## ⚠️ Mandatory rules

1. DO NOT make stuff up or make assumptions
2. Ask clarifying questions when you are not sure about something
3. Focus on best practices, industry standards, easy long-term maintenance, no regressions, and world-class UX and DX
4. ALWAYS look for the best possible solution to a problem then provide the user with their best options
5. Iterate on a plan with the user until they approve it, and only then begin coding
6. After finishing a user-approved plan: run automated tests to verify; provide a manual test plan only for UI/runtime behavior tests don't cover, plus any expected debug-log output

## Agent rules

- **Run tests to verify fixes — don't commit based on reasoning alone.** Nothing auto-runs tests, so an agent is expected to run them. BS unit tests on Roku hardware — TDD (single spec, fastest): `npm run test:tdd`; broader: `npm run test:unit | test:integration | test:all`. BSC plugin / scripts changes (Vitest, no hardware needed): `npm run test:scripts`. Setup, credentials, debugger contention: [`docs/dev/unit-tests-tdd.md`](docs/dev/unit-tests-tdd.md).
- **When hardware isn't reachable, say so explicitly** — don't claim a fix was tested when only the build was verified
- **Cannot modify `CHANGELOG.md`** — CI-controlled
- **Don't compulsively re-run lint / build / format mid-work.** `npm run validate`, `lint:*`, `build:*`, `check-formatting`, and `format` are already run by pre-commit / pre-push hooks and by CI on every push (and most editors surface BSC diagnostics live as you type). So they aren't for routine "did my change compile" checks — but they're fair game when debugging a specific failure, when no hook has fired yet, or when your editor isn't surfacing diagnostics. **Test scripts are NOT covered** — `test:tdd` / `test:unit` / `test:scripts` aren't auto-run anywhere before commit, so running them as part of finishing work is the expected workflow, not a redundancy.
- **Capture cross-session agent guidance in `CLAUDE.md` (root or scoped), not in agent-private memory** — memory files are per-folder (worktrees / multiple JellyRock checkouts each get their own), aren't committed, and don't reach other contributors. Project rules belong in `CLAUDE.md` so everyone benefits. Auto-memory is disabled at the project level (`.claude/settings.json` → `autoMemoryEnabled: false`)
- **Don't reference `tasks/` paths in shared artifacts** — `tasks/` is gitignored; reviewers can't navigate there. Keep it out of commit messages, PR bodies, and shared docs
- **PR follow-ups land in a journal, not just the PR body** — when a PR explicitly defers something ("out of scope", "follow-up"), add an entry to the right journal (see Capture & state discipline below) and link it from the PR. Otherwise the deferral evaporates the moment the PR merges

## Capture & state discipline

The four-pillar journal system (see [`docs/architecture/system-shape.md`](docs/architecture/system-shape.md)) treats live project state as load-bearing. Three rules govern how agents interact with the journals:

- **Capture-discipline rule** — when committing a decision-shaped change (a choice that closes off alternatives, has a non-obvious rationale, or has a constraint worth re-evaluating), invoke `/log decision` in the same change set. **Raw markdown edits to [`docs/decisions.md`](docs/decisions.md), [`docs/progress.md`](docs/progress.md), or [`docs/signals-backlog.md`](docs/signals-backlog.md) are not the sanctioned path for agents** — use `/log` (capture) and `/done` (close) skills exclusively. Direct `Write` / `Edit` on those three files bypasses the diff-and-wait safety net and risks silent corruption of project state. *CI exception:* the post-merge [`.github/workflows/journal-sync.yml`](.github/workflows/journal-sync.yml) workflow is the sole non-skill writer to `progress.md`, performing the mechanical close-loop (move `## Currently running` → `## Recently shipped`, bump `last-updated:`) via [`scripts/journal-sync.js`](scripts/journal-sync.js). Judgment-bearing entries (decisions, tech-debt, followups) still flow through the user-driven `/pr` → `/log` path.
- **Followup-discipline rule** — when deferring work in a PR ("out of scope", "follow-up", "TODO later"), pick the right journal:
  - Internal debt with a slug + severity (refactor candidate, design intent worth preserving) → invoke [`/tech-debt-scan`](.claude/skills/tech-debt-scan/SKILL.md) (writes to [`docs/architecture/tech-debt.md`](docs/architecture/tech-debt.md))
  - Generic deferred work without a debt classification → invoke `/log followup "<text>" --area=<name>` (writes to [`docs/progress.md`](docs/progress.md))
  - External upstream watching (Jellyfin / Roku OS / dep version) → invoke `/log signal <slug>` (writes to [`docs/signals-backlog.md`](docs/signals-backlog.md))
- **Catchup-discipline rule** — at the start of any genuine new session and after multi-day gaps, run one of [`/focus`](.claude/skills/focus/SKILL.md) (opus triage + routing — surfaces a 3–5 item menu of next-move candidates with a "Recommended" call, then routes the pick to the right downstream skill) or [`/catchup`](.claude/skills/catchup/SKILL.md) (sonnet, read-only state briefing). Use `/focus` when you want help picking *which* of several plausible next moves to take; use `/catchup` for a pure state load. The four journals plus GitHub state should never be re-derived from scratch — the aggregator at [`scripts/catchup-state.js`](scripts/catchup-state.js) is the canonical state surface and both skills consume it. For area-scoped re-entry (>2 weeks away from a subsystem), use [`/ramp <area>`](.claude/skills/ramp/SKILL.md) instead.
- **Ship-ritual rule** — invoking [`/pr`](.claude/skills/pr/SKILL.md) is the ship moment. `/pr` bundles the three judgment passes (tech-debt scan, decision-shape detect, followup capture) so journal hygiene lands in the same change set instead of a separate manual step. Don't bypass `/pr` with `gh pr create` or the GitHub UI — those skip the passes and leave the journals to drift.

Enforcement layers (soft → hard):

- **Session-start nudge** — `SessionStart` hook runs [`scripts/lint/session-start-nudge.cjs`](scripts/lint/session-start-nudge.cjs); prints one advisory line when local journal/handoff state suggests actionable work (pending handoffs, stale progress.md, schema-broken journals). Silent on clean state. Local-only — no network calls. Surfaces the catchup-discipline rule at the moment it applies.
- **Mid-session nudges** — `Stop` hook runs [`scripts/lint/progress-cursor-nudge.cjs`](scripts/lint/progress-cursor-nudge.cjs); flags stale progress.md and Currently-running cursors that overlap with shipped commits.
- **Pre-push nudges** — same `progress-cursor-nudge` plus the existing `decision-shape-nudge` print advisories. Never block.
- **Post-merge auto-sync** — [`.github/workflows/journal-sync.yml`](.github/workflows/journal-sync.yml) handles the mechanical close-loop after PR merge (move `## Currently running` → `## Recently shipped`, bump `last-updated:`). Skips on `dependencies` / `documentation` / `ci` / `automated` labels and Renovate/Dependabot/bot authors.
- **CI lint gate** — `npm run lint:docs` FAILs when [`docs/progress.md`](docs/progress.md) is >7 days stale with commits since (`progress-stale` category) or when [`docs/signals-backlog.md`](docs/signals-backlog.md) has a schema-broken row (`signals-schema-invalid` category). CI runs the lint on every PR.

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
- **Processing the weekly Roku crash CSV?** → [`docs/dev/crash-reports.md`](docs/dev/crash-reports.md) (run [`/crash-report`](.claude/skills/crash-report/SKILL.md))

## Workflow

### Looking up Roku platform docs

The source-of-truth Roku developer docs live in [`rokudev/dev-doc`](https://github.com/rokudev/dev-doc) on branch `v2.0`. Prefer the GitHub source over the rendered site at `developer.roku.com/dev` — the rendered site sometimes blocks fetches and truncates HTML tables that the markdown source preserves. Fetch via `gh`:

```bash
# Path discovery:
gh api repos/rokudev/dev-doc/git/trees/v2.0?recursive=1 --jq '.tree[].path' | grep <topic>

# Read a file (decode the base64 content field):
gh api repos/rokudev/dev-doc/contents/<path>?ref=v2.0 --jq '.content' | base64 -d
```

Most useful subtrees: `docs/REFERENCES/scenegraph/` (scene graph nodes + interface fields), `docs/REFERENCES/brightscript/` (components / events / interfaces — `roInput`, `roInputEvent`, `roMessagePort`, etc.), `docs/DEVELOPER/` (feature guides — voice transport, deep linking, certification). Trust the repo when it disagrees with the rendered site; the rendered site is built from this source.

### IDE integration

- `brightscript.projects` (in `.vscode/settings.json`) drives auto-build/validate via the BrighterScript extension during dev
- The IDE's BSC plugin watches `en_US.json` and regenerates `translationKeys` constants live

### Pre-push hook (husky)

`.husky/pre-push` runs on `git push`. Mirrors CI lint, scoped to files in the push range. Auto-fix steps mutate files (combined into one `chore: auto-fix via pre-push hook` commit; never amends); check steps abort the push on failure. Bypass with `git push --no-verify` only as last resort. Full details in [`docs/architecture/build-and-tooling.md`](docs/architecture/build-and-tooling.md).

### Commit messages

Conventional Commits style (matches `git log`): `type(scope): summary`. No `Co-Authored-By` footer

### Pull requests

Use the `/pr` skill — it builds the body from `.github/pull_request_template.md`, scans for related issues, and surfaces architecture docs whose related-files were touched. No `🤖 Generated with Claude Code` footer or any other Claude attribution
