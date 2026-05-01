# JellyRock — State of the World

A snapshot of how JellyRock is architected as of **2026-04-26** (commit `d6322b1f`, app version `2.12.0`).

JellyRock is a Roku client for [Jellyfin](https://jellyfin.org/), the open-source media server. The app authenticates a user against their Jellyfin server and lets them browse and stream their personal media library — movies, TV episodes, music, photos, and live TV — on Roku hardware.

This is a personal architecture reference, not a maintained doc. It exists to give a complete-enough picture that you (or a future contributor, or a trimmed AI-agent version of this doc) can navigate the codebase intentionally without re-discovering the same context. It is comprehensive, not exhaustive — the spine is the user's main path (login → home → browse → playback), and other systems get the depth they earn.

## Tech stack

- **BrighterScript** (`.bs`) — modern superset of BrightScript, transpiled by `bsc`
- **Roku Scene Graph** (`.xml`) — node-based UI, every screen is a component tree
- **Jellyfin REST API** — wrapped by an in-house client + task pool (no third-party SDK)
- **roku-log** for logging, **rooibos** for tests, **ropm** for Roku-specific package management

The build pipeline is `bsc` (BrighterScript compiler) → `roku-deploy` to a real device. There is no JavaScript at runtime.

## Reading order

Read top to bottom for a full picture, or jump around using the map below.

1. **[01 — Bootstrap & lifecycle](./01-bootstrap-and-lifecycle.md)** — `Main()` → `setGlobals` → translations → migrations → root scene → `setGlobalNodes` → `LoginFlow` → main event loop. App suspend/resume/exit. The persistent `JRScene` root.
2. **[02 — Scene stack & navigation](./02-scene-and-navigation.md)** — `SceneManager`, the `JRScene` / `JRScreen` / `JRGroup` triad, how `pushScene`/`popScene` work, focus preservation, the overhang.
3. **[03 — Global state](./03-global-state.md)** — Every node hanging off `m.global`, when each is initialized, who mutates it. User settings auto-sync. Theme cascade.
4. **[04 — The user journey](./04-user-journey.md)** — End-to-end walkthrough: server selection → user pick → auth → home → library grid → item detail → press Play → video player. The spine of the app.
5. **[05 — Video & audio playback](./05-video-and-audio-playback.md)** — `VideoPlayerView`, OSD, trickplay, `QueueManager`, `ViewCreator`, the `AudioPlayer` engine vs. the `AudioPlayerView` screen, transcoding decisions.
6. **[06 — API layer & task pool](./06-api-and-task-pool.md)** — The 3-layer API model (`ApiClient` → domain helpers → typed wrappers), the persistent 3-slot `ApiTask` pool with FIFO coordinator, fire-and-forget side effects.
7. **[07 — Translations](./07-translations.md)** — Custom JSON i18n with English fallback, regional layering, special Chinese handling, BSC-plugin-generated key constants, Weblate sync.
8. **[08 — Settings & migrations](./08-settings-and-migrations.md)** — `settings/settings.json` as source of truth, registry persistence, `SessionDataTransformer`, version-gated migrations.
9. **[09 — Logging, debug, tests](./09-logging-debug-tests.md)** — `roku-log` per-component pattern, the `#if debug` flag system, the `testToast` field and up-up-down-down cheat code, the rooibos test suite layout.
10. **[10 — Build & tooling](./10-build-and-tooling.md)** — `bsc` configs, custom BSC plugins, npm scripts, Makefile targets, ropm modules, IDE integration expectations.
11. **[99 — Tech debt & cruft](./99-tech-debt-and-cruft.md)** — Honest inventory of the messy areas, a "good things to preserve" list to guard against accidental regressions, and a few recently-removed things (legacy `JRVideo`) so future-you doesn't go searching.

## Site map

```brightscript
JellyRock app
│
├── source/main.bs                         ← bootstrap + main event loop (1,291 lines)
│   ├── setGlobals()                       ← non-node globals (server, user, app, device, constants)
│   ├── loadTranslations(locale)           ← i18n (en_US fallback always loaded)
│   ├── runGlobalMigrations()              ← registry schema migrations
│   ├── runRegistryUserMigrations()
│   ├── m.screen.CreateScene("JRScene")    ← persistent root
│   ├── setGlobalNodes()                   ← API pool, sceneManager, queueManager, audioPlayer
│   ├── LoginFlow()                        ← server pick → user pick → auth
│   ├── loadHomeScreen()
│   └── while true / wait(0, m.port)       ← event loop
│
├── components/JRScene.xml                 ← root scene: backdrop, overhang, content slot, toast
│   └── components/JRScene.bs              ← testToast field + up-up-down-down cheat code
│
├── components/data/SceneManager.bs        ← stack: pushScene / popScene / clearScenes
│   └── m.scene.findNode("content")        ← visible group lives here
│
├── components/JRScreen.bs                 ← base for full screens (OnScreenShown / OnScreenHidden / destroy)
├── components/JRGroup.xml                 ← base for sub-panels (lastFocus, overhangTitle, tabs)
│
├── components/manager/QueueManager.bs     ← play queue + shuffle (294 lines, exemplar of clean code)
├── components/manager/ViewCreator.bs      ← factory: CreateVideoPlayerView / CreateAudioPlayerView + dialogs
│
├── components/video/VideoPlayerView.bs    ← canonical video player (1,674 lines)
│   ├── components/video/OSD.bs            ← time, progress, play/pause, 5s inactivity
│   ├── components/video/TrickplayCarousel.bs
│   └── components/video/VideoNotification.bs
│
├── components/mediaPlayers/AudioPlayer.bs ← global audio engine (extends Video, on m.global.audioPlayer)
├── components/music/AudioPlayerView.bs    ← visible audio screen (extends JRScreen)
│
├── source/api/ApiClient.bs                ← singleton Jellyfin client, V1/V2 dispatch
├── source/api/apiPool.bs                  ← fetchRes / fetchJson / submitApiRequest / SubmitSideEffect
├── components/api/ApiTask.bs              ← x3 pool worker
├── components/api/ApiQueueTask.bs         ← FIFO coordinator
├── components/api/ApiResultNode.xml       ← per-request vehicle (immune to event coalescing)
├── components/api/SideEffectTask.bs       ← fire-and-forget POST/DELETE
│
├── source/utils/translate.bs              ← translate(key) / translatePlural(baseKey, count)
├── source/utils/translateLocale.bs        ← locale resolution cascade
├── locale/custom/<lang>.json              ← 100+ translation files
│
├── source/utils/globals.bs                ← setGlobals / setGlobalNodes / theme cascade
├── source/utils/config.bs                 ← getSetting / setSetting / getUserSetting / setUserSetting
├── source/data/SessionDataTransformer.bs  ← registry → m.global.user.settings at startup
├── source/migrations.bs                   ← version-gated registry migrations
└── settings/settings.json                 ← single source of truth for setting defaults & structure
```

## Glossary

- **JRScene** — the *single* root scene of the app, persistent for the entire lifetime. Defined in `components/JRScene.xml`.
- **JRScreen** — base class for full-screen scenes (`extends="JRScreen"` in XML). Provides `OnScreenShown`, `OnScreenHidden`, `destroy` virtuals + `lastFocus` field. Defined in `components/JRScreen.bs/.xml`.
- **JRGroup** — base class for sub-panels and dialogs (`extends="JRGroup"`). Pure interface declaration in `components/JRGroup.xml` (no `.bs`); just adds common fields like `lastFocus`, `overhangTabs`, `selectedTabId`. JRScreen extends JRGroup.
- **SceneManager** — global stack-based navigator at `m.global.sceneManager`. The only thing that swaps groups in/out of `JRScene`'s `content` slot.
- **QueueManager** — global play queue at `m.global.queueManager`. Holds the list of items to play, current position, shuffle state.
- **ViewCreator** — a `.bs` module (not a component) at `components/manager/ViewCreator.bs`. Factory for `VideoPlayerView` and `AudioPlayerView`, plus playback-time dialog handlers (subtitle/audio/source selection).
- **ApiClient** — the modern, singleton Jellyfin API wrapper at `source/api/ApiClient.bs`. Auto-dispatches between v1 (Jellyfin 10.7–10.8) and v2 (10.9+) endpoints. Builds request AAs that are submitted to the task pool.
- **API task pool** — three persistent `ApiTask` Task nodes that execute HTTP requests off the render thread. A separate `ApiQueueTask` is the FIFO coordinator that dispatches into the pool. Per-request `ApiResultNode` is the data vehicle (immune to SceneGraph event coalescing).
- **roku-log** — the logging library. Per-component pattern: `m.log = new log.Logger("ComponentName")`. Levels: error, warn, info, verbose, debug.
- **ropm** — Roku Package Manager. Vendors `log`, `rr` (roku-requests), and `bslib` into `components/roku_modules/` and `source/roku_modules/`.
- **Overhang** — the persistent top bar (logo, current user, search, settings, library tabs). Lives in `JRScene` as `JROverhang`. Each `JRGroup` exposes `overhangTitle`, `overhangTabs`, `selectedTabId`, `isOverhangVisible` so the SceneManager can wire it up automatically on push/pop.
- **Render thread** — Roku's main UI thread. Anything that does I/O (network, registry I/O, large file reads) **must** run on a Task thread to avoid blocking the UI. Task nodes (`ApiTask`, `LoadItemsTask`, etc.) are how this is enforced.
- **`m.global`** — Roku's app-wide global node. JellyRock hangs a deep tree of nodes off it (`m.global.user`, `m.global.server`, `m.global.queueManager`, etc.) — see `03-global-state.md`.
- **Quickplay** — namespace at `source/utils/quickplay.bs`. Wraps a Jellyfin item into a queue-ready format and dispatches by item type. Invoked by the `quickPlayNode` event on press of any Play button.

## Pointers to existing dev docs

The `docs/dev/` folder contains task-oriented how-to guides — this architecture set links to them where relevant rather than duplicating their content.

| File | Topic |
|---|---|
| `docs/dev/DEVGUIDE.md` | New-developer quick start |
| `docs/dev/code-style.md` | Naming, formatting, BS-specific patterns |
| `docs/dev/api-layering-guide.md` | Which API layer to use when |
| `docs/dev/api-patterns.md` | Task-pool call patterns |
| `docs/dev/translations.md` | i18n workflow, locale files |
| `docs/dev/new-user-setting.md` | Adding a setting end-to-end |
| `docs/dev/registry-migrations.md` | Writing a migration |
| `docs/dev/logging.md` | roku-log conventions |
| `docs/dev/debug-flags.md` | Debug flag system, toast cheat code |
| `docs/dev/unit-tests.md` | Rooibos basics |
| `docs/dev/unit-tests-tdd.md` | TDD workflow |
| `docs/dev/jellyfin-server-versioning.md` | Server version dispatch |
| `docs/dev/developer-mode.md` | Developer-mode toggles |

The project root has `CLAUDE.md` (AI-agent rules + project context) and `CHANGELOG.md` (CI-controlled, do not edit).
