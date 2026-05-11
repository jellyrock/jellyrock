---
topic: tech-debt
related-files: []  # touches everything; per-item area fields point to specific files
last-reviewed: 2026-05-10
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
- **issue**: Single file handles **16 distinct item types** via per-type `populateInfoGroup<Type>` renderers (Movie, MusicVideo, Episode, Series, BoxSet, Season, Person, MusicArtist, MusicAlbum, Playlist, Audio, Photo, PhotoAlbum, TvChannel, Program, Recording). 3,600+ lines, ~90 top-level functions, 100+ line `onKeyEvent`. Extras pane animation logic (grid + gradient overlay + slide interpolators) interleaved with Task-result handlers; the inline `TrackDropdown` cluster (~20 functions for pre-playback audio/subtitle/source selection) is also embedded here.
- **direction**: Split per item-type renderer (`populateInfoGroupMovie`, `populateInfoGroupSeries`, etc.) into separate modules under `source/details/` or `components/details/`. Extract: (a) the extras pane (animation + grid + gradient overlay) into its own component, (b) the `TrackDropdown` cluster into its own component (already self-contained — wire via fields), (c) the resume button + logo/date-label clusters as smaller helpers. `onKeyEvent` shrinks naturally as each subsystem owns its own focus / key handling.

#### `videoplayerview-size`

- **area**: `components/video/VideoPlayerView.bs`
- **issue**: 1,883 lines, 57 top-level functions, 133-line `onKeyEvent`. Mixes native `Video` event handling, the playback state machine (`onState`), OSD action dispatch, trickplay, transcoding decisions, the DoVi `buffer:loop:` retry flow, subtitle management (~8 fns), chapter navigation (~4 fns), audio/source track switching (~4 fns), next-episode + media-segment notifications (~10 fns — the largest embedded subsystem), Live TV / DVR-recording mode (~8 fns: channel switching, EPG refresh, live-edge math), and Jellyfin reporting.
- **direction**: Extract subsystem controllers, each owning its own observers + key handling: `SubtitleController` (~8 fns), `ChapterController` (~4 fns), `TranscodeRecoveryHandler` (DoVi retry + error dialog + force-finish, ~6 fns), `NotificationController` (next-episode + media segments, ~10 fns), `LiveTvController` (~8 fns — trickiest because it couples tightly with the underlying `Video` state machine; extract last). The player class is left with lifecycle, state-machine observation, OSD dispatch, audio/source switching, trickplay UI sync, and reporting.

#### `mainbs-event-loop-fan-out`

- **area**: `source/main.bs`
- **issue**: 1,315-line file. `Main()` is ~970 lines containing both bootstrap (~80 lines: Phase 1 globals → migrations → theme → login → Phase 2 globals) and the main event loop (20+ `isNodeEvent` dispatch branches: playback, favorites/watched toggles, voice search, quickplay, font download completion, screen lifecycle / exit / `goto appStart`, search, item selection, button + option events, dialog return data, recording, shuffle, theme reload cascade). Some heavy work is already extracted into `handle*` helpers (font, quickplay, favorite, watched, record); the dispatch and most branch logic still live inline.
- **direction**: Continue the handler-extraction pattern — each `isNodeEvent` branch routes to a per-concern module (`source/handlers/playback.bs`, `search.bs`, `selection.bs`, `dialogs.bs`, etc.). The main loop becomes a thin dispatcher. Bootstrap extracts to `source/bootstrap.bs` so `Main()` is just `bootstrap()` + the dispatch loop.

### Medium

#### `showscenes-mixes-concerns`

- **area**: `source/showScenes.bs`
- **issue**: 702-line file with three concerns: a 230-line `LoginFlow()` state machine, 7 scene factories (`CreateServerGroup`, `CreateUserSelectGroup`, `CreateSigninGroup`, `CreateHomeGroup`, `CreateItemDetailsGroup`, `CreateSearchPage`, plus `playbackOptionDialog`), and three server-list registry utilities (`SaveServerList`, `DeleteFromServerList`, `SendPerformanceBeacon`).
- **direction**: Split into `source/auth/LoginFlow.bs` (the login state machine), `source/screens/<Name>Page.bs` (one factory per scene), and `source/utils/serverList.bs` (registry helpers).

#### `loginflow-error-boundaries`

- **area**: `source/showScenes.bs` (`LoginFlow`) and elsewhere
- **issue**: ~230-line `LoginFlow()` collapses every failure mode (server unreachable, server returned error, invalid/expired token, auth failed, password required) into `goto startLogin` / `goto userSelect`. No category-specific recovery — a transient network blip and a permanent auth failure both bounce the user back to server selection, losing their position in the flow.
- **direction**: Define a small set of error categories (network unreachable, server returned error, auth failed, token invalid) and a corresponding recovery flow per category. Network blips should retry-with-backoff; auth failures should drop into the user picker, not the server picker; token invalid should re-prompt for password without losing the server context.

#### `manual-theme-cascade`

- **area**: `source/utils/globals.bs` (`applyThemeColorOverrides`), `components/data/SceneManager.bs` (`refreshThemeColors`, `reloadHome`), call sites in `components/settings/settings.bs:763-766` and `source/utils/session.bs:463-464,488`.
- **issue**: Settings change → `applyThemeColorOverrides` (writes to `m.global.constants`) → `sceneManager.callFunc("refreshThemeColors")` (re-applies styles) → `sceneManager.callFunc("reloadHome")` (rebuilds home rows) is a 3-step manual chain that every theme-changing call site must invoke in order. Components that cache theme colors at construction time miss updates entirely unless the home is rebuilt.
- **direction**: Either (a) all components read from `m.global.constants` in event handlers (not `init`), or (b) define a "theme observable" — a node on `m.global` whose updates fire observers — that components opt into instead of relying on `reloadHome` as a blunt rebuild.

#### `migrate-grids-to-jrplaceholder`

- **area**: [`components/ItemGrid/GridItem.bs`](../../components/ItemGrid/GridItem.bs) (`onPosterLoadStatusChanged`), [`components/ItemGrid/GridItemSmall.bs`](../../components/ItemGrid/GridItemSmall.bs) (same), [`components/ItemGrid/MusicArtistGridItem.bs`](../../components/ItemGrid/MusicArtistGridItem.bs) (custom fallback at lines 51-76), [`components/music/AudioPlayerView.bs`](../../components/music/AudioPlayerView.bs) (`setPosterImage` fallback at lines 571 / 612 / 630), and [`resources/icons/icons.json`](../../resources/icons/icons.json) (the large-canvas overrides for `album` / `missingArtist` / `musicFolder` exist solely to support these grid fallbacks).
- **issue**: PR #561 introduced [`components/ui/placeholder/JRPlaceholder.xml/.bs`](../../components/ui/placeholder/JRPlaceholder.xml) as the canonical themed-card + glyph fallback component and migrated `JRRowItem` to use it. Other surfaces still have ad-hoc placeholder logic with three real divergences from the canonical pattern: (1) `GridItem` and `GridItemSmall` show a themed backdrop only — **no glyph** on load failure, even though `JRPlaceholder` would surface a type-appropriate one; (2) `MusicArtistGridItem` tints its fallback glyph with `colorTextSecondary`, not `colorBackgroundPrimary` — visible drift from the rest of the app; (3) `AudioPlayerView`'s music poster fallback loads the icon-set `album_$$RES$$.png` directly, bypassing `getPlaceholderImagePath`. The icon overrides for `album` (450/382), `missingArtist` (512/256), and `musicFolder` (256/256) in `icons.json` exist only because these grids load icon URIs at placeholder dimensions; once they migrate to `pkg:/images/placeholders/<name>_$$RES$$.png` the icon-set entries shrink to default 96/54 (or, for `missingArtist` / `musicFolder`, the SVGs become placeholder-only sources renamed to `_filled.svg`).
- **direction**: For each grid, replace the inline `m.itemPoster` fallback pattern with a `<JRPlaceholder>` sibling node sized to the cell. `MusicArtistGridItem` needs a deliberate visual review on hardware to decide whether the existing `colorTextSecondary` tint was intentional or a bug — the migration locks in `colorBackgroundPrimary` per the canonical pattern. After migration: switch `AudioPlayerView`'s three fallback callsites to `getPlaceholderImagePath("MusicAlbum")` (returns `pkg:/images/placeholders/album_$$RES$$.png`); shrink `album` in `icons.json` to default; rename `missingArtist.svg` and `musicFolder.svg` to the `_filled.svg` placeholder-only convention; remove the corresponding icons.json overrides. Out of scope for PR #561 because each grid carries nuance (glyph-vs-no-glyph, tint discrepancy, sizing assumptions in `loadDisplayMode="limitSize"` paths) that warrants a focused visual-audit pass per surface.

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

#### `no-active-player-abstraction`

- **area**: `components/video/VideoPlayerView.bs`, `components/music/AudioPlayerView.bs`, `components/mediaPlayers/AudioPlayer.bs`
- **issue**: Audio (`m.global.audioPlayer`, a persistent global) and video (`VideoPlayerView`, a scene-stack screen) have no shared "active player" interface. Cross-cutting code that wants to control whatever is currently playing has to branch on player type — query `m.global.audioPlayer.state` for audio, or walk the scene stack to find a `VideoPlayerView` for video. Adds friction to features like a universal pause or a "now playing" indicator.
- **direction**: Add a thin `m.global.activePlayer` reference (or an `IPlayer` interface) that points to whichever player is active. Both components publish to it on play/destroy; cross-cutting code reads from there instead of branching on type.

#### `api-timeout-single-value`

- **area**: `source/constants/timeouts.bs`
- **issue**: `timeouts.API_WAIT_MS` is one value for all API calls regardless of operation. A long search and a quick favorite toggle have the same patience.

#### `per-method-v1-v2-routing`

- **area**: `source/api/ApiClient.bs`
- **issue**: 14 of 49 `Build*Request()` methods have inline `if m.getApiVersion() >= 2` branches; the conditional shape repeats per affected method. Adding a third API version means editing each of those 14 methods (the other 35 endpoints share a single code path because their path didn't change between server versions, so they're unaffected).
- **direction**: Centralize via a routing table — `{ "GetItem": { v1: "/users/{userId}/items/{id}", v2: "/Items/{id}" }, ... }`. The 14 version-aware methods read from the table instead of branching inline; the other 35 stay as-is. Low-priority until `V3` is on the roadmap — adjacent work.

#### `apiclient-sync-pool-coexistence`

- **area**: `source/api/ApiClient.bs`, `source/api/sdk.bs`
- **issue**: A handful of sync methods (`AuthenticateByName`, `AuthenticateWithQuickConnect`, `InitiateQuickConnect`, `ConnectQuickConnect`, `GetUser`, `GetPublicUsers`, `GetConfigurationByName`, `GetDisplayPreferences`) still route through the legacy `sdk.*` namespace because the persistent task pool isn't available pre-login. Everything else uses the async `Build*Request()` pattern. New endpoints should be pool-only; the bootstrap path is the surviving exception. (`GetImageURL` / `GetUserImageURL` are URL builders rather than HTTP calls and don't share this concern.)
- **direction**: Make the persistent task pool available pre-login — only the auth header injection needs to be deferred until a token exists. Then migrate the bootstrap sync methods to the pool and remove direct `sdk.*` usage from `ApiClient`.

#### `buildparams-no-array-support`

- **area**: `source/api/baseRequest.bs` (`buildParams`)
- **issue**: `buildParams` skips `roArray` values silently — there's a `' TODO handle array params` placeholder branch with no implementation. Callers that need to pass arrays as query parameters (e.g., comma-separated `Fields=` lists) join the array into a string before calling.
- **direction**: Implement array handling per the actual server-side conventions used by Jellyfin (most array params are comma-separated; some use repeated keys). Then audit callers to remove the workarounds where each call site joins arrays into strings before invoking.

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

#### `mixed-esm-cjs-scripts`

- **area**: `scripts/` (top-level, excluding `bsc-plugins/` and `lib/`)
- **issue**: Top-level `scripts/*.js` are ESM (4: `catchup-state.js`, `changelog-syncer.js`, `journal-sync.js`, `run-roku-tests.js`); the other 4 top-level scripts are `.cjs`. `scripts/lint/` (10 scripts) and `scripts/lib/` (4 scripts) are all `.cjs`. `package.json` has `"type": "module"`, so ESM is the modern default for new code. Forward rule for net-new scripts is documented (ESM `.js` unless `require()`'d), but the existing `.cjs` files in `lint/` and `lib/` are kept for now.
- **direction**: Audit the require-graph first. Anything `require()`'d by a BSC plugin or another locked CJS file (incl. `scripts/lib/*` callers) is forced `.cjs`. Top-level CLI scripts that aren't required by anything are migrate-able to ESM `.js`. Mechanical conversion (`require` → `import`, `module.exports` → `export`, `__dirname` → `fileURLToPath(import.meta.url)`), but needs the audit first because some scripts that look standalone are actually required by lint-staged or other CJS callers.
- **enforced**: [`scripts/CLAUDE.md`](../../scripts/CLAUDE.md) documents the forward rule; [`docs/dev/scripts-development.md`](../dev/scripts-development.md) covers the gotchas. ESLint's `eslint-plugin-n` `flat/mixed-esm-and-cjs` preset handles both extensions transparently.

#### `roku-log-guard-without-pkgpath-recurses`

- **area**: `scripts/bsc-plugins/roku-log.cjs`
- **issue**: The plugin's `visitedLines` dedup is set inside the `insertPkgPath` branch, so it never fires when `guard: true, insertPkgPath: false`. With that combination, wrapping the call in a fresh `IfStatement` causes the BSC AST walker to re-enter the inner `ExpressionStatement`, hit the same visitor, wrap again, and recurse until BSC's plugin error handler catches the `RangeError`. The first edit completes so output looks correct, but it's masked corruption. Production never hits this — defaults are `guard: false`; prod uses `strip: true` (which short-circuits before the guard branch).
- **direction**: Move `visitedLines[range.start.line] = true` out of the `insertPkgPath` block so it's always set when an `m.log.*` call is visited, regardless of which transform fires. The `tests/scripts/unit/bsc-plugins/roku-log.test.js` guard scenario currently combines `guard + insertPkgPath` to dodge the bug; removing that workaround will catch any future regression of the fix.

#### `make-npm-overlap`

- **area**: `Makefile`, `package.json`
- **issue**: Makefile has 11 targets that mostly duplicate npm scripts (build, lint, test, format). Both routes are maintained in parallel; new contributors don't know which is canonical.
- **direction**: Pick one as canonical (npm scripts are the more cross-platform choice; Makefile is occasionally useful for orchestrating multi-step shell flows). Either delete the duplicates from the other or document one as primary and the other as a thin wrapper.

#### `changelog-syncer-mixes-validate-mutate`

- **area**: `scripts/changelog-syncer.js`
- **issue**: Same script provides both `validate()` (read-only) and `syncUnreleased()` / `syncRelease()` (writes the file). A failing `validate` run could be fixed by a `sync` run that then changes things — `validate` doesn't behave like a query when it's adjacent to a mutation in the same module.
- **direction**: Split into separate read-only and write entry points (e.g., `scripts/changelog-validate.cjs` + `scripts/changelog-sync.cjs`), or keep one entry point but make the validate vs sync subcommands clearly distinct in CLI surface.

#### `no-request-cancellation`

- **area**: `source/api/apiPool.bs`
- **issue**: A `submitApiRequest` that's no longer needed completes anyway and fires its callback. Most callers handle this defensively in the callback.

#### `legacy-print-statements`

- **area**: 16 component `.bs` files (`components/api/*Task.bs`, `components/tasks/*Task.bs`, `components/ui/**`, `components/Buttons/JRButtons.bs`, `components/home/HomeRows.bs`, `components/search/SearchResults.bs`, `components/video/VideoPlayerView.bs`) plus `source/data/JellyfinDataTransformer.bs`.
- **issue**: ~36 raw `print` statements in places that *could* use `m.log.*` (component methods + class methods). Production builds can't strip them, so they reach the device log unconditionally.
- **direction**: For each file, add `import "pkg:/source/roku_modules/log/LogMixin.brs"` + `m.log = new log.Logger("…")` in `init()` (or the class constructor) and convert each `print` to the appropriate `m.log.{warn,error,info,debug}` level. Files are currently flagged with a `' bsc-disable-file print-locations` header that points back here.
- **enforced**: `scripts/bsc-plugins/print-locations.cjs` flags every new `print` outside `source/main.bs` / `globals.bs` debug-block, with smart skipping for free functions in `source/` (no `m` context available there). Existing legacy sites are opted out; the plugin still catches new violations in clean files.

#### `e2e-folder-empty`

- **area**: `tests/source/e2e/`
- **issue**: RTA-based UI automation was planned, hasn't materialized. Real coverage today is unit + integration only.

#### `tokenize-stopwords-duplicated`

- **area**: `scripts/journal-sync.js`, `scripts/lint/progress-cursor-nudge.cjs`
- **issue**: `tokenize()` and the 50-word `STOPWORDS` set are copy-pasted between the two files. `journal-sync.js` is ESM; `progress-cursor-nudge.cjs` is CJS — CJS cannot `require()` ESM, which forced the copy at write time. A stopword addition or tokenizer fix must be applied in both places.
- **direction**: Extract to `scripts/lib/tokenize.cjs`. Both callers `require()` it: `progress-cursor-nudge.cjs` via its existing `require()` chain; `journal-sync.js` via `createRequire(import.meta.url)` (same pattern it already uses for `frontmatter.cjs` and `signals-fetch.cjs`). Then remove the inline copies.

#### `journal-sync-workflow-injection`

- **area**: `.github/workflows/journal-sync.yml` (lines 72, 101)
- **issue**: PR title + number are interpolated into shell strings via `${{ github.event.pull_request.title }}` inside a `run:` block. A title containing `'` breaks the single-quoted shell assignment on line 72; a title containing `"` or backticks breaks the `git commit -m "..."` on line 101. GitHub Actions docs classify this as script injection.
- **direction**: Move the interpolations into `env:` fields on the step and reference them as `$PR_TITLE` / `$PR_NUMBER` inside the shell. The `env:` block is not shell-parsed, so no quoting escape is needed.

#### `hd-native-layout-refactor`

- **area**: every `.bs` / `.brs` / `.xml` file with hardcoded `1920` or `1080` layout coordinates (~223 sites at last count), plus [`manifest`](../../manifest)
- **issue**: Issue #419 wanted native HD bitmap rendering on 720p devices to fix the lossy automatic downsampling of icons / spinners / OSD glyphs. Phase 1 (the `feat(icons)` commit on this branch) shipped the asset pipeline (`uri_resolution_autosub` + per-resolution PNGs + the `icons:add` / `icons:build` scripts) but cannot yet declare `ui_resolutions=hd,fhd` — that declaration tells Roku the app has hand-tuned layouts for both design spaces and disables the FHD→HD autoscale. JellyRock has only one layout, designed against hardcoded `1920` / `1080` values; declaring both resolutions causes `1920`-wide elements to overflow the `1280`-wide HD viewport (verified empirically — see PR thread). With `ui_resolutions=fhd` (current), the OS holds rendering at FHD design space and the HD asset triples we ship are loaded into Posters sized at FHD where they're then downsampled by the framebuffer like everything else. The Phase 1 infrastructure is durable and will start delivering native HD bitmap quality the moment this refactor lands.
- **direction**: Convert every hardcoded `1920` / `1080` layout coordinate to a runtime read from `m.global.device.uiResolution` (already populated at bootstrap in [`source/utils/globals.bs`](../../source/utils/globals.bs)). XML literals like `width="1920"` need to become BS-side `init()` assignments. Safe-zone math (`* 0.05`, `* 0.95`, `- 96`, `- 54`) needs the same treatment, ideally consolidated into a `source/constants/screenLayout.bs` module so the call sites read `safezone.RIGHT` instead of recomputing. Once every layout site is device-aware, change `ui_resolutions=fhd` → `ui_resolutions=hd,fhd` and verify on hardware at both resolutions. Speculative alternative not yet investigated: a top-level `scale` field on the root scene could effect FHD→HD scaling at the application level instead of refactoring every coordinate — would let autosub deliver value without touching layouts, but unclear how it interacts with focus, animations, and hit-testing.

#### `sd-resolution-native-support`

- **area**: `manifest`, `scripts/generate/icons-build.js`, `images/icons/*_sd.png`
- **issue**: Native SD assets aren't shipped (the `_sd` slot in `uri_resolution_autosub=$$RES$$,sd,hd,fhd` is reserved but unused) because correct rendering requires NTSC pixel-aspect-ratio handling — SD framebuffer pixels are non-square (720×480 with 8:9 or 32:27 SAR depending on 4:3 vs 16:9 output mode). A naive square-pixel SD render via sharp would produce horizontally-squished icons that may look worse than what the OS produces by auto-scaling. Blocked on [`hd-native-layout-refactor`](#hd-native-layout-refactor) anyway — until that lands, native SD assets share the same fate as native HD ones (loaded into Posters sized at FHD with no per-device-resolution win).
- **direction**: After `hd-native-layout-refactor` lands and SD becomes a meaningful target: extend `scripts/generate/icons-build.js` with a render path that compensates for the non-square SAR. Empirically verify on hardware: set Roku Display Type to `480p`, sideload, compare a candidate hand-authored SD asset against the OS-produced fallback. Ship native SD only if measurably better. If not, leave the `_sd` slot empty (autosub falls through to `hd` per Roku spec) and document the decision. Promote severity to Medium if SD-specific user reports surface.

## Recently removed — don't go searching for these

- **`components/JRVideo.xml/.bs`** and **`source/VideoPlayer.bs`** — the legacy video player. Removed in commit `17cc374f` ("chore: remove legacy video player code"). Replaced by `components/video/VideoPlayerView.xml/.bs`. There is exactly one video player today.
- **`CreateVideoPlayerGroup()`** function from `source/showScenes.bs` — removed alongside the legacy player. The modern equivalent is `ViewCreator.CreateVideoPlayerView()`.
- **Various legacy subtitle helper functions** (`setupSubtitle`, `getSubtitleSelIdxFromSubIdx`) — removed in followup cleanup commits (e.g. `58500a99`).
- **`components/ItemOptions.xml/.bs`** and **`components/movies/{Audio,Video}TrackList{Data,Item}`** — the modal Video/Audio tab popup the inline `TrackDropdown` cluster has now replaced. Removed in commit `f4ac1069` ("chore: remove obsolete `ItemOptions` popup and movies track-list components"). The empty `components/movies/` folder was removed along with them.
