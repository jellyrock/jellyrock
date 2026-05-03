---
topic: build-and-tooling
related-files:
  - bsconfig.json
  - bsconfig-prod.json
  - package.json
  - patches/
  - Makefile
  - scripts/bsc-plugins/roku-log.cjs
  - scripts/bsc-plugins/translation-keys.cjs
  - scripts/bsc-plugins/jrscreen-on-destroy.cjs
  - scripts/bsc-plugins/print-locations.cjs
  - scripts/bsc-plugins/observe-without-on-destroy.cjs
  - scripts/bsc-plugins/no-direct-sdk.cjs
  - scripts/lint/docs-check.cjs
  - scripts/lint/docs-stale.cjs
  - scripts/lint/docs-stale-blocking.cjs
  - scripts/lint/check-touched-related-files.cjs
  - scripts/lint/check-touched-lint.cjs
  - scripts/generate/dev-index.cjs
  - scripts/lib/frontmatter.cjs
  - scripts/lib/changed-files.cjs
  - scripts/lib/lint-excludes.cjs
  - .lintstagedrc.cjs
  - .husky/pre-commit
  - .husky/pre-push
  - .claude/settings.json
  - .claude/hooks/log-tool-use.sh
  - .claude/hooks/check-touched-related-files.sh
  - .claude/hooks/check-touched-lint.sh
  - .claude/hooks/bsfmt-on-write.sh
  - .github/hooks/hooks.json
  - .github/actions/changed-paths/action.yml
  - .github/workflows/lint-docs.yml
  - .github/workflows/_lint-docs.yml
  - .github/workflows/_lint-js.yml
  - .github/workflows/lint-js.yml
  - .github/workflows/_test-scripts.yml
  - .github/workflows/test-scripts.yml
  - .github/workflows/_validate-dependencies.yml
  - .github/workflows/docs-stale-tracker.yml
  - eslint.config.js
  - .prettierrc.json
  - .prettierignore
  - vitest.config.js
last-reviewed: 2026-05-03
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
    "./scripts/bsc-plugins/roku-log.cjs",
    "./scripts/bsc-plugins/translation-keys.cjs"
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

Two custom plugins live in `scripts/bsc-plugins/`:

### `scripts/bsc-plugins/roku-log.cjs`

Optimizes `roku-log` usage at compile time:

- **`strip`** (true in prod, false in dev) — removes all `m.log.*()` calls from compiled output. Production builds have **zero** logging overhead from removed levels.
- **`insertPkgPath`** — automatically prepends the source file path to log lines so telnet output shows where each log came from.
- **`removeComments`** (false by default) — removes BS comments to shrink output.

This is the reason `m.log.debug("intermediate value", x, y, z)` is fine to leave in code — in production, the entire call site disappears.

### `scripts/bsc-plugins/translation-keys.cjs`

Generates a virtual `pkg:/source/translationKeys.bs` file containing a `translationKeys` namespace with one constant per key in `locale/custom/en_US.json`. Documented in detail in `translations.md`.

The plugin uses `fs.watch` to detect en_US.json changes in language-server mode (so the IDE always sees up-to-date constants without re-running the build).

### Convention plugins

Four lint-only plugins encode unwritten conventions documented in `components/CLAUDE.md` / `source/CLAUDE.md` so violations surface as IDE warnings + CI failures instead of bugs at runtime. All emit warnings (severity 2), never errors, and never crash the build on edge cases.

| Plugin | Flags | Smart filtering |
|---|---|---|
| `bsc-plugin-jrscreen-on-destroy.cjs` | XML components that transitively extend `JRScreen` whose codebehind doesn't declare a top-level `onDestroy` function (case-sensitive — `destroy` / `OnDestroy` won't satisfy this) | Skips `JRScreen.xml` itself; walks `parentComponent` chain up to depth 32 |
| `bsc-plugin-print-locations.cjs` | Raw `print` calls outside the allowed sites | Allows `source/main.bs` (whole file) and `#if debug` blocks in `source/utils/globals.bs`; auto-skips top-level functions in any `source/*.bs` file (no `m` context, so no `m.log` available) |
| `bsc-plugin-observe-without-on-destroy.cjs` | `observeField` calls with no matching `unobserveField` (same field name, alias-aware target) anywhere in the file | Only runs on JRScreen subclass codebehinds; alias resolution via union-find over assignment statements (so `m.foo = bar` makes `m.foo` and `bar` interchangeable for matching) |
| `bsc-plugin-no-direct-sdk.cjs` | `sdk.<ns>.<fn>(...)` calls outside `source/api/ApiClient.bs` and `source/api/sdk.bs` | None — the only allowed callers are explicitly listed |

**Suppressing a false positive.** Each plugin honors these comment markers (case-insensitive, regex match against the source text):

```brightscript
' bsc-disable-line <plugin-id>           ← on the same line as the call
' bsc-disable-next-line <plugin-id>      ← on the line above
' bsc-disable-file <plugin-id>           ← anywhere in the file (whole-file opt-out)
```

Valid `<plugin-id>` values: `jrscreen-on-destroy`, `print-locations`, `observe-without-on-destroy`, `no-direct-sdk`. (Note: `jrscreen-on-destroy` only honors `bsc-disable-file` since the diagnostic is reported on the XML component declaration, not a specific source line.) Prefer the narrowest scope: line > next-line > file. Whole-file opt-outs should reference a tech-debt slug in a trailing comment so future readers know why.

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
| `npm run lint:js` | ESLint over `.js`/`.cjs`/`.mjs` repo-wide (flat config, `eslint.config.js`) |
| `npm run lint:json` | jshint on JSON files (excluding node_modules, scripts, tasks, build, out, locale, eslint.config.js, vitest.config.js). Catches duplicate keys; complementary to Prettier (which handles whitespace) |
| `npm run lint:markdown` | markdownlint on all `.md` (with exclusions for AI agent docs) |
| `npm run lint:spelling` | spellchecker on Markdown files |
| `npm run lint:translations` | Custom translation lint (sort order, completeness, placeholder parity) |
| `npm run lint:language-coverage` | Validates the 3-tier language-name resolver in `source/utils/languages.bs` (alias targets exist, tier 1 entries have alias coverage, no redundant fallbacks) — see `translations.md` |
| `npm run lint:docs` | Validates (1) `related-files:` paths in frontmatter, (2) relative markdown links, and (3) tech-debt anchor references of the form `tech-debt.md#<anchor>` — across `docs/architecture/*.md`, `docs/dev/*.md`, `docs/decisions.md`, every `CLAUDE.md`, and the BSC convention plugins (`scripts/bsc-plugins/*.cjs`). The anchor form is the canonical way to cite a slug; narrative-form mentions are intentionally not checked (see [tech-debt.md](tech-debt.md) preamble for the convention) |
| `npm run docs:stale` | Reports docs whose `last-reviewed` frontmatter is older than 90 days. Powers the quarterly arch-audit cadence; not a CI gate by default. Pass `--strict` to fail the run (e.g. for a quarterly check) |
| `npm run docs:stale:blocking` | The conditional hard gate. Fails (exit 1) if a stale (>120 days) **architecture** doc's `related-files` was modified by the PR without the doc itself being updated alongside. Architecture-only by design — dev guides under `docs/dev/` are informational, gating both would force `last-reviewed` bumps for unrelated workflow docs. Wired into the `lint-docs` workflow as a required check |
| `npm run agent-telemetry` | Aggregates `~/.claude/jellyrock-telemetry/tool-use.jsonl` (populated per-USER, not per-worktree, by the `PostToolUse` hook in `.claude/settings.json`) into a top-files-read / top-greps report. Signals where to expand subdir CLAUDE.md coverage |
| `npm run docs:dev-index` / `:check` | Regenerates / checks the auto-generated dev-guides index inside `docs/architecture/README.md`. Pre-push runs the regen as an auto-fix when `docs/dev/*.md` changes; `:check` runs unconditionally as a check step (catches manual README edits that didn't go through the regen) |
| `npm run check-formatting` | `bs` + `js` (project-wide). Aggregates `check-formatting:bs` (`bsfmt --check`) and `check-formatting:js` (`prettier --check .`) |
| `npm run check-formatting:bs` / `:js` | Type-scoped formatting checks. CI per-type workflows call the scoped variant (`lint-brightscript` runs `:bs` only, `lint-js` runs `:js` only) |
| `npm run format` | `bs` + `js` (project-wide). Aggregates `format:bs` (`bsfmt --write`) and `format:js` (`prettier --write .`) |
| `npm run format:bs` / `:js` | Type-scoped formatting writes |
| `npm run validate` | `bsc --noEmit` (type-check) |
| `npm run update-translations` | Auto-fix translation issues |
| `npm run test:scripts` | Vitest unit tests for `scripts/` (BSC plugins + tooling). Uses `vitest.config.js` |
| `npm run test:scripts:tdd` | Vitest watch mode (parity with `test:tdd` for BS) |

Documentation:

| Script | What it does |
|---|---|
| `npm run docs:settings` | Generate `docs/user/app-settings.md` from `settings/settings.json` via `scripts/generate/settings-docs.cjs` |

CHANGELOG management (CI-controlled, agents do NOT touch):

| Script | What it does |
|---|---|
| `npm run changelog:sync-unreleased` | Sync unreleased entries |
| `npm run changelog:sync-release` | Sync on release |
| `npm run changelog:validate` | Validate changelog format |
| `npm run changelog:status` | Show changelog status |

ropm + patches (post-install):

| Script | What it does |
|---|---|
| `npm run postinstall` | Runs `npm run ropm && npm run patches:apply` automatically after `npm install` |
| `npm run ropm` | `ropm copy && node scripts/ropm-hook.cjs` — copies vendored Roku modules into `components/roku_modules/` and `source/roku_modules/` |
| `npm run patches:apply` | `patch-package` — applies every diff in `patches/` to `node_modules/`. Lets us hold local fixes against upstream packages until the upstream change lands |

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
| `jshint` | JSON validation (incl. duplicate-key detection) — complementary to Prettier |
| `eslint` + `eslint-plugin-n` + `@eslint/js` | JS / CJS / ESM linting (flat config) |
| `eslint-config-prettier` | Disables ESLint formatting rules that would fight Prettier |
| `prettier` | JS / curated JSON formatting |
| `vitest` | Unit tests for `scripts/` (BSC plugins + tooling) |
| `dotenv` | `.env` file loading for device target/password |
| `fast-glob` | File matching in scripts |
| `husky` | Manages git hooks; installs `.husky/pre-push` on `npm install` (via `prepare` script) |
| `patch-package` | Applies diffs under `patches/` to `node_modules/` post-install. Used to hold targeted upstream fixes until the corresponding PR lands (e.g. `patches/rooibos-roku+6.0.0-alpha.50.patch` → upstream [rokucommunity/rooibos#364](https://github.com/rokucommunity/rooibos/issues/364)) |

Versions are pinned in `package.json` (currently on alpha versions of brighterscript ecosystem packages).

## JS hygiene (ESLint + Prettier + Vitest)

JellyRock's `scripts/` directory holds Node-side tooling — BSC plugins, doc-validation scripts, generators, the `changelog-syncer.js` script, etc. — that runs outside the BSC project. This section covers how that JS is linted, formatted, and tested.

### Module system

`package.json` has `"type": "module"`, so `.js` = ESM and `.cjs` = CJS. **BSC plugins MUST be `.cjs`** — BrighterScript's `loadPlugins` (in `brighterscript/dist/util.js`, the vendored package) uses `require()`. Anything `require()`'d by a `.cjs` file is also locked to `.cjs` (CJS can't `require()` ESM, though ESM can `import` CJS). That extends the constraint to `scripts/lib/*` and any other shared helper.

Rule for new scripts: net-new top-level CLI scripts go ESM `.js`; plugins and shared helpers stay `.cjs`. The 13 existing top-level `.cjs` scripts predate this rule and remain CJS — migrating them needs a require-graph audit first (tracked as `mixed-esm-cjs-scripts` in [tech-debt.md](tech-debt.md)).

### Tooling

- **[`eslint.config.js`](../../eslint.config.js)** — flat config, `@eslint/js` recommended + `eslint-plugin-n` `mixed-esm-and-cjs` preset. Disables `n/no-unpublished-*` (false positive — JellyRock isn't an npm package). Enforces `n/hashbang` for CLI shebangs, `n/prefer-node-protocol` for ESM imports of built-ins, plus standard `no-unused-vars` / `no-var` / `prefer-const`. `eslint-config-prettier` runs LAST to disable formatting rules that would fight Prettier.
- **[`.prettierrc.json`](../../.prettierrc.json)** — anchored to bsfmt style: 2-space indent, single quotes, semis, trailing commas (all), 100-col print width. JSONC parser for `.vscode/*.json` (they have comments).
- **[`.prettierignore`](../../.prettierignore)** — excludes `package-lock.json` (npm-owned), `locale/` (translation tooling owns), `tasks/jellyfin-server-openapi/` (vendor), `CHANGELOG.md` (CI-controlled), and the formats other tools own (`.bs`/`.brs`/`.xml`/`.md`).
- **[`vitest.config.js`](../../vitest.config.js)** — picks up `tests/scripts/**/*.test.js`. Test files are ESM regardless of source module system (Vitest handles cross-module-system imports).

### Surface ownership for JS/JSON

| Surface | What runs | Auto-fix? |
|---|---|---|
| **Pre-commit (lint-staged)** | `eslint --fix` + `prettier --write` on staged JS; `jshint` (check) + `prettier --write` on staged JSON | Yes |
| **Pre-push (`.husky/pre-push`)** | `lint:js` + `check-formatting:js` + `test:scripts` (gated on JS/JSON changes) | No |
| **CI (`lint-js.yml`)** | `lint:js` + `check-formatting:js` (catches `--no-verify` and fork PRs) | No |
| **CI (`test-scripts.yml`)** | `test:scripts` — Vitest unit tests for `scripts/` (path-filtered to scripts/ and tests/scripts/) | No |

Notes:

- **`lint:json` (jshint) and Prettier are complementary, not redundant.** jshint catches semantic issues Prettier doesn't (notably duplicate keys in JSON). Prettier catches formatting drift jshint doesn't.
- **Pre-push runs the project-wide checks**; pre-commit handles file-scoped auto-fix. CI mirrors pre-push.
- **The Prettier ignore list is canonical** — pre-commit and pre-push both invoke `prettier --write` / `--check` and trust `.prettierignore` to filter.

### Test surface

`tests/scripts/unit/<name>.test.js` mirrors `tests/source/unit/`. Vitest is jest-compatible API (`describe`, `it`, `expect`) but ESM-native. BSC plugin tests use inline scenarios today — short synthetic `.bs`/`.xml` strings passed to one of the harnesses in `tests/scripts/unit/_helpers/` (`run-plugin.js` for diagnostic-emitting plugins, `transpile-with-plugin.js` for transpile-mutating plugins like `roku-log`, `run-plugin-with-temp-locale.js` for virtual-file injectors like `translation-keys`). Fixture-file layouts (`tests/scripts/fixtures/<plugin>/...`) are a *future* option if scenarios grow large enough to warrant the indirection; not standardized yet. Coverage targets live in [`docs/dev/scripts-development.md`](../dev/scripts-development.md).

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

## Verification surfaces (defense in depth)

JellyRock layers five verification surfaces, each owning checks the others can't do well. The principle: **every check runs at the cheapest surface that can do it correctly.** No surface duplicates another's responsibility.

| # | Surface | Trigger | What it owns | Latency |
|---|---|---|---|---|
| 1 | **IDE** (BrighterScript ext) | Live, per keystroke | `.bs` validation + bslint diagnostics, `bsfmt` on save | <100 ms |
| 2 | **`PostToolUse` hook** ([`bsfmt-on-write.sh`](../../.claude/hooks/bsfmt-on-write.sh)) | Agent's `Edit` / `Write` / `MultiEdit` | `bsfmt --write` on the file just edited | ~500 ms |
| 3 | **End-of-turn hook** ([`check-touched-related-files.sh`](../../.claude/hooks/check-touched-related-files.sh) + [`check-touched-lint.sh`](../../.claude/hooks/check-touched-lint.sh)) | Agent finishes turn (`Stop` / `sessionEnd`) | Architecture-doc reminder + lint on **uncommitted-only** files | 2–5 s |
| 4 | **Pre-commit hook** ([`.lintstagedrc.cjs`](../../.lintstagedrc.cjs) via `lint-staged`) | `git commit` | File-scoped lint + auto-format on staged files | 1–5 s |
| 5 | **Pre-push hook** ([`.husky/pre-push`](../../.husky/pre-push)) | `git push` | Project-wide checks that aren't file-scoped | 10–30 s |
| 6 | **CI** (`.github/workflows/lint-*.yml`) | PR open / sync | Same as pre-push, can't bypass | minutes (parallel) |

### Why each surface exists

- **IDE** — fastest possible feedback loop for human devs, but assumes a configured/working BrighterScript extension. Doesn't fire for agents.
- **`PostToolUse`** — the agent's "format on save." Auto-formats `.bs` / `.brs` immediately after the agent writes them so the next read shows canonical form. Silent on success — no context noise. Limited to `bsfmt` because anything project-wide (validate, bslint) would be too slow per-edit.
- **End-of-turn** — covers the gap when the agent has work that *isn't yet committed*. The lint variant scans only working-tree files (committed work is pre-commit's job — running it again here would be wasted cycles). The doc-maintenance variant reminds the agent about architecture-doc related-files territory it touched. Both informational, never block the turn.
- **Pre-commit** (`lint-staged`) — the universal gate for both humans and agents. File-scoped: `bsfmt --write`, `markdownlint --fix`, `spellchecker`, `jshint`. Auto-fix steps re-stage their output so the formatted version lands in the same commit (no "auto-fix commit" ceremony). The `lint-staged` runner handles the staged-files plumbing.
- **Pre-push** — what couldn't run per-commit: full BSC project compile (`bsc --noEmit`), `bslint` (needs full project context, can't be file-scoped), cross-doc reference check (`lint:docs`), drift check on the auto-generated dev-guides index, language-coverage. Plus project-wide regen tasks (`update-translations`, `docs:dev-index`) that mutate one output from many inputs.
- **CI** — final backstop; can't be bypassed. Mirrors pre-push so the local hook isn't a load-bearing source of truth.

### Surface ownership of each lint command

| Command | Pre-commit (file-scoped) | Pre-push (project-wide) | Why |
|---|---|---|---|
| `bsfmt --write` | ✓ | — | File-scoped; auto-fix re-stages |
| `bslint` (`lint:bs`) | — | ✓ | Needs full project context (cross-file scope resolution) |
| `bsc --noEmit` (`validate`) | — | ✓ | Project-wide compile, ~10–30 s |
| `markdownlint-cli2 --fix` | ✓ | — | File-scoped; auto-fix re-stages |
| `spellchecker` (`lint:spelling`) | ✓ | — | File-scoped; no auto-fix (correctness) |
| `jshint` (`lint:json`) | ✓ | — | File-scoped; no auto-fix |
| `docs-check.cjs` (`lint:docs`) | — | ✓ | Cross-doc reference check; needs all docs loaded |
| `generate-dev-index.cjs --check` | — | ✓ | Drift check on auto-generated table |
| `update-translations` (regen) | — | ✓ | Project-wide regen from `en_US.json` |
| `lint:language-coverage` | — | ✓ | Conditional on specific files; unusual pattern |

Excludes mirror `package.json`'s `lint:*` scripts via shared helpers in [`scripts/lib/lint-excludes.cjs`](../../scripts/lib/lint-excludes.cjs) — the lint-staged config, the end-of-turn hook script, and the package.json scripts all consult the same source so excludes don't drift.

### Bypass discipline

- `git commit --no-verify` skips the pre-commit hook; `git push --no-verify` skips the pre-push hook. Either is acceptable in genuine emergencies, but CI catches everything regardless — a `--no-verify` commit gets rejected at PR time.
- `--no-verify` should never be the agent's first move when a hook complains. Fix the underlying issue.

### Why agents shouldn't run `npm run lint:*` manually

The hooks already do it at the right granularity (per-edit, per-commit, per-push). Manual runs duplicate work and waste tokens on output the agent didn't need. **Exception:** debugging a specific failure that the hook surfaced.

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

- Logic: [`scripts/lint/check-touched-related-files.cjs`](../../scripts/lint/check-touched-related-files.cjs)
- Claude Code wrapper: `Stop` hook in `.claude/settings.json` → [`.claude/hooks/check-touched-related-files.sh`](../../.claude/hooks/check-touched-related-files.sh)
- Copilot Coding Agent wrapper: `sessionEnd` in [`.github/hooks/hooks.json`](../../.github/hooks/hooks.json). **Only fires for the GitHub-hosted Coding Agent variant** — in-IDE Copilot Chat doesn't consume that file.
- opencode wrapper: not yet implemented (the `@opencode-ai/plugin` API surface needs verification before plugging in).

Informational only — never blocks the agent. The point is to prompt the right action *during* work, not force it. Forced blocking would tempt the agent to bump `last-reviewed` mechanically to clear the block, which would erode the freshness signal.

### 2. CI gate (hard, per-PR)

The conditional hard gate. `lint-docs.yml` runs `npm run docs:stale:blocking` on every PR; the script exits non-zero only when the PR modifies a stale architecture doc's `related-files` without updating the doc itself. Surgical pressure: PRs that touch unrelated areas pass freely.

Designed to avoid the blanket-gate trap (every PR blocked once any doc is stale) — see the docstring on [`scripts/lint/docs-stale-blocking.cjs`](../../scripts/lint/docs-stale-blocking.cjs) for the design rationale.

### 3. Weekly stale tracker (visibility)

[`.github/workflows/docs-stale-tracker.yml`](../../.github/workflows/docs-stale-tracker.yml) runs every Monday morning UTC, finds the stale list, and maintains a single canonical issue labeled `docs:stale`:

- Opens the issue when stale docs exist and no issue is open
- Edits the body in place when the list changes (one issue, not per-doc — keeps noise low)
- Auto-closes when no docs are stale
- Splits the body into "Architecture (PR-gated at 120 days)" and "Dev guides (informational)" so contributors understand which entries block PRs

The combination: agent sees a soft prompt during work (#1), CI blocks at PR time if the stale-doc territory was touched (#2), weekly tracker keeps any unresolved staleness visible (#3).

## End-of-turn lint feedback for agents

The IDE catches `.bs` issues live. The pre-push hook is the catch-all backstop. **Between** them, an agent working autonomously had no live feedback on lint categories the IDE doesn't cover (markdown, spelling, JSON, etc.) — so a typo in a doc edit would surface only at `git push` time, after the agent had already reported "done." The user, not the agent, ends up debugging.

[`scripts/lint/check-touched-lint.cjs`](../../scripts/lint/check-touched-lint.cjs) closes this gap. It runs on the same `Stop` / `sessionEnd` hook as the architecture-doc reminder (sibling wrappers in [`.claude/hooks/check-touched-lint.sh`](../../.claude/hooks/check-touched-lint.sh) and [`.github/hooks/hooks.json`](../../.github/hooks/hooks.json)) and:

- Computes the set of files the agent touched this session (committed + uncommitted + untracked, via the shared [`scripts/lib/changed-files.cjs`](../../scripts/lib/changed-files.cjs) helper)
- Runs `spellchecker-cli` and `markdownlint-cli2` on changed `.md` files, and `jshint --extra-ext .json` on changed `.json` files
- Surfaces failures to `stdout` so they land in the agent's next-turn context

What it does *not* run: `lint:bs` / `validate` / `check-formatting` (IDE), `lint:docs` (the related-files reminder + CI gate already cover this), `lint:translations` / `lint:language-coverage` (niche; the pre-push hook still catches them).

Non-blocking by design — same rationale as the doc-maintenance reminder. If the failure is a false positive (e.g., legitimate new technical vocabulary that needs to be added to `dictionary.txt`), the agent can fix it without being blocked from declaring done. The pre-push hook still rejects the push if the agent ignores the surfaced output.

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
