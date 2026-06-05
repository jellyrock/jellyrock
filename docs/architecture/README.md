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
| how login → home → playback flows end-to-end (the spine) | [user-journey.md](./user-journey.md) |
| app startup and lifecycle | [bootstrap.md](./bootstrap.md) |
| the scene stack and navigation | [navigation.md](./navigation.md) |
| `RowList`/grid item layout & the focus indicator (the `rowHeights` trap) | [list-grid-item-layout.md](./list-grid-item-layout.md) |
| global state — what hangs off `m.global` | [global-state.md](./global-state.md) |
| video and audio playback | [playback.md](./playback.md) |
| the API layer and task pool | [api.md](./api.md) |
| async work — promises layered over the task pool | [async.md](./async.md) |
| the app's Jellyfin API footprint (generated manifest) | [api-usage-manifest.md](./api-usage-manifest.md) |
| Jellyfin server-upgrade automation (API spec-diff pipeline) | [server-upgrade-automation.md](./server-upgrade-automation.md) |
| translations and i18n | [translations.md](./translations.md) |
| settings — sources, persistence, defaults | [settings.md](./settings.md) |
| registry migrations | [migrations.md](./migrations.md) |
| logging | [logging.md](./logging.md) |
| debug tools | [debug-tools.md](./debug-tools.md) |
| testing | [testing.md](./testing.md) |
| build, tooling, and pre-push hooks | [build-and-tooling.md](./build-and-tooling.md) |
| known tech debt and design intentions to preserve | [tech-debt.md](./tech-debt.md) |

## Glossary

- **JRScene** — the persistent root scene; see [bootstrap.md](./bootstrap.md). Defined in `components/JRScene.xml`.
- **JRScreen** — base class for full-screen scenes (`extends="JRScreen"` in XML). Provides `onScreenShown`, `onScreenHidden`, `onDestroy` virtuals + `lastFocus` field. Defined in `components/JRScreen.bs/.xml`.
- **JRGroup** — base class for sub-panels and dialogs (`extends="JRGroup"`). Interface declared in `components/JRGroup.xml`; a minimal `components/JRGroup.bs` provides only the `onDestroy()` auto-abandon floor (see [async.md](./async.md#cancellation--auto-abandon)). Adds common interface fields used for navigation, focus preservation, and overhang wiring — see [navigation.md](./navigation.md) for the full field table. `JRScreen` extends `JRGroup`.
- **SceneManager** — global stack-based navigator at `m.global.sceneManager`. The only thing that swaps groups in/out of `JRScene`'s `content` slot.
- **QueueManager** — global play queue at `m.global.queueManager`. Holds the list of items to play, current position, shuffle state.
- **ViewCreator** — a `.bs` module (not a component) at `components/manager/ViewCreator.bs`. Factory for `VideoPlayerView` and `AudioPlayerView`, plus playback-time dialog handlers (subtitle/audio/source selection).
- **ApiClient** — the singleton Jellyfin API wrapper at `source/api/ApiClient.bs`. Auto-dispatches between v1 (Jellyfin 10.7–10.8) and v2 (10.9+) endpoints. Builds request AAs that are submitted to the task pool.
- **API task pool** — a small set of persistent `ApiTask` Task nodes that execute HTTP requests off the render thread. A separate `ApiQueueTask` is the FIFO coordinator that dispatches into the pool. Per-request `ApiResultNode` is the data vehicle (immune to SceneGraph event coalescing).
- **roku-log** — the logging library. Per-component pattern: `m.log = new log.Logger("ComponentName")`. Levels: error, warn, info, verbose, debug.
- **ropm** — Roku Package Manager. Vendors `log`, `rr` (roku-requests), and `bslib` into `components/roku_modules/` and `source/roku_modules/`.
- **Overhang** — the persistent top bar (logo, current user, search, settings, library tabs). Lives in `JRScene` as `JROverhang`. Each `JRGroup` exposes `overhangTitle`, `overhangTabs`, `selectedTabId`, `isOverhangVisible` so the `SceneManager` can wire it up automatically on push/pop.
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

Task-oriented how-to guides live in [`docs/dev/`](../dev/). The index below is auto-generated from the `H1` heading of each file by `scripts/generate/dev-index.cjs` — never edit this list by hand.

<!-- BEGIN auto-generated dev-index (run `npm run docs:dev-index` to regenerate) -->

| File | Topic |
|---|---|
| [`docs/dev/DEVGUIDE.md`](../dev/DEVGUIDE.md) | Dev Guide |
| [`docs/dev/api-layering-guide.md`](../dev/api-layering-guide.md) | API Architecture Layering Guide |
| [`docs/dev/api-patterns.md`](../dev/api-patterns.md) | API Request Patterns |
| [`docs/dev/code-style.md`](../dev/code-style.md) | Code Style Guide |
| [`docs/dev/crash-reports.md`](../dev/crash-reports.md) | Weekly Roku crash-report workflow |
| [`docs/dev/debug-flags.md`](../dev/debug-flags.md) | Debug Flags & Toast Testing |
| [`docs/dev/developer-mode.md`](../dev/developer-mode.md) | Developer Mode for Roku Devices |
| [`docs/dev/jellyfin-server-versioning.md`](../dev/jellyfin-server-versioning.md) | JellyRock Versioning Systems Overview |
| [`docs/dev/logging.md`](../dev/logging.md) | Logging Guide (roku-log) |
| [`docs/dev/new-user-setting.md`](../dev/new-user-setting.md) | Adding User Settings Guide |
| [`docs/dev/promises.md`](../dev/promises.md) | Promises How-To & Style Guide |
| [`docs/dev/registry-migrations.md`](../dev/registry-migrations.md) | Registry Migrations Guide |
| [`docs/dev/scripts-development.md`](../dev/scripts-development.md) | Working in `scripts/` |
| [`docs/dev/translations.md`](../dev/translations.md) | Translations |
| [`docs/dev/unit-tests-tdd.md`](../dev/unit-tests-tdd.md) | Test-Driven Development (TDD) Workflow |
| [`docs/dev/unit-tests.md`](../dev/unit-tests.md) | Unit Testing Guide (Rooibos Framework) |

<!-- END auto-generated dev-index -->
