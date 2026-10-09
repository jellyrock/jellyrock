# Media segments (skip intro and outro)

JellyRock can skip the parts of a video your server has marked, or show a button to skip them. These parts are intros, outros, recaps, previews and commercials.

You need Jellyfin 10.10.0 or later and a media segment provider plugin on your server. [Jellyfin server plugins](jellyfin-server-plugins.md) lists the ones JellyRock is tested with and how to install them.

## What you need

You need a segment provider plugin to detect the segments. Jellyfin 10.10.0 and later can store segments, but a provider has to find them.

JellyRock is tested with **Chapter Segments Provider** and **Intro Skipper**. Any Jellyfin segment provider should work. Every provider stores its segments in the same place on the server, and JellyRock reads them from there, not from any one plugin.

## Choose what happens

For each segment type, you choose to skip it, show a skip button or do nothing. You set this in the Jellyfin web client.

To change it for one Roku, go to **Settings → Playback → Media Segments** in JellyRock. See [App Settings](app-settings.md#playback-media-segments).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| No skip button on any item | Your server is older than 10.10.0, or has no segment provider plugin. |
| No skip button on some items | The provider has not detected segments for them yet, or found none. |
| No skip button in one library only | On Jellyfin 10.10.2 and later, a provider turned off in that library's **Media segment providers** setting has its segments ignored. |
