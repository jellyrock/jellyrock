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
  - manifest
  - scripts/harden-prod-manifest.js
last-reviewed: 2026-10-09
---

# Debug flags and toast testing

How to see an error path or a toast on a device without waiting for the real failure. There are two tools:

- **`testToast`**, a field on the scene that shows any toast. It is in every build.
- **Debug flags**, fields on `m.global.debug` that force a failure in one code path. They exist only in a debug build.

## Make a debug build

1. In `manifest`, change `bs_const=debug=false` to `bs_const=debug=true`. Don't commit this change.
2. Build and sideload with `make build-dev install` ([DEVGUIDE](DEVGUIDE.md)).
3. In the console (`telnet <roku-ip> 8085`), look for `[DEBUG] DebugFlags node initialized on m.global.debug` at startup. It lists the flags.

## Use the console

The BrightScript console runs a command only while the app is paused. Press Ctrl-C in the console to pause it. The `Brightscript Debugger>` prompt appears, and `c` resumes the app.

Ctrl-C pauses whichever thread was running, so check the location the debugger prints:

- **On the main thread** (`pkg:/source/main.brs`), `m.top` is invalid. `Main()` keeps the scene in `m.scene`.
- **On a component thread** (any `pkg:/components/` path), reach the scene with `m.top.getScene()`.

`m.global` works from both.

## Show a toast

Set `testToast` on the scene to `"type|message"`. The type is `error`, `success`, `warning` or `info`; with no `|`, the whole value is an `error` message.

From the console, paused on the main thread:

```brightscript
m.scene.testToast = "success|Item saved"
```

Paused on a component thread:

```brightscript
m.top.getScene().testToast = "error|Something went wrong"
```

Without pausing the app, from an RTA build ([`rta-tests.md`](rta-tests.md)), set it through the on-device component:

```js
await odc.setValue({ base: 'scene', keyPath: 'testToast', value: 'success|Item saved' });
```

If `testToast` shows nothing, the fault is in the toast component, not in the code you are testing.

### The up-up-down-down code

A debug build also shows a test toast when you press **Up, Up, Down, Down** with no more than 2 seconds between presses. Each use shows the next type: error, success, warning, info. It rarely works: `JRScene` sees the key releases only while the focus is outside the router outlet, because `RowList` and the outlet consume them (the comment above `JRScene.onKeyEvent()` explains why). Use `testToast` instead.

## Force a failure

Set a flag from the console, then do what the table says:

```brightscript
m.global.debug.shouldForceFavoriteFail = true
' resume with c, press the favorite button, see the error toast
m.global.debug.shouldForceFavoriteFail = false
```

| Flag | What it does | How to see it |
| --- | --- | --- |
| `shouldForceFiltersFail` | `BaseGridView.loadFilters()` skips the request and reports a failure | Open a library with filters, such as Movies |
| `shouldForceFavoriteFail` | `ItemDetails.toggleFavorite()` treats the server's answer as a failure, which reverts the button and shows an error toast | Press the favorite button on an item's details screen |
| `shouldForceWatchedFail` | `ItemDetails.toggleWatched()` does the same for the watched button | Press the watched button on an item's details screen |
| `extraButtonCount` | Adds this many spare buttons to the button rows on the details screen and the playback OSD | Set it, then open (or reopen) a details screen or the OSD |

The flags default to off, and a flag is read where its code path starts, so a change applies the next time that path runs.

### `extraButtonCount`: seeing the More button

A button row holds what fits before the element to its right: 8 buttons on the details screen and 10 on the OSD. Past that, the extra buttons move into a **More** menu. Real items never fill either row: the details screen tops out at 8 and the OSD at 7. So without this flag, nobody can see **More** on a device.

It is a count, not a switch, because rows start at different lengths. A person has 3 buttons on the details screen; a series with a trailer, for a user who may delete it, has 8. A row is built when its screen opens, so reopen the screen after a change.

- **Use `8`** to see **More** and its menu on every item type.
- **To find the edge**, where a row is exactly full and shows no **More**, lower the count one at a time until **More** disappears.

The spare buttons have a label and an icon, so the row and the menu look as they would with real buttons. They do nothing when pressed.

## Add a flag

**If the failure is an API request failing or timing out, don't add a flag.** On-device specs can fail any pooled request with `rtaFailRequests` ([`rta-tests.md`](rta-tests.md#making-requests-fail-or-slow-rtafailrequests)). A flag for each code path would repeat that once per screen.

For any other failure:

1. Add a field to [`DebugFlags.xml`](../../components/data/DebugFlags.xml), default `false` (or `0` for a count):

   ```xml
   <field id="shouldForceMyThingFail" type="boolean" value="false" />
   ```

2. Add it to the `[DEBUG]` lines `setGlobalNodes()` prints in [`globals.bs`](../../source/utils/globals.bs), so the console lists it.
3. Check the flag where the code path starts, inside `#if debug`, before the real work. `BaseGridView.loadFilters()` is the model:

   ```brightscript
   #if debug
     if isValid(m.global.debug) and m.global.debug.shouldForceMyThingFail
       deliverResult({}, "[DEBUG] Forced failure")
       return
     end if
   #end if
   ```

4. Add a row to the table above.
5. Make a debug build, set the flag from the console and watch the failure path run.

The rules for every flag:

- **Inside `#if debug`.** Every line that reads a flag sits inside `#if debug` and `#end if`.
- **Check `isValid(m.global.debug)` first.** The node does not exist in a release build or in test builds.
- **`[DEBUG]` on injected messages,** so a forced failure is easy to tell from a real one in a toast or a log.
- **Simulate failures only.** Never put real behavior behind a flag. `extraButtonCount` is the one flag that adds something, and it adds only inert buttons.

## Why a release build has none of this

`#if debug` is resolved by the Roku device, not by `bsc`. BrighterScript copies the directives into the `.brs` it emits, and the device compiles them against the `bs_const` line in the installed manifest. So a release build loads none of the debug code and never creates the `DebugFlags` node. Two consequences:

- To check whether a build has debug on, read `build/manifest`. The `.brs` files always contain the `#if debug` blocks.
- `manifest.bs_const` in a `bsconfig` file cannot turn debug off; it changes only BrighterScript's own copy of the manifest. See [Compile-time flags](../architecture/build-and-tooling.md#compile-time-flags-bs_const).

[`harden-prod-manifest.js`](../../scripts/harden-prod-manifest.js) is what guarantees it. It runs last in `npm run build:prod` and forces `debug`, `ENABLE_RTA` and `perfTiming` off in `build/manifest`, so no release can ship with them on. A committed `debug=true` has reached `main` twice (`27d99141`, `dc05db8d`), so a convention alone was not enough.

## What else a debug build gives you

### `rawApiData`: what the server sent for an item

Every item node that `JellyfinDataTransformer` builds carries the server's original `BaseItemDto` on its `rawApiData` field ([`JellyfinBaseItem.xml`](../../components/data/jellyfin/JellyfinBaseItem.xml)). Nothing in the app reads it. It answers one question at a breakpoint: is a tile wrong because of our transform, or because of what the server sent?

```brightscript
print node.rawApiData
print node.rawApiData.UserData
```

`curl` is often easier. The console's `[http]` trace prints each request's URL and auth token, so you can fetch the same response again and compare. `rawApiData` saves you working out which request produced which node.

An RTA build cannot read it: `npm run test:rta` turns on `ENABLE_RTA` only, so `debug` stays off and `rawApiData` is `invalid`.

### The Task-thread readout

`printTaskThreads()` prints how many Task threads are live. See [`debug-tools.md`](../architecture/debug-tools.md#task-thread-readout--printtaskthreads).

**Never measure performance on a debug build.** Measured 2026-08-04 at n=10, a debug build painted Home 178 ms slower on a 512 MB Stick and 121 ms slower on a Stick 4K. See [`home-first-paint-performance.md`](home-first-paint-performance.md).

## Troubleshooting

- **`m.global.debug` is invalid.** The build has `debug=false`. Check `build/manifest`, then rebuild.
- **`Interface not a member of BrightScript Component` (`&hf3`) on `m.top`.** The console is paused on the main thread. Use `m.scene` (see [Use the console](#use-the-console)).
- **A flag is set but nothing happens.** Check the name's spelling against `DebugFlags.xml`. Then run the path again: a flag is read when its path starts, and a button row is built when its screen opens.
