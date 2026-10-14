# Rules for `scripts/`

Build, lint and codegen tooling that runs outside the BSC project (Node.js, not BrightScript).

## Directory layout

```text
scripts/
├── bsc-plugins/   BSC compiler plugins (loaded through bsconfig*.json)
├── lint/          Validators that fail CI on bad input
│   └── eslint-rules/  Local ESLint rules, imported by eslint.config.js
├── generate/      Output emitters (write files; no validation role)
├── data/          Committed generated datasets (never hand-edited)
├── lib/           Shared helpers, mostly CJS
├── *.cjs / *.js   Standalone tooling (build, telemetry, changelog, test runner, measurement)
```

Put a new script in the folder that matches its *primary* role. If a script both lints and generates (`update-translations.cjs`: lint by default, generator with `--fix`), put it where its default behavior belongs.

## Module system rule

**BSC plugins must be `.cjs`.** BrighterScript's plugin loader (`loadPlugins` in `brighterscript/dist/util.js`) loads them with `require()`, so an ESM plugin won't load.

**Build a convention plugin from [`lib/bsc-rule.cjs`](lib/bsc-rule.cjs), not by hooking `afterValidateFile` directly.** Its `createScopeRule` and `createProgramRule` factories own the diagnostic lifecycle: they clear the previous run's findings before deriving them again, which a rule reading two files must do. They also handle the `bsc-disable-*` markers and the guard that keeps a rule from crashing the build. See [build-and-tooling.md, "Convention plugins"](../docs/architecture/build-and-tooling.md#convention-plugins).

**The exception is a rule whose every finding is derived from, and anchored in, a single file.** BSC clears a file's diagnostics by `location.uri` whenever that file validates again, so such a rule has nothing stale to clear and may hook `afterValidateFile` directly. The four Task and dialog rules (`no-raw-run`, `no-task-fanout`, `no-same-node-relaunch`, `no-hand-rolled-dialog`) are in this class, and they take the exception for a second reason: `bsc-rule`'s `isSuppressed` honors `bsc-disable-file`, which an error-severity gate must not, since a whole-file opt-out would silently remove the bound from every launch in the file. **If your rule reads a second file (the component XML, another component's interface, the program), you don't get this exception;** use the factories. The one shape that stays legitimate is `no-same-node-relaunch`'s: its file hook stays single-file, and everything that needs the program lives in `afterValidateProgram`, registered under a tag that hook clears first. A file hook that anchors a diagnostic in any other file breaks the exception: BSC never clears it, and it outlives the fix.

**Anything a `.cjs` file `require()`s must be `.cjs` too.** An ESM (`.js`) module can't be `require()`d from CJS. The reverse works: ESM can `import x from './foo.cjs'`. Most of `scripts/lib/` is `.cjs` for this reason; its `.js` files (`fixture-probe.js`, `odc-probe.js`, `png-compare.js`, `pr-title.js`) are imported only by ESM.

The rule for a new script:

| Script type | Extension | Why |
|---|---|---|
| BSC plugin (`scripts/bsc-plugins/*`) | `.cjs` | Loaded with `require()` |
| Shared helper a `.cjs` file uses (`scripts/lib/*`) | `.cjs` | Required by plugins and other CJS |
| Anything else a `.cjs` file `require()`s | `.cjs` | CJS can't require ESM |
| Top-level CLI script with no internal callers | `.js` (ESM) | The modern default |

The four top-level `.cjs` scripts predate this rule. Migrating them is tracked in tech-debt [`mixed-esm-cjs-scripts`](../docs/architecture/tech-debt.md#mixed-esm-cjs-scripts). Don't migrate one in passing: the audit of what requires what comes first.

## Generated assets

- **Icon PNGs are generated, not drawn.** SVG sources live in [`resources/icons/`](../resources/icons/). [`scripts/generate/icons-build.js`](generate/icons-build.js) renders each one with sharp into `images/icons/<name>_fhd.png` and `<name>_hd.png`, with canvas and glyph sizes per icon in `resources/icons/icons.json`. Never hand-edit a generated PNG: render it again from the SVG. Drift is caught by pre-push (which rebuilds when `resources/icons/`, the build script or [`scripts/lib/png-compare.js`](lib/png-compare.js) changes), by `npm run icons:check`, and in CI by the drift test in `tests/scripts/unit/generate/icons-build.test.js`.
- **Asset drift is measured in decoded pixels, not bytes** ([`scripts/lib/png-compare.js`](lib/png-compare.js), shared by the icon and gradient generators). sharp bundles its own `libvips` and `zlib`, so the same image encodes to different bytes when sharp is updated, and a byte comparison fails on identical images. Two things to know before you touch either generator: a build leaves a pixel-identical PNG alone (use `--force` to encode it again on purpose), and a bloated but pixel-identical PNG is not detected.
- **To add an icon, use [`npm run icons:add`](generate/icons-add.js).** `npm run icons:add -- <material_name> [--as <jellyrock_name>]` fetches the Material Symbols SVG in the house style (Rounded, weight 500, 24px, outlined by default; `--filled` for the filled variant), adds a white fill so `blendColor` tinting works at render time, and appends a provenance row. Don't browse `icons.google.com` by hand for the standard icon family: the script encodes the convention, so the variant, weight and fill can't drift. A custom SVG that isn't Material (a brand mark) can still go straight into `resources/icons/`; record why in the [density notes](../resources/icons/README.md#density-notes) of the icons README.
- [build-and-tooling.md, "Icon resolution pipeline"](../docs/architecture/build-and-tooling.md#icon-resolution-pipeline) has the whole pipeline, and [`resources/icons/README.md`](../resources/icons/README.md) the contributor workflow and the glyph-density rules per icon.

## `scripts/data/`: committed generated datasets

Data derived from an upstream source, normalized and committed, so nothing has to fetch (or copy by hand) it at runtime. **Never hand-edit a file here:** each one carries a `_checksum` over its own data, and a `:check` script fails on tampering.

| File | Generator | Upstream | Consumer |
|---|---|---|---|
| [`roku-hardware.json`](data/roku-hardware.json) | [`generate/roku-hardware.js`](generate/roku-hardware.js) | `rokudev/dev-doc` `docs/SPECIFICATIONS/hardware.md` | [`roku-devices.js`](roku-devices.js) |

Each dataset has three parts, and a new one copies the shape:

1. **`<name>:fetch`** pulls upstream and derives the data again. It needs the network, and runs by hand or from a scheduled workflow. **It refuses anything it doesn't recognize** rather than writing a null: a cell it can't parse must fail the sync, not degrade the data silently.
2. **`<name>:check`** validates the invariants and the checksum offline. It is part of `npm run lint`, pre-push, and a CI workflow whose path filter already matches the files it reads (`npm run lint:ci-parity` fails if you skip the CI half).
3. **A scheduled sync workflow** (`roku-hardware-sync.yml`) opens a PR **only when the derived data changes**, never when upstream only edits prose. That gate is what keeps the automation useful rather than noisy.

Why generate it rather than type it: a hand-typed table can be correct entry by entry and still wrong as a whole. The Roku table keyed on four digits, so every letter-prefixed Roku TV and projector family resolved to `null`, and it could not notice a newly supported device.

## Linting and formatting

- **ESLint** (flat config, `eslint.config.js`) covers `.js`, `.cjs` and `.mjs` across the repo. Run it with `npm run lint:js`.
- **Prettier** (`.prettierrc.json`, `.prettierignore`) formats JS and a chosen set of JSON files. Run `npm run format:js` to write or `npm run check-formatting:js` to check. The unprefixed `format` and `check-formatting` cover both BrightScript and JS.
- **jshint** (`npm run lint:json`) catches duplicate keys and checks JSON syntax on a wider set.
- Pre-commit (`lint-staged`) fixes what it can in the staged files; pre-push runs the project-wide checks. **CI does not mirror pre-push and does not run `npm run lint`:** it is built from the per-domain workflows `.github/workflows/_lint-*.yml`, each with its own path filter. So a new check needs wiring in both places. `npm run lint:ci-parity` ([`scripts/lint/ci-parity-check.js`](lint/ci-parity-check.js)) fails when a member of the `lint` aggregate has no CI home, so this can't drift silently, but it can't tell you which workflow is the right home. Pick the one whose path filter already matches what your check reads.

## Tests

`tests/scripts/unit/<name>.test.js` mirrors `tests/source/unit/`. Run it with `npm run test:scripts` (CI) or `npm run test:scripts:tdd` (watch mode).

BSC plugin tests use **inline scenarios**: template literals holding short made-up `.bs` and `.xml` snippets, passed to one of three harnesses in `tests/scripts/unit/_helpers/`:

- `run-plugin.js` for plugins that emit diagnostics. It exports `runPluginOnSource` (one validation) and **`runPluginOnEdits`** (a sequence of edits against one program, returning the diagnostics after each). A plugin whose verdict depends on more than one file needs the second: a stale-diagnostic bug shows only across validations, so a single-validation test passes over it.
- `transpile-with-plugin.js` for plugins that change the transpiled output (`roku-log`).
- `run-plugin-with-temp-locale.js` for plugins that inject a virtual file (`translation-keys`).

Keep each scenario's body short, around 50 lines at most.

If a plugin grows fixtures that don't fit inline, the next step is `.bs` fixture files beside the tests. Nothing has needed that yet, so the layout isn't standardized; don't build it ahead of need.

## Shebangs on top-level CLI scripts

ESLint's `n/hashbang` rule enforces the shebang policy:

- A script listed in `package.json`'s `"bin"` must have `#!/usr/bin/env node`.
- A script not in `"bin"` must not have a shebang.

Nothing in `scripts/` is in `"bin"`: npm scripts call everything with `node scripts/...`, so nothing has a shebang. If a script ever needs direct invocation (`./scripts/foo.js`), add it to `"bin"`; don't restore the shebang by hand and disable the lint.

## Don't run these by hand

- `npm run lint:js` and `check-formatting:js`: pre-push runs them.
- `npm run test:scripts`: pre-push (when the push range has JS) and CI run it. **This is the exception to the root `AGENTS.md` note on test scripts**, which is about the hardware suites (`test:tdd`, `test:unit`, `test:integration`) that no hook runs.
- The exception: debugging a specific failure.
