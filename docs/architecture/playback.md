---
topic: playback
related-files:
  - components/manager/QueueManager.bs
  - components/video/PlayerHostView.bs
  - components/video/PlayerHostView.xml
  - components/video/VideoPlayerView.bs
  - components/video/VideoPlayerView.xml
  - components/video/OSD.bs
  - components/video/OSD.xml
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
  - source/utils/versionLabels.bs
  - source/utils/versionResume.bs
  - source/utils/versionDisplay.bs
  - source/utils/mediaSources.bs
  - source/utils/episodeQueue.bs
  - source/utils/versionPick.bs
  - components/tasks/QuickPlayTask.bs
  - components/GetShuffleItemsTask.bs
  - source/utils/quickplay.bs
  - source/utils/nodeHelpers.bs
  - source/utils/streamSelection.bs
  - source/utils/liveTv.bs
  - source/utils/voiceTransport.bs
  - source/remotecontrol/remoteDispatch.bs
last-reviewed: 2026-09-21
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
- `insertAfterCurrent(item)` — play `item` next; the Cinema Mode intro queues the item it plays in front of this way (see [below](#items-a-queue-arrives-at))
- `set(items)` — replace the whole queue's contents (a shuffle toggle reorders through it); keeps the version pick
- `clear()`, `deleteAtIndex(i)`

Queue inspection:

- `getCount()`, `getCurrentItem()`, `getItemByIndex(i)`, `getQueue()`
- `getQueueTypes()`, `getQueueUniqueTypes()`, `getItemType(item)` — type derivation

Position:

- `setPosition(i)`, `getPosition()`, `moveBack()`, `moveForward()` — plain moves; audio uses these
- `advanceTo(i)` — a VIDEO queue moving on because playback did (an item ended, or the player's next / previous): the item it reaches starts fresh ([below](#items-a-queue-arrives-at))
- `startCurrentFresh()` — the first item of a queue nobody launched to resume (Play All, shuffle) starts fresh too

Shuffle:

- `toggleShuffle()` → switches shuffle on/off, snapshots original order or restores it
- `resetShuffle()`, `getIsShuffled()`, `getUnshuffledQueue()`
- `shuffleQueueItems()` keeps the currently-playing item at position 0 when enabling shuffle

Resume:

- `setCurrentStartingPoint(positionTicks)` — sets the resume point on the current queue item before playback starts

Version pick:

- `setVersionPreference(pref)`, `getVersionPreference()` — the viewer's explicit version pick for this queue, carried to the items it arrives at ([below](#items-a-queue-arrives-at)); `clear()` forgets it, `set()` keeps it

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
and the two content-load failures never started one. The `error` branch stops `onState` from
reacting with a flag (`m.hasPlaybackFailed`), not with `m.top.unobserveField("state")`: that
call would also remove the observer `PlayerHostView` holds from `mountPlayer()` (see
[the player owns its observers once](#the-player-registers-its-own-observers-once)). So the host
does keep receiving `state` from that branch, which is why the claim covers all four rather than
the stall alone.

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
- **More items in queue** → `advanceTo(position + 1)` + `playCurrentQueueItem()` (destroy + remount for the next item, which starts fresh — [Items a queue arrives at](#items-a-queue-arrives-at))
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

#### The player registers its own observers once

Step 5 only happens if the host HEARS `finished`, and the player can silently take that away.
An observer registration is not private to the component that made it: when `VideoPlayerView`
calls `m.top.unobserveField("state")` it removes `PlayerHostView`'s observer too (reproduced on
device, and recorded for that parent/child configuration only in
[`ObserverRegistry.spec.bs`](../../tests/source/unit/platform/ObserverRegistry.spec.bs)).
That is exactly what #898's "unobserve before observe" re-registration did, and every natural
episode end then left a stopped player mounted on a black screen, with the Next Episode
notification still holding focus.

So every `m.top` observer in `VideoPlayerView` — `state`, `position`, the three track fields and
the two caption fields — is registered once in `init()` and removed only in `onDestroy()`, and
the handlers ignore what they must not act on with three flags instead:

| Flag | Raised | Why a handler ignores the notification |
|---|---|---|
| `m.isContentLoaded` | once, where `onVideoContentLoaded` hands the first stream to the `Video` node | Before a stream exists there is no playback to report. A Back pressed while loading surfaces as `stopped` (measured), and `onState` would otherwise report a stop for a session that never started. |
| `m.isApplyingOwnSelection` | around the player's own writes to `audioIndex`, `mediaSourceId` and `selectedSubtitle` | Those writes apply the loaded selection; treating them as user choices reloads the stream. The caption handlers are deliberately not gated — they must see the same writes. |
| `m.hasPlaybackFailed` | in `onState`'s terminal `error` branch; cleared when `onVideoContentLoaded` hands over a new stream | The error dialog owns what happens next. |

A self-write made on the render thread from inside the component ran its handler before the
next statement in that spec, which is what lets a flag raised around the write suppress it. Both halves are build errors
— `top-observer-outside-init` and `top-unobserve-outside-ondestroy` in
[`field-observer-wiring`](./build-and-tooling.md#convention-plugins) — and
[`playback-advance.spec.js`](../../tests/rta/specs/playback-advance.spec.js) plays an episode to
its end on a device and waits for the next one.

### `reportPlayback` — server-side reporting

Position is reported in **Jellyfin ticks** (1 tick = 100 ns; `int(positionSeconds) * 10000000`). The request is built by `GetApi().BuildPlaystateRequest(state, params)` and dispatched via `SubmitSideEffect()` so it doesn't block playback.

States reported:

- `"start"` — once, when playback first transitions to `playing`
- `"update"` — every 10 seconds via the playback timer, while playing or paused
- `"stop"` — once on `finished` or `stopped`

This is what makes "Continue Watching" rows on the home screen accurate.

Every report names the file that is playing as `MediaSourceId` (Live TV sends its own
`MediaSourceId` / `LiveStreamId` from `transcodeParams`). Servers before Jellyfin 12.0 use it
only for the now-playing display; from 12.0 it decides **which version the position is saved
on**, because alternate versions keep their own progress. So an in-player version switch
must not let the old stream's position land on the new file:

- The value is `m.reportedMediaSourceId`, not `m.top.mediaSourceId` — the switch writes that
  field *before* the old stream's `stop` report fires.
- `start` and `update` reports adopt the most recently loaded source; `stop` and `finished`
  keep naming the file reports have been naming. The old stream's stop can still be pending
  once the new source has loaded, and keying on the report rather than on event order means
  nothing depends on when — or whether — `stopped` arrives.
- `onVideoSourceChange` stops the progress timer at the switch (the `playing` branch
  restarts it), so no `update` can carry the old position under the new id in between.

### Alternate versions and resume — `source/utils/versionResume.bs`

An item with several `MediaSources` (alternate versions) resumes differently by server line:

| | Before 12.0 | 12.0+ |
|---|---|---|
| Position stored | once per item, whichever file played | per version, on the reported `MediaSourceId` |
| Version picked to resume | device-best (`findBestVideoSource`) | the most recently played, unless two sit at about the same place — then device-best among those |
| In-progress signal | the item's own position | the item's own position, **or** an alternate listed first in the primary's `MediaSources` |

Resuming continues the file that holds the position because another version can be offset
from it, and neither the names nor the runtime lengths tell a re-encode from a different cut. Upgrading to a
better file is left to an explicit choice or a fresh start: with nothing in progress, playback
picks device-best as before.

**A version is only ever resumed at its OWN position**, never another's — the two local
releases of one episode run 47 s apart, so borrowing a position moves the viewer elsewhere in
the content. "Most recently played" is never read from a timestamp: 12.0 copies the newest
version's `LastPlayedDate` onto the primary's user data (`VersionResumeData.ApplyTo`), so once
an alternate was played more recently the primary's own play time is unreadable — the local
pair reports identical dates to the 100 ns digit. The server answers it two other ways:

- **The source ORDER, but only from a primary.** `SetAlternateVersionResumeStates` moves the
  most recently played version that *has* a position to the front of a **primary's**
  `MediaSources`, and leaves a directly queried alternate's own source first whatever played
  last. So another version in front proves the item is a primary and that version was played
  last; the item's own source in front proves nothing, and the DTO does not say which kind of
  item it is (`PrimaryVersionId` is server-side only, through 12.1).
- **The resume query**, `GET /UserItems/Resume?parentId=<the item's parent>`, which returns the
  version that owns the resume point. `chooseResumeSource` asks for it (`needsMostRecent`) only
  in the ambiguous case above with two versions in progress; the shells answer with
  `versionResume.mostRecentIdFrom()`, and a reply that cannot say falls back to the order.

This matters in practice because on 12.0 **Continue Watching lists the version played last**, so
an alternate's id is what gets queued, and reading that alternate's own source order as "played last" once
resumed the wrong file.

Two versions within `versionResume.NEAR_LEVEL_MARGIN_TICKS` (30 s) count as being at the same
place, so quality decides between them instead of which played last. Because a version resumes at its own
position, that margin *is* the worst-case misplacement the viewer can feel; it absorbs the
constant offset between two releases of one cut (4 s on the local pair), the 10 s
progress-report cadence when a session ends without a stop report, and the switch latency of a
carry. Device knowledge is deliberately absent from `versionResume` (it must stay pure), so a
tie comes back as ids and `findBestVideoSourceAmongIds()` settles it over just those versions —
scoring the whole list would let a 4K version nobody started win a tie between two in progress.

#### What a TILE shows — `versionDisplay.correctDisplayProgress()`

Everything above decides which version **plays**. A poster or episode row is a separate
problem, because a list response carries each item's OWN `UserData` — which from 12.0 is the
position of the item's own file, not of the version that would start. Measured on 12.0.0
(2026-09-19, `Version Episodes (2026)`, 360 s versions): with only the alternate in progress at
120 s the row reports `PlayedPercentage` 0, so the tile shows **no bar at all**; with the item's
own version at 60 s and the alternate at 240 s and played last, the row reports 16.7% while Play
resumes the alternate at 67%. Servers before 12.0 store one position per item whichever file played
(verified the same day on 10.7.7, 10.9.11 and 10.11.11 with a grouped two-version movie), so
neither case exists there and the correction does not run.

The loaders fix it on the RAW reply, before the transform, so the transformer, the item node and
`JRPoster`'s bar need no knowledge of versions. `isResumable` is *derived* from the corrected
values in the transformer, which is the other reason to correct the reply rather than the node —
patching after the transform would mean re-deriving that invariant in a second place.

- **`MediaSourceCount`** is requested wherever video tiles are built. It is the free signal that
  an item has alternates — the server emits it only when there are several (verified 2026-09-19
  on every server from 10.7.7 to 12.0.0), so its cost follows the multi-version items rather
  than the row: +21 bytes for one, +85 across a 100-item page. It gates everything below, and
  drives the alternate-versions badge on the tile.
- **`GET /UserItems/Resume`, no `Fields`** — every version the viewer is part-way through, in
  the server's `DatePlayed`-descending order. That order is the only signal for "played last";
  it is hard-coded in `ItemsController.GetResumeItems` and the endpoint accepts no `sortBy`, so
  a client cannot pin it.
- **`GET /Items?Ids=…&Fields=MediaSources`** for the page's grouped tiles only — each tile's
  sibling version ids. Needed because the DTO exposes no primary pointer and name/year is not
  an identity.

**Why two requests rather than one.** Asking the *resume list* for `Fields=MediaSources` answers
it in one round trip, and costs the wrong thing. Measured against a local 12.0 server
(2026-09-20), per resume row: **1.1 KB plain against 7.3 KB with `MediaSources`** — and the gap
widens with the list, reaching **62 KB against 567 KB at 61 in-progress items**. That scales with
the viewer's *backlog*, which nothing bounds. By-id scales with the *grouped items on the page*,
which `multiVersionIds()` has already counted. End to end at 61 in-progress items and 4 grouped
tiles: **567 KB / 68 ms for one request against 84 KB / 42 ms for two** — 6.8× fewer bytes and
faster despite the extra round trip, because payload dominates.

The resume list is fetched **first**: an empty one means nothing is in progress anywhere, so the
second request is skipped. The resulting cost ladder is 0 requests on a pre-12 server or a page
with nothing grouped, 1 when grouped items exist but nothing is in progress, and 2 otherwise.

**Scoping differs by caller, deliberately.** The grid scopes the resume list to its container
(also correct through a collection — verified 2026-09-20 that a resume query scoped to a `BoxSet`
returns its members). Extras rows do not: More Like This and a person's videos legitimately cross
libraries, so a `parentId` there would drop the correction for exactly those rows.

**Bounded divergence, accepted deliberately.** The version shown is always the one played
*last*, while `chooseResumeSource()` prefers device-best inside the 30 s near-level margin. So
where the two disagree the versions are at most 30 s apart and the bar is at most that much of
the runtime out — under half a percent on a feature, about 8% on a six-minute episode. Closing
it would need every version's streams for every item on the page, not just the grouped ones.

**`versionResume.chooseResumeSource()` is the single answer**, shared by every entry point, so
the app cannot name one version and play another:

- **`LoadVideoContentTask`** makes the choice for everything that did not make it on screen —
  quick play, casts, a queued item — because it is the only one that can read each version's
  own position. An item that starts fresh is the exception: it resumes nothing, so position has
  no say in its version ([below](#items-a-queue-arrives-at)). `quickplay.video` runs on the render thread with no fetching, so on a
  per-version server it stands down by **clearing** `mediaSourceId` (the transformer already sets
  it with `MediaSources[0].Id`, which would otherwise read as an explicit pick) and leaves
  `selectedAudioStreamIndex` at 0 so the audio track is picked for whichever version wins. The
  reads ride `apiPipeline`, so N versions cost roughly one round trip, and nothing is fetched
  unless something is already in progress. A **mid-playback reload** (subtitle or audio change,
  retry) re-runs the same task, so `VideoPlayerView.keepLoadedVersionOnReload()` passes the
  loaded version as that run's `mediaSourceId` — without it the reload chooses again from the
  server's lagging positions and can switch file and position under the viewer.
- **The start position says what kind it is.** The loader replaces a *resume* start with the
  chosen version's own position, and never an *exact* one — a chapter, Play from the start, a
  position the player saved before a reload. Callers write the pair through
  `nodeHelpers.setResumeStart()` / `setExactStart()` (or `setCurrentStartingPoint`'s `isExact`),
  never `startingPoint` alone; `startingPointIsExact` is read only on the per-version path.
- **`ItemDetails`** decides for itself and passes an explicit id, which the loader honors
  untouched. Its first guess comes from the source order alone, then
  `syncVersionSelectionToChoice()` re-runs the choice as each position lands and moves the
  selection — unless the viewer has picked a version, which sets `m.versionUserOverridden` and
  freezes it. The Resume button follows the selected version: its own position (one
  `GET /UserItems/{id}/UserData` for a version other than the item, with the Resume slot's
  loading button meanwhile) or, for a version the user picked that has none, the in-progress
  position carried over.
- **Cinema Mode prerolls** are suppressed when a resume is coming, which `startingPoint` alone
  can no longer say (the item's own version may sit at 0 while an alternate is partway
  through). `quickplay` passes `hasVersionInProgress` on the queue item, read from the source
  order for free, because that decision is made before the version is chosen.
  jellyfin-web draws the same line — `getIntros()` bails on `options.startPositionTicks`.

The carry is guarded by `versionResume.wouldMarkPlayed()`, which follows the server's
`UserDataManager.UpdatePlayState` played branches — past `MaxResumePct`, inside the last
second, onto a version shorter than `MinResumeDurationSeconds`, or onto a version with no
runtime. Each sets `Played`, and the server then propagates that to **every** version and
clears **every** position, so a carry it would count as finished erases the place being
carried from rather than resuming it. The runtime it checks is the one the server applies:
the version's own `RunTimeTicks`, never the item's (the Resume progress bar may fall back to
the item's; the guard may not).

It is deliberately stricter than the server in one place. The server checks `MinResumePct`
first and merely ignores a report below it, never reaching the `MinResumeDuration` branch;
the guard skips that check, so it refuses even a small carry onto a version shorter than
`MinResumeDurationSeconds`. Playing such a version past `MinResumePct` marks it played
either way, so the stricter answer costs the viewer a few seconds at most. The thresholds
are read once per server into `JellyfinServer.resumePolicy` (both or neither), and an
unreadable policy answers "played", so nothing is carried.

#### Switching version mid-playback

`VideoPlayerView.onVideoSourceChange` maps the position into the new version's timeline with
`versionResume.switchTicksFor()` rather than reusing it raw: the exact time when the new
version reaches it, otherwise the same percentage. Two releases of one cut are offset by a
*constant*, not stretched — the local pair runs 47 s apart yet matches at 1080p = 720p + 4 s at
start, middle and end, so the extra footage is at the edges. Mapping by time is 4 s out
everywhere; by percentage it would be 19 s out at 15:00 and 35 s at 25:00. Percentage only wins
once the time does not exist in the new file at all, where it lands near the end instead of
past it.

This path is deliberately **not** guarded by `wouldMarkPlayed()`. Past the resume ceiling but
still inside the new file, the viewer continues at the exact time and the item counts as
watched — what finishing it would have done anyway. The details screen keeps the stricter rule
because refusing there costs nothing: it can simply offer Play instead of Resume, an out the
player does not have.

⚠️ **Tick arithmetic must stay integer.** `abs()` and `getEffectiveDuration()` return floats,
and a 24-bit mantissa cannot hold a tick count (~`1e10`): an early version of the near-level
comparison used `abs()` and a delta of 300000001 ticks silently rounded to the 30 s margin,
tying a version that was past it. Negate by hand, and `int()` seconds before scaling by
`10000000&`.

Every choice above lives in `source/utils/versionResume.bs` as pure functions over plain
values; `ItemDetails` holds only the shell that fetches what `resumeStateFor()` asks for.
That split is what makes the rules testable — a component spec has no way to stub the two
requests, so a rule expressed inside `ItemDetails` could only ever be checked by hand.

### Items a queue arrives at

An item the queue *arrives at* — the next one when an item ends, or the player's next / previous
— is one the viewer did not choose to resume, so it **starts from the beginning**. A position
saved on it belongs to an earlier session, and the viewer is watching in order; Resume is the
Resume button's job. `jellyfin-web`'s `nextTrack` also plays the next item with no start
position. Measured on 12.0 before this rule: auto-advance and Play All resumed a multi-version
episode at its saved 200 s while a single-version one started at 0, because only a multi-version
item reaches the version chooser, which reads positions — so the old behavior depended on how many
files an item happened to have.

The rule lives in the queue, not in the code that builds it, so no queue — current or future,
shuffled or not — can leave it out:

- **`QueueManager.advanceTo()`** is how both video advance paths move
  (`PlayerHostView.onPlayerStateChange` at an item's end, `VideoPlayerView.switchToQueueItem` for
  next / previous). It marks the item it reaches through `nodeHelpers.startFresh()`: an exact
  start at 0, so the loader never swaps in a version's position; `startsFresh`, so the loader picks
  its version by the viewer's pick instead; and no version in progress, since none resumes.
  **Not an arrival:** the item behind a Cinema Mode intro — the loader tags the copy it queues
  behind the intro `followsIntro`, and `advanceTo()` consumes the tag, so the item the viewer
  launched keeps its start — and Live TV, which has no position. Audio moves with the plain
  position methods and is untouched.
- **The intro's copy goes directly after the slot the intro plays in** (`insertAfterCurrent`),
  not at the end of the queue. Appending it played everything else first: measured 2026-09-19 on
  10.11, a Play All queue became `[e1, e2, e3, e4, e1]` and the intro was followed by `e2`, with
  `e1` last. With one item queued — every other intro path — the end IS the next slot, which is
  why it went unnoticed.
- **The first item** is each builder's call, because it follows from the button. Play All and
  shuffle start it fresh (`QuickPlayTask`'s `startsFresh` output, `QueueManager.startCurrentFresh()`
  after any shuffle); quick play of a series or season and the Resume button pick it to resume or
  continue, and keep the loader's resume path.

**The version** of an item that starts fresh is the viewer's explicit pick when the item has one
with the same video (resolution, codec, HDR range — `versionPick`, over
`versionLabels.videoFields()`), else the best for the device. Only an explicit pick carries — the
details screen's Video menu (`m.versionUserOverridden`) or a switch in the player
(`VideoPlayerView.onVideoSourceChange`) — and it lives on the queue
(`QueueManager.setVersionPreference`), so a new queue starts without one. Never matched on the
name: jellyfin-web 12.0 matches `Name` exactly, which only lines up when every item's versions
share one naming scheme, and would hold a viewer on 1080p when the next item has 4K.

#### One copy per episode — `source/utils/episodeQueue.bs`

Before 12.0 the server lists every file of an episode as its own episode — same series, season
and episode number, one `MediaSource` each (queried 2026-09-19 on 10.7.7, 10.8.13, 10.9.11,
10.10.7 and 10.11.11) — so a plain queue plays both copies back to back, and the next-episodes
list can hold a copy of the CURRENT episode, replaying it. Every queue the app builds from a list
of episodes collapses them: the next episodes (`addNextEpisodesToQueue`, which also drops the
current episode's copies), and one pass at the end of `QuickPlayTask.executeQuickPlay` and of
`GetShuffleItemsTask`. That covers Play All, quick play and shuffle of a series, season, person
or folder. **Playlists and collections are left alone** — the viewer put those entries there.

- Copies are grouped by `episodeQueue.episodeKey()`: series + season + episode number, for
  episodes only. Anything else — a movie, a track (which has disc and track numbers), an
  unnumbered episode, a multi-episode file — is never grouped.
- One copy is kept by the same pick → match → device rule as a version. Their `MediaSources` are
  fetched only when copies exist, `COPY_IDS_PER_REQUEST` ids per request (each id costs 35 bytes
  of URL), so a 12.0 queue costs nothing and a large series on an older server never builds an over-long
  request. When a copy's sources cannot be read, the server's first copy is kept.
- **Watched state counts per episode, not per copy.** `QuickPlayTask.doSeason` finds the first
  episode no copy of which is watched (`isGroupPlayed`), and resumes the copy the viewer is
  partway through (`inProgressCopy`) at that copy's own position — so a copy not yet watched of a
  watched episode no longer starts the season over. A first item resumed at its own position is
  kept exactly (`collapseQueue`'s `keepFirst`), with its episode's other copies dropped.

### Version labels — `source/utils/versionLabels.bs`

Since 12.0 resumes the exact file and never upgrades on its own, the version label is what
tells a viewer which file they are about to play. One pure function,
`versionLabels.labelsFor()`, names a version everywhere, judging each label against the other
versions, and returns two forms because the places that name a version do different jobs:

| Form | Used where | Example (two releases of one episode) |
|---|---|---|
| `title`, full | lists a viewer **chooses** from: the `ItemDetails` Video menu, the in-player Select Video Source dialog | `720p · web.h264-tbs` |
| `triggerTitle`, short | places that only say **which is current**: the collapsed Video trigger, the player (`triggerLabelFor()` → `OSD.videoSourceTag`) | `720p` |

- **Stream info first, and only what differs** — resolution, video codec, HDR range. A bitrate
  ladder with identical video gets none.
- **The name without the words every version shares**, at either end (case-insensitive;
  space, `.`, `-`, `_` separate words), **and without the words at either end that repeat a
  label the row already shows** — so Jellyfin's `Movie - 1080p` naming reads `1080p`, not
  `1080p · 1080p`. Both are plain comparisons: names are user-controlled, so no quality is
  read out of them (`2160p` stays beside `4K`).
- **The short form is the stream info alone when that identifies the version**, and the full
  label otherwise. A name can be the only thing that matters (an edition) or a whole release
  filename — Jellyfin returns the full filename when a version's file shares no naming pattern
  with the others, and `MediaSourceInfo` has no edition field — so the name is kept only where
  the viewer chooses. The cost accepted: two editions that also differ in quality are named by
  quality alone once picked.
- **The in-progress version is marked** (`· In progress`) in the `ItemDetails` menu only, on
  12.0+: the one `versionResume.inProgressSourceIndex()` names, which is the version the
  screen selects and Resume continues, so the mark and Resume never disagree.
- **The player shows the short form as its own segment on the line below the title**, right
  after what identifies the item (`S4E6 - Customer Service • 720p`, `2010 • 1080p`); a live TV
  channel shows none. The title line stays the title: an episode's is the series name, and a
  version appended to a movie's name reads as part of it (`AV-1 90mbps`).

A single version keeps its plain stream summary, and the player shows no tag for it.

## OSD — `components/video/OSD.bs/.xml`

The on-screen display: title, current time, position bar, end-time prediction, play/pause icon. Activates on key press, auto-hides after 5 seconds of inactivity (`inactiveTimeout="5"` in the XML).

The OSD is the entry point for advanced controls — it has menu icons for audio tracks, subtitles, video source, and playback info that fire the corresponding `select*Pressed` events on the player when activated.

### Live TV / DVR-recording mode

The OSD adapts when the current item is a live TV channel or a DVR recording (vs. on-demand video). The hybrid behind-live math lives in `source/utils/liveTv.bs` (extracted as testable helpers). Notable adaptations:

- **`goToLive` button** — sits in the `OSD`'s left button menu for the whole of a live TV item, and is **grayed out** while the user is at the live edge rather than removed. Pressing it seeks to live.

  The rule is **membership is per-item, enablement is per-moment**: `setButtonStates()` decides once whether the button is in the row (in for a `TvChannel`, dropped for anything else) and `updateLiveTvDisplay()` only toggles `isEnabled` from there. It matches what the rest of that row already does — `itemBack` and `itemNext` are disabled in place when they would be a no-op — and it is why the OSD row never reshuffles mid-playback.

  It previously attached and detached from the layout as the user crossed the live-edge threshold, on the reasoning that a hidden child still reserves its `LayoutGroup` slot. That is true of `visible` but not of `isEnabled`, which only recolors. The generalization cost a defect: `insertChild(_, 3)` shifted every later child right while `buttonFocused` — an index — was never repaired, so it came to name a different node than the one holding focus and the next left/right press stepped from the wrong origin. Reachable by moving focus onto the audio or subtitle button and then pausing, since pause flips the state immediately and `inactiveCheck` declines to auto-hide while paused. Confirmed on device before the fix; gated by `tests/source/unit/components/video/OSDGoToLive.spec.bs`.
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

Every fact about the file being played (runtime, bitrate, container, streams) comes from `mediaSourceForId(mediaSources, mediaSourceId)`, never `mediaSources[0]`. The first entry is only the server's default: a version picked in the Video dropdown sits elsewhere, and from Jellyfin 12.0 the in-progress version moves to the front. The `/PlaybackInfo` response is the exception, because the request names the version and the server returns only that one.

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

**Live TV** follows the server's answer, with two live-only rules:

- **Direct play of a live channel is always backed by a transcode retry** (`applyLiveDirectPlayFallback`). The server cannot probe a live stream ahead of time, so its "yes" is a guess; a failure before the first frame reloads with `EnableDirectPlay=false`.
- **From Jellyfin 12.0, an HLS channel the server declines to direct play is played from its own URL anyway** (`getUpstreamHlsBlocker` in `source/utils/liveTv.bs`). 12.0 (jellyfin/jellyfin#17768) withdrew direct play for every `m3u` tuner channel whose URL is an HLS manifest, because the server had been relaying the upstream master playlist through its own `/Videos/{id}/` URL, where the playlist's relative variant URIs 404. JellyRock never used that relay: it plays the absolute upstream `Path`, where relative URIs resolve against the origin. The server's replacement, remuxing the stream itself, also loses audio that arrives as a separate HLS rendition (`#EXT-X-MEDIA TYPE=AUDIO`) and starts far slower.

  The server's "no" does not say whether 12.0 is its only reason, so the override rebuilds the answer the server gave before 12.0 from what the client can see. `getUpstreamHlsBlocker` returns the first reason that keeps the channel on the server's stream, as an `UpstreamHlsBlocker` value the loader logs, or `NONE`:

  - **This load:** not a live channel, or the retry that forces a transcode.
  - **Not the 12.0 case:** the server did not decline, the source is not an absolute `http(s)` HLS URL, or it is DASH.
  - **Through Jellyfin:** the server's own host and port, the `/LiveTv/LiveStreamFiles/` relay, or `localhost` / `127.0.0.1`.
  - **The server's older reasons, which 10.11 applied too:** the tuner's "Auto-loop live streams" (`RequiresLooping`), the user's "Force transcoding of remote media sources such as Live TV" on a remote source (`IsRemote`), and the server's internet streaming bitrate limit (`ContainerBitrateExceedsLimit` among the `TranscodingUrl`'s transcode reasons). The other transcode reasons are ignored: for a manifest, 12.x no longer judges direct play at all, and the codec reasons it reports say whether its own transcode can copy the stream, not whether the device can play it.

  The tuner's "Simultaneous stream limit" is the one older reason the client cannot see. The server still enforces it when the live stream opens, and JellyRock holds that stream open until its stop report. The request is typed (`UpstreamHlsRequest`), so a missing or misspelled field is a build error rather than a silently disabled check.

  Past those, the override is gated by a **device preflight**: the loader GETs the master playlist itself (`upstreamPlaylistAnswers`, `timeouts.LIVE_UPSTREAM_PREFLIGHT_MS`) and plays it directly only on HTTP 200 with an `#EXTM3U` body. A Roku handed a URL it cannot reach does not error, it buffers indefinitely (measured on an Ultra 2026-09-21 for a host it has no route to and for a hostname it cannot resolve), so without the preflight the retry above would never run; with it, anything the device cannot load stays on the server's stream.

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
