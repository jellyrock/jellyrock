---
topic: bootstrap
related-files:
  - source/main.bs
  - source/utils/globals.bs
  - components/JRScene.xml
  - components/JRScene.bs
last-reviewed: 2026-05-01
---

# Bootstrap & Lifecycle

How JellyRock starts, where the main event loop lives, and what runs on app suspend / resume / exit.

## Entry point

`source/main.bs` defines the `Main(args)` function that Roku invokes when the channel launches. It is intentionally linear and procedural — no abstractions, just a script. The file is large; the focus here is the bootstrap prologue (everything up to the main event loop).

```brightscript
sub Main (args as dynamic) as void
  printRegistry()                           ' Dev convenience: dump current registry
  m.screen = CreateObject("roSGScreen")
  m.port = CreateObject("roMessagePort")
  m.screen.setMessagePort(m.port)

  m.global = m.screen.getGlobalNode()
  setGlobals()                              ' Phase 1: non-node globals

  loadTranslations(resolveTranslationLocale())
  user.settings.SaveDefaults()
  m.global.user.settings.callFunc("enableAutoSync")

  runGlobalMigrations()                     ' Registry schema migrations (safe to run pre-scene)
  runRegistryUserMigrations()
  if m.global.app.version <> m.global.app.lastRunVersion
    setSetting("LastRunVersion", m.global.app.version)
  end if

  m.scene = m.screen.CreateScene("JRScene") ' Persistent root scene
  m.screen.show()

  setGlobalNodes()                          ' Phase 2: node-based globals (require active screen)

  appStart:
  m.global.sceneManager.callFunc("clearScenes")
  if not LoginFlow() then return            ' Server pick → user pick → auth (in source/showScenes.bs)

  m.global.sceneManager.callFunc("clearScenes")
  initializeFallbackFont()                  ' Optional: download fallback font for non-Latin scripts
  loadHomeScreen()
  ...
  while true
    msg = wait(0, m.port)                   ' Main event loop
    ...
  end while
end sub
```

## The two-phase global setup

JellyRock initializes `m.global` in **two phases**, separated by `m.screen.show()`. This is not arbitrary — it's a Roku constraint: many `roSGNode` operations require an active scene.

### Phase 1 — `setGlobals()` *(before screen.show)*

Defined in `source/utils/globals.bs` (`setGlobals` function). Creates the data nodes that don't depend on the rendered scene:

- `m.global.appLoaded` (bool)
- `m.global.server` — `JellyfinServer` content node (URL, name, version, id)
- `m.global.user` — `JellyfinUser` content node, with three children created and parented:
  - `user.settings` (`JellyfinUserSettings`) — the per-user config tree
  - `user.config` (`JellyfinUserConfiguration`) — server-authoritative profile data
  - `user.policy` (`JellyfinUserPolicy`) — server-authoritative permissions
- `m.global.translations` (AA, populated by `loadTranslations()`)
- `m.global.translationsFallback` (AA, always en_US)
- `m.global.translationLocale` (string)
- `m.global.constants` — `Constants` content node, populated by `setConstants()` → `loadThemeColorDefaults()` (reads theme colors from `settings/settings.json`)
- `m.global.app` — `AppInfo` content node (`appId`, `version`, `isDev`, `lastRunVersion`) populated by `SaveAppToGlobal()`
- `m.global.device` — `DeviceInfo` content node populated by `SaveDeviceToGlobal()` (model, OS version, locale, video mode parsed into height/width/refresh/bit-depth, `isLowMemoryDevice` flag, etc.)

### Phase 2 — `setGlobalNodes()` *(after screen.show)*

Defined in `source/utils/globals.bs` (`setGlobalNodes` function). Creates and starts the long-running nodes:

- `m.global.apiPool0`, `apiPool1`, `apiPool2` — three `ApiTask` Task nodes, each `control = "RUN"` to enter their infinite work loop
- `m.global.apiQueue` — `ApiQueueTask`, the FIFO coordinator that dispatches into the pool
- `m.global.sideEffectTask` — `SideEffectTask` for fire-and-forget POST/DELETE
- `m.global.sceneManager` — observed by `main.bs` for `isDataReturned` and `reloadHomeRequested` events
- `m.global.queueManager` — `QueueManager` node
- `m.global.audioPlayer` — `AudioPlayer` node (extends `Video`, used as the audio playback engine)
- `m.global.debug` — `DebugFlags` node, **only in `#if debug` builds** (compiled out in prod)

Why split? The Tier-1 API pool and `SceneManager` need to be live nodes attached to the running scene graph; trying to wire their observers before `screen.show()` produces undefined behavior on some firmware. The split is enforced by ordering, not by any abstraction.

## The persistent root scene — `JRScene`

JellyRock has **one** scene for the entire lifetime of the channel. It is `components/JRScene.xml`, extending `Scene`. The XML structure:

```xml
<JRScene extends="Scene">
  <BackdropFader id="imageFader" />          <!-- behind everything: backdrop image with crossfade -->
  <Group id="content" />                     <!-- where the active screen lives (swapped by SceneManager) -->
  <JROverhang id="overhang" />               <!-- top bar: logo, user, search, settings, tabs -->
  <Group id="optionsPanelOverlay" />         <!-- options slider (renders above overhang for z-order) -->
  <LabelPrimaryLarge id="loadingText" />
  <Spinner id="spinner" />
  <Toast id="toast" />
  <Label id="defaultFont" /> <Label id="fallbackFont" />  <!-- used to compute m.global.user.fontScaleFactor -->
</JRScene>
```

Interface fields exposed for global control:

| Field | Type | Purpose |
|---|---|---|
| `isLoading` | bool | Show/hide the central spinner + dim active group |
| `isRemoteDisabled` | bool | Block all remote input while loading |
| `loadingText` | string | Text shown beneath the spinner |
| `backgroundImageUri` | string | Backdrop image URL — `BackdropFader` does the crossfade |
| `shouldShowBackdrop` | bool | Lazily resolved from user settings on first backdrop request |
| `exit` | bool | Setting this true exits the channel |
| `testToast` | string | Debug-only test trigger (see `debug-tools.md`) |

`components/JRScene.bs` adds the controller logic:

- Initializes the loading spinner, toast, backdrop fader references
- Lazily resolves the user's "show backdrop" setting on first backdrop request (so the very first backdrop assignment after login picks up the user preference)
- Implements `setBackgroundImage(uri, isAnimated, forceBackdrop)` with `forceBackdrop=true` used during the login splashscreen
- Handles the `back` key by calling `sceneManager.popScene()` and the `options` key by showing the options panel of the active group
- Implements the up-up-down-down debug cheat code that cycles through toast types in `#if debug` builds

## The main event loop

After login + home screen load, `main.bs` enters its event loop:

```brightscript
while true
  msg = wait(0, m.port)
  if type(msg) = "roSGScreenEvent" and msg.isScreenClosed()
    return
  else if isNodeEvent(msg, "exit")
    return
  else if isNodeEvent(msg, "closeSidePanel")           ' Options panel closed → restore focus
  else if isNodeEvent(msg, "isFontDownloadCompleted")  ' Fallback font finished downloading
  else if isNodeEvent(msg, "quickPlayNode")            ' Any Play button pressed anywhere
  else if isNodeEvent(msg, "voiceQuery")               ' Voice search from home screen
  else if isNodeEvent(msg, "output")                   ' QuickPlayTask returned a queue
  else if isNodeEvent(msg, "result")                   ' RecordProgramTask returned
  else if isNodeEvent(msg, "isDone")                   ' Favorite/watched toggle ApiResultNode fired
  else if isNodeEvent(msg, "selectedItem")             ' Library / row item selected → push detail
  ' ...many more event branches
end while
```

The event loop is the central hub for cross-screen actions. Most events are wired by `setGlobalNodes()` (e.g., `sceneManager.observeField("isDataReturned", m.port)`) or by other code paths assigning `m.favoriteResultNode` / `m.watchedResultNode` and observing them on the same port.

The dominant event is **`quickPlayNode`** — the universal "play this item" signal. Any UI that wants to start playback sets a node on its `quickPlayNode` field; `main.bs` reads that node, classifies it by `type` (movie / episode / audio / musicvideo / photo / chapter / tvchannel / program / etc.), and either:

- Calls a synchronous `quickplay.<type>()` helper (e.g. `quickplay.video(itemNode)`) which pushes the item into `QueueManager`, then calls `playQueue()`
- Or, for types that need additional API calls first (e.g. "play whole season"), spawns a `QuickPlayTask` and waits for its `output` event

This funnel means there's exactly one "this got pressed → start playback" code path, regardless of which screen issued it.

## App lifecycle events

Early in `Main()`, several `roDeviceInfo` events are enabled on the same message port:

```brightscript
device.EnableScreensaverExitedEvent(true)
device.EnableAppFocusEvent(true)
device.EnableLowGeneralMemoryEvent(true)
device.EnableLinkStatusEvent(true)
device.EnableCodecCapChangedEvent(true)
device.EnableAudioGuideChangedEvent(true)
```

The event loop branches on each of these. Notable handling:

- **`AppFocusEvent`** — fired on app suspend (user pressed Home) and resume. JellyRock uses this to know when it's coming back from background.
- **`LowGeneralMemoryEvent`** — Roku has signaled memory pressure. JellyRock uses `m.global.device.isLowMemoryDevice` (computed at startup from a hard-coded prefix list of `512MB` models — see `LOW_MEMORY_DEVICE_PREFIXES` in `globals.bs`) to *preemptively* disable memory-heavy features like trickplay tile preloading on small devices.
- **`LinkStatusEvent`** — network up/down. App can show offline state.
- **`CodecCapChangedEvent`** — the device's codec capabilities changed (e.g., user toggled HDR mode in Roku settings).
- **`ScreensaverExitedEvent`** — fires when the screensaver dismisses; lets the app refresh state.

### App exit

There is no explicit "shutdown" function. The app exits when:

1. The event loop sees `roSGScreenEvent` with `isScreenClosed()` returning true, **or**
2. Any code sets `m.scene.exit = true` (the `JRScene` interface field), **or**
3. `popScene()` is called when the stack has exactly one entry (this triggers an exit-confirmation dialog instead of immediate exit; see `navigation.md`)

The Roku OS handles the actual process teardown after `Main` returns.

## Deep links

`Main(args)` accepts an `args` AA from Roku. If launched via deep link, it contains `mediaType` and `contentId`:

```brightscript
if isValidAndNotEmpty(args.mediaType) and isValidAndNotEmpty(args.contentId)
  m.global.queueManager.callFunc("push", nodeHelpers.createQueueItem({ id: args.contentId, type: "video" }))
  m.global.queueManager.callFunc("playQueue")
end if
```

This runs **after** the home screen is loaded (so the user lands on home if they back out of playback). All other deep-link types (audio, photo, etc.) fall through to the regular event loop.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for bootstrap / `main.bs` entries.
