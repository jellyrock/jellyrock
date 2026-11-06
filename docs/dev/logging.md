---
topic: logging
related-files:
  - components/JRScene.bs
  - components/JRScreen.bs
  - components/logging/Log.bs
  - source/logging/Logger.bs
  - scripts/bsc-plugins/roku-log.cjs
last-reviewed: 2026-11-05
---

# Logging guide

JellyRock logs through its own logger in `source/logging/`, adopted from roku-log. To log from your code, import the logger, create one, and call it at the right level. How the logging system works inside is in [architecture/logging.md](../architecture/logging.md).

## 1. The log manager is already set up

`JRScene.init()` sets up the log manager for the whole app, and it must stay the only place that does. Don't add `log.initializeLogManager` to your component: `npm run lint:log-manager-init` fails the build if you do. A second call does nothing at best (`addFields` ignores a field that exists). At worst it breaks logging without any sign: a component built before the manager exists logs nothing, at any level, for the rest of the run.

`JRScene.init()` is the earliest point the manager can exist, because of a platform limit. `log_Log` creates a `Timer` when it starts, and the main thread can't create a `Timer` before `m.screen.show()`. So no logger works during startup: everything in `setGlobals()`, and `main.bs` up to `show()`. Use `print` in `source/main.bs`. In `source/utils/globals.bs`, `print` is allowed only inside its `#if debug` block. The details and device measurements are in [architecture/logging.md](../architecture/logging.md).

The manager takes these settings:

- **Transports:** `log_PrintTransport` writes to the debug console (telnet on port 8085). It is the only one.
- **Log level**: `0` error, `1` warn, `2` info, `3` verbose, `4` debug. A call is written when its level number is at most the configured level. The app's default of `2` writes error, warn and info, and drops verbose and debug.

**Production builds remove every `m.log.*` call** when they compile (`rokuLog.strip` in `bsconfig-prod.json`, applied by the `roku-log` BrighterScript plugin). A production build logs nothing, whatever the level. If a log line you expect is missing, check whether you're on a production build before you look at levels or filters.

## 2. Import the logger

Import the logger in every `.bs` file that logs:

```brighterscript
import "pkg:/source/logging/Logger.bs"
```

## 3. Create a logger in each component or class

In a component's `init()`:

```brighterscript
sub init()
  m.log = new log.Logger("MyComponent")
end sub
```

In a class's `new()`:

```brighterscript
class AnalyticsManager
  function new()
    m.log = new log.Logger("AnalyticsManager")
  end function
end class
```

## 4. Pick the level

| Method | Use it for | Examples |
| --- | --- | --- |
| `m.log.error` | Crashes and critical failures | Sign-in fails, the server can't be reached, a video won't play |
| `m.log.warn` | Problems with a fallback | Missing data (using defaults), retries, deprecated calls |
| `m.log.info` | Important user events | Major app state changes, video start and stop, successful sign-in |
| `m.log.verbose` | Detailed operations | Function entry and exit, API calls, data processing |
| `m.log.debug` | Variable values and logic | Loop contents, which branch ran, object dumps |

Each method takes a message and up to 8 values. A ninth fails the build with `log-too-many-values`, so split a longer line in two:

```brighterscript
m.log.info("Received data", json.result, "http call", m.top.uri)
```

The logger converts the values to text, so you don't have to. The exception: a `LongInteger` or `Double` prints as an empty string (followup `roku-log-longinteger-double-empty`), so call `.toStr()` on one until that is fixed.

## Rules

- **Don't set up the log manager yourself.** `JRScene.init()` owns it, and `lint:log-manager-init` enforces that.
- **Don't create a `log.Logger` in anything built before the scene exists** (`setGlobals()`, early `main.bs`). It stores `invalid` and never logs. Use `print` where it is allowed.
- **Import the logger** in every file that logs.
- **Create one logger per component or class**, so each line shows where it came from.
- **Pick the level by the table above**, so filtering works.
- **Use `m.log.*`, not `print`.** `print` is allowed only in `source/main.bs` and in the `#if debug` block of `source/utils/globals.bs`. The `print-locations` BrighterScript plugin enforces this (see [build-and-tooling.md](../architecture/build-and-tooling.md)).
