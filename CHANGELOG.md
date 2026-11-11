<!-- markdownlint-disable -->
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Fixed

- (syncplay) Reload where the group is; load a mid-reload restart ([#1354](https://github.com/jellyrock/jellyrock/pull/1354)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update dotenv from v18.0.9 to v18.0.10 ([#1342](https://github.com/jellyrock/jellyrock/pull/1342)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update actions/setup-java action to v6.2.0 ([#1347](https://github.com/jellyrock/jellyrock/pull/1347)) by [@renovate[bot]](https://github.com/apps/renovate)

## [3.4.0](https://github.com/jellyrock/jellyrock/compare/v3.3.1...v3.4.0) - 2026-11-09

### Summary

Adds Repeat to the video player's gear. SyncPlay groups get repeat and shuffle too, a group icon in the player, and a confirm dialog before you replace what everyone is watching. Recently Added rows for TV now show posters, like movies. Makes playback more reliable: transcoded videos no longer play silently, 4K files and long films that failed to start now play, and Cinema Mode intros work again. The list below has 16 more fixes.

### Added

- (syncplay) Add a group mark, names, a play confirm and catch-up ([#1335](https://github.com/jellyrock/jellyrock/pull/1335)) by [@cewert](https://github.com/cewert)
- (syncplay) Repeat, shuffle, time offset and leave in the gear ([#1315](https://github.com/jellyrock/jellyrock/pull/1315)) by [@cewert](https://github.com/cewert)
- (player) Repeat a video or the queue from the OSD gear ([#1308](https://github.com/jellyrock/jellyrock/pull/1308)) by [@cewert](https://github.com/cewert)
- (syncplay) Stay in step, stop seek freezes, add a time offset ([#1296](https://github.com/jellyrock/jellyrock/pull/1296)) by [@cewert](https://github.com/cewert)

### Changed

- (logging) Mask secrets in logs, keep names and search text out ([#1329](https://github.com/jellyrock/jellyrock/pull/1329)) by [@cewert](https://github.com/cewert)
- (logging) adopt `roku-log` as owned code, drop its hook ([#1328](https://github.com/jellyrock/jellyrock/pull/1328)) by [@cewert](https://github.com/cewert)
- (home) Show vertical posters in TV Recently Added rows ([#1295](https://github.com/jellyrock/jellyrock/pull/1295)) by [@cewert](https://github.com/cewert)

### Fixed

- (playback) Reload where the stream was and keep a group in sync ([#1344](https://github.com/jellyrock/jellyrock/pull/1344)) by [@cewert](https://github.com/cewert)
- (playback) Restart a stream the server stops sending, and say why ([#1339](https://github.com/jellyrock/jellyrock/pull/1339)) by [@cewert](https://github.com/cewert)
- (playback) Keep a paused video transcoding on the server ([#1338](https://github.com/jellyrock/jellyrock/pull/1338)) by [@cewert](https://github.com/cewert)
- (syncplay) Skip a queue update with no readable time, not crash ([#1340](https://github.com/jellyrock/jellyrock/pull/1340)) by [@cewert](https://github.com/cewert)
- (ui) Fix dialogs left deaf by navigation or the screensaver ([#1336](https://github.com/jellyrock/jellyrock/pull/1336)) by [@cewert](https://github.com/cewert)
- (video) Follow repeat mode on voice and remote Next and Previous ([#1333](https://github.com/jellyrock/jellyrock/pull/1333)) by [@cewert](https://github.com/cewert)
- (playback) Show `.strm` audio and subtitle buttons on first play ([#1332](https://github.com/jellyrock/jellyrock/pull/1332)) by [@gatolocoses](https://github.com/gatolocoses)
- (playback) Start 4K Dolby Vision on a display without HDR ([#1331](https://github.com/jellyrock/jellyrock/pull/1331)) by [@cewert](https://github.com/cewert)
- (playback) Play more Dolby Vision files, end a wasted retry ([#1325](https://github.com/jellyrock/jellyrock/pull/1325)) by [@cewert](https://github.com/cewert)
- (playback) Handle long films, big re-encodes and frozen playback ([#1324](https://github.com/jellyrock/jellyrock/pull/1324)) by [@cewert](https://github.com/cewert)
- (playback) Make 4K transcodes play, in HEVC on hardware servers ([#1323](https://github.com/jellyrock/jellyrock/pull/1323)) by [@cewert](https://github.com/cewert)
- (playback) Recover when a 4K remux overflows the video buffer ([#1318](https://github.com/jellyrock/jellyrock/pull/1318)) by [@cewert](https://github.com/cewert)
- (playback) Copy AC3 audio in a remux on 7.1 systems ([#1327](https://github.com/jellyrock/jellyrock/pull/1327)) by [@cewert](https://github.com/cewert)
- (playback) Pick a playable audio track, not audio description ([#1320](https://github.com/jellyrock/jellyrock/pull/1320)) by [@cewert](https://github.com/cewert)
- (playback) Stop transcoded videos playing with no sound ([#1317](https://github.com/jellyrock/jellyrock/pull/1317)) by [@cewert](https://github.com/cewert)
- (login) Offer Quick Connect when a server lists no users ([#1314](https://github.com/jellyrock/jellyrock/pull/1314)) by [@cewert](https://github.com/cewert)
- (playback) Play the episode once when Repeat is picked during a Cinema Mode intro ([#1313](https://github.com/jellyrock/jellyrock/pull/1313)) by [@cewert](https://github.com/cewert)
- (playback) Play Cinema Mode intros, drop the stale queue slot ([#1312](https://github.com/jellyrock/jellyrock/pull/1312)) by [@cewert](https://github.com/cewert)
- (syncplay) Ask the group to wait after a seek that cannot land ([#1306](https://github.com/jellyrock/jellyrock/pull/1306)) by [@cewert](https://github.com/cewert)
- Register Roku's memory monitor and ship only runtime files ([#1299](https://github.com/jellyrock/jellyrock/pull/1299)) by [@cewert](https://github.com/cewert)
- (home) Show episode images in Favorites tab ([#1290](https://github.com/jellyrock/jellyrock/pull/1290)) by [@cewert](https://github.com/cewert)
- Correct the canceled-recording toast ([#1288](https://github.com/jellyrock/jellyrock/pull/1288)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update vitest from v5.0.5 to v5.1.0 ([#1311](https://github.com/jellyrock/jellyrock/pull/1311)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update rimraf from v6.1.3 to v6.1.4 ([#1319](https://github.com/jellyrock/jellyrock/pull/1319)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update eslint from v10.13.0 to v10.14.0 ([#1287](https://github.com/jellyrock/jellyrock/pull/1287)) by [@renovate[bot]](https://github.com/apps/renovate)
- Rename the Rooibos patch for the installed alpha.56 ([eda2baf](https://github.com/jellyrock/jellyrock/commit/eda2bafab6d1221735e4a07484c4fe1671c1c842)) by [@cewert](https://github.com/cewert)
- Lock file maintenance ([#1300](https://github.com/jellyrock/jellyrock/pull/1300)) by [@renovate[bot]](https://github.com/apps/renovate)

### New Contributors

- [@gatolocoses](https://github.com/gatolocoses) made their first contribution in [#1332](https://github.com/jellyrock/jellyrock/pull/1332)

## [3.3.1](https://github.com/jellyrock/jellyrock/compare/v3.3.0...v3.3.1) - 2026-10-30

### Summary

Fixes subtitles that still showed after picking None, and a paused Roku that other Jellyfin apps and SyncPlay groups kept showing as playing.

### Fixed

- (playback) Turn subtitles off when None is picked ([#1283](https://github.com/jellyrock/jellyrock/pull/1283)) by [@cewert](https://github.com/cewert)
- (playback) Confirm pauses and keep paused and long plays reported ([#1282](https://github.com/jellyrock/jellyrock/pull/1282)) by [@cewert](https://github.com/cewert)

## [3.3.0](https://github.com/jellyrock/jellyrock/compare/v3.2.0...v3.3.0) - 2026-10-29

### Summary

Introduces SyncPlay, so you can watch together with people on other Jellyfin apps. Adds a settings button to the video player that sets the maximum bitrate and resolution for the current playback without changing your defaults, and puts the Search and Settings icons on every screen. Also fixes 7 bugs.

### Added

- (syncplay) Send controls to the group and resume from the menu ([#1276](https://github.com/jellyrock/jellyrock/pull/1276)) by [@cewert](https://github.com/cewert)
- (syncplay) See, join and play with groups from the SyncPlay icon ([#1270](https://github.com/jellyrock/jellyrock/pull/1270)) by [@cewert](https://github.com/cewert)
- (ui) Search and settings icons on every screen, and safer themes ([#1265](https://github.com/jellyrock/jellyrock/pull/1265)) by [@cewert](https://github.com/cewert)
- (syncplay) Follow a group, fix Play on buffering, speed up casts ([#1257](https://github.com/jellyrock/jellyrock/pull/1257)) by [@cewert](https://github.com/cewert)
- (syncplay) Add the pure SyncPlay layer and parse its frames in the receiver ([#1253](https://github.com/jellyrock/jellyrock/pull/1253)) by [@cewert](https://github.com/cewert)
- Add a quality gear, one cap for all codecs, bigger menu icons ([#1246](https://github.com/jellyrock/jellyrock/pull/1246)) by [@cewert](https://github.com/cewert)
- Show a spinner over details and the TV guide while they load, and let Back leave them ([#1243](https://github.com/jellyrock/jellyrock/pull/1243)) by [@cewert](https://github.com/cewert)

### Changed

- (ui) One aligned overhang row, and icons on the 3 pixel grid ([#1262](https://github.com/jellyrock/jellyrock/pull/1262)) by [@cewert](https://github.com/cewert)

### Fixed

- (navigation) Retry a refused navigation once the router is idle ([#1261](https://github.com/jellyrock/jellyrock/pull/1261)) by [@cewert](https://github.com/cewert)
- (dialogs) Keep focus on a dialog opened from another dialog ([#1250](https://github.com/jellyrock/jellyrock/pull/1250)) by [@cewert](https://github.com/cewert)
- Hold keys and let Back cancel a Refresh, photo launch or seek ([#1245](https://github.com/jellyrock/jellyrock/pull/1245)) by [@cewert](https://github.com/cewert)
- (sign-in) Keep a server re-scan from taking focus from a connect ([#1242](https://github.com/jellyrock/jellyrock/pull/1242)) by [@cewert](https://github.com/cewert)
- (sign-in) Ignore extra presses and let Back cancel a sign-in ([#1238](https://github.com/jellyrock/jellyrock/pull/1238)) by [@cewert](https://github.com/cewert)
- (login) Land on Home after sign-in; drop casts while signed out ([#1237](https://github.com/jellyrock/jellyrock/pull/1237)) by [@cewert](https://github.com/cewert)
- (audio) Seek in FLAC without freezing or skipping the end ([#1234](https://github.com/jellyrock/jellyrock/pull/1234)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update java-jdk to v25.0.5 ([#1266](https://github.com/jellyrock/jellyrock/pull/1266)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update markdownlint-cli2 from v0.23.3 to v0.24.0 ([#1232](https://github.com/jellyrock/jellyrock/pull/1232)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update dotenv from v18.0.8 to v18.0.9 ([#1240](https://github.com/jellyrock/jellyrock/pull/1240)) by [@renovate[bot]](https://github.com/apps/renovate)
- Sync Roku hardware dictionary ([#1268](https://github.com/jellyrock/jellyrock/pull/1268)) by [@jellyrock[bot]](https://github.com/apps/jellyrock)

## [3.2.0](https://github.com/jellyrock/jellyrock/compare/v3.1.0...v3.2.0) - 2026-10-21

### Added

- (backdrop) Show My Media backdrops and restore one after sign-in ([#1227](https://github.com/jellyrock/jellyrock/pull/1227)) by [@cewert](https://github.com/cewert)
- (search) Pull-down keyboard, live suggestions and recent searches ([#1217](https://github.com/jellyrock/jellyrock/pull/1217)) by [@cewert](https://github.com/cewert)

### Fixed

- (playback) Play songs and trailers in the right player ([#1224](https://github.com/jellyrock/jellyrock/pull/1224)) by [@cewert](https://github.com/cewert)
- (search) Show a row for every result type, up to 50 items each ([#1216](https://github.com/jellyrock/jellyrock/pull/1216)) by [@cewert](https://github.com/cewert)
- (search) Find the Live TV programs that match a search ([#1214](https://github.com/jellyrock/jellyrock/pull/1214)) by [@cewert](https://github.com/cewert)
- Treat the 512 MB Roku Express `3900X`, `3910X` and `3930X` as low memory ([#1215](https://github.com/jellyrock/jellyrock/pull/1215)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update js-yaml from v5.4.3 to v5.5.0 ([#1212](https://github.com/jellyrock/jellyrock/pull/1212)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update actions/setup-java action to v6.1.0 ([#1219](https://github.com/jellyrock/jellyrock/pull/1219)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update vitest from v5.0.4 to v5.0.5 ([#1210](https://github.com/jellyrock/jellyrock/pull/1210)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update dotenv from v18.0.7 to v18.0.8 ([#1207](https://github.com/jellyrock/jellyrock/pull/1207)) by [@renovate[bot]](https://github.com/apps/renovate)
- Linting (minor) ([#1211](https://github.com/jellyrock/jellyrock/pull/1211)) by [@renovate[bot]](https://github.com/apps/renovate)

## [3.1.0](https://github.com/jellyrock/jellyrock/compare/v3.0.0...v3.1.0) - 2026-10-15

### Added

- (subtitles) Show and announce a failed or empty subtitle search ([#1203](https://github.com/jellyrock/jellyrock/pull/1203)) by [@cewert](https://github.com/cewert)
- (search) Show and announce when a search failed or found nothing ([#1199](https://github.com/jellyrock/jellyrock/pull/1199)) by [@cewert](https://github.com/cewert)
- Say why a quick play found nothing, and never guess an episode ([#1197](https://github.com/jellyrock/jellyrock/pull/1197)) by [@cewert](https://github.com/cewert)

### Fixed

- (subtitles) Stop Perfect match showing old results mid-search ([#1204](https://github.com/jellyrock/jellyrock/pull/1204)) by [@cewert](https://github.com/cewert)
- (playback) Play the last track or version picked, and every retry ([#1198](https://github.com/jellyrock/jellyrock/pull/1198)) by [@cewert](https://github.com/cewert)
- Keep music artists out of search and Favorites people on 12.0+ ([#1195](https://github.com/jellyrock/jellyrock/pull/1195)) by [@cewert](https://github.com/cewert)
- (playback) Pick `.strm` tracks on first play; fill Playback Info ([#1184](https://github.com/jellyrock/jellyrock/pull/1184)) by [@cewert](https://github.com/cewert)
- (grid) Stop asking for `MediaSourceCount` on the music grids ([#1181](https://github.com/jellyrock/jellyrock/pull/1181)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update vitest from v5.0.3 to v5.0.4 ([#1178](https://github.com/jellyrock/jellyrock/pull/1178)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update actions/setup-node action to v7.1.0 ([#1177](https://github.com/jellyrock/jellyrock/pull/1177)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update prettier from v3.9.9 to v3.9.10 ([#1153](https://github.com/jellyrock/jellyrock/pull/1153)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update actions/upload-artifact action to v7.0.2 ([#1176](https://github.com/jellyrock/jellyrock/pull/1176)) by [@renovate[bot]](https://github.com/apps/renovate)

## [3.0.0](https://github.com/jellyrock/jellyrock/compare/v2.35.0...v3.0.0) - 2026-10-12

### Changed

- (manifest) Require Roku OS 15.1 and SceneGraph 1.3 ([#1126](https://github.com/jellyrock/jellyrock/pull/1126)) by [@cewert](https://github.com/cewert)

### Fixed

- (playback) Direct-play `.strm` and DASH; fall back if unreachable ([#1170](https://github.com/jellyrock/jellyrock/pull/1170)) by [@cewert](https://github.com/cewert)
- (music) Keep the playing track when shuffle is switched on again ([#1159](https://github.com/jellyrock/jellyrock/pull/1159)) by [@cewert](https://github.com/cewert)
- (navigation) Recover from a failed navigation before logging it ([#1157](https://github.com/jellyrock/jellyrock/pull/1157)) by [@cewert](https://github.com/cewert)
- Stop the sign-in screen flashing back after a deep-link sign-in ([#1156](https://github.com/jellyrock/jellyrock/pull/1156)) by [@cewert](https://github.com/cewert)
- (locale) Apply the user's language when preferences fail ([#1155](https://github.com/jellyrock/jellyrock/pull/1155)) by [@cewert](https://github.com/cewert)
- Stop a crash on options in a stopped video's playback info ([#1154](https://github.com/jellyrock/jellyrock/pull/1154)) by [@cewert](https://github.com/cewert)
- (overhang) Reset the clock when the screensaver ends ([#1152](https://github.com/jellyrock/jellyrock/pull/1152)) by [@cewert](https://github.com/cewert)
- (home) Hide pilots of not-yet-started series from Next Up ([#1124](https://github.com/jellyrock/jellyrock/pull/1124)) by [@cewert](https://github.com/cewert)
- Change screens and the overhang in one frame ([#1137](https://github.com/jellyrock/jellyrock/pull/1137)) by [@cewert](https://github.com/cewert)
- (focus) Stop screens taking focus back when it leaves the router ([#1138](https://github.com/jellyrock/jellyrock/pull/1138)) by [@cewert](https://github.com/cewert)
- Clearer subtitle track names; dropdowns keep short text on pick ([#1121](https://github.com/jellyrock/jellyrock/pull/1121)) by [@cewert](https://github.com/cewert)
- (home) Show Home sections placed in web client slots 8-10 ([#1119](https://github.com/jellyrock/jellyrock/pull/1119)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update brighterscript-formatter from v1.8.3 to v1.8.4 ([#1151](https://github.com/jellyrock/jellyrock/pull/1151)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update dotenv from v18.0.5 to v18.0.7 ([#1125](https://github.com/jellyrock/jellyrock/pull/1125), [#1145](https://github.com/jellyrock/jellyrock/pull/1145)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update eslint from v10.11.0 to v10.12.0 ([#1083](https://github.com/jellyrock/jellyrock/pull/1083)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update js-yaml from v5.4.2 to v5.4.3 ([#1116](https://github.com/jellyrock/jellyrock/pull/1116)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update eslint-plugin-n from v18.4.0 to v18.4.1 ([#1087](https://github.com/jellyrock/jellyrock/pull/1087)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.35.0](https://github.com/jellyrock/jellyrock/compare/v2.34.1...v2.35.0) - 2026-10-04

### Added

- (video) Ask "Are you still watching?" before endless auto-play ([#1086](https://github.com/jellyrock/jellyrock/pull/1086)) by [@cewert](https://github.com/cewert)

### Changed

- (translations) Seed translations from other Jellyfin clients ([#1102](https://github.com/jellyrock/jellyrock/pull/1102)) by [@cewert](https://github.com/cewert)
- Consolidate duplicate helpers from the dead-code baseline ([#1104](https://github.com/jellyrock/jellyrock/pull/1104)) by [@cewert](https://github.com/cewert)
- Remove unused session transformers, test the live login ([#1103](https://github.com/jellyrock/jellyrock/pull/1103)) by [@cewert](https://github.com/cewert)
- Remove unused component functions, fields and interface exposures ([#1098](https://github.com/jellyrock/jellyrock/pull/1098)) by [@cewert](https://github.com/cewert)
- Remove unused API calls, image helpers and utilities ([#1096](https://github.com/jellyrock/jellyrock/pull/1096)) by [@cewert](https://github.com/cewert)
- Remove unused components, dev dependencies and JS exports ([#1078](https://github.com/jellyrock/jellyrock/pull/1078)) by [@cewert](https://github.com/cewert)

### Fixed

- (video) Keep Next Episode and Skip pop-ups off open dialogs ([#1084](https://github.com/jellyrock/jellyrock/pull/1084)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update dotenv from v17.4.2 to v18 ([#962](https://github.com/jellyrock/jellyrock/pull/962)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update vitest from v5.0.2 to v5.0.3 ([#1077](https://github.com/jellyrock/jellyrock/pull/1077)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.34.1](https://github.com/jellyrock/jellyrock/compare/v2.34.0...v2.34.1) - 2026-10-02

### Fixed

- Silent DTS, failing TrueHD over passthrough, and track switching ([#1079](https://github.com/jellyrock/jellyrock/pull/1079)) by [@cewert](https://github.com/cewert)
- Quick play slow, TV and mixed libraries, and resume music videos ([#1076](https://github.com/jellyrock/jellyrock/pull/1076)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update lint-staged from v17.5.1 to v17.6.0 ([#1053](https://github.com/jellyrock/jellyrock/pull/1053)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update eslint-plugin-n from v18.3.0 to v18.4.0 ([#1052](https://github.com/jellyrock/jellyrock/pull/1052)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update rooibos-roku to v6.0.0 ([#1067](https://github.com/jellyrock/jellyrock/pull/1067)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update brighterscript to v1.0.0 ([#1065](https://github.com/jellyrock/jellyrock/pull/1065)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update sharp from v0.35.4 to v0.35.5 ([#1066](https://github.com/jellyrock/jellyrock/pull/1066)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.34.0](https://github.com/jellyrock/jellyrock/compare/v2.33.0...v2.34.0) - 2026-09-27

### Added

- Say when search or cast is slow; keep search's spinner on search ([#1044](https://github.com/jellyrock/jellyrock/pull/1044)) by [@cewert](https://github.com/cewert)

### Changed

- (details) Give a Season's series fetch its own Task per run ([#1047](https://github.com/jellyrock/jellyrock/pull/1047)) by [@cewert](https://github.com/cewert)
- (grid) Keep large libraries loading as fast as you scroll ([#1046](https://github.com/jellyrock/jellyrock/pull/1046)) by [@cewert](https://github.com/cewert)

### Fixed

- (playback) Back cancels a start, keys wait; slow starts say still loading ([#1064](https://github.com/jellyrock/jellyrock/pull/1064)) by [@cewert](https://github.com/cewert)
- (audio) Transcode Opus in `ogg` music instead of hanging ([#1062](https://github.com/jellyrock/jellyrock/pull/1062)) by [@cewert](https://github.com/cewert)
- Release live streams left mid-open, and wait for slow channels ([#1058](https://github.com/jellyrock/jellyrock/pull/1058)) by [@cewert](https://github.com/cewert)
- (home) Tell a failed Favorites load from an empty one; OK retries ([#1057](https://github.com/jellyrock/jellyrock/pull/1057)) by [@cewert](https://github.com/cewert)
- (home) Tell failed Home rows from empty ones; OK retries ([#1051](https://github.com/jellyrock/jellyrock/pull/1051)) by [@cewert](https://github.com/cewert)
- Close a Live TV stream that never started playing ([#1050](https://github.com/jellyrock/jellyrock/pull/1050)) by [@cewert](https://github.com/cewert)
- (audio) Show the right song's title and artwork after a skip ([#1045](https://github.com/jellyrock/jellyrock/pull/1045)) by [@cewert](https://github.com/cewert)
- (grid) Wait for slow libraries, say so, and let Back stop the load ([#1043](https://github.com/jellyrock/jellyrock/pull/1043)) by [@cewert](https://github.com/cewert)
- Load libraries as you scroll, say "Loading more", page "#" fully ([#1040](https://github.com/jellyrock/jellyrock/pull/1040)) by [@cewert](https://github.com/cewert)
- Show a library that failed to load as failed, and recover from it ([#1033](https://github.com/jellyrock/jellyrock/pull/1033)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update vitest from v5.0.1 to v5.0.2 ([#1036](https://github.com/jellyrock/jellyrock/pull/1036)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.33.0](https://github.com/jellyrock/jellyrock/compare/v2.32.0...v2.33.0) - 2026-09-25

### Added

- Browse a movie or TV library's collections on Jellyfin 12 ([#1014](https://github.com/jellyrock/jellyrock/pull/1014)) by [@cewert](https://github.com/cewert)

### Fixed

- Stop a song crashing when its details fail to load ([#1029](https://github.com/jellyrock/jellyrock/pull/1029)) by [@cewert](https://github.com/cewert)
- Stop Play crashing on a song's details screen ([#1027](https://github.com/jellyrock/jellyrock/pull/1027)) by [@cewert](https://github.com/cewert)
- (video) Keep the resume point when a video fails before it plays ([#1025](https://github.com/jellyrock/jellyrock/pull/1025)) by [@cewert](https://github.com/cewert)
- Stop subtitles crashing on short or comma timestamps, and hide cue ids and notes ([#1024](https://github.com/jellyrock/jellyrock/pull/1024)) by [@cewert](https://github.com/cewert)
- Recover stalled Live TV and close a failed channel's live stream ([#1018](https://github.com/jellyrock/jellyrock/pull/1018)) by [@cewert](https://github.com/cewert)
- Stop restarting a Live TV channel that keeps ending without playing ([#1016](https://github.com/jellyrock/jellyrock/pull/1016)) by [@cewert](https://github.com/cewert)
- Keep screens loading when the app hits its Task-thread limit ([#1022](https://github.com/jellyrock/jellyrock/pull/1022)) by [@cewert](https://github.com/cewert)
- Stop a late playback report replacing a dialog you opened meanwhile ([#1020](https://github.com/jellyrock/jellyrock/pull/1020)) by [@cewert](https://github.com/cewert)
- Stop the playback info report reopening itself after you close it ([#1019](https://github.com/jellyrock/jellyrock/pull/1019)) by [@cewert](https://github.com/cewert)
- Keep Home rows refreshing when you return to Home as a load finishes ([#1017](https://github.com/jellyrock/jellyrock/pull/1017)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update prettier from v3.9.8 to v3.9.9 ([#1015](https://github.com/jellyrock/jellyrock/pull/1015)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update eslint from v10.10.0 to v10.11.0 ([#966](https://github.com/jellyrock/jellyrock/pull/966)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.32.0](https://github.com/jellyrock/jellyrock/compare/v2.31.0...v2.32.0) - 2026-09-23

### Added

- Filter a movie library by audio and subtitle language on Jellyfin 12 ([#1002](https://github.com/jellyrock/jellyrock/pull/1002)) by [@cewert](https://github.com/cewert)
- Show Created by and Directed by credits on every item type that has them ([#1000](https://github.com/jellyrock/jellyrock/pull/1000)) by [@cewert](https://github.com/cewert)
- Show which collections an item is in on its details page ([#992](https://github.com/jellyrock/jellyrock/pull/992)) by [@cewert](https://github.com/cewert)
- Share bsconfig settings through one base config and clear the new BrighterScript warnings ([#984](https://github.com/jellyrock/jellyrock/pull/984)) by [@cewert](https://github.com/cewert)

### Changed

- Give each `HomeRows` latest-rows run its own task node ([#995](https://github.com/jellyrock/jellyrock/pull/995)) by [@cewert](https://github.com/cewert)
- Show every TV guide channel, loading programs near the focus ([#991](https://github.com/jellyrock/jellyrock/pull/991)) by [@cewert](https://github.com/cewert)

### Fixed

- Always apply a subtitle track change, and stop the caption timer ([#1010](https://github.com/jellyrock/jellyrock/pull/1010)) by [@cewert](https://github.com/cewert)
- Don't let abandoned requests delay the ones you're waiting for ([#999](https://github.com/jellyrock/jellyrock/pull/999)) by [@cewert](https://github.com/cewert)
- Show the focused movie's logo, not the previous one's, in the `Movies` view ([#997](https://github.com/jellyrock/jellyrock/pull/997)) by [@cewert](https://github.com/cewert)
- (skills) Make `/pr` titles name every user-visible change ([#998](https://github.com/jellyrock/jellyrock/pull/998)) by [@cewert](https://github.com/cewert)
- Fit `ItemDetails` text to the logo's real size ([#996](https://github.com/jellyrock/jellyrock/pull/996)) by [@cewert](https://github.com/cewert)
- Stop crashing when a server answers a list endpoint with an object ([#993](https://github.com/jellyrock/jellyrock/pull/993)) by [@cewert](https://github.com/cewert)
- Fetch a focused TV guide program's details once, not twice ([#994](https://github.com/jellyrock/jellyrock/pull/994)) by [@cewert](https://github.com/cewert)
- Play Live TV HLS channels from their own URL again on Jellyfin 12 ([#990](https://github.com/jellyrock/jellyrock/pull/990)) by [@cewert](https://github.com/cewert)
- Stop copying prebuilt source maps into builds ([#987](https://github.com/jellyrock/jellyrock/pull/987)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update java-jdk to v25 ([#979](https://github.com/jellyrock/jellyrock/pull/979)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update pin dependency java-jdk to v21.0.12 ([#978](https://github.com/jellyrock/jellyrock/pull/978)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update markdownlint-cli2 from v0.23.2 to v0.23.3 ([#972](https://github.com/jellyrock/jellyrock/pull/972)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.31.0](https://github.com/jellyrock/jellyrock/compare/v2.30.0...v2.31.0) - 2026-09-21

### Added

- Merge a person's credits into one Cast & Crew card, translated ([#975](https://github.com/jellyrock/jellyrock/pull/975)) by [@cewert](https://github.com/cewert)

### Changed

- Show the version that would actually play on posters and episode rows ([#971](https://github.com/jellyrock/jellyrock/pull/971)) by [@cewert](https://github.com/cewert)
- Label alternate versions by what differs, and offer every version ([#953](https://github.com/jellyrock/jellyrock/pull/953)) by [@cewert](https://github.com/cewert)
- Read device settings from a per-user env file as well as `.env` ([#949](https://github.com/jellyrock/jellyrock/pull/949)) by [@cewert](https://github.com/cewert)

### Fixed

- Honor v12 web client's "Original language" audio preference ([#977](https://github.com/jellyrock/jellyrock/pull/977)) by [@cewert](https://github.com/cewert)
- Stop the session socket being reaped a minute after it connects ([#974](https://github.com/jellyrock/jellyrock/pull/974)) by [@cewert](https://github.com/cewert)
- Start every item a queue arrives at from the beginning ([#970](https://github.com/jellyrock/jellyrock/pull/970)) by [@cewert](https://github.com/cewert)
- Resume the same version everywhere, and map an in-player switch ([#958](https://github.com/jellyrock/jellyrock/pull/958)) by [@cewert](https://github.com/cewert)
- Keep the `ItemGridOptions` dialog usable while a library grid loads ([#968](https://github.com/jellyrock/jellyrock/pull/968)) by [@cewert](https://github.com/cewert)
- Give each `BaseGridView` load and page its own Task node ([#967](https://github.com/jellyrock/jellyrock/pull/967)) by [@cewert](https://github.com/cewert)
- Give each run its own Task node where a restart can lose the work ([#961](https://github.com/jellyrock/jellyrock/pull/961)) by [@cewert](https://github.com/cewert)
- Stop Next Up listing every series' pilot on Jellyfin 10.7–10.10 ([#955](https://github.com/jellyrock/jellyrock/pull/955)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update rooibos-roku to v6.0.0 ([#965](https://github.com/jellyrock/jellyrock/pull/965)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update brighterscript to v1.0.0 ([#964](https://github.com/jellyrock/jellyrock/pull/964)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update vitest from v4.1.11 to v5 ([#882](https://github.com/jellyrock/jellyrock/pull/882)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update prettier from v3.9.6 to v3.9.8 ([#941](https://github.com/jellyrock/jellyrock/pull/941)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.30.0](https://github.com/jellyrock/jellyrock/compare/v2.29.1...v2.30.0) - 2026-09-17

### Changed

- Widen the API request pool for faster loading (up to 30% on Home) ([#944](https://github.com/jellyrock/jellyrock/pull/944)) by [@cewert](https://github.com/cewert)

### Fixed

- Match the selected version ignoring case in `ItemDetails`, and drop the dead `MaxVideoDecodeResolution` ([#947](https://github.com/jellyrock/jellyrock/pull/947)) by [@cewert](https://github.com/cewert)
- Read the version being played when starting playback ([#943](https://github.com/jellyrock/jellyrock/pull/943)) by [@cewert](https://github.com/cewert)
- Stabilize `ItemDetails` row focus and prevent buttons from popping in ([#942](https://github.com/jellyrock/jellyrock/pull/942)) by [@cewert](https://github.com/cewert)
- Save and resume progress per version on Jellyfin 12.0 ([#940](https://github.com/jellyrock/jellyrock/pull/940)) by [@cewert](https://github.com/cewert)

## [2.29.1](https://github.com/jellyrock/jellyrock/compare/v2.29.0...v2.29.1) - 2026-09-16

### Fixed

- Stop the extras row counter flickering on `ItemDetails` ([#922](https://github.com/jellyrock/jellyrock/pull/922)) by [@cewert](https://github.com/cewert)
- Hide the series Resume button until an episode has been watched ([#927](https://github.com/jellyrock/jellyrock/pull/927)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update lint-staged from v17.4.1 to v17.5.1 ([#888](https://github.com/jellyrock/jellyrock/pull/888)) by [@renovate[bot]](https://github.com/apps/renovate)
- Brighterscript (patch) ([#902](https://github.com/jellyrock/jellyrock/pull/902)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.29.0](https://github.com/jellyrock/jellyrock/compare/v2.28.0...v2.29.0) - 2026-09-15

### Added

- Add subtitle search, download and delete to item details ([#918](https://github.com/jellyrock/jellyrock/pull/918)) by [@cewert](https://github.com/cewert)
- Cap `ItemDetails` and `OSD` button rows with a `More` overflow menu ([#890](https://github.com/jellyrock/jellyrock/pull/890)) by [@cewert](https://github.com/cewert)

### Changed

- Version-gate the `ws://` socket token param for Jellyfin 12.0 ([#920](https://github.com/jellyrock/jellyrock/pull/920)) by [@cewert](https://github.com/cewert)
- Refresh the `rooibos-roku` patch for the installed version ([#894](https://github.com/jellyrock/jellyrock/pull/894)) by [@cewert](https://github.com/cewert)

### Fixed

- Register `m.top` observers once so the player cannot silence its host ([#913](https://github.com/jellyrock/jellyrock/pull/913)) by [@cewert](https://github.com/cewert)
- Report a force-finished playback as stopped once, not twice ([#914](https://github.com/jellyrock/jellyrock/pull/914)) by [@cewert](https://github.com/cewert)
- Finish playback when a segment skip lands at the end of the media ([#912](https://github.com/jellyrock/jellyrock/pull/912)) by [@cewert](https://github.com/cewert)
- Keep `playbackTimer`'s observer across a stopped → playing cycle ([#907](https://github.com/jellyrock/jellyrock/pull/907)) by [@cewert](https://github.com/cewert)
- Close all three routes to a false buffer stall ([#899](https://github.com/jellyrock/jellyrock/pull/899)) by [@cewert](https://github.com/cewert)
- Register the `state` observer exactly once ([#898](https://github.com/jellyrock/jellyrock/pull/898)) by [@cewert](https://github.com/cewert)
- Register the `position` observer exactly once ([#896](https://github.com/jellyrock/jellyrock/pull/896)) by [@cewert](https://github.com/cewert)
- Gate interface-field observer wiring; fix stale cross-file findings ([#895](https://github.com/jellyrock/jellyrock/pull/895)) by [@cewert](https://github.com/cewert)
- Observe each interface field exactly once in `OSD` and `IconButton` ([#891](https://github.com/jellyrock/jellyrock/pull/891)) by [@cewert](https://github.com/cewert)

### Removed

- Unused `Section` and `SectionScroller` components ([#911](https://github.com/jellyrock/jellyrock/pull/911)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update js-yaml from v5.4.1 to v5.4.2 ([#909](https://github.com/jellyrock/jellyrock/pull/909)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update actions/setup-java action to v6.0.1 ([#917](https://github.com/jellyrock/jellyrock/pull/917)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update rooibos-roku to v6.0.0 ([#905](https://github.com/jellyrock/jellyrock/pull/905)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update adm-zip from v0.6.0 to v0.6.1 ([#908](https://github.com/jellyrock/jellyrock/pull/908)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update promises from v0.7.1 to v0.7.4 ([#878](https://github.com/jellyrock/jellyrock/pull/878), [#904](https://github.com/jellyrock/jellyrock/pull/904)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update ropm from v0.11.9 to v0.11.11 ([#880](https://github.com/jellyrock/jellyrock/pull/880), [#903](https://github.com/jellyrock/jellyrock/pull/903)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update eslint from v10.9.1 to v10.10.0 ([#886](https://github.com/jellyrock/jellyrock/pull/886)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update spellchecker-cli from v7.0.3 to v7.0.4 ([#893](https://github.com/jellyrock/jellyrock/pull/893)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update brighterscript-formatter from v1.8.1 to v1.8.2 ([#877](https://github.com/jellyrock/jellyrock/pull/877)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update roku-deploy from v3.18.3 to v3.18.4 ([#879](https://github.com/jellyrock/jellyrock/pull/879)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.28.0](https://github.com/jellyrock/jellyrock/compare/v2.27.0...v2.28.0) - 2026-09-04

### Changed

- Stop the playback error dialog exiting on a close it did not cause ([#876](https://github.com/jellyrock/jellyrock/pull/876)) by [@cewert](https://github.com/cewert)
- Migrate the playback error dialog onto `JRDialog` and make it diagnostic ([#875](https://github.com/jellyrock/jellyrock/pull/875)) by [@cewert](https://github.com/cewert)

### Fixed

- Guard `onKeyEvent` against key events delivered after teardown ([#883](https://github.com/jellyrock/jellyrock/pull/883)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update actions/setup-java action to v6 ([#874](https://github.com/jellyrock/jellyrock/pull/874)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update lint-staged from v17.3.0 to v17.4.1 ([#865](https://github.com/jellyrock/jellyrock/pull/865)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update softprops/action-gh-release action to v3.0.3 ([#873](https://github.com/jellyrock/jellyrock/pull/873)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update js-yaml from v5.3.0 to v5.4.1 ([#857](https://github.com/jellyrock/jellyrock/pull/857)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.27.0](https://github.com/jellyrock/jellyrock/compare/v2.26.1...v2.27.0) - 2026-08-31

### Added

- rebuild the playback-info report as a `source → target` readout ([#859](https://github.com/jellyrock/jellyrock/pull/859)) by [@cewert](https://github.com/cewert)

### Changed

- Size Home's browse feeds with one setting and measure its ceiling ([#864](https://github.com/jellyrock/jellyrock/pull/864)) by [@cewert](https://github.com/cewert)

### Fixed

- (playback) Direct-play music instead of transcoding it ([#870](https://github.com/jellyrock/jellyrock/pull/870)) by [@cewert](https://github.com/cewert)
- MPEG-2 transcoded despite its setting; AV1 ignored its level cap ([#868](https://github.com/jellyrock/jellyrock/pull/868)) by [@cewert](https://github.com/cewert)
- (setting) Honor a non-default Maximum Resolution instead of capping at 1080p ([#866](https://github.com/jellyrock/jellyrock/pull/866)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update roku-deploy from v3.18.2 to v3.18.3 ([#867](https://github.com/jellyrock/jellyrock/pull/867)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update eslint from v10.8.1 to v10.9.1 ([#839](https://github.com/jellyrock/jellyrock/pull/839)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update sharp from v0.35.3 to v0.35.4 ([#863](https://github.com/jellyrock/jellyrock/pull/863)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.26.1](https://github.com/jellyrock/jellyrock/compare/v2.26.0...v2.26.1) - 2026-08-26

### Fixed

- apply the user's Maximum Bitrate limit instead of discarding it ([#858](https://github.com/jellyrock/jellyrock/pull/858)) by [@cewert](https://github.com/cewert)

## [2.26.0](https://github.com/jellyrock/jellyrock/compare/v2.25.1...v2.26.0) - 2026-08-25

### Changed

- Collapse the dialog family onto one `computeDialogLayout` shape ([#852](https://github.com/jellyrock/jellyrock/pull/852)) by [@cewert](https://github.com/cewert)
- Give the app one authoritative "a session is established" signal ([#850](https://github.com/jellyrock/jellyrock/pull/850)) by [@cewert](https://github.com/cewert)
- Rebuild Quick Connect on the `JRDialog` family and the API pool ([#847](https://github.com/jellyrock/jellyrock/pull/847)) by [@cewert](https://github.com/cewert)
- Enforce a production Task-thread ceiling in `launchTask()` ([#849](https://github.com/jellyrock/jellyrock/pull/849)) by [@cewert](https://github.com/cewert)
- Bound Task fan-out structurally with a `no-task-fanout` BSC plugin ([#846](https://github.com/jellyrock/jellyrock/pull/846)) by [@cewert](https://github.com/cewert)
- Retire `SceneManager`'s dialog machinery for the `JRDialog` family ([#844](https://github.com/jellyrock/jellyrock/pull/844)) by [@cewert](https://github.com/cewert)
- Move `PlayerHostView` onto the standard dialogs and unify the chrome ([#842](https://github.com/jellyrock/jellyrock/pull/842)) by [@cewert](https://github.com/cewert)
- Give `cell-load` rates a denominator with scripted RTA sweeps ([#838](https://github.com/jellyrock/jellyrock/pull/838)) by [@cewert](https://github.com/cewert)
- Batch Home's row-size recompute across a latest-rows run ([#799](https://github.com/jellyrock/jellyrock/pull/799)) by [@cewert](https://github.com/cewert)

### Fixed

- stop `FontDownloadTask` crashing on servers that omit `EnableFallbackFont` ([#841](https://github.com/jellyrock/jellyrock/pull/841)) by [@cewert](https://github.com/cewert)
- Stop posters blinking on the Cast & Crew row as you scroll it ([#840](https://github.com/jellyrock/jellyrock/pull/840)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update vitest from v4.1.10 to v4.1.11 ([#831](https://github.com/jellyrock/jellyrock/pull/831)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update js-yaml from v5.2.3 to v5.3.0 ([#812](https://github.com/jellyrock/jellyrock/pull/812)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.25.1](https://github.com/jellyrock/jellyrock/compare/v2.25.0...v2.25.1) - 2026-08-17

### Changed

- Measure the pre-login flow, and fix the `roku-log` crash it exposed ([#817](https://github.com/jellyrock/jellyrock/pull/817)) by [@cewert](https://github.com/cewert)
- Read a screen in one batch, and report what an assertion checked ([#808](https://github.com/jellyrock/jellyrock/pull/808)) by [@cewert](https://github.com/cewert)

### Fixed

- (`ItemDetails`) drop redundant am/pm from the "Ends at" chip ([#826](https://github.com/jellyrock/jellyrock/pull/826)) by [@cewert](https://github.com/cewert)
- (overhang) stop long usernames rendering as a bare `...` in `JRDropdown` ([#825](https://github.com/jellyrock/jellyrock/pull/825)) by [@cewert](https://github.com/cewert)
- (performance) Destroy popped routed screens and fix the `BaseGridView` retain cycle ([#816](https://github.com/jellyrock/jellyrock/pull/816)) by [@cewert](https://github.com/cewert)
- (rta) record what became of a run, and read the baseline ([#806](https://github.com/jellyrock/jellyrock/pull/806)) by [@cewert](https://github.com/cewert)
- (rta) record which device a run drove in the run ledger ([8794b28](https://github.com/jellyrock/jellyrock/commit/8794b287)) by [@cewert](https://github.com/cewert)
- (rta) compare re-minted credentials by presence so the restore converges ([#805](https://github.com/jellyrock/jellyrock/pull/805)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update eslint-plugin-n from v18.2.2 to v18.3.0 ([#783](https://github.com/jellyrock/jellyrock/pull/783)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.25.0](https://github.com/jellyrock/jellyrock/compare/v2.24.2...v2.25.0) - 2026-08-10

### Added

- Add standard `JRDialog` dialog system with per-instance results ([#757](https://github.com/jellyrock/jellyrock/pull/757)) by [@cewert](https://github.com/cewert)
- (ci) Run the RTA suite in CI on the release-prep branch ([#772](https://github.com/jellyrock/jellyrock/pull/772)) by [@cewert](https://github.com/cewert)
- Bound Task threads behind an accounted `launchTask()` chokepoint ([#768](https://github.com/jellyrock/jellyrock/pull/768)) by [@cewert](https://github.com/cewert)
- Collapse `HomeRows` latest-media fan-out onto a bounded `apiPipeline` ([#762](https://github.com/jellyrock/jellyrock/pull/762)) by [@cewert](https://github.com/cewert)

### Changed

- Batch Home's latest-row item attach into one `appendChildren` call ([#792](https://github.com/jellyrock/jellyrock/pull/792)) by [@cewert](https://github.com/cewert)
- Draw the Genres view before its artwork has loaded ([#779](https://github.com/jellyrock/jellyrock/pull/779)) by [@cewert](https://github.com/cewert)
- Gate device tests behind maintainer approval for fork PRs only ([#773](https://github.com/jellyrock/jellyrock/pull/773)) by [@cewert](https://github.com/cewert)
- Run the Genres view's per-genre fetches through `apiPipeline` ([#770](https://github.com/jellyrock/jellyrock/pull/770)) by [@cewert](https://github.com/cewert)
- Measure the item-grid wait/emit split, pick `apiPipeline` for the genre loop, and keep the timers out of prod ([#769](https://github.com/jellyrock/jellyrock/pull/769)) by [@cewert](https://github.com/cewert)

### Fixed

- Index a season's episodes by position in `QuickPlayTask`, not by `IndexNumber` ([#796](https://github.com/jellyrock/jellyrock/pull/796)) by [@cewert](https://github.com/cewert)
- Scope resume queries to video items so Jellyfin 12.0 folders stay out of Continue Watching ([#794](https://github.com/jellyrock/jellyrock/pull/794)) by [@cewert](https://github.com/cewert)
- Fix Genres view spacing so each heading sits with its own posters ([#787](https://github.com/jellyrock/jellyrock/pull/787)) by [@cewert](https://github.com/cewert)
- (ui) render `Gradient` as a stretched tinted ramp poster ([#781](https://github.com/jellyrock/jellyrock/pull/781)) by [@cewert](https://github.com/cewert)
- (lint) stop the cursor nudge reading Recently-shipped as the cursor ([#771](https://github.com/jellyrock/jellyrock/pull/771)) by [@cewert](https://github.com/cewert)
- Tighten Task-node hygiene and remove stranded dialog helpers ([#765](https://github.com/jellyrock/jellyrock/pull/765)) by [@cewert](https://github.com/cewert)
- Remove invalid `focusable` attribute from `<component>` elements ([#767](https://github.com/jellyrock/jellyrock/pull/767)) by [@cewert](https://github.com/cewert)
- `ws://` remote-control socket task-thread leak ([#756](https://github.com/jellyrock/jellyrock/pull/756)) by [@cewert](https://github.com/cewert)
- move log-manager init to `JRScene` so global nodes can log ([#761](https://github.com/jellyrock/jellyrock/pull/761)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update eslint from v10.8.0 to v10.8.1 ([#780](https://github.com/jellyrock/jellyrock/pull/780)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update actions/setup-java action to v5.7.0 ([#763](https://github.com/jellyrock/jellyrock/pull/763)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update lint-staged from v17.2.0 to v17.3.0 ([#755](https://github.com/jellyrock/jellyrock/pull/755)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update actions/stale action to v11 ([#764](https://github.com/jellyrock/jellyrock/pull/764)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update js-yaml from v5.2.2 to v5.2.3 ([#758](https://github.com/jellyrock/jellyrock/pull/758)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.24.2](https://github.com/jellyrock/jellyrock/compare/v2.24.1...v2.24.2) - 2026-07-31

### Fixed

- (remote-control) bind `ws://` socket to the advertised `DeviceId` ([#747](https://github.com/jellyrock/jellyrock/pull/747)) by [@cewert](https://github.com/cewert)
- (api) route `SubmitSideEffect` through a children-as-vehicle FIFO ([#745](https://github.com/jellyrock/jellyrock/pull/745)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update source-map from v0.7.6 to v0.8.0 ([#725](https://github.com/jellyrock/jellyrock/pull/725)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update eslint from v10.7.0 to v10.8.0 ([#746](https://github.com/jellyrock/jellyrock/pull/746)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update markdownlint-cli2 from v0.23.1 to v0.23.2 ([#749](https://github.com/jellyrock/jellyrock/pull/749)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update lint-staged from v17.0.8 to v17.2.0 ([#722](https://github.com/jellyrock/jellyrock/pull/722)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update actions/checkout action to v7.0.1 ([#748](https://github.com/jellyrock/jellyrock/pull/748)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update js-yaml from v5.2.1 to v5.2.2 ([#740](https://github.com/jellyrock/jellyrock/pull/740)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update roku-deploy from v3.17.7 to v3.18.2 ([#715](https://github.com/jellyrock/jellyrock/pull/715)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.24.1](https://github.com/jellyrock/jellyrock/compare/v2.24.0...v2.24.1) - 2026-07-24

### Fixed

- (osd) Offer manual segment-skip button on replay after one-time auto-skip ([#739](https://github.com/jellyrock/jellyrock/pull/739)) by [@cewert](https://github.com/cewert)
- Guard `VideoPlayerView` notifications against teardown race crash ([#738](https://github.com/jellyrock/jellyrock/pull/738)) by [@cewert](https://github.com/cewert)
- Fix `inferServerUrl` crash from stale pre-login intents ([#736](https://github.com/jellyrock/jellyrock/pull/736)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update prettier from v3.9.5 to v3.9.6 ([#726](https://github.com/jellyrock/jellyrock/pull/726)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.24.0](https://github.com/jellyrock/jellyrock/compare/v2.23.0...v2.24.0) - 2026-07-22

### Added

- (remote-control) ack long-poll commands for at-least-once delivery ([#727](https://github.com/jellyrock/jellyrock/pull/727)) by [@cewert](https://github.com/cewert)

### Changed

- Redesign `/crash-report` to enrich-before-file with disposition routing to epics ([#730](https://github.com/jellyrock/jellyrock/pull/730)) by [@cewert](https://github.com/cewert)
- Report cold-launch pairing and stabilize `DeviceId` on 10.11+ ([#721](https://github.com/jellyrock/jellyrock/pull/721)) by [@cewert](https://github.com/cewert)

### Fixed

- Stop `Home` from clobbering the foreground backdrop when opening deep-link ([#719](https://github.com/jellyrock/jellyrock/pull/719)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update actions/setup-node action to v7 ([#724](https://github.com/jellyrock/jellyrock/pull/724)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update softprops/action-gh-release action to v3.0.2 ([#723](https://github.com/jellyrock/jellyrock/pull/723)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update markdownlint-cli2 from v0.23.0 to v0.23.1 ([#720](https://github.com/jellyrock/jellyrock/pull/720)) by [@renovate[bot]](https://github.com/apps/renovate)
- GitHub Actions ([#713](https://github.com/jellyrock/jellyrock/pull/713)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.23.0](https://github.com/jellyrock/jellyrock/compare/v2.22.0...v2.23.0) - 2026-07-16

### Added

- Add HTTPS long-poll transport for "Cast to JellyRock" ([#714](https://github.com/jellyrock/jellyrock/pull/714)) by [@cewert](https://github.com/cewert)
- Add native `ws://` remote-control receiver (Cast to JellyRock) ([#707](https://github.com/jellyrock/jellyrock/pull/707)) by [@cewert](https://github.com/cewert)

### Changed

- Stop cast `DisplayContent` mirroring from covering active playback ([#716](https://github.com/jellyrock/jellyrock/pull/716)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update eslint from v10.6.0 to v10.7.0 ([#709](https://github.com/jellyrock/jellyrock/pull/709)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update adm-zip from v0.5.18 to v0.6.0 ([#708](https://github.com/jellyrock/jellyrock/pull/708)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update eslint-plugin-n from v18.2.1 to v18.2.2 ([#710](https://github.com/jellyrock/jellyrock/pull/710)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update prettier from v3.9.4 to v3.9.5 ([#706](https://github.com/jellyrock/jellyrock/pull/706)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.22.0](https://github.com/jellyrock/jellyrock/compare/v2.21.0...v2.22.0) - 2026-07-09

### Added

- Add the `/dep-major` skill for major dependency bumps ([#656](https://github.com/jellyrock/jellyrock/pull/656)) by [@cewert](https://github.com/cewert)
- Add a structured agent + contributor workflow ([#670](https://github.com/jellyrock/jellyrock/pull/670)) by [@cewert](https://github.com/cewert)

### Changed

- Restore navigation loading spinners lost in the `sgRouter` migration ([#696](https://github.com/jellyrock/jellyrock/pull/696)) by [@cewert](https://github.com/cewert)
- Route navigation through `sgRouter`; add deep-link/cast contract ([#677](https://github.com/jellyrock/jellyrock/pull/677)) by [@cewert](https://github.com/cewert)

### Fixed

- Fix missing community/critic ratings on `Episode` and other item types ([#702](https://github.com/jellyrock/jellyrock/pull/702)) by [@cewert](https://github.com/cewert)
- (format) pin `brighterscript-formatter` to 1.7.27 (revert 1.7.28 indent regression) ([#684](https://github.com/jellyrock/jellyrock/pull/684)) by [@cewert](https://github.com/cewert)
- (settings) point keyboard submit-key KDFs at the icon assets that exist ([#682](https://github.com/jellyrock/jellyrock/pull/682)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update roku-deploy from v3.17.6 to v3.17.7 ([#703](https://github.com/jellyrock/jellyrock/pull/703)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update vitest from v4.1.8 to v4.1.10 ([#700](https://github.com/jellyrock/jellyrock/pull/700)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update awalsh128/cache-apt-pkgs-action action to v1.6.3 ([#699](https://github.com/jellyrock/jellyrock/pull/699)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update actions/setup-java action to v5.4.0 ([#701](https://github.com/jellyrock/jellyrock/pull/701)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update markdownlint-cli2 from v0.22.1 to v0.23.0 ([#693](https://github.com/jellyrock/jellyrock/pull/693)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update js-yaml from v4.2.0 to v5.2.1 ([#681](https://github.com/jellyrock/jellyrock/pull/681), [#672](https://github.com/jellyrock/jellyrock/pull/672), [#694](https://github.com/jellyrock/jellyrock/pull/694)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update sharp from v0.34.5 to v0.35.3 ([#657](https://github.com/jellyrock/jellyrock/pull/657), [#665](https://github.com/jellyrock/jellyrock/pull/665), [#692](https://github.com/jellyrock/jellyrock/pull/692)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update sgRouter to v0.1.4 ([#690](https://github.com/jellyrock/jellyrock/pull/690)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update brighterscript-formatter from v1.7.27 to v1.8.1 ([#678](https://github.com/jellyrock/jellyrock/pull/678), [#688](https://github.com/jellyrock/jellyrock/pull/688)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update prettier from v3.8.4 to v3.9.4 ([#680](https://github.com/jellyrock/jellyrock/pull/680), [#687](https://github.com/jellyrock/jellyrock/pull/687)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update adm-zip from v0.5.17 to v0.5.18 ([#686](https://github.com/jellyrock/jellyrock/pull/686)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update GitHub Actions from v1.6.1 to v5.3.0 ([#663](https://github.com/jellyrock/jellyrock/pull/663), [#673](https://github.com/jellyrock/jellyrock/pull/673), [#674](https://github.com/jellyrock/jellyrock/pull/674)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update linting from v10.5.0 to v18.1.0 ([#661](https://github.com/jellyrock/jellyrock/pull/661), [#658](https://github.com/jellyrock/jellyrock/pull/658)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update vitest monorepo to v4.1.9 ([#664](https://github.com/jellyrock/jellyrock/pull/664)) by [@renovate[bot]](https://github.com/apps/renovate)
- GitHub Actions (checkout v7, cache v6) + allow-unsafe-pr-checkout opt-in ([#675](https://github.com/jellyrock/jellyrock/pull/675)) by [@renovate[bot]](https://github.com/apps/renovate)
- Linting (eslint 10.6.0, eslint-plugin-n 18.2.1, prettier 3.9.1) ([#679](https://github.com/jellyrock/jellyrock/pull/679)) by [@renovate[bot]](https://github.com/apps/renovate)
- Git hooks ([#671](https://github.com/jellyrock/jellyrock/pull/671)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.21.0](https://github.com/jellyrock/jellyrock/compare/v2.20.0...v2.21.0) - 2026-06-12

### Added

- Add library + item-type gallery screenshots + store/website split ([#648](https://github.com/jellyrock/jellyrock/pull/648)) by [@cewert](https://github.com/cewert)
- (i18n) add global sign-in screen language setting ([#638](https://github.com/jellyrock/jellyrock/pull/638)) by [@cewert](https://github.com/cewert)

### Changed

- (screenshots) lossless WebP + prune non-store languages ([#652](https://github.com/jellyrock/jellyrock/pull/652)) by [@cewert](https://github.com/cewert)
- Per-language store screenshots + RTA functional-test layer ([#642](https://github.com/jellyrock/jellyrock/pull/642)) by [@cewert](https://github.com/cewert)

### Fixed

- (search) localize search result-row headers ([#649](https://github.com/jellyrock/jellyrock/pull/649)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update promises from v0.7.0 to v0.7.1 ([#646](https://github.com/jellyrock/jellyrock/pull/646)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update ropm from v0.11.8 to v0.11.9 ([#645](https://github.com/jellyrock/jellyrock/pull/645)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update brighterscript from v1.0.0 to v1.7.27 ([#644](https://github.com/jellyrock/jellyrock/pull/644)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update linting to v3.8.4 ([#643](https://github.com/jellyrock/jellyrock/pull/643)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update js-yaml from v4.1.1 to v4.2.0 ([#640](https://github.com/jellyrock/jellyrock/pull/640)) by [@renovate[bot]](https://github.com/apps/renovate)
- Pin dependencies ([#647](https://github.com/jellyrock/jellyrock/pull/647)) by [@renovate[bot]](https://github.com/apps/renovate)
- Pin dependencies ([#639](https://github.com/jellyrock/jellyrock/pull/639)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.20.0](https://github.com/jellyrock/jellyrock/compare/v2.19.0...v2.20.0) - 2026-06-08

### Added

- (promises) collapse GetFiltersTask + LoadChannelListForQueueTask to render-thread promises (#551) ([#628](https://github.com/jellyrock/jellyrock/pull/628)) by [@cewert](https://github.com/cewert)
- (promises) collapse LoadProgramDetailsTask to a render-thread promise (#551) ([#627](https://github.com/jellyrock/jellyrock/pull/627)) by [@cewert](https://github.com/cewert)
- (promises) collapse the watched toggle to a render-thread promise ([#626](https://github.com/jellyrock/jellyrock/pull/626)) by [@cewert](https://github.com/cewert)
- (login) collapse Branding + QuickConnect Tasks to render-thread promises ([#625](https://github.com/jellyrock/jellyrock/pull/625)) by [@cewert](https://github.com/cewert)

### Changed

- (quickplay) collapse dead album/artist dispatch aliases to canonical type ([#631](https://github.com/jellyrock/jellyrock/pull/631)) by [@cewert](https://github.com/cewert)
- Adopt `@rokucommunity/promises` foundation + 3 reference migrations ([#624](https://github.com/jellyrock/jellyrock/pull/624)) by [@cewert](https://github.com/cewert)

### Fixed

- (server-upgrade) decouple diff anchor from resolved-through ([#634](https://github.com/jellyrock/jellyrock/pull/634)) by [@cewert](https://github.com/cewert)
- (quickplay) key Play All dispatch on canonical Jellyfin item type ([#630](https://github.com/jellyrock/jellyrock/pull/630)) by [@cewert](https://github.com/cewert)
- (playback) restore ts-first transcode container order in `getTranscodingProfiles` ([#620](https://github.com/jellyrock/jellyrock/pull/620)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update roku deploy & test to v3.17.6 ([#619](https://github.com/jellyrock/jellyrock/pull/619)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.19.0](https://github.com/jellyrock/jellyrock/compare/v2.18.0...v2.19.0) - 2026-06-04

### Changed

- Skip Roku device tests when only Node tests change ([#616](https://github.com/jellyrock/jellyrock/pull/616)) by [@cewert](https://github.com/cewert)
- Auto-prune the shipped log and backtick code identifiers in PR titles ([#615](https://github.com/jellyrock/jellyrock/pull/615)) by [@cewert](https://github.com/cewert)
- Unify `GridItem`/`GridItemSmall` and fix genre grid rendering ([#613](https://github.com/jellyrock/jellyrock/pull/613)) by [@cewert](https://github.com/cewert)

### Fixed

- (playback) preserve surround on multichannel transcode fallback ([#574](https://github.com/jellyrock/jellyrock/pull/574)) by [@cewert](https://github.com/cewert)
- Fix photo selection opening the viewer behind `ItemDetails` ([#614](https://github.com/jellyrock/jellyrock/pull/614)) by [@cewert](https://github.com/cewert)

## [2.18.0](https://github.com/jellyrock/jellyrock/compare/v2.17.0...v2.18.0) - 2026-06-03

### Added

- Add proactive PR-time floor-coverage lint ([#607](https://github.com/jellyrock/jellyrock/pull/607)) by [@cewert](https://github.com/cewert)
- Add /crash-report + /crash-backtrace for weekly Roku crash triage ([#575](https://github.com/jellyrock/jellyrock/pull/575)) by [@cewert](https://github.com/cewert)
- Add JRPlaceholder, placeholder pipeline, and outlined icon defaults ([#561](https://github.com/jellyrock/jellyrock/pull/561)) by [@cewert](https://github.com/cewert)
- Add Material Symbols icon pipeline with per-resolution assets ([#560](https://github.com/jellyrock/jellyrock/pull/560)) by [@cewert](https://github.com/cewert)

### Changed

- Support RC + unstable/master channels in server-upgrade automation ([#610](https://github.com/jellyrock/jellyrock/pull/610)) by [@cewert](https://github.com/cewert)
- Version-guard the Lyrics request on Jellyfin 10.9+ ([#605](https://github.com/jellyrock/jellyrock/pull/605)) by [@cewert](https://github.com/cewert)
- Server-upgrade automation: detect + triage Jellyfin API changes that affect us (Phases 0–6) ([#597](https://github.com/jellyrock/jellyrock/pull/597)) by [@cewert](https://github.com/cewert)
- Expand placeholder coverage to grids, audio player, and item details ([#567](https://github.com/jellyrock/jellyrock/pull/567)) by [@cewert](https://github.com/cewert)
- renovate: strip rules now covered by org default ([#590](https://github.com/jellyrock/jellyrock/pull/590)) by [@cewert](https://github.com/cewert)
- vscode: associate dotfiles to stop markdownlint false positives ([#589](https://github.com/jellyrock/jellyrock/pull/589)) by [@cewert](https://github.com/cewert)
- Skills overhaul: /catchup, journal sync, /pr update-path ([#559](https://github.com/jellyrock/jellyrock/pull/559)) by [@cewert](https://github.com/cewert)

### Fixed

- (ci) pass PR title/author/labels via env in journal-sync (command injection) ([#604](https://github.com/jellyrock/jellyrock/pull/604)) by [@cewert](https://github.com/cewert)
- (server-upgrade) clearer digest counts, honest root-cause comments, harden commit-msg injection ([#603](https://github.com/jellyrock/jellyrock/pull/603)) by [@cewert](https://github.com/cewert)
- Fix server-upgrade tracker issue writes (REST) + digest legend & nudge ([#600](https://github.com/jellyrock/jellyrock/pull/600)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update rooibos-roku to v6.0.0 ([#609](https://github.com/jellyrock/jellyrock/pull/609), [#593](https://github.com/jellyrock/jellyrock/pull/593)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update brighterscript to v1.0.0 ([#608](https://github.com/jellyrock/jellyrock/pull/608), [#586](https://github.com/jellyrock/jellyrock/pull/586)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update vitest from v4.1.5 to v4.1.8 ([#572](https://github.com/jellyrock/jellyrock/pull/572), [#581](https://github.com/jellyrock/jellyrock/pull/581), [#606](https://github.com/jellyrock/jellyrock/pull/606)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update lint-staged from v16.4.0 to v17.0.7 ([#577](https://github.com/jellyrock/jellyrock/pull/577), [#596](https://github.com/jellyrock/jellyrock/pull/596), [#598](https://github.com/jellyrock/jellyrock/pull/598)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update ropm from v0.11.5 to v0.11.8 ([#571](https://github.com/jellyrock/jellyrock/pull/571), [#588](https://github.com/jellyrock/jellyrock/pull/588), [#595](https://github.com/jellyrock/jellyrock/pull/595)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update roku-deploy from v3.17.2 to v3.17.5 ([#570](https://github.com/jellyrock/jellyrock/pull/570), [#578](https://github.com/jellyrock/jellyrock/pull/578), [#594](https://github.com/jellyrock/jellyrock/pull/594)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update eslint from v10.3.0 to v10.4.1 ([#576](https://github.com/jellyrock/jellyrock/pull/576), [#592](https://github.com/jellyrock/jellyrock/pull/592)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update @rokucommunity/bslint to v1.0.0 ([#587](https://github.com/jellyrock/jellyrock/pull/587)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update brighterscript-formatter from v1.7.24 to v1.7.26 ([#569](https://github.com/jellyrock/jellyrock/pull/569), [#580](https://github.com/jellyrock/jellyrock/pull/580)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update undent from v1.0.0 to v1.0.1 ([#579](https://github.com/jellyrock/jellyrock/pull/579)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update eslint-plugin-n from v17.24.0 to v18 ([#549](https://github.com/jellyrock/jellyrock/pull/549)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update ajv from v6.15.0 to v8 ([#556](https://github.com/jellyrock/jellyrock/pull/556)) by [@renovate[bot]](https://github.com/apps/renovate)
- Actions/stale digest to eb5cf3a ([#591](https://github.com/jellyrock/jellyrock/pull/591)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.17.0](https://github.com/jellyrock/jellyrock/compare/v2.16.0...v2.17.0) - 2026-05-07

### Added

- (playback) wire Roku voice transport controls ([#554](https://github.com/jellyrock/jellyrock/pull/554)) by [@cewert](https://github.com/cewert)

### Changed

- Overhaul dev-experience: skills, agents, four-pillar journals ([#555](https://github.com/jellyrock/jellyrock/pull/555)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update roku-deploy from v3.17.1 to v3.17.2 ([#552](https://github.com/jellyrock/jellyrock/pull/552)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.16.0](https://github.com/jellyrock/jellyrock/compare/v2.15.0...v2.16.0) - 2026-05-05

### Added

- (translations) seed Language* keys in non-English locales from CLDR ([#543](https://github.com/jellyrock/jellyrock/pull/543)) by [@cewert](https://github.com/cewert)
- (release) add local package:signed for Roku channel-store .pkg ([#542](https://github.com/jellyrock/jellyrock/pull/542)) by [@cewert](https://github.com/cewert)
- Add Vitest coverage for update-translations and changelog-syncer ([#538](https://github.com/jellyrock/jellyrock/pull/538)) by [@cewert](https://github.com/cewert)
- JS hygiene (ESLint+Prettier+Vitest) + scripts/ reorg + 134 tests ([#536](https://github.com/jellyrock/jellyrock/pull/536)) by [@cewert](https://github.com/cewert)
- feat(agents)+ci: doc-maintenance enforcement + layered verification surfaces ([#534](https://github.com/jellyrock/jellyrock/pull/534)) by [@cewert](https://github.com/cewert)
- agent-context system (docs + governance tooling) ([#533](https://github.com/jellyrock/jellyrock/pull/533)) by [@cewert](https://github.com/cewert)

### Changed

- adopt on* prefix style for lifecycle/event callbacks ([#539](https://github.com/jellyrock/jellyrock/pull/539)) by [@cewert](https://github.com/cewert)

### Fixed

- (playback) deprioritize commentary audio tracks; restore OSD switching ([#544](https://github.com/jellyrock/jellyrock/pull/544)) by [@cewert](https://github.com/cewert)
- (ci) patch rooibos coverage to avoid render-thread watchdog ([#540](https://github.com/jellyrock/jellyrock/pull/540)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update brighterscript-formatter from v1.7.23 to v1.7.24 ([#532](https://github.com/jellyrock/jellyrock/pull/532)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.15.0](https://github.com/jellyrock/jellyrock/compare/v2.14.0...v2.15.0) - 2026-04-30

### Added

- (ItemDetails) Replace settings button with inline TrackDropdown cluster ([#487](https://github.com/jellyrock/jellyrock/pull/487)) by [@cewert](https://github.com/cewert)

### Fixed

- (itemDetails) localize audio/subtitle track language names ([#527](https://github.com/jellyrock/jellyrock/pull/527)) by [@cewert](https://github.com/cewert)
- (trackDropdown) measure dropdown width with themed Label ([#526](https://github.com/jellyrock/jellyrock/pull/526)) by [@cewert](https://github.com/cewert)

## [2.14.0](https://github.com/jellyrock/jellyrock/compare/v2.13.0...v2.14.0) - 2026-04-29

### Added

- support Quick Connect on Jellyfin 10.7.x ([#523](https://github.com/jellyrock/jellyrock/pull/523)) by [@cewert](https://github.com/cewert)

### Fixed

- Quick Connect on Jellyfin 10.9+ servers ([#522](https://github.com/jellyrock/jellyrock/pull/522)) by [@cewert](https://github.com/cewert)
- (tests) use canonical 'en_US' locale in BaseTestSuite ([ad50e1c](https://github.com/jellyrock/jellyrock/commit/ad50e1c2)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update roku-deploy from v3.17.0 to v3.17.1 ([#521](https://github.com/jellyrock/jellyrock/pull/521)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.13.0](https://github.com/jellyrock/jellyrock/compare/v2.12.0...v2.13.0) - 2026-04-28

### Added

- (Home) add Active Recordings section type ([#499](https://github.com/jellyrock/jellyrock/pull/499)) by [@cewert](https://github.com/cewert)

### Changed

- Move Quick Connect to User Select screen ([#506](https://github.com/jellyrock/jellyrock/pull/506)) by [@cewert](https://github.com/cewert)
- Live TV OSD + DVR recording playback improvements ([#501](https://github.com/jellyrock/jellyrock/pull/501)) by [@cewert](https://github.com/cewert)

### Fixed

- (playback) direct-play multichannel audio by default and preserve surround codec on transcode ([#513](https://github.com/jellyrock/jellyrock/pull/513)) by [@cewert](https://github.com/cewert)
- (itemdetails) stable date-added label position on first render ([#503](https://github.com/jellyrock/jellyrock/pull/503)) by [@cewert](https://github.com/cewert)
- (chapters) align synthetic-chapter threshold with displayed runtime ([#502](https://github.com/jellyrock/jellyrock/pull/502)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update roku-deploy from v3.16.4 to v3.17.0 ([#497](https://github.com/jellyrock/jellyrock/pull/497), [#511](https://github.com/jellyrock/jellyrock/pull/511)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update markdownlint-cli2 from v0.22.0 to v0.22.1 ([#505](https://github.com/jellyrock/jellyrock/pull/505)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update brighterscript-formatter from v1.7.22 to v1.7.23 ([#498](https://github.com/jellyrock/jellyrock/pull/498)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update softprops/action-gh-release action to v3 ([#493](https://github.com/jellyrock/jellyrock/pull/493)) by [@renovate[bot]](https://github.com/apps/renovate)
- Github actions ([#504](https://github.com/jellyrock/jellyrock/pull/504), [#492](https://github.com/jellyrock/jellyrock/pull/492)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.12.0](https://github.com/jellyrock/jellyrock/compare/v2.11.1...v2.12.0) - 2026-04-13

### Added

- live progress bar on Program cells ([#486](https://github.com/jellyrock/jellyrock/pull/486)) by [@cewert](https://github.com/cewert)

### Fixed

- prevent stale field re-fires on scene restore (quickPlayNode/selectedItem) ([#494](https://github.com/jellyrock/jellyrock/pull/494)) by [@cewert](https://github.com/cewert)
- validate URLs before HTTP requests to prevent Invalid-to-String crash ([#491](https://github.com/jellyrock/jellyrock/pull/491)) by [@cewert](https://github.com/cewert)
- trickplay carousel not rendering after boolean prefix refactor ([#489](https://github.com/jellyrock/jellyrock/pull/489)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update dotenv from v17.4.1 to v17.4.2 ([#490](https://github.com/jellyrock/jellyrock/pull/490)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.11.1](https://github.com/jellyrock/jellyrock/compare/v2.11.0...v2.11.1) - 2026-04-10

### Added

- (docs) matrix chat link to readme ([9d8fb7f](https://github.com/jellyrock/jellyrock/commit/9d8fb7f6)) by [@cewert](https://github.com/cewert)

### Fixed

- API timeouts + TV Guide performance + quickplay ([#480](https://github.com/jellyrock/jellyrock/pull/480)) by [@cewert](https://github.com/cewert)
- use GetDayOfWeek() instead of GetWeekday() for weekday index ([b07d5a7](https://github.com/jellyrock/jellyrock/commit/b07d5a7b)) by [@cewert](https://github.com/cewert)

## [2.11.0](https://github.com/jellyrock/jellyrock/compare/v2.10.1...v2.11.0) - 2026-04-09

### Added

- Add Chapter support to ItemDetails ([#476](https://github.com/jellyrock/jellyrock/pull/476)) by [@cewert](https://github.com/cewert)
- Add 7 premade themes and fix overhang bug when switching theme ([#472](https://github.com/jellyrock/jellyrock/pull/472)) by [@cewert](https://github.com/cewert)
- upgrade BrighterScript to v1 ([#457](https://github.com/jellyrock/jellyrock/pull/457)) by [@cewert](https://github.com/cewert)

### Changed

- code cleanup — naming conventions, enums, and style guide ([#467](https://github.com/jellyrock/jellyrock/pull/467)) by [@cewert](https://github.com/cewert)

### Fixed

- guard GetWeekday() crash in Live TV schedule ([#477](https://github.com/jellyrock/jellyrock/pull/477)) by [@cewert](https://github.com/cewert)
- restore overhang icon focus when returning to Home screen ([55218b9](https://github.com/jellyrock/jellyrock/commit/55218b9a)) by [@cewert](https://github.com/cewert)
- hide library tile backdrop when poster is already loaded ([42b9aff](https://github.com/jellyrock/jellyrock/commit/42b9aff8)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update roku-deploy from v3.16.3 to v3.16.4 ([#471](https://github.com/jellyrock/jellyrock/pull/471)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.10.1](https://github.com/jellyrock/jellyrock/compare/v2.10.0...v2.10.1) - 2026-04-07

### Fixed

- audio/subtitle track selection and playback position ([#464](https://github.com/jellyrock/jellyrock/pull/464)) by [@cewert](https://github.com/cewert)
- sort BoxSet/Collection movies by release date ([#463](https://github.com/jellyrock/jellyrock/pull/463)) by [@cewert](https://github.com/cewert)
- report position at video duration when force-finishing playback ([98d8ac9](https://github.com/jellyrock/jellyrock/commit/98d8ac91)) by [@cewert](https://github.com/cewert)

## [2.10.0](https://github.com/jellyrock/jellyrock/compare/v2.9.0...v2.10.0) - 2026-04-06

### Added

- add .editorconfig file to ensure consistant styling ([2a07113](https://github.com/jellyrock/jellyrock/commit/2a071131)) by [@cewert](https://github.com/cewert)
- custom translation engine with 98 locales and Weblate CI/CD ([#451](https://github.com/jellyrock/jellyrock/pull/451)) by [@cewert](https://github.com/cewert)

### Changed

- OptionsSlider to not extend PanelSet ([#455](https://github.com/jellyrock/jellyrock/pull/455)) by [@cewert](https://github.com/cewert)

### Fixed

- explicitly mark episode as watched when skipping outro ([#458](https://github.com/jellyrock/jellyrock/pull/458)) by [@cewert](https://github.com/cewert)
- set state to hidden in VideoNotification.destroy() to prevent crash ([4a91606](https://github.com/jellyrock/jellyrock/commit/4a916066)) by [@cewert](https://github.com/cewert)
- resolve captionTask data race crash ([#453](https://github.com/jellyrock/jellyrock/pull/453)) by [@cewert](https://github.com/cewert)
- (translation) rebuild translation key constants when en_US.json is edited ([a2ac7fb](https://github.com/jellyrock/jellyrock/commit/a2ac7fbb)) by [@cewert](https://github.com/cewert)
- (translation) use ellipsis instead of three dots ([6440cf2](https://github.com/jellyrock/jellyrock/commit/6440cf24)) by [@cewert](https://github.com/cewert)
- (ci) gate device tests behind environment approval ([fe16ab4](https://github.com/jellyrock/jellyrock/commit/fe16ab49)) by [@cewert](https://github.com/cewert)

### Removed

- unused field alias ([c4c6948](https://github.com/jellyrock/jellyrock/commit/c4c6948f)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update dotenv from v17.4.0 to v17.4.1 ([#456](https://github.com/jellyrock/jellyrock/pull/456)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.9.0](https://github.com/jellyrock/jellyrock/compare/v2.8.0...v2.9.0) - 2026-04-02

### Added

- Add media segment detection and skip notifications ([#447](https://github.com/jellyrock/jellyrock/pull/447)) by [@cewert](https://github.com/cewert)
- add texture management to MarkupGrid ([#444](https://github.com/jellyrock/jellyrock/pull/444)) by [@cewert](https://github.com/cewert)
- add RowList texture management and placeholder images ([#443](https://github.com/jellyrock/jellyrock/pull/443)) by [@cewert](https://github.com/cewert)

### Fixed

- dismiss stale segment notifications on back-to-back transitions ([#448](https://github.com/jellyrock/jellyrock/pull/448)) by [@cewert](https://github.com/cewert)
- captionTask crash on orphaned timer after player teardown ([#446](https://github.com/jellyrock/jellyrock/pull/446)) by [@cewert](https://github.com/cewert)
- overhang focus always defaults to active tab ([#441](https://github.com/jellyrock/jellyrock/pull/441)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update dotenv from v17.3.1 to v17.4.0 ([#445](https://github.com/jellyrock/jellyrock/pull/445)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.8.0](https://github.com/jellyrock/jellyrock/compare/v2.7.0...v2.8.0) - 2026-03-31

### Added

- Add search and settings icon buttons to overhang ([#438](https://github.com/jellyrock/jellyrock/pull/438)) by [@cewert](https://github.com/cewert)
- add user dropdown to overhang ([#437](https://github.com/jellyrock/jellyrock/pull/437)) by [@cewert](https://github.com/cewert)
- add Reset User Settings button ([#436](https://github.com/jellyrock/jellyrock/pull/436)) by [@cewert](https://github.com/cewert)

## [2.7.0](https://github.com/jellyrock/jellyrock/compare/v2.6.0...v2.7.0) - 2026-03-30

### Added

- Add ItemDetails support for Photo, PhotoAlbum, TvChannel, and Program ([#431](https://github.com/jellyrock/jellyrock/pull/431)) by [@cewert](https://github.com/cewert)
- (playback) add language preference override settings ([#428](https://github.com/jellyrock/jellyrock/pull/428)) by [@cewert](https://github.com/cewert)
- intelligent video source selection and OSD source switching ([#424](https://github.com/jellyrock/jellyrock/pull/424)) by [@cewert](https://github.com/cewert)

### Fixed

- (playback) allow direct play of anamorphic video by default ([#433](https://github.com/jellyrock/jellyrock/pull/433)) by [@cewert](https://github.com/cewert)
- h264 device profile and level override issues ([#432](https://github.com/jellyrock/jellyrock/pull/432)) by [@cewert](https://github.com/cewert)
- (ItemDetails) preserve date label Y position on refresh (#427 follow-up) ([c76c272](https://github.com/jellyrock/jellyrock/commit/c76c2723)) by [@cewert](https://github.com/cewert)
- (ItemDetails) restore item logo for primary-image fallback types ([#427](https://github.com/jellyrock/jellyrock/pull/427)) by [@cewert](https://github.com/cewert)
- run captionTask VTT fetch on Task thread ([#425](https://github.com/jellyrock/jellyrock/pull/425)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update brighterscript from v0.70.4 to v0.71.0 ([#426](https://github.com/jellyrock/jellyrock/pull/426)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.6.0](https://github.com/jellyrock/jellyrock/compare/v2.5.0...v2.6.0) - 2026-03-27

### Added

- Add voice search from Home screen ([#421](https://github.com/jellyrock/jellyrock/pull/421)) by [@cewert](https://github.com/cewert)
- add horizontal wrap for short RowList rows ([#420](https://github.com/jellyrock/jellyrock/pull/420)) by [@cewert](https://github.com/cewert)

## [2.5.0](https://github.com/jellyrock/jellyrock/compare/v2.4.0...v2.5.0) - 2026-03-26

### Added

- two-tier API task pool, async button UX, and toast notifications ([#414](https://github.com/jellyrock/jellyrock/pull/414)) by [@cewert](https://github.com/cewert)
- Theme preset system with conditional settings ([#410](https://github.com/jellyrock/jellyrock/pull/410)) by [@cewert](https://github.com/cewert)

### Fixed

- bug in itemDetails animation target after opening extras rows ([#416](https://github.com/jellyrock/jellyrock/pull/416)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update @rokucommunity/bslint from v0.8.39 to v0.8.41 ([#403](https://github.com/jellyrock/jellyrock/pull/403), [#415](https://github.com/jellyrock/jellyrock/pull/415)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update brighterscript from v0.70.3 to v0.70.4 ([#404](https://github.com/jellyrock/jellyrock/pull/404)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update roku-deploy from v3.16.2 to v3.16.3 ([#406](https://github.com/jellyrock/jellyrock/pull/406)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update brighterscript-formatter from v1.7.21 to v1.7.22 ([#405](https://github.com/jellyrock/jellyrock/pull/405)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.4.0](https://github.com/jellyrock/jellyrock/compare/v2.3.0...v2.4.0) - 2026-03-24

### Added

- (extras) improve UX by animating panel on row focus change ([#400](https://github.com/jellyrock/jellyrock/pull/400)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update actions/cache action to v5.0.4 ([#398](https://github.com/jellyrock/jellyrock/pull/398)) by [@renovate[bot]](https://github.com/apps/renovate)
- Github actions (major) ([#399](https://github.com/jellyrock/jellyrock/pull/399)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.3.0](https://github.com/jellyrock/jellyrock/compare/v2.2.0...v2.3.0) - 2026-03-23

### Added

- expand supported item types for search and favorites ([#393](https://github.com/jellyrock/jellyrock/pull/393)) by [@cewert](https://github.com/cewert)
- (ItemDetails) Add support for type `Playlist` ([#389](https://github.com/jellyrock/jellyrock/pull/389)) by [@cewert](https://github.com/cewert)
- (ItemDetails) Add support for types `Artist`, `Album`, and `Song` ([#387](https://github.com/jellyrock/jellyrock/pull/387)) by [@cewert](https://github.com/cewert)
- (home) Tab navigation, skeleton loading, and Favorites tab ([#384](https://github.com/jellyrock/jellyrock/pull/384)) by [@cewert](https://github.com/cewert)
- Add self-hosted GitHub Actions runner for Roku hardware tests + migrate to GitHub App auth ([#385](https://github.com/jellyrock/jellyrock/pull/385)) by [@cewert](https://github.com/cewert)

### Fixed

- (LoadingButton) correct spinner size and button frame on ItemDetails ([#395](https://github.com/jellyrock/jellyrock/pull/395)) by [@cewert](https://github.com/cewert)
- (osd) limit OSD logo image height to 300px ([#394](https://github.com/jellyrock/jellyrock/pull/394)) by [@cewert](https://github.com/cewert)
- bslint build warnings  ([#391](https://github.com/jellyrock/jellyrock/pull/391)) by [@cewert](https://github.com/cewert)
- don't run device unit tests for automated commits ([445d473](https://github.com/jellyrock/jellyrock/commit/445d473)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update markdownlint-cli2 from v0.21.0 to v0.22.0 ([#390](https://github.com/jellyrock/jellyrock/pull/390)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update @rokucommunity/bslint from v0.8.38 to v0.8.39 ([#386](https://github.com/jellyrock/jellyrock/pull/386)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.2.0](https://github.com/jellyrock/jellyrock/compare/v2.1.0...v2.2.0) - 2026-03-17

### Added

- (ItemDetails) Add support for type `BoxSet` ([#380](https://github.com/jellyrock/jellyrock/pull/380)) by [@cewert](https://github.com/cewert)
- add destroy() to all remaining screens ([#379](https://github.com/jellyrock/jellyrock/pull/379)) by [@cewert](https://github.com/cewert)

### Fixed

- TvChannel playback and implement OSD CurrentProgram metadata ([#381](https://github.com/jellyrock/jellyrock/pull/381)) by [@cewert](https://github.com/cewert)

### Removed

- dead tmp:/scene file operations for screensaver ([#378](https://github.com/jellyrock/jellyrock/pull/378)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update softprops/action-gh-release action to v2.6.1 ([#377](https://github.com/jellyrock/jellyrock/pull/377)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.1.0](https://github.com/jellyrock/jellyrock/compare/v2.0.1...v2.1.0) - 2026-03-16

### Added

- add JRRowItem, standardize home/extras/search rows ([#371](https://github.com/jellyrock/jellyrock/pull/371)) by [@cewert](https://github.com/cewert)
- Add ApiClient abstraction layer with image injection ([#370](https://github.com/jellyrock/jellyrock/pull/370)) by [@cewert](https://github.com/cewert)
- multi-network server discovery with original URL persistence ([#369](https://github.com/jellyrock/jellyrock/pull/369)) by [@cewert](https://github.com/cewert)
- Add support for all Jellyfin server versions 10.7.x+ ([#368](https://github.com/jellyrock/jellyrock/pull/368)) by [@cewert](https://github.com/cewert)

### Fixed

- use server ID for deduplication and preserve original URL ([#374](https://github.com/jellyrock/jellyrock/pull/374)) by [@cewert](https://github.com/cewert)
- use primary image in logo slot for Episode/Season/Recording ([#373](https://github.com/jellyrock/jellyrock/pull/373)) by [@cewert](https://github.com/cewert)
- (JRRowItem) Season/Episode title order and MusicVideo slot ([#372](https://github.com/jellyrock/jellyrock/pull/372)) by [@cewert](https://github.com/cewert)
- (SearchResults) prevent stale backdrop when keyboard is focused ([e99e62b](https://github.com/jellyrock/jellyrock/commit/e99e62b)) by [@cewert](https://github.com/cewert)

## [2.0.1](https://github.com/jellyrock/jellyrock/compare/v2.0.0...v2.0.1) - 2026-03-10

### Fixed

- (ItemDetails) prevent extras pane from opening when grid is empty ([ec5a2dd](https://github.com/jellyrock/jellyrock/commit/ec5a2dd)) by [@cewert](https://github.com/cewert)
- (ItemDetails) missing Watched button for type `Series` and `Season` ([2b06857](https://github.com/jellyrock/jellyrock/commit/2b06857)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update roku-deploy from v3.16.1 to v3.16.2 ([#364](https://github.com/jellyrock/jellyrock/pull/364)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update brighterscript-formatter from v1.7.19 to v1.7.21 ([#363](https://github.com/jellyrock/jellyrock/pull/363)) by [@renovate[bot]](https://github.com/apps/renovate)

## [2.0.0](https://github.com/jellyrock/jellyrock/compare/v1.16.0...v2.0.0) - 2026-03-09

### Added

- (extras) show More Like This row for episode type ([1330489](https://github.com/jellyrock/jellyrock/commit/1330489)) by [@cewert](https://github.com/cewert)
- Support direct playing `truehd`, `dtshd`, and `mpeg1video` ([#359](https://github.com/jellyrock/jellyrock/pull/359)) by [@cewert](https://github.com/cewert)
- Support direct playing more h264 profiles ([bf2891c](https://github.com/jellyrock/jellyrock/commit/bf2891c)) by [@cewert](https://github.com/cewert)
- Use `ItemDetails` to open `Person` items ([#358](https://github.com/jellyrock/jellyrock/pull/358)) by [@cewert](https://github.com/cewert)
- show Go to Series button for Episode items ([bcfe2c2](https://github.com/jellyrock/jellyrock/commit/bcfe2c2)) by [@cewert](https://github.com/cewert)
- Use `ItemDetails` to open `Season` items ([#352](https://github.com/jellyrock/jellyrock/pull/352)) by [@cewert](https://github.com/cewert)
- Support direct playing h264 profile "Constrained Baseline" ([f5e9f0e](https://github.com/jellyrock/jellyrock/commit/f5e9f0e)) by [@cewert](https://github.com/cewert)
- (itemDetails) universal detail screen replacing MovieDetails and TVShowDetails ([#351](https://github.com/jellyrock/jellyrock/pull/351)) by [@cewert](https://github.com/cewert)
- universal JellyfinBaseItem ContentNode ([#349](https://github.com/jellyrock/jellyrock/pull/349)) by [@cewert](https://github.com/cewert)

### Changed

- Limit all quickplay API queries to 500 items ([4d271a5](https://github.com/jellyrock/jellyrock/commit/4d271a5)) by [@cewert](https://github.com/cewert)
- show episode in Series resume button ([11f0e12](https://github.com/jellyrock/jellyrock/commit/11f0e12)) by [@cewert](https://github.com/cewert)
- adjust extras panel layout and hide metadata during transition ([c6be05a](https://github.com/jellyrock/jellyrock/commit/c6be05a)) by [@cewert](https://github.com/cewert)

### Fixed

- OSD logo not displaying and add image fallbacks for all types ([415512b](https://github.com/jellyrock/jellyrock/commit/415512b)) by [@cewert](https://github.com/cewert)
- Add null check for hideNextEpisodeButtonAnimation to prevent crash ([a3d2c85](https://github.com/jellyrock/jellyrock/commit/a3d2c85)) by [@cewert](https://github.com/cewert)
- focus no longer stolen when returning from extras sub-screen on Series ([9c87a75](https://github.com/jellyrock/jellyrock/commit/9c87a75)) by [@cewert](https://github.com/cewert)
- quickplay.series() logic. check for resumeable episode first ([76e86c0](https://github.com/jellyrock/jellyrock/commit/76e86c0)) by [@cewert](https://github.com/cewert)
- sync Series Resume button logic with Home rows ([#355](https://github.com/jellyrock/jellyrock/pull/355)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update spellchecker-cli from v7.0.2 to v7.0.3 ([#354](https://github.com/jellyrock/jellyrock/pull/354)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update brighterscript-xml-plugin from v0.2.1 to v0.3.2 ([#347](https://github.com/jellyrock/jellyrock/pull/347), [#353](https://github.com/jellyrock/jellyrock/pull/353)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update actions/upload-artifact action to v7 ([#348](https://github.com/jellyrock/jellyrock/pull/348)) by [@renovate[bot]](https://github.com/apps/renovate)
- Github actions ([#360](https://github.com/jellyrock/jellyrock/pull/360)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.16.0](https://github.com/jellyrock/jellyrock/compare/v1.15.0...v1.16.0) - 2026-02-24

### Added

- auto-retry with transcode on live-stream direct-play failure ([#344](https://github.com/jellyrock/jellyrock/pull/344)) by [@cewert](https://github.com/cewert)

### Fixed

- auto-retry with direct play on DoVi buffer overflow ([#343](https://github.com/jellyrock/jellyrock/pull/343)) by [@cewert](https://github.com/cewert)

### Dependencies

- Actions/stale digest to b5d41d4 ([#340](https://github.com/jellyrock/jellyrock/pull/340)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.15.0](https://github.com/jellyrock/jellyrock/compare/v1.14.0...v1.15.0) - 2026-02-23

### Added

- dynamic HLS segment length to prevent buffer overflow ([#338](https://github.com/jellyrock/jellyrock/pull/338)) by [@cewert](https://github.com/cewert)
- custom media track formatting and subtitle display ([#333](https://github.com/jellyrock/jellyrock/pull/333)) by [@cewert](https://github.com/cewert)

### Changed

- lower video playbackTimer from 30 to 10 seconds ([f1191d1](https://github.com/jellyrock/jellyrock/commit/f1191d1)) by [@cewert](https://github.com/cewert)

### Fixed

- enforce paired Height+Width resolution caps across all codec profiles ([#339](https://github.com/jellyrock/jellyrock/pull/339)) by [@cewert](https://github.com/cewert)
- prevent h264 playback failures due to resolution ([bf7d4e2](https://github.com/jellyrock/jellyrock/commit/bf7d4e2)) ([54d1a32](https://github.com/jellyrock/jellyrock/commit/54d1a32)) by [@cewert](https://github.com/cewert)
- VP9 HDR playback and add Dolby Vision Profile 7 support ([ef25339](https://github.com/jellyrock/jellyrock/commit/ef25339)) by [@cewert](https://github.com/cewert)
- on-device decode setting ignored when no receiver connected ([#334](https://github.com/jellyrock/jellyrock/pull/334)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update rimraf from v6.1.2 to v6.1.3 ([#336](https://github.com/jellyrock/jellyrock/pull/336)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update markdownlint-cli2 from v0.20.0 to v0.21.0 ([#335](https://github.com/jellyrock/jellyrock/pull/335)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.14.0](https://github.com/jellyrock/jellyrock/compare/v1.13.0...v1.14.0) - 2026-02-10

### Added

- add exit confirmation dialog when pressing back on home screen ([#330](https://github.com/jellyrock/jellyrock/pull/330)) by [@cewert](https://github.com/cewert)
- Add Date Added Display to MovieDetails Screen ([#329](https://github.com/jellyrock/jellyrock/pull/329)) by [@cewert](https://github.com/cewert)

### Dependencies

- Actions/checkout digest to de0fac2 ([#328](https://github.com/jellyrock/jellyrock/pull/328)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.13.0](https://github.com/jellyrock/jellyrock/compare/v1.12.1...v1.13.0) - 2026-02-09

### Added

- add refresh button to MovieDetails ([#325](https://github.com/jellyrock/jellyrock/pull/325)) by [@cewert](https://github.com/cewert)
- animate MovieDetails info with extras slider ([#324](https://github.com/jellyrock/jellyrock/pull/324)) by [@cewert](https://github.com/cewert)
- FocusableOverview for MovieDetails  ([#322](https://github.com/jellyrock/jellyrock/pull/322)) by [@cewert](https://github.com/cewert)
- add Delete button to MovieDetails based on server permissions ([#321](https://github.com/jellyrock/jellyrock/pull/321)) by [@cewert](https://github.com/cewert)

### Changed

- remove redundant JRButtonGroup focus() helper ([#323](https://github.com/jellyrock/jellyrock/pull/323)) by [@cewert](https://github.com/cewert)

### Fixed

- prevent OverviewDialog from triggering MovieDetails data refresh ([db2616c](https://github.com/jellyrock/jellyrock/commit/db2616c)) by [@cewert](https://github.com/cewert)
- movieDetails options button dialog ([c0a339e](https://github.com/jellyrock/jellyrock/commit/c0a339e)) by [@cewert](https://github.com/cewert)
- exclude homevideos from photo presenter mapping ([82b3ab1](https://github.com/jellyrock/jellyrock/commit/82b3ab1)) by [@cewert](https://github.com/cewert)

## [1.12.1](https://github.com/jellyrock/jellyrock/compare/v1.12.0...v1.12.1) - 2026-02-06

### Added

- Add `FocusableOverview` component and improve PersonDetails readability ([#318](https://github.com/jellyrock/jellyrock/pull/318)) by [@cewert](https://github.com/cewert)

### Fixed

- MovieDetails description alignment and `Ends At` text ([#317](https://github.com/jellyrock/jellyrock/pull/317)) by [@cewert](https://github.com/cewert)

## [1.12.0](https://github.com/jellyrock/jellyrock/compare/v1.11.0...v1.12.0) - 2026-02-05

### Changed

- refactor MovieDetails layout ([#314](https://github.com/jellyrock/jellyrock/pull/314)) by [@cewert](https://github.com/cewert)

### Fixed

- livetv guide focus bug and speed up animation ([fd67594](https://github.com/jellyrock/jellyrock/commit/fd67594)) by [@cewert](https://github.com/cewert)
- thshowDetails focus bug and extraSlider alignment ([a593435](https://github.com/jellyrock/jellyrock/commit/a593435)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update actions/cache action to v5.0.3 ([#313](https://github.com/jellyrock/jellyrock/pull/313)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.11.0](https://github.com/jellyrock/jellyrock/compare/v1.10.0...v1.11.0) - 2026-02-02

### Added

- add customizable theme color user settings ([#309](https://github.com/jellyrock/jellyrock/pull/309)) by [@cewert](https://github.com/cewert)

### Changed

-  feat(HexKeyboard): add reset button for custom theme color settings  ([#310](https://github.com/jellyrock/jellyrock/pull/310)) by [@cewert](https://github.com/cewert)

## [1.10.0](https://github.com/cewert/jellyrock/compare/v1.9.1...v1.10.0) - 2026-01-29

### Added

- add LiveTV and Photo `BaseGridView` presenters ([#305](https://github.com/cewert/jellyrock/pull/305)) by [@cewert](https://github.com/cewert)
- add smart down-key navigation for JRMarkupGrid ([187401d](https://github.com/cewert/jellyrock/commit/187401d)) by [@cewert](https://github.com/cewert)

### Changed

- update artistView to use the new BackdropFader component ([#306](https://github.com/cewert/jellyrock/pull/306)) by [@cewert](https://github.com/cewert)
- Consolidate duplicated ItemGrid library components ([#304](https://github.com/cewert/jellyrock/pull/304)) by [@cewert](https://github.com/cewert)
- enable loadSync for local UI posters ([bc99715](https://github.com/cewert/jellyrock/commit/bc99715)) by [@cewert](https://github.com/cewert)
- replace ItemGrid maskGroup scaling with JRMarkupGrid focus indicator ([#297](https://github.com/cewert/jellyrock/pull/297)) by [@cewert](https://github.com/cewert)

### Fixed

- show trickplay thumbnails on low RAM devices ([#301](https://github.com/cewert/jellyrock/pull/301)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update ropm from v0.11.2 to v0.11.4 ([#300](https://github.com/cewert/jellyrock/pull/300), [#303](https://github.com/cewert/jellyrock/pull/303)) by [@renovate[bot]](https://github.com/apps/renovate)
- Actions/setup-java digest to be666c2 ([#302](https://github.com/cewert/jellyrock/pull/302)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.9.1](https://github.com/cewert/jellyrock/compare/v1.9.0...v1.9.1) - 2026-01-20

### Fixed

- prevent video auto-replay when returning to episode list ([21d1538](https://github.com/cewert/jellyrock/commit/21d1538)) by [@cewert](https://github.com/cewert)

### Dependencies

- Github actions ([#293](https://github.com/cewert/jellyrock/pull/293)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.9.0](https://github.com/cewert/jellyrock/compare/v1.8.0...v1.9.0) - 2026-01-19

### Added

- Add trickplay carousel for video scrubbing ([#291](https://github.com/cewert/jellyrock/pull/291)) by [@cewert](https://github.com/cewert)

### Changed

- use bullet instead of dash for movie homeitem subtext ([f7d2dd0](https://github.com/cewert/jellyrock/commit/f7d2dd0)) by [@cewert](https://github.com/cewert)
- changed: enable loadSync for local UI posters ([bbb5f99](https://github.com/cewert/jellyrock/commit/bbb5f99)) by [@cewert](https://github.com/cewert)

### Fixed

- incorrect backdrop image dimensions ([19f8b88](https://github.com/cewert/jellyrock/commit/19f8b88)) by [@cewert](https://github.com/cewert)

## [1.8.0](https://github.com/cewert/jellyrock/compare/v1.7.1...v1.8.0) - 2026-01-12

### Added

- apply global theme to settings and display app version ([#286](https://github.com/cewert/jellyrock/pull/286)) by [@cewert](https://github.com/cewert)

### Fixed

- build warnings by tagging unused variables ([38fb7d0](https://github.com/cewert/jellyrock/commit/38fb7d0)) by [@cewert](https://github.com/cewert)
- remove unused id parameter from sortSubtitles function ([5b65680](https://github.com/cewert/jellyrock/commit/5b65680)) by [@cewert](https://github.com/cewert)
- improve search textbox focus UX and address unused param (ref #132) ([9ec1ae1](https://github.com/cewert/jellyrock/commit/9ec1ae1)) by [@cewert](https://github.com/cewert)

## [1.7.1](https://github.com/cewert/jellyrock/compare/v1.7.0...v1.7.1) - 2026-01-07

### Fixed

- silent crash when quickplaying from search results ([#283](https://github.com/cewert/jellyrock/pull/283)) by [@cewert](https://github.com/cewert)
- external stream (.strm) playback broken ([#282](https://github.com/cewert/jellyrock/pull/282)) by [@cewert](https://github.com/cewert)

## [1.7.0](https://github.com/cewert/jellyrock/compare/v1.6.0...v1.7.0) - 2026-01-06

### Added

- integrate AudioPlayerView with app-wide BackdropFader component ([#277](https://github.com/cewert/jellyrock/pull/277)) by [@cewert](https://github.com/cewert)
- improve OSD metadata display ([#275](https://github.com/cewert/jellyrock/pull/275)) by [@cewert](https://github.com/cewert)
- display community and critic ratings in OSD ([#274](https://github.com/cewert/jellyrock/pull/274)) by [@cewert](https://github.com/cewert)

### Changed

- make OSD progressBar wider ([7ca3936](https://github.com/cewert/jellyrock/commit/7ca3936)) by [@cewert](https://github.com/cewert)
- MovieDetails metadata display with dynamic rating components ([#273](https://github.com/cewert/jellyrock/pull/273)) by [@cewert](https://github.com/cewert)
- Complete video player migration to VideoPlayerView ([#266](https://github.com/cewert/jellyrock/pull/266)) by [@cewert](https://github.com/cewert)

### Fixed

- Fix backdrop darkness inconsistency and TV show navigation flicker ([#278](https://github.com/cewert/jellyrock/pull/278)) by [@cewert](https://github.com/cewert)
- (tvshows) restore smaller community rating in TV list details ([34a6469](https://github.com/cewert/jellyrock/commit/34a6469)) by [@cewert](https://github.com/cewert)
- Backdrop not updating when watched item removed from home row ([#276](https://github.com/cewert/jellyrock/pull/276)) by [@cewert](https://github.com/cewert)
- reduce maxHeight to 300 for OSD logo image ([91c5fe1](https://github.com/cewert/jellyrock/commit/91c5fe1)) by [@cewert](https://github.com/cewert)
- resolve external SubRip subtitle display issues ([#272](https://github.com/cewert/jellyrock/pull/272)) by [@cewert](https://github.com/cewert)
- eliminate duplicate ItemPostPlaybackInfo calls during video load ([#271](https://github.com/cewert/jellyrock/pull/271)) by [@cewert](https://github.com/cewert)
- stale backdrops during video playlist playback ([#269](https://github.com/cewert/jellyrock/pull/269)) by [@cewert](https://github.com/cewert)
- Next Episode button positioning on first appearance ([5bcd978](https://github.com/cewert/jellyrock/commit/5bcd978)) by [@cewert](https://github.com/cewert)
- device profile level calculation ([#268](https://github.com/cewert/jellyrock/pull/268)) by [@cewert](https://github.com/cewert)
- prevent crash when using shuffle on TV Show ([9556953](https://github.com/cewert/jellyrock/commit/9556953)) by [@cewert](https://github.com/cewert)
- preserve dovi not working when type = episode ([ece7107](https://github.com/cewert/jellyrock/commit/ece7107)) by [@cewert](https://github.com/cewert)
- show Next Episode button regardless of auto-play setting ([f0e1cb5](https://github.com/cewert/jellyrock/commit/f0e1cb5)) by [@cewert](https://github.com/cewert)
- prevent crash when seasonData is invalid ([84ee89a](https://github.com/cewert/jellyrock/commit/84ee89a)) by [@cewert](https://github.com/cewert)
- Fix MovieOptions crash and implement dynamic options button ([#264](https://github.com/cewert/jellyrock/pull/264)) by [@cewert](https://github.com/cewert)

## [1.6.0](https://github.com/cewert/jellyrock/compare/v1.5.3...v1.6.0) - 2025-12-16

### Added

- add Resume button with progress bar to MovieDetails ([#256](https://github.com/cewert/jellyrock/pull/256)) by [@cewert](https://github.com/cewert)

### Dependencies

- Github actions (major) ([#261](https://github.com/cewert/jellyrock/pull/261)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.5.3](https://github.com/cewert/jellyrock/compare/v1.5.2...v1.5.3) - 2025-12-15

### Changed

- full-screen components to extend JRScreen ([#255](https://github.com/cewert/jellyrock/pull/255)) by [@cewert](https://github.com/cewert)

### Fixed

- validate VideoType to prevent crash ([5888568](https://github.com/cewert/jellyrock/commit/5888568)) by [@cewert](https://github.com/cewert)
- restore focus when returning to AlbumView, PlaylistView, and TVEpisodes ([#254](https://github.com/cewert/jellyrock/pull/254)) by [@cewert](https://github.com/cewert)

## [1.5.2](https://github.com/cewert/jellyrock/compare/v1.5.1...v1.5.2) - 2025-12-12

### Changed

- don't save user credentials by default ([17a0cd8](https://github.com/cewert/jellyrock/commit/17a0cd8)) by [@cewert](https://github.com/cewert)

### Fixed

- global settings registry routing and eliminate double-writes ([#249](https://github.com/cewert/jellyrock/pull/249)) by [@cewert](https://github.com/cewert)

## [1.5.1](https://github.com/cewert/jellyrock/compare/v1.5.0...v1.5.1) - 2025-12-11

### Fixed

- prevent crash when using back button from user select screen ([#246](https://github.com/cewert/jellyrock/pull/246)) by [@cewert](https://github.com/cewert)

## [1.5.0](https://github.com/cewert/jellyrock/compare/v1.4.2...v1.5.0) - 2025-12-10

### Added

- add global splash screen setting ([#243](https://github.com/cewert/jellyrock/pull/243)) by [@cewert](https://github.com/cewert)
- add user setting to disable backdrop images ([#239](https://github.com/cewert/jellyrock/pull/239)) by [@cewert](https://github.com/cewert)
- Add backdrop fade transitions with BackdropFader component ([#235](https://github.com/cewert/jellyrock/pull/235)) by [@cewert](https://github.com/cewert)

### Fixed

- splash image not displaying after logout ([#242](https://github.com/cewert/jellyrock/pull/242)) by [@cewert](https://github.com/cewert)
- Fix splashscreen feature - Move to login screen with proper API verification ([#240](https://github.com/cewert/jellyrock/pull/240)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update markdownlint-cli2 from v0.19.1 to v0.20.0 ([#234](https://github.com/cewert/jellyrock/pull/234)) by [@renovate[bot]](https://github.com/apps/renovate)
- Github actions ([#238](https://github.com/cewert/jellyrock/pull/238)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.4.2](https://github.com/cewert/jellyrock/compare/v1.4.1...v1.4.2) - 2025-12-06

### Fixed

- crash on Continue Watching when hitting OK on an episode or recording ([c500b9b](https://github.com/cewert/jellyrock/commit/c500b9b)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update roku-deploy from v3.15.0 to v3.16.1 ([#231](https://github.com/cewert/jellyrock/pull/231)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.4.1](https://github.com/cewert/jellyrock/compare/v1.4.0...v1.4.1) - 2025-12-04

### Fixed

- playback crash when UserData is invalid ([f6017c6](https://github.com/cewert/jellyrock/commit/f6017c6)) by [@cewert](https://github.com/cewert)
- prevent crash when media UserData is invalid ([e08a698](https://github.com/cewert/jellyrock/commit/e08a698)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update spellchecker-cli from v7.0.1 to v7.0.2 ([#227](https://github.com/cewert/jellyrock/pull/227)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.4.0](https://github.com/cewert/jellyrock/compare/v1.3.0...v1.4.0) - 2025-12-02

### Changed

- Migrate MovieDetails to IconButton with improved sizing for icon text ([#221](https://github.com/cewert/jellyrock/pull/221)) by [@cewert](https://github.com/cewert)
- Refactor AudioPlayerView - use IconButton components and fix image bugs ([#218](https://github.com/cewert/jellyrock/pull/218)) by [@cewert](https://github.com/cewert)
- Cleanup and theme the Alpha Menu ([#212](https://github.com/cewert/jellyrock/pull/212)) by [@cewert](https://github.com/cewert)
- remove `white_focus.9.png` 9patch image ([eda1e9d](https://github.com/cewert/jellyrock/commit/eda1e9d)) by [@cewert](https://github.com/cewert)

### Fixed

- lost focus bug when returning to artistview screen ([90d02ea](https://github.com/cewert/jellyrock/commit/90d02ea)) by [@cewert](https://github.com/cewert)
- placeholder image not showing for private users on UserSelect screen ([#223](https://github.com/cewert/jellyrock/pull/223)) by [@cewert](https://github.com/cewert)
- alpha menu mic alignment and color ([a6b6a23](https://github.com/cewert/jellyrock/commit/a6b6a23)) by [@cewert](https://github.com/cewert)
- Fix TextButton uneven padding ([#220](https://github.com/cewert/jellyrock/pull/220)) by [@cewert](https://github.com/cewert)
- make default user image in overhang match the one used in User Select ([51b0952](https://github.com/cewert/jellyrock/commit/51b0952)) by [@cewert](https://github.com/cewert)

### Removed

- redundant sidebar menu on music artist screen ([#211](https://github.com/cewert/jellyrock/pull/211)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update softprops/action-gh-release action to v2.5.0 ([#204](https://github.com/cewert/jellyrock/pull/204)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.3.0](https://github.com/cewert/jellyrock/compare/v1.2.0...v1.3.0) - 2025-11-26

### Added

- claude agent to analyze PR code reviews ([924e6c3](https://github.com/cewert/jellyrock/commit/924e6c3)) by [@cewert](https://github.com/cewert)

### Changed

- Refactor 9-patch images and fix library view backgrounds ([#208](https://github.com/cewert/jellyrock/pull/208)) by [@cewert](https://github.com/cewert)
- (ui) improve button focus borders with optimized 9-patch implementation ([#206](https://github.com/cewert/jellyrock/pull/206)) by [@cewert](https://github.com/cewert)
- Separate TV channel number and name in OSD display ([#202](https://github.com/cewert/jellyrock/pull/202)) by [@cewert](https://github.com/cewert)
- LiveTV guide view not displaying on initial load ([#199](https://github.com/cewert/jellyrock/pull/199)) by [@cewert](https://github.com/cewert)
- Replace custom buttons with JRButtonGroup in ProgramDetails ([#197](https://github.com/cewert/jellyrock/pull/197)) by [@cewert](https://github.com/cewert)
- cache m.global node references to reduce render thread overhead ([2c21862](https://github.com/cewert/jellyrock/commit/2c21862)) by [@cewert](https://github.com/cewert)
- Preserve DoVi in MKV containers by forcing a remux ([#193](https://github.com/cewert/jellyrock/pull/193)) by [@cewert](https://github.com/cewert)
- extract username sanitization into pure function ([b259c4e](https://github.com/cewert/jellyrock/commit/b259c4e)) by [@cewert](https://github.com/cewert)
- Enable MKV container support via manifest flag ([#195](https://github.com/cewert/jellyrock/pull/195)) by [@cewert](https://github.com/cewert)
- Optimize bot instruction files ([#192](https://github.com/cewert/jellyrock/pull/192)) by [@cewert](https://github.com/cewert)

### Fixed

- playback crash when videoContent[0] is invalid ([7d159f7](https://github.com/cewert/jellyrock/commit/7d159f7)) by [@cewert](https://github.com/cewert)

### Removed

- Remove hardcoded defaults from server-authoritative user settings ([#201](https://github.com/cewert/jellyrock/pull/201)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update actions/checkout action to v6 ([#205](https://github.com/cewert/jellyrock/pull/205)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update markdownlint-cli2 from v0.19.0 to v0.19.1 ([#196](https://github.com/cewert/jellyrock/pull/196)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update rimraf from v6.1.0 to v6.1.2 ([#191](https://github.com/cewert/jellyrock/pull/191)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.2.0](https://github.com/cewert/jellyrock/compare/v1.1.5...v1.2.0) - 2025-11-19

### Added

- Add `Decode Multichannel Audio` setting ([#187](https://github.com/cewert/jellyrock/pull/187)) by [@cewert](https://github.com/cewert)

### Changed

- Use Roku OS language as fallback for audio track selection ([#188](https://github.com/cewert/jellyrock/pull/188)) by [@cewert](https://github.com/cewert)

## [1.1.5](https://github.com/cewert/jellyrock/compare/v1.1.4...v1.1.5) - 2025-11-18

### Added

- Add `Play Default Audio Track` setting ([#184](https://github.com/cewert/jellyrock/pull/184)) by [@cewert](https://github.com/cewert)
- (docs) add comprehensive user settings implementation guide ([72694f4](https://github.com/cewert/jellyrock/commit/72694f4)) by [@cewert](https://github.com/cewert)

### Changed

- Improve registry migration robustness and test cleanup ([#183](https://github.com/cewert/jellyrock/pull/183)) by [@cewert](https://github.com/cewert)
- Preserve multichannel audio via passthrough for surround receivers ([#174](https://github.com/cewert/jellyrock/pull/174)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update roku-deploy from v3.14.4 to v3.15.0 ([#180](https://github.com/cewert/jellyrock/pull/180)) by [@renovate[bot]](https://github.com/apps/renovate)
- Github actions ([#176](https://github.com/cewert/jellyrock/pull/176)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.1.4](https://github.com/cewert/jellyrock/compare/v1.1.3...v1.1.4) - 2025-11-17

### Changed

- Unify audio stream selection with hardware detection ([#169](https://github.com/cewert/jellyrock/pull/169)) by [@cewert](https://github.com/cewert)

### Fixed

- Fix audio/subtitle stream selection for LoadVideoContentTask ([#168](https://github.com/cewert/jellyrock/pull/168)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update spellchecker-cli from v7.0.0 to v7.0.1 ([#170](https://github.com/cewert/jellyrock/pull/170)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.1.3](https://github.com/cewert/jellyrock/compare/v1.1.2...v1.1.3) - 2025-11-14

### Changed

- revert out of scope changes from #154 ([62b82fb](https://github.com/cewert/jellyrock/commit/62b82fb)) by [@cewert](https://github.com/cewert)
- Move AAC profile detection to playback initialization ([#154](https://github.com/cewert/jellyrock/pull/154)) by [@cewert](https://github.com/cewert)

### Fixed

- Fix runtime crash when accessing `UserData` in `HomeData` ([#157](https://github.com/cewert/jellyrock/pull/157)) by [@cewert](https://github.com/cewert)
- Fix transcoding errors for usernames with spaces (Jellyfin 10.11.x) ([#155](https://github.com/cewert/jellyrock/pull/155)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update markdownlint-cli2 from v0.18.1 to v0.19.0 ([#158](https://github.com/cewert/jellyrock/pull/158)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.1.2](https://github.com/cewert/jellyrock/compare/v1.1.1...v1.1.2) - 2025-11-09

### Fixed

- Fix audio stream selection regression ([#151](https://github.com/cewert/jellyrock/pull/151)) by [@cewert](https://github.com/cewert)
- Fix duplicate video player creation on quickPlay ([#148](https://github.com/cewert/jellyrock/pull/148)) by [@cewert](https://github.com/cewert)

## [1.1.1](https://github.com/cewert/jellyrock/compare/v1.1.0...v1.1.1) - 2025-11-07

### Fixed

- Fix video codec UI display using getFirstVideoStream helper ([#145](https://github.com/cewert/jellyrock/pull/145)) by [@cewert](https://github.com/cewert)
- Fix H264/HEVC profile level override checking wrong stream type ([#143](https://github.com/cewert/jellyrock/pull/143)) by [@copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent)
- Fix MaxVideoDecodeResolution and codec checks using wrong stream ([#144](https://github.com/cewert/jellyrock/pull/144)) by [@copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent)
- Fix audio track selection: return Jellyfin stream index instead of array position ([#135](https://github.com/cewert/jellyrock/pull/135)) by [@cewert](https://github.com/cewert)
- Fix directPlaySupported() checking wrong stream type ([#142](https://github.com/cewert/jellyrock/pull/142)) by [@copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent)
- Fix OSD playback info showing incorrect stream data ([#136](https://github.com/cewert/jellyrock/pull/136)) by [@cewert](https://github.com/cewert)

## [1.1.0](https://github.com/cewert/jellyrock/compare/v1.0.4...v1.1.0) - 2025-11-03

### Added

- channel store link to readme and release notes ([b71db07](https://github.com/cewert/jellyrock/commit/b71db07)) by [@cewert](https://github.com/cewert)

### Changed

- preserve scopes in changelog entries and use message action words for dependencies ([195e1f6](https://github.com/cewert/jellyrock/commit/195e1f6)) by [@cewert](https://github.com/cewert)
- consolidate duplicate dependency entries in changelog ([a29c0b2](https://github.com/cewert/jellyrock/commit/a29c0b2)) by [@cewert](https://github.com/cewert)
- Set button focusBackground to colorBackgroundSecondary ([05d5cc4](https://github.com/cewert/jellyrock/commit/05d5cc4)) by [@cewert](https://github.com/cewert)
- Make OSD "Ends At" text bold ([54f313d](https://github.com/cewert/jellyrock/commit/54f313d)) by [@cewert](https://github.com/cewert)
- Auto scale user image to preserve texture memory ([#129](https://github.com/cewert/jellyrock/pull/129)) by [@cewert](https://github.com/cewert)
- Improve support for Direct Playing HDR videos ([#128](https://github.com/cewert/jellyrock/pull/128)) by [@roidy](https://github.com/roidy)
- Use `ContentNode` instead of AA for `m.global` + refactor tests ([#116](https://github.com/cewert/jellyrock/pull/116)) by [@cewert](https://github.com/cewert)
- Use SubtitleSelection enum instead of magic numbers ([#113](https://github.com/cewert/jellyrock/pull/113)) by [@mtlynch](https://github.com/mtlynch)

### Fixed

- prevent bot commits from triggering changelog-sync workflow ([4e63c32](https://github.com/cewert/jellyrock/commit/4e63c32)) by [@cewert](https://github.com/cewert)
- prevent fork PRs from accessing secrets in update-settings-docs workflow ([b3344ac](https://github.com/cewert/jellyrock/commit/b3344ac)) by [@cewert](https://github.com/cewert)
- prevent duplicate builds on PR push ([0719eed](https://github.com/cewert/jellyrock/commit/0719eed)) by [@cewert](https://github.com/cewert)
- workflows failing to commit changes due to branch protections ([6e05827](https://github.com/cewert/jellyrock/commit/6e05827)) by [@cewert](https://github.com/cewert)
- run build workflow for all PR commits ([f3b37bf](https://github.com/cewert/jellyrock/commit/f3b37bf)) by [@cewert](https://github.com/cewert)
- skip build-translation job for fork PRs to prevent secret exposure ([4b03b27](https://github.com/cewert/jellyrock/commit/4b03b27)) by [@cewert](https://github.com/cewert)

### Dependencies

- Update @rokucommunity/bslint from v0.8.35 to v0.8.38 ([#99](https://github.com/cewert/jellyrock/pull/99), [#124](https://github.com/cewert/jellyrock/pull/124)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update brighterscript from v0.70.1 to v0.70.3 ([#100](https://github.com/cewert/jellyrock/pull/100), [#125](https://github.com/cewert/jellyrock/pull/125)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update ropm from v0.11.0 to v0.11.2 ([#102](https://github.com/cewert/jellyrock/pull/102), [#127](https://github.com/cewert/jellyrock/pull/127)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update roku-deploy from v3.13.0 to v3.14.4 ([#121](https://github.com/cewert/jellyrock/pull/121), [#122](https://github.com/cewert/jellyrock/pull/122)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update rimraf from v6.0.1 to v6.1.0 ([#123](https://github.com/cewert/jellyrock/pull/123)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update actions/upload-artifact action to v5 ([#118](https://github.com/cewert/jellyrock/pull/118)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update brighterscript-formatter from v1.7.18 to v1.7.19 ([#101](https://github.com/cewert/jellyrock/pull/101)) by [@renovate[bot]](https://github.com/apps/renovate)
- Update peter-evans/repository-dispatch action to v4 ([#98](https://github.com/cewert/jellyrock/pull/98)) by [@renovate[bot]](https://github.com/apps/renovate)
- Github actions (major) ([#109](https://github.com/cewert/jellyrock/pull/109)) by [@renovate[bot]](https://github.com/apps/renovate)
- Pin dependencies ([#108](https://github.com/cewert/jellyrock/pull/108)) by [@renovate[bot]](https://github.com/apps/renovate)
- Github actions ([#97](https://github.com/cewert/jellyrock/pull/97)) by [@renovate[bot]](https://github.com/apps/renovate)

### New Contributors

- [@mtlynch](https://github.com/mtlynch) made their first contribution in [#113](https://github.com/jellyrock/jellyrock/pull/113)
- [@roidy](https://github.com/roidy) made their first contribution in [#128](https://github.com/jellyrock/jellyrock/pull/128)

## [1.0.4](https://github.com/cewert/jellyrock/compare/v1.0.3...v1.0.4) - 2025-10-06

### Added

- proper linting for unit tests ([#94](https://github.com/cewert/jellyrock/pull/94)) by [@cewert](https://github.com/cewert)

### Changed

- device profile to improve support for HDR10Plus and DOVIWithHDR10Plus ([ca25905](https://github.com/cewert/jellyrock/commit/ca25905)) by [@cewert](https://github.com/cewert)

### Fixed

- unit tests by making rooibos use latest version of brighterscript ([8c69a25](https://github.com/cewert/jellyrock/commit/8c69a25)) by [@cewert](https://github.com/cewert)
- app crash on MovieDetails ([#93](https://github.com/cewert/jellyrock/pull/93)) by [@cewert](https://github.com/cewert)
- app crash when `CreateInstantMix` returns invalid ([#90](https://github.com/cewert/jellyrock/pull/90)) by [@cewert](https://github.com/cewert)

### Removed

- bslint warnings for array and assocarray fields ([3da1107](https://github.com/cewert/jellyrock/commit/3da1107)) by [@cewert](https://github.com/cewert)

### Dependencies

- actions/cache action to v4.3.0 ([#91](https://github.com/cewert/jellyrock/pull/91)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.0.3](https://github.com/cewert/jellyrock/compare/v1.0.2...v1.0.3) - 2025-09-16

### Added

- claude subagent to enforce roku-log best practices and use it to refactor Home.bs ([3dd2088](https://github.com/cewert/jellyrock/commit/3dd2088)) by [@cewert](https://github.com/cewert)
- docs/dev/logging.md ([efab961](https://github.com/cewert/jellyrock/commit/efab961)) by [@cewert](https://github.com/cewert)
- debug flag to manifest ([ce1fb28](https://github.com/cewert/jellyrock/commit/ce1fb28)) by [@cewert](https://github.com/cewert)
- dynamic gradient component ([#80](https://github.com/cewert/jellyrock/pull/80)) by [@cewert](https://github.com/cewert)
- npm script to validate translation files + convert CI to use script ([ae344c2](https://github.com/cewert/jellyrock/commit/ae344c2)) by [@cewert](https://github.com/cewert)
- developer mode doc and link to it on readme ([df60ff9](https://github.com/cewert/jellyrock/commit/df60ff9)) by [@cewert](https://github.com/cewert)

### Changed

- bot instructions ([62dbe04](https://github.com/cewert/jellyrock/commit/62dbe04)) by [@cewert](https://github.com/cewert)
- Stop using invalid poster image uris ([#78](https://github.com/cewert/jellyrock/pull/78)) by [@cewert](https://github.com/cewert)
- llm agent instructions, create CLAUDE.md, format as instructions ([1fe8568](https://github.com/cewert/jellyrock/commit/1fe8568)) by [@cewert](https://github.com/cewert)
- d: lint all translation files not just english ([470991f](https://github.com/cewert/jellyrock/commit/470991f)) by [@cewert](https://github.com/cewert)

### Fixed

- ropm copy error ([a31d18e](https://github.com/cewert/jellyrock/commit/a31d18e)) by [@cewert](https://github.com/cewert)
- exclude release-prep PRs from changelog. Fixes #68 ([98a3fcb](https://github.com/cewert/jellyrock/commit/98a3fcb)) by [@cewert](https://github.com/cewert)

### Removed

- redundant component fields ([23d12d3](https://github.com/cewert/jellyrock/commit/23d12d3)) by [@cewert](https://github.com/cewert)

### Security

- renovate config and github actions. All actions pinned to immutable commit hashes for security. Unified @<hash> # v<version> format across all workflows for consistency. Renovate will handle future updates with Monday morning grouped PRs ([1457818](https://github.com/cewert/jellyrock/commit/1457818)) by [@cewert](https://github.com/cewert)

### Dependencies

- dependency @rokucommunity/bslint to v0.8.35 ([#84](https://github.com/cewert/jellyrock/pull/84)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency brighterscript-formatter to v1.7.18 ([#85](https://github.com/cewert/jellyrock/pull/85)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency brighterscript to v0.70.1 ([#83](https://github.com/cewert/jellyrock/pull/83)) by [@renovate[bot]](https://github.com/apps/renovate)
- softprops/action-gh-release action to v2.3.3 ([#81](https://github.com/cewert/jellyrock/pull/81)) by [@renovate[bot]](https://github.com/apps/renovate)
- github actions (major) ([#82](https://github.com/cewert/jellyrock/pull/82)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.0.2](https://github.com/cewert/jellyrock/compare/v1.0.1...v1.0.2) - 2025-09-02

### Changed

- `Custom Subtitles` setting description ([b198483](https://github.com/cewert/jellyrock/commit/b198483)) by [@cewert](https://github.com/cewert)

### Fixed

- CI race conditions ([d38a8ac](https://github.com/cewert/jellyrock/commit/d38a8ac)) by [@cewert](https://github.com/cewert)
- custom subtitle crash while watching video ([#65](https://github.com/cewert/jellyrock/pull/65)) by [@cewert](https://github.com/cewert)
- validate json string before parsing ([aca6f3c](https://github.com/cewert/jellyrock/commit/aca6f3c)) by [@cewert](https://github.com/cewert)
- log sync logic after a new release ([7638085](https://github.com/cewert/jellyrock/commit/7638085)) by [@cewert](https://github.com/cewert)

## [1.0.1](https://github.com/cewert/jellyrock/compare/v1.0.0...v1.0.1) - 2025-08-30

### Added

- use workflow to sync changelog file ([c1479da](https://github.com/cewert/jellyrock/commit/c1479da)) by [@cewert](https://github.com/cewert)
- changelog with all v1 commits and PRs ([9cfdc42](https://github.com/cewert/jellyrock/commit/9cfdc42)) by [@cewert](https://github.com/cewert)
- use CI to auto-update generated app-settings.md doc ([a0773b5](https://github.com/cewert/jellyrock/commit/a0773b5)) by [@cewert](https://github.com/cewert)
- settings docs generator ([eb634c1](https://github.com/cewert/jellyrock/commit/eb634c1)) by [@cewert](https://github.com/cewert)

### Changed

- changelog with new parsing logic ([4cf5052](https://github.com/cewert/jellyrock/commit/4cf5052)) by [@cewert](https://github.com/cewert)
- changelog commit parser logic and release draft body ([03b3e7b](https://github.com/cewert/jellyrock/commit/03b3e7b)) by [@cewert](https://github.com/cewert)
- release prep pr body ([5ab8cdb](https://github.com/cewert/jellyrock/commit/5ab8cdb)) by [@cewert](https://github.com/cewert)
- lint:json to exclude scripts folder ([59877af](https://github.com/cewert/jellyrock/commit/59877af)) by [@cewert](https://github.com/cewert)
- enable manual trigger to fix doc ([f671435](https://github.com/cewert/jellyrock/commit/f671435)) by [@cewert](https://github.com/cewert)
- link to user app settings ([b4b8058](https://github.com/cewert/jellyrock/commit/b4b8058)) by [@cewert](https://github.com/cewert)
- sort scripts ([4d33d02](https://github.com/cewert/jellyrock/commit/4d33d02)) by [@cewert](https://github.com/cewert)
- use colons instead of dashes ([8e149da](https://github.com/cewert/jellyrock/commit/8e149da)) by [@cewert](https://github.com/cewert)
- recommended extensions ([df1350c](https://github.com/cewert/jellyrock/commit/df1350c)) by [@cewert](https://github.com/cewert)

### Fixed

- correct release notes extraction in automated release notes ([0cbb98c](https://github.com/cewert/jellyrock/commit/0cbb98c)) by [@cewert](https://github.com/cewert)
- automated release workflow - proper changelog extraction and compare URLs ([1d61f4a](https://github.com/cewert/jellyrock/commit/1d61f4a)) by [@cewert](https://github.com/cewert)
- CI authentication for PR label detection in changelog syncer ([67d285e](https://github.com/cewert/jellyrock/commit/67d285e)) by [@cewert](https://github.com/cewert)
- automated release body ([868113c](https://github.com/cewert/jellyrock/commit/868113c)) by [@cewert](https://github.com/cewert)
- release prep triggering twice on branch creation ([9788ad7](https://github.com/cewert/jellyrock/commit/9788ad7)) by [@cewert](https://github.com/cewert)
- filepath trigger ([77e3f2e](https://github.com/cewert/jellyrock/commit/77e3f2e)) by [@cewert](https://github.com/cewert)
- `ui.row.layout` affects all rows ([a217a08](https://github.com/cewert/jellyrock/commit/a217a08)) by [@cewert](https://github.com/cewert)
- prevent translation commits from triggering translation workflow ([d7cc939](https://github.com/cewert/jellyrock/commit/d7cc939)) by [@cewert](https://github.com/cewert)
- prevent hardcoded fallback font text from being translatied ([dc80d78](https://github.com/cewert/jellyrock/commit/dc80d78)) by [@cewert](https://github.com/cewert)
- no longer using bugfix branch ([620cb30](https://github.com/cewert/jellyrock/commit/620cb30)) by [@cewert](https://github.com/cewert)
- spinner color from secondary -> text_secondary ([74bec4f](https://github.com/cewert/jellyrock/commit/74bec4f)) by [@cewert](https://github.com/cewert)
- spelling linter ([270920b](https://github.com/cewert/jellyrock/commit/270920b)) by [@cewert](https://github.com/cewert)
- overhang warnings in log at app start `Could not find node "overhang" to update the interpolator field on` ([6695a5f](https://github.com/cewert/jellyrock/commit/6695a5f)) by [@cewert](https://github.com/cewert)

### Removed

- project automation ([ec1d760](https://github.com/cewert/jellyrock/commit/ec1d760)) by [@cewert](https://github.com/cewert)

### Dependencies

- stefanzweifel/git-auto-commit-action action to v6 ([#42](https://github.com/cewert/jellyrock/pull/42)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency ropm to v0.11.0 ([#40](https://github.com/cewert/jellyrock/pull/40)) by [@renovate[bot]](https://github.com/apps/renovate)

## [1.0.0](https://github.com/cewert/jellyrock/commits/main/?since=2025-06-28&until=2025-08-24) - 2025-08-24

### Added

- fork info and clean up build comments ([3cca8a4](https://github.com/cewert/jellyrock/commit/3cca8a4)) by [@cewert](https://github.com/cewert)
- privacy policy and terms of use ([b1e3e2c](https://github.com/cewert/jellyrock/commit/b1e3e2c)) by [@cewert](https://github.com/cewert)
- debug: add debug output for GitHub release condition ([d68eec6](https://github.com/cewert/jellyrock/commit/d68eec6)) by [@cewert](https://github.com/cewert)
- brighterscript-xml-plugin to dev build config <https://github.com/slheavner/brighterscript-xml-plugin> ([355a406](https://github.com/cewert/jellyrock/commit/355a406)) by [@cewert](https://github.com/cewert)
- build instructions ([b66696a](https://github.com/cewert/jellyrock/commit/b66696a)) by [@cewert](https://github.com/cewert)
- support for live tv to OSD ([e5de6b9](https://github.com/cewert/jellyrock/commit/e5de6b9)) by [@cewert](https://github.com/cewert)
- screenshots to readme ([1ab719c](https://github.com/cewert/jellyrock/commit/1ab719c)) by [@cewert](https://github.com/cewert)
- more validation and debugging to post task ([8e3264c](https://github.com/cewert/jellyrock/commit/8e3264c)) by [@cewert](https://github.com/cewert)
- default overhang image and ensure to remove cached user image during logut ([9208091](https://github.com/cewert/jellyrock/commit/9208091)) by [@cewert](https://github.com/cewert)
- themed TextButton and use it to theme the server and user select pages ([e44e112](https://github.com/cewert/jellyrock/commit/e44e112)) by [@cewert](https://github.com/cewert)
- profile pic to overhang ([8c748fc](https://github.com/cewert/jellyrock/commit/8c748fc)) by [@cewert](https://github.com/cewert)
- backdropText to My Media row until image loads ([df4e153](https://github.com/cewert/jellyrock/commit/df4e153)) by [@cewert](https://github.com/cewert)
- all missing themed label variants ([#24](https://github.com/cewert/jellyrock/pull/24)) by [@cewert](https://github.com/cewert)
- auto rebase stale prs and auto create roll back prs ([045e928](https://github.com/cewert/jellyrock/commit/045e928)) by [@cewert](https://github.com/cewert)
- copilot setup steps workflow. the bot was wasting tokens figuring out and doing these steps on it's own ([dc4bda1](https://github.com/cewert/jellyrock/commit/dc4bda1)) by [@cewert](https://github.com/cewert)
- copilot instructions ([9727fa1](https://github.com/cewert/jellyrock/commit/9727fa1)) by [@cewert](https://github.com/cewert)
- basic text svg logos ([6513a80](https://github.com/cewert/jellyrock/commit/6513a80)) by [@cewert](https://github.com/cewert)
- and implement new color palette and font sizes saved to global. create JFPoster to render progressbar and watchbadge. create extendable components based on global theme and font sizes. Give iconbutton a focus border and add to OSD. Update readability of OSD and overall UX. Remove Voicebox cover from itemgrid ([6e7da39](https://github.com/cewert/jellyrock/commit/6e7da39)) by [@cewert](https://github.com/cewert)
- comment ([0d7d676](https://github.com/cewert/jellyrock/commit/0d7d676)) by [@cewert](https://github.com/cewert)
- and use js script to sync all translation files with en_US (fix them and start fresh) ([7dde85e](https://github.com/cewert/jellyrock/commit/7dde85e)) by [@cewert](https://github.com/cewert)
- comments to help troubleshoot problems with 4k ([31054fb](https://github.com/cewert/jellyrock/commit/31054fb)) by [@cewert](https://github.com/cewert)
- renovate.json ([168041b](https://github.com/cewert/jellyrock/commit/168041b)) by [@cewert](https://github.com/cewert)
- `Date Show Added` sort option. Make option list match web client ([8d05cae](https://github.com/cewert/jellyrock/commit/8d05cae)) by [@cewert](https://github.com/cewert)
- workflow to validate dependency bump PRs  don't break anything ([de3b00e](https://github.com/cewert/jellyrock/commit/de3b00e)) by [@cewert](https://github.com/cewert)
- live TV series title, season number, and episode number to OSD, when available ([8763f0c](https://github.com/cewert/jellyrock/commit/8763f0c)) by [@michaelcresswell](https://github.com/michaelcresswell)
- a user setting to allow users to disable the new look ([5659a9c](https://github.com/cewert/jellyrock/commit/5659a9c)) by [@cewert](https://github.com/cewert)
- localization for channel abbreviation string ([110f82a](https://github.com/cewert/jellyrock/commit/110f82a)) by [@michaelcresswell](https://github.com/michaelcresswell)
- channel number to Live TV channel title ([229f7b9](https://github.com/cewert/jellyrock/commit/229f7b9)) by [@michaelcresswell](https://github.com/michaelcresswell)

### Changed

- use task to download fallback font + don't stop loading home page when user only has custom subs enabled ([30154f1](https://github.com/cewert/jellyrock/commit/30154f1)) by [@cewert](https://github.com/cewert)
- unused ([9f8cc92](https://github.com/cewert/jellyrock/commit/9f8cc92)) by [@cewert](https://github.com/cewert)
- release prep ([dd2f5e4](https://github.com/cewert/jellyrock/commit/dd2f5e4)) by [@cewert](https://github.com/cewert)
- only reposition backdrop text when iconImage finished loading ([b375e22](https://github.com/cewert/jellyrock/commit/b375e22)) by [@cewert](https://github.com/cewert)
- tweak build config and vscode debugger behavior ([1bd4024](https://github.com/cewert/jellyrock/commit/1bd4024)) by [@cewert](https://github.com/cewert)
- theme spinner ([1e28130](https://github.com/cewert/jellyrock/commit/1e28130)) by [@cewert](https://github.com/cewert)
- more theming on server select ([8fb7079](https://github.com/cewert/jellyrock/commit/8fb7079)) by [@cewert](https://github.com/cewert)
- theme tv guide screen and use fallback fonts as needed ([cb0e706](https://github.com/cewert/jellyrock/commit/cb0e706)) by [@cewert](https://github.com/cewert)
- unused ([f1597da](https://github.com/cewert/jellyrock/commit/f1597da)) by [@cewert](https://github.com/cewert)
- reposition itemIcon and backgroundText when both are present ([5ea5196](https://github.com/cewert/jellyrock/commit/5ea5196)) by [@cewert](https://github.com/cewert)
- github actions links ([f2f8257](https://github.com/cewert/jellyrock/commit/f2f8257)) by [@cewert](https://github.com/cewert)
- release branch vrom v1.0.0 to release-1.0.0 ([9910a9c](https://github.com/cewert/jellyrock/commit/9910a9c)) by [@cewert](https://github.com/cewert)
- don't delete release notes when updating release ([0fec22f](https://github.com/cewert/jellyrock/commit/0fec22f)) by [@cewert](https://github.com/cewert)
- rebase before commiting ([0f4693a](https://github.com/cewert/jellyrock/commit/0f4693a)) by [@cewert](https://github.com/cewert)
- don't try to cache gradle ([1b78e07](https://github.com/cewert/jellyrock/commit/1b78e07)) by [@cewert](https://github.com/cewert)
- workflows ([#35](https://github.com/cewert/jellyrock/pull/35)) by [@cewert](https://github.com/cewert)
- author ([3e31244](https://github.com/cewert/jellyrock/commit/3e31244)) by [@cewert](https://github.com/cewert)
- run static analysis on release branches ([67f8d65](https://github.com/cewert/jellyrock/commit/67f8d65)) by [@cewert](https://github.com/cewert)
- use jellyrock-bot token ([f3483ab](https://github.com/cewert/jellyrock/commit/f3483ab)) by [@cewert](https://github.com/cewert)
- make folder for buttongroups ([3170168](https://github.com/cewert/jellyrock/commit/3170168)) by [@cewert](https://github.com/cewert)
- VideoData has no image field ([5dd9264](https://github.com/cewert/jellyrock/commit/5dd9264)) by [@cewert](https://github.com/cewert)
- align next episode button to bottom right edge ([745db9e](https://github.com/cewert/jellyrock/commit/745db9e)) by [@cewert](https://github.com/cewert)
- hide osd when pressing rewind/ff ([7018fef](https://github.com/cewert/jellyrock/commit/7018fef)) by [@cewert](https://github.com/cewert)
- resize to allow two screenshots per row ([f7abf03](https://github.com/cewert/jellyrock/commit/f7abf03)) by [@cewert](https://github.com/cewert)
- resize screenshots ([8398270](https://github.com/cewert/jellyrock/commit/8398270)) by [@cewert](https://github.com/cewert)
- convert to content node ([d2a82c6](https://github.com/cewert/jellyrock/commit/d2a82c6)) by [@cewert](https://github.com/cewert)
- better align genre view ([e0e32cf](https://github.com/cewert/jellyrock/commit/e0e32cf)) by [@cewert](https://github.com/cewert)
- theme remaining buttons ([#33](https://github.com/cewert/jellyrock/pull/33)) by [@cewert](https://github.com/cewert)
- stop wasting tokens running both lint-bs and validate ([58c6c74](https://github.com/cewert/jellyrock/commit/58c6c74)) by [@cewert](https://github.com/cewert)
- _validate-dependencies.yml ([3221ab9](https://github.com/cewert/jellyrock/commit/3221ab9)) by [@cewert](https://github.com/cewert)
- copilot-instructions.md ([62c939b](https://github.com/cewert/jellyrock/commit/62c939b)) by [@cewert](https://github.com/cewert)
- cache user image poster ([cf0a9a3](https://github.com/cewert/jellyrock/commit/cf0a9a3)) by [@cewert](https://github.com/cewert)
- vscode settings ([0e3adf4](https://github.com/cewert/jellyrock/commit/0e3adf4)) by [@cewert](https://github.com/cewert)
- theme griditemsmall ([914523c](https://github.com/cewert/jellyrock/commit/914523c)) by [@cewert](https://github.com/cewert)
- resources folder not needed to build app ([b054852](https://github.com/cewert/jellyrock/commit/b054852)) by [@cewert](https://github.com/cewert)
- don't show colon until we show the time ([acbd672](https://github.com/cewert/jellyrock/commit/acbd672)) by [@cewert](https://github.com/cewert)
- clean up OSD ([38287d4](https://github.com/cewert/jellyrock/commit/38287d4)) by [@cewert](https://github.com/cewert)
- theme last rowlist. theme search page ([c89b611](https://github.com/cewert/jellyrock/commit/c89b611)) by [@cewert](https://github.com/cewert)
- theme postergrid ([7537652](https://github.com/cewert/jellyrock/commit/7537652)) by [@cewert](https://github.com/cewert)
- theme remaining markupgrid's except itemgrid which needs a refactor ([1e69536](https://github.com/cewert/jellyrock/commit/1e69536)) by [@cewert](https://github.com/cewert)
- theme remaining RowList components ([05f683f](https://github.com/cewert/jellyrock/commit/05f683f)) by [@cewert](https://github.com/cewert)
- disable migrations until needed. remove old jellyfin-roku migration code but leave functions as is ([1376c20](https://github.com/cewert/jellyrock/commit/1376c20)) by [@cewert](https://github.com/cewert)
- complete Label and ScrollingLabel themed refactoring with comprehensive color mapping and syntax fixes ([#13](https://github.com/cewert/jellyrock/pull/13)) by [@copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent)
- configure Renovate ([#19](https://github.com/cewert/jellyrock/pull/19)) by [@renovate[bot]](https://github.com/apps/renovate)
- trigger renovate onboarding PR ([e06afd3](https://github.com/cewert/jellyrock/commit/e06afd3)) by [@cewert](https://github.com/cewert)
- lint all json files ([2d084f5](https://github.com/cewert/jellyrock/commit/2d084f5)) by [@cewert](https://github.com/cewert)
- alert jellyrock-code-docs repo whenever bright(er)script code has been updated ([7a2f35a](https://github.com/cewert/jellyrock/commit/7a2f35a)) by [@cewert](https://github.com/cewert)
- npm audit fix ([f227192](https://github.com/cewert/jellyrock/commit/f227192)) by [@cewert](https://github.com/cewert)
- finish removing api/code docs from repo. remove deps, scripts, and workflows ([916943a](https://github.com/cewert/jellyrock/commit/916943a)) by [@cewert](https://github.com/cewert)
- try default ([c821988](https://github.com/cewert/jellyrock/commit/c821988)) by [@cewert](https://github.com/cewert)
- "Bad credentials" using GH_TOKEN ([e74c2dc](https://github.com/cewert/jellyrock/commit/e74c2dc)) by [@cewert](https://github.com/cewert)
- use jellyrock-bot pat token for copilot agent ([a80466c](https://github.com/cewert/jellyrock/commit/a80466c)) by [@cewert](https://github.com/cewert)
- permissions for Copilot setup to allow issue and pull request access ([976957d](https://github.com/cewert/jellyrock/commit/976957d)) by [@cewert](https://github.com/cewert)
- theme the trickPlayBar ([d91da5e](https://github.com/cewert/jellyrock/commit/d91da5e)) by [@cewert](https://github.com/cewert)
- readability of home page ([457ba81](https://github.com/cewert/jellyrock/commit/457ba81)) by [@cewert](https://github.com/cewert)
- increase rowItemSpacing ([1cc14d5](https://github.com/cewert/jellyrock/commit/1cc14d5)) by [@cewert](https://github.com/cewert)
- reorder home settings dialog ([8c2ccd3](https://github.com/cewert/jellyrock/commit/8c2ccd3)) by [@cewert](https://github.com/cewert)
- translate a couple more strings ([b7c6072](https://github.com/cewert/jellyrock/commit/b7c6072)) by [@cewert](https://github.com/cewert)
- pin versions for renovate and remove redundant ropm command ([f6451db](https://github.com/cewert/jellyrock/commit/f6451db)) by [@cewert](https://github.com/cewert)
- use bot for doc commits ([4bed5b7](https://github.com/cewert/jellyrock/commit/4bed5b7)) by [@cewert](https://github.com/cewert)
- bot token name ([cadf64e](https://github.com/cewert/jellyrock/commit/cadf64e)) by [@cewert](https://github.com/cewert)
- restore gitignore ([1a50f63](https://github.com/cewert/jellyrock/commit/1a50f63)) by [@cewert](https://github.com/cewert)
- need to remove code-docs folder ([96d6fc5](https://github.com/cewert/jellyrock/commit/96d6fc5)) by [@cewert](https://github.com/cewert)
- no longer needed ([fdbc526](https://github.com/cewert/jellyrock/commit/fdbc526)) by [@cewert](https://github.com/cewert)
- deploying to main from @ cewert/jellyrock@306d5c5e4636f2c9066c86cced15403f5d734f5b 🚀 ([ce603d5](https://github.com/cewert/jellyrock/commit/ce603d5)) by [@cewert](https://github.com/cewert)
- move api/code docs to their own repo ([d053f31](https://github.com/cewert/jellyrock/commit/d053f31)) by [@cewert](https://github.com/cewert)
- don't use logo with secondary text color ([dc27847](https://github.com/cewert/jellyrock/commit/dc27847)) by [@cewert](https://github.com/cewert)
- makefile to delete images before generating. duplicate SVG logos and set text color to text secondary. update makefile to use these SVGs for the in-app logo.png's ([2ddbd1e](https://github.com/cewert/jellyrock/commit/2ddbd1e)) by [@cewert](https://github.com/cewert)
- npm audit fix ([7829aef](https://github.com/cewert/jellyrock/commit/7829aef)) by [@cewert](https://github.com/cewert)
- missed one ([ed089f5](https://github.com/cewert/jellyrock/commit/ed089f5)) by [@cewert](https://github.com/cewert)
- put code in backticks and update spelling of links ([fa9310c](https://github.com/cewert/jellyrock/commit/fa9310c)) by [@cewert](https://github.com/cewert)
- don't try to run unit tests and use isValid() ([ecb69bd](https://github.com/cewert/jellyrock/commit/ecb69bd)) by [@cewert](https://github.com/cewert)
- force use of isValid() function throughout entire codebase ([#8](https://github.com/cewert/jellyrock/pull/8)) by [@copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent)
- makefile to create dev and prod images. update logo demensions ([b737233](https://github.com/cewert/jellyrock/commit/b737233)) by [@cewert](https://github.com/cewert)
- use logo for readme header ([5d0d4bb](https://github.com/cewert/jellyrock/commit/5d0d4bb)) by [@cewert](https://github.com/cewert)
- overhang logo size so the new logo doesn't stretch ([2527294](https://github.com/cewert/jellyrock/commit/2527294)) by [@cewert](https://github.com/cewert)
- makefile get_images and use it to update app images ([2efaa73](https://github.com/cewert/jellyrock/commit/2efaa73)) by [@cewert](https://github.com/cewert)
- merge branch 'main' of <https://github.com/cewert/jellyrock> ([5dc96f6](https://github.com/cewert/jellyrock/commit/5dc96f6)) by [@cewert](https://github.com/cewert)
- stop showing 'mic icon Search' in the overhang. now only showing mic icon above alpha menu ([64cb58c](https://github.com/cewert/jellyrock/commit/64cb58c)) by [@cewert](https://github.com/cewert)
- stop showing "* options" text in overhang ([ddf7b07](https://github.com/cewert/jellyrock/commit/ddf7b07)) by [@cewert](https://github.com/cewert)
- extras slider bg ([7688f96](https://github.com/cewert/jellyrock/commit/7688f96)) by [@cewert](https://github.com/cewert)
- apply new theme colors to all StandardDialogs ([1ce5242](https://github.com/cewert/jellyrock/commit/1ce5242)) by [@cewert](https://github.com/cewert)
- stop running roku static analysis so much ([86bc6da](https://github.com/cewert/jellyrock/commit/86bc6da)) by [@cewert](https://github.com/cewert)
- tweak home row titles ([675bc76](https://github.com/cewert/jellyrock/commit/675bc76)) by [@cewert](https://github.com/cewert)
- move osd stream info button  to far right of screen ([535b85f](https://github.com/cewert/jellyrock/commit/535b85f)) by [@cewert](https://github.com/cewert)
- bot username ([87d994e](https://github.com/cewert/jellyrock/commit/87d994e)) by [@cewert](https://github.com/cewert)
- version ([1be6caa](https://github.com/cewert/jellyrock/commit/1be6caa)) by [@cewert](https://github.com/cewert)
- jellyfin -> jellyrock ([afb054a](https://github.com/cewert/jellyrock/commit/afb054a)) by [@cewert](https://github.com/cewert)
- git pull before building docs ([a68bda7](https://github.com/cewert/jellyrock/commit/a68bda7)) by [@cewert](https://github.com/cewert)
- rename registry vars and update more refs to jellyfin ([0db8767](https://github.com/cewert/jellyrock/commit/0db8767)) by [@cewert](https://github.com/cewert)
- rename components from JF*to JR* ([b609793](https://github.com/cewert/jellyrock/commit/b609793)) by [@cewert](https://github.com/cewert)
- rename unit tests folder ([1d4d88d](https://github.com/cewert/jellyrock/commit/1d4d88d)) by [@cewert](https://github.com/cewert)
- only disable previous/play/next and remove all other unneeded buttons from osd ([b45ec2b](https://github.com/cewert/jellyrock/commit/b45ec2b)) by [@cewert](https://github.com/cewert)
- no bs in xml ([0d8713f](https://github.com/cewert/jellyrock/commit/0d8713f)) by [@cewert](https://github.com/cewert)
- merge branch 'main' of <https://github.com/cewert/jellyrock> ([71a4097](https://github.com/cewert/jellyrock/commit/71a4097)) by [@cewert](https://github.com/cewert)
- merge branch 'main' of <https://github.com/cewert/jellyrock> ([f142546](https://github.com/cewert/jellyrock/commit/f142546)) by [@cewert](https://github.com/cewert)
- prevent race conditions ([4c77bf6](https://github.com/cewert/jellyrock/commit/4c77bf6)) by [@cewert](https://github.com/cewert)
- merge branch 'main' of <https://github.com/cewert/jellyrock> ([31820f5](https://github.com/cewert/jellyrock/commit/31820f5)) by [@cewert](https://github.com/cewert)
- move all auto commit jobs to the same workflow ([3ed1ee6](https://github.com/cewert/jellyrock/commit/3ed1ee6)) by [@cewert](https://github.com/cewert)
- no longer needed ([cc6b8c8](https://github.com/cewert/jellyrock/commit/cc6b8c8)) by [@cewert](https://github.com/cewert)
- merge branch 'main' of <https://github.com/cewert/jellyrock> ([77e8631](https://github.com/cewert/jellyrock/commit/77e8631)) by [@cewert](https://github.com/cewert)
- readme ([d4a6123](https://github.com/cewert/jellyrock/commit/d4a6123)) by [@cewert](https://github.com/cewert)
- bugfix ([0e0a9af](https://github.com/cewert/jellyrock/commit/0e0a9af)) by [@cewert](https://github.com/cewert)
- using main branch instead of master ([d76f79e](https://github.com/cewert/jellyrock/commit/d76f79e)) by [@cewert](https://github.com/cewert)
- translation file ([440342c](https://github.com/cewert/jellyrock/commit/440342c)) by [@jellyrock-bot](https://github.com/jellyrock-bot)
- fill in icons ([67a0bde](https://github.com/cewert/jellyrock/commit/67a0bde)) by [@cewert](https://github.com/cewert)
- npm audit fix ([2d171a6](https://github.com/cewert/jellyrock/commit/2d171a6)) by [@cewert](https://github.com/cewert)
- search br(s), xml, and settings.json for translation strings and remove unused strings from file. small refactor to prevent current translations from being lost ([008c2c3](https://github.com/cewert/jellyrock/commit/008c2c3)) by [@cewert](https://github.com/cewert)
- tidy up ([f85b684](https://github.com/cewert/jellyrock/commit/f85b684)) by [@cewert](https://github.com/cewert)
- clean up old workflows ([a7133c2](https://github.com/cewert/jellyrock/commit/a7133c2)) by [@cewert](https://github.com/cewert)
- use CI to auto update translation file ([7227a3a](https://github.com/cewert/jellyrock/commit/7227a3a)) by [@cewert](https://github.com/cewert)
- automatically create en_US translation file ([96d38ca](https://github.com/cewert/jellyrock/commit/96d38ca)) by [@cewert](https://github.com/cewert)
- stop using comment tag ([bb7e4f4](https://github.com/cewert/jellyrock/commit/bb7e4f4)) by [@cewert](https://github.com/cewert)
- further limit vscode search results ([efcb142](https://github.com/cewert/jellyrock/commit/efcb142)) by [@cewert](https://github.com/cewert)
- fill in play and pause icons ([81c8ebd](https://github.com/cewert/jellyrock/commit/81c8ebd)) by [@cewert](https://github.com/cewert)
- always toggle spinner ([629c545](https://github.com/cewert/jellyrock/commit/629c545)) by [@cewert](https://github.com/cewert)
- loading spinner logic and fix bug where spinner wasn't being removed on the home page ([27bb68d](https://github.com/cewert/jellyrock/commit/27bb68d)) by [@cewert](https://github.com/cewert)
- no regex duplicates ([788f263](https://github.com/cewert/jellyrock/commit/788f263)) by [@cewert](https://github.com/cewert)
- force project to use 2 spaces for tabs. update all files to match ([b8ef5f3](https://github.com/cewert/jellyrock/commit/b8ef5f3)) by [@cewert](https://github.com/cewert)
- use a string for osd metadata ([d95a4af](https://github.com/cewert/jellyrock/commit/d95a4af)) by [@cewert](https://github.com/cewert)
- osd title/subtitle spacing. remove debugging ([88cc776](https://github.com/cewert/jellyrock/commit/88cc776)) by [@cewert](https://github.com/cewert)
- UX of OSD. Use google icons. Organized osd and icon images into folders. Fix bug in defaultvideo logic ([f05084d](https://github.com/cewert/jellyrock/commit/f05084d)) by [@cewert](https://github.com/cewert)
- pause leaves osd open until resume or back ([00161f4](https://github.com/cewert/jellyrock/commit/00161f4)) by [@cewert](https://github.com/cewert)
- image to match new background ([65e393e](https://github.com/cewert/jellyrock/commit/65e393e)) by [@cewert](https://github.com/cewert)
- stop using a dialog to disable remote. no more dimmed gray overlay ([a8cf099](https://github.com/cewert/jellyrock/commit/a8cf099)) by [@cewert](https://github.com/cewert)
- revert "move invisible dialog to the top of the stack. this removes the light gray overlay" ([e0b0449](https://github.com/cewert/jellyrock/commit/e0b0449)) by [@cewert](https://github.com/cewert)
- increase clock size ([c2418c4](https://github.com/cewert/jellyrock/commit/c2418c4)) by [@cewert](https://github.com/cewert)
- revert "Make view all buttom smart" ([d1dcec9](https://github.com/cewert/jellyrock/commit/d1dcec9)) by [@cewert](https://github.com/cewert)
- move invisible dialog to the top of the stack. this removes the light gray overlay ([f957fba](https://github.com/cewert/jellyrock/commit/f957fba)) by [@cewert](https://github.com/cewert)
- hide video title until osd is ready ([a861f52](https://github.com/cewert/jellyrock/commit/a861f52)) by [@cewert](https://github.com/cewert)
- show a third row on home screen ([cd65865](https://github.com/cewert/jellyrock/commit/cd65865)) by [@cewert](https://github.com/cewert)
- stop showing meridian in overhang and OSD ([17e4071](https://github.com/cewert/jellyrock/commit/17e4071)) by [@cewert](https://github.com/cewert)
- splashBackground as needed ([cb08bd2](https://github.com/cewert/jellyrock/commit/cb08bd2)) by [@cewert](https://github.com/cewert)
- try to recover from multiple video players ([8b18349](https://github.com/cewert/jellyrock/commit/8b18349)) by [@cewert](https://github.com/cewert)
- some default settings ([d262d32](https://github.com/cewert/jellyrock/commit/d262d32)) by [@cewert](https://github.com/cewert)
- set background color to black ([7642bac](https://github.com/cewert/jellyrock/commit/7642bac)) by [@cewert](https://github.com/cewert)
- default audio track selection for movie details page and quick played videos ([897c5e0](https://github.com/cewert/jellyrock/commit/897c5e0)) by [@cewert](https://github.com/cewert)
- vp9 doesn't support dovi ([302a899](https://github.com/cewert/jellyrock/commit/302a899)) by [@cewert](https://github.com/cewert)
- bump-version.yml ([000668e](https://github.com/cewert/jellyrock/commit/000668e)) by [@cewert](https://github.com/cewert)
- disable dependency dashboard ([439a9c1](https://github.com/cewert/jellyrock/commit/439a9c1)) by [@cewert](https://github.com/cewert)
- migrate config renovate.json ([b672216](https://github.com/cewert/jellyrock/commit/b672216)) by [@renovate[bot]](https://github.com/apps/renovate)
- renovate.json ([1f7cf66](https://github.com/cewert/jellyrock/commit/1f7cf66)) by [@cewert](https://github.com/cewert)
- renovate init ([68c36fb](https://github.com/cewert/jellyrock/commit/68c36fb)) by [@cewert](https://github.com/cewert)
- bot token ([a3422ec](https://github.com/cewert/jellyrock/commit/a3422ec)) by [@cewert](https://github.com/cewert)
- use cewert-bot instead of jellyfin-bot for automations ([2499bf6](https://github.com/cewert/jellyrock/commit/2499bf6)) by [@cewert](https://github.com/cewert)
- workflows to run as they did on the main repo ([92b78e9](https://github.com/cewert/jellyrock/commit/92b78e9)) by [@cewert](https://github.com/cewert)
- _build-prod.yml ([faeb8da](https://github.com/cewert/jellyrock/commit/faeb8da)) by [@jimdogx](https://github.com/jimdogx)
- DEVGUIDE.md ([6ee3a66](https://github.com/cewert/jellyrock/commit/6ee3a66)) by [@frothedoatmilk](https://github.com/frothedoatmilk)
- make sure all jobs run for a dependency PR and clean things up ([bee35c5](https://github.com/cewert/jellyrock/commit/bee35c5)) by [@cewert](https://github.com/cewert)
- show User Icon for SavedUsers as well ([4c32db0](https://github.com/cewert/jellyrock/commit/4c32db0)) by [@SonicMastr](https://github.com/SonicMastr)
- use the same movie sorting options as web ([0776889](https://github.com/cewert/jellyrock/commit/0776889)) by [@cewert](https://github.com/cewert)
- dependecy workflow so we only have 1 skipped check instead of 8 ([8cf6ad4](https://github.com/cewert/jellyrock/commit/8cf6ad4)) by [@cewert](https://github.com/cewert)
- move everything under the workflows dir ([8d8950a](https://github.com/cewert/jellyrock/commit/8d8950a)) by [@cewert](https://github.com/cewert)
- make workflows reuseable ([0be5604](https://github.com/cewert/jellyrock/commit/0be5604)) by [@cewert](https://github.com/cewert)
- npm audit fix ([687cad5](https://github.com/cewert/jellyrock/commit/687cad5)) by [@cewert](https://github.com/cewert)
- allow Intro Videos to be able to be skipped or paused ([424b12c](https://github.com/cewert/jellyrock/commit/424b12c)) by [@sivart73](https://github.com/sivart73)
- make settings menu wrap ([d9562a3](https://github.com/cewert/jellyrock/commit/d9562a3)) by [@cewert](https://github.com/cewert)
- alphabetize all user settings ([ce9ef20](https://github.com/cewert/jellyrock/commit/ce9ef20)) by [@cewert](https://github.com/cewert)
- home row layout on refresh so we don't need to restart the app after updating setting ([6ded730](https://github.com/cewert/jellyrock/commit/6ded730)) by [@cewert](https://github.com/cewert)
- rename user setting ([26425d4](https://github.com/cewert/jellyrock/commit/26425d4)) by [@cewert](https://github.com/cewert)
- make more robust with validation function and string template ([848c15a](https://github.com/cewert/jellyrock/commit/848c15a)) by [@michaelcresswell](https://github.com/michaelcresswell)
- increase spacing between row items ([ccbd4d4](https://github.com/cewert/jellyrock/commit/ccbd4d4)) by [@cewert](https://github.com/cewert)
- expand home rows to take up full width of the screen ([3fed93c](https://github.com/cewert/jellyrock/commit/3fed93c)) by [@cewert](https://github.com/cewert)

### Fixed

- dissapearing icons ([554afcd](https://github.com/cewert/jellyrock/commit/554afcd)) by [@cewert](https://github.com/cewert)
- my media backdrop text positioning ([2e8a7c3](https://github.com/cewert/jellyrock/commit/2e8a7c3)) by [@cewert](https://github.com/cewert)
- build artifact names when triggered by PR ([ea683cf](https://github.com/cewert/jellyrock/commit/ea683cf)) by [@cewert](https://github.com/cewert)
- pr body formatting ([4192e42](https://github.com/cewert/jellyrock/commit/4192e42)) by [@cewert](https://github.com/cewert)
- release-prep pr creation ([3369830](https://github.com/cewert/jellyrock/commit/3369830)) by [@cewert](https://github.com/cewert)
- overhang user image caching logic ([f0c6f40](https://github.com/cewert/jellyrock/commit/f0c6f40)) by [@cewert](https://github.com/cewert)
- build artifact naming conflicts ([e34f4f1](https://github.com/cewert/jellyrock/commit/e34f4f1)) by [@cewert](https://github.com/cewert)
- gh release ([d6f8344](https://github.com/cewert/jellyrock/commit/d6f8344)) by [@cewert](https://github.com/cewert)
- static analysis trigger ([d0cb6a4](https://github.com/cewert/jellyrock/commit/d0cb6a4)) by [@cewert](https://github.com/cewert)
- image size warning in static analysis ([6d900d8](https://github.com/cewert/jellyrock/commit/6d900d8)) by [@cewert](https://github.com/cewert)
- false warning ([9e38ad0](https://github.com/cewert/jellyrock/commit/9e38ad0)) by [@cewert](https://github.com/cewert)
- TextButton focusBackground ([df6c70e](https://github.com/cewert/jellyrock/commit/df6c70e)) by [@cewert](https://github.com/cewert)
- sporadic login crash and add more validation to fallback fonts ([b7df2d3](https://github.com/cewert/jellyrock/commit/b7df2d3)) by [@cewert](https://github.com/cewert)
- trickbar thumb color ([20f4530](https://github.com/cewert/jellyrock/commit/20f4530)) by [@cewert](https://github.com/cewert)
- max resolution logic ([fd6ed36](https://github.com/cewert/jellyrock/commit/fd6ed36)) by [@cewert](https://github.com/cewert)
- hide clock logic ([d89fbea](https://github.com/cewert/jellyrock/commit/d89fbea)) by [@cewert](https://github.com/cewert)
- image params ([ee7c363](https://github.com/cewert/jellyrock/commit/ee7c363)) by [@cewert](https://github.com/cewert)
- spelling linter and disable markdown linter on copilot files ([9a6cb5b](https://github.com/cewert/jellyrock/commit/9a6cb5b)) by [@cewert](https://github.com/cewert)
- hideclock user setting ([f6cb256](https://github.com/cewert/jellyrock/commit/f6cb256)) by [@cewert](https://github.com/cewert)
- app crash when using 24h clock ([63cfc6f](https://github.com/cewert/jellyrock/commit/63cfc6f)) by [@cewert](https://github.com/cewert)
- overhang alignment ([d99a96a](https://github.com/cewert/jellyrock/commit/d99a96a)) by [@cewert](https://github.com/cewert)
- "..." unwatched bug on griditemsmall ([09e152b](https://github.com/cewert/jellyrock/commit/09e152b)) by [@cewert](https://github.com/cewert)
- artist detail buttons ([5080f74](https://github.com/cewert/jellyrock/commit/5080f74)) by [@cewert](https://github.com/cewert)
- type ([a3ca6b6](https://github.com/cewert/jellyrock/commit/a3ca6b6)) by [@cewert](https://github.com/cewert)
- attempt to fix copilot agent ([584521e](https://github.com/cewert/jellyrock/commit/584521e)) by [@cewert](https://github.com/cewert)
- copilot agent auth token ([bba3aa8](https://github.com/cewert/jellyrock/commit/bba3aa8)) by [@cewert](https://github.com/cewert)
- "..." unplayedvideo count bug. caused by boundingRect() ([f498c8d](https://github.com/cewert/jellyrock/commit/f498c8d)) by [@cewert](https://github.com/cewert)
- header "logo" link ([a69fcce](https://github.com/cewert/jellyrock/commit/a69fcce)) by [@cewert](https://github.com/cewert)
- loading spinner bug. only hide active group if remote is disabled ([97cfd91](https://github.com/cewert/jellyrock/commit/97cfd91)) by [@cewert](https://github.com/cewert)
- code-docs link ([5fb3f8f](https://github.com/cewert/jellyrock/commit/5fb3f8f)) by [@cewert](https://github.com/cewert)
- code-docs pages deployment ([9defe0b](https://github.com/cewert/jellyrock/commit/9defe0b)) by [@cewert](https://github.com/cewert)
- invalid param name ([59711d3](https://github.com/cewert/jellyrock/commit/59711d3)) by [@cewert](https://github.com/cewert)
- markdown linter ([c111069](https://github.com/cewert/jellyrock/commit/c111069)) by [@cewert](https://github.com/cewert)
- spelling linter ([c704110](https://github.com/cewert/jellyrock/commit/c704110)) by [@cewert](https://github.com/cewert)
- linting errors ([811baa4](https://github.com/cewert/jellyrock/commit/811baa4)) by [@cewert](https://github.com/cewert)
- build-docs error ([cc5e561](https://github.com/cewert/jellyrock/commit/cc5e561)) by [@cewert](https://github.com/cewert)
- formatting ([d80a1ff](https://github.com/cewert/jellyrock/commit/d80a1ff)) by [@cewert](https://github.com/cewert)
- client name in server dashboard ([5679826](https://github.com/cewert/jellyrock/commit/5679826)) by [@cewert](https://github.com/cewert)
- prod build file name ([552cb70](https://github.com/cewert/jellyrock/commit/552cb70)) by [@cewert](https://github.com/cewert)
- workflows and rename a few things ([96ca702](https://github.com/cewert/jellyrock/commit/96ca702)) by [@cewert](https://github.com/cewert)
- syntax error ([6f3a586](https://github.com/cewert/jellyrock/commit/6f3a586)) by [@cewert](https://github.com/cewert)
- bugs with translation script and update to be case sensitive. alphebetize translations strings ([a670608](https://github.com/cewert/jellyrock/commit/a670608)) by [@cewert](https://github.com/cewert)
- translations ([b5c4d90](https://github.com/cewert/jellyrock/commit/b5c4d90)) by [@cewert](https://github.com/cewert)
- formatting ([ef7e2d2](https://github.com/cewert/jellyrock/commit/ef7e2d2)) by [@cewert](https://github.com/cewert)
- formatting ([753f27a](https://github.com/cewert/jellyrock/commit/753f27a)) by [@cewert](https://github.com/cewert)
- bad merge ([63abf7e](https://github.com/cewert/jellyrock/commit/63abf7e)) by [@cewert](https://github.com/cewert)

### Removed

- colon from episode text ([a8fb9c3](https://github.com/cewert/jellyrock/commit/a8fb9c3)) by [@cewert](https://github.com/cewert)
- debugging ([4ab18ed](https://github.com/cewert/jellyrock/commit/4ab18ed)) by [@cewert](https://github.com/cewert)
- release and recreate to preserve auto gen changelog ([96d6e4e](https://github.com/cewert/jellyrock/commit/96d6e4e)) by [@cewert](https://github.com/cewert)
- all themed labelbadge components. looked the same as system font in my testing ([16e0921](https://github.com/cewert/jellyrock/commit/16e0921)) by [@cewert](https://github.com/cewert)
- unused code ([fda5b98](https://github.com/cewert/jellyrock/commit/fda5b98)) by [@cewert](https://github.com/cewert)
- overhang user image as needed ([b1bf369](https://github.com/cewert/jellyrock/commit/b1bf369)) by [@cewert](https://github.com/cewert)
- redundant timer. observe clock field instead ([5c1086b](https://github.com/cewert/jellyrock/commit/5c1086b)) by [@cewert](https://github.com/cewert)
- unused home settings option ([0a9b80c](https://github.com/cewert/jellyrock/commit/0a9b80c)) by [@cewert](https://github.com/cewert)
- unused code ([0f1b61a](https://github.com/cewert/jellyrock/commit/0f1b61a)) by [@cewert](https://github.com/cewert)
- debugging ([cda41bd](https://github.com/cewert/jellyrock/commit/cda41bd)) by [@cewert](https://github.com/cewert)
- unused functions ([#22](https://github.com/cewert/jellyrock/pull/22)) by [@copilot-swe-agent[bot]](https://github.com/apps/copilot-swe-agent)
- code-docs leftover ([b65406b](https://github.com/cewert/jellyrock/commit/b65406b)) by [@cewert](https://github.com/cewert)
- api docs ([c992620](https://github.com/cewert/jellyrock/commit/c992620)) by [@cewert](https://github.com/cewert)
- api/code docs ([c5c55a2](https://github.com/cewert/jellyrock/commit/c5c55a2)) by [@cewert](https://github.com/cewert)
- api docs ([306d5c5](https://github.com/cewert/jellyrock/commit/306d5c5)) by [@cewert](https://github.com/cewert)
- redundant ropm calls. these are handled by the postinstall script ([34d597c](https://github.com/cewert/jellyrock/commit/34d597c)) by [@cewert](https://github.com/cewert)
- beta branding images ([fb89cef](https://github.com/cewert/jellyrock/commit/fb89cef)) by [@cewert](https://github.com/cewert)
- text area from my media home row ([b171114](https://github.com/cewert/jellyrock/commit/b171114)) by [@cewert](https://github.com/cewert)
- meridian from movie/tv ends at text. add ends at text to OSD and update it every 60sec ([2be43ae](https://github.com/cewert/jellyrock/commit/2be43ae)) by [@cewert](https://github.com/cewert)
- menu, remove jf images info, and remove all settings instructions ([4efdd4d](https://github.com/cewert/jellyrock/commit/4efdd4d)) by [@cewert](https://github.com/cewert)
- hevc user setting ([1c51b49](https://github.com/cewert/jellyrock/commit/1c51b49)) by [@cewert](https://github.com/cewert)
- link ([925ab28](https://github.com/cewert/jellyrock/commit/925ab28)) by [@cewert](https://github.com/cewert)
- random blue item bg. clean up global constants and icons. only use snake case for constants. ([75c255c](https://github.com/cewert/jellyrock/commit/75c255c)) by [@cewert](https://github.com/cewert)
- whats new popup ([ba9777d](https://github.com/cewert/jellyrock/commit/ba9777d)) by [@cewert](https://github.com/cewert)
- unused file ([d94ce60](https://github.com/cewert/jellyrock/commit/d94ce60)) by [@cewert](https://github.com/cewert)
- unneeded api call on render thread ([fbae4f6](https://github.com/cewert/jellyrock/commit/fbae4f6)) by [@cewert](https://github.com/cewert)
- redundant "Loading..." text ([9faac6d](https://github.com/cewert/jellyrock/commit/9faac6d)) by [@cewert](https://github.com/cewert)
- "show all next up" button. increase max next up items on home screen ([bac2e86](https://github.com/cewert/jellyrock/commit/bac2e86)) by [@cewert](https://github.com/cewert)
- comment ([2c25e5d](https://github.com/cewert/jellyrock/commit/2c25e5d)) by [@cewert](https://github.com/cewert)
- renovate.json ([2aa155e](https://github.com/cewert/jellyrock/commit/2aa155e)) by [@cewert](https://github.com/cewert)
- duplicate ([0e7b443](https://github.com/cewert/jellyrock/commit/0e7b443)) by [@cewert](https://github.com/cewert)
- actions folder ([63cc652](https://github.com/cewert/jellyrock/commit/63cc652)) by [@cewert](https://github.com/cewert)
- other restrictions on OSD for intro files ([210a9c1](https://github.com/cewert/jellyrock/commit/210a9c1)) by [@sivart73](https://github.com/sivart73)

### Dependencies

- update actions/checkout action to v5 ([#36](https://github.com/cewert/jellyrock/pull/36)) by [@renovate[bot]](https://github.com/apps/renovate)
- update softprops/action-gh-release action to v2 ([#37](https://github.com/cewert/jellyrock/pull/37)) by [@renovate[bot]](https://github.com/apps/renovate)
- update actions/setup-java action to v5 ([#34](https://github.com/cewert/jellyrock/pull/34)) by [@renovate[bot]](https://github.com/apps/renovate)
- update actions/checkout action to v5 ([#31](https://github.com/cewert/jellyrock/pull/31)) by [@renovate[bot]](https://github.com/apps/renovate)
- update dependency brighterscript to v0.70.0 ([#32](https://github.com/cewert/jellyrock/pull/32)) by [@renovate[bot]](https://github.com/apps/renovate)
- update dependency roku-deploy to v3.13.0 ([#21](https://github.com/cewert/jellyrock/pull/21)) by [@renovate[bot]](https://github.com/apps/renovate)
- update peter-evans/repository-dispatch action to v3 ([#18](https://github.com/cewert/jellyrock/pull/18)) by [@renovate[bot]](https://github.com/apps/renovate)
- update dependency brighterscript-formatter to v1.7.17 ([#16](https://github.com/cewert/jellyrock/pull/16)) by [@renovate[bot]](https://github.com/apps/renovate)
- update dependency ropm to v0.10.37 ([#17](https://github.com/cewert/jellyrock/pull/17)) by [@renovate[bot]](https://github.com/apps/renovate)
- update dependency @rokucommunity/bslint to v0.8.34 ([#14](https://github.com/cewert/jellyrock/pull/14)) by [@renovate[bot]](https://github.com/apps/renovate)
- update dependency brighterscript to v0.69.13 ([#15](https://github.com/cewert/jellyrock/pull/15)) by [@renovate[bot]](https://github.com/apps/renovate)
- update dependency ropm to v0.10.36 ([#12](https://github.com/cewert/jellyrock/pull/12)) by [@renovate[bot]](https://github.com/apps/renovate)
- update dependency brighterscript to v0.69.12 ([#7](https://github.com/cewert/jellyrock/pull/7)) by [@renovate[bot]](https://github.com/apps/renovate)
- update dependency ropm to v0.10.35 ([#6](https://github.com/cewert/jellyrock/pull/6)) by [@renovate[bot]](https://github.com/apps/renovate)
- update dependency brighterscript-formatter to v1.7.16 ([#5](https://github.com/cewert/jellyrock/pull/5)) by [@renovate[bot]](https://github.com/apps/renovate)
- update dependency @rokucommunity/bslint to v0.8.33 ([#3](https://github.com/cewert/jellyrock/pull/3)) by [@renovate[bot]](https://github.com/apps/renovate)
- update dependency brighterscript to v0.69.11 ([#4](https://github.com/cewert/jellyrock/pull/4)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency undent to v1 ([d13917e](https://github.com/cewert/jellyrock/commit/d13917e)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency brighterscript-formatter to v1.7.15 ([e3fe4f1](https://github.com/cewert/jellyrock/commit/e3fe4f1)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency roku-deploy to v3.12.6 ([50b42a3](https://github.com/cewert/jellyrock/commit/50b42a3)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency ropm to v0.10.34 ([cad7c4d](https://github.com/cewert/jellyrock/commit/cad7c4d)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency @rokucommunity/bslint to v0.8.32 ([382e68f](https://github.com/cewert/jellyrock/commit/382e68f)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency brighterscript to v0.69.10 ([2536b8d](https://github.com/cewert/jellyrock/commit/2536b8d)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency rooibos-roku to v5.15.7 ([e2c5183](https://github.com/cewert/jellyrock/commit/e2c5183)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency ropm to v0.10.33 ([e7ed644](https://github.com/cewert/jellyrock/commit/e7ed644)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency brighterscript to v0.69.9 ([83e6f88](https://github.com/cewert/jellyrock/commit/83e6f88)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency markdownlint-cli2 to v0.18.1 ([5046bc4](https://github.com/cewert/jellyrock/commit/5046bc4)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency spellchecker-cli to v7 ([3860562](https://github.com/cewert/jellyrock/commit/3860562)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency roku-deploy to v3.12.5 ([1cc5005](https://github.com/cewert/jellyrock/commit/1cc5005)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency jsdoc to v4.0.4 ([5e0299c](https://github.com/cewert/jellyrock/commit/5e0299c)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency @rokucommunity/bslint to v0.8.31 ([fae2e93](https://github.com/cewert/jellyrock/commit/fae2e93)) by [@renovate[bot]](https://github.com/apps/renovate)
- dependency brighterscript-formatter to v1.7.14 ([ee48895](https://github.com/cewert/jellyrock/commit/ee48895)) by [@renovate[bot]](https://github.com/apps/renovate)
- stefanzweifel/git-auto-commit-action digest to 778341a ([6fbc874](https://github.com/cewert/jellyrock/commit/6fbc874)) by [@renovate[bot]](https://github.com/apps/renovate)
- stefanzweifel/git-auto-commit-action action to v6 ([a012442](https://github.com/cewert/jellyrock/commit/a012442)) by [@renovate[bot]](https://github.com/apps/renovate)
- stefanzweifel/git-auto-commit-action digest to b863ae1 ([e5fbf5d](https://github.com/cewert/jellyrock/commit/e5fbf5d)) by [@renovate[bot]](https://github.com/apps/renovate)
- actions/upload-artifact digest to ea165f8 ([7da1225](https://github.com/cewert/jellyrock/commit/7da1225)) by [@renovate[bot]](https://github.com/apps/renovate)
- actions/stale digest to 5bef64f ([9e9304d](https://github.com/cewert/jellyrock/commit/9e9304d)) by [@renovate[bot]](https://github.com/apps/renovate)
- actions/setup-node digest to 49933ea ([297a22c](https://github.com/cewert/jellyrock/commit/297a22c)) by [@renovate[bot]](https://github.com/apps/renovate)
- actions/setup-java digest to c5195ef ([5627d2d](https://github.com/cewert/jellyrock/commit/5627d2d)) by [@renovate[bot]](https://github.com/apps/renovate)
- actions/checkout digest to 11bd719 ([c9e5a75](https://github.com/cewert/jellyrock/commit/c9e5a75)) by [@renovate[bot]](https://github.com/apps/renovate)
