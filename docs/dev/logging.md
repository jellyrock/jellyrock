---
topic: logging
related-files:
  - components/JRScene.bs
  - components/JRScreen.bs
  - scripts/bsc-plugins/roku-log.cjs
last-reviewed: 2026-08-02
---

# Logging Guide (roku-log)

JellyRock uses roku-log for structured, flexible logging. Follow these steps to set up and use logging effectively.

## 1. Initialization — already done; don't add your own call

`JRScene.bs:init()` initializes the log manager for the whole app, and it must stay the **only**
call. **Do not add `log.initializeLogManager` to your component** — `npm run lint:log-manager-init`
fails the build if you do. A second call is at best a no-op (`addFields` ignores an existing field)
and at worst a silent break, and the failure mode is invisible: a component built before the manager
exists logs nothing, forever, at any level. Full mechanism in
[architecture/logging.md](../architecture/logging.md).

**`JRScene.init()` is as early as the manager can possibly exist** — it's a platform constraint,
not a style choice. `log_Log`'s own init creates a `Timer`, and Timer creation fails on the main
thread before `m.screen.show()`. So there is a bootstrap window (everything in `setGlobals()`, plus
`main.bs` up to `show()`) where **no logger works**. Use `print` there, as `main.bs` does. Details
and the device measurements are in [architecture/logging.md](../architecture/logging.md).

For reference, the arguments the manager takes:

- **Transports**: one or more of
  - `log_PrintTransport` (telnet output)
  - `log_ScreenTransport` (overlay screen)
  - `log_NodeTransport` (RALE node)
  - `log_HTTPTransport` (HTTP endpoint)
- **Log Level**: `0`=error, `1`=warn, `2`=info, `3`=verbose, `4`=debug. A call emits when its
  level number is `<=` the configured level, so the app's prod default of `2` emits error, warn
  and info, and suppresses only verbose and debug.

One gotcha the level alone doesn't tell you: **prod builds strip every `m.log.*` call site** at
transpile (`bsconfig-prod.json` → `rokuLog.strip`, applied by the `roku-log` BSC plugin), so a
prod build emits nothing regardless of level. If a log line you expect is missing, check whether
you're on a prod build before you go hunting for a level or a filter.

## 2. Import the Logging Mixin

In every `.bs` file that uses logging, import the mixin:

```brighterscript
import "pkg:/source/roku_modules/log/LogMixin.brs"
```

## 3. Register a Logger in Each Component/Class

In your component's `init()` method:

```brighterscript
sub init()
  m.log = new log.Logger("MyComponent")
end sub
```

Or your class's `new()` method:

```brighterscript
class AnalyticsManager
  function new()
    m.log = new log.Logger("AnalyticsManager")
  end function
end class
```

## 4. Logging Methods

Use these methods for structured logging:

| Level | Use For | Examples |
| ------- | --------- | ---------- |
| `m.log.error` | **Crashes & Critical Failures** | Auth failure, server unreachable, video won't play |
| `m.log.warn` | **Issues with Fallbacks** | Missing data (using defaults), retry attempts, deprecated usage |
| `m.log.info` | **Important User Events** | Major app state changes, video start/stop, login success, etc. |
| `m.log.verbose` | **Detailed Operations** | function entry/exit, API calls, data processing |
| `m.log.debug` | **Variable Values & Logic** | Loop contents, conditional branches, object dumps |

All accept a message and up to 9 values:

```brighterscript
m.log.info("Received data", json.result, "http call", m.top.uri)
```

No need to convert values to strings—roku-log handles this.

## 5. Indentation for Readable Logs

Use indentation helpers to group related log entries:

```brighterscript
m.log.increaseIndent("Fetching user data")
' ...log actions...
m.log.decreaseIndent()
m.log.resetIndent()
```

- `increaseIndent([title])`: Optional title for context
- `decreaseIndent()`: Step out one level
- `resetIndent()`: Clear all indentation

## Best Practices

- **Don't initialize the manager yourself** — `JRScene.init()` owns it, and `lint:log-manager-init`
  enforces that. A second call is either a no-op or, if it lands earlier, a silent break.
- **Don't create a `log.Logger` in anything constructed before the scene exists** (`setGlobals()`,
  early `main.bs`). It will cache `invalid` and no-op forever. Use `print`.
- **Import the mixin** in every file that logs.
- **Create a logger per component/class** for clear log sources.
- **Use appropriate log levels** for filtering.
- **Group related actions** with indentation for easier tracing.
- **Never use print statements outside of `source/main.bs`**; always use `m.log.*`. (Enforced by the `print-locations` BSC plugin — see [build-and-tooling.md](../architecture/build-and-tooling.md).)

---

This guide covers all essential steps and best practices for using roku-log in JellyRock.
