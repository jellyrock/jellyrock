---
topic: scripts-development
related-files:
  - scripts/CLAUDE.md
  - eslint.config.js
  - .prettierrc.json
  - .prettierignore
  - vitest.config.js
last-reviewed: 2026-05-02
---

# Working in `scripts/`

How to add, modify, or test the build / lint / codegen tooling that lives
outside the BSC project.

## Quick reference

| I want to… | Do this |
|---|---|
| Add a BSC plugin | `scripts/bsc-plugins/<name>.cjs` + register in [`bsconfig.json`](../../bsconfig.json) |
| Add a doc/code validator | `scripts/lint/<name>.cjs`, expose `npm run lint:<name>` |
| Add an output generator | `scripts/generate/<name>.cjs`, expose `npm run docs:<name>` or similar |
| Add a one-off CLI tool | `scripts/<name>.js` (ESM) at root |
| Add a shared helper | `scripts/lib/<name>.cjs` (must be `.cjs`) |
| Add tests | `tests/scripts/unit/<name>.test.js` |

## Directory layout

See [`scripts/CLAUDE.md`](../../scripts/CLAUDE.md) for the canonical layout
and module-system rule. Brief recap:

- `bsc-plugins/` — BSC compiler plugins
- `lint/` — validators (fail CI on bad input)
- `generate/` — output emitters
- `lib/` — shared CJS helpers
- root — one-off tools (build, ropm, telemetry, changelog, test runner)

## Module system: `.cjs` vs `.js`

`package.json` declares `"type": "module"`, so `.js` = ESM and `.cjs` = CJS.

**The hard constraint:** BSC plugins are `require()`'d by BrighterScript's
plugin loader, which is CommonJS. Plugins must therefore be `.cjs`. And because
CJS modules can't `require()` ESM, anything imported by a plugin (or by another
locked CJS file) is also forced `.cjs`. That locks `scripts/lib/*` and a handful
of other shared helpers.

For net-new top-level CLI scripts that aren't `require()`'d by anything, write
ESM `.js`. It's the modern default and works seamlessly with `node:` protocol
imports, top-level await, and ES module syntax.

The 13 existing top-level `.cjs` scripts predate this rule and remain CJS.
Migrating them is its own project (audit the require-graph first; some look
like top-level CLIs but get required from lint-staged or other CJS callers).

## Linting and formatting

JellyRock has four lint surfaces for JS/JSON:

| Surface | Trigger | Coverage |
|---|---|---|
| **`PostToolUse` hook** (Claude Code only) | After Write/Edit | `bsfmt --write` on `.bs`/`.brs` |
| **End-of-turn hook** | Agent finishes turn | spell / markdown / `json` on uncommitted files |
| **Pre-commit** (`lint-staged`) | `git commit` | File-scoped: `eslint --fix`, `prettier --write`, `jshint` |
| **Pre-push** | `git push` | Project-wide: `lint:js`, `check-formatting:js`, `lint:bs`, `validate`, etc. |
| **CI** | Per PR | Same as pre-push (can't bypass) |

**`npm run` cheat sheet:**

```bash
npm run lint:js               # ESLint over the whole project
npm run format:js             # Prettier --write on JS + curated JSON set
npm run check-formatting:js   # Prettier --check (no write)
npm run format                # bs + js (project-wide)
npm run check-formatting      # bs + js (project-wide)
npm run test:scripts          # vitest run
npm run test:scripts:tdd      # vitest watch
```

You generally **don't run these manually** — pre-push and CI handle them.
Exception: debugging a specific failure.

## Style anchors

Prettier config matches bsfmt as closely as possible:

- 2-space indent, no tabs
- Single quotes
- Semicolons
- Trailing commas on multiline (matches `bsfmt`'s pattern for arrays, AAs, params)
- Print width: 100
- `arrowParens: 'always'`

JSON files: Prettier defaults (double quotes, no trailing commas — JSON spec).
JSONC for `.vscode/*.json` (they have comments).

## Adding tests

Tests live in `tests/scripts/unit/` and mirror the structure of `scripts/`.
All test files are ESM `.test.js` regardless of whether the script-under-test
is `.cjs` or `.js` — Vitest handles cross-module-system imports transparently.

For BSC plugins, tests use **inline scenarios** today — template literals
(sometimes via `undent`) carrying short synthetic `.bs` snippets passed to
the shared harness. Every plugin test in `tests/scripts/unit/bsc-plugins/`
follows this shape; bodies stay under ~50 lines and each scenario is
self-contained.

If a future plugin grows scenarios that don't fit comfortably inline (very
long fixtures, or fixtures shared across multiple test cases), the next step
is `.bs` fixture files alongside the tests — but the pattern hasn't been
needed yet, so we haven't standardized a layout.

Pattern (sketch):

```js
import { describe, it, expect } from 'vitest';
import { runPluginOnSource } from './_helpers/run-plugin.js';
import plugin from '../../../scripts/bsc-plugins/no-direct-sdk.cjs';

describe('no-direct-sdk', () => {
  it('allows sdk.* calls inside ApiClient.bs', () => {
    const diagnostics = runPluginOnSource(plugin, {
      'source/api/ApiClient.bs': `function go()\n  sdk.users.getMe()\nend function`,
    });
    expect(diagnostics).toHaveLength(0);
  });
});
```

The shared `_helpers/run-plugin.js` harness instantiates a `brighterscript`
`Program` with the plugin loaded, applies the source, and returns a flat
diagnostic list (synchronously — `program.validate()` is synchronous, so no
`await` needed at the call site). Keeps individual tests terse.

## Common gotchas

- **`fs-extra` is not a dep.** Use `node:fs` (`ropm-hook.cjs` used to require
  it from the `ropm` package's transitive deps; now uses native `fs`).
- **`n/no-unpublished-import` and `n/no-unpublished-require`** are off because
  this is a Roku app, not an npm package — nothing in `scripts/` is published.
- **The `lint:json` jshint exclude list** at `package.json:lint:json` must
  include any new `.js` config files at repo root (e.g. `eslint.config.js`,
  `vitest.config.js`) so jshint doesn't try to parse ESM as ES5.
- **Prettier respects `.prettierignore`.** When adding a new directory whose
  JSON shouldn't be formatted (vendor data, generated output, etc.), add it
  there.
