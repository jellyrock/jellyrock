# Rules for `components/video/`

Video playback subsystem. See [docs/architecture/playback.md](../../docs/architecture/playback.md) for the full picture (canonical video player, OSD, trickplay, transcoding decisions, DoVi fallback, multichannel audio handling, Live TV / DVR-recording mode).

## Player invariants

- There is **exactly one** video player component: `VideoPlayerView`. The legacy `JRVideo` was removed (see `docs/architecture/tech-debt.md`'s "Recently removed"); don't reintroduce a parallel player.
- `VideoPlayerView` extends Roku's native `Video` node. Inherits the full media-playback state machine; do NOT replicate state-machine logic.
- **A live `Video` node with no stream is NOT a blank screen.** It keeps drawing Roku's own buffering indicator (the internal `retrievingBar` / `bufferingBar` ProgressBars — `bufferingBar` is the one `init` styles), so a player left mounted after the stream stops shows a ring reading `0%`: the app claiming to load, forever. Measured on a Stick 4K; the app's own spinner reads `visible: false` at the same instant, which is how you tell the two apart. If you keep a player mounted without navigating away, **hide the node** — `parkPlayerAfterSupersede` is the one case that does — **and** flag it parked, because `stateAllowsOSD()` admits `"stopped"` and `Up` would otherwise open an OSD inside a hidden parent: a control surface rendering nothing while holding the focus `Back` needs.
- Pre-playback track selection happens in `ItemDetails`'s inline `TrackDropdown` cluster. **Playback-time** track selection happens via `PlayerHostView` dialog handlers (`onSelectAudioPressed` / `onSelectSubtitlePressed` / `onSelectVideoSourcePressed`). Both write to the same `VideoPlayerView` fields — they're parallel entry points, not duplicates.

## OSD

- Single `OSD` instance per `VideoPlayerView`. Auto-hides after `5s` of inactivity (`inactiveTimeout="5"` on the instance in `VideoPlayerView.xml`).
- Live TV / DVR recording mode adapts the OSD: `goToLive` button, hybrid behind-live math (in `source/utils/liveTv.bs`), wall-clock fallback when stream metadata is missing. See [docs/architecture/playback.md](../../docs/architecture/playback.md#live-tv--dvr-recording-mode).

## Transcoding

- Decision tree (Direct Play → Direct Stream → Transcode) lives in `source/api/items.bs` + `source/utils/deviceCapabilities.bs`. Don't replicate the codec-capability logic in player code; surface fields and let the items layer decide.
- **DoVi fallback path is sophisticated** — `playbackPreserveDovi` setting + `isRetrying` flag + `shouldBypassDoviPreservation` retry. Don't simplify it; it handles a real `buffer:loop:` source overflow on Roku.
- **Multichannel audio is direct-play by default** on surround-capable hardware; the transcoder is steered toward surround codecs (`eac3`/`ac3`/`dts`) when transcoding is required. The `surroundCodecs` list in `items.bs` is intentionally distinct from `stereoOutputCodecs` in `deviceCapabilities.bs`.

## Trickplay

- `TrickplayCarousel` + `TrickplayTileLoader` (an async Task). Prefetch range scaled down on `m.global.device.isLowMemoryDevice` (texture-memory protection).
- Don't pre-fetch tiles synchronously from the player — always async via the loader Task.

## Notifications

- Two `VideoNotification` instances overlay during playback: one for next-episode, one for media-segment skips. Both auto-dismiss on a timer.
- Don't add a third notification component without thinking about z-order / focus interactions.

## Reporting playback to Jellyfin

- Position is in **Jellyfin ticks** (`int(positionSeconds) * 10000000&`). 1 tick = 100 ns.
- Reports go through `GetApi().BuildPlaystateRequest()` + `SubmitSideEffect()` (fire-and-forget; never blocks playback).
- States reported: `start` (once), `update` (every `10s` while playing/paused), `stop` (once on finished/stopped).

## What NOT to do

- Transcode *decisions* (Direct Play / Direct Stream / Transcode, codec capability checks, URL building) live in `LoadVideoContentTask.bs`. `VideoPlayerView.bs` *consumes* the result and *reacts* to it (DoVi `buffer:loop:` retry, audio-track-change reload for transcoded streams). Don't move decision logic into the player; don't move reaction logic into the loader.
- Don't bypass the queue: a play press should populate the queue and reach the `/details/:type/:id/play` route (via `QueueManager.playQueue()`'s `playbackLaunchRequest` signal, or `ItemDetails`'s direct `navigateTo`) so `PlayerHostView` mounts the player from the current queue item.
- Don't observe `state` directly from outside the player — `PlayerHostView.onPlayerStateChange` is the canonical end-of-playback / queue-advancement handler (the routed host owns the player as a child).
