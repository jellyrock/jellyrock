---
last-updated: 2026-06-23
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

Investigating issue #573 (surround audio fails to play; the server emits a bad ffmpeg audio argument). Reworked PR #574 so the playback audio logic prefers the user's chosen surround format setting instead of falling back to stereo — fixing the crash and keeping surround output intact. Verified against a live Jellyfin 10.11 server and on Roku hardware (50 of 50 audio specs); next is the PR description update and asking the reporter to retest.

## Recently shipped

Newest first. Prepended by the post-merge journal-sync (and `/done`). Bullets older than 14 days are pruned automatically by that same sync; `/catchup` is only a backstop.

- 2026-06-23 — chore(lint): make `markdownlint` respect `.gitignore`
- 2026-06-11 — perf(screenshots): lossless WebP + prune non-store languages
- 2026-06-11 — Add library + item-type gallery screenshots + store/website split
- 2026-06-10 — Per-language store screenshots + RTA functional-test layer

## Open followups

Grouped by area. Append via `/log followup "<text>" --area=<name>`. Close via `/done <slug-or-keyword>`. If the area you need isn't here, add a new `###` subsection.

### scripts

- Expand automated store screenshots from the 5 marketing languages to ALL ~99 locale files, to surface the default Roku OS font's blast radius — boxes/tofu for scripts the system font doesn't cover are EXPECTED and the point of capturing them. From #642.

### components

(none)

### source

- Migrate the watched toggle (`main.bs`) to the `3c` `callFunc`→`fetchAsync` pattern (mirror `ItemDetails.toggleFavorite`). Extra surface vs favorite: Series "mark all" confirmation-dialog path (2nd entry ~`main.bs:927`), resume-button loading state, `pendingWatched*` bookkeeping. Completes removal of the `isDone` branch + `handleWatchedToggleDone` + `m.watchedResultNode`. #551 Phase 4 settings/misc render-thread batch.

### tests

- Add approval-gated `device-rta-tests.yml` CI workflow running `npm run test:rta` on the self-hosted `roku-device` runner (mirror `device-unit-tests.yml`; register with `lint:ci-workflow-sync`).
- Expand RTA functional-test screen coverage beyond the current 6 (`userSelect`/`home`/`libraryGrid`/`movieDetails`/`osd`/`trickplay`) to more screens, and make screenshot capture the default for RTA runs (currently `RTA_CAPTURE=1` opt-in) so every covered screen yields a store image. From #642. *(Largely addressed by #621: coverage grew 6→23 website-gallery screens; the "every screen → store image" clause is superseded by `rta-screenshot-store-website-split`.)*
- Remaining RTA gallery screens after #621 (`personDetails`/`seasonDetails`/`episodeDetails`/`audioDetails` are now done via the `openChildDetailByRowType` content-based row helper). Content-blocked on the richer custom server (zero demo content): `BoxSet`, `Photo`/`PhotoAlbum`, `MusicVideo`, Live TV, OSD per-button dialogs, the non-cast extras rows (trailers/special features/similar), and the `Networks` TV view (the demo's single series has no network — captured as its empty "No Items" state for now).

### docs

(none)

### claude

(none)
