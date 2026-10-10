---
topic: testing
related-files:
  - tests/source/BaseTestSuite.spec.bs
  - scripts/run-roku-tests.js
  - scripts/device-lock.js
  - bsconfig-tests.json
  - bsconfig-tests-unit.json
  - bsconfig-tests-integration.json
last-reviewed: 2026-10-10
---

# Testing

How JellyRock's tests are organized and run: the Rooibos suites on a Roku, the `BaseTestSuite` they all extend, and what the runner does around a run. To write a test, see [`unit-tests.md`](../dev/unit-tests.md); to work test-first on one spec, [`unit-tests-tdd.md`](../dev/unit-tests-tdd.md). Logging is in [`logging.md`](logging.md), debug tooling in [`debug-tools.md`](debug-tools.md).

## Three test suites, two frameworks

- **Rooibos** ([rooibos](https://github.com/rokucommunity/rooibos)) runs the BrighterScript unit and integration tests under `tests/source/`, on a real Roku. Tests use `@suite`, `@describe` and `@it` annotations.
- **Vitest** runs two Node suites that are never compiled into the app:
  - `tests/scripts/`: tests for the build and lint tooling (see [`scripts-development.md`](../dev/scripts-development.md)).
  - `tests/rta/`: the RTA functional tests (`roku-test-automation`), which drive a real Roku from outside over ECP and ODC and check that each screen loads. The same screen list drives the store screenshots. See [`rta-tests.md`](../dev/rta-tests.md).

The rest of this page is about the Rooibos suites.

### Folder layout

```text
tests/source/
├── BaseTestSuite.spec.bs    ← the base class every suite extends
├── unit/                    ← isolated tests, no I/O
├── integration/             ← components together, real I/O allowed
│   ├── registry/            ← the real Roku registry, in "test-" sections
│   └── migration/           ← each registry migration end to end
├── mocks/                   ← mock data (API responses, registry sections, users, devices)
└── shared/                  ← shared test helpers
```

### `BaseTestSuite`

Every suite extends `tests.BaseTestSuite` (`tests/source/BaseTestSuite.spec.bs`), which extends `rooibos.BaseTestSuite`. Rooibos runs `setup()` and `teardown()` once per `@describe` group, and `beforeEach()` and `afterEach()` once per test. The base class uses them like this:

- **Global state, per group.** `setup()` takes the global node from the test scene and fills in the app, device, server and user nodes from mock data, then loads the `en_US` translations. Re-applying the mock data for each group is what keeps groups apart. `setGlobals()` itself runs once per session: it writes through `m.global.addFields`, which leaves existing fields alone, so running it again would only build nodes to throw away.
- **The device, per test.** `resetDevice()` puts `m.global.device` back to the fields `setGlobals()` gave it, in `setup()` and again in `beforeEach()`. A test's `loadTestDevice()` call or direct write never reaches the next test, so a device fixture goes in `beforeEach()`, not `setup()`.
- **The registry, per test, when a suite asks.** A suite that sets `m.needsRegistrySetup = true` gets every `test-` section cleared after each test and after the suite.
- **The logger.** When the test scene has no `rLog`, `setup()` creates one at the verbose level.

Test registry sections start with `test-`, and the migration runner touches only `test-` sections when any exist ([`migrations.md`](migrations.md#sections-the-user-runner-skips)). That is what keeps a test run on a personal Roku away from real user data.

## Running the suites

Each `test:` script builds one test app with `bsc`, then runs it through `scripts/run-roku-tests.js`:

| Command | bsconfig | What it runs |
|---|---|---|
| `npm run test:tdd` | `bsconfig-tdd.json` | The specs you pick, for test-first work. Copy `bsconfig-tdd-sample.json` (the copy is gitignored) and edit its `files`. |
| `npm run test:unit` | `bsconfig-tests-unit.json` | Unit tests, except `measurement` |
| `npm run test:integration` | `bsconfig-tests-integration.json` | Integration tests, except `migration` and `registry` |
| `npm run test:all` | `bsconfig-tests.json` | Everything except `migration`, `registry` and `measurement`. CI's gating run uses this. |
| `npm run test:complete` | `bsconfig-tests-complete.json` | Everything, with code coverage recorded |

Each has a `build:` twin that only builds (`build:tdd`, `build:tests-unit`, `build:tests-integration`, `build:tests`, `build:tests-complete`). None of them watches for changes.

**Only `test:complete` records code coverage.** Coverage slows every line it runs, and runs the code with different timing from the shipped app. Measured 2026-09-13 on a Streaming Stick 4K: `test:all` took 602 s with coverage and 68 s without. Recording coverage outside the PR gate is tracked in #541.

### What the runner does

`run-roku-tests.js` claims the device, sideloads the test app, reads the Rooibos output from the debug console and exits with the result.

**A PASS whose summary does not add up fails the run.** Every test Rooibos counts in `Total` must land in exactly one of `Passed`, `Crashed`, `Failed` or `Ignored`. The runner reads the summary ([`scripts/lib/rooibos-summary.cjs`](../../scripts/lib/rooibos-summary.cjs)) and exits 1 when a counted test was never reported. Upstream Rooibos leaves a test that is `@ignore`d on its own out of `Ignored` (an ignored group or suite is counted), so such a test showed up nowhere behind a green run. A patch in `patches/` makes the console report print the real count, sent upstream as [rokucommunity/rooibos#435](https://github.com/rokucommunity/rooibos/pull/435), which also brings back the `IGNORED TESTS:` list. The gate is what notices if a counted test ever goes unreported again.

**The device is claimed before the sideload.** The runner holds a lock on the device ([`scripts/device-lock.js`](../../scripts/device-lock.js)) until the run ends. Rooibos runs need it more than RTA does: they have no registry snapshot to restore, so an overlapping run just corrupts the other one, and the sideload alone restarts whatever the other run was driving. The lock prevents clashes between local runs: a second terminal running `test:rta`, `demo` or `screenshots:capture` against the same Roku. CI drives its own Roku, so it cannot clash with a local run unless someone points `ROKU_IP` at CI's device, which the lock also covers because it keys on the device's identity. A run that finds the lock taken stops at once and names the holder. How the lock works, and why it lives on a git ref and not on the device: [`rta-tests.md`](../dev/rta-tests.md#the-device-lock).

**Each run leaves a record.** The runner opens a run through [`scripts/run-record.js`](../../scripts/run-record.js), which writes `out/device/` for this run (who held the lock, and the start and end times) and appends one line to `.device-runs/device/runs.jsonl`, a ledger that is never reset. RTA uses the same record. The Rooibos runner needs it too because of [#800](https://github.com/jellyrock/jellyrock/issues/800): a Rooibos test that used the shared demo server went red when a run crossed the top of the hour, and the server reset under it. The record's time window shows that. The folder is `out/device/`, not `out/rta/`, so the Rooibos runner never pulls in the RTA client. Details: [`rta-tests.md`](../dev/rta-tests.md#one-record-directory-per-run-kind).

Each ledger line carries an `outcome`: `passed`, `failed`, `interrupted`, `blocked` or `crashed`, where `crashed` is the default when nothing closed the run. Only `passed` and `failed` reached a verdict and count as evidence about the app. The others never did, so a flake rate leaves them out entirely; `npm run flake-baseline` applies that split ([`rta-tests.md`](../dev/rta-tests.md#reading-a-baseline-out-of-it)).

### Agents run the suites too

The `test:` scripts need no IDE, so an agent runs them the same way a person does. The runner reads `ROKU_IP` and `ROKU_PASSWORD` from the checkout's gitignored `.env`, then from the per-user `~/.config/jellyrock/env` ([`env-config.cjs`](../../scripts/lib/env-config.cjs)). The TDD guide covers the fallback to VS Code's `brightscript.debug.*` settings.

`ROKU_PASSWORD` is one device's developer password, so changing `ROKU_IP` alone does not reach a different Roku. CI's device password exists only as a CI secret. With the wrong password, the sideload fails with a `401 Unauthorized`, after the lock is taken.

Before saying no device is available, run `npm run device:check`. When the runner cannot reach the device it exits with an error, and that is what to report: a fix is never called tested when only the build passed. A VS Code BrightScript debugger attached to the device makes the sideload fail; say so instead of retrying. The rules are in [`tests/CLAUDE.md`](../../tests/CLAUDE.md).

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md): `rooibos-setup-not-per-test`, the suites that still build mutated state in `setup()`.
