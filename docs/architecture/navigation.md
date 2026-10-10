---
topic: navigation
related-files:
  - components/JRScene.bs
  - components/JRScene.xml
  - components/JRScreen.bs
  - components/JRScreen.xml
  - components/JRGroup.bs
  - components/JRGroup.xml
  - components/auth/AuthManager.bs
  - components/auth/AuthManager.xml
  - components/data/SceneManager.bs
  - components/data/SceneManager.xml
  - components/OverviewDialog.bs
  - source/utils/dialogs.bs
  - source/replayRoute.bs
  - source/loginRouter.bs
  - source/enums/LoadingKind.bs
  - source/utils/loadingStages.bs
  - source/utils/screenWaits.bs
  - source/utils/appWaits.bs
  - components/AppWaitHost.bs
  - components/AppWaitHost.xml
last-reviewed: 2026-10-10
---

# Navigation (sgRouter)

How JellyRock moves between screens, where focus goes on the way, and how the shared top bar (the overhang) follows the active screen.

Every screen is a view of [`@rokucommunity/sgrouter`](https://github.com/rokucommunity/sgrouter), mounted into one outlet on `JRScene`: the pre-login screens, the content screens and the players. There is no scene stack. `SceneManager` survives as a shared service node for dialogs, the backdrop and the theme ([below](#scenemanager-is-a-service-node)). The router source is vendored in `components/roku_modules/sgrouter/` and `source/roku_modules/sgrouter/`.

## The component triad

Every UI component inherits from `JRGroup`, and every full-screen view from `JRScreen`:

```text
Group
  └─ sgrouter_View          (the router's view base)
      └─ JRGroup            components/JRGroup.xml + .bs
          ├─ sub-panels and dialogs (ExtrasSlider, JRDialog, OverviewDialog, ...)
          └─ JRScreen       components/JRScreen.xml + .bs
              ├─ Home, ItemDetails, BaseGridView, SearchResults, Settings
              ├─ PlayerHostView, AudioPlayerView, PhotoDetails
              └─ SetServerScreen, UserSelect, LoginScene (pre-login)

Scene
  └─ JRScene                components/JRScene.xml + .bs (the router host)
```

`JRGroup` extends `sgrouter_View`, so every `JRScreen` is a router view with no per-screen wiring. Sub-panels and dialogs inherit the router's view interface too, but it stays inert for them: the router drives only the views it mounts in its outlet.

### `JRGroup`

`JRGroup.xml` declares the fields a view uses to describe itself:

| Field | Type | Purpose |
|---|---|---|
| `lastFocus` | node | The element that had focus when the view was last suspended |
| `overhangTitle` | string | Title in the top bar |
| `overhangTabs` | array | Tab definitions for the top bar |
| `selectedTabId` | string, `alwaysNotify` | The selected tab |
| `isOverhangVisible` | bool, default true | Show the top bar (false during playback) |
| `isLogoVisible` | bool, default false | Show the JellyRock logo in the top bar |
| `shouldShowIcons` | bool, default false | Show the search and settings icons (only with a signed-in user) |
| `shouldShowUserDropdown` | bool, default false | Show the current-user dropdown |
| `isOptionsAvailable` | bool, default true | Whether the options key opens a panel for this view |
| `loadingWaits` | `assocarray` | The view's open content waits ([below](#what-kind-of-wait-a-spinner-is)) |

`JRGroup.bs` holds one function: an `onDestroy()` that calls `abandonApiPromises()`, so a late API response cannot fire into a destroyed panel.

### `JRScreen`

Screens implement three functions, and `JRScreen.bs` supplies the defaults:

| Function | When it runs | Default |
|---|---|---|
| `onScreenShown()` | The view opens, or comes back on top | Restores focus from `lastFocus`, else focuses the view |
| `onScreenHidden()` | The view is covered or closed | Nothing |
| `onDestroy()` | The view is closed for good | `abandonApiPromises()` |

SceneGraph does not chain an override to the base `onDestroy()`. For a screen that calls `fetchAsync`, the `auto-abandon-promises` BSC plugin injects `abandonApiPromises()` into the screen's own `onDestroy()`, and fails the build when the screen has none. A screen that reaches the API pool through a shared `source/` helper is not detected; its header lists that limit.

`JRScreen.bs` has no `init()`. `JRScene.init()` starts the `roku-log` log manager, at level 4 in debug builds and 2 otherwise, so every component can log ([logging.md](logging.md)).

#### The `JRScreen` lifecycle bridge

sgRouter drives its views through `onViewOpen`, `onViewResume`, `onViewSuspend` and `beforeViewClose`, and asks one to take focus through `handleFocus()`. `JRScreen.bs` overrides those and calls the screen's own functions, so no screen implements a router hook ([ADR 0019](../adr/0019-jrscreen-lifecycle-bridge.md)):

| Router callback | What `JRScreen` does |
|---|---|
| `onViewOpen` (first time on top) | Sets `m.global.activeRoutedView` to itself, then `onScreenShown()` |
| `onViewResume` (back on top after being covered) | The same |
| `onViewSuspend` (covered by a new view) | `saveLastFocus()` stores the deepest focused node in `lastFocus`, then marks the view covered. The view is still visible, so `onScreenHidden()` waits for `hideCovered()` |
| `hideCovered()` (called by `JRScene`, not the router) | Hides the view, and runs `onScreenHidden()` if it was covered ([the screen swap](#the-screen-swap)) |
| `beforeViewClose` (closed for good) | `onScreenHidden()`, then `onDestroy()` |
| `handleFocus` | `restoreScreenFocus()`, unless the call is only a notice ([focus management](#focus-management)) |

`activeRoutedView` is set before `onScreenShown()` runs, because the overhang controller, the playback code and the options key all find the screen on show through it. `getActiveView()` in `source/utils/misc.bs` returns it.

> **Never set `m.top.id` on a routed view.** sgRouter uses the view's `id` as its history id, and changing it breaks `goBack`.

## The router host: `JRScene`

`JRScene` is the app's one scene ([bootstrap.md](bootstrap.md#the-root-scene-jrscene) has its children and fields). It owns `<sgrouter_Outlet id="routerOutlet">`, where every routed view mounts, and `<JROverhang id="overhang">`. There is no other content slot: add a screen as a route.

The `sgrouter` namespace resolves only on the render thread, so the main thread (`main.bs`, `loginRouter.bs`, `replayRoute.bs`) navigates by `callFunc` into `JRScene`. `JRScene` is a plain `Scene`, not a `sgrouter_View`, so `JRScene.bs` imports the router and promise scripts itself.

### `initRouter()`

`JRScene.initRouter()` does nothing when a router exists. Otherwise it:

1. Observes `m.global.activeRoutedView` (the overhang controller), `playbackLaunchRequest` and `photoLaunchRequest` (the launch bridges, below). Each observer is removed before it is added, so a second sign-in does not double it.
2. Builds the guard list from the `AuthManager` node on `m.global`.
3. Calls `sgrouter.initialize()` with the outlet, sets `suspendMode: "show"` on every route in a loop, then calls `sgrouter.addRoutes()`.

It does not navigate. Each entry point that navigates calls it first (`routerNavigate`, `replayRoutedDeepLink`, `resolveDeepLink`, `replayDeepLinkReplacingPlayer`), so it runs again after `resetRouter()` at sign-out.

### The route table

| Name | Pattern | Component | Flags |
|---|---|---|---|
| `home` | `/` | `Home` | `clearStackOnResolve`, `allowReuse`, guard |
| `server` | `/server` | `SetServerScreen` | none |
| `users` | `/users` | `UserSelect` | none |
| `login` | `/login` | `LoginScene` | none |
| `play` | `/details/:type/:id/play` | `PlayerHostView` | guard |
| `details` | `/details/:type/:id` | `ItemDetails` | guard |
| `library` | `/library/:id` | `BaseGridView` | guard |
| `search` | `/search` | `SearchResults` | guard |
| `settings` | `/settings` | `Settings` | guard |
| `photo` | `/photo` | `PhotoDetails` | guard |
| `audio` | `/audio` | `AudioPlayerView` | guard |

"Guard" is the `AuthManager` `canActivate` check ([below](#the-auth-guard)). The pre-login routes have none, because `/login` is where the guard sends a signed-out user. Every route also gets `suspendMode: "show"` ([the screen swap](#the-screen-swap)). Code that builds a route by name, such as `JRScene.onDeepLinkResolved` checking for `library`, depends on the names.

What the flags mean:

- **`clearStackOnResolve`** (Home): navigating to `/` clears the router's stack, so Home becomes the root. That is how the pre-login screens go once sign-in finishes, and how a theme or language change rebuilds Home.
- **`allowReuse`** (Home only): the router keeps the existing Home instead of building a new one. Details leaves it off: every navigation to details builds a new `ItemDetails`, which is what the component is written for. A navigation to the path already on screen reuses the view anyway, whatever the flags (`isSamePath` in the router's `_navigateTo`); `ItemDetails.onRouteUpdate` handles that case, when a cast targets the item already showing.
- **`suspendMode: "show"`** (every route): a covered view stays in the outlet, and `JRScene` hides it. `goBack` resumes it through `onViewResume`, which is how Back from `/play` returns to the details it was launched from.
- **`keepAlive`: never.** It reads like "keep alive while covered" and means "keep after it is closed": a cache of views by path, for the whole session, which nothing short of `sgrouter.destroy()` empties. A kept view never runs `onDestroy()`, so its Tasks, observers and textures stay. [ADR 0029](../adr/0029-destroy-routed-screens-on-pop.md) has the measurement that removed it.

> **A session reset uses `resetRouter()`, not `clearStackOnResolve`.** Only `sgrouter.destroy()` empties the router's stores and releases the router itself. Signing out by navigating Home would leave the router live under a signed-out session.

### The screen swap

Going forward, the old screen, the new screen and the overhang change in one render pass. sgRouter does not promise that: it runs the outgoing view's suspend and the incoming view's `onViewOpen` as separate promise steps, several message-loop turns apart, so with `"hide"` or `"detach"` the old screen vanished before the new one appeared. [ADR 0050](../adr/0050-same-frame-screen-swap.md) has the decision and the timings. So every route suspends with `"show"`, and `JRScene` drives the swap:

1. The router suspends the outgoing view and leaves it visible. `onViewSuspend()` saves its focus and marks it covered.
2. The router shows the incoming view and calls its `onViewOpen()`, which sets `m.global.activeRoutedView`.
3. `JRScene.onActiveRoutedViewChanged()` runs inside that write ([overhang controller](#overhang-controller)). It hides the previous view through `hideCovered()` and shows the new view's overhang.

Steps 2 and 3 run in one synchronous call, so nothing renders between them. Going back, the router closes the outgoing view instead of suspending it, so `hideCovered()` only hides it: `beforeViewClose` already ran `onScreenHidden()`.

`onScreenHidden()` runs at the swap, not at suspend, because the screen is still visible at suspend. Anything it changes on screen, such as a backdrop, would change before the new screen arrives.

### The auth guard

`setGlobalNodes()` (`source/utils/globals.bs`) creates `AuthManager` on `m.global` before the routes are added, and the same node is the `canActivate` guard on every post-login route. The router calls it on the render thread for each guarded navigation. It checks the token only, with no network call; the sign-in flow validates the token against the server.

```brightscript
function canActivate(currentRequest as object) as dynamic
  if isValidAndNotEmpty(m.global.user.authToken) then return true
  if isValid(currentRequest) and isValidAndNotEmpty(currentRequest.path)
    m.top.stashedRoute = currentRequest.path
  end if
  return { path: "/login" }
end function
```

With no token, it stores the requested path on `stashedRoute` and returns `{ path: "/login" }`. The router treats any associative array with a non-empty `path` as a redirect (`sgrouter_runGuardChecks`), the shape `sgrouter.createRedirectCommand("/login")` builds, so the guard node does not need the router namespace. Registering the node that lives on `m.global` is what lets the main thread read the stash after sign-in.

#### Replaying a stashed route

After sign-in, `main.bs` `createAndShowHomeGroup()` calls `replayAfterLogin()` (`source/replayRoute.bs`). A stashed deep link (`AuthManager.stashedDeepLink`) goes first, through `JRScene.resolveDeepLink`: [bootstrap.md](bootstrap.md#deep-links) owns that path. Otherwise it reads and clears `stashedRoute`, and passes `buildReplayRoutes(stashed)` to `JRScene.replayRoutedDeepLink`:

| Stash | Route chain |
|---|---|
| empty | `["/"]`: Home |
| a plain route | `["/", route]`: Home, then the route |
| a `/play` route | `["/", detailsPath, playPath]`, so Back goes Player, Details, Home |

`AuthManager.canActivate` is the only writer of `stashedRoute`.

### Navigation functions on `JRScene`

The main thread reaches the ones in `JRScene.xml`'s interface by `callFunc`.

| Function | What it does | Called from |
|---|---|---|
| `routerNavigate(path, context, clearSpinner)` | `initRouter()`, then `navigateThenFocus()` | `loginRouter.routerNav()` (the pre-login routes) and the remote-control commands Home, Search and Settings (`remoteDispatch.dispatchRoute()`) |
| `navigateThenFocus(path, context, clearSpinner)` | `sgrouter.navigateTo()`; when it settles, `sgrouter.setFocus()`; when it fails, logs and takes focus again so the remote is never stranded. With `clearSpinner`, stops the spinner at either end ([spinners](#loading-spinners-across-navigation)) | `routerNavigate`, the last step of `navigateChainStep`, deep-link resolve |
| `replayRoutedDeepLink(routes)` | `initRouter()`, then `navigateChainStep(routes, 0, true)`. Defaults to `["/"]` | `replayAfterLogin()` |
| `navigateChainStep(routes, index, clearLoginSpinnerOnEnd)` | Navigates one route and, when its promise settles, the next. The last step takes focus and, if asked, clears the sign-in spinner | `replayRoutedDeepLink`, `replayDeepLinkReplacingPlayer` |
| `resolveDeepLink(args)` | Fetches the item before navigating, then `onDeepLinkResolved` routes to it ([bootstrap.md](bootstrap.md#resolving)). `cancelDeepLinkResolve()` stops the fetch | `replayAfterLogin()`, `replayDeepLinkRuntime()` |
| `replayDeepLinkReplacingPlayer(targetRoute)` | Replaces a playing player ([below](#replacing-an-active-player)) | `onDeepLinkResolved`, for a playback cast over a player |
| `onPlaybackLaunchRequested()` | Observer of `m.global.playbackLaunchRequest`: audio goes to `/audio`, every video type to `/details/<type>/<id>/play`. The queue decides what plays | `QueueManager.playQueue`, which cannot navigate |
| `onPhotoLaunchRequested()` | Observer of `m.global.photoLaunchRequest`: navigates to `/photo` with the request as route context | `QueueManager.onQuickPlayTaskOutput()`, `quickplay.bs` |
| `reloadRoutedHome()` | `sgrouter.navigateTo("/")`; `clearStackOnResolve` rebuilds Home with the new theme or language | `main.bs`, on `SceneManager.reloadHomeRequested` |
| `routerGoBack()` | `sgrouter.goBack()` | The remote-control Back command (`remoteDispatch.dispatchGoBack()`) |
| `resetRouter()` | Removes the three observers, closes the mounted views (`teardownRoutedViews`), drops the screen's waits, cancels a deep-link fetch, calls `sgrouter.destroy()`, clears `activeRoutedView` and hides the overhang | Sign-out, change user and change server in `main.bs`, and `replayRoute.onServerProbeDone` for a cast to another server |

`resetRouter()` closes the views itself because `sgrouter.destroy()` removes the view nodes without running their lifecycle. Without it, a view covered at sign-out would keep its Tasks and observers and never abandon its API promises.

> **`teardownRoutedViews` reaches covered views because no route detaches them.** It walks the outlet's `viewTarget`, where a `"show"` view stays when covered. A `"detach"` view would sit in the router's detach store (`m.__router_detachedViews`), which this loop cannot see, and `sgrouter.destroy()` would remove it without `onDestroy()`. Measured 2026-10-07 on a Streaming Stick (3600X), resetting with Home, a library and a details screen on the stack: with details and library on `"detach"` the library never got `beforeViewClose`; with every route on `"show"`, all three did. Check this before giving any route `"detach"` or `keepAlive`.

## Loading spinners across navigation

`startLoadingSpinner()` and `stopLoadingSpinner()` (`source/utils/misc.bs`) set the scene's `isLoading` and `isRemoteDisabled`. `JRScene.onIsLoadingChanged()` shows the spinner and also sets `activeRoutedView.visible = not isRemoteDisabled`, so a blocking spinner hides the screen and stopping it shows the screen again.

**A screen that loads data on open owns its spinner.** Callers only navigate. When a spinner goes missing, the destination screen is the first place to look.

| Screen | Starts | Stops |
|---|---|---|
| `BaseGridView` | `prepareDataLoad()`, from `loadInitialItems()` | `stopGridSpinner()` |
| Live TV schedule (`schedule.bs`) | `startLoading()`, `reloadChannels()` | `onChannelsLoaded()`, `onChannelPageFailed()` |
| `ItemDetails` | `onItemIdChanged()`, before the metadata fetch | `onDetailsLoaded()` |
| `SearchResults` | a content wait, `screenWaits.begin()` in `searchMedias()` | `screenWaits.finish()` |
| `PhotoDetails` | `QueueManager.launchItem()` | `showPhoto()` |

`ItemDetails` starts the spinner from its `itemId` observer, which runs before the empty screen draws a frame. When the route context already holds the full item, as from a resolved deep link, it shows no spinner. Every other item type that `launchItem()` handles opens a playback start instead of a spinner ([below](#what-kind-of-wait-a-spinner-is)).

**Sign-in is the one spinner that crosses screens.** `loginRouter.bs` starts a blocking spinner on the outgoing pre-login screen (`onServerSubmitted`, `onUserSelected`, `onCredentialsSubmitted`), then navigates to a different screen. `navigateTo` settles only at `NavigationEnd`, so until then `activeRoutedView` is still the outgoing screen. Stopping the spinner before that resets `isRemoteDisabled` and shows the outgoing screen again for a frame before the next one mounts: the "login flash" of #677. So the spinner stays up across the navigation and is cleared when it settles, through `clearSpinner` on `navigateThenFocus`. The step to `/login` passes it through `routerNavigate`, and the step to Home through `replayRoutedDeepLink` and `navigateChainStep`. When a deep link is stashed, `resolveDeepLink` takes the spinner over and `onDeepLinkResolved` clears it.

### What kind of wait a spinner is

The spinner is one widget, but the waits it covers are not alike, and each kind has its own rules for what the viewer is told and what Back does. The kinds are `LoadingKind` (`source/enums/LoadingKind.bs`), and the text under the spinner comes from `loadingStages` (`source/utils/loadingStages.bs`). The decision and the alternatives ruled out: [ADR 0044](../adr/0044-spinner-by-kind-of-wait.md).

| Kind | The wait | Back | Text under the spinner |
|---|---|---|---|
| **Content load**, `screenWaits.begin(m.top, name)` | A screen waiting on the server for the data it shows | Leaves the screen, and its waits go with it. The pool skips a queued read nobody waits for and stops a long one already sent ([api.md](api.md#a-request-nobody-is-waiting-for), [ADR 0043](../adr/0043-pool-stops-long-reads-of-gone-callers.md)) | "Still loading…" from 8 s, "The server is taking a while to answer." from 30 s |
| **Playback start**, `QueueManager.beginPlaybackStart(label)` | From the press to the player holding a stream: a queue build (Play all, shuffle), the server opening a play session (`PlaybackInfo`, a live stream) | Before a player exists, cancels the start, stops the queue build and shows the screen Play was pressed on. After, the player's teardown fails it, and a live stream still opening is allowed to finish so it is closed ([ADR 0045](../adr/0045-live-stream-open-handed-off-by-stage.md)) | The same stages, under the channel name on a channel switch |
| **Buffering**, not built yet | The player refilling mid-playback | The player's own handling | None: the wait is not a server answer |
| **Session change**, not built yet | Sign in or out, switching user or server, the server scan, the boot-time font download | Blocked | None |

**Plain** (`startLoadingSpinner()`) is a spinner no call site has given a kind yet: the spinner and the caller's text, nothing else. A call site moves to a kind only when it meets that kind's rules.

- **A screen's waits live on the screen, by name.** `screenWaits.begin(m.top, "results")` opens a wait in the screen's `loadingWaits` field, and `screenWaits.finish(m.top, "results")` ends it. `JRScene.bindLoadingWaits()` follows the active view's field, so a screen's waits show only while it is the active view. They go when it closes, hide while another view covers it, and show again when it returns, still counting from when each began. A screen can end only its own waits, so a late answer for a screen the viewer has left cannot stop the spinner of the one they are on. The spinner stays until the last open wait ends. Beginning an open wait restarts it (a new query replaces the last), and finishing one that is not open does nothing, so every exit path can call it. Don't end a screen's wait with `stopLoadingSpinner()`: that is the scene's spinner.
- **The scene's own spinner shows over a screen's waits.** `startLoadingSpinner()` and a deep-link fetch are waits the whole app is in. While one is up it owns the spinner, and the screen's waits show again when it stops. Its stop ends whatever scene spinner is up, which is why each call site moves to a named kind.
- **App waits outlive the screen that started them, and each is a Promise.** A playback start runs from a press on one screen to a player on another, so it cannot live on either. `appWaits.begin(kind, label)` (`source/utils/appWaits.bs`) asks the scene's `AppWaitHost` for a Promise, by `callFunc`, and the scene shows the wait until it settles, over the active screen's waits. The first settle wins and later ones do nothing, so every exit path ends it without checking, and code holding one start cannot end another.
- **How a playback start runs.** `QueueManager` opens it (`beginPlaybackStart`) and hands it to the player that mounts (`takePlaybackStart`). The player resolves it when its stream loads and fails it on a failed load or teardown. One nobody ends fails at `timeouts.PLAYBACK_START_LIMIT_MS` and is logged as an error. While it waits, it hides the screen Play was pressed on, and the overhang with it, by `opacity`, which neither the router nor the overhang controller touches. `AppWaitHost` holds the remote focus meanwhile. It sits outside the router outlet, so the hidden screen takes no keys; Back reaches `JRScene`'s [back arbiter](#the-back-arbiter--exit-confirmation), which cancels the start and shows the screen again (`AppWaitHost.cancelOnBack`), and other keys wait. When no start hides a screen, `AppWaitHost.releaseFocus` gives the focus back through the screen's `handleFocus`. A screen that plays sets `isPlaybackScreen` (`JRScreen.xml`), and reaching it is the one screen change that does not fail a start still waiting for its player (`appWaits.leftBehind`, from `AppWaitHost.failLeftBehind`).
- **The text is only ever true.** "The server is taking a while" shows only for kinds whose wait is a server answer. A kind whose wait is not (buffering, a LAN scan, local teardown) gets no stage text rather than wrong text. The stage text has its own line under the spinner (`#loadingStageText`), so a caller's text above it (a channel name, "Downloading fallback font") stays. With several waits open, it counts from the oldest one with stages: that is how long the viewer has waited.
- **Why 8 s.** A normal wait never shows text: even a 512 MB Stick draws a large library's first page in about 3.4 s from a server that keeps up (measured 2026-09-24). The usual guideline is that a wait of around 10 s needs feedback and a way out.
- **The stages reach the viewer only on a wait allowed to run long.** A screen whose wait is one request on the default limit gives up at `timeouts.API_WAIT_MS`, so it shows "Still loading…" briefly and never the 30 s stage. Search makes four requests in sequence, so a slow search can reach it. A content load that can take longer needs a longer limit on its request as well as this kind.
- **A direct write to the scene's `isLoading` resets its kind to plain when the spinner stops**, so a later direct start that names no kind cannot inherit one.

## The back arbiter & exit confirmation

The outlet takes a routed view's Back first and calls `sgrouter.goBack()`. Back reaches `JRScene.onKeyEvent()` only when `goBack` did nothing. That happens at the root of the history, and also while a navigation is running, because sgRouter refuses `goBack` mid-transition. `JRScene` then decides, in this order:

| Check | Then |
|---|---|
| The remote is disabled (`isRemoteDisabled`, a blocking spinner) | Swallow every key |
| A deep-link fetch is running | Cancel it (`cancelDeepLinkResolve()`): Back aborts the cast |
| `isRouterNavigating()` | Swallow: the navigation that is settling owns this Back |
| A playback start hides the screen (`AppWaitHost.cancelOnBack`) | Cancel the start and show the screen again |
| Otherwise | `showExitConfirmation()` |

`isRouterNavigating()` reads the router's `routerState.type` field. No router, an empty type, `NavigationEnd`, `NavigationError` or `NavigationCancel` means idle; anything else means a navigation is running. The field is read, never observed: a `routerState` observer coalesces quick writes and drops the final `NavigationEnd`, which once left a mirrored "navigating" flag stuck true so Back never offered to exit. A read always sees the latest value.

`showExitConfirmation()` shows a `showConfirmDialog` and handles the answer itself, in the scoped observer `onExitConfirmResult`, which sets `m.top.exit = true` on yes. `main.bs` sees only the `exit` field it already observes. Answering on `main.bs`'s message port instead would cross threads for every field write and gain nothing.

The options key opens the active view's options panel when the view's `isOptionsAvailable` is true and `nodeHelpers.findOptionsPanel()` finds a panel. It sets `lastFocus` to the view's `focusedChild`, shows the panel and focuses its list.

## Replacing an active player

A playback cast can arrive while a player is on screen. `replayDeepLinkRuntime()` (`source/replayRoute.bs`) hands it to `JRScene.resolveDeepLink`, and once the item is fetched `onDeepLinkResolved` calls `replayDeepLinkReplacingPlayer(detailsRoute)`. That does two things:

1. Calls `teardownForDeepLink()` on the active view, which stops playback at once, so nothing keeps playing. `PlayerHostView` destroys its player, which reports the stop to the server; `AudioPlayerView` stops the audio node and leaves the rest to its `onDestroy()`.
2. `navigateChainStep(["/", targetRoute], 0)`: Home first, then the target. Home's `clearStackOnResolve` clears the stack, the player included. When its `navigateTo` promise settles, the chain mounts the target, which starts playback. Back then goes Player, Details, Home, with nothing of the old item left.

The chain follows `navigateTo`'s promise, which the router always settles, not the `routerState` observer. An earlier design popped the player with `goBack()` and waited for that observer to report `NavigationEnd`. It stranded every cast on device, because the observer drops that value and `goBack` returns a Boolean with no promise to wait on ([ADR 0020](../adr/0020-router-settle-primitive.md)).

**Any other deep link over a player is dropped.** Display mirroring in `jellyfin-web` sends an `open` for every item a casting user browses, which would push `ItemDetails` over the video. `replayDeepLinkRuntime()` drops an `open` when `wouldStackOverActivePlayer()` finds a player active. The same check covers a Roku `open` deep link during playback. See [remote-control.md](remote-control.md).

## Focus management

sgRouter leaves focus to the views. `JRScene` asks a view to take focus through `sgrouter.setFocus()`, which reaches `JRScreen.handleFocus()`, and the lifecycle bridge does the rest:

1. **On suspend**, `saveLastFocus()` walks to the deepest focused node and stores it in `lastFocus`.
2. **On open or resume**, `onScreenShown()` restores `lastFocus`. A screen can override it to fetch data first, then focus.
3. **On `handleFocus`**, `restoreScreenFocus()` restores `lastFocus`, else focuses the view. A screen that restores focus some other way overrides `restoreScreenFocus()`, never `handleFocus()`.

Saving the deepest node, not only `focusedChild`, is what returns the cursor to the right row of a list inside a tab inside a screen. It works as long as `lastFocus` still names what the view shows on return, and nothing takes focus it should not. Three facts decide when it fails:

- **The router calls `handleFocus` after `onScreenShown`.** `sgrouter_showView` runs it in the `finally` of the open or resume promise, so the base restores `lastFocus` a second time. A screen that chooses focus on return from anything but `lastFocus` overrides `restoreScreenFocus()`, the function both paths reach, or the second call undoes the first. `Home.restoreHomeFocus()` (focus left on an overhang icon) and `BaseGridView.restoreGridFocus()` (a load that failed or finished while covered) do.
- **`handleFocus` has four callers, and one is only a notice.**

  | Caller | `routerFocused` | Takes focus |
  |---|---|---|
  | `JRScene`'s `sgrouter.setFocus()` | `true` | Yes |
  | The router, right after `onViewOpen` or `onViewResume` | the router's own flag, often `false` | Yes: this is the call that focuses the player |
  | `AppWaitHost.releaseFocus` | not set | Yes |
  | `sgrouter_onFocusChildChanged`, when focus leaves the outlet | `false` | No |

  Taking focus on the last call would pull it back from the overhang (outside the outlet), a dialog or `AppWaitHost`. So `JRScreen.handleFocus()` leaves focus alone when no show is pending (`m.isShowFocusPending`, set by `onViewOpen` and `onViewResume`, cleared by the next `handleFocus`), `routerFocused` is `false`, and another node holds focus (`isFocusHeldElsewhere()`). Focus stranded on the bare scene still gets restored, because there the call is the recovery path.
- **A detached view's nodes still report focus.** Measured 2026-09-25 on an Ultra (Roku OS 15.3.4), with `BaseGridView` detached under an `ItemDetails`: `setFocus(true)` on its grid returned `true`, and the grid's `hasFocus()` and the view's `isInFocusChain()` both read `true`, while the real focus stayed on the details Play button, which kept answering keys. Routes no longer detach, but the rule stands: `hasFocus()` and `isInFocusChain()` cannot tell whether the viewer is on a view that can be covered. A timer or observer that acts for the viewer (narration, a toast) checks a flag the view keeps from `onScreenShown` and `onScreenHidden` instead: `m.isShown` in `BaseGridView` and `schedule.bs`.

## Overhang controller

`JROverhang` is the top bar: logo, current user, search and settings icons, library tabs and clock. It belongs to `JRScene`, not to any view. A view describes what it wants in its `JRGroup` fields, usually in `init()`, and never touches `JROverhang` directly. The controller copies those fields onto the overhang when the active view changes, so the whole bar changes in one frame.

`JRScene.onActiveRoutedViewChanged()` runs whenever `m.global.activeRoutedView` is written:

1. If the field still holds the same node, it returns. The observer fires many times per navigation for one write (measured 2026-10-07: 23 to 46 times).
2. The previous view is hidden: `hideCovered()` for a `JRScreen`, `visible = false` for anything else ([the screen swap](#the-screen-swap)). Its overhang observers are removed (`unregisterOverhangData`).
3. If the new view is a `JRGroup`, `registerOverhangData()` copies and observes its fields.
4. `bindLoadingWaits()` follows the new view's `loadingWaits`, and `AppWaitHost.failLeftBehind` fails a playback start the viewer has left.

`registerOverhangData()` keeps three behaviors:

- **Tabs before title.** It sets `overhang.tabs` before `overhang.title`, so `onTabsChanged` can hide the title before it draws, with no flash from title to tabs.
- **`selectedTabId` both ways.** When the viewer changes tab in the overhang, `JRScene.onOverhangTabSelected()` writes the view's `selectedTabId`, which the view observes to swap its content. Home uses it for its Home and Favorites tabs.
- **Logo, icons and user dropdown.** `isLogoVisible`, `shouldShowIcons` and `shouldShowUserDropdown` are copied and observed with the tabs and title, so the bar settles in one frame. `shouldShowUserDropdown` is a boolean because the controller takes the name from the signed-in user (`applyOverhangUserDropdown`): a view says only whether the dropdown shows.

## `SceneManager` is a service node

`components/data/SceneManager.bs` holds no navigation stack. It lives at `m.global.sceneManager` and keeps:

| Member | What it is |
|---|---|
| `isDialogOpen` | Whether a dialog is on screen, on either channel: Roku's modal `m.scene.dialog` and the overlays (`isOverlayDialogOpen`). The OSD inactivity hide (`OSD.inactiveCheck`), `VideoPlayerView` and `VideoNotification` ask it before acting |
| `setBackgroundImage` | Passes through to `JRScene.setBackgroundImage` |
| `refreshThemeColors` | Walks the overhang and applies `m.global.constants` again |
| `currentUser` | A field whose `onChange` handler, `updateUser`, updates the overhang |
| `resetTime` | Resets the overhang clock |
| `reloadHome` | Sets `reloadHomeRequested`; `main.bs` observes it and calls `JRScene.reloadRoutedHome` |

`SceneManager` shows no dialogs: every dialog goes through `source/utils/dialogs.bs`. `isDialogOpen` stays on it because it answers for both channels at once.

### The standard dialog system (`source/utils/dialogs.bs`)

Each helper creates a dialog, presents it and returns it. The answer arrives on that dialog's own `result` field, so there is no shared field for two dialogs to overwrite. [dialogs.md](dialogs.md) is the standard for how a dialog looks and behaves; this section covers the helpers, the result and how dialogs relate to navigation.

| Helper | Component | Channel |
|---|---|---|
| `showAlertDialog` | `JRDialog` | Overlay. An optional second button beside OK (`result.buttonIndex` 1) is for an action that stays on the alert's subject, such as **Details** on a playback error. Two answers to a question are `showConfirmDialog` |
| `showConfirmDialog` | `JRDialog` | Overlay |
| `showChoiceDialog` | `JRDialog` when the choices fit as buttons (`choicesFitAsButtons`), else `JRListDialog` through `showListDialog` | Overlay |
| `showStillWatchingDialog` | `JRDialog` with `anyKeyResolves`: any key answers | Overlay |
| `showListDialog` | `JRListDialog`. An optional `icons` array puts a glyph beside each row, for action lists; pickers use that space for the check on the current choice | Overlay |
| `showOverflowMenu` | `JRListDialog` anchored to a button, sized to its rows, with no title ([dialogs.md](dialogs.md#presenting-and-tearing-down)) | Overlay |
| `showInfoDialog` | `OverviewDialog` | Overlay |
| `showReportDialog` | `OverviewDialog`, with label and value rows. Setting its `sections` again with the same row ids rewrites the values in place ([dialogs.md](dialogs.md#a-read-only-body-can-be-a-paragraph-or-rows)) | Overlay |
| `showQuickConnectDialog` | `QuickConnectDialog` | Overlay |
| `showKeyboardDialog` | `JRKeyboardDialog` | Roku's modal channel (`m.scene.dialog`): the OS owns the keyboard |

From a component, pass `onResult` (a function name in your scope) and the helper wires a scoped observer. From main-thread code, leave it out and observe the dialog on your message port. The result has the same shape either way: `{ cancelled, confirmed, buttonIndex, buttonText, optionIndex, value, externallyCancelled }`. `externallyCancelled` is true when code closed the dialog (`cancelOpenDialog`, or a newer overlay replacing it) and false when the viewer did, Back included. Only a handler that acts on its result needs it ([dialogs.md](dialogs.md#presenting-and-tearing-down)).

**Overlays are appended to the scene, not to the screen that opened them**, so one outlives a routed view destroyed under it. A screen that opens a dialog tears it down itself:

| Verb | Delivers | Use when |
|---|---|---|
| `abandonDialog(dialog)` | nothing | You own it and your scope is being torn down (`onDestroy`): nobody is left to receive a result |
| `cancelOpenDialog()` | a canceled result, on either channel | Someone else owns it, is still alive and waits on its answer (a main-thread flow such as the deep-link server switch). It looks the same as the viewer pressing Back |

`PlayerHostView.prepareToLeaveMount()` uses both at the end of playback: it abandons its own dialogs (the error dialog, the playback report, the track picker, the still-watching prompt), then cancels whatever else is open.

### Exactly one overlay dialog

Roku's modal channel holds one dialog: the OS replaces whatever was there. The overlay channel does not, so JellyRock keeps it to one. Two overlays would share the `jrDialog` id, so `findNode` would find the wrong one, and the lower dialog would stay visible but take no keys.

`presentOverlayDialog` therefore replaces: it cancels the overlay on screen through that dialog's own resolve guard, so its owner gets the canceled result Back would have produced, then appends the new one. That is safe at every call site: the replaced dialog's owner gets what Back would give it, and every handler acts on a yes only when `confirmed` is true. It still logs a warning, because two overlays racing points at something upstream, such as two casts at once.

- **A main-thread owner needs no code for this.** Its message port delivers the canceled result only at the next `wait(0, m.port)`, after the flow has moved on to its new dialog, so its identity check rejects the old one. `replayRoute.onServerSwitchDialogResult` is the example.
- **The modal channel is never replaced.** `cancelOpenDialog()` closes both channels, but `presentOverlayDialog` replaces only an overlay. Canceling an open keyboard throws away what the viewer typed (`ConfigList` and `SetServerScreen` apply the value only when `confirmed`), which is a worse trade than closing a yes-or-no question. The two channels can be open at once, and nothing arbitrates between them.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md): search by `area` for navigation, `sgRouter` and `SceneManager` entries.
