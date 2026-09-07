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
  - components/OverviewDialog.bs
  - source/utils/dialogs.bs
  - source/replayRoute.bs
  - source/loginRouter.bs
last-reviewed: 2026-09-04
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

The `roku-log` log manager is initialized in `JRScene.bs:init()` (debug builds: level 4; prod: level 2), so every component has logging available without each one having to call `initializeLogManager`. `JRScreen.bs` deliberately has no `init()` — it must not initialize the manager, because global nodes are constructed before the first screen, and `JRScene.init()` is already the earliest point the manager can exist. See [logging.md](logging.md).

#### `JRScreen` lifecycle bridge

sgRouter drives the views it mounts through a promise-native lifecycle (`onViewOpen` / `onViewResume` / `onViewSuspend` / `beforeViewClose`) and asks them to take focus via `handleFocus()`. JellyRock screens implement `onScreenShown` / `onScreenHidden` / `onDestroy`. `JRScreen.bs:68-106` bridges the two so every existing screen works under the router with **no per-screen changes**:

| Router callback | `JRScreen` bridge (`JRScreen.bs`) |
|---|---|
| `onViewOpen` (first activation) | publishes `m.global.activeRoutedView = m.top`, then `onScreenShown()` |
| `onViewResume` (suspended view back on top) | publishes `m.global.activeRoutedView = m.top`, then `onScreenShown()` |
| `onViewSuspend` (a new view pushed on top, this one kept alive) | `saveLastFocus()` (walk to deepest focused descendant → `m.top.lastFocus`), then `onScreenHidden()` |
| `beforeViewClose` (permanent destroy) | `onScreenHidden()` + `onDestroy()` |
| `handleFocus` (router asks for remote focus) | restore `m.top.lastFocus` if valid, else focus `m.top` |

Publishing `activeRoutedView` *before* `onScreenShown` matters: `JRScene`'s overhang controller and `main.bs`'s playback/options/device code all resolve "what's on screen" via `getActiveView()`, which now simply returns `m.global.activeRoutedView` (`source/utils/misc.bs:255`).

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
| `/details/:type/:id` | `ItemDetails` | `suspendMode: "detach"`, `canActivate` — **no `allowReuse`** |
| `/library/:id` | `BaseGridView` | `suspendMode: "detach"`, `canActivate` |
| `/search` | `SearchResults` | `suspendMode: "detach"`, `canActivate` |
| `/settings` | `Settings` | `canActivate` |
| `/photo` | `PhotoDetails` | `canActivate` |
| `/audio` | `AudioPlayerView` | `canActivate` |

> **No route sets `keepAlive`, and none should.** See the flag notes below — it is a
> session-lifetime view cache, not a "stay alive while covered" switch.

What the flags mean:

- **`clearStackOnResolve`** (Home) — resolving `/` clears the visible router stack so Home becomes the back-stack root. This is how the pre-login screens fall away once login completes, and how a theme/locale reload rebuilds Home from scratch.
  > **Locked invariant — session reset MUST use `resetRouter` (`sgrouter.destroy`), not `clearStackOnResolve`.** `clearStackOnResolve` runs `beforeViewClose` on the view target's children and on the detach store's non-`keepAlive` residents (`sgrouter_collectDetachedViewsToDestroy`), but only `destroy()` guarantees the store is emptied and the router itself released. Signing out with `clearStackOnResolve` alone leaves the router live under a signed-out session.
- **`allowReuse`** (Home only) — lets the router reuse the existing Home instance instead of recreating it. Deliberately **omitted** on `/details/:type/:id`: JellyRock has always created a fresh `ItemDetails` per navigation (detail→detail included). `allowReuse` would force an in-place `onRouteUpdate` reuse the component was never built for.
  > `allowReuse` does **not** govern a *same-path* navigation. The router reuses the active view whenever `isSamePath` (`Router.brs` `_navigateTo`), independent of every flag — that is the path `ItemDetails.onRouteUpdate` serves when a cast re-targets the item already showing.
- **`suspendMode: "detach"`** (details / library / search) — governs how a view is held while it is **covered** by a view pushed on top: `"detach"` removes it from the tree into the router's detach store and re-attaches it on `goBack`, freeing its render/texture cost while it is not visible. Every outgoing view is suspended this way *regardless of any flag*, and `_goBack` resumes it through `_onViewResume` either way, so back navigation is unaffected. This is what lets detail→`/play` restore the launching detail on back instead of bubbling a spurious Exit dialog.
- **`keepAlive` — do not use it.** It looks like the flag that means "don't destroy while covered". It is not. Upstream documents it as *"retained for later resumption"*: a session-lifetime, **path-keyed view cache**, so a view that is **popped** is kept rather than closed, and a later forward navigation to the same path resumes the old instance. It is also **unbounded** — the only eviction helper (`sgrouter_collectDetachedViewsToDestroy`) skips `keepAlive` views by design, so nothing short of `sgrouter.destroy()` at sign-out releases them.
  > **Why this matters, measured.** These three routes carried `keepAlive` until the retained-view fix. Because the cache is keyed by `route.path`, every *distinct* path visited and backed out of stayed alive for the session — one `BaseGridView` per library, one `ItemDetails` per item. A retained view is **not** an inert node tree: `onScreenHidden` runs on suspend but `onDestroy` does not, and `onDestroy` is where the teardown lives (tasks stopped, ~40 observers dropped, textures freed, promises abandoned, and for `SearchResults` the firmware's global voice route released). An on-device census — browse six items, back out of each, return Home — measured **1,936 unparented roots against a 519-root cold-Home baseline**, growing monotonically (946 → 1,884 across the six round trips). Removing the flag brought the same walk to **458**, flat. (`getRootsCount` counts nodes with *no parent* — the ones held only by a BrightScript reference — not every live node. The load-bearing result is the flatness across round trips; the absolute figure landing under the cold-Home baseline is not a like-for-like comparison, since cold Home and returned-to Home are different app states.)
- **No `suspendMode`** (photo / audio) — defaults to `"hide"`: kept in the tree, hidden and parked off-screen. Both set `isOverhangVisible = false`, so the overhang hides while they're active and the view beneath suspends (focus saved) and resumes (focus restored) on back — exactly like the video player.

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
| `resetRouter()` | Removes the overhang/playback/photo observers, drives `beforeViewClose` (→ `onScreenHidden` + `onDestroy`) on the mounted routed views (`teardownRoutedViews`), then `sgrouter.destroy()`, clears `m.global.activeRoutedView`, hides the overhang. Called on sign-out / change-user / change-server before `reenterLogin`. The explicit teardown is required because `sgrouter.destroy()` removes the view *nodes* without running their lifecycle — without it a view suspended at sign-out leaks its Tasks/observers and never abandons in-flight API promises. **Known gap, see below.** |

> **`teardownRoutedViews` does not reach detached views — a `"detach"` view suspended at sign-out still misses its `onDestroy`.** It walks `["viewTarget", "keepAliveViewTarget"]` under the outlet, but `keepAliveViewTarget` no longer exists in sgRouter 0.1.4: the `Outlet` declares only `viewTarget`, and suspended views live in `m.__router_detachedViews`, an associative array (`Router.brs` notes it outright — suspended `keepAlive` / `detach` views "no longer live in a SceneGraph container"). So that loop iteration finds nothing, and `sgrouter.destroy()` then `removeNode`s the store's residents without lifecycle. Predates [ADR 0029](../adr/0029-destroy-routed-screens-on-pop.md) and is *narrowed* by it — the store used to accumulate every popped view for the session, and now holds at most the covered ones — but the residue is real: sign out from a detail and the library beneath it keeps its `LoadItemsTask`, its observers and its in-flight promises. The fix is to iterate the store via the router's public `getDetachedViews`; tracked as an open followup in [`progress.md`](../progress.md).

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

`showExitConfirmation()` shows a standard `showConfirmDialog` and owns the whole exchange itself. `JRScene` is a component with its own script scope, so it reads the answer through a scoped observer (`onExitConfirmResult`) and sets `m.top.exit = true` on confirm; `main.bs` sees only the `exit` field it already observes. Routing the dialog through `main.bs`'s message port instead would cross the thread boundary for every field write and buy nothing.

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

Preserving the *deepest* focused element (not just `focusedChild`) matters for nested panels (a list inside a tab inside a screen) so back navigation lands the cursor exactly where the user left it. For suspended views, this is what makes suspend→resume feel seamless: the cursor returns to its exact prior position. The `lastFocus` mechanism is one of the things JellyRock gets reliably right.

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

- **The one dialog QUERY** — `isDialogOpen`. `SceneManager` no longer *shows* dialogs at all: `userMessage`, `showConfirmationDialog`, `dismissDialog`, `standardDialog`, `radioDialog`, the shared `returnData` / `isDataReturned` fields and the `isPending*` flags are all **deleted**, along with the `StandardDialog` / `RadioDialog` components. Every dialog goes through `source/utils/dialogs.bs` (see below). What survives is the query, because it has to answer for BOTH channels at once — Roku's modal channel (`m.scene.dialog`) and the scene-appended overlays (via `isOverlayDialogOpen`) — which is what the OSD inactivity auto-hide and the player's end-of-playback teardown ask before acting.
- **Backdrop** — `setBackgroundImage` (passthrough to `JRScene.setBackgroundImage`).
- **Theme** — `refreshThemeColors` (walks the overhang tree, re-applies `m.global.constants`).
- **Overhang passthrough fields** — `updateUser`, `resetTime`.
- **Reload-home signal** — `reloadHome` sets `reloadHomeRequested = true`; `main.bs` observes it and calls `JRScene.reloadRoutedHome`.

> The long-overview overlay was the last `SceneManager.pushScene` user, and then the last hand-rolled scene append. `FocusableOverview.openOverviewDialog` now goes through `showInfoDialog` like every other overlay, passing itself as `returnFocusTo`; `OverviewDialog` removes itself and restores focus on close. The hand-rolled version worked, but it never stamped the shared overlay id — so `isOverlayDialogOpen` / `isDialogOpen` / `cancelOpenDialog` were all blind to it, and `OverviewDialog.cancelDialog()` was unreachable on that path.

### The standard dialog system (`source/utils/dialogs.bs`)

The canonical way to show a dialog. Helpers create the node, present it, and return it;
the result arrives on that **dialog instance's own `result` field**, so there is no shared
global to cross-fire (the failure mode of `SceneManager.returnData`).

| Helper | Component | Presentation |
|---|---|---|
| `showAlertDialog` / `showConfirmDialog` / `showChoiceDialog` | `JRDialog` | Scene-appended overlay (`OverviewDialog` mechanics). `showAlertDialog` takes an optional SECONDARY button beside OK (`result.buttonIndex` 1) — for an action that does not leave the alert's subject, like `[Details]` on a playback error. Two *answers* to a question are `showConfirmDialog` |
| `showListDialog` | `JRListDialog` | Scene-appended overlay. Takes an optional `icons` array paired with `items` — a leading glyph per row, for ACTION lists (a `More` overflow menu) rather than pickers, which use that gutter for the current-option check |
| `showInfoDialog` | `OverviewDialog` | Scene-appended overlay |
| `showReportDialog` | `OverviewDialog` | Scene-appended overlay; structured label/value body instead of a paragraph, and **re-settable** — see below |
| `showQuickConnectDialog` | `QuickConnectDialog` | Scene-appended overlay |
| `showKeyboardDialog` | `JRKeyboardDialog` | Roku modal channel (`m.scene.dialog`) — the OS owns the keyboard |

#### One chrome, one flow

`showReportDialog` is the one helper whose dialog keeps being written to after it opens.
Assigning `sections` again **reconciles**: rows matched by `id` have their text rewritten in
place, and nothing is created or destroyed, so the panel height, the scroll position and
focus all stay put. A structurally different array rebuilds instead. That is what lets the
playback report refresh its live figures without the "set every text field BEFORE
presenting" rule biting — the rule exists because a dialog never re-*lays out* after mount,
and an in-place rewrite of a single-line value does not change any height.

`JRDialog`, `JRListDialog`, `OverviewDialog` and `QuickConnectDialog` all draw the same
chrome — dimmed backdrop, panel, 3px edge, title, and the short `colorSecondary` accent rule
under it — from **`JRDialogPanel`**, and all four get their geometry from
**`source/utils/dialogLayout.bs`**, which is pure and unit-tested.

That is not tidiness. The three each owned a private copy of both, and when the #757 review
restyled `JRDialog` the other two silently kept the old look, so the app shipped two dialog
languages with every gate green — nothing asserted a position, gap, color or asset. The
module exists so "one dialog language" is a test rather than a claim, including a gate on the
multiples-of-6 spacing scale that keeps values integral through the 720p downscale.

A dialog supplies its own body and footer and nothing else, and there is exactly ONE layout
shape: the footer flows inside the panel and the panel is derived from its content. The
fixed-panel and outside-footer modes both existed for `OverviewDialog` alone and are both
gone — see [`dialogs.md`](./dialogs.md#3-the-footer-flows-inside-the-panel) for the capture
that settled it and for the second ceiling the outside footer used to need.

**The full dialog standard — footer placement, per-type key models, when a bespoke dialog is
legitimate, spacing and color rules, narration — lives in
[`dialogs.md`](./dialogs.md).** What stays here is how dialogs relate to navigation: the
helper table above, the result contract, teardown across a routed view's destruction, and
the one-overlay invariant below.

From a component, pass `onResult` (a function name in your scope) and the helper wires the
scoped observer. From main-thread code, omit it and observe with your message port. The
result shape is identical either way:
`{ cancelled, confirmed, buttonIndex, buttonText, optionIndex, value, externallyCancelled }`.
`externallyCancelled` distinguishes a close made by code — `cancelOpenDialog`, or
`presentOverlayDialog` superseding an incumbent — from the user pressing Back, which
`cancelled` deliberately cannot. Only a handler that ACTS on its result needs it.

Overlay dialogs are appended to the **scene**, not to the opening screen, so they outlive a
routed view that is destroyed while one is open — a screen that opens a dialog is
responsible for its own teardown. Two verbs do that, and the difference between them is
whether the dialog's OWNER is told:

| Verb | Delivers | Use when |
|---|---|---|
| `abandonDialog(dialog)` | nothing | **You** own it and your scope is being torn down (`onDestroy`) — there is nobody left to receive a result |
| `cancelOpenDialog()` | a canceled result | **Someone else** owns it and is still alive, holding state until it answers (a main-thread flow such as the deep-link server switch). Indistinguishable from the user pressing `Back` |

`PlayerHostView`'s end-of-playback teardown calls both, in that order, for exactly that
reason: its own picker is abandoned, anything else on screen is canceled.

### Exactly one overlay dialog

Roku's modal channel (`m.scene.dialog`) is **single-slot** — the OS replaces whatever was
there. The overlay channel is not, so when the main-thread flows moved off the modal channel
in the #288 phase-3 migration that invariant had to be restored explicitly. Two overlays
stacked would share the `jrDialog` id, leaving `findNode` resolving to the corpse and the
lower dialog visible but deaf behind the upper one.

`presentOverlayDialog` therefore **supersedes**: an incumbent overlay is canceled — through
its own once-only resolve guard, so its owner receives the same `canceled` result the user
pressing `Back` would have produced — before the newcomer is appended. Safe at every call
site, because all ten `result.confirmed` consumers in app code gate positively: a superseded
confirm is a no-op, never a half-action. The warning log stays, because two overlays racing
is still a signal about something upstream (two casts in flight).

Two consequences worth knowing:

- **A main-thread owner needs no code of its own.** Port delivery is asynchronous, so the
  superseded dialog's result reaches `Main()` only at the next `wait(0, m.port)` — after the
  flow has re-pointed at its new dialog, so its identity check rejects the old one. Written
  out at `replayRoute.onServerSwitchDialogResult`.
- **The MODAL channel is deliberately not superseded.** `cancelOpenDialog()` covers both
  channels; the supersede covers only the overlay. Canceling an open keyboard dialog is
  action-safe but discards what the user has typed (`ConfigList` and `SetServerScreen` both
  apply their value only on `confirmed`), which is a materially worse trade than closing a
  yes/no prompt. The two channels can still be open at once; nothing arbitrates between them.

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
