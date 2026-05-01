# 09c — Testing

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

npm run build:tdd                 # watch mode for rapid iteration
```

The actual test execution is via `scripts/run-roku-tests.js` which deploys the test channel, captures rooibos output over telnet, and exits with the result.

### Constraints (from `CLAUDE.md`)

- **Agents cannot run tests** — manual execution required (deploys to a real device).
- **Agents cannot modify `CHANGELOG.md`** — CI-controlled.
- **Agents cannot trigger build/deploy** — IDE handles compilation.

### Documentation

- `docs/dev/unit-tests.md` — comprehensive guide
- `docs/dev/unit-tests-tdd.md` — TDD workflow with watch mode

## Cruft callouts

- **e2e folder is mostly empty.** The plan was for RTA-based UI automation but it hasn't materialized yet. Real coverage today is unit + integration.
- **`needsRegistrySetup` opt-in is per-suite.** Forgetting it in a suite that does touch the registry produces flaky tests where one suite's writes leak into another. There's no automatic detection.
