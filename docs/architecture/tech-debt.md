# 99 — Tech Debt & Cruft

A consolidated honest inventory: where the codebase is messy, where it's cleaner than average, and what's been recently removed (so future-you doesn't go searching for ghosts).

## Refactor candidates, by severity

### High — meaningful complexity costs

| Area | File | Issue | Suggested direction |
|---|---|---|---|
| `ItemDetails.bs` size | `components/ItemDetails.bs` (3,337 lines) | Single file handles every item type (movies, episodes, series, seasons, audio, photos, live TV programs). Long `onKeyEvent` with many key handlers. Extras pane animation logic mixed with data loading. | Split per item-type renderer (`PopulateInfoGroupMovie`, `Series`, `Episode`, `Music` etc. as separate modules). Extract the extras pane and item-options popup into their own components. |
| `VideoPlayerView.bs` size | `components/video/VideoPlayerView.bs` (1,674 lines) | Mixes native `Video` event handling, OSD orchestration, trickplay, transcoding, DoVi fallback, subtitle management, audio track switching, chapter navigation, Jellyfin reporting. | Extract subsystems: `SubtitleController`, `ChapterController`, `TranscodeRecoveryHandler`. Keep the player class focused on lifecycle + observers. |
| `main.bs` size | `source/main.bs` (1,291 lines) | Bootstrap + main event loop in one file. Event loop handles 15+ distinct event types: playback, favorites toggle, watched toggle, voice search, quickplay dispatch, font download completion, screen lifecycle. | Extract per-concern handler modules; main loop dispatches to them by event name. |

### Medium — worth refactoring when adjacent

| Area | File | Issue | Suggested direction |
|---|---|---|---|
| `showScenes.bs` mixes concerns | `source/showScenes.bs` (728 lines) | LoginFlow + a dozen `Create*Group()` scene factories in one file. | Split into `source/auth/LoginFlow.bs` and `source/screens/<Name>Page.bs`. |
| Legacy SDK namespace coexists with `ApiClient` | `source/api/sdk.bs` | The header comment warns "Only used by ApiClient — do NOT call directly" but some legacy code paths do. The migration is partial. | Finish the migration; remove the namespace once nothing imports it directly. |
| Manual `destroy()` discipline | All `JRScreen` subclasses | The base `destroy()` is a no-op virtual. Forgetting to override leaks observers and tasks. No safety net. | Add a base implementation that auto-unobserves any field this screen called `observeField` on, and stops/destroys any Task nodes stored in `m.*` fields with a known naming convention. |
| Per-method V1/V2 routing | `source/api/ApiClient.bs` | Adding a third API version means editing every `Build*Request()` method. | Centralize via a routing table: `{ "GetItem": { v1: "/users/{userId}/items/{id}", v2: "/Items/{id}" }, ... }`. Build methods read from the table instead of branching inline. |
| Limited error boundaries | `source/showScenes.bs` (LoginFlow) and elsewhere | Network failures in LoginFlow may leave app in inconsistent state; minimal retry/recovery. | Define a small set of error categories (network unreachable, auth failed, server error) and a corresponding recovery flow per category. |
| Manual theme color cascade | `source/utils/globals.bs`, settings flow | Settings change → `applyThemeColorOverrides` → `refreshThemeColors` → `reloadHome` is a manual chain. Components that cache theme colors at construction time miss updates. | Either: (a) all components read from `m.global.constants` in event handlers (not init), or (b) define a "theme observable" that nodes can opt into. |

### Low — minor irritants, low blast radius

| Area | File | Issue |
|---|---|---|
| `quickPlayNode` set-then-clear pattern | `components/ItemDetails.bs`, `source/main.bs` | Unusual single-shot event idiom. Works (and is documented), but unfamiliar to first-time readers. |
| `goto`-based retry in LoginFlow | `source/showScenes.bs` | `goto startLogin` and `goto userSelect` for auth retry. Old-school but readable. |
| OSD inactivity timeout | `components/video/OSD.xml` | Hardcoded 5-second timeout via `inactiveTimeout="5"`. Should probably be a constant. |
| No persistent series playlist UI | `components/ItemDetails`, QueueManager | "Play next" routes through ItemDetails → quickPlayNode each time; no "now playing queue" sidebar. |
| `m.groups` is unbounded | `components/data/SceneManager.bs` | Stack array has no cap. Buggy push-without-pop loops would leak indefinitely. |
| `selectedItem` bubbling | `components/home/Home.xml`, `components/ItemDetails.xml`, ... | Implicit contract — every level declares the field with `alwaysNotify`. Tracing a click to its handler requires walking the tree. |
| `printRegistry()` on startup | `source/main.bs` | Runs unconditionally; noisy in prod logs unless filtered by level. |
| `appStart:` label-based restart | `source/main.bs` | `goto appStart` for "log out and start over". Works fine, but unusual pattern today. |
| `m.wasMigrated` global flag | `source/migrations.bs`, `source/main.bs` | Communicates via the implicit `m` AA between functions. |
| Plural form is Zero/One/Many only | `source/utils/translate.bs` | No support for languages with more than three plural forms. |
| Locale file size grows linearly | `locale/custom/*.json` | ~150KB per locale × 98 locales = ~15MB checked into the source tree. Repo-size only, not runtime. |
| Settings auto-sync coupling | `JellyfinUserSettings.bs` | The auto-sync depends on field names matching registry keys exactly. A field rename without a migration breaks this. |
| `valueToString` lossy on edge types | `source/utils/config.bs` | Registry stores all values as strings. `"True"` typo doesn't fail-fast. |
| Trickplay tile pre-fetch range hardcoded | `components/video/TrickplayCarousel.bs` | Should be a constant, possibly user-configurable. |
| 30s API timeout, hardcoded | `source/constants/timeouts.bs` | `timeouts.API_WAIT_MS` — one value for all calls regardless of operation. |
| `JRScreen.init` initializes log manager | `components/JRScreen.bs` | Unusual coupling — global resource initialized in a screen lifecycle hook. Re-init is no-op so it works. |
| `testToast` field is in production | `components/JRScene.xml` | Not gated by `#if debug`. Field exists always; only the cheat code is debug-gated. |
| Dialog `returnData` is shared global | `components/data/SceneManager.bs` | All dialogs write to the same field. Risk of cross-dialog observers firing on stale data. |
| Seven bsconfig files | repo root | Mostly copies with overrides. A base + overlay would be cleaner. |
| No request cancellation | `source/api/apiPool.bs` | A `submitApiRequest` that's no longer needed completes anyway and fires its callback. |
| `e2e` test folder mostly empty | `tests/source/e2e/` | RTA-based UI automation was planned, hasn't materialized. |

## Things to preserve — recognize the gold so you don't accidentally regress it

These are areas where the design is genuinely good and shouldn't be casually reformed:

- **`QueueManager.bs`** — clean, well-bounded, thoroughly commented. ~294 lines of clear API. Often held up as the "this is what good BrighterScript looks like" exemplar.
- **The 3-layer API model** — `ApiClient` → `image.bs` validation → `imageHelpers.bs` domain helpers. Each layer adds value. Don't collapse.
- **The persistent task pool** — three `ApiTask` workers + `ApiQueueTask` coordinator + per-request `ApiResultNode`. Avoiding SceneGraph event coalescing via children-as-vehicle is genuinely clever and battle-tested. Don't replace with naive per-request task creation.
- **Custom translation system** — the lookup chain (active → fallback → key), regional layering, Chinese script-code handling, BSC-plugin-generated key constants, Weblate sync. Every piece earns its keep. Don't switch to Roku's `tr()`.
- **`SceneManager` + `JRScreen`/`JRGroup` triad** — three well-bounded base classes, lifecycle hooks, focus preservation via `lastFocus`. The system reliably preserves cursor position across navigation.
- **Settings as `settings.json`** — single source of truth. Defaults live there, the Settings UI walks the JSON to render itself, the `docs:settings` script generates user docs from it. Don't add a parallel source.
- **Registry migrations framework** — version-gated, idempotent-ish, test-mode-safe. Old migrations stay forever (can't be removed without breaking users who skip versions).
- **Typed `ContentNode` data layer** — `JellyfinUserSettings`, `JellyfinUser`, `DeviceInfo`, etc. The XML *is* the schema. BSC validates field accesses at compile time.
- **The auto-sync settings observer** — write to the field, persistence is automatic. Developer experience here is excellent.
- **The DoVi transcode-fallback flow** — sophisticated, well-commented, handles a real Roku/Jellyfin interaction problem (`buffer:loop:` source overflow on DoVi HLS). Don't simplify.
- **Per-component logging pattern** — `m.log = new log.Logger("Name")` in every `init()`, with prod-build log stripping. Zero overhead in production.
- **The `back` key always means popScene** — SceneManager handles it uniformly. Confirmation dialog appears automatically when popping the last scene.
- **`isLowMemoryDevice` detection** — hardcoded prefix list of 22 known 512MB models. Yes, it's hardcoded; yes, it's the right call (Roku doesn't expose RAM info via API).

## Recently removed — don't go searching for these

- **`components/JRVideo.xml/.bs`** and **`source/VideoPlayer.bs`** — the legacy video player. Removed in commit **`17cc374f` "chore: remove legacy video player code"** (Dec 2025). Was replaced by `components/video/VideoPlayerView.xml/.bs`. If you encounter references in old comments, blog posts, AI training data, or stale documentation, those are stale. There is exactly one video player today.
- **`CreateVideoPlayerGroup()`** function from `source/showScenes.bs` — removed alongside the legacy player. The modern equivalent is `ViewCreator.CreateVideoPlayerView()`.
- **Various legacy subtitle helper functions** (`setupSubtitle`, `getSubtitleSelIdxFromSubIdx`) — removed in followup cleanup commits (`58500a99` and similar in early 2026).

## A note on the audio "duplication"

There are two audio-related components that look like duplicates but aren't:

- **`components/mediaPlayers/AudioPlayer.xml/.bs`** — the audio playback **engine**. Extends `Video` (Roku's native node, used for both video and audio). Lives at `m.global.audioPlayer` for the entire app lifetime. Plays the actual bytes.
- **`components/music/AudioPlayerView.xml/.bs`** — the audio playback **screen**. Extends `JRScreen`. Shows album art, track title, controls. Is push/popped on the scene stack like any other screen.

This split is intentional and correct: the engine plays whether the screen is shown or not, so audio keeps going when the user navigates away from "now playing." Don't merge them.

## How to use this document

When you're considering a refactor, check here first to see if it's already been categorized. If it's "High" severity, there's likely consensus that it should be done. If it's "Low," consider whether the change is actually worth the churn — many low-severity items are quirks that have a reason for existing.

When you're considering a major change to a system, check the "Things to preserve" list to make sure you're not accidentally reforming something that's working well. The clean systems are clean for reasons that aren't always obvious from the code — they were debugged into their current shape.
