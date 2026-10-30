---
pitch: Play your files as they are, with no conversion, whenever your Roku can, and see why when it can't.
since: 1.0.0
server: 10.7.0
highlight: 4
---

# Watch in original quality

JellyRock tells your Jellyfin server exactly what your Roku can play. When your Roku can play a file as it is, the server sends it untouched: the full picture and sound quality, and no work for the server. When it can't, the server converts only what it has to, and JellyRock shows you why.

## How a file plays

Your server picks one of three ways for each file:

- **Direct playing:** your Roku plays the file as it is. This is the best quality.
- **Direct streaming:** the server repackages the file without changing the picture or sound, for example when your Roku can play what's inside but not the file type.
- **Transcoding:** the server converts the picture, the sound or both, because your Roku can't play them as they are, or because a setting asks for a lower quality.

## See how something is playing

While a video plays, press **Up** or **Down** to show the player controls, and select the info button at the right. **Playback Info** shows:

- whether the video is direct playing, direct streaming or transcoding;
- the reason the server gave for any conversion, and the JellyRock setting behind it when there is one;
- the video, audio and subtitle tracks, and what the server converts them to when it says;
- where the stream comes from.

Take a photo of this screen when you report a playback problem.

## Lower the quality for one video

On a slow connection, select the gear button next to the info button and set a **Maximum Bitrate** or a **Maximum Resolution**. The video reloads where you were. Your pick lasts for this video and the rest of what you queued with it; the next thing you play uses your settings again.

## Settings

- [Maximum Bitrate](../app-settings.md#playbackBitrateLimit), turned on with [Enable Limit](../app-settings.md#playbackBitrateMaxLimited), and [Maximum Resolution](../app-settings.md#playbackResolutionMax): caps for every video. Leave them off to get the original quality.
- [Text Subtitles Only](../app-settings.md#playbackSubsOnlyText): shows only text subtitles, because picture-based subtitles make the server transcode the video to draw them in.
- [MPEG-2](../app-settings.md#playbackMpeg2) and [MPEG-4](../app-settings.md#playbackMpeg4): whether your Roku plays these older formats itself.
- [H.264](../app-settings.md#playbackTryDirectH264ProfileLevel) and [HEVC](../app-settings.md#playbackTryDirectHevcProfileLevel) profile levels: try a file your Roku might not support directly before falling back to transcoding.
- [Force Transcode Anamorphic Video](../app-settings.md#playbackForceTranscodeAnamorphic): turn it on if the picture looks squished or stretched.

## Troubleshooting

- **A video transcodes and you expected it not to.** Open **Playback Info**: it names the reason. If it names a JellyRock setting, change that setting.
- **No sound, no picture or stuttering.** See [Playback troubleshooting](../playback-troubleshooting.md).

Sound and HDR have pages of their own: [Surround sound](surround-sound.md) and [HDR and Dolby Vision](hdr-dolby-vision.md).
