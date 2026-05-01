# JellyRock Architecture

Topic-organized explanation of how JellyRock is built. These docs answer **why** and describe **shape** — anything quantitative (file sizes, exact field lists) is left to the code itself, since `wc -l`, `grep`, and `find` are cheaper than maintaining a parallel snapshot.

JellyRock is a Roku client for [Jellyfin](https://jellyfin.org/), the open-source media server. The app authenticates a user against their Jellyfin server and lets them browse and stream their personal media library — movies, TV episodes, music, photos, and live TV — on Roku hardware.

## Tech stack

- **BrighterScript** (`.bs`) — typed superset of BrightScript, transpiled by `bsc`
- **Roku Scene Graph** (`.xml`) — node-based UI, every screen is a component tree
- **Jellyfin REST API** — wrapped by an in-house client + task pool (no third-party SDK)
- **roku-log** for logging, **rooibos** for tests, **ropm** for Roku-specific package management

The build pipeline is `bsc` (BrighterScript compiler) → `roku-deploy` to a real device. There is no JavaScript at runtime.

## How to use these docs

These are **explanation** docs (Diátaxis terminology) — the *why* and the *shape*, not how-to guides or API reference. They're meant to be loaded by topic when you (or an agent) need depth in a specific area, not read end-to-end.

For **how to do X** (writing tests, adding a setting, writing a migration, etc.), see `docs/dev/`.
For **what every setting does**, see `docs/user/app-settings.md` (auto-generated from `settings/settings.json`).
For **the spine that connects systems**, start with [user-journey.md](./user-journey.md).

Each doc has YAML frontmatter listing the source files it primarily references and a `last-reviewed` date. The `last-reviewed` field is bumped only on substantive content refreshes, not on routine edits.

## Topic map — load by purpose

| When you need to understand… | Read |
|---|---|
| **The spine** — how login → home → playback flows end-to-end | [user-journey.md](./user-journey.md) |
| **App startup**, two-phase global setup, the persistent JRScene root, app suspend/resume/exit | [bootstrap.md](./bootstrap.md) |
| **The scene stack** — `JRScene`/`JRScreen`/`JRGroup` triad, `pushScene`/`popScene`, focus, the overhang | [navigation.md](./navigation.md) |
| **Global state** — every node hanging off `m.global`, when each is initialized, who mutates it | [global-state.md](./global-state.md) |
| **Playback** — `VideoPlayerView`, OSD, trickplay, `QueueManager`, `ViewCreator`, the `AudioPlayer` engine vs. the `AudioPlayerView` screen, transcoding decisions | [playback.md](./playback.md) |
| **The API layer** — 3-layer model, the persistent task pool, V1/V2 dispatch, the four call patterns | [api.md](./api.md) |
| **Translations (i18n)** — custom JSON system, lookup chain, regional layering, BSC-plugin-generated key constants, Weblate sync | [translations.md](./translations.md) |
| **Settings** — `settings/settings.json` as source of truth, registry persistence, auto-sync, `SessionDataTransformer` | [settings.md](./settings.md) |
| **Registry migrations** — when one is needed, version-gated structure, test-mode safety | [migrations.md](./migrations.md) |
| **Logging** — `roku-log` per-component pattern, levels, prod-build stripping | [logging.md](./logging.md) |
| **Debug tools** — `m.global.debug` flags, `testToast` field, up-up-down-down cheat code | [debug-tools.md](./debug-tools.md) |
| **Tests** — rooibos, `BaseTestSuite`, test folder layout, run scripts | [testing.md](./testing.md) |
| **Build & tooling** — `bsc` configs, custom BSC plugins, npm scripts, Makefile, ropm | [build-and-tooling.md](./build-and-tooling.md) |
| **Tech debt and "things to preserve"** — known cruft, recent removals, design intentions worth defending | [tech-debt.md](./tech-debt.md) |

## Glossary

- **JRScene** — the *single* root scene of the app, persistent for the entire lifetime. Defined in `components/JRScene.xml`.
- **JRScreen** — base class for full-screen scenes (`extends="JRScreen"` in XML). Provides `OnScreenShown`, `OnScreenHidden`, `destroy` virtuals + `lastFocus` field. Defined in `components/JRScreen.bs/.xml`.
- **JRGroup** — base class for sub-panels and dialogs (`extends="JRGroup"`). Pure interface declaration in `components/JRGroup.xml` (no `.bs`); just adds common fields like `lastFocus`, `overhangTabs`, `selectedTabId`. JRScreen extends JRGroup.
- **SceneManager** — global stack-based navigator at `m.global.sceneManager`. The only thing that swaps groups in/out of `JRScene`'s `content` slot.
- **QueueManager** — global play queue at `m.global.queueManager`. Holds the list of items to play, current position, shuffle state.
- **ViewCreator** — a `.bs` module (not a component) at `components/manager/ViewCreator.bs`. Factory for `VideoPlayerView` and `AudioPlayerView`, plus playback-time dialog handlers (subtitle/audio/source selection).
- **ApiClient** — the singleton Jellyfin API wrapper at `source/api/ApiClient.bs`. Auto-dispatches between v1 (Jellyfin 10.7–10.8) and v2 (10.9+) endpoints. Builds request AAs that are submitted to the task pool.
- **API task pool** — a small set of persistent `ApiTask` Task nodes that execute HTTP requests off the render thread. A separate `ApiQueueTask` is the FIFO coordinator that dispatches into the pool. Per-request `ApiResultNode` is the data vehicle (immune to SceneGraph event coalescing).
- **roku-log** — the logging library. Per-component pattern: `m.log = new log.Logger("ComponentName")`. Levels: error, warn, info, verbose, debug.
- **ropm** — Roku Package Manager. Vendors `log`, `rr` (roku-requests), and `bslib` into `components/roku_modules/` and `source/roku_modules/`.
- **Overhang** — the persistent top bar (logo, current user, search, settings, library tabs). Lives in `JRScene` as `JROverhang`. Each `JRGroup` exposes `overhangTitle`, `overhangTabs`, `selectedTabId`, `isOverhangVisible` so the SceneManager can wire it up automatically on push/pop.
- **Render thread** — Roku's main UI thread. Anything that does I/O (network, registry I/O, large file reads) **must** run on a Task thread to avoid blocking the UI. Task nodes (`ApiTask`, `LoadItemsTask`, etc.) are how this is enforced.
- **`m.global`** — Roku's app-wide global node. JellyRock hangs a deep tree of nodes off it (`m.global.user`, `m.global.server`, `m.global.queueManager`, etc.) — see [global-state.md](./global-state.md).
- **Quickplay** — namespace at `source/utils/quickplay.bs`. Wraps a Jellyfin item into a queue-ready format and dispatches by item type. Invoked by the `quickPlayNode` event on press of any Play button.

## Related docs

| Where | What lives there |
|---|---|
| `docs/dev/` | Task-oriented how-to guides (writing tests, adding settings, migrations, debugging) |
| `docs/user/` | User-facing reference (`app-settings.md` is auto-generated from `settings.json`) |
| `docs/decisions.md` | Append-only "why we chose X" log for non-obvious design decisions |
| `CLAUDE.md` (root + subdirs) | Always-loaded rules for AI agents working in the repo |
| `CHANGELOG.md` | CI-controlled — do not edit by hand |

### Existing dev guides

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
