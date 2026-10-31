---
pitch: Hear 5.1 and 7.1 sound on your soundbar or receiver, kept as surround even when the server has to convert it.
since: 1.0.0
server: 10.7.0
---

# Surround sound

JellyRock asks your Roku which surround formats your TV, soundbar or receiver can play, and tells your Jellyfin server. Surround audio your system can play goes to it as it is. When the server has to convert the sound, JellyRock asks for surround, not stereo.

## What you need

- A soundbar, receiver or TV that plays surround sound, connected to your Roku.
- Your Roku's audio settings set to send surround to it. The formats your Roku reports are the ones JellyRock asks for.

## How each format plays

- **Dolby Digital (AC3) and Dolby Digital Plus (EAC3)** play as they are. Your Roku sends them to a surround system that supports them, and mixes them down to stereo itself when there is none.
- **DTS** plays as it is, up to 5.1, when your audio system supports it.
- **Dolby TrueHD, DTS-HD and DTS:X** are converted by your server to Dolby Digital Plus or Dolby Digital, still in surround. Roku doesn't play these formats reliably, so JellyRock never asks for them as they are.
- **Opus, AAC, FLAC, ALAC, PCM and Vorbis** in surround are decoded by your Roku itself, unless you turn off [Decode Multichannel Audio](../app-settings.md#playbackDecodeMultichannelAudio).
- **Stereo sound** stays stereo: JellyRock never asks the server to turn it into surround.

When you switch audio tracks during a video, the new track plays as it is if your system supports it. Otherwise the video reloads at the same point with the converted track.

**Playback Info** in the player shows the audio format of the file and what the server converts it to. See [Watch in original quality](original-quality.md#see-how-something-is-playing).

## Settings

- [Decode Multichannel Audio](../app-settings.md#playbackDecodeMultichannelAudio): on by default. Turn it off if surround sound is garbled or distorted, or to have the server convert these formats into one your receiver plays itself.
- [Preferred Surround Audio Codec](../app-settings.md#playbackPreferredMultichannelCodec): the format the server converts surround sound to: Dolby Digital Plus (EAC3), the default, or Dolby Digital (AC3) for older receivers. The menu also offers DTS, and picking it currently gets you Dolby Digital Plus.

## Troubleshooting

- **Garbled or distorted surround sound.** Turn off [Decode Multichannel Audio](../app-settings.md#playbackDecodeMultichannelAudio).
- **Stereo where you expected surround.** Check your Roku's audio settings, then open **Playback Info** to see which format the file has and what the server sends.
- **No sound at all.** See [Playback troubleshooting](../playback-troubleshooting.md).
