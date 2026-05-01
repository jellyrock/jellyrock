---
topic: build-and-tooling
related-files:
  - bsconfig.json
  - bsconfig-prod.json
  - package.json
  - Makefile
  - scripts/bsc-plugin-roku-log.cjs
  - scripts/bsc-plugin-translation-keys.cjs
last-reviewed: 2026-04-26
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

There are seven `bsconfig*.json` files, one per build target:

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

Generates a virtual `pkg:/source/translationKeys.bs` file containing a `translationKeys` namespace with one constant per key in `locale/custom/en_US.json`. Documented in detail in `07-translations.md`.

The plugin uses `fs.watch` to detect en_US.json changes in language-server mode (so the IDE always sees up-to-date constants without re-running the build).

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

Lint and format:

| Script | What it does |
|---|---|
| `npm run lint` | Runs everything below in sequence |
| `npm run lint:bs` | bslint on BrighterScript code |
| `npm run lint:json` | jshint on JSON files (excluding node_modules, scripts, tasks, build, out, locale) |
| `npm run lint:markdown` | markdownlint on all `.md` (with exclusions for AI agent docs) |
| `npm run lint:spelling` | spellchecker on Markdown files |
| `npm run lint:translations` | Custom translation lint (sort order, completeness, placeholder parity) |
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

`ropm` is the Roku-specific package manager that vendors libraries into your project (no runtime resolution — everything is copied into the build). Three packages are installed:

- **`log`** — the `roku-log` library (npm package: `roku-log@0.11.1`). Vendored into `source/roku_modules/log/` and `components/roku_modules/log/`.
- **`rr`** — `roku-requests@1.2.0`. HTTP client used by `ApiTask` (vendored into `source/roku_modules/rr/`).
- **`rokucommunity_bslib`** — `@rokucommunity/bslib@0.1.1`. Standard library extensions (commonly-needed BrightScript utilities).

Module names (`log`, `rr`) are configured in `package.json`'s `dependencies` block as npm package aliases:

```json
"dependencies": {
  "log": "npm:roku-log@0.11.1",
  "rr": "npm:roku-requests@1.2.0",
  "@rokucommunity/bslib": "0.1.1"
}
```

The aliasing keeps imports short — `import "pkg:/source/roku_modules/log/LogMixin.brs"` rather than the full upstream package path.

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

## IDE integration

JellyRock expects developers to use VS Code with the BrighterScript extension. With the extension installed:

- **Real-time validation** runs continuously — no need to manually `npm run lint` or `npm run validate`
- **Diagnostics in the Problems panel** match what `bsc --noEmit` would report
- **Auto-completion** works for `m.global.user.settings.<field>` (typed by the `JellyfinUserSettings` ContentNode) and for `translationKeys.<key>` (generated by the BSC plugin)
- **Format on save** can be configured to run `bsfmt`
- **The translation key plugin's fs.watch** ensures key constants are regenerated when `en_US.json` is edited, even though BSC's normal `Program.setFile` doesn't trigger on JSON

This means: **agents and humans should NOT run `npm run lint` or `npm run build` as part of normal editing**. The IDE catches problems live. CI runs the full lint + validate suite on every push.

## Agent restrictions (from `CLAUDE.md`)

- **Cannot run tests** — test execution requires a real Roku device, manual setup
- **Cannot modify `CHANGELOG.md`** — CI-controlled only
- **Cannot execute build/deploy** — IDE handles compilation; deploy requires device credentials

## Cruft callouts

- **Seven bsconfig files.** Each is mostly a copy with a few overrides. A common base + overlays would be cleaner, but BSC's config schema doesn't currently support inheritance.
- **`bsconfig-tdd.json` is gitignored** — devs maintain their own copy of `bsconfig-tdd-sample.json`. This is fine but means new contributors have to figure out to copy the sample first.
- **No CI-enforced version bumping.** `package.json` version (`2.12.0`) and the manifest version are maintained by hand. A pre-release script that asserts they match would be helpful.
- **`make` targets and npm scripts overlap.** Some devs prefer `make`, others `npm`. Both routes are maintained in parallel; documenting one as canonical would simplify onboarding.
- **The branding image generation (`make make_images`)** depends on ImageMagick being installed locally. Not all CI environments have it; the targets exist but aren't part of the regular build.
- **`scripts/changelog-syncer.js` does both validation and mutation.** A failing validate run could be fixed by a sync run, which then changes things. A clearer separation between read-only validate and write-only sync would reduce confusion.
