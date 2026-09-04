<!-- markdownlint-disable -->
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Dependencies

- Update promises from v0.7.1 to v0.7.2 ([#878](https://github.com/jellyrock/jellyrock/pull/878))
- Update brighterscript-formatter from v1.8.1 to v1.8.2 ([#877](https://github.com/jellyrock/jellyrock/pull/877))
- Update roku-deploy from v3.18.3 to v3.18.4 ([#879](https://github.com/jellyrock/jellyrock/pull/879))

## [2.28.0](https://github.com/jellyrock/jellyrock/compare/v2.27.0...v2.28.0) - 2026-09-04

### Changed

- Stop the playback error dialog exiting on a close it did not cause ([#876](https://github.com/jellyrock/jellyrock/pull/876))
- Migrate the playback error dialog onto `JRDialog` and make it diagnostic ([#875](https://github.com/jellyrock/jellyrock/pull/875))

### Fixed

- Guard `onKeyEvent` against key events delivered after teardown ([#883](https://github.com/jellyrock/jellyrock/pull/883))

### Dependencies

- Update actions/setup-java action to v6 ([#874](https://github.com/jellyrock/jellyrock/pull/874))
- Update lint-staged from v17.3.0 to v17.4.1 ([#865](https://github.com/jellyrock/jellyrock/pull/865))
- Update softprops/action-gh-release action to v3.0.3 ([#873](https://github.com/jellyrock/jellyrock/pull/873))
- Update js-yaml from v5.3.0 to v5.4.1 ([#857](https://github.com/jellyrock/jellyrock/pull/857))

## [2.27.0](https://github.com/jellyrock/jellyrock/compare/v2.26.1...v2.27.0) - 2026-08-31

### Added

- rebuild the playback-info report as a `source → target` readout ([#859](https://github.com/jellyrock/jellyrock/pull/859))

### Changed

- Size Home's browse feeds with one setting and measure its ceiling ([#864](https://github.com/jellyrock/jellyrock/pull/864))

### Fixed

- (playback) Direct-play music instead of transcoding it ([#870](https://github.com/jellyrock/jellyrock/pull/870))
- MPEG-2 transcoded despite its setting; AV1 ignored its level cap ([#868](https://github.com/jellyrock/jellyrock/pull/868))
- (setting) Honor a non-default Maximum Resolution instead of capping at 1080p ([#866](https://github.com/jellyrock/jellyrock/pull/866))

### Dependencies

- Update roku-deploy from v3.18.2 to v3.18.3 ([#867](https://github.com/jellyrock/jellyrock/pull/867))
- Update eslint from v10.8.1 to v10.9.1 ([#839](https://github.com/jellyrock/jellyrock/pull/839))
- Update sharp from v0.35.3 to v0.35.4 ([#863](https://github.com/jellyrock/jellyrock/pull/863))

## [2.26.1](https://github.com/jellyrock/jellyrock/compare/v2.26.0...v2.26.1) - 2026-08-26

### Fixed

- apply the user's Maximum Bitrate limit instead of discarding it ([#858](https://github.com/jellyrock/jellyrock/pull/858))

## [2.26.0](https://github.com/jellyrock/jellyrock/compare/v2.25.1...v2.26.0) - 2026-08-25

### Changed

- Collapse the dialog family onto one `computeDialogLayout` shape ([#852](https://github.com/jellyrock/jellyrock/pull/852))
- Give the app one authoritative "a session is established" signal ([#850](https://github.com/jellyrock/jellyrock/pull/850))
- Rebuild Quick Connect on the `JRDialog` family and the API pool ([#847](https://github.com/jellyrock/jellyrock/pull/847))
- Enforce a production Task-thread ceiling in `launchTask()` ([#849](https://github.com/jellyrock/jellyrock/pull/849))
- Bound Task fan-out structurally with a `no-task-fanout` BSC plugin ([#846](https://github.com/jellyrock/jellyrock/pull/846))
- Retire `SceneManager`'s dialog machinery for the `JRDialog` family ([#844](https://github.com/jellyrock/jellyrock/pull/844))
- Move `PlayerHostView` onto the standard dialogs and unify the chrome ([#842](https://github.com/jellyrock/jellyrock/pull/842))
- Give `cell-load` rates a denominator with scripted RTA sweeps ([#838](https://github.com/jellyrock/jellyrock/pull/838))
- Batch Home's row-size recompute across a latest-rows run ([#799](https://github.com/jellyrock/jellyrock/pull/799))

### Fixed

- stop `FontDownloadTask` crashing on servers that omit `EnableFallbackFont` ([#841](https://github.com/jellyrock/jellyrock/pull/841))
- Stop posters blinking on the Cast & Crew row as you scroll it ([#840](https://github.com/jellyrock/jellyrock/pull/840))

### Dependencies

- Update vitest from v4.1.10 to v4.1.11 ([#831](https://github.com/jellyrock/jellyrock/pull/831))
- Update js-yaml from v5.2.3 to v5.3.0 ([#812](https://github.com/jellyrock/jellyrock/pull/812))

## [2.25.1](https://github.com/jellyrock/jellyrock/compare/v2.25.0...v2.25.1) - 2026-08-17

### Changed

- Measure the pre-login flow, and fix the `roku-log` crash it exposed ([#817](https://github.com/jellyrock/jellyrock/pull/817))
- Read a screen in one batch, and report what an assertion checked ([#808](https://github.com/jellyrock/jellyrock/pull/808))

### Fixed

- (`ItemDetails`) drop redundant am/pm from the "Ends at" chip ([#826](https://github.com/jellyrock/jellyrock/pull/826))
- (overhang) stop long usernames rendering as a bare `...` in `JRDropdown` ([#825](https://github.com/jellyrock/jellyrock/pull/825))
- (performance) Destroy popped routed screens and fix the `BaseGridView` retain cycle ([#816](https://github.com/jellyrock/jellyrock/pull/816))
- (rta) record what became of a run, and read the baseline ([#806](https://github.com/jellyrock/jellyrock/pull/806))
- (rta) record which device a run drove in the run ledger ([8794b28](https://github.com/jellyrock/jellyrock/commit/8794b287))
- (rta) compare re-minted credentials by presence so the restore converges ([#805](https://github.com/jellyrock/jellyrock/pull/805))

### Dependencies

- Update eslint-plugin-n from v18.2.2 to v18.3.0 ([#783](https://github.com/jellyrock/jellyrock/pull/783))

## [2.25.0](https://github.com/jellyrock/jellyrock/compare/v2.24.2...v2.25.0) - 2026-08-10

### Added

- Add standard `JRDialog` dialog system with per-instance results ([#757](https://github.com/jellyrock/jellyrock/pull/757))
- (ci) Run the RTA suite in CI on the release-prep branch ([#772](https://github.com/jellyrock/jellyrock/pull/772))
- Bound Task threads behind an accounted `launchTask()` chokepoint ([#768](https://github.com/jellyrock/jellyrock/pull/768))
- Collapse `HomeRows` latest-media fan-out onto a bounded `apiPipeline` ([#762](https://github.com/jellyrock/jellyrock/pull/762))

### Changed

- Batch Home's latest-row item attach into one `appendChildren` call ([#792](https://github.com/jellyrock/jellyrock/pull/792))
- Draw the Genres view before its artwork has loaded ([#779](https://github.com/jellyrock/jellyrock/pull/779))
- Gate device tests behind maintainer approval for fork PRs only ([#773](https://github.com/jellyrock/jellyrock/pull/773))
- Run the Genres view's per-genre fetches through `apiPipeline` ([#770](https://github.com/jellyrock/jellyrock/pull/770))
- Measure the item-grid wait/emit split, pick `apiPipeline` for the genre loop, and keep the timers out of prod ([#769](https://github.com/jellyrock/jellyrock/pull/769))

### Fixed

- Index a season's episodes by position in `QuickPlayTask`, not by `IndexNumber` ([#796](https://github.com/jellyrock/jellyrock/pull/796))
- Scope resume queries to video items so Jellyfin 12.0 folders stay out of Continue Watching ([#794](https://github.com/jellyrock/jellyrock/pull/794))
- Fix Genres view spacing so each heading sits with its own posters ([#787](https://github.com/jellyrock/jellyrock/pull/787))
- (ui) render `Gradient` as a stretched tinted ramp poster ([#781](https://github.com/jellyrock/jellyrock/pull/781))
- (lint) stop the cursor nudge reading Recently-shipped as the cursor ([#771](https://github.com/jellyrock/jellyrock/pull/771))
- Tighten Task-node hygiene and remove stranded dialog helpers ([#765](https://github.com/jellyrock/jellyrock/pull/765))
- Remove invalid `focusable` attribute from `<component>` elements ([#767](https://github.com/jellyrock/jellyrock/pull/767))
- `ws://` remote-control socket task-thread leak ([#756](https://github.com/jellyrock/jellyrock/pull/756))
- move log-manager init to `JRScene` so global nodes can log ([#761](https://github.com/jellyrock/jellyrock/pull/761))

### Dependencies

- Update eslint from v10.8.0 to v10.8.1 ([#780](https://github.com/jellyrock/jellyrock/pull/780))
- Update actions/setup-java action to v5.7.0 ([#763](https://github.com/jellyrock/jellyrock/pull/763))
- Update lint-staged from v17.2.0 to v17.3.0 ([#755](https://github.com/jellyrock/jellyrock/pull/755))
- Update actions/stale action to v11 ([#764](https://github.com/jellyrock/jellyrock/pull/764))
- Update js-yaml from v5.2.2 to v5.2.3 ([#758](https://github.com/jellyrock/jellyrock/pull/758))

## [2.24.2](https://github.com/jellyrock/jellyrock/compare/v2.24.1...v2.24.2) - 2026-07-31

### Fixed

- (remote-control) bind `ws://` socket to the advertised `DeviceId` ([#747](https://github.com/jellyrock/jellyrock/pull/747))
- (api) route `SubmitSideEffect` through a children-as-vehicle FIFO ([#745](https://github.com/jellyrock/jellyrock/pull/745))

### Dependencies

- Update source-map from v0.7.6 to v0.8.0 ([#725](https://github.com/jellyrock/jellyrock/pull/725))
- Update eslint from v10.7.0 to v10.8.0 ([#746](https://github.com/jellyrock/jellyrock/pull/746))
- Update markdownlint-cli2 from v0.23.1 to v0.23.2 ([#749](https://github.com/jellyrock/jellyrock/pull/749))
- Update lint-staged from v17.0.8 to v17.2.0 ([#722](https://github.com/jellyrock/jellyrock/pull/722))
- Update actions/checkout action to v7.0.1 ([#748](https://github.com/jellyrock/jellyrock/pull/748))
- Update js-yaml from v5.2.1 to v5.2.2 ([#740](https://github.com/jellyrock/jellyrock/pull/740))
- Update roku-deploy from v3.17.7 to v3.18.2 ([#715](https://github.com/jellyrock/jellyrock/pull/715))

## [2.24.1](https://github.com/jellyrock/jellyrock/compare/v2.24.0...v2.24.1) - 2026-07-24

### Fixed

- (osd) Offer manual segment-skip button on replay after one-time auto-skip ([#739](https://github.com/jellyrock/jellyrock/pull/739))
- Guard `VideoPlayerView` notifications against teardown race crash ([#738](https://github.com/jellyrock/jellyrock/pull/738))
- Fix `inferServerUrl` crash from stale pre-login intents ([#736](https://github.com/jellyrock/jellyrock/pull/736))

### Dependencies

- Update prettier from v3.9.5 to v3.9.6 ([#726](https://github.com/jellyrock/jellyrock/pull/726))

## [2.24.0](https://github.com/jellyrock/jellyrock/compare/v2.23.0...v2.24.0) - 2026-07-22

### Added

- (remote-control) ack long-poll commands for at-least-once delivery ([#727](https://github.com/jellyrock/jellyrock/pull/727))

### Changed

- Redesign `/crash-report` to enrich-before-file with disposition routing to epics ([#730](https://github.com/jellyrock/jellyrock/pull/730))
- Report cold-launch pairing and stabilize `DeviceId` on 10.11+ ([#721](https://github.com/jellyrock/jellyrock/pull/721))

### Fixed

- Stop `Home` from clobbering the foreground backdrop when opening deep-link ([#719](https://github.com/jellyrock/jellyrock/pull/719))

### Dependencies

- Update actions/setup-node action to v7 ([#724](https://github.com/jellyrock/jellyrock/pull/724))
- Update softprops/action-gh-release action to v3.0.2 ([#723](https://github.com/jellyrock/jellyrock/pull/723))
- Update markdownlint-cli2 from v0.23.0 to v0.23.1 ([#720](https://github.com/jellyrock/jellyrock/pull/720))
- GitHub Actions ([#713](https://github.com/jellyrock/jellyrock/pull/713))

## [2.23.0](https://github.com/jellyrock/jellyrock/compare/v2.22.0...v2.23.0) - 2026-07-16

### Added

- Add HTTPS long-poll transport for "Cast to JellyRock" ([#714](https://github.com/jellyrock/jellyrock/pull/714))
- Add native `ws://` remote-control receiver (Cast to JellyRock) ([#707](https://github.com/jellyrock/jellyrock/pull/707))

### Changed

- Stop cast `DisplayContent` mirroring from covering active playback ([#716](https://github.com/jellyrock/jellyrock/pull/716))

### Dependencies

- Update eslint from v10.6.0 to v10.7.0 ([#709](https://github.com/jellyrock/jellyrock/pull/709))
- Update adm-zip from v0.5.18 to v0.6.0 ([#708](https://github.com/jellyrock/jellyrock/pull/708))
- Update eslint-plugin-n from v18.2.1 to v18.2.2 ([#710](https://github.com/jellyrock/jellyrock/pull/710))
- Update prettier from v3.9.4 to v3.9.5 ([#706](https://github.com/jellyrock/jellyrock/pull/706))

## [2.22.0](https://github.com/jellyrock/jellyrock/compare/v2.21.0...v2.22.0) - 2026-07-09

### Added

- Add the `/dep-major` skill for major dependency bumps ([#656](https://github.com/jellyrock/jellyrock/pull/656))
- Add a structured agent + contributor workflow ([#670](https://github.com/jellyrock/jellyrock/pull/670))

### Changed

- Restore navigation loading spinners lost in the `sgRouter` migration ([#696](https://github.com/jellyrock/jellyrock/pull/696))
- Route navigation through `sgRouter`; add deep-link/cast contract ([#677](https://github.com/jellyrock/jellyrock/pull/677))

### Fixed

- Fix missing community/critic ratings on `Episode` and other item types ([#702](https://github.com/jellyrock/jellyrock/pull/702))
- (format) pin `brighterscript-formatter` to 1.7.27 (revert 1.7.28 indent regression) ([#684](https://github.com/jellyrock/jellyrock/pull/684))
- (settings) point keyboard submit-key KDFs at the icon assets that exist ([#682](https://github.com/jellyrock/jellyrock/pull/682))

### Dependencies

- Update roku-deploy from v3.17.6 to v3.17.7 ([#703](https://github.com/jellyrock/jellyrock/pull/703))
- Update vitest from v4.1.8 to v4.1.10 ([#700](https://github.com/jellyrock/jellyrock/pull/700))
- Update awalsh128/cache-apt-pkgs-action action to v1.6.3 ([#699](https://github.com/jellyrock/jellyrock/pull/699))
- Update actions/setup-java action to v5.4.0 ([#701](https://github.com/jellyrock/jellyrock/pull/701))
- Update markdownlint-cli2 from v0.22.1 to v0.23.0 ([#693](https://github.com/jellyrock/jellyrock/pull/693))
- Update js-yaml from v4.2.0 to v5.2.1 ([#681](https://github.com/jellyrock/jellyrock/pull/681), [#672](https://github.com/jellyrock/jellyrock/pull/672), [#694](https://github.com/jellyrock/jellyrock/pull/694))
- Update sharp from v0.34.5 to v0.35.3 ([#657](https://github.com/jellyrock/jellyrock/pull/657), [#665](https://github.com/jellyrock/jellyrock/pull/665), [#692](https://github.com/jellyrock/jellyrock/pull/692))
- Update sgRouter to v0.1.4 ([#690](https://github.com/jellyrock/jellyrock/pull/690))
- Update brighterscript-formatter from v1.7.27 to v1.8.1 ([#678](https://github.com/jellyrock/jellyrock/pull/678), [#688](https://github.com/jellyrock/jellyrock/pull/688))
- Update prettier from v3.8.4 to v3.9.4 ([#680](https://github.com/jellyrock/jellyrock/pull/680), [#687](https://github.com/jellyrock/jellyrock/pull/687))
- Update adm-zip from v0.5.17 to v0.5.18 ([#686](https://github.com/jellyrock/jellyrock/pull/686))
- Update GitHub Actions from v1.6.1 to v5.3.0 ([#663](https://github.com/jellyrock/jellyrock/pull/663), [#673](https://github.com/jellyrock/jellyrock/pull/673), [#674](https://github.com/jellyrock/jellyrock/pull/674))
- Update linting from v10.5.0 to v18.1.0 ([#661](https://github.com/jellyrock/jellyrock/pull/661), [#658](https://github.com/jellyrock/jellyrock/pull/658))
- Update vitest monorepo to v4.1.9 ([#664](https://github.com/jellyrock/jellyrock/pull/664))
- GitHub Actions (checkout v7, cache v6) + allow-unsafe-pr-checkout opt-in ([#675](https://github.com/jellyrock/jellyrock/pull/675))
- Linting (eslint 10.6.0, eslint-plugin-n 18.2.1, prettier 3.9.1) ([#679](https://github.com/jellyrock/jellyrock/pull/679))
- Git hooks ([#671](https://github.com/jellyrock/jellyrock/pull/671))

## [2.21.0](https://github.com/jellyrock/jellyrock/compare/v2.20.0...v2.21.0) - 2026-06-12

### Added

- Add library + item-type gallery screenshots + store/website split ([#648](https://github.com/jellyrock/jellyrock/pull/648))
- (i18n) add global sign-in screen language setting ([#638](https://github.com/jellyrock/jellyrock/pull/638))

### Changed

- (screenshots) lossless WebP + prune non-store languages ([#652](https://github.com/jellyrock/jellyrock/pull/652))
- Per-language store screenshots + RTA functional-test layer ([#642](https://github.com/jellyrock/jellyrock/pull/642))

### Fixed

- (search) localize search result-row headers ([#649](https://github.com/jellyrock/jellyrock/pull/649))

### Dependencies

- Update promises from v0.7.0 to v0.7.1 ([#646](https://github.com/jellyrock/jellyrock/pull/646))
- Update ropm from v0.11.8 to v0.11.9 ([#645](https://github.com/jellyrock/jellyrock/pull/645))
- Update brighterscript from v1.0.0 to v1.7.27 ([#644](https://github.com/jellyrock/jellyrock/pull/644))
- Update linting to v3.8.4 ([#643](https://github.com/jellyrock/jellyrock/pull/643))
- Update js-yaml from v4.1.1 to v4.2.0 ([#640](https://github.com/jellyrock/jellyrock/pull/640))
- Pin dependencies ([#647](https://github.com/jellyrock/jellyrock/pull/647))
- Pin dependencies ([#639](https://github.com/jellyrock/jellyrock/pull/639))

## [2.20.0](https://github.com/jellyrock/jellyrock/compare/v2.19.0...v2.20.0) - 2026-06-08

### Added

- (promises) collapse GetFiltersTask + LoadChannelListForQueueTask to render-thread promises (#551) ([#628](https://github.com/jellyrock/jellyrock/pull/628))
- (promises) collapse LoadProgramDetailsTask to a render-thread promise (#551) ([#627](https://github.com/jellyrock/jellyrock/pull/627))
- (promises) collapse the watched toggle to a render-thread promise ([#626](https://github.com/jellyrock/jellyrock/pull/626))
- (login) collapse Branding + QuickConnect Tasks to render-thread promises ([#625](https://github.com/jellyrock/jellyrock/pull/625))

### Changed

- (quickplay) collapse dead album/artist dispatch aliases to canonical type ([#631](https://github.com/jellyrock/jellyrock/pull/631))
- Adopt `@rokucommunity/promises` foundation + 3 reference migrations ([#624](https://github.com/jellyrock/jellyrock/pull/624))

### Fixed

- (server-upgrade) decouple diff anchor from resolved-through ([#634](https://github.com/jellyrock/jellyrock/pull/634))
- (quickplay) key Play All dispatch on canonical Jellyfin item type ([#630](https://github.com/jellyrock/jellyrock/pull/630))
- (playback) restore ts-first transcode container order in `getTranscodingProfiles` ([#620](https://github.com/jellyrock/jellyrock/pull/620))

### Dependencies

- Update roku deploy & test to v3.17.6 ([#619](https://github.com/jellyrock/jellyrock/pull/619))

## [2.19.0](https://github.com/jellyrock/jellyrock/compare/v2.18.0...v2.19.0) - 2026-06-04

### Changed

- Skip Roku device tests when only Node tests change ([#616](https://github.com/jellyrock/jellyrock/pull/616))
- Auto-prune the shipped log and backtick code identifiers in PR titles ([#615](https://github.com/jellyrock/jellyrock/pull/615))
- Unify `GridItem`/`GridItemSmall` and fix genre grid rendering ([#613](https://github.com/jellyrock/jellyrock/pull/613))

### Fixed

- (playback) preserve surround on multichannel transcode fallback ([#574](https://github.com/jellyrock/jellyrock/pull/574))
- Fix photo selection opening the viewer behind `ItemDetails` ([#614](https://github.com/jellyrock/jellyrock/pull/614))

## [2.18.0](https://github.com/jellyrock/jellyrock/compare/v2.17.0...v2.18.0) - 2026-06-03

### Added

- Add proactive PR-time floor-coverage lint ([#607](https://github.com/jellyrock/jellyrock/pull/607))
- Add /crash-report + /crash-backtrace for weekly Roku crash triage ([#575](https://github.com/jellyrock/jellyrock/pull/575))
- Add JRPlaceholder, placeholder pipeline, and outlined icon defaults ([#561](https://github.com/jellyrock/jellyrock/pull/561))
- Add Material Symbols icon pipeline with per-resolution assets ([#560](https://github.com/jellyrock/jellyrock/pull/560))

### Changed

- Support RC + unstable/master channels in server-upgrade automation ([#610](https://github.com/jellyrock/jellyrock/pull/610))
- Version-guard the Lyrics request on Jellyfin 10.9+ ([#605](https://github.com/jellyrock/jellyrock/pull/605))
- Server-upgrade automation: detect + triage Jellyfin API changes that affect us (Phases 0–6) ([#597](https://github.com/jellyrock/jellyrock/pull/597))
- Expand placeholder coverage to grids, audio player, and item details ([#567](https://github.com/jellyrock/jellyrock/pull/567))
- renovate: strip rules now covered by org default ([#590](https://github.com/jellyrock/jellyrock/pull/590))
- vscode: associate dotfiles to stop markdownlint false positives ([#589](https://github.com/jellyrock/jellyrock/pull/589))
- Skills overhaul: /catchup, journal sync, /pr update-path, audit-skill ([#559](https://github.com/jellyrock/jellyrock/pull/559))

### Fixed

- (ci) pass PR title/author/labels via env in journal-sync (command injection) ([#604](https://github.com/jellyrock/jellyrock/pull/604))
- (server-upgrade) clearer digest counts, honest root-cause comments, harden commit-msg injection ([#603](https://github.com/jellyrock/jellyrock/pull/603))
- Fix server-upgrade tracker issue writes (REST) + digest legend & nudge ([#600](https://github.com/jellyrock/jellyrock/pull/600))

### Dependencies

- Update rooibos-roku to v6.0.0 ([#609](https://github.com/jellyrock/jellyrock/pull/609), [#593](https://github.com/jellyrock/jellyrock/pull/593))
- Update brighterscript to v1.0.0 ([#608](https://github.com/jellyrock/jellyrock/pull/608), [#586](https://github.com/jellyrock/jellyrock/pull/586))
- Update vitest from v4.1.5 to v4.1.8 ([#572](https://github.com/jellyrock/jellyrock/pull/572), [#581](https://github.com/jellyrock/jellyrock/pull/581), [#606](https://github.com/jellyrock/jellyrock/pull/606))
- Update lint-staged from v16.4.0 to v17.0.7 ([#577](https://github.com/jellyrock/jellyrock/pull/577), [#596](https://github.com/jellyrock/jellyrock/pull/596), [#598](https://github.com/jellyrock/jellyrock/pull/598))
- Update ropm from v0.11.5 to v0.11.8 ([#571](https://github.com/jellyrock/jellyrock/pull/571), [#588](https://github.com/jellyrock/jellyrock/pull/588), [#595](https://github.com/jellyrock/jellyrock/pull/595))
- Update roku-deploy from v3.17.2 to v3.17.5 ([#570](https://github.com/jellyrock/jellyrock/pull/570), [#578](https://github.com/jellyrock/jellyrock/pull/578), [#594](https://github.com/jellyrock/jellyrock/pull/594))
- Update eslint from v10.3.0 to v10.4.1 ([#576](https://github.com/jellyrock/jellyrock/pull/576), [#592](https://github.com/jellyrock/jellyrock/pull/592))
- Update @rokucommunity/bslint to v1.0.0 ([#587](https://github.com/jellyrock/jellyrock/pull/587))
- Update brighterscript-formatter from v1.7.24 to v1.7.26 ([#569](https://github.com/jellyrock/jellyrock/pull/569), [#580](https://github.com/jellyrock/jellyrock/pull/580))
- Update undent from v1.0.0 to v1.0.1 ([#579](https://github.com/jellyrock/jellyrock/pull/579))
- Update eslint-plugin-n from v17.24.0 to v18 ([#549](https://github.com/jellyrock/jellyrock/pull/549))
- Update ajv from v6.15.0 to v8 ([#556](https://github.com/jellyrock/jellyrock/pull/556))
- Actions/stale digest to eb5cf3a ([#591](https://github.com/jellyrock/jellyrock/pull/591))

## [2.17.0](https://github.com/jellyrock/jellyrock/compare/v2.16.0...v2.17.0) - 2026-05-07

### Added

- (playback) wire Roku voice transport controls ([#554](https://github.com/jellyrock/jellyrock/pull/554))

### Changed

- Overhaul dev-experience: skills, agents, four-pillar journals ([#555](https://github.com/jellyrock/jellyrock/pull/555))

### Dependencies

- Update roku-deploy from v3.17.1 to v3.17.2 ([#552](https://github.com/jellyrock/jellyrock/pull/552))

## [2.16.0](https://github.com/jellyrock/jellyrock/compare/v2.15.0...v2.16.0) - 2026-05-05

### Added

- (translations) seed Language* keys in non-English locales from CLDR ([#543](https://github.com/jellyrock/jellyrock/pull/543))
- (release) add local package:signed for Roku channel-store .pkg ([#542](https://github.com/jellyrock/jellyrock/pull/542))
- Add Vitest coverage for update-translations and changelog-syncer ([#538](https://github.com/jellyrock/jellyrock/pull/538))
- JS hygiene (ESLint+Prettier+Vitest) + scripts/ reorg + 134 tests ([#536](https://github.com/jellyrock/jellyrock/pull/536))
- feat(agents)+ci: doc-maintenance enforcement + layered verification surfaces ([#534](https://github.com/jellyrock/jellyrock/pull/534))
- agent-context system (docs + governance tooling) ([#533](https://github.com/jellyrock/jellyrock/pull/533))

### Changed

- adopt on* prefix style for lifecycle/event callbacks ([#539](https://github.com/jellyrock/jellyrock/pull/539))

### Fixed

- (playback) deprioritize commentary audio tracks; restore OSD switching ([#544](https://github.com/jellyrock/jellyrock/pull/544))
- (ci) patch rooibos coverage to avoid render-thread watchdog ([#540](https://github.com/jellyrock/jellyrock/pull/540))

### Dependencies

- Update brighterscript-formatter from v1.7.23 to v1.7.24 ([#532](https://github.com/jellyrock/jellyrock/pull/532))

## [2.15.0](https://github.com/jellyrock/jellyrock/compare/v2.14.0...v2.15.0) - 2026-04-30

### Added

- (ItemDetails) Replace settings button with inline TrackDropdown cluster ([#487](https://github.com/jellyrock/jellyrock/pull/487))

### Fixed

- (itemDetails) localize audio/subtitle track language names ([#527](https://github.com/jellyrock/jellyrock/pull/527))
- (trackDropdown) measure dropdown width with themed Label ([#526](https://github.com/jellyrock/jellyrock/pull/526))

## [2.14.0](https://github.com/jellyrock/jellyrock/compare/v2.13.0...v2.14.0) - 2026-04-29

### Added

- support Quick Connect on Jellyfin 10.7.x ([#523](https://github.com/jellyrock/jellyrock/pull/523))

### Fixed

- Quick Connect on Jellyfin 10.9+ servers ([#522](https://github.com/jellyrock/jellyrock/pull/522))
- (tests) use canonical 'en_US' locale in BaseTestSuite ([ad50e1c](https://github.com/jellyrock/jellyrock/commit/ad50e1c2))

### Dependencies

- Update roku-deploy from v3.17.0 to v3.17.1 ([#521](https://github.com/jellyrock/jellyrock/pull/521))

## [2.13.0](https://github.com/jellyrock/jellyrock/compare/v2.12.0...v2.13.0) - 2026-04-28

### Added

- (Home) add Active Recordings section type ([#499](https://github.com/jellyrock/jellyrock/pull/499))

### Changed

- Move Quick Connect to User Select screen ([#506](https://github.com/jellyrock/jellyrock/pull/506))
- Live TV OSD + DVR recording playback improvements ([#501](https://github.com/jellyrock/jellyrock/pull/501))

### Fixed

- (playback) direct-play multichannel audio by default and preserve surround codec on transcode ([#513](https://github.com/jellyrock/jellyrock/pull/513))
- (itemdetails) stable date-added label position on first render ([#503](https://github.com/jellyrock/jellyrock/pull/503))
- (chapters) align synthetic-chapter threshold with displayed runtime ([#502](https://github.com/jellyrock/jellyrock/pull/502))

### Dependencies

- Update roku-deploy from v3.16.4 to v3.17.0 ([#497](https://github.com/jellyrock/jellyrock/pull/497), [#511](https://github.com/jellyrock/jellyrock/pull/511))
- Update markdownlint-cli2 from v0.22.0 to v0.22.1 ([#505](https://github.com/jellyrock/jellyrock/pull/505))
- Update brighterscript-formatter from v1.7.22 to v1.7.23 ([#498](https://github.com/jellyrock/jellyrock/pull/498))
- Update softprops/action-gh-release action to v3 ([#493](https://github.com/jellyrock/jellyrock/pull/493))
- Github actions ([#504](https://github.com/jellyrock/jellyrock/pull/504), [#492](https://github.com/jellyrock/jellyrock/pull/492))

## [2.12.0](https://github.com/jellyrock/jellyrock/compare/v2.11.1...v2.12.0) - 2026-04-13

### Added

- live progress bar on Program cells ([#486](https://github.com/jellyrock/jellyrock/pull/486))

### Fixed

- prevent stale field re-fires on scene restore (quickPlayNode/selectedItem) ([#494](https://github.com/jellyrock/jellyrock/pull/494))
- validate URLs before HTTP requests to prevent Invalid-to-String crash ([#491](https://github.com/jellyrock/jellyrock/pull/491))
- trickplay carousel not rendering after boolean prefix refactor ([#489](https://github.com/jellyrock/jellyrock/pull/489))

### Dependencies

- Update dotenv from v17.4.1 to v17.4.2 ([#490](https://github.com/jellyrock/jellyrock/pull/490))

## [2.11.1](https://github.com/jellyrock/jellyrock/compare/v2.11.0...v2.11.1) - 2026-04-10

### Added

- (docs) matrix chat link to readme ([9d8fb7f](https://github.com/jellyrock/jellyrock/commit/9d8fb7f6))

### Fixed

- API timeouts + TV Guide performance + quickplay ([#480](https://github.com/jellyrock/jellyrock/pull/480))
- use GetDayOfWeek() instead of GetWeekday() for weekday index ([b07d5a7](https://github.com/jellyrock/jellyrock/commit/b07d5a7b))

## [2.11.0](https://github.com/jellyrock/jellyrock/compare/v2.10.1...v2.11.0) - 2026-04-09

### Added

- Add Chapter support to ItemDetails ([#476](https://github.com/jellyrock/jellyrock/pull/476))
- Add 7 premade themes and fix overhang bug when switching theme ([#472](https://github.com/jellyrock/jellyrock/pull/472))
- upgrade BrighterScript to v1 ([#457](https://github.com/jellyrock/jellyrock/pull/457))

### Changed

- code cleanup — naming conventions, enums, and style guide ([#467](https://github.com/jellyrock/jellyrock/pull/467))

### Fixed

- guard GetWeekday() crash in Live TV schedule ([#477](https://github.com/jellyrock/jellyrock/pull/477))
- restore overhang icon focus when returning to Home screen ([55218b9](https://github.com/jellyrock/jellyrock/commit/55218b9a))
- hide library tile backdrop when poster is already loaded ([42b9aff](https://github.com/jellyrock/jellyrock/commit/42b9aff8))

### Dependencies

- Update roku-deploy from v3.16.3 to v3.16.4 ([#471](https://github.com/jellyrock/jellyrock/pull/471))

## [2.10.1](https://github.com/jellyrock/jellyrock/compare/v2.10.0...v2.10.1) - 2026-04-07

### Fixed

- audio/subtitle track selection and playback position ([#464](https://github.com/jellyrock/jellyrock/pull/464))
- sort BoxSet/Collection movies by release date ([#463](https://github.com/jellyrock/jellyrock/pull/463))
- report position at video duration when force-finishing playback ([98d8ac9](https://github.com/jellyrock/jellyrock/commit/98d8ac91))

## [2.10.0](https://github.com/jellyrock/jellyrock/compare/v2.9.0...v2.10.0) - 2026-04-06

### Added

- add .editorconfig file to ensure consistant styling ([2a07113](https://github.com/jellyrock/jellyrock/commit/2a071131))
- custom translation engine with 98 locales and Weblate CI/CD ([#451](https://github.com/jellyrock/jellyrock/pull/451))

### Changed

- OptionsSlider to not extend PanelSet ([#455](https://github.com/jellyrock/jellyrock/pull/455))

### Fixed

- explicitly mark episode as watched when skipping outro ([#458](https://github.com/jellyrock/jellyrock/pull/458))
- set state to hidden in VideoNotification.destroy() to prevent crash ([4a91606](https://github.com/jellyrock/jellyrock/commit/4a916066))
- resolve captionTask data race crash ([#453](https://github.com/jellyrock/jellyrock/pull/453))
- (translation) rebuild translation key constants when en_US.json is edited ([a2ac7fb](https://github.com/jellyrock/jellyrock/commit/a2ac7fbb))
- (translation) use ellipsis instead of three dots ([6440cf2](https://github.com/jellyrock/jellyrock/commit/6440cf24))
- (ci) gate device tests behind environment approval ([fe16ab4](https://github.com/jellyrock/jellyrock/commit/fe16ab49))

### Removed

- unused field alias ([c4c6948](https://github.com/jellyrock/jellyrock/commit/c4c6948f))

### Dependencies

- Update dotenv from v17.4.0 to v17.4.1 ([#456](https://github.com/jellyrock/jellyrock/pull/456))

## [2.9.0](https://github.com/jellyrock/jellyrock/compare/v2.8.0...v2.9.0) - 2026-04-02

### Added

- Add media segment detection and skip notifications ([#447](https://github.com/jellyrock/jellyrock/pull/447))
- add texture management to MarkupGrid ([#444](https://github.com/jellyrock/jellyrock/pull/444))
- add RowList texture management and placeholder images ([#443](https://github.com/jellyrock/jellyrock/pull/443))

### Fixed

- dismiss stale segment notifications on back-to-back transitions ([#448](https://github.com/jellyrock/jellyrock/pull/448))
- captionTask crash on orphaned timer after player teardown ([#446](https://github.com/jellyrock/jellyrock/pull/446))
- overhang focus always defaults to active tab ([#441](https://github.com/jellyrock/jellyrock/pull/441))

### Dependencies

- Update dotenv from v17.3.1 to v17.4.0 ([#445](https://github.com/jellyrock/jellyrock/pull/445))

## [2.8.0](https://github.com/jellyrock/jellyrock/compare/v2.7.0...v2.8.0) - 2026-03-31

### Added

- Add search and settings icon buttons to overhang ([#438](https://github.com/jellyrock/jellyrock/pull/438))
- add user dropdown to overhang ([#437](https://github.com/jellyrock/jellyrock/pull/437))
- add Reset User Settings button ([#436](https://github.com/jellyrock/jellyrock/pull/436))

## [2.7.0](https://github.com/jellyrock/jellyrock/compare/v2.6.0...v2.7.0) - 2026-03-30

### Added

- Add ItemDetails support for Photo, PhotoAlbum, TvChannel, and Program ([#431](https://github.com/jellyrock/jellyrock/pull/431))
- (playback) add language preference override settings ([#428](https://github.com/jellyrock/jellyrock/pull/428))
- intelligent video source selection and OSD source switching ([#424](https://github.com/jellyrock/jellyrock/pull/424))

### Fixed

- (playback) allow direct play of anamorphic video by default ([#433](https://github.com/jellyrock/jellyrock/pull/433))
- h264 device profile and level override issues ([#432](https://github.com/jellyrock/jellyrock/pull/432))
- (ItemDetails) preserve date label Y position on refresh (#427 follow-up) ([c76c272](https://github.com/jellyrock/jellyrock/commit/c76c2723))
- (ItemDetails) restore item logo for primary-image fallback types ([#427](https://github.com/jellyrock/jellyrock/pull/427))
- run captionTask VTT fetch on Task thread ([#425](https://github.com/jellyrock/jellyrock/pull/425))

### Dependencies

- Update brighterscript from v0.70.4 to v0.71.0 ([#426](https://github.com/jellyrock/jellyrock/pull/426))

## [2.6.0](https://github.com/jellyrock/jellyrock/compare/v2.5.0...v2.6.0) - 2026-03-27

### Added

- Add voice search from Home screen ([#421](https://github.com/jellyrock/jellyrock/pull/421))
- add horizontal wrap for short RowList rows ([#420](https://github.com/jellyrock/jellyrock/pull/420))

## [2.5.0](https://github.com/jellyrock/jellyrock/compare/v2.4.0...v2.5.0) - 2026-03-26

### Added

- two-tier API task pool, async button UX, and toast notifications ([#414](https://github.com/jellyrock/jellyrock/pull/414))
- Theme preset system with conditional settings ([#410](https://github.com/jellyrock/jellyrock/pull/410))

### Fixed

- bug in itemDetails animation target after opening extras rows ([#416](https://github.com/jellyrock/jellyrock/pull/416))

### Dependencies

- Update @rokucommunity/bslint from v0.8.39 to v0.8.41 ([#403](https://github.com/jellyrock/jellyrock/pull/403), [#415](https://github.com/jellyrock/jellyrock/pull/415))
- Update brighterscript from v0.70.3 to v0.70.4 ([#404](https://github.com/jellyrock/jellyrock/pull/404))
- Update roku-deploy from v3.16.2 to v3.16.3 ([#406](https://github.com/jellyrock/jellyrock/pull/406))
- Update brighterscript-formatter from v1.7.21 to v1.7.22 ([#405](https://github.com/jellyrock/jellyrock/pull/405))

## [2.4.0](https://github.com/jellyrock/jellyrock/compare/v2.3.0...v2.4.0) - 2026-03-24

### Added

- (extras) improve UX by animating panel on row focus change ([#400](https://github.com/jellyrock/jellyrock/pull/400))

### Dependencies

- Update actions/cache action to v5.0.4 ([#398](https://github.com/jellyrock/jellyrock/pull/398))
- Github actions (major) ([#399](https://github.com/jellyrock/jellyrock/pull/399))

## [2.3.0](https://github.com/jellyrock/jellyrock/compare/v2.2.0...v2.3.0) - 2026-03-23

### Added

- expand supported item types for search and favorites ([#393](https://github.com/jellyrock/jellyrock/pull/393))
- (ItemDetails) Add support for type `Playlist` ([#389](https://github.com/jellyrock/jellyrock/pull/389))
- (ItemDetails) Add support for types `Artist`, `Album`, and `Song` ([#387](https://github.com/jellyrock/jellyrock/pull/387))
- (home) Tab navigation, skeleton loading, and Favorites tab ([#384](https://github.com/jellyrock/jellyrock/pull/384))
- Add self-hosted GitHub Actions runner for Roku hardware tests + migrate to GitHub App auth ([#385](https://github.com/jellyrock/jellyrock/pull/385))

### Fixed

- (LoadingButton) correct spinner size and button frame on ItemDetails ([#395](https://github.com/jellyrock/jellyrock/pull/395))
- (osd) limit OSD logo image height to 300px ([#394](https://github.com/jellyrock/jellyrock/pull/394))
- bslint build warnings  ([#391](https://github.com/jellyrock/jellyrock/pull/391))
- don't run device unit tests for automated commits ([445d473](https://github.com/jellyrock/jellyrock/commit/445d473))

### Dependencies

- Update markdownlint-cli2 from v0.21.0 to v0.22.0 ([#390](https://github.com/jellyrock/jellyrock/pull/390))
- Update @rokucommunity/bslint from v0.8.38 to v0.8.39 ([#386](https://github.com/jellyrock/jellyrock/pull/386))

## [2.2.0](https://github.com/jellyrock/jellyrock/compare/v2.1.0...v2.2.0) - 2026-03-17

### Added

- (ItemDetails) Add support for type `BoxSet` ([#380](https://github.com/jellyrock/jellyrock/pull/380))
- add destroy() to all remaining screens ([#379](https://github.com/jellyrock/jellyrock/pull/379))

### Fixed

- TvChannel playback and implement OSD CurrentProgram metadata ([#381](https://github.com/jellyrock/jellyrock/pull/381))

### Removed

- dead tmp:/scene file operations for screensaver ([#378](https://github.com/jellyrock/jellyrock/pull/378))

### Dependencies

- Update softprops/action-gh-release action to v2.6.1 ([#377](https://github.com/jellyrock/jellyrock/pull/377))

## [2.1.0](https://github.com/jellyrock/jellyrock/compare/v2.0.1...v2.1.0) - 2026-03-16

### Added

- add JRRowItem, standardize home/extras/search rows ([#371](https://github.com/jellyrock/jellyrock/pull/371))
- Add ApiClient abstraction layer with image injection ([#370](https://github.com/jellyrock/jellyrock/pull/370))
- multi-network server discovery with original URL persistence ([#369](https://github.com/jellyrock/jellyrock/pull/369))
- Add support for all Jellyfin server versions 10.7.x+ ([#368](https://github.com/jellyrock/jellyrock/pull/368))

### Fixed

- use server ID for deduplication and preserve original URL ([#374](https://github.com/jellyrock/jellyrock/pull/374))
- use primary image in logo slot for Episode/Season/Recording ([#373](https://github.com/jellyrock/jellyrock/pull/373))
- (JRRowItem) Season/Episode title order and MusicVideo slot ([#372](https://github.com/jellyrock/jellyrock/pull/372))
- (SearchResults) prevent stale backdrop when keyboard is focused ([e99e62b](https://github.com/jellyrock/jellyrock/commit/e99e62b))

## [2.0.1](https://github.com/jellyrock/jellyrock/compare/v2.0.0...v2.0.1) - 2026-03-10

### Fixed

- (ItemDetails) prevent extras pane from opening when grid is empty ([ec5a2dd](https://github.com/jellyrock/jellyrock/commit/ec5a2dd))
- (ItemDetails) missing Watched button for type `Series` and `Season` ([2b06857](https://github.com/jellyrock/jellyrock/commit/2b06857))

### Dependencies

- Update roku-deploy from v3.16.1 to v3.16.2 ([#364](https://github.com/jellyrock/jellyrock/pull/364))
- Update brighterscript-formatter from v1.7.19 to v1.7.21 ([#363](https://github.com/jellyrock/jellyrock/pull/363))

## [2.0.0](https://github.com/jellyrock/jellyrock/compare/v1.16.0...v2.0.0) - 2026-03-09

### Added

- (extras) show More Like This row for episode type ([1330489](https://github.com/jellyrock/jellyrock/commit/1330489))
- Support direct playing `truehd`, `dtshd`, and `mpeg1video` ([#359](https://github.com/jellyrock/jellyrock/pull/359))
- Support direct playing more h264 profiles ([bf2891c](https://github.com/jellyrock/jellyrock/commit/bf2891c))
- Use `ItemDetails` to open `Person` items ([#358](https://github.com/jellyrock/jellyrock/pull/358))
- show Go to Series button for Episode items ([bcfe2c2](https://github.com/jellyrock/jellyrock/commit/bcfe2c2))
- Use `ItemDetails` to open `Season` items ([#352](https://github.com/jellyrock/jellyrock/pull/352))
- Support direct playing h264 profile "Constrained Baseline" ([f5e9f0e](https://github.com/jellyrock/jellyrock/commit/f5e9f0e))
- (itemDetails) universal detail screen replacing MovieDetails and TVShowDetails ([#351](https://github.com/jellyrock/jellyrock/pull/351))
- universal JellyfinBaseItem ContentNode ([#349](https://github.com/jellyrock/jellyrock/pull/349))

### Changed

- Limit all quickplay API queries to 500 items ([4d271a5](https://github.com/jellyrock/jellyrock/commit/4d271a5))
- show episode in Series resume button ([11f0e12](https://github.com/jellyrock/jellyrock/commit/11f0e12))
- adjust extras panel layout and hide metadata during transition ([c6be05a](https://github.com/jellyrock/jellyrock/commit/c6be05a))

### Fixed

- OSD logo not displaying and add image fallbacks for all types ([415512b](https://github.com/jellyrock/jellyrock/commit/415512b))
- Add null check for hideNextEpisodeButtonAnimation to prevent crash ([a3d2c85](https://github.com/jellyrock/jellyrock/commit/a3d2c85))
- focus no longer stolen when returning from extras sub-screen on Series ([9c87a75](https://github.com/jellyrock/jellyrock/commit/9c87a75))
- quickplay.series() logic. check for resumeable episode first ([76e86c0](https://github.com/jellyrock/jellyrock/commit/76e86c0))
- sync Series Resume button logic with Home rows ([#355](https://github.com/jellyrock/jellyrock/pull/355))

### Dependencies

- Update spellchecker-cli from v7.0.2 to v7.0.3 ([#354](https://github.com/jellyrock/jellyrock/pull/354))
- Update brighterscript-xml-plugin from v0.2.1 to v0.3.2 ([#347](https://github.com/jellyrock/jellyrock/pull/347), [#353](https://github.com/jellyrock/jellyrock/pull/353))
- Update actions/upload-artifact action to v7 ([#348](https://github.com/jellyrock/jellyrock/pull/348))
- Github actions ([#360](https://github.com/jellyrock/jellyrock/pull/360))

## [1.16.0](https://github.com/jellyrock/jellyrock/compare/v1.15.0...v1.16.0) - 2026-02-24

### Added

- auto-retry with transcode on live-stream direct-play failure ([#344](https://github.com/jellyrock/jellyrock/pull/344))

### Fixed

- auto-retry with direct play on DoVi buffer overflow ([#343](https://github.com/jellyrock/jellyrock/pull/343))

### Dependencies

- Actions/stale digest to b5d41d4 ([#340](https://github.com/jellyrock/jellyrock/pull/340))

## [1.15.0](https://github.com/jellyrock/jellyrock/compare/v1.14.0...v1.15.0) - 2026-02-23

### Added

- dynamic HLS segment length to prevent buffer overflow ([#338](https://github.com/jellyrock/jellyrock/pull/338))
- custom media track formatting and subtitle display ([#333](https://github.com/jellyrock/jellyrock/pull/333))

### Changed

- lower video playbackTimer from 30 to 10 seconds ([f1191d1](https://github.com/jellyrock/jellyrock/commit/f1191d1))

### Fixed

- enforce paired Height+Width resolution caps across all codec profiles ([#339](https://github.com/jellyrock/jellyrock/pull/339))
- prevent h264 playback failures due to resolution ([bf7d4e2](https://github.com/jellyrock/jellyrock/commit/bf7d4e2)) ([54d1a32](https://github.com/jellyrock/jellyrock/commit/54d1a32))
- VP9 HDR playback and add Dolby Vision Profile 7 support ([ef25339](https://github.com/jellyrock/jellyrock/commit/ef25339))
- on-device decode setting ignored when no receiver connected ([#334](https://github.com/jellyrock/jellyrock/pull/334))

### Dependencies

- Update rimraf from v6.1.2 to v6.1.3 ([#336](https://github.com/jellyrock/jellyrock/pull/336))
- Update markdownlint-cli2 from v0.20.0 to v0.21.0 ([#335](https://github.com/jellyrock/jellyrock/pull/335))

## [1.14.0](https://github.com/jellyrock/jellyrock/compare/v1.13.0...v1.14.0) - 2026-02-10

### Added

- add exit confirmation dialog when pressing back on home screen ([#330](https://github.com/jellyrock/jellyrock/pull/330))
- Add Date Added Display to MovieDetails Screen ([#329](https://github.com/jellyrock/jellyrock/pull/329))

### Dependencies

- Actions/checkout digest to de0fac2 ([#328](https://github.com/jellyrock/jellyrock/pull/328))

## [1.13.0](https://github.com/jellyrock/jellyrock/compare/v1.12.1...v1.13.0) - 2026-02-09

### Added

- add refresh button to MovieDetails ([#325](https://github.com/jellyrock/jellyrock/pull/325))
- animate MovieDetails info with extras slider ([#324](https://github.com/jellyrock/jellyrock/pull/324))
- FocusableOverview for MovieDetails  ([#322](https://github.com/jellyrock/jellyrock/pull/322))
- add Delete button to MovieDetails based on server permissions ([#321](https://github.com/jellyrock/jellyrock/pull/321))

### Changed

- remove redundant JRButtonGroup focus() helper ([#323](https://github.com/jellyrock/jellyrock/pull/323))

### Fixed

- prevent OverviewDialog from triggering MovieDetails data refresh ([db2616c](https://github.com/jellyrock/jellyrock/commit/db2616c))
- movieDetails options button dialog ([c0a339e](https://github.com/jellyrock/jellyrock/commit/c0a339e))
- exclude homevideos from photo presenter mapping ([82b3ab1](https://github.com/jellyrock/jellyrock/commit/82b3ab1))

## [1.12.1](https://github.com/jellyrock/jellyrock/compare/v1.12.0...v1.12.1) - 2026-02-06

### Added

- Add `FocusableOverview` component and improve PersonDetails readability ([#318](https://github.com/jellyrock/jellyrock/pull/318))

### Fixed

- MovieDetails description alignment and `Ends At` text ([#317](https://github.com/jellyrock/jellyrock/pull/317))

## [1.12.0](https://github.com/jellyrock/jellyrock/compare/v1.11.0...v1.12.0) - 2026-02-05

### Changed

- refactor MovieDetails layout ([#314](https://github.com/jellyrock/jellyrock/pull/314))

### Fixed

- livetv guide focus bug and speed up animation ([fd67594](https://github.com/jellyrock/jellyrock/commit/fd67594))
- thshowDetails focus bug and extraSlider alignment ([a593435](https://github.com/jellyrock/jellyrock/commit/a593435))

### Dependencies

- Update actions/cache action to v5.0.3 ([#313](https://github.com/jellyrock/jellyrock/pull/313))

## [1.11.0](https://github.com/jellyrock/jellyrock/compare/v1.10.0...v1.11.0) - 2026-02-02

### Added

- add customizable theme color user settings ([#309](https://github.com/jellyrock/jellyrock/pull/309))

### Changed

-  feat(HexKeyboard): add reset button for custom theme color settings  ([#310](https://github.com/jellyrock/jellyrock/pull/310))

## [1.10.0](https://github.com/cewert/jellyrock/compare/v1.9.1...v1.10.0) - 2026-01-29

### Added

- add LiveTV and Photo `BaseGridView` presenters ([#305](https://github.com/cewert/jellyrock/pull/305))
- add smart down-key navigation for JRMarkupGrid ([187401d](https://github.com/cewert/jellyrock/commit/187401d))

### Changed

- update artistView to use the new BackdropFader component ([#306](https://github.com/cewert/jellyrock/pull/306))
- Consolidate duplicated ItemGrid library components ([#304](https://github.com/cewert/jellyrock/pull/304))
- enable loadSync for local UI posters ([bc99715](https://github.com/cewert/jellyrock/commit/bc99715))
- replace ItemGrid maskGroup scaling with JRMarkupGrid focus indicator ([#297](https://github.com/cewert/jellyrock/pull/297))

### Fixed

- show trickplay thumbnails on low RAM devices ([#301](https://github.com/cewert/jellyrock/pull/301))

### Dependencies

- Update ropm from v0.11.2 to v0.11.4 ([#300](https://github.com/cewert/jellyrock/pull/300), [#303](https://github.com/cewert/jellyrock/pull/303))
- Actions/setup-java digest to be666c2 ([#302](https://github.com/cewert/jellyrock/pull/302))

## [1.9.1](https://github.com/cewert/jellyrock/compare/v1.9.0...v1.9.1) - 2026-01-20

### Fixed

- prevent video auto-replay when returning to episode list ([21d1538](https://github.com/cewert/jellyrock/commit/21d1538))

### Dependencies

- Github actions ([#293](https://github.com/cewert/jellyrock/pull/293))

## [1.9.0](https://github.com/cewert/jellyrock/compare/v1.8.0...v1.9.0) - 2026-01-19

### Added

- Add trickplay carousel for video scrubbing ([#291](https://github.com/cewert/jellyrock/pull/291))

### Changed

- use bullet instead of dash for movie homeitem subtext ([f7d2dd0](https://github.com/cewert/jellyrock/commit/f7d2dd0))
- changed: enable loadSync for local UI posters ([bbb5f99](https://github.com/cewert/jellyrock/commit/bbb5f99))

### Fixed

- incorrect backdrop image dimensions ([19f8b88](https://github.com/cewert/jellyrock/commit/19f8b88))

## [1.8.0](https://github.com/cewert/jellyrock/compare/v1.7.1...v1.8.0) - 2026-01-12

### Added

- apply global theme to settings and display app version ([#286](https://github.com/cewert/jellyrock/pull/286))

### Fixed

- build warnings by tagging unused variables ([38fb7d0](https://github.com/cewert/jellyrock/commit/38fb7d0))
- remove unused id parameter from sortSubtitles function ([5b65680](https://github.com/cewert/jellyrock/commit/5b65680))
- improve search textbox focus UX and address unused param (ref #132) ([9ec1ae1](https://github.com/cewert/jellyrock/commit/9ec1ae1))

## [1.7.1](https://github.com/cewert/jellyrock/compare/v1.7.0...v1.7.1) - 2026-01-07

### Fixed

- silent crash when quickplaying from search results ([#283](https://github.com/cewert/jellyrock/pull/283))
- external stream (.strm) playback broken ([#282](https://github.com/cewert/jellyrock/pull/282))

## [1.7.0](https://github.com/cewert/jellyrock/compare/v1.6.0...v1.7.0) - 2026-01-06

### Added

- integrate AudioPlayerView with app-wide BackdropFader component ([#277](https://github.com/cewert/jellyrock/pull/277))
- improve OSD metadata display ([#275](https://github.com/cewert/jellyrock/pull/275))
- display community and critic ratings in OSD ([#274](https://github.com/cewert/jellyrock/pull/274))

### Changed

- make OSD progressBar wider ([7ca3936](https://github.com/cewert/jellyrock/commit/7ca3936))
- MovieDetails metadata display with dynamic rating components ([#273](https://github.com/cewert/jellyrock/pull/273))
- Complete video player migration to VideoPlayerView ([#266](https://github.com/cewert/jellyrock/pull/266))

### Fixed

- Fix backdrop darkness inconsistency and TV show navigation flicker ([#278](https://github.com/cewert/jellyrock/pull/278))
- (tvshows) restore smaller community rating in TV list details ([34a6469](https://github.com/cewert/jellyrock/commit/34a6469))
- Backdrop not updating when watched item removed from home row ([#276](https://github.com/cewert/jellyrock/pull/276))
- reduce maxHeight to 300 for OSD logo image ([91c5fe1](https://github.com/cewert/jellyrock/commit/91c5fe1))
- resolve external SubRip subtitle display issues ([#272](https://github.com/cewert/jellyrock/pull/272))
- eliminate duplicate ItemPostPlaybackInfo calls during video load ([#271](https://github.com/cewert/jellyrock/pull/271))
- stale backdrops during video playlist playback ([#269](https://github.com/cewert/jellyrock/pull/269))
- Next Episode button positioning on first appearance ([5bcd978](https://github.com/cewert/jellyrock/commit/5bcd978))
- device profile level calculation ([#268](https://github.com/cewert/jellyrock/pull/268))
- prevent crash when using shuffle on TV Show ([9556953](https://github.com/cewert/jellyrock/commit/9556953))
- preserve dovi not working when type = episode ([ece7107](https://github.com/cewert/jellyrock/commit/ece7107))
- show Next Episode button regardless of auto-play setting ([f0e1cb5](https://github.com/cewert/jellyrock/commit/f0e1cb5))
- prevent crash when seasonData is invalid ([84ee89a](https://github.com/cewert/jellyrock/commit/84ee89a))
- Fix MovieOptions crash and implement dynamic options button ([#264](https://github.com/cewert/jellyrock/pull/264))

## [1.6.0](https://github.com/cewert/jellyrock/compare/v1.5.3...v1.6.0) - 2025-12-16

### Added

- add Resume button with progress bar to MovieDetails ([#256](https://github.com/cewert/jellyrock/pull/256))

### Dependencies

- Github actions (major) ([#261](https://github.com/cewert/jellyrock/pull/261))

## [1.5.3](https://github.com/cewert/jellyrock/compare/v1.5.2...v1.5.3) - 2025-12-15

### Changed

- full-screen components to extend JRScreen ([#255](https://github.com/cewert/jellyrock/pull/255))

### Fixed

- validate VideoType to prevent crash ([5888568](https://github.com/cewert/jellyrock/commit/5888568))
- restore focus when returning to AlbumView, PlaylistView, and TVEpisodes ([#254](https://github.com/cewert/jellyrock/pull/254))

## [1.5.2](https://github.com/cewert/jellyrock/compare/v1.5.1...v1.5.2) - 2025-12-12

### Changed

- don't save user credentials by default ([17a0cd8](https://github.com/cewert/jellyrock/commit/17a0cd8))

### Fixed

- global settings registry routing and eliminate double-writes ([#249](https://github.com/cewert/jellyrock/pull/249))

## [1.5.1](https://github.com/cewert/jellyrock/compare/v1.5.0...v1.5.1) - 2025-12-11

### Fixed

- prevent crash when using back button from user select screen ([#246](https://github.com/cewert/jellyrock/pull/246))

## [1.5.0](https://github.com/cewert/jellyrock/compare/v1.4.2...v1.5.0) - 2025-12-10

### Added

- add global splash screen setting ([#243](https://github.com/cewert/jellyrock/pull/243))
- add user setting to disable backdrop images ([#239](https://github.com/cewert/jellyrock/pull/239))
- Add backdrop fade transitions with BackdropFader component ([#235](https://github.com/cewert/jellyrock/pull/235))

### Fixed

- splash image not displaying after logout ([#242](https://github.com/cewert/jellyrock/pull/242))
- Fix splashscreen feature - Move to login screen with proper API verification ([#240](https://github.com/cewert/jellyrock/pull/240))

### Dependencies

- Update markdownlint-cli2 from v0.19.1 to v0.20.0 ([#234](https://github.com/cewert/jellyrock/pull/234))
- Github actions ([#238](https://github.com/cewert/jellyrock/pull/238))

## [1.4.2](https://github.com/cewert/jellyrock/compare/v1.4.1...v1.4.2) - 2025-12-06

### Fixed

- crash on Continue Watching when hitting OK on an episode or recording ([c500b9b](https://github.com/cewert/jellyrock/commit/c500b9b))

### Dependencies

- Update roku-deploy from v3.15.0 to v3.16.1 ([#231](https://github.com/cewert/jellyrock/pull/231))

## [1.4.1](https://github.com/cewert/jellyrock/compare/v1.4.0...v1.4.1) - 2025-12-04

### Fixed

- playback crash when UserData is invalid ([f6017c6](https://github.com/cewert/jellyrock/commit/f6017c6))
- prevent crash when media UserData is invalid ([e08a698](https://github.com/cewert/jellyrock/commit/e08a698))

### Dependencies

- Update spellchecker-cli from v7.0.1 to v7.0.2 ([#227](https://github.com/cewert/jellyrock/pull/227))

## [1.4.0](https://github.com/cewert/jellyrock/compare/v1.3.0...v1.4.0) - 2025-12-02

### Changed

- Migrate MovieDetails to IconButton with improved sizing for icon text ([#221](https://github.com/cewert/jellyrock/pull/221))
- Refactor AudioPlayerView - use IconButton components and fix image bugs ([#218](https://github.com/cewert/jellyrock/pull/218))
- Cleanup and theme the Alpha Menu ([#212](https://github.com/cewert/jellyrock/pull/212))
- remove `white_focus.9.png` 9patch image ([eda1e9d](https://github.com/cewert/jellyrock/commit/eda1e9d))

### Fixed

- lost focus bug when returning to artistview screen ([90d02ea](https://github.com/cewert/jellyrock/commit/90d02ea))
- placeholder image not showing for private users on UserSelect screen ([#223](https://github.com/cewert/jellyrock/pull/223))
- alpha menu mic alignment and color ([a6b6a23](https://github.com/cewert/jellyrock/commit/a6b6a23))
- Fix TextButton uneven padding ([#220](https://github.com/cewert/jellyrock/pull/220))
- make default user image in overhang match the one used in User Select ([51b0952](https://github.com/cewert/jellyrock/commit/51b0952))

### Removed

- redundant sidebar menu on music artist screen ([#211](https://github.com/cewert/jellyrock/pull/211))

### Dependencies

- Update softprops/action-gh-release action to v2.5.0 ([#204](https://github.com/cewert/jellyrock/pull/204))

## [1.3.0](https://github.com/cewert/jellyrock/compare/v1.2.0...v1.3.0) - 2025-11-26

### Added

- claude agent to analyze PR code reviews ([924e6c3](https://github.com/cewert/jellyrock/commit/924e6c3))

### Changed

- Refactor 9-patch images and fix library view backgrounds ([#208](https://github.com/cewert/jellyrock/pull/208))
- (ui) improve button focus borders with optimized 9-patch implementation ([#206](https://github.com/cewert/jellyrock/pull/206))
- Separate TV channel number and name in OSD display ([#202](https://github.com/cewert/jellyrock/pull/202))
- LiveTV guide view not displaying on initial load ([#199](https://github.com/cewert/jellyrock/pull/199))
- Replace custom buttons with JRButtonGroup in ProgramDetails ([#197](https://github.com/cewert/jellyrock/pull/197))
- cache m.global node references to reduce render thread overhead ([2c21862](https://github.com/cewert/jellyrock/commit/2c21862))
- Preserve DoVi in MKV containers by forcing a remux ([#193](https://github.com/cewert/jellyrock/pull/193))
- extract username sanitization into pure function ([b259c4e](https://github.com/cewert/jellyrock/commit/b259c4e))
- Enable MKV container support via manifest flag ([#195](https://github.com/cewert/jellyrock/pull/195))
- Optimize bot instruction files ([#192](https://github.com/cewert/jellyrock/pull/192))

### Fixed

- playback crash when videoContent[0] is invalid ([7d159f7](https://github.com/cewert/jellyrock/commit/7d159f7))

### Removed

- Remove hardcoded defaults from server-authoritative user settings ([#201](https://github.com/cewert/jellyrock/pull/201))

### Dependencies

- Update actions/checkout action to v6 ([#205](https://github.com/cewert/jellyrock/pull/205))
- Update markdownlint-cli2 from v0.19.0 to v0.19.1 ([#196](https://github.com/cewert/jellyrock/pull/196))
- Update rimraf from v6.1.0 to v6.1.2 ([#191](https://github.com/cewert/jellyrock/pull/191))

## [1.2.0](https://github.com/cewert/jellyrock/compare/v1.1.5...v1.2.0) - 2025-11-19

### Added

- Add `Decode Multichannel Audio` setting ([#187](https://github.com/cewert/jellyrock/pull/187))

### Changed

- Use Roku OS language as fallback for audio track selection ([#188](https://github.com/cewert/jellyrock/pull/188))

## [1.1.5](https://github.com/cewert/jellyrock/compare/v1.1.4...v1.1.5) - 2025-11-18

### Added

- Add `Play Default Audio Track` setting ([#184](https://github.com/cewert/jellyrock/pull/184))
- (docs) add comprehensive user settings implementation guide ([72694f4](https://github.com/cewert/jellyrock/commit/72694f4))

### Changed

- Improve registry migration robustness and test cleanup ([#183](https://github.com/cewert/jellyrock/pull/183))
- Preserve multichannel audio via passthrough for surround receivers ([#174](https://github.com/cewert/jellyrock/pull/174))

### Dependencies

- Update roku-deploy from v3.14.4 to v3.15.0 ([#180](https://github.com/cewert/jellyrock/pull/180))
- Github actions ([#176](https://github.com/cewert/jellyrock/pull/176))

## [1.1.4](https://github.com/cewert/jellyrock/compare/v1.1.3...v1.1.4) - 2025-11-17

### Changed

- Unify audio stream selection with hardware detection ([#169](https://github.com/cewert/jellyrock/pull/169))

### Fixed

- Fix audio/subtitle stream selection for LoadVideoContentTask ([#168](https://github.com/cewert/jellyrock/pull/168))

### Dependencies

- Update spellchecker-cli from v7.0.0 to v7.0.1 ([#170](https://github.com/cewert/jellyrock/pull/170))

## [1.1.3](https://github.com/cewert/jellyrock/compare/v1.1.2...v1.1.3) - 2025-11-14

### Changed

- revert out of scope changes from #154 ([62b82fb](https://github.com/cewert/jellyrock/commit/62b82fb))
- Move AAC profile detection to playback initialization ([#154](https://github.com/cewert/jellyrock/pull/154))

### Fixed

- Fix runtime crash when accessing `UserData` in `HomeData` ([#157](https://github.com/cewert/jellyrock/pull/157))
- Fix transcoding errors for usernames with spaces (Jellyfin 10.11.x) ([#155](https://github.com/cewert/jellyrock/pull/155))

### Dependencies

- Update markdownlint-cli2 from v0.18.1 to v0.19.0 ([#158](https://github.com/cewert/jellyrock/pull/158))

## [1.1.2](https://github.com/cewert/jellyrock/compare/v1.1.1...v1.1.2) - 2025-11-09

### Fixed

- Fix audio stream selection regression ([#151](https://github.com/cewert/jellyrock/pull/151))
- Fix duplicate video player creation on quickPlay ([#148](https://github.com/cewert/jellyrock/pull/148))

## [1.1.1](https://github.com/cewert/jellyrock/compare/v1.1.0...v1.1.1) - 2025-11-07

### Fixed

- Fix video codec UI display using getFirstVideoStream helper ([#145](https://github.com/cewert/jellyrock/pull/145))
- Fix H264/HEVC profile level override checking wrong stream type ([#143](https://github.com/cewert/jellyrock/pull/143))
- Fix MaxVideoDecodeResolution and codec checks using wrong stream ([#144](https://github.com/cewert/jellyrock/pull/144))
- Fix audio track selection: return Jellyfin stream index instead of array position ([#135](https://github.com/cewert/jellyrock/pull/135))
- Fix directPlaySupported() checking wrong stream type ([#142](https://github.com/cewert/jellyrock/pull/142))
- Fix OSD playback info showing incorrect stream data ([#136](https://github.com/cewert/jellyrock/pull/136))

## [1.1.0](https://github.com/cewert/jellyrock/compare/v1.0.4...v1.1.0) - 2025-11-03

### Added

- channel store link to readme and release notes ([b71db07](https://github.com/cewert/jellyrock/commit/b71db07))

### Changed

- preserve scopes in changelog entries and use message action words for dependencies ([195e1f6](https://github.com/cewert/jellyrock/commit/195e1f6))
- consolidate duplicate dependency entries in changelog ([a29c0b2](https://github.com/cewert/jellyrock/commit/a29c0b2))
- Set button focusBackground to colorBackgroundSecondary ([05d5cc4](https://github.com/cewert/jellyrock/commit/05d5cc4))
- Make OSD "Ends At" text bold ([54f313d](https://github.com/cewert/jellyrock/commit/54f313d))
- Auto scale user image to preserve texture memory ([#129](https://github.com/cewert/jellyrock/pull/129))
- Improve support for Direct Playing HDR videos ([#128](https://github.com/cewert/jellyrock/pull/128))
- Use `ContentNode` instead of AA for `m.global` + refactor tests ([#116](https://github.com/cewert/jellyrock/pull/116))
- Use SubtitleSelection enum instead of magic numbers ([#113](https://github.com/cewert/jellyrock/pull/113))

### Fixed

- prevent bot commits from triggering changelog-sync workflow ([4e63c32](https://github.com/cewert/jellyrock/commit/4e63c32))
- prevent fork PRs from accessing secrets in update-settings-docs workflow ([b3344ac](https://github.com/cewert/jellyrock/commit/b3344ac))
- prevent duplicate builds on PR push ([0719eed](https://github.com/cewert/jellyrock/commit/0719eed))
- workflows failing to commit changes due to branch protections ([6e05827](https://github.com/cewert/jellyrock/commit/6e05827))
- run build workflow for all PR commits ([f3b37bf](https://github.com/cewert/jellyrock/commit/f3b37bf))
- skip build-translation job for fork PRs to prevent secret exposure ([4b03b27](https://github.com/cewert/jellyrock/commit/4b03b27))

### Dependencies

- Update @rokucommunity/bslint from v0.8.35 to v0.8.38 ([#99](https://github.com/cewert/jellyrock/pull/99), [#124](https://github.com/cewert/jellyrock/pull/124))
- Update brighterscript from v0.70.1 to v0.70.3 ([#100](https://github.com/cewert/jellyrock/pull/100), [#125](https://github.com/cewert/jellyrock/pull/125))
- Update ropm from v0.11.0 to v0.11.2 ([#102](https://github.com/cewert/jellyrock/pull/102), [#127](https://github.com/cewert/jellyrock/pull/127))
- Update roku-deploy from v3.13.0 to v3.14.4 ([#121](https://github.com/cewert/jellyrock/pull/121), [#122](https://github.com/cewert/jellyrock/pull/122))
- Update rimraf from v6.0.1 to v6.1.0 ([#123](https://github.com/cewert/jellyrock/pull/123))
- Update actions/upload-artifact action to v5 ([#118](https://github.com/cewert/jellyrock/pull/118))
- Update brighterscript-formatter from v1.7.18 to v1.7.19 ([#101](https://github.com/cewert/jellyrock/pull/101))
- Update peter-evans/repository-dispatch action to v4 ([#98](https://github.com/cewert/jellyrock/pull/98))
- Github actions (major) ([#109](https://github.com/cewert/jellyrock/pull/109))
- Pin dependencies ([#108](https://github.com/cewert/jellyrock/pull/108))
- Github actions ([#97](https://github.com/cewert/jellyrock/pull/97))

## [1.0.4](https://github.com/cewert/jellyrock/compare/v1.0.3...v1.0.4) - 2025-10-06

### Added

- proper linting for unit tests ([#94](https://github.com/cewert/jellyrock/pull/94))

### Changed

- device profile to improve support for HDR10Plus and DOVIWithHDR10Plus ([ca25905](https://github.com/cewert/jellyrock/commit/ca25905))

### Fixed

- unit tests by making rooibos use latest version of brighterscript ([8c69a25](https://github.com/cewert/jellyrock/commit/8c69a25))
- app crash on MovieDetails ([#93](https://github.com/cewert/jellyrock/pull/93))
- app crash when `CreateInstantMix` returns invalid ([#90](https://github.com/cewert/jellyrock/pull/90))

### Removed

- bslint warnings for array and assocarray fields ([3da1107](https://github.com/cewert/jellyrock/commit/3da1107))

### Dependencies

- actions/cache action to v4.3.0 ([#91](https://github.com/cewert/jellyrock/pull/91))

## [1.0.3](https://github.com/cewert/jellyrock/compare/v1.0.2...v1.0.3) - 2025-09-16

### Added

- claude subagent to enforce roku-log best practices and use it to refactor Home.bs ([3dd2088](https://github.com/cewert/jellyrock/commit/3dd2088))
- docs/dev/logging.md ([efab961](https://github.com/cewert/jellyrock/commit/efab961))
- debug flag to manifest ([ce1fb28](https://github.com/cewert/jellyrock/commit/ce1fb28))
- dynamic gradient component ([#80](https://github.com/cewert/jellyrock/pull/80))
- npm script to validate translation files + convert CI to use script ([ae344c2](https://github.com/cewert/jellyrock/commit/ae344c2))
- developer mode doc and link to it on readme ([df60ff9](https://github.com/cewert/jellyrock/commit/df60ff9))

### Changed

- bot instructions ([62dbe04](https://github.com/cewert/jellyrock/commit/62dbe04))
- Stop using invalid poster image uris ([#78](https://github.com/cewert/jellyrock/pull/78))
- llm agent instructions, create CLAUDE.md, format as instructions ([1fe8568](https://github.com/cewert/jellyrock/commit/1fe8568))
- d: lint all translation files not just english ([470991f](https://github.com/cewert/jellyrock/commit/470991f))

### Fixed

- ropm copy error ([a31d18e](https://github.com/cewert/jellyrock/commit/a31d18e))
- exclude release-prep PRs from changelog. Fixes #68 ([98a3fcb](https://github.com/cewert/jellyrock/commit/98a3fcb))

### Removed

- redundant component fields ([23d12d3](https://github.com/cewert/jellyrock/commit/23d12d3))

### Security

- renovate config and github actions. All actions pinned to immutable commit hashes for security. Unified @<hash> # v<version> format across all workflows for consistency. Renovate will handle future updates with Monday morning grouped PRs ([1457818](https://github.com/cewert/jellyrock/commit/1457818))

### Dependencies

- dependency @rokucommunity/bslint to v0.8.35 ([#84](https://github.com/cewert/jellyrock/pull/84))
- dependency brighterscript-formatter to v1.7.18 ([#85](https://github.com/cewert/jellyrock/pull/85))
- dependency brighterscript to v0.70.1 ([#83](https://github.com/cewert/jellyrock/pull/83))
- softprops/action-gh-release action to v2.3.3 ([#81](https://github.com/cewert/jellyrock/pull/81))
- github actions (major) ([#82](https://github.com/cewert/jellyrock/pull/82))

## [1.0.2](https://github.com/cewert/jellyrock/compare/v1.0.1...v1.0.2) - 2025-09-02

### Changed

- `Custom Subtitles` setting description ([b198483](https://github.com/cewert/jellyrock/commit/b198483))

### Fixed

- CI race conditions ([d38a8ac](https://github.com/cewert/jellyrock/commit/d38a8ac))
- custom subtitle crash while watching video ([#65](https://github.com/cewert/jellyrock/pull/65))
- validate json string before parsing ([aca6f3c](https://github.com/cewert/jellyrock/commit/aca6f3c))
- log sync logic after a new release ([7638085](https://github.com/cewert/jellyrock/commit/7638085))

## [1.0.1](https://github.com/cewert/jellyrock/compare/v1.0.0...v1.0.1) - 2025-08-30

### Added

- use workflow to sync changelog file ([c1479da](https://github.com/cewert/jellyrock/commit/c1479da))
- changelog with all v1 commits and PRs ([9cfdc42](https://github.com/cewert/jellyrock/commit/9cfdc42))
- use CI to auto-update generated app-settings.md doc ([a0773b5](https://github.com/cewert/jellyrock/commit/a0773b5))
- settings docs generator ([eb634c1](https://github.com/cewert/jellyrock/commit/eb634c1))

### Changed

- Prepare for v1.0.1 release ([#62](https://github.com/cewert/jellyrock/pull/62))
- changelog with new parsing logic ([4cf5052](https://github.com/cewert/jellyrock/commit/4cf5052))
- changelog commit parser logic and release draft body ([03b3e7b](https://github.com/cewert/jellyrock/commit/03b3e7b))
- release prep pr body ([5ab8cdb](https://github.com/cewert/jellyrock/commit/5ab8cdb))
- lint:json to exclude scripts folder ([59877af](https://github.com/cewert/jellyrock/commit/59877af))
- enable manual trigger to fix doc ([f671435](https://github.com/cewert/jellyrock/commit/f671435))
- link to user app settings ([b4b8058](https://github.com/cewert/jellyrock/commit/b4b8058))
- sort scripts ([4d33d02](https://github.com/cewert/jellyrock/commit/4d33d02))
- use colons instead of dashes ([8e149da](https://github.com/cewert/jellyrock/commit/8e149da))
- recommended extensions ([df1350c](https://github.com/cewert/jellyrock/commit/df1350c))

### Fixed

- correct release notes extraction in automated release notes ([0cbb98c](https://github.com/cewert/jellyrock/commit/0cbb98c))
- automated release workflow - proper changelog extraction and compare URLs ([1d61f4a](https://github.com/cewert/jellyrock/commit/1d61f4a))
- CI authentication for PR label detection in changelog syncer ([67d285e](https://github.com/cewert/jellyrock/commit/67d285e))
- automated release body ([868113c](https://github.com/cewert/jellyrock/commit/868113c))
- release prep triggering twice on branch creation ([9788ad7](https://github.com/cewert/jellyrock/commit/9788ad7))
- filepath trigger ([77e3f2e](https://github.com/cewert/jellyrock/commit/77e3f2e))
- `ui.row.layout` affects all rows ([a217a08](https://github.com/cewert/jellyrock/commit/a217a08))
- prevent translation commits from triggering translation workflow ([d7cc939](https://github.com/cewert/jellyrock/commit/d7cc939))
- prevent hardcoded fallback font text from being translatied ([dc80d78](https://github.com/cewert/jellyrock/commit/dc80d78))
- no longer using bugfix branch ([620cb30](https://github.com/cewert/jellyrock/commit/620cb30))
- spinner color from secondary -> text_secondary ([74bec4f](https://github.com/cewert/jellyrock/commit/74bec4f))
- spelling linter ([270920b](https://github.com/cewert/jellyrock/commit/270920b))
- overhang warnings in log at app start `Could not find node "overhang" to update the interpolator field on` ([6695a5f](https://github.com/cewert/jellyrock/commit/6695a5f))

### Removed

- project automation ([ec1d760](https://github.com/cewert/jellyrock/commit/ec1d760))

### Dependencies

- stefanzweifel/git-auto-commit-action action to v6 ([#42](https://github.com/cewert/jellyrock/pull/42))
- dependency ropm to v0.11.0 ([#40](https://github.com/cewert/jellyrock/pull/40))

## [1.0.0](https://github.com/cewert/jellyrock/commits/main/?since=2025-06-28&until=2025-08-24) - 2025-08-24

### Added

- fork info and clean up build comments ([3cca8a4](https://github.com/cewert/jellyrock/commit/3cca8a4))
- privacy policy and terms of use ([b1e3e2c](https://github.com/cewert/jellyrock/commit/b1e3e2c))
- debug: add debug output for GitHub release condition ([d68eec6](https://github.com/cewert/jellyrock/commit/d68eec6))
- brighterscript-xml-plugin to dev build config <https://github.com/slheavner/brighterscript-xml-plugin> ([355a406](https://github.com/cewert/jellyrock/commit/355a406))
- build instructions ([b66696a](https://github.com/cewert/jellyrock/commit/b66696a))
- support for live tv to OSD ([e5de6b9](https://github.com/cewert/jellyrock/commit/e5de6b9))
- screenshots to readme ([1ab719c](https://github.com/cewert/jellyrock/commit/1ab719c))
- more validation and debugging to post task ([8e3264c](https://github.com/cewert/jellyrock/commit/8e3264c))
- default overhang image and ensure to remove cached user image during logut ([9208091](https://github.com/cewert/jellyrock/commit/9208091))
- themed TextButton and use it to theme the server and user select pages ([e44e112](https://github.com/cewert/jellyrock/commit/e44e112))
- profile pic to overhang ([8c748fc](https://github.com/cewert/jellyrock/commit/8c748fc))
- backdropText to My Media row until image loads ([df4e153](https://github.com/cewert/jellyrock/commit/df4e153))
- all missing themed label variants ([#24](https://github.com/cewert/jellyrock/pull/24))
- auto rebase stale prs and auto create roll back prs ([045e928](https://github.com/cewert/jellyrock/commit/045e928))
- copilot setup steps workflow. the bot was wasting tokens figuring out and doing these steps on it's own ([dc4bda1](https://github.com/cewert/jellyrock/commit/dc4bda1))
- copilot instructions ([9727fa1](https://github.com/cewert/jellyrock/commit/9727fa1))
- basic text svg logos ([6513a80](https://github.com/cewert/jellyrock/commit/6513a80))
- and implement new color palette and font sizes saved to global. create JFPoster to render progressbar and watchbadge. create extendable components based on global theme and font sizes. Give iconbutton a focus border and add to OSD. Update readability of OSD and overall UX. Remove Voicebox cover from itemgrid ([6e7da39](https://github.com/cewert/jellyrock/commit/6e7da39))
- comment ([0d7d676](https://github.com/cewert/jellyrock/commit/0d7d676))
- and use js script to sync all translation files with en_US (fix them and start fresh) ([7dde85e](https://github.com/cewert/jellyrock/commit/7dde85e))
- comments to help troubleshoot problems with 4k ([31054fb](https://github.com/cewert/jellyrock/commit/31054fb))
- renovate.json ([168041b](https://github.com/cewert/jellyrock/commit/168041b))
- `Date Show Added` sort option. Make option list match web client ([8d05cae](https://github.com/cewert/jellyrock/commit/8d05cae))
- workflow to validate dependency bump PRs  don't break anything ([de3b00e](https://github.com/cewert/jellyrock/commit/de3b00e))
- live TV series title, season number, and episode number to OSD, when available ([8763f0c](https://github.com/cewert/jellyrock/commit/8763f0c))
- a user setting to allow users to disable the new look ([5659a9c](https://github.com/cewert/jellyrock/commit/5659a9c))
- localization for channel abbreviation string ([110f82a](https://github.com/cewert/jellyrock/commit/110f82a))
- channel number to Live TV channel title ([229f7b9](https://github.com/cewert/jellyrock/commit/229f7b9))

### Changed

- use task to download fallback font + don't stop loading home page when user only has custom subs enabled ([30154f1](https://github.com/cewert/jellyrock/commit/30154f1))
- unused ([9f8cc92](https://github.com/cewert/jellyrock/commit/9f8cc92))
- release prep ([dd2f5e4](https://github.com/cewert/jellyrock/commit/dd2f5e4))
- only reposition backdrop text when iconImage finished loading ([b375e22](https://github.com/cewert/jellyrock/commit/b375e22))
- tweak build config and vscode debugger behavior ([1bd4024](https://github.com/cewert/jellyrock/commit/1bd4024))
- theme spinner ([1e28130](https://github.com/cewert/jellyrock/commit/1e28130))
- more theming on server select ([8fb7079](https://github.com/cewert/jellyrock/commit/8fb7079))
- theme tv guide screen and use fallback fonts as needed ([cb0e706](https://github.com/cewert/jellyrock/commit/cb0e706))
- unused ([f1597da](https://github.com/cewert/jellyrock/commit/f1597da))
- reposition itemIcon and backgroundText when both are present ([5ea5196](https://github.com/cewert/jellyrock/commit/5ea5196))
- github actions links ([f2f8257](https://github.com/cewert/jellyrock/commit/f2f8257))
- release branch vrom v1.0.0 to release-1.0.0 ([9910a9c](https://github.com/cewert/jellyrock/commit/9910a9c))
- don't delete release notes when updating release ([0fec22f](https://github.com/cewert/jellyrock/commit/0fec22f))
- rebase before commiting ([0f4693a](https://github.com/cewert/jellyrock/commit/0f4693a))
- don't try to cache gradle ([1b78e07](https://github.com/cewert/jellyrock/commit/1b78e07))
- workflows ([#35](https://github.com/cewert/jellyrock/pull/35))
- author ([3e31244](https://github.com/cewert/jellyrock/commit/3e31244))
- run static analysis on release branches ([67f8d65](https://github.com/cewert/jellyrock/commit/67f8d65))
- use jellyrock-bot token ([f3483ab](https://github.com/cewert/jellyrock/commit/f3483ab))
- make folder for buttongroups ([3170168](https://github.com/cewert/jellyrock/commit/3170168))
- VideoData has no image field ([5dd9264](https://github.com/cewert/jellyrock/commit/5dd9264))
- align next episode button to bottom right edge ([745db9e](https://github.com/cewert/jellyrock/commit/745db9e))
- hide osd when pressing rewind/ff ([7018fef](https://github.com/cewert/jellyrock/commit/7018fef))
- resize to allow two screenshots per row ([f7abf03](https://github.com/cewert/jellyrock/commit/f7abf03))
- resize screenshots ([8398270](https://github.com/cewert/jellyrock/commit/8398270))
- convert to content node ([d2a82c6](https://github.com/cewert/jellyrock/commit/d2a82c6))
- better align genre view ([e0e32cf](https://github.com/cewert/jellyrock/commit/e0e32cf))
- theme remaining buttons ([#33](https://github.com/cewert/jellyrock/pull/33))
- stop wasting tokens running both lint-bs and validate ([58c6c74](https://github.com/cewert/jellyrock/commit/58c6c74))
- _validate-dependencies.yml ([3221ab9](https://github.com/cewert/jellyrock/commit/3221ab9))
- copilot-instructions.md ([62c939b](https://github.com/cewert/jellyrock/commit/62c939b))
- cache user image poster ([cf0a9a3](https://github.com/cewert/jellyrock/commit/cf0a9a3))
- vscode settings ([0e3adf4](https://github.com/cewert/jellyrock/commit/0e3adf4))
- theme griditemsmall ([914523c](https://github.com/cewert/jellyrock/commit/914523c))
- resources folder not needed to build app ([b054852](https://github.com/cewert/jellyrock/commit/b054852))
- don't show colon until we show the time ([acbd672](https://github.com/cewert/jellyrock/commit/acbd672))
- clean up OSD ([38287d4](https://github.com/cewert/jellyrock/commit/38287d4))
- theme last rowlist. theme search page ([c89b611](https://github.com/cewert/jellyrock/commit/c89b611))
- theme postergrid ([7537652](https://github.com/cewert/jellyrock/commit/7537652))
- theme remaining markupgrid's except itemgrid which needs a refactor ([1e69536](https://github.com/cewert/jellyrock/commit/1e69536))
- theme remaining RowList components ([05f683f](https://github.com/cewert/jellyrock/commit/05f683f))
- disable migrations until needed. remove old jellyfin-roku migration code but leave functions as is ([1376c20](https://github.com/cewert/jellyrock/commit/1376c20))
- complete Label and ScrollingLabel themed refactoring with comprehensive color mapping and syntax fixes ([#13](https://github.com/cewert/jellyrock/pull/13))
- configure Renovate ([#19](https://github.com/cewert/jellyrock/pull/19))
- trigger renovate onboarding PR ([e06afd3](https://github.com/cewert/jellyrock/commit/e06afd3))
- lint all json files ([2d084f5](https://github.com/cewert/jellyrock/commit/2d084f5))
- alert jellyrock-code-docs repo whenever bright(er)script code has been updated ([7a2f35a](https://github.com/cewert/jellyrock/commit/7a2f35a))
- npm audit fix ([f227192](https://github.com/cewert/jellyrock/commit/f227192))
- finish removing api/code docs from repo. remove deps, scripts, and workflows ([916943a](https://github.com/cewert/jellyrock/commit/916943a))
- try default ([c821988](https://github.com/cewert/jellyrock/commit/c821988))
- "Bad credentials" using GH_TOKEN ([e74c2dc](https://github.com/cewert/jellyrock/commit/e74c2dc))
- use jellyrock-bot pat token for copilot agent ([a80466c](https://github.com/cewert/jellyrock/commit/a80466c))
- permissions for Copilot setup to allow issue and pull request access ([976957d](https://github.com/cewert/jellyrock/commit/976957d))
- theme the trickPlayBar ([d91da5e](https://github.com/cewert/jellyrock/commit/d91da5e))
- readability of home page ([457ba81](https://github.com/cewert/jellyrock/commit/457ba81))
- increase rowItemSpacing ([1cc14d5](https://github.com/cewert/jellyrock/commit/1cc14d5))
- reorder home settings dialog ([8c2ccd3](https://github.com/cewert/jellyrock/commit/8c2ccd3))
- translate a couple more strings ([b7c6072](https://github.com/cewert/jellyrock/commit/b7c6072))
- pin versions for renovate and remove redundant ropm command ([f6451db](https://github.com/cewert/jellyrock/commit/f6451db))
- use bot for doc commits ([4bed5b7](https://github.com/cewert/jellyrock/commit/4bed5b7))
- bot token name ([cadf64e](https://github.com/cewert/jellyrock/commit/cadf64e))
- restore gitignore ([1a50f63](https://github.com/cewert/jellyrock/commit/1a50f63))
- need to remove code-docs folder ([96d6fc5](https://github.com/cewert/jellyrock/commit/96d6fc5))
- no longer needed ([fdbc526](https://github.com/cewert/jellyrock/commit/fdbc526))
- deploying to main from @ cewert/jellyrock@306d5c5e4636f2c9066c86cced15403f5d734f5b 🚀 ([ce603d5](https://github.com/cewert/jellyrock/commit/ce603d5))
- move api/code docs to their own repo ([d053f31](https://github.com/cewert/jellyrock/commit/d053f31))
- don't use logo with secondary text color ([dc27847](https://github.com/cewert/jellyrock/commit/dc27847))
- makefile to delete images before generating. duplicate SVG logos and set text color to text secondary. update makefile to use these SVGs for the in-app logo.png's ([2ddbd1e](https://github.com/cewert/jellyrock/commit/2ddbd1e))
- npm audit fix ([7829aef](https://github.com/cewert/jellyrock/commit/7829aef))
- missed one ([ed089f5](https://github.com/cewert/jellyrock/commit/ed089f5))
- put code in backticks and update spelling of links ([fa9310c](https://github.com/cewert/jellyrock/commit/fa9310c))
- don't try to run unit tests and use isValid() ([ecb69bd](https://github.com/cewert/jellyrock/commit/ecb69bd))
- force use of isValid() function throughout entire codebase ([#8](https://github.com/cewert/jellyrock/pull/8))
- makefile to create dev and prod images. update logo demensions ([b737233](https://github.com/cewert/jellyrock/commit/b737233))
- use logo for readme header ([5d0d4bb](https://github.com/cewert/jellyrock/commit/5d0d4bb))
- overhang logo size so the new logo doesn't stretch ([2527294](https://github.com/cewert/jellyrock/commit/2527294))
- makefile get_images and use it to update app images ([2efaa73](https://github.com/cewert/jellyrock/commit/2efaa73))
- merge branch 'main' of <https://github.com/cewert/jellyrock> ([5dc96f6](https://github.com/cewert/jellyrock/commit/5dc96f6))
- stop showing 'mic icon Search' in the overhang. now only showing mic icon above alpha menu ([64cb58c](https://github.com/cewert/jellyrock/commit/64cb58c))
- stop showing "* options" text in overhang ([ddf7b07](https://github.com/cewert/jellyrock/commit/ddf7b07))
- extras slider bg ([7688f96](https://github.com/cewert/jellyrock/commit/7688f96))
- apply new theme colors to all StandardDialogs ([1ce5242](https://github.com/cewert/jellyrock/commit/1ce5242))
- stop running roku static analysis so much ([86bc6da](https://github.com/cewert/jellyrock/commit/86bc6da))
- tweak home row titles ([675bc76](https://github.com/cewert/jellyrock/commit/675bc76))
- move osd stream info button  to far right of screen ([535b85f](https://github.com/cewert/jellyrock/commit/535b85f))
- bot username ([87d994e](https://github.com/cewert/jellyrock/commit/87d994e))
- version ([1be6caa](https://github.com/cewert/jellyrock/commit/1be6caa))
- jellyfin -> jellyrock ([afb054a](https://github.com/cewert/jellyrock/commit/afb054a))
- git pull before building docs ([a68bda7](https://github.com/cewert/jellyrock/commit/a68bda7))
- rename registry vars and update more refs to jellyfin ([0db8767](https://github.com/cewert/jellyrock/commit/0db8767))
- rename components from JF*to JR* ([b609793](https://github.com/cewert/jellyrock/commit/b609793))
- rename unit tests folder ([1d4d88d](https://github.com/cewert/jellyrock/commit/1d4d88d))
- only disable previous/play/next and remove all other unneeded buttons from osd ([b45ec2b](https://github.com/cewert/jellyrock/commit/b45ec2b))
- no bs in xml ([0d8713f](https://github.com/cewert/jellyrock/commit/0d8713f))
- merge branch 'main' of <https://github.com/cewert/jellyrock> ([71a4097](https://github.com/cewert/jellyrock/commit/71a4097))
- merge branch 'main' of <https://github.com/cewert/jellyrock> ([f142546](https://github.com/cewert/jellyrock/commit/f142546))
- prevent race conditions ([4c77bf6](https://github.com/cewert/jellyrock/commit/4c77bf6))
- merge branch 'main' of <https://github.com/cewert/jellyrock> ([31820f5](https://github.com/cewert/jellyrock/commit/31820f5))
- move all auto commit jobs to the same workflow ([3ed1ee6](https://github.com/cewert/jellyrock/commit/3ed1ee6))
- no longer needed ([cc6b8c8](https://github.com/cewert/jellyrock/commit/cc6b8c8))
- merge branch 'main' of <https://github.com/cewert/jellyrock> ([77e8631](https://github.com/cewert/jellyrock/commit/77e8631))
- readme ([d4a6123](https://github.com/cewert/jellyrock/commit/d4a6123))
- bugfix ([0e0a9af](https://github.com/cewert/jellyrock/commit/0e0a9af))
- using main branch instead of master ([d76f79e](https://github.com/cewert/jellyrock/commit/d76f79e))
- translation file ([440342c](https://github.com/cewert/jellyrock/commit/440342c))
- fill in icons ([67a0bde](https://github.com/cewert/jellyrock/commit/67a0bde))
- npm audit fix ([2d171a6](https://github.com/cewert/jellyrock/commit/2d171a6))
- search br(s), xml, and settings.json for translation strings and remove unused strings from file. small refactor to prevent current translations from being lost ([008c2c3](https://github.com/cewert/jellyrock/commit/008c2c3))
- tidy up ([f85b684](https://github.com/cewert/jellyrock/commit/f85b684))
- clean up old workflows ([a7133c2](https://github.com/cewert/jellyrock/commit/a7133c2))
- use CI to auto update translation file ([7227a3a](https://github.com/cewert/jellyrock/commit/7227a3a))
- automatically create en_US translation file ([96d38ca](https://github.com/cewert/jellyrock/commit/96d38ca))
- stop using comment tag ([bb7e4f4](https://github.com/cewert/jellyrock/commit/bb7e4f4))
- further limit vscode search results ([efcb142](https://github.com/cewert/jellyrock/commit/efcb142))
- fill in play and pause icons ([81c8ebd](https://github.com/cewert/jellyrock/commit/81c8ebd))
- always toggle spinner ([629c545](https://github.com/cewert/jellyrock/commit/629c545))
- loading spinner logic and fix bug where spinner wasn't being removed on the home page ([27bb68d](https://github.com/cewert/jellyrock/commit/27bb68d))
- no regex duplicates ([788f263](https://github.com/cewert/jellyrock/commit/788f263))
- force project to use 2 spaces for tabs. update all files to match ([b8ef5f3](https://github.com/cewert/jellyrock/commit/b8ef5f3))
- use a string for osd metadata ([d95a4af](https://github.com/cewert/jellyrock/commit/d95a4af))
- osd title/subtitle spacing. remove debugging ([88cc776](https://github.com/cewert/jellyrock/commit/88cc776))
- UX of OSD. Use google icons. Organized osd and icon images into folders. Fix bug in defaultvideo logic ([f05084d](https://github.com/cewert/jellyrock/commit/f05084d))
- pause leaves osd open until resume or back ([00161f4](https://github.com/cewert/jellyrock/commit/00161f4))
- image to match new background ([65e393e](https://github.com/cewert/jellyrock/commit/65e393e))
- stop using a dialog to disable remote. no more dimmed gray overlay ([a8cf099](https://github.com/cewert/jellyrock/commit/a8cf099))
- revert "move invisible dialog to the top of the stack. this removes the light gray overlay" ([e0b0449](https://github.com/cewert/jellyrock/commit/e0b0449))
- increase clock size ([c2418c4](https://github.com/cewert/jellyrock/commit/c2418c4))
- revert "Make view all buttom smart" ([d1dcec9](https://github.com/cewert/jellyrock/commit/d1dcec9))
- move invisible dialog to the top of the stack. this removes the light gray overlay ([f957fba](https://github.com/cewert/jellyrock/commit/f957fba))
- hide video title until osd is ready ([a861f52](https://github.com/cewert/jellyrock/commit/a861f52))
- show a third row on home screen ([cd65865](https://github.com/cewert/jellyrock/commit/cd65865))
- stop showing meridian in overhang and OSD ([17e4071](https://github.com/cewert/jellyrock/commit/17e4071))
- splashBackground as needed ([cb08bd2](https://github.com/cewert/jellyrock/commit/cb08bd2))
- try to recover from multiple video players ([8b18349](https://github.com/cewert/jellyrock/commit/8b18349))
- some default settings ([d262d32](https://github.com/cewert/jellyrock/commit/d262d32))
- set background color to black ([7642bac](https://github.com/cewert/jellyrock/commit/7642bac))
- default audio track selection for movie details page and quick played videos ([897c5e0](https://github.com/cewert/jellyrock/commit/897c5e0))
- vp9 doesn't support dovi ([302a899](https://github.com/cewert/jellyrock/commit/302a899))
- bump-version.yml ([000668e](https://github.com/cewert/jellyrock/commit/000668e))
- disable dependency dashboard ([439a9c1](https://github.com/cewert/jellyrock/commit/439a9c1))
- migrate config renovate.json ([b672216](https://github.com/cewert/jellyrock/commit/b672216))
- renovate.json ([1f7cf66](https://github.com/cewert/jellyrock/commit/1f7cf66))
- renovate init ([68c36fb](https://github.com/cewert/jellyrock/commit/68c36fb))
- bot token ([a3422ec](https://github.com/cewert/jellyrock/commit/a3422ec))
- use cewert-bot instead of jellyfin-bot for automations ([2499bf6](https://github.com/cewert/jellyrock/commit/2499bf6))
- workflows to run as they did on the main repo ([92b78e9](https://github.com/cewert/jellyrock/commit/92b78e9))
- _build-prod.yml ([faeb8da](https://github.com/cewert/jellyrock/commit/faeb8da))
- DEVGUIDE.md ([6ee3a66](https://github.com/cewert/jellyrock/commit/6ee3a66))
- make sure all jobs run for a dependency PR and clean things up ([bee35c5](https://github.com/cewert/jellyrock/commit/bee35c5))
- show User Icon for SavedUsers as well ([4c32db0](https://github.com/cewert/jellyrock/commit/4c32db0))
- use the same movie sorting options as web ([0776889](https://github.com/cewert/jellyrock/commit/0776889))
- dependecy workflow so we only have 1 skipped check instead of 8 ([8cf6ad4](https://github.com/cewert/jellyrock/commit/8cf6ad4))
- move everything under the workflows dir ([8d8950a](https://github.com/cewert/jellyrock/commit/8d8950a))
- make workflows reuseable ([0be5604](https://github.com/cewert/jellyrock/commit/0be5604))
- npm audit fix ([687cad5](https://github.com/cewert/jellyrock/commit/687cad5))
- allow Intro Videos to be able to be skipped or paused ([424b12c](https://github.com/cewert/jellyrock/commit/424b12c))
- make settings menu wrap ([d9562a3](https://github.com/cewert/jellyrock/commit/d9562a3))
- alphabetize all user settings ([ce9ef20](https://github.com/cewert/jellyrock/commit/ce9ef20))
- home row layout on refresh so we don't need to restart the app after updating setting ([6ded730](https://github.com/cewert/jellyrock/commit/6ded730))
- rename user setting ([26425d4](https://github.com/cewert/jellyrock/commit/26425d4))
- make more robust with validation function and string template ([848c15a](https://github.com/cewert/jellyrock/commit/848c15a))
- increase spacing between row items ([ccbd4d4](https://github.com/cewert/jellyrock/commit/ccbd4d4))
- expand home rows to take up full width of the screen ([3fed93c](https://github.com/cewert/jellyrock/commit/3fed93c))

### Fixed

- dissapearing icons ([554afcd](https://github.com/cewert/jellyrock/commit/554afcd))
- my media backdrop text positioning ([2e8a7c3](https://github.com/cewert/jellyrock/commit/2e8a7c3))
- build artifact names when triggered by PR ([ea683cf](https://github.com/cewert/jellyrock/commit/ea683cf))
- pr body formatting ([4192e42](https://github.com/cewert/jellyrock/commit/4192e42))
- release-prep pr creation ([3369830](https://github.com/cewert/jellyrock/commit/3369830))
- overhang user image caching logic ([f0c6f40](https://github.com/cewert/jellyrock/commit/f0c6f40))
- build artifact naming conflicts ([e34f4f1](https://github.com/cewert/jellyrock/commit/e34f4f1))
- gh release ([d6f8344](https://github.com/cewert/jellyrock/commit/d6f8344))
- static analysis trigger ([d0cb6a4](https://github.com/cewert/jellyrock/commit/d0cb6a4))
- image size warning in static analysis ([6d900d8](https://github.com/cewert/jellyrock/commit/6d900d8))
- false warning ([9e38ad0](https://github.com/cewert/jellyrock/commit/9e38ad0))
- TextButton focusBackground ([df6c70e](https://github.com/cewert/jellyrock/commit/df6c70e))
- sporadic login crash and add more validation to fallback fonts ([b7df2d3](https://github.com/cewert/jellyrock/commit/b7df2d3))
- trickbar thumb color ([20f4530](https://github.com/cewert/jellyrock/commit/20f4530))
- max resolution logic ([fd6ed36](https://github.com/cewert/jellyrock/commit/fd6ed36))
- hide clock logic ([d89fbea](https://github.com/cewert/jellyrock/commit/d89fbea))
- image params ([ee7c363](https://github.com/cewert/jellyrock/commit/ee7c363))
- spelling linter and disable markdown linter on copilot files ([9a6cb5b](https://github.com/cewert/jellyrock/commit/9a6cb5b))
- hideclock user setting ([f6cb256](https://github.com/cewert/jellyrock/commit/f6cb256))
- app crash when using 24h clock ([63cfc6f](https://github.com/cewert/jellyrock/commit/63cfc6f))
- overhang alignment ([d99a96a](https://github.com/cewert/jellyrock/commit/d99a96a))
- "..." unwatched bug on griditemsmall ([09e152b](https://github.com/cewert/jellyrock/commit/09e152b))
- artist detail buttons ([5080f74](https://github.com/cewert/jellyrock/commit/5080f74))
- type ([a3ca6b6](https://github.com/cewert/jellyrock/commit/a3ca6b6))
- attempt to fix copilot agent ([584521e](https://github.com/cewert/jellyrock/commit/584521e))
- copilot agent auth token ([bba3aa8](https://github.com/cewert/jellyrock/commit/bba3aa8))
- "..." unplayedvideo count bug. caused by boundingRect() ([f498c8d](https://github.com/cewert/jellyrock/commit/f498c8d))
- header "logo" link ([a69fcce](https://github.com/cewert/jellyrock/commit/a69fcce))
- loading spinner bug. only hide active group if remote is disabled ([97cfd91](https://github.com/cewert/jellyrock/commit/97cfd91))
- code-docs link ([5fb3f8f](https://github.com/cewert/jellyrock/commit/5fb3f8f))
- code-docs pages deployment ([9defe0b](https://github.com/cewert/jellyrock/commit/9defe0b))
- invalid param name ([59711d3](https://github.com/cewert/jellyrock/commit/59711d3))
- markdown linter ([c111069](https://github.com/cewert/jellyrock/commit/c111069))
- spelling linter ([c704110](https://github.com/cewert/jellyrock/commit/c704110))
- linting errors ([811baa4](https://github.com/cewert/jellyrock/commit/811baa4))
- build-docs error ([cc5e561](https://github.com/cewert/jellyrock/commit/cc5e561))
- formatting ([d80a1ff](https://github.com/cewert/jellyrock/commit/d80a1ff))
- client name in server dashboard ([5679826](https://github.com/cewert/jellyrock/commit/5679826))
- prod build file name ([552cb70](https://github.com/cewert/jellyrock/commit/552cb70))
- workflows and rename a few things ([96ca702](https://github.com/cewert/jellyrock/commit/96ca702))
- syntax error ([6f3a586](https://github.com/cewert/jellyrock/commit/6f3a586))
- bugs with translation script and update to be case sensitive. alphebetize translations strings ([a670608](https://github.com/cewert/jellyrock/commit/a670608))
- translations ([b5c4d90](https://github.com/cewert/jellyrock/commit/b5c4d90))
- formatting ([ef7e2d2](https://github.com/cewert/jellyrock/commit/ef7e2d2))
- formatting ([753f27a](https://github.com/cewert/jellyrock/commit/753f27a))
- bad merge ([63abf7e](https://github.com/cewert/jellyrock/commit/63abf7e))

### Removed

- colon from episode text ([a8fb9c3](https://github.com/cewert/jellyrock/commit/a8fb9c3))
- debugging ([4ab18ed](https://github.com/cewert/jellyrock/commit/4ab18ed))
- release and recreate to preserve auto gen changelog ([96d6e4e](https://github.com/cewert/jellyrock/commit/96d6e4e))
- all themed labelbadge components. looked the same as system font in my testing ([16e0921](https://github.com/cewert/jellyrock/commit/16e0921))
- unused code ([fda5b98](https://github.com/cewert/jellyrock/commit/fda5b98))
- overhang user image as needed ([b1bf369](https://github.com/cewert/jellyrock/commit/b1bf369))
- redundant timer. observe clock field instead ([5c1086b](https://github.com/cewert/jellyrock/commit/5c1086b))
- unused home settings option ([0a9b80c](https://github.com/cewert/jellyrock/commit/0a9b80c))
- unused code ([0f1b61a](https://github.com/cewert/jellyrock/commit/0f1b61a))
- debugging ([cda41bd](https://github.com/cewert/jellyrock/commit/cda41bd))
- unused functions ([#22](https://github.com/cewert/jellyrock/pull/22))
- code-docs leftover ([b65406b](https://github.com/cewert/jellyrock/commit/b65406b))
- api docs ([c992620](https://github.com/cewert/jellyrock/commit/c992620))
- api/code docs ([c5c55a2](https://github.com/cewert/jellyrock/commit/c5c55a2))
- api docs ([306d5c5](https://github.com/cewert/jellyrock/commit/306d5c5))
- redundant ropm calls. these are handled by the postinstall script ([34d597c](https://github.com/cewert/jellyrock/commit/34d597c))
- beta branding images ([fb89cef](https://github.com/cewert/jellyrock/commit/fb89cef))
- text area from my media home row ([b171114](https://github.com/cewert/jellyrock/commit/b171114))
- meridian from movie/tv ends at text. add ends at text to OSD and update it every 60sec ([2be43ae](https://github.com/cewert/jellyrock/commit/2be43ae))
- menu, remove jf images info, and remove all settings instructions ([4efdd4d](https://github.com/cewert/jellyrock/commit/4efdd4d))
- hevc user setting ([1c51b49](https://github.com/cewert/jellyrock/commit/1c51b49))
- link ([925ab28](https://github.com/cewert/jellyrock/commit/925ab28))
- random blue item bg. clean up global constants and icons. only use snake case for constants. ([75c255c](https://github.com/cewert/jellyrock/commit/75c255c))
- whats new popup ([ba9777d](https://github.com/cewert/jellyrock/commit/ba9777d))
- unused file ([d94ce60](https://github.com/cewert/jellyrock/commit/d94ce60))
- unneeded api call on render thread ([fbae4f6](https://github.com/cewert/jellyrock/commit/fbae4f6))
- redundant "Loading..." text ([9faac6d](https://github.com/cewert/jellyrock/commit/9faac6d))
- "show all next up" button. increase max next up items on home screen ([bac2e86](https://github.com/cewert/jellyrock/commit/bac2e86))
- comment ([2c25e5d](https://github.com/cewert/jellyrock/commit/2c25e5d))
- renovate.json ([2aa155e](https://github.com/cewert/jellyrock/commit/2aa155e))
- duplicate ([0e7b443](https://github.com/cewert/jellyrock/commit/0e7b443))
- actions folder ([63cc652](https://github.com/cewert/jellyrock/commit/63cc652))
- other restrictions on OSD for intro files ([210a9c1](https://github.com/cewert/jellyrock/commit/210a9c1))

### Dependencies

- update stefanzweifel/git-auto-commit-action action to v6 ([#42](https://github.com/cewert/jellyrock/pull/42))
- update dependency ropm to v0.11.0 ([#40](https://github.com/cewert/jellyrock/pull/40))
- update actions/checkout action to v5 ([#36](https://github.com/cewert/jellyrock/pull/36))
- update softprops/action-gh-release action to v2 ([#37](https://github.com/cewert/jellyrock/pull/37))
- update actions/setup-java action to v5 ([#34](https://github.com/cewert/jellyrock/pull/34))
- update actions/checkout action to v5 ([#31](https://github.com/cewert/jellyrock/pull/31))
- update dependency brighterscript to v0.70.0 ([#32](https://github.com/cewert/jellyrock/pull/32))
- update dependency roku-deploy to v3.13.0 ([#21](https://github.com/cewert/jellyrock/pull/21))
- update peter-evans/repository-dispatch action to v3 ([#18](https://github.com/cewert/jellyrock/pull/18))
- update dependency brighterscript-formatter to v1.7.17 ([#16](https://github.com/cewert/jellyrock/pull/16))
- update dependency ropm to v0.10.37 ([#17](https://github.com/cewert/jellyrock/pull/17))
- update dependency @rokucommunity/bslint to v0.8.34 ([#14](https://github.com/cewert/jellyrock/pull/14))
- update dependency brighterscript to v0.69.13 ([#15](https://github.com/cewert/jellyrock/pull/15))
- update dependency ropm to v0.10.36 ([#12](https://github.com/cewert/jellyrock/pull/12))
- update dependency brighterscript to v0.69.12 ([#7](https://github.com/cewert/jellyrock/pull/7))
- update dependency ropm to v0.10.35 ([#6](https://github.com/cewert/jellyrock/pull/6))
- update dependency brighterscript-formatter to v1.7.16 ([#5](https://github.com/cewert/jellyrock/pull/5))
- update dependency @rokucommunity/bslint to v0.8.33 ([#3](https://github.com/cewert/jellyrock/pull/3))
- update dependency brighterscript to v0.69.11 ([#4](https://github.com/cewert/jellyrock/pull/4))
- dependency undent to v1 ([d13917e](https://github.com/cewert/jellyrock/commit/d13917e))
- dependency brighterscript-formatter to v1.7.15 ([e3fe4f1](https://github.com/cewert/jellyrock/commit/e3fe4f1))
- dependency roku-deploy to v3.12.6 ([50b42a3](https://github.com/cewert/jellyrock/commit/50b42a3))
- dependency ropm to v0.10.34 ([cad7c4d](https://github.com/cewert/jellyrock/commit/cad7c4d))
- dependency @rokucommunity/bslint to v0.8.32 ([382e68f](https://github.com/cewert/jellyrock/commit/382e68f))
- dependency brighterscript to v0.69.10 ([2536b8d](https://github.com/cewert/jellyrock/commit/2536b8d))
- dependency rooibos-roku to v5.15.7 ([e2c5183](https://github.com/cewert/jellyrock/commit/e2c5183))
- dependency ropm to v0.10.33 ([e7ed644](https://github.com/cewert/jellyrock/commit/e7ed644))
- dependency brighterscript to v0.69.9 ([83e6f88](https://github.com/cewert/jellyrock/commit/83e6f88))
- dependency markdownlint-cli2 to v0.18.1 ([5046bc4](https://github.com/cewert/jellyrock/commit/5046bc4))
- dependency spellchecker-cli to v7 ([3860562](https://github.com/cewert/jellyrock/commit/3860562))
- dependency roku-deploy to v3.12.5 ([1cc5005](https://github.com/cewert/jellyrock/commit/1cc5005))
- dependency jsdoc to v4.0.4 ([5e0299c](https://github.com/cewert/jellyrock/commit/5e0299c))
- dependency @rokucommunity/bslint to v0.8.31 ([fae2e93](https://github.com/cewert/jellyrock/commit/fae2e93))
- dependency brighterscript-formatter to v1.7.14 ([ee48895](https://github.com/cewert/jellyrock/commit/ee48895))
- stefanzweifel/git-auto-commit-action digest to 778341a ([6fbc874](https://github.com/cewert/jellyrock/commit/6fbc874))
- stefanzweifel/git-auto-commit-action action to v6 ([a012442](https://github.com/cewert/jellyrock/commit/a012442))
- stefanzweifel/git-auto-commit-action digest to b863ae1 ([e5fbf5d](https://github.com/cewert/jellyrock/commit/e5fbf5d))
- actions/upload-artifact digest to ea165f8 ([7da1225](https://github.com/cewert/jellyrock/commit/7da1225))
- actions/stale digest to 5bef64f ([9e9304d](https://github.com/cewert/jellyrock/commit/9e9304d))
- actions/setup-node digest to 49933ea ([297a22c](https://github.com/cewert/jellyrock/commit/297a22c))
- actions/setup-java digest to c5195ef ([5627d2d](https://github.com/cewert/jellyrock/commit/5627d2d))
- actions/checkout digest to 11bd719 ([c9e5a75](https://github.com/cewert/jellyrock/commit/c9e5a75))
