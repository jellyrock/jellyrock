---
topic: unit-tests
related-files:
  - tests/source/BaseTestSuite.spec.bs
  - tests/source/shared/MockDataLoader.bs
  - bsconfig-tests.json
  - bsconfig-tests-unit.json
  - bsconfig-tests-integration.json
  - bsconfig-tests-complete.json
  - scripts/run-roku-tests.js
last-reviewed: 2026-10-09
---

# Unit tests

How to write a Rooibos test for JellyRock's BrighterScript code. Tests run on a Roku: `npm run test:unit`, `test:integration` or `test:all`. To run one spec while you work on it, see [`unit-tests-tdd.md`](unit-tests-tdd.md). For how the test build and runner fit together, see [`testing.md`](../architecture/testing.md). The rules for `tests/` are in [`tests/CLAUDE.md`](../../tests/CLAUDE.md).

This guide covers what JellyRock's tests use. Rooibos has more (mocks, stubs, node tests, async tests); [Rooibos also has](#rooibos-also-has) lists them.

## Write a test

A spec file is a `.bs` file named `<Thing>.spec.bs`. Put a unit test under `tests/source/unit/` (no I/O) and one that reads or writes the registry under `tests/source/integration/`. The unit and integration builds each leave out the other's folder.

```brighterscript
namespace tests

  @suite("isValid")
  class IsValidTests extends tests.BaseTestSuite

    '+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    @describe("isValid()")
    '+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    @it("returns true for a string")
    function _()
      m.assertTrue(isValid("hello"))
    end function

    @it("returns false for invalid")
    function _()
      m.assertFalse(isValid(invalid))
    end function

  end class

end namespace
```

Every spec file follows four rules:

- **Put the class in `namespace tests`.**
- **Extend `tests.BaseTestSuite`**, never `rooibos.BaseTestSuite`. The base class sets up `m.global` the way the app does (see [What `BaseTestSuite` gives you](#what-basetestsuite-gives-you)).
- **Write one `@suite` per file.** A second suite in the same file builds cleanly, then crashes the runner on the device. To split a suite, keep the base name and add the aspect: `misc.spec.bs` and `miscAudioStreams.spec.bs`.
- **Name each test with `@it`.** Rooibos renames the function, so `_()` is the convention. A `sub` works as well as a `function`.

Group tests with `@describe`. The `'+++` comment lines around it are the house style, so a group stands out in a long file.

## Run one input through many cases

`@params` runs the same test once per line. The function takes one argument per value:

```brighterscript
@it("treats blank strings as empty")
@params("hello", true)
@params("", false)
@params("   ", false)
function _(input, expected)
  m.assertEqual(isValidAndNotEmpty(input), expected)
end function
```

Use it when the cases differ only in their data. When they need different setup or different assertions, write separate tests.

## Set up state per test

Rooibos has four hooks, and they run at different times:

| Hook | Runs |
| --- | --- |
| `setup()` and `teardown()` | Once per `@describe` group |
| `beforeEach()` and `afterEach()` | Once per test |

Build anything a test changes in `beforeEach()`. A node made in `setup()` is shared by every test in its group, so each test gets whatever the last one left behind. `setup()` is for fixtures no test changes. The reasoning and the incident behind it are in [`tests/CLAUDE.md`](../../tests/CLAUDE.md#lifecycle-hooks--setup-is-per-describe-group-beforeeach-is-per-test).

`BaseTestSuite` overrides all four hooks, so call the parent in each one you override. This is `JRDialog.spec.bs`:

```brighterscript
protected override function beforeEach()
  super.beforeEach()
  m.dialog = CreateObject("roSGNode", "JRDialog")
end function

protected override function afterEach()
  parent = m.dialog.getParent()
  if isValid(parent) then parent.removeChild(m.dialog)
  m.dialog = invalid
  super.afterEach()
end function
```

To check a suite is isolated, reverse the order of its tests and run it again. A suite that passes only in declaration order shares state.

## Assert

Call every assertion on `m`. The ones JellyRock's tests use most:

| Assertion | Passes when |
| --- | --- |
| `m.assertTrue(value)`, `m.assertFalse(value)` | `value` is `true` or `false` |
| `m.assertEqual(actual, expected)` | The two are equal (see below) |
| `m.assertNotEqual(actual, expected)` | They are not equal |
| `m.assertInvalid(value)`, `m.assertNotInvalid(value)` | `value` is or is not `invalid` |
| `m.assertArrayCount(array, n)` | `array` has `n` items |
| `m.assertArrayContains(array, value)` | `array` holds `value` |
| `m.assertAAHasKey(aa, key)` | `aa` has `key` |
| `m.assertAAContainsSubset(aa, subset)` | Every key in `subset` is in `aa` with the same value |
| `m.assertNodeCount(node, n)` | `node` has `n` children |
| `m.assertNodeContainsFields(node, subset)` | Every field in `subset` is on `node` with the same value |

The full list is in the [Rooibos docs](https://github.com/rokucommunity/rooibos/blob/master/docs/index.md#full-list-of-asserts).

`assertEqual` compares this way:

- **Different types are never equal.** `m.assertEqual("true", true)` fails, and so does `m.assertEqual(1, 1.0)`.
- **Associative arrays and arrays compare by content**, key by key and item by item.
- **Nodes compare by identity** (`isSameNode`). Two nodes with the same fields are not equal; compare the fields instead.

To assert a type, use the base class's helpers: `m.isStringType()`, `m.isBooleanType()`, `m.isIntegerType()` and `m.isFloatType()`. Each accepts both forms of its type (`String` and `roString`, for example), so a boxed value does not fail the check.

```brighterscript
m.assertTrue(m.isStringType(registryValue))
```

## What `BaseTestSuite` gives you

[`BaseTestSuite.spec.bs`](../../tests/source/BaseTestSuite.spec.bs) runs the app's own start-up code, so `m.global` looks as it does in a signed-in session:

- `m.global.constants`, `app` and `device` from `setGlobals()`, once per run.
- The en_US translations, reloaded for every `@describe` group.
- `m.global.server` and `m.global.user`, reset to their XML defaults for every group, then filled from the `default` server and user mocks. The user's `Configuration` and `Policy` go through the same transformers `user.Login()` uses.
- `m.global.sceneManager`, a `MockSceneManager` whose functions do nothing, so code that navigates does not crash.

Don't assign an associative array to a content node field such as `m.global.user.settings`. The field expects a node, and an AA skips the field types and the transformers the app uses.

### Helpers

| Method | What it does |
| --- | --- |
| `m.getTestServer()`, `m.getTestUser()`, `m.getTestUserSettings()` | Return the global node, so you read it into a local once |
| `m.resetServer()`, `m.resetUser()` | Reset a node to its XML defaults; `resetUser()` also gives it a fresh settings node |
| `m.loadSettingsFromRegistry(userId)` | Load a user's registry section into a fresh settings node, converting each stored string to the field's type the way `user.Login()` does |
| `m.setTestDisplaySetting(libraryId, key, value)` | Set one per-library display setting |
| `m.loadTestDevice(name)` | Apply a mock device from `mocks/devices/` to `m.global.device` |

**`loadTestDevice()` is not undone.** Nothing resets `m.global.device`, so the mock device stays in place for the suites that run after yours.

Read a global node into a local before you use it more than once. Each `m.global` read crosses a thread boundary, which is slow on a Roku:

```brighterscript
localUser = m.getTestUser()
userId = localUser.id
userName = localUser.name
```

## Use mock data

Mock JSON lives in `tests/source/mocks/`, and `MockDataLoader` in [`tests/source/shared/MockDataLoader.bs`](../../tests/source/shared/MockDataLoader.bs) reads it. Pass the file name without `.json`:

| Folder | Holds | Loader |
| --- | --- | --- |
| `servers/` | Server records | `MockDataLoader.LoadServer(name)` |
| `users/` | User records as the server returns them | `MockDataLoader.LoadUser(name)` |
| `devices/` | Device info for one Roku model or locale | `MockDataLoader.LoadDevice(name)`, or `m.loadTestDevice(name)` |
| `api/items/` | Item responses from the server | `MockDataLoader.LoadItem(name)` |
| `api/deviceProfiles/` | Device profiles | `MockDataLoader.LoadDeviceProfile(name)` |
| `registry/userSettings/` | A user's stored settings | `MockDataLoader.LoadRegistryUserSettings(name)` |

```brighterscript
mockData = MockDataLoader.LoadItem("movie-quickplay-basic")
```

A loader returns `invalid` when the file is missing or the JSON does not parse. Assert the result is valid first, so a typo fails at the load and not three lines later.

User settings are not in the user mock. To test settings as they are stored, write them to the registry and load them with `m.loadSettingsFromRegistry()` (see the next section).

## Test the registry

A test that touches the registry is an integration test. It goes under `tests/source/integration/` and follows two rules:

- **Name every section you write `test-<something>`.** That keeps tests away from a real user's data, even on your own Roku.
- **Set `m.needsRegistrySetup = true` before `super.setup()`.** The base class then deletes every `test-` section after each test. Without it, sections leak into the next suite.

This is `RoundTripConversion.spec.bs`, shortened:

```brighterscript
@suite("Type Conversion - Registry Round-Trip Tests")
@tags("registry")
class RoundTripConversionTests extends tests.BaseTestSuite

  protected override sub setup()
    m.needsRegistrySetup = true
    super.setup()
  end sub

  @it("round-trip boolean true")
  function _()
    testUserId = "test-roundtrip-bool-true-001"
    m.global.user.id = testUserId
    setUserSetting("uiDesignHideClock", true)

    settings = m.loadSettingsFromRegistry(testUserId)

    m.assertEqual(type(settings.uiDesignHideClock), "roBoolean")
    m.assertEqual(settings.uiDesignHideClock, true)
  end function

end class
```

`@tags` puts a suite in a group a build can include or leave out. JellyRock uses three:

| Tag | Marks | Which builds run it |
| --- | --- | --- |
| `registry` | A suite that reads and writes real registry sections | `test:complete`, or `test:tdd` with the spec listed |
| `migration` | A suite that runs a registry migration end to end | The same |
| `measurement` | A suite that records a platform rate and cannot fail on the number | The same |

The other builds leave these out, `test:all` and `test:integration` included. Before you tag a suite, check which build will run it ([`tests/CLAUDE.md`](../../tests/CLAUDE.md#running-tests)).

## Test a component

Create the component with `CreateObject("roSGNode", ...)` in `beforeEach()`, then set its fields and read them back. Most of JellyRock's component tests work this way. See the `JRDialog.spec.bs` hooks in [Set up state per test](#set-up-state-per-test):

```brighterscript
@it("defaultButtonIndex defaults to 0")
function _()
  m.assertEqual(m.dialog.defaultButtonIndex, 0)
end function
```

A test that appends the node to the scene removes it again, in the test or in `afterEach()`.

## Wait for something to happen

An observer callback does not fire during an ordinary test. To wait for a field, observe it on a port and read the port. This is `apiPoolCollect.spec.bs`:

```brighterscript
@it("returns the response of a request that already answered, without waiting")
function _()
  port = CreateObject("roMessagePort")
  node = CreateObject("roSGNode", "ApiResultNode")
  node.request = { method: "GET", url: "http://example.invalid/items" }
  node.observeField("isDone", port)
  node.result = { ok: true, statusCode: 200, json: { Items: [] } }
  node.isDone = true

  res = collectApiRequest(node, port)

  m.assertEqual(res.statusCode, 200)
  m.assertTrue(res.ok)
end function
```

Give every wait a time limit, so a test that never gets its event fails instead of hanging the run.

## Focus or skip a test

To run one spec while you work, list it in your TDD config ([`unit-tests-tdd.md`](unit-tests-tdd.md)). That changes nothing in the test code.

Rooibos also has annotations for this. Don't commit them:

- `@only` runs only the marked suite, group or test.
- `@ignore` skips it. The runner counts it under `Ignored` and lists it under `IGNORED TESTS:` at the end of the run.
- `@noCatch` stops Rooibos catching the test's errors, so a crash stops on the line that caused it.

## Troubleshoot

| Symptom | Cause and fix |
| --- | --- |
| `User not initialized in test` | `setTestDisplaySetting()` found no user or settings node. The suite does not extend `tests.BaseTestSuite`, or an overridden `setup()` skips `super.setup()`. |
| `assertEqual` fails on values that print the same | The types differ: a string `"8000"` is not the integer `8000`. Check `type(value)`. |
| `assertEqual` fails on two nodes with the same fields | Nodes compare by identity. Compare their fields. |
| A test passes alone and fails in the full run, or the reverse | State leaks between tests. Move what the test changes from `setup()` into `beforeEach()`. |
| `ERROR RETRIEVING TEST SUITE DATA`, then the runner crashes | The file has more than one `@suite`. Split it. |
| A `MockDataLoader` call returns `invalid` | The name has a typo or a `.json` suffix, or the JSON does not parse. |
| A registry test sees another suite's data | The suite does not set `m.needsRegistrySetup = true`, or a section name lacks the `test-` prefix. |

The run itself (deploy, credentials, a debugger holding the device) is covered in [`unit-tests-tdd.md`](unit-tests-tdd.md).

## Rooibos also has

No JellyRock test uses these yet. Read the Rooibos docs before you add the first:

- **[Mocks and stubs](https://github.com/rokucommunity/rooibos/blob/master/docs/index.md#using-mocks-and-stubs)** replace a method on an associative array: `m.stub()`, `m.expect()`, `m.expectOnce()`, `m.expectNone()`, checked by `m.assertMocks()`. The third argument of `m.expect()` is how many calls to expect, and the arguments come after it. Mocking a global function needs `isGlobalMethodMockingEnabled`, which is off in every JellyRock config.
- **[Node tests](https://github.com/rokucommunity/rooibos/blob/master/docs/index.md#testing-nodes)** run a suite inside a component with `@SGNode`.
- **[Async tests](https://github.com/rokucommunity/rooibos/blob/master/docs/index.md#async-tests)** use `@async` and `m.done()`. `m.assertAsyncField(node, field)` waits for the field to change, not to reach a value, so it returns on the first change (a Task's `state` moving to `run`, say).
