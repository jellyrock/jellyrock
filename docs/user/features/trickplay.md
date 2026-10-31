---
pitch: See preview pictures of the scene you're skipping to while you fast-forward or rewind.
since: 1.9.0
server: 10.9.0
screenshots: trickplay
---

# Trickplay (preview thumbnails while seeking)

When you fast-forward, rewind or skip through a video, JellyRock shows a row of preview pictures above the progress bar: the scene at the point you'd land on in the middle, with the scenes before and after it on each side. You see where you're going before you let go.

## What you need

- **Jellyfin 10.9 or later.**
- **Trickplay images for the video on your server.** Jellyfin makes them from each video when an admin turns trickplay on for the library. A video the server has made no images for plays as usual, without previews.

## Use it

While a video plays, press **Left**, **Right**, **Fast Forward** or **Rewind** to start seeking. The preview pictures follow the position on the progress bar: the picture in the middle is where playback goes on from when you finish seeking.

JellyRock picks the size of the pictures your server made that best fits your screen, and loads them ahead in the direction you're seeking, so they keep up while you hold the button.

## Troubleshooting

- **No preview pictures.** Your server has no trickplay images for that video, or runs a Jellyfin release older than 10.9. Ask your server's admin whether trickplay is turned on for that library and the images are done.
