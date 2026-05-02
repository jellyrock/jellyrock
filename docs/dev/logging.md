---
topic: logging
related-files:
  - components/JRScreen.bs
  - scripts/bsc-plugins/roku-log.cjs
last-reviewed: 2026-05-01
---

# Logging Guide (roku-log)

JellyRock uses roku-log for structured, flexible logging. Follow these steps to set up and use logging effectively.

## 1. Initialize the Logging Framework

Call `log.initializeLogManager` as early as possible (after SceneGraph starts):

```brighterscript
m.top._rLog = log.initializeLogManager([
  "log_PrintTransport", "log_ScreenTransport"
], 5)
```

- **Transports**: Choose one or more:
  - `log_PrintTransport` (telnet output)
  - `log_ScreenTransport` (overlay screen)
  - `log_NodeTransport` (RALE node)
  - `log_HTTPTransport` (HTTP endpoint)
- **Log Level**: 1=error, 2=warn, 3=info, 4=verbose, 5=debug

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

- **Initialize logging early** to capture all events.
- **Import the mixin** in every file that logs.
- **Create a logger per component/class** for clear log sources.
- **Use appropriate log levels** for filtering.
- **Group related actions** with indentation for easier tracing.
- **Never use print statements outside of `source/main.bs`**; always use `m.log.*`. (Enforced by the `print-locations` BSC plugin — see [build-and-tooling.md](../architecture/build-and-tooling.md).)

---

This guide covers all essential steps and best practices for using roku-log in JellyRock.
