---
pitch: Cast from a Jellyfin app on your phone or browser to your Roku, then pause, seek and skip from there.
since: 2.23.0
server: 10.7.0
highlight: 2
---

# Cast from another Jellyfin app

Pick something in the Jellyfin app on your phone or in your browser, send it to your Roku, and JellyRock plays it. Then use that app as a remote: pause, seek, skip or stop without picking up the Roku remote.

## What you need

- **JellyRock open and signed in** to the same server as the app you cast from. To cast while JellyRock is closed, see [Cast while JellyRock is closed](#cast-while-jellyrock-is-closed).
- **On an HTTPS server, the JellyRock Companion plugin.** On an HTTP server you need nothing else. See [Jellyfin server plugins](../jellyfin-server-plugins.md) to install it.

## Cast something

1. In the Jellyfin app, open the cast or **Play On** menu and pick your Roku running JellyRock.
2. Play a movie, an episode, a song or anything else. JellyRock starts it on your TV.

After an episode, JellyRock moves on to the next one as usual. Casting a music album plays its first track.

## Control it from the app

- **Play, pause, stop, seek, and next or previous** all work from the app's player controls.
- **Seek with the app's skip buttons.** Dragging the progress bar in the Jellyfin web app sends nothing to a cast device, so the video doesn't move.
- **Go Home, open Search or Settings, or go back** with the remote buttons in the Jellyfin web app.

## Display mirroring

With display mirroring turned on in the Jellyfin app you cast from, each item page you open in that app opens on your TV as well, so everyone can see what you're browsing.

While something plays on your TV, browsing in the app doesn't interrupt it: the TV changes only when you play something new.

## Messages from another device

Someone signed in to your server can send your TV a message from Jellyfin. A short message shows for a few seconds. A message that stays until it's read opens as **Message from another device**; press **OK** to close it.

## Cast while JellyRock is closed

With the JellyRock Companion plugin on your server, your Roku shows up as a cast target even while JellyRock is closed, and JellyRock opens straight into what you picked. Your server must be on the same network as your Roku. [Jellyfin server plugins](../jellyfin-server-plugins.md) says which plugin version this needs.

## Troubleshooting

- **Your Roku isn't in the cast list.** Open JellyRock and sign in, to the same server as the app you're casting from. On an HTTPS server, install the JellyRock Companion plugin.
- **Dragging the progress bar does nothing.** Use the app's skip buttons instead; the web app doesn't send a drag to a cast device.
- **Only the first track of an album plays.** JellyRock plays the first item of what you cast. Queue the rest from JellyRock.

To send commands from a script, a smart home system or a voice routine instead, see [Deep linking and casting to JellyRock](deep-linking.md).
