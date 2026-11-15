# ADR 0059: A Roku audio track id comes from the MKV header, read alongside `PlaybackInfo`

**Status:** Accepted
**Date:** 2026-11-13

**related-files**: `components/ItemGrid/LoadVideoContentTask.bs`, `source/utils/mkvTracks.bs`, `source/utils/rokuAudioTrack.bs`, `components/video/VideoPlayerView.bs`, `source/constants/timeouts.bs`, `docs/architecture/playback.md`

A Roku Video node names an MKV audio track by the `TrackNumber` stored in the file's header. Its `availableAudioTracks` list is in header order, whatever the device language, and leaves out tracks the device can't play, which depends on the HDMI chain. Jellyfin numbers streams in file order but moves sidecar streams (first on 10.8 and later, last on 10.7), and never exposes the stored number. So `LoadVideoContentTask` reads the first `MKV_TRACK_READ_BYTES` of an MKV direct-play source with a raw `roUrlTransfer` into `tmp:`, alongside the `PlaybackInfo` request, and parses the track entries (`mkvTrackEntries()`). `audioStreamsWithRokuTracks()` then gives each embedded audio stream the number of the audio entry in the same place among the audio entries. Without the header, the id is the stream's position among the embedded video, audio and subtitle streams, plus one. In that case the Roku's list order is used only when its ids run out of order and it lists every embedded audio track.

Matching by "Nth same-language track" (from #500) and "Index + 1" were both wrong: #1377 played a commentary because the Roku left out a TrueHD track ahead of it, and any sidecar file shifts Jellyfin's index. The read assumes the server honors `Range`. Every Jellyfin version from 10.7 to 12.4 does. Behind a proxy that strips it, up to `MKV_TRACK_READ_MS` of the whole file streams into `tmp:` before the cancel, and that proxy already breaks seeking in direct play.

**Ruled out:** matching on the Roku's list alone (with numbers out of order it can't tell which tracks were left out); reading the header only when the list disagrees (the correction lands after playback starts, as an audible switch); routing the read through the API pool (it carries only text and JSON, so it would need a binary mode on the path every request takes); caching headers in `cachefs:` (a replaced file would map against the old header).
