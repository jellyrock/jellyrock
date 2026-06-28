# Playback troubleshooting (no sound, no video, stutter, wrong audio)

This guide exists to get a playback problem **fixed fast**. Most playback bugs come
down to one specific file, one codec, or one audio-output setup, and without that detail
a report can't be reproduced or fixed no matter how clearly the symptom is described.

If you read nothing else, read **[The three things that let us fix it](#the-three-things-that-let-us-fix-it)**.
Attaching those to your issue is the single biggest thing you can do to get a fix.

---

## First, the 60-second self-checks

Do these before filing. They resolve a good share of "no sound" / "won't play" reports
outright:

1. **Update to the latest JellyRock.** Bugs get fixed continuously and releases reach
   devices on a delay. Confirm your version in JellyRock's **Settings** (bottom of the
   screen) and compare against the
   [latest release](https://github.com/jellyrock/jellyrock/releases). If you're behind,
   update and re-test before filing.
2. **Check your Roku's audio output setting** (for *no-sound* problems). On your Roku:
   **Settings → Audio → HDMI** (or **S/PDIF and ARC**). Try switching between
   "Auto detect", "Dolby Digital Plus", "Dolby Digital", and "Stereo". A surround setting
   that your TV or soundbar can't actually decode is a very common cause of silence, and
   it isn't something the app controls.
3. **Does it happen on every file, or only some?** "Some videos are silent, others are
   fine" points at a **specific codec or container**, which is exactly the thing we need
   to know (see below). "Everything is silent" points at the audio-output setting in
   step 2.
4. **Does the same file play with sound in the Jellyfin web player or the official Roku
   app?** If those are fine but JellyRock is silent, note that. It tells us the server
   *can* produce sound for this file and the difference is on JellyRock's side. If the
   file is *also* silent there, the problem is likely server-side (transcoding / ffmpeg)
   rather than JellyRock.

---

## The three things that let us fix it

For a playback issue, especially **no sound on some files**, these three pieces turn a
report we can't reproduce into one we can fix. Even one or two of them helps a lot.

### 1. The Media Info for one file that fails

Pick a single file that reproduces the problem. In the **Jellyfin web interface**, open
that item, click **⋯ (more) → Media Info** (or the info panel on the item page).
Screenshot or copy the stream details. We specifically need:

- **Audio codec** (e.g. TrueHD, DTS, DTS-HD MA, E-AC-3 / EAC3, AC3, AAC, FLAC, Opus)
- **Channels / layout** (e.g. 2.0 stereo, 5.1, 7.1)
- **Video codec** (e.g. H.264, HEVC, AV1) and the **container** (mkv, mp4, ...)

The whole stream list matters. Sound problems sometimes depend on the **video codec or
container** (an AV1 video or a particular container can change the transcode path, and
with it how audio is handled), so don't trim it to just the audio line.

### 2. How your Roku audio is connected

One line plus, ideally, a photo or screenshot of your Roku's **Settings → Audio** screen:

- Is the Roku plugged **directly into a TV**, or into an **AV receiver / soundbar**?
- What is **Settings → Audio → Audio mode / HDMI / S/PDIF** currently set to?

Bitstream surround vs. on-device stereo decode behaves very differently depending on
this, so it changes what the right fix is.

### 3. A short sample clip, *or* the server's transcode log

Either one lets us reproduce directly. Pick whichever is easier for you.

**Option A, a short sample clip (best).** Sending the whole movie is impractical (they're
huge), but a short slice that keeps **every stream exactly as-is** reproduces the bug
perfectly. See [Make a sample clip](#make-a-sample-clip) below for a copy-paste command.

**Option B, the Jellyfin server's ffmpeg log for that playback.** This requires no file
transfer and no Roku tinkering. See
[Grab the Jellyfin transcode log](#grab-the-jellyfin-transcode-log).

---

## Make a sample clip

This takes a **60-second** slice starting at 1 minute in and copies every stream
**without re-encoding**, so the video codec, audio codec, channel layout, and container
are byte-for-byte identical to the original. That faithfulness is exactly what makes it
reproduce the bug.

You need [ffmpeg](https://ffmpeg.org/download.html) (free, all platforms). Then:

```bash
ffmpeg -ss 00:01:00 -i "INPUT_FILE" -t 00:01:00 -map 0 -c copy "sample.mkv"
```

- Replace `INPUT_FILE` with the path to the problem file (keep the quotes).
- `-ss 00:01:00` is where the clip starts; `-t 00:01:00` is its length (60 seconds). For
  a "no sound" problem that's plenty, the silence shows up immediately. Move `-ss` if the
  problem only appears at a specific spot.
- `-map 0 -c copy` keeps **all** streams (video, every audio track, subtitles) and copies
  them as-is. No quality loss, no codec change, runs in seconds.

**Don't shrink it by stripping streams or re-encoding.** Removing the video track or
re-encoding to reduce size can change the codec or container and **hide the very bug** we
need to see (some no-sound cases depend on the video codec, e.g. AV1, or the container).
If you need it smaller, lower the duration (`-t 00:00:30`). Never alter the streams.

### Sending it: use a link, not the GitHub box

A stream-copied clip keeps the source bitrate, so even a 60-second slice of a typical
movie is often tens to a couple hundred MB, well past GitHub's inline attachment limit.
**Don't try to drag it onto the issue.** Upload it to any file host (Google Drive,
Dropbox, etc.) and paste the **share link** into your report instead.

> Already confirmed the problem file plays fine in the Jellyfin web player or official
> Roku app but is silent in JellyRock? Say so. It means the sample will reproduce on our
> end too.

---

## Grab the Jellyfin transcode log

When a file is being transcoded (the usual case for "unsupported audio format"), the
**Jellyfin server** logs the exact ffmpeg command and how it mapped the audio. That log
often shows immediately whether an audio stream is even being produced.

1. Start playing the problem file in JellyRock until the symptom appears, then stop.
2. In the **Jellyfin web admin dashboard**: **Dashboard → Logs**.
3. Open the most recent **`FFmpeg.Transcode-*.log`** (or the transcode log for that
   session) and attach it to the issue. The first ~30 lines (the ffmpeg command line and
   stream mapping) are the important part. A text log is small, so this one *does* fit the
   GitHub attachment box.

---

## Advanced: JellyRock debug log from the Roku

Only needed if we ask for it. The items above resolve most cases. The Roku-side
BrightScript console log requires sideloading a developer build:

- Sideload / developer-mode instructions:
  [README → Sideload / Beta Test](https://github.com/jellyrock/jellyrock#sideload--beta-test)
- Maintainer notes on debug flags live in
  [`docs/dev/debug-flags.md`](../dev/debug-flags.md).

---

## What happens after you file

A report with the **Media Info, audio setup, and a sample or transcode log** can usually
be reproduced and fixed directly. A report with only "some videos have no sound" cannot
be, because there's nothing to reproduce, so it will mostly result in us linking back
here and asking for the items above. Saving that round-trip by attaching them up front is
the fastest path to a fix.
