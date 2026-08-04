---
topic: debug-flags
related-files:
  - components/data/DebugFlags.xml
  - source/utils/globals.bs
  - components/JRScene.bs
  - components/JRScene.xml
  - source/data/JellyfinDataTransformer.bs
  - components/data/jellyfin/JellyfinBaseItem.xml
  - source/utils/tasks.bs
last-reviewed: 2026-08-04
---

# Debug Flags & Toast Testing

## Overview

JellyRock includes a compile-time debug system for testing error paths, toast notifications, and edge cases that are difficult to reproduce naturally. The system has **zero presence in production builds** — the BrighterScript compiler removes all debug code when `bs_const=debug=false`.

**Two tools are available:**

1. **`testToast`** — Trigger any toast directly from the BrightScript console (always available)
2. **`DebugFlags`** — Inject failures into specific code paths to test real error flows (debug builds only)

---

## Quick Start

### Test a Toast Visually (Cheat Code)

Enter **up, up, down, down** on the d-pad within 2 seconds. Each activation cycles through error → success → warning → info toast types. This requires a debug build (`bs_const=debug=true`).

### Test a Toast Visually (Console)

From the BrightScript console (telnet to port 8085) — **only works when app is paused at a breakpoint**:

```brightscript
m.top.getScene().testToast = "error|Something went wrong"
m.top.getScene().testToast = "success|Item saved"
m.top.getScene().testToast = "info|Loading..."
m.top.getScene().testToast = "Just a message"          ' defaults to error type
```

### Trigger an Error Path

1. Set `bs_const=debug=true` in the `manifest` file
2. Build and sideload the app
3. From the BrightScript console:

```brightscript
m.global.debug.shouldForceFiltersFail = true
```

1. Navigate to a movie library — the filter task takes the failure branch, and a toast appears
2. Turn it off:

```brightscript
m.global.debug.shouldForceFiltersFail = false
```

---

## Toast Testing

### Cheat Code (Recommended)

In a debug build, enter **up, up, down, down** on the d-pad within 2 seconds to trigger a test toast. Each activation cycles through error → success → warning → info. This works while the app is running normally — no console or breakpoint needed.

**Compiled out in production** via `#if debug`.

### `testToast` Field (Console Fallback)

The `testToast` field on `JRScene` provides programmatic toast triggering. It is always available (not behind `#if debug`) because it has negligible footprint and the BrightScript console is only accessible on side loaded dev builds anyway.

**Important:** The BrightScript console (both VS Code and telnet port 8085) can only evaluate expressions when the app is **paused at a breakpoint**. For live testing, use the key combo above.

**Format:** `"type|message"` where type is `error`, `success`, `warning`, or `info`. If no pipe is found, defaults to `error`.

**Use for:** Programmatic toast testing from breakpoints or automated test scripts.

---

## `DebugFlags` System (Option C)

### Architecture

```text
manifest: bs_const=debug=true
    |
    v
globals.bs: initDebugFlags()          <-- #if debug, compiled out in prod
    |
    v
m.global.debug (DebugFlags node)      <-- does not exist in prod builds
    |
    v
Task code: #if debug check flag       <-- entire block compiled out in prod
    |
    v
Simulated failure --> toast
```

### Components

| File | Purpose |
| ------ | --------- |
| `components/data/DebugFlags.xml` | Node definition with boolean fields for each injectable failure |
| `source/utils/globals.bs` | Creates and attaches the `DebugFlags` node to `m.global.debug` inside `#if debug` |

### Production Safety

The system uses BrighterScript's `#if debug` conditional compilation:

- `bs_const=debug=false` (manifest default) — the compiler **removes all `#if debug` blocks entirely**. No dead code, no runtime checks, no node creation. The `DebugFlags` XML component exists in the package but is never instantiated.
- `bs_const=debug=true` (set during development) — all debug code is active.
- The commit skill enforces `bs_const=debug=false` before commits land.

### Available Flags

| Flag | What It Does | Where to Test |
| ------ | ------------- | --------------- |
| `shouldForceFiltersFail` | Skips the API call in `GetFiltersTask` and simulates a failure response | Navigate to any library with dynamic filters (e.g., Movies) |
| `shouldForceFavoriteFail` | Forces the favorite toggle API response to appear failed | Press the favorite button on any `ItemDetails` screen |
| `shouldForceWatchedFail` | Forces the watched toggle API response to appear failed | Press the watched button on any `ItemDetails` screen |

---

## Adding a New Debug Flag

Follow these steps when adding error injection to a new feature:

### Step 1: Add the field to DebugFlags.xml

```xml
<!-- components/data/DebugFlags.xml -->
<interface>
  <field id="shouldForceFiltersFail" type="boolean" value="false" />
  <field id="shouldForceMyNewThingFail" type="boolean" value="false" />  <!-- ADD -->
</interface>
```

### Step 2: Add the injection guard in the task

Place the `#if debug` block **before** the real API call so it short-circuits early:

```brightscript
sub myTask()
  ' Debug error injection — compiled out in production (bs_const=debug=false)
  #if debug
    if isValid(m.global.debug) and m.global.debug.shouldForceMyNewThingFail
      m.top.error = "[DEBUG] Forced failure"
      m.top.result = {}    ' or whatever the failure shape is
      return
    end if
  #end if

  ' Real implementation follows...
end sub
```

### Step 3: Update the Available Flags table above

Add your flag to the table in this document so other developers know it exists.

### Step 4: Test it

```brightscript
' From BrightScript console (port 8085):
m.global.debug.shouldForceMyNewThingFail = true
' Navigate to the feature, verify the error path fires
m.global.debug.shouldForceMyNewThingFail = false
```

---

## Other things a debug build gives you

`#if debug` carries more than the flags above. These are not toggles — they are simply present in any build compiled with `bs_const=debug=true`.

### `rawApiData` — the server's payload, attached to the item

Every node `JellyfinDataTransformer` produces carries the **raw `BaseItemDto` the server sent**, on the `rawApiData` field ([`JellyfinBaseItem.xml`](../../components/data/jellyfin/JellyfinBaseItem.xml)). Nothing in the app reads it; it exists purely for a human at a breakpoint asking *"why is this tile rendering wrong — is our transform wrong, or did the server send that?"*

```brightscript
' From a paused BrightScript console, with an item node in hand:
print node.rawApiData
print node.rawApiData.UserData
```

**When to prefer `curl` instead.** For most questions the payload is easier to get from outside the app: the firmware's `[http]` console trace prints the full request URL *and* the auth token, so re-fetching any response is a one-liner and the result is diffable and repeatable. `rawApiData`'s advantage is narrow but real — it is the payload bound to *this specific node*, so you skip working out which request produced which tile.

**Not reachable from RTA.** ODC can read node fields, but `npm run test:rta` flips `ENABLE_RTA` only — the committed manifest keeps `debug=false`, so `rawApiData` reads `invalid` in any normal RTA run. Automated/agent-driven inspection wants `curl`.

**Cost.** Measured on three device tiers (n=10 each, `debug=true` with and without the assignment): no difference in Home's first paint distinguishable at that sample size, and available-memory differences under 700 `kB`, inside the noise of the reading itself. That bounds it below roughly 120 ms — the smallest effect that experiment could resolve — rather than proving it free.

### The Task-thread ledger

`printTaskThreads()` and `m.global.taskLedger` — see [`debug-tools.md`](../architecture/debug-tools.md).

> ⚠️ **A debug build is not a performance-representative build.** The two items above measurably slow Home's first paint on weaker hardware (+178 ms on a 512 MB Stick, +121 ms on a Stick 4K; both significant at n=10). Never take a perf baseline from one — see [`home-first-paint-performance.md`](home-first-paint-performance.md).

---

## Rules

1. **All debug code must be inside `#if debug` / `#end if`** — this is the compile-time guarantee
2. **Always check `isValid(m.global.debug)`** before reading a flag — the node does not exist in production and may not exist in test harnesses
3. **Default all flags to `false`** in the XML — flags are opt-in, never accidentally on
4. **Prefix injected error messages with `[DEBUG]`** so they are immediately distinguishable from real errors in the toast UI and logs
5. **One boolean field per injectable failure** — keep it simple, no complex configuration
6. **Never gate real functionality behind debug flags** — they are strictly for simulating failures

---

## Troubleshooting

### "m.global.debug is invalid"

You are running a production build (`bs_const=debug=false`). Set `bs_const=debug=true` in the manifest and rebuild.

### Flag is set but nothing happens

1. Verify the flag name matches exactly (case-sensitive)
2. Check the task has the `#if debug` guard for that specific flag
3. Make sure you rebuilt after changing the manifest — `bs_const` is a compile-time constant

### Toasts not appearing

Use `testToast` to verify the toast component itself works:

```brightscript
m.top.getScene().testToast = "error|Test"
```

If this doesn't show a toast, the issue is in the Toast component, not the debug system.
