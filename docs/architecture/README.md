# JellyRock architecture

Explanations of how JellyRock is built, one topic per file. They say why a subsystem is built the way it is and what shape it has. They leave quantities such as file sizes and field lists to the code, since `wc -l`, `grep` and `find` answer those for free and never go stale.

JellyRock is a Roku client for [Jellyfin](https://jellyfin.org/), the open-source media server. A user signs in to their Jellyfin server and browses and plays their own library on a Roku: movies, TV, music, photos and live TV.

## Tech stack

- **BrighterScript** (`.bs`): a typed superset of BrightScript, compiled to BrightScript by `bsc`.
- **Roku SceneGraph** (`.xml`): node-based UI, where every screen is a component tree.
- **Jellyfin REST API:** reached through an in-house client and task pool, with no third-party SDK.
- **roku-log** for logging, **Rooibos** for tests and **ropm** for Roku packages.

`npm run build` compiles the app with `bsc`, and `make install` sideloads the package to a Roku. No JavaScript runs on the device; the JavaScript in the repo is build and test tooling.

## How to use these docs

These are explanation docs in the Diátaxis sense: the why and the shape, not how-to steps or reference. Load the one for the area you need; they are not meant to be read end to end.

- **How to do a task** (write a test, add a setting, write a migration): [`docs/dev/`](../dev/).
- **What each setting does:** [`docs/user/app-settings.md`](../user/app-settings.md), generated from `settings/settings.json`.
- **How the systems connect:** start with [user-journey.md](./user-journey.md).

Each doc's frontmatter lists the source files it describes (`related-files`) and a `last-reviewed` date. That date moves only when the doc was checked against the code, not on every edit.

## Topic map

| When you need to understand… | Read |
|---|---|
| how sign-in, Home and playback connect end to end | [user-journey.md](./user-journey.md) |
| app startup and lifecycle | [bootstrap.md](./bootstrap.md) |
| routing and navigation | [navigation.md](./navigation.md) |
| dialogs: the family, the standard and how it is enforced | [dialogs.md](./dialogs.md) |
| `RowList` and grid item layout, and the focus indicator (the `rowHeights` trap) | [list-grid-item-layout.md](./list-grid-item-layout.md) |
| global state: what hangs off `m.global` | [global-state.md](./global-state.md) |
| video and audio playback | [playback.md](./playback.md) |
| remote control, "Cast to JellyRock" | [remote-control.md](./remote-control.md) |
| the HTTPS long-poll fallback's wire format | [remote-control-longpoll-contract.md](./remote-control-longpoll-contract.md) |
| the API layer and task pool | [api.md](./api.md) |
| async work: promises over the task pool | [async.md](./async.md) |
| which thread code runs on, and what that forbids | [threading.md](./threading.md) |
| the app's Jellyfin API footprint (a generated manifest) | [api-usage-manifest.md](./api-usage-manifest.md) |
| Jellyfin server-upgrade automation (the API spec-diff pipeline) | [server-upgrade-automation.md](./server-upgrade-automation.md) |
| translations | [translations.md](./translations.md) |
| settings: sources, persistence, defaults | [settings.md](./settings.md) |
| registry migrations | [migrations.md](./migrations.md) |
| logging | [logging.md](./logging.md) |
| debug tools | [debug-tools.md](./debug-tools.md) |
| testing | [testing.md](./testing.md) |
| build, tooling and git hooks | [build-and-tooling.md](./build-and-tooling.md) |
| how this repo's dev process is organized (journals, skills, hooks) | [system-shape.md](./system-shape.md) |
| known tech debt, and design intent to keep | [tech-debt.md](./tech-debt.md) |

## Glossary

- **JRScene:** the root scene, which lives for the whole session. Defined in `components/JRScene.xml`; see [bootstrap.md](./bootstrap.md). It hosts the router and the overhang, and wires each screen's overhang fields to the overhang.
- **JRScreen:** the base for full-screen views (`extends="JRScreen"`). It adds the `onScreenShown`, `onScreenHidden` and `onDestroy` hooks and the `lastFocus` field. Defined in `components/JRScreen.bs` and `.xml`.
- **JRGroup:** the base for panels and dialogs, and through `JRScreen` for every screen. Its interface, in `components/JRGroup.xml`, carries the navigation, focus and overhang fields ([navigation.md](./navigation.md) has the table). `components/JRGroup.bs` holds only an `onDestroy()` that abandons pending promises ([async.md](./async.md#cancellation-auto-abandon)).
- **sgRouter:** the navigation library (`@rokucommunity/sgrouter`). Every screen is routed. `JRScene` hosts the router in a `<sgrouter_Outlet>` and owns the route table, the `AuthManager` guard, the overhang controller and the exit confirmation. See [navigation.md](./navigation.md).
- **`SceneManager`:** a service node at `m.global.sceneManager`. It no longer manages scenes (the router replaced that in #550). What is left: reloading Home, refreshing theme colors, setting the backdrop, saying whether a dialog is open, and passing the current user and clock to the overhang.
- **QueueManager:** the play queue at `m.global.queueManager`: the items to play, the current position and the shuffle state.
- **PlayerHostView:** the routed view (`components/video/PlayerHostView.bs`) that wraps `VideoPlayerView`, since a `Video` node cannot be a router view. It reads the queue when it mounts, moves through the queue and hosts the track, source and info dialogs during playback.
- **ApiClient:** the Jellyfin API wrapper in `source/api/ApiClient.bs`. It picks the v1 endpoints (Jellyfin 10.7 and 10.8) or the v2 ones (10.9 and later), and builds request AAs for the task pool.
- **API task pool:** a few persistent `ApiTask` Task nodes that make HTTP requests off the render thread, fed in order by one `ApiQueueTask` coordinator. Each request's answer comes back on its own `ApiResultNode`, so SceneGraph cannot merge two answers into one field change.
- **roku-log:** the logging library. Each component creates `m.log = new log.Logger("ComponentName")`. Levels: error, warn, info, verbose, debug.
- **ropm:** the Roku package manager. It vendors packages into `components/roku_modules/` and `source/roku_modules/`: `log` (roku-log), `rr` (roku-requests), `promises`, `sgrouter`, `rokucommunity_bslib` and `tkss_rodash_v0`.
- **Overhang:** the top bar (logo, current user, search, settings, library tabs), a `JROverhang` inside `JRScene`. Each `JRGroup` sets `overhangTitle`, `overhangTabs`, `selectedTabId` and `isOverhangVisible`, and `JRScene` binds them to the overhang when the router switches to that screen.
- **Threads:** a SceneGraph app has three. The main thread runs `Main()` in `source/main.bs`. The render thread runs every component's `init()`, observers and key handlers. Task threads run Task nodes. Network, registry and other blocking work must run on a Task thread, never the render thread. See [threading.md](./threading.md).
- **`m.global`:** Roku's app-wide global node. JellyRock hangs a tree of nodes off it (`m.global.user`, `m.global.server`, `m.global.queueManager` and more); see [global-state.md](./global-state.md).
- **Quickplay:** the `quickplay` namespace in `source/utils/quickplay.bs`. It turns a Jellyfin item into queue items and dispatches by item type. A screen triggers it by setting its `quickPlayNode` field when a Play button is pressed.

## Related docs

| Where | What lives there |
|---|---|
| `docs/dev/` | How-to guides: tests, settings, migrations, debugging |
| `docs/user/` | Reference for users (`app-settings.md` is generated from `settings.json`) |
| `docs/adr/` | Numbered decision records for architectural, hard-to-reverse or cross-component choices. Never edited after they are accepted. |
| `docs/decisions.md` | Shorter notes on why a narrower choice was made, below the ADR bar |
| `CLAUDE.md` (root and folders) | Rules that AI agents load while working in the repo |
| `CHANGELOG.md` | Written by CI; never edit it by hand |

### Existing dev guides

The how-to guides in [`docs/dev/`](../dev/), listed by each file's `H1` heading. `scripts/generate/dev-index.cjs` writes this table; never edit it by hand.

<!-- BEGIN auto-generated dev-index (run `npm run docs:dev-index` to regenerate) -->

| File | Topic |
|---|---|
| [`docs/dev/DEVGUIDE.md`](../dev/DEVGUIDE.md) | Dev guide |
| [`docs/dev/api-layering-guide.md`](../dev/api-layering-guide.md) | API layering guide |
| [`docs/dev/api-patterns.md`](../dev/api-patterns.md) | API request patterns |
| [`docs/dev/code-style.md`](../dev/code-style.md) | Code style |
| [`docs/dev/crash-reports.md`](../dev/crash-reports.md) | Weekly Roku crash reports |
| [`docs/dev/debug-flags.md`](../dev/debug-flags.md) | Debug flags and toast testing |
| [`docs/dev/deep-linking.md`](../dev/deep-linking.md) | Deep linking and casting |
| [`docs/dev/developer-mode.md`](../dev/developer-mode.md) | Developer mode for Roku devices |
| [`docs/dev/home-first-paint-performance.md`](../dev/home-first-paint-performance.md) | Measuring orchestrator wait-vs-emit on device |
| [`docs/dev/jellyfin-server-versioning.md`](../dev/jellyfin-server-versioning.md) | Jellyfin server versions |
| [`docs/dev/logging.md`](../dev/logging.md) | Logging guide (roku-log) |
| [`docs/dev/measuring-performance.md`](../dev/measuring-performance.md) | Measuring performance on device |
| [`docs/dev/new-user-setting.md`](../dev/new-user-setting.md) | Add a setting |
| [`docs/dev/promises.md`](../dev/promises.md) | Promises |
| [`docs/dev/registry-migrations.md`](../dev/registry-migrations.md) | Registry migrations |
| [`docs/dev/rta-tests.md`](../dev/rta-tests.md) | RTA functional tests (`tests/rta/`) |
| [`docs/dev/scripts-development.md`](../dev/scripts-development.md) | Working in `scripts/` |
| [`docs/dev/translations.md`](../dev/translations.md) | Translations |
| [`docs/dev/unit-tests-tdd.md`](../dev/unit-tests-tdd.md) | Test-driven development (TDD) |
| [`docs/dev/unit-tests.md`](../dev/unit-tests.md) | Unit tests |
| [`docs/dev/writing-style.md`](../dev/writing-style.md) | Writing style |

<!-- END auto-generated dev-index -->
