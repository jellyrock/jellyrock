---
topic: build-and-tooling
related-files:
  - bsconfig.json
  - bsconfig-prod.json
  - package.json
  - patches/
  - Makefile
  - scripts/create-package.cjs
  - scripts/create-signed-package.cjs
  - scripts/harden-prod-manifest.js
  - manifest
  - scripts/bsc-plugins/roku-log.cjs
  - scripts/bsc-plugins/translation-keys.cjs
  - scripts/bsc-plugins/jrscreen-on-destroy.cjs
  - scripts/bsc-plugins/print-locations.cjs
  - scripts/bsc-plugins/observe-without-on-destroy.cjs
  - scripts/bsc-plugins/no-direct-sdk.cjs
  - scripts/bsc-plugins/no-raw-run.cjs
  - scripts/bsc-plugins/callfunc-interface.cjs
  - scripts/lint/dictionary-audit.cjs
  - scripts/lint/docs-check.cjs
  - scripts/lint/docs-stale.cjs
  - scripts/lint/docs-stale-blocking.cjs
  - scripts/lint/check-touched-related-files.cjs
  - dictionary.txt
  - scripts/lint/check-touched-lint.cjs
  - scripts/lint/decision-shape-nudge.cjs
  - scripts/lint/progress-cursor-nudge.cjs
  - scripts/lint/issue-templates-check.cjs
  - scripts/lint/validate-deps-workflow-sync.cjs
  - scripts/journal-sync.js
  - scripts/lint/issue-forms.schema.json
  - scripts/generate/dev-index.cjs
  - scripts/generate/icons-build.js
  - scripts/generate/icons-add.js
  - resources/icons/
  - resources/placeholders/
  - resources/placeholders/placeholders.json
  - manifest
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
  - .claude/hooks/check-progress-cursor.sh
  - .claude/hooks/bsfmt-on-write.sh
  - .github/hooks/hooks.json
  - .github/actions/changed-paths/action.yml
  - .github/workflows/lint-docs.yml
  - .github/workflows/_lint-docs.yml
  - .github/workflows/_lint-js.yml
  - .github/workflows/lint-js.yml
  - .github/workflows/_test-scripts.yml
  - .github/workflows/test-scripts.yml
  - .github/workflows/_lint-issue-templates.yml
  - .github/workflows/lint-issue-templates.yml
  - .github/workflows/_smoke-test-deps.yml
  - .github/workflows/_validate-dependencies.yml
  - .github/workflows/docs-stale-tracker.yml
  - .github/workflows/journal-sync.yml
  - .github/workflows/device-unit-tests.yml
  - .github/workflows/rta-functional-tests.yml
  - eslint.config.js
  - .prettierrc.json
  - .prettierignore
  - vitest.config.js
last-reviewed: 2026-08-06
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

## Compile-time flags (`bs_const`)

The `manifest`'s `bs_const` line carries three compile-time constants. **Roku's on-device
compiler evaluates `#if`, not `bsc`** — the directives are passed straight through and appear
verbatim in the emitted `.brs`, then get compiled out at load time against the shipped
manifest. Two consequences that are easy to get wrong:

- **Grepping `build/**/*.brs` to check whether a flag is off proves nothing.** The `#if`
  block is always present there. Read `build/manifest` instead.
- **`bsconfig.json`'s `manifest.bs_const` cannot enforce anything.** BrighterScript applies
  it to its own in-memory manifest only; the `manifest` file is copied to `build/` verbatim,
  so the override never reaches the device.

| Constant | Default | What it gates |
|---|---|---|
| `debug` | `false` | Failure injection (`DebugFlags`), the toast cheat code, the Task-thread ledger, `rawApiData`/`raw*` payload attachment, and log level 4 vs 2. See [debug-flags.md](../dev/debug-flags.md) |
| `perfTiming` | **`true`** | Orchestrator wait/emit instrumentation in `LoadLatestRowsTask` + `LoadItemsTask2`. See [home-first-paint-performance.md](../dev/home-first-paint-performance.md) |
| `ENABLE_RTA` | `false` | The RTA on-device component. Flipped to `true` in the build directory by the RTA deploy itself |

`perfTiming` defaults **on** so dev builds print the numbers without ceremony — instrumentation
behind a flag-flip-and-rebuild stops being looked at, and stops functioning as a baseline. It is
deliberately separate from `debug` rather than folded into it: a `debug` build attaches
`rawApiData` to every transformed item, which lands inside the `emit` measurement, so sharing the
flag would mean the only build that can read the numbers is one that distorts them.

### Production hardening

[`scripts/harden-prod-manifest.js`](../../scripts/harden-prod-manifest.js) is the
final step of `npm run build:prod`. It rewrites `build/manifest` to force `debug`, `perfTiming`,
and `ENABLE_RTA` to `false`, prints what it flipped, and fails loudly if the manifest is missing
or has no `bs_const` line. Every route to a release artifact composes `build:prod`, so
`npm run package:signed` is covered too.

This exists because `roku-log`'s `strip` removes log *calls* from production but not the code
feeding them — the timing clocks would otherwise run in production and have their results
discarded. It also means a `debug=true` flip left in the working tree cannot reach a release —
and that flip is routine, because the log level is welded to the same const, so raising
verbosity means flipping `debug`. It has landed on `main` as `true` **twice** (`27d99141`,
`dc05db8d`), each reverted the same day.

The script also **denies by default**: after forcing the known dev `bs_const` values off, any const still
`true` fails the build by name. `FORCED_OFF` is a deny-list and only knows what someone
remembered to add, while the const set turns over every few months (`printReg` → `debug` →
`ENABLE_RTA` → `perfTiming`) — and `perfTiming` is the first one to default `true`, which is
the pattern the next dev flag will copy. A const that legitimately must ship enabled opts into
`ALLOWED_TRUE` explicitly.

A manifest that *drops* a const never reaches the script: `bsc` raises
`hash-const-does-not-exist` (error, exit 1) for every `#if` referencing an undeclared const,
and `build:prod` chains the two with `&&`.

Verify with:

```bash
npm run build:prod && grep bs_const build/manifest
# bs_const=debug=false;ENABLE_RTA=false;perfTiming=false
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

Six plugins encode unwritten conventions documented in `components/CLAUDE.md` / `source/CLAUDE.md` so violations surface as IDE diagnostics + CI failures instead of bugs at runtime, and never crash the build on edge cases. The first four emit warnings (severity 2); `callfunc-interface` and `no-raw-run` emit an **error** (severity 1) — an undeclared `callFunc` target is a guaranteed silent no-op, and an unaccounted Task launch is the `&h29` crash class from epic #728, so neither is a style nit.

| Plugin | Flags | Smart filtering |
|---|---|---|
| `bsc-plugin-jrscreen-on-destroy.cjs` | XML components that transitively extend `JRScreen` whose codebehind doesn't declare a top-level `onDestroy` function (case-sensitive — `destroy` / `OnDestroy` won't satisfy this) | Skips `JRScreen.xml` itself; walks `parentComponent` chain up to depth 32 |
| `bsc-plugin-print-locations.cjs` | Raw `print` calls outside the allowed sites | Allows `source/main.bs` (whole file) and `#if debug` blocks in `source/utils/globals.bs`; auto-skips top-level functions in any `source/*.bs` file (no `m` context, so no `m.log` available) |
| `bsc-plugin-observe-without-on-destroy.cjs` | `observeField` calls with no matching `unobserveField` (same field name, alias-aware target) anywhere in the file | Only runs on `JRScreen` subclass codebehinds; alias resolution via union-find over assignment statements (so `m.foo = bar` makes `m.foo` and `bar` interchangeable for matching) |
| `bsc-plugin-no-direct-sdk.cjs` | `sdk.<ns>.<fn>(...)` calls outside `source/api/ApiClient.bs` and `source/api/sdk.bs` | None — the only allowed callers are explicitly listed |
| `bsc-plugin-no-raw-run.cjs` **(error)** | A `control` field written with `"RUN"` — `node.control = ...`, `node["control"] = ...`, `node.setField("control", ...)`, or a literal `node.setFields({ control: ... })` — or written with a value that cannot be resolved statically, outside `source/utils/tasks.bs`. I.e. a Task thread started without going through `launchTask()`, so it cannot be counted | Only `"RUN"` is a thread start: `control` is also Animation's `"start"/"pause"/"resume"` and Video's `"play"/"rewind"/"none"`, and ~95 such writes are left alone. `components/vendor/**` is excluded (the vendored `WebSocketClientTask` self-starts). `setField` is keyed on a **literal** `"control"` first argument, so a generic `setField(name, value)` helper never trips it; `setFields` is inspected when its argument is a literal AA. Known gap: `setFields(someVariable)` can't be inspected statically, and flagging every non-literal one to chase soundness would false-positive across the codebase |
| `bsc-plugin-callfunc-interface.cjs` **(error)** | `callFunc("X")` where `X` is a method DEFINED in one of our component codebehinds but declared in NO component `<interface><function>` anywhere — the silent-no-op bug | Program-wide, case-insensitive membership: if ANY component exposes `X`, no site is flagged (errs toward false-negatives, away from false-positives). Skips `roku_modules`; ignores non-literal `callFunc` args |

**Suppressing a false positive.** Each plugin honors these comment markers (case-insensitive, regex match against the source text):

```brightscript
' bsc-disable-line <plugin-id>           ← on the same line as the call
' bsc-disable-next-line <plugin-id>      ← on the line above
' bsc-disable-file <plugin-id>           ← anywhere in the file (whole-file opt-out)
```

Prefer the narrowest scope: line > next-line > file. Whole-file opt-outs should reference a tech-debt slug in a trailing comment so future readers know why.

**Not every plugin honors all three markers.** Reaching for one a plugin doesn't implement fails silently — the comment sits there looking like a suppression while the diagnostic keeps firing:

| `<plugin-id>` | line | next-line | file | |
|---|---|---|---|---|
| `print-locations` | ✅ | ✅ | ✅ | |
| `observe-without-on-destroy` | ✅ | ✅ | ✅ | |
| `callfunc-interface` | ✅ | ✅ | ✅ | Suppressing should be extremely rare — an undeclared target is normally a real bug |
| `no-direct-sdk` | ✅ | ✅ | ❌ | |
| `no-raw-run` | ✅ | ✅ | ❌ | **Deliberate.** A whole-file opt-out on an error-severity thread-budget guard would silently remove the bound from a whole file; suppress the one line and say why |
| `jrscreen-on-destroy` | ❌ | ❌ | ✅ | The diagnostic lands on the XML component declaration, not a source line |
| `auto-abandon-promises` | ❌ | ❌ | ✅ | |

### Other plugins

- **`@rokucommunity/bslint`** — lint rules (`lintConfig: bslint.json`)
- **`brighterscript-xml-plugin`** — XML linting and parsing for component definitions

## npm scripts — `package.json`

Build:

| Script | What it does |
|---|---|
| `npm run build` | Dev build (`bsc --project bsconfig.json`) |
| `npm run build:prod` | Production build with log stripping, then [manifest hardening](#compile-time-flags-bs_const) — forces every dev `bs_const` off |
| `npm run build:tests` | All test suites |
| `npm run build:tests-unit` | Unit tests only |
| `npm run build:tests-integration` | Integration tests only |
| `npm run build:tests-complete` | Complete suite |
| `npm run build:tdd` | TDD watch mode (uses `bsconfig-tdd.json`) |
| `npm run package` | Create installable .zip via `scripts/create-package.cjs` |
| `npm run package:signed` | Compose `build:prod` then sign via `scripts/create-signed-package.cjs` — produces `out/jellyrock-vX.Y.Z.pkg` (version from `manifest`) for Roku channel-store upload. Local-only (no CI variant); requires a physical Roku in dev mode plus `ROKU_IP` / `ROKU_PASSWORD` / `ROKU_SIGNING_PASSWORD` in `.env`. Optional `ROKU_DEV_ID` enables dev-ID verification. Refuses to sign if `build/` contains source maps (dev/test build guard). See [`docs/admin/releases.md` → Signed `.pkg`](../admin/releases.md#signed-pkg-for-roku-channel-store) |
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
| `npm run lint:dictionary` | Audits `dictionary.txt` for identifier-shaped entries (PascalCase / camelCase / file extensions / paths). Code identifiers belong in backticks in source markdown, not in the dictionary — see [code-style.md](../dev/code-style.md#when-to-add-to-dictionarytxt-instead). Acronym plurals (`URIs`, `PNGs`) and product names (`BrighterScript`, `ESLint`) are bypassed via pattern + allowlist |
| `npm run lint:translations` | Custom translation lint (sort order, completeness, placeholder parity) |
| `npm run lint:language-coverage` | Validates the 3-tier language-name resolver in `source/utils/languages.bs` (alias targets exist, tier 1 entries have alias coverage, no redundant fallbacks) — see `translations.md` |
| `npm run lint:docs` | Validates (1) `related-files:` paths in frontmatter, (2) relative markdown links, and (3) tech-debt anchor references of the form `tech-debt.md#<anchor>` — across `docs/architecture/*.md`, `docs/dev/*.md`, `docs/adr/*.md`, `docs/decisions.md`, `docs/progress.md`, `docs/signals-backlog.md`, every `CLAUDE.md`, and the BSC convention plugins (`scripts/bsc-plugins/*.cjs`). Also runs three journal-system gates: (4) `progress-frontmatter` — fails if `docs/progress.md` is missing a well-formed `last-updated:` field (a *structural* per-PR check; **temporal** staleness of that field is deliberately NOT gated here — it moved to the non-blocking weekly `docs-stale-tracker.yml` + the local `progress-cursor-nudge.cjs` nudges, because staleness is a property of `main`, not of any one PR); (5) `signals-schema-invalid` — fails if a `docs/signals-backlog.md` row is missing required bullets, has an invalid `status` enum, or a malformed ISO date; (6) `decisions-supersede-chain` — fails if a `docs/decisions.md` note has a duplicate slug, a field declared twice, an invalid `status` enum, a pointer that doesn't resolve to a slug **in that file**, asymmetric pointers, a superseded target still reading `accepted`, a `superseded` note naming no successor, a `withdrawn` note used as either end of a supersede, or anything pointing at itself. Fields are read only from the contiguous block under a note's heading, so body prose can't be mistaken for one. Two shapes are modeled: the **full** ritual (predecessor flips to `superseded` + `superseded-by`; successor declares `supersedes`) and the **partial** one (`partially-supersedes` / `partially-superseded-by`, each carrying a required `(scope)` annotation, with **both notes staying `accepted`** because both are still live — mirroring ADR 0003/0004 and 0008/0011). The supersede ritual is a three-part hand edit, so a half-applied one used to leave the chain quietly lying; ADRs express the same relationship as prose (`**Status:** Superseded by …`) rather than as fields, so the ADR side remains unchecked, as does any note↔ADR relationship (those are prose links, validated by check (2)). The anchor form is the canonical way to cite a slug; narrative-form mentions are intentionally not checked (see [tech-debt.md](tech-debt.md) preamble for the convention) |
| `npm run lint:issue-templates` | Validates `.github/ISSUE_TEMPLATE/*.yml` against GitHub's vendored issue-forms JSON Schema (`scripts/lint/issue-forms.schema.json`). GitHub silently drops invalid templates from `/issues/new/choose` with no error surfaced anywhere — schema breakage (empty `title`, missing required field, unknown body type) is otherwise invisible until someone tries to file an issue |
| `npm run lint:socket-auth-binding` | Guards the `ws://` session-identity binding (#743): the remote-control receiver must set `m.ws.headers` BEFORE `m.ws.open`, and the vendored `WebSocketClientTask.brs` must keep its header-seeding modifications (no restored upstream `m.top.headers = m.ws.get_headers()` clobber, seed between observer registration and `open()`, no `m.task_port`). None of those fail loudly when broken — the app builds, connects, and passes every test while silently delivering cast commands to the wrong Jellyfin session. An end-to-end test can't reach the path (RTA drives an `https://` server; the `ws://` receiver only runs on `http://`), so this gates the source shape instead. Wired into the `lint-brightscript` workflow |
| `npm run lint:socket-thread-release` | Guards release of the `ws://` socket Task thread (epic #728). A Task thread is not released by dropping the node reference, so the vendored loop must `exit while`, `closeSocket()` must `STOP` the child, and `SignOut` must stop the published `socketNode` — through a local snapshot, never by dotting the field twice (`STOP` doesn't join the receiver, so re-reading races `closeSocket()` clearing it). The subtle rule is *ordering*: the exit test must sit BEFORE `m.ws.run()`, because `run()` both performs the CLOSED transition and posts the final `on_close`, so a drained-port check after it releases the thread with the terminal event still queued — the receiver then blocks forever instead of reconnecting. Same unreachable path as the binding check above, so the paired Vitest suite executes a model of the loop whose ordering is read back out of the real file. Wired into the `lint-brightscript` workflow |
| `npm run lint:ci-parity` | The CI/local parity meta-gate. Expands the `npm run lint` aggregate to its leaves and fails when any leaf is not invoked by some workflow under `.github/workflows/`, matching `npm run <name>` or a direct `node scripts/...` call. Comment lines are stripped first, so a *mention* of a check never counts as a *run* of it. Deliberate exceptions live in a `LOCAL_ONLY` allowlist requiring a written reason, and a stale entry (now covered by CI, or gone from the aggregate) is itself a failure. Uses only the Node standard library, so it runs without `npm ci`. Wired into the `lint-docs` workflow beside `lint:ci-workflow-sync` — the two are siblings, guarding the same drift class one layer apart. Does **not** prove the hosting workflow's `paths` filter matches what the check reads, nor that its status-check context is required on `main` — see [tech-debt.md](tech-debt.md#ci-path-filters-unverified) |
| `npm run catchup:state` | Runs the session-state aggregator (`scripts/catchup-state.js`) and emits a JSON document with git state, open PRs, issues, CI runs, handoffs, and the four project journals. Primary consumer is `/catchup` (global session brief) and `/ramp <area>` (area-scoped brief); not a lint or build step — useful for debugging what those skills receive |
| `npm run docs:stale` | Reports docs whose `last-reviewed` frontmatter is older than 90 days. Powers the quarterly arch-audit cadence; not a CI gate by default. Pass `--strict` to fail the run (e.g. for a quarterly check) |
| `npm run docs:stale:blocking` | The conditional hard gate. Fails (exit 1) if a stale (>120 days) **architecture** doc's `related-files` was modified by the PR without the doc itself being updated alongside. Architecture-only by design — dev guides under `docs/dev/` are informational, gating both would force `last-reviewed` bumps for unrelated workflow docs. Wired into the `lint-docs` workflow as a required check |
| `npm run agent-telemetry` | Aggregates `~/.claude/jellyrock-telemetry/tool-use.jsonl` (populated per-USER, not per-worktree, by the `PostToolUse` hook in `.claude/settings.json`) into a top-files-read / top-greps report. Signals where to expand subdir CLAUDE.md coverage |
| `npm run docs:dev-index` / `:check` | Regenerates / checks the auto-generated dev-guides index inside `docs/architecture/README.md`. Pre-push runs the regen as an auto-fix when `docs/dev/*.md` changes; `:check` runs unconditionally as a check step (catches manual README edits that didn't go through the regen) |
| `npm run icons:build` / `:check` | Regenerates / checks the per-resolution PNG triples (`<name>_fhd.png` + `<name>_hd.png`) under `images/icons/` (icon set) and `images/placeholders/` (placeholder set) from SVG sources in `resources/icons/`. Driven by `resources/icons/icons.json` (icon overrides) and `resources/placeholders/placeholders.json` (placeholder set). Powers the `uri_resolution_autosub` pipeline (see [Icon resolution pipeline](#icon-resolution-pipeline) below). Pre-push runs the regen as an auto-fix when `resources/icons/*.svg`, `resources/icons/icons.json`, `resources/placeholders/placeholders.json`, or [`scripts/generate/icons-build.js`](../../scripts/generate/icons-build.js) changes; `:check` runs as a check step in the same conditional |
| `npm run icons:add -- <material_name> [--as <jellyrock_name>] [--filled]` | Adds a new icon by fetching the canonical Material Symbols SVG from `google/material-design-icons` (Rounded variant, weight 500, **outlined by default — `fill=0`**, `24px` — locked house style), injecting white fill for `blendColor` tinting, saving to `resources/icons/`, and appending a row to the [provenance table](../../resources/icons/README.md#provenance). The `--filled` flag fetches the filled variant for the documented exception cases (toggle on-states, pure shapes, avatars, placeholders — see [Fill convention](../../resources/icons/README.md#fill-convention)). Removes the manual `icons.google.com` browse step. After running, follow up with `npm run icons:build` and update the call-site URI |
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

## Icon resolution pipeline

JellyRock declares `ui_resolutions=fhd` in [`manifest`](../../manifest) — the app is designed at 1920×1080 design coordinates and the Roku OS automatically downsamples the framebuffer to 720p / 480p on HD / SD devices. The manifest also declares:

```text
uri_resolution_autosub=$$RES$$,sd,hd,fhd
```

This is a Roku-blessed primitive: at image-load time, the OS rewrites the magic token `$$RES$$` in any image URI to `sd`, `hd`, or `fhd`. A Poster URI like `pkg:/images/icons/play_$$RES$$.png` then resolves to `play_fhd.png`, `play_hd.png`, or `play_sd.png`.

> **Current limitation — read this before assuming the HD assets deliver native rendering.** With `ui_resolutions=fhd` set, the OS holds rendering at FHD design space and downsamples the whole framebuffer at the end. So even though the autosub mechanism + per-resolution PNGs are in place, the HD assets do not currently deliver a measurable quality win — they get loaded into Posters sized at FHD and scaled by the framebuffer downsample like everything else. Fully realizing this pipeline requires a layout refactor so every dimension is computed from `m.global.device.uiResolution` instead of hardcoded against `1920` / `1080`; only then can we declare `ui_resolutions=hd,fhd` and have Roku render natively per device. Tracked as [`hd-native-layout-refactor`](tech-debt.md#hd-native-layout-refactor). The current PR is foundation work — the asset pipeline is durable and the per-resolution PNGs will start delivering value immediately when the layout refactor lands.

### Source-of-truth layout

- **SVG sources** live in [`resources/icons/`](../../resources/icons/) and are committed. JellyRock standardizes on the [Material Symbols](https://fonts.google.com/icons) family (Rounded variant, weight 500, **outlined by default**, `24px`) — locked in the `npm run icons:add` script so contributors can't drift. The Fill convention has 7 documented exception cases (pure shapes, small-canvas sizes, avatars, placeholders, ratings, playback action buttons, toggle on-states); see [`resources/icons/README.md`](../../resources/icons/README.md#fill-convention) for the rules + decision tree.
- **Generated PNGs** at `images/icons/<name>_fhd.png` and `<name>_hd.png` are produced by [`scripts/generate/icons-build.js`](../../scripts/generate/icons-build.js) via [sharp](https://sharp.pixelplumbing.com/). These are committed too (matches the pattern of committed-but-generated artifacts elsewhere in the repo, e.g. `source/utils/translationKeys.bs`).
- **Per-icon overrides** in `resources/icons/icons.json` carry two distinct sizes: `sizeFhd` (canvas dimensions in pixels — the Poster's `width`/`height`) and `glyphSize` (how big the visible glyph is *inside* the canvas; the rest is transparent padding). Both auto-detect from existing PNGs when migrating; explicit overrides are only needed when the auto-detection would produce the wrong result. See the [glyph-density section in the README](../../resources/icons/README.md#glyph-density) for the resolution order.
- **Placeholder set** in `resources/placeholders/placeholders.json` defines a second render pass through the same pipeline — placeholder glyphs render at 256×256 FHD into `images/placeholders/<name>_fhd.png` (and `_hd.png`). Each entry maps a placeholder name to a source SVG (typically a filled variant from `resources/icons/`) plus its canvas / glyph sizing. The `JRPlaceholder` SceneGraph component (see `components/ui/placeholder/`) loads the resulting URI through `getPlaceholderImagePath()` (`source/utils/placeholderImage.bs`) and overlays it on a themed `RectangleBackgroundSecondary` backdrop tinted via `blendColor=colorBackgroundPrimary` — backgrounds are runtime-themed SceneGraph composition, not baked-in PNG layers.
- **Shared glyphs** (Material symbols needed in both an outlined-icon context and a filled-placeholder context — e.g. `album`) commit two SVG files: `<name>.svg` (outlined for icon use) + `<name>_filled.svg` (filled for placeholder use, referenced from `placeholders.json`). The build script auto-skips files ending in `_filled.svg` from the icons-rendering loop so we don't generate orphan icon PNGs for placeholder sources.

### Pipeline contract

`npm run icons:build` reads each `resources/icons/*.svg`, determines the canvas size and glyph size per icon (override > measurement of the existing PNG > defaults `96`/`54`), then for each render: rasterizes the SVG large, trims Material's design-grid padding, resizes the bare glyph to the target glyph size (preserving aspect ratio), and center-pads with transparent border to canvas size. The trim step is the load-bearing piece — it kills Material's ~25% built-in padding so per-icon density is honored. Sharp config is locked (compression level, `lanczos3` kernel, exact-pinned sharp version) so byte-identical output is reproducible across runs.

`npm run icons:check` does the same render in-memory and compares against on-disk PNGs, exiting nonzero on drift — the CI / pre-push enforcement.

### Pre-push integration

When a push includes changes to `resources/icons/*.svg`, `resources/icons/icons.json`, or `scripts/generate/icons-build.js`, the pre-push hook runs `npm run icons:build` in the auto-fix bucket (alongside translation regen and the `docs:dev-index` regen) and folds the regenerated PNGs into the auto-fix commit. `npm run icons:check` then runs as a check step. Drift never lands.

### Migration / opt-in

Existing single-resolution PNGs in `images/icons/` continue to work unchanged. The `uri_resolution_autosub` rewrite only fires when the magic `$$RES$$` token is present in the URI — call sites that load `pkg:/images/icons/<name>.png` (no token) get the asset as-is and are auto-scaled by the OS as today. Migrating an icon to the per-resolution pipeline is per-asset and reversible: drop the SVG, run `icons:build`, swap the call-site URI, delete the legacy single-res PNG.

### Coexistence with `splash_screen_*` / `mm_icon_focus_*`

The manifest's existing splash + channel-poster triples (lines 8-21) use a different OS mechanism (explicit per-resolution manifest keys) and are unaffected by `uri_resolution_autosub`. Both mechanisms coexist cleanly.

### Phase-2 deferral — native SD

The `sd` slot in `uri_resolution_autosub` is reserved but not yet populated. Native SD support requires NTSC pixel-aspect-ratio handling in the build script (SD framebuffer pixels are non-square: 720×480 with 8:9 or 32:27 SAR). A naive square-pixel render would produce horizontally-squished SD assets that may look worse than the alternative — letting the OS auto-scale from HD. Until that's empirically verified on hardware, SD devices fall back to the `hd` substring (one downsample step). Tracked as [`sd-resolution-native-support`](tech-debt.md#sd-resolution-native-support).

## Roku signing pipeline (`.pkg` for channel store)

Roku channel-store submission requires a signed `.pkg`, not the sideload `.zip`. Roku has no submission API — uploading the `.pkg` to the dev portal is always manual. The production of the `.pkg` is automated locally via [`scripts/create-signed-package.cjs`](../../scripts/create-signed-package.cjs) and `npm run package:signed`.

**Why local, not CI.** Solo-maintainer ritual; the time CI signing would save (a sideload + a portal-UI sign) is washed out by the friction of a CI-produced artifact (download + auth + storage). Local stays simpler and matches the same `.env`-based credential pattern already used for `ROKU_IP` / `ROKU_PASSWORD` in `scripts/run-roku-tests.js`.

**Why hardware is required.** `roku-deploy.deployAndSignPackage()` is a thin wrapper over `deploy()` + `signExistingPackage()`. The signing runs on the Roku itself: `roku-deploy` uploads the zip, hits the dev-portal sign endpoint with the signing password, and downloads the resulting `.pkg`. There is no offline signing path.

**Prod-build guard.** The script refuses to sign a `build/` directory that contains source maps. `bsconfig-prod.json` has `sourceMap: false`; `bsconfig.json` and `bsconfig-tests*.json` both have `sourceMap: true`. Any `.map` file under `build/` means an unsafe build is sitting there. The composed npm script (`npm run build:prod && node scripts/create-signed-package.cjs`) makes the default invocation always safe; the in-script guard catches direct `.cjs` invocations against a stale build.

**Dev-ID verification (optional).** When `ROKU_DEV_ID` is set, it's passed to `deployAndSignPackage()` and the call aborts if the device's cert produces a `.pkg` with a different ID. Roku channel-store updates must be signed with the same dev ID as prior versions, so this catches a wrong-cert `.pkg` before manual upload.

Full operator runbook (env setup, when to run, manual upload): [`docs/admin/releases.md` → Signed `.pkg` for Roku channel store](../admin/releases.md#signed-pkg-for-roku-channel-store).

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
- **Pre-push runs the project-wide checks**; pre-commit handles file-scoped auto-fix. **CI does not mirror pre-push** — and it never runs the `npm run lint` aggregate. CI is assembled from the per-domain reusable workflows (`_lint-*.yml`), each with its own path filter, so the two surfaces are wired independently and a check must be added to both. That independence is deliberate (path-filtered parallel jobs keep a docs-only PR from paying a full BrighterScript compile), but it silently cost three checks their CI gate — including the #551 promise ratchet, which blocked nowhere while its own comments claimed otherwise. [`npm run lint:ci-parity`](../../scripts/lint/ci-parity-check.js) now fails when any aggregate member has no CI home, with an explicit `LOCAL_ONLY` allowlist for the deliberate exceptions.
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

JellyRock layers nine verification + automation surfaces, each owning checks or sync work the others can't do well. The principle: **every check runs at the cheapest surface that can do it correctly.** No surface duplicates another's responsibility.

Surfaces 1–7 are a pure cost ladder — the same check pushed to the cheapest place it still works. Surfaces **8 and 9 are different in kind**: their cost floor is a *physical resource*, not compute. They need the one Roku, so no amount of optimization moves them earlier, and surface 9 can't run per-PR at all. Read the table as ending at 9, not at 7 — treating CI as the last line of defense is the mistake this row set exists to prevent.

| # | Surface | Trigger | What it owns | Latency |
|---|---|---|---|---|
| 1 | **IDE** (BrighterScript ext) | Live, per keystroke | `.bs` validation + bslint diagnostics, `bsfmt` on save | <100 ms |
| 2 | **`PostToolUse` hook** ([`bsfmt-on-write.sh`](../../.claude/hooks/bsfmt-on-write.sh)) | Agent's `Edit` / `Write` / `MultiEdit` | `bsfmt --write` on the file just edited | ~500 ms |
| 3 | **End-of-turn hook** ([`check-touched-related-files.sh`](../../.claude/hooks/check-touched-related-files.sh) + [`check-touched-lint.sh`](../../.claude/hooks/check-touched-lint.sh) + [`check-progress-cursor.sh`](../../.claude/hooks/check-progress-cursor.sh)) | Agent finishes turn (`Stop` / `sessionEnd`) | Architecture-doc reminder + lint on **uncommitted-only** files + stale-progress / cursor-shipped nudges | 2–5 s |
| 4 | **Pre-commit hook** ([`.lintstagedrc.cjs`](../../.lintstagedrc.cjs) via `lint-staged`) | `git commit` | File-scoped lint + auto-format on staged files | 1–5 s |
| 5 | **Pre-push hook** ([`.husky/pre-push`](../../.husky/pre-push)) | `git push` | Project-wide checks that aren't file-scoped + decision/cursor advisory nudges | 10–30 s |
| 6 | **Post-merge journal-sync** ([`journal-sync.yml`](../../.github/workflows/journal-sync.yml)) | PR merges to main | Mechanical close-loop on `progress.md` (running → shipped, last-updated bump) via [`scripts/journal-sync.js`](../../scripts/journal-sync.js) | seconds |
| 7 | **CI** (`.github/workflows/lint-*.yml`) | PR open / sync | Same as pre-push, can't bypass | minutes (parallel) |
| 8 | **Device unit tests** ([`device-unit-tests.yml`](../../.github/workflows/device-unit-tests.yml)) | PR open / sync; push to `main` | Rooibos unit + integration suites on the physical Roku — the only surface that runs BrightScript *inside* the app. Maintainer-approval gated (`environment: roku-device`) | ~8–15 min |
| 9 | **RTA functional tests** ([`rta-functional-tests.yml`](../../.github/workflows/rta-functional-tests.yml)) | push to `release-*.*.*`; manual dispatch | Screen-level navigation + rendered-content assertions, driving the device from *outside*. Release-only, not per-PR | ~10–15 min |

### Why each surface exists

- **IDE** — fastest possible feedback loop for human devs, but assumes a configured/working BrighterScript extension. Doesn't fire for agents.
- **`PostToolUse`** — the agent's "format on save." Auto-formats `.bs` / `.brs` immediately after the agent writes them so the next read shows canonical form. Silent on success — no context noise. Limited to `bsfmt` because anything project-wide (validate, bslint) would be too slow per-edit.
- **End-of-turn** — covers the gap when the agent has work that *isn't yet committed*. The lint variant scans only working-tree files (committed work is pre-commit's job — running it again here would be wasted cycles). The doc-maintenance variant reminds the agent about architecture-doc related-files territory it touched. The progress-cursor variant flags stale `docs/progress.md` and Currently-running cursors that overlap with shipped commits. All three informational, never block the turn.
- **Pre-commit** (`lint-staged`) — the universal gate for both humans and agents. File-scoped: `bsfmt --write`, `markdownlint --fix`, `spellchecker`, `jshint`. Auto-fix steps re-stage their output so the formatted version lands in the same commit (no "auto-fix commit" ceremony). The `lint-staged` runner handles the staged-files plumbing.
- **Pre-push** — what couldn't run per-commit: full BSC project compile (`bsc --noEmit`), `bslint` (needs full project context, can't be file-scoped), cross-doc reference check (`lint:docs`), drift check on the auto-generated dev-guides index, language-coverage. Plus project-wide regen tasks (`update-translations`, `docs:dev-index`) that mutate one output from many inputs. Also runs two advisory nudges (always exit 0): [`decision-shape-nudge.cjs`](../../scripts/lint/decision-shape-nudge.cjs) (pattern-matches commit messages for decision-shaped language and nudges toward `/log decision` when the range doesn't touch `docs/adr/` or `docs/decisions.md`) and [`progress-cursor-nudge.cjs`](../../scripts/lint/progress-cursor-nudge.cjs) (same checks as the end-of-turn hook, doubled here so the prompt fires before push regardless of whether the IDE / agent is running). Both are human-facing complements to the agent-facing Capture-discipline rule in `CLAUDE.md`.
- **Post-merge journal-sync** — fires on PR merge to main. Reads PR title / labels / author from the event payload, then runs [`scripts/journal-sync.js`](../../scripts/journal-sync.js) to perform the *mechanical* close-loop on [`docs/progress.md`](../progress.md): prepend "- YYYY-MM-DD — \<pr-title\>" to `## Recently shipped`, conditionally clear `## Currently running` (token-overlap heuristic), bump `last-updated:`. Skips on `dependencies` / `documentation` / `ci` / `automated` labels and Renovate / Dependabot / bot authors. Concurrency-grouped with the existing `jellyrock-bot-main` group so it queues against the changelog-sync workflow rather than racing it. This surface is what keeps the four-pillar journal flow from depending on the user remembering `/done running` after every merge.
- **CI** — can't be bypassed. Mirrors pre-push so the local hook isn't a load-bearing source of truth. Note it is *not* the final backstop: it is the last surface that runs on commodity runners, which is a different claim.
- **Device unit tests** — the only surface that executes BrightScript in the app on real hardware, so it owns everything no static check or Node-side test can reach (Roku OS behavior, registry I/O, Task threading). `check-skip` short-circuits it when nothing test-relevant changed, so docs and tooling PRs don't spin the device.
- **RTA functional tests** — drives the app from outside via ECP + ODC, so it owns the class Rooibos structurally cannot see: whether a *screen* renders the right thing. Deliberately release-only. There is one physical Roku, shared with surface 8 and with manual runs, and `vitest.rta.config.js` pins single-fork, so a pass is ~10–15 min of exclusive device time — too expensive per-PR. The accepted cost is that an RTA regression surfaces at release, after N merged PRs; the mitigation is running `npm run test:rta` locally when a change touches navigation or screens. See [rta-tests.md](../dev/rta-tests.md#when-ci-runs-it).

### Surface ownership of each lint command

| Command | Pre-commit (file-scoped) | Pre-push (project-wide) | Why |
|---|---|---|---|
| `bsfmt --write` | ✓ | — | File-scoped; auto-fix re-stages |
| `bslint` (`lint:bs`) | — | ✓ | Needs full project context (cross-file scope resolution) |
| `bsc --noEmit` (`validate`) | — | ✓ | Project-wide compile, ~10–30 s |
| `markdownlint-cli2 --fix` (`lint:markdown`) | ✓ | ✓ | Pre-commit auto-fixes + re-stages; pre-push re-runs the read-only check (gated on `.md` changes) because rebase / cherry-pick / merge commits skip the pre-commit hook entirely |
| `spellchecker` (`lint:spelling`) | ✓ | ✓ | Pre-commit checks (no auto-fix — correctness); pre-push re-runs it (gated on `.md` changes) as the same backstop for commits that bypass pre-commit |
| `jshint` (`lint:json`) | ✓ | — | File-scoped; no auto-fix |
| `docs-check.cjs` (`lint:docs`) | — | ✓ | Cross-doc reference check; needs all docs loaded |
| `generate-dev-index.cjs --check` | — | ✓ | Drift check on auto-generated table |
| `update-translations` (regen) | — | ✓ | Project-wide regen from `en_US.json` |
| `lint:language-coverage` | — | ✓ | Conditional on specific files; unusual pattern |
| `lint:issue-templates` | — | ✓ | Conditional on `.github/ISSUE_TEMPLATE/` changes; validates against vendored GitHub schema (invalid forms otherwise hide silently) |

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

### Dependency update orchestration (`_validate-dependencies.yml` + `_smoke-test-deps.yml`)

[`_validate-dependencies.yml`](../../.github/workflows/_validate-dependencies.yml) is the dependency-update orchestrator: it re-runs every lint and test reusable with `force: true` on any PR labeled `dependencies`. Renovate and Dependabot auto-apply that label, so their PRs automatically trigger full CI. This is what makes [`renovate.json`](../../renovate.json)'s `automerge: true` for patch updates safe — a Renovate patch PR can only auto-merge once every downstream job passes.

**When you add a new `_lint-*.yml`, `_test-*.yml`, or `_smoke-test-*.yml` reusable, add a matching `force: true` job to `_validate-dependencies.yml` immediately.** Skipping this means dependency bumps that break your new workflow silently pass CI. `npm run lint:ci-workflow-sync` ([`scripts/lint/validate-deps-workflow-sync.cjs`](../../scripts/lint/validate-deps-workflow-sync.cjs)) enforces this mechanically — it runs in `_lint-docs.yml` and in the pre-push hook and exits non-zero when any `_lint-*` / `_test-*` / `_smoke-test-*` reusable is not listed in `_validate-dependencies.yml`.

**And add the new workflow's status-check context to the required checks on `main`.** A reusable called from a wrapper reports its status as `"<wrapper job> / <reusable job>"` — e.g. `lint-docs.yml`'s `docs:` job calling `_lint-docs.yml`'s `docs:` job reports `docs / docs`. A context that is not in branch protection's required list still *runs* and still reports red, but **does not block a merge**. That is the same silent-no-gate outcome as having no CI home at all, one layer further out, and neither `lint:ci-workflow-sync` nor `lint:ci-parity` can catch it: branch protection is repo configuration, not a file in the tree, and reading it needs admin scope that CI's `github.token` does not carry. Check the current list with:

```bash
gh api repos/jellyrock/jellyrock/branches/main/protection --jq '.required_status_checks.contexts[]'
```

[`_smoke-test-deps.yml`](../../.github/workflows/_smoke-test-deps.yml) is a smoke-test companion (not a lint workflow). It covers the two dev dependencies nothing else in CI exercises: `roku-deploy` (never invoked in CI — only by manual deploy scripts) and `lint-staged` (only invoked by the husky pre-commit hook locally). Smoke tests are cheap CLI invocations (`--version`, `--print-config`) that catch catastrophic breakage (package missing, CLI broken) without full integration tests. Husky itself is already covered for free: `"prepare": "husky"` in `package.json` runs the husky CLI on every `npm ci`.

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
