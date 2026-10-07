# Jellyfin server plugins

Some JellyRock features need a plugin on your Jellyfin server, not on your Roku. Find your plugin below to see what it adds and what it needs.

Features that depend on your server version rather than a plugin are in the [Jellyfin Server Feature Matrix](jellyfin-server-feature-matrix.md).

## Supported plugins

| Plugin | What you get in JellyRock | Jellyfin server version | JellyRock version | Install |
| --- | --- | --- | --- | --- |
| [Open Subtitles](https://github.com/jellyfin/jellyfin-plugin-opensubtitles) | Find and download subtitles from an item's page ([Manage Subtitles](manage-subtitles.md)) | 10.7 or later | 2.29.0 or later | [From your catalog](#install-from-your-catalog) |
| [Chapter Segments Provider](https://github.com/jellyfin/jellyfin-plugin-chapter-segments) | [Skip the intro and outro](media-segments.md), found from chapter markers | 10.10 or later | 2.9.0 or later | [From your catalog](#install-from-your-catalog) |
| [Intro Skipper](https://github.com/intro-skipper/intro-skipper) | [Skip the intro and outro](media-segments.md), detected from the audio and video | 10.10 or later | 2.9.0 or later | [Add a repository](#install-from-a-repository) |
| [JellyRock Companion](https://github.com/jellyrock/jellyfin-plugin-jellyrock) | [Cast to JellyRock while it's closed](https://github.com/jellyrock/jellyfin-plugin-jellyrock/blob/main/docs/features/cold-launch-cast.md). On HTTPS servers, also [remote control](https://github.com/jellyrock/jellyfin-plugin-jellyrock/blob/main/docs/features/remote-control.md) and [fast cleanup after you press Home](https://github.com/jellyrock/jellyfin-plugin-jellyrock/blob/main/docs/features/playback-cleanup.md) | 10.11 or later | 2.23.0 or later (2.24.0 to cast while closed) | [Add a repository](#install-from-a-repository) |

The Jellyfin server version is the oldest server the JellyRock feature works with. Your server's catalog offers the plugin build that matches your server.

On Jellyfin 10.9 and 10.10, the catalog offers an older JellyRock Companion release (0.2.x) that cannot cast to a closed app.

## Install from your catalog

1. Go to **Dashboard → Plugins** and find the plugin.
2. Select **Install**.
3. Restart Jellyfin if it asks you to.

## Install from a repository

1. Go to **Dashboard → Plugins → Manage Repositories → New Repository**.
2. Paste the plugin's repository URL:

   Intro Skipper:

   ```text
   https://intro-skipper.org/manifest.json
   ```

   JellyRock Companion:

   ```text
   https://jellyrock.github.io/jellyfin-plugin-jellyrock/manifest.json
   ```

3. Install the plugin from your catalog, as above.

## After installing

**Open Subtitles** needs your Open Subtitles account. Sign in to it in the plugin's settings ([Jellyfin's guide](https://jellyfin.org/docs/general/server/plugins/open-subtitles/)).

## Plugin not listed?

Any Jellyfin subtitle provider or media segment provider should work. JellyRock uses Jellyfin's shared subtitle and segment features, not any one plugin. The plugins above are the ones JellyRock is tested with.

Menu names are from Jellyfin 10.11 and 12.1. Older servers label these screens differently: see [Jellyfin's plugin documentation](https://jellyfin.org/docs/general/server/plugins/).
