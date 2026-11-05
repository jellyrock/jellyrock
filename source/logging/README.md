# Logging runtime (adopted from roku-log)

The `log.Logger` class, `log.initializeLogManager` and the `log_Log` manager node. JellyRock owns this code, and every check applies to it ([ADR 0054](../../docs/adr/0054-owned-code-gets-every-check.md)). How logging works in the app is in [`docs/architecture/logging.md`](../../docs/architecture/logging.md); how to log from your code is in [`docs/dev/logging.md`](../../docs/dev/logging.md).

- **Upstream:** [`georgejecook/roku-log`](https://github.com/georgejecook/roku-log), by George Cook
- **Pinned release:** `v0.11.1`, commit `a853601aa77b85c186a6b87f60247fcf663b27f4` (2023-05-15), the last release
- **License:** MIT (see [`LICENSE`](LICENSE), copied unchanged)
- **Files:** `source/logging/LogMixin.bs` (upstream `src/source/LogMixin.bs`) and `components/logging/Log.{bs,xml}` (upstream `src/components/Log.{bs,xml}`)

## Why it is here

roku-log has had no release since 2023, and installing it needed a post-install hook that rewrote its component XML, because ropm wrote script paths that did not exist (rokucommunity/ropm#69, rokucommunity/brighterscript#809). Owning the code removes the hook and the npm dependency, and lets us fix its bugs here.

## Local modifications

The public names are unchanged, so no call site changed: `log.Logger`, `log.initializeLogManager`, the `log_Log` component and the `"log_PrintTransport"` transport name. The console output is byte-identical, which `scripts/measurements.js` depends on.

- **Callback names match their functions.** Upstream observed `"log_onTransportsChange"` but named the function `onTransportsChange`, and relied on the renaming ropm did to make them match. Without ropm the callback never ran, `logMode` stayed `0`, and nothing printed. `tests/source/unit/logging/LogManager.spec.bs` guards it.
- **Three transports deleted:** `NodeTransport` (for RALE), `ScreenTransport` (an on-screen overlay) and `HTTPTransport` (which needed maestro's `mc_RequestTask`, absent from this app). Nothing used them. The manager still accepts any node with a `logItem(name, levelNum, text)` function as a transport.
- **Indentation deleted:** `increaseIndent`, `decreaseIndent`, `resetIndent` and `_changeIndent`, with the `logIndent` and `logIndentText` fields they kept on `m.global`. Nothing called them, but every log line read `m.global.logIndentText`, a thread crossing when the caller is a Task. The text was always empty, so the output is the same.
- **`method()` level deleted**, with the `isMethod` parameter of `log()`. Nothing called it.
- **Unreachable fallback deleted.** A `Logger` built with no manager replaced its `log` method with one that printed `NO LOGGER FOUND`, but every level method returns before calling it in that case.
- **Lint fixes:** `sub` for every function with no return value, consistent `rLog` casing, and comments rewritten. `onTransportsChange` now loops over the local it null-checks; upstream checked it and then looped over the field.

## Known issues

- A `LongInteger` or `Double` argument prints as an empty string (followup `roku-log-longinteger-double-empty` in `docs/progress.md`).
- `initializeLogManager` defaults `enabled` to `false` and `JRScene` does not pass it, so turning on the plugin's `guard` would silence every line (followup `log-enabled-default-false`).
- `onTransportsChange` reads `m.transports` but writes `m.top.transports`, so a transport node is never removed when the list changes. It matters only for a transport other than the print transport.
