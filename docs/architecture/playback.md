---
topic: playback
related-files:
  - components/manager/QueueManager.bs
  - components/video/PlayerHostView.bs
  - components/video/PlayerHostView.xml
  - components/video/VideoPlayerView.bs
  - components/video/VideoPlayerView.xml
  - components/video/OSD.bs
  - components/video/TrickplayCarousel.bs
  - components/video/VideoNotification.bs
  - components/mediaPlayers/AudioPlayer.bs
  - components/music/AudioPlayerView.bs
  - components/ItemGrid/LoadVideoContentTask.bs
  - source/utils/voiceTransport.bs
  - source/remotecontrol/remoteDispatch.bs
last-reviewed: 2026-07-09
---

# Video & Audio Playback

The playback subsystem: queue management, the canonical video player, the audio engine vs. audio screen, transcoding decisions, and reporting back to Jellyfin.

## Component map

```brightscript
m.global.queueManager                         ← QueueManager.bs (clean, well-bounded; the exemplar)
m.global.audioPlayer                          ← AudioPlayer.bs (small; extends Video, the audio engine)
                                                always present, plays whether the AudioPlayerView is shown or not

components/video/                             ← VIDEO playback UI
  ├── PlayerHostView.bs/.xml                  ← the routed host for video (extends JRScreen, route
  │                                             /details/:type/:id/play); owns VideoPlayerView as a
  │                                             runtime child + the playback-time dialog handlers
  ├── VideoPlayerView.bs/.xml                 ← the canonical video player; extends Video
  ├── OSD.bs/.xml                              ← title, time, progress; auto-hides after 5s
  ├── TrickplayCarousel.bs/.xml                ← scrub-thumbnail carousel
  ├── TrickplayTileLoader.bs/.xml              ← async tile fetch
  └── VideoNotification.bs/.xml                ← next-episode + media-segment overlays

components/music/                              ← AUDIO playback UI
  ├── AudioPlayerView.bs/.xml                 ← the audio "now playing" screen; extends JRScreen
  ├── AlbumTrackList.bs/.xml                   ← track list for the current album
  ├── SongItem.bs/.xml                         ← row item for a song
  └── LoadScreenSaverTimeoutTask.bs/.xml       ← screensaver suppression while music plays

components/mediaPlayers/                       ← AUDIO playback ENGINE
  └── AudioPlayer.bs/.xml                      ← extends Video, reports playstate to Jellyfin
                                                 lives at m.global.audioPlayer

components/ItemGrid/
  └── LoadVideoContentTask.bs                  ← computes transcode params, builds video URL
                                                 (called by VideoPlayerView before playback starts)
components/GetPlaybackInfoTask.bs/.xml         ← fetches PlaybackInfo from Jellyfin
components/GetShuffleItemsTask.bs/.xml         ← fetches items when shuffle is enabled
(next-episode availability is not a Task — VideoPlayerView.fetchNextEpisode()
 is a render-thread fetchAsync() promise; issue #551 Phase-3a collapse)
```

## QueueManager — `components/manager/QueueManager.bs`

A clean, well-bounded class. Lives at `m.global.queueManager`, instantiated in phase 2. Methods are accessed via `callFunc` from any thread:

```brightscript
m.global.queueManager.callFunc("push", queueItem)
m.global.queueManager.callFunc("playQueue")
```

### State (instance variables)

| Variable | Purpose |
|---|---|
| `m.queue` | Array of queue items (in current play order — could be shuffled) |
| `m.originalQueue` | Snapshot of unshuffled order (for un-shuffle) |
| `m.queueTypes` | Parallel array of item types (`"movie"`, `"audio"`, etc.) — avoids re-deriving |
| `m.position` | Index of currently-playing item in `m.queue` |
| `m.isPlaying` | Whether a player is currently active |
| `m.shuffleEnabled` | Bool |
| `m.hold` | Items "held" for later (separate from the active queue) |
| `m.isPrerollActive` | Cached from `m.global.user.settings.playbackCinemaMode`; controls whether cinema-mode prerolls play before the next item |

### Public methods

Queue mutation:

- `push(item)`, `pop()`, `peek()`, `top()` — array-style access
- `set(items)` — replace the whole queue
- `clear()`, `clearHold()`, `deleteAtIndex(i)`
- `hold(item)` / `getHold()` — separate "held items" list

Queue inspection:

- `getCount()`, `getCurrentItem()`, `getItemByIndex(i)`, `getQueue()`
- `getQueueTypes()`, `getQueueUniqueTypes()`, `getItemType(item)` — type derivation

Position:

- `setPosition(i)`, `getPosition()`, `moveBack()`, `moveForward()`

Shuffle:

- `toggleShuffle()` → switches shuffle on/off, snapshots original order or restores it
- `resetShuffle()`, `getIsShuffled()`, `getUnshuffledQueue()`
- `shuffleQueueItems()` keeps the currently-playing item at position 0 when enabling shuffle

Resume:

- `setCurrentStartingPoint(positionTicks)` — sets the resume point on the current queue item before playback starts

Preroll:

- `isPrerollActive()`, `setPrerollStatus(status)` — cinema mode

The big one:

- **`playQueue()`** — looks at the current item's type and sets `m.global.playbackLaunchRequest = { type, id[, media: "audio"] }`. It does **not** instantiate a player or navigate (a Task/data node has no router chain). `JRScene.onPlaybackLaunchRequested` observes that field and turns it into a route: audio → `/audio` (the routed `AudioPlayerView`), every video-family type → `/details/<type>/<id>/play` (the `PlayerHostView`). The queue is the source of truth for what actually plays; the route `:type`/`:id` just give the launch a deep-link identity.

The whole file is well-commented and reads cleanly. It's frequently held up internally as the gold standard for "what good BrighterScript looks like" — worth reading end-to-end before doing any refactor that touches queue mechanics.

## PlayerHostView — `components/video/PlayerHostView.bs/.xml`

The **routed host** for video playback (route `/details/:type/:id/play`). `VideoPlayerView` extends Roku's native `Video` node, so it can't itself be a `sgrouter_View`; this thin `JRScreen` wrapper is the routed view and owns the player as a **runtime child** (`m.top.appendChild(m.view)`), not a separate pushed scene. It is the new home for what was `ViewCreator`'s video half (the deleted `components/manager/ViewCreator.bs`). Its job is three-fold:

1. **Player mount**: `onScreenShown` → `mountPlayer()` instantiates `VideoPlayerView`, wires observers, kicks off `GetPlaybackInfoTask`, updates the backdrop, and appends the player as a child (player `visible=false` during loading to avoid a black flash over the backdrop). The queue is already populated *before* navigation (the launcher cleared + pushed, then navigated to `/play`), so the host just reads `getCurrentItem` — **the queue is the source of truth**.
2. **Queue advancement** (host-internal): next-episode / Live TV restart / channel switch destroy + remount the player child (`playCurrentQueueItem()` = `destroyPlayer()` + `mountPlayer()`), rather than pop/push of scenes.
3. **Playback-time track selection**: when the user opens the `OSD`'s track menus *during playback*, the player fires events (`selectSubtitlePressed`, `selectAudioPressed`, `selectVideoSourcePressed`, `selectPlaybackInfoPressed`) which `PlayerHostView` catches via observers and shows a `radioDialog` (these handlers were ported verbatim from `ViewCreator`). (Note: *pre-playback* track selection happens inline via `ItemDetails`'s `TrackDropdown` cluster — see `user-journey.md`. The two flows write to the same `VideoPlayerView` fields; they're parallel entry points, not duplicates.)

The dialog flow:

```brightscript
User presses "audio tracks" on OSD
  → VideoPlayerView sets selectAudioPressed = true
  → PlayerHostView.onSelectAudioPressed() builds an array of {index, isExternal, track, type, selected?}
  → m.global.sceneManager.callFunc("radioDialog", "Select Audio", audioData)
  → SceneManager presents the dialog
  → user picks → SceneManager.returnData = chosen item
  → PlayerHostView.onSelectionMade() reads returnData, dispatches by .type
    ├── "subtitleselection" → processSubtitleSelection()
    ├── "audioselection" → processAudioSelection()  → m.view.audioIndex = chosen.index
    └── "videosourceselection" → processVideoSourceSelection()
```

The processing functions write back into `VideoPlayerView`'s fields (`audioIndex`, `selectedSubtitle`, `mediaSourceId`), which the player observes and reacts to (e.g., changing `audioIndex` triggers an audio stream switch on the underlying `Video` node).

`onPlayerStateChange` (ported from `ViewCreator.onStateChange`) handles end-of-playback:

- **`finished` state** but `isRetrying = true` → don't advance (`mid-DoVi-fallback` retry)
- **Live TV channel that finished** → `playCurrentQueueItem()` (restart the same channel, host-internal remount)
- **More items in queue** → `moveForward` + `playCurrentQueueItem()` (destroy + remount for the next item)
- **Queue exhausted** → `exitPlayback()` → `sgrouter.goBack()` (leaves the play route; the `keepAlive` view beneath — the launching detail, or Home — resumes)

The player reports its stop playstate to Jellyfin in `destroyPlayer()`: it removes the observer on `state`, then sets `m.view.control = "stop"` (the `Video` node's own `onDestroy` does not report a stop), before `callFunc("onDestroy")` and `removeChild`. So whether the user backs out (`goBack` → `beforeViewClose` → `onDestroy` → `destroyPlayer`) or the queue exhausts, Jellyfin records the stop.

## VideoPlayerView — `components/video/VideoPlayerView.bs/.xml`

The canonical video player and the largest single component in the playback subsystem. Extends Roku's native `Video` node, so it inherits the full media-playback state machine and adds `JellyRock-specific` overlays, OSD, trickplay, captions, transcoding logic, and Jellyfin reporting.

### Component structure

```xml
<component name="VideoPlayerView" extends="Video">
  <interface>
    <field id="backPressed" />
    <field id="selectSubtitlePressed" />
    <field id="selectAudioPressed" />
    <field id="selectVideoSourcePressed" />
    <field id="selectPlaybackInfoPressed" />
    <field id="PlaySessionId" />            <!-- Jellyfin session ID for reporting -->
    <field id="Subtitles" />                 <!-- subtitle track array -->
    <field id="SelectedSubtitle" />          <!-- -1 = none, otherwise track index -->
    <field id="container" />                 <!-- e.g. "mp4", "mkv" -->
    <field id="isDirectPlaySupported" />
    <field id="transcodeParams" />
    <field id="isTranscodeAvailable" />
    <field id="isTranscoded" />
    <field id="transcodeReasons" />
    <field id="isDoviDirectPlayFallbackAvailable" />
    <field id="isRetrying" />                <!-- prevents premature scene pop during DoVi retry -->
    <field id="videoId" />
    <field id="mediaSourceId" />
    <field id="fullSubtitleData" />
    <field id="fullAudioData" />
    <field id="fullVideoSourceData" />
    <field id="audioIndex" />
    <function name="onDestroy" />
  </interface>
  <children>
    <Group id="captionGroup" />                                    <!-- Custom subtitle rendering -->
    <TrickplayCarousel id="trickplayCarousel" visible="false" />
    <timer id="playbackTimer" repeat="true" duration="10" />        <!-- 10s reporting cadence -->
    <timer id="bufferCheckTimer" repeat="true" />
    <OSD id="osd" visible="false" inactiveTimeout="5" />            <!-- 5s OSD auto-hide -->
    <Rectangle id="chapterList" visible="false" ...>
      <LabelList id="chaptermenu" .../>
    </Rectangle>
    <!-- next-episode and media-segment notifications attached at runtime -->
  </children>
</component>
```

Note: the `OSD`'s `inactiveTimeout` is **5 seconds**, not 10 as some sources may claim.

### Playback lifecycle

1. **Mount** — `PlayerHostView.mountPlayer()` instantiates the player, observes state + UI press fields, kicks off `GetPlaybackInfoTask`, and appends it as a child of the host (player is `visible=false` during loading to avoid a black flash over the backdrop).
2. **Metadata loaded** — `onPlaybackInfoLoaded()` populates `playbackData`. The player begins resolving the actual video URL (direct play vs. transcode — see "Transcoding decisions" below).
3. **Underlying `Video` node starts** — the inherited `state` field transitions to `buffering` → `playing`. The player observes its own state and:
   - Shows the OSD briefly
   - Starts the `playbackTimer` (10-second repeat) → `reportPlayback("update")` to Jellyfin
   - Becomes `visible = true`
4. **Steady state** — `playbackTimer.fire` → `reportPlayback("update")` every 10 seconds with current position. User interactions (pause, seek, OSD open) are all handled by `onKeyEvent` and the inherited `Video` machinery.
5. **End / transition** — `state = "finished"` → `PlayerHostView.onPlayerStateChange` handles next-item / restart / exit logic (host-internal remount or `goBack`). If the user backs out, the router closes the host (`beforeViewClose` → `onDestroy` → `destroyPlayer`). Either way the stop is reported to Jellyfin via `m.view.control = "stop"` in `destroyPlayer()`.

### `reportPlayback` — server-side reporting

Position is reported in **Jellyfin ticks** (1 tick = 100 ns; `int(positionSeconds) * 10000000`). The request is built by `GetApi().BuildPlaystateRequest(state, params)` and dispatched via `SubmitSideEffect()` so it doesn't block playback.

States reported:

- `"start"` — once, when playback first transitions to `playing`
- `"update"` — every 10 seconds via the playback timer, while playing or paused
- `"stop"` — once on `finished` or `stopped`

This is what makes "Continue Watching" rows on the home screen accurate.

## OSD — `components/video/OSD.bs/.xml`

The on-screen display: title, current time, position bar, end-time prediction, play/pause icon. Activates on key press, auto-hides after 5 seconds of inactivity (`inactiveTimeout="5"` in the XML).

The OSD is the entry point for advanced controls — it has menu icons for audio tracks, subtitles, video source, and playback info that fire the corresponding `select*Pressed` events on the player when activated.

### Live TV / DVR-recording mode

The OSD adapts when the current item is a live TV channel or a DVR recording (vs. on-demand video). The hybrid behind-live math lives in `source/utils/liveTv.bs` (extracted as testable helpers). Notable adaptations:

- **`goToLive` button** — appears in the `OSD`'s left button menu when the user has scrubbed back from the live edge of a live TV stream. Pressing it seeks to live. The button auto-hides when the user is already at the live edge (detached from the layout entirely so it doesn't reserve dead space).
- **Wall-clock fallback** — when stream metadata is missing (some recordings, mid-stream channel switches), OSD timestamps fall back to wall-clock time + program EPG data rather than reporting zeros.
- **Logo/metadata refresh** — channel switches reset stale logo and metadata before the new channel's data arrives, so the OSD doesn't briefly show the previous channel's branding.
- **Recording playback** — short MPEG-TS recordings stay on HLS so the trickplay scrub bar can scrub them; longer recordings remain progressive (the MPEG-TS → progressive MKV transcode path was tried and reverted as not worth the complexity).

`components/video/RefreshLiveTvMetadataTask.bs` supports the metadata-refresh flow. The channel queue is populated by `VideoPlayerView.loadChannelListForQueue()` — a render-thread `fetchAsync().then()` promise (collapsed from the former `LoadChannelListForQueueTask`; see [`docs/dev/promises.md`](../dev/promises.md)) that fetches the channel list once per playback and installs it into the queue via `buildChannelQueueList()` (`source/utils/liveTv.bs`). The channel list is reused across channel switches in the queue to avoid refetching.

## TrickplayCarousel — `components/video/TrickplayCarousel.bs/.xml`

The seek-thumbnail UI. When the user holds left/right to scrub, this component:

- Receives the seek position from `Video.trickPlayBar`
- Shows a horizontal carousel of preview thumbnails near the current scrub position
- Uses `TrickplayTileLoader` (an async Task) to fetch the actual thumbnail tiles from Jellyfin
- Pre-fetches ahead of the scrub direction so the carousel doesn't stutter
- On low-memory devices (`m.global.device.isLowMemoryDevice`), reduces pre-fetch range to conserve texture memory

## VideoNotification — `components/video/VideoNotification.bs/.xml`

Two kinds of notifications overlay during playback:

1. **Next Episode** — appears near the end of an episode if `QueueManager` has another item queued. User can press OK to skip immediately to the next episode.
2. **Media Segments** — Jellyfin can mark sections like Intro, Outro, Recap, Preview, Commercial. The player shows skip buttons at the appropriate timestamps.

Both notifications dismiss themselves on a timer or when the user navigates away.

## `AudioPlayer` engine — `components/mediaPlayers/AudioPlayer.bs/.xml`

A small component that **extends Video** but is used exclusively for audio. Lives at `m.global.audioPlayer` for the entire app lifetime, so audio can keep playing while the user navigates other screens.

```brightscript
sub init()
  m.isPlayReported = false
  m.top.observeField("state", "audioStateChanged")
end sub

sub audioStateChanged()
  currentState = LCase(m.top.state)
  reportedPlaybackState = "update"

  m.top.disableScreenSaver = (currentState = "playing")    ' suppress screensaver while playing

  if currentState = "playing" and not m.isPlayReported
    reportedPlaybackState = "start"
    m.isPlayReported = true
  else if currentState = "stopped" or currentState = "finished"
    reportedPlaybackState = "stop"
    m.isPlayReported = false
  end if

  reportPlayback(reportedPlaybackState)
end sub

sub reportPlayback(state as string)
  params = {
    "ItemId": m.global.queueManager.callFunc("getCurrentItem").id,
    "PlaySessionId": m.top.content.id,
    "PositionTicks": int(m.top.position) * 10000000&,
    "IsPaused": (LCase(m.top.state) = "paused")
  }
  req = GetApi().BuildPlaystateRequest(state, params)
  SubmitSideEffect(req)
end sub
```

Same reporting pattern as the video player. The screen-saver suppression is important — without it, Roku would dim the screen and eventually exit the app while music was playing.

## AudioPlayerView — `components/music/AudioPlayerView.bs/.xml`

The visible "now playing" screen for music — extends `JRScreen`, **not** `Video`. It's the UI that shows album art, track title, artist, progress bar, track list, and playback controls. The actual audio comes from `m.global.audioPlayer` (the engine above), which the screen interacts with via `callFunc` and observers.

This split is **intentional and clean** — the audio keeps playing even when the screen is popped (e.g., user backs out of "now playing" to go look for another album). The screen is just a view onto the engine's state.

## Transcoding decisions — `components/ItemGrid/LoadVideoContentTask.bs`

Before `VideoPlayerView` starts the `Video` node, it needs a URL. The decision tree:

1. **Direct Play** — try first. Check device codec capabilities (`m.global.device.videoBitDepth`, etc.) against the item's media streams.
2. **Direct Stream** — if the container needs remuxing but codecs are OK.
3. **Transcode** — if codecs/profiles unsupported.

Multichannel audio handling lives in `source/api/items.bs` and `source/utils/deviceCapabilities.bs`:

- **Direct-play multichannel by default** on surround-capable hardware — the device's `MaxAudioChannels` (from its `TranscodingProfiles`) gates whether 5.1+ tracks are direct-played.
- **Surround codec preservation on transcode** — when a multichannel source can't direct-play, the transcoder is steered toward surround-capable codecs (`eac3`/`ac3`/`dts`) over downmixing to AAC stereo. The `surroundCodecs` list in `items.bs` is intentionally distinct from `stereoOutputCodecs` in `deviceCapabilities.bs`; the former is a pick-from-this-list hint to the server, the latter is an output capability.

Special case: **Dolby Vision (DoVi)**. JellyRock has dedicated DoVi handling because `Jellyfin`'s transcoder can sometimes produce HLS segments that overflow Roku's video buffer:

- If `playbackPreserveDovi` is enabled and item is DoVi, attempt a `DoVi-preserving` transcode first.
- If that produces a `buffer:loop:` source error mid-playback, the player retries with `shouldBypassDoviPreservation = true` (the `isRetrying` flag prevents `PlayerHostView.onPlayerStateChange` from advancing/exiting during this in-flight retry).
- The retry typically succeeds with direct play (since the device supports DoVi natively, just not the way Jellyfin transcoded it).

Live TV channels always use the HLS transcode wrapper.

`transcodeReasons` is surfaced to the user via the playback-info dialog, so they can see *why* their movie is transcoding (e.g., "Codec H.265 not supported" / "Audio channel layout 5.1 not supported").

## Subtitles

Three "kinds" of subtitles:

- **None** — `SelectedSubtitle = -1` (`SubtitleSelection.NONE` enum)
- **Native (Roku-rendered)** — text-format tracks (SRT, VTT) that Roku can display directly. `globalCaptionMode = "On"`, `subtitleTrack = <Roku-mangled track name>`.
- **Encoded (Jellyfin-burned)** — tracks burned into the video stream by the transcoder (e.g., bitmap subtitles like PGS). `globalCaptionMode = "Off"` (Roku captions hidden because they're already in the picture).

Annoyance addressed in code: Roku **reorders** subtitle tracks unpredictably between what JellyRock provides and what `availableSubtitleTracks` returns. The function `availSubtitleTrackIdx(trackName)` in `PlayerHostView.bs` handles this by matching on substring of the track URL rather than expecting index parity.

The current selection persists in user settings (`globalCaptionMode`) so it's remembered across sessions.

Track *language names* (the labels shown in the `TrackDropdown` and OSD menus) are localized via `source/utils/languages.bs` — see `translations.md` for the 3-tier resolver (alias → `translationKey` → English fallback) and the `lint:language-coverage` CI script that catches silent localization gaps.

## Transport control (Roku voice remote + "Cast to JellyRock")

The players' `handleTransport()` serves **two** command sources that share one dispatch adapter:
Roku **voice** transport (`roInputEvent`, `info.type = "transport"`) and the **`ws://` remote-control
receiver** (another Jellyfin client casting — see [remote-control.md](./remote-control.md)). Voice
commands are `play`, `pause`, `seek`, `next`, `startover`, `replay`, `skip`, `nowplaying`, `shuffle`,
`loop`, `like`, `dislike`, …; the cast path adds `previous`, `seekto` (ABSOLUTE seek, vs voice's
relative `seek`), and `playpause` (toggle). Four pieces wire this up:

1. **Manifest gates** (in `manifest`): `supports_voice_roinput=1`, `supports_etc_seek=1`, `supports_etc_next=1`. Without these, Roku OS shows a "command not available" HUD even if the app would have handled it.
2. **Shared dispatch adapter** (`source/remotecontrol/remoteDispatch.bs`): `dispatchTransport(evt)` resolves the active view via `getActiveView()` (= `m.global.activeRoutedView`) and calls `handleTransport(evt)` via `callFunc` when that view is `PlayerHostView`, `VideoPlayerView`, or `AudioPlayerView`, returning `{ status, nowPlaying }`. For routed video the active view is the `PlayerHostView` wrapper, which forwards to its child `VideoPlayerView`.
3. **Voice main-loop branch** (`source/main.bs`): `input.EnableTransportEvents()` opts in; the `roInputEvent` branch calls the shared `dispatchTransport(info)`, then feeds the `status` back via `input.EventResponse({id, status})` (the status code controls Roku's HUD message — `success` / `success.seek-start` / `success.seek-end` / `error.live` / `error.no-media` / `error.redundant` / `error.generic` / `unhandled`) and reports `nowPlaying` to `roAppManager` (both `roInput`/`roAppManager` are main-thread-only). The cast path calls the same `dispatchTransport` but ignores the return (Jellyfin doesn't expect a per-command acknowledgment).
4. **Per-player handlers** — `VideoPlayerView.handleTransport()` and `AudioPlayerView.handleTransport()`, each owning its own command map (`PlayerHostView.handleTransport` is a thin forwarder to the child player). Pure logic (setting fallback for instant-replay duration, voice `seek` payload parsing, bounds-checked seek math) lives in `source/utils/voiceTransport.bs` so it's unit-testable without instantiating a player.

One deliberate per-player UX deviation from the Roku-doc default:

- **Video `skip`** first tries to skip an active media segment (intro/recap/etc.) — if a `segmentNotification` is in-window, the same handler that fires on physical-OK fires; if no segment is active, falls through to `next`-item behavior per the Roku doc spec.

The `replay` (instant-replay) duration is user-configurable via `playbackInstantReplaySeconds` in user settings — both video and audio honor it, defaulting to 10 seconds (industry standard, midpoint of Roku's 10-to-25-seconds guidance). The `voiceTransport.resolveInstantReplaySeconds()` helper falls back to 10 when the setting is missing or non-positive.

Testing without a voice remote: ECP curl works for any `transport` command —

```bash
curl -d '' "http://<roku-ip>:8060/input/dev?id=1&type=transport&command=seek&direction=forward&duration=30"
```

This is how the Rooibos specs verify status-code logic, and it's the recommended manual smoke-test path.

The runtime deep-link launch branch (`info.DoesExist("mediatype")`) shares the same `roInputEvent` dispatcher — both ingress paths come through the same `roInput` object created at startup. It is now **route-aware**: it stashes the play path + seeds the queue via `stashDeepLinkPlay`, then (when signed in) `replayAfterLogin()` replays the route chain so back unwinds Player → Details → Home (decision #3). See `bootstrap.md` for the full deep-link flow.

## A historical note: the legacy video player

There used to be a second video player (`components/JRVideo.bs` + `source/VideoPlayer.bs`). It was deleted in commit **`17cc374f` "chore: remove legacy video player code"**. There is now only one video player — `VideoPlayerView`. If you find references in old comments, blog posts, or AI training data to a `JRVideo` component or `VideoPlayer.bs`, those are stale.

The audio side has *two* components (`mediaPlayers/AudioPlayer` and `music/AudioPlayerView`), but they are not duplicates — they are the engine and the screen, intentionally split (see above).

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for playback / `VideoPlayerView` / audio-player entries.
