---
topic: rta-tests
related-files:
  - tests/rta/config.js
  - tests/rta/screens.js
  - tests/rta/lib/nav.js
  - tests/rta/specs/screens.spec.js
  - vitest.rta.config.js
  - scripts/capture-screenshots.js
last-reviewed: 2026-06-21
---

# RTA functional tests (`tests/rta/`)

On-device functional tests driven by **`roku-test-automation` (RTA)**: a Node process
drives a real Roku from the dev machine via ECP (key presses) + ODC (Scene Graph
queries), navigates to each screen, and asserts it loaded. The same library powers
the store-screenshot generator, so a screen is defined once and reused for both.

This is a different paradigm from the Rooibos unit/integration tests
([unit-tests.md](unit-tests.md)): Rooibos is BrightScript compiled **into** the app
and asserts in-process; RTA is **Node-side** and drives the app from **outside**. So
RTA tests live in `tests/rta/` (Node/ESM, like `tests/scripts/`), NOT under
`tests/source/**` (which is compiled into the app), and run under **Vitest**, not
`scripts/run-roku-tests.js`.

## Commands

| Command | What |
|---|---|
| `npm run test:rta` | Build (dev) + deploy the RTA build + run all screen tests. The regression command. |
| `npm run test:rta:tdd` | Watch mode — deploys once, re-runs specs on save. |
| `npm run test:rta:fast` | `RTA_NO_DEPLOY=1` — skip the redeploy, run against the build already on the device (fastest inner loop). |
| `npm run test:rta:capture` | Run the tests AND dump a raw UI screenshot per screen to `out/rta-captures/` (for viewing the GUI). |

Credentials: `ROKU_IP` / `ROKU_PASSWORD` from a gitignored `.env` (same as the
Rooibos device tests). If no device is reachable, **say so** — don't claim a pass.

## How it works

- **Deploy**: the RTA `device.deploy({ injectTestingFiles: true })` stages the build,
  flips the manifest `bs_const ENABLE_RTA=false`→`true`, and injects the on-device
  component. The `#if ENABLE_RTA` block in `source/main.bs` then creates
  `RTA_OnDeviceComponent` at boot. This passthrough works for **both** dev and prod
  builds. Deploy runs once per test run (Vitest `globalSetup`); `RTA_NO_DEPLOY=1`
  skips it.
- **Per worker**: `tests/rta/setup/env-setup.js` (Vitest `setupFiles`) configures the
  RTA client singletons from `.env` in the test worker.
- **Serial**: one real device, so `vitest.rta.config.js` pins single-fork, no
  parallelism, long timeouts (OSD playback waits can take ~90 seconds).
- **Assertions**: the `waitFor` / `waitFocused` steps poll real node state and THROW
  on timeout — that throw IS the test failure (a descriptive message). Don't wrap them
  in `expect`; use `expect` only for value checks (title text, focus subtype).
- **Scoping `#id` reads under sgRouter `keepAlive`**: `getVal` resolves `#id` by a
  recursive `findNode` **from the scene root**, but `id` is not unique across components
  (every `ItemDetails` has `#extrasGrid`; several declare `#options`). sgRouter
  `keepAlive` routes (`/library`, `/details`) leave the SUSPENDED parent view in the
  scene tree, so a recursive read can resolve to the wrong (suspended) view's node — e.g.
  a detail→detail drill reading the parent's `#extrasGrid` instead of the active child's.
  For value reads of such recurring ids, use `getActiveVal` (or `waitFor(..., { read:
  getActiveVal })`), which scopes to `m.global.activeRoutedView` (the app's own "view the
  user is on"). Focus-based assertions (`waitFocused`) are inherently unambiguous — there
  is only one focused node — so prefer them when "did this open/land?" is the question.

## Adding a screen

Add one entry to [`tests/rta/screens.js`](../../tests/rta/screens.js):

```js
{ name: 'myScreen', state: 'home', nav: navMyScreen, capture: { eligible: true } }
```

- `state`: `'home'` | `'userSelect'` | `'serverSelect'` (the seed-to-land state, via the
  matching `seed*` in [`tests/rta/lib/seed.js`](../../tests/rta/lib/seed.js); add a branch in
  BOTH `specs/screens.spec.js` and `scripts/capture-screenshots.js` for a new state).
- `nav`: an async `(ctx) => {}` in [`tests/rta/lib/nav.js`](../../tests/rta/lib/nav.js)
  that drives key presses and `waitFor`s the screen's loaded signal. The waits are the
  assertion.
- `assert`: optional — for seed-to-land screens with no `nav`, or extra checks.
- `view`: optional `{ collectionType, landing }` for a library-dependent screen. Library
  views are **sticky** in the registry (`display.<libraryId>.landing`, set by the grid options
  dialog), so a screen that depends on a specific view must seed it deterministically rather
  than inherit whatever is persisted. The `vw(name, nav, collectionType, landing)` helper in
  `screens.js` builds these entries; `seedLibraryLanding` (called by the spec + orchestrator)
  resolves the library id at RUNTIME from the stable `collectionType` (never a hardcoded id,
  which would die if the library is recreated) and seeds the landing view. `seedHome` clears all sticky `display.*` keys first, so views
  can't leak between screens.
- `capture`: screenshot metadata (store generator + `RTA_CAPTURE` only):
  `eligible` to capture, `store: true` to ALSO include in the curated Roku-store / homepage
  set (see split below), `backdrop: true` to composite the in-film frame behind the OSD,
  `scope: 'shared'` for language-agnostic screens (captured once, copied to all locales).

The new screen is automatically a functional test (`it.each(SCREENS)`) and, if
`capture.eligible`, a captured screenshot.

## Store set vs website gallery (the `store` flag)

The Roku store caps a listing at **6 screenshots**, but the captured set is larger — the
extra screens feed the website's screenshot *gallery* (a UX preview) and may graduate to the
store later. So `capture` has two levers:

- `eligible` — captured at all: written to `docs/screenshots/<locale>/` (website gallery) and
  dumped by `RTA_CAPTURE`.
- `store` — ALSO part of the frozen Roku-store / homepage 6. Only these are bundled by
  `npm run screenshots:store`, and the website homepage renders them (in registry order)
  while the gallery page renders every `eligible` screen.

The manifest (`docs/screenshots/screenshots.json`) emits both lists: `screens` (full gallery)
and `storeScreens` (the curated 6). Keep `store: true` on exactly the 6 that ship — adding a
7th store screen is a Developer-Portal decision, not a code default.

## Image format & footprint

Committed images are **lossless WebP**. The device only outputs a fixed-quality **JPEG** (that's
the quality ceiling regardless), so lossless adds nothing over the source while keeping every
screen pixel-perfect — and it's still ~3× smaller than PNG, which after pruning got the committed
set from ~160 MB to ~36 MB. (Lossless everywhere is deliberately simpler than mixing lossy +
lossless — there's no per-screen "is this one lossy?" to reason about.)

To keep the repo lean, only the **`galleryLocale`** (en_US) folder holds the full screen set;
every other store locale holds **only the store screens** — a full per-language gallery isn't
worth the weight. The manifest records `format` + `galleryLocale` so the website can resolve
`<locale>/<screen>.<format>` and know which locale carries the full gallery. The Roku Developer
Portal wants PNG, so `npm run screenshots:store` **decodes** each store WebP back to PNG into
`out/store/<lang>/` (no extra loss) — WebP never reaches the store listing.

## Two capture tiers

| | `RTA_CAPTURE=1` (test runner) | `screenshots:capture` (store) |
|---|---|---|
| Output | `out/rta-captures/<screen>.png` (gitignored) | `docs/screenshots/<locale>/<screen>.webp` + `screenshots.json` |
| Locales | en_US only | full matrix |
| Build | dev | **prod** (release branding) |
| OSD background | black (the video plane can't be captured — fine for GUI viewing) | real in-film frame composited via ffmpeg |
| Purpose | view the GUI while designing UI | public store / website assets |

Store screenshots default to the **prod** build (`npm run screenshots:capture` →
`build:prod`), so they match what ships. `screenshots:capture:dev` and
`screenshots:capture:fast` are the alternates. See
[`scripts/capture-screenshots.js`](../../scripts/capture-screenshots.js).

## Incremental capture — only the new screens

When you add screens, you do NOT need to regenerate the existing set — both axes subset:

```bash
# Functional test, only the new screens (skip redeploy after the first full run):
RTA_NO_DEPLOY=1 vitest run --config vitest.rta.config.js -t 'serverSelect|settings'

# Capture ONLY the new screens, full locale matrix (leaves the other images untouched).
# DEPLOY=1 on the first run to push the build; drop it on re-captures.
DEPLOY=1 node scripts/capture-screenshots.js --screens=serverSelect,settings
```

`capture` writes one WebP per (screen × locale), so `--screens=` only overwrites those files —
the existing store screens are never touched. `screenshots.json` + the README index are
regenerated each run but are derived from the config, so they always reflect the full
intended set regardless of the subset captured. `--languages=` narrows the locale set the
same way.

## Store languages

`screenshots:capture` writes every locale in `RTA_CONFIG.languages` (the full capture
matrix — planned to grow to all locale files, to map the default-font blast radius). Only
a curated subset actually **ships** in the Roku store listing: `RTA_CONFIG.storeLanguages`
— the ONE hand-maintained "what's in the store" list (a subset of `languages`). To gather
just those for upload:

```bash
npm run screenshots:store
```

It copies `docs/screenshots/<lang>/` for each `storeLanguages` entry into
`out/store/<lang>/` (gitignored), ready to upload to the Roku Developer Portal — no hunting
through the full locale set. Adding a store language = add it to `storeLanguages` and
re-run. `storeLocales` is also emitted into `screenshots.json` so the website can tell the
store set from the full capture set.

## Notes

- Seeds write the **real** `JellyRock` registry (not a `test-*` section) because the
  app reads real keys to choose a screen — inherent to driving the real app. The
  `snapshotSession`/`restoreSession` pair (in [`tests/rta/lib/seed.js`](../../tests/rta/lib/seed.js))
  restores the device's prior session afterward. This is the accepted exception to the
  `test-*` isolation rule, which governs in-process Rooibos tests.
- Demo server: the public `demo.jellyfin.org/stable` (license-clear content). It
  resets hourly; navigation anchors on the `SortName` tile index, not the volatile Continue
  Watching row.
