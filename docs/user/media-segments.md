# Media Segments (skip intro / outro)

During playback JellyRock can skip, or offer a button to skip, parts of a video
your server has marked — intros, outros, recaps, previews and commercials.

It needs **Jellyfin 10.10.0 or newer** and a media segment provider plugin on
your server — see [Jellyfin Server Plugins](jellyfin-server-plugins.md) for the
ones JellyRock is tested with and how to install them.

## What you need

A segment provider plugin that **detects** the segments. Jellyfin 10.10.0+
provides the API JellyRock reads, but the segments themselves come from a
provider.

JellyRock is tested with **Chapter Segments Provider** and **Intro Skipper**. Any
Jellyfin segment provider should work: every provider stores its segments in the
same place on the server, and JellyRock reads them from there rather than from
any one plugin.

## Choosing what happens

Per-segment-type behavior (auto-skip, show a skip button, do nothing) is
configured in the Jellyfin web client, and can be overridden per device in
JellyRock under **Settings → Playback → Media Segments** — see
[App Settings](app-settings.md#playback-media-segments).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| No skip button on any item | Server is older than 10.10.0, or has no segment provider plugin |
| No skip button on some items | The provider has not detected segments for them yet, or found none |
| No skip button in one library only | On Jellyfin 10.10.2 and newer, a provider turned off under that library's **Media segment providers** setting has its segments ignored |
