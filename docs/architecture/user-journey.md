---
topic: user-journey
related-files:
  - source/main.bs
  - source/loginRouter.bs
  - source/replayRoute.bs
  - components/ItemDetails.bs
  - components/video/PlayerHostView.bs
  - components/manager/QueueManager.bs
  - components/home/Home.bs
  - components/ItemGrid/BaseGridView.bs
last-reviewed: 2026-09-23
---

# The User Journey

The spine of the app: app launch → server pick → user pick → auth → home → library browse → item detail → press Play → video player. This is the path users take 95% of the time and the path most code lives along.

As of #550 every screen on this path — pre-login *and* post-login — is a router view in `JRScene`'s outlet. Navigation goes through `sgrouter.navigateTo` / `goBack`, not a `SceneManager` stack. See `navigation.md` for the router model and `bootstrap.md` for the unified event loop.

## At a glance

```text
1. App launch         ← Roku invokes Main(args) in source/main.bs
2. reenterLogin()     ← source/loginRouter.bs coordinates the routed pre-login flow
   ├── /server  → SetServerScreen   (if no saved/valid server)
   ├── /users   → UserSelect        (public + saved users)
   └── /login   → LoginScene        (token / no-password / password / Quick Connect)
3. finishLogin()      ← per-user font bootstrap → loadHomeScreen()
4. createAndShowHomeGroup() → replayAfterLogin() navigates "/" (Home); clearStackOnResolve
                              drops the pre-login views
5. Browse             ← Home → /library/:id (BaseGridView) → /details/:type/:id (ItemDetails)
6. Play press         ← ItemDetails clears + populates the queue, then navigates /details/:type/:id/play
7. PlayerHostView     ← routed host mounts VideoPlayerView for the current queue item
8. Playback           ← Roku Video node, with OSD/trickplay/notification overlays
```

Each step below traces what code runs and what state changes.

## 1. App launch

`Main(args)` in `source/main.bs` runs the bootstrap sequence (see `bootstrap.md`):

- `setGlobals()` → typed nodes, translations, migrations, constants
- `m.screen.show()` → root scene visible
- `setGlobalNodes()` → `sceneManager`, `AuthManager`, `activeRoutedView` + launch-request fields, `queueManager`, `audioPlayer`, API pool

At this point the user sees the `JRScene` backdrop (initially blank) and the `loadingText` "Loading…" centered. The overhang is hidden because no routed view has been mounted yet.

## 2. The routed pre-login flow — `source/loginRouter.bs`

The old `LoginFlow()` `goto-label` state machine in `showScenes.bs` (three blocking `wait()` loops) is replaced by `loginRouter.bs`, a **main-thread coordinator**. The pre-login screens (`SetServerScreen` / `UserSelect` / `LoginScene`) are self-contained **routed views**: they own their UI and emit a high-level INTENT (`m.scene.preLoginIntent = "<action>"` with the payload on their own `m.top` fields). `main.bs` observes `preLoginIntent` on the main thread and dispatches to `handlePreLoginIntent`, which runs the (synchronous, main-thread-permitted) bootstrap API calls and drives the next navigation.

`reenterLogin()` is the entry point (called at cold start *and* on every session reset). It re-resolves the pre-login locale, then `beginLogin()` runs the saved-server resolution + saved-token validation **with no interactive UI** and returns a decision. `enterDecision` brings the router up on the right route:

- `{ status: "success" }` → `finishLogin()` (already authenticated — fast path)
- `{ status: "server" }` → `routerNav("/server")`
- `{ status: "users", users }` → `routerNav("/users", { users })`
- `{ status: "login", username }` → `routerNav("/login", { username })`

`routerNav` is a thin bridge: `m.scene.callFunc("routerNavigate", path, context)` (the `sgrouter` namespace resolves on the render thread, which the main loop can't call directly).

### `2a`. Server selection — `/server` (`SetServerScreen`)

When `beginLogin` can't connect to a saved server, it navigates `/server`. `SetServerScreen` offers:

- **SSDP discovery** — broadcasts a Jellyfin server lookup on the LAN, populates a list of found servers
- **Manual URL entry** — text box for entering `http://yourserver:8096`

On submit, the view sets `preLoginIntent = "serverSubmitted"` (URL on `view.enteredUrl`); `onServerSubmitted` connects, persists to `server`/`serverList`, resets stale credentials on a server change, then resolves the user step. Back from `/server` at a fresh install bottoms out at the router root → exit confirmation (see `navigation.md`).

### `2b`. User selection — `/users` (`UserSelect`)

When there's no active user, `buildPublicUserList()` merges public users (`GetPublicUsers` → `/Users/Public`) with saved users for this server id into `PublicUserData` nodes, and navigates `/users`. `UserSelect` is a grid of avatars plus a **Quick Connect** button (gated on `m.global.server.isQuickConnectEnabled`). Components in `components/login/`: `UserSelect`, `UserRow`, `UserItem`.

Intents from this view: `userSelected` (→ `onUserSelected`: tries saved token, then no-password login, else navigates `/login` with the username populated), `userBack` (→ delete server, navigate `/server`), `quickConnectAuthenticated` (→ `onQuickConnectAuthenticated`: `user.Login` on the handed-over `AuthenticationResult`, then `finishLogin`).

**Quick Connect emits no intent when the button is pressed.** Its first three steps — initiate, poll for approval, exchange the secret — are network calls with no navigation between them, so they run on the render thread in `UserSelect` as `fetchAsync` promises, and only the finished session crosses to the coordinator. `QuickConnectDialog` is a pure view on the scene overlay channel: it shows the code and a Cancel button, and `UserSelect` owns the poll timer, the `showConfirmDialog` that asks whether to save credentials, and the teardown.

### `2c`. Authentication — `/login` (`LoginScene`)

`LoginScene` presents the password keyboard (username populated when arriving from `/users`). On submit it sets `preLoginIntent = "credentialsSubmitted"` (username/password/`saveCredentials` on the view); `onCredentialsSubmitted` calls `getToken` and, on success, `user.Login` + persists per-user credentials (when "save credentials" is checked), then `finishLogin`. `loginBack` returns to `/users` if there were public users, else to `/server`.

Across all paths, the four auth modes are unchanged: **token** (validate saved `authToken` via `AboutMe`), **no-password** (empty password for public users), **password** (keyboard), and **Quick Connect** (server returns an `AccessToken` for whichever user approved the code; bypasses user-pick + password). The Quick Connect endpoint is version-dispatched: `GET /QuickConnect/Initiate` on Jellyfin 10.7–10.8, `POST` on 10.9+ (routed by `ApiClient.BuildInitiateQuickConnectRequest`). All three Quick Connect requests go through the API pool, so the poll can read `res.statusCode` — a `404` from `/QuickConnect/Connect` is an expired or unknown secret, and is the only thing distinguishing a dead code from one nobody has approved yet.

Successful login writes:

- `m.global.user.id`, `name`, `authToken` (in-memory) — and, critically, the `authToken` is what the `AuthManager` `canActivate` guard checks on every post-login route (see `navigation.md`)
- Per-user registry section keys: `authToken`, `username`, `primaryImageTag`
- Global registry: `active_user` (the user ID for next launch's auto-resume)

The `m.global.user.settings` node is repopulated by `SessionDataTransformer` reading the per-user registry section + applying `settings.json` defaults for missing keys. `m.global.user.config` and `m.global.user.policy` come from the `/Users/{userId}` API response — server-authoritative, never written back.

## 3. Finish login & bring up Home

`finishLogin()` (`loginRouter.bs`) runs the post-login bootstrap and brings up Home:

```brightscript
sub finishLogin()
  initializeFallbackFont()    ' optional fallback-font download (subs-custom / uiFontFallback)
  loadHomeScreen()
end sub
```

`loadHomeScreen()` → `createAndShowHomeGroup()` (both in `main.bs`), which calls `replayAfterLogin()` (`source/replayRoute.bs`). That reads + clears any stashed deep link and navigates the router via `JRScene.replayRoutedDeepLink`:

- no deep link → `["/"]` (plain Home — the navigation that used to be a `pushScene`)
- a deferred/cold-start play deep link → `["/", details, play]` so back unwinds Player → Details → Home (decision #3)

Navigating `/` resolves Home with `clearStackOnResolve: true`, which drops the pre-login views from the router stack so Home becomes the back-stack root — no explicit `clearScenes` step. When UI fallback fonts are enabled, `loadHomeScreen` defers `createAndShowHomeGroup` until `FontDownloadTask` completes (handled in the event loop). Home self-loads its libraries in its own `onViewOpen`.

## 4. Home screen

`components/home/Home.xml/.bs` is the central hub. It extends `JRScreen` and contains:

```xml
<component name="Home" extends="JRScreen">
  <children>
    <VoiceTextEditBox id="homeVoiceBox" />        <!-- voice search trigger -->
    <HomeRows id="homeRows" />                    <!-- the row-based content -->
    <OptionsSlider id="options" />                <!-- settings/menu side panel -->
  </children>
  <interface>
    <field id="selectedItem" type="node" alwaysNotify="true" />  <!-- bubbles up library + item picks -->
    <field id="quickPlayNode" type="node" />                     <!-- bubbles up Play presses -->
    <field id="voiceQuery" type="string" alwaysNotify="true" />
    <field id="userMenuAction" type="string" alwaysNotify="true" />
  </interface>
</component>
```

The overhang (which `JRScene`'s overhang controller wires up automatically when the router makes Home the active view) shows: logo, current user, search icon, settings gear, and the library tabs (Movies, Shows, Music, etc.).

### Two main tab content components

- **`HomeRows.xml/.bs`** — default tab. Horizontal-scrolling rows: "Continue Watching", "Next Up", "Latest Movies", "Latest Shows", per-library "Recently Added", etc. Each row is a `HomeRow.xml`.
- **`FavoritesRows.xml/.bs`** — alternate tab. Rows of items the user has marked as favorites.

Data is fetched by `LoadItemsTask.bs` (`components/home/`), an orchestrator Task that issues several API calls in parallel and assembles the row content.

### How "select something" propagates

When the user clicks a library section header or an individual row item:

1. The grid item bubbles up `selectedItem` on its parent row.
2. The row bubbles `selectedItem` to `HomeRows`.
3. `HomeRows` bubbles to `Home`.
4. `Home` observes its **own** `selectedItem` (a self-observer; `Home.bs:onRowItemSelected`) and navigates the router directly — the `main.bs` relay that used to catch this is gone.

The view does the navigation itself because it runs on the render thread, where the `sgrouter` namespace resolves. The route is computed by the pure helper `routeForItem(item)` (`source/utils/misc.bs:276`): library/grid container types (`CollectionFolder`, `UserView`, `Folder`, `Genre`, `Studio`, …) map to `{ name: "library", params: { id } }`; everything else maps to `{ name: "details", params: { type, id } }`; `Chapter` returns `invalid` (it's playback, not navigation). The view then calls `sgrouter.navigateTo(route, { context: { item: item } })`, passing the rich node as route context so the destination needn't re-fetch.

Playback presses are separate: a row's Play button (or a Live TV channel) sets `quickPlayNode`, which the view's own `onQuickPlayLaunch` self-observer forwards to `QueueManager` (see step 6). This is still BS's "bubbling field" pattern (`alwaysNotify="true"` fields rise to each parent until one handles them) — what changed is that the *handler* is now the routed view itself, not `main.bs`.

## 5. Library browse — `BaseGridView`

`components/ItemGrid/BaseGridView.xml/.bs` is the polymorphic grid view used for **every library type**: Movies, Shows, Music, Photos, Live TV, Mixed Folders. The component itself is generic; behavior is parameterized via the **presenter pattern**.

```text
source/GridView/
├── GridPresenterBase.bs       ← abstract base
├── MoviePresenter.bs          ← movie-specific layout, sorting, filters
├── TVShowPresenter.bs
├── MusicPresenter.bs
├── PhotoPresenter.bs
├── LiveTVPresenter.bs
└── GenericPresenter.bs        ← fallback for unknown library types
```

Each presenter declares: backdrop mode (fullscreen / presentation panel / none), grid translation/rows/columns, available options (view modes, sort options, filter facets), and how to format metadata. `BaseGridView.setPresenter(presenter)` is called immediately after creation to specialize the screen.

This pattern keeps `BaseGridView.xml/.bs` clean — there's no `if libraryType = "movie"` ladder. Adding a new library type means writing a presenter, not editing the grid view.

`BaseGridView` is a **`suspendMode: "detach"`** route (`/library/:id`): when the user drills into an item, the grid is *suspended* out of the tree (its node + focus saved) rather than destroyed, and *resumed* on back — so the cursor returns to the exact item the user left. It is deliberately **not** `keepAlive`: backing out of the library entirely destroys it, so re-entering that library is a fresh load rather than a resumed cache — a spinner and tile 0, not the item you left. The view / sort / filter selection still survives, because that lives in the registry (`getLibraryDisplaySetting`), not on the view — with one qualification since a view can be server-gated: a saved view is honored only while the presenter still offers it (`gridQuery.resolveView`), because the same library opened against an older server may have no such view. The fallback is in memory only, so the saved choice comes back when the server does. See [ADR 0029](../adr/0029-destroy-routed-screens-on-pop.md) for the accepted cost. `BaseGridView.onLibrarySelection` computes `routeForItem(item)` and calls `sgrouter.navigateTo(route, { context: { item } })` itself (it routes to `/details/:type/:id` for an item, or to another `/library/:id` for a nested folder/genre). On resume it re-checks `m.scene.contentVersion` and re-fetches if a delete happened beneath it, so a deleted item can't linger in the resumed grid (see `JRScene.xml`'s `contentVersion` field).

## 6. Item Detail — `components/ItemDetails.bs`

The largest single file in the codebase. It handles the detail view for *every* item type — movies, episodes, series, seasons, audio, music videos, photos, live TV programs, recordings, mixed folders.

The component contains:

- A title block with metadata (year, runtime, rating, genres, credits, tagline, overview). Under the title, one row of chips (year, rating, runtime, …), one row of details (genres, episode code and series, studio, …) and a **credits row** (`Created by …`, then `Directed by …`), which is empty — so takes no space — for an item with no credits. The row is driven by the item's own `People`, not its type: whichever credits the server sends appear, on any item type (a Series' creators arrive from Jellyfin 12.0; a Season can carry directors on every version), and nothing is looked up from a parent. Credits get a row of their own because a credit list is the one item on these rows with no natural length limit; sharing a row with the genres, it was always the first thing cut.
  - **No text reaches the logo, and text uses the room the logo leaves.** `layoutDetailsText()` gives each line — the title, all three rows and the description — its own width from where the logo actually is: a line ending above the logo runs to the right edge (`LOGO_RIGHT_ANCHOR_X`), one beside it stops `LOGO_TEXT_CLEARANCE` short of the logo's left edge ([`infoRowFit.textLineWidth()`](../../source/utils/infoRowFit.bs)). The description's text stops a further `focusableOverview.FOCUS_OUTSET` short, so its focus border lands on the same line. Line positions are computed (`detailsLineBottoms()`), not read, because the block has not laid out when this runs; a debug build checks them against the real layout.
  - **The logo's place is known before its image arrives.** A first request for a resized image can take seconds while the server makes it (measured 2026-09-22 on a LAN server: 0.26 s median, 3 s worst). So `setLogoImage()` also asks for the image's original size (`GetItemImageInfos`, on every supported server), and [`logoLayout.bs`](../../source/utils/logoLayout.bs) turns it into the served size and the drawn box — the same arithmetic that places the loaded bitmap, which is then drawn in the predicted box. A placeholder, or a server with no size recorded, waits for the bitmap instead.
  - **The text paints once.** Until the logo's place is known, the title, rows and description are held at opacity 0 — nothing else is — and then shown already fitted (`holdDetailsText()` / `setLogoBox()`). `textHoldTimer` caps the wait at 0.5 s; past it the text shows fitted to the widest logo possible (`logoLeftmostX()`, safe for any logo) and is not refitted when the logo lands. After the text shows, only a logo that reaches *further* than the one it was fitted to (a Season swapping in its series logo) refits it.
  - `fitInfoRow()` cuts a row that is still too long: it narrows the item that crosses its width so the `Label` cuts it with an ellipsis, and drops what follows; a rating chip is never narrowed, only dropped. It runs again on row 1 when its text changes later (`Ends at` each minute, a Playlist's item count). The title stays **one line**: with extras open, this block is pinned above the extras pane and grows upward, and a second title line put its top outside Roku's action-safe zone.
  - **Cuts are by character, never `ellipsizeOnBoundary`.** On a `Label` that doesn't wrap, cutting on whole words drops a single word too wide for the space and renders a bare `...` (#798).
- A button row (`buttonGrp`) — buttons are dynamically generated based on item type and play state:
  - **Play** — primary action
  - **Resume** — replaces Play if the item has playback progress. On Jellyfin 12.0+ an item with alternate versions resumes per version: Resume follows the version selected in the Video dropdown and can load that version's position behind a loading button (see [`playback.md`](playback.md#alternate-versions-and-resume--sourceutilsversionresumebs))
  - **Series Play** — for series, plays from next-up episode
  - **Shuffle** — for collections and playlists
  - **Trailer** — if a remote trailer URL is available
  - **Mark Watched / Unwatched**, **Mark Favorite / Unfavorite**
  - The row is **capped at what fits before the logo** (8 buttons today — see [`buttonOverflow.bs`](../../source/utils/buttonOverflow.bs)). Past the cap the last slot becomes a **More** button and the remainder move to an off-layout stash, reachable through a `showListDialog` menu whose rows carry the same label and glyph. Nothing overflows at present: the busiest item types reach exactly 8.
- An inline **`TrackDropdown` cluster** (`trackCluster`) — three side-by-side dropdowns for Video / Audio / Subtitle source selection, replacing the older modal `ItemOptions` popup. Track titles localize via the `languages.bs` 3-tier resolver (alias → `translationKey` → English fallback). A slot with a single choice renders as static text that cannot take focus, and the Video slot is hidden for audio items and items with no `MediaSources`. It offers every version, whatever its `VideoType` (an ISO or disc folder included), because the version it selects and the one the player offers can be any of them. Version labels, and the `· In progress` mark on the version being resumed (12.0+), come from `versionLabels` (see [`playback.md`](playback.md#version-labels--sourceutilsversionlabelsbs)). On 12.0+ the Video slot's own selection can MOVE after the screen has drawn: the first pick is made from the server's source order alone, then re-run as each version's position arrives so it names the version that would actually resume — until the viewer picks one, which freezes it (see [`playback.md`](playback.md#alternate-versions-and-resume--sourceutilsversionresumebs)).
- An "extras" panel (revealed by pressing DOWN) — `extrasGrid` shows related items: cast, episodes (for series), parts (for split media), recommendations, similar items
- A **subtitle management panel** (`SubtitlePanel`, #750), opened by the **Manage Subtitles** button on a Movie or Episode the server lets this user search. It slides up in the extras pane's region (the two are mutually exclusive) and is self-contained: it owns its API calls, focus and keys, targets the **selected version** (a `MediaSource` is its own item), and hands back only `subtitlesChanged` — which makes `ItemDetails` re-fetch, because adding or deleting a subtitle renumbers every stream index the track dropdowns hold

There are two distinct launch shapes in `ItemDetails`:

**Single-item play** (Play / Resume / Trailer / next-up episode) goes through `ItemDetails.launchQueueItemToPlay(queueItem, routeType, routeId, versionPreference)`: it clears the queue, records the viewer's explicit Video-menu pick for it when there is one, pushes, then navigates the play route directly:

```brightscript
m.global.queueManager.callFunc("clear")
if isValid(versionPreference) then m.global.queueManager.callFunc("setVersionPreference", versionPreference)
m.global.queueManager.callFunc("push", queueItem)
sgrouter.navigateTo("/details/" + routeType + "/" + routeId + "/play")
```

The pick is what the items the queue arrives at next keep to (see [playback.md → Items a queue arrives at](playback.md#items-a-queue-arrives-at)); a version the screen chose on its own is not recorded.

The queue is populated **before** navigation — `PlayerHostView` reads it on mount, so the route `:type`/`:id` are just a deep-link identity; the queue is the source of truth.

**Multi-item / unknown-shape play** (Series Play, Shuffle a collection, etc.) sets `quickPlayNode`:

```brightscript
m.top.quickPlayNode = content[0]
m.top.quickPlayNode = invalid              ' set-then-clear: forces event to fire even if value is identical
```

`ItemDetails` observes its **own** `quickPlayNode` (`ItemDetails.bs:206`) and forwards it to `onQuickPlayLaunch` → `QueueManager.launchItem` — the `main.bs` relay that used to read it is gone, because the launch now happens on the render thread where `sgrouter` resolves.

### The set-then-clear pattern

This appears in several places in `ItemDetails.bs`. The trick: `SceneGraph`'s `observeField` only fires when a field's *value* changes. If the user plays the same item twice in a row, setting `quickPlayNode = content[0]` the second time wouldn't fire — the value didn't change. Setting to `invalid` immediately afterward guarantees the next set fires. The self-observer reads `msg.getData()` (the value at event-queue time) rather than the current field value (which is `invalid` by the time the handler runs). It's unusual enough that anyone touching `quickPlayNode` for the first time has to read this to understand it.

## 7. Quickplay dispatch — `QueueManager.launchItem`

The `quickPlayNode` self-observers across `Home` / `BaseGridView` / `SearchResults` / `ItemDetails` all forward the node to `m.global.queueManager.callFunc("launchItem", node)`. `launchItem` (`components/manager/QueueManager.bs`) — **not** `main.bs` anymore — classifies the item by `type` and builds the queue, using the helpers in `source/utils/quickplay.bs`:

```brightscript
sub launchItem(itemNode)
  itemType = LCase(itemNode.type)
  startLoadingSpinner()
  clear()
  resetShuffle()

  if itemType = "chapter"
    ' Chapter: start parent video at chapter position
    queueItem.type = itemNode.parentType
    queueItem.startingPoint = itemNode.playbackPositionTicks
    push(queueItem) : playQueue()
  else if itemType = "episode" or = "recording" or = "movie" or = "video"
    quickplay.video(itemNode) : playQueue()
  else if itemType = "audio"
    quickplay.audio(itemNode) : playQueue()
  else if itemType = "musicvideo"
    quickplay.musicVideo(itemNode) : playQueue()
  else if itemType = "photo"
    quickplay.photo(itemNode)              ' photo viewer; no playQueue
  else if itemType = "tvchannel"
    quickplay.tvChannel(itemNode) : playQueue()
  else if itemType = "program"
    quickplay.program(itemNode) : playQueue()
  else
    ' Series, season, album, playlist, etc. — need API calls to expand into a multi-item queue
    launchQuickPlayAction({ action: itemType, id: itemNode.id, seriesId: ..., ... })
  end if
end sub
```

The split is "synchronous types" vs "async types":

- **Synchronous**: a single item has all the info needed to play. Wrap in queue format, push, play.
- **Async**: requires API expansion (e.g., "play this whole series" → fetch all episodes in order). `launchQuickPlayAction` spawns a `QuickPlayTask` which writes results to its `output` field and finishes the queue setup.

## 8. QueueManager.playQueue() — `components/manager/QueueManager.bs`

`playQueue` looks at `getCurrentItem()`, classifies its type, and **signals a launch** by setting `m.global.playbackLaunchRequest` — it does not instantiate a player or navigate (a data node has no router chain):

```brightscript
sub playQueue()
  m.isPlaying = true
  nextItem = getCurrentItem()
  if not isValid(nextItem) then return
  nextItemMediaType = getItemType(nextItem)

  if nextItemMediaType = "audio" or = "audiobook"
    m.global.playbackLaunchRequest = { type: nextItem.type, id: nextItem.id, media: "audio" }
  else if videoTypes.DoesExist(nextItemMediaType)   ' video/movie/episode/recording/chapter/trailer/program/tvchannel/musicvideo
    m.global.playbackLaunchRequest = { type: nextItem.type, id: nextItem.id }
  end if
end sub
```

(Note: photo launches go through `m.global.photoLaunchRequest` from `quickplay.photo`, not `playQueue`.)

## 9. Player launch — `JRScene` → `PlayerHostView`

`JRScene.onPlaybackLaunchRequested` (`JRScene.bs:375`) observes `playbackLaunchRequest` and turns it into a route on the render thread: audio → `/audio` (the routed `AudioPlayerView`), every video-family type → `/details/<type>/<id>/play` (the `PlayerHostView`).

`PlayerHostView` is the **routed host** for video: `VideoPlayerView` extends Roku's native `Video` node and can't itself be a router view, so this thin `JRScreen` wrapper mounts it as a runtime child. On `onScreenShown` → `mountPlayer()` it instantiates `VideoPlayerView` (visible=false during loading to avoid a black flash), wires observers, updates the backdrop, and `appendChild`s the player. The playback report's `GetPlaybackInfoTask` is created per fetch, only once the user opens the report (`onSelectPlaybackInfoPressed`). It reads the already-built queue (`getCurrentItem`) — the queue is the source of truth. The `VideoPlayerView` itself fetches media metadata, builds the URL, and starts the underlying `Video` node. See `playback.md` for the full picture.

## 10. Playback running

While the video plays:

- `VideoPlayerView` runs a periodic timer that fires `reportPlayback("update")` every ~10 seconds, sending position to Jellyfin via the side-effect task.
- The OSD shows for 5 seconds when the user interacts, then hides.
- Trickplay (seek scrubbing) shows a thumbnail carousel of preview images.
- "Next episode" notification appears near the end of an episode if the queue has another item.

When the video finishes (`state = "finished"`), `PlayerHostView.onPlayerStateChange` decides what to do (queue advancement is **host-internal** — destroy + remount the player child, not pop/push):

- **Live TV channel** — `playCurrentQueueItem()` (restart the same channel by remounting)
- **More items in queue** — `advanceTo(position + 1)` → `playCurrentQueueItem()` (remount for the next item, which starts from its beginning)
- **Queue exhausted** — `exitPlayback()` → `sgrouter.goBack()` (the suspended launching detail, or Home, resumes)

Two `finished` states are *not* the end of playback and bail before any of that: a DoVi
fallback retry (`isRetrying`) and an error dialog holding the exit (`errorDialogOwnsExit`),
both of which reach this handler only because the player itself called `stop` and that stop
surfaced as `finished` rather than `stopped`. See [`playback.md`](./playback.md) for the
second one and for what is and is not measured about it.

Whether the user backs out (router `goBack` → `beforeViewClose` → `onDestroy`) or the queue exhausts, `PlayerHostView.destroyPlayer()` sets `m.view.control = "stop"` so Jellyfin records the stop before the player node is destroyed.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for `ItemDetails`, `loginRouter`, or login-flow entries.
