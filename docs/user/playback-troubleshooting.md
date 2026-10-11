# Playback troubleshooting (no sound, no video, stutter, wrong audio)

This guide helps you get a playback problem fixed fast. Most playback bugs come down to one file, one codec or one audio setup. Without that detail, a report can't be reproduced or fixed, however clearly it describes the symptom.

If you read one section, read [The three things that let us fix it](#the-three-things-that-let-us-fix-it). Attaching those to your issue is the best thing you can do to get a fix.

## First, the 60-second self-checks

Do these before you file. They solve many "no sound" and "won't play" reports on their own:

1. **Update to the latest JellyRock.** Bugs are fixed all the time, and releases reach devices with a delay. Find your version at the bottom of JellyRock's **Settings** screen and compare it with the [latest release](https://github.com/jellyrock/jellyrock/releases). If you're behind, update and test again before you file.
2. **Check your Roku's audio output setting** (for no-sound problems). On your Roku, go to **Settings → Audio → HDMI** (or **S/PDIF and ARC**). Try each of "Auto detect", "Dolby Digital Plus", "Dolby Digital" and "Stereo". A surround setting your TV or soundbar can't decode is a common cause of silence, and the app doesn't control it.
3. **Does it happen on every file, or only some?** If some videos are silent and others are fine, a specific codec or container is the likely cause, and that is what we need to know (see below). If everything is silent, look at the audio setting in step 2.
4. **Does the same file play with sound in the Jellyfin web player or the official Roku app?** If it does but JellyRock is silent, say so. It tells us the server can produce sound for this file, so the difference is in JellyRock. If the file is silent there too, the problem is likely on the server (transcoding or ffmpeg), not in JellyRock.

## The three things that let us fix it

For a playback issue, and above all for no sound on some files, these three things turn a report we can't reproduce into one we can fix. Even one or two of them helps.

### 1. The media info for one file that fails

Pick one file that shows the problem. In the Jellyfin web app, open the item and select **⋯ (more) → Media Info**, or open the info panel on the item page. Take a screenshot or copy the stream details. We need:

- **Audio codec**, for example TrueHD, DTS, DTS-HD MA, E-AC-3 (EAC3), AC3, AAC, FLAC or Opus
- **Channels or layout**, for example 2.0 stereo, 5.1 or 7.1
- **Video codec**, for example H.264, HEVC or AV1, and the **container**, for example mkv or mp4

Send the whole stream list. Sound problems sometimes depend on the video codec or the container: an AV1 video or a particular container can change how the server transcodes, and with it how audio is handled. Don't cut the list down to the audio line.

### 2. How your Roku audio is connected

Write one line, and if you can, add a photo or screenshot of your Roku's **Settings → Audio** screen:

- Is the Roku plugged straight into a TV, or into an AV receiver or soundbar?
- What is **Settings → Audio → Audio mode / HDMI / S/PDIF** set to?

Sending surround sound to a receiver and decoding to stereo on the Roku behave very differently. The right fix depends on which one you have.

### 3. A short sample clip, or the server's transcode log

Either one lets us reproduce the problem. Pick whichever is easier.

**Option A: a short sample clip (best).** A whole movie is too large to send. A short slice that keeps every stream exactly as it is reproduces the bug just as well. See [Make a sample clip](#make-a-sample-clip) for a command to copy.

**Option B: the Jellyfin server's ffmpeg log for that playback.** You send no file and change nothing on your Roku. See [Grab the Jellyfin transcode log](#grab-the-jellyfin-transcode-log).

## Make a sample clip

This command takes a 60-second slice, starting 1 minute in. It copies every stream without re-encoding, so the video codec, audio codec, channel layout and container are identical to the original. That is what lets the clip reproduce the bug.

You need [ffmpeg](https://ffmpeg.org/download.html), which is free for all platforms. Then run:

```bash
ffmpeg -ss 00:01:00 -i "INPUT_FILE" -t 00:01:00 -map 0 -c copy "sample.mkv"
```

- Replace `INPUT_FILE` with the path to the problem file, and keep the quotes.
- `-ss 00:01:00` is where the clip starts, and `-t 00:01:00` is its length (60 seconds). For a no-sound problem that is plenty, because the silence shows at once. Move `-ss` if the problem only appears at one spot.
- `-map 0 -c copy` keeps every stream (video, every audio track, subtitles) and copies them unchanged. You lose no quality, no codec changes, and it runs in seconds.

**Don't make it smaller by removing streams or re-encoding.** Removing the video track or re-encoding can change the codec or container and hide the bug we need to see. Some no-sound cases depend on the video codec (AV1, for example) or on the container. If you need a smaller file, shorten it (`-t 00:00:30`). Leave the streams as they are.

### Sending it: use a link, not the GitHub box

A stream-copied clip keeps the original bitrate. Even a 60-second slice of a typical movie is often tens to a couple of hundred MB, far over GitHub's attachment limit, so don't drag it onto the issue. Upload it to any file host, such as Google Drive or Dropbox, and paste the share link into your report.

> Have you already seen the problem file play fine in the Jellyfin web player or the official Roku app, but play silent in JellyRock? Say so. It means the sample will reproduce on our side too.

## Grab the Jellyfin transcode log

When a file is transcoded (the usual case for "unsupported audio format"), the Jellyfin server logs the exact ffmpeg command and how it mapped the audio. That log often shows straight away whether an audio stream is produced at all.

1. Play the problem file in JellyRock until the problem appears, then stop.
2. In the Jellyfin web app, go to **Dashboard → Logs**.
3. Open the newest **`FFmpeg.Transcode-*.log`** (or the transcode log for that session) and attach it to the issue. The first 30 or so lines, the ffmpeg command and the stream mapping, matter most. A text log is small, so this one fits in GitHub's attachment box.

## Advanced: JellyRock debug log from the Roku

You need this only if we ask for it. The sections above solve most cases. The debug log from the Roku needs a developer build installed on it:

- To install a developer build, see [Sideload / beta test](https://github.com/jellyrock/jellyrock#sideload--beta-test) in the README.
- Maintainer notes on debug flags are in [`docs/dev/debug-flags.md`](../dev/debug-flags.md).

## What happens after you file

With the media info, your audio setup, and a sample clip or transcode log, we can usually reproduce and fix the problem. A report that only says "some videos have no sound" gives us nothing to reproduce. We will reply with a link to this page and ask for the items above. Attach them when you file and you save that round trip.
