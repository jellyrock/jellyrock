# ADR 0052: A seek in a direct-played FLAC loads a FLAC stream the server starts at the target

**Status:** Accepted
**Date:** 2026-10-21

**related-files**: `source/utils/audioSeek.bs`, `source/api/items.bs`, `components/mediaPlayers/AudioPlayer.bs`, `components/music/AudioPlayerView.bs`, `docs/architecture/playback.md`

Roku can't finish a FLAC it starts at a non-zero position (a `seek` or a `PlayStart`) when the file's last frame is shorter than its frame size, which is most FLACs. Mid-track it stalls in `playing` a moment before the end, so the queue never moves on (#662). Near the end it reports `finished` at once with "malformed data", skipping the rest. Measured 2026-10-21 on a Stick 4K (Roku OS 15.3.4), about 70 runs: the demo FLAC "Jellyfin" froze 13 of 13 times after a 50% seek. The seek method, `seekMode`, `autoplayAfterSeek`, `StreamFormat`, a seek table, the embedded picture, the sample rate and the `Video` or `Audio` node made no difference. Removing the short last frame cured it. MP3, AAC, ALAC, WAV and Vorbis seek and end cleanly. So `audioSeek.startAction()` sends a FLAC seek above 0 to `AudioStream(id, start, true)`: `PlaybackInfo` with `StartTimeTicks`, `EnableDirectPlay: false` and one FLAC transcoding profile without `MaxAudioChannels`. Roku plays that stream from zero and finishes it, and its decoded samples matched the source's. A seek to 0 reloads the direct stream, and anything not FLAC keeps its native seek.

Without the user's `EnableAudioPlaybackTranscoding` policy, or when the server stream fails, the seek falls back to a native seek (or the direct stream with a `PlayStart`). The `AudioPlayer` end guard then ends a track left stuck at its end, and a one-time toast tells the listener when the policy is the cause.

**Ruled out:** the guard alone (it ends a stuck track but can't recover the skipped seconds or early ends); transcoding every FLAC to AAC (loses lossless for every listener); the `Audio` node (the same defect, and only `Video` has `disableScreenSaver`).

**Check again:** an in-stream seek inside a server stream is ignored, so every FLAC seek reloads (1.3 to 2.0 s on the Stick 4K). Whether Jellyfin 10.7 and 10.8 serve the stream is unverified. A Roku firmware fix would let FLAC seek natively; the minimal reproduction is the same FLAC with and without its short last frame.
