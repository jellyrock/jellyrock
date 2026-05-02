---
topic: build-and-tooling
related-files:
  - bsconfig.json
  - bsconfig-prod.json
  - package.json
  - Makefile
  - scripts/bsc-plugin-roku-log.cjs
  - scripts/bsc-plugin-translation-keys.cjs
  - scripts/bsc-plugin-jrscreen-destroy.cjs
  - scripts/bsc-plugin-print-locations.cjs
  - scripts/bsc-plugin-observe-without-destroy.cjs
  - scripts/bsc-plugin-no-direct-sdk.cjs
  - scripts/docs-check.cjs
  - scripts/docs-stale.cjs
  - scripts/docs-stale-blocking.cjs
  - scripts/check-touched-related-files.cjs
  - scripts/generate-dev-index.cjs
  - scripts/lib/frontmatter.cjs
  - .claude/settings.json
  - .claude/hooks/log-tool-use.sh
  - .claude/hooks/check-touched-related-files.sh
  - .github/hooks/hooks.json
  - .github/actions/changed-paths/action.yml
  - .github/workflows/lint-docs.yml
  - .github/workflows/_lint-docs.yml
  - .github/workflows/_validate-dependencies.yml
  - .github/workflows/docs-stale-tracker.yml
last-reviewed: 2026-05-02
---

# Build & Tooling

The BrighterScript compiler configuration, custom plugins, npm scripts, Makefile, ropm modules, and IDE integration expectations.

## The BrighterScript pipeline

JellyRock is written in **BrighterScript** (`.bs`), a typed superset of BrightScript that compiles to plain `.brs` for the Roku runtime. The compiler is `bsc` (the `brighterscript` npm package). Output goes to `build/` (and `out/` for packaged ZIPs).

```text
.bs source files  ─┐
.xml components   ─┤  →  bsc (with plugins) →  .brs/.xml output  →  ZIP  →  Roku device
images, locales   ─┘     in build/                                    in out/
```

## bsconfig variants

Several `bsconfig*.json` files exist, one per build target:

| File | Purpose |
|---|---|
| `bsconfig.json` | Standard dev build — log strip OFF, source maps ON, all plugins active |
| `bsconfig-prod.json` | Production build — log strip ON (`rokuLog.strip = true`), source maps OFF, comments removed |
| `bsconfig-tests.json` | All test suites |
| `bsconfig-tests-unit.json` | Unit tests only (faster for iteration) |
| `bsconfig-tests-integration.json` | Integration tests only |
| `bsconfig-tests-complete.json` | Complete coverage variant |
| `bsconfig-tdd-sample.json` | Sample TDD config — devs copy to `bsconfig-tdd.json` and customize what suites/tests to run |

The `bsconfig.json` (dev) entry shape:

```json
{
  "files": [
    "manifest",
    "source/**/*.*",
    "components/**/*.*",
    "images/**/*.*",
    "locale/**/*.*",
    "settings/*.*"
  ],
  "plugins": [
    "@rokucommunity/bslint",
    "brighterscript-xml-plugin",
    "./scripts/bsc-plugin-roku-log.cjs",
    "./scripts/bsc-plugin-translation-keys.cjs"
  ],
  "lintConfig": "bslint.json",
  "rokuLog": {
    "strip": false,
    "insertPkgPath": true,
    "removeComments": false
  },
  "sourceMap": true,
  "autoImportComponentScript": true,
  "outDir": "build"
}
```

## Custom BSC plugins

Two custom plugins live in `scripts/`:

### `scripts/bsc-plugin-roku-log.cjs`

Optimizes `roku-log` usage at compile time:

- **`strip`** (true in prod, false in dev) — removes all `m.log.*()` calls from compiled output. Production builds have **zero** logging overhead from removed levels.
- **`insertPkgPath`** — automatically prepends the source file path to log lines so telnet output shows where each log came from.
- **`removeComments`** (false by default) — removes BS comments to shrink output.

This is the reason `m.log.debug("intermediate value", x, y, z)` is fine to leave in code — in production, the entire call site disappears.

### `scripts/bsc-plugin-translation-keys.cjs`

Generates a virtual `pkg:/source/translationKeys.bs` file containing a `translationKeys` namespace with one constant per key in `locale/custom/en_US.json`. Documented in detail in `translations.md`.

The plugin uses `fs.watch` to detect en_US.json changes in language-server mode (so the IDE always sees up-to-date constants without re-running the build).

### Convention plugins

Four lint-only plugins encode unwritten conventions documented in `components/CLAUDE.md` / `source/CLAUDE.md` so violations surface as IDE warnings + CI failures instead of bugs at runtime. All emit warnings (severity 2), never errors, and never crash the build on edge cases.

| Plugin | Flags | Smart filtering |
|---|---|---|
| `bsc-plugin-jrscreen-destroy.cjs` | XML components that transitively extend `JRScreen` whose codebehind doesn't declare a top-level `destroy` function | Skips `JRScreen.xml` itself; walks `parentComponent` chain up to depth 32 |
| `bsc-plugin-print-locations.cjs` | Raw `print` calls outside the allowed sites | Allows `source/main.bs` (whole file) and `#if debug` blocks in `source/utils/globals.bs`; auto-skips top-level functions in any `source/*.bs` file (no `m` context, so no `m.log` available) |
| `bsc-plugin-observe-without-destroy.cjs` | `observeField` calls with no matching `unobserveField` (same field name, alias-aware target) anywhere in the file | Only runs on JRScreen subclass codebehinds; alias resolution via union-find over assignment statements (so `m.foo = bar` makes `m.foo` and `bar` interchangeable for matching) |
| `bsc-plugin-no-direct-sdk.cjs` | `sdk.<ns>.<fn>(...)` calls outside `source/api/ApiClient.bs` and `source/api/sdk.bs` | None — the only allowed callers are explicitly listed |

**Suppressing a false positive.** Each plugin honors these comment markers (case-insensitive, regex match against the source text):

```brightscript
' bsc-disable-line <plugin-id>           ← on the same line as the call
' bsc-disable-next-line <plugin-id>      ← on the line above
' bsc-disable-file <plugin-id>           ← anywhere in the file (whole-file opt-out)
```

Valid `<plugin-id>` values: `jrscreen-destroy`, `print-locations`, `observe-without-destroy`, `no-direct-sdk`. (Note: `jrscreen-destroy` only honors `bsc-disable-file` since the diagnostic is reported on the XML component declaration, not a specific source line.) Prefer the narrowest scope: line > next-line > file. Whole-file opt-outs should reference a tech-debt slug in a trailing comment so future readers know why.

### Other plugins

- **`@rokucommunity/bslint`** — lint rules (`lintConfig: bslint.json`)
- **`brighterscript-xml-plugin`** — XML linting and parsing for component definitions

## npm scripts — `package.json`

Build:

| Script | What it does |
|---|---|
| `npm run build` | Dev build (`bsc --project bsconfig.json`) |
| `npm run build:prod` | Production build with log stripping |
| `npm run build:tests` | All test suites |
| `npm run build:tests-unit` | Unit tests only |
| `npm run build:tests-integration` | Integration tests only |
| `npm run build:tests-complete` | Complete suite |
| `npm run build:tdd` | TDD watch mode (uses `bsconfig-tdd.json`) |
| `npm run package` | Create installable .zip via `scripts/create-package.cjs` |
| `npm run validate` | Type-check only (`bsc --noEmit`) |

Run tests:

| Script | What it does |
|---|---|
| `npm run test:unit` | Build + run unit tests on configured device |
| `npm run test:integration` | Build + run integration tests |
| `npm run test:all` | Build + run all tests |
| `npm run test:complete` | Build + run complete suite |
| `npm run test:tdd` | Build + run TDD config (uses `bsconfig-tdd.json`; copy from `bsconfig-tdd-sample.json` and edit) |

Lint and format:

| Script | What it does |
|---|---|
| `npm run lint` | Runs everything below in sequence |
| `npm run lint:bs` | bslint on BrighterScript code |
| `npm run lint:json` | jshint on JSON files (excluding node_modules, scripts, tasks, build, out, locale) |
| `npm run lint:markdown` | markdownlint on all `.md` (with exclusions for AI agent docs) |
| `npm run lint:spelling` | spellchecker on Markdown files |
| `npm run lint:translations` | Custom translation lint (sort order, completeness, placeholder parity) |
| `npm run lint:language-coverage` | Validates the 3-tier language-name resolver in `source/utils/languages.bs` (alias targets exist, tier 1 entries have alias coverage, no redundant fallbacks) — see `translations.md` |
| `npm run lint:docs` | Validates (1) `related-files:` paths in frontmatter, (2) relative markdown links, and (3) tech-debt anchor references of the form `tech-debt.md#<anchor>` — across `docs/architecture/*.md`, `docs/dev/*.md`, `docs/decisions.md`, every `CLAUDE.md`, and the BSC convention plugins (`scripts/bsc-plugin-*.cjs`). The anchor form is the canonical way to cite a slug; narrative-form mentions are intentionally not checked (see [tech-debt.md](tech-debt.md) preamble for the convention) |
| `npm run docs:stale` | Reports docs whose `last-reviewed` frontmatter is older than 90 days. Powers the quarterly arch-audit cadence; not a CI gate by default. Pass `--strict` to fail the run (e.g. for a quarterly check) |
| `npm run docs:stale:blocking` | The conditional hard gate. Fails (exit 1) if a stale (>120 days) **architecture** doc's `related-files` was modified by the PR without the doc itself being updated alongside. Architecture-only by design — dev guides under `docs/dev/` are informational, gating both would force `last-reviewed` bumps for unrelated workflow docs. Wired into the `lint-docs` workflow as a required check |
| `npm run agent-telemetry` | Aggregates `~/.claude/jellyrock-telemetry/tool-use.jsonl` (populated per-USER, not per-worktree, by the `PostToolUse` hook in `.claude/settings.json`) into a top-files-read / top-greps report. Signals where to expand subdir CLAUDE.md coverage |
| `npm run docs:dev-index` / `:check` | Regenerates / checks the auto-generated dev-guides index inside `docs/architecture/README.md`. Pre-push runs the regen as an auto-fix when `docs/dev/*.md` changes; `:check` runs unconditionally as a check step (catches manual README edits that didn't go through the regen) |
| `npm run check-formatting` | `bsfmt --check` (read-only check) |
| `npm run format` | `bsfmt --write` (apply formatting fixes) |
| `npm run validate` | `bsc --noEmit` (type-check) |
| `npm run update-translations` | Auto-fix translation issues |

Documentation:

| Script | What it does |
|---|---|
| `npm run docs:settings` | Generate `docs/user/app-settings.md` from `settings/settings.json` via `scripts/generate-settings-docs.cjs` |

CHANGELOG management (CI-controlled, agents do NOT touch):

| Script | What it does |
|---|---|
| `npm run changelog:sync-unreleased` | Sync unreleased entries |
| `npm run changelog:sync-release` | Sync on release |
| `npm run changelog:validate` | Validate changelog format |
| `npm run changelog:status` | Show changelog status |

ropm:

| Script | What it does |
|---|---|
| `npm run postinstall` | Runs `npm run ropm` automatically after `npm install` |
| `npm run ropm` | `ropm copy && node scripts/ropm-hook.cjs` — copies vendored Roku modules into `components/roku_modules/` and `source/roku_modules/` |

## ropm modules — Roku Package Manager

`ropm` is the Roku-specific package manager that vendors libraries into your project (no runtime resolution — everything is copied into the build). Three packages are installed (see `package.json` for current versions):

- **`log`** — the `roku-log` library. Vendored into `source/roku_modules/log/` and `components/roku_modules/log/`.
- **`rr`** — `roku-requests`. HTTP client used by `ApiTask` (vendored into `source/roku_modules/rr/`).
- **`rokucommunity_bslib`** — `@rokucommunity/bslib`. Standard library extensions (commonly-needed BrightScript utilities).

Module names (`log`, `rr`) are configured in `package.json`'s `dependencies` block as npm package aliases. The aliasing keeps imports short — `import "pkg:/source/roku_modules/log/LogMixin.brs"` rather than the full upstream package path.

## Dev dependencies (key ones)

| Package | Purpose |
|---|---|
| `brighterscript` | Compiler |
| `@rokucommunity/bslint` | Linter |
| `brighterscript-formatter` | Formatter (`bsfmt`) |
| `brighterscript-xml-plugin` | XML linting/parsing |
| `roku-deploy` | Device deployment helpers |
| `rooibos-roku` | Test framework |
| `ropm` | Roku package manager |
| `markdownlint-cli2` | Markdown lint |
| `spellchecker-cli` | Spell check |
| `jshint` | JSON validation |
| `dotenv` | `.env` file loading for device target/password |
| `fast-glob` | File matching in scripts |
| `husky` | Manages git hooks; installs `.husky/pre-push` on `npm install` (via `prepare` script) |

Versions are pinned in `package.json` (currently on alpha versions of brighterscript ecosystem packages).

## Makefile

The Makefile wraps npm scripts and adds device-deployment targets that need `ROKU_DEV_TARGET` (device IP) and `ROKU_DEV_PASSWORD` (device password) env vars.

Build targets (proxy to npm):

| Target | What it does |
|---|---|
| `make build-dev` | `npm run build` |
| `make build-prod` | `npm run build:prod` |
| `make build-tests` / `build-tests-unit` / `build-tests-integration` | Test builds |
| `make build-tdd` | TDD watch |
| `make format` | `npm run format` |
| `make lint` | `npm run lint` |
| `make make_images` | Generate branding PNGs from SVGs (needs ImageMagick `convert`) |

Device targets (need env vars):

| Target | What it does |
|---|---|
| `make home` | Press Home button on device |
| `make launch` | Launch installed channel |
| `make install` | Install built ZIP on device |
| `make remove` | Remove installed channel |
| `make screenshot` | Capture screenshot |
| `make deploy` | `lint → remove → install` |

Typical dev loop on a real device:

```bash
export ROKU_DEV_TARGET=192.168.1.50
export ROKU_DEV_PASSWORD=mydevpassword
make deploy        # lints, removes old, installs new
make launch        # launches the channel
```

## Pre-push hook — `.husky/pre-push`

Installed by `husky` on `npm install` (via `package.json`'s `prepare` script). Mirrors the CI lint suite, scoped to files in the push range, so issues are caught before they fail the build.

**Auto-fix steps** (mutate files; combined into a single `chore: auto-fix via pre-push hook` commit; never amends):

1. `bsfmt --write` on `*.bs` / `*.brs` files in the push range.
2. `npm run update-translations` if BS source / `locale/**` / `settings/settings.json` changed.

**Check steps** (read-only; non-zero exit aborts the push) — run after auto-fix:

1. `npm run validate` — when `*.bs` / `*.brs` / `*.xml` / `bsconfig*.json` changed.
2. `npm run lint:markdown` + `npm run lint:spelling` — when `*.md` changed.
3. `npm run lint:json` — when `*.json` changed.
4. `npm run lint:docs` — **always**. Validates `related-files:` paths, markdown link targets, and tech-debt slug references across `docs/architecture/*.md`, `docs/dev/*.md`, `docs/decisions.md`, every `CLAUDE.md`, and `scripts/bsc-plugin-*.cjs`. Runs unconditionally because broken refs most often come from code renames or tech-debt slug deletions (no `*.md` in the push range), and limiting the check to doc-only pushes lets those slip through to CI. Cost is ~`1s`.

**Safety:** auto-fix is skipped (with a warning) when the working tree is dirty so WIP can't be swept into the auto-fix commit. Check steps still run.

**Bypass:** `git push --no-verify` if you must (prefer fixing the underlying issue).

This is the reason agents and humans should NOT manually run `npm run lint*` or `npm run validate`: the IDE catches issues live, the pre-push hook catches them at push time, and CI catches them on PR. Manual runs duplicate work.

## CI lint workflows

Each lint scope has a workflow pair under [`.github/workflows/`](../../.github/workflows/):

- `lint-X.yml` — the public, PR-triggered caller. Just calls `_lint-X.yml`.
- `_lint-X.yml` — the reusable workflow that does the actual work.

The pair pattern exists so the same lint logic can be invoked from other workflows in the future without duplication.

**Path relevance is computed *inside* the job, not at event time.** Each `_lint-X.yml` starts with [`./.github/actions/changed-paths`](../../.github/actions/changed-paths/action.yml) — a composite action that uses `gh pr diff --name-only` to check whether the PR modified any file matching the workflow's regex. All subsequent steps are gated on the action's `relevant` output.

This avoids the standard GitHub gotcha with event-time `paths:` filters: a workflow filtered by `paths:` simply doesn't run when paths don't match, which means *no status is reported*. If such a workflow is wired as a required check in branch protection, PRs that don't touch matching paths get stuck with `Expected — Waiting for status to be reported` and can't merge. Always-queue + internal-skip dodges this — the workflow always reports a status (success when the gate skipped, success or failure when it actually ran), so it's safe to wire as a required check.

When adding a new lint workflow, copy an existing `_lint-X.yml` and update the `pattern:` regex passed to `changed-paths`. The regex must mirror what would have gone into the old `paths:` block. Always also expose a `force: boolean` `workflow_call` input and forward it to the action — orchestrator workflows like [`_validate-dependencies.yml`](../../.github/workflows/_validate-dependencies.yml) need to bypass the path check (a dep bump can regress a linter even when no matching source file changed in the PR).

## Doc-maintenance enforcement

The agent-context system (architecture docs, scoped CLAUDE.md, BSC convention plugins, `lint:docs`) only delivers value if the docs are kept in sync with the code. Three layers enforce that:

### 1. End-of-turn reminder hook (soft, per-session)

Fires when an agent finishes its turn. Prints which architecture doc(s) claim files the session touched, prompting the agent to re-read and update the doc if the change altered shape/why.

- Logic: [`scripts/check-touched-related-files.cjs`](../../scripts/check-touched-related-files.cjs)
- Claude Code wrapper: `Stop` hook in `.claude/settings.json` → [`.claude/hooks/check-touched-related-files.sh`](../../.claude/hooks/check-touched-related-files.sh)
- Copilot Coding Agent wrapper: `sessionEnd` in [`.github/hooks/hooks.json`](../../.github/hooks/hooks.json). **Only fires for the GitHub-hosted Coding Agent variant** — in-IDE Copilot Chat doesn't consume that file.
- opencode wrapper: not yet implemented (the `@opencode-ai/plugin` API surface needs verification before plugging in).

Informational only — never blocks the agent. The point is to prompt the right action *during* work, not force it. Forced blocking would tempt the agent to bump `last-reviewed` mechanically to clear the block, which would erode the freshness signal.

### 2. CI gate (hard, per-PR)

The conditional hard gate. `lint-docs.yml` runs `npm run docs:stale:blocking` on every PR; the script exits non-zero only when the PR modifies a stale architecture doc's `related-files` without updating the doc itself. Surgical pressure: PRs that touch unrelated areas pass freely.

Designed to avoid the blanket-gate trap (every PR blocked once any doc is stale) — see the docstring on [`scripts/docs-stale-blocking.cjs`](../../scripts/docs-stale-blocking.cjs) for the design rationale.

### 3. Weekly stale tracker (visibility)

[`.github/workflows/docs-stale-tracker.yml`](../../.github/workflows/docs-stale-tracker.yml) runs every Monday morning UTC, finds the stale list, and maintains a single canonical issue labeled `docs:stale`:

- Opens the issue when stale docs exist and no issue is open
- Edits the body in place when the list changes (one issue, not per-doc — keeps noise low)
- Auto-closes when no docs are stale
- Splits the body into "Architecture (PR-gated at 120 days)" and "Dev guides (informational)" so contributors understand which entries block PRs

The combination: agent sees a soft prompt during work (#1), CI blocks at PR time if the stale-doc territory was touched (#2), weekly tracker keeps any unresolved staleness visible (#3).

## Agent telemetry

`.claude/settings.json` registers a `PostToolUse` hook that fires after every Read / Grep / Glob / Edit / Write / `MultiEdit`. The hook script (`.claude/hooks/log-tool-use.sh`) appends a JSONL line to `~/.claude/jellyrock-telemetry/tool-use.jsonl` (per-USER, not per-worktree — so contributors with multiple jellyrock copies see a single combined picture without manual log consolidation). Override the location with `$JELLYROCK_TELEMETRY_DIR` if needed.

The hook is non-blocking: it runs after the tool, never delays the agent, and silences every error path so a missing `jq` (the only dep) just no-ops rather than failing the tool call.

`npm run agent-telemetry` reads the log and prints a report — top files read, top files edited, top grep / glob patterns, and a few "what to act on" hints. The intent is to drive evidence-based decisions about where to expand subdir CLAUDE.md coverage rather than guessing.

The log file is per-developer (lives in `$HOME`; never committed). Aggregating across developers would require explicit opt-in plumbing; not currently in scope.

## IDE integration

JellyRock expects developers to use VS Code with the BrighterScript extension. With the extension installed:

- **Real-time `.bs` validation** runs continuously — `npm run validate` and `npm run lint:bs` are redundant
- **Diagnostics in the Problems panel** match what `bsc --noEmit` would report
- **Auto-completion** works for `m.global.user.settings.<field>` (typed by the `JellyfinUserSettings` ContentNode) and for `translationKeys.<key>` (generated by the BSC plugin)
- **Format on save** can be configured to run `bsfmt`
- **The translation key plugin's fs.watch** ensures key constants are regenerated when `en_US.json` is edited, even though `BSC`'s normal `Program.setFile` doesn't trigger on JSON

What the IDE does NOT cover universally:

- **Markdown / spelling lint** — depends on the dev having the `markdownlint-cli2` and `spellchecker-cli` extensions installed. Many devs don't; we don't standardize.
- **JSON lint, translation lint, language-coverage, docs:check** — no extension coverage at all; these run only via `npm run lint:*` or the pre-push hook.

So the rule is: **don't run `npm run validate` or `npm run lint:bs` manually** (IDE has them covered). For everything else, the pre-push hook is the backstop; run `npm run lint:<name>` manually only when debugging a specific failure. CI runs the full lint + validate suite on every push.

## Agent rules (from `CLAUDE.md`)

- **Agents run tests** via `npm run test:tdd` / `test:unit` / `test:integration` / `test:all`. Credentials in `.env` (`ROKU_IP`, `ROKU_PASSWORD`); fall back to `VSCode`'s `brightscript.debug.*` settings. Honest reporting is required when hardware isn't available — a green build is not a green test run.
- **Cannot modify `CHANGELOG.md`** — CI-controlled only.
- **`.bs` validation is live in the IDE** (BSC + bslint via the BrighterScript extension); `npm run validate` and `npm run lint:bs` shouldn't be run manually. **Other lint scripts have no universal IDE coverage** (markdown / spelling rely on per-dev extensions; JSON / translations / language-coverage / docs have none) — the pre-push hook is the backstop. Don't run `npm run build:*` manually either; the IDE handles dev builds.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for build / tooling entries.
