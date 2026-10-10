---
topic: rta-tests
related-files:
  - tests/rta/config.js
  - tests/rta/screens.js
  - tests/rta/lib/nav.js
  - tests/rta/lib/steps.js
  - tests/rta/lib/diagnostics.js
  - scripts/run-record.js
  - scripts/run-roku-tests.js
  - tests/rta/specs/screens.spec.js
  - vitest.rta.config.js
  - scripts/capture-screenshots.js
  - tests/rta/lib/seed.js
  - tests/rta/lib/registry.js
  - tests/rta/lib/driver.js
  - tests/rta/setup/global-setup.js
  - scripts/rta-run.js
  - scripts/rta-restore.js
  - scripts/device-lock.js
  - scripts/measure.js
  - scripts/measure-devices.js
  - scripts/measure-matrix.js
  - scripts/measure-signin.js
  - scripts/flake-baseline.js
  - tests/rta/demos/run.mjs
  - .github/workflows/rta-functional-tests.yml
last-reviewed: 2026-10-09
---

# RTA functional tests (`tests/rta/`)

How to run, read and extend the on-device functional tests. A Node process drives a real Roku from outside through `roku-test-automation` (RTA): ECP for key presses, ODC for Scene Graph queries. It opens each screen and asserts it loaded. The store screenshots come from the same screen definitions, so a screen is defined once for both.

These are not the Rooibos tests ([`unit-tests.md`](unit-tests.md)), which are compiled into the app and assert from inside it. RTA tests are Node code in `tests/rta/`, never under `tests/source/`, and run under Vitest, not `scripts/run-roku-tests.js`. The rules for writing them are in [`tests/rta/CLAUDE.md`](../../tests/rta/CLAUDE.md).

## Commands

| Command | What it does |
| --- | --- |
| `npm run test:rta` | Builds (dev), deploys the RTA build and runs every screen test. The regression command |
| `npm run test:rta:tdd` | Watch mode: deploys once and re-runs specs on save |
| `npm run test:rta:fast` | `RTA_NO_DEPLOY=1`: runs against the build already on the device |
| `npm run test:rta:capture` | Also saves a raw screenshot per screen to `out/rta-captures/` |
| `RTA_BENCH=1 npm run test:rta` | Also runs the measurement specs (`task-ledger-bench`, `task-ledger-screen-cost`), which report numbers and gate nothing |
| `RTA_SERVER_URL=… RTA_SERVER_USER=… RTA_SERVER_PASS=… npm run test:rta` | Runs against another server. The demo server is a control, not a substitute: it has a few libraries where a real server has about ten, so anything that scales with library count reads low on it |
| `RTA_HERO_MOVIE=… RTA_SEEK_SECONDS=… npm run test:rta` | Changes the content the suite expects. Also `RTA_TRICKPLAY_MOVIE`, `RTA_TRICKPLAY_SEEK_SECONDS`, `RTA_SEARCH_QUERY`, documented in `.env.example` and resolved by `resolveContent()` in [`tests/rta/config.js`](../../tests/rta/config.js). The defaults name films on the public demo server, so set them when you point the suite elsewhere |

Credentials are `ROKU_IP` and `ROKU_PASSWORD` from the checkout's `.env` or `~/.config/jellyrock/env`, as for the Rooibos device tests. Run `npm run device:check` first; if no device answers, say the probe failed and don't claim a pass.

## When CI runs it

[`rta-functional-tests.yml`](../../.github/workflows/rta-functional-tests.yml) runs the suite on a push to a release branch (`release-*.*.*`) and on `workflow_dispatch`. It is not a gate on each PR: there is one CI device, shared with the Rooibos device suite, and the suite runs one test at a time. A full pass took 35 to 44 minutes locally in early October 2026 (the RTA ledger). The job's time limit has not caught up with that: the pinned followup `release-rta-never-passes-in-ci` in [`progress.md`](../progress.md) tracks it.

Three guards keep it from running on a push that can't change what it tests:

| Guard | Why |
| --- | --- |
| [`changed-paths`](../../.github/actions/changed-paths/action.yml) | A push touching only screenshots, docs or `CHANGELOG.md` skips the device. Branch creation and a dispatch always run, so it can never skip wrongly |
| `github.actor != 'jellyrock[bot]'` | The release workflow pushes its version bump to the same branch as the bot, and that commit changes nothing the suite sees |
| `concurrency` with `cancel-in-progress: false` | Concurrency is decided before any job runs, so with `true` a docs push would cancel a run started by an earlier code push and then skip itself, leaving that code untested. A skipped run costs seconds |

The cost: a regression shows up only on the release branch, after several merged PRs, which makes it harder to bisect. When a PR touches navigation, screens or `tests/rta/`, run `npm run test:rta` yourself.

## How it works

- **Deploy.** `device.deploy({ injectTestingFiles: true })` stages the build, sets `bs_const ENABLE_RTA=true` and adds the on-device component, which `source/main.bs` creates at boot under `#if ENABLE_RTA`. It works for dev and prod builds. [`scripts/rta-run.js`](../../scripts/rta-run.js) deploys once per run, before Vitest starts. The manifest rewrite happens on every deploy, outside `injectTestingFiles`, so `injectTestingFiles: false` gives an `ENABLE_RTA=true` build with no component. A build without RTA needs a `beforeZipCallback`, which is what `deployBuild`'s `enableRta` parameter in [`driver.js`](../../tests/rta/lib/driver.js) is for.
- **Per worker,** `tests/rta/setup/env-setup.js` (Vitest `setupFiles`) configures the RTA clients from `.env`.
- **Querying nodes by property needs a reference store.** `odc.getNodesWithProperties` and `getNodesInfo` read the snapshot `odc.storeNodeReferences()` builds; without it they fail with `Invalid value supplied for 'nodeRefKey' param`. Call `storeNodeReferences()` before and `deleteNodeReferences()` after, and remember nodes created later are not in the snapshot. In a one-off script, asserting on the server response that fed the screen is often simpler.
- **After seeding, `hardRelaunch()`, never `relaunch()`.** A seed writes the device registry, and `relaunch()` (ECP `/launch/dev`) only brings a running channel to the front, which keeps its session and writes it back over the seed. The suite then drives the old server with the seeded server's item IDs, which shows as many unrelated timeouts. `hardRelaunch()` exits to the Roku home screen first, forcing a cold start, and `assertSeedTookEffect()` fails loudly if the seed was lost. This holds for every registry write, `scripts/capture-screenshots.js` included, where a lost seed photographs the wrong library into the store set.
- **One test at a time.** There is one device, so `vitest.rta.config.js` runs a single fork with long timeouts. `testTimeout` sits above the longest chain of waits, not only the longest single wait: a wait that gives up throws through `diagnosedError` and reports the device's state, while a Vitest timeout reports nothing. `screen "settings"` has the longest chain; redo the sum in the comment in the config file whenever one of its timeouts changes.
- **The waits are the assertions.** `waitFor` and `waitFocused` poll real node state and throw on timeout, and that throw is the failure. Don't wrap them in `expect`; use `expect` for value checks.
- **"Grid loaded" is the app's own signal.** `waitGridLoaded` reads `BaseGridView`'s `loadState` field (`loading`, then optionally `skeleton`, then `loaded` or `empty`) through `getActiveVal`. Anything asking whether a grid has settled should read `loadState`.
- **Scope `#id` reads to the active view.** `getVal` finds `#id` by searching from the scene root, and IDs repeat across components. A view suspended with the router's default `suspendMode: "hide"` (Home, `/settings`, `/photo`, `/audio`) stays in the tree, so its nodes can answer: a suspended Home's `#options` has beaten the active grid's options dialog. Use `getActiveVal`, or `waitFor(..., { read: getActiveVal })`, which searches `m.global.activeRoutedView`. A focus check (`waitFocused`) is unambiguous, so prefer it for "did this open?".
- **"Is focus inside X?" goes through `focusIsInside` or `waitFocusInside`,** never `keyPath.includes(...)`. RTA builds a `keyPath` from one segment per ancestor (`#id`, or the child index), and `#options` is a substring of `#optionsPanelOverlay`, so a substring test passes for focus anywhere in that overlay. `focusIsInside` matches whole segments.

## When a wait times out, it reports what it saw

A wait's message is the only account of a failure anyone gets, and "timed out waiting for X" says nothing about the cause. So every timeout in the harness throws through `diagnosedError` ([`lib/diagnostics.js`](../../tests/rta/lib/diagnostics.js)), which adds the device's state. Real output from forced failures (from before `readErrors=` was added):

```text
nav timed out waiting for a detail row count that can never happen (last=3)
        ↳ view=ItemDetails#91e3d867… loadState=— · focus=ResumeButton@#routerOutlet.#viewTarget.#91e3d867-….#buttons.#resumeButton
        ↳ home=5 · detail=3 · keyPath="#extrasGrid.content.getChildCount()" · last=3 · actionErrors=0
        ↳ server=https://demo.jellyfin.org/stable (id f0b33816…) user=4ed1b8b4…
```

```text
nav timed out waiting for a grid item count that can never happen (last=11)
        ↳ view=BaseGridView#649e2164… loadState=loaded · focus=JRMarkupGrid@#routerOutlet.#viewTarget.#649e2164-….#itemGrid
        ↳ home=5 · keyPath="#itemGrid.content.getChildCount()" · last=11 · actionErrors=0
        ↳ server=https://demo.jellyfin.org/stable (id f0b33816…) user=4ed1b8b4…
```

### Reading the dump

**`loadState=—` on a detail screen is correct.** `loadState` exists only on `BaseGridView`. `ItemDetails` extends `JRScreen`, a sibling, so it has none; there the load signal is `detail=<n>`.

The app shell's fields answer on every screen. Each prints only when set:

| Printed | Field | Tells you |
| --- | --- | --- |
| `spinner=on("…")` | `isLoading` / `loadingText` | The app was still waiting on a fetch, and which |
| `input=BLOCKED` | `isRemoteDisabled` | **The app was swallowing our key presses** |
| `waits=[…]` | The active view's `loadingWaits` | The screen's own named waits still open (`screenWaits`). They show the spinner without `isLoading` |
| `player=<state>` | The OS media player (`ecp.getMediaPlayer()`) | What the Roku player thinks is happening. `buffer` counts as playing while the app may still refuse to open the OSD |
| `videoNode=<state>` | The app's Video node | The app's side, so a mismatch with `player` says which side an unopened OSD is stuck on |
| `playerError=true` | The OS media player | The player itself faulted |

`input=BLOCKED` is the most useful. `JRScene.onKeyEvent` returns `true` while `isRemoteDisabled` is set, so every key sent was consumed: the "we pressed before it was ready" failure [`tests/rta/CLAUDE.md`](../../tests/rta/CLAUDE.md) opens with.

**A screensaver looks like a dead device.** A screensaver runs in its own BrightScript context, and ODC can't talk to the app while one is up, so the dump's ODC reads fail. The capture also asks ECP (`query/active-app`), which the OS answers, and prints this above the ODC line when one is up:

```text
nav timed out waiting for home rows (last=undefined)
        ↳ a SCREENSAVER is running ("Aquatic Life") — the app is not on screen, so treat every reading below as describing a backgrounded app
        ↳ device did not answer ODC: timed out after 5000ms
```

A screensaver starts only after the device's idle timeout, which a healthy run never reaches; it appears when a run has already stalled. The suite detects it rather than suppressing it ([`rta-screensaver-detect-not-suppress`](../decisions.md)).

**A failed read and an unchanged field are different timeouts.** `getVal` and `getActiveVal` turn a failed read into `undefined`, which is right for a poll but makes "the app never set the field" and "the device stopped answering" both print `last=undefined`. So the waits count reads that did not complete and say so:

```text
… (last=undefined) — 12 read(s) did not complete; the device may have stopped answering
```

`readErrors=<n>` is in the `observed` payload too. ODC answers `found: false` for a path it resolved and didn't find, and fails only when the request did, so an ordinary "not there yet" timeout reports `readErrors=0`.

### Rules for the capture

- **It runs only after a wait gives up**, at the throw site, so it costs nothing on the success path.
- **It reads identity by named field**, never the whole node: `JellyfinUser` carries `authToken`, and a whole-node read would put a credential in an artifact.
- **A new timeout throws through `diagnosedError`,** not `new Error`. An ESLint `no-restricted-syntax` rule in [`eslint.config.js`](../../eslint.config.js) fails `lint:js` on a bare `throw new …` in `lib/nav.js`, `lib/steps.js`, `screens.js`, `demos/` and `scripts/capture-screenshots.js`. A fail-fast that already names its cause can stay a plain throw, with the rule disabled on that line and a reason. The rule is a tripwire: `const e = new Error(…); throw e` passes it. A new lib file that grows a wait belongs in the rule's file list.
- **In a demo take, use `ctx.waitFor`** rather than a hand-written poll, so the take gets the dump. A spec that polls until it gives up should use a shared wait or `diagnosedError` too: `waitMediaPlaying` in `lib/steps.js` is the example.
- **A new wait needs a justified category.** The harness polls where RTA offers `onFieldChangeOnce`, so `jellyrock-rta/wait-justified` ([`rta-wait-justified.js`](../../scripts/lint/eslint-rules/rta-wait-justified.js)) fails a `waitFor` that fits none. It proves three categories from the call's shape; the fourth, a plain field settle, depends on how the app writes the field, so a `keyPath` must be listed in `VERIFIED_SETTLE_KEYPATHS`. The categories are in [`tests/rta/CLAUDE.md` → Why every wait polls](../../tests/rta/CLAUDE.md#why-every-wait-polls).
- **Register a failure `kind` first,** in the frozen `FAILURE_KINDS` set in `diagnostics.js`. It is the key a flake baseline groups by; an unregistered one is kept as is and flagged in the run summary.

Each failure also lands as a line in the run's `failures.jsonl`, which [`endRun`](../../scripts/run-record.js) folds into `run-meta.json` when the suite exits, then summarizes:

```text
[rta] 2 failure(s) captured with device state in this run → out/rta/failures.jsonl
[rta]   00:55 probe B: forced timeout on ItemDetails — wait-for-timeout; view=ItemDetails focus=ResumeButton
[rta]   00:56 probe C: forced timeout on a library grid — wait-for-timeout; view=BaseGridView loadState=loaded focus=JRMarkupGrid
```

## A green wait can still have read the wrong node (`RTA_AUDIT_RESOLUTION=1`)

`getVal('#homeRows…')` searches the whole scene, so a read can succeed against something other than the call site means, and a green gate says nothing. Two ways:

- **Duplicate:** several nodes share the ID, so tree order picks the answer. Seven components declare a node with ID `buttons`.
- **Not presented:** one node has the ID, in a view sgRouter has hidden. This is the one that has caused real false passes: `waitHome()` passed from a library grid by finding a suspended Home.

Set `RTA_AUDIT_RESOLUTION=1` and every scene-rooted read is checked against a census of the live scene ([`lib/resolution.js`](../../tests/rta/lib/resolution.js)), at one extra round trip per read. Findings go to the run's `resolutions.jsonl` and the run summary, on a passing run, the only time they can appear:

```text
[rta] 4 scene-rooted read(s) did not resolve to what the call site names, out of 538 audited.
      The suite is green either way — that is the defect, not the reassurance.
[rta]   OFF-SCREEN #homeRows.content.0.0.id (#homeRows) — hidden at #routerOutlet.#viewTarget.#d5e10d7e-…
```

- **It only reports.** It may not fail a healthy suite until its false-alarm rate is known.
- **It checks "presented", not "inside `activeRoutedView`".** `#jrDialog`, the most-read ID in the suite, is appended to the scene by `presentOverlayDialog`, as is `#imageFader`; an active-view rule would flag both.
- **It flags a node hidden by an ancestor, not one hidden itself.** `waitFor('#osd.visible', v => v === false)` waits for exactly that state.

`waitFocusInside` is outside it: it matches the focused node's own path.

## Run records

### One record directory per run kind

`writeRunMeta` overwrites, so each kind of run writes its own directory ([`runDir`](../../scripts/run-record.js)), and one never erases another's record:

| Run | Records to | Summary tag |
| --- | --- | --- |
| `npm run test:rta` (and `:tdd`, `:fast`, `:capture`) | `out/rta/` | `[rta]` |
| `npm run screenshots:capture` | `out/screenshots/` | `[screenshots]` |
| `npm run demo` | `out/demo/` | `[demo]` |
| `npm run test:unit`, `test:integration`, `test:all` (Rooibos) | `out/device/` | `[device]` |
| `npm run measure` | `out/measure/` | `[measure]` |

The tag comes from the directory, so the two can't disagree. Three files per kind; pick by the question:

| File | Where | Lifetime | Read it for |
| --- | --- | --- | --- |
| `run-meta.json` | `out/<kind>/` | This run, overwritten | One run whole: lock, time window, folded failures |
| `failures.jsonl` | `out/<kind>/` | This run, emptied at start | Failures as they land, mid-run |
| `runs.jsonl` | `.device-runs/<kind>/` | Never reset | Comparing across runs: the flake baseline reads this |

**The ledger lives outside `out/`** because every `build*` script starts with `npx rimraf build/ out/`, and `test:rta` builds first: a ledger there would be deleted before each run that appends to it. [`run-record.test.js`](../../tests/scripts/unit/run-record.test.js) checks both halves.

`npm run measure` adds `.device-runs/measure/measurements.jsonl`, one line per series with its samples, workload and provenance ([`measuring-performance.md`](measuring-performance.md)). It is not joined to `runs.jsonl`:

- It carries its own selection keys (`variant`, `commit`, `dirty`, `deviceKey`, `startedAt`) and its own `outcome`.
- A run refused before it measured writes a `runs.jsonl` line with `outcome: "blocked"` and no measurement.
- A `--nav` that fails partway keeps the launches already taken, with a `navFailure` saying why, and folds as `blocked`, so no comparison selects it.
- `npm run measure:devices` writes one line per device ([more than one device](measuring-performance.md#more-than-one-device)).

`capture-screenshots` tags each failure with its screen, locale and retry attempt, so a screen that recovered on attempt 2 isn't counted as a failure; demos tag each with the take's name.

### What each ledger line records

A baseline is a filter over the ledger, never a deleted file. Each line carries these keys, always present (`null` when unknown, `[]` for `runnerArgs`), so a filter can't drop a row silently:

| Key | Is | Why a baseline needs it |
| --- | --- | --- |
| `variant` | The npm script that ran (`test:rta`, `test:rta:fast`, `test:unit`, …) | `:fast` skips the deploy, `:capture` adds screenshots, and the Rooibos scripts are different suites |
| `runnerArgs` | What the run passed to its test runner, verbatim; `[]` for a full suite | `test:rta:fast -- -t "moviesLibraryGenres"` runs one test, and without this its line matches a full suite's |
| `commit` | Short SHA at the start of the run | Whether the runs tested the same code |
| `dirty` | The tree was modified at that SHA, untracked files included | A bare SHA would claim more than it can |
| `deviceKey` | Which Roku: the lock's `sha256(device-id)`, never an address | Devices are not interchangeable. `null` when the lock couldn't identify the device |
| `outcome` | `passed`, `failed`, `interrupted`, `crashed` or `blocked` | The only key about the run itself, not the invocation |

`assertions` (`{ <screen>: <count> }`) records how much each content assertion checked. A content assertion can check forty pairings or four and pass either way, so watch the count across a series; nothing asserts a floor on it, because fixture churn would make that fail for the wrong reason.

### Reading a baseline out of it

Run `npm run flake-baseline`: bare to see what the ledger holds, then with a series named:

```console
$ npm run flake-baseline
.device-runs/rta/runs.jsonl — 10 line(s)

  variant     test:rta ×8   test:rta:fast ×2
  device      (unrecorded) ×4   ac4701ca4a5d8a0b ×4   1f9118827848036c ×2
  commit      27279e75 ×3   f45eebd7 ×2   ad1908cb ×2   …
  outcome     (unrecorded) ×6   crashed ×2   passed ×1   failed ×1
  tree        dirty ×9   clean ×1
  scope       full suite ×9   -t moviesLibraryGenres ×1
  hour        inside one hour ×10

$ npm run flake-baseline -- --commit HEAD --device ac4701ca4a5d8a0b
  samples     6   (6 passed, 0 failed)
  excluded    4   1 dirty tree · 1 other device · 1 scoped run (-t moviesLibraryGenres) · 1 not a sample (1 crashed)

  flake rate  0/6 = 0.0%   95% upper bound 39.3%
  ⚠ 4 of 6 samples crossed the top of the hour.
  The demo server resets then, so those ran against a fixture that changed underneath
  them. NOT excluded — whether it matters is the proportion, …
  A clean series BOUNDS the rate, it does not measure 0% — …
```

`--run run-roku-tests` reads the Rooibos ledger; `--variant a,b` overrides the variants. It is a command, not a filter to retype, because hand-written versions of it produced wrong numbers without an error ([`decisions.md`](../decisions.md), the `SAMPLE_OUTCOMES` entry).

How it chooses, and why:

- **Only `passed` and `failed` runs are samples.** A `crashed`, `interrupted` or `blocked` run never reached a verdict, so it says nothing about the app either way: counting it red inflates the rate and counting it green hides a failure. `SAMPLE_OUTCOMES` in [`run-record.js`](../../scripts/run-record.js) is that set, shared with the run summary's advice.
- **`blocked` looks like an ordinary failed run,** but a request to the test server failed underneath it, so what went red after was not a fair test. `tests/rta/lib/jellyfin.js` records the failure where it happens, and it outranks `failed`. A `blocked` run in your series means the fixture failed you: take the run again.
- **The rate reads `outcome`, never `failures.length`.** An empty `failures` list is true of a passed run, a run that failed somewhere the capture doesn't cover (a plain `expect()`, a Vitest error), and a run that never started. A run nobody closed is labeled `crashed`, and a run that didn't pass prints a line.
- **A scoped run is excluded.** A `-t` run is not a weak sample of the suite but a sample of something else. It excludes on any passed argument, not a list of the narrowing ones, because Vitest's set of narrowing flags changes between versions; a harmless flag costs a sample loudly, with the arguments printed. There is no flag to include scoped runs. A line with no `runnerArgs` predates the key and counts as a full suite (checked against the ledger; see `flake-baseline.js`).
- **Crossing the top of the hour is a warning, not an exclusion.** The demo server resets on the hour, so a run spanning it ran against a fixture that changed. Whether that matters depends on how many runs did, which only you can judge. A line missing the flag is counted separately, never read as "did not cross".
- **A clean series bounds the rate; it doesn't show 0%.** Six clean runs bound it at 39%, ten at 26%, thirty at 10%, so report "consistent with fixed, upper bound X%". One red run is informative at once.

Taking a series:

- **Run one `test:rta`, then `test:rta:fast` for the rest,** so the series tests one binary. The tool includes both variants for the RTA ledger by default. Compare durations within one variant: `:fast` skips the deploy.
- **Commit first.** A dirty tree is excluded, because `dirty` carries no content hash.
- **Don't `git pull` during a series.** `commit` is stamped per run, so a pull splits one series into two, silently.
- **Check `npm run device:status` between runs.** A failed registry restore is not in the run record: `rta-run` folds the record before it restores. A restore that doesn't converge spoils every later run, and those are the ones that look normal in the ledger.

### Where a baseline runs

| Device | Reached through | Can you deploy to it? |
| --- | --- | --- |
| Your device | `ROKU_IP` and `ROKU_PASSWORD` in your `.env` | Yes |
| The CI device | The org secrets `ROKU_DEVICE_IP` and `ROKU_DEVICE_PASSWORD` | No |

**Take the series on your device, and cross-check on the CI device** by dispatching [`rta-functional-tests.yml`](../../.github/workflows/rta-functional-tests.yml), which uploads the ledger. Not the other way round:

- **You can't deploy to the CI device.** Its password is an org secret, so the deploy fails with `401 Unauthorized`, after the lock is taken.
- **Holding its lock blocks CI.** CI's device jobs only read the lock and fail rather than wait, so a long series would fail every PR's device check meanwhile. Running the series inside CI has the same problem: the one self-hosted runner takes one job at a time.

Six to eight runs on your device and about three dispatches answer whether the device matters at all; the CI arm is not a second baseline. `npm run device:status` prints the ledger key of the device you can reach, and bare `npm run flake-baseline` lists every key with runs, including the CI device's.

**One red in three CI runs is not a signal.** With one red among 11 runs (8 and 3), it lands in the group of 3 about 27% of the time by chance:

| CI-device result | Read it as |
| --- | --- |
| 0/3 | Agreement: stop |
| 1/3 | Not separable: extend that arm to 6 first |
| 2+/3 | A real difference: chase it |

### A run always closes, including on Ctrl-C

`beginRun` returns a handle whose `close()` folds the run. It also arms a `process.on('exit')` handler that closes a run no entry point closed, because three of the four entry points exit through a signal handler ending in `process.exit()`. `close()` stays explicit where order matters: `rta-run` folds before the registry restore, so the summary survives a restore that throws. A subprocess test in [`run-record.test.js`](../../tests/scripts/unit/run-record.test.js) checks it.

On macOS, stdout from an `exit` handler is asynchronous for pipes, so a piped, interrupted run can lose its printed summary. The records are file writes and are unaffected: read `run-meta.json`.

### The run's time window

The summary reports the run's window and flags a run that crossed the top of the hour, when the demo server resets its content (playlists, and anything the run marked watched). A change landing mid-run fails as an unrelated nav timeout. Each failure carries `afterHourBoundary`, so you can tell which side of the reset it landed on.

In watch mode (`test:rta:tdd`) the window spans the whole session, so both the run flag and the per-failure stamp are off, and `afterHourBoundary` is absent rather than `false`: the reset may well have happened. `beginRun` writes `cumulative` into the record at open time so the Vitest child can see it.

## Test hooks in RTA builds

RTA builds add fields on `m.global` under `#if ENABLE_RTA` in `setGlobalNodes()`, absent from dev and prod builds. Each lives in app memory, so the next relaunch clears it. Set them after relaunch, before navigating.

### Driving intermediate load stages (`rtaSkeletonHoldMs`)

The Genres view's skeleton stage (structure drawn, samples pending) lasts only a few hundred milliseconds against the demo server. `rtaSkeletonHoldMs` makes `LoadItemsTask2` hold it open, like a slow server:

```js
await odc.setValue({ base: 'global', keyPath: 'rtaSkeletonHoldMs', value: 5000 });
await openLibraryByType('movies', moviesId); // navLibraryByType minus the loaded-wait
```

`specs/genre-skeleton.spec.js` uses it. `openLibraryByType` is the press-into-the-library half of `navLibraryByType`, for specs like that one; everything else should use `navLibraryByType`, which waits for the grid to settle.

### Paging a grid on a small library (`rtaGridPageSize`)

A grid page is 100 items, larger than the demo server's libraries, so paging never happens there. Above 0, `rtaGridPageSize` is `LoadItemsTask2`'s page size; the task reads it when created, so set it before opening the grid:

```js
await odc.setValue({ base: 'global', keyPath: 'rtaGridPageSize', value: 4 });
```

`specs/fail-requests.spec.js` uses it to fail a later page.

### Asking "Are you still watching?" now (`rtaForceStillWatching`)

The prompt normally needs an hour or more of unattended playback. While `rtaForceStillWatching` is `true`, `PlayerHostView` asks at every automatic advance:

```js
await odc.setValue({ base: 'global', keyPath: 'rtaForceStillWatching', value: true });
```

`specs/still-watching.spec.js` uses it; when to ask is unit-tested in `tests/source/unit/utils/stillWatching.spec.bs`.

## Making requests fail or slow (`rtaFailRequests`)

A screen's failure path can't be reached against a healthy server, nor its slow path against a fast one. RTA builds let a spec fail or slow chosen requests, through [`lib/failRequests.js`](../../tests/rta/lib/failRequests.js):

```js
await failRequests([{ prefix: 'itemQuery_usersItems', kind: 'timeout', times: 1 }]);
await openLibraryByType('movies', moviesId);
```

- **`prefix`** matches the start of the request ID the app passes to `fetchRes` or `fetchAsync` (`itemQuery_usersItems`, `itemMetaData`, `genreItems_<id>`, …). Find it at the call site.
- **`kind: 'timeout'`** answers the way `roku-requests` does when it gives up; **`kind: 'http'`** needs a `status` of 400 or more.
- **`kind: 'slow'`** needs `ms`: the request is sent and its real answer held until `ms` after sending, with its pool slot busy all the while. `{ …, kind: 'slow', ms: 20000, times: 1, after: 1 }` slows a grid's page 2. `m.global.rtaHeldRequests` counts answers held now; read it with `getGlobalVal` ([`lib/steps.js`](../../tests/rta/lib/steps.js)) to act once a request is on a slot, and to see the slot freed when its screen closes. [`specs/slow-library.spec.js`](../../tests/rta/specs/slow-library.spec.js) is the reference.
- **`times`** is how many matching requests the rule applies to (all when omitted). `times: 1` proves recovery: the first load fails and the next reaches the server.
- **`after`** is how many matching requests pass first, for an ID that repeats faster than a spec can act: a grid's page 2 follows page 1 within a fraction of a second under the same ID, so `{ …, times: 1, after: 1 }` fails page 2 alone.
- **A rule the app can't honor exactly is dropped,** so a typo fails your assertions, not another request.

The API coordinator answers a failed request itself and never sends it; a slowed one it sends and holds ([`api.md`](../architecture/api.md#a-request-a-test-makes-fail-or-slow-rta-builds-only)). Only pooled requests are covered, not the start-up sync calls (`getJson`) or `SideEffectTask` writes. [`specs/fail-requests.spec.js`](../../tests/rta/specs/fail-requests.spec.js) is the reference. When the failure you want is a request failing, use this rather than a new `DebugFlags` flag.

## Adding a screen

Add one entry to [`tests/rta/screens.js`](../../tests/rta/screens.js):

```js
{ name: 'myScreen', state: 'home', nav: navMyScreen, capture: { eligible: true } }
```

- **`state`:** `'home'`, `'userSelect'` or `'serverSelect'`, the state to seed and land on, through the matching `seed*` in [`lib/seed.js`](../../tests/rta/lib/seed.js). A new state needs a branch in both `specs/screens.spec.js` and `scripts/capture-screenshots.js`.
- **`nav`:** an async `(ctx) => {}` in [`lib/nav.js`](../../tests/rta/lib/nav.js) that presses keys and waits for the screen's loaded signal. The waits are the assertion.
- **`assert`:** optional, for a screen with no `nav` or extra checks.
- **`view`:** optional `{ collectionType, landing }` for a screen that depends on a library view. Views are remembered in the registry (`display.<libraryId>.landing`), so seed the view rather than inherit one. The `vw(name, nav, collectionType, landing)` helper builds these entries, and `seedLibraryLanding` finds the library by `collectionType` at runtime, never by a fixed ID. `seedHome` clears every `display.*` key first.
- **`capture`:** screenshot settings. `eligible` captures it, `store: true` also puts it in the store set (below), `backdrop: true` puts the film frame behind the OSD, and `scope: 'shared'` captures a screen with no text once for every locale.
- **`requires`:** optional `{ probe, reason }`, or a list of them, for a screen that needs something the server may not have. `probe` is a `(ctx) => boolean`, sync or async; when it answers false, the screen skips with that reason, in the suite and the screenshot run alike, through the one `firstUnmetRequirement(screen, ctx)`. Gates run in order and stop at the first that fails, so a cheap check can guard an expensive one. A probe throws on a failed request rather than answering false, so an auth error can't pass as "not available".

  | Gate | Kind of gap | Skips when |
  | --- | --- | --- |
  | `manageSubtitlesOffered()` (`subtitlePanel`) | User or server capability | The user can't search subtitles, or no provider plugin is installed |
  | `HERO_PRESENT` (`osd`, `trickplay`) | The configured content is missing | `RTA_HERO_MOVIE` names a film this server doesn't have |
  | `trickplayAvailable()` (`trickplay`) | Data the server derives | The server extracted no trickplay images for that film |

  Without a gate, missing content passes falsely or fails like an app bug. A film `findMovie` doesn't find returns `{ index: 0, id: '' }`, so the seek is skipped and the screen passes without being driven; trickplay extraction is off by default on Jellyfin, so the trickplay screen fails as if the scrubber were broken. A "Generate Trickplay Images" task finishing cleanly is not evidence that images exist.

The new screen becomes a functional test (the spec loops over `SCREENS`) and, if `capture.eligible`, a screenshot.

A screen with a `view` skips itself, with a reason, when the server has no library of that `collectionType`: the demo server's libraries come and go, so a missing one says something about the fixture. That is why the spec is a plain `for` loop and not `it.each`, which passes no Vitest `TestContext` to skip with.

### Workload entries

Some entries are round trips that end where they started, not screens. They are in the registry because [`scripts/measure.js`](../../scripts/measure.js) resolves `--nav` from it:

- **Round trips that keep a view:** `homeReturn`, `homeReturnAfterDetails`, `searchReturn`.
- **Cell sweeps:** `cellSweepHome`, `cellSweepGrid`, `cellSweepExtras`, `cellSweepSearch`. Each opens a screen, moves a fixed distance, waits for its cell counters to stop, and leaves, which publishes them ([cell workloads](measuring-performance.md#cell-workloads-how-much-work-did-the-cells-do)).
- **Grid paging:** `gridScroll`, a timed scroll (Down every 150 ms for 20 s) that can outrun the loaded rows; leaving prints the grid's paging line ([`home-first-paint-performance.md`](home-first-paint-performance.md#grid-paging-did-the-user-wait-at-the-last-loaded-row)).

They have no `capture`, and they still run as functional tests, so a workload that can no longer reach its screen fails like any navigation regression. When writing one:

- **Fit the fixture; never refuse it.** They run against the small demo server too. A sweep that wants 12 steps and finds 4 rows takes 3 and says so.
- **Home needs one more gate.** `waitHome()` is satisfied by skeleton rows, so `navCellSweepHome` waits on [`waitRowsSettled`](../../tests/rta/lib/steps.js) before reading its bounds. That gate is not why Home's counts vary between launches: the variation happens during page load, before the first key press ([why](measuring-performance.md#the-totals-are-cumulative-on-home-most-of-them-are-not-the-sweeps)).
- **Add a `nav` rather than change one.** `measure` records the `nav`'s name, not its path, so changing its distances splits a series without saying so.

## Screenshots

### Store set vs website gallery (the `store` flag)

The Roku store takes 6 screenshots; the captured set is larger, and the rest feed the website's gallery.

- **`eligible`:** captured, written to `docs/screenshots/<locale>/` and saved by `RTA_CAPTURE`.
- **`store`:** also one of the store and homepage 6. Only these go into `npm run screenshots:store`, and the homepage shows them in registry order.

`docs/screenshots/screenshots.json` lists both: `screens` (the gallery) and `storeScreens`. Keep `store: true` on exactly the 6 that ship; a seventh is a Developer Portal decision.

### Image format and size

Committed images are lossless WebP. The device outputs a fixed-quality JPEG, so lossless loses nothing more and keeps the files several times smaller than PNG. Only the `galleryLocale` (en_US) folder holds every screen; other store locales hold only the store screens. The manifest records `format` and `galleryLocale` so the website can find `<locale>/<screen>.<format>`. The Developer Portal wants PNG, so `npm run screenshots:store` converts each store WebP to PNG in `out/store/<lang>/`.

### Two capture tiers

| | `RTA_CAPTURE=1` (test runner) | `screenshots:capture` (store) |
| --- | --- | --- |
| Output | `out/rta-captures/<screen>.png` (gitignored) | `docs/screenshots/<locale>/<screen>.webp` and `screenshots.json` |
| Locales | en_US only | All of them |
| Build | Dev | Prod, with release branding |
| OSD background | Black: the video plane can't be captured | A real film frame, composited with ffmpeg |
| For | Seeing the UI while you design it | Store and website images |

`screenshots:capture:dev` and `screenshots:capture:fast` are the alternatives ([`capture-screenshots.js`](../../scripts/capture-screenshots.js)).

### Capturing only new screens

You don't need to regenerate the whole set:

```bash
# Functional test, only the new screens (skip redeploy after the first full run):
RTA_NO_DEPLOY=1 vitest run --config vitest.rta.config.js -t 'serverSelect|settings'

# Capture ONLY the new screens, full locale matrix (leaves the other images untouched).
# DEPLOY=1 on the first run to push the build; drop it on re-captures.
DEPLOY=1 node scripts/capture-screenshots.js --screens=serverSelect,settings
```

`--screens=` overwrites only those screens' files, and `--languages=` narrows the locales. `screenshots.json` and the README index are rebuilt from the config each run, so they always describe the full set.

### Store languages

`screenshots:capture` writes every locale in `RTA_CONFIG.languages`. Only `RTA_CONFIG.storeLanguages`, the one hand-kept list of what ships, goes in the store listing. `npm run screenshots:store` copies those into `out/store/<lang>/` for upload. To add a store language, add it to `storeLanguages` and run it again; `storeLocales` in `screenshots.json` tells the website which they are.

## Load windows, and testing on a second device

A nav that presses a key right after starting playback presses into a component that ignores input until it is ready. The window from press to playable was several seconds on every device tested, set by stream start on the demo server, not device speed. Every nav has to wait for it rather than lengthen a timeout; the rule is in [`tests/rta/CLAUDE.md`](../../tests/rta/CLAUDE.md).

- **When a failure happens on one device only, power-cycle it and run again** before chasing it. Device state drifts.
- **Before a release, run against the slowest supported device,** not only a fast one. A device with headroom hides rendering bugs and render-thread costs.

## "nothing is listening on <host>:9000": the run refused to start

Every RTA entry point checks the on-device component is there before its first ODC call, and stops within seconds when it isn't. Three things cause it, and they look the same from outside:

- **The installed build has no ODC.** A Rooibos test build (`npm run test:unit`) and a `build:prod` both leave a working channel with no component. Deploy the dev build again; `npm run test:rta` does unless you set `RTA_NO_DEPLOY=1`.
- **The channel is closed.** The component lives inside the app, so port 9000 goes quiet when the app exits. That is also why "ODC not answering" from `npm run device:check` is not on its own a reason to redeploy.
- **The device is asleep or off, or `ROKU_IP` names another host.** Run `npm run device:check`.

It is a gate rather than a longer timeout because a failed connect in `roku-test-automation` leaves a rejection nothing can catch, which ends the process at an unrelated point and loses the run record ([`scripts/lib/odc-probe.js`](../../scripts/lib/odc-probe.js); `rta-odc-gated-before-bounded` in [`decisions.md`](../decisions.md)). The gate waits longer than RTA's own connect retry, so a slow but working boot passes; if it fails on a device that is coming up, the gate has a bug.

A port that is open while the component never answers is a separate case: *"the ODC port is open but the component never answered ... within 60 s"*, an upstream defect (`rta-odc-connect-hang` in [`signals-backlog.md`](../signals-backlog.md)). Kill the run and deploy again.

## Leaving the device as you found it

An RTA run drives a device someone uses, so it owns the device's registry for the run and hands it back. [`scripts/rta-run.js`](../../scripts/rta-run.js) is that owner: it deploys, snapshots, runs Vitest as a child process and restores. Every `test:rta` variant goes through it.

- **The snapshot is the whole registry,** every section and key, not a list of what the seeds write: the app writes too.
- **The restore is a diff, and it is checked.** Added keys are deleted, created sections dropped, changed values put back. Then the channel cold-starts and the whole registry is compared with the snapshot; a mismatch retries, then fails and names the keys.
- **`authToken` and `primaryImageTag` are compared on presence, not value.** The check's cold start can make the app sign in again and save a new token, so comparing bytes would never match. `LastRunVersion` is ignored. Presence still fails both ways:

  | Snapshot | Device after restore | Verdict |
  | --- | --- | --- |
  | Has a token | Has a different token | Passes: the app made its own |
  | Has a token | Has none | Fails: the session was destroyed |
  | Has none | Has one | Fails: a credential was left behind |

  The restore still writes the user's own value back; only the comparison is relaxed ([`restore-compares-credentials-by-presence`](../decisions.md)).
- **The snapshot is saved to `.device-runs/registry-<host>.json` before any seeding,** and deleted only by a checked restore. A file still there means the last run did not put the device back:
  - `npm run rta:restore` applies it.
  - The next run applies it automatically before taking its own snapshot, so a stranded state never becomes the new baseline.
  - **Except while the run that wrote it is alive.** The file records the `pid` that wrote it, and it exists for the whole of a healthy run, so `snapshotRegistry()` refuses rather than revert a running suite's registry. The device lock usually keeps runs apart, but it is advisory under `RTA_SKIP_LOCK=1`, without a GitHub token, or with GitHub unreachable. If the process is gone and its number reused, `npm run rta:restore -- --force` repairs it.
  - **It lives outside `out/`** for the ledger's reason: a build would delete it before the next run could use it to repair the device.
  - **It is shared across entry points,** so a device stranded by `npm run demo` is repaired by the next `test:rta`, and `rta:restore` finds it with no arguments.
  - **It is your real registry, `authToken` included,** so treat it as a secret. It is gitignored, and nothing prints its contents. Only a checked restore or `rta:restore` removes it, so it can sit there indefinitely. When a restore won't converge and you are done with the device, `npm run rta:restore -- --accept` prints what it couldn't restore and clears the snapshot; use it rather than `rm`, which deletes the device's only backup. What you accepted is written, redacted, to `.device-runs/accepted-<host>.json`, and `npm run device:status` reports it until you delete that file.
  - **`npm run device:status` reports every snapshot on disk,** for any host, with when it was taken. It shows a live run as `IN PROGRESS` and withholds the repair command; `rta:restore` refuses then too (`-- --force` overrides). The lock is not the signal for this: a degraded run holds none, and a stale lease outlives a finished run.
- **Ctrl-C is safe.** It stops the child, and the parent restores before exiting, which takes a while; press Ctrl-C again to abandon and repair later with `npm run rta:restore`. This is why the lifecycle can't live inside Vitest: `afterAll` never runs in a killed process, and Vitest's own interrupt handler exits too soon for a restore.
- **Don't run `vitest --config vitest.rta.config.js` directly.** `globalSetup` refuses, because that path takes no snapshot.

### The second owner: `measure:devices --sign-in`

`npm run measure:devices -- --sign-in <url> --user <name>` signs every device in `ROKU_DEVICES` into one server, measures them, and puts them back, so a device matrix really does measure one server.

- **Single-device `npm run measure` never writes the registry,** so a lone series measures the app as the device already has it. The sign-in lives in [`scripts/measure-signin.js`](../../scripts/measure-signin.js), one child process per device (`roku-test-automation` binds one host per process).
- **It reuses the lifecycle above:** `snapshotRegistry()` from [`lib/registry.js`](../../tests/rta/lib/registry.js), `seedHome` from [`lib/seed.js`](../../tests/rta/lib/seed.js), then `npm run rta:restore`, with the same `VERIFIED CLEAN` check.
- **`--sign-in <url>` implies `--server <url>`,** and the server is still checked on every device, so a sign-in that didn't take fails before a sample is written. Passing `--server` or `--no-server` with it is refused, and so is repeating a sign-in flag, because otherwise the last value would win silently.
- **The sign-in takes the device lock;** the restore does not. The sign-in is the only part that writes the registry, so it is where a concurrent run could adopt the seed as a user's state. `rta:restore` is the repair for a dead run, so a dead run's lock must not block it; its one refusal keys on the snapshot's live `pid`.
- **`hardRelaunch()` runs before the first registry read,** because an ODC read against a device not running the component hangs rather than fails, and RTA's request timeout doesn't cover a connect that never settles. The sign-in also has its own wall-clock limit, for a build with no ODC (a Rooibos test build, a `build:prod`), which `--deploy` doesn't fix because that deploy happens inside `measure`, after the sign-in.
- **The restore always runs:** after a failed sign-in, a failed measurement or an interrupt. The driver handles `SIGINT`, `SIGTERM` and `SIGHUP` through `signalPolicy` in [`measure-matrix.js`](../../scripts/measure-matrix.js). The first signal stops the run and kills the child, unless the restore is running, which is left to finish. A second abandons it and prints the device at risk (`ROKU_IP=<host> npm run rta:restore`).
- **A restore that didn't verify fails the whole run** and prints the repair command, even when every measurement succeeded.
- **Every device is seeded in `RTA_CONFIG.languages[0]` (`en_US`),** so a matrix compares hardware, not languages. `measurements.jsonl` has no locale field, so a seeded series and a plain `measure` series on one device may differ in language without saying so; the driver prints it, and recording it is an open followup.

For an account with a password, set `MEASURE_SIGNIN_PASSWORD` in `.env` rather than passing a flag.

## The device lock

[`scripts/device-lock.js`](../../scripts/device-lock.js) keeps two runs off one device: `test:rta`, `test:unit`, `demo` and `screenshots:capture` can each take the same device from different terminals, and the Rooibos path has no snapshot to fall back on. CI has its own device, so the contention is between local runs; the lock keys on the device's identity, so it also covers a local run pointed at the CI device. Which device is which is in the header of `device-lock.js`.

- **The lock is a git ref,** `refs/device-lock/<key>` in this repo. Creating a ref that exists fails with 422, which makes it a true compare-and-swap with no service to run. A tag object the ref points at holds the holder and the lease clock.
- **The key is a hash of the device's identity,** `sha256(device-id)` cut to 16 hex characters. Ref names are public on a public repo, and a `device-id` partly encodes the serial. An address would be worse: a new DHCP lease would give each side a different key, and both would run. A run that can't identify the device over ECP says so instead of guessing.
- **There is no check that CI is idle.** CI uses its own device, so waiting on CI would block you from your own hardware.
- **A run that finds the device locked fails at once and names the holder.** No queue: another device on the network is usually free (`ROKU_IP=<other-ip> npm run test:rta`).
- **Reads can be stale; the create is not.** A 422 followed by a read saying "free" means the read is wrong. Never decide the device is free from a read.
- **The holder record names the run, not you:** `what`, a `pid`, and `local` or `ci`. No hostname, since the tag object is public while held.
- **A crashed holder's lease expires after 15 minutes.** Live holders renew every 5 minutes, so a long `screenshots:capture` never expires. `npm run device:status` names the holder, and `npm run device:release` drops a stuck lock.
- **`rta-restore.js` takes no lock,** since it is the repair for an abandoned run, which may have left one behind.

When GitHub is unreachable or you aren't signed in, a run warns and proceeds without the lock, and records `locked: false` in `run-meta.json`. Set `RTA_REQUIRE_LOCK=1` to make that a failure, or `RTA_SKIP_LOCK=1` to bypass the lock on purpose. CI doesn't set `RTA_REQUIRE_LOCK`: it is alone on its device, so the flag would only turn a GitHub outage into a red run.

## Notes

- **Seeds write the real `JellyRock` registry,** not a `test-` section, because the app reads real keys to choose a screen. This is the accepted exception to the `test-` rule, which is for Rooibos tests. [Leaving the device as you found it](#leaving-the-device-as-you-found-it) covers what puts it back.
- **The demo server** is the public `demo.jellyfin.org/stable`, with license-clear content. It resets every hour, so navigation finds tiles by `SortName` index, never by the Continue Watching row.
