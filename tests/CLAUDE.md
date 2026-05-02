# Rules for `tests/`

rooibos test framework with `@suite` / `@describe` / `@it` decorators. See [docs/architecture/testing.md](../docs/architecture/testing.md) for the test layout and how the `BaseTestSuite` base class works.

## Folder layout

- `tests/source/unit/` — isolated unit tests, no I/O.
- `tests/source/integration/` — component interactions, real I/O allowed; subfolders for `registry/` and `migration/`.
- `tests/source/e2e/` — UI automation (RTA-based; sparsely populated today).
- `tests/source/mocks/` — mock data and stubs.
- `tests/source/shared/` — shared test helpers.
- `tests/scripts/unit/` — **Vitest** unit tests for the Node-side build/lint tooling under [`scripts/`](../scripts/). Different framework (Vitest, not Rooibos) and runtime (Node, not Roku). Rules below DO NOT apply — see [`docs/dev/scripts-development.md`](../docs/dev/scripts-development.md) for that layout.

## Test pattern

Every test suite extends `tests.BaseTestSuite` (which extends `rooibos.BaseTestSuite`). The base provides:

- `m.global` initialization with real content nodes + en_US translations.
- Registry teardown between tests (only when `m.needsRegistrySetup = true` — opt-in per suite).
- Test-mode marker: registry section names start with `test-` so production migration code skips real user data.

## Registry isolation

- **All test registry writes must use `test-*` section names.** This isolates tests from real user data, even on a dev build deployed to a personal device.
- If a suite touches the registry, set `m.needsRegistrySetup = true` in setup so the base class clears `test-*` sections between tests. Forgetting this opt-in produces flaky cross-suite leakage.
- See `migrations.md`'s test-mode safety section for the migration runner's handling.

## Running tests

Agents *can* and *should* run tests to verify fixes — do NOT commit changes based on reasoning alone.

| Command | What |
|---|---|
| `npm run test:tdd` | Build + run TDD config (single-suite iteration; copy `bsconfig-tdd-sample.json` to `bsconfig-tdd.json` and edit `files`) |
| `npm run test:unit` | All unit tests |
| `npm run test:integration` | All integration tests |
| `npm run test:all` | Everything |
| `npm run test:complete` | Complete coverage suite |

The runner (`scripts/run-roku-tests.js`) zips the build, sideloads to the Roku at `ROKU_IP`, and tails the debug console for `[Rooibos Result]: PASS|FAIL`.

### Credentials

Reads `ROKU_IP` and `ROKU_PASSWORD` from a gitignored `.env` at the repo root. If missing, source from VSCode `brightscript.debug.host` / `brightscript.debug.password` and write them to `.env`.

### When hardware isn't available

If no Roku is reachable (no `.env`, no device on network, debugger holding the port), **say so explicitly**. Do NOT claim a fix was tested when only the build (`npm run build:tdd`) was verified. A green build is not a green test run.

### Debugger contention

If a VSCode BrightScript debugger session is already attached to the test device, the deploy will fail (ECP refuses the second sideload) and may also kill the active debugger. Surface this to the user — do not retry blindly.

`docs/dev/unit-tests.md` and `docs/dev/unit-tests-tdd.md` are the canonical how-tos with full troubleshooting.

## Other rules (reminders from root)

- **Cannot modify `CHANGELOG.md`** — CI-controlled.
- **Cannot trigger production build / deploy** — that's IDE / CI territory; testing scripts above are scoped to test sideloads.

## What NOT to do

- Don't write to a registry section without a `test-` prefix from a test.
- Don't mock the database / registry for migration tests — use real `test-*` sections so the integration is exercised. (Same lesson as the `feedback`-style guidance: mocked tests can pass while real schema breaks.)
- Don't skip `BaseTestSuite` for "lightweight" tests — `m.global` setup matters for almost everything.
