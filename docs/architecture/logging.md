---
topic: logging
related-files:
  - components/JRScreen.bs
  - scripts/bsc-plugins/roku-log.cjs
last-reviewed: 2026-05-01
---

# Logging

How JellyRock logs (`roku-log`), the initialization story, and the per-component pattern. Debug-time tooling lives in `debug-tools.md`. Test infrastructure lives in `testing.md`.

## roku-log

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

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for logging entries.
