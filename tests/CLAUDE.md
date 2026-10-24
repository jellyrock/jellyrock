# Rules for `tests/`

The Rooibos test framework, with `@suite`, `@describe` and `@it` annotations. See [docs/architecture/testing.md](../docs/architecture/testing.md) for the test layout and how the `BaseTestSuite` base class works.

## Folder layout

- `tests/source/unit/`: isolated unit tests, no I/O.
- `tests/source/integration/`: component interactions, real I/O allowed, with subfolders `registry/` and `migration/`.
- `tests/source/mocks/`: mock data and stubs.
- `tests/source/shared/`: shared test helpers.
- `tests/components/`: test-only components, which the test builds map to `components/tests`. Use one when a suite must run inside a component scope (`@SGNode`) and the real component has side effects in `init()`: `WebSocketClientHarness` loads the vendored socket client's scripts without the Task that starts a socket loop.
- `tests/scripts/unit/`: **Vitest** unit tests for the Node build and lint tooling under [`scripts/`](../scripts/). A different framework (Vitest, not Rooibos) and runtime (Node, not Roku), so the rules below don't apply; see [`docs/dev/scripts-development.md`](../docs/dev/scripts-development.md).
- `tests/rta/`: **RTA functional tests** (roku-test-automation). Node ESM under Vitest that drives a real device from outside (ECP and ODC) and checks each screen loads. Not Rooibos, so the rules below don't apply: it has its own [`tests/rta/CLAUDE.md`](rta/CLAUDE.md), and the how-to is [`docs/dev/rta-tests.md`](../docs/dev/rta-tests.md).

## Test pattern

Every suite extends `tests.BaseTestSuite`, which extends `rooibos.BaseTestSuite`. The base provides:

- `m.global` set up with real content nodes and the `en_US` translations.
- Registry cleanup between tests, for a suite that opts in with `m.needsRegistrySetup = true`.
- The test-mode marker: test registry sections start with `test-`, so the migration runner never touches real user data.

The one exception: a suite that runs inside a component scope (`@SGNode`) extends `rooibos.BaseTestSuite`, because that scope cannot see `tests.BaseTestSuite`. Such a suite tests code that needs none of the `m.global` setup (`WebSocketClient.spec.bs`).

### One `@suite` per file

**Put exactly one `@suite` class in a `.spec.bs` file.** Breaking this breaks the runner, not only the tidiness. A file with two or more suites builds and validates cleanly, then crashes the Rooibos runner on the device (`&hec` in `TestRunner.brs`), because the generated `.brs` gives only the last class a `getTestSuiteData()`; Rooibos prints `ERROR RETRIEVING TEST SUITE DATA` right before (observed 2026-09-22 on a Roku Ultra). The crash leaves the Roku hung until an ECP `Home` key press.

To split a growing suite, keep the base name and add the aspect (`remoteSubtitles.spec.bs`, `remoteSubtitlesStreams.spec.bs`, `remoteSubtitlesResults.spec.bs`), as the existing `misc.spec.bs` and `miscAudioStreams.spec.bs` pair does.

> A green `npm run validate` says nothing about this: the crash is a runtime fault in the generated runner, so only hardware shows it.

## Lifecycle hooks: `setup()` runs per `@describe` group, `beforeEach()` per test

Rooibos gives `BaseTestSuite` four hooks, and the two pairs run at different frequencies (read from `TestGroup.runSync` in `rooibos-roku` 6.0.0-alpha.56, 2026-10-11):

| Hook | Runs |
|---|---|
| `setup()` and `teardown()` | **Once per `@describe` group:** every test in a group shares one `setup()` |
| `beforeEach()` and `afterEach()` | **Once per test** |

- **Build anything a test changes in `beforeEach()`, never in `setup()`.** A node created in `setup()` is shared by every test in its `@describe` group, so each test inherits what the last one left behind. Chain `super.beforeEach()` and `super.afterEach()`: the project's base class overrides all four hooks.
- `setup()` is still right for fixtures nothing changes (read-only mock data, constants). The rule is about changed state, not about moving everything.
- **It has happened.** In #781 a `rotateDegrees = 270` set by one test leaked into the next test in the same `@describe` and made a correct component look broken. The worse direction is silent: a test that never sets a field it reads can pass on a neighbor's leftovers, and stays green until someone reorders or deletes that neighbor.
- **A cheap check:** reverse the order of a suite's tests and run it again. A suite that passes only in declaration order is not isolated.
- Older suites predate this rule: see [`rooibos-setup-not-per-test`](../docs/architecture/tech-debt.md#rooibos-setup-not-per-test) and epic [#786](https://github.com/jellyrock/jellyrock/issues/786). Fix one when you're already in it; don't copy its shape into a new spec.

## Registry isolation

- **Every test registry write uses a `test-` section name.** That isolates tests from real user data, even on a dev build installed on a personal device.
- A suite that touches the registry sets `m.needsRegistrySetup = true` before `super.setup()`, so the base class deletes every `test-` section after each test. Without it, sections leak into the next suite and fail it.
- How the migration runner treats `test-` sections is in [migrations.md](../docs/architecture/migrations.md#sections-the-user-runner-skips).

## Running tests

Agents can and should run tests to verify fixes: don't commit a change on reasoning alone.

| Command | What it runs |
|---|---|
| `npm run test:tdd` | Your TDD config, for iterating on one suite (copy `bsconfig-tdd-sample.json` to `bsconfig-tdd.json` and edit `files`) |
| `npm run test:unit` | Every unit test except the `measurement` tag |
| `npm run test:integration` | The integration tests except the `migration` and `registry` tags |
| `npm run test:all` | Every suite except the `migration`, `registry` and `measurement` tags, without code coverage; CI's gating run |
| `npm run test:complete` | Everything, those tags included, **with code coverage recorded**. Much slower: the only build that instruments the code |
| `npm run test:rta` | **RTA functional tests** (Vitest, driving a real device): build, install and check each screen loads. See [`docs/dev/rta-tests.md`](../docs/dev/rta-tests.md). |

**`@tags("measurement")`** marks a suite that records a platform rate rather than gating behavior: it is slow and can't fail on the number it prints (`TaskRelaunchBlockModes.spec.bs`). It runs only when asked for: `test:tdd` with the spec selected, or `test:complete`. Put the property the app depends on in a spec without the tag, so every run still gates it.

The Rooibos runner (`scripts/run-roku-tests.js`) zips the build, installs it on the Roku at `ROKU_IP` and reads the debug console for `[Rooibos Result]: PASS|FAIL`. It also fails a PASS whose summary doesn't add up (`Total` is not `Passed` + `Crashed` + `Failed` + `Ignored`): a test counted but never reported ran invisibly. The RTA tests run under Vitest instead (`vitest.rta.config.js`) and check in Node.

### Credentials

The runner reads `ROKU_IP` and `ROKU_PASSWORD` from the environment, filled from the checkout's gitignored `.env` and then the per-user `~/.config/jellyrock/env` (the checkout wins). [`unit-tests-tdd.md`](../docs/dev/unit-tests-tdd.md) has the precedence rules and the fallback to VS Code's `brightscript.debug.host` and `brightscript.debug.password`.

### When hardware isn't available

**First run `npm run device:check`.** It probes every device in `.env` over ECP and prints which answered. Claiming there is no device without running it is the failure it exists to stop: a device that answers is a device you can test on.

If the probe fails (no `.env`, no device on the network, a debugger holding the port), say so, and say *the probe failed*, not that you lack access. Never call a fix tested when only the build (`npm run build:tdd`) was checked. A green build is not a green test run.

### A debugger already attached

If a VS Code BrightScript debugger is attached to the test device, the install can fail, and it can end that debugger session. Tell the user rather than retrying.

[`docs/dev/unit-tests.md`](../docs/dev/unit-tests.md) and [`docs/dev/unit-tests-tdd.md`](../docs/dev/unit-tests-tdd.md) are the how-tos, with full troubleshooting.

## Other rules (reminders from the root)

- **Never modify `CHANGELOG.md`:** CI writes it.
- **Never trigger a production build or deploy:** the test scripts above install test builds only.

## What not to do

- Don't write to a registry section without a `test-` prefix from a test.
- Don't mock the registry for a migration test: use real `test-` sections, so the integration is exercised. A mocked test can pass while the real schema breaks.
- Don't skip `BaseTestSuite` for a "lightweight" test: the `m.global` setup matters for almost everything.
