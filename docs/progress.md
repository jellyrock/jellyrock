---
last-updated: 2026-07-10
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

## Recently shipped

Newest first. Prepended by the post-merge journal-sync (and `/done`). Bullets older than 14 days are pruned automatically by that same sync; `/catchup` is only a backstop.

- 2026-07-06 — Restore navigation loading spinners lost in the `sgRouter` migration
- 2026-07-06 — Investigating issue #573 (surround audio fails to play; the server emits a bad ffmpeg audio argument). Reworked PR #574 so the playback audio logic prefers the user's chosen surround format setting instead of falling back to stereo — fixing the crash and keeping surround output intact. Verified against a live Jellyfin 10.11 server and on Roku hardware (50 of 50 audio specs); next is the PR description update and asking the reporter to retest.
- 2026-06-23 — chore(lint): make `markdownlint` respect `.gitignore`

## Open followups

Grouped by area. Append via `/log followup "<text>" --area=<name>`. Close via `/done <slug-or-keyword>`. If the area you need isn't here, add a new `###` subsection.

### scripts

- Expand automated store screenshots from the 5 marketing languages to ALL ~99 locale files, to surface the default Roku OS font's blast radius — boxes/tofu for scripts the system font doesn't cover are EXPECTED and the point of capturing them. From #642.

### components

- Consolidate the `SceneManager` `reloadHomeRequested` Home-reload signal onto `JRScene` (alongside `contentVersion`), so both view-refresh signals live on the router host instead of split across `SceneManager`. Surfaced while cleaning up a stale `JRScene.xml` comment during the #550 sgRouter PR-hardening pass.
- Normalize audio queue items to one transformed (camelCase) shape at queue-build time — `QuickPlayTask.doAlbum/doArtist/doPlaylist/doInstantMix` + the `set()` paths store RAW Jellyfin items while single-song taps store transformed ones, so `createQueueItem` reads both shapes with raw-key fallbacks (`albumName`←`Album`, `primaryImageTag`←`ImageTags.Primary`). Transforming at queue-build kills the duality so every consumer reads one predictable shape (also removes the latent `albumName`-vs-`Album` mismatch class). Deferred from the #550 audio now-playing contract fix (A+C+D shipped: `createQueueItem` carries the now-playing display fields + `QueueItem` interface + spec gate). Bigger blast radius (video queue paths) → needs a hardware verification pass.

### source

- Migrate the watched toggle (`main.bs`) to the `3c` `callFunc`→`fetchAsync` pattern (mirror `ItemDetails.toggleFavorite`). Extra surface vs favorite: Series "mark all" confirmation-dialog path (2nd entry ~`main.bs:927`), resume-button loading state, `pendingWatched*` bookkeeping. Completes removal of the `isDone` branch + `handleWatchedToggleDone` + `m.watchedResultNode`. #551 Phase 4 settings/misc render-thread batch.
- `inferServerUrl` (`source/utils/misc.bs:302`, called on the render thread from `loginRouter.bs:233` `onServerSubmitted`) runs a synchronous `roUrlTransfer` probe loop up to 15 seconds during server connect — same render-thread-blocking class as #550 `A2` (fixed for the deep-link server-switch probe via `ServerReachableTask`). Out of scope for the current navigation-hardening project (migration cleanup not surfaced by the #550 review). Fix: move the probe to a Task like `ServerReachableTask`.
- **Queue-aware multi-item casting** (remote control #666 follow-up): a Jellyfin `Play` carries the full `ItemIds` list + `StartIndex` + `StartPositionTicks` + `PlayCommand`, but #666 casts only the single `itemIds[startIndex]` via the deep-link seam (`remoteDispatch.dispatchPlay`). Consume the whole list to seed the queue, honor `StartPositionTicks`, and implement `PlayNext`/`PlayLast` semantics (`queueMode` is already parsed by `remoteCommand.playCommandToQueueMode` but ignored) — likely `QueueManager.insertNext`/`push` helpers. Fixes casting a music album (currently plays only track 1). Epic #669.
- **Cast navigation lag (render-thread wake)** (remote control #666): a cast `navigate`/`play` to an *idle*, already-resident screen (e.g. back-to-Home) can stay on the prior screen until the next input, because the command arrives as a node event on the MAIN thread → `remoteDispatch` → `callFunc` into `JRScene`, and nothing wakes the render thread to repaint (Roku has no render-wake idiom; `playbackLaunchRequest` avoids this only by being observed by `JRScene` on the *render* thread — `JRScene.bs:300-306`). Transport during playback is unaffected (video keeps the render thread awake). NEEDS a confirmed reproduction (capture the socket frame log during the exact idle navigation to prove a frame arrives but doesn't render vs. web sending nothing) before a fix; likely fix routes cast play/navigate through a render-thread observer mirroring `playbackLaunchRequest`.
- **Verify cast seek actually moves playback** (remote control #666): the `seekto` path dispatches to `VideoPlayerView.handleTransport` (confirmed in socket logs — a `Playstate` `Seek` frame reaches the handler with `cmd = "seekto"`), but the visible playback-position jump was NOT visually verified on device, and the jellyfin web scrubber was hard to drive. Confirm the video position actually moves; if not, debug `seekToWithBounds(evt.position)` (`evt.position` = `remoteCommand.ticksToSeconds(SeekPositionTicks)`). The parse/dispatch layers are unit-tested; only the on-device player effect is unverified.

### tests

- Add approval-gated `device-rta-tests.yml` CI workflow running `npm run test:rta` on the self-hosted `roku-device` runner (mirror `device-unit-tests.yml`; register with `lint:ci-workflow-sync`).
- Expand RTA functional-test screen coverage beyond the current 6 (`userSelect`/`home`/`libraryGrid`/`movieDetails`/`osd`/`trickplay`) to more screens, and make screenshot capture the default for RTA runs (currently `RTA_CAPTURE=1` opt-in) so every covered screen yields a store image. From #642. *(Largely addressed by #621: coverage grew 6→23 website-gallery screens; the "every screen → store image" clause is superseded by `rta-screenshot-store-website-split`.)*
- Remaining RTA gallery screens after #621 (`personDetails`/`seasonDetails`/`episodeDetails`/`audioDetails` are now done via the `openChildDetailByRowType` content-based row helper). Content-blocked on the richer custom server (zero demo content): `BoxSet`, `Photo`/`PhotoAlbum`, `MusicVideo`, Live TV, OSD per-button dialogs, the non-cast extras rows (trailers/special features/similar), and the `Networks` TV view (the demo's single series has no network — captured as its empty "No Items" state for now).
- RTA screens `playlistsLibrary` + `playlistDetails` are content-FLAKY: the demo server (`demo.jellyfin.org/stable`) resets hourly and its playlists may be absent/changed, so `findHomeLibraryTile('playlists')` can time out (only `movies`/`tvshows`/`music` guaranteed). Guard/skip these two when no playlists library is present (or seed a playlist), like the other demo-content-dependent screens. Surfaced by the #550 sgRouter PR-hardening RTA run.

### docs

(none)

### claude

- Exercise `/dep-major` end-to-end on the next real Renovate major PR — validate the changelog→call-site mapping and the on-device `test:unit`+`test:rta` gate run inside the skill flow (mechanics validated at build time, but the full orchestration on a real major bump is not yet exercised).
