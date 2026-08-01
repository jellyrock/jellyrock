---
topic: logging
related-files:
  - components/JRScene.bs
  - components/JRScreen.bs
  - scripts/bsc-plugins/roku-log.cjs
last-reviewed: 2026-08-01
---

# Logging

How JellyRock logs (`roku-log`), the initialization story, and the per-component pattern. Debug-time tooling lives in `debug-tools.md`. Test infrastructure lives in `testing.md`.

## roku-log

JellyRock uses **roku-log** (`log` ropm package) for all logging. It supports multiple transports (telnet, on-screen overlay), structured logging with named loggers, and per-logger log levels.

### Initialization

`JRScene.bs:init()` initializes the log manager **once**, with different default log levels per build:

```brightscript
sub init()
  #if debug
    log.initializeLogManager(["log_PrintTransport"], 5)   ' debug: everything
  #else
    log.initializeLogManager(["log_PrintTransport"], 2)   ' prod: error+warn+info
  #end if
end sub
```

**Initialization order is load-bearing, and it must happen before `setGlobalNodes()`.** `log.Logger.new()`
resolves `m.global.rLog` **once** and caches it; every level method then opens with
`if m.rLog = invalid then return`. A component whose `init()` runs before the manager exists therefore
logs **nothing, forever, at any level, on any build** — silently, with no error (the `NO LOGGER FOUND`
fallback lives on `m.log`, which the level methods never reach). `JRScene` is the earliest component
init (`CreateScene`, ahead of `setGlobalNodes()` in `main.bs`), which is why it owns this.

This used to live in `JRScreen.init()` on the assumption that a screen always initializes first. That
assumption was false: `setGlobalNodes()` runs before the first screen mounts, so `JRScene` itself plus
`RemoteControlTask`, `SceneManager`, `QueueManager` and `SideEffectTask` never emitted a single log
line. `JRScreen.init()` keeps a fallback call for Rooibos suites that mount a screen without `JRScene`
(`addFields` ignores an existing field, so it is a no-op in the app). If you add a component that logs
from a global node, verify its output on-device — a silent logger looks identical to a quiet one.

Levels — the number is the value passed to `initializeLogManager`, and a call emits when
`levelNum <= logLevel`:

| Level | Number | When to use |
|---|---|---|
| `error` | 0 | Crashes, critical failures (auth fail, server unreachable, playback error) |
| `warn` | 1 | Issues with fallbacks (missing data, retry attempts) |
| `info` | 2 | Important user events (login, video start/stop, major state transitions) |
| `verbose` | 3 | Detailed operations (function entry/exit, API calls, data flow) |
| `debug` | 4 | Variable values, loop bodies, conditional branches |

So the production default (`2`) emits error, warn **and info**; it suppresses only verbose and debug,
keeping telnet output readable on real devices without losing the important user events.

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
