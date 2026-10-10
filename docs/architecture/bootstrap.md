---
topic: bootstrap
related-files:
  - source/main.bs
  - source/loginRouter.bs
  - source/replayRoute.bs
  - source/utils/globals.bs
  - components/JRScene.xml
  - components/JRScene.bs
last-reviewed: 2026-10-10
---

# Bootstrap and lifecycle

How JellyRock starts, where the main event loop lives, and how the app handles device events, exit and deep links.

## Entry point

Roku calls `Main(args)` in `source/main.bs` when the app launches. It is a plain linear script. Shortened, the start-up part reads:

```brightscript
sub Main (args as dynamic) as void
  printRegistry()
  m.screen = CreateObject("roSGScreen")
  m.port = CreateObject("roMessagePort")
  m.screen.setMessagePort(m.port)

  m.global = m.screen.getGlobalNode()
  setGlobals()                                    ' phase 1

  loadTranslations(resolveTranslationLocale())    ' the locale before anyone signs in
  user.settings.SaveDefaults()
  m.global.user.settings.callFunc("enableAutoSync")

  runGlobalMigrations()
  runRegistryUserMigrations()
  ' ... then LastRunVersion is written back

  m.scene = m.screen.CreateScene("JRScene")
  m.screen.show()
  ' ... #if ENABLE_RTA: the on-device test component

  setGlobalNodes()                                ' phase 2

  m.scene.observeField("userMenuAction", m.port)  ' change server or user, sign out
  m.scene.observeField("exit", m.port)
  m.scene.observeField("preLoginIntent", m.port)  ' the sign-in screens' requests
  m.global.remoteControlTask.observeField("dispatchCommand", m.port)

  ' ... a cold-start deep link is stashed here (see Deep links)

  input = CreateObject("roInput")                 ' voice transport commands
  device = CreateObject("roDeviceInfo")           ' device events (see Device events)
  ' ... both on m.port

  reenterLogin()                                  ' source/loginRouter.bs

  while true
    msg = wait(0, m.port)                         ' the one event loop
    ...
  end while
end sub
```

Every screen, before and after sign-in, is a route in sgRouter (#550). `Main()` sets up `roInput` and `roDeviceInfo` once and enters one event loop that serves the whole session. Changing the server or user, or signing out, calls `reenterLogin()` again from inside that loop, so nothing is recreated and the loop never restarts.

`reenterLogin()` reloads the sign-in locale and runs `beginLogin()`, which tries the saved server and saved token with no UI. If both work, `finishLogin()` starts the fallback-font download when the user needs it and opens Home. Otherwise the router opens `/server`, `/users` or `/login`. [`user-journey.md`](user-journey.md) covers the sign-in screens.

## The two-phase global setup

`m.global` is built in two phases, before and after `m.screen.show()`:

- **Phase 1, `setGlobals()`**, builds the data nodes: `server`, `user` and its three children, the translation fields, `constants`, `app` and `device`. It also declares the Task launch queue's two fields.
- **Phase 2, `setGlobalNodes()`**, builds the long-running nodes: the Task launch queue, the API pool and its coordinator, the side-effect Task, `sceneManager`, `AuthManager`, the routing fields, `queueManager`, `audioPlayer` and the remote-control Task.

[`global-state.md`](global-state.md#the-shape-of-mglobal) lists every field and what it is for.

The order inside the phases matters in two places:

- **Some nodes cannot be made on the main thread before the screen is shown.** A `Timer` comes back invalid there ([`threading.md`](threading.md#measured-findings)). The data nodes of phase 1 are made there without trouble; whether a Task node can be has not been tested, so Task nodes stay in phase 2.
- **Phase 2 reads phase 1.** The API pool's width comes from `m.global.device.isLowMemoryDevice`, so `SaveDeviceToGlobal()` has to run first. The launch queue is created first in phase 2, before the pool slots start, so a launch past the thread watermark can wait instead of being refused.

`main.bs` also observes `sceneManager`'s `reloadHomeRequested` from phase 2 on.

## The root scene: `JRScene`

The app has one scene for its whole life, `components/JRScene.xml`, which extends `Scene`. It hosts the router. Its children, back to front:

```xml
<JRScene extends="Scene">
  <AppWaitHost id="appWaitHost" />            <!-- holds app-wide waits; draws nothing -->
  <BackdropFader id="imageFader" />           <!-- the backdrop image, with a crossfade -->
  <sgrouter_Outlet id="routerOutlet" />       <!-- every routed view mounts here -->
  <JROverhang id="overhang" />                <!-- top bar: logo, title, user, tabs, clock -->
  <Group id="optionsPanelOverlay" />          <!-- the options panel, above the overhang -->
  <LabelPrimaryLarge id="loadingText" />      <!-- text above the spinner -->
  <Spinner id="spinner" />
  <LabelSecondaryMedium id="loadingStageText" />  <!-- how a long wait is going -->
  <Timer id="loadingStageTimer" />
  <Toast id="toast" />
  <Label id="defaultFont" /> <Label id="fallbackFont" />  <!-- measured for fontScaleFactor -->
</JRScene>
```

### Interface fields

| Field | Type | Purpose |
| --- | --- | --- |
| `isLoading` | bool | Shows the scene's own spinner (`startLoadingSpinner()`). The spinner also shows app-wide waits and the active view's named waits, which leave this false. See [`navigation.md`](navigation.md#what-kind-of-wait-a-spinner-is). |
| `isRemoteDisabled` | bool | While true, `JRScene` swallows every key press and the active routed view is hidden. Starts true. |
| `loadingText` | string | The text above the scene's spinner. |
| `loadingKind` | string | The `LoadingKind` of the scene's spinner, which picks the stage text under it. |
| `backgroundImageUri` | string | The backdrop image. `BackdropFader` does the crossfade. |
| `shouldShowBackdrop` | bool | Whether backdrops show. Worked out from the user's settings on the first backdrop request after sign-in. |
| `exit` | bool | Set true to close the app. |
| `userMenuAction` | string | Home's user menu sets it; `main.bs` passes it to `handleMenuAction()`. |
| `preLoginIntent` | string | A sign-in screen sets it; `main.bs` passes it to `handlePreLoginIntent()`. |
| `contentVersion` | int | Bumped when a view changes server content (an item delete). A grid suspended under it reloads on resume when the number differs. |
| `testToast` | string | Shows a test toast when set from the console (see [`debug-tools.md`](debug-tools.md)). |

Its `callFunc` functions:

- `setBackgroundImage(uri, isAnimated, forceBackdrop)`, `refreshBackdropSetting()` and `showToast(message, type)`.
- The router bridge, for main-thread code in `main.bs`, `loginRouter.bs` and `replayRoute.bs`: `routerNavigate`, `replayRoutedDeepLink`, `resolveDeepLink`, `reloadRoutedHome`, `resetRouter` and `routerGoBack`. Main-thread code cannot call the `sgrouter` functions itself, because they run on the render thread.

### What `JRScene.bs` does

- **Starts the `roku-log` log manager**, as the first statement of `init()`. A `log.Logger` made before the manager exists stays silent forever. It cannot start earlier: the manager creates a `Timer`, which fails on the main thread before `show()`. So everything made in `setGlobals()`, and `main.bs` up to `show()`, logs with `print`. See [`logging.md`](logging.md).
- **Owns the router:** `initRouter()` brings it up on the first navigation, registers the routes and watches the active routed view to drive the overhang. `resetRouter()` tears it down on a session reset. [`navigation.md`](navigation.md) has the detail.
- **Runs the spinner:** `onIsLoadingChanged()` and `showLoadingStage()` decide what the spinner and its two labels show.
- **Shows backdrops:** `setBackgroundImage()` skips an unchanged image. `forceBackdrop` shows one whatever the setting, for the sign-in splash screen.
- **Decides what Back does at the top of the app.** A routed view's Back goes to the router first. Back reaches `JRScene.onKeyEvent()` only when the router has nothing to go back to, or is busy. There, in order:
  1. A deep link still being looked up is canceled.
  2. A navigation in progress keeps the press.
  3. A playback start that is hiding its screen is canceled.
  4. Otherwise `showExitConfirmation()` asks whether to exit.
- **Opens the options panel** on the Options key, when the active view has one.
- **Cycles test toasts** on an Up, Up, Down, Down key sequence in a debug build. Routed views swallow key releases, so this rarely fires; use `testToast` instead.

## The main event loop

`Main()` ends in one loop on `m.port`. Each branch handles a message only the main thread can act on: the blocking sign-in API calls, `roInput` and `roAppManager`, and the bridge to the router.

| Message | What happens |
| --- | --- |
| screen closed, or `exit` | `Main()` returns and the app closes. |
| `preLoginIntent` | `handlePreLoginIntent()` runs the sign-in step the screen asked for and opens the next route. |
| `userMenuAction` | `handleMenuAction()`: change server, change user or sign out. |
| `isFontDownloadCompleted` | The fallback font arrived: work out `fontScaleFactor`, then open Home if it was waiting. |
| `reachable` | The server probe before a deep-link server switch answered (`onServerProbeDone()`). |
| `result` | The deep-link server-switch dialog was answered (`onServerSwitchDialogResult()`). It is the one dialog `main.bs` handles; every other dialog answers in its own component. |
| `dispatchCommand` | A remote-control command from `RemoteControlTask` (see [`remote-control.md`](remote-control.md)). |
| `reloadHomeRequested` | A theme or language change: `JRScene.reloadRoutedHome()` opens a new Home. |
| `roDeviceInfoEvent` | A device event (see the next section). |
| `roInputEvent` | A runtime deep link, or a voice transport command passed to `remoteDispatch.dispatchTransport()`. |

Play presses, item selection and the favorite and watched buttons are not here. Each routed view handles its own on the render thread ([`user-journey.md`](user-journey.md)).

`handleMenuAction()` starts the spinner, tears down the router (`resetRouter`), signs out and calls `reenterLogin()`. Signing out also deletes the user's saved token. Changing server keeps it but forgets the saved server.

## Device events

`Main()` turns on six `roDeviceInfo` events. The loop does this with them:

| Event | What happens |
| --- | --- |
| Screensaver exited | Resets the overhang clock through `sceneManager`, and calls `onScreenShown()` on the active screen so it refreshes. |
| Audio guide changed | Updates `m.global.device.isAudioGuideEnabled`. |
| Low general memory | Stores the level in `m.global.device.memoryLevel` and prints it. Nothing else reacts. |
| Codec capability changed | Sends the server the device's new playback capabilities. |
| App focus | Prints it. Roku sends it when a system overlay takes or returns focus. |
| Link status | Prints it. The app does not show an offline state. |

The 512 MB memory measures (a narrower API pool, half-size trickplay tiles) do not wait for a memory event: they key off `isLowMemoryDevice`, set at start-up ([`global-state.md`](global-state.md#app-and-device-mglobalapp-mglobaldevice)).

## App exit

There is no shutdown function. The app exits when the loop sees the screen close or the `exit` field set, and `Main()` returns. Roku then ends the process.

`exit` is set by `JRScene` itself. When Back reaches it at the top of the app, `showExitConfirmation()` opens the confirm dialog. `JRScene` reads the answer through its own observer and sets `exit` when the user confirms.

## Deep links

A deep link arrives two ways:

- **At launch**, in `Main(args)`.
- **While running**, as an `roInputEvent`, from another app or a Jellyfin client casting to the Roku.

Both carry a `contentId` and may carry a `mediaType` and an `itemName`. `contentId` holds the whole request in one string, `id=<itemId>|serverId=<serverGuid>|action=<verb>`, because it is the one field both paths deliver intact. A bare item id works too. `parseDeepLinkContentId()` in `source/replayRoute.bs` documents the format.

### Stashing

`stashDeepLink()` parses the request and stores it on `m.global.AuthManager.stashedDeepLink`. The id and the media type go into a route path without URL encoding, so a value with characters outside a safe set is dropped or replaced first. An id that fails is discarded; a bad media type becomes `Video` and a bad action becomes `open`.

### At launch

1. `Main()` stashes the link. If it names a saved server, `steerColdStartDeepLinkServer()` points sign-in at that server.
2. Sign-in runs as usual. If it needs the user, a toast says the content opens after they sign in.
3. After sign-in, `replayAfterLogin()` opens Home first, so it is the bottom of the back stack. Then `JRScene.resolveDeepLink()` fetches the item.

### While running

- **Signed out:** the link is stashed and a toast says it opens after sign-in.
- **For the current server, or none named:** `replayDeepLinkRuntime()` resolves it without opening Home first.
  - On the item's details already, a playback action starts there.
  - An `open` that would cover a playing video is dropped, because jellyfin-web sends one on every item a casting user browses.
  - A playback action replaces an active player.
- **For another saved server:** a dialog offers to switch. On yes, `ServerReachableTask` checks the server first, then the app signs out and signs in there with the link still stashed.
- **For an unknown server:** a toast says the content is on a server JellyRock does not know, and the link is discarded.

### Resolving

`resolveDeepLink()` fetches the item before navigating, because the id came from outside. The remote stays live during the fetch, and Back cancels it.

- **Not found:** a toast, and nothing navigates.
- **A library or folder:** its grid opens directly.
- **Anything else:** the details route opens with `?deeplink=<action>`. `ItemDetails` then shows the item for `open`, or starts the action (`play`, `shuffle`, `trailer`, `instantmix`).

Back from the player then goes to details, then Home.

A route the auth guard stashed while signed out is a separate path. It is stored on `AuthManager.stashedRoute` and replayed by `buildReplayRoutes()` as Home, then the route, with the details screen between them for a `/play` route ([`navigation.md`](navigation.md#deferred-deep-links)).

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md): search its `area` lines for `main.bs`, `loginRouter.bs` and `JRScene`.
