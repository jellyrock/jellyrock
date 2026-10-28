# Rules for `components/video/`

The video playback subsystem. [docs/architecture/playback.md](../../docs/architecture/playback.md) has the full picture: the video player, the OSD, trickplay, how the server's playback decision is read, the Dolby Vision fallback, multichannel audio and Live TV mode.

## Player invariants

- There is **exactly one** video player component: `VideoPlayerView`. The legacy `JRVideo` was removed (see "Recently removed" in [`tech-debt.md`](../../docs/architecture/tech-debt.md)); don't reintroduce a parallel player.
- `VideoPlayerView` extends Roku's native `Video` node and inherits its whole playback state machine. Don't replicate that state machine.
- **A live `Video` node with no stream is not a blank screen.** It keeps drawing Roku's own buffering ring (its internal `retrievingBar` and `bufferingBar` `ProgressBar` nodes, which `init()` recolors), so a player left mounted after the stream stops shows a ring reading `0%`: the app claiming to load, forever. On a Stick 4K (2026-09-03, #876) the app's own spinner read `visible: false` at the same instant, which is how you tell the two apart. If you keep a player mounted without navigating away, **hide the node** (`parkPlayerAfterSupersede` is the one case that does) **and** flag it parked. `stateAllowsOSD()` admits `"stopped"`, so otherwise `Up` opens an OSD inside a hidden parent: a control surface that draws nothing while holding the focus `Back` needs.
- **Nothing may touch `VideoPlayerView` after its `host.callFunc(...)` into `PlayerHostView` returns.** The host can destroy the calling player synchronously (a remount runs its `onDestroy`, which releases its members), and control then returns into a component that no longer has them. On a Stick 4K (2026-09-24, #1018), `bufferCheck` touching `m.bufferCheckTimer` after `onLiveStreamStalled` restarted the channel crashed the app (`&he4`). `switchToQueueItem`, `exitFromPlaybackError` and `bufferCheck` end on their host call for this reason, and the voice `stop` in `handleTransport` returns only a literal after its `exitPlayback`.
- Track selection before playback happens in the `TrackDropdown` cluster inside `ItemDetails`. **During playback** it happens through the `PlayerHostView` dialog handlers (`onSelectAudioPressed`, `onSelectSubtitlePressed`, `onSelectVideoSourcePressed`). Both write the same `VideoPlayerView` fields: they are parallel entry points, not duplicates.

## OSD

- One `OSD` instance per `VideoPlayerView`. It hides after 5 seconds without input (`inactiveTimeout="5"` on the instance in `VideoPlayerView.xml`).
- **A gear pick lasts for the playback and the rest of its queue, and is never saved.** `QueueManager` holds it beside the version pick, and Settings stays the default. It reaches the request as the `caps` argument of `getDeviceProfile()`, so read caps through that argument or `playbackCaps.bs`, never by writing the setting. A new gear row goes in `playbackSettingsMenu.rows()`. See [playback.md](../../docs/architecture/playback.md#playback-settings-the-gear).
- For a Live TV channel the OSD adapts: a `goToLive` button, the behind-live math (in `source/utils/liveTv.bs`), and times from the guide data and the wall clock, falling back to the player's `positionTime` when program timing is missing. A DVR recording gets episode-style titles only. See [playback.md](../../docs/architecture/playback.md#live-tv-mode).

## How an item plays

- **The server decides.** `getDeviceProfile()` in `source/utils/deviceCapabilities.bs` builds the device profile, and `buildPlaybackInfoPostData()` in `source/api/items.bs` builds the `PlaybackInfo` request around it. `LoadVideoContentTask` reads the answer in two branches: when the source `SupportsDirectPlay`, it plays the file; otherwise it plays the `TranscodingUrl`, a remux or a full transcode. Don't replicate codec-capability logic in player code: change the profile.
- **The Dolby Vision fallback is complex on purpose:** the `playbackPreserveDovi` setting, the `isRetrying` flag and the `shouldBypassDoviPreservation` retry. Don't simplify it; it handles a real `buffer:loop:` source overflow on Roku.
- **Multichannel audio:** only what Roku documents and the device reports is direct-played. A multichannel source that must be transcoded is steered to surround: `resolveMultichannelSurroundTarget()` puts `eac3` or `ac3` first. For a stereo source, `optimizeAudioCodecListForSource()` strips the surround codecs (`surroundCodecs` in `items.bs`) from the list. `dts` and `truehd` are never transcode targets: the server copies them, and Roku plays DTS copied into `fMP4` HLS silent ([playback.md](../../docs/architecture/playback.md)).

## Trickplay

- `TrickplayCarousel` shows the scrub thumbnails, and `TrickplayTileLoader`, a Task, fetches the tiles, ahead in the scrub direction first. On a low-memory device (`m.global.device.isLowMemoryDevice`) the tiles load at half size, to protect texture memory.
- Don't fetch tiles synchronously from the player: always through the loader Task.

## Notifications

- Two `VideoNotification` pop-ups, declared in `VideoPlayerView.xml`, can show during playback. **Next Episode** counts down near the end of an episode and hides when the countdown ends or its conditions lapse; it has no timer of its own. **The media-segment skip button** hides itself after 10 seconds. See [playback.md](../../docs/architecture/playback.md#videonotification).
- Don't add a third notification component without working out its z-order and focus with the other two.

## Reporting playback to Jellyfin

- Positions are in **Jellyfin ticks** (`int(positionSeconds) * 10000000&`). One tick is 100 ns.
- Reports go through `GetApi().BuildPlaystateRequest()` and `SubmitSideEffect()`: fire and forget, never blocking playback.
- What is reported: `start` once, `update` every 10 seconds while playing and once when paused, and the stream's end once, only through `reportPlaybackEnd()`.
- **A stream that never reported `start` still reports its end, marked `Failed`.** Don't skip that stop: it is what makes the server stop the transcode. For Live TV, **exactly one release per stream**: a stream that reported `start` is released by its stop, and one that never did by a close by id, with its stop leaving `LiveStreamId` out (`endClosesLiveStream()` decides, `liveStreamReportFields()` builds the report). Never both: what a stop naming a never-started stream does varies by server version and by who else is watching, and a second release ends another viewer's shared stream (the table is in playback.md). And don't send it unmarked: the position read before the first frame (usually 0) would replace the resume point (#969). [playback.md](../../docs/architecture/playback.md#reportplayback--server-side-reporting) has the full rule.
- **Never only `STOP` the video load (`m.LoadMetaDataTask`) when the view goes away; `releaseVideoLoad()` decides.** A load stopped while its `PlaybackInfo` is opening a Live TV stream loses the only answer that names the stream, and the server keeps it open; a load that already holds the stream must have it closed. The load records its stage on `liveStream`, and the view marks it `handedOver` or `released` when it takes or closes the stream, so exactly one party releases each stream ([playback.md](../../docs/architecture/playback.md#a-live-stream-the-player-never-held), `source/utils/liveStreamHandoff.bs`).

## What not to do

- Don't move decision logic into the player. `LoadVideoContentTask` reads the server's answer and builds the URL; `VideoPlayerView` *reacts* to the result (the Dolby Vision `buffer:loop:` retry, the reload after an audio track change on a transcoded stream). Don't move the reactions into the loader either.
- Don't bypass the queue. A play press fills the queue and reaches the `/details/:type/:id/play` route (through the `playbackLaunchRequest` signal from `QueueManager.playQueue()`, which every launcher and the details screen end in), so `PlayerHostView` mounts the player from the current queue item.
- Don't observe the player's `state` from outside it. `PlayerHostView.onPlayerStateChange` is the one handler for the end of playback and queue advancement: the routed host owns the player as a child.
