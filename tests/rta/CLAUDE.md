# Rules for `tests/rta/`

On-device **RTA functional tests** (roku-test-automation). Node/ESM that drives a
real Roku from the dev machine via ECP + ODC. See
[docs/dev/rta-tests.md](../../docs/dev/rta-tests.md) for the full how-to.

**This is NOT Rooibos.** The `tests/` (Rooibos) rules do NOT apply here — this is
Node/ESM under Vitest, not BrightScript compiled into the app. Don't put `.spec.js`
files under `tests/source/**` (that tree is BrightScript-compiled); RTA tests live
here.

## Layout

- `config.js` — `RTA_CONFIG` (demo server, hero movie, seek position, locales). Shared with the store screenshot generator.
- `screens.js` — the **screen registry**, the single source of truth for both the tests and the screenshots. Add a screen here.
- `lib/` — `driver` (env + deploy + relaunch), `steps` (press/getVal/waitFor/waitFocused), `seed` (registry seeds + snapshot/restore), `jellyfin` (demo REST), `nav` (per-screen navigation).
- `specs/` — the Vitest specs (a `for` loop over `SCREENS`, not `it.each`: `it.each` passes only the case object, so a case can't skip itself at runtime, and content-dependent screens need exactly that).
- `capture.js`, `setup/` — the `RTA_CAPTURE` raw-capture helper and Vitest global/per-worker setup.
- `demos/` — hands-free **video-capture** takes (`npm run demo`). `run.mjs` owns the privacy-safe lifecycle (snapshot → record gates → restore + relaunch); each `takes/*.js` declares only its choreography. NOT tests — these drive the device for marketing/PR demos against the public demo server only (the runner refuses any non-demo host).

## Rules

- **Run `npm run test:rta` to verify no RTA/nav regressions** after touching `tests/rta/`, `scripts/capture-screenshots.js`, or app navigation/screens. Needs hardware + `.env` (`ROKU_IP`/`ROKU_PASSWORD`); if no device, say so — don't claim a pass.
- **CI runs this suite only on the release-prep branch** ([`rta-functional-tests.yml`](../../.github/workflows/rta-functional-tests.yml)) — there is one physical device and a full pass is ~10–15 min, so it is not a per-PR gate. That makes the local run above the *only* feedback a PR gets: a regression you don't catch here surfaces at release, after N merged PRs, where bisecting it is much harder. See [`docs/dev/rta-tests.md`](../../docs/dev/rta-tests.md#when-ci-runs-it).
- **Use `npm run test:rta:capture` (or `RTA_CAPTURE=1`) to view the GUI** when modifying or designing UI — it dumps `out/rta-captures/<screen>.png`. The OSD's video plane is black there (expected); the polished store images come from `screenshots:capture`.
- **`waitFor`/`waitFocused` throw on timeout — that IS the assertion.** Don't wrap them in `expect`. Use `expect` only for value checks (label text, focus subtype).
- **Check a content-dependent assertion against the demo server's ACTUAL content before writing it, and make it throw when it verified nothing.** The demo library is small and shrinks; an assertion keyed on content it never has passes vacuously forever and reads as coverage. Real case: the natural genre-row check keys on the `View All` child, which only exists above 5 items per genre — and no demo genre has more than 4, so it would never have checked anything. Query the server first (`getJson` in `lib/jellyfin.js`), then assert; a `verified` counter that throws at zero is what turns a silent no-op into a red test.
- **Add a screen** by adding ONE entry to `screens.js` (+ a `nav` in `lib/nav.js`). It becomes both a functional test and (if `capture.eligible`) a store screenshot. Keep nav free of screenshot concerns (no backdrop/ffmpeg — that's the store orchestrator's job).
- **Real-registry exception**: seeds write the real `JellyRock` registry (not `test-*`) because the app reads real keys to pick a screen. This is the accepted exception to the `tests/CLAUDE.md` `test-*` rule (which governs in-process Rooibos tests). Always pair with `snapshotSession`/`restoreSession`.
- **Build flavor**: tests run against the dev build (`npm run build`); store screenshots use prod (`build:prod`). Never `build:prod` for a path that needs source maps/logs for debugging.
