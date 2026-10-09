---
topic: scripts-development
related-files:
  - scripts/CLAUDE.md
  - eslint.config.js
  - .prettierrc.json
  - .prettierignore
  - vitest.config.js
last-reviewed: 2026-10-09
---

# Working in `scripts/`

How to add, change and test the build, lint and code-generation tools that live outside the BrighterScript project.

## Quick reference

| I want to… | Do this |
| --- | --- |
| Add a BrighterScript compiler plugin | `scripts/bsc-plugins/<name>.cjs`, built on [`scripts/lib/bsc-rule.cjs`](../../scripts/lib/bsc-rule.cjs), and registered in [`bsconfig.json`](../../bsconfig.json) |
| Add a doc or code validator | `scripts/lint/<name>.cjs`, run as `npm run lint:<name>` |
| Add an output generator | `scripts/generate/<name>.cjs`, run as `npm run docs:<name>` or similar |
| Add a one-off command-line tool | `scripts/<name>.js` (ESM) |
| Add a shared helper | `scripts/lib/<name>.cjs` (it must be `.cjs`) |
| Add tests | `tests/scripts/unit/<name>.test.js`, in the subfolder matching the script's (`bsc-plugins/`, `lint/`, `lib/`, `generate/`) |

## Folder layout

[`scripts/CLAUDE.md`](../../scripts/CLAUDE.md) holds the full layout and the module-system rule. In short:

- `bsc-plugins/`: BrighterScript compiler plugins.
- `lint/`: validators that fail CI on bad input. `lint/eslint-rules/` holds local ESLint rules, which [`eslint.config.js`](../../eslint.config.js) imports rather than running as commands.
- `generate/`: scripts that write output files.
- `lib/`: shared CommonJS helpers.
- The top level: one-off tools (build, ropm, telemetry, changelog, test runner).

## Module system: `.cjs` or `.js`

`package.json` sets `"type": "module"`, so a `.js` file is an ES module and a `.cjs` file is CommonJS.

**Compiler plugins must be `.cjs`.** BrighterScript loads plugins with `require()`, which is CommonJS. A CommonJS file can't `require()` an ES module, so anything a plugin imports must be `.cjs` too. That fixes `scripts/lib/` and a few other shared helpers as `.cjs`.

Write a new top-level tool that nothing else `require()`s as an ES module (`.js`). That gives you `node:` imports, top-level `await` and `import` syntax.

The top-level `.cjs` scripts predate this rule and stay CommonJS. Moving one is its own job: check what requires it first, because some that look like standalone tools are required by lint-staged or other CommonJS files.

## Linting and formatting

Five layers check JavaScript and JSON:

| Layer | When it runs | What it does |
| --- | --- | --- |
| `PostToolUse` hook (Claude Code only) | After an agent edits a file | `bsfmt --write` on `.bs` and `.brs` files |
| End-of-turn hook (agents) | When an agent finishes a turn | Spelling, markdown and JSON checks on uncommitted files |
| Pre-commit (`lint-staged`) | `git commit` | On the staged files: `eslint --fix`, `prettier --write`, `jshint` |
| Pre-push | `git push` | Project-wide: `lint:js`, `check-formatting:js`, `lint:bs`, `validate` and more |
| CI | Every pull request | The same checks as pre-push, with no way to skip them |

The `npm run` commands:

```bash
npm run lint:js               # ESLint over the whole project
npm run format:js             # Prettier --write over the project (.prettierignore sets what it skips)
npm run check-formatting:js   # Prettier --check (no write)
npm run format                # bs + js (project-wide)
npm run check-formatting      # bs + js (project-wide)
npm run test:scripts          # vitest run
npm run test:scripts:tdd      # vitest watch
```

You rarely need to run these yourself, because pre-push and CI do. Run one when you are debugging a failure it reports.

## Style

The Prettier settings ([`.prettierrc.json`](../../.prettierrc.json)) follow `bsfmt` as closely as they can:

- Two-space indent, no tabs.
- Single quotes and semicolons.
- Trailing commas on multi-line lists, as `bsfmt` writes arrays, AAs and parameters.
- A print width of 100.
- `arrowParens: 'always'`.

JSON files keep Prettier's defaults: double quotes and no trailing commas, as JSON requires. The `.vscode/*.json` files are parsed as JSONC, because they have comments.

## Adding tests

Tests live in `tests/scripts/unit/`, in subfolders that match `scripts/`. Every test file is an ES module (`.test.js`), whether the script it tests is `.cjs` or `.js`. Vitest handles the imports across the two module systems.

Plugin tests in `tests/scripts/unit/bsc-plugins/` write each scenario inline: a template literal holding a short `.bs` or `.xml` snippet, passed to one of the harnesses in [`tests/scripts/unit/_helpers/`](../../tests/scripts/unit/_helpers/). Keep each scenario self-contained. If a plugin someday needs fixtures too long to inline, or shared across tests, put `.bs` fixture files beside the tests; no layout for that exists yet.

### Building a diagnostic plugin

**Build a diagnostic plugin on [`scripts/lib/bsc-rule.cjs`](../../scripts/lib/bsc-rule.cjs).** Use `createScopeRule` for a rule about one component (its XML and its code-behind). Use `createProgramRule` for a rule that needs the whole program before it can judge any one site. The factories clear a rule's earlier findings before it judges again. Without that, a rule that reads two files leaves a stale finding on screen when you edit the file the finding isn't anchored in. See [build-and-tooling.md, Convention plugins](../architecture/build-and-tooling.md#convention-plugins).

**A rule whose every finding comes from, and is anchored in, one file can hook `afterValidateFile` directly.** BrighterScript already clears a file's diagnostics each time it validates the file again, so nothing goes stale. Also, `bsc-rule`'s `isSuppressed` honors `bsc-disable-file`, which an error-level gate must not. The four Task and dialog rules (`no-raw-run`, `no-task-fanout`, `no-same-node-relaunch`, `no-hand-rolled-dialog`) work this way.

Keep that exception narrow. Once a rule reads a second file, use the factories. The one exception is cross-file work that runs entirely in `afterValidateProgram`, under a tag the rule clears first, as `no-same-node-relaunch`'s check of its own list does. A file hook must never anchor a diagnostic in another file: BrighterScript never clears it, so it outlives the fix.

Test such a plugin with `runPluginOnEdits` as well as the usual cases. `runPluginOnSource` validates once, so it can't see what happens across validations, which is where stale findings come from.

### The three harnesses

| Harness | Tests | Returns |
| --- | --- | --- |
| `_helpers/run-plugin.js` | Plugins that report diagnostics (tier 1) | `runPluginOnSource`: one array of diagnostics from one `program.validate()`. `runPluginOnEdits`: one array per step of a sequence of edits. |
| `_helpers/transpile-with-plugin.js` | Plugins that change the transpiled code (tier 2, `roku-log`) | `{pkgPath: transpiledCode}` from `program.getTranspiledFileContents()` |
| `_helpers/run-plugin-with-temp-locale.js` | Plugins that add virtual files (tier 2, `translation-keys`) | `createTranslationKeysHarness()`, with `setup`, `regenerate`, `writeLocale` and `teardown` |

A tier 1 test, in outline:

```js
import { describe, it, expect } from 'vitest';
import { runPluginOnSource } from '../_helpers/run-plugin.js';
import plugin from '../../../../scripts/bsc-plugins/no-direct-sdk.cjs';

describe('no-direct-sdk', () => {
  it('allows sdk.* calls inside ApiClient.bs', () => {
    const diagnostics = runPluginOnSource(plugin, {
      'source/api/ApiClient.bs': `function go()\n  sdk.users.getMe()\nend function`,
    });
    expect(diagnostics).toHaveLength(0);
  });
});
```

A tier 2 transpile test, in outline:

```js
import { transpileWithPlugin } from '../_helpers/transpile-with-plugin.js';
import rokuLogPlugin from '../../../../scripts/bsc-plugins/roku-log.cjs';

it('strips m.log.* calls by default', async () => {
  const out = await transpileWithPlugin(rokuLogPlugin, {
    'source/foo.bs': `sub init()\n  m.log.info("hi")\nend sub`,
  });
  expect(out['source/foo.bs']).not.toMatch(/m\.log\.info/);
});
```

Plugin settings go in through the `Program` options. To override a default, pass `{ rokuLog: { strip: false } }` as the third argument.

The tier 1 harness is synchronous, because `program.validate()` is. The transpile harness is `async`, because `getTranspiledFileContents` is. The virtual-file harness is synchronous, and uses `beforeEach` and `afterEach` to create and remove its temporary folder.

### A test must not write into `.device-runs/`

`.device-runs/` keeps the records of real device runs: the ledger each kind of run reads its baseline from, and one record folder per device. `npm run test:scripts` runs without hardware, so it must never touch that folder.

The trap: [`scripts/run-record.js`](../../scripts/run-record.js) finds the folder through a relative `LEDGER_ROOT`, which resolves against `process.cwd()`. A test that calls `beginRun` or `endRun` (or anything that reaches `runsLedgerPath`) from the default working folder writes into your checkout's real ledger on every run, without a warning. Any test of that lifecycle needs its own working folder:

```js
let cwd;
beforeEach(() => {
  cwd = process.cwd();
  process.chdir(tmpDir);
});
afterEach(() => process.chdir(cwd));
```

Don't point `RTA_RECORD_DIR` at a temporary folder instead. Several of these tests check how the path is worked out when that variable is unset, so setting it makes them pass while checking nothing.

A `globalSetup` guard, [`tests/scripts/setup/no-durable-writes.js`](../../tests/scripts/setup/no-durable-writes.js), fails the suite if `.device-runs/` changed during the run, and prints what appeared. It runs once around the whole suite, not per file, so it can say what was written but not which test wrote it. The leaked record usually tells you, since it carries the fixture's own `deviceKey` and `run`.

Under `test:scripts:tdd` (watch mode), the guard reports when you quit, not between reruns: Vitest only tears down a `globalSetup` in `Vitest.close()`. It takes its snapshot when the session starts, so nothing escapes; the report just arrives late.

## Common mistakes

- **`fs-extra` isn't a dependency.** Use `node:fs`.
- **ESLint's `n/no-unpublished-import` and `n/no-unpublished-require` are off.** This is a Roku app, not an npm package, and nothing in `scripts/` is published.
- **Add a new `.js` config file at the repository root to the `jshint` exclude list** in `package.json`'s `lint:json` script, as `eslint.config.js` and `vitest.config.js` are. Otherwise `jshint` tries to read the ES module as ES5.
- **Prettier follows `.prettierignore`.** When you add a folder whose JSON shouldn't be formatted, such as vendored data or generated output, add it there.
