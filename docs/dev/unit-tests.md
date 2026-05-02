---
topic: unit-tests
related-files:
  - tests/source/BaseTestSuite.spec.bs
  - bsconfig-tests.json
  - bsconfig-tests-unit.json
  - bsconfig-tests-integration.json
  - bsconfig-tests-complete.json
  - scripts/run-roku-tests.js
last-reviewed: 2026-05-01
---

# Unit Testing Guide (Rooibos Framework)

## Overview

JellyRock uses the Mocha-inspired Rooibos framework for robust unit and integration testing of Roku/BrighterScript components.

**What you'll learn:**

- Writing unit tests with Rooibos framework
- Using JellyRock's `BaseTestSuite` and helper methods
- Testing with mocks, stubs, and async patterns
- Testing Scene Graph components
- Best practices for Roku/BrightScript testing

**See also:** [TDD Workflow Guide](unit-tests-tdd.md) for focused development and rapid iteration

---

## Quick Start

### Your First Test

```brighterscript
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

### Running Tests

Build and deploy tests using VSCode `Run and Debug` and select the desired build.

To manually build the unit tests:

```bash
npm run build:tests              # Build all tests (unit + integration)
npm run build:tests-unit         # Build unit tests only
npm run build:tests-integration  # Build integration tests only
npm run build:tdd                # Build in watch mode for TDD
```

**💡 For rapid development workflow:** See the [TDD Workflow Guide](unit-tests-tdd.md) for focused test execution and faster iteration.

---

## Test Structure

### Hierarchy

```text
Suite (@suite)
  └── Describe Block (@describe)
      └── Test Case (@it)
          └── Parameterized Test (@params)
```

### File Requirements

All tests in JellyRock:

- **MUST** be written in BrighterScript (`.bs` files)
- **SHOULD** follow naming: `ComponentName.spec.bs`
- **MUST** be inside a `namespace tests` block
- **MUST** extend `tests.BaseTestSuite`

### Essential Annotations

| Annotation | Purpose | Example |
| ----------- | --------- | --------- |
| `@suite("name")` | Define test suite (required) | `@suite("User Tests")` |
| `@describe("name")` | Group related tests | `@describe("Authentication")` |
| `@it("description")` | Individual test case | `@it("validates input")` |
| `@params(a, b, c)` | Parameterized test data | `@params(1, 2, 3)` |
| `@only` | Run only this test/suite | `@only @it("debug this")` |
| `@ignore` | Skip this test/suite | `@ignore @it("broken")` |
| `@SGNode("Type")` | Run test in component context | `@SGNode("ItemGrid")` |

### Complete Test Example

```brighterscript
namespace tests

  @suite("isValid utility functions")
  class IsValidTests extends tests.BaseTestSuite

    protected override function setup()
      super.setup()  ' ALWAYS call parent setup!
      m.testData = [1, 2, 3]
    end function

    '+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    @describe("isValid()")
    '+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    @it("returns true for valid strings")
    function _()
      m.assertTrue(isValid("hello"))
    end function

    @it("returns false for invalid")
    function _()
      m.assertFalse(isValid(invalid))
    end function

    '+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
    @describe("Parameterized example")
    '+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    @it("handles strings correctly")
    @params("hello", true)
    @params("", false)
    @params("   ", false)
    function _(input, expected)
      m.assertEqual(isValidAndNotEmpty(input), expected)
    end function

  end class

end namespace
```

**Style Notes:**

- Use `+++++++++++++` around `@describe` blocks for readability
- Function names can be anything (Rooibos renames them) - `_()` is common
- Both `function` and `sub` work for test cases

---

## Assertions

All assertions are called on `m`: `m.assertSomething(actual, expected)`.

### Most Common Assertions

| Assertion | Purpose | Example |
| ----------- | --------- | --------- |
| `assertTrue(val)` | Assert true | `m.assertTrue(isValid(obj))` |
| `assertFalse(val)` | Assert false | `m.assertFalse(isEmpty)` |
| `assertEqual(act, exp)` | Values equal | `m.assertEqual(result, 42)` |
| `assertNotEqual(act, exp)` | Values not equal | `m.assertNotEqual(userId, "")` |
| `assertInvalid(val)` | Value is invalid | `m.assertInvalid(errorObj)` |
| `assertNotInvalid(val)` | Value is not invalid | `m.assertNotInvalid(user)` |
| `assertArrayCount(arr, n)` | Array has N items | `m.assertArrayCount(items, 5)` |
| `assertArrayContains(arr, val)` | Array contains value | `m.assertArrayContains(genres, "Action")` |
| `assertAAHasKey(aa, key)` | AA has key | `m.assertAAHasKey(user, "id")` |
| `assertAAContainsSubset(aa, sub)` | AA contains subset | `m.assertAAContainsSubset(user, {id: "123"})` |
| `assertNodeCount(node, n)` | Node has N children | `m.assertNodeCount(parent, 5)` |
| `assertNodeContainsFields(node, fields)` | Node has fields | `m.assertNodeContainsFields(item, {id: "123"})` |

**For complete assertion reference:** [Rooibos API Documentation](https://rokucommunity.github.io/rooibos/module-BaseTestSuite.html)

---

## Parameterized Tests

Test the same logic with different inputs to reduce code duplication.

```brighterscript
@it("validates multiple input types")
@params(true, true)
@params(false, true)
@params(invalid, false)
@params("hello", true)
function _(input, expected)
  result = isValid(input)
  m.assertEqual(result, expected)
end function
```

**Rules:** Function **MUST** accept same number of parameters as `@params` entries. Up to 6 parameters per line, unlimited lines.

**Control execution:** Use `@onlyParams(a, b)` to run only specific params, or `@ignoreParams(a, b)` to skip them.

---

## `BaseTestSuite` (JellyRock-Specific)

All test suites **MUST** extend `tests.BaseTestSuite`, which provides:

- Automatic initialization of `m.global` with proper ContentNode structure
- Mock data loading and transformation using production code paths
- Helper methods for common testing patterns

### Helper Methods

| Method | Purpose |
| -------- | --------- |
| `loadTestUser(userName)` | Load mock user from JSON file in `tests/source/mocks/users/` |
| `setTestDisplaySetting(libId, key, val)` | Set single display setting for testing |
| `getTestServer()` | Get local server reference (minimizes rendezvous) |
| `getTestUser()` | Get local user reference |
| `getTestUserSettings()` | Get local settings reference |
| `resetServer()` | Reset server to XML defaults |
| `resetUser()` | Reset user to XML defaults |

### Mock Data Files

Mock data is stored in `tests/source/mocks/`:

- `servers/` - Server configurations (e.g., `default.json`)
- `users/` - User configurations (e.g., `user-with-display-settings.json`)
- `api/` - API responses

**Mock User JSON Structure:**

```json
{
  "id": "test-user-id",
  "name": "Test User",
  "settings": {
    "display.library1.sortAscending": "true",
    "display.library1.sortField": "DateCreated",
    "ui.rowLayout": "fullwidth"
  }
}
```

**Key points:** Display settings use dot notation `"display.libraryId.settingKey"`. All values stored as **strings** (registry format). `SessionDataTransformer` converts types automatically.

### ✅ DO: Use Mock Data Files

```brighterscript
@it("tests with proper mock data")
function _()
  m.loadTestUser("user-with-display-settings")
  result = someFunction()
  m.assertEqual(result, expectedValue)
end function
```

### ❌ DON'T: Hardcode Mock Data

```brighterscript
' ❌ BAD - Bypasses ContentNode creation and transformers
m.global.user = { settings: {...} }  ' This will fail!
```

**Why this breaks:** Bypasses ContentNode field definitions, production transformers, observer patterns, and causes type mismatches.

---

## Mocking and Stubbing

Isolate code under test by replacing dependencies with controlled implementations.

**When to use:** Testing API calls, Task nodes, external dependencies, complex objects.

### Enabling Mocking

Add to `bsconfig.json`:

```json
{
  "rooibos": {
    "isGlobalMethodMockingEnabled": true,
    "isGlobalMethodMockingEfficientMode": true
  }
}
```

### Mock Example (Verify Method Called)

```brighterscript
@it("verifies API call")
function _()
  apiClient = { callApi: function(endpoint) return invalid }

  m.mock(apiClient, "callApi")
  m.expect(apiClient, "callApi", ["users"], {users: [{id: "1"}]})

  result = apiClient.callApi("users")

  m.assertEqual(result.users.Count(), 1)
  m.assertMocks()  ' Verify expectations met
end function
```

### Stub Example (Replace Return Value)

```brighterscript
@it("stubs Task node")
function _()
  task = CreateObject("roSGNode", "LoadItemsTask")
  m.stub(task, "control")  ' Prevent actual execution

  ' Simulate completion
  task.output = {items: [{id: "1"}]}

  m.assertEqual(task.output.items.Count(), 1)
end function
```

### Mock Expectations

```brighterscript
m.expectOnce(obj, "method", [args], returnValue)  ' Called once
m.expectNone(obj, "method")                       ' Never called
m.expect(obj, "method", [args], returnValue, N)   ' Called N times
m.assertMocks()                                   ' Verify (MUST call at end)
```

---

## Async Testing

Wait for asynchronous operations (Task nodes, field observers).

### `assertAsyncField()`

```brighterscript
@it("waits for task completion")
function _()
  task = CreateObject("roSGNode", "LoadItemsTask")
  task.control = "RUN"

  ' Wait for field to change (500ms intervals, 10 retries = 5s timeout)
  m.assertAsyncField(task, "state")

  m.assertEqual(task.state, "DONE")
  m.assertNotInvalid(task.output)
end function
```

**Syntax:** `m.assertAsyncField(node, fieldName, timeout, retries)`

**Parameters:** timeout (ms, default: 500), retries (default: 10)

---

## Component Testing (@SGNode)

Test Scene Graph components in their proper node context.

**Requirements:** `"autoImportComponentScript": true` in `bsconfig.json`

```brighterscript
namespace tests

  @suite("ItemGrid Component Tests")
  @SGNode("ItemGrid")  ' Creates test in ItemGrid context
  class ItemGridTests extends tests.BaseTestSuite

    @it("initializes with default values")
    function _()
      ' m.node references the ItemGrid instance
      m.assertNotInvalid(m.node)
      m.assertEqual(m.node.subtype(), "ItemGrid")
      m.assertEqual(m.node.numColumns, 6)
    end function

  end class

end namespace
```

**Note:** `m.top` and `m.node` refer to the same component instance.

---

## Test Lifecycle

```text
Suite Setup (override setup())
    └── BeforeEach (override beforeEach())
        └── Test 1
    └── AfterEach (override afterEach())
    └── BeforeEach
        └── Test 2
    └── AfterEach
Suite TearDown (override teardown())
```

### Suite-Level Lifecycle

```brighterscript
class MyTests extends tests.BaseTestSuite

  protected override function setup()
    super.setup()  ' ⚠️ ALWAYS call in JellyRock!
    m.sharedData = loadExpensiveData()
  end function

  protected override function teardown()
    m.sharedData = invalid
  end function

  protected override function beforeEach()
    m.testCounter = 0
  end function

  protected override function afterEach()
    m.testCounter = invalid
  end function

end class
```

### Describe-Level Lifecycle

```brighterscript
@describe("Feature group")

@setup
function featureSetup()
  m.featureData = loadFeatureData()
end function

@tearDown
function featureTearDown()
  m.featureData = invalid
end function

@it("tests something")
function _()
  ' m.featureData is available
end function
```

---

## Controlling Test Execution

### Recommended: Use TDD Mode for Focus

**For daily development**, use TDD mode (see [TDD Workflow Guide](unit-tests-tdd.md)) to run only specific test files. This is cleaner and faster than annotation-based filtering.

### Use @only for Temporary Debugging

When debugging a specific test within your TDD session:

```brighterscript
@only  ' Temporarily run only this test
@it("debug this test")
function _()
end function
```

**⚠️ CRITICAL: Remove all `@only` annotations before committing!**

**Note:** `@only` can be used on `@suite`, `@describe`, or `@it` to focus execution at any level.

### Avoid @ignore During Development

**❌ Don't use `@ignore` to skip tests during development** - use TDD file filtering instead.

**✅ Only use `@ignore` for permanently disabled tests:**

```brighterscript
@ignore  ' TODO: Fix in ticket #123 - API endpoint deprecated
@it("calls legacy endpoint")
function _()
end function
```

**Best practice:** Always include a comment explaining why the test is ignored and reference a ticket/issue number.

### Debug Mode

```brighterscript
@noCatch  ' Crash with stack trace on failure
@it("debug this")
function _()
end function
```

Or configure globally: `"throwOnFailedAssertion": true, "failFast": true`

---

## Best Practices

### 1. Always Extend tests.BaseTestSuite and Call super.setup()

```brighterscript
' ✅ GOOD
namespace tests
  @suite("My Tests")
  class MyTests extends tests.BaseTestSuite
    protected override function setup()
      super.setup()  ' Critical!
    end function
  end class
end namespace

' ❌ BAD
class MyTests extends rooibos.BaseTestSuite  ' Wrong base class
```

### 2. Use Descriptive Test Names

```brighterscript
' ✅ GOOD
@it("returns defaultValue when library doesn't exist in displaySettings")

' ❌ BAD
@it("test 1")
```

### 3. Test Both Success and Edge Cases

```brighterscript
@it("retrieves stored setting")
@it("returns defaultValue when key doesn't exist")
@it("returns defaultValue when library doesn't exist")
@it("handles invalid input gracefully")
```

### 4. Use Parameterized Tests for Similar Cases

```brighterscript
' ✅ GOOD - One test, many cases
@it("validates various inputs")
@params(true, "valid")
@params(false, "valid")
@params(invalid, "invalid")
function _(input, expected)
  m.assertEqual(validateInput(input), expected)
end function

' ❌ BAD - Repeated tests
@it("validates true")
@it("validates false")
@it("validates invalid")
```

### 5. Minimize Rendezvous with m.global

```brighterscript
' ✅ GOOD - Single rendezvous
localUser = m.getTestUser()
userId = localUser.id
userName = localUser.name

' ❌ BAD - Multiple rendezvous (slow!)
userId = m.global.user.id       ' Rendezvous 1
userName = m.global.user.name   ' Rendezvous 2
```

### 6. Use Helper Methods, Not Hardcoded Data

```brighterscript
' ✅ GOOD
m.loadTestUser("user-with-display-settings")

' ❌ BAD
m.global.user.settings = {...}  ' Wrong type!
```

### 7. Use TDD Mode for Focused Development

**For rapid iteration during development**, use the [TDD Workflow](unit-tests-tdd.md) with file-based filtering instead of `@ignore` annotations. This keeps your codebase clean and builds faster.

---

## Troubleshooting

### Test Crashes with "User not initialized"

**Solution:** Ensure test extends `tests.BaseTestSuite` and calls `super.setup()`.

### Assertions Pass But Shouldn't

**Causes:**

1. Comparing object references: Use `m.assertEqual(obj1.id, obj2.id)` not `m.assertEqual(obj1, obj2)`
2. Type mismatch: `m.assertEqual("true", true)` passes due to coercion. Verify type first: `m.assertTrue(Type(value) = "roBoolean")`
3. Async timing: Use `m.assertAsyncField(task, "output")` instead of immediately checking `task.output`

### Mock Expectations Not Met

**Solution:** Verify code actually calls the mocked method before `m.assertMocks()`.

### Tests Run Slowly

**Solutions:**

1. Disable code coverage: `"isRecordingCodeCoverage": false`
2. Use `@only` to focus
3. Check for unnecessary Task node usage
4. Use `"failFast": true`

### Type Mismatch Errors

**Solution:** Use `m.loadTestUser()` instead of direct assignment. Direct assignment bypasses ContentNode creation.

### Mock Data Not Loading

**Checklist:**

- File exists in `tests/source/mocks/users/`?
- Filename correct (without `.json`)?
- JSON valid?

### Rendezvous Tracking Warnings

**Solution:** Disable in `.vscode/launch.json`: `"rendezvousTracking": false`

---

## Quick Reference

### Test Template

```brighterscript
namespace tests

  @suite("My Feature Tests")
  class MyFeatureTests extends tests.BaseTestSuite

    protected override function setup()
      super.setup()
    end function

    @describe("Feature area")

    @it("does something")
    function _()
      m.assertTrue(true)
    end function

    @it("handles edge case")
    @params(1, "expected1")
    @params(2, "expected2")
    function _(input, expected)
      result = myFunction(input)
      m.assertEqual(result, expected)
    end function

  end class

end namespace
```

### Common Assertions

```brighterscript
m.assertTrue(val)
m.assertFalse(val)
m.assertEqual(actual, expected)
m.assertInvalid(val)
m.assertNotInvalid(val)
m.assertArrayCount(arr, n)
m.assertArrayContains(arr, val)
m.assertAAHasKey(aa, "key")
m.assertNodeCount(node, n)
m.assertAsyncField(node, "field")
m.assertMocks()
```

### `BaseTestSuite` Helpers

```brighterscript
m.loadTestUser("filename")
m.setTestDisplaySetting("libId", "key", value)
server = m.getTestServer()
user = m.getTestUser()
settings = m.getTestUserSettings()
```

### Build Commands

```bash
npm run build:tests              # Build all tests
npm run build:tests-unit         # Build unit tests only
npm run build:tests-integration  # Build integration tests only
npm run build:tdd                # Build with TDD config (see TDD guide)
```

**💡 TDD Workflow:** For focused test execution and rapid iteration, see the [TDD Workflow Guide](unit-tests-tdd.md).

### Resources

- [Rooibos Documentation](https://github.com/rokucommunity/rooibos/blob/master/docs/index.md)
- [Rooibos API Reference](https://rokucommunity.github.io/rooibos/module-BaseTestSuite.html)
- [`BaseTestSuite` Implementation](../../tests/source/BaseTestSuite.spec.bs)
