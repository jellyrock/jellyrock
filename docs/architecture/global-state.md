---
topic: global-state
related-files:
  - source/utils/globals.bs
  - components/data/jellyfin/JellyfinUser.xml
  - components/data/jellyfin/JellyfinUserSettings.xml
  - components/data/jellyfin/JellyfinUserSettings.bs
  - components/data/jellyfin/JellyfinServer.xml
  - components/data/Constants.xml
  - components/data/jellyfin/AppInfo.xml
  - components/data/jellyfin/DeviceInfo.xml
last-reviewed: 2026-10-10
---

# Global state

What hangs off `m.global`, when each piece is created, and who changes it.

## The shape of `m.global`

`m.global` is Roku's app-wide node, one `roSGNode` that every thread can reach. JellyRock hangs typed nodes off it, each declared by an XML file in `components/data/` or `components/data/jellyfin/`. That XML is the schema: read it for the full field list. The tree below shows what each field is for and which phase creates it.

```text
m.global
│
│   Phase 1: setGlobals(), before the screen is shown
├── appLoaded             bool
├── server                JellyfinServer: URL, name, version, apiVersion, isConnected, and
│   │                     the capabilities read later:
│   ├── isQuickConnectEnabled   defaults to true; UserSelect's probe sets it false
│   ├── subtitleProviderStatus  "" until Home's session check (serverCapabilities.bs)
│   └── resumePolicy            invalid until ItemDetails first needs it (versionResume.bs)
├── user                  JellyfinUser: id, name, authToken, fontScaleFactor
│   ├── settings          JellyfinUserSettings, every per-user setting (see settings.md)
│   ├── config            JellyfinUserConfiguration, the server's profile for the user
│   └── policy            JellyfinUserPolicy, the server's permissions for the user
├── translations          AA of the current locale's strings
├── translationsFallback  AA, always en_US
├── translationLocale     locale code, such as "fr_CA"
├── taskLaunchQueue       field only; the node is created in phase 2
├── taskLaunchQueued      integer, launches waiting right now
├── constants             Constants: theme colors, alphas, font sizes, icon URIs
├── app                   AppInfo from roAppInfo, plus lastRunVersion from the registry
└── device                DeviceInfo from roDeviceInfo, plus isLowMemoryDevice
│
│   Phase 2: setGlobalNodes(), after the screen is shown
├── taskLaunchQueue       TaskLaunchQueue node, created before any Task starts
├── apiPoolWidth          integer, chosen per device class (api.md#pool-width)
├── apiPool0 … apiPool<apiPoolWidth-1>   ApiTask, one persistent thread per slot
├── apiQueue              ApiQueueTask, the FIFO coordinator
├── sideEffectTask        SideEffectTask, the fire-and-forget queue
├── sceneManager          SceneManager
├── AuthManager           the sign-in guard on every post-login route
├── deepLinkOpeningTitle  string, the title the player toasts on a deep-link launch
├── activeRoutedView      node, the screen the router has mounted
├── playbackLaunchRequest AA, QueueManager's request to open the player
├── photoLaunchRequest    AA, a request to open the photo viewer
├── queueManager          QueueManager
├── audioPlayer           AudioPlayer, which extends Video
├── remoteControlTask     RemoteControlTask, created here and started by Home after sign-in
├── debug                 DebugFlags                  #if debug
└── rtaSkeletonHoldMs, rtaFailRequests, …             #if ENABLE_RTA (test hooks)
│
│   Created on first use, by source/utils/tasks.bs and TaskLaunchQueue.bs
├── taskLedger            array of every Task node launchTask() started (every build)
├── taskLedgerRefusals, taskLedgerFirstRefused        #if perfTiming
├── taskLaunchQueuedTotal, taskLaunchQueuePeak        #if perfTiming
└── taskLedgerUs, taskLedgerLaunches                  #if perfTiming (ledger cost probe)
```

The two phases are described in [`bootstrap.md`](bootstrap.md#the-two-phase-global-setup). The `ENABLE_RTA` fields are explained beside their `addFields` call in `setGlobalNodes()`.

## Why typed nodes

Each XML file declares a component that extends `ContentNode` and lists its fields:

```xml
<component name="AppInfo" extends="ContentNode">
  <interface>
    <field id="appId" type="string" />
    <field id="isDev" type="boolean" />
    <field id="version" type="string" />
    <field id="lastRunVersion" type="string" />
  </interface>
</component>
```

The XML is the one place a reader finds every field and its type, without searching the code. It does not make the compiler check assignments: BrighterScript accepts a string written to a `boolean` field. Code that loads stored strings converts them itself, as `user.settings.Save()` does.

| File | Holds |
| --- | --- |
| `AppInfo.xml` | App metadata from `roAppInfo` |
| `DeviceInfo.xml` | Device facts from `roDeviceInfo` |
| `JellyfinServer.xml` | Server identity, connection state and capabilities |
| `JellyfinUser.xml` | User identity and the three child nodes |
| `JellyfinUserSettings.xml` | Per-user settings, see [`settings.md`](settings.md) |
| `JellyfinUserConfiguration.xml` | The server's profile for the user |
| `JellyfinUserPolicy.xml` | The server's permissions for the user |
| `JellyfinBaseItem.xml` | Every Jellyfin item type in one wide node |

`JellyfinBaseItem` is the largest because Jellyfin's `BaseItemDto` covers every item type in one shape. JellyRock mirrors that as one node with optional fields, filled by `JellyfinDataTransformer` in `source/data/JellyfinDataTransformer.bs`. It is not on `m.global`; screens hold their own items.

## The user: `m.global.user`

`setGlobals()` creates the `JellyfinUser` node with empty `settings`, `config` and `policy` children. `user.Login()` in `source/utils/session.bs` fills it at sign-in, and `user.Logout()` replaces all three children with new empty nodes.

- **`settings`** holds every per-user setting. Defaults come from `settings/settings.json`, saved values from the registry, and a write to a field is saved for you. [`settings.md`](settings.md) has the whole lifecycle.
- **`config` and `policy`** come from the server's user record at sign-in (`transformUserConfiguration()` and `transformUserPolicy()`). JellyRock never writes them back.
- **`fontScaleFactor`** is set by `calculateFontScaleFactor()` in `main.bs` when `uiFontFallback` is on. It scales text drawn in the downloaded fallback font, and `JRLabel`, `JRButtons` and the other `JR*` text components read it.

## Constants: `m.global.constants`

`components/data/Constants.xml` holds the shared UI constants. Two kinds:

- **Theme colors** (`colorPrimary`, `colorSecondary`, `colorTextPrimary`, `colorTextSecondary`, `colorTextDisabled`, `colorBackgroundPrimary`, `colorBackgroundSecondary`) have no value in the XML. `loadThemeColorDefaults()` fills them from the defaults in `settings/settings.json`.
- **Everything else** (`colorYellow`, `colorTextError`, `colorSuccess`, `colorBlack`, the `alpha*` steps, font sizes, icon URIs) has its value in the XML.

`settings.json` stores a color as six hex digits. `globals.bs` adds `0x` and uppercases it when loading. Alpha is a separate constant you append where you use it:

```brightscript
node.color = m.global.constants.colorPrimary                             ' fully opaque
node.color = m.global.constants.colorBlack + m.global.constants.alpha60  ' 60% black
```

Which theme color means what is in [`components/CLAUDE.md`](../../components/CLAUDE.md#theme-colors--which-one-means-what).

### Changing the theme

A theme color reaches the screen through three manual steps, all in `globals.bs` and `SceneManager`:

1. `applyThemeColorOverrides(userSettings)` copies each valid six-digit hex setting onto `m.global.constants`. An invalid value keeps the default.
2. `sceneManager.callFunc("refreshThemeColors")` sets the scene background and re-colors the overhang.
3. `sceneManager.callFunc("reloadHome")` tells `main.bs` to navigate back to a new Home, so every Home node is built with the new colors.

Three places run them:

- **Leaving Settings** (`performSettingsExit()`) runs steps 1 and 2 if a theme color changed, then step 3 if a theme color or the language changed.
- **Signing in** (`user.Login()`) runs steps 1 and 2.
- **Signing out** (`user.Logout()`) runs `resetThemeColors()`, which reloads the defaults, then step 2.

A component that copies a theme color when it is built keeps the old color until it is rebuilt. That is why Settings rebuilds Home. The manual chain is tracked as [`manual-theme-cascade`](tech-debt.md#manual-theme-cascade).

## App and device: `m.global.app`, `m.global.device`

`SaveAppToGlobal()` fills `m.global.app` from `roAppInfo`. Its `lastRunVersion` is read from the registry. `migrations.bs` uses it to pick which migrations run, and `main.bs` writes the current `version` back once they finish.

`SaveDeviceToGlobal()` fills `m.global.device` from `roDeviceInfo`. The fields other code reads most:

- **`isLowMemoryDevice`**: true when the model number starts with one of the `LOW_MEMORY_DEVICE_PREFIXES` in `globals.bs`, the 512 MB models. It narrows the API pool (`apiPool.widthFor()`), picks the smaller video buffer when transcode settings are worked out (`getDeviceBufferSize()`), and loads trickplay tiles at half size (`TrickplayCarousel`).
- **`videoHeight` and `videoWidth`**: the resolution the Roku is set to output, parsed from `GetVideoMode()`. It can be lower than the TV supports. `canPlay4k()` and stream selection read the height and width; `LoadVideoContentTask` sizes trickplay from the width.
- **`serverDeviceName`**: the `DeviceId` JellyRock sends Jellyfin. `user.SetServerDeviceName()` sets it after sign-in, and the auth header, the remote-control socket and the session lookups all read it.
- **`locale`**: the Roku's locale, used to pick translations before anyone signs in.
- **`memoryLevel`**: updated by `main.bs` when Roku sends a general memory event.

## Manager nodes: `sceneManager`, `queueManager`, `audioPlayer`

All three live for the whole app. `sceneManager` and `queueManager` are called through `callFunc`, so each method must be declared in the node's XML interface. `audioPlayer` extends Roku's `Video` node and is driven through its fields:

```brightscript
m.global.sceneManager.callFunc("reloadHome")
m.global.queueManager.callFunc("push", queueItem)
m.global.queueManager.callFunc("playQueue")
m.global.audioPlayer.control = "play"
```

- **`sceneManager`** no longer moves between screens; the router does that ([`navigation.md`](navigation.md)). It keeps the theme refresh, `reloadHome`, the background image, the clock reset and the `isDialogOpen` query.
- **`queueManager`** owns the play queue and starts playback ([`playback.md`](playback.md)).
- **`audioPlayer`** is the one audio player. Because it sits on `m.global` and not on a screen, music keeps playing while the user moves around the app. `AudioPlayerView` reads it from `m.global.audioPlayer` and observes its `state` and `position`.

## Debug flags: `m.global.debug`

The `DebugFlags` node exists only in a build with `debug=true`. `setGlobalNodes()` creates it and prints how to set its fields from the port 8085 console. The flags force failures (`shouldForceFiltersFail`, `shouldForceFavoriteFail`, `shouldForceWatchedFail`) or add spare buttons (`extraButtonCount`). [`debug-tools.md`](debug-tools.md) explains them and [`debug-flags.md`](../dev/debug-flags.md) is the how-to.

## Task-thread ledger: `m.global.taskLedger`

`launchTask()` in `source/utils/tasks.bs` records every Task node it starts in `m.global.taskLedger`, in every build. The live thread count is read from each node's `state` when needed. Above 50 live threads (`TASK_THREAD_WATERMARK`), a launch waits in `m.global.taskLaunchQueue` until a thread frees ([ADR 0041](../adr/0041-task-launch-queue.md)). How to read the ledger on a device is in [`debug-tools.md`](debug-tools.md#the-ledger-is-in-every-build).

Three facts about its storage decide how it must be written:

- **It has to be a node field.** `GetGlobalAA()` would be far cheaper, but it is scoped to one component, not one thread, so each component would count only its own launches. A field on `m.global` is the only storage every component shares. [ADR 0031](../adr/0031-task-thread-ceiling.md) has the measurements.
- **Reading an array field returns a copy.** `m.global.taskLedger.push(x)` changes the copy and leaves the field as it was, with no error. Code must read the array, change it, and assign it back, as `recordTaskLaunch()` does.
- **It is created on first use, not declared in `setGlobalNodes()`.** `setGlobalNodes()` starts the pool slots, `ApiQueueTask` and `SideEffectTask` before it could declare the field. A write to an undeclared field does nothing, so declaring it there lost those launches.

A launch is refused, returning `false`, only when the queue already holds `TASK_QUEUE_CAP` launches or before `setGlobalNodes()` has created the queue. The `[TASKS] REFUSED` print is `#if debug`. The lasting trace is `taskLedgerRefusals` and `taskLedgerFirstRefused`, which are `#if perfTiming`: the committed `manifest` sets `perfTiming=true` and `harden-prod-manifest.js` turns it off for store builds. The first refused node is kept, not the latest, because it names the fan-out and every later refusal follows from it.

### The real peak

`tests/source/unit/utils/tasks.spec.bs` pins the safety bound: the watermark plus the threads the ledger cannot see stays under Roku's 100-thread limit. `tests/rta/specs/task-thread-peak.spec.js` measures the peak on a device while it walks the app.

The peak depends on the pool width and on the server's library count, so read it against the `libraryCount` its run artifact records:

- **9 to 11 at the old fixed width of 3**, the band [ADR 0031](../adr/0031-task-thread-ceiling.md) set the watermark against. Recorded 2026-09-09: one device peaked at 10 with 4 libraries and another at 9 with 3. Device and library count both differed, so neither explains the gap.
- **Per-device widths**, measured 2026-09-16 on the 4-library demo server: a Streaming Stick `3600X` at width 4 peaked at 8, an Ultra `4850X` at width 6 at 10, and a Streaming Stick 4K at width 6 at 11 the day before. The extra slots raise the idle floor (6 and 8 at Home) but kept the peak in the old band ([ADR 0036](../adr/0036-api-pool-width-by-device-class.md)).

The same build on the same server varies by about two from run to run. A peak well under the band most likely means the walk did not run, not that the app improved.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md): search its `area` lines for `globals.bs` and `SceneManager`.
