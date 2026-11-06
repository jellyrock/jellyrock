---
topic: playback
related-files:
  - components/manager/QueueManager.bs
  - source/utils/playKind.bs
  - components/video/PlayerHostView.bs
  - components/video/PlayerHostView.xml
  - components/video/VideoPlayerView.bs
  - components/video/VideoPlayerView.xml
  - components/video/OSD.bs
  - components/video/OSD.xml
  - components/GetPlaybackInfoTask.bs
  - source/utils/trackPickerOptions.bs
  - source/utils/playbackSettingsMenu.bs
  - source/utils/playbackCaps.bs
  - source/utils/queueRepeat.bs
  - source/utils/playbackInfo.bs
  - source/utils/deviceCapabilities.bs
  - source/utils/playbackErrorInfo.bs
  - source/utils/playbackReport.bs
  - source/utils/audioSeek.bs
  - source/utils/transcodeCause.bs
  - components/video/CaptionRenderer.bs
  - components/video/LoadCaptionTask.bs
  - source/utils/webvtt.bs
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
  - source/utils/quickplayOutcome.bs
  - source/utils/quickplay.bs
  - source/utils/quickplayLibrary.bs
  - source/utils/nodeHelpers.bs
  - source/utils/streamSelection.bs
  - source/utils/probedStreams.bs
  - source/utils/streamOrigin.bs
  - source/utils/stillWatching.bs
  - source/utils/liveTv.bs
  - source/utils/upstreamManifest.bs
  - source/utils/bufferStall.bs
  - source/enums/BufferCheckAction.bs
  - source/utils/playbackEnd.bs
  - source/utils/playbackRetry.bs
  - source/utils/hlsMaster.bs
  - source/enums/PlaybackEndReport.bs
  - source/utils/liveStreamHandoff.bs
  - source/enums/LiveStreamStage.bs
  - source/enums/AbandonedLoadAction.bs
  - source/utils/voiceTransport.bs
  - source/remotecontrol/remoteDispatch.bs
  - components/syncplay/SyncPlayManager.bs
  - components/syncplay/SyncPlayManager.xml
  - source/syncplay/syncPlayPlayback.bs
  - source/syncplay/syncPlayQueue.bs
  - source/syncplay/syncPlayHooks.bs
  - source/syncplay/syncPlayState.bs
last-reviewed: 2026-11-05
---

# Video and audio playback

How JellyRock plays things: the queue that decides what plays, the video player and the routed screen that hosts it, the audio engine and its screen, how a stream is chosen, and what is reported back to Jellyfin.

## Component map

| Component | Where | Role |
| --- | --- | --- |
| `QueueManager` | `components/manager/`, at `m.global.queueManager` | What plays, in what order; starts playback |
| `PlayerHostView` | `components/video/` | The routed screen for video (`/details/:type/:id/play`); owns the player and the playback-time dialogs |
| `VideoPlayerView` | `components/video/` | The video player; extends Roku's `Video` node |
| `OSD` | `components/video/` | Title, time, progress and the control buttons |
| `TrickplayCarousel`, `TrickplayTileLoader` | `components/video/` | Scrub thumbnails, and the Task that fetches their tiles |
| `VideoNotification` | `components/video/` | The Next Episode and media-segment pop-ups |
| `CaptionRenderer`, `LoadCaptionTask` | `components/video/` | App-drawn subtitles: the renderer, and the Task that fetches and parses a track |
| `RefreshLiveTvMetadataTask` | `components/video/` | Refreshes a channel's program data when a program ends |
| `LoadVideoContentTask` | `components/ItemGrid/` | Asks the server how to play the item and builds the stream URL |
| `GetPlaybackInfoTask` | `components/` | Fetches this device's live session for the playback-info report |
| `GetShuffleItemsTask` | `components/` | Fetches the items for a shuffle |
| `SyncPlayManager`, `TimeSyncTask` | `components/syncplay/`, at `m.global.syncPlayManager` | The SyncPlay coordinator and its clock-offset Task; the player follows it while in a group |
| `AudioPlayer` | `components/mediaPlayers/`, at `m.global.audioPlayer` | The audio engine; extends `Video` and lives for the whole app |
| `AudioPlayerView` | `components/music/` | The routed "now playing" screen (`/audio`); extends `JRScreen` |
| `LoadScreenSaverTimeoutTask` | `components/music/` | Reads the device's screensaver timeout (`roAppManager.GetScreensaverTimeout()`) |

There is one video player, `VideoPlayerView`. The next-episode lookup is not a Task: `VideoPlayerView.fetchNextEpisode()` is a render-thread `fetchAsync()` promise.

## `QueueManager`

`QueueManager.bs` lives at `m.global.queueManager`, created in `setGlobalNodes()`, and every method is called through `callFunc`. It holds the queue and starts playback; it never builds a player or navigates.

### Starting playback

The launchers build a queue and start it: `launchItem`, `launchQuickPlayAction`, `launchShuffle` and `launchPhotoAlbum`. Each opens a playback-start wait first, through `beginPlaybackStart()`. The player that mounts takes that wait (`takePlaybackStart()`) and ends it when its stream loads or fails (the photo viewer, `PhotoDetails`, when its first photo shows), and `failPendingPlaybackStart()` fails it when the start cannot reach a player. Every start gets its own Promise, so one start can never end another's spinner ([ADR 0046](../adr/0046-playback-start-wait-is-a-promise.md); the wait kinds are in [`navigation.md`](navigation.md#what-kind-of-wait-a-spinner-is)).

A launcher whose Task finds nothing to play ends its start and shows a toast (`showNothingToPlay`): "couldn't load" when a read failed, "nothing here" when the server answered empty, and "can't" when nothing builds that launch, such as a Shuffle another device sends for a movie. The text is worded for what the build was (`source/utils/quickplayOutcome.bs`). Each Task reads through an `apiRead.Reader` (`source/api/apiRead.bs`), which records a read that did not answer, so a failure never looks like an empty item. A failed read also never falls back to a guess: a series whose resume or Next Up read fails stops there, rather than start some other episode.

`playQueue()` then looks up the current item's type in `playKind` ([`source/utils/playKind.bs`](../../source/utils/playKind.bs), the one table of how each type plays) and sets `m.global.playbackLaunchRequest = { type, id[, media: "audio"] }`. `JRScene.onPlaybackLaunchRequested` turns that into a route: audio goes to `/audio`, every video type to `/details/<type>/<id>/play`. The queue is the source of truth for what plays; the route's `:type` and `:id` only give the launch a deep-link identity. The whole path from a press to a mounted player is in [`user-journey.md`](user-journey.md#starting-playback).

### Methods

| Group | Methods |
| --- | --- |
| Change the queue | `push(item)`, `insertAfterCurrent(item)` (play next; the Cinema Mode intro queues its item this way), `set(items)` (replace the contents and keep the version pick), `clear()` |
| Read the queue | `getCount()`, `getCurrentItem()`, `getItemByIndex(i)`, `getQueue()`, `getQueueTypes()`, `getQueueUniqueTypes()`, `getItemType(item)` |
| Position | `setPosition(i)`, `getPosition()`, `moveBack()`, `moveForward()` (plain moves, used by audio); `advanceTo(i)` (a video queue moving on, so the item starts fresh); `startCurrentFresh()` |
| Shuffle | `toggleShuffle()`, `getIsShuffled()`, `getUnshuffledQueue()` |
| Resume | `setCurrentStartingPoint(positionTicks, isExact = false)` |
| Version pick | `setVersionPreference(pref)`, `getVersionPreference()`: the viewer's explicit version pick, carried to later items; `clear()` forgets it |
| Repeat | `setRepeatMode(mode, by)`, `getRepeatMode()`, `releaseRepeatMode(by)`: one of the server's `RepeatMode` values (`queueRepeat.bs`), with who set it, the viewer in the gear (`BY_VIEWER`) or a followed SyncPlay group (`BY_GROUP`); `releaseRepeatMode` turns the mode off only while its setter still holds it; `set()` keeps both and `clear()` forgets both |
| Cinema Mode | `isPrerollActive()`, `setPrerollStatus(status)` |
| Start | `launchItem`, `launchQuickPlayAction`, `launchShuffle`, `launchPhotoAlbum`, `beginPlaybackStart`, `takePlaybackStart`, `failPendingPlaybackStart`, `playQueue` |

`clear()` also resets the position to 0, the playing flag and the Cinema Mode flag, and `set()` goes through `clear()`.

Turning shuffle on (`shuffleQueueItems()`) keeps the playing item first while `m.isPlaying` is set, and saves the original order for turning it off. `resetShuffle()` runs when an item, a quick-play action or a shuffle load starts a new queue.

## `PlayerHostView`

`VideoPlayerView` extends Roku's `Video` node, so it cannot be a routed view itself. `PlayerHostView` is the routed `JRScreen` for `/details/:type/:id/play`, and it owns the player as a runtime child (`m.top.appendChild(m.view)`). It has three jobs.

1. **Mount the player.** `onScreenShown()` runs `mountPlayer()`, which builds the `VideoPlayerView`, observes its state and press fields, sets the backdrop and appends it. The queue is filled before navigation, so the host reads `getCurrentItem()`.
2. **Move through the queue inside the route.** The next item, the player's next and previous, a channel switch and a Live TV restart destroy and remount the player child; nothing navigates. The next item goes through `playCurrentQueueItem()`, next, previous and a channel switch through `skipToCurrentQueueItem()` (which also restarts the still-watching count), and a Live TV restart through `restartLiveChannel()`, the only remount that keeps the restart count.
3. **Show the playback-time dialogs.** The track buttons on the OSD and the "i" button set the player's `selectAudioPressed`, `selectSubtitlePressed`, `selectVideoSourcePressed` and `selectPlaybackInfoPressed`, and the host shows a dialog from the standard family ([`dialogs.md`](dialogs.md)). Track choices made before playback come from `ItemDetails`' `TrackDropdown` cluster ([`user-journey.md`](user-journey.md)). Both write the same player fields.

### Track pickers

| Step | What happens |
| --- | --- |
| The viewer presses an OSD track button | The player sets, for example, `selectAudioPressed` |
| The host's handler runs (`onSelectAudioPressed`) | A pure builder in `source/utils/trackPickerOptions.bs` returns `{ labels, values, defaultIndex, selectedIndex }` |
| `showTrackPicker()` | Opens `showListDialog` with those labels and indexes, and keeps the options in `m.trackPickerOptions` |
| The viewer picks | The picker's own handler (`onAudioTrackSelected`) maps the index back through `resolvePickedValue()` and writes the player field |

A list dialog answers with an index into the labels it was given, so each picker keeps the `{ labels, values }` pair it built until its result lands. Each picker has its own result handler. The builders are pure, so the mapping from Jellyfin streams to what the viewer sees, and back, is unit-tested off the device.

The handlers write the player's `audioIndex`, `selectedSubtitle` and `mediaSourceId` only when the value changes: `mediaSourceId` reloads the stream, and `SelectedSubtitle` is `alwaysNotify`, so writing the same value still fires its observers.

The report has its own slot (`m.reportDialog`), apart from the pickers' (`m.trackPickerDialog`): after an "i" press the fetch is in flight before any dialog exists, and a picker can open in that window. With one shared slot, the fetch's answer took the picker for the report.

### Leaving a mount

`prepareToLeaveMount()` runs before the host leaves the current player, from `onPlayerStateChange()` and from `onLiveStreamStalled()`. It returns early, leaving everything in place, in two cases:

- the player is retrying (`isRetrying`, the Dolby Vision fallback, whose `stop` can surface as `finished`);
- an error dialog owns the exit (`errorDialogOwnsExit`, [below](#an-error-dialog-owns-the-exit)).

Otherwise it clears every dialog, in this order:

| Order | Dialog | Owner | How it is cleared |
| --- | --- | --- | --- |
| 1 | The playback error alert | `VideoPlayerView` | `m.view.callFunc("abandonErrorDialog")` |
| 2 | Track pickers, the playback-info report, the still-watching prompt | `PlayerHostView` | `abandonPlaybackDialogs()` |
| 3 | Anything a main-thread flow put over the player (a cast notice, the deep-link server-switch prompt) | Someone else | `cancelOpenDialog()` |

Ours are abandoned: no result is delivered, because the scope that would receive it is going away. A foreign dialog is canceled, because its owner is alive and holds state until it answers. Leaving it up is not an option: playback teardown navigates, the next screen takes focus, and the dialog stays on screen but deaf.

**The error alert must be abandoned before anything is canceled.** It is an ordinary overlay, so `cancelOpenDialog()` would reach it, and a cancel looks exactly like the viewer pressing **Back**. The alert's result handler treats that as "leave the player" and calls `exitPlayback()`, which would navigate from inside a teardown that is itself about to advance or exit. The rule is general, and [`dialogs.md`](dialogs.md#presenting-and-tearing-down) states it; this is its worked example. `onDestroy()` abandons the host's own dialogs, and the player's `onDestroy()` abandons its alert.

### An error dialog owns the exit

When `VideoPlayerView` shows a playback error (`showPlaybackErrorDialog`), it sets `errorDialogOwnsExit` with the dialog and clears it with the dialog. While it is set, `prepareToLeaveMount()` returns early, so a `finished` the app caused is not taken as playback ending. The stall paths (`bufferCheck`, `showLiveStreamStalledError`) show the alert and then stop the stream. That stop usually surfaces as `stopped`, which the host ignores, but it can surface as `finished`: without the claim, the host would abandon the unread alert and play the next episode.

The dialog then drives the exit itself, through `exitFromPlaybackError()` and `exitPlayback()`, the one path both error tiers share. Acknowledging an error leaves the player rather than advancing the queue: auto-advancing past a failure skips content the viewer asked for, and with the server down it walks the rest of a season one unread error at a time. The claim cannot strand the dialog, because anything that navigates without it reaches `VideoPlayerView.onDestroy()`, which abandons it. The claim is set inside `showPlaybackErrorDialog` itself, so no caller can order it wrong. What a reproduction would still have to show is in tech-debt [`playback-error-dialog-dismissed-before-it-is-read`](tech-debt.md#playback-error-dialog-dismissed-before-it-is-read).

`onState`'s `error` branch stops reacting through a flag (`m.hasPlaybackFailed`), not `m.top.unobserveField("state")`, which would also remove the host's observer ([below](#the-player-registers-its-own-observers-once)).

### A superseded error parks the player

`presentOverlayDialog` cancels the dialog on screen when another arrives, from a caller that cannot know to abandon someone else's dialog first. So both error tiers check provenance (`result.externallyCancelled` on the alert, the `externallyCancelled` field on the `OverviewDialog` report) and do not leave the route on a close the viewer did not make ([`dialogs.md`](dialogs.md#presenting-and-tearing-down)).

**A `Video` node with no stream is not a blank screen.** It keeps drawing Roku's own buffering ring (its internal `retrievingBar` and `bufferingBar` `ProgressBar` nodes, which `init()` recolors), reading `0%` forever. So the handlers call `parkPlayerAfterSupersede`: clear the error state, hide the node, and mark the player parked. Hiding it removes the ring and shows the backdrop the host set for the item. The parked flag matters too: `stateAllowsOSD()` admits `stopped`, so without it **Up** would open an OSD inside a hidden parent, which takes the focus **Back** needs. `onState`'s `playing` branch undoes both, because a voice or remote `play` can restart a stopped node without a reload.

The viewer does not get the error text back: it went with the dialog, and showing it again over the dialog that took the screen would restart the fight. The player does not own that dialog and cannot observe its close.

### The playback-info report

The "i" button shows a report of what is playing and why.

| Step | Where | Why there |
| --- | --- | --- |
| Fetch the live session | `GetPlaybackInfoTask` | The only I/O |
| Model the report | [`playbackReport.bs`](../../source/utils/playbackReport.bs) | Pure, so it is tested off the device, and cheap enough on the render thread to rebuild on each press |
| Attribute a reason to a setting | [`transcodeCause.bs`](../../source/utils/transcodeCause.bs) | Pure, and the only part that can be wrong rather than missing |
| Present it | `showReportDialog` and `OverviewDialog` | The one read-only overlay of the family |

The report is built on each press, so it describes what is playing now: a Dolby Vision fallback that switches from a transcode to direct play changes the next report.

- **A row shows `source → target` only where the server named the target** (decision [`playback-report-target-evidence-tiers`](../decisions.md#decision-id-playback-report-target-evidence-tiers)). `TranscodingInfo` from the live session is the actual output. A few `TranscodingUrl` parameters (`&AudioBitrate`, `&AudioSampleRate`, `&SubtitleMethod`) are exact. The per-codec stream options are constraints (`<codec>-rangetype` can be a list, `<codec>-videobitdepth` is a ceiling), read only where they reduce to one answer. Anything else shows the source alone.
- **The Audio section never goes missing for a source that lists audio.** It describes the track the viewer chose, found by its index. A source can list its audio with no index (a Live TV channel's `m3u` tuner sends `-1` for every stream); with one audio stream, that stream is the one playing, and the section describes it. With several, the section says the playing track is unknown and lists the tracks by the server's own titles (`unidentifiedAudioSection()`), because an empty gap reads as "no audio". It says the same when the device plays the stream itself and Roku lists none of its audio tracks (several tracks muxed into one HLS variant, measured 2026-10-12): the app cannot choose among them, so it does not name the pick. A source that lists no audio gets no section: none listed is not the same claim as none there.
- **A `.strm` item shows no size or total bitrate:** the server's figures describe the `.strm` text file (101 B and 11 bit/s for a two-hour film, measured 2026-10-12). The report knows a `.strm` item by its own path, the server's own test (`isShortcutPath()`), not by its source's protocol: a shortcut takes its URL's protocol, and a channel plugin's `Http` source can carry real figures. A live stream keeps its bitrate.
- **"Streaming from" tells everyone where the stream comes from:** "This Jellyfin server", or the host of the URL the player was handed (a Live TV channel or `.strm` item played from its own URL). Administrators also see the playback URL and the path, with their secrets hidden (`maskUrlSecrets()` in `source/utils/streamOrigin.bs`): a server URL's token (`ApiKey`, or `api_key` on older servers), every query value of a provider's URL, whose token names are unknown, and any `user:password@` on either. The report is the screen users photograph for a bug report.
- **Each transcode reason shows the server's code and what it means.** The code is the label, untranslated, so it can be searched in Jellyfin's vocabulary; the value explains it in plain words (`transcodeReasonExplanation()`, one string for each code Jellyfin defines, written from where the server sets them). The report then adds what the server cannot know: that one of our settings caused the constraint, and only where the predicate that added that profile condition still holds for this stream. A code the app does not know shows with no explanation.
- **Live rows refresh** every `PLAYBACK_INFO_REFRESH_SECONDS`: transcode speed, progress, how far the transcode is ahead of the playback position, and output bitrate. Speed is the actionable one: `TranscodingInfo.Framerate` is frames encoded per second, so dividing by the source frame rate gives a real-time multiplier, and below 1.0x the server cannot keep up. `OverviewDialog` updates rows in place by `id` while the report's shape is unchanged, so the scroll position holds, and rebuilds the layout when the shape changes (a transcode ending while the report is open).
- **Every fetch is a new `GetPlaybackInfoTask` node** ([ADR 0037](../adr/0037-task-run-replacement.md), decision [`playback-report-fetch-per-run`](../decisions.md#decision-id-playback-report-fetch-per-run)). A press replaces a run in flight; a poll tick skips while one runs or waits to launch (`isTaskInFlight`, [ADR 0041](../adr/0041-task-launch-queue.md)), or a server slower than the poll would never answer. Closing the report releases the node, so a late answer cannot open the report again. At most one fetch is live per player.
- **A dialog opened after the press wins** (decision [`playback-report-newest-dialog-wins`](../decisions.md#decision-id-playback-report-newest-dialog-wins)). Opening a track picker releases the fetch, and an answer that finds another overlay open is dropped rather than superseding it, since the error dialog would read a supersede as a takeover and park the player. The chapter list is a panel inside the player, not an overlay, so a late answer still opens over it; the report gives focus back to the list when it closes.

The poll pauses while the device would otherwise show its screensaver, using `LoadScreenSaverTimeoutTask`'s answer as its idle limit.

### When a video ends

`onPlayerStateChange()` handles the end of playback:

- **`finished` while `prepareToLeaveMount()` declines** (a retry, or an error that owns the exit): nothing.
- **A Live TV channel that finished:** `restartLiveChannel()`, the same channel, remounted. A live feed that drops mid-stream surfaces as `finished`. So does a stream that ends without ever playing (an on-demand playlist listed as a channel, joined at its end), so restarts are budgeted: an end after `LIVE_RESTART_HEALTHY_MS` of progress resets the count, any other end adds one, and past `LIVE_RESTART_MAX` the player shows the error. Progress is counted by the player from its `position` notifications (`liveProgressOnPosition()`): only small forward steps past the furthest position count, so pauses, buffering, the jump to the live edge and a seek do not. The host reads `liveProgressMs()` at the end; `liveRestartOnMount()`, `liveRestartOnEnd()` and `liveRestartOnStall()` in `source/utils/liveTv.bs` hold the rule (decision [`live-restart-progress-and-stall-rule`](../decisions.md#decision-id-live-restart-progress-and-stall-rule)).
- **A Live TV stream that stalled** (not an end): `VideoPlayerView.bufferCheck` sees no buffering progress across a tick (`classifyBufferCheck()` in `source/utils/bufferStall.bs`) and calls the host's `onLiveStreamStalled()`. A mount that had made `LIVE_RESTART_HEALTHY_MS` of progress restarts; any other stall shows the error and stops the stream. A mount that a stall restart started must play `LIVE_STALL_REPROVE_MS` before its own stall restarts again, because a restart into a playlist that stopped growing plays its leftover segments. A movie or episode that stalls shows the error directly.
- **A player that plays but does not move:** `VideoPlayerView.playingProgressCheck` watches a node in `playing` (not paused, seeking or scrubbing, and not within `STALL_END_MARGIN_SECONDS` of the end). A position that has not moved for `STALL_WINDOW_SECONDS`, the same window as a buffering stall, takes the same exits (`classifyPlayingProgress()` in `source/utils/bufferStall.bs`): the error dialog for a movie or episode, `onLiveStreamStalled()` for Live TV. Without it a frozen picture showed no error at all. It has its own timer, `playingProgressTimer`, registered once in `init()`, and its ticks are the window: each compares the position with the last tick's. No second clock is checked against it, because one read a hair either side of the timer's duration and would miss stalls at random.
- **The give-up error's wording** (`liveGiveUpCauseKey()`): "This channel isn't sending any video" when no mount since the viewer chose the channel made progress, "This channel's stream stopped" when one did.
- **Something to play next** (`queueRepeat.nextIndex()` on the queue's repeat mode: the next item; the same item again under `RepeatOne`; the first item after the last under `RepeatAll`): `advanceTo()` and `playCurrentQueueItem()`; the item starts fresh ([below](#items-a-queue-arrives-at)), a replay included. First, `shouldAskStillWatching()` decides whether it plays under the still-watching prompt.
- **The queue is done:** the audio player's `loopMode` is cleared, then `exitPlayback()` calls `sgrouter.goBack()`, and the screen beneath (the details screen, or Home) resumes.

The same rule decides where the previous and next buttons of the OSD may step (`nextIndex()` and `previousIndex()`, read by `OSD.applyStepButtons` and `VideoPlayerView.handleItemSkipAction`): under `RepeatOne` a press plays this item again, as next in jellyfin-web and the SyncPlay server's `Next()` do, so the control reads the same in and out of a group, and a toast says so once (an automatic replay at the end says nothing); `RepeatAll` wraps at either end, a single video to itself; off, a single video has no step. `RepeatOne` also keeps the Next Episode prompt down (`checkTimeToDisplayNextEpisode`), since the end replays the episode. The gear lights up (`IconButton.isButtonSelected`, the music screen's idiom for its repeat and shuffle buttons) while a gear row differs from the viewer's defaults (`playbackSettingsMenu.hasPicks`: a cap on the queue, or repeat on); `OSD.refreshFromQueue` reads the step buttons and the tint again as the OSD opens and after each gear pick. The mode belongs to the queue and uses the server's words so that a SyncPlay group's `PlayQueue` update can carry the same value; the audio player's `loopMode` is a separate, older loop for music.

`destroyPlayer()` reports the stop: it removes the `state` observer, sets `m.view.control = "stop"` (the `Video` node's own teardown reports nothing), then calls the player's `onDestroy` and removes the child. So Jellyfin records the stop whether the viewer backs out (`goBack`, `beforeViewClose`, `onDestroy`, `destroyPlayer`) or the queue ends.

### Are you still watching?

After enough unattended videos, the next one plays under a centered prompt (#982, decision [`still-watching-prompt`](../decisions.md#decision-id-still-watching-prompt)). **When** to ask is `source/utils/stillWatching.bs`, pure and unit-tested; **the asking** is `PlayerHostView`, which owns the session while the play route is mounted.

- **The rule.** A video counts as unattended when no remote button was pressed while it played (`roDeviceInfo.TimeSinceLastKeypress()` against when it started). Ask before the next one once the count reaches the preset's limit, or, from the second unattended video in a row (`STILL_WATCHING_MIN_VIDEOS_FOR_TIME_LIMIT`), once the time since the last press reaches its limit. So one long movie never prompts on its own. It covers every kind of queue, unlike jellyfin-web, which counts only episodes.
- **The presets** match jellyfin-web (2 videos or 60 minutes, 3/90, 5/150, 8/240, off), in `playbackStillWatching`, defaulting to `default`. Web keeps its choice in the browser, not on the server, so there is no web value to follow. Web 12.0 and 12.1 fall back to the same default; 12.2 falls back to off.
- **Not a new video:** a Cinema Mode intro and the item behind it (`followsIntro`) count as one.
- **The prompt** is `showStillWatchingDialog()`, shown on the next video's first `playing` with the video playing underneath. **Any key answers it, Back included** (`anyKeyResolves`, `buttonDialogKeyAction`), and the press does nothing else. A one-second timer rewrites the countdown in the subheading, the one text field rewritten after a dialog is up, safe only because it is a single short line.
- **No answer** in `STILL_WATCHING_RESPONSE_SECONDS`: the prompt is abandoned and the player calls `pauseWithOsd()`, what the Play key does.
- **Activity without a key press counts too:** any voice or Jellyfin app command (`PlayerHostView.handleTransport` records it, and answers the prompt when it is up), and a resume after the timeout.
- **Skipping** with next or previous starts the count over (`skipToCurrentQueueItem`).
- **The key-press clock counts whole seconds** and `UpTime` does not, so a press within `STILL_WATCHING_KEYPRESS_PRECISION_SECONDS` of a video's start counts as the press that started it.
- **While it is up,** the Skip Intro and Next Episode pop-ups stay down (`isDialogOpen` in `VideoPlayerView.onPositionChanged`), and an auto-skip intro waits.

RTA covers both endings (`tests/rta/specs/still-watching.spec.js`, with the `rtaForceStillWatching` hook so it need not play for an hour first).

### SyncPlay: the player follows the group

While `m.global.syncPlayManager.following` is true, the player answers to a SyncPlay group ([`global-state.md`](global-state.md#manager-nodes-scenemanager-queuemanager-audioplayer)), and the host and the player change in two ways.

- **Events go up, verbs come down, and nothing observes the player from outside.** `PlayerHostView.mountPlayer`, `onPlayerStateChange` and `destroyPlayer`, and `VideoPlayerView.onPositionChanged`, hand the manager their event through `syncPlayHooks.notify` (`source/syncplay/syncPlayHooks.bs`), which is silent while not following. The manager acts through the host's existing `handleTransport` verbs (`pause`, `resume`, `seekto`) and `exitPlayback`. An observer of the player's `state` registered by the manager would be removed along with the host's by any `unobserveField` (#898), so the events are pushed instead. The decisions (when a command applies, which verbs carry it, when `Buffering` and `Ready` go out) are pure in `syncPlayPlayback.bs`; the manager owns the Timers.
- **The local auto-behaviors stand down,** because each would move this member on its own: `shouldAskStillWatching` returns false; `onPlayerStateChange` does not advance on `finished` (the manager asks the server for the next item, and the server's queue update remounts every member; on the group's last item the manager leaves the route itself); `checkMediaSegments` turns an auto-skip into the skip button, since one member's setting would move everyone; `checkTimeToDisplayNextEpisode` shows no button; the manager sets `setPrerollStatus(false)` on the group's queue, so `LoadVideoContentTask` queues no Cinema Mode intro; and the load queues no following episodes after a group item (`syncPlayQueue.isGroupQueueItem`), because the group's playlist is the queue.
- **The viewer's own controls go to the group.** The Play key, the OSD play-pause button, trickplay, replay, chapter skips, the segment button, voice and remote transport, and the OSD buttons for previous and next ask the group through `syncPlayHooks.control` and `SyncPlayManager.control` (`Pause`, `Unpause`, `Seek`, `NextItem`, `PreviousItem`), as the playback manager of jellyfin-web does in a group, and the server's command then moves every member, this one included. A pause is also written locally at once, as web does, so the press is seen to land; a resume or a seek waits for the server. The group's own verbs reach the player through the same `handleTransport`, marked `fromGroup`, and the player applies those as they are: unmarked, a group Seek came back as a new Seek request and went round for good (Stick 4K, 2026-10-28). The OK on the trick-play bar posts the scrubbed target to the group and writes nothing to the node: the group's Seek closes the bar. A local seek to the node's own position used to close it at once, but it overlapped the group's Seek and could freeze the whole group. A bare swallow leaves the bar up, a resume plays on under it and a play wedges the node (Stick 4K, 2026-10-28), so if no group Seek comes, a 5 s timer (`groupSeekFallbackTimer`) writes that seek to the node's own position, and the bar still closes. A seek that cannot be posted (not following, or no request) falls through to Roku's own seek. The remote's Replay key is a group seek too, through the voice replay's path, since Roku's own replay never reached the group. A group `Pause` shows the OSD as the Play key does (`showOsd` on the verb); the group's `Unpause` hides it by itself. The pause hold's give-up halts the member rather than warn, since a viewer's own Play goes to the group.
- **The local queue holds the group's playing item alone.** A queue update fetches the one item the group plays (`syncPlayQueue.playingEntry`), never the playlist, because in a group the next item is the server's answer, so the other items' metadata has no reader; `sync.playlistCount`, `sync.playingItemIndex` and `sync.repeatMode` give the previous and next buttons of the OSD their enabled state (`syncPlayQueue.stepBounds`, through `syncPlayHooks.groupQueue`), read at each load and again as the OSD opens, since another member can change the playlist under the playing item (`OSD.applyStepButtons`); the manager also tells the player `queuechanged` on each queue update, so an open OSD reads again. Measured on a Stick 4K (2026-10-24): the whole-playlist build cost about 1.1 s at 300 entries against 0.4 s at two.
- **The group's modes are the group's, and repeat rides on the queue.** Each `PlayQueue` update carries the group's `RepeatMode` and `ShuffleMode` (`syncPlayState`); the manager writes the repeat mode onto the local queue while the queue holds the group's item (`SyncPlayManager.syncGroupModes`, and `applyQueue` as it sets the queue), so the OSD, the gear's tint and the step buttons read the one holder in and out of a group (decision `video-repeat-belongs-to-queue`). A Repeat or Shuffle pick in the gear goes to the server (`control({ kind: "repeat" })`, `SetRepeatMode` and `SetShuffleMode`, in any group state), and the update that comes back writes every member. Under `RepeatAll` the server's `Next()` wraps and under `RepeatOne` it keeps the index, so no item is last then (`syncPlayQueue.isLastItem`) and a finished item asks `NextItem` instead of leaving; a `NextItem` or `PreviousItem` update starts the item over even when its id is unchanged (`syncPlayQueue.changesPlayingItem`), because the server then waits on every member's `Ready`, as jellyfin-web restarts it too. A Next or Previous press whose target is the playing item (the group's `RepeatOne`, or `RepeatAll` on a one-item playlist; `stepBounds` names each step's target) shows the same "playing again" toast as outside a group. When following ends, by a halt or a leave, the repeat the group wrote goes off (`SyncPlayManager.releaseGroupRepeat`), since what plays is then the viewer's own, and jellyfin-web restores its own queue on leave, so a group's mode never carries into local playback. The queue knows who set its mode (`QueueManager.releaseRepeatMode`), so a mode the viewer picked since, or a new queue, keeps its own, and a follow again writes the group's mode back (`applyQueue`). A second `NextItem` or `PreviousItem` with the same id, arriving while this member is still loading that restart or waits ready at its start, reloads nothing (`syncPlayQueue.restartAbsorbed`); a member already ready sends `Ready` again, because the server's `Next()` under `RepeatOne` keeps the index and bumps `LastChange`, drops a duplicate only by `PlaylistItemId`, and so starts a new wait for each member's press.
- **A halted member resumes from the SyncPlay menu.** The in-group menu is one list in every state, **Resume with Group** while halted then **Leave Group**; `SyncPlayManager.resumeFollowing` follows again and loads the group's item as a new queue at the position the state kept while halted (`syncPlayPlayback.startPositionTicks` takes a newer `Pause` or `Seek` at its own position, an `Unpause` estimated forward). A resume whose load fails says so, though an automatic follow that fails stays quiet.

A load reports `Buffering` at mount and `Ready` at its first `playing`, pausing the player there, and the server's `Unpause` starts every member together (jellyfin-web does the same). A load that started partway in (a late join) reports the start it was asked for when the node reads further below it than 500 ms: the node still reads 0 at its first `playing`, and a `Ready` at 0 would draw a corrective `Seek`. After a `Seek` command, `Ready` waits for a `position` notification within 500 ms of the target, never the `playing` edge, where the node once still read the position from before the seek; after 3 s it reports the position in hand and lets the server correct it. Two Stick 4K findings shape the verbs: a `seek` on a paused `Video` node resumes it (2026-10-23), and a `play` or `resume` written while the node buffers leaves it buffering for good (2026-10-23). A `pause` written while it buffers is safe: it lands `paused` at once and stays there (measured 2026-10-24, direct play, a seek to 150 s, two runs). So a `Pause` only pauses, and it pauses a buffering node too, except during a load, where the first-frame pause already holds it. A `Pause` during a seek also writes nothing, since a pause written to a node that is still seeking can leave it buffering for good: the seek's landing pauses, with the OSD up, and an `Unpause` that follows takes that pause back. A `Seek` that arrives while another seek is in flight waits, and the newest wins: two seeks running on the node at once can leave it buffering for good, with the group waiting on it. The tracker holds the later seek (`heldSeek`) and the manager writes it when the first lands, with no report or pause for the first; an `Unpause` drops it, since it says where the group is now. The trick-play fallback's local seek is known to the tracker for the same reason, so a late group `Seek` waits for it. A `Seek` is the seek alone and pauses again only once the node reports `playing` at the new position, which confirms the position first. The node's position reaches the target before it reports buffering (measured 2026-10-24 on a Stick 4K), so the tracker forgets the state from before the seek and waits for the node's next state. The manager's own seeks stay unreported. Each waits for the node's state before it counts as landed, because the position can arrive before the node reports `buffering`, and that buffering would otherwise read as a stall. A `buffering` counts as a stall only after it has lasted a second, since a stall report makes the server pause the whole group. A silent seek still buffering after both of its 3 s budgets is reported as a stall, so the group waits instead of the member falling behind in silence. An `Unpause` during a load writes nothing: a server from 12.1 stops waiting for a member after 30 s, and a seek written then chases the load. The load's first frame pauses and reports `Ready`, and the server answers with the group's position. While the group is paused the manager keeps the player paused: `syncPlayPlayback.owesPause` says when the node plays on, a check a second after each pause write confirms it took, and at most three writes go out per command. A player that goes away with no remount the manager asked for (Back, an error that exits) halts: the member stays in the group, stops following, and sends `SetIgnoreWait`, so a server without a group-wait timeout never waits on it. The manager marks a remount as its own only right before it calls the host, never on `finished`, so a `NextItem` the server leaves unanswered cannot turn the next Back into a non-halt.

**The drift correction.** After each `Unpause`, once the node plays and two position notifications have come in, the manager reads how far this member sits from the group (`syncPlayPlayback.driftMs`, published as `sync.playbackDiffMs` at each reading in RTA builds only, for the specs, beside `sync.correctionsDone`, a count of the corrections that ran to their resume). That reading is the `Unpause`'s position run forward on the clock, minus the node's position. A member ahead past `SETTLE_CORRECTION_MS` holds, and a member behind past `SKIP_TO_SYNC_MIN_MS` seeks (`settleCorrectionDue`). The two bars differ because a seek froze the picture for 2.1 to 2.6 s, while a hold costs only the drift (Stick 4K, 2026-10-31). So a resume 288 ms late on a slow transcode path stays uncorrected.

- **The shape.** A member behind makes a silent seek to the group's position plus a lead, pauses as it lands (the tracker's `thenPause`), and resumes on `correctionTimer` as the group reaches that position (`correctionPlan`). A plain seek to the group's position lands behind by the seek's own latency. The lead grows to the last seek's time and a margin (`correctionLeadMs`), since a fixed 2 s lead left a member 1.9 s behind (Stick 4K, 2026-10-31). A member ahead only pauses and resumes, so the picture neither jumps nor buffers: 29 such holds on direct play and transcode, over HTTP and HTTPS, settled within 19 ms (Stick 4K, 2026-10-31).
- **The limits.** Each correction gets one more reading after it, then none until the next `Unpause`. A load disarms the check, since the last item's `Unpause` says nothing about the new one. A seek that would run off the item is skipped, since the player would turn it into a seek 30 s short of the end. A member behind whose last seek the tracker gave up (`trackPlayerEvent`'s `seekGaveUp`: it reported a stall, or never reached `playing`) does not seek either: it posts a Seek to its own position, so the server brings the others to it, and the Seek that comes back finds the node where it asked (`seekIsWhereWeAre`), so the node pauses and reports Ready with no seek. Once per pause chain (`waitedOnMe`), or a member that keeps falling behind would rewind the group every few seconds; after that the correction is skipped until a group Pause. On a direct-played 100 Mbps file every seek-correction outlasted the budgets, froze the picture for them and stalled the group (Stick 4K, 2026-11-01; decision `syncplay-slow-seek-waits-on-member`).
- **After this member's own stall.** A `Buffering` it reported ends the reading until the next command (`syncPlayPlayback.clockReference`). The group waits for this member, and a server from 12.1 answers its recovery with an `Unpause` to the other members alone. Correcting from the old `Unpause` left a member 4.88 s ahead after a 4 s stall (Stick 4K, 12.2 server, 2026-10-31).
- **When it ends.** The resume is scheduled from the node's `paused` state, never as the pause is written, and from where the node stopped. Any group command drops a correction under way, its seek's pause included. A halt or a leave also resumes a node it was holding.
- **No running loop.** No path drifted more than 30 ms over a steady minute, and one read at one-minute spacing moved under 10 ms over 8 minutes (Stick 4K, 2026-10-31).

**What the viewer's controls mean during a correction.** The node's state alone misleads them: a hold reads `paused` while the viewer is watching, and a pause waiting on a seek's landing reads `playing`. So the Play key, the OSD button, voice and the OSD icon all ask `syncPlayPlayback.pausedForViewer`. A press during a seek or a hold pauses the group. `SyncPlayManager.viewerPause` posts it, ends the correction, and leaves the node's pause to the landing, since a pause written to a seek in flight can leave the node buffering for good: 8 of 8 rounds froze that way, and 0 of 7 with no press (Stick 4K, 2026-10-31). A group `Pause` during a hold brings up the OSD, though the node needs no pause.

The viewer's **SyncPlay Time Offset** setting is added to the clock estimate (`syncPlayOffset.setExtraOffsetMs`, read at each frame and player event), for the constant a TV or sound system adds that no clock round trip can see. Web's `extraTimeOffset` is the same knob. It is set in **Settings → Playback** or, while following, from the OSD gear's **SyncPlay Time Offset** row, whose picker steps by 100 ms, twice the pick bar below, so every step it offers starts a correction; a value between the steps is typed in Settings and applies at the next resume. With such a value set, the picker lists it in its place, and a pick less than 50 ms from it is under the bar, so it too waits for the next resume. A pick takes effect at once: `onSyncPlayPicked` sends a `timeOffset` control, which arms the drift check (`armSettleCheck` with `byPick`) against `PICK_CORRECTION_MS` (50 ms either way, half the gear's step, which a unit test pins) instead of the resume bars, so a change the viewer hears as wrong is corrected without waiting for an `Unpause`, and a pick's seek shows a **Syncing with the group** toast. Halfway between the drift reading's own noise and one step, the bar leaves margin on both sides: settled readings ran from −8 to +2 ms, and one step read 74 to 106 ms (Stick 4K, 2026-11-04). The reading is the notified `Video.position`, so a step down corrects only while its phase error after the last resume is under 50 ms: readings after some resumes and seeks sat 49 to 73 ms off in the same runs, and whether that is the node or the reading is not yet known. Normal drift keeps the resume bars, so small wobbles never seek. A correction's seek lands less precisely than a hold (one landed about 55 ms behind, the same run), so a pick promises a correction, not a landing within the bar. The label shows the offset alone: a drift beside it read as wrong right after a pick. Its limit is 500 ms because the server's `Unpause` leads by at least that much: at 800 ms, 8 of 8 resumes had to seek, against 2 of 8 at 500 (Stick 4K, 12.2 server, 2026-11-01).

Only the group's item answers to the group, and while in a group a video play is the group's. `QueueManager.playQueue` asks `SyncPlayManager.claimPlay` before any launch: the manager posts `SetPlaylistItem` for a current item already in the group's playlist and `SetNewQueue` for anything else (`syncPlayQueue.handoff`), and the group's `PlayQueue` answer loads it for every member, this one included. The claim holds the start the press opened and lasts as long as it: the load's own start replaces it, a reload in place marks it done, a refusal, the membership ending or a halt fails that start and no other, and **Back** or the start's time limit ends the claim with it. A halted member is told to be waited on again (`SetIgnoreWait`) before its play is posted. The manager's own group load is told apart by the playlist id stamped on its current item (`syncPlayQueue.isGroupItem`), and a frame that answers a claimed play owes a load even when the group's item did not change (`syncPlayQueue.owedLoadForClaimedPlay`), since the viewer asked for it. A queue the video player could not follow (music, Live TV, one such item among videos) plays locally: a mount while following checks that the current item carries the group's playlist id, and anything else halts the member, so it plays as their own. A group item the video player does not play (music, Live TV) halts the member before the queue changes, so the group never waits on it. A halted member records the group's commands but applies none of them; it follows again on its own play, or when any member starts a new playlist (as jellyfin-web does), while a jump, an append or a removal within the playlist leaves it halted. Each group load tells the viewer one thing, decided as its `PlayQueue` frame arrives and said when the load runs (`syncPlayQueue.noticeForQueueFrame`, `noticeAtLoad`), because the toast has one slot and a second message replaces the first. The queue that answers the viewer's own join says nothing past **Joined**: the server sends a join to a playing or paused group its queue before any command, and an idle group a `Stop` first. A member brought back by another member's playlist hears it once, when the load runs, and a play it handed over was told at the claim. A command emitted before the group's playing item last changed is dropped (`syncPlayState.acceptsCommand`): the `Stop` every join brings is held until the first clock estimate, and applied late it would close the new queue's player. mpv-shim and Streamyfin apply the same rule. A new group playlist starts as a new queue (`QueueManager.clear` first), so a version pick or gear caps from the viewer's previous queue do not carry into it. A queue update that moves the group to another item reloads a mounted player in place (`syncPlayQueue.loadAction`), as the next item does, and opens the play route only when no player is mounted. The manager decides that a load is owed as the queue frame arrives (`syncPlayQueue.owedLoadAfter`) and keeps the record until the load is performed, so a frame that lands while the items load cannot cancel it. A queue update that leaves the group playing nothing (items queued onto an idle group, or an emptied playlist) owes no load and fetches nothing: the server waits on no member's `Ready` then, and the update that picks an item owes the load. The route never runs over a mounted host: sgRouter reuses the host for the same item and covers it, still playing, for another. Sign-out and a server switch post `Leave` before the session ends, with the `Authorization` header taken at that moment: the server leaves a group only with its session, and an HTTPS session outlives the app's long poll. A membership the app exit leaves behind (Home on the remote posts no `Leave`) is kept in the user's registry while in a group and ended at the next launch: `Home`'s first run calls `leaveStaleMembership` once the receiver is up, so the server's `GroupLeft` names the group in a toast, and a `NotInGroup` (the socket drop ended it already on HTTP) says nothing.

## `VideoPlayerView`

The video player. It extends Roku's `Video` node, so it inherits the playback state machine, and adds the OSD, trickplay, captions, the stream choice and the reporting to Jellyfin.

### Interface

| Group | Fields and functions |
| --- | --- |
| Presses the host observes | `selectSubtitlePressed`, `selectAudioPressed`, `selectVideoSourcePressed`, `selectPlaybackInfoPressed` (all `alwaysNotify`) |
| Selection | `audioIndex`, `SelectedSubtitle` (default `-2`, `SubtitleSelection.NOT_SET`; `-1` is none; `alwaysNotify`), `mediaSourceId`, `Subtitles`, `fullSubtitleData`, `fullAudioData`, `fullVideoSourceData`, `isPreviousSubtitleEncoded`, `shouldAllowCaptions` |
| The stream | `videoId`, `PlaySessionId`, `container`, `isDirectPlaySupported`, `isTranscoded`, `isTranscodeAvailable`, `transcodeParams`, `cachedPlaybackInfo`, `isShortcut` (the item is a `.strm` file, so the report hides its size and bitrate), `showID` |
| Retries | `isDoviDirectPlayFallbackAvailable`, `isReencodeFallbackAvailable`, `isTranscodeAvailable`, `isRetrying`, `isDoviPreservationBypassed` (the stream was asked for without the Dolby Vision profile, so the report must not blame the setting), `isVideoCopyDisallowed` (the stream was asked for re-encoded, which the report says) |
| Errors | `errorDialogOwnsExit` |
| Other | `lastFocus`, `transcodeReasons` (set to `[]` in `init()` and never read) |
| Functions | `onDestroy`, `handleTransport`, `pauseWithOsd`, `abandonErrorDialog`, `showLiveStreamStoppedError`, `showLiveStreamStalledError`, `liveProgressMs`, `reportStallStop` |

Its children, declared in `VideoPlayerView.xml`: `captionGroup` (app-drawn subtitles), `trickplayCarousel`, `playbackTimer` (10 s, repeating), `bufferCheckTimer`, `osd` (with `inactiveTimeout="5"` set on this instance), the `chapterList` panel and its `chaptermenu`, and the two `VideoNotification` nodes, `segmentNotification` and `nextEpisodeNotification`.

### Playback lifecycle

1. **Mount.** `PlayerHostView.mountPlayer()` builds the player, observes its state and press fields, and appends it, hidden while it loads so no black frame covers the backdrop.
2. **Load.** `init()` launches `LoadVideoContentTask` (`m.LoadMetaDataTask`), which asks the server how to play the item ([below](#choosing-a-stream)). Every load, and every reload after it (an audio, subtitle or version change, a pick in the gear, a retry), goes through `startVideoLoad()`, which runs it on a new node with its full input set and lets the old run go through `releaseVideoLoad()`. A reload can start while the previous run is still going, and the same node would drop it: a second version pick made during the first one's load was lost 6 of 6 times, and the server-stream retry started from inside a delivery never started 1 time in 10 (measured 2026-10-13 on a Streaming Stick 4K against 12.0.0). `onVideoContentLoaded()` ignores a replaced run's delivery (`isCurrentTaskEvent`), then applies the answer (the stream `content`, the chosen audio, subtitle and version, `cachedPlaybackInfo`), makes the player visible and starts it, or shows the playback error when nothing came back.
3. **Playing.** The `state` field moves through `buffering` to `playing`. The `playing` branch reports `start` once, tells the OSD the playback state (its icon), starts `playbackTimer`, and undoes a park.
4. **Steady state.** `playbackTimer` sends `reportPlayback("update")` every 10 seconds. Pausing stops the timer and sends one update; resuming restarts it.
5. **End.** `finished` reaches `PlayerHostView.onPlayerStateChange()` ([above](#when-a-video-ends)). If the viewer backs out, the router closes the host, and `destroyPlayer()` reports the stop either way.

#### The player registers its own observers once

An observer registration is not private to the component that made it: a `VideoPlayerView` calling `m.top.unobserveField("state")` also removes `PlayerHostView`'s observer, and then no natural end reaches the host (#898). So every `m.top` observer in `VideoPlayerView` (`state`, `position`, the three track fields, the two caption fields and `shouldAllowCaptions`) is registered once in `init()` and removed only in `onDestroy()` ([ADR 0034](../adr/0034-component-observers-init-to-ondestroy.md); the rule for every component is in [`components/CLAUDE.md`](../../components/CLAUDE.md#observing-a-field-on-a-long-lived-node)). Handlers ignore what they must not act on through three flags:

| Flag | Raised | Why a handler ignores the notification |
| --- | --- | --- |
| `m.isContentLoaded` | Once, when `onVideoContentLoaded` hands the first stream to the node | Before a stream exists there is nothing to report. **Back** pressed while loading surfaces as `stopped`, and `onState` would otherwise report a stop for a session that never started. |
| `m.isApplyingOwnSelection` | Around the player's own writes to `audioIndex`, `mediaSourceId` and `selectedSubtitle` | Those writes apply the loaded selection; treated as the viewer's choices, they would reload the stream. The caption handlers are not gated: they must see the same writes. |
| `m.hasPlaybackFailed` | In `onState`'s `error` branch; cleared when a new stream is handed over | The error dialog owns what happens next |

A write the component makes to its own field on the render thread runs the handler before the next statement, which is what lets a flag raised around the write suppress it. Both halves are build errors (`top-observer-outside-init` and `top-unobserve-outside-ondestroy` in [`field-observer-wiring`](build-and-tooling.md#convention-plugins)), and [`playback-advance.spec.js`](../../tests/rta/specs/playback-advance.spec.js) plays an episode to its end on a device and waits for the next one.

<a id="reportplayback--server-side-reporting"></a>

### Reporting playback to Jellyfin

Position is reported in Jellyfin ticks (1 tick = 100 ns; `int(positionSeconds) * 10000000&`). `GetApi().BuildPlaystateRequest(state, params)` builds the request and `SubmitSideEffect()` sends it, so it never blocks playback. This is what keeps **Continue Watching** accurate.

| Report | When |
| --- | --- |
| `start` | Once per stream, on the first `playing` |
| `update` | Every 10 seconds while playing; when paused, at once and then every 60 seconds |
| `stop` or `finished` | Once per stream, when it ends (`stopped`, `finished` or a terminal `error`), through `reportPlaybackEnd()` |

**A pause is confirmed, and a paused player keeps reporting** (#1281). Two server rules make a single pause report unsafe (`source/utils/playbackCheckIn.bs` has the details):

- After each report the server makes "still playing" copies of it once a second. One that lands while a pause report is being handled sets `IsPaused` back to false, and the dashboard and other apps then show the Roku playing.
- The server ends a playing session that sent no report of its own for more than 5 minutes, paused or not. Its copies don't count.

So 2 seconds after a pause report the player reads its own session back (`GET /Sessions?deviceId=`) and reports the pause again when the server shows playing, at most 3 reports per pause (`playbackCheckIn.pauseReadBackAction()`). And while paused the report timer keeps running at `playbackCheckIn.KEEPALIVE_SECONDS`, well inside the 5 minutes. A pause the read-back could not confirm is corrected by the next keepalive report. The audio engine does the same (below).

**The end of a stream is reported once, and only a stream that played saves its position.** `reportPlaybackEnd()` asks `classifyPlaybackEnd()` (`source/utils/playbackEnd.bs`):

- **A stream that reported `start` and ended normally** sends a plain stop (or `finished`), and the server saves its position.
- **A terminal `error`, or a stream that never reported `start`** (it failed before its first frame, stalled into the error, was retried, or the viewer backed out after it loaded), sends a stop **marked `Failed`**. The stop still matters, because the server stops the session's transcode on it. `Failed` makes Jellyfin skip only the user-data write (`OnPlaybackStopped`), so the position read before the first frame, usually 0, cannot replace the resume point (#969).
- **A Live TV stream that never reported `start` is released by a close by id, and its stop leaves the stream out** (`POST /LiveStreams/Close`; `endClosesLiveStream()` and `liveStreamReportFields()` decide). Each release drops one consumer from the stream, so a stream must be released exactly once: a second release of a stream the server shares between viewers ends another viewer's stream. A stop naming a stream that never reported `start` cannot be that one release, because what the server does with it depends on its version and on who else is watching:

  | Server | A stop naming a stream whose `start` was never reported |
  | --- | --- |
  | 10.7 to 10.10 | Always releases it |
  | 10.11 | Never releases it: only a session linked by a `start` or progress report does ([jellyfin/jellyfin#13220](https://github.com/jellyfin/jellyfin/pull/13220)) |
  | 12.0 and 12.1 | Releases it only while no other session is linked ([jellyfin/jellyfin#17178](https://github.com/jellyfin/jellyfin/pull/17178)) |

  So the close releases it and the stop leaves `LiveStreamId` out, which every version ignores (decision [`live-stream-released-once`](../decisions.md#decision-id-live-stream-released-once) has the measurement). A stream that did report `start` is released by its stop and never closed as well. A stream the player never held is [below](#a-live-stream-the-player-never-held).
- **A stream whose end was already reported sends nothing.** A stop can surface as `finished` as well as `stopped`, and the server logs every stop as its own "finished playing". The flag (`m.isEndReported`) resets when a new stream loads and when a `start` is sent, since a voice or remote `play` can restart a stopped player without a reload.
- **A force-finish** (`forceFinishPlayback`) sets `finished` itself, so the `stopped` its stop raises reports nothing (#914).

When playback stops or finishes, the player also puts back the device's caption mode (`globalCaptionMode`) it saved at the start.

#### A live stream the player never held

`LoadVideoContentTask` opens a Live TV stream in its `PlaybackInfo` request (`AutoOpenLiveStream`), and the server opens it whether or not the app is still waiting. Only the answer names the stream. So the load records how far it got on its own `liveStream` field (`LiveStreamStage`: `opening` before `PlaybackInfo`, `open` with the id after it), and whoever is left holding the stream releases it (`source/utils/liveStreamHandoff.bs`, [ADR 0045](../adr/0045-live-stream-open-handed-off-by-stage.md)):

| When | Released by |
| --- | --- |
| The player took it | The player, at its end (the rules above); the view marks it `handedOver` |
| The load failed after opening it (no transcoding URL, a `localhost` path it cannot rebuild) | The view, in `onVideoContentLoaded()`, which marks it `released` |
| The view went away (**Back**, a channel switch, a deep link) while the load held it | The view, in `releaseVideoLoad()`: stop the load, then close the stream |
| The view went away while the stream was opening | The load itself: `releaseVideoLoad()` sets `isAbandoned` without stopping it, and when `PlaybackInfo` answers the load closes the stream and ends |

Every other load the view leaves is stopped, and changes nothing more. The two never both close: the load closes only when `isAbandoned` is set, and the view sets it only for a load it saw `opening`, and then closes nothing. They never both leave it either: the load writes `open` before it reads `isAbandoned`, and the view reads the stage and sets the flag in one render-thread callback, which the load's two node accesses cannot split (assumed from how the render thread serves a Task, not gated). A stopped Task makes no further node access ([`threading.md`](threading.md#relaunching-and-stopping-a-task)).

A live open waits up to `timeouts.LIVE_OPEN_MS`, not the default timeout, because a channel's first open includes the server's probe and any tuning, and a client that gives up first leaves the stream open with no id to close. A source that answers but never sends data keeps the server waiting with no limit, so the app gives up at its limit with "This channel took too long to start" (`ErrorThisChannelTookTooLongToStart`, chosen by `apiResponse.noAnswer()`). **Back** works throughout. The wait holds a pool slot, since the pool never stops a POST, so a few opens of a dead source can leave every slot busy (predicted, not measured; ADR 0045).

#### Which version a report names

Every report names the playing file as `MediaSourceId` (Live TV sends its own `MediaSourceId` and `LiveStreamId` from `transcodeParams`). Before Jellyfin 12.0 the server uses it only for the now-playing display; from 12.0 it decides **which version the position is saved on**, because alternate versions keep their own progress. So a version switch in the player must not let the old stream's position land on the new file:

- The value is `m.reportedMediaSourceId`, not `m.top.mediaSourceId`: the switch writes that field before the old stream's `stop` fires.
- `start` and `update` adopt the most recently loaded source; `stop` and `finished` keep naming the file reports have been naming. Keying on the report rather than on event order means nothing depends on when, or whether, `stopped` arrives.
- `onVideoSourceChange` stops the progress timer at the switch (the `playing` branch restarts it), so no `update` carries the old position under the new id.

### Alternate versions and resume

An item with several `MediaSources` (alternate versions) resumes differently by server line (decision [`per-version-resume-selection`](../decisions.md#decision-id-per-version-resume-selection)). The rules live in `source/utils/versionResume.bs` as pure functions.

| | Before 12.0 | 12.0 and later |
| --- | --- | --- |
| Position stored | Once per item, whichever file played | Per version, on the reported `MediaSourceId` |
| Version picked to resume | Best for the device (`findBestVideoSource`) | The most recently played, unless two sit at about the same place, then the best for the device among those |
| In-progress signal | The item's own position | The item's own position, or an alternate listed first in the primary's `MediaSources` |

Resuming continues the file that holds the position, because another version can be offset from it and neither names nor running times tell a re-encode from a different cut. Upgrading to a better file is left to an explicit choice or a fresh start: with nothing in progress, playback picks the best for the device.

**A version is resumed only at its own position**, never another's, because two releases of one cut are offset and borrowing a position moves the viewer elsewhere in the content. "Most recently played" cannot come from a timestamp: 12.0 copies the newest version's `LastPlayedDate` onto the primary's user data (`VersionResumeData.ApplyTo`), so the primary's own play time is unreadable. The server answers it two other ways (decision [`version-resume-primary-order`](../decisions.md#decision-id-version-resume-primary-order)):

- **The source order, but only from a primary.** `SetAlternateVersionResumeStates` moves the most recently played version that has a position to the front of a primary's `MediaSources`, and leaves a directly queried alternate's own source first. So another version in front proves the item is a primary and that version played last; the item's own source in front proves nothing, and the DTO does not say which kind of item it is.
- **The resume query**, `GET /UserItems/Resume?parentId=<the item's parent>`, which returns the version that owns the resume point. `chooseResumeSource` asks for it (`needsMostRecent`) only in that ambiguous case with two versions in progress; the shells answer with `versionResume.mostRecentIdFrom()`, and a reply that cannot say falls back to the order.

This matters because on 12.0 **Continue Watching lists the version played last**, so an alternate's id is what gets queued.

Two versions within `versionResume.NEAR_LEVEL_MARGIN_TICKS` (30 s) count as being at the same place, so quality decides between them (decision [`version-resume-near-level`](../decisions.md#decision-id-version-resume-near-level)). Because a version resumes at its own position, that margin is the worst misplacement the viewer can feel. It absorbs the constant offset between two releases of one cut, the 10 s report cadence when a session ends without a stop, and the latency of a switch. `versionResume` holds no device knowledge (it must stay pure), so a tie comes back as ids and `findBestVideoSourceAmongIds()` settles it over those versions alone: scoring the whole list would let a 4K version nobody started win a tie between two in progress.

#### What a tile shows

Which version plays is one problem; a poster's progress bar is another. A list response carries each item's own `UserData`, which from 12.0 is the position of the item's own file, not of the version that would start. So with only an alternate in progress the tile shows no bar, and with both in progress it shows the wrong one. Before 12.0 the server stores one position per item, so `versionDisplay.correctDisplayProgress()` runs only on 12.0 and later (decision [`version-display-progress`](../decisions.md#decision-id-version-display-progress)).

The loaders correct the raw reply before the transform, so the transformer, the item node and `JRPoster`'s bar need no knowledge of versions. `isResumable` is derived from the corrected values in the transformer, the other reason to correct the reply rather than the node.

| Request | Why |
| --- | --- |
| `MediaSourceCount` on every request that builds video tiles | The free signal that an item has alternates: the server sends it only when there are several. It gates the rest, and drives the alternate-versions badge. |
| `GET /UserItems/Resume`, no `Fields` | Every version the viewer is part way through, newest first by `DatePlayed`. That order is the only signal for "played last"; the server hard-codes it and the endpoint takes no `sortBy`. |
| `GET /Items?Ids=…&Fields=MediaSources` for the page's grouped tiles only | Each tile's sibling version ids, since the DTO has no primary pointer and name and year are not an identity |

Two requests beat one: asking the resume list for `MediaSources` makes its size grow with the viewer's whole backlog, while the by-id request grows only with the grouped tiles on the page (decision [`version-display-two-requests`](../decisions.md#decision-id-version-display-two-requests) has the measurement). The resume list goes first, and an empty one skips the second request, so the cost is 0 requests on a server before 12.0 or a page with nothing grouped, 1 when nothing is in progress, and 2 otherwise.

The grid scopes the resume list to its container, which also works through a collection. Extras rows (More Like This, a person's videos) and the favorites row cross libraries, so they pass no parent.

**The divergence is bounded.** The tile shows the version played last, while `chooseResumeSource()` prefers the best for the device inside the 30 s margin. Where the two disagree, the versions are at most 30 s apart. Closing that gap would need every version's streams for every item on the page.

#### One answer for every entry point

`versionResume.chooseResumeSource()` decides for everything, so the app cannot name one version and play another:

- **`LoadVideoContentTask`** chooses for everything not chosen on screen (quick play, casts, a queued item), because it is the only place that can read each version's own position. An item that starts fresh resumes nothing, so position has no say in its version ([below](#items-a-queue-arrives-at)). `quickplay.video` runs on the render thread with no fetching, so on a per-version server it clears `mediaSourceId` (the transformer sets it from `MediaSources[0].Id`, which would read as an explicit pick) and leaves `selectedAudioStreamIndex` at 0. The reads ride `apiPipeline`, so several versions cost about one round trip, and nothing is fetched unless something is in progress. A reload during playback (a subtitle or audio change, a retry) runs the same task, so `VideoPlayerView.onVideoContentLoaded()` records the loaded version as the `mediaSourceId` the next run asks for; otherwise the reload would choose again from the server's lagging positions.
- **The start position says what kind it is.** The loader replaces a resume start with the chosen version's own position, and never an exact one (a chapter, Play from the start, a position saved before a reload). Callers write the pair through `nodeHelpers.setResumeStart()` or `setExactStart()` (or `setCurrentStartingPoint`'s `isExact`), never `startingPoint` alone.
- **`ItemDetails`** decides for itself and passes an explicit id, which the loader honors. Its first guess comes from the source order, then `syncVersionSelectionToChoice()` re-runs the choice as each position lands, unless the viewer has picked a version (`m.versionUserOverridden`). The Resume button follows the selected version: its own position (one `GET /UserItems/{id}/UserData` for a version other than the item), or, for a picked version with none, the in-progress position carried over.
- **Cinema Mode prerolls** are skipped when a resume is coming, which `startingPoint` alone can no longer say. `quickplay` passes `hasVersionInProgress` on the queue item, read from the source order, because that decision comes before the version is chosen. jellyfin-web draws the same line (`getIntros()` returns early on `startPositionTicks`). A queue gets one chance: its first load turns Cinema Mode off (`setPrerollStatus(false)`) whether or not an intro plays, so a resumed launch never hands an intro to the next item the queue reaches.

The carry is guarded by `versionResume.wouldMarkPlayed()`, which follows the server's played branches in `UserDataManager.UpdatePlayState`: past `MaxResumePct`, inside the last second, onto a version shorter than `MinResumeDurationSeconds`, or onto a version with no runtime. Each marks the item played, and the server then clears every version's position, so a carry the server would count as finished erases the place being carried from. The runtime it checks is the version's own `RunTimeTicks`, never the item's. It is stricter than the server in one place: the server checks `MinResumePct` first and ignores a report below it, while the guard refuses even a small carry onto a version shorter than `MinResumeDurationSeconds`, which costs the viewer a few seconds at most. The thresholds are read once per server into `JellyfinServer.resumePolicy`, and an unreadable policy answers "played", so nothing is carried.

#### Switching version during playback

`VideoPlayerView.onVideoSourceChange` maps the position into the new version with `versionResume.switchTicksFor()`: the same time when the new version reaches it, otherwise the same percentage. Two releases of one cut are offset by a constant, not stretched, so mapping by time stays close everywhere, and percentage wins only where the time does not exist in the new file (decision [`version-switch-position-mapping`](../decisions.md#decision-id-version-switch-position-mapping)).

Until the new version's load delivers, the audio and subtitle pickers still list the old version's tracks, so `VideoPlayerView.isTrackPickAgainstOldVersion()` ignores a pick that would need a reload. Reloading for it would either undo the switch or ask the new version for a track index from the old one's list, and it would overwrite the start point the switch has mapped. The switch's own load finishes with the tracks it chose for the new version.

This path is not guarded by `wouldMarkPlayed()`: past the resume ceiling but inside the new file, the viewer continues at the same time and the item counts as watched, which finishing it would do anyway. The details screen keeps the stricter rule because it can offer Play in place of Resume, a way out the player does not have.

**Tick arithmetic never uses single-precision floats.** A float's 24-bit mantissa cannot hold a tick count, and `abs()` and `getEffectiveDuration()` return floats. Negate by hand, `int()` seconds before scaling by `10000000&`, and use doubles (`1.0#`, `100#`) where a ratio is needed, as `switchTicksFor()` and `wouldMarkPlayed()` do.

`ItemDetails` holds only the shell that fetches what `resumeStateFor()` asks for. A component spec cannot stub those requests, so a rule written inside `ItemDetails` could only be checked by hand.

### Items a queue arrives at

An item the queue arrives at (the next one when an item ends, or the player's next and previous) is one the viewer did not choose to resume, so it **starts from the beginning** ([ADR 0038](../adr/0038-queue-arrival-starts-fresh.md)). A position saved on it belongs to an earlier session; Resume is the Resume button's job. In jellyfin-web, `nextTrack` also plays the next item with no start position. Before this rule, whether an arrival resumed depended on how many files the item had, because only a multi-version item reaches the version chooser.

The rule lives in the queue, so no queue can leave it out:

- **`QueueManager.advanceTo()`** is how both video advance paths move (`PlayerHostView.onPlayerStateChange` at an item's end, `VideoPlayerView.switchToQueueItem` for next and previous). It marks the item through `nodeHelpers.startFresh()`: an exact start at 0, so the loader never swaps in a version's position; `startsFresh`, so the loader picks the version by the viewer's pick; and no version in progress. Not an arrival: the item behind a Cinema Mode intro (the loader tags it `followsIntro` and `advanceTo()` consumes the tag, so the launched item keeps its start) and Live TV, which has no position. Audio moves with the plain position methods.
- **The intro's item goes right after the intro's slot** (`insertAfterCurrent`), not at the end of the queue, which would play the rest of a Play All queue first. The intro plays in the launched item's own slot, so once `advanceTo()` moves onto the item behind it, it removes that slot (`removeAt`) and the queue holds the item once: left in, previous would replay the item and a repeat of the queue would play it twice per loop. A move back onto the intro's slot (a replay under `RepeatOne`, a `RepeatAll` wrap) drops it too, and a press that ends the intro shows no repeat toast. The intro loads with no `mediaSourceId`, since the one on the load names the launched item's version and the server refuses it for another item. A reload while the intro plays (a retry, or a track or gear change) loads the intro again: `VideoPlayerView` reloads the item the last load loaded (`m.loadItemId`), marked as an intro, not the queue item.
- **The first item** is each launcher's call. Play All and shuffle start it fresh (`QuickPlayTask`'s `startsFresh` output, `startCurrentFresh()` after a shuffle); quick play of a series or season and the Resume button resume it.

**The version of an item that starts fresh** is the viewer's explicit pick when the item has a version with the same video (resolution, codec, HDR range: `versionPick`, over `versionLabels.videoFields()`), else the best for the device. Only an explicit pick carries (the details screen's Video menu, or a switch in the player), and it lives on the queue (`setVersionPreference`), so a new queue starts without one. It never matches on the name: jellyfin-web 12.0 matches `Name` exactly, which lines up only when every item's versions share one naming scheme.

#### One copy per episode

Before 12.0 the server lists every file of an episode as its own episode, with the same series, season and episode number and one `MediaSource` each. So a plain queue plays both copies back to back, and the next-episodes list can hold a copy of the current episode. `source/utils/episodeQueue.bs` collapses them in every queue the app builds from a list of episodes: the next episodes (`addNextEpisodesToQueue`, which also drops the current episode's copies), and one pass at the end of `QuickPlayTask.executeQuickPlay` and of `GetShuffleItemsTask`. That covers Play All, quick play and shuffle of a series, season, person or folder. **Playlists and collections are left alone:** the viewer put those entries there.

- Copies are grouped by `episodeQueue.episodeKey()`: series, season and episode number, for episodes only. A movie, a track, an unnumbered episode or a multi-episode file is never grouped.
- One copy is kept by the same pick, match and device rule as a version. Their `MediaSources` are fetched only when copies exist, `apiIds.PER_REQUEST` ids per request, so a 12.0 queue costs nothing and a large series never builds an over-long URL. When a copy's sources cannot be read, the server's first copy is kept.
- **Watched state counts per episode, not per copy.** `QuickPlayTask.doSeason` finds the first episode no copy of which is watched (`isGroupPlayed`), and resumes the copy the viewer is part way through (`inProgressCopy`) at that copy's own position. A first item resumed at its own position is kept exactly (`collapseQueue`'s `keepFirst`), with its episode's other copies dropped.

### Version labels

From 12.0 playback resumes the exact file and never upgrades on its own, so the label is what tells the viewer which file is about to play. One pure function, `versionLabels.labelsFor()`, names a version everywhere, judging each label against the other versions, and returns two forms (decision [`version-label-forms`](../decisions.md#decision-id-version-label-forms)):

| Form | Used where | Example (two releases of one episode) |
| --- | --- | --- |
| `title`, full | Lists the viewer chooses from: the `ItemDetails` Video menu, the player's Select Video Source dialog | `720p · web.h264-tbs` |
| `triggerTitle`, short | Places that say which is current: the collapsed Video trigger, the player (`triggerLabelFor()`, `OSD.videoSourceTag`) | `720p` |

- **Stream info first, and only what differs:** resolution, video codec, HDR range. A bitrate ladder with identical video gets none.
- **The name without the words every version shares**, at either end (ignoring case; space, `.`, `-` and `_` separate words), **and without end words that repeat a label the row already shows**, so Jellyfin's `Movie - 1080p` naming reads `1080p`, not `1080p · 1080p`. Both are plain comparisons: names are user-controlled, so no quality is read out of them.
- **The short form is the stream info alone when that identifies the version**, and the full label otherwise. A name can be the only difference (an edition) or a whole release file name (Jellyfin returns the file name when versions share no naming pattern, and `MediaSourceInfo` has no edition field), so the name is kept only where the viewer chooses. The cost: two editions that also differ in quality are named by quality alone once picked.
- **The in-progress version is marked** (`· In progress`) in the `ItemDetails` menu only, on 12.0 and later: the one `versionResume.inProgressSourceIndex()` names, which is also the one the screen selects and Resume continues.
- **The player shows the short form as its own segment on the line below the title**, after what identifies the item (`S4E6 - Customer Service • 720p`, `2010 • 1080p`); a Live TV channel shows none. A single version keeps its plain stream summary, and the player shows no tag for it.

## OSD

The on-screen display: title, current time, position bar, end time and play state, plus the buttons for audio, subtitles, version, chapters and playback info, which reach the player as its `select*Pressed` fields, and the playback-settings gear. It opens on a key press and hides after `inactiveTimeout` seconds without one (5, set on the player's `osd` instance), except while paused or while a dialog is open (`OSD.inactiveCheck`).

### Playback settings (the gear)

The gear sits in the right-hand group, left of playback info, and opens a menu of quality caps for this playback, then the queue's repeat mode, and while following a SyncPlay group three more rows: the group's **Shuffle**, the viewer's **SyncPlay Time Offset** and **Leave Group** (`syncPlayHooks.groupModes` feeds them). Each row shows the value that applies in parentheses: `Maximum Bitrate (No limit)`, `Maximum Resolution (720p)`, `Repeat (Off)`, `Shuffle (Off)`, `SyncPlay Time Offset (100 ms)`. The Repeat picker shows the full titles (`Off`, `Repeat all`, `Repeat one`) and the row the short ones.

| Step | What happens |
| --- | --- |
| OK on the gear | `OSD.openSettingsMenu()` opens the rows from `playbackSettingsMenu.rows()` as a menu anchored to the gear, the way **More** opens |
| OK on a row | `openCapPicker()` opens that row's choices with the current one checked: `bitrateOptions()` for Maximum Bitrate, `resolutionOptions()` for Maximum Resolution, `repeatOptions()` for Repeat |
| Back in a picker | The gear menu opens again on that row; Back there returns focus to the gear |
| A pick that differs from the value that applies | The OSD writes `playbackCapsPick` (`{ field, value }`). `VideoPlayerView.onPlaybackCapsPicked()` records it on the queue and reloads at the current position through `reloadAtCurrentPosition()`, the same path an audio or subtitle change takes. A Repeat pick goes out on `repeatModePick` instead: `onRepeatModePicked()` records it on the queue and reloads nothing, or while following asks the group (`syncPlayHooks.control`), whose update writes the queue. The SyncPlay rows go out on `syncPlayPick` (`{ kind, value }`): a shuffle asks the group, the time offset saves the setting (`user.settings.Save`), and Leave Group posts the Leave with playback going on as the viewer's own. Either pick then has the OSD read its step buttons and the gear's tint again (`refreshFromQueue`) |

**A pick lasts for the playback and the rest of its queue, and is never saved.** `QueueManager` holds it beside the version pick (`setPlaybackCaps`, built by `playbackCaps.withPick()`), so `clear()` forgets it when a new queue starts and `set()` keeps it through a shuffle. Settings stays the default, so a bitrate dropped for one bad connection does not follow the viewer into the next thing they play. A pick equal to the Settings value records nothing.

**The caps reach the request as an argument.** `LoadVideoContentTask` reads `getPlaybackCaps` once per load and passes it through `ItemPostPlaybackInfoResponse()` and `buildPlaybackInfoPostData()` to `getDeviceProfile(caps)`, which hands it to `GetBitRateLimit()` and `getResolutionConditions()`. With no argument each of them reads Settings, which is what every other caller relies on. One bitrate limit caps every codec: a positive number picked in the gear or set in Settings. Everything else is no limit, Settings' limit set to 0 included, and a No limit pick lifts a Settings cap. The bitrate row says No limit rather than Auto, because Auto suggests the app measures the connection and nothing here does. The playback report's cause checks read the same values: `PlayerHostView.reportSettings()` lays the picked caps over Settings (`playbackCaps.settingsOverlay()`), so a transcode the gear caused is still attributed to Maximum Bitrate or Maximum Resolution.

**The bitrate ladder is trimmed to the source.** It keeps the steps at or below the playing video stream's bitrate (`OSD.sourceVideoBitrate`, read from the loaded version) plus the one step above it, because a higher cap constrains nothing. A Settings value that is off the ladder is added and checked. **The resolution choices are the Settings entry's own options,** read from `settings.json` (`findConfigTreeKey()`), so the gear and the Settings screen offer one list.

**Each level opens the next from inside its own result handler,** and a list dialog delivers its result before it closes. The new menu takes focus, and the closing dialog leaves it there, because a dialog restores its `returnFocusTo` only when it still held focus ([dialogs.md](dialogs.md)). Both levels return focus to the gear. The RTA test in `dialogs.spec.js` checks focus at each level.

**Live TV has no gear yet.** A reload there opens a new live stream, and the one-release-per-stream rule has not been checked on that path, so `rows()` returns nothing for a `TvChannel` and `setButtonStates()` drops the gear. That also gives the left row its slot back.

### Live TV mode

The OSD adapts when the item is a Live TV channel (`OSD.isLiveTvItem()`, a `TvChannel`). A DVR recording gets episode-style title handling only. The behind-live math lives in `source/utils/liveTv.bs`.

- **The `goToLive` button** sits in the left button group for the whole of a channel, grayed out while the viewer is at the live edge. **Membership is per item, enablement is per moment:** `setButtonStates()` decides once whether the button is in the row, and `updateLiveTvDisplay()` only toggles `isEnabled`, the way `itemBack` and `itemNext` are disabled in place. Adding and removing the button shifted every later button's index under `buttonFocused`, so focus moved from the wrong origin; `OSDGoToLive.spec.bs` gates it.
- **Times** come from the program's start and end in the guide data plus the wall clock. When program timing is missing, the OSD falls back to the player's `positionTime`.
- **Program data refreshes when a program ends.** `VideoPlayerView` runs `RefreshLiveTvMetadataTask` at the program's end time, and the answer always rewrites the OSD logo, so the previous program's logo does not linger.

The channel queue comes from `VideoPlayerView.loadChannelListForQueue()`, a render-thread `fetchAsync()` promise ([`promises.md`](../dev/promises.md)) that fetches the channel list once per playback and installs it through `buildChannelQueueList()`.

## `TrickplayCarousel`

The scrub thumbnails. `VideoPlayerView` reads the position label of Roku's trick-play bar (`findTrickPlayBarPositionLabel()`, `onTrickPlayBarTextChange()`) and writes `thumbnailIndex` and `playbackPosition` to the carousel, which shows a row of five thumbnails around that position. `TrickplayTileLoader`, a Task, fetches the tiles from Jellyfin, ahead in the scrub direction first. On a low-memory device (`m.global.device.isLowMemoryDevice`) the posters and the preloading poster load tiles at half size.

## `VideoNotification`

Two instances overlay playback:

1. **Next Episode** appears near the end of an episode when `playbackNextUpButtonSeconds` is above 0 and `fetchNextEpisode()` finds a following episode (`BuildGetEpisodesRequest` from the current item). It counts down and hides when the countdown ends or its conditions lapse; OK calls `forceFinishPlayback()`, which moves to the next item.
2. **Media segments** (intro, outro, recap, preview, commercial, as Jellyfin marks them) show a skip button at the segment, which hides itself after 10 seconds, or not at all while Next Episode is showing. A segment type set to skip automatically (`MediaSegmentAction.SKIP`, through `resolveEffectiveSegmentAction()`) seeks past it with no button.

## `AudioPlayer` engine

`components/mediaPlayers/AudioPlayer` extends `Video` but plays only audio. It lives at `m.global.audioPlayer` for the whole app, but music does not play on once the viewer leaves `/audio`: every exit from `AudioPlayerView` stops it (Back, `exitAudioPlayback()`, a deep link, a move to a video in a mixed queue). It sets `disableScreenSaver` while playing, which keeps Roku's screensaver off during audio, and has a `loopMode` field for repeat. `Video` and not `Audio` is deliberate: `disableScreenSaver` exists only on `Video`, and Roku documents it for audio-only streams.

**Reporting is per listen.** Each `content` the engine is given opens a session (its `PlaySessionId`, the queue item, the last position). It reports `start` on the first `playing` and `update` on each other state change, through the same `BuildPlaystateRequest` and `SubmitSideEffect` as video, with positions in the whole track (below). Like video, it reads its session back after a pause report, and it reports on the same timing while a stream is open: every `playbackCheckIn.PLAYING_REPORT_SECONDS` while playing and every `playbackCheckIn.KEEPALIVE_SECONDS` while paused. The server keeps the resume point only from these reports, and ends a session that sends none for 5 minutes ([Reporting playback to Jellyfin](#reportplayback--server-side-reporting)). A session's `stop` is reported once: when the stream reaches `stopped` or `finished`, or when another `content` replaces it for a new listen (another track, a replay).

A stream a seek loaded is not a new listen. `AudioPlayerView` marks it `continuesListen`, and `audioSeek.streamHandover()` then has the engine send no `stop` for the old session and no `start` for the new one, only `update`s under the new `PlaySessionId`. This matters because Jellyfin adds a play on every `start` (`SessionManager.OnPlaybackStart()`, on 10.7.7 and on master): reporting each reload as a new listen counted a FLAC play with one seek as two (measured 2026-10-21 on the demo server, against one for an MP3 play with a seek). A server stream replaced this way still has a transcode the server runs until told otherwise, so the engine ends it with `BuildStopEncodingRequest` (`DELETE /Videos/ActiveEncodings`), which kills the job without a playstate report.

**The end-of-track guard.** A one-shot `Timer` that `init()` creates and registers once. It restarts on every position change within `audioSeek.END_MARGIN_SECONDS` of the track's length (`content.length`, from `RunTimeTicks`) while `playing`, and stops on any other state. If it fires and the position has not moved for `audioSeek.STALL_SECONDS`, `forceEnd()` reports the stop and sets `state = "finished"` itself, as `VideoPlayerView.forceFinishPlayback()` does, so `AudioPlayerView` advances as for a real end. It exists for the FLAC case below when no server stream could be had, and for any other stall at the very end.

Video reports differently: an end once, through `reportPlaybackEnd()`, and updates on a timer.

### Seeking, and why a FLAC seek reloads the stream

Roku plays a FLAC that it starts at a non-zero position (a `seek` or a `PlayStart`) and, when the file's last frame is shorter than its frame size, never finishes it. Most FLACs end that way. Mid-track, it stalls in `playing` forever, a moment before the last frame; near the end it ends at once with "malformed data", skipping the rest. A stream played from 0 always finishes (#662).

Measured 2026-10-21 on a Stick 4K (Roku OS 15.3.4) with the demo FLAC "Jellyfin", about 70 runs: a 50% seek froze 13 of 13 times. It made no difference whether the seek went through `seek` or `PlayStart`, which `seekMode` was set, whether the player paused first, `autoplayAfterSeek`, or whether the node was `Video` or `Audio`. A seek table, the embedded picture, the sample rate and the encoder did not matter either. Removing the short last frame cured it. Frame sizes 1,152, 2,304, 4,608 and 8,192 with a short tail all failed; 4,096 played through twice, unexplained. MP3, AAC, ALAC, WAV and Vorbis seek and end cleanly.

So `AudioPlayerView.startAudioAt()` takes every seek (scrub, voice, Jellyfin remote, repeat), and `audioSeek.startAction()` in `source/utils/audioSeek.bs` picks how:

| Stream | Target | Action |
|---|---|---|
| not FLAC | any | `seek` in the playing stream |
| FLAC | 0 | load the direct stream again, from 0 |
| FLAC | above 0, server may transcode audio | load a FLAC stream the server starts at the target |
| FLAC | above 0, it may not | `seek` (or the direct stream with a `PlayStart`, from a server stream), the guard as backstop, and a one-time toast |
| FLAC | above 0, the server stream failed | no seek: the track plays on where it was, and a toast asks to try again (a native seek there often ends the track at once) |

The server stream comes from `AudioStream(id, startSeconds, true)`: `PlaybackInfo` with `StartTimeTicks`, `EnableDirectPlay: false`, `EnableDirectStream: false` and one FLAC transcoding profile (`audioSeek.applyFlacRemuxProfile`). Without the direct-stream switch, Jellyfin 10.7 answers with no stream URL. It has no `MaxAudioChannels`, which would mix a multichannel source down, and its decoded samples matched the source's (checked 2026-10-21 against both demo FLACs, and on Jellyfin 10.7.7, 10.8.13, 10.11.11 and 12.0.0). An in-stream seek inside such a stream is ignored, so every later seek loads again. The reload took about 1.3 to 2.0 s on the Stick 4K; the old stream pauses and the progress bar holds the target meanwhile (`m.pendingSeek`). The reload is the player's own buffering wait (`beginSeekWait`): the player stays on show under the spinner and ignores every key but Back until the new stream plays or fails.

A server stream counts position from its own start, and its node `duration` means nothing. The content carries `startOffset`, and `audioSeek.logicalPosition()` (offset plus position) is the only position the screen and the reports read. Length is `content.length` or the queue item's `RunTimeTicks`.

## `AudioPlayerView`

The "now playing" screen for music, a `JRScreen` routed at `/audio`. It shows the artwork, title, artist, progress and controls, and drives the engine by writing its fields (`content`, `control`, `seek`, `loopMode`) and observing `state`, `position` and `bufferingStatus`. Every seek goes through `startAudioAt()`, and a replay from the start through `replayFromStart()` ([above](#seeking-and-why-a-flac-seek-reloads-the-stream)). The engine outlives the screen, but leaving the screen stops the audio: **Back** sets `control = "stop"` and clears `loopMode`, and `exitAudioPlayback` and `teardownForDeepLink` stop it too.

## Choosing a stream

The server decides how an item plays, from the device profile JellyRock sends: `getDeviceProfile()` in `source/utils/deviceCapabilities.bs` builds it, and `buildPlaybackInfoPostData()` in `source/api/items.bs` builds the `PlaybackInfo` request around it. `LoadVideoContentTask` reads the answer: when the source `SupportsDirectPlay`, it plays the file; otherwise it plays the `TranscodingUrl`, which may be a remux or a full transcode.

Every fact about the file (runtime, bitrate, container, streams) comes from `mediaSourceForId(mediaSources, mediaSourceId)`, never `mediaSources[0]`, because the first entry is only the server's default: a version picked in the Video menu sits elsewhere, and from 12.0 a primary's most recently played version moves to the front. The `PlaybackInfo` answer is the exception: the request names the version and the server returns only that one.

A source the server has never probed lists no streams: a `.strm` item before its first play. Its first `PlaybackInfo` probes it, and the server saves what it found (measured 2026-10-12 on 10.11 and 12.1: the item lists the streams as soon as that answer arrives). The audio and subtitle picks were made before that, from nothing, so the loader reads the item again (`reloadProbedStreams()`), picks again from the probed streams, and builds the track menu and the playback-info report from them. The details screen hands such a source's subtitle pick over as not set (`detailsSubtitlePick()`), so it is picked again too, as audio is. A transcode answer was built for the picks made before the probe, so when the new ones differ the loader asks once more (`probedPicksNeedNewAnswer()` in `source/utils/probedStreams.bs`), but only when that answer is the stream that plays (`serverAnswerPlays()`). A direct play needs no second answer, since the device plays the source and switches tracks itself. Neither does a source whose own manifest URL the device will play, nor one the server allowed but the device cannot reach, whose retry asks the server with our picks. So the loader decides whether the device plays the manifest URL right after the first answer, before the picks; nothing in that decision depends on them. The first play then looks like every later one. Some remote `.strm` sources take the server longer than the 10 s request limit on every `PlaybackInfo`, and fail to play (followup `strm-first-play-probe-outlasts-10s`).

The client overrides the server's answer in three places:

- **H.264 and HEVC level.** With `playbackTryDirectH264ProfileLevel` or `playbackTryDirectHevcProfileLevel` on, a source whose only transcode reason is `VideoLevelNotSupported` plays directly, within the device's hardware ceiling (`isWithinH264HardwareCeiling`).
- **Live direct play is always backed by a transcode retry** (`applyLiveDirectPlayFallback`). The server cannot probe a live stream ahead of time, so its "yes" is a guess; a failure before the first frame reloads with `EnableDirectPlay=false`. `applyMediaSourceToPostData()` sends that flag on every forced retry, live or not, so a server that allowed direct play answers with its transcode rather than the same "yes".
- **A source whose URL is an upstream HLS or DASH manifest is played from that URL, whatever the server answered** (`getUpstreamManifestBlocker()` in `source/utils/upstreamManifest.bs`, decision [`manifest-upstream-direct-play`](../decisions.md#decision-id-manifest-upstream-direct-play)). That covers `m3u` tuner channels and `.strm` items. Jellyfin 12.0 withdrew direct play for every manifest source (`StreamBuilder.ManifestContainers`: `hls`, `applehttp`, `dash`; [jellyfin/jellyfin#17768](https://github.com/jellyfin/jellyfin/pull/17768) for channels), because it had been relaying the manifest through its own URL, where relative URIs fail. JellyRock plays the absolute upstream `Path`, where they resolve. The server's replacement, a remux or a full transcode, loses audio sent as a separate rendition, starts slower and loads the server; it has no DASH output at all.

  The server's "no" does not say whether 12.0 is its only reason, so the rule rebuilds the earlier answer from what the client can see. `getUpstreamManifestBlocker()` returns the first reason to stay on the server's stream, as an `UpstreamManifestBlocker` value the loader logs, or `NONE`:

  - **This load:** the retry that forces a transcode, or a source with no `SupportsDirectPlay` answer.
  - **Not an upstream manifest:** not HTTP, not an absolute `http(s)` URL, or neither HLS nor DASH (`upstreamManifestFormat()`, from the container or, failing that, the URL path's extension; 10.7 and 10.8 report a `.strm` DASH item's container as `strm`).
  - **Through Jellyfin:** the server's own host and port, the `/LiveTv/LiveStreamFiles/` relay, or `localhost` or `127.0.0.1`.
  - **The server's older reasons, which 10.11 applied too:** the tuner's "Auto-loop live streams" (`RequiresLooping`), "Force transcoding of remote media sources such as Live TV" on a remote source (`IsRemote`; the server reports a `.strm` item as remote even for a LAN URL), and the internet streaming bitrate limit (`ContainerBitrateExceedsLimit` among the transcode reasons). The other reasons are ignored: for a manifest, 12.x no longer judges direct play, and its codec reasons say whether its own transcode can copy the stream, not whether the device can play it.

  The tuner's "Simultaneous stream limit" is the one older reason the client cannot see; the server still enforces it when the stream opens. The request is typed (`UpstreamManifestRequest`), so a misspelled field is a build error. Past those checks, a **device check** gates every upstream play, a server "yes" included: the loader fetches the manifest itself (`upstreamManifestAnswers()`, `timeouts.UPSTREAM_PREFLIGHT_MS`) and plays it directly only on HTTP 200 with a manifest of the declared format (`isUpstreamManifestResponse()`: an `#EXTM3U` first line for HLS, well-formed XML with an `MPD` root for DASH). A Roku handed a URL it cannot reach buffers instead of failing, which ended in the live stall error at about a minute on 10.11 (measured 2026-10-11). When the check fails after a "no", the load uses the server's `TranscodingUrl`. After a "yes" there is none, so the load flags `needsServerStream`: `VideoPlayerView.onVideoContentLoaded()` hands nothing to the `Video` node, closes the live stream the load opened (`releaseUnplayedLiveStream()`) and reloads through `retryPlayback()`.

  A source played from its URL always gets the transcode retry, live or not, and its `StreamFormat` is the manifest's own (`directPlayStreamFormat()`). A live direct play whose format cannot be read keeps `hls`, which every live direct play was given before formats were told apart.

MPEG-TS is left out of the direct-play profiles (`GetDirectPlayProfiles`), so the server remuxes every TS source, recordings included, to HLS.

### Why every HLS transcode is TS

`getTranscodingProfiles()` emits one HLS video profile, with the `ts` container. Don't add an `mp4` (`fMP4`) one back: Roku's media spec lists TS as the only HLS chunk format that may mux audio and video ("muxing audio and video not supported for CMAF"), and Jellyfin's `fMP4` HLS puts both tracks in the same fragments. The video plays and the audio never starts. A spec in `deviceCapabilities-transcodingProfile.spec.bs` fails if an `mp4` video profile comes back.

Array order did not keep the server off `fMP4`. From 10.8 the server's `StreamBuilder` ranks profiles by video and then audio fit and uses order only to break a tie, so whenever the `mp4` profile's longer audio list fit the source better, it picked `fMP4`. #573 (stereo files) and #1079 (DTS copied in) were that one cause, each patched for its own trigger. The measurements and the history are in decision [`hls-transcodes-ts-only`](../decisions.md#decision-id-hls-transcodes-ts-only).

TS has one cost: a source with rotation metadata, such as a phone video, can't keep its video in a remux. From 10.10 the server turns video copy off for a rotated source unless the segments are `fMP4` (`DynamicHlsHelper`, read from the server source, not measured), so the video is re-encoded.

To see what the server chose, open **Playback Info**: its container row shows the source and the target.

### Audio

The profile rules for audio live in `source/utils/deviceCapabilities.bs` and `source/api/items.bs`:

- **Multichannel tracks direct-play when the device can output them:** the profile's `AudioChannels` conditions (`getCodecProfiles()`) and the device's real codec support (`getActualCodecSupport()`) decide.
- **A multichannel source that must be transcoded is steered to surround.** `resolveMultichannelSurroundTarget()` puts `eac3` or `ac3` first in the transcode codec list, so the server does not mix down to stereo AAC. For a stereo source, `optimizeAudioCodecListForSource()` strips the surround codecs (`surroundCodecs`) from the list.
- **Only what Roku documents is direct-played, and `dts` and `truehd` are never transcode targets** (decision [`audio-profile-documented-and-reported`](../decisions.md#decision-id-audio-profile-documented-and-reported)). Roku's `CanDecodeAudio` and a soundbar's EDID can both say yes to a format the player then fails on, so the profile takes what Roku's media spec lists and the device reports. TrueHD, DTS-HD and `DTS:X` are never direct-played as such; DTS is direct-played up to `DTS_MAX_DIRECT_PLAY_CHANNELS` (6). Neither is offered as a transcode target, because the server copies a source codec it finds on that list, and DTS copied into HLS plays silent on Roku (#821, #892), so the server converts both to `eac3` or `ac3`.
- **A default track this Roku cannot play gives way to one it can.** With **Play default audio track** on, `findBestAudioStreamIndex()` takes the track the file flags default, but when that track is not direct-playable here (TrueHD, for one), `playableAlternativeToDefault()` picks a same-language track of the same kind that is (audio description for audio description, never commentary), as long as it has no fewer channels than the viewer would get from the default. The server would convert the default anyway, and the playable track lets the video direct-play or copy. A converted default arrives as at most 5.1 (`SURROUND_TRANSCODE_MAX_CHANNELS`), because the server's `eac3` and `ac3` encoders stop there, so a 7.1 default gives way to a 5.1 track even on a 7.1 system.
- **A track switch during playback** asks the profile's own question (`isStreamDirectPlayable()`: `getActualCodecSupport()`, the same refusals, the Decode Multichannel Audio cap and the AAC profile rule), so a switch stays native only where the server would have direct-played the track, and otherwise reloads.

### Dolby Vision

Roku does not play Dolby Vision from an MKV container, so JellyRock asks for a remux, with a fallback when the server's stream overflows Roku's video buffer:

- With `playbackPreserveDovi` on, `buildPlaybackInfoPostData()` adds the MKV container condition `doviRemuxContainerProfile()` returns (`VideoRangeType NotEquals` the stream's range) that keeps the server from direct-playing the file, so it remuxes it into another container. It does this only when the device reports Dolby Vision and plays 4K, and `isDoviRemuxCandidate()` holds: the stream's range type names Dolby Vision and it is not out-of-spec (below), the container is MKV, the codec is not AV1 and the server is tier 2 or later. The playback report's `causedByPreserveDovi()` asks the same function, so it blames the setting only when the request applied it. The fallback below is offered only when the server names `VideoRangeTypeNotSupported` and this load's request added the condition (`offersDoviDirectPlayFallback()`, which asks `doviRemuxContainerProfile()` again), since otherwise the retry would send the same request.
- If that stream fails with a `buffer:loop:` source error, the player retries with `shouldBypassDoviPreservation = true`, which asks again without the condition and so allows direct play. `isRetrying` keeps `PlayerHostView` from advancing or exiting during the retry, and `isDoviPreservationBypassed` tells the report not to blame the setting.
- **Out-of-spec Dolby Vision plays as HDR10.** Jellyfin 10.11 and later mark profile 8 or 10 video `DOVIInvalid` when its base-layer compatibility ID is one Dolby does not define for that profile. When the stream is HEVC in an MKV file and still carries the HDR10 color tags, `allowHdr10DoviInvalid()` adds `DOVIInvalid` to the HEVC `VideoRangeType` list when it takes HDR10, for that request only, so the server direct-plays it and the Roku shows the HDR10 base layer. Only MKV, because Roku ignores Dolby Vision in MKV: from an `mp4` file on a Dolby Vision TV it plays the out-of-spec Dolby Vision itself, or refuses the file. Only HEVC, because no AV1 file of this kind has been played on a Roku. Any other `DOVIInvalid` stream is converted by the server, which leaves the Dolby Vision out of the stream when the request lists Dolby Vision. It runs before the choice to list HEVC first (`prefersHevcTranscode()`), so a transcode of such a stream lists HEVC first on a server that encodes HEVC in hardware, as for any HDR source the display takes. `isDoviRemuxCandidate()` leaves `DOVIInvalid` out, since a remux cannot make it play as Dolby Vision. Servers before 10.11 call compatibility ID 6 `DOVIWithHDR10`, which the HDR10 list already takes, so `isDoviRemuxCandidate()` also leaves a stream out by its own fields (`isOutOfSpecHdr10Dovi()`: profile 8 or 10 with a profile and compatibility ID other than 8.1, 8.2, 8.4, 10.0, 10.1, 10.2 and 10.4, and the HDR10 color tags), and it direct-plays the same way.
- **A profile 8 `mp4` file tagged `dvh1` is repackaged.** Roku refuses a `dvh1` sample entry that carries a profile 8 Dolby Vision configuration (`invalid DV entry`), so a direct play of one fails. For such a source (`CodecTag` `dvh1`, `DvProfile` 8), `refuseDvh1DolbyVision()` removes every Dolby Vision type from that request's HEVC `VideoRangeType` list. The server then copies the video into its HLS stream, which the Roku plays. The Dolby Vision data stays in the video, so a TV that shows Dolby Vision still gets it. It runs after the choice to list HEVC first, which still counts such a source as HDR the display takes. Only `mp4`, `m4v` and `mov` files carry a codec tag. Servers before 10.9 have no range types, so the rule cannot apply there.

### A remux that overflows the video buffer

A copied video stream can only be cut at the source's keyframes, so a source with keyframes several seconds apart gives HLS segments larger than Roku's whole video buffer, whatever `SegmentLength` asks for (`calculateOptimalTranscodingParams()` sizes segments by bitrate alone). Roku then fails with a `buffer:loop:` source error, and the player retries once with the video re-encoded, which forces a keyframe every segment:

- `chooseErrorRetry()` (`source/utils/playbackRetry.bs`) picks the retry. The Dolby Vision retry above comes first; the re-encode retry is offered on any transcoded load that did not already ask for one (`isReencodeFallbackAvailable`), except Live TV: no live overflow has been measured, and a live re-encode would need its own 1080p check.
- The retry sends `AllowVideoStreamCopy = false` and applies the buffer bitrate cap even below the source bitrate.
- The report says why the video is re-encoded (`isVideoCopyDisallowed`, a row in its reasons section), since no server reason names it.

### A retry lasts for the version's playback

Each retry adds one flag to `VideoPlayerView`'s `m.retryFlags` (`retryFlagsWith()`): the Dolby Vision bypass, the forced transcode or the re-encode. `startVideoLoad()` sends them on every run, so an audio, subtitle or gear reload asks the server the same way, and only a version switch starts over (`noRetryFlags()`); a new queue item gets a new player. What a retry learned is a property of the file: a reload that dropped it would fail the same way again. A flag only turns on, and a load with a flag on never offers that flag's fallback again (a forced transcode sends `EnableDirectPlay = false`, which also blocks the upstream-URL play), so a playback takes at most one retry of each kind. Dropping a flag is what once let the re-encode cycle with a direct play that had failed: the server still allows direct play when it may not copy the video.

### A transcode Roku can decode

Roku decodes H.264 only up to `H264_MAX_WIDTH` by `H264_MAX_HEIGHT` (1920 by 1080): a larger direct-played file fails with "Image width too high", and a larger HLS stream never starts. A server that does not encode HEVC (Jellyfin's default) re-encodes any source to H.264 at the source's size, so the load checks what the server will send:

- **HEVC goes first when the server encodes HEVC in hardware.** Home reads the server's encoding settings at each sign-in (`GET /System/Configuration/encoding`, open to any signed-in user; `JellyfinServer.encodingPolicy`), so every play follows them from the start; a video load that finds them unread reads them itself. A server before 10.10 leaves `HardwareAccelerationType` out until its Transcoding page is saved, which reads as no hardware, as Jellyfin's dashboard reads it. When they allow HEVC encoding on a hardware encoder (`serverCapabilities.serverEncodesHevcInHardware()`), a source H.264 cannot carry, beyond the ceiling or HDR the TV shows (`prefersHevcTranscode()`), lists HEVC first, so the server keeps its size and range. Live TV follows the same rule only when the channel item lists its video stream: an `M3U` channel lists none before it opens, so it keeps H.264 first. Otherwise H.264 goes first: a software HEVC encode runs slower than real time and stalls, where H.264 plays. The re-encode retry always lists HEVC first. Neither rule asks for more than the screen shows: the resolution limit and the HDR range types come from the Roku's output mode and what the TV reports (`getResolutionConditions()`, `GetDisplayProperties()`).
- **The server's answer is read before it plays.** For a non-live source beyond the ceiling, and on every re-encode retry, the load reads the master playlist's codec and size (`hlsMasterVariants()`) and asks once more with a 1080p cap when `h264CapDecision()` says so (`capH264Resolution()`). It judges the first variant the display shows, since the Roku drops the rest: a `PQ` or `HLG` variant counts only when the device profile's HEVC range list takes it (`hlsVariantShown()`), and that list is built only when the playlist has an HDR variant. It caps when that variant is H.264 above the ceiling or when the display shows none, and on the retry it also caps a source beyond the ceiling whose playlist could not be read. A first request with no readable playlist keeps its answer: the server may be copying the video, and a cap would turn a 4K copy into a 1080p re-encode. A failed second request keeps the first answer. The check is skipped under a viewer cap at or below 1080p, because the first answer already honors it, and for a load that does not play the transcode: the device plays the upstream link, or the viewer's level override tries direct play (`playsServerTranscode()`, `h264OutputCheck()`). The override is decided before the check, since a 1080p answer adds a resolution reason that would turn it off. A play at or below 1080p reads no playlist; a 4K transcode or remux reads it once, and a copied video reads as HEVC and plays at its own size.

A width limit in the H.264 codec profile cannot do this: Jellyfin applies a codec profile's width as one limit for the whole transcode, which would also stop 4K HEVC copies.

### A playlist Roku accepts

Roku refuses an HLS media playlist larger than `ROKU_MAX_PLAYLIST_BYTES` (4 MiB) with `mpr playlist file is too large`, and Jellyfin repeats the whole request query in every entry, so a long film can exceed it. After the answer, `fitHlsPlaylist()` estimates the playlist from the server's own `TranscodingUrl` (`estimatePlaylistBytes()`) and, over 90% of the limit, asks once more with `maxPlaylistEntriesFor()`, which `calculateOptimalTranscodingParams()` turns into a longer segment. `uniqueRangeTypes()` keeps the profile's range type lists free of repeats, since each repeat costs bytes in every entry. Shortening each entry further, or playing a film in parts, is #1321.

### A re-encode above the buffer bitrate

Jellyfin copies video only when the requested bitrate is at or above the source's, so for a source above the buffer cap the request keeps roughly the source bitrate, and a server that must re-encode anyway re-encodes at that bitrate, too high for Roku to buffer. The app cannot know beforehand whether the server will copy, so it asks: about 4 s after the stream reaches the player, `VideoPlayerView` reads its session, and when `TranscodingInfo` says the video is re-encoded above this load's cap (`reencodeCheck.reencodeNeedsBufferCap()`), it restarts once through `retryPlayback()`, whose request applies the cap. A copy is never touched and a failed read does nothing. The restart is the `REENCODE_VIDEO` retry, whose flag stays for the rest of the version's playback (`retryFlagsWith()`), so no later load of it, an audio or subtitle reload included, checks again or copies the video. `retryPlayback()` rather than `reloadAtCurrentPosition()`, which would save 0 as the resume point of a stream that never played. Skipped in a SyncPlay group, where a reload would report Ready at position 0 (followup `syncplay-reload-ready-position`), and for Live TV.

## Subtitles

| Kind | How it shows | Player state |
| --- | --- | --- |
| None | Nothing | `SelectedSubtitle = -1` (`SubtitleSelection.NONE`) |
| Native | Roku draws a text track the server delivers as an external file | `globalCaptionMode = "On"`, `subtitleTrack` set to Roku's track name |
| Burned in | The server draws it into the video (`DeliveryMethod = "Encode"`, `IsEncoded` in `source/utils/subtitles.bs`), as it does for bitmap formats such as PGS | `globalCaptionMode = "Off"` |
| Custom | JellyRock draws an external text track itself, when `playbackSubsCustom` is on | `suppressCaptions = true`; lines drawn into `captionGroup` |

The device profile offers `vtt`, `srt`, `ttml` and `sub` as external formats (`getSubtitleProfiles()`); the server decides delivery per track. Custom rendering is chosen by `shouldUseCustomSubtitlesForCurrentSelection()`, which needs the setting and `IsExternal`, so an embedded track always takes the native path.

The default track comes from `playbackSubtitleLanguagePreference` and the server's `subtitleMode` (`source/utils/streamSelection.bs`). Track language names in the menus are localized by `source/utils/languages.bs` ([`translations.md`](translations.md)).

Roku reorders subtitle tracks between what JellyRock provides and what `availableSubtitleTracks` reports, so the player finds a track by matching its name, not its index: `VideoPlayerView.availSubtitleTrackIdx()`, and a second copy, `availableSubtitleTrackIndex()` in `source/utils/trackPickerOptions.bs`, for the host's picker.

### Custom subtitles: fetch and rendering are separate components

Two components, so that exactly one thread writes each one's `m` (decision [`caption-fetch-render-split`](../decisions.md#decision-id-caption-fetch-render-split); [ADR 0014](../adr/0014-non-pool-http-stays-task-blocking.md) has the crash the old single node caused):

- **`LoadCaptionTask`**, Task thread only, fetches one `.vtt` and parses it with `parseVTT()` from `source/utils/webvtt.bs`, pure string work unit-tested in `webvtt.spec.bs`. It keeps cue text only, skipping the header, `NOTE`, `STYLE` and `REGION` blocks and cue identifiers. It reads a timestamp with or without its hour field, and with a comma before the milliseconds (outside the spec, but seen in production); a cue whose timing it cannot read is dropped, with one summary warning per file. A new node runs for each subtitle change, so a second switch during a fetch is not lost ([ADR 0037](../adr/0037-task-run-replacement.md)). It also reports whether the server's fallback font reached disk.
- **`CaptionRenderer`**, a `Group` on the render thread that lives as long as the player, owns the caption timer, the font and style lookups, the `currentPos` and `playerState` bridge, and the fetch node.

`VideoPlayerView` launches no caption Task of its own: it writes `captionRenderer.url` to load a track and `""` to clear one, and appends the published `currentCaption` nodes into `captionGroup`.

**The fetcher accepts only a `.vtt` URL, which is safe only because `vtt` comes first in `getSubtitleProfiles()`:** the server converts an external text track to the first format the client offers. Reordering that list stops every custom track from rendering; `deviceCapabilities-subtitleProfile.spec.bs` pins it.

## Transport control (voice remote and casting)

The players' `handleTransport()` serves two command sources through one dispatch adapter: Roku **voice** transport (`roInputEvent`, `info.type = "transport"`) and the Jellyfin **remote-control receiver** (another Jellyfin client casting; [`remote-control.md`](remote-control.md#two-transports-one-command-stream) owns that side). Voice commands include `play`, `pause`, `seek`, `next`, `startover`, `replay`, `skip`, `nowplaying`, `shuffle`, `loop`, `like` and `dislike`; casting adds `previous`, `seekto` (an absolute seek, where voice `seek` is relative) and `playpause`.

| Piece | Where | What it does |
| --- | --- | --- |
| Manifest flags | `manifest` | `supports_voice_roinput=1`, `supports_etc_seek=1`, `supports_etc_next=1`. Without them Roku shows "command not available" even when the app would handle the command. |
| Dispatch adapter | `source/remotecontrol/remoteDispatch.bs` | `dispatchTransport(evt)` finds the active view (`getActiveView()`, `m.global.activeRoutedView`) and, when it is `PlayerHostView`, `VideoPlayerView` or `AudioPlayerView`, calls its `handleTransport(evt)`, returning `{ status, nowPlaying }` |
| Voice branch | `source/main.bs` | `input.EnableTransportEvents()` opts in. The `roInputEvent` branch calls `dispatchTransport(info)`, answers with `input.EventResponse({ id, status })` (the status picks Roku's on-screen message: `success`, `success.seek-start`, `success.seek-end`, `error.live`, `error.no-media`, `error.redundant`, `error.generic`, `unhandled`) and reports `nowPlaying` to `roAppManager`. Casting calls the same adapter and ignores the answer. |
| Per-player handlers | `VideoPlayerView.handleTransport()`, `AudioPlayerView.handleTransport()` | Each owns its command map. `PlayerHostView.handleTransport()` records the activity for the still-watching count, closes the prompt if it is up, and forwards to its player. The pure parts (the instant-replay setting, voice `seek` payload parsing, bounded seek math) are in `source/utils/voiceTransport.bs`, tested without a player. |

- **Video `skip`** first skips the active media segment (`tryActiveSegmentSkip()`, keyed on `m.activeSegmentId`); with no segment active it moves to the next item, as Roku's spec says.
- **`replay`** goes back `playbackInstantReplaySeconds` (default 10, inside Roku's 10 to 25 second guidance), in video and audio; `voiceTransport.resolveInstantReplaySeconds()` falls back to 10 when the setting is missing or not positive.

To try a command without a voice remote, send it over ECP:

```bash
curl -d '' "http://<roku-ip>:8060/input/dev?id=1&type=transport&command=seek&direction=forward&duration=30"
```

The same `roInput` object also delivers a deep link while the app runs (the `info.DoesExist("contentid")` branch); [`bootstrap.md`](bootstrap.md#deep-links) covers that flow.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md): search by `area` for playback, `VideoPlayerView` or audio-player entries.
