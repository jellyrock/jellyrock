---
topic: unit-tests-tdd
related-files:
  - bsconfig-tdd-sample.json
  - scripts/run-roku-tests.js
  - scripts/lib/env-config.cjs
  - tests/source/BaseTestSuite.spec.bs
last-reviewed: 2026-10-09
---

# Test-driven development (TDD)

TDD mode builds and runs only the test files you are working on, so each run is much faster than the full suite. Read [unit testing basics](unit-tests.md) first.

## Why use TDD mode

- **Faster runs:** only your test files are built, not the whole suite.
- **Focus:** the results show only the tests you are working on.
- **No `@ignore` clutter:** you choose tests by file, so nothing in the test code changes.

## Setup

### 1. Create your TDD config

```bash
cp bsconfig-tdd-sample.json bsconfig-tdd.json
```

`bsconfig-tdd.json` is gitignored: it is your own config.

The sample `extends` `bsconfig-tests.json`, which supplies the plugins, the compiler options and every diagnostic filter. Your copy only needs `files` and `rooibos`, and should keep it that way: a `plugins` or `diagnosticFilters` array in your copy replaces the inherited list instead of adding to it, and a copied plugin list goes stale when a plugin changes. Keep `"!**/*.map"` as the last `files` entry too. It stops the build copying prebuilt source maps over the ones BrighterScript generates.

If your copy is older than this (it lists its own `plugins`, has top-level `sourceMap` or `autoImportComponentScript` keys, or the build warns `deprecated-bsconfig-option`), copy the sample again and add your spec entries back.

### 2. List your test files

The sample excludes every spec file, then adds back `BaseTestSuite.spec.bs` and one example. Replace the example with your own files:

```json
{
  "files": [
    // ... the sample's other entries ...
    "!**/*.spec.bs",
    { "src": "**/BaseTestSuite.spec.bs", "dest": "source" },
    { "src": "**/YourTestFile.spec.bs", "dest": "source" },
    "!**/*.map"
  ]
}
```

Always keep `BaseTestSuite.spec.bs`. To work on several related files, add one entry for each.

### 3. Run the tests

From Visual Studio Code, choose **Run TDD tests** in the **Run and Debug** panel and press `F5`. From a terminal, run:

```bash
npm run test:tdd
```

Either one builds with `bsconfig-tdd.json`, installs the build on your Roku and runs the tests once. After you change code, run it again.

## Rooibos settings

The sample's `rooibos` block is set up for quick runs:

```json
{
  "rooibos": {
    "isRecordingCodeCoverage": false,
    "showOnlyFailures": true,
    "failFast": false,
    "catchCrashes": true
  }
}
```

Change these to suit your work:

- `"failFast": true` stops at the first failure.
- `"showOnlyFailures": false` lists passing tests too.
- `"isRecordingCodeCoverage": true` records coverage, which makes the build slower.

## A TDD session

Say you are adding a `getDisplaySetting()` function:

1. Create the test file, `tests/source/unit/utils/DisplaySettings.spec.bs`.
2. Add it to `bsconfig-tdd.json`: `{ "src": "**/DisplaySettings.spec.bs", "dest": "source" }`.
3. Write a test that fails.
4. Run the TDD tests and watch it fail.
5. Write the function.
6. Run the TDD tests again until they pass, then clean up the code.
7. Before you commit, run the full suite (`npm run test:unit`) to catch regressions.

## Choosing which tests run

### Choose by file

For day-to-day work, list the files in `bsconfig-tdd.json`. It is faster than annotations and leaves the test code alone.

### `@only` for a quick debug

To run one test, or one group, inside your TDD files, mark it `@only`. It works on `@suite`, `@describe` and `@it`.

```brighterscript
@only
@it("debug this test")
function _()
end function
```

**Remove every `@only` before you commit.** A committed `@only` makes the full suite skip every other test.

### `@ignore` only for tests that stay off

Don't use `@ignore` to skip tests while you work; choose files instead. Use it only for a test that stays disabled, with a comment that says why and links the issue:

```brighterscript
@ignore  ' Endpoint removed upstream; see #123
@it("calls legacy endpoint")
function _()
end function
```

## Troubleshooting

### Tests don't run

- Check that `bsconfig-tdd.json` exists. The sample isn't used.
- Check that `files` includes your test file and `BaseTestSuite.spec.bs`.

### Builds are slow

- Check that `isRecordingCodeCoverage` is `false`.
- Check that `files` lists only the test files you need.
- Turn source maps off with `"compilerOptions": { "sourceMap": false }`. A top-level `"sourceMap": false` is ignored, because `compilerOptions.sourceMap` in `bsconfig-base.json` wins.

## Commands

```bash
cp bsconfig-tdd-sample.json bsconfig-tdd.json   # once
npm run test:tdd                 # build bsconfig-tdd.json and run it on the Roku
npm run build:tdd                # build bsconfig-tdd.json only
npm run build:tests-unit         # build all unit tests
npm run build:tests-integration  # build all integration tests
npm run build:tests              # build all tests
```

## Running tests from a terminal or an agent

These notes are for running tests outside Visual Studio Code, for example from an agent's session.

### The commands

- One spec file: `npm run test:tdd`. It builds with `bsconfig-tdd.json` and runs on the Roku at `ROKU_IP`.
- Wider runs: `npm run test:unit`, `npm run test:integration`, `npm run test:all`.
- The runner, [`scripts/run-roku-tests.js`](../../scripts/run-roku-tests.js), zips the build, installs it on the Roku and reads the Roku's debug console until it sees `[Rooibos Result]: PASS` or `FAIL`. It saves the full log to `roku-test-output.log`.

### Roku settings: `.env` and your per-user file

Every tool reads its device settings (`ROKU_IP`, `ROKU_PASSWORD`, `ROKU_DEVICES` and others) from the environment. Two files that never enter the repository fill it. In order, the first one that sets a value wins:

1. **Variables already set** in your shell, or by a parent process. These are never overwritten.
2. **The checkout's `.env`**, at the repository root. Use it to override one checkout, such as a folder pointed at a different Roku.
3. **Your per-user file**, `~/.config/jellyrock/env` (or `$XDG_CONFIG_HOME/jellyrock/env`). Put your defaults here once, and every checkout uses them.

Both files use the format of `.env.example`. **An empty value in a file counts as unset**, so a `.env` copied from `.env.example` with blank keys doesn't hide your per-user file. The exceptions are `MEASURE_SIGNIN_PASSWORD`, `RTA_SERVER_PASS` and `JELLYFIN_VERSION_SERVERS_PASS`, where blank means an account with no password; `.env.example` ships those commented out.

**The per-user file is skipped under GitHub Actions**, so CI is set up only by its workflow. It is also skipped when `JELLYROCK_USER_ENV=off` is set, as the scripts' unit tests do.

To stop using a device for a while, comment out the full `ROKU_DEVICES` line and add a shorter one below it. `npm run device:check` prints which file its device list came from. The rules live in [`scripts/lib/env-config.cjs`](../../scripts/lib/env-config.cjs).

If neither file exists, read the values from the user's Visual Studio Code settings:

```bash
grep -E '"brightscript\.debug\.(host|password)"' ~/.config/Code/User/settings.json
```

Then write them as `ROKU_IP=...` and `ROKU_PASSWORD=...` to the per-user file (and `chmod 600` it), or to `.env` for this checkout only.

### A debugger already attached

If a Visual Studio Code BrightScript debugger is attached to the test Roku, the install can fail, and it can end that debugger session. Tell the user rather than retrying.

### When the Roku doesn't answer

**Check before you conclude there is no hardware: run `npm run device:check`.** It probes every configured Roku over ECP and reports which answered. A Roku that answers is one you can test on, so run the tests.

If the probe fails (no device configured, none on the network, a debugger holding the port), say that the probe failed, not that you lack access. Never call a fix tested when only the build (`npm run build:tdd`) was checked.

An answer over ECP doesn't promise the install will work. Developer mode turned off, or a `ROKU_PASSWORD` that belongs to another Roku, still fails at install. That is a different report, and one you can also check.

## Related docs

- [Unit tests](unit-tests.md): testing concepts and the Rooibos framework.
- [Logging](logging.md): using roku-log to debug at runtime.
- [Dev guide](DEVGUIDE.md): setting up and installing the app.
