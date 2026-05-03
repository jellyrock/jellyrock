---
topic: user-journey
related-files:
  - source/main.bs
  - source/showScenes.bs
  - components/ItemDetails.bs
  - components/manager/ViewCreator.bs
  - components/manager/QueueManager.bs
  - components/home/Home.bs
  - components/ItemGrid/BaseGridView.bs
last-reviewed: 2026-05-03
---

# The User Journey

The spine of the app: app launch → server pick → user pick → auth → home → library browse → item detail → press Play → video player. This is the path users take 95% of the time and the path most code lives along.

## At a glance

```text
1. App launch       ← Roku invokes Main(args) in source/main.bs
2. LoginFlow()      ← source/showScenes.bs orchestrates auth
   ├── Server selection  → CreateServerGroup() if no saved server, else validate saved
   ├── User selection    → CreateUserSelectGroup() with public + saved users
   └── Authentication    → token / no-password / password paths
3. clearScenes()    ← wipe login screens off the stack
4. loadHomeScreen() ← push the Home screen
5. Browse           ← Home → BaseGridView (per library) → ItemDetails
6. Play press       ← Item Details sets quickPlayNode → main.bs catches the event
7. Quickplay        ← source/utils/quickplay.bs wraps item, pushes to QueueManager
8. playQueue()      ← QueueManager picks player by item type
9. Player launches  ← ViewCreator.CreateVideoPlayerView() pushes VideoPlayerView
10. Playback        ← Roku Video node, with OSD/trickplay/notification overlays
```

Each step below traces what code runs and what state changes.

## 1. App launch

`Main(args)` in `source/main.bs` runs the bootstrap sequence (see `bootstrap.md`):

- `setGlobals()` → typed nodes, translations, migrations, constants
- `m.screen.show()` → root scene visible
- `setGlobalNodes()` → `sceneManager`, `queueManager`, `audioPlayer`, API pool

At this point the user sees the `JRScene` backdrop (initially blank) and the `loadingText` "Loading…" centered. The overhang is hidden because no `JRGroup` has been pushed yet.

## 2. `LoginFlow` — `source/showScenes.bs`

`LoginFlow()` is the gating function. It returns `false` to abort the whole app (user backed out of server selection from a fresh install), or `true` once an authenticated session exists.

The function is procedural with `goto` labels (`startLogin:`, `userSelect:`) for retry loops — old-school BrightScript style, but readable. All persistence is via the registry helpers in `source/utils/config.bs`.

### `2a`. Server selection

```brightscript
serverUrl = getSetting("server")          ' last successful server URL
if isValid(serverUrl)
  ' Try to use it
  startOver = not server.UpdateURL(serverUrl, serverUrl)
  if not startOver
    invalidServer = ServerInfo().Error    ' API ping
  end if
end if

if startOver or invalidServer
  ' Show interactive server picker
  m.serverSelection = CreateServerGroup()
  if m.serverSelection = "backPressed"
    m.global.sceneManager.callFunc("clearScenes")
    return false                           ' user backed out — exit app
  end if
  SaveServerList()
end if
```

`CreateServerGroup()` builds and pushes the `SetServerScreen` UI. This screen offers:

- **SSDP discovery** — broadcasts a Jellyfin server lookup on the LAN, populates a list of found servers
- **Manual URL entry** — text box for entering `http://yourserver:8096`

The user picks one; the function returns the selected server URL (or `"backPressed"`). Successful selections are written to registry as `server` (canonical URL) and `serverList` (history of all servers ever connected to, deduplicated by ID).

If a saved server is valid, `LoginFlow` skips the picker UI but pushes a hidden `Group` placeholder onto the scene stack anyway — this keeps the stack depth consistent so back-button cleanup works regardless of which path was taken. Comment in the code explains: *"Using Group because it has a visible field (ContentNode does not)."*

### `2b`. User selection

```brightscript
activeUser = getSetting("active_user")
if not isValid(activeUser)
  ' No remembered user — show user picker
  publicUsers = GetPublicUsers()         ' /Users/Public API call
  savedUsers = getSavedUsers()           ' from local registry
  ...build merged list of PublicUserData nodes...
  userSelected = CreateUserSelectGroup(publicUsersNodes)
end if
```

`CreateUserSelectGroup()` builds the `UserSelect` component — a grid of avatars with names plus a **Quick Connect** button. The components are in `components/login/`:

- `UserSelect.xml/.bs` — the screen, with the Quick Connect button gated on `m.global.server.isQuickConnectEnabled`
- `UserRow.xml/.bs` — wrapper row
- `UserItem.xml/.bs` — individual avatar tile

The Quick Connect button is removed at runtime if the server reports the feature disabled (`QuickConnectEnabledTask` probes `/QuickConnect/Enabled`; on Jellyfin 10.7 the endpoint is missing, so the probe fails open). When the user picks it, the app shows a 6-character code and polls `/QuickConnect/Connect` until the user approves the device from another Jellyfin client.

If the user backs out, the function returns `"backPressed"`, which causes `LoginFlow` to delete the saved server (`unsetSetting("server")`) and `goto startLogin` for a full restart.

### `2c`. Authentication

Once a user is selected (or Quick Connect completes), four auth paths exist:

1. **Token path** — `getUserSetting("authToken")` returns a saved token; call `AboutMe()` to validate. If valid, call `user.Login(currentUser, true)` and return `true`.
2. **No-password path** — for public users, try `getToken(userSelected, "")` (empty password). Some Jellyfin users have no password.
3. **Password path** — show `CreateSigninGroup(userName)` which presents the password keyboard. Submitted password goes through `getToken()`.
4. **Quick Connect path** — Quick Connect bypasses the user-pick + password steps entirely. The Jellyfin server returns an `AccessToken` keyed to whichever user approved the code, and the app proceeds as if that user was selected directly.

The Quick Connect endpoint is version-dispatched: `GET /QuickConnect/Initiate` on Jellyfin 10.7–10.8, `POST /QuickConnect/Initiate` on 10.9+. The Build*Request method in `ApiClient` handles the routing.

Successful login writes:

- `m.global.user.id`, `name`, `authToken` (in-memory)
- Per-user registry section keys: `authToken`, `username`, `primaryImageTag`
- Global registry: `active_user` (the user ID for next launch's auto-resume)

The `m.global.user.settings` node is repopulated by `SessionDataTransformer` reading the per-user registry section + applying `settings.json` defaults for missing keys.

`m.global.user.config` and `m.global.user.policy` are populated from the `/Users/{userId}` API response — these are server-authoritative and never written back to.

## 3. Clean up login

Back in `main.bs`:

```brightscript
m.global.sceneManager.callFunc("clearScenes")
initializeFallbackFont()                    ' optional fallback font download (uiFontFallback setting)
loadHomeScreen()
```

`clearScenes()` calls `onScreenHidden` + `onDestroy` on every login screen so they release tasks/observers. `initializeFallbackFont()` triggers an async `FontDownloadTask` if the user has enabled fallback font support; the home screen waits for that to complete before rendering. Otherwise, `loadHomeScreen()` runs immediately.

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

The overhang (which the `SceneManager` wires up automatically when Home is pushed) shows: logo, current user, search icon, settings gear, and the library tabs (Movies, Shows, Music, etc.).

### Two main tab content components

- **`HomeRows.xml/.bs`** — default tab. Horizontal-scrolling rows: "Continue Watching", "Next Up", "Latest Movies", "Latest Shows", per-library "Recently Added", etc. Each row is a `HomeRow.xml`.
- **`FavoritesRows.xml/.bs`** — alternate tab. Rows of items the user has marked as favorites.

Data is fetched by `LoadItemsTask.bs` (`components/home/`), an orchestrator Task that issues several API calls in parallel and assembles the row content.

### How "select something" propagates

When the user clicks a library section header or an individual row item:

1. The grid item bubbles up `selectedItem` on its parent row.
2. The row bubbles `selectedItem` to `HomeRows`.
3. `HomeRows` bubbles to `Home`.
4. `Home` bubbles to its parent (effectively the main event loop, since `Home` was pushed via `sceneManager`).
5. `main.bs` catches `selectedItem`, decides if it's a library (push `BaseGridView`) or an individual item (push `ItemDetails`).

This is BS's standard "bubbling field" pattern: you declare a field with `alwaysNotify="true"`, and any descendant that writes to a field with the same name triggers the observer at every parent level until something handles it.

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

Item selection in the grid bubbles `selectedItem` up to main.bs, which pushes `ItemDetails`.

## 6. Item Detail — `components/ItemDetails.bs`

The largest single file in the codebase. It handles the detail view for *every* item type — movies, episodes, series, seasons, audio, music videos, photos, live TV programs, recordings, mixed folders.

The component contains:

- A title block with metadata (year, runtime, rating, director, genres, tagline, overview)
- A button row (`buttonGrp`) — buttons are dynamically generated based on item type and play state:
  - **Play** — primary action
  - **Resume** — replaces Play if the item has playback progress
  - **Series Play** — for series, plays from next-up episode
  - **Shuffle** — for collections and playlists
  - **Trailer** — if a remote trailer URL is available
  - **Mark Watched / Unwatched**, **Mark Favorite / Unfavorite**
- An inline **`TrackDropdown` cluster** (`trackCluster`) — three side-by-side dropdowns for Video / Audio / Subtitle source selection, replacing the older modal `ItemOptions` popup. Track titles localize via the `languages.bs` 3-tier resolver (alias → `translationKey` → English fallback). Slots auto-hide when no choices exist (e.g., the Video slot is hidden when only one source is available).
- An "extras" panel (revealed by pressing DOWN) — `extrasGrid` shows related items: cast, episodes (for series), parts (for split media), recommendations, similar items

When a Play button is pressed (handled by `onKeyEvent`):

```brightscript
m.top.quickPlayNode = content[0]
m.top.quickPlayNode = invalid              ' set-then-clear: forces event to fire even if value is identical
```

This bubbles `quickPlayNode` up the parent chain. `main.bs` catches it.

### The set-then-clear pattern

This appears in several places in `ItemDetails.bs`. The trick: `SceneGraph`'s `observeField` only fires when a field's *value* changes. If the user plays the same item twice in a row, setting `quickPlayNode = content[0]` the second time wouldn't fire — the value didn't change. Setting to `invalid` immediately afterward guarantees the next set fires.

The receiver in `main.bs` reads `msg.getData()` (the value at event-queue time) rather than the current field value (which is `invalid` by the time the handler runs):

```brightscript
else if isNodeEvent(msg, "quickPlayNode")
  itemNode = msg.getData()                ' the actual item — not invalid
  if isValid(itemNode) and isValid(itemNode.id) and itemNode.id <> ""
    ...dispatch by itemType...
  end if
```

It works. It's also unusual enough that anyone touching `quickPlayNode` for the first time has to read this to understand it.

## 7. Quickplay dispatch — `source/utils/quickplay.bs`

Inside the `quickPlayNode` handler in `main.bs`, the item is classified by its `type` field and routed:

```brightscript
itemType = LCase(itemNode.type)

m.global.queueManager.callFunc("clear")
m.global.queueManager.callFunc("resetShuffle")

if itemType = "chapter"
  ' Chapter: start parent video at chapter position
  queueItem.type = itemNode.parentType
  queueItem.startingPoint = itemNode.playbackPositionTicks
  queueManager.push(queueItem)
  queueManager.playQueue()

else if itemType = "episode" or itemType = "recording" or itemType = "movie" or itemType = "video"
  quickplay.video(itemNode)               ' wraps in queueItem, pushes
  queueManager.playQueue()

else if itemType = "audio"
  quickplay.audio(itemNode)
  queueManager.playQueue()

else if itemType = "musicvideo"
  quickplay.musicVideo(itemNode)
  queueManager.playQueue()

else if itemType = "photo"
  quickplay.photo(itemNode)               ' photo viewer; no playQueue

else if itemType = "tvchannel" or itemType = "program"
  quickplay.tvChannel(itemNode)           ' or .program(itemNode)
  queueManager.playQueue()

else
  ' Series, season, album, playlist, etc. — need API calls to expand into a multi-item queue
  m.activeQuickPlayTask = CreateObject("roSGNode", "QuickPlayTask")
  m.activeQuickPlayTask.input = { action: itemType, id: ..., seriesId: ..., ... }
  m.activeQuickPlayTask.observeField("output", m.port)
  m.activeQuickPlayTask.control = "RUN"   ' async — output event handled below
end if
```

The split is "synchronous types" vs "async types":

- **Synchronous**: a single item has all the info needed to play. Wrap in queue format, push, play.
- **Async**: requires API expansion (e.g., "play this whole series" → fetch all episodes in order). Spawn a `QuickPlayTask` (in `components/tasks/QuickPlayTask.xml/.bs`) which writes results to its `output` field; the main loop catches the `output` event and finishes the queue setup.

## 8. QueueManager.playQueue() — `components/manager/QueueManager.bs`

The `QueueManager` looks at `getCurrentItem()`, classifies its type, and invokes the right player factory:

```brightscript
sub playQueue()
  m.isPlaying = true
  nextItem = getCurrentItem()
  if not isValid(nextItem) then return

  nextItemMediaType = getItemType(nextItem)

  if nextItemMediaType = "audio" or = "audiobook"
    CreateAudioPlayerView()
  else if nextItemMediaType = "musicvideo" or = "video" or = "movie" or = "episode"
                          or = "recording" or = "chapter" or = "trailer"
                          or = "program" or = "tvchannel"
    CreateVideoPlayerView()
  end if
end sub
```

Both `CreateAudioPlayerView` and `CreateVideoPlayerView` are top-level functions in `components/manager/ViewCreator.bs`.

## 9. Player launch — `components/manager/ViewCreator.bs`

```brightscript
sub CreateVideoPlayerView()
  m.view = CreateObject("roSGNode", "VideoPlayerView")
  m.view.visible = false                    ' keep hidden during loading; otherwise black flash covers backdrop
  m.view.observeField("state", "onStateChange")
  m.view.observeField("selectPlaybackInfoPressed", "onSelectPlaybackInfoPressed")
  m.view.observeField("selectSubtitlePressed", "onSelectSubtitlePressed")
  m.view.observeField("selectAudioPressed", "onSelectAudioPressed")
  m.view.observeField("selectVideoSourcePressed", "onSelectVideoSourcePressed")

  mediaSourceId = m.global.queueManager.callFunc("getCurrentItem").mediaSourceId
  if not isValid(mediaSourceId) or mediaSourceId = ""
    mediaSourceId = m.global.queueManager.callFunc("getCurrentItem").id
  end if

  m.getPlaybackInfoTask = createObject("roSGNode", "GetPlaybackInfoTask")
  m.getPlaybackInfoTask.videoID = mediaSourceId
  m.getPlaybackInfoTask.observeField("data", "onPlaybackInfoLoaded")

  updateQueueBackdrop()                     ' show item's backdrop image
  m.global.sceneManager.callFunc("pushScene", m.view)
end sub
```

The `VideoPlayerView` itself handles fetching media metadata, building the URL, and starting the underlying Roku `Video` node. See `playback.md` for the full picture.

## 10. Playback running

While the video plays:

- `VideoPlayerView` runs a periodic timer that fires `ReportPlayback("Playing")` every ~10 seconds, sending position to `Jellyfin`'s `/PlaybackInfo` endpoint via the side-effect task.
- The OSD shows for 5 seconds when the user interacts, then hides.
- Trickplay (seek scrubbing) shows a thumbnail carousel of preview images.
- "Next episode" notification appears near the end of an episode if the queue has another item.

When the video finishes (`state = "finished"`), `ViewCreator.onStateChange` decides what to do:

- **Live TV channel** — restart the same channel (`clearPreviousScene` → `playQueue` again)
- **More items in queue** — `clearPreviousScene` → `moveForward` → `playQueue` (next item)
- **Queue exhausted** — `popScene` (return to wherever the user came from)

If the user backs out mid-playback, `SceneManager.popScene` detects the `Video` subtype on the popped group and issues `group.control = "stop"` to make sure Jellyfin records the stop event before the node is destroyed.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for `ItemDetails`, `showScenes`, or login-flow entries.
