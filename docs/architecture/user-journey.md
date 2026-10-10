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
last-reviewed: 2026-10-10
---

# The user journey

The main path through the app: launch, pick a server, pick a user, sign in, Home, a library, an item's details, Play, the video player. Most of the code lives along it, and this doc traces what runs at each step and what state changes.

Every screen on the path, before and after sign-in, is a route in `JRScene`'s outlet (#550). Navigation goes through `sgrouter.navigateTo` and `goBack`. [`navigation.md`](navigation.md) covers the router, and [`bootstrap.md`](bootstrap.md) covers start-up and the event loop.

## At a glance

| Step | What runs | Where |
|---|---|---|
| 1. Launch | `Main(args)`: global setup, then `reenterLogin()` | `source/main.bs` ([`bootstrap.md`](bootstrap.md#entry-point)) |
| 2. Sign-in | `beginLogin()` tries the saved server and token; otherwise `/server`, `/users` or `/login` | `source/loginRouter.bs` |
| 3. Bring up Home | `finishLogin()`, then `loadHomeScreen()`, then `replayAfterLogin()` | `loginRouter.bs`, `main.bs`, `replayRoute.bs` |
| 4. Home | Rows of items; a pick navigates, a Play press starts playback | `components/home/Home.bs` |
| 5. Library | `/library/:id`, one grid for every library type | `components/ItemGrid/BaseGridView.bs` |
| 6. Details | `/details/:type/:id`, buttons, track menus and extras | `components/ItemDetails.bs` |
| 7. Start playback | The queue is built, then a launch request is set | `components/manager/QueueManager.bs` |
| 8. Player | `/details/:type/:id/play` mounts the video player | `components/video/PlayerHostView.bs` |

## Sign-in

`loginRouter.bs` coordinates sign-in from the main thread. The three sign-in screens (`SetServerScreen`, `UserSelect`, `LoginScene`) are routed views that own their UI. Each reports what the user asked for by setting `m.scene.preLoginIntent` to an action name, with the details on its own `m.top` fields. `Main()` observes `preLoginIntent`, and `handlePreLoginIntent()` runs the sign-in API calls (synchronous calls are allowed on the main thread) and picks the next route.

`reenterLogin()` is the entry point, at cold start and on every sign-out or change of user. It loads the sign-in locale, then `beginLogin()` tries the saved server and saved token with no UI and returns a decision. `enterDecision()` acts on it:

| Decision | Next |
|---|---|
| `success` | `finishLogin()`: already signed in |
| `server` | `/server` |
| `users` | `/users`, with the user list |
| `login` | `/login`, with the username filled in |

`routerNav()` asks the scene to navigate (`routerNavigate` through `callFunc`), since the `sgrouter` namespace resolves only on the render thread.

### What each screen asks for

| Screen | Action | Handler, and what it does |
|---|---|---|
| `/server` (`SetServerScreen`) | `serverSubmitted` | `onServerSubmitted()` connects to `enteredUrl`, saves the server (`server`, and `saved_servers` through `SaveServerList()`), clears saved credentials when the server changed, then picks the user step |
| `/users` (`UserSelect`) | `userSelected` | `onUserSelected()` tries the user's saved token, then a sign-in with no password, else opens `/login` with the username |
| | `manualLogin` | Opens `/login` with no username |
| | `userBack` | `onUserBack()` forgets the server and opens `/server` |
| | `quickConnectAuthenticated` | `onQuickConnectAuthenticated()` runs `user.Login` on the session Quick Connect returned, then `finishLogin()` |
| `/login` (`LoginScene`) | `credentialsSubmitted` | `onCredentialsSubmitted()` gets a token, runs `user.Login`, then `finishLogin()` |
| | `loginBack` | `onLoginBack()` returns to `/users` when the server has public users, else to `/server` |

`SetServerScreen` finds servers on the LAN by SSDP or takes a typed URL. Back from `/server` on a fresh install reaches the router root, which asks whether to exit ([`navigation.md`](navigation.md#the-back-arbiter--exit-confirmation)).

`UserSelect` shows public users (`/Users/Public`) merged with the users saved for this server (`buildPublicUserList()`), a **Manual Login** button, and a **Quick Connect** button when the server has it enabled (`m.global.server.isQuickConnectEnabled`).

### Quick Connect

Pressing **Quick Connect** sets no action. Its three steps (start, wait for approval, exchange the secret) are network calls with no navigation between them, so `UserSelect` runs them on the render thread as `fetchAsync` promises, and only the finished session goes to the coordinator. `QuickConnectDialog` only shows the code and a **Cancel** button. `UserSelect` owns the poll timer, the `showConfirmDialog` that asks whether to save credentials, and the teardown.

The start request is `GET /QuickConnect/Initiate` on Jellyfin 10.7 and 10.8 and `POST` from 10.9 (`ApiClient.BuildInitiateQuickConnectRequest`). All three requests go through the API pool, so the poll can read `res.statusCode`: a `404` from `/QuickConnect/Connect` means the secret expired or is unknown. That is the only way to tell a dead code from one nobody has approved yet.

### What a sign-in writes

There are four ways in: a saved token (checked with `AboutMe`), an empty password for a public user, a typed password, and Quick Connect. Each ends in `user.Login` (`source/utils/session.bs`), which writes:

- **On `m.global.user`:** `id`, `name` and `authToken`. The auth guard reads `authToken` before every route after sign-in ([`navigation.md`](navigation.md#the-auth-guard--componentsauthauthmanager)).
- **In the user's registry section:** `serverId` always; `authToken`, `username` and `primaryImageTag` only when the user chose to save credentials.
- **In the global registry section:** `active_user`, only when the **Remember Me** setting (`globalRememberMe`) is on. It picks the user at the next launch.

`user.Login` builds a fresh settings node, applies the defaults from `settings.json` (`SaveDefaults()`), then applies the user's registry section over them. `m.global.user.config` and `m.global.user.policy` come from the server's user response through `SessionDataTransformer`. The server owns them, and the app never writes them back.

## Bringing up Home

`finishLogin()` first checks that `user.Login` left a signed-in session (`user.IsAuthenticated()`). If it did not, it stops the spinner, clears the half-written user, shows a toast and returns to `/users` or `/login`. It never forgets the server here: nobody asked it to. Otherwise it starts the fallback-font download when the user needs one (`initializeFallbackFont()`) and calls `loadHomeScreen()`.

`loadHomeScreen()` waits for that download when one is running, then calls `createAndShowHomeGroup()`, which calls `replayAfterLogin()`:

- **A stashed deep link** goes to `JRScene.resolveDeepLink` with `homeFirst`. Home opens first, so it is the bottom of the back stack, and the item opens from there ([`bootstrap.md`](bootstrap.md#deep-links)).
- **Otherwise** `buildReplayRoutes()` turns the route the auth guard stashed, if any, into a chain for `JRScene.replayRoutedDeepLink`. With nothing stashed the chain is Home alone.

The Home route has `clearStackOnResolve`, so opening it drops the sign-in screens from the back stack. Home loads its own rows when it opens.

## Home

`components/home/Home.xml` extends `JRScreen`. Its children are a `VoiceTextEditBox` for voice search, `HomeRows` (the rows) and an `OptionsSlider` (the side menu). Its overhang tabs are **Home**, which shows `HomeRows`, and **Favorites**, which shows `FavoritesRows`.

`HomeRows` builds rows for Continue Watching, Next Up, On Now, My Media, Active Recordings and "Recently Added in" each library, in the order the user's home sections set. Each section loads through its own `LoadItemsTask` (started with `replaceTask`), except the "Recently Added in" rows, which `LoadLatestRowsTask` loads together over `apiPipeline`. `HomeRow` is a `ContentNode`: the data for one row, not a view.

### Picking an item

Each parent observes the field on its child and handles it. Nothing passes up on its own:

1. `HomeRows` observes its own `rowItemSelected`. `HomeRows.itemSelected()` sets `selectedItem` to the item, then to `invalid`.
2. `Home` observes `selectedItem` on the active tab's rows and navigates in `onRowItemSelected()`.

The view navigates because it runs on the render thread, where `sgrouter` resolves. `routeForItem(item)` (`source/utils/misc.bs`) picks the route: a container type (`CollectionFolder`, `UserView`, `Folder`, `Genre`, `Studio` and others) goes to `library`, a `Chapter` returns `invalid` (it is playback, not navigation), and anything else goes to `details`. The view passes the item as route context, so the next screen does not fetch it again.

A Play press is separate. `HomeRows` sets `quickPlayNode`, `Home.onQuickPlayNode()` copies it onto Home's own `quickPlayNode`, and Home's own observer (`onQuickPlayLaunch`) sends it to the queue manager ([Starting playback](#starting-playback)).

## Library grid

`components/ItemGrid/BaseGridView.bs` is the grid for every library type. A presenter in `source/GridView/` sets what differs by type: the backdrop, the grid's shape, the view, sort and filter options, and how metadata reads. The grid has no ladder of library types.

The route sets `presenterType` (`loadLibraryFromRoute()`), and `onPresenterTypeChanged()` creates the presenter and calls its `onInit()`:

| `presenterType` | Presenter |
|---|---|
| `movie` | `MoviePresenter` |
| `tvshow` | `TVShowPresenter` |
| `music` | `MusicPresenter` |
| `photo` | `PhotoPresenter` |
| `livetv` | `LiveTVPresenter` |
| anything else | `GenericPresenter` |

A new library type needs a presenter, not a change to the grid. The same folder holds the grid's paging and query helpers (`gridPaging`, `gridPage`, `gridQuery`).

Picking an item calls `routeForItem()` and navigates in `BaseGridView.onLibrarySelection()`: details for an item, another `/library/:id` for a nested folder or genre.

### Covered, then back

Like every route, `/library/:id` uses `suspendMode: "show"`. Opening an item leaves the grid in the outlet, hidden, with its focus, and Back shows it again with the cursor where the user left it. On that return it checks `m.scene.contentVersion` and loads again if an item was deleted meanwhile, so a deleted item does not stay in the grid.

Backing out of the library destroys the grid ([ADR 0029](../adr/0029-destroy-routed-screens-on-pop.md)). Opening it again loads from the start, with a spinner and the first tile focused. The view, sort and filter choice survives, because it lives in the registry (`getLibraryDisplaySetting`). A saved view applies only while the presenter still offers it (`gridQuery.resolveView`), since the same library on an older server may not have it. The fallback stays in memory only, so the saved choice comes back when the server offers it again.

### Loading pages

The grid loads the rows near the user, not the whole library. Every loaded item costs memory (on the 512 MB devices), a server query and render-thread time. So `gridPaging` asks for a page only when the loaded rows below the focused row would run out before a page could arrive. It measures how long pages take and how fast the user moves, and at rest it keeps one screen of rows ahead. This replaced loading every page in the background (#444).

- **The total is counted once,** on the first page. Later pages skip it (`EnableTotalRecordCount=false`), because the count is most of a page's cost on a slow server.
- **Reaching the last loaded row** while a page is on its way shows a "Loading more…" pill (`ProgressPill`) after a short delay, so a fast page never flashes it.
- **The "#" letter filter** is two ranges of sort names, before "a" and from "{" on (`gridPage.hashRanges`), paged as one list. With A to Z they hold every item once ([`jellyfin-server-versioning.md`](../dev/jellyfin-server-versioning.md)).

### A failed load

A failed load is not an empty library. `LoadItemsTask2` publishes `status` (`ok` or `failed`) beside its `content` and logs why the query failed; the view never learns the cause.

- **A failed first page** (or Genres list) shows a message and a **Try again** button in place of the grid, and `loadState` reads `failed`, not `empty`. It never retries on its own: the failed query may still be running on the server.
- **A failed later page** keeps the items already shown and the total, shows one toast until a page succeeds, and asks again by the same rule the next time focus moves or the user comes back to the grid.
- **While another screen covers the grid,** it neither toasts nor moves focus.
- **A "#" page** fails whole if either of its two requests fails.

Focus follows what the grid shows, not the event that got there; see `BaseGridView`'s Focus Handling section, and [navigation.md](navigation.md#focus-management) for why a covered view cannot ask `hasFocus()`.

### A slow server

A page gets `timeouts.GRID_PAGE_MS` (60 s), where an ordinary request gets `timeouts.HTTP_MS` (10 s). A large library on a server whose database is not optimized took about 40 s to answer its first page (measured 2026-09-24 on Jellyfin 10.11.11 with 8,643 movies, #869). The spinner shows no text for 8 s, then "Still loading…", then from 30 s says the server is slow to answer. Each is spoken to Audio Guide users (`narrateStatus`). The grid owns the scene's spinner while it loads, so backing out takes it down. The long wait is safe only because backing out also frees the page's pool slot at once ([api.md](api.md#a-long-request-already-on-a-slot)).

## Details

`components/ItemDetails.bs` is the largest file in the codebase. It shows the details of every item type.

### The title block

Under the title are a row of chips (year, rating, runtime and others), a row of details (genres, episode code and series, studio and others) and a credits row (`Created by …`, then `Directed by …`). The credits row takes no space when the item has no credits. It is driven by the item's own `People`, not its type, and nothing is looked up from a parent. A Series' creators arrive from Jellyfin 12.0, and a Season can carry directors on every version. Credits have their own row because a credit list has no natural length limit; sharing a row with the genres, it was always the first thing cut.

- **No text reaches the logo.** `layoutDetailsText()` gives each line (the title, the three rows, the description) its own width from where the logo is. A line above the logo runs to the right edge (`LOGO_RIGHT_ANCHOR_X`), and one beside it stops `LOGO_TEXT_CLEARANCE` short of the logo ([`infoRowFit.textLineWidth()`](../../source/utils/infoRowFit.bs)). The description stops a further `focusableOverview.FOCUS_OUTSET` short, so its focus border lands on the same line. Line positions are computed (`detailsLineBottoms()`), since the block has not laid out yet; a debug build checks them against the real layout.
- **The logo's place is known before its image arrives.** A first request for a resized image can take seconds while the server makes it (measured 2026-09-22 on a LAN server: 0.26 s median, 3 s worst). So `setLogoImage()` also asks for the image's original size (`GetItemImageInfos`), and [`logoLayout.bs`](../../source/utils/logoLayout.bs) turns it into the drawn box, with the same arithmetic that places the loaded bitmap. A placeholder, or a server with no size recorded, waits for the bitmap.
- **The text paints once.** Until the logo's place is known, the title, rows and description are held at opacity 0 and then shown already fitted (`holdDetailsText()`, `setLogoBox()`). `textHoldTimer` caps the wait at 0.5 s. Past it, the text is fitted to the widest possible logo (`logoLeftmostX()`) and not refitted when the logo lands. After the text shows, only a logo that reaches further than the one it was fitted to (a Season swapping in its series logo) refits it.
- **A row that is still too long is cut** by `fitInfoRow()`: it narrows the item that crosses the width so the `Label` ends it with an ellipsis, and drops what follows. A rating chip is never narrowed, only dropped. It runs again when row 1 changes (`Ends at` each minute, a Playlist's item count).
- **The title stays one line.** With extras open, the block is pinned above the extras pane and grows upward, and a second title line put its top outside Roku's action-safe zone.
- **Cuts are by character,** never `ellipsizeOnBoundary`. On a `Label` that does not wrap, cutting on whole words drops a single word too wide for the space and shows a bare `...` (#798).

### Buttons

The button row (node id `buttons`, `m.buttonGrp` in code) is built from the item's type and state. The main ones:

| Button | When |
|---|---|
| **Play** | Every playable item. On a `Series`, `Season`, `BoxSet`, `MusicArtist`, `MusicAlbum` or `Playlist` it plays them all. |
| **Resume** | Before **Play**, and focused, when the item has progress. On a Series it plays the next-up episode. On Jellyfin 12.0+ an item with several versions resumes the version picked in the Video menu ([`playback.md`](playback.md#alternate-versions-and-resume--sourceutilsversionresumebs)). |
| **Shuffle** | `Series`, `Season`, `BoxSet`, `MusicArtist`, `MusicAlbum`, `Playlist` and `PhotoAlbum` |
| **Trailer** | When the server has local trailers for the item (`checkTrailerAvailability`) |
| **Watched**, **Favorite** | Toggles |

Others appear by type: **Instant Mix**, **Manage Subtitles**, **Delete**, **Refresh**, **Record**, **Watch Channel**, **Go to Series**, **Go to Album**, **Go to Artist**, **Go to Channel**, **View Photo** and **Slideshow**.

The row holds only what fits before the logo, 8 buttons ([`buttonOverflow.bs`](../../source/utils/buttonOverflow.bs)). Past that, the last slot becomes **More**, and the rest open from it in a `showListDialog` menu with the same labels and icons.

### Track menus, extras and subtitles

- **`TrackDropdown` menus** (`trackCluster`): Video, Audio and Subtitle, side by side. Track titles go through the `languages.bs` resolver ([`translations.md`](translations.md#track-language-name-resolution)). A menu with one choice shows as text that cannot take focus, and the Video menu is hidden for audio and for items with no `MediaSources`. It offers every version, whatever its `VideoType`. Version labels, and the `· In progress` mark on the version being resumed (12.0+), come from `versionLabels` ([`playback.md`](playback.md#version-labels--sourceutilsversionlabelsbs)). On 12.0+ the Video menu's choice can change after the screen draws: the first pick follows the server's order, then runs again as each version's position arrives, until the user picks one.
- **Extras** (`extrasGrid`), shown by pressing **Down**: rows of related items, which depend on the item's type (`components/extras/ExtrasRowList.bs`, loaded by `LoadExtrasRowsTask`).
- **Manage Subtitles** opens `SubtitlePanel` (#750) on a Movie or Episode the server lets this user search. It slides up where the extras pane is (only one shows at a time), owns its API calls, focus and keys, and works on the selected version. It reports only `subtitlesChanged`, and `ItemDetails` then fetches the item again, because adding or deleting a subtitle renumbers the stream indexes the track menus hold.

### How Play starts here

**One item** (Play, Resume, the next-up episode) goes through `ItemDetails.launchQueueItemToPlay()`. It fills the queue first, then opens the play route:

```brightscript
m.global.queueManager.callFunc("beginPlaybackStart", "")
m.global.queueManager.callFunc("clear")
if isValid(versionPreference) then m.global.queueManager.callFunc("setVersionPreference", versionPreference)
m.global.queueManager.callFunc("push", queueItem)
sgrouter.navigateTo("/details/" + routeType + "/" + routeId + "/play")
```

`PlayerHostView` reads the queue when it mounts, so the route's `:type` and `:id` only name the item for deep links; the queue decides what plays. The version preference is recorded only when the user picked one in the Video menu, and the items the queue reaches next keep to it ([playback.md](playback.md#items-a-queue-arrives-at)).

**Several items** (Play on a type `isPlayAllType()` accepts) go to `QueueManager.launchQuickPlayAction` with a `playAll` action, and its `QuickPlayTask` builds the queue. Shuffle uses `launchShuffle`, or `launchPhotoAlbum` for a photo album. **Trailer** uses `launchQuickPlayAction` with `loadTrailers`.

**An extras tile** navigates when `routeForItem()` gives it a route; otherwise `onExtrasItemSelected()` sets `quickPlayNode`. The remote's **Play** key on a focused tile always sets it:

```brightscript
m.top.quickPlayNode = m.extrasGrid.focusedItem
m.top.quickPlayNode = invalid              ' set-then-clear (see below)
```

`ItemDetails` observes its own `quickPlayNode` (registered in `init()`) and sends it to the queue manager in `onQuickPlayLaunch()`.

### The set-then-clear pattern

Writing a field and then `invalid` makes the next write of the same value a change, so its observer fires. Roku needs this only on a field declared without `alwaysNotify`: by default an observer runs only when the value changes, while `alwaysNotify="true"` runs it on every write. `ItemDetails` declares `quickPlayNode` with `alwaysNotify="true"`, so a repeat pick fires either way: `onExtrasItemSelected()` does not clear, and the **Play** key's clear is redundant. The observer reads `msg.getData()` (the value when the event was queued), not the field, which the clear has already reset. Which other `quickPlayNode` writers still need the clear is tracked in [`quickplaynode-set-then-clear`](tech-debt.md#quickplaynode-set-then-clear).

## Starting playback

`Home`, `BaseGridView`, `SearchResults` and `ItemDetails` each observe their own `quickPlayNode` and call `m.global.queueManager.callFunc("launchItem", node)`.

### `QueueManager.launchItem`

`launchItem()` returns at once for an item with no id or type. Otherwise it opens the playback-start wait (`beginPlaybackStart`), or the plain spinner for a photo, which opens a viewer rather than a play session. It clears the queue and the shuffle, then builds the queue by type with the helpers in `source/utils/quickplay.bs`:

| Item type | Builds the queue with | Then |
|---|---|---|
| `chapter` | A queue item of the parent's type that starts at the chapter (`nodeHelpers.setExactStart`) | `playQueue()` |
| `episode`, `recording`, `movie`, `video`, `musicvideo` | `quickplay.video` | `playQueue()` |
| `audio` | `quickplay.audio` | `playQueue()` |
| `photo` | `quickplay.photo`, which opens the photo viewer | nothing |
| `tvchannel` | `quickplay.tvChannel` | `playQueue()` |
| `program` | `quickplay.program` | `playQueue()` |
| anything else | `runQuickPlayAction()`, which runs a `QuickPlayTask` | the Task finishes the queue |

The types in the table carry everything needed to play. Anything else (a series, a season, an album, a playlist, a library) needs API calls to expand into a queue, so `QuickPlayTask` runs them. `runQuickPlayAction` is used here, not `launchQuickPlayAction`, because `launchItem()` has already opened the playback start. A read that searches a whole library (Play on a library, folder or collection tile) or every library for one person or artist gets `timeouts.QUICKPLAY_LIBRARY_MS` (60 s), as a grid page does (#811). The spinner says it is still loading meanwhile, and **Back** stops the Task, which frees the request's pool slot.

### `QueueManager.playQueue`

`playQueue()` asks for a player by setting `m.global.playbackLaunchRequest`. It neither creates a player nor navigates, since a data node has no router. It reads the current item's type:

- **`audio` or `audiobook`:** a request with `media: "audio"`.
- **A video type** (`musicvideo`, `video`, `movie`, `episode`, `recording`, `chapter`, `trailer`, `program`, `tvchannel`): a request with the item's type and id.
- **An empty queue, an item with no type, or any other type:** no request; it ends the playback-start wait with the reason (`failPendingPlaybackStart`).

A photo never reaches `playQueue()`: `quickplay.photo` sets `m.global.photoLaunchRequest`.

## Player

`JRScene.onPlaybackLaunchRequested()` turns the request into a route on the render thread: audio opens `/audio` (`AudioPlayerView`), and every video type opens `/details/<type>/<id>/play` (`PlayerHostView`).

`VideoPlayerView` extends Roku's `Video` node, so it cannot be a routed view. `PlayerHostView` is the routed `JRScreen` that holds it. On `onScreenShown()`, `mountPlayer()` creates the player hidden (to avoid a black flash while it loads), wires its observers, sets the backdrop and appends it. The player reads the current queue item, fetches its media details, builds the stream URL and starts playback. The playback info report's `GetPlaybackInfoTask` is created only when the user opens the report. See [`playback.md`](playback.md) for the whole picture.

While a video plays, `VideoPlayerView` reports the position to Jellyfin every 10 s (`reportPlayback("update")` through the side-effect task), the OSD hides after 5 s without a key press, and trickplay shows preview images while seeking.

### When a video ends

When the player's state becomes `finished`, `PlayerHostView.onPlayerStateChange()` decides what happens next. Moving through the queue happens inside the host: it destroys the player and mounts a new one, with no route change.

| Case | What happens |
|---|---|
| A Live TV channel | `restartLiveChannel()` mounts the same channel again, unless it keeps ending without playing; then the playback error shows ([`playback.md`](playback.md)) |
| More items in the queue | The queue manager's `advanceTo` moves to the next item, then `playCurrentQueueItem()` mounts it from its start. After enough videos with no key press, the next one plays under an "Are you still watching?" prompt ([`playback.md`](playback.md#are-you-still-watching)) |
| The queue is done | `exitPlayback()` calls `sgrouter.goBack()`, and the details screen that started it, or Home, shows again |

Two `finished` states are not the end of playback and return before any of that: a Dolby Vision fallback retry (`isRetrying`), and an error dialog that owns the exit (`errorDialogOwnsExit`). Both reach this handler because the player itself called `stop`, and that stop arrived as `finished` rather than `stopped`. [`playback.md`](playback.md) covers the second.

Whether the user backs out (`goBack`, then `beforeViewClose`, then `onDestroy`) or the queue ends, `PlayerHostView.destroyPlayer()` sets the player's `control` to `"stop"`, so Jellyfin records the stop before the player is destroyed.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md); search by `area` for `ItemDetails`, `loginRouter` or the sign-in entries.
