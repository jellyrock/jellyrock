---
pitch: Watch HDR10, HDR10+, HLG and Dolby Vision as they were made, on a 4K Roku and a TV that shows them.
since: 1.0.0
server: 10.7.0
---

# HDR and Dolby Vision

JellyRock asks your Roku which HDR formats your TV can show and tells your Jellyfin server, so HDR video reaches your TV as it was made.

## What you need

- A Roku that plays 4K video.
- A TV that shows the HDR format of the video: HDR10, HDR10+, HLG or Dolby Vision. JellyRock asks for each format only when your Roku reports that your TV shows it.
- For Dolby Vision in MKV files, Jellyfin 10.9 or later. See [Dolby Vision in MKV files](#dolby-vision-in-mkv-files).

## How HDR plays

A video in an HDR format your TV shows plays in that format. A video in an HDR format your TV doesn't show, or any HDR video on a Roku that doesn't play 4K, is converted by your server.

Some files carry Dolby Vision that doesn't follow Dolby's specification, for example some converted from a Blu-ray. When the picture underneath is HDR10, the file plays as HDR10 on a TV that shows HDR10, without Dolby Vision: an MKV file as it is, any other file repackaged by your server. Otherwise your server converts it.

Some Dolby Vision mp4 files are packaged in a way Roku doesn't play. With Jellyfin 10.9 or later, your server repackages them so they play, still in Dolby Vision on a TV that shows it.

**Playback Info** in the player shows the video's HDR format, and the reason when the server converts it. See [Watch in original quality](original-quality.md#see-how-something-is-playing).

## Dolby Vision in MKV files

Roku doesn't play Dolby Vision from MKV files. So when you play one, JellyRock asks your server to repackage the video into a file type your Roku plays Dolby Vision from, without converting the picture. This needs Jellyfin 10.9 or later, a Roku and TV that show Dolby Vision, and a video that is not AV1.

Some of these repackaged streams are too much for the Roku to hold. When one fails like that, JellyRock plays the MKV file as it is instead, without Dolby Vision.

[Preserve DoVi](../app-settings.md#playbackPreserveDovi) turns this on or off. It's on by default.

## Settings

- [Preserve DoVi](../app-settings.md#playbackPreserveDovi): repackage Dolby Vision MKV files so they play in Dolby Vision.
- [Maximum Resolution](../app-settings.md#playbackResolutionMax): a cap below 4K makes the server convert 4K HDR video.

## Troubleshooting

- **A Dolby Vision MKV file plays without Dolby Vision.** Check that [Preserve DoVi](../app-settings.md#playbackPreserveDovi) is on and your server runs Jellyfin 10.9 or later. Then open **Playback Info**: it says whether the stream was repackaged.
- **A Dolby Vision file plays as HDR10.** Its Dolby Vision may not follow Dolby's specification, and JellyRock plays those as HDR10 (see [How HDR plays](#how-hdr-plays)). Open **Playback Info**: a format such as `DV 8.6` is one of them, and Preserve DoVi doesn't change it.
- **A Dolby Vision mp4 file is repackaged by the server.** Open **Playback Info**: a codec tag of `dvh1` means the file is packaged in a way Roku doesn't play, so your server repackaged it (see [How HDR plays](#how-hdr-plays)).
- **HDR video looks washed out or dark.** Open **Playback Info** to see whether the server converted it, and why.
- **Other playback problems.** See [Playback troubleshooting](../playback-troubleshooting.md).
