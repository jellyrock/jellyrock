---
topic: debug-tools
related-files:
  - components/data/DebugFlags.xml
  - components/JRScene.bs
  - components/JRScene.xml
  - source/utils/globals.bs
  - source/utils/tasks.bs
last-reviewed: 2026-08-03
---

# Debug Tools

The debug-only error injection system, the toast cheat code, the `testToast` field, and the Task-thread readout. Logging primitives live in `logging.md`. Test infrastructure lives in `testing.md`.

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

## Task-thread readout — `printTaskThreads()`

Roku OS caps an app instance at 100 concurrent threads and raises `&h29` past it — the crash class behind epic #728. The readout answers "how many Task threads are live right now?" on a real device, so that bound is measured rather than argued about.

`launchTask()` (`source/utils/tasks.bs`) is the one place a Task thread starts; the `no-raw-run` BSC plugin makes a bare `control = "RUN"` anywhere else a build error. In a debug build each launch is recorded into `m.global.taskLedger`, and the count is **derived** on demand by reading each tracked node's `state` — a terminated thread stops counting toward Roku's cap even though the node stays valid, so `state` is the authoritative signal and a `control = "STOP"` needs no bookkeeping call of its own.

From the BrightScript console (port 8085), with the app paused at a breakpoint:

```brightscript
printTaskThreads()
```

```text
[TASKS] live=2 tracked=2
[TASKS]   ServerReachableTask id=probeA state=run
[TASKS]   ServerReachableTask id=probeB state=run
[TASKS] (app launches only — excludes main, render, and any thread not started via launchTask)
```

The caveat in that last line matters when comparing against Roku's cap: the ledger sees the app's own launches, not the main and render threads or the vendored `WebSocketClient` that `RemoteControlTask` starts on its own thread. Add roughly three to the reported number for a total.

The ledger and the readout are both inside `#if debug`, so production pays nothing — the shell is excluded at load by the device's BrightScript compiler from `bs_const=debug=false`, exactly as the debug flags above are. The ledger *arithmetic* (`pruneTaskLedger`, `countLiveTaskThreads`, `taskThreadIsLive`) deliberately sits outside the gate as pure functions, because test builds compile with `debug=false` and anything inside the gate is unreachable from Rooibos.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for debug-tools / `JRScene` entries.
