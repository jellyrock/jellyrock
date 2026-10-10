---
topic: logging
related-files:
  - components/JRScene.bs
  - components/JRScreen.bs
  - scripts/bsc-plugins/roku-log.cjs
last-reviewed: 2026-10-10
---

# Logging

How JellyRock's logging works inside: the two parts of roku-log, where and when the log manager starts, and why that point cannot move. To log from your code, see the how-to in [`docs/dev/logging.md`](../dev/logging.md). Debug tooling is in [`debug-tools.md`](debug-tools.md), test setup in [`testing.md`](testing.md).

## roku-log

JellyRock logs through roku-log (the `log` ropm package): named loggers, per-logger levels and a choice of transports. The app uses one transport, `log_PrintTransport`, which writes to the debug console.

### "roku-log" is two artifacts, and only one of them is ours

Say which one you mean. They fail differently, and a bug in the second reads like a bug in the first.

| | What | Who owns it |
|---|---|---|
| **Runtime library** | `source/roku_modules/log/` and `components/roku_modules/log/`: `Logger`, the transports, `initializeLogManager` | **Upstream, unchanged.** `npm:roku-log@0.11.1`, vendored by ropm, which prefixes every symbol (`Logger` becomes `log_Logger`, `"Log"` becomes `"log_Log"`) |
| **Compile-time plugin** | [`scripts/bsc-plugins/roku-log.cjs`](../../scripts/bsc-plugins/roku-log.cjs): `strip`, `insertPkgPath`, `guard`, `removeComments` | **Ours.** Written from scratch to replace the unmaintained `roku-log-bsc-plugin@0.9.0-beta.1`, which BrighterScript v1 broke. There is nothing upstream to sync from |

**Never hand-edit the vendored runtime files.** `roku_modules` is gitignored, so those files are regenerated on every install: an edit there disappears at the next `npm i` and leaves no trace. The installed copy differs from the npm package only by the prefixes ropm adds. To check:

```bash
diff node_modules/log/dist/source/LogMixin.brs source/roku_modules/log/LogMixin.brs
```

So when logging misbehaves, first ask which artifact is at fault. The plugin rewrites your source before the compiler sees it, so it can add a statement your file never contained (see the next section).

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

`JRScene.init()` is the earliest point in the app that can create the manager. `initializeLogManager` creates a `log_Log` node, whose own `init()` always creates a `Timer` (`components/roku_modules/log/Log.brs`). Creating a `Timer` on the main thread before `m.screen.show()` fails. Measured 2026-08-02 on a Streaming Stick 4K, Roku OS 15.2.4:

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

## Where `print` is allowed

The `print-locations` plugin flags a `print` wherever an `m.log` is available: any function in a component, and any class method. It allows `print` where no logger can exist: `source/main.bs`, the `#if debug` block in `source/utils/globals.bs`, and free functions in `source/`, which have no `m` to hold one. Unlike `m.log` calls, a `print` is not stripped from a production build.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md): `log-level-welded-to-debug-const`, `no-lint-for-mlog-without-logger` and `ropm-hook-fails-silently`.
