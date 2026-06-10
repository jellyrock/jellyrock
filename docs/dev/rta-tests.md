---
topic: rta-tests
related-files:
  - tests/rta/config.js
  - tests/rta/screens.js
  - tests/rta/lib/nav.js
  - tests/rta/specs/screens.spec.js
  - vitest.rta.config.js
  - scripts/capture-screenshots.js
last-reviewed: 2026-06-08
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

## Adding a screen

Add one entry to [`tests/rta/screens.js`](../../tests/rta/screens.js):

```js
{ name: 'myScreen', state: 'home', nav: navMyScreen, capture: { eligible: true } }
```

- `state`: `'home'` | `'userSelect'` (the seed-to-land state).
- `nav`: an async `(ctx) => {}` in [`tests/rta/lib/nav.js`](../../tests/rta/lib/nav.js)
  that drives key presses and `waitFor`s the screen's loaded signal. The waits are the
  assertion.
- `assert`: optional — for seed-to-land screens with no `nav`, or extra checks.
- `capture`: screenshot metadata (store generator + `RTA_CAPTURE` only):
  `eligible` to capture, `backdrop: true` to composite the in-film frame behind the
  OSD, `scope: 'shared'` for language-agnostic screens (captured once, copied to all
  locales).

The new screen is automatically a functional test (`it.each(SCREENS)`) and, if
`capture.eligible`, a store screenshot.

## Two capture tiers

| | `RTA_CAPTURE=1` (test runner) | `screenshots:capture` (store) |
|---|---|---|
| Output | `out/rta-captures/<screen>.png` (gitignored) | `docs/screenshots/<locale>/<screen>.png` + `screenshots.json` |
| Locales | en_US only | full matrix |
| Build | dev | **prod** (release branding) |
| OSD background | black (the video plane can't be captured — fine for GUI viewing) | real in-film frame composited via ffmpeg |
| Purpose | view the GUI while designing UI | public store / website assets |

Store screenshots default to the **prod** build (`npm run screenshots:capture` →
`build:prod`), so they match what ships. `screenshots:capture:dev` and
`screenshots:capture:fast` are the alternates. See
[`scripts/capture-screenshots.js`](../../scripts/capture-screenshots.js).

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
