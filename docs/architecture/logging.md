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

# Logging

How JellyRock's logging works inside: its two parts, where and when the log manager starts, and why that point cannot move. To log from your code, see the how-to in [`docs/dev/logging.md`](../dev/logging.md). Debug tooling is in [`debug-tools.md`](debug-tools.md), test setup in [`testing.md`](testing.md).

## roku-log

JellyRock logs through code adopted from roku-log 0.11.1: named loggers and per-logger levels. The app uses one transport, `log_PrintTransport`, which writes to the debug console.

### Logging is two parts, and both are ours

Say which one you mean. They fail differently, and a bug in the second reads like a bug in the first.

| | What | Where it came from |
|---|---|---|
| **Runtime** | [`source/logging/Logger.bs`](../../source/logging/Logger.bs) (`log.Logger`, `log.initializeLogManager`) and [`components/logging/Log.bs`](../../components/logging/Log.bs) (the `log_Log` manager node) | Adopted from roku-log 0.11.1, whose last release was in 2023. Its [README](../../source/logging/README.md) lists every change from upstream. Edit it like any other code ([ADR 0054](../adr/0054-owned-code-gets-every-check.md)) |
| **Compile-time plugin** | [`scripts/bsc-plugins/roku-log.cjs`](../../scripts/bsc-plugins/roku-log.cjs): `strip`, `insertPkgPath`, `guard`, `removeComments`, and the `log-too-many-values` check, which fails a call with more values than the runtime function takes once `insertPkgPath` has added its argument | Written from scratch to replace the unmaintained `roku-log-bsc-plugin@0.9.0-beta.1`, which BrighterScript v1 broke |

**The console format is a contract.** `npm run measure` parses `<LEVEL> file://<path>:<line> <message>` (`LOG_LINE` in [`scripts/measurements.js`](../../scripts/measurements.js)), so a change to how `Logger.log()` writes a line must keep that shape or update the parser in the same change.

So when logging misbehaves, first ask which part is at fault. The plugin rewrites your source before the compiler sees it, so it can add a statement your file never contained (see the next section).

### The `guard` transform only knows `m.log`

With `guard` on, the plugin wraps each `m.log.<level>()` call in `if m.__le = true then …`. To feed that check, it adds `m.__le = m.log.enabled` after every `m.log = new log.Logger(…)`.

**Both halves are written for `m.log` only, and the added line is limited to that target on purpose.** A logger kept under another name gets no cache line: nothing would read it, since its calls are not guarded, and the line itself reads an `m.log` the scope may not have. That once crashed the app at launch. [`source/utils/screenReadiness.bs`](../../source/utils/screenReadiness.bs) keeps its logger in `m.screenLoadLog`, and the added line faulted (`&hec`, `'Dot' Operator ... invalid`) the first time main-thread code in `source/loginRouter.bs` called it, a scope with no `m.log`. Every component sets `m.log` in `init()`, which hid the coupling until a main-thread caller existed.

So `source/` code on the main thread can log without a component-style `m.log`, but a second logger in one scope gets no guard caching. The regression tests are in [`tests/scripts/unit/bsc-plugins/roku-log.test.js`](../../tests/scripts/unit/bsc-plugins/roku-log.test.js).

## Starting the log manager

`JRScene.init()` starts the log manager once. The level depends on the `debug` compile-time constant in `manifest`, which is `false` as committed:

```brighterscript
#if debug
  log.initializeLogManager(["log_PrintTransport"], 4) ' Debug: everything
#else
  log.initializeLogManager(["log_PrintTransport"], 2) ' Production: error + warn + info
#end if
```

A call is written when its level number is at most the manager's level: `0` error, `1` warn, `2` info, `3` verbose, `4` debug. So a normal sideloaded build writes error, warn and info. Seeing verbose or debug lines means building with `debug=true`, which changes other behavior too (tech-debt entry `log-level-welded-to-debug-const`). A production build removes every `m.log` call at compile time (`strip`), so it logs nothing at any level.

### Why the start must come first

`new log.Logger()` looks up `m.global.rLog` once and keeps it, and every level method starts with `if m.rLog = invalid then return`. So a component whose `init()` runs before the manager exists logs nothing, ever, at any level, with no error. The `NO LOGGER FOUND` fallback in the library is never reached by the level methods.

The start used to live in `JRScreen.init()`, on the assumption that a screen always starts first. It does not: `setGlobalNodes()` runs before the first screen mounts, so `JRScene` itself, `RemoteControlTask`, `SceneManager`, `QueueManager` and `SideEffectTask` never wrote a log line. `JRScreen` no longer starts the manager, and `npm run lint:log-manager-init` ([`log-manager-init-check.js`](../../scripts/lint/log-manager-init-check.js)) keeps it that way: one call, in `JRScene.bs`, as the first statement of its `init()`. No unit test can catch this: the test suites skip `Main()` and set up their own `rLog`.

### Why it cannot start earlier

`JRScene.init()` is the earliest point in the app that can create the manager. `initializeLogManager` creates a `log_Log` node, whose own `init()` always creates a `Timer` (`init()` in [`components/logging/Log.bs`](../../components/logging/Log.bs)). Creating a `Timer` on the main thread before `m.screen.show()` fails. Measured 2026-08-02 on a Streaming Stick 4K, Roku OS 15.2.4:

```text
[probe] bare Timer pre-show   → type=Invalid
        BRIGHTSCRIPT: ERROR: roSGNode: Failed to create roSGNode with type Timer
        → library then faults: "Invalid value for left-side of expression. (runtime error &he4)"
[probe] bare Timer post-show  → type=roSGNode        ✅
[probe] log_Log   post-show   → type=roSGNode        ✅
```

The limit is about when, not which thread. It matches the note in [`globals.bs`](../../source/utils/globals.bs) that SceneGraph nodes must be created after `m.screen` is shown. A plain `ContentNode` can be created earlier, which is why `setGlobals()` works where `Main()` calls it, before `m.screen.show()`; a `Timer` cannot. `JRScene.init()` runs on the render thread after the screen exists, so it can create both.

When `m.global.rLog` becomes valid on the main thread, measured on the same date and device over three cold starts with the same result:

| Point in `main.bs` | `rLog` valid? |
|---|---|
| before `CreateScene("JRScene")` | ❌ |
| after `CreateScene("JRScene")` | ❌ |
| after `m.screen.show()` | ✅ |

So `m.screen.show()` is the point to sync on: it does not return until `JRScene.init()` has finished.

### The startup window has no logger

Nodes created in `setGlobals()`, which `Main()` calls, are built before any manager can exist, so their `m.log` never writes. Today that is `JellyfinUserSettings`: its `init()` line and the startup `enableAutoSync` call are lost. Nothing shows it at run time, because `user.Login()` creates a new `JellyfinUserSettings` after the scene is up, and that one logs normally.

**Do not create a `log.Logger` in anything built before the scene exists.** Use `print` there, as `main.bs` does. `lint:log-manager-init` fails on a new one; `JellyfinUserSettings` is its one recorded exception. If you add a global node that logs, check its output on a device: a silent logger looks the same as a quiet one.

## Masking what a line could leak

Console logs get shared: pasted into issues, and copied into `.device-runs/` by `scripts/lib/console-capture.js`. So `Logger.log()` passes every line through `log.Redactor` (in [`source/logging/Logger.bs`](../../source/logging/Logger.bs)) before it is written, in every build:

| Found | Becomes |
|---|---|
| A token, API key or `AccessToken` value (`ApiKey=`, `api_key=`, `Token="…"`, JSON keys) | `<token:xxxx>`, the first 4 hex characters of its `MD5` hash |
| A device ID (`DeviceId=`, `deviceId=`) | `<device:xxxx>` |
| A password, a secret, or user info in a URL | `<secret>` |
| The `Device=` field of the `Authorization` header (the Roku's user-set name) | `<device-name>` |
| A URL host, or a bare `IPv4` address | `<loopback>`, `<lan-ip>`, `<public-ip>`, `<lan-host>` or `<host>` |

**A fingerprint still answers the debugging question.** Two lines with the same `<token:…>` used the same token, and a host class still says whether the app talked to the LAN, the internet or itself. Scheme, port, path and query keys stay. Item and user IDs stay too: they identify nothing alone.

**Free text cannot be masked, so the build keeps it out.** A title or a person's name has no shape the redactor could find. The `log-personal-text` check in [`roku-log.cjs`](../../scripts/bsc-plugins/roku-log.cjs) fails an `m.log` argument whose name says it holds one (`rowTitle`, `item.name`, `username`, `groupName` and the like).

**The redactor adds no thread crossing.** It reads no node and keeps no shared state, only its compiled patterns and a fingerprint cache, and a `Logger` builds it on its first line. Its cost per line on a device is not measured yet: `tests/source/unit/logging/RedactorCost.spec.bs` prints it through `test:tdd`. A production build strips every `m.log` call, so the cost is a dev and test build cost.

**Not covered:** `print` statements, which bypass the logger; the `[http]` request trace of `roku-requests`, which prints each request's full URL and headers, token included, in every build; and Roku OS's own console lines. The first two are followups `log-print-through-redactor` and `rr-http-trace-leaks-token` in [`docs/progress.md`](../progress.md).

## Where `print` is allowed

The `print-locations` plugin flags a `print` wherever an `m.log` is available: any function in a component, and any class method. It allows `print` where no logger can exist: `source/main.bs`, the `#if debug` block in `source/utils/globals.bs`, and free functions in `source/`, which have no `m` to hold one. The logging runtime's own `print` statements are suppressed line by line, since they are the console output. Unlike `m.log` calls, a `print` is not stripped from a production build.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md): `log-level-welded-to-debug-const` and `no-lint-for-mlog-without-logger`. The runtime's known bugs are listed in its [README](../../source/logging/README.md#known-issues).
