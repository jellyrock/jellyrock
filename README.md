<!-- markdownlint-disable MD041 -->
[![JellyRock](resources/branding/release/channel-poster_sd.png "Download JellyRock ")](https://channelstore.roku.com/details/232f9e82db11ce628e3fe7e01382a330:a85d6e9e520567806e8dae1c0cabadd5/jellyrock)

[![Current Release](https://img.shields.io/github/release/jellyrock/jellyrock.svg?logo=github "Current Release")](https://github.com/jellyrock/jellyrock/releases)
[![Chat on Matrix](https://img.shields.io/matrix/jellyrock-app:matrix.org.svg?logo=matrix "Chat on Matrix")](https://matrix.to/#/#jellyrock-app:matrix.org)
[![Translation Status](https://translate.jellyrock.app/widget/jellyrock/svg-badge.svg "Translation Status")](https://translate.jellyrock.app/engage/jellyrock/)
[![License](https://img.shields.io/github/license/jellyrock/jellyrock.svg "GPL 2.0 License")](LICENSE)
[![Build Status](https://img.shields.io/github/actions/workflow/status/jellyrock/jellyrock/build.yml?logo=github&branch=main "Build Status")](https://github.com/jellyrock/jellyrock/actions/workflows/build.yml?query=branch%3Amain)
[![API docs](https://img.shields.io/badge/API%20docs-purple "API docs")](https://jellyrock.github.io/api-docs/)
<!-- [![Translation Status](https://translate.jellyfin.org/widgets/jellyfin/-/jellyfin-roku/svg-badge.svg "Translation Status")](https://translate.jellyfin.org/projects/jellyfin/jellyfin-roku/?utm_source=widget) -->

JellyRock is a fast, fluid Jellyfin client for Roku, focused on stability, performance, and a polished UX. Direct Play in original quality, a redesigned playback OSD, deep theming with custom hex colors, and 99 built-in language translations. Free and open-source, no ads, no tracking. Bring your own Jellyfin server.

## Changelog

All notable changes to this project are documented in [CHANGELOG.md](CHANGELOG.md).

## Prerequisites

- Roku OS 11 or later
- Jellyfin server 10.7.0 or later

## Install

### Using your Roku device

- Navigate to Home -> Search -> "JellyRock".

### Using your browser

- Visit the [Roku Channel Store](https://channelstore.roku.com/details/232f9e82db11ce628e3fe7e01382a330:a85d6e9e520567806e8dae1c0cabadd5/jellyrock) -> Add app -> Login. This will install JellyRock on **all** devices linked to your Roku account.

## Screenshots

  <a href="docs/screenshots/en_US/userSelect.webp" target="_blank" title="User Select">
    <img src="docs/screenshots/en_US/userSelect.webp" width="400" alt="User Select" />
  </a>
  <a href="docs/screenshots/en_US/home.webp" target="_blank" title="Home">
    <img src="docs/screenshots/en_US/home.webp" width="400" alt="Home" />
  </a>
  <a href="docs/screenshots/en_US/libraryGrid.webp" target="_blank" title="Library grid">
    <img src="docs/screenshots/en_US/libraryGrid.webp" width="400" alt="Library grid" />
  </a>
  <a href="docs/screenshots/en_US/movieDetails.webp" target="_blank" title="Movie Details">
    <img src="docs/screenshots/en_US/movieDetails.webp" width="400" alt="Movie Details" />
  </a>
  <a href="docs/screenshots/en_US/osd.webp" target="_blank" title="On-Screen Display(OSD)">
    <img src="docs/screenshots/en_US/osd.webp" width="400" alt="On-Screen Display(OSD)" />
  </a>
  <a href="docs/screenshots/en_US/trickplay.webp" target="_blank" title="Trickplay">
    <img src="docs/screenshots/en_US/trickplay.webp" width="400" alt="Trickplay" />
  </a>

**🖼️ [View all screenshots →](docs/screenshots/)**

## History

From 2019 to 2025, I worked on the original Jellyfin client for Roku as a member of the Jellyfin team, and was its sole maintainer for part of that time.

That client is now archived as [jellyfin-roku-legacy](https://github.com/jellyfin-archive/jellyfin-roku-legacy). For its [v3 release](https://github.com/jellyfin/jellyfin-roku/releases/tag/3.0.0), the [official client](https://github.com/jellyfin/jellyfin-roku) adopted a different fork as its new base, one that had branched from the original back at v2.1.4.

JellyRock continues the original's own line. I forked it at [v2.2.5](https://github.com/jellyfin-archive/jellyfin-roku-legacy/releases/tag/v2.2.5), the last release I'd personally vetted as stable, and have rebuilt and refined it independently ever since, cherry-picking select fixes from later commits along the way.

## Sideload / Beta Test

To run the latest version of JellyRock before it hits the Roku Channel Store:

1. Put your Roku device in [Developer Mode](docs/dev/developer-mode.md). Save your password!
2. Download the latest [build](https://github.com/jellyrock/jellyrock/actions/workflows/build.yml?query=branch%3Amain) created by GitHub Actions. Select the first item listed then click one of the links at the bottom of the page i.e. `JellyRock-prod-main-e34f4f169ff47531abd23ae3a11c102f6811f907`. This will download a zip file to your computer.
3. Put your Roku's IP from step 1 into a browser i.e. `http://192.168.1.2` and press enter.
4. Log in with credentials from step 1.
5. Upload and install the zip file downloaded in step 2.

> NOTE: The app will always be at the bottom of your Roku's channel list and it will *not* automatically update.

## Build

```bash
git clone https://github.com/jellyrock/jellyrock.git
cd jellyrock
npm install
# Note: If npm scripts are disabled, manually run `npm run ropm` to install dependencies
npm run build # OR npm run build:prod
```

## User Docs

- [App Settings](docs/user/app-settings.md)
- [Jellyfin Server Feature Matrix](docs/user/jellyfin-server-feature-matrix.md)

## Dev Docs

- [Developer Mode](docs/dev/developer-mode.md)
- [Dev Guide](docs/dev/DEVGUIDE.md)
- [Logging](docs/dev/logging.md)
- [New User Setting](docs/dev/new-user-setting.md)
- [Registry Migrations](docs/dev/registry-migrations.md)
- [TDD Workflow](docs/dev/unit-tests-tdd.md)
- [Unit Tests](docs/dev/unit-tests.md)
- [Jellyfin Server Versioning](docs/dev/jellyfin-server-versioning.md)

## Translations

JellyRock uses Weblate for translations: <https://translate.jellyrock.app/projects/jellyrock>

[![Translation status](https://translate.jellyrock.app/widget/jellyrock/multi-auto.svg)](https://translate.jellyrock.app/engage/jellyrock/)
