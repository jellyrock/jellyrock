---
last-updated: 2026-08-04
---

# Progress

Live state cursor — repo-scoped, ~14-day rolling. The "where did I leave off, what just shipped, what's open" surface.

Sections:

- **Currently running** — 1-2 sentences on what's actively in flight
- **Recently shipped** — newest first; bullets older than 14 days are pruned automatically by the post-merge journal-sync
- **Open followups** — grouped by area; deferred work that's not yet issue-shaped or tech-debt-shaped

This file is updated through skills, not raw markdown edits:

- `/log followup "<text>" --area=<name>` to add an open followup
- `/done <slug-or-keyword>` to flip a followup → recently-shipped
- `/log decision` for decisions (ADR-grade lands in [`docs/adr/`](adr/README.md); sub-architectural in [decisions.md](decisions.md)) — not here

Drift is gated by `npm run lint:docs` — **FAILs** when `last-updated` is >7 days old AND there are commits since.

## Currently running

Epic #728 Phase 1's last design blocker is **closed by measurement**: the grid's genre loop (`LoadItemsTask2`) is **78% network wait / 22% emit** — the inverse of Home, which is 51% emit — so it gets `apiPipeline` and NOT the orchestration job pool. Branch `perf/728-genre-loop-split` is pushed with the permanent wait/emit instrumentation and the performance-doc section, but **no PR is open yet**. Next: `/pr` for that branch, then the two independent builds — migrate the genre loop onto `apiPipeline` (projected 1016 → ~400 ms, re-measurable with the shipped instrumentation), and build the job pool for Home's emit. Mechanism is now chosen **per orchestrator, from a measured split** — do not carry one orchestrator's result to another.

## Recently shipped

Newest first. Prepended by the post-merge journal-sync (and `/done`). Bullets older than 14 days are pruned automatically by that same sync; `/catchup` is only a backstop.

- 2026-08-04 — feat: PR #768 **merged** (`d1ec5683`) — epic #728 Phase 1's accounted `launchTask()` chokepoint, 99 launch sites migrated, `no-raw-run` making a bare launch a build error. The headline review fix: the debug thread ledger silently dropped the five Task threads `setGlobalNodes()` starts — it wrote to an `roSGNode` field that did not exist yet — so `printTaskThreads()` under-reported by a permanent five (device-verified either side of the fix, now a mutation-proven regression test). The post-completion pool refill was **reverted**: 190 measured runs across three device tiers found it slower in 6/6 independent comparisons (sign test p=0.031) and never faster, and its original n=4 justification did not reproduce. Home first-paint baselines were re-measured at n=30 per device against the committed artifact, with `drain` dropped from the published table as an unreliable derived quantity.
- 2026-08-04 — fix(rta): `restoreSession` now proves the restore took — write → cold restart → read back → compare, retrying and THROWING on mismatch, plus `globalRememberMe` added to the snapshot and a `hardRelaunch` (an ECP `/launch/dev` on a running channel only foregrounds it, so the stale in-memory session used to survive and re-persist over the restore). Closes the "`npm run test:rta` can leave the device signed into the demo server" followup, which recurred and stranded two devices during the #768 measurement work before being fixed and dogfooded to recover them.
- 2026-08-03 — fix: Tighten Task-node hygiene and remove stranded dialog helpers
- 2026-08-03 — fix: Remove invalid `focusable` attribute from `<component>` elements
- 2026-08-03 — feat: Collapse `HomeRows` latest-media fan-out onto a bounded `apiPipeline`
- 2026-08-02 — RTA screens `playlistsLibrary` + `playlistDetails` are content-FLAKY: the demo server (`demo.jellyfin.org/stable`) resets hourly and its playlists may be absent/changed, so `findHomeLibraryTile('playlists')` can time out (only `movies`/`tvshows`/`music` guaranteed). Guard/skip these two when no playlists library is present (or seed a playlist), like the other demo-content-dependent screens. Surfaced by the #550 sgRouter PR-hardening RTA run.
- 2026-08-02 — fix: move log-manager init to `JRScene` so global nodes can log
- 2026-07-31 — ci(lint): validate the `docs/decisions.md` supersede chain
- 2026-07-31 — ci(lint): gate that every `npm run lint` check actually runs in CI
- 2026-07-30 — fix(remote-control): bind `ws://` socket to the advertised `DeviceId`
- 2026-07-25 — fix(api): route `SubmitSideEffect` through a children-as-vehicle FIFO
- 2026-07-23 — Fix `inferServerUrl` crash from stale pre-login intents
- 2026-07-23 — chore(ci): improve the `/crash-report` skill workflow
- 2026-07-21 — Report cold-launch pairing and stabilize `DeviceId` on 10.11+

## Open followups

Grouped by area. Append via `/log followup "<text>" --area=<name>`. Close via `/done <slug-or-keyword>`. If the area you need isn't here, add a new `###` subsection.

### scripts

- Expand automated store screenshots from the 5 marketing languages to ALL ~99 locale files, to surface the default Roku OS font's blast radius — boxes/tofu for scripts the system font doesn't cover are EXPECTED and the point of capturing them. From #642.

### components

- Consolidate the `SceneManager` `reloadHomeRequested` Home-reload signal onto `JRScene` (alongside `contentVersion`), so both view-refresh signals live on the router host instead of split across `SceneManager`. Surfaced while cleaning up a stale `JRScene.xml` comment during the #550 sgRouter PR-hardening pass.
- Normalize audio queue items to one transformed (camelCase) shape at queue-build time — `QuickPlayTask.doAlbum/doArtist/doPlaylist/doInstantMix` + the `set()` paths store RAW Jellyfin items while single-song taps store transformed ones, so `createQueueItem` reads both shapes with raw-key fallbacks (`albumName`←`Album`, `primaryImageTag`←`ImageTags.Primary`). Transforming at queue-build kills the duality so every consumer reads one predictable shape (also removes the latent `albumName`-vs-`Album` mismatch class). Deferred from the #550 audio now-playing contract fix (A+C+D shipped: `createQueueItem` carries the now-playing display fields + `QueueItem` interface + spec gate). Bigger blast radius (video queue paths) → needs a hardware verification pass.
- **A failed latest-media row keeps its `type: "Loading"` skeleton placeholder indefinitely**, so it reads as "still loading" when it has actually finished and failed. Deliberate as of PR #762: the alternative (removing the row) makes the next successful refresh re-insert it via `populateRowFromData`'s else-branch, which visibly pops the row in and shifts every row below it — measured on device with 8 libraries and five forced HTTP 500 responses, where the skipped rows held their single placeholder and nothing moved. Accepted cost: it only self-corrects on the next `Home.refresh()` (i.e. `onScreenShown`), so sitting on Home leaves the false loading state up. The better answer is a distinct failed/empty placeholder that keeps the row in place without lying — deferred because it needs a visual design, a translation key, and `JRRowItem` work to render a non-`Loading` placeholder type.
- **Home never removes the row of a library newly added to `latestItemsExcludes`.** `HomeRows.onLibrariesLoaded` recomputes `m.filteredLatest` on every refresh, but that only decides which libraries get REQUESTED — nothing clears the row of a library that dropped OUT of the list, so its stale content sits on Home indefinitely. Note the setting has no JellyRock UI: it arrives from the Jellyfin server's user config (`SessionDataTransformer.bs` ← `configData.LatestItemsExcludes`), so it changes out from under the client and the app never sees an edit event. Fix shape: diff the previous `filteredLatest` against the new one in `onLibrariesLoaded` and remove the rows for dropped ids (`removeRowAtIndex` already exists). This is pre-existing and independent of the #728 orchestrator work — surfaced while reviewing PR #762, deliberately not folded in.

### source

- Migrate the watched toggle (`main.bs`) to the `3c` `callFunc`→`fetchAsync` pattern (mirror `ItemDetails.toggleFavorite`). Extra surface vs favorite: Series "mark all" confirmation-dialog path (2nd entry ~`main.bs:927`), resume-button loading state, `pendingWatched*` bookkeeping. Completes removal of the `isDone` branch + `handleWatchedToggleDone` + `m.watchedResultNode`. #551 Phase 4 settings/misc render-thread batch.
- `inferServerUrl` (`source/utils/misc.bs:302`, called on the render thread from `loginRouter.bs:233` `onServerSubmitted`) runs a synchronous `roUrlTransfer` probe loop up to 15 seconds during server connect — same render-thread-blocking class as #550 `A2` (fixed for the deep-link server-switch probe via `ServerReachableTask`). Out of scope for the current navigation-hardening project (migration cleanup not surfaced by the #550 review). Fix: move the probe to a Task like `ServerReachableTask`.
- **Queue-aware multi-item casting** (remote control #666 follow-up): a Jellyfin `Play` carries the full `ItemIds` list + `StartIndex` + `StartPositionTicks` + `PlayCommand`, but #666 casts only the single `itemIds[startIndex]` via the deep-link seam (`remoteDispatch.dispatchPlay`). Consume the whole list to seed the queue, honor `StartPositionTicks`, and implement `PlayNext`/`PlayLast` semantics (`queueMode` is already parsed by `remoteCommand.playCommandToQueueMode` but ignored) — likely `QueueManager.insertNext`/`push` helpers. Fixes casting a music album (currently plays only track 1). Epic #669.
- **Cast command expansion — player-integrated** (remote control #666 follow-up): advertise + handle more `GeneralCommandType`s that need player/Live-TV integration — `SetAudioStreamIndex`/`SetSubtitleStreamIndex` (remote audio/subtitle switching during playback, via the player's existing track APIs) and `ChannelUp`/`ChannelDown` (+ a `/guide` route for `Guide`) for Live TV. Add each to `getSupportedRemoteCommands` and a dispatch handler. #666 ships nav + messaging only (`GoHome`/`GoToSearch`/`GoToSettings`/`Back`/`DisplayMessage`). Epic #669.
- **Cast command expansion — platform + ECP** (remote control #666 follow-up): (a) `SetVolume`/`VolumeUp`/`VolumeDown`/`Mute` — a streaming player has no system-volume API, but a **Roku TV** exposes more OS surface; investigate whether volume is controllable there before advertising it. (b) directional D-pad (`MoveUp/Down/Left/Right`, `Select`, `PageUp/Down`) + `SendKey`/`SendString`/`TakeScreenshot` — not injectable into the SceneGraph focus from inside the app, but doable via **ECP** (as the RTA tests do); would ride the planned #667 server plugin. Deferred to that effort. Also fold `SetShuffleQueue`/`SetRepeatMode` into the queue-aware casting followup above.
- **Cast `DisplayMessage` — resolve the sender name** (remote control #666 follow-up): the persistent-message dialog uses a static provenance title (`LabelCastMessage` = "Message from another device"). Resolve the command's `ControllingUserId` → username for "Message from `<name>`" (e.g. "Message from Dad"). A regular user often can't `GET /Users/{otherId}`, so match against the public-users list (`GetPublicUsers`) instead, off the main thread (the `RemoteControlTask` receiver enriches the command before marshalling, or a cached id→name map). Short-circuit the self-cast case via `m.global.user`. Fall back to the static title when unresolved (hidden user / fetch fails). Needs `ControllingUserId` captured in `remoteCommand.parseGeneralCommand` + a `LabelCastMessageFrom` = "Message from {0}" key. Epic #669.
- **Cast list shows the Roku MODEL name, not the friendly name** (cold-cast producer #668 follow-up): every JellyRock session (live receiver + closed-app phantom) surfaces in the web cast list as `getModelDisplayName()` + `(GetModel())` — e.g. "Roku Ultra (4800X)" — because that's the auth header's `Device=` field (`source/api/baseRequest.bs:152`, `globalDevice.name` = `getModelDisplayName()` at `source/utils/globals.bs:406,350`). Optional UX polish for multi-Roku households: prefer the user's friendly name ("Living Room"). The correct fix is **app-wide** — change the auth `Device=` header — so the open session and the phantom keep ONE continuous name; sending `friendlyName` only in the `/pair` payload would make the phantom's cast-list name flicker vs the open app across the open/closed swap. Out of scope for #668 (the `"JellyRock"` constant fallback at `PhantomSessionService.cs:255` essentially never shows — a session always carries the model name). Epic #669.

- **Convert `main.bs`'s post-`show()` `print`s to `m.log.*`** (log-manager-init follow-up): proven viable on device (Streaming Stick 4K, OS 15.2.4) — `m.global.rLog` is live immediately after `m.screen.show()` (3/3 cold starts, `show()` blocks until `JRScene.init` completes), and the `roku-log` BSC plugin *does* transform call sites in `source/main.bs` (pkg-path injected in the transpiled output, so `bsconfig-prod`'s `strip` applies there too). Scope is **post-`show()` only** — everything up to and including `setGlobals()` must stay `print`, because the log manager cannot exist before `show()` (`log_Log`'s init creates a `Timer`, which fails on the main thread pre-show). That covers the whole event loop, where most of main's prints live. Deferred from the log-manager-init PR to keep that fix isolated; blocked on nothing.

### api

- Tier-1 API task loops (`ApiTask.runApiLoop` / `ApiQueueTask.runQueueLoop`) are persistent continuous-server loops that die permanently on an uncaught error, silently stalling the pool for the session — the same failure mode #744 fixed for `SideEffectTask` via per-request `try/catch`. Consider adding equivalent per-request isolation to the Tier-1 loops. This is pre-existing (not introduced by #744) and deferred to keep #744 scoped.

### tests

- Add approval-gated `device-rta-tests.yml` CI workflow running `npm run test:rta` on the self-hosted `roku-device` runner (mirror `device-unit-tests.yml`; register with `lint:ci-workflow-sync`).
- Expand RTA functional-test screen coverage beyond the current 6 (`userSelect`/`home`/`libraryGrid`/`movieDetails`/`osd`/`trickplay`) to more screens, and make screenshot capture the default for RTA runs (currently `RTA_CAPTURE=1` opt-in) so every covered screen yields a store image. From #642. *(Largely addressed by #621: coverage grew 6→23 website-gallery screens; the "every screen → store image" clause is superseded by `rta-screenshot-store-website-split`.)*
- Remaining RTA gallery screens after #621 (`personDetails`/`seasonDetails`/`episodeDetails`/`audioDetails` are now done via the `openChildDetailByRowType` content-based row helper). Content-blocked on the richer custom server (zero demo content): `BoxSet`, `Photo`/`PhotoAlbum`, `MusicVideo`, Live TV, OSD per-button dialogs, the non-cast extras rows (trailers/special features/similar), and the `Networks` TV view (the demo's single series has no network — captured as its empty "No Items" state for now).
- **The `ws://` `DeviceId` session binding has no end-to-end gate** (#743 follow-up): RTA drives the `https://` demo server (`tests/rta/config.js`), but the `ws://` receiver only runs against an `http://` server (`remoteProtocol.isHttpServer`), so RTA takes the long-poll branch and never exercises the socket at all. The real binding was verified manually against a local 10.11.11 server using a token deliberately minted under a mismatched `DeviceId` (PR #747); `scripts/lint/socket-auth-binding-check.js` now gates only the SOURCE SHAPE those runs validated. Closing the gap needs RTA to target a local `http://` Jellyfin, which conflicts with the demo server's license-clear screenshot role — so the open question is whether a second RTA target is worth standing up.
- **`navLibraryByType(collectionType)` is not deterministic on a server with SEVERAL libraries of one type.** It resolves the first Home tile matching the collection type, while `libraryIdFor(libraries, collectionType)` (used by the seeding side) resolves the first library from `/UserViews` — on a server with e.g. four `movies` libraries those two need not agree, so a screen seeded for library A can be navigated to library B. Observed 2026-08-04 while measuring the grid genre loop against a 14-library server: one sample in five opened a *different* movies library than the one seeded, which silently produced a valid-looking but wrong measurement (28 items, no genre load, instead of 8). Affects any `vw(...)` screen whose seeded view must match the navigated library — a capture would render the default view rather than the seeded one, and nothing would flag it. Harmless on the demo server (one library per type), which is why it hasn't bitten the gallery run. Fix shape: resolve the library id once and navigate BY ID, or assert after nav that the opened library is the seeded one.
- **`scripts/capture-screenshots.js` has the same missing-library exposure the RTA spec just fixed.** It loops the shared `tests/rta/screens.js` registry and calls `libraryIdFor(libraries, screen.view.collectionType)`, which returns null when the server has no such library — then `screen.nav(ctx)` throws and `captureScreen`'s 3-attempt retry burns three full seed+relaunch cycles per locale before giving up. Every `vw(...)` screen is `capture.eligible`, so `playlistsLibrary`/`playlistDetails` hit this today. Deliberately NOT folded into the RTA fix: the right behavior differs (a store/gallery run losing a screen should probably warn loudly rather than skip quietly), and a ~15-min matrix run against real store assets is not something the RTA change verified. Fix shape: reuse the same null-library check, skip the screen, and log a visible warning so the gallery set's shrinkage is never silent.

### docs

(none)

### claude

- Exercise `/dep-major` end-to-end on the next real Renovate major PR — validate the changelog→call-site mapping and the on-device `test:unit`+`test:rta` gate run inside the skill flow (mechanics validated at build time, but the full orchestration on a real major bump is not yet exercised).
