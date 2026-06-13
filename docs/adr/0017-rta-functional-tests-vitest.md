# ADR 0017: RTA functional tests in Node/Vitest, not Rooibos

**Status:** Accepted
**Date:** 2026-06-08

**related-files**: tests/rta/screens.js, tests/rta/lib/nav.js, tests/rta/specs/screens.spec.js, vitest.rta.config.js, scripts/capture-screenshots.js, docs/dev/rta-tests.md

RTA functional tests live in a Node/Vitest layer (`tests/rta/`) that drives a real device from outside via `roku-test-automation` (ECP key presses + ODC Scene Graph queries), **not** Rooibos. Rooibos is BrightScript compiled into the app and asserts in-process — right for unit/integration, but end-to-end screen navigation + screenshots must drive the real app externally, which is the RTA model. So `tests/rta/` is Node/ESM (outside `tests/source/**`, which is compiled into the app) under a dedicated `vitest.rta.config.js` (serial single-fork, long timeouts, a `globalSetup` that deploys the `ENABLE_RTA` build once). Chose **Vitest** (already powers `tests/scripts/`; free reporting/watch/filtering/CI) over a custom Node runner (reinvents all of that) and over the RTA `Suitest` wrapper (extra abstraction, weaker Vitest/CI integration).

A single screen registry (`tests/rta/screens.js`) is the source of truth for both the functional tests and the store-screenshot generator: each screen declares how to reach it and how to assert it loaded; the navigation steps' `waitFor` gates double as the assertions. Screenshots are a thin layer on top — `RTA_CAPTURE=1` dumps raw UI for GUI viewing, and `scripts/capture-screenshots.js` adds the locale matrix + the ffmpeg OSD backdrop + the manifest. Store screenshots use the **prod** build (release branding); the RTA deploy-time `ENABLE_RTA` manifest flip is build-flavor-agnostic (verified prod keeps the `#if` passthrough), so prod works with RTA. Closed off: Rooibos for end-to-end, a custom runner, `Suitest`, and the empty `tests/source/e2e/` placeholder (removed; its `e2e-folder-empty` tech-debt resolved).
