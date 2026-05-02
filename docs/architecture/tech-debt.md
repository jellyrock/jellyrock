---
topic: tech-debt
related-files: []  # touches everything; per-item area fields point to specific files
last-reviewed: 2026-05-01
---

# Tech Debt & Cruft

A living inventory of known issues, plus a "recently removed" list (so future-you doesn't waste time searching for ghosts that have been deleted).

For *what's good and shouldn't be casually reformed* — see the relevant topic doc in [`docs/architecture/`](./README.md#topic-map--load-by-purpose). Each topic doc explains its subsystem's design intent inline, where the context is fresh.

Each refactor item has a stable slug for cross-referencing in commits, PRs, and GitHub issues. When a slug is filed as a GitHub issue, add the issue number as the `github` field. When the work is complete, remove the entry entirely (the closed GitHub issue becomes the historical record).

## How to use this document

- **Considering a refactor?** Check this list first. If the area is here, the change is at least documented; pick severity carefully — `low` items are usually quirks with reasons.
- **Considering a major change to a "clean" subsystem?** Read the relevant topic doc in [`docs/architecture/`](./README.md) first. The clean systems are clean for reasons that aren't always obvious from the code alone, and those reasons live in the topic docs (e.g., the persistent task pool's children-as-vehicle dodge for SceneGraph event coalescing is in [`api.md`](./api.md), the DoVi `buffer:loop:` retry is in [`playback.md`](./playback.md)).
- **Filing a GitHub issue?** Reference the slug in the title and link from the issue back to this entry. Add the issue number to the entry's `github` field here.
- **Fixing an entry?** Remove the entry from this file in the same PR. The git history of this file becomes the audit trail of what got fixed when.

### Citing a slug from another doc / comment

Use the **anchor-link form**, not narrative prose:

```markdown
[`manual-theme-cascade`](../../docs/architecture/tech-debt.md#manual-theme-cascade)
```

In code comments / diagnostic strings (where markdown won't render), use the bare anchor: `tech-debt.md#manual-theme-cascade`.

The `npm run lint:docs` checker validates every `tech-debt.md#<anchor>` reference against the actual headings in this file, so deleting a slug catches stale references at push time. Naked narrative mentions like `` `manual-theme-cascade` `` (no anchor) are not checked — there's no syntactic signal to distinguish them from any other backtick-wrapped kebab-case identifier — so the convention exists to keep the check bulletproof. If you find yourself mentioning a slug, link it.

## Severity rubric

- **High** — meaningful complexity costs; fixing genuinely improves agent + human DX. Worth scheduling.
- **Medium** — worth refactoring when adjacent (touch the area for any reason → fix in passing).
- **Low** — minor irritants, low blast radius. Often quirks with rationale; fix only if the surrounding work makes it cheap.

## Refactor candidates

### High

#### `itemdetails-size`

- **area**: `components/ItemDetails.bs`
- **issue**: Single file handles every item type (movies, episodes, series, seasons, audio, photos, live TV programs, recordings). Long `onKeyEvent` with many key handlers. Extras pane animation logic mixed with data loading.
- **direction**: Split per item-type renderer (`PopulateInfoGroupMovie`, `Series`, `Episode`, `Music` etc. as separate modules). Extract the extras pane and metadata renderer into their own components.

#### `videoplayerview-size`

- **area**: `components/video/VideoPlayerView.bs`
- **issue**: Mixes native `Video` event handling, OSD orchestration, trickplay, transcoding, DoVi fallback, subtitle management, audio track switching, chapter navigation, and Jellyfin reporting in one component.
- **direction**: Extract subsystems: `SubtitleController`, `ChapterController`, `TranscodeRecoveryHandler`. Keep the player class focused on lifecycle + observers.

#### `mainbs-event-loop-fan-out`

- **area**: `source/main.bs`
- **issue**: Bootstrap + main event loop in one file. Event loop handles many distinct event types: playback, favorites toggle, watched toggle, voice search, quickplay dispatch, font download completion, screen lifecycle.
- **direction**: Extract per-concern handler modules; main loop dispatches to them by event name.

### Medium

#### `showscenes-mixes-concerns`

- **area**: `source/showScenes.bs`
- **issue**: `LoginFlow()` plus a dozen `Create*Group()` scene factories live in one file.
- **direction**: Split into `source/auth/LoginFlow.bs` and `source/screens/<Name>Page.bs`.

#### `per-method-v1-v2-routing`

- **area**: `source/api/ApiClient.bs`
- **issue**: Adding a third API version means editing every `Build*Request()` method. The conditional shape repeats per method.
- **direction**: Centralize via a routing table — `{ "GetItem": { v1: "/users/{userId}/items/{id}", v2: "/Items/{id}" }, ... }`. Build methods read from the table instead of branching inline.

#### `loginflow-error-boundaries`

- **area**: `source/showScenes.bs` (LoginFlow) and elsewhere
- **issue**: Network failures in `LoginFlow` may leave app in inconsistent state; minimal retry/recovery semantics.
- **direction**: Define a small set of error categories (network unreachable, auth failed, server error) and a corresponding recovery flow per category.

#### `manual-theme-cascade`

- **area**: `source/utils/globals.bs`, settings flow
- **issue**: Settings change → `applyThemeColorOverrides` → `refreshThemeColors` → `reloadHome` is a manual chain. Components that cache theme colors at construction time miss updates without a rebuild.
- **direction**: Either (a) all components read from `m.global.constants` in event handlers (not init), or (b) define a "theme observable" that nodes can opt into.

### Low

#### `quickplaynode-set-then-clear`

- **area**: `components/ItemDetails.bs`, `source/main.bs`
- **issue**: Single-shot event idiom — unfamiliar to first-time readers. See `user-journey.md` for the canonical explanation.

#### `loginflow-goto-retry`

- **area**: `source/showScenes.bs`
- **issue**: `goto startLogin` and `goto userSelect` for auth retry. Old-school but readable.

#### `osd-inactivity-timeout-hardcoded`

- **area**: `components/video/VideoPlayerView.xml`
- **issue**: The OSD instance is declared with `inactiveTimeout="5"` (a literal). `OSD.xml` itself only declares the field — the value is set by the parent. Should be a named constant.

#### `no-now-playing-queue-ui`

- **area**: `components/ItemDetails`, `QueueManager`
- **issue**: "Play next" routes through `ItemDetails → quickPlayNode` each time; no "now playing queue" sidebar to see upcoming items without going to the player.

#### `scenemanager-stack-unbounded`

- **area**: `components/data/SceneManager.bs`
- **issue**: Stack array has no cap. Buggy push-without-pop loops would leak indefinitely.

#### `selecteditem-bubbling-implicit`

- **area**: `components/home/Home.xml`, `components/ItemDetails.xml`, …
- **issue**: Implicit contract — every level declares the field with `alwaysNotify` and trusts the level above. Tracing a click to its handler requires walking the tree.

#### `printregistry-on-startup`

- **area**: `source/main.bs`
- **issue**: `printRegistry()` runs unconditionally; noisy in prod logs unless filtered by level.

#### `appstart-label-restart`

- **area**: `source/main.bs`
- **issue**: `goto appStart` for "log out and start over". Works fine, but unusual pattern today.

#### `m-wasmigrated-global-flag`

- **area**: `source/migrations.bs`, `source/main.bs`
- **issue**: Communicates via the implicit `m` AA between functions.

#### `plural-forms-zero-one-many-only`

- **area**: `source/utils/translate.bs`
- **issue**: No support for languages with more than three plural forms (Polish, Russian, Arabic).

#### `settings-auto-sync-coupling`

- **area**: `JellyfinUserSettings.bs`
- **issue**: Auto-sync depends on field names matching registry keys exactly. A field rename without a migration breaks this silently.

#### `valuetostring-lossy`

- **area**: `source/utils/config.bs`
- **issue**: Registry stores all values as strings. A `"True"` typo doesn't fail-fast.

#### `trickplay-prefetch-hardcoded`

- **area**: `components/video/TrickplayCarousel.bs`
- **issue**: Tile pre-fetch range is hardcoded. Should be a constant, possibly user-configurable.

#### `api-timeout-single-value`

- **area**: `source/constants/timeouts.bs`
- **issue**: `timeouts.API_WAIT_MS` is one value for all API calls regardless of operation. A long search and a quick favorite toggle have the same patience.

#### `jrscreen-init-initializes-log-manager`

- **area**: `components/JRScreen.bs`
- **issue**: Unusual coupling — global resource initialized in a screen lifecycle hook. Re-init is no-op so it works, but design assumes `JRScreen.init` runs before any other component's `init`.

#### `testtoast-in-production-builds`

- **area**: `components/JRScene.xml`
- **issue**: `testToast` field is not gated by `#if debug`. Field exists always; only the cheat code is debug-gated.

#### `dialog-returndata-shared-global`

- **area**: `components/data/SceneManager.bs`
- **issue**: All dialogs write to the same `returnData` field. Risk of cross-dialog observers firing on stale data.

#### `bsconfig-files-duplicated`

- **area**: repo root
- **issue**: Multiple `bsconfig*.json` files mostly copy each other with a few overrides. A common base + overlay would be cleaner, but `BSC`'s config schema doesn't support inheritance.

#### `no-request-cancellation`

- **area**: `source/api/apiPool.bs`
- **issue**: A `submitApiRequest` that's no longer needed completes anyway and fires its callback. Most callers handle this defensively in the callback.

#### `legacy-print-statements`

- **area**: 16 component `.bs` files (`components/api/*Task.bs`, `components/tasks/*Task.bs`, `components/ui/**`, `components/Buttons/JRButtons.bs`, `components/home/HomeRows.bs`, `components/search/SearchResults.bs`, `components/video/VideoPlayerView.bs`) plus `source/data/JellyfinDataTransformer.bs`.
- **issue**: ~36 raw `print` statements in places that *could* use `m.log.*` (component methods + class methods). Production builds can't strip them, so they reach the device log unconditionally.
- **direction**: For each file, add `import "pkg:/source/roku_modules/log/LogMixin.brs"` + `m.log = new log.Logger("…")` in `init()` (or the class constructor) and convert each `print` to the appropriate `m.log.{warn,error,info,debug}` level. Files are currently flagged with a `' bsc-disable-file print-locations` header that points back here.
- **enforced**: `scripts/bsc-plugin-print-locations.cjs` flags every new `print` outside `source/main.bs` / `globals.bs` debug-block, with smart skipping for free functions in `source/` (no `m` context available there). Existing legacy sites are opted out; the plugin still catches new violations in clean files.

#### `e2e-folder-empty`

- **area**: `tests/source/e2e/`
- **issue**: RTA-based UI automation was planned, hasn't materialized. Real coverage today is unit + integration only.

## Recently removed — don't go searching for these

- **`components/JRVideo.xml/.bs`** and **`source/VideoPlayer.bs`** — the legacy video player. Removed in commit `17cc374f` ("chore: remove legacy video player code"). Replaced by `components/video/VideoPlayerView.xml/.bs`. There is exactly one video player today.
- **`CreateVideoPlayerGroup()`** function from `source/showScenes.bs` — removed alongside the legacy player. The modern equivalent is `ViewCreator.CreateVideoPlayerView()`.
- **Various legacy subtitle helper functions** (`setupSubtitle`, `getSubtitleSelIdxFromSubIdx`) — removed in followup cleanup commits (e.g. `58500a99`).
- **`components/ItemOptions.xml/.bs`** and **`components/movies/{Audio,Video}TrackList{Data,Item}`** — the modal Video/Audio tab popup the inline `TrackDropdown` cluster has now replaced. Removed in commit `f4ac1069` ("chore: remove obsolete `ItemOptions` popup and movies track-list components"). The empty `components/movies/` folder was removed along with them.
