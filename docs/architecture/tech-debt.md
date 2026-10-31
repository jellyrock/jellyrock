---
topic: tech-debt
related-files: []  # touches everything; per-item area fields point to specific files
last-reviewed: 2026-10-11
---

# Tech debt and cruft

A list of known debt, plus a "recently removed" list so nobody searches for code that is already gone.

For what is good and should not be casually reformed, read the relevant topic doc in [`docs/architecture/`](./README.md#topic-map). Each one explains its subsystem's design intent where the context is fresh.

Each entry has a stable slug for commits, PRs and GitHub issues. When a slug is filed as an issue, add the issue number as the entry's `github` field. When the work is done, remove the entry: the closed issue and this file's git history are the record.

## How to use this document

- **Considering a refactor?** Check this list first. If the area is here, the change is at least documented. Pick severity carefully: `low` items are often quirks with reasons.
- **Considering a major change to a clean subsystem?** Read its topic doc in [`docs/architecture/`](./README.md) first. The clean systems are clean for reasons the code alone does not show. For example, why the API pool hands results over as child nodes is in [`api.md`](./api.md#the-coalescing-problem-why-children-not-fields), and the Dolby Vision `buffer:loop:` retry is in [`playback.md`](./playback.md).
- **Filing a GitHub issue?** Put the slug in the title, link back to the entry, and add the issue number to its `github` field.
- **Fixing an entry?** Remove it in the same PR.

### Citing a slug from another doc or comment

Use the anchor-link form, not a bare mention:

```markdown
[`manual-theme-cascade`](../../docs/architecture/tech-debt.md#manual-theme-cascade)
```

In a code comment or a diagnostic string, where markdown does not render, use the bare anchor: `tech-debt.md#manual-theme-cascade`.

`npm run lint:docs` checks every `tech-debt.md#<anchor>` reference against this file's headings, so removing a slug catches stale references at push time. A bare `` `manual-theme-cascade` `` is not checked, because nothing tells it apart from any other kebab-case name in backticks. If you mention a slug, link it.

## Severity rubric

- **High**: the debt has real complexity costs, and fixing it improves the experience for people and agents working here. Worth scheduling.
- **Medium**: worth fixing when you are already in the area.
- **Low**: a minor irritant with a small blast radius, often a quirk with a reason. Fix it only when surrounding work makes it cheap.

## Refactor candidates

### High

#### `itemdetails-size`

- **area**: `components/ItemDetails.bs`
- **issue**: One file handles 16 item types through per-type `populateInfoGroup<Type>` renderers (Movie, MusicVideo, Episode, Series, BoxSet, Season, Person, MusicArtist, MusicAlbum, Playlist, Audio, Photo, PhotoAlbum, TvChannel, Program, Recording). It also holds the extras pane (grid, gradient overlay and slide animation), the inline `TrackDropdown` cluster for choosing audio, subtitle and source before playback (about 20 functions), and an `onKeyEvent` of over 100 lines. Count its functions with `grep -cE '^(sub|function) ' components/ItemDetails.bs`: the count roughly doubled between May and October 2026.
- **direction**: Split the per-type renderers into modules under `source/details/` or `components/details/`. Extract the extras pane into its own component, then the `TrackDropdown` cluster. That cluster is wired to `m.top` and to button-row focus (`pickTrackDropdownFromButtons`, `setTracksInLayout`), so give it a field interface first. Then pull the resume button and the logo and date-label clusters into small helpers. `onKeyEvent` shrinks as each part owns its own focus and keys. Doing this first also shrinks [`button-row-model`](#button-row-model).

#### `videoplayerview-size`

- **area**: `components/video/VideoPlayerView.bs`
- **issue**: The player mixes native `Video` event handling, the playback state machine (`onState`), OSD action dispatch, trickplay, transcoding decisions, the Dolby Vision `buffer:loop:` retry and these embedded subsystems:
  - subtitles (about 8 functions)
  - chapters (4)
  - audio and source switching (4 or 5)
  - next-episode and media-segment notifications (about 11)
  - Live TV and recordings: channel switching, guide refresh, live-edge math (about 10)
  - voice and remote transport: `handleTransport`, seeks, next and previous item, `announceNowPlaying`, `setFavorite` (about 10)
  - the playback-error dialog and its diagnostics (11, from `showPlaybackErrorDialog` to `parkPlayerAfterSupersede`). Its pure logic lives in [`playbackErrorInfo.bs`](../../source/utils/playbackErrorInfo.bs); presentation and teardown stayed here.
- **direction**: Extract controllers that each own their observers and keys: `SubtitleController`, `ChapterController`, a `TranscodeRecoveryHandler` (Dolby Vision retry, error dialog, force-finish), a `NotificationController` (next episode and media segments), a transport handler, and a `LiveTvController`. Extract Live TV last, because it is tied most closely to the `Video` state machine. The player keeps its lifecycle, state observation, OSD dispatch, audio and source switching, trickplay sync and reporting.

#### `mainbs-event-loop-fan-out`

- **area**: `source/main.bs`
- **issue**: `Main()` holds both the bootstrap and the main event loop. The bootstrap runs `setGlobals()`, loads translations and defaults, runs migrations, creates `JRScene`, runs `setGlobalNodes()`, wires the port observers, stashes a launch deep link, then calls `reenterLogin()`. The loop handles screen close, `exit`, `preLoginIntent`, `isFontDownloadCompleted`, `reachable`, `userMenuAction`, `roDeviceInfoEvent`, `roInputEvent` (a deep link, or voice transport through `remoteDispatch.dispatchTransport`), `result`, `dispatchCommand` and `reloadHomeRequested`. Some heavy work is in helpers (`handleFontDownloadCompletion`, `handleMenuAction`, and `handlePreLoginIntent` in `loginRouter.bs`). The `result` branch is one line that hands off to `onServerSwitchDialogResult`, which holds the identity check that keeps a second main-thread dialog safe.
- **direction**: Extract the bootstrap into `source/bootstrap.bs`, so `Main()` becomes `bootstrap()` plus a thin dispatch loop. Do not build a `source/handlers/dialogs.bs` dialog registry: with one main-thread dialog there is nothing to fan out. Revisit that only if a second main-thread flow starts observing `result` on the port.

#### `task-thread-budget`

- **area**: Task components (26 shipped types, plus two test probes and the vendored `WebSocketClient`; find them with `git grep -l 'extends="Task"' -- components`), [`source/utils/tasks.bs`](../../source/utils/tasks.bs) (the launch ledger, `TASK_THREAD_WATERMARK`, the launch queue), [`components/tasks/TaskLaunchQueue.bs`](../../components/tasks/TaskLaunchQueue.bs), and `source/main.bs`.
- **github**: #728 (the `&h29` "Too many task threads" crash epic, closed 2026-08-21)
- **issue**: Roku caps an app's concurrent Task threads; ADR 0031 records 50 as the console warning and 100 as the cap. JellyRock runs a fixed floor of persistent tasks: the `ApiTask` pool ([sized per device class](api.md#pool-width)), the `ApiQueueTask` coordinator, `SideEffectTask` and `RemoteControlTask` (with a nested `WebSocketClient` on the `ws://` path). `FontDownloadTask` and `FontScalingTask` are conditional and short-lived. Transient per-screen tasks spawn on top during navigation. #728's fan-out is fixed, and two guards now cover that shape:
  - At compile time, [`no-task-fanout.cjs`](../../scripts/bsc-plugins/no-task-fanout.cjs) makes a `launchTask()` inside a loop an error, following a same-file helper one hop (decision `task-fanout-follows-helpers`).
  - At runtime, `launchTask()` queues a launch above the watermark instead of starting it ([ADR 0031](../adr/0031-task-thread-ceiling.md), [ADR 0041](../adr/0041-task-launch-queue.md)). The pre-ship device gate is [`task-thread-peak.spec.js`](../../tests/rta/specs/task-thread-peak.spec.js). Measured peaks are in ADR 0031 and [ADR 0036](../adr/0036-api-pool-width-by-device-class.md).

  Neither guard sees repetition driven by a timer or an observer. That shape is churn, not concurrency: the Quick Connect poll before #847 built a Task every tick but ran one at a time (the #847 commit has the detail). The next timer-driven launch will not be caught.
- **direction**: Audit the persistent floor and keep it small; `source/api/CLAUDE.md` says not to change the pool width without measuring on a device. `JRButtons`' `TextSizeTask` exists because `roFontRegistry` was believed render-thread-forbidden; [`threading.md`](threading.md#a-correction-worth-keeping) shows it is not, so check whether that task can go. The other half, auditing each routed screen's `onDestroy` for complete release of its Task nodes, was done read-only on 2026-10-13 and found no gap: every Task node a component with an `onDestroy` stores is released there or in a helper it calls, and every host calls its children's `onDestroy` (the overhang's `JRTabBar` and `JRDropdown` are never destroyed, since the overhang lives for the app).

#### `no-lint-for-mlog-without-logger`

- **area**: [`scripts/lint/log-manager-init-check.js`](../../scripts/lint/log-manager-init-check.js), [`scripts/bsc-plugins/`](../../scripts/bsc-plugins/), any codebehind calling `m.log.*`
- **issue**: Two log-call mistakes pass `npm run validate` and fault on the device:
  - **A call with no Logger.** A component can call `m.log.warn(...)` without ever building a Logger. `m.log` is then `invalid`, and the call faults with `&hf3` ("Interface not a member of BrightScript Component"). `lint:log-manager-init` checks only that the manager is set up in `JRScene.init`. This hides on rare branches, such as error handling. `HomeRows` shipped one (fixed in `fd54e38e3`).
  - **Too many arguments.** `Logger.info` takes 10 parameters, and the `roku-log` plugin spends one on the injected package path, so a call may pass at most nine. A tenth faults with `&hf1`, which drops the app into the debugger mid-load. That then looks like broken tooling: ODC reads time out and RTA reports "screen never loaded". It is a documented rule ([`source/CLAUDE.md`](../../source/CLAUDE.md)) that keeps being broken, which is the case for a gate.
- **direction**:
  - Add the argument check to [`roku-log.cjs`](../../scripts/bsc-plugins/roku-log.cjs) itself. It already walks every log call, holds the arguments and knows `insertPkgPath`. Gate at more than nine regardless of `insertPkgPath`: prod sets it false, but the fault shows on the dev builds people test with. The `transpile-with-plugin.js` harness and `roku-log.test.js` exist.
  - Add the missing-Logger check as a convention plugin in the `afterValidateFile` shape of [`no-direct-sdk.cjs`](../../scripts/bsc-plugins/no-direct-sdk.cjs). Flag `m.log.<level>(...)` in a file with no `m.log = new log.Logger(...)`, after resolving up the `extends` chain, since an ancestor's `init` may set it. The teardown plugins already walk `parentComponent`. Land it as a warning first to size the count.

  Followup `audit-claude-rules-vs-enforced` in [`progress.md`](../progress.md) sequences enforcement before doc tightening.

#### `rooibos-setup-not-per-test`

- **area**: spec files under [`tests/source/unit/`](../../tests/source/unit/) and [`tests/source/integration/`](../../tests/source/integration/) that build or mutate node state in `setup()`
- **github**: #786 (epic with the per-file checklist, refreshed 2026-10-13)
- **issue**: Rooibos runs `setup()` and `teardown()` once per `@describe` group, and `beforeEach()` and `afterEach()` once per test. A suite that builds a node in `setup()` and then mutates it lets each test inherit the last one's leftovers, so it passes on declaration order rather than isolation. The visible failure is the benign direction. The hazard is a test that never sets a field it depends on and passes on a neighbor's value, until someone reorders or deletes the neighbor. Of #786's 23 files on 2026-10-11, 20 still build in `setup()` (one is converted, two were deleted), and 7 files not on the list build there too.
- **direction**: Move construction and mutated state to `beforeEach()` (chaining `super.beforeEach()`) and cleanup to `afterEach()`; leave immutable per-suite fixtures in `setup()`. Audit rather than rewrite blind: a suite where every test sets every field it reads is already order-independent. The cheap check is to reverse the test order and re-run. Split by the epic's groups, one PR each. Prevention is already in [`tests/CLAUDE.md`](../../tests/CLAUDE.md).

#### `homerows-spec-asserts-nothing`

- **area**: the test bsconfig plugin lists ([`bsconfig-tests-unit.json`](../../bsconfig-tests-unit.json)), [`components/home/HomeRows.bs`](../../components/home/HomeRows.bs) (`buildSectionPlan`)
- **issue**: Two gaps are left from a suite that verified nothing. Its assertions were `m.assertTrue(true)`, and every test called an undeclared `callFunc`, which runs nothing and raises nothing ([`components/CLAUDE.md`](../../components/CLAUDE.md)). The assertions, the `<interface>` declaration and the per-test build are fixed. What is left: no test bsconfig loads the `callfunc-interface` plugin, and [`bsconfig.json`](../../bsconfig.json) does not include `tests/`, so the test build still cannot catch an undeclared `callFunc` in a spec. The #1010 caption teardown fix found the same class elsewhere. And `buildSectionPlan()` has no direct test: [`homeSlots.spec.bs`](../../tests/source/unit/utils/homeSlots.spec.bs) covers the slot count, the settings fields, `user.SaveUserHomeSections()` and `user.hasHomeSectionData()`.
- **direction**:
  - Add `callfunc-interface` to the test plugin lists, so an undeclared `callFunc` in a spec fails the build. That plugin list is the duplication [`bsconfig-files-duplicated`](#bsconfig-files-duplicated) tracks.
  - Add a plan-level case for `buildSectionPlan()` once the seam exists, or extract the plan builder into `source/` as a pure function.

### Medium

#### `homerows-geometry-invariant-ungated`

- **area**: [`components/home/HomeRows.bs`](../../components/home/HomeRows.bs) (`setRowItemSize`, `applyPendingRowRemovals`, `rowStructureChanged`), [`tests/rta/`](../../tests/rta/)
- **issue**: The row-size batching ([`home-row-size-recompute-per-row`](#home-row-size-recompute-per-row)) rests on an invariant no check enforces. The three geometry arrays (`rowItemSize`, `rowHeights`, `rowSpacings`) must describe the current row list at all times except inside the batch. Break it and rows below a removal draw at their neighbor's size, with no error, no log line and no timing change. That shipped once in development and was caught by a throwaway ODC probe. Focus is also unguarded: removals now land together at the end of a run, and `RowList` focus is by index, so dropping rows above the focused one shifts what the user points at. `populateRowFromData` already appends before it removes for this reason.
- **direction**: Promote the probe to a standing RTA assertion covering geometry and focus together. It must poll through the load, since the defect is a window, not an end state. It must also name which visible row is drawn at a size not its own: a length mismatch alone is not a defect, because a surplus entry can sit past the last row. The method is in [`home-first-paint-performance.md`](../dev/home-first-paint-performance.md). It is blocked on a fixture with several libraries that return no latest items. On 2026-08-10, `demo.jellyfin.org/stable` had one (`playlists`), and that would turn vacuous the day it gained an item. It also needs an `ENABLE_RTA` hold hook in [`LoadLatestRowsTask.bs`](../../components/home/LoadLatestRowsTask.bs), like `rtaSkeletonHoldMs` in `LoadItemsTask2`. The fixture question is open in followups `ws-deviceid-session-binding-ungated` and `rta-fixture-demo-server-undocumented` in [`progress.md`](../progress.md). RTA runs on release branches and by hand, so this would gate at release, not per PR.

#### `home-first-paint-scales-with-library-count`

- **area**: [`components/home/HomeRows.bs`](../../components/home/HomeRows.bs) (`populateRowFromData`, `insertLatestMediaSkeletons`), [`components/home/LoadLatestRowsTask.bs`](../../components/home/LoadLatestRowsTask.bs)
- **issue**: Home builds and attaches every latest row, one `appendChildren` per library, whether or not the user scrolls to it, so first paint grows linearly with the library count. The growth is per row, not per item. On a Streaming Stick 4K (measured 2026-08-09), render-side `attach` cost about 315 ms across 9 populated rows, about 35 ms a row. On a 512 MB Streaming Stick `3600X` (measured 2026-08-26, 3, 6 and 11 rows), `totalMs` went 1244, 2526, 3721: about 57 ms a row of `attach` and 104 ms of `notify`, the render-thread rendezvous. The per-row item limit (`uiHomeRowLimit`, default 32, maximum 100) barely moves it: decision `home-feeds-are-sized-worklists-are-not` has the sweep. The pipeline-budget half of this entry is fixed (decision `pipeline-budget-charges-wait-only`). A row whose fetch fails shows the retry tile.
- **direction**: Hydrate rows lazily by viewport: attach items only for rows in or near the visible range, fill the rest on scroll, and keep the skeleton rows as placeholders. Followup `genres-silently-truncates-at-100` names the same mechanism, so design them together. Do not shrink the per-row item count instead; that changes what the user sees, not when it is built. The single `rowItemSize` write per load also grows with rows (see [`home-row-size-recompute-per-row`](#home-row-size-recompute-per-row)), which is one more reason to size this work by rows. Treat any extrapolation to 100 libraries as an order of magnitude.

#### `log-level-welded-to-debug-const`

- **area**: [`components/JRScene.bs`](../../components/JRScene.bs) (the `initializeLogManager` call), the `manifest` `bs_const` line, [`scripts/harden-prod-manifest.js`](../../scripts/harden-prod-manifest.js)
- **issue**: The `debug` compile-time const picks the roku-log level: level 4 under `#if debug`, level 2 otherwise. So seeing `m.log.debug` or `m.log.verbose` output means editing the manifest to `debug=true` and rebuilding. That has two costs. Raising verbosity also changes the app: a debug build attaches `rawApiData` to every transformed item, arms failure injection and enables the toast cheat code, and it paints Home slower ([`debug-flags.md`](../dev/debug-flags.md) has the measurement). And it churns the committed manifest: `debug=true` reached `main` twice (`27d99141`, `dc05db8d`), each reverted the same day. `harden-prod-manifest.js` keeps it out of releases, so the cost is developer experience and measurement fidelity.
- **direction**: Two shapes, and the cheap one is a stepping stone:
  - **A.** A `verboseLogging` const like `perfTiming`: level 4 with no debug behaviors, listed in `FORCED_OFF`. It removes the distortion but keeps the rebuild.
  - **B.** A level settable at runtime, which ends the churn. Settle where the value lives (a registry setting or an in-app developer gesture), whether it survives a restart, and whether it is dev-only.

  `initializeLogManager` cannot move earlier than `JRScene.init` (see the comment there), so a runtime source must be readable by then. Followup `debug-build-never-built-automatically` touches the same question.

#### `observe-without-on-destroy-jrscreen-only`

- **area**: [`scripts/bsc-plugins/observe-without-on-destroy.cjs`](../../scripts/bsc-plugins/observe-without-on-destroy.cjs), [`scripts/bsc-plugins/jrscreen-on-destroy.cjs`](../../scripts/bsc-plugins/jrscreen-on-destroy.cjs)
- **issue**: Both teardown plugins cover only descendants of `JRScreen` (`TARGET_BASE = 'JRScreen'`). A `Group` or `LayoutGroup` used as a widget gets no coverage, and several dozen such components observe a field they never unobserve. Most of that is self-observation, which dies with the node. The cross-node cases are the real leak shape:
  - `JRButtons` held a `TextSizeTask` observer for its lifetime until it was fixed by hand under #728.
  - [`GridItem`](../../components/ItemGrid/GridItem.bs) observes the content root its `BaseGridView` owns, unobserves only when the root changes, and has no `onDestroy`. [ADR 0029](../adr/0029-destroy-routed-screens-on-pop.md) breaks the resulting retain cycle from the container side: `BaseGridView.onDestroy` drops the content root.
  - [`JRRowItem`](../../components/ui/rowitem/JRRowItem.bs) and its `BrowseRowItem` subclass (the cell for `ExtrasRowList` and `SearchRow`) cache `m.contentRoot` and observe it in a one-time `setupTextureObserver()`, with no `onDestroy`. `SearchScreen.onDestroy` drops its content, but `ExtrasRowList.onDestroy` does not.

  Container-side mitigation is per container by construction, and nothing makes the next container remember.
- **direction**: Widen the check to every component with a codebehind. The teardown method differs by class (`onDestroy` for routed screens, an explicit release sub for widgets), so this likely needs a per-class allowlist of teardown methods. Expect a large first count: separate self-observation from cross-node observation before turning it on, or land it as a warning.

#### `observer-balanced-toggle-ungated`

- **area**: [`scripts/bsc-plugins/register-once-observer.cjs`](../../scripts/bsc-plugins/register-once-observer.cjs), [`components/CLAUDE.md`](../../components/CLAUDE.md), any component pairing `observeField` and `unobserveField` across a start/stop or `if`/`else` boundary
- **issue**: [`components/CLAUDE.md`](../../components/CLAUDE.md) allows two ways to wire an observer on a long-lived node, and only one is gated. `register-once-observer` covers a member observed once in `init()` and detached only in `onDestroy()`. The balanced toggle (observe on the way in, unobserve on every exit path) is gated only for `m.top`, by `field-observer-wiring`'s `top-observer-outside-init` and `top-unobserve-outside-ondestroy` ([ADR 0034](../adr/0034-component-observers-init-to-ondestroy.md)). A toggle on a child node the component owns, such as a `Timer`, is not gated, and the register-once rule cannot reach it by construction. Four instances were found by hand, one per PR: #896, #898, #899 and #907. The last lost an observer instead of adding one: an audio-track switch left the progress timer firing with no listener, so Continue Watching froze (decision note on `playbackTimer`).
- **severity**: Medium: a recurring class with a cheap per-instance fix, nothing live and no crash. Escalate if a fifth lands.
- **direction**: This needs control-flow analysis: for each `(target, field)` pair, does every path out of the observing scope reach a matching `unobserveField`? Do not start with a same-function heuristic; the plugin header records why that drowned in toggles. Find a structural signature for "this member is a toggle" first, and measure the candidate set before choosing a rule shape.

#### `ropm-hook-fails-silently`

- **area**: [`scripts/ropm-hook.cjs`](../../scripts/ropm-hook.cjs), the `ropm` script in [`package.json`](../../package.json), `components/roku_modules/` and `source/roku_modules/` (generated, gitignored)
- **github**: #986 (adopting roku-log as owned code deletes the hook)
- **issue**: `ropm copy` writes vendored component XML whose `<script uri>` paths do not exist (`pkg:/source/roku_modules/undefined/bslib.brs` and similar). `ropm-hook.cjs` rewrites them after every install, which is what lets the app launch. It catches and logs every error, and `npm run ropm` still exits 0, so if the output of `ropm copy` changes shape the hook silently does nothing and the app ships with unresolvable script URIs. Nothing checks that `<script uri>` targets resolve, and `bsconfig-base.json` filters every diagnostic under `**/roku_modules/**`. An audit on 2026-09-03 found every URI resolving. [ADR 0020](../adr/0020-router-settle-primitive.md) calls the hook fragile.
- **direction**: Prefer a lint that resolves every `<script uri="pkg:/…">` in component XML against the build output. It catches the failure whether or not the hook ran. A cheaper stopgap is to make the hook fail the install when a rewritten URI has no file behind it. The hook only rewrites the XML of roku-log, so if #986 lands, delete this entry with the hook.

#### `weblate-branch-stale-sync`

- **area**: Weblate integration (`locale/custom/*.json`, the `weblate` branch), `.github/workflows/jellyrock-bot.yml` (`sync-translations-to-weblate`), `.github/workflows/release-management.yml` (`merge-translations`), `scripts/weblate-sync.js`, `scripts/translations-merge.js`
- **issue**: Between releases, only `en_US.json` and `languages.json` flow from `main` to `weblate`, on every push. Every other locale file moves both ways only at release prep, through a three-way key-level merge ([`translations.md`](translations.md#weblate-sync)). So a translation fix merged mid-cycle reaches Weblate only at the next release, and translator edits reach `main` only then. This is not the cause of #641's untranslated keys, which exist in no source.
- **direction**: [ADR 0048](../adr/0048-translation-seeding-and-weblate-merge.md) names the trigger: translators reporting redone work. Then extend `translations-merge.js` rather than adding a sibling. A mid-cycle push needs `weblate-sync.js`'s lock as release prep does, and it must not write a `Translations-Release` trailer, which `findAncestor()` would take for a shipped release.

#### `loginflow-error-boundaries`

- **area**: `source/loginRouter.bs`
- **issue**: The interactive paths handle failure in place: a failed server entry stays on `SetServerScreen` with a message, and a failed sign-in stays on `LoginScene` with an alert. The cold start does not. In `beginLogin()`, an unreachable saved server or a server-info error goes straight to `/server` with no retry. An invalid saved token tries a password-less sign-in, then drops to the user picker or `/login`, and never re-prompts for the password on the same server. The fallback sign-in cannot tell a network failure from an auth failure, so both get one generic message.
- **direction**: Define a few error categories (unreachable, server error, auth failed, token invalid) with a recovery per category. A network blip retries with backoff. An auth failure goes to the user picker, not the server picker. An invalid token re-prompts for the password and keeps the server.

#### `prelogin-intent-payload-coupling`

- **area**: `source/loginRouter.bs` (`onServerSubmitted`, `onCredentialsSubmitted`, `onUserSelected`), `source/main.bs` (the `preLoginIntent` dispatch), the pre-login views (`components/config/SetServerScreen.*`, `components/login/UserSelect.*`, `components/config/LoginScene.*`)
- **issue**: The pre-login intent bridge is fire-and-forget: a view sets `preLoginIntent = "<action>"` on the scene and `main.bs` drains it later. Each handler reads the payload from `getActiveView()` at drain time instead of binding it at fire time. If the active view changes in between, the handler reads the wrong view's fields. #734 crashed this way: a duplicate submit drained after navigation and read a missing `enteredUrl`. The fix added per-handler stale-intent guards and blocked input during the connect, but every new pre-login handler must remember the guard. It is the same last-writer shape as [`backdrop-ownership-guard`](#backdrop-ownership-guard).
- **direction**: Bind the payload to the intent, for example an AA `{ action, payload }` set in one write at fire time. Check `roSGNodeEvent.getData()`'s snapshot behavior on a device first: it decides whether duplicate intents keep their own payloads. This touches every pre-login view and handler.

#### `manual-theme-cascade`

- **area**: `source/utils/globals.bs` (`applyThemeColorOverrides`), `components/data/SceneManager.bs` (`refreshThemeColors`, `reloadHome`), callers in `components/settings/settings.bs` (`radioSettingChanged()`, `onScreenHidden()`, `performSettingsExit()`) and `source/utils/session.bs` (`Login()`, `Logout()`)
- **issue**: A theme change is a manual chain. `applyThemeColorOverrides` writes `m.global.constants`, `refreshThemeColors` restyles the scene background and the overhang, and `reloadHome` rebuilds the whole Home route. Each caller runs its own subset: Settings applies a theme choice at once in `radioSettingChanged` (the first step, setting `m.themeColorsChanged`), restyles in `onScreenHidden` (the second step, when that flag is set), and `performSettingsExit` runs all three on the way out. `Login()` runs the first two, and `Logout()` resets the colors and refreshes. A component that caches theme colors at construction misses the change until it is rebuilt.
- **direction**: Either (a) components read colors from `m.global.constants` in their handlers, not in `init`, or (b) a "theme" node on `m.global` that components observe, replacing `reloadHome` as a blunt rebuild.

#### `backdrop-ownership-guard`

- **area**: `components/JRScene.bs` (`setBackgroundImage`, `imageFader`), `components/ui/BackdropFader.*`, and every backdrop writer (`HomeRows`, `FavoritesRows`, `BaseGridView`, `ItemDetails`, `SearchScreen`, `AudioPlayerView`, `queueBackdropHelper`)
- **issue**: There is one backdrop node (`JRScene.imageFader`), and `setBackgroundImage` is last-writer-wins with no notion of which routed view owns the screen. A view whose data lands after it stopped being the active view can overwrite the foreground's backdrop. Home's late row load once blanked a deep-linked `ItemDetails` backdrop. `HomeRows.updateBackdropForFocusedItem` now guards with `backgroundWriteIsStale` ([`backdrop.bs`](../../source/utils/backdrop.bs)), but the other writers do not. The `forceBackdrop` half is fixed: `setBackgroundImage` resets `m.lastBackdropUri` on a forced write, so a later write of the same URI is no longer dropped as a duplicate.
- **direction**: Move the ownership check into `setBackgroundImage`, keyed to `m.global.activeRoutedView`, then drop the per-caller guard in `HomeRows`. `SceneManager.setBackgroundImage` forwards only `uri`, `isAnimated` and `forceBackdrop` today, so the writer's identity has to be passed in first.

#### `per-item-cross-thread-appends`

- **area**: [`components/home/FavoritesRows.bs`](../../components/home/FavoritesRows.bs) (`applyItems`), [`components/ItemGrid/BaseGridView.bs`](../../components/ItemGrid/BaseGridView.bs) (`onItemDataLoaded`), [`components/search/SearchRow.bs`](../../components/search/SearchRow.bs)
- **issue**: A loop that appends nodes one at a time into a node already in the render tree costs in proportion to the number of append calls. One `appendChildren` does not. [ADR 0026](../adr/0026-no-worker-pool-for-task-ui-handoff.md) and the `HomeRows.populateRowFromData` comment hold the Home measurement. Two things are measured and safe to rely on: the cost scales with the number of calls, and it appears only when the target is live. On the same Stick 4K session (measured 2026-08-09), the same `appendChildren` cost about 315 ms into a live row and about 0 into a detached one. Building detached is not a fix, though: that arm ran slower end to end (`total` 2083 to 3266 ms, with `other` absorbing 884 ms), for reasons the experiment could not separate. The mechanism is not established, so do not derive one from the thread-ownership model ([`threading.md`](threading.md)).

  Sites, as of 2026-10-11:
  - **Live, open:** `FavoritesRows.applyItems`' in-place branch appends per item into a row in `m.top.content`. `BaseGridView.onItemDataLoaded`'s grid page path appends per item into `m.data`, which is the live `m.itemGrid.content`; `appendMs` and `appendMaxMs` time it.
  - **Detached, measure first:** the `BaseGridView` genre branch fills a new `rowsRoot` before revealing it, and `SearchRow` builds a detached `data` node. There is likely nothing to win.
  - **Fixed:** `HomeRows.populateRowFromData` (both branches), `liveTv/schedule.bs` (one `appendChildren` per channel row, #991), and `ExtrasRowList` (`fillRow`, `commitRows`; decision `extras-rows-single-commit`). `LoadItemsTask2.populateGenreRow` appends on a Task into its own undelivered node, so it is not a candidate.
- **direction**: For each live site, replace the loop with one `appendChildren(array)` and measure before and after, one site at a time. Small sites may not clear the first-paint method's resolution floor ([`home-first-paint-performance.md`](../dev/home-first-paint-performance.md)). Decide on `total`, not `attach`: a site appending into a detached node reports about 0 `attach` either way. Check a claimed win against the live content tree on both arms (row count, tiles per row, tile order over ODC), because a run that renders fewer items looks identical in the timings.

#### `quickplaytask-selection-logic-untestable`

- **area**: [`components/tasks/QuickPlayTask.bs`](../../components/tasks/QuickPlayTask.bs) (the `do*` dispatch functions)
- **issue**: The play-queue selection logic lives in file-scoped functions of a Task component, which a Rooibos spec cannot import. [`quickplay.spec.bs`](../../tests/source/integration/quickplay.spec.bs) covers `quickplay.video()`, a different layer. `doSeason` once derived an array position from `IndexNumber`, which holds only for seasons numbered 1 to N with no gaps, and that bug shipped with no regression test because there was nowhere to put one (#796). Since #1076, the whole-library rules live in [`quickplayLibrary.bs`](../../source/utils/quickplayLibrary.bs) with their own spec, the outcome kind and status and the toast message key live in [`quickplayOutcome.bs`](../../source/utils/quickplayOutcome.bs), and the read that reports a failed fetch (`apiRead.Reader`, shared with Search) lives in [`apiRead.bs`](../../source/api/apiRead.bs), each with its own spec. The series, season, person, folder and per-collection-type selection is still in the Task.
- **direction**: Extract the pure part (items and user data in, chosen index or queue out, no fetch) into `source/` functions a spec can import, and leave each `do*` as a thin fetch-and-delegate wrapper. For library reads, aim for one table of queries per collection type in `quickplayLibrary`, so a spec can check each one is bounded. [`liveTv.bs`](../../source/utils/liveTv.bs) and its spec are the precedent.

#### `measure-record-assembly-untested`

- **area**: [`scripts/measure.js`](../../scripts/measure.js), from the `Close the boundary` marker to the end: the `record` appended to `measurements.jsonl`, the statistics (`medianOf`, per-key medians, `lineCoverage`) and the console output
- **issue**: This is the last untested layer of the measurement harness. Six modules were extracted out of the entry point with their own suites (`measure-args`, `measure-compare`, `measurement-guard`, `measurements`, `measure-selection`, `measure-loop`). `measure.js` itself has none, because it takes the device lock at module scope, so importing it claims the device. The record it assembles is what every reader trusts (`measure:compare`, `measure:report`), and the harness's defects have been well-formed but wrong records ([ADR 0028](../adr/0028-mount-identity-component-and-variant.md) has one). The assembly also has a second writer: [`measure-calibration.js`](../../scripts/measure-calibration.js) stamps `provenance.deploy` and `enclosure` ([ADR 0030](../adr/0030-non-odc-arm-identity-by-enclosure.md)) onto a record from outside. The record also cannot say which locale a series ran in. `measure:devices --sign-in` pins the first RTA language, and both entry points print it, but the record does not carry it.
- **direction**: Extract record assembly and statistics into a pure module that takes no device lock: samples plus device metadata in, the record and rendered lines out. Let it accept the calibration fields as inputs instead of a caller mutating its result. Add the locale while there: `m.global.translationLocale` holds it, so check on a device that an ODC read of it can sit beside `IDENTITY_REQUESTS` ([`measurement-guard.js`](../../scripts/measurement-guard.js)). [`measurement-invariants-ungated`](#measurement-invariants-ungated) lands in the same layer. This is deferred debt; `measure:report` reads the ledger and does not depend on it.

#### `failed-poster-retry-population-unmeasured`

- **area**: [`source/utils/textureManager.bs`](../../source/utils/textureManager.bs) (`shouldReloadTexture`), [`components/ui/rowitem/JRRowItem.bs`](../../components/ui/rowitem/JRRowItem.bs), [`components/ItemGrid/GridItem.bs`](../../components/ItemGrid/GridItem.bs)
- **issue**: The reload guard (decision `failed-poster-no-scroll-retry` in [`decisions.md`](../decisions.md)) stops a cell from re-requesting a failed image when it re-enters view while still loaded. A cell gets one fresh attempt after it leaves the loaded range. Every suppressed request is a retry of a load that already failed. On the library it was measured against, those retries recovered nothing (the decision has the figures), but that library had almost no cast artwork. On a library whose artwork exists but fails intermittently (a throttling server, a slow remote mount), the guard could hold a failure glyph on a cell whose image would have arrived later. Nothing measures that.
- **direction**: Measure before designing. Read `loadsSucceeded` over the extras sweep, with and without the guard, on a library with present but flaky artwork. If it does not move, close this entry. If it does, design a policy (bounded attempts, keyed on elapsed time, reset on rebind) instead of restoring the old behavior. Do not bring back retrying on scroll position, which had no cap. Medium because the unknown is user-facing and one run on the right library settles it.

#### `numeric-coercion-still-inlined-at-three-sites`

- **area**: [`source/utils/deviceCapabilities.bs`](../../source/utils/deviceCapabilities.bs) (`isWithinH264HardwareCeiling`), [`source/api/items.bs`](../../source/api/items.bs) (`buildPlaybackInfoPostData`'s `Channels` and `MaxAudioChannels` reads)
- **issue**: `mediaNumber()` in [`misc.bs`](../../source/utils/misc.bs) was extracted to fix `GetBitRateLimit` (#858), whose `type(x) = "Integer"` check never matched a node field. The same integer reports `Integer`, `roInteger` or `roInt` depending on where it was read from (the #858 commit has the table). Three hand-written `type()` branches remain. `isWithinH264HardwareCeiling` converts only strings, so it works for any integer type. The two branches in `buildPlaybackInfoPostData` accept `roInt` and `Integer` but not `roInteger`. That is correct for the values production passes: measured 2026-10-11 on a Streaming Stick 4K, an integer from `ParseJson` reports `Integer`, and one read back through an `assocarray` node field reports `roInt`. Only an integer in an AA literal reports `roInteger`, which happens in test code, so a spec that builds a stream as `{ Channels: 6 }` exercises the default instead of the branch.
- **direction**: Replace each inline branch with `mediaNumber(...)`, which accepts all three type names and so removes the test trap. All three fields are integers, so `mediaNumber`'s float truncation should change nothing; confirm that per site.

#### `audio-probe-strategies-not-unified`

- **area**: [`source/utils/deviceCapabilities.bs`](../../source/utils/deviceCapabilities.bs): the audio codec probe in `GetDirectPlayProfiles`' container loop, `getAudioDirectPlayProfiles` / `canDecodeAudioInContainer`, and `getCodecProfiles` / `getActualCodecSupport`
- **issue**: Three places ask the device "can you play this audio codec" three ways. The video container loop sends `CanDecodeAudio({Codec, Container})` and routes `mat` through `canDecodeAudioInContainer`. `canDecodeAudioInContainer` sends the same shape with the `mat` rule. `getActualCodecSupport` tries `PassThru` first for surround codecs, refuses `dtshd` and `dtsx` outright, then applies a fixed max-channel table. The `mat` quirk has had to be fixed twice. `getDeviceProfile()` is rebuilt inside every `ItemPostPlaybackInfo`, so on every music track change. On 2026-08-30 that measured 169 ms on a Streaming Stick 4K and 78 ms on an Ultra, of which the audio table was 43 and 21 ms. The mid-play track switch already shares one rule: `isStreamDirectPlayable()` answers from `getActualCodecSupport()` (decision `audio-profile-documented-and-reported`). Jellyfin labels DTS-HD and `DTS:X` tracks as `dts` plus a profile, so those two names are gone from the codec lists. `getSupportedPassthruCodecs` still probes a `dtshd` sink when choosing a transcode target.
- **direction**: One function owns "can this device play codec X in container Y", with each quirk once, and the other three call it. Take `di` as a parameter so the quirk table is testable against a fake `roDeviceInfo`, as `deviceCapabilities-audioDirectPlay.spec.bs` does. Three cost levers were each verified on both devices:
  - Cache within a single profile build; the audio `mkv` row's probes repeat the video loop's.
  - Drop `wav` and `aiff` from the codec lists: they are container names and answer false to every probe.
  - Filter with the bare probe first. No codec answered false bare and true in a container.

  Do not prune by the single-call `CanDecodeAudio({})`: it omits `mp3`, `mp2` and `lpcm`. Do not cache across playback requests: Roku requires re-querying before each one, and the answers change with audio output. Keep TrueHD and DTS above 5.1 refused in the single owner.

#### `button-row-model`

- **area**: [`source/utils/buttonOverflow.bs`](../../source/utils/buttonOverflow.bs), [`components/ItemDetails.bs`](../../components/ItemDetails.bs) (the 11 functions that change the row), [`components/video/OSD.bs`](../../components/video/OSD.bs) (`setButtonStates`), [`scripts/bsc-plugins/button-row-bracket.cjs`](../../scripts/bsc-plugins/button-row-bracket.cjs)
- **issue**: The row's logical content (which buttons this item has, in order) and its physical form (the children of the `JRButtonGroup` or `OSDButtonGroup`) are the same list. The #788 overflow split edits the physical list: the tail moves to an off-layout stash and a `More` button takes the last slot. The call sites reason about the logical one (`getButtonIndex("deleteButton")`, `insertChild(x, 0)`, `buttonFocused` as an index). The `unsplitButtons()` / `applyOverflow()` bracket converts back and forth, and it is hand-kept at 12 call sites. Hiding overflowed buttons in place does not work, because a `LayoutGroup` reserves a slot for an invisible child (measured on a Roku Ultra; the `OSD.setButtonStates` comment records it).
- **severity**: Medium. A forgotten bracket is a build error through `button-row-bracket`, and the defects found so far have specs. But the bracket's focus capture runs on every change, including a row that fits. As added in #918, it restored the old focus over one a row change chose on purpose, and every item with progress opened with Play focused instead of Resume (v2.29.0 and v2.29.1). The fix lengthened the contract: a row change that moves focus on purpose must call `claimRowFocus()` (decision `row-focus-explicit-claim`). The grade is for build machinery and a growing list of per-call-site duties that compensate for a design.
- **headroom**: The caps are computed (`itemDetailsButtonCap()`, `osdButtonCap()`). Counted against `setupButtons` on 2026-10-11, Movie and Episode reach 8 in the worst case (Resume, Play, Watched, Favorite, then Trailer for Movie or Go to Series for Episode, Manage Subtitles, Delete, Refresh). Series and Season reach 7. The trailer check runs only for `Movie`, `Video` and `MusicVideo`. The next button added to a video type is likely to trigger the `More` split.
- **direction**: Keep an ordered list of button descriptors as the source of truth and derive the group's children from it in one render step. Call sites edit the model, the split becomes a pure function of it, and the bracket and its plugin go away. This is not small. `ItemDetails` changes button fields in place in many places (`isLoading`, `text`, `playbackPositionTicks`, `isEnabled`, the favorite and watched toggles), so the model must hold that state too, on top of `setupButtons`' per-type construction. Treat it as a `/start-project`, not a PR rider. Doing [`itemdetails-size`](#itemdetails-size) first shrinks it.

#### `subtitle-panel-rta-fixture-gated`

- **area**: [`tests/rta/screens.js`](../../tests/rta/screens.js) (`subtitlePanel`), [`tests/rta/lib/nav.js`](../../tests/rta/lib/nav.js) (`navSubtitlePanel`), [`tests/rta/lib/jellyfin.js`](../../tests/rta/lib/jellyfin.js) (`manageSubtitlesOffered`)
- **issue**: The subtitle panel is in the RTA registry but skips on the default (public demo) fixture, so the registry entry and `screens.spec.js` guard nothing there. Only [`specs/subtitle-search-failure.spec.js`](../../tests/rta/specs/subtitle-search-failure.spec.js) runs, and only against a local Jellyfin with a subtitle provider plugin (checked on 10.11.11 with Open Subtitles, no credentials); it covers the search-failure and no-results messages and nothing about layout. The local fixture is not wired into the default run or CI. `manageSubtitlesOffered` needs two things: a user allowed to search subtitles (from 10.9, an administrator or `EnableSubtitleManagement`) and a subtitle provider plugin on the server (`SubtitleFetchers` in `/Libraries/AvailableOptions`). The public demo fails both: its `demo` user has neither right (the `screens.js` comment), and it reported no fetchers on 2026-09-14. Two things still wait on a fixture that passes both checks on every run:
  - The docs screenshot, which must come from the demo server. The entry carries no `capture` key on purpose, because marking it eligible would list a file that does not exist in `screenshots.json`.
  - A deeper spec asserting what Rooibos cannot: both columns render, both sections take focus and scroll, and Down crosses from External files into In the video file. [`SubtitlePanel.xml`](../../components/subtitles/SubtitlePanel.xml)'s comment and `sectionRowCounts()` warn about that regression, and nothing guards it.
- **direction**: Both need a fixture that passes both checks on the default run. The local fixture the search-failure spec uses shows one can be built; the focus and scroll spec could run on it as the same kind of gated spec. The screenshot cannot until the demo server passes. Enabling the screenshot takes two changes: add `capture: { eligible: true }` to the registry entry, and give `navSubtitlePanel` a paint settle budgeted in [`rta-sleep-budgeted.js`](../../scripts/lint/eslint-rules/rta-sleep-budgeted.js), as `navMovieDetails` has. The probe, `specs/screens.spec.js` and `scripts/capture-screenshots.js` already honor `requires`. [`homerows-geometry-invariant-ungated`](#homerows-geometry-invariant-ungated) waits on a controlled fixture too, and [`config.js`](../../tests/rta/config.js) says pointing RTA at JellyRock's own demo server is a one-line `.env` change.

#### `subtitle-selection-duplicated-across-threads`

- **area**: [`source/utils/subtitles.bs`](../../source/utils/subtitles.bs) (`sortSubtitles()`, `defaultSubtitleTrack()`, run by `LoadVideoContentTask` for playback), its render-thread copy in [`source/utils/streamSelection.bs`](../../source/utils/streamSelection.bs) (`findDefaultSubtitleStreamIndex()`, `selectSubtitleByMode()`, run by `ItemDetails` for the subtitle dropdown), and `JDT_sortSubtitleStreams()` in [`JellyfinDataTransformer.bs`](../../source/data/JellyfinDataTransformer.bs)
- **issue**: The default-subtitle pick is written twice, and the copies must agree or the details screen shows one track while playback picks another. The "Original language" work had to thread `originalLanguage` and `matchingLanguageCodes()` through both in the same PR (#977). `JDT_sortSubtitleStreams()` is a third copy of the ordering whose `preferredLanguage` is always `""`, because no caller of `transformBaseItem()` or `transformBaseItemArray()` passes `preferredSubtitleLanguage`. Its preference branch has never run on real input.
- **direction**: One implementation both threads call; a `source/` function has no thread affinity. Keep the URL building that only playback needs (`sortSubtitles()` calls `buildURL()`) at the playback call site. Before folding in `JDT_sortSubtitleStreams()`, check whether `item.subtitleStreams` needs a preference order at all; if not, drop the parameter. Both copies have specs: `subtitleSelection.spec.bs` for the render-thread copy, and `LoadVideoContentTask.spec.bs` for `defaultSubtitleTrackFromVid()`.

#### `subtitle-row-badge-pool-duplication`

- **area**: [`components/subtitles/SubtitleResultRow.bs`](../../components/subtitles/SubtitleResultRow.bs) and [`components/subtitles/CurrentSubtitleRow.bs`](../../components/subtitles/CurrentSubtitleRow.bs): `buildBadgePool`, `newBadgeIcon`, `newBadge`, `placeBadges`, `fillBadgeSlot`, and the `BADGE_ICON_*` constants in both
- **issue**: Both rows carry the same badge-pool code. With comments removed, they differ in the slot-id prefix and one extra `icons[BADGE_ICON_STAR]` line. `BADGE_ICON_SIZE`, `BADGE_ICON_NONE` and `BADGE_ICON_CC` are declared twice with the same values (`BADGE_POOL_SIZE` differs, correctly). Both copies landed in #918, so any change to badge sizing, icon tinting or pool behavior has to be made twice.
- **direction**: One shared helper that builds the pool, fills slots and hides the tail, given an icon map and a slot-id prefix. Each row keeps only its own `badgesFor` policy: a result row badges provider facts, an installed-track row badges stream flags. Move the constants to [`subtitleLayout.bs`](../../source/constants/subtitleLayout.bs) beside `BADGE_SPACING` and `BADGE_ICON_GAP`. `CurrentSubtitleRow.spec.bs` and `SubtitleResultRow.spec.bs` cover slot filling, right alignment, whole-badge dropping and recycling, so the extraction has a gate.

#### `remotecontrol-no-keepalive-longevity-gate`

- **area**: [`source/remotecontrol/remoteProtocol.bs`](../../source/remotecontrol/remoteProtocol.bs) (`keepAliveFrame`), [`components/remotecontrol/RemoteControlTask.bs`](../../components/remotecontrol/RemoteControlTask.bs) (`runWsReceiver`, `connectAndPump`), the RTA suite under `tests/rta/`
- **issue**: Nothing holds a session socket open past Jellyfin's inactivity reap, so a `KeepAlive` the server ignores fails no test. That is how #934 stayed hidden: `keepAliveFrame()` sent a lowercased key for the whole life of the `ws://` transport, every 10.11+ session socket was reaped and reconnected forever, and the only symptom users saw was Live TV stopping about a minute into playback on 12.0. The #974 commit has the reap timings and the capture. The unit spec now pins the frame's bytes, but that guards one function, not the behavior. A regression in cadence, framing or teardown would be equally silent.
- **severity**: Medium. It is the only gate that would have caught #934 by symptom rather than by review, at the cost of about 90 s of run time.
- **direction**: Expose a client-side signal for "the socket stayed up N seconds without a forced reconnect". Nothing counts reconnects today; `runWsReceiver` logs one. Then add an RTA spec that idles past the reap window and asserts on it. Whether the public demo server reaps the same way is unchecked.

#### `ci-path-filters-unverified`

- **area**: the `pattern:` input to `.github/actions/changed-paths` in each `.github/workflows/_lint-*.yml` and `_test-*.yml`, and [`scripts/lint/ci-parity-check.js`](../../scripts/lint/ci-parity-check.js)
- **issue**: `lint:ci-parity` proves every `npm run lint` check runs in some workflow, but nothing checks that the workflow's hand-written path pattern matches the files the check reads. A pattern that is too narrow passes the parity check and never fires on the PR that needed it. Each pattern's comments record why it was widened. That has happened at least eight times, each found by a person noticing. One area is now checked: [`brightscript-trigger-parity.test.js`](../../tests/scripts/unit/lint/brightscript-trigger-parity.test.js) asserts that CI triggers on everything that makes pre-push run `validate`. Known gaps on 2026-10-11:
  - `_lint-spelling.yml` does not match `package.json`, where the `lint:spelling` globs live. Widening it to all of `package.json` would run it on every dependency bump.
  - `_lint-language-coverage.yml` and the pre-push `HAS_LANGUAGE_TRIGGERS` were the same gap until #1160, which moved the script's inputs to `language-coverage-inputs.cjs` with a parity test. That is the shape the direction below generalizes.
  - `_lint-docs.yml` misses a couple of dozen architecture-doc `related-files` (`manifest`, `Makefile`, several `bsconfig*.json` and more), so `docs-stale-blocking.cjs` skips a PR that touches only those.

  A Vitest test that reads app source (`apiversion-consistency.test.js`, `socket-auth-binding.test.js`) does not re-run when that source changes. The lint script is the gate there; the test checks the script. Whether each check's workflow is a required status check on `main` is a second unverified layer, because branch protection is repository settings, not a file. [`build-and-tooling.md`](build-and-tooling.md) documents adding a new context as a manual step.
- **severity**: Medium. The failure is silent, and the parity gate makes it easy to assume this is covered.
- **direction**: Have each check declare the globs it reads (an export, or a manifest keyed by npm script), and extend `ci-parity-check.js` to assert the workflow's pattern covers them. The patterns are regular expressions and the inputs are globs, so compare after normalizing. For the required-check layer, a committed list of expected contexts drifts on its own, and an admin-scope token in CI is a cost; the doc step stays the fix for now.

#### `failure-state-ui-copied`

- **area**: `components/search/SearchScreen.xml` and `.bs` (the `searchFailed` group; `onRetryButtonReady`, `focusRetryButton`, `onFailureNarrationDue`), `components/ItemGrid/BaseGridView.xml` and `.bs` (the `loadFailed` group and the same three handlers)
- **issue**: The search failure state (#1199) copies the grid's load-failure state nearly line for line: a bold message label, a `TextButton` Try again centered on the 720p grid once it has measured itself, and a `Timer` that announces message and button after `narration.OPENING_DELAY` when Try again takes focus. A fix to one copy (its layout, its narration timing) can miss the other, and a third screen with a failure state would make a third copy.
- **severity**: Medium. Two copies, small today; the drift risk grows with each screen that adds one.
- **direction**: One failure-state component (message, button label, the area to center in) that does the centering and the opening announcement itself, and reports a retry press on a field. What stays with each screen: when to show it, where focus goes (the grid moves focus to Try again; Search does too once its overlay has closed, and otherwise keeps it on the keyboard), and Search's announcement on arrival while the keyboard is open (`showSearchOutcome`).

### Low

#### `playerhostview-second-subsystem`

- **area**: [`components/video/PlayerHostView.bs`](../../components/video/PlayerHostView.bs):
  - the playback report: `onSelectPlaybackInfoPressed`, `startPlaybackInfoLoad`, `onPlaybackInfoLoaded`, `playbackReportInputs`, `playingUrl`, `userIsAdministrator`, `reportHasLiveRows`, `reportNeedsPolling`, `startPlaybackInfoRefresh`, `stopPlaybackInfoRefresh`, `releasePlaybackInfoRefresh`, `onScreensaverTimeoutLoaded`, `onPlaybackInfoRefreshDue`, `onPlaybackInfoDialogClosed`
  - the still-watching prompt (#982): `shouldAskStillWatching`, `onStillWatchingPlaying`, `onStillWatchingResult`, `onStillWatchingTick`, `closeStillWatchingPrompt`, `stillWatchingCountdownText`
  - two touch points elsewhere in the host: `skipToCurrentQueueItem`, which restarts the session, and the `stillWatchingOnActivity` call in `handleTransport`
- **issue**: The host is the player factory, the queue-advance state machine and the playback-time track dialogs. The playback report added a fourth job in one PR (#859): composing the report, owning a refresh timer with two gates, reading the screensaver timeout through a Task, and managing a dialog's lifecycle. Every function listed for it serves that one feature, and none is touched by the host's other jobs. The still-watching prompt (#982) added a fifth, independent block: session state, a countdown timer, a prompt `JRDialog` and a transport answer. This is the shape [`videoplayerview-size`](#videoplayerview-size) describes, arriving on a second file.
- **severity**: Low. Both blocks are cohesive and self-contained, which is why extracting them is cheap and why nothing is hard to change yet.
- **direction**: Extract a `PlaybackReportController` (composition, refresh and dialog lifecycle), leaving the host with mount and teardown, advancement and OSD dispatch. The functions talk to each other and to `m.view` fields, not to the queue, so this is a move rather than a redesign. Do it when the report next needs work. The still-watching block is a second candidate: its logic is already pure in [`stillWatching.bs`](../../source/utils/stillWatching.bs), and what remains in the host is glue.

#### `home-row-size-recompute-per-row`

- **area**: [`components/home/HomeRows.bs`](../../components/home/HomeRows.bs): `setRowItemSize()`, reached only through `flushRowSizes()`, and `rowStructureChanged()`, which `createSkeletonRows`, `onLibrariesLoaded`, `showLatestMediaStandIn`, `removeRowAtIndex`, `populateRowFromData`'s insert branch and `applyPendingRowRemovals` call
- **issue**: Fixed in #799. `setRowItemSize()` rewrites the three geometry arrays, and it used to run once per row removed or re-inserted during a load. Removals and their recompute are now batched to one per latest-rows run. The #799 commit has the per-tier results and the scaling run. Decision `home-row-removals-deferred` records the two cheaper shapes that failed: flushing per drain coalesced nothing, and deferring only the recompute drew rows at the wrong size. The batch covers only the rows the run delivers (`latestRows.removalIsDeferrable`), because widening it to Home's other sections would make their removal race-dependent and unsafe. At most four such removals exist.

  What is left is one recompute per load. Its cost was measured on a Stick 4K with a throwaway probe on 2026-08-19. Rebuilding the arrays and writing `rowHeights` and `rowSpacings` each cost 0 ms. The `rowItemSize` write was the entire cost, 114 ms at 13 rows, and it stayed with that field when the write order was swapped. That is the `RowList` re-measuring its cells, which a removal makes necessary. One `setFields` for the three writes did not help (`total` p=0.24). So rebuilding the arrays looks wasteful but costs nothing, and this path has nothing further to reclaim. The `rowItemSize` write does grow with the row list: 62 ms at 5 rows against 114 ms at 13 (two points, with rows and items varying together). It belongs with [`home-first-paint-scales-with-library-count`](#home-first-paint-scales-with-library-count).
- **severity**: Low. One question is parked. A mid-run removal of the Active Recordings row is associated with the launches that bind the most cells (#856, #862 have the analysis), but the recompute is not the mechanism. The deciding test, dropping that section from the user's `DisplayPreferences`, has not been run.
- **direction**: Nothing to build. Re-open the parked question only with a new measurement; the console data behind an earlier cost estimate was not kept (followup `measure-discards-healthy-console-capture`).

#### `subtitle-panel-downloaded-naming`

- **area**: [`components/subtitles/SubtitlePanel.bs`](../../components/subtitles/SubtitlePanel.bs) and [`SubtitlePanel.xml`](../../components/subtitles/SubtitlePanel.xml) (`downloadedHeading`, `downloadedList`, `downloadedCount`, `onDownloadedFocusMoved`), [`source/constants/subtitleLayout.bs`](../../source/constants/subtitleLayout.bs) (`downloadedRows`, "downloaded section" comments)
- **issue**: The panel's first section is headed "External files" (`LabelExternalFiles`, renamed in #1121), but its node ids, members, the layout result field and the comments still say "downloaded". That change left them alone to stay one-purpose. Someone looking for the External files section by name will not find it, and the term misleads: the list holds every subtitle file kept outside the video, not only ones fetched through the panel.
- **direction**: Rename in one mechanical pass to an intent-based term such as `external*`: the XML ids, the `m.` members, the `downloadedRows` field, the comments, and `subtitleLayout.spec.bs`. [`subtitle-panel-rta-fixture-gated`](#subtitle-panel-rta-fixture-gated) quotes the heading, so keep the two in step.
- **severity**: Low. Naming only; it costs a reader a grep miss.

#### `queued-relaunch-stale-stop`

- **area**: [`components/tasks/TaskLaunchQueue.bs`](../../components/tasks/TaskLaunchQueue.bs), [`source/utils/tasks.bs`](../../source/utils/tasks.bs) (`taskQueueDropReleased`); sites: `TrickplayCarousel.m.tileLoader`, `VideoPlayerView.m.liveTvRefreshTask`, and `Home`'s launch of `m.global.remoteControlTask` (suppressed for good: the node is app-wide and `main.bs` observes it once)
- **issue**: [ADR 0041](../adr/0041-task-launch-queue.md) drops a waiting launch whose node's `state` changed since it was queued, which is how a STOP while waiting cancels it. A persistent node relaunched after a finished run is queued already reading `"stop"`, so a STOP while it waits changes nothing the drain can see, and the run starts late. This needs the app at the thread watermark. The worst known case is a trickplay tile download that finishes with nobody listening. `tasksLaunchQueue.spec.bs` pins the limitation ("cannot see a release of a node that had already finished a run").
- **direction**: Close it site by site by moving each to a new node per run ([ADR 0037](../adr/0037-task-run-replacement.md)); a never-run node's STOP while waiting is visible. Keep the pinning test, since the queue's limitation stays true. `Home`'s receiver cannot take that fix, because a new node would lose `main.bs`'s `dispatchCommand` observer. There, a sign-out while the relaunch waits is not seen, and the receiver starts after the sign-out with no token. On `ws://`, `buildSocketUrl` returns `""` for an empty token and the receiver exits. On long-poll, it makes one unauthenticated plugin probe, then its token check exits the loop. A sign-in that lands first starts it with the new session's token, which is the wanted state. This entry closes when no other site relaunches a finished node.
- **severity**: Low. It needs a saturated app and a release during the wait, at a handful of sites.

#### `rta-odc-connect-unbounded`

- **area**: [`tests/rta/lib/seed.js`](../../tests/rta/lib/seed.js) (`seedHome`), [`tests/rta/lib/driver.js`](../../tests/rta/lib/driver.js) (`ensureOdcReachable`)
- **issue**: The entry points' first ODC call is bounded since 2026-09-06: `snapshotRegistry()` and `applyRestore()` go through `readRegistryBounded` in [`registry.js`](../../tests/rta/lib/registry.js). The decision note `rta-odc-gated-before-bounded` has the failure modes and the alternatives ruled out, and followup `rta-odc-connect-hang` in [`progress.md`](../progress.md) tracks the two upstream defects. What remains is a Vitest worker, a separate process: its own first ODC call (`seedHome` opens with `odc.writeRegistry`) is ungated. By the time a spec runs, the parent has deployed and taken its snapshot, so only an app that dies mid-suite reaches it, and that already fails the specs. The cost is a lost run record, not a hang.
- **direction**: If taken, call `ensureOdcReachable()` at the top of `seedHome`. Do not gate every read: the probe answers false the moment a port is refused, which would fail a device that is only relaunching.

#### `onstate-error-branch-not-reentrant`

- **area**: [`components/video/VideoPlayerView.bs`](../../components/video/VideoPlayerView.bs) (`onState`, the `error` branch)
- **issue**: The Dolby Vision and transcode fallbacks each clear their guard flag (`isDoviDirectPlayFallbackAvailable`, then `isTranscodeAvailable`) right before calling `retryPlayback(...)`. The branch is correct only while `onState` runs once per `state` notification. A second run for the same notification falls through to the next test. It then either fires a second retry with other parameters, or reaches the final `else`, which sets `m.hasPlaybackFailed`, stops both timers and shows the error dialog while the retry is in flight. That is unreachable today: `state` is observed once, in `init()`, and moving an `m.top` observer elsewhere is a build error ([ADR 0034](../adr/0034-component-observers-init-to-ondestroy.md)). Before that fix, #898 measured a duplicate `onState` on a Roku Ultra; the branch itself was never driven. `bufferCheck` had the same shape and is fixed (#899), but nothing tests either, since `VideoPlayerView` has no unit spec.
- **direction**: Make the clear-then-retry pair safe to re-enter (read and clear into a local before branching, or claim the `error` block with an in-flight flag as `errorDialogOwnsExit` does), or state the invariant in a comment at the head of the branch citing this slug. Do not add another observer guard; that guard is already in place. A related route this branch leaves dead is tracked as followup `park-player-after-supersede-not-reversed`.
- **severity**: Low. Unreachable from any known path; filed because the branch does not defend itself.

#### `playback-error-dialog-dismissed-before-it-is-read`

- **area**: [`components/video/VideoPlayerView.bs`](../../components/video/VideoPlayerView.bs) (`bufferCheck`), [`components/video/PlayerHostView.bs`](../../components/video/PlayerHostView.bs) (`onPlayerStateChange`, `prepareToLeaveMount`)
- **issue**: `bufferCheck` shows the playback-error dialog and then stops the player on the next line. If that stop surfaced as `finished`, the host's teardown would abandon the dialog and advance the queue, so a stall would play the next episode with no message. An `errorDialogOwnsExit` claim in `prepareToLeaveMount()` now guards that landing, beside the `isRetrying` check, so the code path is closed. It was never shown to be open: driving a real stall on a Roku Ultra, the stop surfaced as `stopped` every time, and the dialog survived (#876 has the runs). The superseded-dialog half is fixed too: `externallyCancelled` on the result contract, and `parkPlayerAfterSupersede` hides the stream-less `Video` node so Roku's own buffering ring does not show forever.
- **severity**: Low, downgraded from Medium: the user-facing symptom did not reproduce.
- **direction**: Nothing to build. To close this, produce a stall whose stop yields `finished` (other stream types, Live TV, a mid-queue episode or the 512 MB Stick are untried) and record the state read. If nobody can, delete the entry; the guard stands on the `isRetrying` precedent. Do not re-grade it upward without a state read. One window stays unguarded on purpose: a supersede between the stop and the state change would let a pending `finished` advance. Retaining the claim would break the legitimate voice-resume case.

#### `playback-error-dialog-untestable-on-device`

- **area**: [`tests/rta/`](../../tests/rta/), [`components/video/VideoPlayerView.bs`](../../components/video/VideoPlayerView.bs) (`showPlaybackErrorDialog` and its two result handlers)
- **issue**: Nothing in the RTA suite can raise the playback-error dialog, so the `errorDialogOwnsExit` claim, both handlers' `externallyCancelled` return and `parkPlayerAfterSupersede` are verified only by manual runs on one device. The dialog plumbing underneath is gated (`dialogResult.spec.bs` and the four dialog specs); the player half, which navigates, is not. Seeding a 1 bps bitrate cap does not cause an error: the server transcodes down and plays (tried 2026-09-02).
- **severity**: Low. A verification gap on a narrow path, not a defect.
- **direction**: The supersede half needs no cast. `replayRoute.promptServerSwitch` can be driven over ECP, and [`seed.js`](../../tests/rta/lib/seed.js) can stage two saved servers. So: stage them, raise a real playback error, deep-link the other server's item, and assert the routed view is still `PlayerHostView` with the player parked. Raising the error is the only blocker. A cast `DisplayMessage` would be more faithful but arrives over the Jellyfin socket, which needs a session lookup the harness does not have.

#### `screenshot-osd-frame-quality`

- **area**: [`scripts/capture-screenshots.js`](../../scripts/capture-screenshots.js) (`prepareBackdrop`, `injectBackdrop` and the OSD navigation)
- **issue**: The OSD store screenshot is softer than the original HDMI capture. Roku's developer screenshot (`/plugin_inspect`) captures only the SceneGraph UI plane, as a fixed-quality JPEG, and never the video plane. So the full-resolution film frame injected behind the OSD (pulled from the stream with `ffmpeg`) is softened on the round trip. A mild sharpening filter helps; it is fine for a store asset but not crisp.
- **direction**: Composite offline so the frame never goes through the device. Capture the paused OSD twice, over white and over black backdrops, solve per pixel for the UI layer's color and alpha, then composite it over the `ffmpeg` frame. JPEG edges may leave halos around text, so weigh that before building. Surfaced in #621.

#### `grid-titles-ignores-hidealways`

- **area**: [`components/ItemGrid/GridItem.bs`](../../components/ItemGrid/GridItem.bs), [`components/ItemGrid/BaseGridView.bs`](../../components/ItemGrid/BaseGridView.bs) (`configureGrid`, the `gridTitles` and `showItemTitles` fields)
- **issue**: `GridItem` takes title visibility from `gridTitles` (the raw `itemGridTitles` setting). `configureGrid()` sets `showItemTitles` to `"hidealways"` when a presenter shows the presentation-info panel (only Movie's `"movies"` view), but nothing reads `showItemTitles`. So in that view, titles can show under tiles that were meant to hide them. The genre view is unaffected: no Genres view shows the panel.
- **direction**: Decide whether `hidealways` should win in the presentation view. If yes, have `GridItem` read `showItemTitles`, or fold the presentation rule into `gridTitles` and delete the unused field.

#### `tvshow-library-placeholder`

- **area**: [`source/utils/placeholderImage.bs`](../../source/utils/placeholderImage.bs), [`resources/icons/tv.svg`](../../resources/icons/tv.svg), [`resources/placeholders/placeholders.json`](../../resources/placeholders/placeholders.json)
- **issue**: `resolveItemPlaceholderType` maps `presenterType = "tvshow"` to `"Series"`, and `getPlaceholderImagePath` resolves that to `playCircle_*.png`, the generic playable-video glyph shared with Episode, Season, Recording and Program. A TV Shows library tile would read better with a TV glyph. `tv.svg` already exists (used by `ItemDetails`' Go to Series and Go to Channel buttons).
- **direction**: Run `npm run icons:add -- tv --as tv_filled --filled`, add a `tv` entry to `placeholders.json` sourced from `tv_filled.svg`, and return `pkg:/images/placeholders/tv_$$RES$$.png` for Series (and probably Season) in `getPlaceholderImagePath`. Keep `playCircle` for individual items.

#### `endsat-multiday-runtime-ambiguous`

- **area**: [`components/ItemDetails.bs`](../../components/ItemDetails.bs) (`populateInfoGroupPlaylist`'s `createEndsAtNode` call), [`source/utils/misc.bs`](../../source/utils/misc.bs) (`formatDisambiguatedTime`, `getDisambiguatingTimePeriod`)
- **issue**: The "Ends at" chip shows a time with no date, so it can only express an end within 24 hours. Movie, Episode, Audio and Recording pass a bounded duration, and Series and Season pass Jellyfin's average episode runtime. `populateInfoGroupPlaylist` passes the playlist's total runtime, which can exceed a day, and then "Ends at 3:40 pm" is ambiguous whatever the am/pm rule does. The 12 to 24 hour band is handled by `MERIDIAN_INFERENCE_HORIZON_SECONDS`.
- **direction**: Decide whether a multi-day end is worth showing. Nobody watches a long playlist in one sitting, so dropping the chip for Playlist may be the honest fix. If it stays, the Playlist call needs a variant that shows the day when the end falls on a later date.

#### `quickplaynode-set-then-clear`

- **area**: the `quickPlayNode` writers (`ItemDetails`, `BaseGridView`, `SearchScreen`, `HomeRows`, `FavoritesRows`) and the `<field id="quickPlayNode">` declarations beside them
- **issue**: Writing the field and then setting it to `invalid` exists so a repeat write of the same node fires its observer ([`user-journey.md`](user-journey.md#the-set-then-clear-pattern)). Where the field is `alwaysNotify="true"` (`ItemDetails`, `BaseGridView`, `SearchScreen`, `Home`), Roku notifies on every set, so the clear is redundant; `ItemDetails.onExtrasItemSelected` already writes without one. `HomeRows` and `FavoritesRows` declare it without `alwaysNotify`, so there the clear may be what lets a repeat fire (not traced). That is two rules for one field, and a reader cannot tell which clears matter.
- **direction**: One rule: `alwaysNotify="true"` on every `quickPlayNode` field and no clears. Before removing a clear, check on a device that choosing the same item twice still plays twice on that screen.
- **severity**: Low. Consistency; nothing is known to be broken.

#### `osd-inactivity-timeout-hardcoded`

- **area**: `components/video/VideoPlayerView.xml`
- **issue**: The OSD is declared with `inactiveTimeout="5"`, a literal. `OSD.xml` only declares the field; the parent sets the value. It should be a named constant.

#### `m-wasmigrated-global-flag`

- **area**: `source/migrations.bs`, `source/main.bs`
- **issue**: `Main()` sets `m.wasMigrated = false`, and the migrations set it to true, so the two files talk through the implicit `m` AA.

#### `plural-forms-zero-one-many-only`

- **area**: `source/utils/translate.bs` (`translatePlural`)
- **issue**: `translatePlural` picks a suffix by count (zero, one, or anything else), not by a language's plural category. Russian and Polish (one, few, many, other) and Arabic cannot be expressed correctly. [`translations.md`](translations.md) describes the current rule.

#### `settings-auto-sync-coupling`

- **area**: `components/data/jellyfin/JellyfinUserSettings.bs`
- **issue**: `init` observes every field, and `onSettingChanged` writes each change to the registry under the field's own name. A field rename without a migration silently orphans the stored value, and no script checks the pairing.

#### `valuetostring-lossy`

- **area**: `source/utils/config.bs` (`valueToString`)
- **issue**: The registry stores every value as a string. Boolean settings read back through `toBoolean`, which is case-insensitive, so `"True"` parses. A non-boolean string (`"ture"`) comes back unchanged and is passed to a boolean field; what the node does with it is unchecked. Nothing fails fast on a bad stored value.

#### `no-active-player-abstraction`

- **area**: `components/video/PlayerHostView.bs`, `components/video/VideoPlayerView.bs`, `components/music/AudioPlayerView.bs`, `components/mediaPlayers/AudioPlayer.bs`, `source/remotecontrol/remoteDispatch.bs`
- **issue**: Audio (`m.global.audioPlayer`, an app-wide node) and video (`VideoPlayerView`, mounted by the routed `PlayerHostView`) share no "active player" interface. Code that wants to control whatever is playing branches on player type. `remoteDispatch.dispatchTransport` (shared by voice and the #666 cast receiver) reads `getActiveView()` and checks its subtype against `PlayerHostView`, `VideoPlayerView` and `AudioPlayerView` before `callFunc("handleTransport")`. This adds friction to a universal pause or a "now playing" indicator.
- **direction**: Add a thin `m.global.activePlayer` reference, or an interface, pointing at whichever player is active. Both players publish to it on play and teardown, and cross-cutting code reads it instead of branching.

#### `api-timeout-single-value`

- **area**: `source/constants/timeouts.bs`, `source/api/apiTimeout.bs`
- **issue**: A request can carry its own limit (`timeoutMs`, read by `apiTimeout.bs` and honored by the HTTP call, `fetchRes` and `fetchAsync`), but only three callers set one: a library grid page (`GRID_PAGE_MS`), a quick-play library, person or artist read (`QUICKPLAY_LIBRARY_MS`), and a live item's `PlaybackInfo` request (`LIVE_OPEN_MS`). Every other call gets the shared `HTTP_MS` and `API_WAIT_MS`, so a long search and a quick favorite toggle have the same patience. Giving another slow endpoint its own limit is safe only with what the grid page got: a stop when its caller goes, and on a screen, text saying it is still loading. A render-thread request is not stopped (only a waiting Task is watched), so it holds a pool slot for its full limit. A request inside an `apiPipeline` run is also bounded by the run's `budgetMs`, which would need raising too.

#### `per-method-v1-v2-routing`

- **area**: `source/api/ApiClient.bs`
- **issue**: 15 `Build*Request()` methods branch inline on `m.getApiVersion() >= 2`, out of 61 on 2026-10-11. `GetUserImageURL` branches the same way outside that census, and `BuildAuthenticateWithQuickConnectRequest` branches on `versionChecker(server.version, "10.8.0")`. A third API version means editing each of them.
- **direction**: Centralize in a routing table, for example `{ "GetItem": { v1: "/users/{userId}/items/{id}", v2: "/Items/{id}" } }`, which the version-aware methods read instead of branching. Low priority until a third API tier is planned.

#### `apiclient-sync-pool-coexistence`

- **area**: `source/api/ApiClient.bs`, `source/api/sdk.bs`
- **issue**: Four synchronous methods (`AuthenticateByName`, `GetUser`, `GetPublicUsers`, `GetDisplayPreferences`) still go through the legacy `sdk.*` namespace; everything else uses the async `Build*Request()` pattern. The pool is running before sign-in: `setGlobalNodes()` starts it before `reenterLogin()` ([`api.md`](api.md#the-synchronous-methods-left)). The constraint is that `fetchAsync` registers a named render-thread observer, so it works only inside a SceneGraph component. `main.bs` and `loginRouter.bs` run on the main thread, where named observers never fire. (`GetImageURL` and `GetUserImageURL` build URLs and make no request.)
- **direction**: Migrate the four the way the #847 Quick Connect rebuild did: move each call into the render-thread component that wants it, and hand the main thread only the finished result. `user.Login()` stays on the main thread, because it reads and writes the registry. `GetPublicUsers`, `GetUser` and `AuthenticateByName` are reached from `loginRouter`, so each call site moves into `UserSelect` or `LoginScene` first. `GetDisplayPreferences` is called from `user.LoadUserPreferences`. Then remove direct `sdk.*` use from `ApiClient`.

#### `buildparams-no-array-support`

- **area**: `source/api/baseRequest.bs` (`buildParams`)
- **issue**: `buildParams` mishandles every value type except strings, integers, long integers and booleans. Measured 2026-10-10 on a Streaming Stick 4K, Roku OS 15.3.4, with a throwaway Rooibos spec:
  - A decimal is truncated by `stri(int(v))`: `1.5` sends `k=1`, and so does `3 / 2`, since `/` always gives a decimal.
  - An `roArray` is dropped: its branch is a `TODO`.
  - `invalid` sends the text `k=null`.
  - An AA crashes the app: it falls to `EncodeUriComponent()` on a non-string.

  No caller sends an array, a decimal or an AA today (a sweep of the `buildURL`, `buildParams`, `ImageURL` and `injectDefaults` callers on the same date; `m.global.device.uiResolution` measured as `roInt`). Callers join lists into comma strings first (`mediaSources.byIds()`, `nextUpLookupQueries()`, `gridQuery`). `BuildGetResumeItemsRequest` replaces any `MediaTypes` that is not a non-empty string with `"Video"`, so an array there is silently replaced. A list passed as `Fields` crashes earlier, in `injectApiParams()` (`misc.bs`), on `fields.inStr()`.
- **direction**: Harden `buildParams`, as its own PR from `main`: a decimal keeps its fraction, a list is comma-joined (check each endpoint against Jellyfin's spec for the comma or repeated-key form), and an unknown type is logged and skipped instead of crashing. Add a unit test per type, and the `Fields` list case in `injectApiParams`. Then remove the callers' workarounds.

#### `testtoast-in-production-builds`

- **area**: `components/JRScene.xml`, `components/JRScene.bs`
- **issue**: The `testToast` field, its observer in `JRScene.init()` and the `onTestToast` handler ship in every build. Only the cheat-code key handling is inside `#if debug`. ([`debug-flags.md`](../dev/debug-flags.md) says so.)

#### `jrdialog-no-relayout-on-post-mount-change`

- **area**: [`components/dialogs/JRDialog.bs`](../../components/dialogs/JRDialog.bs), [`source/utils/dialogLayout.bs`](../../source/utils/dialogLayout.bs)
- **issue**: A `JRDialog` does not re-lay-out after it is on screen, so changing `title`, `message` or `subheading` on an open dialog draws the new text over the old layout. `renderTracking` reports visibility, so it fires once, from none to full, and never again. Measured on a Roku Ultra `4850X` on 2026-08-22: setting `subheading` on an open dialog left it at `[627, 516]`, on top of the message, and a shorter `message` did not resize the panel either.
- **severity**: Low. The helpers in [`dialogs.bs`](../../source/utils/dialogs.bs) set text before `presentOverlayDialog` appends the dialog. The one exception, `PlayerHostView.onStillWatchingTick`, rewrites a single-line `subheading` every second, which cannot change a height ([`dialogs.md`](dialogs.md) records it). The constraint is documented at `JRDialog`'s change handlers.
- **direction**: Needed when a caller wants to change an open dialog's height, such as a progress dialog. `applyLayout()` needs a re-run path that does not depend on a visibility change. [`OverviewDialog`](../../components/OverviewDialog.bs) is the worked example: it re-lays-out from three settle signals, and its `sections` reconcile by row `id` after mount, rewriting values in place for a same-shape update and re-laying-out only on a shape change. The work is porting that. Re-grade to Medium when such a caller lands.

#### `dialog-channels-unarbitrated`

- **area**: [`source/utils/dialogs.bs`](../../source/utils/dialogs.bs), [`components/dialogs/JRKeyboardDialog.bs`](../../components/dialogs/JRKeyboardDialog.bs)
- **issue**: The two dialog channels can be open at once and nothing arbitrates between them. `presentOverlayDialog` keeps exactly one scene-appended overlay (decision `one-overlay-dialog-supersedes`), and Roku's modal channel (`m.scene.dialog`) holds one by construction, but neither knows about the other. The modal channel has one writer, `showKeyboardDialog`. The scenario this entry was filed for is a cast `DisplayMessage` arriving while the user types in `SetServerScreen` or `ConfigList`. That now looks unreachable: both keyboard callers are pre-login only (`ConfigList` is used by `LoginScene`), the cast receiver is launched from `Home`, and `SignOut` stops it before every return to sign-in. What remains is the moment after STOP while the receiver winds down, since STOP is not a join. Nothing has checked this on a device.
- **severity**: Low, and provisional. Roku's [`scene.md`](https://gitlab.com/rokudev/dev-doc/-/blob/v2.0/docs/REFERENCES/scenegraph/scene.md) says nothing about how a modal dialog stacks against scene children.
- **direction**: Confirm on a device that a cast notice cannot arrive while a keyboard dialog is open, then retire this entry. Do not fold the modal channel into the overlay supersede: that would cancel an open keyboard and discard what the user typed. The keyboard wraps an OS control, so it cannot leave the modal channel the way Quick Connect and the playback-error dialog did.

#### `itemgridoptions-hand-rolled-dialog`

- **area**: [`components/ItemGrid/ItemGridOptions.xml`](../../components/ItemGrid/ItemGridOptions.xml), [`components/ItemGrid/ItemGridOptions.bs`](../../components/ItemGrid/ItemGridOptions.bs)
- **issue**: The library view, sort and filter panel is a hand-built dialog that predates the `JRDialog` family; the [`no-hand-rolled-dialog`](../../scripts/bsc-plugins/no-hand-rolled-dialog.cjs) plugin found it. It draws its own full-screen 0.75-opacity backdrop and fixed panel, places children at fixed offsets rather than through `computeDialogLayout`, extends `Group` rather than `JRGroup`, and uses Roku's own `RadiobuttonList`, `CheckList`, `ButtonGroup` and `Button` (its top row is the app's `JRButtons`). So it sits outside the family's guarantees. It is not on the overlay channel, so `isOverlayDialogOpen`, `cancelOpenDialog` and the one-overlay supersede cannot see it, and a restyle of the family will not reach it.
- **severity**: Low. It works today. The grade is about drift: it is the one surface a change to `JRDialogPanel` or `dialogLayout.bs` will not reach. A `bsc-disable-next-line no-hand-rolled-dialog` comment pointing here keeps the gate green.
- **direction**: Decide what it should be in family terms before touching the markup. Three list modes and a favorites toggle share one panel and swap by opacity. The family's rule is one class of focusable thing per dialog, so the answer is likely several `showListDialog` calls. Removing the suppression comment is the definition of done. [`itemgridoptions-single-active-filter`](#itemgridoptions-single-active-filter) belongs to the same decision.

#### `itemgridoptions-single-active-filter`

- **area**: [`components/ItemGrid/ItemGridOptions.bs`](../../components/ItemGrid/ItemGridOptions.bs) (`onKeyEvent`'s filter branch), [`components/ItemGrid/BaseGridView.bs`](../../components/ItemGrid/BaseGridView.bs) (the options restore pass, `optionsClosed`)
- **issue**: Only one filter category can be active at a time, so categories replace each other instead of combining. `m.top.filter` is one string, `filterOptions` is built as a one-key AA (`newFilter[m.top.filter] = …`), and the restore pass reads `m.filterOptions.keys()[0]`. Picking Genres clears `Unplayed`, and picking Years clears Genres. The server is not the limit: `LoadItemsTask2` appends whatever keys `filterOptions` holds, and on 2026-09-22 a local 12.0.0 server answered `AudioLanguages=eng&Genres=Action` with the intersection. The 12.0 language filters (#1002) make it visible: "English audio with Spanish subtitles" is a query the server can answer and the panel cannot express.
- **severity**: Low. Each category works on its own, so this is a missing feature, not a defect. Re-read the grade as features land on the panel.
- **direction**: Make the selection multi-key: `filterOptions` holds one entry per category, and `filter` stops doubling as "which category owns the options". The registry already stores the AA as JSON, so persistence needs no schema change. Settle first what the title shows when several are active (`updateTitle()` reads the single `m.filter`), and whether the exclusive pseudo-categories (`All`, `Favorites`, `Played`, `Unplayed`, `Resumable`, which map to `Filters=`) stay one radio group. Do it with [`itemgridoptions-hand-rolled-dialog`](#itemgridoptions-hand-rolled-dialog).

#### `bsconfig-files-duplicated`

- **area**: the repository root: `bsconfig-base.json` and the eight `bsconfig*.json` that inherit from it; the five test-runner configs carry what remains
- **issue**: BSC's `extends` merges shallowly. A child that sets `files`, `plugins`, `diagnosticFilters` or `rooibos` replaces the parent's value, so it cannot inherit an array and change one entry. Only `compilerOptions` merges key by key. `bsconfig-base.json` holds `compilerOptions`, every `diagnosticFilters` entry and `outDir`, and [`bsconfig-inheritance.test.js`](../../tests/scripts/unit/lint/bsconfig-inheritance.test.js) stops children from redefining them. What remains duplicated is the shallow-merge case: the `files` arrays and `rooibos` blocks of the five test-runner configs, and the three-entry test `plugins` list in the four runnable ones. `bsconfig-tdd-sample.json` extends `bsconfig-tests.json` to inherit that list. [`build-and-tooling.md`](build-and-tooling.md) explains the merge rule.
- **direction**: A `bsconfig-tests-base.json` could hold the test `plugins` list, but `files` and `rooibos` would still be restated, so it saves three lines per config. That is not worth a second inheritance level unless the plugin list starts to drift. A real fix needs BSC to merge arrays or support `files` additions upstream.

#### `mixed-esm-cjs-scripts`

- **area**: `scripts/` (top level), `scripts/lib/`, `scripts/lint/`
- **issue**: `package.json` sets `"type": "module"`, so new code defaults to ESM, but the tree mixes both:
  - **Top level:** the `.js` scripts are ESM; three are `.cjs` (`create-package.cjs`, `create-signed-package.cjs`, `ropm-hook.cjs`).
  - **`scripts/lib/`:** `.cjs`, except four ESM files nothing `require()`s (`fixture-probe.js`, `odc-probe.js`, `png-compare.js`, `pr-title.js`).
  - **`scripts/lint/`:** mostly `.cjs`, the rest ESM (`ls scripts/lint/*.js` lists them). `floor-coverage-check.js` must be ESM, because it imports named exports from the ESM `findings-candidates.js`.

  The forward rule for new scripts is ESM `.js` unless something `require()`s it.
- **direction**: Audit the require graph first. Anything `require()`d by a BSC plugin or another locked CJS file is forced `.cjs`; a CLI script nothing requires can move to ESM. The conversion is mechanical (`require` to `import`, `module.exports` to `export`, `__dirname` to `fileURLToPath(import.meta.url)`), but some scripts that look standalone are required by lint-staged or other CJS callers.
- **enforced**: [`scripts/CLAUDE.md`](../../scripts/CLAUDE.md) states the forward rule, and [`scripts-development.md`](../dev/scripts-development.md) covers the gotchas. ESLint's `eslint-plugin-n` `flat/mixed-esm-and-cjs` preset handles both extensions.

#### `roku-log-guard-without-pkgpath-recurses`

- **area**: `scripts/bsc-plugins/roku-log.cjs`
- **issue**: The plugin's `visitedLines` dedup is set inside the `insertPkgPath` branch, so it never fires with `guard: true, insertPkgPath: false`. With that combination, wrapping a call in a new `IfStatement` makes the AST walker re-enter it, wrap it again, and recurse until the plugin's error handler catches the `RangeError`. The first edit completes, so the output looks right but is corrupted. Production never hits it: the defaults are `guard: false`, and prod uses `strip: true`, which returns before the guard.
- **direction**: Move `visitedLines[range.start.line] = true` out of the `insertPkgPath` block so it is set whenever a log call is visited. The guard scenario in `roku-log.test.js` combines `guard` with `insertPkgPath` to avoid the bug; drop that workaround once fixed, so the test catches a regression.

#### `two-async-model-split`

- **area**: `source/api/apiPromise.bs`, `source/api/apiPool.bs`
- **issue**: JellyRock runs two async models on purpose: promises (`fetchAsync`) on the render thread, and blocking `fetchRes` / `fetchJson` inside Task threads for the bootstrap path and for orchestrators with linear or branching flow ([ADR 0012](../adr/0012-promise-native-interface-fetchres-exception.md)). A third pattern, `apiPipeline.bs` (non-blocking `submitApiRequest` plus a bounded wait, on one Task), runs independent fetches concurrently without async/await. `LoadLatestRowsTask`, `LoadItemsTask2`'s genre samples (#769), `LoadExtrasRowsTask` (#922) and `LoadItemsTask`'s Next Up kind (#1124) use it. Still blocking:
  - `QuickPlayTask`
  - `LoadItemsTask`'s other kinds
  - `LoadItemsTask2`'s main item query and its `logoHead` request
  - `LoadVideoContentTask`
  - the `liveTv` tasks
  - several `items.bs` helpers

  Non-pool HTTP (fonts, captions, SSDP over raw `roUrlTransfer`) stays as blocking Tasks ([ADR 0014](../adr/0014-non-pool-http-stays-task-blocking.md)).
- **direction**: Collapse to one promise model once BrighterScript ships async/await, which restores the linear readability that justifies blocking `fetchRes` today. Revisit ADR 0012 then. Convert the kept Task internals to `await fetchAsync`, and run each orchestrator's independent fetches through `await promises.all([...])`. Until then the split is correct. Do not rewrite working orchestrators into promise loops early: it costs readability and risks regressions on hot paths.

#### `legacy-print-statements`

- **area**: 12 component `.bs` files (the font tasks, `JRButtons`, `JRButtonGroup`, `JRLabel`, `JRScrollingLabel`, `JRLabelList`, `JRRowList`, `JRTimeGrid`, `HomeRows`, `VideoPlayerView`) and `source/data/JellyfinDataTransformer.bs`. `ResumeButton.bs` carries the opt-out header with no `print` left.
- **issue**: Raw `print` statements remain where `m.log.*` could be used (component and class methods). Prod builds strip `m.log` calls but not `print`, so these reach the device log unconditionally.
- **direction**: In each file, import `pkg:/source/roku_modules/log/LogMixin.brs`, create `m.log = new log.Logger("…")` in `init()` (or the class constructor), and convert each `print` to the right level. Each file carries a `' bsc-disable-file print-locations` header pointing here; remove it with the last `print`. Remove `ResumeButton.bs`' header now, so a new `print` there is flagged.
- **enforced**: `scripts/bsc-plugins/print-locations.cjs` flags every new `print` outside `source/main.bs` and the `globals.bs` debug block, skipping free functions in `source/`, which have no `m`.

#### `tokenize-stopwords-duplicated`

- **area**: `scripts/journal-sync.js`, `scripts/lint/progress-cursor-nudge.cjs`
- **issue**: `tokenize()` and the `STOPWORDS` set are copied between the two files. The sets have already drifted: only the nudge has `branch` and `pattern`.
- **direction**: Extract to `scripts/lib/tokenize.cjs`. `progress-cursor-nudge.cjs` `require()`s it, and `journal-sync.js` imports it the way it already imports `./lint/dictionary-audit.cjs`. Then delete both copies.

#### `sd-resolution-native-support`

- **area**: `manifest`, `scripts/generate/icons-build.js`, `images/icons/`
- **issue**: The manifest maps `uri_resolution_autosub=$$RES$$,sd,hd,fhd`, but no `_sd` icons ship. Correct SD rendering needs non-square pixel handling (720 by 480 pixels with an 8:9 or 32:27 aspect, depending on output mode), and a naive square-pixel render would squash the icons. `$$RES$$` keys off the device's UI resolution even under `ui_resolutions=fhd` (decision `retire-hd-native-layout-refactor`), so an SD device would ask for the `_sd` file. Roku's manifest reference describes no fallback when that file is missing. Only a 480p display would hit this, and no device that is current or can still update in `scripts/data/roku-hardware.json` has an SD UI.
- **direction**: If SD becomes a target, add an SD render path to `icons-build.js` that compensates for the pixel aspect. Verify on hardware: set the Roku display type to 480p, sideload, and compare a hand-made SD asset with what the device does today. Check first what an SD device does with the missing `_sd` file. Raise to Medium if SD-specific reports arrive.

#### `nul-bytes-in-scripts-source`

- **area**: `scripts/**/*.{js,cjs}`; a guard would live in `scripts/lint/`
- **issue**: A literal NUL byte used as an in-memory join separator has been committed into a `scripts/` source file twice: `findings-candidates.js` (`opKey`, which now joins with a space) and `spec-diff.js` (`changeSortKey`, now the `'\0'` escape). A literal NUL makes git and `file(1)` treat the source as binary, so it lands with no reviewable diff. Nothing stops a third: ESLint's `no-control-regex` covers only regular expressions, and Prettier passes a file containing a NUL.
- **direction**: Add a CI-gated lint (for example `scripts/lint/no-control-bytes.cjs`) that fails when a `scripts/**/*.{js,cjs}` file contains a NUL or another control byte besides tab and newline, wired into `npm run lint` and pre-push.

#### `exit-net-summary-lost-on-macos-pipe`

- **area**: [`scripts/run-record.js`](../../scripts/run-record.js) (`armCloseOnExit`): the `process.on('exit')` net that folds a device run its entry point never closed
- **issue**: The net prints the run summary with `console.log` inside an `exit` handler, which is safe only while stdout writes are synchronous. They are for terminals, files and pipes on Linux, but stdout writes to a pipe are asynchronous on macOS. So a macOS contributor who pipes an interrupted run (`npm run test:rta | tee log`) can lose the summary on Ctrl-C. Nothing durable is lost: the fold uses `fs.writeFileSync` and `fs.appendFileSync`, so `run-meta.json` and the `.device-runs/<kind>/runs.jsonl` ledger land regardless.
- **direction**: Only if a macOS contributor reports it. Then have the exit handler write the summary lines into the run record and print them on the next run, or have `npm run device:status` render the last run's summary. Either avoids an asynchronous write on the exit path.

#### `remotecontrol-socket-abrupt-teardown`

- **area**: `source/api/userAuth.bs` (`SignOut`, `StopRemoteControlReceiver`), `components/remotecontrol/RemoteControlTask.bs`
- **issue**: `StopRemoteControlReceiver` stops the receiver with `control = "STOP"`, which ends the Task thread before the transport is torn down. On `ws://` (#666) the socket gets no close handshake. On long-poll (#667) an in-flight poll, held up to `POLL_TIMEOUT_MS`, is abandoned rather than canceled. Both are harmless: Jellyfin reaps the session on its inactivity timeout, and the same sign-out invalidates the token. But each leaves a short-lived dangling resource on every sign-out or server switch. It also STOPs the socket child through the `socketNode` field `RemoteControlTask` publishes ([`remote-control.md`](remote-control.md) explains why the teardown is abrupt).
- **direction**: Have the receiver watch for a shutdown signal and close the transport before exiting: `close = [1000]` on the `WebSocketClient`, `AsyncCancel` on the outstanding poll. What the graceful path needs is the sequence (request close, wait for the handshake or a timeout, then STOP), not only the call. Low priority, unless a half-open socket ever proves visible.

#### `api-usage-manifest-no-per-endpoint-binding`

- **area**: [`docs/architecture/api-usage-manifest.json`](api-usage-manifest.json), [`scripts/generate/api-usage-manifest.js`](../../scripts/generate/api-usage-manifest.js)
- **issue**: `requestFields` is flat and repo-wide (`{name, sourceFiles}`, no endpoint), and `REQUEST_FIELD_GLOBS` scans only `source/api/**/*.bs` plus `source/syncplay/syncPlayRequests.bs`, narrower than the endpoint scan's `source/**`. So it cannot compare the parameters we send with the ones an endpoint declares, and it cannot see `components/**` (or `source/data/`, `source/utils/`) call sites. #784 hit both: see [Known limitations](server-upgrade-automation.md#known-limitations-what-this-pipeline-cannot-catch).
- **direction**: Bind request fields to the endpoint they are sent to, and widen the scan past `source/api/**`. One data point so far; revisit if it recurs.

#### `cell-load-starts-do-not-reconcile`

- **area**: [`source/utils/cellLoad.bs`](../../source/utils/cellLoad.bs), [`waitCellsQuiet`](../../tests/rta/lib/steps.js)
- **issue**: `loadsStarted - (loadsFailed + loadsSucceeded)` should be zero when a run ends on quiet, and it is not: 15 to 21% of issued requests reached neither terminal counter when measured (#840 has the figures). An unload can swallow a resolution: both cell components' load-status observers return early on `isTextureUnloaded`. Unloads explained most of the gap on one arm but under half on the other, and the gap does not scale with requests, so the rest is unexplained. `unload()` now records why a cell was unloaded (`unloadsRange`, `unloadsWindow`, beside the total `unloads`), so a re-run could attribute the gap to an eviction path. That re-run has not been done. It does not threaten the reload-guard result: the gap is larger on the arm with more wiped glyphs, so it can only widen that difference.
- **direction**: Separate two candidates. (a) Reassigning a poster URI while a request is in flight may drop the request with no status callback. (b) Some requests do not resolve within the quiet window. A counter where the observers return early on `isTextureUnloaded` tells them apart. Until then, read `loadsStarted` as attempts issued, never completed, and never infer a success count from it by subtraction. The parser test pins that.

#### `measurement-invariants-ungated`

- **area**: [`scripts/measurements.js`](../../scripts/measurements.js) (the `MEASUREMENTS` registry), [`scripts/measure-loop.js`](../../scripts/measure-loop.js) (`assembleSamples`)
- **issue**: A measurement family can have fields that must hold a relation to each other, and the registry cannot say so, so the check lives in a doc instead of the harness. In `home-latest-rows`, `sizeCalls - sizeRemove - sizeInsert` is the end-of-run flush and must be 0 or 1. Above 1, a recompute reached `setRowItemSize()` by a path neither counter tags, crediting a sample to the wrong call site. Below 0, a counted call site did not reach it, because `setRowItemSize()` returns early on an invalid `m.top.content` before its own increment. That direction is unreachable today, since both call sites read `m.top.content` first. `rowRemoveSeq` has the same shape: it must read 1 on every complete sample. Both held whenever checked by hand (#856, #862). The unit test that names the flush invariant checks a hand-written line, not a real arm.
- **direction**: Add an optional per-family `sanity` list: a label and a predicate over a sample's fields, evaluated where samples are assembled. Report a violation as a `[measure] ⚠` line naming the family, launch and relation. Do not drop the sample, which would hide the case the check exists to show. Guard predicates against absent fields: those lines are `required: false`, so a baseline build without the instrument still records. A naming convention cannot cover this, because `counts` and `workload` classify one field at a time and a relation is known only to its family. Take this with [`measure-record-assembly-untested`](#measure-record-assembly-untested) if that extraction happens first. [`homerows-geometry-invariant-ungated`](#homerows-geometry-invariant-ungated) is the same kind of gap on the app side.

#### `trackdropdown-selected-treatment`

- **area**: [`components/ui/dropdown/TrackDropdownRow.bs`](../../components/ui/dropdown/TrackDropdownRow.bs)
- **issue**: `TrackDropdownRow` marks the current track by drawing its label in `colorTextSecondary`, which plays the user's pick down rather than marking it. The two other components that mark a current choice disagree with it and with each other. `JRDropdownItem` recolors the selected label to `colorSecondary`, and only while unfocused. `JRListDialogRow` shows a `colorSecondary` check over a `colorBackgroundSecondary` surface and leaves the label at `colorTextPrimary`. So choosing an audio or subtitle track marks the current value one way before playback (the dropdown) and another way during it (the list dialog).
- **direction**: Give `TrackDropdownRow` the `JRListDialogRow` treatment (a check and a surface, label unchanged), and settle at the same time whether `JRDropdownItem`'s unfocused-only rule is the convention. Do not recolor the label too: with a surface already there, a third treatment was too much contrast on a device (the `JRListDialogRow` comment records it). A shape survives color blindness and a dim panel, which a hue change does not. Check that the row height fits a glyph first.

#### `vendored-source-maps-shipped`

- **area**: `components/roku_modules/log/` and `source/roku_modules/log/` (prebuilt maps ropm vendors with roku-log; generated, gitignored)
- **github**: #986 (adopt roku-log as owned code)
- **issue**: roku-log ships prebuilt `.map` files whose `sources` are absolute paths on its author's machine. Copying them into builds is fixed: every `files` array ends with `"!**/*.map"` (gated by [`bsconfig-inheritance.test.js`](../../tests/scripts/unit/lint/bsconfig-inheritance.test.js)), and a prod build holds no maps. What remains: BSC reads each co-located map (`util.resolveInputSourceMap`) and chains it into the map it writes. So in dev, test and analysis builds, a `roku_modules/log` frame maps to paths that exist nowhere, and [`/crash-report`](../../scripts/crash-report.js) resolves such a frame with no code snippet.
- **direction**: Adopt roku-log as owned code (#986). The prebuilt maps leave with the ropm dependency, and BSC maps its frames to files in this repo. Low, because roku-log calls are stripped in prod.

#### `jrtabbar-ondestroy-never-called`

- **area**: [`components/ui/tabbar/JRTabBar.bs`](../../components/ui/tabbar/JRTabBar.bs), `components/JROverhang.bs` (`onTabsChanged`), [`components/home/Home.bs`](../../components/home/Home.bs)
- **issue**: `JRTabBar` declares an `onDestroy` (it unobserves `tabs`, `focusedTabIndex` and `focusedChild` and clears its container) that nothing calls. The overhang owns the bar: `JROverhang.onTabsChanged` creates it and hides it when the tabs empty, to reuse it. `Home` only borrows it; in its own `onDestroy` it unobserves `requestFocusReturn` and drops the reference. `JROverhang` has no `onDestroy`. So the injected `m.isDestroyed` guard in `JRTabBar` is inert, and nothing leaks today, since the bar lives as long as the overhang.
- **direction**: Pick one and make it true. Delete the dead `onDestroy` so it stops reading as live teardown, or give the overhang a teardown that cascades into it. Do not cascade from `Home`: that would destroy a bar the overhang reuses.

#### `dev-tooling-platforms-unverified`

- **area**: [`scripts/lib/env-config.cjs`](../../scripts/lib/env-config.cjs) (the per-user env file), and developer tooling in general
- **issue**: The per-user env file loader is verified only on Linux, and no doc says which developer platforms the tooling supports. On macOS it should work as written (`~/.config`, with `XDG_CONFIG_HOME` honored), though `~/.config` is not Apple's convention. On Windows it resolves to `%USERPROFILE%\.config\jellyrock\env`, which works but is not where Windows tools keep settings (`%APPDATA%`). The loader's fixtures are separator-neutral, but every hosted CI job runs on `ubuntu-latest`. Some tooling assumes a Unix shell anyway: `test:rta:fast` uses `VAR=value command`, and the husky hooks are `sh` scripts.
- **direction**: Decide and document the supported platforms. If macOS or Windows is in scope, verify the loader there or add a CI leg for `npm run test:scripts`. For Windows, consider reading `%APPDATA%\jellyrock\env` first. Fix the Unix-only npm scripts at the same time, or the loader working there buys little.

#### `poster-badge-system-undesigned`

- **area**: [`components/ui/poster/JRPoster.xml`](../../components/ui/poster/JRPoster.xml), [`components/ui/poster/JRPoster.bs`](../../components/ui/poster/JRPoster.bs)
- **issue**: The poster carries two badges, watched mark or `unplayed` count at top right and alternate versions at bottom left, each placed on its own merits, with no agreed system for a third. Whether new signals take their own corners or share one rail, and which metadata earns a place on a tile, are both open. jellyfin-web puts most card indicators in one top-right rail of round chips, and that rail holds no HDR, Dolby Vision, `Atmos` or resolution. It shows the version count separately, in a round chip at top left (`.mediaSourceIndicator` in `cardBuilder.js`). So web answers the versions question differently in corner, shape and content, and JellyRock's chips are rectangular besides. Geometry limits it too. Portrait posters are 213, 234 or 264 pixels wide depending on the screen. The watched badge is 90 pixels wide and the versions badge 48. A rail of three badges would crowd a narrow poster.
- **why it is not decided yet**: With two badges the question is not forced, and settling it on a reference check alone would lock a convention before the case that tests it exists. Two sub-decisions are made:
  - **An icon, not a count, for versions.** The top-right badge is already a number (`unplayedVideosCount`), so a second number meaning something else would hurt legibility.
  - **A badge must not depend on its container.** A badge that shows on a poster in the library and vanishes on the same poster elsewhere reads as a bug.

  Whether a quality signal like Dolby Vision belongs on a tile, and whether it should show only on a device that can play it, is the question that decides the layout. Deciding it per tile at render time is an unmeasured cost.
- **direction**: Settle it before a third badge lands; the favorite mark is the likely trigger. Decide in this order, since each answer constrains the next. (1) Which signals earn a tile. A candidate rule is "it must change what you would do", under which watched, progress, versions and favorite qualify, while descriptive quality does not, since [`mediaDisplayTitle.bs`](../../source/utils/mediaDisplayTitle.bs) already shows resolution, codec and HDR on the details screen and in the OSD. (2) Rail or corners, given the count and the narrowest poster. (3) Chip size and shape. Do not add a third badge in the meantime; that would make the decision silently.

#### `poster-badge-setting-name-drift`

- **area**: [`components/ui/poster/JRPoster.bs`](../../components/ui/poster/JRPoster.bs), [`components/ItemGrid/GridItem.bs`](../../components/ItemGrid/GridItem.bs), [`components/ui/rowitem/JRRowItem.bs`](../../components/ui/rowitem/JRRowItem.bs), the `uiTvShowsDisableUnwatchedCount` setting
- **issue**: The setting is named for the `unwatched` count but governs more. `JRPoster.init` reads it into `m.disableWatchBadge`, which also hides the watched check, and `GridItem.renderMediaItem` gates its whole badge block on it. The alternate-versions badge does not inherit it on purpose, since a name promising one thing must not grow to mean all poster badges. So a user who turned it on to quiet their grid gets a badge they cannot turn off, and the name is further from its behavior than before.
- **direction**: Do this when the favorite badge lands. One badge does not justify a settings group; three do. Then add a **Poster badges** group with a toggle per signal, migrate `uiTvShowsDisableUnwatchedCount` into it ([`registry-migrations.md`](../dev/registry-migrations.md)), and decide whether the migrated key keeps hiding the check or splits into two. Shape the group around [`poster-badge-system-undesigned`](#poster-badge-system-undesigned).

#### `language-coverage-script-misnamed`

- **area**: [`scripts/lint/language-coverage.cjs`](../../scripts/lint/language-coverage.cjs), its npm script `lint:language-coverage`, and [`tests/scripts/unit/lint/language-coverage.test.js`](../../tests/scripts/unit/lint/language-coverage.test.js)
- **issue**: The script gates three localization lookup tables, not one: the media-language resolver, the `PersonKind` label table in `people.bs` (`personKindTranslationKeys()`, `unlabeledPersonKinds()`, checked against the spec fingerprints since #975), and `creditRowKinds()` in the same file. Its name, npm script and test file still say "language", so someone searching for the gate on person labels will not find it. It was extended rather than renamed because the language and `PersonKind` tables share a shape, a parser (`parseAA`) and a failure mode. `creditRowKinds()` is ordered, so it needed `parseAAArray` as well. A rename touches the CI parity wiring (`lint:ci-parity`, `lint:ci-workflow-sync`).
- **severity**: Low. The name misleads; the check works, and since #1160 its CI and pre-push triggers include `people.bs`. `parseAA` and `parseAAArray` both read BrightScript by regex, and a comment above `parseAA` already calls for a tokenizer. A fourth table of a third shape is the point to build one.
- **direction**: Rename to a name covering every table (for example `lint:translation-table-coverage`), moving the npm script, the CI reference, the test file and the doc mentions in one change. Do not split it into two scripts, which would copy `parseAA`.

#### `translate-per-item-task-copy`

- **area**: [`source/utils/translate.bs`](../../source/utils/translate.bs) (`translate()`), and every Task-thread caller that translates per item
- **issue**: `translate()` reads `m.global.translations[key]`. From a Task thread, that read is a render-thread rendezvous that copies the whole translations table (several hundred keys) on every call. While the user scrolls, each one also waits on the busy render thread ([`async.md`](async.md#crossing-the-thread-boundary-costs-a-rendezvous--budget-crossings-not-bytes)). Three per-item paths are fixed:
  - The TV guide's channel load resolves its label once per page (`LoadChannelsTask`, `JellyfinDataTransformer.getChannelLabel()`; #991).
  - `sortSubtitles()` reads the table once per subtitle list through `translateCached()`.
  - `people.bs` `personCreditLabel` reads it through `translateCached()` too; the comment on `translateCached()` has the measurement.

  Other Task-thread callers have not been audited.
- **severity**: Low. It is cheap on an idle screen for a few calls; it matters only in a per-item loop on a Task.
- **direction**: Audit Task-thread `translate()` calls for per-item use and hoist each to once per run, or route it through `translateCached()`. A cache inside `translate()` must not outlive the run, since the locale can change mid-session.

#### `latest-rows-launch-failure-leaves-flags-set`

- **area**: [`components/home/HomeRows.bs`](../../components/home/HomeRows.bs) (`startLatestMediaLoads`)
- **issue**: `startLatestMediaLoads` sets `m.isLoadingLatestRows` and `m.rowSizesBatching` before `launchTask`, and returns `false` without clearing either when the launch is refused. Home then believes a latest-rows run is going: a refresh skips the Recently Added rows, and OK on a failed one waits for a retry instead of starting one. Only `resetLatestRowsRun` clears them, when a later `startLatestMediaLoads` finds the run stalled (`latestRows.runIsStalled`). There is no timer, so that waits for the next refresh or retry past the stall budget.
- **severity**: Low. `launchTask` returns `false` only for an invalid node or a full launch queue ([ADR 0041](../adr/0041-task-launch-queue.md)). Named when the direct Recently Added retry (decision `home-row-failure-tile`) became the first caller to act on the `false` return.
- **direction**: Set both flags only after the launch is accepted, or clear them on the `false` path, then re-run `home-failure.spec.js` on a device.

#### `subtitle-track-name-matchers-duplicated`

- **area**: `VideoPlayerView.availSubtitleTrackIdx()`, `trackPickerOptions.availableSubtitleTrackIndex()`
- **issue**: Two functions match a subtitle stream to Roku's rewritten `TrackName` by substring (`inStr`). The `VideoPlayerView` copy has no `isValid` guards and no `> 0` test, so the two can disagree on the same track.
- **direction**: Keep one matching function, with the guards, and call it from both places; one spec covers it.

#### `two-plugins-bypass-bsc-rule`

- **area**: [`unobserve-before-release.cjs`](../../scripts/bsc-plugins/unobserve-before-release.cjs), [`auto-abandon-promises.cjs`](../../scripts/bsc-plugins/auto-abandon-promises.cjs)
- **issue**: Both define their own `afterValidateFile` and call `hasSiblingComponentXml()` by hand, the two-file shape [`scripts/lib/bsc-rule.cjs`](../../scripts/lib/bsc-rule.cjs) exists for and eight other plugins use.
- **direction**: Move both onto `bsc-rule.cjs`; their existing tests should pass unchanged.

#### `lint-exclude-lists-drifted`

- **area**: [`scripts/lib/lint-excludes.cjs`](../../scripts/lib/lint-excludes.cjs), the `lint:*` scripts in `package.json`, `.lintstagedrc.cjs`
- **issue**: The pre-commit excludes and the `package.json` excludes are meant to match and have drifted: `package.json` also leaves `**/copilot-instructions.md` out of spelling, `build-analysis/` out of markdown and JSON, and `tests/rta/` out of JSON. Both file headers admit it, and nothing checks parity.
- **direction**: Build the `package.json` globs from `lint-excludes.cjs`, or add a test that the two lists agree.

#### `docs-check-skips-claude-dir`

- **area**: [`scripts/lint/docs-check.cjs`](../../scripts/lint/docs-check.cjs)
- **issue**: `lint:docs` skips every directory whose name starts with a dot, so links and anchors in `.claude/` (skills, rules, agents) are never checked. They were probed by hand once, on 2026-10-11 for #1161.
- **direction**: Scan `.claude/` too, or record the exclusion as a decision if scanning it costs more than it finds.

#### `dead-selecteditem-fields`

- **area**: `components/home/Home.xml`
- **issue**: `Home.selectedItem` is declared, and nothing writes or observes it. A reader can wire to a field that never fires. (`SearchResults.selectedItem` went with that screen; `SearchScreen` declares none.)
- **direction**: Remove the field, or list it in the dead-code epic #1072.

#### `path-normalization-triplicated`

- **area**: `normalizeSpecPath()` in [`scripts/lib/spec-path.cjs`](../../scripts/lib/spec-path.cjs), `normalizePath()` in `scripts/generate/api-usage-manifest.js` and in `scripts/lib/endpoint-availability.cjs`
- **issue**: Three copies of the endpoint-path rule must agree for the server-upgrade join to work. They agree today; `spec-path.cjs`'s header names the other two, and no test checks them.
- **direction**: Have the other two import `normalizeSpecPath()`.

#### `prod-bsconfig-plugin-gap-unrecorded`

- **area**: `bsconfig-prod.json`, `bsconfig.json`
- **issue**: The prod config leaves out six plugins the dev config runs (`brighterscript-xml-plugin`, `callfunc-interface`, `button-row-bracket`, `field-observer-wiring`, `register-once-observer`, `dead-code`) with no recorded reason. `validate` still runs them on every PR, so nothing slips today; the gap is a silent carve-out.
- **direction**: Record why (most likely: lint-only plugins change nothing in a prod build) as a decision, or add them to match.

#### `bare-router-navigate-calls-skip-refusal-retry`

- **area**: `components/ItemDetails.bs`, `components/ItemGrid/BaseGridView.bs`, `components/search/SearchScreen.bs`, `components/home/Home.bs` (the voice-search and item-open `sgrouter.navigateTo` calls)
- **issue**: `JRScene.navigateThenFocus` retries a navigation the router refused as "already in progress" (decision `refused-navigation-retried-on-message`). The overhang cluster's search and settings actions on every screen use it through `routerNavigate` (`JRScene.onOverhangIconAction`), as do Home's options-panel actions. The remaining direct `sgrouter.navigateTo` calls, the item-open and link calls, do not, so a press that lands before the previous navigation ends can still be lost, and most of those calls do not log the rejection either.
- **direction**: Route the remaining item-open and link calls (`ItemDetails`, `BaseGridView`, `SearchScreen`, Home's voice search) through `routerNavigate`, or give them a shared wrapper. Check first whether any of those screens can be pressed in the window after Back: only the overhang has been seen to hit it.

## Recently removed: don't go searching for these

- **`scenemanager-stack-unbounded`**, **`printregistry-on-startup`**, **`selecteditem-bubbling-implicit`**, **`changelog-syncer-mixes-validate-mutate`**, **`make-npm-overlap`** and **`trickplay-prefetch-hardcoded`**: retired 2026-10-11 because their premises no longer held.
  - `SceneManager` has had no scene stack since the sgRouter migration (#677).
  - `printRegistry()` prints only inside `#if debug`.
  - `selectedItem` now travels one hop from a row to the view that routes it. `Home.selectedItem` and `SearchResults.selectedItem` are declared and never written.
  - `changelog-syncer.js` runs validate and sync as separate subcommands, and validate writes nothing.
  - The Makefile targets that overlap npm are one-line `npm run` wrappers.
  - Trickplay adapts how many tiles it loads ahead to scrub speed, between `m.minPreloadTiles` and `m.maxPreloadTiles`.
- **`teardown-ordering-unenforced`**: resolved 2026-09-03 by the [`unobserve-before-release`](../../scripts/bsc-plugins/unobserve-before-release.cjs) BSC plugin. [ADR 0032](../adr/0032-teardown-key-guard-injected.md) records the four refinements that made a same-file check precise.
- **`matrix-cannot-establish-its-own-precondition`**: resolved 2026-08-16 by `npm run measure:devices -- --sign-in <url> --user <name>`, which seeds a session per device ([`measure-signin.js`](../../scripts/measure-signin.js)), measures and restores it. The #824 commit has the verification run.
- **`measure-single-device-only`**: resolved 2026-08-16 by [`npm run measure:devices`](../../scripts/measure-devices.js), which reads `ROKU_DEVICES` from `.env` and takes tiers from [`roku-hardware.json`](../../scripts/data/roku-hardware.json). The matrix report reads `measurements.jsonl` (decision `matrix-report-is-a-reader`).
- **`hd-native-layout-refactor`**: retired 2026-08-07 without being implemented. Hardware checks disproved its premise; decision `retire-hd-native-layout-refactor` has the findings and the re-open trigger. The 720p `Gradient` banding found then was fixed separately ([ADR 0025](../adr/0025-gradient-rendering-ramp-posters.md)).
- **`components/JRVideo.xml/.bs`** and **`source/VideoPlayer.bs`**: the legacy video player, removed in `17cc374f`. `components/video/VideoPlayerView.xml/.bs` is the only video player.
- **`CreateVideoPlayerGroup()`** in `source/showScenes.bs`: removed with the legacy player. The routed equivalent is `PlayerHostView.mountPlayer()`.
- **Legacy subtitle helpers** (`setupSubtitle`, `getSubtitleSelIdxFromSubIdx`): removed in `58500a99`.
- **`components/ItemOptions.xml/.bs`** and **`components/movies/{Audio,Video}TrackList{Data,Item}`**: the modal track popup that the inline `TrackDropdown` replaced, removed in `f4ac1069`.
