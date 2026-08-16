# Rules for `tests/rta/`

On-device **RTA functional tests** (roku-test-automation). Node/ESM that drives a
real Roku from the dev machine via ECP + ODC. See
[docs/dev/rta-tests.md](../../docs/dev/rta-tests.md) for the full how-to.

**This is NOT Rooibos.** The `tests/` (Rooibos) rules do NOT apply here — this is
Node/ESM under Vitest, not BrightScript compiled into the app. Don't put `.spec.js`
files under `tests/source/**` (that tree is BrightScript-compiled); RTA tests live
here.

## ⭐ The north star: establish the state that makes an action or a read meaningful, BEFORE doing it

If you remember one thing when writing or editing an RTA test, remember this. It is the
single largest source of flakes in this suite: **five separate instances were found in one
day**, every one of them a test that acted before the app could answer, and every one of
them initially misread as an app bug.

It has two shapes, and the second is the one people miss:

- **Driving input too early.** The app legitimately swallows keys in load states — the
  player ignores Up until `stateAllowsOSD()` passes. A loop that starts pressing right
  after a Play press spends the whole window pressing at a component designed not to
  answer. These windows are longer than they look: playback start measured **~5-7 s on
  every device tested**, and it tracks stream start, not device speed.
- **Reading too early.** A screen can RENDER before its data arrives, so a gate proving
  "something is there" can be satisfied by placeholders, and a field can be stale rather
  than wrong. `waitHome()` passes on skeleton rows whose tiles carry no `.id` (measured
  window: **~1.35 s**), and `rowItemFocused` / `itemFocused` **retain their last value
  when the list is not focused** — so "grid loaded" is not "grid focused", and a walk
  started too early reads `[0,0]` forever while pressing at whatever does hold focus.

**The tell:** a timeout that blames a component — "tile not found", "screen never
loaded" — when the real cause is that we acted before it could respond. If a failure says
something is missing, ask whether it was ever asked at a moment it could have answered.

**How to satisfy it:**

- Gate on the state that makes the step meaningful (`state = playing`, focus inside
  `#itemGrid`), settle, then act. Not on a proxy for it.
- Poll the scan inside a bounded wait rather than scanning once, and put the retry in the
  **shared helper** so every caller inherits it instead of one call site.
- Distinguish **"not there YET"** (retry) from **"genuinely wrong"** (throw now) — an
  ambiguous multi-library match cannot be fixed by waiting, so it still fails fast.
- Never paper over it with a longer timeout or a fixed `sleep`. The wait was not timing
  out; it was succeeding too early.

There is a third shape, and it is the one that reads least like a harness bug: **acting
from a position the app gates on.** `Home.onKeyEvent` releases focus to the overhang only
when the active row list reports `rowItemFocused[0] = 0`; at any other index Up returns
false, the key bubbles away, and the walk that follows spends its whole timeout pressing at
a list that is not listening. Nothing about the state is "not ready" — Home is fully loaded
and answering — so every gate that means "loaded" passes. Two investigations of a
`focusOverhangIcon` timeout dead-ended here, because a healthy Home and a stuck one produce
an IDENTICAL focused keyPath (`#homeRows`) and only the row index tells them apart; that
field is now kept in the failure dump for exactly that reason.

Canonical examples in [`lib/nav.js`](lib/nav.js): `waitOsdUp` (input), `findHomeLibraryTile`
(scan), and the focus gates in `navLibraryByType` / `navMovieDetails` /
`openChildDetailByRowType` (stale reads). For the third shape, `walkHomeToFirstRow` in
[`lib/steps.js`](lib/steps.js) — shared rather than inlined at its one call site precisely
because the next Home-relative press will need it too, and it is unit-tested there against a
mocked device.

## Layout

- `config.js` — `RTA_CONFIG` (demo server, hero movie, seek position, locales). Shared with the store screenshot generator.
- `screens.js` — the **screen registry**, the single source of truth for both the tests and the screenshots. Add a screen here.
- `lib/` — `driver` (env + deploy + relaunch), `steps` (press/getVal/waitFor/waitFocused, plus the shared media-player waits used by both the deep-link spec and the demo runner, and the shared Home preconditions `waitHome` / `walkHomeToFirstRow`), `seed` (registry seeds), `registry` (whole-registry snapshot/verified restore), `jellyfin` (demo REST), `nav` (per-screen navigation), `diagnostics` (failure-time device-state dump + the `FAILURE_KINDS` registry). The run record it writes into — directories, lifecycle, ledger, summary — lives in [`scripts/run-record.js`](../../scripts/run-record.js), which is shared with the Rooibos runner and knows nothing about devices.
- `specs/` — the Vitest specs (a `for` loop over `SCREENS`, not `it.each`: `it.each` passes only the case object, so a case can't skip itself at runtime, and content-dependent screens need exactly that).
- `capture.js`, `setup/` — the `RTA_CAPTURE` raw-capture helper and Vitest global/per-worker setup.
- `demos/` — hands-free **video-capture** takes (`npm run demo`). `run.mjs` owns the privacy-safe lifecycle (snapshot → record gates → restore + relaunch); each `takes/*.js` declares only its choreography. NOT tests — these drive the device for marketing/PR demos against the public demo server only (the runner refuses any non-demo host).

## Rules

- **Run `npm run test:rta` to verify no RTA/nav regressions** after touching `tests/rta/`, `scripts/capture-screenshots.js`, or app navigation/screens. Needs hardware + `.env` (`ROKU_IP`/`ROKU_PASSWORD`); if no device, say so — don't claim a pass.
- **CI runs this suite only on the release-prep branch** ([`rta-functional-tests.yml`](../../.github/workflows/rta-functional-tests.yml)) — there is one physical device and a full pass is ~10–15 min, so it is not a per-PR gate. That makes the local run above the *only* feedback a PR gets: a regression you don't catch here surfaces at release, after N merged PRs, where bisecting it is much harder. See [`docs/dev/rta-tests.md`](../../docs/dev/rta-tests.md#when-ci-runs-it).
- **Use `npm run test:rta:capture` (or `RTA_CAPTURE=1`) to view the GUI** when modifying or designing UI — it dumps `out/rta-captures/<screen>.png`. The OSD's video plane is black there (expected); the polished store images come from `screenshots:capture`.
- **`waitFor`/`waitFocused` throw on timeout — that IS the assertion.** Don't wrap them in `expect`. Use `expect` only for value checks (label text, focus subtype).
- **Preconditions before actions and reads** — see [the north star](#-the-north-star-establish-the-state-that-makes-an-action-or-a-read-meaningful-before-doing-it) at the top of this file. It is the rule most worth internalizing before you touch a nav.
- **A timeout must report what it SAW, so throw via `diagnosedError`, never a bare `new Error`.** `lib/diagnostics.js` attaches the state the device was actually in (active view + `loadState`, the app shell's `isLoading` / `isRemoteDisabled`, focused node, row counts, seeded server/user identity) and appends a record to the run's `failures.jsonl` that the run's `close()` folds into `run-meta.json` (see [`scripts/run-record.js`](../../scripts/run-record.js)). The capture runs only at the throw site, after a poll loop has given up — never inside a tick — so it costs nothing on the success path (measured on `.177`: median 21 ms, n=20). This applies to **timeouts**; a fail-fast that already names its cause (the ambiguous-library refusal in `nav.js`) can stay a plain throw.
  - **This is enforced, not just written down.** An ESLint `no-restricted-syntax` rule scoped to `lib/nav.js`, `lib/steps.js` and **all of `demos/`** fails `lint:js` on a bare `throw new Error` there. A legitimate fail-fast disables it on that line **with a reason**. A new lib file that grows a wait should be added to that glob in [`eslint.config.js`](../../eslint.config.js); `specs/` stays out, because most spec-level throws are assertions rather than timeouts.
  - **In a take, reach for `ctx.waitFor` rather than a hand-rolled poll** — it already throws through `diagnosedError`, so you inherit the dump instead of re-deriving it. A take that polls its own loop is the shape that produced both of the unconverted waits this rule was written for.
  - **`kind` comes from the frozen `FAILURE_KINDS` set, never an inline string** — it is the key a flake baseline aggregates by, and an invented slug forks a bucket. An unregistered one is recorded and called out in the run summary rather than silently counted.
  - **Prefer passing state the loop *already read* as `observed`** over re-reading it; that is what turns `2 row(s) present` into `rowTypes=[Chapter, Person]`, i.e. the difference between *late* and *absent*.
  - **`loadState=—` on a detail screen is correct** — that field is `BaseGridView`'s, and `ItemDetails` extends `JRScreen`. Read `detail=<n>` and the shell fields there instead; `input=BLOCKED` means `JRScene.onKeyEvent` was swallowing every key we sent, which is the north-star failure mode made visible.
  - **Never dump a whole node into a record** — `JellyfinUser` carries `authToken`; read identity by named field.
  - Full shape in [`docs/dev/rta-tests.md`](../../docs/dev/rta-tests.md#when-a-wait-times-out-it-reports-what-it-saw).
- **Guard every repeated `action`, and never let one fail silently.** Press only while the target state is *not* yet reached (the focus-walk navs and `waitOsdUp` both read first) — a blind re-press can perturb a UI that already responded. `waitFor`/`waitFocused` count actions that throw and name them in the timeout message; keep that, because "the key never landed" and "the screen never rendered" are otherwise indistinguishable and cost hours to tell apart after the fact.
- **A one-shot assertion reads the screen in ONE batch, not field by field.** Use `getActiveVals([...])` from [`lib/steps.js`](lib/steps.js) — ODC's `getValues` loops the requests inside a single on-device message, so N keyPaths cost one round trip. **This is a correctness rule, and the measurement says so explicitly: it is NOT a speed win.** On `.177`, 57 sequential reads take a median 303 ms against 58 ms batched (~5.4 ms per round trip), which is ~245 ms inside a ~20 s test — before/after suite runs showed no wall-clock change at all. What shrinks is the OBSERVATION WINDOW: 57 sequential reads observe a still-settling screen across 303 ms, so the field read 50th need not describe the same frame as the field read 1st, and batching collapses that to 58 ms. Same class of fix as the north-star rule, applied to reads instead of input. `assertGenreRowsOwnTheirItems` went from 57 reads to 3, and the failure record got richer for free — the whole view is already in memory to pass as `observed`. Poll loops keep the single-read `getActiveVal`: they retry by design, and `waitFor` already owns their timeout.
- **Never swallow a failed server request into an empty result — absence is only ever reported from a request that SUCCEEDED.** `lib/jellyfin.js` throws a typed `JellyfinRequestError` on any non-2xx or transport error; do not wrap a call to it in `.catch(() => null)` / `.catch(() => [])` to "tolerate" a flaky fixture. A sentinel is indistinguishable from a real empty result, and every caller here reads an empty result as a fact about the demo server — so the failure does not surface as an error, it surfaces as a *confident false statement*. Two ways that lands, both observed on 2026-08-12: a swallowed 401 in `getLibraries` (called once per spec file, in `beforeAll`) made `libraryIdFor` return `null`, which drove `screens.spec.js`'s legitimate fixture-shortfall skip and reported the run **green** with `server has no "movies" library`; and a session evicted partway through `genreItemNames`' sequential loop produced a coherent, entirely fictional picture of a demo server whose content had thinned to two genres, which was written up as a finding and reasoned from before anyone re-measured. Returning `{ index: 0, id: '' }` or `[]` is still correct **after the server answers** — that is a fixture fact a caller may act on. A run whose failures include a `server-request-failed` record folds as `outcome: blocked` (a NON-sample), so a broken fixture leaves the flake population instead of being counted as app flake.
- **Authenticate with your own role — never share a `DeviceId`.** `authenticate(server, { role, deviceKey })` mints `jellyrock-<role>-<deviceKey>`. Jellyfin keys a session to its `DeviceId` and a second auth under the same one **evicts the first token**, so two tools (or one tool on two devices) sharing an id silently log each other out mid-run. A new entry point passes its own `role`; see [`decisions.md`](../../docs/decisions.md) → `session-identity-per-role-and-device`.
- **Check a content-dependent assertion against the demo server's ACTUAL content before writing it, and make it throw when it verified nothing.** The demo library is small and shrinks; an assertion keyed on content it never has passes vacuously forever and reads as coverage. Real case: the natural genre-row check keys on the `View All` child, which only exists above 5 items per genre — and no demo genre has more than 4, so it would never have checked anything. Query the server first (`getJson` in `lib/jellyfin.js`), then assert; a `verified` counter that throws at zero is what turns a silent no-op into a red test.
- **Library navs must target a library BY ID** — pass `libraryIdFor(ctx.libraries, ct)` into `navLibraryByType`, and thread `ctx` through every chained nav. Matching on `collectionType` alone picks the first Home *tile* of that type, while the seeding side picks the first `/UserViews` entry; on a server with several libraries of one type those disagree and a screen seeded for library A gets navigated to library B, silently. The demo server has one library per type, so **the suite cannot catch this** — it only shows up against a real multi-library server.
- **Add a screen** by adding ONE entry to `screens.js` (+ a `nav` in `lib/nav.js`). It becomes both a functional test and (if `capture.eligible`) a store screenshot. Keep nav free of screenshot concerns (no backdrop/ffmpeg — that's the store orchestrator's job).
- **After ANY registry write, relaunch with `hardRelaunch()`, not `relaunch()`.** A plain `relaunch()` only foregrounds a running channel, so the app re-persists its in-memory session over the seed and the suite silently drives the wrong server — it presents as ~30 unrelated timeouts, not as a seed error. `assertSeedTookEffect()` guards each seed; keep calling it. Same rule in `scripts/capture-screenshots.js`, where the failure silently captures the wrong library into the store set.
- **Real-registry exception**: seeds write the real `JellyRock` registry (not `test-*`) because the app reads real keys to pick a screen. This is the accepted exception to the `tests/CLAUDE.md` `test-*` rule (which governs in-process Rooibos tests).
- **Never put the device-registry lifecycle in a spec.** Specs seed; they do NOT snapshot or restore. [`scripts/rta-run.js`](../../scripts/rta-run.js) owns it for the whole run — it snapshots the WHOLE registry before any seeding, runs Vitest as a child, and restores + verifies afterwards, including on Ctrl-C. A per-spec `afterAll` cannot do this: it never runs on a killed process, and Vitest exits on a 1 ms timer from its own SIGINT handler, so nothing armed inside Vitest can finish a ~30 s restore. Measured 2026-08-10 — a SIGINT 15 s into a run left `.178` signed into the demo server. If you add a new RTA entry point, snapshot via `lib/registry.js` from the MAIN process, never from a spec.
- **Build flavor**: tests run against the dev build (`npm run build`); store screenshots use prod (`build:prod`). Never `build:prod` for a path that needs source maps/logs for debugging.
