---
topic: logging
related-files:
  - components/JRScene.bs
  - components/JRScreen.bs
  - scripts/bsc-plugins/roku-log.cjs
last-reviewed: 2026-08-15
---

# Logging

How JellyRock logs (`roku-log`), the initialization story, and the per-component pattern. Debug-time tooling lives in `debug-tools.md`. Test infrastructure lives in `testing.md`.

## roku-log

JellyRock uses **roku-log** (`log` ropm package) for all logging. It supports multiple transports (telnet, on-screen overlay), structured logging with named loggers, and per-logger log levels.

### "roku-log" is TWO artifacts, and only one of them is ours

Say which one you mean. They fail differently, and a bug in the second reads like a bug in the first:

| | What | Who owns it |
|---|---|---|
| **Runtime library** | `source/roku_modules/log/` + `components/roku_modules/log/` — `Logger`, the transports, `initializeLogManager` | **Upstream, stock.** `npm:roku-log@0.11.1`, vendored by ropm, which mechanically prefixes every symbol (`Logger` → `log_Logger`, `"Log"` → `"log_Log"`) |
| **Compile-time plugin** | [`scripts/bsc-plugins/roku-log.cjs`](../../scripts/bsc-plugins/roku-log.cjs) — `strip` / `insertPkgPath` / `guard` / `removeComments` | **Ours outright.** Written from scratch to replace the unmaintained `roku-log-bsc-plugin@0.9.0-beta.1`, which BSC v1 broke. Nothing upstream to sync from |

**Never hand-edit the vendored runtime files.** `roku_modules` is gitignored ([`.gitignore`](../../.gitignore)), so those files are untracked and regenerated on every install — an edit there is not a change to the project, it is a change that disappears at the next `npm i` with nothing to show it was ever made. The only differences between the installed copy and the npm package are the prefixes ropm adds; verify with
`diff node_modules/log/dist/source/LogMixin.brs source/roku_modules/log/LogMixin.brs`.

So when logging misbehaves, ask which artifact first. The plugin REWRITES your source before the compiler sees it, which means it can inject a statement your file never contained — see the guard rule below.

### The `guard` transform only knows `m.log`

With `guard` on, the plugin wraps `m.log.<level>()` calls in `if m.__le = true then …` and injects
`m.__le = m.log.enabled` after `m.log = new log.Logger(…)` to cache the check.

**Both halves are hardcoded to `m.log`, and the injection is deliberately restricted to that target.**
A logger kept under any other name gets no cache line — nothing would read it (its calls are not
guarded), and the read itself dots into an `m.log` the scope need not have. That is not theoretical:
[`source/utils/screenReadiness.bs`](../../source/utils/screenReadiness.bs) keeps its logger on
`m.screenLoadLog`, and the injection crashed the app at launch (`&hec`, `'Dot' Operator ... invalid`)
the first time the ledger was called from **main-thread** `source/loginRouter.bs` — a scope with no
`m.log` of its own. Every instrumented *component* sets `m.log` in `init()`, which is why the coupling
stayed hidden until a main-thread caller existed.

Practical consequence: **a component-style `m.log` is not a prerequisite for logging from `source/`
main-thread code**, but a second logger in one scope will not get guard caching. Regression coverage
lives in [`tests/scripts/unit/bsc-plugins/roku-log.test.js`](../../tests/scripts/unit/bsc-plugins/roku-log.test.js).

### Initialization

`JRScene.bs:init()` initializes the log manager **once**, with different default log levels per build:

```brightscript
sub init()
  #if debug
    log.initializeLogManager(["log_PrintTransport"], 4)   ' debug: everything
  #else
    log.initializeLogManager(["log_PrintTransport"], 2)   ' prod: error+warn+info
  #end if
end sub
```

**Initialization order is load-bearing.** `log.Logger.new()` resolves `m.global.rLog` **once** and
caches it; every level method then opens with `if m.rLog = invalid then return`. A component whose
`init()` runs before the manager exists therefore logs **nothing, forever, at any level, on any
build** — silently, with no error (the `NO LOGGER FOUND` fallback lives on `m.log`, which the level
methods never reach).

This used to live in `JRScreen.init()` on the assumption that a screen always initializes first. That
assumption was false: `setGlobalNodes()` runs before the first screen mounts, so `JRScene` itself plus
`RemoteControlTask`, `SceneManager`, `QueueManager` and `SideEffectTask` never emitted a single log
line. `JRScreen` no longer initializes the manager at all.

#### Why it can't move earlier — the node-creation constraint before `show()`

`JRScene.init()` is not merely a convenient early hook, it is **the earliest point in the app that
can create the manager**. `initializeLogManager` creates a `log_Log` node, and that node's own
`init()` unconditionally creates a `Timer` (`components/roku_modules/log/Log.brs`). Creating a
`Timer` on the **main thread before `m.screen.show()`** fails — verified on device (Streaming Stick
4K, OS 15.2.4):

```text
[probe] bare Timer pre-show   → type=Invalid
        BRIGHTSCRIPT: ERROR: roSGNode: Failed to create roSGNode with type Timer
        → library then faults: "Invalid value for left-side of expression. (runtime error &he4)"
[probe] bare Timer post-show  → type=roSGNode        ✅
[probe] log_Log   post-show   → type=roSGNode        ✅
```

This is a **lifecycle** constraint, not a thread one, and it confirms the note in
[`globals.bs`](../../source/utils/globals.bs) that "`roSGNode`s must be created after `m.screen` is
shown" — plain `ContentNode`s tolerate earlier creation (which is why `setGlobals()` works at
`main.bs:9`), SceneGraph node types like `Timer` do not. `JRScene.init()` runs on the **render
thread**, where node creation is unrestricted, which is why it works there.

Measured availability of `m.global.rLog` on the main thread (3/3 identical cold starts):

| Point in `main.bs` | `rLog` valid? |
|---|---|
| before `CreateScene("JRScene")` | ❌ |
| after `CreateScene("JRScene")` | ❌ |
| after `m.screen.show()` | ✅ |

So `m.screen.show()` is the synchronization point — it does not return until `JRScene.init()` has
completed.

#### Known consequence: the bootstrap window has no logger

Nodes created in `setGlobals()` (`main.bs:9`) are constructed **before any manager can exist**, so
their `m.log` is permanently dead. Today that is `JellyfinUserSettings` — its `init()` line and the
bootstrap `enableAutoSync` call are lost. It is not visible at runtime because
`SessionDataTransformer.transformUserInfo` creates a **fresh** `JellyfinUserSettings` at login, and
that instance (created after the scene is up) logs normally.

**Rule: do not construct a `log.Logger` in anything created before the scene exists.** Use `print`
there, as `main.bs` does. If you add a component that logs from a global node, verify its output
on-device — a silent logger looks identical to a quiet one.

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
