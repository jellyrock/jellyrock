# Jellyfin Server Plugins

Some JellyRock features need a plugin installed **on your Jellyfin server**, not
on your Roku. These are the plugins JellyRock is tested with and what each one
adds.

Features that depend on your server **version** rather than a plugin are in the
[Jellyfin Server Feature Matrix](jellyfin-server-feature-matrix.md).

## Already in your server's catalog

**Dashboard → Plugins** → find the plugin → **Install**, then restart Jellyfin if
prompted.

| Plugin | Adds to JellyRock |
| --- | --- |
| [Open Subtitles](https://github.com/jellyfin/jellyfin-plugin-opensubtitles) | [Manage Subtitles](manage-subtitles.md) — sign in to your Open Subtitles account in the plugin's settings ([Jellyfin's guide](https://jellyfin.org/docs/general/server/plugins/open-subtitles/)) |
| [Chapter Segments Provider](https://github.com/jellyfin/jellyfin-plugin-chapter-segments) | [Skip intro / outro](media-segments.md), from chapter markers |

## Add its repository first

**Dashboard → Plugins → Manage Repositories → New Repository** → paste the
repository URL, then install the plugin like any other.

| Plugin | Adds to JellyRock | Repository URL |
| --- | --- | --- |
| [Intro Skipper](https://github.com/intro-skipper/intro-skipper) | [Skip intro / outro](media-segments.md), detected from the audio and video | `https://intro-skipper.org/manifest.json` |
| [JellyRock Companion](https://github.com/jellyrock/jellyfin-plugin-jellyrock) | [Cast to JellyRock while it's closed](https://github.com/jellyrock/jellyfin-plugin-jellyrock/blob/main/docs/features/cold-launch-cast.md)<br>[Remote control (HTTPS servers)](https://github.com/jellyrock/jellyfin-plugin-jellyrock/blob/main/docs/features/remote-control.md)<br>[Fast cleanup after pressing Home (HTTPS servers)](https://github.com/jellyrock/jellyfin-plugin-jellyrock/blob/main/docs/features/playback-cleanup.md) | `https://jellyrock.github.io/jellyfin-plugin-jellyrock/manifest.json` |

## Good to know

- **Other providers should work too.** Any Jellyfin subtitle provider or media
  segment provider should work with JellyRock, because JellyRock uses Jellyfin's
  shared subtitle and segment APIs rather than any one plugin. The plugins above
  are the ones it is tested with.
- **Menu names are from Jellyfin 10.11.** Older servers label these screens
  differently — see [Jellyfin's plugin documentation](https://jellyfin.org/docs/general/server/plugins/).
