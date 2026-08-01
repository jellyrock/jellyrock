---
topic: navigation
related-files:
  - components/JRScene.bs
  - components/JRScene.xml
  - components/JRScreen.bs
  - components/JRScreen.xml
  - components/JRGroup.xml
  - components/auth/AuthManager.bs
  - components/auth/AuthManager.xml
  - components/data/SceneManager.bs
  - source/replayRoute.bs
  - source/loginRouter.bs
last-reviewed: 2026-07-15
---

# Navigation (sgRouter)

How JellyRock moves between screens, where focus lives during transitions, and how the persistent overhang stays in sync.

As of #550 the **whole app is routed through [`@rokucommunity/sgrouter`](https://github.com/rokucommunity/sgrouter)**. There is no longer a `SceneManager` scene-stack; `pushScene`/`popScene`/`clearScenes` are gone. Every screen — pre-login, content, and playback — is a router *view* mounted into a single outlet on `JRScene`. `SceneManager` survives only as a shared **service node** (dialogs, backdrop, theme, overhang passthrough fields).

## The component triad

Three base classes form the screen hierarchy. Every UI component inherits from one of them.

```brightscript
roSGNode
  └─ Group
      └─ JRGroup           ← components/JRGroup.xml (interface only, no .bs)
          ├─ <any sub-panel or dialog>
          └─ sgrouter_View
              └─ JRScreen  ← components/JRScreen.xml/.bs (full-screen routed views)
                  ├─ Home
                  ├─ ItemDetails
                  ├─ BaseGridView
                  ├─ SearchResults
                  ├─ Settings
                  ├─ PlayerHostView
                  ├─ AudioPlayerView
                  ├─ PhotoDetails
                  ├─ SetServerScreen / UserSelect / LoginScene  (pre-login)
                  └─ ...

Scene
  └─ JRScene               ← components/JRScene.xml/.bs (the router HOST; one for the app's lifetime)
```

`JRScreen` extends `sgrouter_View` (the router's view base), so every full-screen component is a router view with no per-screen wiring — `JRScreen.bs` bridges the router lifecycle to JellyRock's existing `onScreen*` contract (see "`JRScreen` lifecycle bridge" below). `JRScene` is a plain `Scene`, so it does **not** inherit `sgrouter_View`'s scripts; it imports the `sgrouter`/`promises` namespaces directly (`JRScene.bs:6-14`) to drive the router.

### `JRGroup` — `components/JRGroup.xml`

Pure interface declaration. No BrighterScript backing file. Adds these fields to every group:

| Field | Type | Purpose |
|---|---|---|
| `backPressed` | bool (alwaysNotify) | Set to true when child wants to handle back internally |
| `lastFocus` | node | The element that had focus when this group was last shown/suspended |
| `overhangTitle` | string | Title to display in the top bar |
| `overhangTabs` | array | Tab definitions for the top bar |
| `selectedTabId` | string (alwaysNotify) | Currently selected tab |
| `isOverhangVisible` | bool (default: true) | Hide the top bar (e.g., during video playback) |
| `isLogoVisible` | bool (default: false) | Show the JellyRock logo in the overhang |
| `shouldShowIcons` | bool (default: false) | Show the search + settings icons (gated also on a current user) |
| `shouldShowUserDropdown` | bool (default: false) | Show the current-user dropdown (controller derives the name from the global user) |
| `isOptionsAvailable` | bool (default: true) | Whether the options key opens a panel for this group |

`JRScene`'s overhang controller reads these fields when the router mounts/switches the active view (see "Overhang controller" below). `JRGroup` is still the base for sub-panels and dialogs, and still carries the overhang interface surface.

### `JRScreen` — `components/JRScreen.xml/.bs`

Extends `sgrouter_View` (via `JRGroup`). Declares three lifecycle virtual functions that subclasses override:

```brightscript
sub onScreenShown()       ' Called when this view becomes active (open, or resume from suspend)
sub onScreenHidden()      ' Called when this view is suspended or being closed
sub onDestroy()           ' Called when this view is permanently destroyed
```

The base implementations are minimal:

- `onScreenShown()` restores focus from `lastFocus` (or sets focus on the view itself)
- `onScreenHidden()` is a no-op
- `onDestroy()` calls `abandonApiPromises()` so a late pool response can't fire into a destroyed node (this is the floor for screens that *don't* override `onDestroy`; screens that do get `abandonApiPromises()` injected by the `auto-abandon-promises` BSC plugin — `SG-component` `onDestroy` does not chain to this base, so each override must carry its own cleanup)

The `roku-log` log manager is initialized in `JRScene.bs:init()` (debug builds: level 5; prod: level 2), so every component has logging available without each one having to call `initializeLogManager`. `JRScreen.bs:init()` keeps a fallback call for suites that mount a screen without `JRScene`; it must not be the primary, because global nodes are constructed before the first screen. See [logging.md](logging.md).

#### `JRScreen` lifecycle bridge

sgRouter drives the views it mounts through a promise-native lifecycle (`onViewOpen` / `onViewResume` / `onViewSuspend` / `beforeViewClose`) and asks them to take focus via `handleFocus()`. JellyRock screens implement `onScreenShown` / `onScreenHidden` / `onDestroy`. `JRScreen.bs:68-106` bridges the two so every existing screen works under the router with **no per-screen changes**:

| Router callback | `JRScreen` bridge (`JRScreen.bs`) |
|---|---|
| `onViewOpen` (first activation) | publishes `m.global.activeRoutedView = m.top`, then `onScreenShown()` |
| `onViewResume` (`keepAlive` view back on top) | publishes `m.global.activeRoutedView = m.top`, then `onScreenShown()` |
| `onViewSuspend` (a new view pushed on top, this one kept alive) | `saveLastFocus()` (walk to deepest focused descendant → `m.top.lastFocus`), then `onScreenHidden()` |
| `beforeViewClose` (permanent destroy) | `onScreenHidden()` + `onDestroy()` |
| `handleFocus` (router asks for remote focus) | restore `m.top.lastFocus` if valid, else focus `m.top` |

Publishing `activeRoutedView` *before* `onScreenShown` matters: `JRScene`'s overhang controller and `main.bs`'s playback/options/device code all resolve "what's on screen" via `getActiveView()`, which now simply returns `m.global.activeRoutedView` (`source/utils/misc.bs:218`).

> **Locked invariant — never set `m.top.id` on a routed view.** sgRouter uses the view node's `id` as its history-node id; clobbering it breaks `goBack`.

### `JRScene` — `components/JRScene.xml/.bs`

The router **host**. One scene for the entire lifetime of the channel. See `bootstrap.md` for its full child layout and interface fields. Relevant here: it owns a `<sgrouter_Outlet id="routerOutlet">` (the live navigation surface — every routed view mounts here) and a `<JROverhang id="overhang">` driven by `JRScene`'s overhang controller.

> The old `<Group id="content"/>` slot that `SceneManager` swapped screens into was **removed** along with the scene stack — `JRScene.xml` now declares only the `<sgrouter_Outlet>` as the navigation surface. Don't reintroduce a content slot; use the router.

## The router host — `components/JRScene.bs`

`JRScene` initializes the router, registers the route table, drives the overhang from the router-active view, and confirms app exit. Navigation is driven from the **main thread** (`main.bs` / `loginRouter`) via `callFunc` into `JRScene`'s render-thread functions, because the `sgrouter` namespace resolves on the render thread and the main loop can't call it directly.

### `initRouter()` — idempotent bring-up (`JRScene.bs:270`)

A no-op if a router already exists (`sgrouter.getRouter()`). Otherwise it:

1. Registers the overhang controller — `m.global.observeField("activeRoutedView", "onActiveRoutedViewChanged")`.
2. Registers the playback launch bridge — `m.global.observeField("playbackLaunchRequest", "onPlaybackLaunchRequested")`. `QueueManager.playQueue` can't navigate (no router chain), so it sets this field and `JRScene` turns it into a route.
3. Registers the photo launch bridge — `m.global.observeField("photoLaunchRequest", "onPhotoLaunchRequested")`.
4. Builds the auth guard reference — `guard = [m.global.AuthManager]` (the same node created on `m.global` in `setGlobalNodes`, registered by **node reference**).
5. `sgrouter.initialize({ outlet: m.top.findNode("routerOutlet") })` then `sgrouter.addRoutes([...])`.

`initRouter()` does **not** navigate. The first `routerNavigate` / `replayRoutedDeepLink` call brings the router up. It is re-callable after `resetRouter()` (sign-out → re-login): `sgrouter.initialize` creates a fresh router when none exists.

### The route table (`JRScene.bs:298-326`)

Registered exactly as below. Pre-login routes carry **no guard** (their redirect target, `/login`, is one of them); every post-login route carries the `AuthManager` `canActivate` guard.

| Pattern | Component | Flags |
|---|---|---|
| `/` | `Home` | `clearStackOnResolve: true`, `allowReuse: true`, `canActivate` |
| `/server` | `SetServerScreen` | (pre-login — none) |
| `/users` | `UserSelect` | (pre-login — none) |
| `/login` | `LoginScene` | (pre-login — none) |
| `/details/:type/:id/play` | `PlayerHostView` | `canActivate` |
| `/details/:type/:id` | `ItemDetails` | `keepAlive: { enabled: true }`, `canActivate` — **no `allowReuse`** |
| `/library/:id` | `BaseGridView` | `keepAlive: { enabled: true }`, `canActivate` |
| `/search` | `SearchResults` | `keepAlive: { enabled: true }`, `canActivate` |
| `/settings` | `Settings` | `canActivate` |
| `/photo` | `PhotoDetails` | `canActivate` — **no `keepAlive`** |
| `/audio` | `AudioPlayerView` | `canActivate` — **no `keepAlive`** |

What the flags mean:

- **`clearStackOnResolve`** (Home) — resolving `/` clears the visible router stack so Home becomes the back-stack root. This is how the pre-login screens fall away once login completes, and how a theme/locale reload rebuilds Home from scratch.
  > **Locked invariant — session reset MUST use `resetRouter` (`sgrouter.destroy`), not `clearStackOnResolve`.** `clearStackOnResolve` does **not** tear down *suspended* `keepAlive` views; only `destroy()` clears both the active view target and the `keepAlive` view target. Signing out with only `clearStackOnResolve` would leak the suspended detail/library/search views.
- **`allowReuse`** (Home only) — lets the router reuse the existing Home instance instead of recreating it. Deliberately **omitted** on `/details/:type/:id`: JellyRock has always created a fresh `ItemDetails` per navigation (detail→detail included). `allowReuse` would force an in-place `onRouteUpdate` reuse the component was never built for.
- **`keepAlive`** (details / library / search) — when a new view is pushed on top, the view is **suspended** (its node kept, focus saved) rather than destroyed, and **resumed** (focus restored) on `goBack`. This is the router equivalent of a screen staying mounted beneath a pushed screen in the old stack. `keepAlive` on `/details` is what lets detail→`/play` restore the launching detail on back instead of bubbling a spurious Exit dialog.
- **No `keepAlive`** (photo / audio) — a fresh `PhotoDetails` / `AudioPlayerView` per launch, destroyed on `goBack`. Both set `isOverhangVisible = false`, so the overhang hides while they're active and the `keepAlive` view beneath suspends (focus saved) and resumes (focus restored) on back — exactly like the video player.

### The auth guard — `components/auth/AuthManager`

`AuthManager` is created on `m.global` in `setGlobalNodes` (`globals.bs:116`) **before** `addRoutes`, and registered by node reference as the `canActivate` guard on every post-login route. The router invokes it on the render thread once per guarded navigation.

`canActivate(currentRequest)` (`AuthManager.bs:18`) is a cheap **synchronous** token check — no network (launch-time `AboutMe` re-validation stays in the login flow):

```brightscript
function canActivate(currentRequest as object) as dynamic
  if isValidAndNotEmpty(m.global.user.authToken) then return true
  if isValid(currentRequest) and isValidAndNotEmpty(currentRequest.path)
    m.top.stashedRoute = currentRequest.path
  end if
  return { path: "/login" }
end function
```

On a present token it returns `true` (allow). On absence it **stashes the requested path** on `m.top.stashedRoute` and returns `{ path: "/login" }` — a redirect command. The router treats any AA with a non-empty `path` as a redirect (`Router.brs` `sgrouter_runGuardChecks`), the same shape `sgrouter.createRedirectCommand("/login")` produces, without pulling the whole router namespace into the guard node. Registering the *same* instance that lives on `m.global` is the point: the stashed path is readable by the main-thread replay helper after login (see "Deferred deep links" below and `bootstrap.md`).

### Navigation helpers on `JRScene`

| Function | What it does |
|---|---|
| `routerNavigate(path, context, clearSpinner)` | `initRouter()` then `navigateThenFocus(path, context, clearSpinner)`. The main-thread entry point for single navigation calls (pre-login flow + transition to Home). `context` carries route data (e.g. a populated username for `/login`). `clearSpinner` (login paths only) — see "Loading spinners across navigation" below. |
| `navigateThenFocus(path, context, clearSpinner)` | The shared navigate tail: `sgrouter.navigateTo` → on settle, `sgrouter.setFocus` → on reject, warn + re-assert focus (never strand the remote). Centralizes the navigate/focus/catch trio reused by `routerNavigate`, the final step of `navigateChainStep`, and the deep-link resolve calls. `path` is a string or a named-route AA. When `clearSpinner` is set, it `stopLoadingSpinner()`s at settle (`NavigationEnd`) / on reject — used to carry a blocking login spinner across the async nav (see below). |
| `replayRoutedDeepLink(routes)` | `initRouter()` then `navigateChainStep(routes, 0, true)` — a *sequential* route chain for post-login replay (each step waits for the previous to settle). Defaults to `["/"]`. Passes `clearLoginSpinnerOnEnd = true` so the blocking login spinner is cleared only when the final route mounts. |
| `navigateChainStep(routes, index, clearLoginSpinnerOnEnd)` | Navigates `routes[index]`, then chains to the next once it settles (`navigateTo`'s promise resolves at `NavigationEnd`). The final step takes remote focus (and clears the login spinner when `clearLoginSpinnerOnEnd` is set). The runtime-cast caller (`replayDeepLinkReplacingPlayer`) leaves it `false` — no login spinner is up there. |
| `onPlaybackLaunchRequested()` | Reads `m.global.playbackLaunchRequest`; audio → `/audio`, every video-family type → `/details/<type>/<id>/play`. The queue is the source of truth for what plays. |
| `onPhotoLaunchRequested()` | Reads `m.global.photoLaunchRequest`; navigates `/photo` carrying the launch AA through as route context (`PhotoDetails` reads it on mount). |
| `reloadRoutedHome()` | `sgrouter.navigateTo("/")` — a fresh Home render after theme/locale change (Home's `clearStackOnResolve` rebuilds it, picking up new theme constants / translations). |
| `routerGoBack()` | Main-thread wrapper for `sgrouter.goBack()` (e.g. after a delete confirmation leaves the now-deleted detail). |
| `resetRouter()` | Removes the overhang/playback/photo observers, **drives `beforeViewClose` (→ `onScreenHidden` + `onDestroy`) on every mounted routed view** (`teardownRoutedViews` — both the active view and the suspended `keepAlive` views), then `sgrouter.destroy()`, clears `m.global.activeRoutedView`, hides the overhang. Called on sign-out / change-user / change-server before `reenterLogin`. The explicit teardown is required because `sgrouter.destroy()` removes the view *nodes* without running their lifecycle — without it a `keepAlive` view suspended at sign-out leaks its Tasks/observers and never abandons in-flight API promises. |

### Loading spinners across navigation

The scene-level loading spinner is toggled by `JRScene.onIsLoadingChanged` (fired by `startLoadingSpinner()` / `stopLoadingSpinner()` in `misc.bs`, which set `isLoading` + `isRemoteDisabled` on the scene). Crucially it also toggles the active view: `activeRoutedView.visible = not isRemoteDisabled`. So a **blocking** spinner (`isRemoteDisabled = true`) hides the current view; stopping it shows the current view again.

**Convention: a routed destination screen owns its own load spinner.** The screen that loads data on open starts the spinner when its fetch begins and stops it when the data arrives; callers just `navigateTo`. This is the pattern the sgRouter migration established, and where a spinner "goes missing" it's almost always a screen that didn't get the memo.

- **Self-starting screens** — `BaseGridView` (`loadInitialItems` → `prepareDataLoad`), `SearchResults` (`searchMedias`), the Live TV schedule: start *and* stop their own spinner.
- **Launcher-started** — photo / player: `QueueManager.launchItem` (and the play/quickplay paths) start the spinner; the destination (`PhotoDetails` on mount, the player when content loads) stops it.
- **`ItemDetails`** — starts the spinner in `onItemIdChanged` (right before the metadata fetch task), stops it in `onDetailsLoaded`. Its start used to live in the removed `showScenes.CreateItemDetailsGroup` factory; the migration didn't re-home it, so item opens showed no spinner until this was restored. `itemId`'s `onChange` is a synchronous scoped observer, so the spinner is up before the empty springboard renders a frame; the complete-context (deep-link) early-return shows no spinner for an already-loaded item.

**Login is the one cross-screen exception.** The login coordinator starts a **blocking** spinner on the *outgoing* pre-login view (`onUserSelected` / `onCredentialsSubmitted`), then navigates to a **different** view. Because `navigateTo` is async (it resolves at `NavigationEnd`), `activeRoutedView` is still the outgoing view for the duration of the nav. Stopping the spinner synchronously *before* the nav settles resets `isRemoteDisabled` and re-shows that stale outgoing view for a frame before the destination mounts — the visible "login flash" #677 introduced. The fix is to **keep the spinner up across the nav and clear it at settle** via the `clearSpinner` flag on `navigateThenFocus` (login→Home rides it through `replayRoutedDeepLink` → `navigateChainStep`; the password-required `/login` hop rides it through `routerNavigate`). This mirrors the launcher-started pattern — the destination's mount is what clears the spinner, never a synchronous stop mid-transition.

## The back arbiter & exit confirmation

Because the whole app is routed, a routed view's `back` is intercepted by the **outlet first** (`sgrouter.goBack`). A back key only bubbles up to `JRScene.onKeyEvent` when `goBack` is a no-op — i.e. the router is at history root (depth ≤ 1). That is `JRScene`'s cue to confirm exit (`JRScene.bs:228-233`):

```brightscript
if key = "back"
  showExitConfirmation()   ' router is at root; nothing left to pop
  return true
```

`showExitConfirmation()` (`JRScene.bs:451`) reuses `SceneManager`'s `showConfirmationDialog` and sets `sceneManager.isPendingExitConfirmation = true`. `main.bs`'s `isDataReturned` handler reads that flag and sets `m.scene.exit = true` on confirm — unchanged from the old stack≤1 branch.

To distinguish the two reasons a back bubbles up — at history root (confirm exit) vs. a navigation still in flight (the settling nav owns the back) — the arbiter calls `isRouterNavigating()`, which reads the router's public `routerState.type` field **directly**. A non-terminal type means a nav is in flight (swallow the back); a terminal type (`NavigationEnd`/`NavigationError`/`NavigationCancel`), or no router yet, means idle (confirm exit). The field is **read**, never observed: a `routerState` observer *coalesces* rapid writes and reliably drops the terminal `NavigationEnd` (proven on device — a mirrored `navInProgress` flag wedged true and ate back→exit), but a field *read* never coalesces, so the field always holds the true latest state.

The `options` key (`JRScene.bs:234-242`) opens the active routed view's options panel: it resolves the view via `getActiveView()`, checks `isOptionsAvailable`, saves `lastFocus`, and focuses the panel's list.

## Replacing an active player (cast-over-player)

A playback cast can arrive while a media player is already active (`replayDeepLinkReplacingPlayer`): the old content must tear down and the new content launch. The flow is two steps:

1. `teardownForDeepLink()` on the active view — stop decoding + report to the server synchronously, so nothing keeps playing during the transition.
2. `navigateChainStep(["/", targetRoute], 0)` — navigate **Home first**, then the target. Navigating `"/"` tears the player host down (Home is `clearStackOnResolve`, so the whole stack — player host included — clears and Home re-mounts) and its `navigateTo` promise resolves at `NavigationEnd`; the chain then mounts the target, which auto-launches. Back lands Player → Details → Home — the intended deep-link shape — with no stale prior item left behind.

This rides `navigateTo`'s **promise** (via the shared `navigateChainStep`, exactly as post-login deep-link replay does). The promise resolves reliably through the router's internal chain — **not** the coalescing `routerState` field observer — so the navigation can't strand. An earlier design (ADR 0020) instead `goBack()`-popped the player and waited for a `routerState`-observer "settle" event before navigating; that was proven on device to strand every cast, because the observer coalesces and drops the terminal `NavigationEnd` it waited on (`goBack` also returns a bare Boolean, with no promise to chain). See [ADR 0020](../adr/0020-router-settle-primitive.md) for the full postmortem.

**The complement — a non-playback `open` over an active player is *dropped*, not stacked.** Only a *playback* cast replaces the player (above). A `navigate`/`open` deep link arriving while a player is active — e.g. jellyfin web's Display Mirroring emitting a `DisplayContent` on every item-detail browse while JellyRock is the cast target — would otherwise plain-push `ItemDetails` on top of live playback. `replayDeepLinkRuntime` guards this via `wouldStackOverActivePlayer` (drop when `activeRoutedView` is a media player), so the controller's incidental browsing never yanks the cast target off the video. The same guard covers a Roku OS `open` deep link arriving mid-playback. See [remote-control.md](remote-control.md).

## Focus management

sgRouter is **hands-off about focus** — views own their own focus; `JRScene` only asks a view to take focus via the router's `setFocus`, which routes to `JRScreen.handleFocus`. The save/restore dance is now driven by the `JRScreen` lifecycle bridge:

1. **On suspend** (`onViewSuspend`) — `saveLastFocus()` walks the focus chain to the *deepest* focused descendant and stores it in `m.top.lastFocus`. (Lifted from the old `SceneManager.pushScene` focus-save loop.)
2. **On resume / open** (`onViewResume` / `onViewOpen`) — `onScreenShown()` runs; its default reads `m.top.lastFocus` and `.setFocus(true)`. Subclasses can override to re-fetch data first, then focus.
3. **On `handleFocus`** — same rule: restore `lastFocus`, else focus the view root.

Preserving the *deepest* focused element (not just `focusedChild`) matters for nested panels (a list inside a tab inside a screen) so back navigation lands the cursor exactly where the user left it. For `keepAlive` views, this is what makes suspend→resume feel seamless: the cursor returns to its exact prior position. The `lastFocus` mechanism is one of the things JellyRock gets reliably right.

## Overhang controller

`JROverhang` is the persistent top bar (logo, current user info, search icon, settings icon, library tabs, clock). It lives in `JRScene` and is **not** part of any individual view. Each view *describes* what it wants in the overhang via its `JRGroup` fields (`isOverhangVisible`, `overhangTitle`, `overhangTabs`, `selectedTabId`, `isLogoVisible`, `shouldShowIcons`, `shouldShowUserDropdown`) — the controller projects them onto the shared `JROverhang` atomically on view-change, so the whole top bar updates in one frame (no transition flicker). Views **declare** these (typically in `init()`); they never poke the `JROverhang` node directly.

The controller **now lives on `JRScene`** (lifted verbatim from the deleted `SceneManager` register/`unregister` pair) and is driven by the router's active view rather than a stack. When the router mounts or switches the active view, `m.global.activeRoutedView` changes and `onActiveRoutedViewChanged()` (`JRScene.bs:434`) re-points the binding:

```brightscript
sub onActiveRoutedViewChanged()
  newView = m.global.activeRoutedView
  if isValid(m.previousRoutedView) and not m.previousRoutedView.isSameNode(newView)
    unregisterOverhangData(m.previousRoutedView)
  end if
  if isValid(newView) and newView.isSubType("JRGroup")
    registerOverhangData(newView)
  end if
  m.previousRoutedView = newView
end sub
```

`registerOverhangData(view)` (`JRScene.bs:463`) wires the field observers, preserving two behaviors carried over from the stack era:

- **Tabs before title** — `m.overhang.tabs` is set *before* `m.overhang.title` so `onTabsChanged` can hide the title before it renders with text, preventing a visible title→tab transition flash.
- **Bidirectional `selectedTabId`** — when the user changes tabs in the overhang, `onOverhangTabSelected` (`JRScene.bs:504`) writes back into the active routed view's `selectedTabId`, which the view observes to swap content. Home uses this for the home/favorites tab swap.
- **Logo / icons / dropdown projection** — `isLogoVisible`, `shouldShowIcons` and `shouldShowUserDropdown` are projected (and observed) alongside tabs/title so the whole overhang settles in one frame. `shouldShowUserDropdown` is intentionally a boolean: the controller derives the displayed name from the global user (`applyOverhangUserDropdown`), so a view only declares *whether* the dropdown shows, not the name. This replaced the older pattern where each post-login screen poked `isLogoVisible` / `currentUser` / `shouldShowIcons` imperatively in `onScreenShown` (across multiple frames → a visible overhang flicker on Home↔detail transitions).

## `SceneManager` is now a service node

`components/data/SceneManager.bs` no longer manages a navigation stack. The stack methods (`pushScene` / `popScene` / `getActiveScene` / `clearScenes` / `clearPreviousScene` / `deleteSceneAtIndex` / `settings`) and `SceneManager`'s own overhang-sync helpers were **deleted** in #550. It survives as a shared **service node** at `m.global.sceneManager`:

- **Dialogs** — `userMessage`, `standardDialog`, `radioDialog`, `showConfirmationDialog`, `dismissDialog`, `isDialogOpen`, plus the selection-return contract (`returnData` / `isDataReturned`, `optionSelected` / `optionClosed`).
- **Backdrop** — `setBackgroundImage` (passthrough to `JRScene.setBackgroundImage`).
- **Theme** — `refreshThemeColors` (walks the overhang tree, re-applies `m.global.constants`).
- **Overhang passthrough fields** — `updateUser`, `resetTime`.
- **Reload-home signal** — `reloadHome` sets `reloadHomeRequested = true`; `main.bs` observes it and calls `JRScene.reloadRoutedHome`.

> The long-overview overlay was the last `SceneManager.pushScene` user. It now appends directly to the scene: `FocusableOverview.openOverviewDialog` (`components/ui/label/FocusableOverview.bs:176`) sets `dialog.returnFocusTo = m.top` and `m.top.getScene().appendChild(dialog)`; `OverviewDialog` removes itself and restores focus on close (`OverviewDialog.bs:218-223`).

## Deferred deep links

A deep link launched while signed out is stashed (by the guard, or by the cold-start / runtime handlers in `main.bs`) and replayed after login. The stash producer seeds the queue and sets `m.global.AuthManager.stashedRoute` to a play path; after login, `replayAfterLogin()` (`source/replayRoute.bs`) reads + clears the stash and hands the route chain from `buildReplayRoutes(stashed)` to `JRScene.replayRoutedDeepLink`:

- empty stash → `["/"]` (plain Home)
- a plain route → `["/", route]` (Home → destination)
- a `/play` route → `["/", detailsPath, playPath]` so back unwinds Player → Details → Home

This Home → `ItemDetails` → Player back-stack is **locked decision #3**. Full bootstrap/deep-link mechanics live in `bootstrap.md`; the pre-login coordinator that drives the routed login flow is in `user-journey.md`.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for navigation / `sgRouter` / `SceneManager` entries.
</content>
</invoke>
