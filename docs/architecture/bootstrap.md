---
topic: bootstrap
related-files:
  - source/main.bs
  - source/loginRouter.bs
  - source/replayRoute.bs
  - source/utils/globals.bs
  - components/JRScene.xml
  - components/JRScene.bs
last-reviewed: 2026-08-02
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

  loadTranslations(resolveTranslationLocale())   ' Pre-login locale (bootstrap, before first render)
  user.settings.SaveDefaults()
  m.global.user.settings.callFunc("enableAutoSync")

  runGlobalMigrations()                     ' Registry schema migrations (safe to run pre-scene)
  runRegistryUserMigrations()
  if m.global.app.version <> m.global.app.lastRunVersion
    setSetting("LastRunVersion", m.global.app.version)
  end if

  m.scene = m.screen.CreateScene("JRScene") ' Persistent root scene (the sgRouter host)
  m.screen.show()

  setGlobalNodes()                          ' Phase 2: node-based globals (require active screen)

  ' #550 sgRouter: scene-field bridges observed ONCE on the main thread (m.global field +
  ' port does NOT deliver — the relay defect — but a scene field + port does, like `exit`).
  m.scene.observeField("userMenuAction", m.port)   ' routed Home: change user/server / sign out
  m.scene.observeField("exit", m.port)
  m.scene.observeField("preLoginIntent", m.port)   ' routed pre-login views emit intents

  ' #550 sgRouter: cold-start deep link — stash BEFORE entering login so it replays uniformly.
  if isValid(args) and isValidAndNotEmpty(args.mediaType) and isValidAndNotEmpty(args.contentId)
    stashDeepLinkPlay(args.contentId, args.mediaType)
  end if

  ' Input + device events set up ONCE — they survive session resets (no app-loop restart).
  input = CreateObject("roInput")
  input.SetMessagePort(m.port)
  input.EnableTransportEvents()             ' Roku voice transport (play/pause/seek/next/...)
  device = CreateObject("roDeviceInfo")
  device.setMessagePort(m.port)
  ' ... device.Enable*Event(true) (see App lifecycle events) ...

  reenterLogin()                            ' Routed pre-login flow (source/loginRouter.bs)

  while true
    msg = wait(0, m.port)                   ' ONE unified event loop, pre- AND post-login
    ...
  end while
end sub
```

There is **no `LoginFlow()` gate and no `clearScenes`** anymore. The whole app — pre-login and post-login — is routed through sgRouter (#550); `Main()` brings up `roInput` / `roDeviceInfo` once, stashes any cold-start deep link, then calls `reenterLogin()` and drops into a **single** event loop that serves both phases. Session resets (Change Server / User / Sign Out) re-enter the login flow *in place* via `reenterLogin()`, so `roInput`/`roDeviceInfo` are no longer recreated per login and there is no `appStart:` / `goto` restart.

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
- `m.global.sideEffectTask` — `SideEffectTask`, `control = "RUN"` to enter its FIFO children-as-vehicle loop for fire-and-forget POST/DELETE
- `m.global.sceneManager` — now a shared **service node** (dialogs, backdrop, theme, overhang passthrough fields — the scene-stack was removed in #550, see `navigation.md`); observed by `main.bs` for `isDataReturned` and `reloadHomeRequested` events
- `m.global.AuthManager` — the sgRouter `canActivate` auth guard, created **before** the router's `addRoutes` and registered by node reference on every post-login route (see `navigation.md`)
- `m.global.activeRoutedView` — node field (default invalid); the currently-mounted router view. Published by `JRScreen`'s lifecycle bridge; read by `getActiveView()`, the overhang controller, and the playback/options/device branches of the event loop
- `m.global.playbackLaunchRequest` / `m.global.photoLaunchRequest` — `assocarray` fields the queue/photo launchers set to request a route (`JRScene` observes them and navigates — see `playback.md` / `user-journey.md`)
- `m.global.queueManager` — `QueueManager` node
- `m.global.audioPlayer` — `AudioPlayer` node (extends `Video`, used as the audio playback engine)
- `m.global.debug` — `DebugFlags` node, **only in `#if debug` builds** (compiled out in prod)

Why split? The Tier-1 API pool and the service/manager nodes need to be live nodes attached to the running scene graph; trying to wire their observers before `screen.show()` produces undefined behavior on some firmware. The split is enforced by ordering, not by any abstraction.

## The persistent root scene — `JRScene` (the sgRouter host)

JellyRock has **one** scene for the entire lifetime of the channel. It is `components/JRScene.xml`, extending `Scene`, and it is the **router host** (#550): it initializes sgRouter over its outlet, registers the route table, drives the overhang from the router-active view, and confirms app exit. The XML structure:

```xml
<JRScene extends="Scene">
  <BackdropFader id="imageFader" />          <!-- behind everything: backdrop image with crossfade -->
  <sgrouter_Outlet id="routerOutlet" />      <!-- the live nav surface: every routed view mounts here -->
  <JROverhang id="overhang" />               <!-- top bar: logo, user, search, settings, tabs -->
  <Group id="optionsPanelOverlay" />         <!-- options slider (renders above overhang for z-order) -->
  <LabelPrimaryLarge id="loadingText" />
  <Spinner id="spinner" />
  <Toast id="toast" />
  <Label id="defaultFont" /> <Label id="fallbackFont" />  <!-- used to compute m.global.user.fontScaleFactor -->
</JRScene>
```

`<sgrouter_Outlet id="routerOutlet">` is the live navigation surface — every routed view (pre-login, content, playback) mounts here. The old `<Group id="content"/>` slot that `SceneManager` swapped screens into was removed along with the scene stack.

Interface fields exposed for global control:

| Field | Type | Purpose |
|---|---|---|
| `isLoading` | bool | Show/hide the central spinner + dim the active routed view |
| `isRemoteDisabled` | bool | Block all remote input while loading |
| `loadingText` | string | Text shown beneath the spinner |
| `backgroundImageUri` | string | Backdrop image URL — `BackdropFader` does the crossfade |
| `shouldShowBackdrop` | bool | Lazily resolved from user settings on first backdrop request |
| `exit` | bool | Setting this true exits the channel |
| `userMenuAction` | string | Routed Home sets this (change user/server / sign out); `main.bs` observes it → `handleMenuAction` |
| `preLoginIntent` | string | Routed pre-login views emit an intent string; `main.bs` observes it → `handlePreLoginIntent` |
| `contentVersion` | int | Content-freshness token bumped on a content mutation (e.g. item delete); a grid suspended beneath the detail re-fetches on resume when it differs |
| `testToast` | string | Debug-only test trigger (see `debug-tools.md`) |

`JRScene` also exposes router hooks called from `main.bs` / `loginRouter` on the main thread (the `sgrouter` namespace resolves on the render thread, so the main loop can't call it directly): `initRouter`, `routerNavigate`, `replayRoutedDeepLink`, `reloadRoutedHome`, `resetRouter`, `routerGoBack`.

`components/JRScene.bs` adds the controller logic:

- **Initializes the `roku-log` log manager** — first statement in `init()`, and the ordering is load-bearing: a `log.Logger` built before the manager exists caches `invalid` and silently no-ops forever. Doing it here is what gives the global singletons (`RemoteControlTask`, `SceneManager`, `QueueManager`, `SideEffectTask`) working loggers. It also cannot be done any earlier — `log_Log` creates a `Timer`, and Timer creation fails on the main thread before `m.screen.show()`, so `main.bs` can't stand the manager up itself. The corollary is a **bootstrap window with no logging**: everything created in `setGlobals()`, plus `main.bs` up to `show()`, must use `print`. See [logging.md](logging.md)
- Initializes the loading spinner, toast, backdrop fader, and overhang references
- Lazily resolves the user's "show backdrop" setting on first backdrop request (so the very first backdrop assignment after login picks up the user preference)
- Implements `setBackgroundImage(uri, isAnimated, forceBackdrop)` with `forceBackdrop=true` used during the login splashscreen
- **Owns the router**: `initRouter` (idempotent bring-up + route table + overhang/playback/photo observers), `routerNavigate` / `replayRoutedDeepLink` (navigation), `resetRouter` (`sgrouter.destroy` on session reset), and the overhang controller (`onActiveRoutedViewChanged` + `register/unregisterOverhangData`). Full detail in `navigation.md`
- Handles the `back` key via the **router back arbiter**: a routed view's back is intercepted by the outlet first (`sgrouter.goBack`); a back key only reaches `JRScene.onKeyEvent` when `goBack` is a no-op at the router root (history depth ≤ 1), where it calls `showExitConfirmation()`. The `options` key opens the active routed view's options panel
- Implements the up-up-down-down debug cheat code that cycles through toast types in `#if debug` builds

## The main event loop

`Main()` drops into **one unified event loop** that serves both the pre-login flow and the post-login session (#550 — there is no separate login loop anymore):

```brightscript
while true
  msg = wait(0, m.port)
  if type(msg) = "roSGScreenEvent" and msg.isScreenClosed()
    return
  else if isNodeEvent(msg, "exit")
    return
  else if isNodeEvent(msg, "preLoginIntent")           ' routed pre-login view emitted an intent
  else if isNodeEvent(msg, "isAuthenticated")          ' QuickConnectDialog signalled success
  else if isNodeEvent(msg, "closeSidePanel")           ' options panel closed → restore focus
  else if isNodeEvent(msg, "isFontDownloadCompleted")  ' fallback font finished downloading
  else if isNodeEvent(msg, "playItem")                 ' AlbumTrackList row → play audio
  else if isNodeEvent(msg, "searchValue") / "results"  ' search box → SearchTask
  else if isNodeEvent(msg, "optionSelected")           ' OptionsSlider action → handleMenuAction
  else if isNodeEvent(msg, "userMenuAction")           ' routed Home user dropdown → handleMenuAction
  else if type(msg) = "roDeviceInfoEvent"              ' app lifecycle (see below)
  else if type(msg) = "roInputEvent"                   ' deep link OR voice transport
  else if isNodeEvent(msg, "isDataReturned")           ' dialog result (exit confirm, resume prompt)
  else if isNodeEvent(msg, "reloadHomeRequested")      ' theme/locale change → reloadRoutedHome
  ' ...
end while
```

The loop is the central hub for cross-screen, main-thread-only actions (things the render thread can't do: blocking bootstrap API calls, `roInput`/`roAppManager`, the `sgrouter`-namespace bridge). Events are wired by `setGlobalNodes()` (e.g. `sceneManager.observeField("isDataReturned", m.port)`), by the once-only scene-field observers set up in `Main()` (`preLoginIntent` / `userMenuAction` / `exit`), or by other code paths observing a node on the same port.

What is **no longer here** (moved to per-view render-thread handlers in #550):

- **`quickPlayNode`** — Play presses are no longer relayed through `main.bs`. Each routed view (`Home` / `BaseGridView` / `SearchResults` / `ItemDetails`) observes its *own* `quickPlayNode` and forwards it to `QueueManager.launchItem`; single-item plays navigate `/details/:type/:id/play` directly (see `user-journey.md`).
- **`selectedItem`** — library/item selection is handled by each view's own `selectedItem` observer, which navigates the router via `routeForItem(item)` — not relayed to `main.bs`.
- The favorite/watched toggles were migrated off this loop in #551 (`group.callFunc("toggleFavorite")` / `toggleWatched` run as render-thread `fetchAsync()` promises in `ItemDetails`). The Series "mark all watched" confirmation now routes through `ItemDetails`'s own scoped `isDataReturned` observer; the only confirmations `main.bs` still handles here are the **exit** dialog and the **resume/start-over** prompt. No raw `submitApiRequest` + `observeField("isDone")` consumer remains in app code — the `promise-ratchet` lint is a hard grep-zero guard.

Session-ending actions converge on `handleMenuAction(actionId)`: each tears down the routed Home (`m.scene.callFunc("resetRouter")` → `sgrouter.destroy`) and re-enters the login flow **in place** via `reenterLogin()` — no `goto appStart` (that path is gone).

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
2. Any code sets `m.scene.exit = true` (the `JRScene` interface field)

The second path is reached via the **router back arbiter**: when a back key reaches `JRScene` at the router root (history depth ≤ 1, i.e. `sgrouter.goBack` had nothing to pop), `showExitConfirmation()` shows the confirm dialog; on confirm, `main.bs`'s `isDataReturned` branch sets `m.scene.exit = true` (see `navigation.md`). The Roku OS handles the actual process teardown after `Main` returns.

## Deep links

`Main(args)` accepts an `args` AA from Roku. If launched via deep link it contains `mediaType` and `contentId`. The deep link is **stashed before the login flow runs** so it replays uniformly whether the user is already authenticated or has to sign in first:

```brightscript
if isValid(args) and isValidAndNotEmpty(args.mediaType) and isValidAndNotEmpty(args.contentId)
  stashDeepLinkPlay(args.contentId, args.mediaType)   ' seed queue + record play path on AuthManager.stashedRoute
end if
reenterLogin()
```

`stashDeepLinkPlay` (`source/replayRoute.bs`) seeds the queue with the `contentId` and records a `/details/:type/:id/play` path on `m.global.AuthManager.stashedRoute`. After login, `createAndShowHomeGroup` → `replayAfterLogin()` reads + clears the stash and navigates the route chain via `JRScene.replayRoutedDeepLink`:

- no deep link → `["/"]` (plain Home)
- a play deep link → `["/", details, play]` so back unwinds **Player → Details → Home** (locked decision #3) — the user lands on Home if they back out of playback

A **runtime** deep link (another app hands JellyRock content while it's already running) arrives as an `roInputEvent` with `info.mediatype` / `info.contentid`. The `roInputEvent` branch calls `stashDeepLinkPlay` the same way, then — if already signed in — `replayAfterLogin()` immediately; otherwise the stash rides along until login completes. The voice-transport `roInputEvent` branch (`info.type = "transport"`) shares the same dispatcher; it sources the active view via `getActiveView()` and forwards `handleTransport` to `PlayerHostView` / `VideoPlayerView` / `AudioPlayerView` (see `playback.md`).

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for bootstrap / `main.bs` entries.
