---
topic: playback
related-files:
  - components/manager/QueueManager.bs
  - components/video/PlayerHostView.bs
  - components/video/PlayerHostView.xml
  - components/video/VideoPlayerView.bs
  - components/video/VideoPlayerView.xml
  - components/video/OSD.bs
  - components/GetPlaybackInfoTask.bs
  - source/utils/trackPickerOptions.bs
  - source/utils/playbackInfo.bs
  - source/utils/deviceCapabilities.bs
  - source/utils/playbackErrorInfo.bs
  - source/utils/playbackReport.bs
  - source/utils/transcodeCause.bs
  - components/video/TrickplayCarousel.bs
  - components/video/VideoNotification.bs
  - components/mediaPlayers/AudioPlayer.bs
  - components/music/AudioPlayerView.bs
  - components/ItemGrid/LoadVideoContentTask.bs
  - source/utils/voiceTransport.bs
  - source/remotecontrol/remoteDispatch.bs
last-reviewed: 2026-09-02
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
components/GetPlaybackInfoTask.bs/.xml         ← fetches THIS DEVICE'S LIVE SESSION (/Sessions)
                                                 for the playback-info report; fetch only,
                                                 the report is composed render-side
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
| `m.isPrerollActive` | Cached from `m.global.user.settings.playbackCinemaMode`; controls whether cinema-mode prerolls play before the next item |

### Public methods

Queue mutation:

- `push(item)`, `pop()`, `peek()`, `top()` — array-style access
- `set(items)` — replace the whole queue
- `clear()`, `deleteAtIndex(i)`

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

1. **Player mount**: `onScreenShown` → `mountPlayer()` instantiates `VideoPlayerView`, wires observers (including creating `GetPlaybackInfoTask` and observing its `data`, without launching it — the launch is deferred to `onSelectPlaybackInfoPressed`), updates the backdrop, and appends the player as a child (player `visible=false` during loading to avoid a black flash over the backdrop). The queue is already populated *before* navigation (the launcher cleared + pushed, then navigated to `/play`), so the host just reads `getCurrentItem` — **the queue is the source of truth**.
2. **Queue advancement** (host-internal): next-episode / Live TV restart / channel switch destroy + remount the player child (`playCurrentQueueItem()` = `destroyPlayer()` + `mountPlayer()`), rather than pop/push of scenes.
3. **Playback-time track selection**: when the user opens the `OSD`'s track menus *during playback*, the player fires events (`selectSubtitlePressed`, `selectAudioPressed`, `selectVideoSourcePressed`, `selectPlaybackInfoPressed`) which `PlayerHostView` catches via observers and shows a dialog from the standard family (`source/utils/dialogs.bs`). (Note: *pre-playback* track selection happens inline via `ItemDetails`'s `TrackDropdown` cluster — see `user-journey.md`. The two flows write to the same `VideoPlayerView` fields; they're parallel entry points, not duplicates.)

The dialog flow:

```brightscript
User presses "audio tracks" on OSD
  → VideoPlayerView sets selectAudioPressed = true
  → PlayerHostView.onSelectAudioPressed()
      → buildAudioTrackOptions()  (source/utils/trackPickerOptions.bs)
          returns { labels, values, defaultIndex }
      → showTrackPicker() → showListDialog(title, labels, "onAudioTrackSelected", defaultIndex)
  → user picks → the DIALOG NODE's own result.optionIndex
  → PlayerHostView.onAudioTrackSelected() → m.view.audioIndex = values[optionIndex]
```

**The option set is what makes the result meaningful.** `JRListDialog` answers with an
index into the labels it was given, so each picker holds the `{ labels, values }` pair it
built until its result lands (`m.trackPickerOptions`). The builders are pure functions in
`source/utils/trackPickerOptions.bs` — one per picker — which is what lets the
"Jellyfin streams + current selection → what the user sees, and what they picked" mapping
be unit-tested off-device.

Each picker has its **own** result handler. The predecessor shared one
`SceneManager.returnData` field across all three and told them apart by stamping a `type`
string (`"audioselection"` / `"subtitleselection"` / `"videosourceselection"`) into every
option — a discriminator that existed only because the return channel was global.

Only one of these can be open at a time (the OSD is unreachable behind a modal), so they
share one node slot (`m.playbackDialog`). That slot is what teardown abandons: these
overlays are appended to the **scene**, so `onDestroy` *and* `onPlayerStateChange` call
`abandonDialog()` on it.

`onPlayerStateChange` then calls `cancelOpenDialog()` as well, and the two are not
redundant. A main-thread flow can open a dialog *over* the player — a cast notice, the
deep-link server-switch prompt — and it holds state until that dialog answers. Ours is
**abandoned** (the scope that would receive the result is being torn down); anything else
is **canceled** (its owner is alive and has to be told, exactly as if the user had pressed
`Back`). Leaving a foreign dialog up is not an option either: playback teardown navigates,
the incoming screen takes focus, and the dialog is left on screen but deaf.

### Three dialogs, cleared in a fixed order

Playback teardown has to clear **three** separate things, and they differ by *who owns
them* — which is what decides both the verb and the order:

| # | Dialog | Owned by | How teardown clears it |
|---|---|---|---|
| 1 | Track pickers + the playback-info report (`m.playbackDialog`) | `PlayerHostView` | `abandonDialog()` on the slot |
| 2 | The playback-error alert | **`VideoPlayerView`** (the player child) | `m.view.callFunc("abandonErrorDialog")` |
| 3 | Anything a main-thread flow put over the player (cast notice, server-switch prompt) | someone else | `cancelOpenDialog()` |

Rows 1 and 2 are *ours*, so they are **abandoned** — no result is delivered, because the
scope that would receive it is going away. Row 3 belongs to a flow that is still alive and
holding state until its dialog answers, so it is **canceled** — the same answer the user
pressing `Back` would have produced.

**Row 2 needs its own call, and it must come before row 3.** The error alert is created by
`showPlaybackErrorDialog` inside the *player*, not the host, so it was never in
`m.playbackDialog` and row 1 never touched it. Since it is now an ordinary overlay,
`cancelOpenDialog()` *would* reach it — and that is the trap. Canceling is deliberately
**indistinguishable from the user pressing `Back`** (see `JRDialog.cancelDialog`), and this
dialog's result handler treats any real dismissal as "leave the player" and calls
`exitPlayback()`. So a cancel arriving from teardown fires a `goBack()` from *inside*
`onPlayerStateChange`, which then carries on to advance the queue or exit again — one
navigation racing another. Abandoning first drops the dialog and its observer, so by the time
`cancelOpenDialog()` runs there is nothing left for it to cancel.

The host reaches into the player through an `<interface>` `<function>` because that is the
only way to call a child component's method in Scene Graph. Historically this alert was a
raw Roku `Dialog` on the modal channel whose `wasClosed` observer fired for user dismissals
and programmatic closes alike — unable to tell them apart, it navigated for both, which is
exactly the race this ordering retires.

**The rule is general, and lives in the dialog standard, not here.** Any dialog whose result
handler *acts* rather than merely reading a value has this hazard; the player is simply the
first surface to hit it. See
[`dialogs.md`](./dialogs.md#presenting-and-tearing-down) — this section is the worked
example, that bullet is the rule.

### An error dialog owns the exit

Ordering alone does not cover the stall path, because that path *creates* the very state
teardown reacts to: `bufferCheck` shows the alert and stops the stream on the next line, with
nothing claiming the exit. **Which state that stop produces decides whether it bites.**
Measured on a Roku Ultra (4850X), four runs of a real TrueHD buffering stall, it produced
`stopped` — which `onPlayerStateChange` ignores outright, so the alert survived and the path
was already benign. It can produce `finished` instead, and that is not speculation: the
`isRetrying` guard beside it exists because the DoVi fallback's `stop` did exactly that. On
that landing the table above runs — abandoning the alert, then advancing the queue — with the
error unread, and mid-season that reads as "play the next episode".

So `VideoPlayerView` **claims the exit** when it shows an error: `errorDialogOwnsExit` is set
alongside the dialog and cleared with it, and `onPlayerStateChange` returns early while it is
set — the same shape as the `isRetrying` check beside it, and the same premise, that a
`finished` this app caused is not playback ending. The dialog then drives the exit itself
through `exitFromPlaybackError` → `exitPlayback`, the one path both error tiers share.
Acknowledging leaves the player rather than advancing the queue: auto-advancing past a
failure skips content the viewer asked for, and with the server down it walks the rest of the
season one unread flash at a time. The claim is cheap insurance rather than a fix for a
reproduced defect — it costs nothing on the `stopped` landing and closes the asymmetry on the
`finished` one. See
[`playback-error-dialog-dismissed-before-it-is-read`](./tech-debt.md#playback-error-dialog-dismissed-before-it-is-read)
for the measurement and what a reproduction would still have to show. Bailing cannot strand
the dialog — the dialog's own resolution exits, and anything that navigates without it reaches
`VideoPlayerView.onDestroy`, which abandons it. Row 2 of the table stays as defense in depth
for a dialog shown without a claim.

The claim is set inside `showPlaybackErrorDialog`, not at its call sites, so none of the four
can order it wrong — it lands after the dialog is on screen and before any caller's stop. Only
`bufferCheck` issues one: `onState`'s `error` branch stops the two timers and not the stream,
and the two content-load failures never started one. Note that the `error` branch's
`m.top.unobserveField("state")` drops only `VideoPlayerView`'s own observer — `PlayerHostView`
holds a separate one from `mountPlayer()` — so the host can still receive a later `finished`
from that branch, which is why the claim covers all four rather than the stall alone.

### A superseded error parks the player

A **supersede** is the case ordering genuinely cannot reach: `presentOverlayDialog` cancels
the incumbent from a caller that cannot know to abandon someone else's dialog first. Both
error tiers therefore check provenance — `result.externallyCancelled` on the alert, the
`externallyCancelled` field on the `OverviewDialog` report, which has no result — and decline
to leave the route on a close the user did not make. See
[`dialogs.md`](./dialogs.md#presenting-and-tearing-down) for the contract.

Declining to leave is not the same as doing nothing, because **a live `Video` node with no
stream is not a blank screen**. It keeps drawing Roku's own buffering indicator (the internal
`retrievingBar` / `bufferingBar` `ProgressBar` nodes — `bufferingBar` is the one `init` styles), so
the first version of this left the viewer on a black screen with a ring reading `0%`: the app
saying it is loading, forever. Captured on a Streaming Stick 4K by reproducing the state
(player mounted, stream stopped, no dialog, OSD never opened) and reading the app's own
spinner as `visible: false` at the same instant, which is what identifies the ring as Roku's
node rather than ours.

So the two handlers call `parkPlayerAfterSupersede`: clear the error state, hide the node, and
mark the player parked. Hiding removes the ring and reveals the backdrop the host already set
for this item. The parked flag is not decoration — `stateAllowsOSD()` admits `"stopped"`, so
without it `Up` would open an OSD inside a hidden parent, a control surface that renders
nothing while taking the focus `Back` needs. Parked, there is nothing to control and `Back` is
the only action, which is what the state actually is. `onState`'s `playing` branch undoes both,
because a voice or remote-control `play` restarts a stopped node without going through
`onVideoContentLoaded` — the only other place that makes the player visible.

What the viewer still does not get is an explanation: the error text went with the dialog, and
re-presenting it over the surface that deliberately took the screen would just restart the
fight. Doing better needs a signal that does not exist — the player does not own the
interrupting dialog and has no way to observe its close.

**Playback info** (`selectPlaybackInfoPressed`) takes the same route to a different
member of the family, and the split is deliberate at every step:

| Step | Where | Why there |
|---|---|---|
| fetch the live session | `GetPlaybackInfoTask` | the only I/O; nothing else on that thread |
| model the report | [`source/utils/playbackReport.bs`](../../source/utils/playbackReport.bs) | pure — testable without hardware, and cheap enough on the render thread to rebuild per press |
| attribute a reason to a setting | [`source/utils/transcodeCause.bs`](../../source/utils/transcodeCause.bs) | pure, and the only part that can be *wrong* rather than merely missing |
| present it | `showReportDialog` → `OverviewDialog` | one read-only overlay for the family |

The task used to do all four. That was wrong three times over: the work needed no Task
thread, every `m.global` read it made cost ~93 µs against ~2 µs from the render thread, and
the built report was cached for the life of the player — so a DoVi buffer-overflow fallback
(transcode → direct play) left the "i" button confidently describing a transcode that had
already stopped. Composing per press is what makes it honest.

**Every row is `source → target`, and the arrow appears only where the server told us the
target.** Three tiers of evidence, and they are not interchangeable: `TranscodingInfo` off
the live session is the actual output; a handful of `TranscodingUrl` parameters
(`&AudioBitrate`, `&AudioSampleRate`, `&SubtitleMethod`) are exact declarations; and the
per-codec stream options are *constraints* — `<codec>-rangetype` can be a comma-joined
permitted set and `<codec>-videobitdepth` is a ceiling, so they are read only where they
collapse to one unambiguous answer. Anything else renders source-only. Inventing "→ SDR"
because a transcode is happening would be the most convincing wrong thing this report
could say.

**Reason codes pass through untranslated.** Jellyfin maintains that vocabulary; a parallel
copy here would drift, and a code we cannot explain is the server's to explain. What the
report adds is the part no server can know — that the constraint came from a switch in
*our* settings screen — and it says so only where the same predicate that injected the
profile condition still holds for this stream. A setting that is on but not *binding*
caused nothing.

**Three rows are live** (transcode speed, progress, output bitrate) and the dialog polls
every `PLAYBACK_INFO_REFRESH_SECONDS`. Speed is the actionable one: `TranscodingInfo.Framerate`
is frames *encoded* per second, so dividing by the source frame rate gives a real-time
multiplier, and below 1.0x the server cannot keep up. Refreshing assigns `sections` again;
`OverviewDialog` reconciles by row `id` and rewrites text in place, so nothing is added or
removed and the scroll position does not move. Volatility is a property of the *model*,
not a list in the refresh code — a future live field updates because its text changed.

The result handlers write back into `VideoPlayerView`'s fields (`audioIndex`, `selectedSubtitle`, `mediaSourceId`), which the player observes and reacts to (e.g., changing `audioIndex` triggers an audio stream switch on the underlying `Video` node). They write only on an actual change: `mediaSourceId` triggers a video reload, and `SelectedSubtitle` is `alwaysNotify`, so re-writing the value it already holds still fires its observers.

`onPlayerStateChange` (ported from `ViewCreator.onStateChange`) handles end-of-playback:

- **`finished` state** but `isRetrying = true` → don't advance (`mid-DoVi-fallback` retry)
- **Live TV channel that finished** → `playCurrentQueueItem()` (restart the same channel, host-internal remount)
- **More items in queue** → `moveForward` + `playCurrentQueueItem()` (destroy + remount for the next item)
- **Queue exhausted** → `exitPlayback()` → `sgrouter.goBack()` (leaves the play route; the suspended view beneath — the launching detail, or Home — resumes)

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
    <field id="isDoviPreservationBypassed" /><!-- a retry re-asked WITHOUT the DoVi profile, so the
                                                  report must not blame the Preserve DoVi setting -->
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

1. **Mount** — `PlayerHostView.mountPlayer()` instantiates the player, observes state + UI press fields, creates `GetPlaybackInfoTask` and observes its `data` (the task is launched later, on `onSelectPlaybackInfoPressed`), and appends it as a child of the host (player is `visible=false` during loading to avoid a black flash over the backdrop).
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
