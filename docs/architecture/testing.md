---
topic: testing
related-files:
  - tests/source/BaseTestSuite.spec.bs
  - scripts/run-roku-tests.js
  - bsconfig-tests.json
  - bsconfig-tests-unit.json
  - bsconfig-tests-integration.json
last-reviewed: 2026-05-01
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
├── e2e/                     ← UI automation (planned, RTA framework — sparsely populated today)
├── mocks/                   ← mock data and stubs (api responses, registry sections, users, devices)
└── shared/                  ← shared test helpers
```

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

- **`m.global` initialization** — pulls a real global node from the test scene, populates app/device/server/user content nodes, loads en_US translations
- **Registry teardown** — between tests, clears `test-*` sections so each test starts fresh (only if `m.needsRegistrySetup = true`)
- **Test mode flag** — sections start with `test-` so production migration code skips real user data

### Running tests

```bash
npm run build:tests-unit          # build unit test app
npm run build:tests-integration   # build integration test app
npm run build:tests               # build everything

npm run test:unit                 # build + run on configured device (uses ROKU_DEV_TARGET env var)
npm run test:integration
npm run test:all
npm run test:complete

npm run test:tdd                  # build + run TDD config (single-suite iteration; uses bsconfig-tdd.json)
npm run build:tdd                 # watch mode build only (no run)
```

The TDD workflow expects you to copy `bsconfig-tdd-sample.json` to `bsconfig-tdd.json` (gitignored) and edit it to scope which suites/tests get built.

The actual test execution is via `scripts/run-roku-tests.js` which deploys the test channel, captures rooibos output over telnet, and exits with the result.

### How agents run tests

Tests deploy to a real Roku device, but the npm scripts are CLI-driven so an automated agent can run them just like a human. The runner reads `ROKU_IP` / `ROKU_PASSWORD` from a gitignored `.env` (with a fallback to `VSCode`'s `brightscript.debug.*` settings). If hardware isn't reachable, the runner exits with an error — agents are expected to surface this honestly rather than claim a fix was tested when only the build was verified. Debugger contention (a VSCode BrightScript debugger holding the port) is a real failure mode and shouldn't be retried blindly. See [`tests/CLAUDE.md`](../../tests/CLAUDE.md) for the rules and `docs/dev/unit-tests-tdd.md` for the full procedure.

### Documentation

- `docs/dev/unit-tests.md` — comprehensive guide
- `docs/dev/unit-tests-tdd.md` — TDD workflow with watch mode

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for testing entries.
