---
topic: testing
related-files:
  - tests/source/BaseTestSuite.spec.bs
  - scripts/run-roku-tests.js
  - scripts/device-lock.js
  - bsconfig-tests.json
  - bsconfig-tests-unit.json
  - bsconfig-tests-integration.json
last-reviewed: 2026-09-21
---

# Testing

The rooibos test framework, the `BaseTestSuite` base class, the test folder layout, and how tests run on real devices. Logging primitives live in `logging.md`. Debug-time tooling lives in `debug-tools.md`.

## Tests — rooibos

JellyRock uses [rooibos](https://github.com/rokucommunity/rooibos), a unit testing framework for BrighterScript with `@suite`, `@describe`, `@it` decorators (mocha-inspired). Tests run on actual Roku hardware (or a simulator).

### Folder structure

```text
tests/source/
├── BaseTestSuite.spec.bs    ← base class for every test suite (extends rooibos.BaseTestSuite)
├── unit/                    ← isolated unit tests (no I/O)
│   ├── components/
│   ├── data/
│   ├── api/
│   ├── userSettings/
│   ├── utils/
│   └── ...
├── integration/             ← component interactions, real I/O allowed
│   ├── registry/            ← exercises the actual Roku registry (under "test-*" sections)
│   └── migration/           ← exercises each migration end-to-end
├── mocks/                   ← mock data and stubs (api responses, registry sections, users, devices)
└── shared/                  ← shared test helpers
```

Two **Node/Vitest** test trees sit alongside `tests/source/` (different framework
and runtime — not Rooibos, not compiled into the app):

- `tests/scripts/` — unit tests for the Node-side build/lint tooling (see [scripts-development.md](../dev/scripts-development.md)).
- `tests/rta/` — **RTA functional tests** (`roku-test-automation`): drive a real device from outside (ECP + ODC) and assert each screen loads; the same screen registry backs the store-screenshot generator. See [rta-tests.md](../dev/rta-tests.md).

### Test pattern

```brightscript
namespace tests

  @suite("My First Test")
  class MyFirstTest extends tests.BaseTestSuite

    @it("validates a simple function")
    function _()
      result = isValid("hello")
      m.assertTrue(result)
    end function

  end class
end namespace
```

`tests.BaseTestSuite` (in `tests/source/BaseTestSuite.spec.bs`) extends `rooibos.BaseTestSuite` and provides:

- **`m.global` initialization** — pulls a real global node from the test scene, populates app/device/server/user content nodes, loads en_US translations. Rooibos runs `setup()` once per **`@describe` group**, not once per suite, so this is per-test-group work: the server/user mock data and en_US translations are re-applied for every group (that re-application is what isolates groups from each other), while `setGlobals()` runs only once per test session — its `m.global.addFields` writes leave existing fields untouched, so repeating it only built nodes to discard
- **Registry teardown** — between tests, clears `test-*` sections so each test starts fresh (only if `m.needsRegistrySetup = true`)
- **Test mode flag** — sections start with `test-` so production migration code skips real user data

### Running tests

```bash
npm run build:tests-unit          # build unit test app
npm run build:tests-integration   # build integration test app
npm run build:tests               # build everything

npm run test:unit                 # build + run on configured device (uses ROKU_DEV_TARGET env var)
npm run test:integration
npm run test:all                  # what CI's gating run uses — no code coverage recorded
npm run test:complete             # adds the migration/registry tags and records code coverage (much slower)

npm run test:tdd                  # build + run TDD config (single-suite iteration; uses bsconfig-tdd.json)
npm run build:tdd                 # watch mode build only (no run)
```

**Code coverage is not recorded in the gating build.** Instrumentation multiplies the cost of every executed line — `test:all` on a Streaming Stick 4K took 602 s with coverage and 68 s without — and runs the code under test with different timing than the shipped app. Coverage comes from `test:complete` (or the workflow's `complete` dispatch type); reporting it on `main` and on demand is tracked in #541.

The TDD workflow expects you to copy `bsconfig-tdd-sample.json` to `bsconfig-tdd.json` (gitignored) and edit it to scope which suites/tests get built.

The actual test execution is via `scripts/run-roku-tests.js` which deploys the test channel, captures rooibos output over telnet, and exits with the result.

**A PASS whose summary does not add up fails the run.** Every test Rooibos counts in `Total` must land in exactly one of `Passed` / `Crashed` / `Failed` / `Ignored`; the runner reads the summary ([`scripts/lib/rooibos-summary.cjs`](../../scripts/lib/rooibos-summary.cjs)) and exits 1 when a counted test was never reported. Upstream Rooibos leaves a test `@ignore`d on its own out of `Ignored` (an ignored group or suite is counted), so such a test appeared in no line at all behind a green run. `patches/rooibos-roku+*.patch` makes the console reporter print the runtime count — upstream as [rokucommunity/rooibos#435](https://github.com/rokucommunity/rooibos/pull/435) — which also restores the `IGNORED TESTS:` list; the gate is what notices if a counted test ever goes unreported again.

**The device is claimed before the sideload**, and `run-roku-tests.js` holds that
claim ([`scripts/device-lock.js`](../../scripts/device-lock.js)) until the run
ends. This matters more here than for RTA: the Rooibos path has
no registry snapshot to fall back on, so an overlapping run is pure corruption —
the deploy alone restarts whatever the other party was driving.

The contention it prevents is **local-vs-local** — a second terminal running
`test:rta`, `demo` or `screenshots:capture` against the same Roku. It is *not*
protection against CI: CI drives its own device (`.200`), so the two cannot
collide unless someone points `ROKU_IP` at CI's box, which the lock does cover
because it keys on device identity. A contended run refuses immediately and names
the holder. Full protocol — and why the lock lives on a git ref rather than on
the device — in [`rta-tests.md`](../dev/rta-tests.md#the-device-lock).

**Each Rooibos run also leaves a record.** `run-roku-tests.js` opens a run via
[`scripts/run-record.js`](../../scripts/run-record.js), which writes `out/device/`
(this run: lock provenance plus the wall-clock window) and appends one line per run
to `.device-runs/device/runs.jsonl` (the ledger, never reset). It is the same record
the RTA harness uses, deliberately: [#800](https://github.com/jellyrock/jellyrock/issues/800)
went red on a *Rooibos* test hitting the shared demo server, so this path needs the
run window too — a suite that straddled the top of the hour ran against a fixture
that reset underneath it, and the summary says so. The directory is `out/device/`, not
`out/rta/`; the record module knows nothing about devices, so nothing drags the RTA
client into a runner that drives the device over telnet. Shape and lifecycle in
[`rta-tests.md`](../dev/rta-tests.md#one-record-directory-per-run-kind).

Each line also carries an `outcome` — `passed` / `failed` / `interrupted` / `crashed`
— set from the runner's own exit and defaulted to `crashed` by the process-exit net.
The failure records say what a run *diagnosed*, which is not the same question as
whether it ran at all. The four are not four peers, either: `passed` and `failed`
reached a verdict and are evidence, while `crashed` and `interrupted` never did and
leave the population entirely. `npm run flake-baseline` is the reader that applies
that partition — see
[`rta-tests.md`](../dev/rta-tests.md#reading-a-baseline-out-of-it).

### How agents run tests

Tests deploy to a real Roku device, but the npm scripts are CLI-driven so an automated agent can run them just like a human. The runner reads `ROKU_IP` / `ROKU_PASSWORD` from the checkout's gitignored `.env` or the per-user `~/.config/jellyrock/env` ([`env-config.cjs`](../../scripts/lib/env-config.cjs); a fallback to `VSCode`'s `brightscript.debug.*` settings is documented in the TDD guide). Note `ROKU_PASSWORD` is that one device's **dev server** password, so overriding `ROKU_IP` alone is not enough to drive a different Roku — pointing a local run at CI's `.200` also needs `.200`'s password, which lives only in CI as an org secret. The deploy fails with a `401 Unauthorized` from `roku-deploy`, after the lock is taken. If hardware isn't reachable, the runner exits with an error — agents are expected to surface this honestly rather than claim a fix was tested when only the build was verified. Debugger contention (a VSCode BrightScript debugger holding the port) is a real failure mode and shouldn't be retried blindly. See [`tests/CLAUDE.md`](../../tests/CLAUDE.md) for the rules and `docs/dev/unit-tests-tdd.md` for the full procedure.

### Documentation

- `docs/dev/unit-tests.md` — comprehensive guide
- `docs/dev/unit-tests-tdd.md` — TDD workflow with watch mode

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for testing entries.
