---
topic: build-and-tooling
related-files:
  - bsconfig-base.json
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
  - scripts/bsc-plugins/auto-abandon-promises.cjs
  - scripts/bsc-plugins/jrscreen-on-destroy.cjs
  - scripts/bsc-plugins/print-locations.cjs
  - scripts/bsc-plugins/observe-without-on-destroy.cjs
  - scripts/bsc-plugins/no-direct-sdk.cjs
  - scripts/bsc-plugins/no-raw-run.cjs
  - scripts/bsc-plugins/no-task-fanout.cjs
  - scripts/bsc-plugins/no-same-node-relaunch.cjs
  - scripts/bsc-plugins/no-hand-rolled-dialog.cjs
  - scripts/bsc-plugins/callfunc-interface.cjs
  - scripts/bsc-plugins/button-row-bracket.cjs
  - scripts/bsc-plugins/field-observer-wiring.cjs
  - scripts/bsc-plugins/register-once-observer.cjs
  - scripts/lib/bsc-rule.cjs
  - scripts/bsc-plugins/auto-destroyed-guard.cjs
  - scripts/bsc-plugins/unobserve-before-release.cjs
  - scripts/bsc-plugins/dead-code.cjs
  - .dead-code-baseline.json
  - scripts/dead-code-accuracy.js
  - scripts/lint/dictionary-audit.cjs
  - scripts/lint/docs-check.cjs
  - scripts/lint/docs-stale.cjs
  - scripts/lint/docs-stale-blocking.cjs
  - scripts/lint/check-touched-related-files.cjs
  - dictionary.txt
  - .spellcheckerrc.yaml
  - dictionary-sentence-final.txt
  - scripts/generate/sentence-final-dictionary.js
  - .github/workflows/_lint-spelling.yml
  - scripts/lint/check-touched-lint.cjs
  - scripts/lint/decision-shape-nudge.cjs
  - scripts/lint/progress-cursor-nudge.cjs
  - scripts/lint/issue-templates-check.cjs
  - scripts/lint/validate-deps-workflow-sync.cjs
  - scripts/lint/ci-parity-check.js
  - scripts/lint/rta-capability-coverage.cjs
  - scripts/lint/rta-wait-inventory.js
  - scripts/lint/eslint-rules/rta-wait-justified.js
  - scripts/journal-sync.js
  - scripts/lint/issue-forms.schema.json
  - scripts/generate/dev-index.cjs
  - scripts/generate/feature-catalog.cjs
  - scripts/lib/feature-facts.cjs
  - scripts/generate/icons-build.js
  - scripts/generate/gradient-assets.js
  - scripts/generate/icons-add.js
  - scripts/generate/roku-hardware.js
  - scripts/data/roku-hardware.json
  - scripts/roku-devices.js
  - .github/workflows/roku-hardware-sync.yml
  - resources/icons/
  - resources/placeholders/
  - resources/placeholders/placeholders.json
  - scripts/lib/png-compare.js
  - scripts/lib/frontmatter.cjs
  - scripts/lib/changed-files.cjs
  - scripts/lib/lint-excludes.cjs
  - .lintstagedrc.cjs
  - .husky/pre-commit
  - .husky/pre-push
  - .claude/settings.json
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
  - scripts/device-lock.js
  - eslint.config.js
  - .prettierrc.json
  - .prettierignore
  - vitest.config.js
last-reviewed: 2026-10-18
---

# Build and tooling

How JellyRock is compiled, checked and packaged: the BrighterScript configs and compile-time flags, our compiler plugins, the npm scripts and Makefile, the generated image assets, and the layers of checks from the editor to the Roku.

## The BrighterScript pipeline

JellyRock is written in BrighterScript (`.bs`), a typed superset of BrightScript that compiles to plain `.brs` for the Roku. The compiler is `bsc`, from the `brighterscript` npm package. It writes to `build/`; packaged ZIPs go to `out/`.

```text
.bs source files  ─┐
.xml components   ─┤  bsc (with plugins)  ─▶  .brs/.xml in build/  ─▶  ZIP in out/  ─▶  Roku
images, locales   ─┘
```

## bsconfig variants

Each build target has its own `bsconfig*.json`, and every one inherits from `bsconfig-base.json`:

| File | Purpose |
|---|---|
| `bsconfig-base.json` | Not a build target. The settings every config shares: `compilerOptions` (`autoImportComponentScript`, `sourceMap: true`), every `diagnosticFilters` entry, and `outDir` |
| `bsconfig.json` | Dev build, and the project `npm run validate`, the editor and CI check. Every plugin, logs kept, source maps on |
| `bsconfig-prod.json` | Production build. Logs and comments stripped, no file paths in log lines, no source maps, release branding copied to `images/branding`. Runs fewer plugins than the dev build (below) |
| `bsconfig-analysis.json` | `bsconfig-prod.json` plus source maps, built to `build-analysis/` (`npm run build:analysis`). `/crash-report` derives the same config from each tag's own prod config |
| `bsconfig-tests.json` | Every suite except the `migration`, `registry` and `measurement` tags, without code coverage. The gating build (`test:all`, CI) |
| `bsconfig-tests-unit.json` | Unit tests only, except the `measurement` tag |
| `bsconfig-tests-integration.json` | Integration tests only, except the `migration` and `registry` tags |
| `bsconfig-tests-complete.json` | Every tag, with code coverage recorded (`test:complete`, the CI `complete` dispatch) |
| `bsconfig-tdd-sample.json` | Extends `bsconfig-tests.json`. Copy it to the gitignored `bsconfig-tdd.json` and pick the suites to run |

`bsconfig.json` is the place to read the plugin list. The prod config leaves out `brighterscript-xml-plugin`, `callfunc-interface`, `button-row-bracket`, `field-observer-wiring`, `register-once-observer` and `dead-code`. No reason is recorded; those rules still gate every PR through `validate`, which builds `bsconfig.json`.

### How the configs compose

Each config names its parent with `extends`. `bsconfig-analysis.json` extends the prod config, `bsconfig-tdd-sample.json` extends `bsconfig-tests.json`, and the rest extend the base.

BrighterScript merges `extends` shallowly. Only `compilerOptions` merges key by key, so the prod config can set `compilerOptions.sourceMap: false` and keep the other options. Any other key a child sets replaces the parent's value. A child `diagnosticFilters` array would drop every filter in the base, so all filters live in the base, test-only ones included.

[`bsconfig-inheritance.test.js`](../../tests/scripts/unit/lint/bsconfig-inheritance.test.js) enforces the shape:

- every config reaches the base;
- no child redefines `diagnosticFilters`;
- no config uses a deprecated top-level compiler option;
- every file a device-test config inherits from triggers the device unit tests;
- every `files` array ends with `"!**/*.map"`.

**Every `files` array ends with `"!**/*.map"`.** A ropm package can ship prebuilt `.map` files next to its `.brs`. Copied by `files`, one lands on the same path as the map BSC writes for that `.brs`, and the two writes race. BSC already reads a prebuilt map from disk to chain it, so nothing needs copying. The negation must stay the last entry, because a later glob would copy the maps back in. The TDD sample restates the line, since `files` is never inherited. The full story is in commit `cfd5a32b`; adopting roku-log as owned code would remove the prebuilt maps ([#986](https://github.com/jellyrock/jellyrock/issues/986)).

Compiler options go under `compilerOptions`. The top-level spelling still works but warns. When both are set, `compilerOptions` wins, so a top-level override in a child is ignored once the base sets that option.

The base filters `function-name-too-long` for `tests/**/*.spec.bs` only. Rooibos renames every test method to `rooiboos_test_case_<md5>_<n>` inside the suite class, which pushes a long suite class name past Roku's 89-character limit. The limit matters only when a function reference goes through `toStr()`, and Rooibos calls test methods by name (`m.testSuite[m.funcName]()`). App code, test helpers and mocks keep the rule.

The BrighterScript language server reloads a project only when that project's own bsconfig changes. After editing `bsconfig-base.json`, run **BrightScript: Restart Language Server** or reload the window.

## Compile-time flags (`bs_const`)

The `manifest`'s `bs_const` line carries three compile-time constants. Roku's on-device compiler evaluates `#if`, not `bsc`: the directives pass through into the emitted `.brs` and are compiled out at load time against the shipped manifest. Two consequences:

- Grepping `build/**/*.brs` to see whether a flag is off proves nothing, because the `#if` block is always there. Read `build/manifest` instead.
- A `manifest.bs_const` override in a bsconfig enforces nothing. BrighterScript applies it to its own in-memory manifest; the `manifest` file is copied to `build/` as it is.

| Constant | Default | What it gates |
|---|---|---|
| `debug` | `false` | Failure injection (`DebugFlags`), the toast cheat code, the Task-thread ledger, `rawApiData` and the other `raw*` payloads, and log level 4 instead of 2. See [debug-flags.md](../dev/debug-flags.md) |
| `perfTiming` | `true` | Timing instrumentation: the Home, grid and extras load pipelines, the API queue, the Task launch queue and screen readiness. `git grep -l '#if perfTiming'` lists the files. See [home-first-paint-performance.md](../dev/home-first-paint-performance.md) |
| `ENABLE_RTA` | `false` | The RTA on-device component and the test hooks RTA drives in app code (request faults, load-stage holds, grid page size). The RTA deploy sets it to `true` in the build directory. See [rta-tests.md](../dev/rta-tests.md#test-hooks-in-rta-builds) |

`perfTiming` defaults on so dev builds print their timings without a rebuild; instrumentation behind a flag flip stops being read. It is separate from `debug` because a `debug` build attaches `rawApiData` to every transformed item, inside the timed work. Sharing the flag would mean the only build that prints the numbers is one that distorts them.

### Production hardening

[`scripts/harden-prod-manifest.js`](../../scripts/harden-prod-manifest.js) is the last step of `npm run build:prod`, and every route to a release artifact runs `build:prod`. It rewrites `build/manifest` with `debug`, `perfTiming` and `ENABLE_RTA` forced to `false` and prints what it changed. It fails when the manifest or its `bs_const` line is missing.

It exists for two reasons:

- The roku-log plugin's `strip` removes log calls but not the code feeding them, so the timing clocks would run in production with their results thrown away.
- A `debug=true` left in the working tree cannot reach a release. That flip is routine, because raising the log level means flipping `debug`, and it has reached `main` before (the script names the commits).

The script denies by default. After forcing the known flags off, any const still `true` fails the build by name. A const that must ship enabled opts in through `ALLOWED_TRUE`. A manifest that drops a const never reaches the script: `bsc` raises `hash-const-does-not-exist`, an error, for every `#if` naming it.

```bash
npm run build:prod && grep bs_const build/manifest
# bs_const=debug=false;ENABLE_RTA=false;perfTiming=false
```

## Custom BSC plugins

Our plugins live in `scripts/bsc-plugins/`. Each file opens with a comment that explains its rule in full: what it flags, why, the cases it skips and its known gaps. This section is the map; the file is the reference.

### Transform plugins

These change the emitted code.

| Plugin | What it does |
|---|---|
| `roku-log.cjs` | Ours, replacing the unmaintained `roku-log-bsc-plugin`; the roku-log runtime library is stock upstream ([logging.md](logging.md#roku-log-is-two-artifacts-and-only-one-of-them-is-ours)). `strip` removes every `m.log.*()` call (prod), `insertPkgPath` prepends the source path to log lines (dev), `removeComments` strips comments (on by default, off in dev). `guard` wraps calls in a check, but no config turns it on ([logging.md](logging.md#the-guard-transform-only-knows-mlog)) |
| `translation-keys.cjs` | Generates a virtual `pkg:/source/translationKeys.bs` with one constant per key in `locale/custom/en_US.json`. It watches that file, so the editor sees new keys without a rebuild. See [translations.md](translations.md) |
| `auto-abandon-promises.cjs` | Puts `abandonApiPromises()` first in the `onDestroy()` of every component that calls `fetchAsync`, so a late response never calls into a destroyed node. A component that calls `fetchAsync` with no `onDestroy()` is a build error. See [promises.md](../dev/promises.md) |
| `auto-destroyed-guard.cjs` | Adds a teardown guard to `onKeyEvent` (next section) |

Because `strip` removes the whole call, `m.log.debug("value", x, y)` is free to leave in code: production never runs it.

### `scripts/bsc-plugins/auto-destroyed-guard.cjs`

Injects a guard so a key event delivered after a component's `onDestroy` cannot dot into the references `onDestroy` has set to `invalid`.

The window is structural. The router runs the view's close hook, which reaches `JRScreen.beforeViewClose()` and then `onDestroy()`, and removes the node only when the returned promise resolves. That lands on a later message-loop turn, and the view stays visible and focused in between. The next key press there throws `&hec`.

SceneGraph `onDestroy` and `onKeyEvent` do not chain to a base component, so no base-class fix exists. The plugin injects into every codebehind that declares both hooks:

| Site | Injected |
|---|---|
| `init()` | `m.isDestroyed = false` |
| `onDestroy()` | `m.isDestroyed = true` |
| `onKeyEvent()` | `if m.isDestroyed = true then return false` |

A site is skipped when its function already opens with that statement. A hand-written flag anywhere else still gets the injection. `VideoPlayerView` opens `init()` and `onDestroy()` with the flag on purpose, so it receives only the `onKeyEvent` guard.

The test is `= true` because Roku treats `invalid` as neither true nor false: `if m.isDestroyed then` throws on an unset flag. A component with `onDestroy` and `onKeyEvent` but no `init()` has nowhere to set the flag, which is the plugin's one error. Returning `false` hands the key to whatever the router focuses next. The decision is [ADR 0032](../adr/0032-teardown-key-guard-injected.md).

### Convention plugins

These turn conventions from `components/CLAUDE.md` and `source/CLAUDE.md` into editor diagnostics and CI failures. None may crash the build. An error blocks it; a warning shows in the editor and CI output.

| Plugin | Severity | Flags | Rule explained in |
|---|---|---|---|
| `jrscreen-on-destroy` | warning | A component that extends `JRScreen`, at any depth, whose codebehind declares no top-level `onDestroy` (case-sensitive) | The plugin file |
| `print-locations` | warning | A raw `print` outside `source/main.bs` and the `#if debug` blocks in `source/utils/globals.bs`. Non-class functions under `source/` are skipped, since they have no `m.log` | [logging.md](logging.md#where-print-is-allowed) |
| `observe-without-on-destroy` | warning | In a `JRScreen` codebehind, an `observeField` with no matching `unobserveField` in the file. Matching follows aliases; `releaseTask(x, "field")` counts as an unobserve | The plugin file |
| `unobserve-before-release` | warning | An `unobserveField` in `onDestroy` that runs after a release (`m.x = invalid`) of a reference the observer's handler dereferences. The fix is to move the unobserve first, not to add a guard | [ADR 0032](../adr/0032-teardown-key-guard-injected.md), the plugin file |
| `no-direct-sdk` | warning | A `sdk.<ns>.<fn>()` call outside `source/api/ApiClient.bs` and `source/api/sdk.bs` | [api.md](api.md) |
| `no-raw-run` | error | A Task started without `launchTask()`: `control` written with `"RUN"`, or with a value that cannot be resolved, outside `source/utils/tasks.bs` | [ADR 0031](../adr/0031-task-thread-ceiling.md) |
| `no-task-fanout` | error | A `launchTask()` inside a loop body, directly or one same-file helper call away, unless its argument is a stable `m.` path the loop does not rebind | [ADR 0031](../adr/0031-task-thread-ceiling.md), decisions [`task-fanout-keys-on-argument`](../decisions.md#decision-id-task-fanout-keys-on-argument) and [`task-fanout-follows-helpers`](../decisions.md#decision-id-task-fanout-follows-helpers) |
| `no-same-node-relaunch` | error | Relaunching a Task node the same function stopped; launching `m.x` with no new node assigned first; a `replaceTask()` handler that does not open with `isCurrentTaskEvent()` | [ADR 0037](../adr/0037-task-run-replacement.md), decisions [`same-node-relaunch-gate`](../decisions.md#decision-id-same-node-relaunch-gate) and [`relaunch-gate-no-stop-shapes`](../decisions.md#decision-id-relaunch-gate-no-stop-shapes) |
| `no-hand-rolled-dialog` | error | A dialog built outside the `JRDialog` family: a full-screen translucent `Rectangle`, or an `appendChild` or `insertChild` onto the scene | [dialogs.md](dialogs.md), decision [`one-overlay-dialog-supersedes`](../decisions.md#decision-id-one-overlay-dialog-supersedes) |
| `callfunc-interface` | error | A `callFunc("x")` where `x` is defined in one of our codebehinds but declared in no component `<interface>`, a call that does nothing. `m.top.callFunc` is checked against its own component | The plugin file |
| `button-row-bracket` | error | A function that mutates an overflow-managed button row without calling both `unsplitButtons()` and `applyOverflow()` | Tech debt [`button-row-model`](tech-debt.md#button-row-model), which deletes it |
| `field-observer-wiring` | error | Five ways an interface field's wiring goes wrong: wired by both XML `onChange` and `m.top.observeField()`; an unobserve that detaches nothing; an `onChange` in a component that has `onDestroy`; an `m.top` unobserve outside `onDestroy()`; an `m.top` observe outside `init()` | [ADR 0034](../adr/0034-component-observers-init-to-ondestroy.md) |
| `register-once-observer` | error | A member observed once, in `init()`, then unobserved anywhere but `onDestroy()`. Nothing re-registers it, so its handler never runs again | [ADR 0034](../adr/0034-component-observers-init-to-ondestroy.md), decision [`register-once-observer-gate`](../decisions.md#decision-id-register-once-observer-gate) |
| `dead-code` | error | A declaration nothing in the app consumes | [Dead code](#dead-code), [ADR 0047](../adr/0047-dead-code-gate.md) |

The three Task rules work together. `no-raw-run` bounds where a thread may start, `no-task-fanout` bounds how many start at once, and `no-same-node-relaunch` catches a launch the platform can ignore ([threading.md](threading.md#measured-findings)). Epic #728 needed the first two: its crash came from concurrent launches in one screen load, through an ordinary launch site.

`no-same-node-relaunch` lists the app sites that predate it, or predate a change that lets it see a new shape, in its own `PENDING_MIGRATIONS`, not as inline markers, so there is no marker to copy onto a new site. The list can only shrink, and it has been empty since 2026-10-13. Every state an entry can be in raises an error except the one where it matches its site, whether the fault is in the code or in the list.

#### Cross-file rules clear before they re-derive

BSC clears a file's diagnostics when that file re-validates. A finding that depends on two files is not cleared by an edit to the file it is not anchored on, so it outlives the fix. An XML `onChange` with its codebehind, or a `callFunc` with the target's `<interface>`, are the usual pairs.

Write a new convention plugin through one of the two factories in [`scripts/lib/bsc-rule.cjs`](../../scripts/lib/bsc-rule.cjs). It is BSC's own pattern: clear by tag, then re-register.

- `createScopeRule` reasons over one component, its XML and its codebehind. This is the common case.
- `createProgramRule` needs the whole program before it can judge one site.

Both handle the clear, the suppression markers and the never-crash guard, so the rule body holds only the rule. The module also exports shared AST helpers (`functionsIn`, `isLaunchTaskCall`, `bareCallName`).

A rule whose every finding comes from and lands in one file can hook `afterValidateFile` directly, since BSC already clears it. `no-raw-run`, `no-task-fanout`, `no-same-node-relaunch` and `no-hand-rolled-dialog` do. They also need to, because the factories honor `bsc-disable-file`, which an error-level Task or dialog gate must not. Once a rule reads a second file, it needs a factory, or the cross-file part must run in `afterValidateProgram` under a tag it clears first. A file hook must never anchor a diagnostic in another file, because BSC never clears it.

The bug shows only across validations, so its tests use `runPluginOnEdits`; `runPluginOnSource` validates once ([scripts-development.md](../dev/scripts-development.md#the-three-harnesses)).

#### Suppressing a false positive

A marker names a diagnostic code. It matches case-insensitively and needs a `'` comment opener:

```brightscript
' bsc-disable-line <code>           ← on the same line
' bsc-disable-next-line <code>      ← on the line above
' bsc-disable-file <code>           ← anywhere in the file
```

Use the narrowest one. A whole-file marker should name a tech-debt slug in a trailing comment.

Not every plugin honors every marker, and an unsupported one fails silently: the comment looks like a suppression while the diagnostic keeps firing.

| Code | line | next-line | file | Notes |
|---|---|---|---|---|
| `print-locations` | ✅ | ✅ | ✅ | |
| `observe-without-on-destroy` | ✅ | ✅ | ✅ | |
| `unobserve-before-release` | ✅ | ✅ | ✅ | Put it on the `unobserveField` line, where the diagnostic lands |
| `callfunc-interface` | ✅ | ✅ | ✅ | Should be rare: an undeclared target is normally a real bug |
| `register-once-observer` | ✅ | ✅ | ✅ | `ResumeButton` carries the live suppression |
| `duplicate-field-observer`, `ineffective-unobserve`, `undetachable-observer`, `top-unobserve-outside-ondestroy`, `top-observer-outside-init` | ✅ | ✅ | ✅ | `field-observer-wiring` reports under these five codes, so a marker naming the plugin does nothing |
| `no-direct-sdk` | ✅ | ✅ | ❌ | |
| `no-raw-run` | ✅ | ✅ | ❌ | A whole-file opt-out would lift the thread bound from a whole file. Suppress the line and say why |
| `no-task-fanout` | ✅ | ✅ | ❌ | Same reason as `no-raw-run` |
| `no-same-node-relaunch` | ✅ | ✅ | ❌ | Same reason. Only for an intended relaunch; a site awaiting migration goes in `PENDING_MIGRATIONS` |
| `no-hand-rolled-dialog` | ✅ | ✅ | ❌ | Same reason. Also matches inside a multi-line XML comment (`ItemGridOptions` is the live case) |
| `jrscreen-on-destroy` | ❌ | ❌ | ✅ | The diagnostic lands on the XML component declaration |
| `auto-abandon-promises` | ❌ | ❌ | ✅ | |
| `button-row-bracket` | ❌ | ❌ | ✅ | The rule is about a whole function, so a line has nowhere to sit |
| `auto-destroyed-guard` | ❌ | ❌ | ✅ | Suppresses the injection as well as the diagnostic |
| `dead-code` | ✅ | ✅ | ❌ | Each marker must read `keep: <kind>: <reason>`; see [Dead code](#dead-code) |

### Dead code

`scripts/bsc-plugins/dead-code.cjs` fails the build on a declaration nothing in the app consumes (epic #1072, [ADR 0047](../adr/0047-dead-code-gate.md)). It runs on `bsconfig.json`, not the test builds, so code only a test uses is dead: a test of code the app never runs protects nothing.

**What counts as a consumer.** SceneGraph reaches code by name more often than by call. So a reference can be any of these:

- an identifier: a call, a value, a member access, an AA key or a qualified chain;
- a string literal naming it (`observeField`, `functionName`, `CreateObject`, a route);
- a `callFunc("x")` or `node@.x()` call;
- an XML tag, attribute name or attribute value;
- a string value in packaged JSON (`settings.json`'s `settingName`);
- a concatenated string prefix: `"segmentAction" + type` reaches every `segmentAction*` field.

Resolution follows scope:

- A namespace member matches only by its qualified name, or by a relative reference inside its namespace. A same-named member of another namespace does not keep it alive.
- A codebehind function matches by name only inside the component scopes that include its file, so two components can each define `onHeightChanged`.
- A `callFunc` reaches a function only through an `<interface>` `<function>` declared by a component that includes its file, because that is how SceneGraph dispatches it. A function called this way with no declaration is reported with the call named, since that is a wiring bug rather than dead code.
- An interface function is reached only by a call, never by a string that spells its name.
- `m.top.x` counts only for the file's own component's field.
- A component is named by an exact value (a tag, `extends=`, `*ComponentName=`, a whole string), never a word inside a longer string. A `findNode()` argument is a node id, not a component.
- Code reachable only from dead code is dead, and the message names what reached it. That covers a dead field's XML element and its `onChange` handler, and a script whose including components are all dead.

**Never reported:** Roku entry points and lifecycle callbacks; fields the firmware writes into item and row components; `keySelected` on a `DynamicCustomKeyboard` subclass; an alias field with a `value`; calls another plugin injects at transpile time; `roku_modules`, `components/vendor` and the generated `translationKeys` namespace.

**Tests.** A test's `callFunc` keeps an interface function's declaration alive, because the test needs that exposure to drive a live component. That covers Rooibos `callFunc("x")` and `@.x`, and an RTA quoted `funcName: 'x'` (`deadCode.exposureConsumers`). It works only while the app still runs the function behind it, and keeps nothing else alive.

**Keeping code on purpose.** Unused code stays only as one of six recorded kinds:

| Kind | For |
|---|---|
| `design-system` | A deliberate set |
| `api` | Built ahead of its first caller |
| `planned` | Waiting on an issue, which it must cite |
| `platform` | Called by Roku OS by a name the rule does not know |
| `test-infra` | Probe components the suites create by name |
| `debug-console` | Called from the BrightScript console in a debug build |

```brightscript
' bsc-disable-next-line dead-code keep: api: the early-exit half of the pipeline lifecycle
```

A whole set goes in `bsconfig.json`'s `deadCode.keep` with its files, optional name patterns and reason. These are each a `dead-code-keep` error, because a keep that outlived its reason is a silent carve-out:

- a marker without a kind and reason;
- a `planned` keep without an issue;
- a file-level marker;
- a marker on code that is used;
- an allowlist entry that matches nothing.

Code you intend to fix is not a keep: it waits in the baseline.

**Baseline.** `.dead-code-baseline.json` lists findings awaiting removal, keyed by kind, file and qualified name. Listed findings are not reported, and an entry that stops matching is (`dead-code-baseline`), so the file never holds a stale entry. An addition is a review decision visible in the diff. `DEAD_CODE_WRITE_BASELINE=1 npx bsc --noEmit` rewrites the baseline; use it only to record a deliberate deferral, never to silence a new finding.

**Known limits.** Two make it report less:

- A member access on anything other than `m.top` is matched by name, because the rule does not know the node's type. A field or method whose name another component or a Roku built-in node also uses stays alive.
- Reads and writes are not told apart, so a field that is only ever written counts as used. `npm run dead-code:write-only` lists those for review. Each needs judgment: a `getFields()` loop, or code that serializes a node, reads fields by no name.

One makes it report more. A name built at runtime from a variable (`setField(name, …)`, `m[name]`, `callFunc(name)`) is invisible, so a declaration reached only that way is reported. Keep it with a marker whose reason names the site.

**Component names match case-insensitively.** Roku documents them as case-sensitive, yet `ItemDetails.xml` declares `<extrasSlider>` and the firmware builds an `ExtrasSlider`. Checked 2026-09-29 on a Roku Ultra (Roku OS 15.3.4) and pinned by [`ItemDetailsExtrasSlider.spec.bs`](../../tests/source/unit/components/ItemDetailsExtrasSlider.spec.bs).

**Accuracy.** [`scripts/dead-code-accuracy.js`](../../scripts/dead-code-accuracy.js) measures it. Each command first checks that its in-memory loader sees what the real `bsc` build sees. Rerun both after changing the plugin. ADR 0047 records the first replay, and #1073's commit (`0deef5b2`) the first mutation run.

- `npm run dead-code:replay` rebuilds the parent of every commit whose message mentions dead or unused code, and checks the rule flagged what each commit deleted.
- `npm run dead-code:mutate` erases every reference to a sample of live declarations and requires each to be flagged, which proves the plugin's account of why something is live is complete.

### Other plugins

- `@rokucommunity/bslint`: lint rules, configured in `bslint.json`.
- `brighterscript-xml-plugin`: XML parsing and checks for component files.
- `rooibos-roku`: the test framework, a plugin in every test config.

## npm scripts

`package.json` is the full list. These are the entry points, grouped, with the doc that covers each area.

| Group | Scripts | More in |
|---|---|---|
| Build | `build` (dev), `build:prod` (then [manifest hardening](#production-hardening)), `build:analysis`, `build:tests`, `build:tests-unit`, `build:tests-integration`, `build:tests-complete`, `build:tdd`, `validate` (`bsc --noEmit`) | [bsconfig variants](#bsconfig-variants) |
| Package | `package` (sideload ZIP), `package:signed` (signed `.pkg`) | [Roku signing pipeline](#roku-signing-pipeline) |
| Device tests | `test:unit`, `test:integration`, `test:all`, `test:complete`, `test:tdd`, `device:check` | [unit-tests-tdd.md](../dev/unit-tests-tdd.md) |
| RTA | `test:rta`, `test:rta:tdd`, `test:rta:fast`, `test:rta:capture`, `demo`, `rta:restore`, `screenshots:*`, `device:status`, `device:release` | [rta-tests.md](../dev/rta-tests.md) |
| Measurement | `measure`, `measure:*`, `flake-baseline` | [measuring-performance.md](../dev/measuring-performance.md) |
| Script tests | `test:scripts`, `test:scripts:tdd` (watch) | [scripts-development.md](../dev/scripts-development.md) |
| Format | `format`, `check-formatting`, each with `:bs` (`bsfmt`) and `:js` (Prettier) | [Surfaces for JS and JSON](#surfaces-for-js-and-json) |
| Translations | `update-translations`, `translations:seed`, `translations:merge` | [translations.md](translations.md) |
| Server upgrades | `docs:api-manifest`, `docs:spec-fingerprints`, `api-watch:*`, `jellyfin:matrix`, each with `:check` where one exists | [server-upgrade-automation.md](server-upgrade-automation.md) |
| Generated assets | `icons:build`, `icons:add`, `gradients:build`, `roku-hardware:fetch`, each with `:check` | [Icon resolution pipeline](#icon-resolution-pipeline) |
| Docs | `docs:settings`, `docs:dev-index`, `docs:features`, `docs:stale`, `docs:stale:blocking`, `docs:fact-report`, `dictionary:sentence-final` | [Doc-maintenance enforcement](#doc-maintenance-enforcement) |
| Agent state | `catchup:state` (the JSON `/catchup` and `/ramp` read) | [`scripts/catchup-state.js`](../../scripts/catchup-state.js) |
| Dead code | `dead-code:replay`, `dead-code:mutate`, `dead-code:write-only` | [Dead code](#dead-code) |
| Changelog | `changelog:*`, run by CI only | [changelog.md](../admin/changelog.md) |
| Install | `postinstall` (`ropm`, then `patches:apply`), `prepare` (husky) | [ropm modules](#ropm-modules) |

### The `lint` aggregate

`npm run lint` runs a fixed chain of checks, listed in its own `package.json` entry. [`lint:ci-parity`](../../scripts/lint/ci-parity-check.js) proves each member has a CI home. Checks with no other home in the docs:

| Script | Checks |
|---|---|
| `lint:docs` | `related-files:` paths, relative links and `tech-debt.md#` anchors across the docs, every `CLAUDE.md` outside dot-directories, and the BSC plugins. Plus the schema of `progress.md`'s frontmatter, the `decisions.md` supersede chain, the Roku store descriptions in `docs/admin/store-listing.md` (each within its length limit, each count it cites matching the app), and the frontmatter of each feature page in `docs/user/features/` ([Document a feature](../dev/feature-pages.md)). Run it through `/docs-lint` |
| `lint:voice` | The house voice and line-number citations in every tracked `.md`, as a per-file ratchet ([writing-style.md](../dev/writing-style.md#what-the-gate-checks)) |
| `lint:comment-voice` | The house voice in the comments of tracked code, as a per-file ratchet ([writing-style.md](../dev/writing-style.md#what-the-gate-checks)) |
| `lint:skill-placeholders` | Argument placeholders in `.claude/skills/*/SKILL.md` (`$ARGUMENTS`, `$0` to `$9`, an `arguments:` list), which Claude Code replaces at run time ([the script's header](../../scripts/lint/skill-placeholders-check.js)) |
| `lint:dictionary` | Identifier-shaped entries in `dictionary.txt`; code names belong in backticks ([code-style.md](../dev/code-style.md#when-to-add-to-dictionarytxt-instead)) |
| `lint:issue-templates` | `.github/ISSUE_TEMPLATE/*.yml` against GitHub's issue-forms schema. GitHub drops an invalid form from the new-issue page without an error |
| `lint:json` | jshint over JSON, which catches duplicate keys. Prettier handles the whitespace |
| `lint:rta-capabilities`, `lint:rta-waits` | The ODC capability inventory and the wait categories in [`tests/rta/CLAUDE.md`](../../tests/rta/CLAUDE.md) against the installed client and the suite |
| `lint:ci-workflow-sync` | Every `_lint-*`, `_test-*` and `_smoke-test-*` workflow has a job in `_validate-dependencies.yml` |
| `lint:ci-parity` | Every `lint` member is run by some workflow. Deliberate exceptions sit in `LOCAL_ONLY` with a reason. It does not prove the workflow's path filter matches what the check reads ([tech-debt](tech-debt.md#ci-path-filters-unverified)) |
| `lint:promise-ratchet` | The count of raw `observeField("isDone", …)` pool consumers in app code can only fall; new code uses `fetchAsync` ([promises.md](../dev/promises.md)) |

The socket checks are in [remote-control.md](remote-control.md), the API floor checks in [server-upgrade-automation.md](server-upgrade-automation.md), `lint:log-manager-init` in [logging.md](logging.md), and the translation checks in [translations.md](translations.md).

## Icon resolution pipeline

The `manifest` declares `ui_resolutions=fhd`: the app is laid out in 1920×1080 coordinates and the OS scales the frame to the device. It also declares:

```text
uri_resolution_autosub=$$RES$$,sd,hd,fhd
```

At image-load time the OS replaces `$$RES$$` in an image URI with the string for the device's UI resolution. `pkg:/images/icons/play_$$RES$$.png` loads `play_fhd.png` on a 1080p UI and `play_hd.png` on a 720p UI.

The substitution follows the device's UI resolution, not `ui_resolutions`. A 720p device loads the `_hd` assets and the OS decodes them at the output size, so the smaller assets render close to native today. This was checked on hardware on 2026-08-07 (#419's closing comment) through the debug console's `r2d2_bitmaps`.

No `_sd` assets exist. Roku's manifest reference describes the third value as the SD replacement string and describes no fallback, so what an SD UI loads is unverified. See [`sd-resolution-native-support`](tech-debt.md#sd-resolution-native-support). The manifest's splash and channel-poster images use separate per-resolution keys and are not affected.

### Source layout

- SVG sources are committed in [`resources/icons/`](../../resources/icons/). They are Material Symbols, Rounded, weight 500, outlined by default, 24px, and `npm run icons:add` locks that style. [`resources/icons/README.md`](../../resources/icons/README.md#fill-convention) lists when to use a filled variant.
- [`scripts/generate/icons-build.js`](../../scripts/generate/icons-build.js) renders `images/icons/<name>_fhd.png` and `<name>_hd.png` with [sharp](https://sharp.pixelplumbing.com/). The PNGs are committed.
- `resources/icons/icons.json` overrides an icon's `sizeFhd` (the canvas, which is the Poster's width and height) and `glyphSize` (the visible glyph inside it). Both default to what the existing PNG measures ([README](../../resources/icons/README.md#glyph-density)).
- `resources/placeholders/placeholders.json` drives a second pass: 256×256 placeholder glyphs in `images/placeholders/`. `JRPlaceholder` loads them through `getPlaceholderImagePath()` over a themed backdrop, so backgrounds are themed at runtime rather than baked into the PNG.
- A glyph used both outlined and filled commits `<name>.svg` and `<name>_filled.svg`. The icon pass skips `_filled.svg` files, which only placeholders use.

### Pipeline contract

`npm run icons:build` works out each icon's canvas and glyph size: the override, else the existing PNG, else `96`/`54`. It rasterizes the SVG large and trims Material's built-in padding, so each icon's glyph size is honored. Then it resizes the glyph and pads it to the canvas. The sharp config and version are pinned, so the same SVG renders the same image every run.

`npm run icons:check` renders in memory and fails on drift. It runs in pre-push and, in CI, through the repo drift gate in [`icons-build.test.js`](../../tests/scripts/unit/generate/icons-build.test.js). That gate also catches a dependency bump that changes the renderer.

**Drift is measured in decoded pixels, not bytes** ([`scripts/lib/png-compare.js`](../../scripts/lib/png-compare.js), shared with the gradient generator). sharp bundles its own `libvips` and `zlib`, so the PNG bytes change when sharp changes and differ between machines. Pixel comparison still fails on a stale, missing or resized asset, and on a renderer change that moves pixels. It ignores file size. Commits `94c6fd8d7` and `c04186f6d` have the history.

Write mode leaves a pixel-identical file alone, so a rebuild on one machine does not rewrite every asset for the next contributor. `icons:build -- --force` rewrites them all, which is how you adopt a newer encoder on purpose. `gradients:build` has the same flag for the same reason.

The pre-push hook regenerates icons as an auto-fix when an icon or placeholder source, `icons-build.js` or `png-compare.js` changes, then runs the check.

### Gradients and hardware data

`gradients:build` renders the alpha ramps in `images/gradients/` that the [`Gradient`](../../components/ui/Gradient.bs) component stretches and tints. It follows the same contract as the icons ([ADR 0025](../adr/0025-gradient-rendering-ramp-posters.md)).

`roku-hardware:fetch` builds [`scripts/data/roku-hardware.json`](../../scripts/data/roku-hardware.json) from Roku's published device table, read by [`scripts/roku-devices.js`](../../scripts/roku-devices.js). Its input is an external document, so `:check` cannot re-derive it. It validates the dataset's own rules and a checksum instead, and [`roku-hardware-sync.yml`](../../.github/workflows/roku-hardware-sync.yml) checks upstream weekly. The fetch refuses a cell it does not recognize, so an upstream spelling change fails the sync instead of marking a device unknown.

## Roku signing pipeline

A Roku Channel Store submission needs a signed `.pkg`, not the sideload ZIP. `npm run package:signed` runs `build:prod`, then [`scripts/create-signed-package.cjs`](../../scripts/create-signed-package.cjs). Uploading the `.pkg` is manual, because Roku has no submission API.

- **Signing runs on a Roku.** `roku-deploy` uploads the ZIP, calls the device's signing endpoint and downloads the `.pkg`. There is no offline path, so the script needs a device in developer mode and `ROKU_IP`, `ROKU_PASSWORD` and `ROKU_SIGNING_PASSWORD`.
- **It takes the device lock.** Signing deploys to the Roku, so it holds [the device lock](../dev/rta-tests.md#the-device-lock) from before its first device call until it finishes. The local checks (environment, a production build, the manifest version) run first and need no network.
- **It runs locally, not in CI.** A CI-built artifact would need downloading and storing, which costs more than the local run it saves.
- **It refuses a build with source maps.** The prod config sets `sourceMap: false`, so any `.map` in `build/` means a dev or test build is sitting there. The npm script always builds prod first; the guard catches a direct run against a stale build.
- **It can check the developer ID.** With `ROKU_DEV_ID` set, the script reads the device's ID through `rokuDeploy.getDevId()` and stops before signing if it differs. `roku-deploy` ignores a `devId` option during signing. Store updates must be signed with the same ID as before.

The runbook is in [releases.md](../admin/releases.md#signed-pkg-for-roku-channel-store).

## ropm modules

ropm copies Roku libraries into the project at install time; nothing resolves at runtime. The Roku runtime packages are in `package.json`'s `dependencies`, most under short npm aliases so the vendored paths stay short:

| Alias | Package | Used for |
|---|---|---|
| `log` | `roku-log` | Logging ([logging.md](logging.md)) |
| `rr` | `roku-requests` | HTTP, under the API Task |
| `promises` | `@rokucommunity/promises` | Render-thread promises ([promises.md](../dev/promises.md)) |
| `sgRouter` | `@rokucommunity/sgrouter` | Screen routing ([navigation.md](navigation.md)) |
| (none) | `@rokucommunity/bslib` | BrighterScript's standard library |

They land in the gitignored `source/roku_modules/` and `components/roku_modules/`. `npm run ropm` runs `ropm copy`, then `scripts/ropm-hook.cjs`.

## Dev dependencies worth knowing

`package.json` lists them all, and the BrighterScript packages are on alpha versions. These have a reason to name:

- `jshint` checks JSON for duplicate keys, which Prettier does not.
- `eslint-config-prettier` turns off the ESLint rules that would fight Prettier.
- `dotenv` reads the checkout's `.env` and the per-user `~/.config/jellyrock/env`, through [`scripts/lib/env-config.cjs`](../../scripts/lib/env-config.cjs).
- `husky` installs the git hooks from `prepare` on every `npm ci`.
- `patch-package` applies the diffs in `patches/` after install. The Rooibos patch holds two fixes: coverage aggregated on write, so coverage runs stay under the render-thread watchdog ([rooibos#364](https://github.com/rokucommunity/rooibos/issues/364)), and the console reporter's `Ignored` count ([rooibos#435](https://github.com/rokucommunity/rooibos/pull/435)). After a Rooibos bump, regenerate it with `npx patch-package rooibos-roku` so its name matches the installed version.

## JS hygiene

`scripts/` holds the Node tooling: BSC plugins, linters, generators and the changelog sync script. How to write and test it is in [scripts-development.md](../dev/scripts-development.md), including which files must be `.cjs` ([Module system](../dev/scripts-development.md#module-system-cjs-or-js)). Older top-level `.cjs` scripts that could move to ESM are tracked as [`mixed-esm-cjs-scripts`](tech-debt.md#mixed-esm-cjs-scripts).

### ESLint

[`eslint.config.js`](../../eslint.config.js) is a flat config: `@eslint/js` recommended, the `eslint-plugin-n` mixed ESM and CJS preset, and `eslint-config-prettier` last. Beyond generic hygiene, path-scoped blocks turn project conventions into gates. There are two shapes:

- **A `no-restricted-syntax` selector**, for "this syntax is banned here". RTA waits and assertions must throw through `diagnosedError`, so a failure reports the device state it saw ([rta-tests.md](../dev/rta-tests.md#when-a-wait-times-out-it-reports-what-it-saw)). A repo-wide `n/no-restricted-import` and `n/no-restricted-require` pair keeps `dotenv` inside `env-config.cjs`.
- **A local rule module** in [`scripts/lint/eslint-rules/`](../../scripts/lint/eslint-rules/), for logic a selector cannot hold or a check that needs data. Reach for one when the selector stops being something a reviewer could safely edit. A rule module gets unit tests through ESLint's `RuleTester`, in [`tests/scripts/unit/lint/`](../../tests/scripts/unit/lint/).

The rule modules sit in two namespaces, chosen by scope:

- `jellyrock-rta/*` covers `tests/rta/**` and `scripts/capture-screenshots.js`. `wait-justified` and `sleep-budgeted` are inventories: a per-file count that ratchets, because some instances must be argued for. `home-list-resolved` lets the Home row list ids appear only in `tests/rta/lib/home-list.js`.
- `jellyrock-tests/*` covers test files repo-wide. `ordering-asserts-presence` requires an ordering assertion over `indexOf` or `findIndex` to assert its operands were found, since `-1` sorts before every real index. It has no budget and no escape hatch, because compliance always costs one line.

A rule with no escape hatch is reasonable only when compliance is free; otherwise it needs the inventory shape. All the RTA rules share one `files:` block, because a flat config replaces a rule's options rather than merging them.

Both shapes ride `lint:js`, which already has a CI home, so they need no new script or workflow. Prefer them over a new `scripts/lint/` checker unless the rule reasons across files. A legitimate exception disables the rule on its line, with a reason.

### Prettier and Vitest

- [`.prettierrc.json`](../../.prettierrc.json) matches the `bsfmt` style: 2-space indent, single quotes, semicolons, trailing commas, 100 columns. `.vscode/*.json` uses the JSONC parser.
- [`.prettierignore`](../../.prettierignore) leaves out `package-lock.json`, `locale/`, the vendored OpenAPI specs, `CHANGELOG.md` and the formats other tools own (`.bs`, `.brs`, `.xml`, `.md`). Every Prettier run trusts it.
- [`vitest.config.js`](../../vitest.config.js) picks up `tests/scripts/**/*.test.js` and `tests/rta/**/*.test.js`, the RTA harness's hardware-free parts. The suffix matters: `tests/rta/specs/**/*.spec.js` drives a real device and belongs to `vitest.rta.config.js`.
- Its `globalSetup`, [`no-durable-writes.js`](../../tests/scripts/setup/no-durable-writes.js), fails the run if a test wrote into `.device-runs/`, the ledger of real device runs, or into `out/`, where a device run's package lives ([scripts-development.md](../dev/scripts-development.md#a-test-must-not-write-into-device-runs)).

### Surfaces for JS and JSON

| Surface | What runs | Fixes? |
|---|---|---|
| Pre-commit (lint-staged) | `eslint --fix` and `prettier --write` on staged JS; `jshint` and `prettier --write` on staged JSON | Yes |
| Pre-push | `lint:js` and `test:scripts` when JS is in the push range; `check-formatting:js` when JS or JSON is | No |
| CI, `lint-js.yml` | `lint:js` and `check-formatting:js` | No |
| CI, `test-scripts.yml` | `test:scripts`, behind a path filter covering the scripts, their tests and the files they check | No |

jshint and Prettier do not overlap: jshint catches duplicate keys, Prettier catches formatting.

## Makefile

The Makefile wraps the npm scripts and adds device targets. `ROKU_DEV_TARGET` (the device address) is needed by every device target, and `ROKU_DEV_PASSWORD` by all but `home` and `launch`.

| Target | What it does |
|---|---|
| `make build-dev`, `build-prod`, `build-tests`, `build-tests-unit`, `build-tests-integration`, `build-tdd` | The matching `npm run build*`. `build-tdd` is a one-shot build |
| `make format`, `make lint` | `npm run format`, `npm run lint` |
| `make make_images` | Branding PNGs from SVGs (needs ImageMagick `convert`) |
| `make home`, `make launch` | Press Home; launch the installed app |
| `make install` | Press Home, install the built ZIP, then launch it |
| `make remove` | Remove the installed app |
| `make screenshot` | Save a screenshot to `screenshot.jpg` in the repo root |
| `make deploy` | Lint, remove, then install |

```bash
export ROKU_DEV_TARGET=<device address>
export ROKU_DEV_PASSWORD=<developer password>
make deploy   # lints, removes the old build, installs and launches the new one
```

## Verification surfaces

Nine surfaces check or sync the work, and each check runs at the cheapest surface that can do it correctly.

Surfaces 1 to 7 form a cost ladder: the same kind of check, pushed as early as it still works. Surfaces 8 and 9 differ in kind. They need a Roku, a physical resource, so they cannot move earlier, and surface 9 cannot run on every PR. CI is not the last line of defense.

| # | Surface | Trigger | What it owns | Takes |
|---|---|---|---|---|
| 1 | Editor (BrighterScript extension) | Each edit | `.bs` validation and bslint diagnostics | Instant |
| 2 | `PostToolUse` hook ([`bsfmt-on-write.sh`](../../.claude/hooks/bsfmt-on-write.sh)) | An agent's file edit | `bsfmt --write` on that file | Under a second |
| 3 | End-of-turn hook | Claude Code `Stop`; Copilot Coding Agent `sessionEnd` | Doc reminders and lint on uncommitted files. Claude Code also runs the progress-cursor nudges | Seconds |
| 4 | Pre-commit ([`.lintstagedrc.cjs`](../../.lintstagedrc.cjs)) | `git commit` | File-scoped lint and formatting on staged files | Seconds |
| 5 | Pre-push ([`.husky/pre-push`](../../.husky/pre-push)) | `git push` | Project-wide checks scoped to the push range, regenerated outputs, advisory nudges | Tens of seconds |
| 6 | Post-merge journal sync ([`journal-sync.yml`](../../.github/workflows/journal-sync.yml)) | A PR merged to `main` | The mechanical close-loop on `progress.md` | Seconds |
| 7 | CI (`.github/workflows/lint-*.yml` and others) | A PR opened or updated | The project-wide checks, with no way to bypass them | Minutes |
| 8 | Device unit tests ([`device-unit-tests.yml`](../../.github/workflows/device-unit-tests.yml)) | A PR opened or updated; a push to `main` | The Rooibos suites on a Roku, the only surface that runs BrightScript inside the app | Minutes |
| 9 | RTA functional tests ([`rta-functional-tests.yml`](../../.github/workflows/rta-functional-tests.yml)) | A push to `release-*.*.*`; manual dispatch | Screen-level navigation and rendered content, driving the app from outside | Minutes |

### Why each surface exists

- **Editor:** the fastest loop for people, if the extension is set up. It does nothing for agents.
- **`PostToolUse`:** an agent's format-on-save, so its next read shows formatted code. Only `bsfmt`, because anything project-wide is too slow per edit. Silent on success.
- **End-of-turn:** covers work not yet committed. The lint step checks only working-tree files, since committed files are pre-commit's job. The doc step names architecture docs and dev guides whose `related-files` the session touched. None blocks the turn.
- **Pre-commit:** the gate for people and agents alike. `bsfmt`, markdownlint and the spellchecker on staged files, plus the JS and JSON checks above. Fixes are re-staged into the same commit.
- **Pre-push:** what cannot run per file: the full compile (`validate`), bslint, `lint:docs`, the voice ratchet, the generated-output checks, and the steps that rebuild one output from many inputs. It also prints two nudges that never block: [`decision-shape-nudge.cjs`](../../scripts/lint/decision-shape-nudge.cjs) and [`progress-cursor-nudge.cjs`](../../scripts/lint/progress-cursor-nudge.cjs).
- **Post-merge journal sync:** runs [`scripts/journal-sync.js`](../../scripts/journal-sync.js) on the merged PR. It adds the PR to `## Recently shipped`, clears `## Currently running` when it matches, and bumps `last-updated:`. It skips the `dependencies`, `documentation`, `ci` and `automated` labels and bot authors. Each PR gets its own concurrency group, and the push retries on a moved base.
- **CI:** cannot be bypassed. It runs the same checks as pre-push but is wired separately, so a check must be added to both (below).
- **Device unit tests:** own what no static or Node test reaches: Roku OS behavior, registry I/O, Task threading. `check-skip` short-circuits a PR with nothing test-relevant. The workflow runs on `pull_request_target`, which hands secrets to fork code, so a `fork-gate` job waits for a maintainer behind the `roku-device` environment's required reviewer. GitHub's "require approval for outside collaborators" setting does not cover `pull_request_target`.
- **RTA:** owns whether a screen renders the right thing, which Rooibos cannot see. It is release-only because CI has one Roku, shared with surface 8, and a run holds it for a long time. A regression can therefore surface only at release; run `npm run test:rta` locally when a change touches navigation or screens ([rta-tests.md](../dev/rta-tests.md#when-ci-runs-it)).

CI and local work never share a Roku: CI uses its own device, named by an org-level secret. Local runs can collide with each other, so [`scripts/device-lock.js`](../../scripts/device-lock.js) takes a lock keyed on the device's identity. CI only reads it, which keeps the fork-running workflow on read-only permissions. See [rta-tests.md](../dev/rta-tests.md#the-device-lock) and decision [`device-lock-scoped-to-local`](../decisions.md#decision-id-device-lock-scoped-to-local).

### Which hook runs each lint command

| Command | Pre-commit | Pre-push | Why |
|---|---|---|---|
| `bsfmt --write` | ✓ | | File-scoped; the fix is re-staged |
| `lint:bs` (bslint) | | ✓ | Needs the whole project |
| `validate` (`bsc --noEmit`) | | ✓ | A full compile |
| `lint:markdown` | ✓ | ✓ | Pre-commit fixes; pre-push re-checks changed `.md`, because rebase, cherry-pick and merge commits skip pre-commit |
| `lint:spelling` | ✓ | ✓ | Same backstop. No auto-fix |
| `lint:json` (jshint) | ✓ | | File-scoped |
| `lint:docs` | | ✓ | Needs every doc loaded |
| `lint:voice` | ✓ | ✓ | Pre-commit checks the staged `.md`; pre-push runs on every push, so a baseline-only change is checked too |
| `lint:comment-voice` | | ✓ | Runs on every push, so a baseline-only change is checked too |
| `lint:skill-placeholders` | ✓ | ✓ | Pre-commit checks the staged skills; pre-push checks every skill |
| `docs:dev-index:check` | | ✓ | Drift in a generated table |
| `docs:features:check` | | ✓ | Drift in the feature catalog, the features index and the README list, all generated from the feature pages |
| `update-translations` | | ✓ | Regenerates from `en_US.json` |
| `lint:language-coverage` | | ✓ | Only when its inputs change |
| `lint:issue-templates` | | ✓ | Only when the templates change |

[`scripts/lib/lint-excludes.cjs`](../../scripts/lib/lint-excludes.cjs) holds the exclude lists that lint-staged and the end-of-turn hook use. The `package.json` `lint:*` scripts carry hand-copied lists of their own, and the module asks you to change both together.

### Spellchecker config

Four surfaces run `spellchecker-cli`: `lint:spelling` (CI and pre-push), [`.lintstagedrc.cjs`](../../.lintstagedrc.cjs), [`check-touched-lint.cjs`](../../scripts/lint/check-touched-lint.cjs) and [`journal-sync.js`](../../scripts/journal-sync.js). All read their dictionaries and plugins from [`.spellcheckerrc.yaml`](../../.spellcheckerrc.yaml), so they cannot drift apart. Before editing a call site:

- Don't pass `-d`, `-p` or `-i`. `spellchecker-config.test.js` fails if any call does, scanning the whole call expression.
- Spawn from the repo root. The tool finds its config from the working directory, not the checked file, and quietly falls back to its defaults without it. `journal-sync.js` passes `cwd: repoRoot` for this reason.
- File globs stay out of the config, since `lint-excludes.cjs` holds them.

[`dictionary-sentence-final.txt`](../../dictionary-sentence-final.txt) is generated from `dictionary.txt` (`npm run dictionary:sentence-final`). It holds each entry with a trailing period, because the spellchecker attaches a paragraph's final period to the word before a list, blockquote or lowercase heading. Do not replace it with an `ignore:` regex: that hides real typos in the same position, and `spellchecker-config.test.js` fails if an `ignore` key returns. Its drift check runs in `lint`, in `_lint-spelling.yml` before the spell lint, and on every push. The reasoning is decision [`spellchecker-sentence-final-dictionary`](../decisions.md#decision-id-spellchecker-sentence-final-dictionary).

### Bypassing a hook

`git commit --no-verify` and `git push --no-verify` skip the hooks, and CI still catches the failure on the PR. When a hook complains, fix the cause rather than bypass it.

A new git worktree has no hooks until `npm ci` runs inside it, so it skips surfaces 4 and 5 without warning. [`AGENTS.md`](../../AGENTS.md) has the rule, where to put a worktree, and why linking `node_modules` fails.

## CI lint workflows

Each lint scope has a pair of workflows under [`.github/workflows/`](../../.github/workflows/): `lint-X.yml`, triggered by the PR, calls the reusable `_lint-X.yml`, which does the work.

**Every job that runs on a machine sets `timeout-minutes`:** 15 for a GitHub-hosted job, unless a comment at the job says why it differs. Without it a job inherits GitHub's 6-hour default, and a stuck step holds the PR's checks for hours (#791). A caller job cannot take the key, so the limit goes on the job inside `_lint-X.yml`. [`workflow-timeouts.test.js`](../../tests/scripts/unit/lint/workflow-timeouts.test.js) enforces it.

**Path relevance is decided inside the job.** Each `_lint-X.yml` starts with [`changed-paths`](../../.github/actions/changed-paths/action.yml), which uses `gh pr diff --name-only` to test the PR's files against the workflow's regex. Later steps run only when it matches. An event-time `paths:` filter would skip the workflow entirely and report no status, so a required check would leave the PR waiting forever. Running every time and skipping inside always reports a status.

To add a lint workflow, copy an existing `_lint-X.yml` and change the regex passed to `changed-paths`. Expose a `force: boolean` input and forward it to the action, so a dependency update can bypass the path check.

### Dependency updates

[`_validate-dependencies.yml`](../../.github/workflows/_validate-dependencies.yml) re-runs every lint and test workflow with `force: true` on a PR labeled `dependencies`, which Renovate applies. That full run is what lets the org Renovate preset (`github>jellyrock/.github//renovate/default`) merge updates on its own safely.

When you add a `_lint-*`, `_test-*` or `_smoke-test-*` workflow:

1. Add a `force: true` job for it to `_validate-dependencies.yml`. `npm run lint:ci-workflow-sync` fails until you do.
2. Add its status-check context to the required checks on `main`. A reusable called from a wrapper reports as `"<wrapper job> / <reusable job>"`, such as `docs / docs`. A context that is not required still runs and turns red but does not block a merge, and no check in the tree can see branch protection.

```bash
gh api repos/jellyrock/jellyrock/branches/main/protection --jq '.required_status_checks.contexts[]'
```

Before adding a pair at all, check whether an already-required suite can host the check. A new workflow costs a runner, an `npm ci`, a `_validate-dependencies.yml` job and a branch-protection edit, and blocks nothing until that edit lands. A drift-gate test in `_test-scripts.yml` inherits the required `vitest / vitest` and gates the day it merges. `icons:check` and `gradients:check` are wired this way, registered in `COVERED_BY_TEST` in [`ci-parity-check.js`](../../scripts/lint/ci-parity-check.js). Use a pair when the check needs its own runtime, its own tooling or its own name in the checks list.

[`_smoke-test-deps.yml`](../../.github/workflows/_smoke-test-deps.yml) loads `roku-deploy` and `lint-staged` and checks their exported functions, without running either CLI. Husky needs no smoke test, since `prepare` runs it on every `npm ci`.

## Doc-maintenance enforcement

Two layers keep the architecture docs in step with the code. Both fire when you touch a doc's `related-files`, when re-reading it is cheap. The agent rule is in [`AGENTS.md`](../../AGENTS.md#doc-maintenance-discipline).

### 1. End-of-turn reminder (soft)

When an agent finishes a turn, [`check-touched-related-files.cjs`](../../scripts/lint/check-touched-related-files.cjs) prints which docs claim the files it touched: `docs/architecture/`, and `docs/dev/` marked as informational. Claude Code runs it from a `Stop` hook ([`check-touched-related-files.sh`](../../.claude/hooks/check-touched-related-files.sh)), and the GitHub-hosted Copilot Coding Agent from `sessionEnd` in [`.github/hooks/hooks.json`](../../.github/hooks/hooks.json).

It never blocks. A block would tempt an agent to bump `last-reviewed` only to clear it, which would empty the freshness signal. Dev guides get only this reminder: a how-to with a moved path breaks its reader, but changes no subsystem's shape, so it must never block a PR.

### 2. CI gate (hard)

[`docs-stale-blocking.cjs`](../../scripts/lint/docs-stale-blocking.cjs) fails a PR that changes a stale architecture doc's `related-files` without updating the doc. A doc is stale after 120 days. It runs in `_lint-docs.yml`, behind that workflow's path filter, so a PR that touches only files outside the filter skips it ([`ci-path-filters-unverified`](tech-debt.md#ci-path-filters-unverified)). PRs in unrelated areas pass freely.

### No calendar backlog

`last-reviewed` records the last review done in context, not a countdown. A weekly list of docs past 90 days was retired: it asked for cold re-reads that never happened, and it could never be cleared. `npm run docs:stale` reports the cadence on demand, and [`docs-stale-tracker.yml`](../../.github/workflows/docs-stale-tracker.yml) now tracks only the `docs/progress.md` cursor.

Keep content data out of `related-files`. A file that changes in routine work without changing a shape, such as `locale/custom/en_US.json`, makes a doc look drifted and eventually blocks an unrelated PR. The machinery files carry that signal instead.

## End-of-turn lint feedback

The editor catches `.bs` issues and pre-push catches the rest, but an agent would otherwise learn about a doc typo only at push time, after reporting done. [`check-touched-lint.cjs`](../../scripts/lint/check-touched-lint.cjs) runs on the same end-of-turn hooks:

- It takes the working-tree changes (staged or not, and untracked files) through [`scripts/lib/changed-files.cjs`](../../scripts/lib/changed-files.cjs).
- It runs the spellchecker and markdownlint on changed `.md` files, and jshint on changed `.json` files.
- It prints failures so they land in the agent's next turn.

It skips what the editor covers (`lint:bs`, `validate`, formatting), `lint:docs` (the layers above cover it) and the translation checks (pre-push runs them). It never blocks.

## Editor setup

The workspace targets VS Code. [`.vscode/extensions.json`](../../.vscode/extensions.json) recommends the extensions, and [`.vscode/settings.json`](../../.vscode/settings.json) configures them:

- **BrighterScript:** `brightscript.projects` names the bsconfigs the language server checks live, `bsconfig.json` and `bsconfig-tests.json`. It shows diagnostics and never builds. It also completes `translationKeys.*` from the plugin's virtual file.
- **Format on save:** `editor.formatOnSave` is on. Markdown formats with markdownlint, JS and JSON with Prettier (the tool and config pre-commit uses), XML with the Red Hat XML extension.
- **Linting:** the ESLint and markdownlint extensions are recommended. Nothing in the editor checks spelling, translations or `lint:docs`; the hooks and CI do.

When to run the npm checks by hand is in [`AGENTS.md`](../../AGENTS.md).

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md). Search by `area` for build and tooling entries.
