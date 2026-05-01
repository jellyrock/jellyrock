# 09 — Logging, Debug & Tests

How JellyRock logs (`roku-log`), the debug-only error injection system, the toast cheat code, and the rooibos test suite layout.

## Logging — `roku-log`

JellyRock uses **roku-log** (`log` ropm package) for all logging. It supports multiple transports (telnet, on-screen overlay), structured logging with named loggers, and per-logger log levels.

### Initialization

`JRScreen.bs:init()` initializes the log manager **once**, with different default log levels per build:

```brightscript
sub init()
  #if debug
    log.initializeLogManager(["log_PrintTransport"], 5)   ' debug: error+warn+info+verbose+debug
  #else
    log.initializeLogManager(["log_PrintTransport"], 2)   ' prod: error+warn only
  #end if
end sub
```

Because every screen extends `JRScreen` (and `JRScreen.init()` runs first), the log manager is up before any screen needs to log.

Levels:

| Level | Number | When to use |
|---|---|---|
| `error` | 1 | Crashes, critical failures (auth fail, server unreachable, playback error) |
| `warn` | 2 | Issues with fallbacks (missing data, retry attempts) |
| `info` | 3 | Important user events (login, video start/stop, major state transitions) |
| `verbose` | 4 | Detailed operations (function entry/exit, API calls, data flow) |
| `debug` | 5 | Variable values, loop bodies, conditional branches |

Production builds suppress info/verbose/debug to keep telnet output readable on real devices.

### Per-component pattern

Every `.bs` file that logs follows the same setup:

```brightscript
import "pkg:/source/roku_modules/log/LogMixin.brs"

sub init()
  m.log = new log.Logger("ComponentName")
end sub

sub doStuff()
  m.log.info("Starting work")
  m.log.debug("Variable value", someVar, "another", anotherVar)
  m.log.warn("Falling back to default", defaultValue)
  m.log.error("Failed to load", err.code, err.message)
end sub
```

The `Logger` constructor takes a name that's prefixed onto every log line, so telnet output looks like:

```text
[INFO][SceneManager] setBackgroundImage called http://server/image/abc.jpg true false
[DEBUG][QueueManager] setCurrentStartingPoint queuePosition 0 ticks 12345678 queueCount 5
```

Helpful structured methods:

- `m.log.increaseIndent("Section")` / `m.log.decreaseIndent()` — visually nest a series of related log lines
- The `info`/`warn`/etc. methods accept arbitrary positional args, formatted into a single line

### `print` statements

`print` is **only allowed in `source/main.bs`** (early bootstrap before the log manager initializes). Everywhere else, use `roku-log` instead. The `print` statements in `globals.bs` debug-block initialization are an exception — they exist to help developers find the debug toggle instructions in the console.

`docs/dev/logging.md` has the canonical guide.

## Debug flags — `m.global.debug`

A compile-time error injection system for testing error paths. **Zero overhead in production** — `bs_const=debug=false` strips all the code.

### Setup

`components/data/DebugFlags.xml` is a `ContentNode` with boolean fields, one per injectable failure:

```xml
<component name="DebugFlags" extends="ContentNode">
  <interface>
    <field id="shouldForceFiltersFail" type="boolean" value="false" />
    <field id="shouldForceFavoriteFail" type="boolean" value="false" />
    <field id="shouldForceWatchedFail" type="boolean" value="false" />
  </interface>
</component>
```

`globals.bs:setGlobalNodes()` creates this node only in `#if debug` builds:

```brightscript
#if debug
  debugNode = CreateObject("roSGNode", "DebugFlags")
  m.global.addFields({ debug: debugNode })
  print "[DEBUG] DebugFlags node initialized on m.global.debug"
  print "[DEBUG] Toggle flags from BrightScript console (port 8085):"
  print "[DEBUG]   m.global.debug.shouldForceFiltersFail = true"
  print "[DEBUG]   m.global.debug.shouldForceFavoriteFail = true"
  print "[DEBUG]   m.global.debug.shouldForceWatchedFail = true"
#end if
```

### Usage in code

Wrap injection sites in `#if debug`:

```brightscript
sub onFiltersLoaded()
  #if debug
    if m.global.debug.shouldForceFiltersFail
      m.log.warn("Forcing filters failure for debug")
      m.top.getScene().testToast = "error|Filters failed (debug)"
      return
    end if
  #end if

  ' ...normal handling
end sub
```

### Triggering from the console

Telnet to the device on port 8085, then:

```console
> m.global.debug.shouldForceFiltersFail = true
```

Next time the relevant code path runs, the failure fires.

### Adding a new flag

1. Add a `<field id="shouldForceXyzFail" type="boolean" value="false" />` to `DebugFlags.xml`
2. Add a `print` line to `globals.bs` so developers see the new flag in the console boot message
3. Wrap the injection site in `#if debug`
4. Document in `docs/dev/debug-flags.md`

`docs/dev/debug-flags.md` has the full set of currently-defined flags and the expected behavior of each.

## Toast testing — the `testToast` field

The root `JRScene` exposes a `testToast` string field (always present, in dev and prod, though primarily used in dev):

```xml
<field id="testToast" type="string" value="" alwaysNotify="true" />
```

Setting it from the telnet console immediately fires a toast:

```console
> m.top.getScene().testToast = "error|Something went wrong"
> m.top.getScene().testToast = "success|Item saved"
> m.top.getScene().testToast = "info|Loading filters..."
> m.top.getScene().testToast = "Just a message"      ' defaults to error type
```

Format is `"type|message"` where `type` is one of `error`, `success`, `warning`, `info`. Without a `|`, the whole string is treated as the message and type defaults to `error`.

The handler is in `JRScene.bs:onTestToast()`. It parses the format and calls the same `showToast` function that real toasts go through, so it's a faithful preview of what production looks like.

## The up-up-down-down cheat code

In `#if debug` builds, pressing **up, up, down, down** on the d-pad within 2 seconds cycles through the four toast types (error → success → warning → info) without needing the telnet console. Implemented in `JRScene.bs:onKeyEvent()`:

```brightscript
function onKeyEvent(key as string, press as boolean) as boolean
  #if debug
    if not press                              ' UP events bubble to JRScene reliably
      now = CreateObject("roDateTime").asSeconds()
      if now - m.debugLastKeyTime > 2
        m.debugCodeProgress = 0               ' 2-second timeout resets progress
      end if
      m.debugLastKeyTime = now
      if key = m.debugCodeSequence[m.debugCodeProgress]
        m.debugCodeProgress++
        if m.debugCodeProgress >= m.debugCodeSequence.count()
          ' Sequence complete — fire next toast
          m.debugCodeProgress = 0
          debugToasts = [
            { type: "error",   msg: "[DEBUG] Error toast test" },
            { type: "success", msg: "[DEBUG] Success toast test" },
            { type: "warning", msg: "[DEBUG] Warning toast test" },
            { type: "info",    msg: "[DEBUG] Info toast test" }
          ]
          toast = debugToasts[m.debugToastIndex]
          m.debugToastIndex = (m.debugToastIndex + 1) mod 4
          showToast(toast.msg, toast.type)
          return true
        end if
      else
        m.debugCodeProgress = 0
      end if
    end if
  #end if
  ' ...normal key handling
end function
```

Why key UP events specifically: BrightScript convention is for child components to return `false` for `press=false`, so all key UP events bubble up to `JRScene`. This guarantees the sequence is tracked regardless of which screen has focus.

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

- **`JRScreen.init` initializes the log manager.** This works because every screen extends JRScreen and inherits its init, but it's an unusual coupling — the log manager is a global resource initialized inside what looks like a screen's lifecycle hook. Repeated re-initialization is no-op in roku-log, but the design assumes JRScreen.init runs before any other component's init.
- **`testToast` is in production builds too.** It's not gated by `#if debug`. The field exists on the JRScene interface always; only the cheat code is debug-gated. So in theory a malicious app could drive toasts on the prod app via some external means — but there's no such attack vector on Roku.
- **No log filtering by namespace at runtime.** Once you set the level to 5 (debug), every component logs at debug. There's no way to say "show me only QueueManager logs at debug, everything else at info." Possible to add via roku-log's transport configuration but not currently set up.
- **e2e folder is mostly empty.** The plan was for RTA-based UI automation but it hasn't materialized yet. Real coverage today is unit + integration.
- **`needsRegistrySetup` opt-in is per-suite.** Forgetting it in a suite that does touch the registry produces flaky tests where one suite's writes leak into another. There's no automatic detection.
