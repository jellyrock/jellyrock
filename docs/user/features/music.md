---
pitch: Browse your music by artist, album or genre, play albums and instant mixes, and read a song's lyrics.
since: 1.0.0
server: 10.7.0
---

# Music

Play the music on your Jellyfin server: browse it by artist, album or genre, play or shuffle an album, start an instant mix, and read along with the lyrics.

## What you need

- A music library on your Jellyfin server.
- For lyrics, Jellyfin 10.9 or later, and lyrics your server already has for the song.

## Browse your music

Open your music library from Home. Press the options button (**\***) to choose how to browse it: **Album Artists**, **Albums**, **Artists** or **Genres**. The same menu sorts the list by title, date added or at random, and filters it to your favorites.

## Play music

- On an album, artist or song page, press **Play** to start it. On an album or artist page, **Shuffle** plays it in random order.
- Press **Instant Mix** on an artist, album or song page for a mix of similar music from your library.

The now-playing screen shows the album art, the song, the artist and the progress, with buttons for previous, play and pause, next, **shuffle** and **repeat**. Press **Back** to leave it; the music stops.

You can also control the music by voice, shuffle and repeat included: see [Voice control](voice-control.md).

When the music plays with no button pressed for as long as your Roku waits before its screensaver, JellyRock shows a screensaver of its own with the album art.

## Lyrics

A song's page shows its lyrics when your server has them.

## Troubleshooting

- **No lyrics on a song.** Your server has no lyrics for it, or runs a Jellyfin release older than 10.9.
- **Seeking in a FLAC song takes a moment.** For some FLAC files, JellyRock asks your server for a new stream at the new position, so the song pauses briefly while it loads.
