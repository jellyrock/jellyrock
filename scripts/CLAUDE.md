# scripts/ — Agent rules

Build, lint, and codegen tooling that runs outside the BSC project (Node.js, not BrightScript).

## Directory layout

```text
scripts/
├── bsc-plugins/   BSC compiler plugins (loaded via bsconfig*.json)
├── lint/          Validators that fail CI on bad input
├── generate/      Output emitters (write files; no validation role)
├── lib/           Shared CJS helpers (require()'d by the above)
├── *.cjs / *.js   One-off tooling (build, ropm, telemetry, changelog, test runner)
```

Put new scripts in the bucket that matches their *primary* role. If a script is
both lint and generator (e.g. `update-translations.cjs`: default = lint, `--fix`
= generator), put it in the bucket that matches its default behavior.

## Module system rule (load-bearing)

**BSC plugins MUST be `.cjs`.** BrighterScript's plugin loader (`loadPlugins`
in the vendored `brighterscript/dist/util.js`) uses `require()`.
ESM plugins won't load.

**Anything `require()`'d by a `.cjs` file is also forced `.cjs`** — including
everything in `scripts/lib/`. ESM (`.js`) modules can't be `require()`'d from
CJS. The reverse works fine: ESM can `import x from './foo.cjs'`.

Effective rule for new scripts:

| Script type | Extension | Why |
|---|---|---|
| BSC plugin (`scripts/bsc-plugins/*`) | `.cjs` | Loaded via `require()` |
| Shared helper (`scripts/lib/*`) | `.cjs` | Required by plugins (CJS) |
| `require()`'d by other `.cjs` | `.cjs` | CJS can't require ESM |
| Top-level CLI script (no internal callers) | `.js` (ESM) | Modern default |

The 13 existing top-level `.cjs` scripts predate this rule. Migrating them is
tracked separately — see [`tech-debt.md`](../docs/architecture/tech-debt.md)
("Mixed ESM/CJS in scripts/"). Don't migrate ad-hoc; the require-graph audit
needs to come first.

## Linting and formatting

- **ESLint** (flat config, `eslint.config.js`) covers `.js`/`.cjs`/`.mjs`
  repo-wide. Run via `npm run lint:js`.
- **Prettier** (`.prettierrc.json`, `.prettierignore`) formats JS + a curated
  JSON set. Run via `npm run format:js` (write) or `npm run check-formatting:js`
  (check). The unprefixed `format` / `check-formatting` aggregate both
  BrightScript and JS.
- **jshint** (kept) catches duplicate-key bugs and validates JSON syntax on the
  broader set.
- Pre-commit (`lint-staged`) auto-fixes file-scoped issues; pre-push runs the
  project-wide checks; CI mirrors pre-push.

## Tests

`tests/scripts/unit/<name>.test.js` mirrors `tests/source/unit/`. Run via
`npm run test:scripts` (CI) or `npm run test:scripts:tdd` (watch mode).

BSC plugin tests use **inline scenarios** — template literals carrying short
synthetic `.bs`/`.xml` snippets passed to the shared `_helpers/run-plugin.js`
harness. Bodies stay under ~50 lines per scenario.

If a future plugin grows fixtures that don't fit comfortably inline, the next
step is `.bs` fixture files alongside the tests — but that hasn't been needed
yet, so the layout isn't standardized. Don't pre-build it speculatively.

## Shebangs on top-level CLI scripts

ESLint's `n/hashbang` rule enforces the shebang policy automatically:

- Scripts listed in `package.json` `"bin"` MUST have `#!/usr/bin/env node`.
- Scripts NOT in `"bin"` MUST NOT have a shebang.

Today nothing in `scripts/` is in `"bin"`; everything is invoked via
`node scripts/...` from npm scripts. So no shebangs. If a script genuinely
needs direct invocation later (`./scripts/foo.js`), the fix is to add it to
`"bin"` — not to hand-restore the shebang and disable the lint.

## Don't manually run

- `npm run lint:js` / `check-formatting:js` — pre-push runs them
- `npm run test:scripts` — pre-push + CI run it
- Exception: debugging a specific lint failure
