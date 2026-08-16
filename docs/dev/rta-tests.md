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
last-reviewed: 2026-08-16
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

## When CI runs it

[`rta-functional-tests.yml`](../../.github/workflows/rta-functional-tests.yml) runs the
suite on the **release-prep branch** (`push` to `release-*.*.*`) and on
`workflow_dispatch`. It is deliberately **not** a per-PR gate: there is one physical
device, shared with the Rooibos device suite and with ad-hoc manual runs, and
[`vitest.rta.config.js`](../../vitest.rta.config.js) pins single-fork by design, so a
full pass is ~10–15 min of exclusive device time.

Three guards keep it from firing on pushes that can't change what RTA observes:

| Guard | Why |
|---|---|
| [`changed-paths`](../../.github/actions/changed-paths/action.yml) | A screenshot / docs / `CHANGELOG` push to the release branch never spins the device. It resolves a `push`'s file list via the compare API over `before...after`; branch creation and `workflow_dispatch` fall back to running, so it can never *falsely* skip. |
| `github.actor != 'jellyrock[bot]'` | [`release-management.yml`](../../.github/workflows/release-management.yml) pushes the version bump to this same branch as the bot, and that commit changes no observable behavior. Same guard [`device-unit-tests.yml`](../../.github/workflows/device-unit-tests.yml) uses. |
| `concurrency` with `cancel-in-progress: **false**` | Not a typo, and not the usual choice. Concurrency is evaluated **before any job runs**, so with `true` a docs-only push would cancel an in-flight run started by an earlier *source* push and then skip — leaving that source change with no gate at all. A skipped run is a ~20-second `ubuntu-latest` no-op, so letting runs queue costs nothing. |

**The trade-off, stated plainly:** a release-only gate surfaces a regression after N
merged PRs, so bisecting is harder than it would be with a per-PR gate. That is the
price of one device. When a PR genuinely touches navigation, screens, or
`tests/rta/**`, run `npm run test:rta` locally rather than waiting for the release
branch to find it.

## How it works

- **Deploy**: the RTA `device.deploy({ injectTestingFiles: true })` stages the build,
  flips the manifest `bs_const ENABLE_RTA=false`→`true`, and injects the on-device
  component. The `#if ENABLE_RTA` block in `source/main.bs` then creates
  `RTA_OnDeviceComponent` at boot. This passthrough works for **both** dev and prod
  builds. Deploy runs once per test run, from [`scripts/rta-run.js`](../../scripts/rta-run.js)
  before Vitest starts; `RTA_NO_DEPLOY=1` skips it.
- **Per worker**: `tests/rta/setup/env-setup.js` (Vitest `setupFiles`) configures the
  RTA client singletons from `.env` in the test worker.
- **Seeding, then `hardRelaunch()` — never `relaunch()`**: seeds write the device
  registry, and a plain `relaunch()` (ECP `/launch/dev`) only *foregrounds* an
  already-running channel. The app keeps its in-memory session and re-persists it
  over everything just seeded. The suite then drives an app pointed at whatever
  server it was already on, using the seeded server's item ids — which surfaces as
  ~30 unrelated-looking timeouts, not as an obvious seeding error. `hardRelaunch()`
  exits to the Roku home screen first, forcing a cold start that re-reads the
  registry. `assertSeedTookEffect()` runs after each one and fails loudly if the
  seed was discarded. Cost is `exitMs` (~4 s) per relaunch. **This applies to every
  registry write, including `scripts/capture-screenshots.js`** — there the failure
  is worse than a red test: it silently photographs the wrong server's library into
  the store-listing set.
- **Serial**: one real device, so `vitest.rta.config.js` pins single-fork, no
  parallelism, long timeouts (OSD playback waits can take ~90 seconds).
- **Assertions**: the `waitFor` / `waitFocused` steps poll real node state and THROW
  on timeout — that throw IS the test failure (a descriptive message). Don't wrap them
  in `expect`; use `expect` only for value checks (title text, focus subtype).
- **"Grid loaded" is the app's own signal, not an inference**: `waitGridLoaded` polls
  the `loadState` interface field on `BaseGridView` (`loading -> [skeleton ->] loaded | empty`)
  via `getActiveVal` — one atomic read of state the view maintains, instead of the old
  child-count + first-cell-type sniffing (two racing ODC reads that also re-declared the
  skeleton sentinel string on the JS side and assumed row 0 filled ⇒ all rows filled).
  Anything that needs "is this grid settled?" should read `loadState`, not content
  internals.
- **Scoping `#id` reads when a suspended view is still in the tree**: `getVal` resolves
  `#id` by a recursive `findNode` **from the scene root**, but `id` is not unique across
  components (every `ItemDetails` has `#extrasGrid`; several declare `#options`). A view
  suspended under the router's default `suspendMode: "hide"` — Home, `/settings`,
  `/photo`, `/audio` — stays in the tree, hidden and parked off-screen, so its nodes can
  still win a recursive lookup: the observed case is a suspended Home's own `#options`
  (an `OptionsSlider`, hidden) beating the active grid's options dialog. Views on
  `"detach"` routes (`/library`, `/details`, `/search`) are removed from the tree while
  suspended, so they are not the hazard — but scoping the read costs nothing and does not
  depend on knowing which mode a route carries.
  For value reads of such recurring ids, use `getActiveVal` (or `waitFor(..., { read:
  getActiveVal })`), which scopes to `m.global.activeRoutedView` (the app's own "view the
  user is on"). Focus-based assertions (`waitFocused`) are inherently unambiguous — there
  is only one focused node — so prefer them when "did this open/land?" is the question.

## When a wait times out, it reports what it SAW

The waits are the assertions, so their messages are the only account of a failure
anyone gets. Left to themselves they describe the **ask** — "nav timed out waiting
for X" — which cannot be attributed to a cause afterwards. So every timeout in the
harness throws through `diagnosedError`
([`lib/diagnostics.js`](../../tests/rta/lib/diagnostics.js)), which attaches the
state the device was actually in.

Both samples below are **real captured output** from forced failures on `.177`, not
illustrations. A detail screen first:

```text
nav timed out waiting for a detail row count that can never happen (last=3)
        ↳ view=ItemDetails#91e3d867… loadState=— · focus=ResumeButton@#routerOutlet.#viewTarget.#91e3d867-….#buttons.#resumeButton
        ↳ home=5 · detail=3 · keyPath="#extrasGrid.content.getChildCount()" · last=3 · actionErrors=0
        ↳ server=https://demo.jellyfin.org/stable (id f0b33816…) user=4ed1b8b4…
```

…and the same wait against a library grid:

```text
nav timed out waiting for a grid item count that can never happen (last=11)
        ↳ view=BaseGridView#649e2164… loadState=loaded · focus=JRMarkupGrid@#routerOutlet.#viewTarget.#649e2164-….#itemGrid
        ↳ home=5 · keyPath="#itemGrid.content.getChildCount()" · last=11 · actionErrors=0
        ↳ server=https://demo.jellyfin.org/stable (id f0b33816…) user=4ed1b8b4…
```

### `loadState=—` on a detail screen is correct, not a broken capture

The difference between those two lines is the thing worth knowing before you read a
failure record. **`loadState` is grid-only**: it is declared on `BaseGridView`
([`BaseGridView.xml`](../../components/ItemGrid/BaseGridView.xml)) alone, where it
carries a real four-value vocabulary (`loading` / `skeleton` / `loaded` / `empty`).
`ItemDetails` extends `JRScreen`, a *sibling* of `BaseGridView`, so it has no such
field and the dump shows `—`. On a detail screen the load signal is `detail=<n>`
and the shell fields below.

The universal signal — the one that answers on **every** screen — is the app
shell's, read from the scene root:

| Printed when | Field | What it tells you |
|---|---|---|
| `spinner=on("…")` | `isLoading` / `loadingText` | the app was still blocked on a fetch, and which one |
| `input=BLOCKED` | `isRemoteDisabled` | **the app was swallowing our key presses** |

`input=BLOCKED` is the highest-value field in the dump.
[`JRScene.onKeyEvent`](../../components/JRScene.bs) does `if m.top.isRemoteDisabled
then return true`, so a timeout carrying it means every key we sent was consumed and
reported handled — the *"we acted before it could respond"* failure mode that
[`tests/rta/CLAUDE.md`](../../tests/rta/CLAUDE.md) opens with, which until now could
only be inferred. Both print **only when set**, so an ordinary failure stays as
short as the samples above and the flag keeps its signal value.

- **It costs nothing on the success path.** The capture runs *after* a poll loop
  has given up, at the throw site, never inside a tick — deliberately, because
  [#785](https://github.com/jellyrock/jellyrock/issues/785) may replace those loops
  with `onFieldChangeOnce` and diagnostics must not entrench a shape it might
  delete. At the boundary it is two round-trips issued in parallel (`getFocusedNode`
  has no batch form; everything else rides one `getValues` of 11 key paths) —
  **median 21 ms, 18–30 ms typical** on `.177` (n=20 on `ItemDetails`), with occasional
  spikes to ~70 ms when the render thread is busy. Adding the three shell fields did
  not move that: it is still one round trip, and
  [the platform cost model](../architecture/async.md#crossing-the-thread-boundary-costs-a-rendezvous--budget-crossings-not-bytes)
  says the count of crossings dominates the size of each.
- **The `observed` fields come free.** `rowTypes` / `rows` are retained from reads
  the loop was already making, so "2 row(s) present" becomes "the two that landed
  were Chapter and Person" — which is the difference between *Season is late* and
  *Season is absent*, indistinguishable until now.
- **Identity is read by named field**, never by dumping the node: `JellyfinUser`
  carries `authToken`, and a whole-node read would put a live demo credential in an
  artifact.
- **A new TIMEOUT throws via `diagnosedError`**, not a bare `new Error` — otherwise
  that failure mode is the one nobody can attribute. This is **gated**, not just
  documented: an ESLint `no-restricted-syntax` rule in
  [`eslint.config.js`](../../eslint.config.js) fails `lint:js` (pre-push *and* CI,
  and it underlines live in your editor) on a bare `throw new …` in `lib/nav.js`,
  `lib/steps.js` or anywhere under `demos/`. A fail-fast that is *not* a timeout and
  already names its cause can stay a plain throw — disable the rule on that line
  **with a reason**, as the ambiguous-library refusal in `nav.js` does.
  - It matches any `new` in a `throw`, not just `Error`: `throw new TypeError(…)` in
    a wait has the same problem, and a gate that reads as covering throws generally
    should not have a hole in it. It is still only a **tripwire** — `const e = new
    Error(…); throw e` slips it — so a green `lint:js` means "nobody wrote the
    obvious shape", not "no unattributable timeout exists".
  - The gate covers `lib/nav.js`, `lib/steps.js` and **all of `demos/`**. The other
    lib modules throw fail-fasts that already name their cause (a snapshot from the
    wrong device, a seed that did not take), so gating them would buy four disable
    comments and no signal. **A new lib file that grows a wait belongs in that
    glob** — adding it is one reviewable line.
  - `demos/` is in the glob on evidence, not symmetry: while it was outside, it
    accumulated two unconverted waits — the runner's own playback timeout and a
    take's 15 s dialog poll. It is also the directory that grows by adding
    choreography, which is where new waits come from. Its handful of genuine
    fail-fasts (an unknown server name, the non-demo-host refusal, a REST lookup
    that came back empty) carry one-line disables with reasons.
  - **In a take, prefer `ctx.waitFor` to a hand-rolled poll.** It already throws
    through `diagnosedError`, so a take inherits the dump rather than re-deriving
    it — and a take that rolls its own loop is exactly how both of the misses above
    happened.
  - Specs are outside the glob, because most spec-level throws are assertions rather
    than timeouts. A spec that genuinely *polls until it gives up* should still use
    `diagnosedError` — or better, one of the shared waits, which already do:
    `waitMediaPlaying` lives in `lib/steps.js` and is shared by `deeplink.spec.js`
    and the demo runner, because "media player never started" cannot otherwise
    distinguish a stream that failed to open from a cast the app never routed.
- **Register the `kind` first.** It is the key a flake baseline aggregates by, so it
  comes from the frozen `FAILURE_KINDS` set in `diagnostics.js`, never an inline
  string. An unregistered slug is recorded as-is and called out in the run summary
  (`⚠ N unregistered failure kind(s)`) rather than silently forking a bucket.

Each failure also lands as a JSON line in the run's `failures.jsonl`, which
[`endRun`](../../scripts/run-record.js) folds into `run-meta.json` after the suite
exits, then summarizes:

```text
[rta] 2 failure(s) captured with device state in this run → out/rta/failures.jsonl
[rta]   00:55 probe B: forced timeout on ItemDetails — wait-for-timeout; view=ItemDetails focus=ResumeButton
[rta]   00:56 probe C: forced timeout on a library grid — wait-for-timeout; view=BaseGridView loadState=loaded focus=JRMarkupGrid
```

That fold is what finally gives `run-meta.json` a **reader** — it was written by
four entry points and read by nothing, so lock provenance only ever lived in a
terminal line that scrolls past. The parent stays the file's sole writer; the child appends to the
JSONL and never touches run-meta.json.

### One record directory per run kind

`writeRunMeta` is a full overwrite, and every entry point used to share
`out/rta/run-meta.json`. Harmless while the file held only lock provenance —
destructive once it carries folded failure records, because a `npm run test:unit`
between two RTA runs silently ate the first one's. So the record directory is keyed
on the run kind ([`runDir`](../../scripts/run-record.js)):

| Run | Records to | Summary tag |
|---|---|---|
| `npm run test:rta` (+ `:tdd`, `:fast`, `:capture`) | `out/rta/` | `[rta]` |
| `npm run screenshots:capture` | `out/screenshots/` | `[screenshots]` |
| `npm run demo` | `out/demo/` | `[demo]` |
| `npm run test:unit` / `test:integration` / `test:all` (Rooibos) | `out/device/` | `[device]` |
| `npm run measure` (on-device perf sample) | `out/measure/` | `[measure]` |

The tag on each summary line names the **run kind**, derived from that same
directory so there is no second mapping to drift. A Rooibos run prints `[device]`,
not `[rta]` — this record is shared with that runner, and a line claiming the wrong
harness is the same dishonesty the directory split removed.

Three files per run kind. They overlap deliberately — pick by the question you are
asking, not by which one you found first:

| File | Where | Lifetime | Read it when you want… |
|---|---|---|---|
| `run-meta.json` | `out/<kind>/` | this run, **overwritten** | the whole of ONE run in one place — lock provenance, window, and the folded failures |
| `failures.jsonl` | `out/<kind>/` | this run, **truncated at start** | to stream failures as they land, mid-run, before the fold |
| `runs.jsonl` | **`.device-runs/<kind>/`** | **the ledger — never reset** | to aggregate ACROSS runs (this is the one a flake baseline reads) |

One run kind adds a fourth. `npm run measure` appends
`.device-runs/measure/measurements.jsonl` — **one line per SERIES**, carrying the
samples, the workload, and the provenance the sample was taken against. It uses
[`ledgerPath()`](../../scripts/run-record.js) rather than the `dir` `beginRun` hands
back, for the reason the ledger itself is not under `out/`: a series can cost an
hour of exclusive device time and the next `npm run build` would `rimraf` it.

It is **not** a second run ledger, and the two files are deliberately not joinable:

- `runs.jsonl` is a side effect of using `beginRun` for its lifecycle (lock
  provenance, the process-exit net, the outcome). Nothing reads it for `measure`,
  and a flake rate over measurement invocations would not mean anything.
- `measurements.jsonl` is the aggregation surface, and it carries the selection keys
  (`variant`, `commit`, `dirty`, `deviceKey`, `startedAt`) *itself* so a comparison
  never has to join on a timestamp.
- **Their cardinality differs by design.** A run refused by tier 1 writes a
  `runs.jsonl` line with `outcome: "blocked"` and no measurement record at all — a
  refused run is not a measurement. Each measurement line therefore carries its own
  `outcome`, so a reader can tell a usable series from one that produced no sample
  without consulting the other file.
- **One exception, and it is not a refusal.** A `--nav` that fails PARTWAY abandons the
  series but does write a record, carrying the launches the device had already taken and
  a `navFailure` naming why the rest never happened. Those samples are real loads of a
  real device and the only thing that made them unusable was a LATER failure; the series
  still folds as `outcome: "blocked"` and no comparison selects it, so the choice is
  between `3/30 cold samples` on disk and nothing on disk. A nav that fails on the FIRST
  launch has nothing to keep and refuses exactly as tier 1 does.
- **`npm run measure:devices` writes one line PER DEVICE**, all from the same invocation
  — it runs `measure` once per Roku in `ROKU_DEVICES`, sequentially, in its own process
  (`roku-test-automation` binds its client singletons to one host per process). See
  [`home-first-paint-performance.md`](home-first-paint-performance.md#more-than-one-device).

**The ledger is the Phase-3 surface.** Aggregating N back-to-back suites is a read
of `.device-runs/rta/runs.jsonl`, not "remember to copy a file aside after each
run" — each line is a complete `summarizeRun` including that run's failure records.

**Scope a baseline by FILTERING, not by deleting.** Every line carries four keys
for exactly that, and all four are always present (`null` when unknown) so a
filter can never silently drop a row:

| Key | Is | Why a baseline needs it |
|---|---|---|
| `variant` | the npm script that ran (`test:rta`, `test:rta:fast`, `test:unit`, …) | run kinds are SHARED — `:fast` skips the deploy, `:capture` adds per-screen PNG work, and `test:unit`/`test:all` are different suites. Pooling their durations compares incomparable runs |
| `commit` | short SHA at the start of the run | "are these N runs even the same code?" |
| `dirty` | working tree not clean at that SHA (untracked files included — they get compiled in) | during RTA work the tree is usually dirty, and a bare SHA would over-claim reproducibility |
| `deviceKey` | **which Roku** — the lock's own `sha256(device-id)`, not an address | there are three on this LAN and they are not interchangeable. A baseline is specified on one device, so `variant` and `commit` are IDENTICAL across its runs and cannot separate a stray run on another one. `null` on the degraded lock path, which never resolves a device |
| `outcome` | `passed` / `failed` / `interrupted` / `crashed` / `blocked` — what became of the run | the other four describe the INVOCATION; this is the only one about the run itself. See below — without it, a run that never executed a test is indistinguishable from a perfect one, and a run the fixture broke is indistinguishable from app flake |

Plus one field that is **provenance, not a filter key**:

| Key | Is | Why it is recorded |
|---|---|---|
| `assertions` | `{ <screen>: <count> }` — how many things each content assertion actually CHECKED. Omitted when nothing recorded one | a content assertion's strength is invisible from its result. `moviesLibraryGenres` verifies a subset relation over whatever the fixture holds, so it can check forty pairings or four and go green either way — and the day it can check zero it goes red, having weakened silently for months first. Never asserted on: a floor would redden runs over fixture churn, which is the false-red this is all here to remove. Watch the number across a series the way you would watch `durationMs` |

### Reading a baseline out of it

**`npm run flake-baseline`** — that is the whole recipe, and it is deliberately not a
snippet to retype. Run it bare to see what the ledger holds, then name a series:

```console
$ npm run flake-baseline
.device-runs/rta/runs.jsonl — 10 line(s)

  variant     test:rta ×8   test:rta:fast ×2
  device      (unrecorded) ×4   ac4701ca4a5d8a0b ×4   1f9118827848036c ×2
  commit      27279e75 ×3   f45eebd7 ×2   ad1908cb ×2   …
  outcome     (unrecorded) ×6   crashed ×2   passed ×1   failed ×1
  tree        dirty ×9   clean ×1
  hour        inside one hour ×10

$ npm run flake-baseline -- --commit HEAD --device ac4701ca4a5d8a0b
  samples     6   (6 passed, 0 failed)
  excluded    4   2 dirty tree · 1 other device · 1 not a sample (1 crashed)

  flake rate  0/6 = 0.0%   95% upper bound 39.3%
  ⚠ 4 of 6 samples crossed the top of the hour.
  The demo server resets then, so those ran against a fixture that changed underneath
  them. NOT excluded — whether it matters is the proportion, …
  A clean series BOUNDS the rate, it does not measure 0% — …
```

`--run run-roku-tests` reads the Rooibos ledger instead; `--variant a,b` overrides the
variant set (defaulted only for the RTA ledger — see below).

**Why a command and not four lines of `runs.filter(...)` you can read here.** Because
that is what this was, and it was wrong three times in one PR cycle — each time
producing a plausible number rather than an error. It filtered
`variant === 'test:rta'` while the protocol says to use `test:rta:fast` from run 2, so
it selected the first run of a six-run series and reported a one-sample baseline. It
counted `outcome !== 'passed'` as a failure while the run summary told the operator to
*exclude* a crashed run. And after the copy here was fixed, the copy in the project
plan still carried the second bug. None of those were defects in the ledger; they were
defects in a recipe a human retypes. What is left below is the part that genuinely
needs a human reader — *why* the filter is shaped this way.

**The hour row is a WARNING, not a filter.** It is the one property that invalidates a
series without changing any single run in it: a ~13-minute suite starting after roughly
`:46` has the demo server's reset land mid-run, so those samples ran against a fixture
that changed underneath them. It is not excluded, for two reasons — whether it matters
is the *proportion* (1 of 8 is noise, 5 of 8 is measuring the fixture, and only a human
can make that call), and dropping them silently would shrink the population and widen
the bound without saying why. An **absent** flag is counted separately rather than read
as "did not cross": `summarizeRun` writes it on every close, so a missing one means a
hand-edited or truncated line, and treating unknown as the good case is the move this
whole field exists to prevent.

**The rate reads `outcome`, never `failures.length`** — see the three-way conflation
below.

**The outcomes are not peers; they partition into samples and non-samples.**
A `passed` or `failed` run reached a verdict, so it is evidence: in the population,
and in the numerator respectively. A `crashed`, `interrupted` or `blocked` run never
reached one — a deploy that 401'd, an operator's Ctrl-C, a fixture server that
stopped answering — so it is not evidence about the app in either direction. Counting
it red inflates the rate; counting it green hides a real failure; the only correct
move is to drop it from the population. `SAMPLE_OUTCOMES` in
[`run-record.js`](../../scripts/run-record.js) is that set, shared by the selector and
by the run summary's own operator advice so the two cannot drift — they did not agree
on first cut.

**`blocked` is the one to understand, because it is the only non-sample that looks
exactly like a sample.** The other two are obvious from outside: no suite ran, or a
human stopped it. A blocked run ran its suite, failed tests, and exited non-zero —
nothing about it reads as unusual. What separates it is that a request to the demo
server failed underneath it, so whatever went red afterwards was never a fair test of
the app. `tests/rta/lib/jellyfin.js` records that failure at the throw site and
`rta-run.js` reads it back, because by the time it surfaces the cause is gone: a 401
inside a helper arrives as an ordinary assertion failure several frames away.

It outranks `failed` when a run has both, deliberately — a broken dependency is a
plausible cause of whatever else went red in the same run. On 2026-08-12 two runs went
red on a content assertion whose real cause was a session evicted 66 seconds in; both
would have entered a baseline as app flake. **A `blocked` run in your series is not
noise to ignore — it means the fixture failed you, and the run needs re-taking.**

**Do not `git pull` while a series is running.** `commit` is stamped per run, at its
open, so a pull mid-series silently splits one series into two populations and
`--commit HEAD` then selects only the runs taken after it. This is the ledger working
as designed — it is exactly the miscount the key exists to prevent — but it is silent
in the sense that both halves look like complete series. It happened on 2026-08-12:
two CI journal commits landed between run 1 and run 2, and the two runs are keyed to
different commits despite testing an identical binary (`test:rta:fast` rebuilds
nothing). Take the series on a checkout you are not also updating.

**A dirty tree is excluded, so commit before the series.** `dirty: true` records that
the tree was modified but carries no content hash, so two dirty runs are not provably
the same code — which is the one thing `commit` is in the filter to establish. This is
why a series is taken on a merged, clean checkout, and why the tool reports
`N dirty tree` as an exclusion rather than quietly returning fewer runs.

**Both variants, not `test:rta` alone.** The protocol is one `test:rta` followed by
`test:rta:fast` for runs 2..N, precisely so the whole series measures ONE binary
instead of N rebuilds of it. Those runs land as `variant: 'test:rta:fast'`. The tool
defaults to both for the RTA ledger and to *no* variant filter for any other, because
the Rooibos ledger's variants (`test:unit` / `test:integration` / `test:all`) are
different SUITES rather than one suite deployed two ways. Keep the two apart when
comparing **durations** — that is what the `variant` row above is about, and `:fast`
is ~30 s shorter by construction.

**A clean series does not measure a 0% flake rate**, which is why the tool prints a
bound beside the estimate rather than the estimate alone. Six clean runs bound the
per-run probability at 39%, ten at 26%, thirty at 10% — so no affordable N proves
"fixed", and the honest report is *"consistent with fixed, upper bound X%"*. A single
red run, by contrast, is immediately informative — that asymmetry is what sizes the
series (below).

**`failures: []` is not an outcome.** The failure records come from the five RTA
throw sites that capture device state; an empty list means *those* did not fire, and
that is true of three different runs:

1. the suite ran and passed;
2. the suite ran and went red somewhere the diagnostics do not cover — a plain
   `expect()` (there are 11 in `tests/rta/specs/`) or an error raised by Vitest itself;
3. the suite **never ran at all** — the entry point died first.

(3) is not hypothetical. `ROKU_IP=192.168.1.200 npm run test:rta` on 2026-08-12 threw
out of `deployRtaBuild()` on a 401 and appended `durationMs: 621, failures: []`, on a
clean tree — the *first* line ever to satisfy all four filter keys above, from a run
where nothing executed. `outcome` is what separates them: the entry points set it from
their exit, and the process-exit net labels a run nobody closed `crashed`. A
non-`passed` run now also prints a line, because a run with no failures printed
nothing at all, which is how that one reached the ledger unnoticed. The file is still append-only and
nothing prunes it — `rm .device-runs/<kind>/runs.jsonl` throws the history away if you
want that, but it is no longer the way you get a trustworthy number. (Size is a
non-issue: a clean line is ~200 bytes, and one carrying 30 failure records with full
device state is ~25 KB.)

### Where a baseline runs: your device for the series, the CI device for a cross-check

There are two Roku devices in play for any contributor, and they are not interchangeable:

| | Reached via | You can deploy to it? |
|---|---|---|
| **your device** | `ROKU_IP` / `ROKU_PASSWORD` in your gitignored `.env` | yes — this is the one every `npm run` script drives |
| **the CI device** | `secrets.ROKU_DEVICE_IP` / `secrets.ROKU_DEVICE_PASSWORD`, org-level secrets | **no** — see below |

**Run the baseline series on YOUR device.** Cross-check on the CI device by dispatching
[`rta-functional-tests.yml`](../../.github/workflows/rta-functional-tests.yml), which
uploads the ledger as an artifact. Two independent reasons it is not the other way round:

- **You cannot deploy to the CI device.** `ROKU_PASSWORD` in `.env` is *your* device's
  dev server password. Overriding `ROKU_IP` alone is not enough — the CI device's
  password is an org secret, so the deploy fails with a `401 Unauthorized` from
  `roku-deploy`, *after* the lock has been taken.
- **Even with the password it would be the wrong move.** `acquireDeviceLock` has no wait
  budget, and CI's device jobs only READ the lock (they run with no write token) — so
  while a workstation holds the CI device's lock, those jobs **fail rather than queue**.
  A multi-hour series would red every PR's device check for its whole duration.

The same arithmetic rules out running the series *inside* CI. A suite measures ~13 min
against `timeout-minutes: 25`, so exactly one fits per job; a loop would need the timeout
at ~4.5 h, and a single self-hosted runner carries the `roku-device` label and takes one
job at a time — so that is a hard block on all device CI for the duration, the same
objection relocated. (A multi-run job would produce N ledger lines, not one: `runs.jsonl`
is append-only and lives outside `out/` for exactly that reason. The timeout is the wall,
not the record.)

**So: N=6–8 on your device, and ~3 dispatches on the CI device.** The CI arm answers only
*"is device identity a factor at all"* — it is not a second baseline. The ledger stores
a device as a hash and never an address, so `deviceKey` has to be looked up rather than
guessed: `npm run device:status` prints `device <ip> — ledger key <D>` for the device
you can reach, and bare `npm run flake-baseline` lists every key that actually has runs
— which is the one that works for the CI arm, whose device you cannot reach at all.

**The decision rule matters more than the counts, because the obvious reading of a single
red is wrong.** With 8 runs on one device and 3 on the other, if exactly one run in the 11
is red, then under the null that both devices behave identically that red lands in the
3-run group **3/11 ≈ 27%** of the time. So "1 of 3" has a better-than-one-in-four
false-alarm rate *by construction*, and treating it as a signal is how a cross-check meant
to stop early instead burns the most device time:

| CI-device result | Read it as |
|---|---|
| 0/3 | agreement — stop; device identity is not a factor |
| 1/3 | **not separable.** Extend that arm to 6 before concluding anything |
| 2+/3 | a real difference — chase it |

**Why the ledger is not under `out/` with the others.** `out/` is the build output
directory, and all eight `build*` npm scripts begin with `npx rimraf build/ out/`.
`npm run test:rta` builds first — so a ledger under `out/` was deleted immediately
before each run that was meant to append to it, and an N-run baseline would have
ended with exactly one line, silently. The per-run files are safe there because
`beginRun` truncates them anyway; a file whose contract is *never reset* is not.
[`run-record.test.js`](../../tests/scripts/unit/run-record.test.js) gates both
halves — that the ledger is outside `out/`, and that the build scripts really do
wipe it — so this cannot quietly come back.

The two entry points that are not Vitest get a label Vitest would otherwise supply:
`capture-screenshots` tags each record with its screen, locale and **retry attempt**,
so a screen that recovered on attempt 2 is not mistaken for a failure; `demos` tags
each with its take name.

#### A run always closes, including when you Ctrl-C it

`beginRun` returns a handle whose `close()` folds the run — it carries the lock, the
run kind, the origin and the watch-mode flag, so no entry point restates them and
none can restate them wrongly. `beginRun` also arms a `process.on('exit')` net that
closes any run whose entry point never got to.

That net is not belt-and-braces. Three of the four entry points hand their exit to a
signal handler ending in `process.exit()` — `armRestoreOnInterrupt`'s among them —
so a hand-rolled fold in the happy path alone would skip exactly the interrupt a
~15-minute matrix run is most likely to end with. It is legal because `endRun` is
all-synchronous. `close()` stays explicit where output ORDER matters: `rta-run`
folds before the registry restore, so the summary survives a restore that throws.
The net is gated by a subprocess test in
[`run-record.test.js`](../../tests/scripts/unit/run-record.test.js) — in-process it
cannot be exercised at all, since emitting `exit` by hand proves only that the
listener is attached.

**Know where the record STOPS.** That same ordering is a boundary: `rta-run` folds
before it restores, so **a failed registry restore is not in the run record or the
ledger**. A run that left the device dirty appears in `runs.jsonl` as an ordinary
run — clean, zero failures — and the signal that it stranded the device is the
snapshot file it left behind (which `npm run device:status` reports), not the
record. That matters for a Phase-3 baseline specifically: a restore that does not
converge wedges every *subsequent* run — `snapshotRegistry()` restores from the kept
file before taking its own — so the runs whose numbers it corrupts are the ones that
look most normal in the ledger. The `authToken` re-mint that used to cause this is
fixed ([`restore-compares-credentials-by-presence`](../decisions.md)), but any
residual the loop cannot converge has the same shape. Check `device:status` between runs of a series; do not
infer a clean device from a clean ledger line.

One bounded caveat: writes to stdout from an `exit` handler are synchronous on Linux
for TTYs, files and pipes, but **asynchronous for pipes on macOS** — so a macOS
contributor piping an interrupted run's output can lose the printed summary. Every
durable record is an `fs` write and is unaffected; re-read `run-meta.json`.

### The run's wall-clock window is part of the evidence

The summary also reports the window, and flags a run that **crossed the top of the
hour**. The demo server resets on the hour, which changes both its own content
(playlists have come and gone) and anything a run marked watched through the app —
so a ~13-minute suite (measured at 13.6 min on `.177`) starting after roughly `:46`
can have that change land *mid-run* and fail as an unrelated-looking nav timeout.
Individual failures carry `afterHourBoundary`, so a record says whether it landed on
the far side of a reset. A green run that straddled `:00` is flagged too: its result
was taken against a fixture that changed underneath it.

The flag is **suppressed in watch mode** (`npm run test:rta:tdd`), where the record
opens once at session start and folds once at exit: that window spans every
iteration, so any session over an hour would trip it and a flag that always fires is
one nobody reads. The summary says "this watch session" there.

**The per-failure stamp is suppressed there too**, for the same reason and not only
at the run level. The origin a failure is measured against is the *session's*, so
past the first hour of a watch session every failure would carry
`afterHourBoundary` — the identical always-fires noise. In a cumulative window the
field is therefore **absent, not `false`**: the reset may well have happened, so
`false` would be a claim the record cannot support, exactly as it is when no origin
was stamped at all. The origin itself is still recorded either way. `beginRun`
stamps `cumulative` into the record at *open* time so the Vitest child can see it
mid-run — the closed summary's copy arrives too late to be of use to the process
actually writing the failures.

## Driving intermediate load stages (`rtaSkeletonHoldMs`)

The Genres view has an interactive **skeleton stage** (structure drawn, samples pending)
that lasts only a few hundred ms against the demo server — too narrow to exercise
reliably. RTA builds compile in one test hook: an `rtaSkeletonHoldMs` field on `m.global`
(added under `#if ENABLE_RTA` in `setGlobalNodes()`; the field does not exist in dev or
prod builds). `LoadItemsTask2` holds the skeleton stage open that long, mimicking a slow
server on the task thread. A spec sets it after relaunch, before navigating:

```js
await odc.setValue({ base: 'global', keyPath: 'rtaSkeletonHoldMs', value: 5000 });
await openLibraryByType('movies', moviesId); // navLibraryByType minus the loaded-wait
```

App-memory only — the next relaunch resets it, so no restore step. The consumer is
`specs/genre-skeleton.spec.js`, which asserts the skeleton window's contracts (select is
a no-op, scroll survives the fill, backdrop lands on the focused item). `openLibraryByType`
is the press-into-the-library half of `navLibraryByType` for exactly this kind of spec —
everything else should keep using `navLibraryByType`, which settles.

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

The new screen is automatically a functional test (the spec loops over `SCREENS`) and, if
`capture.eligible`, a captured screenshot.

A screen that declares a `view` is **content-dependent**: if the server has no library of
that `collectionType`, the test skips itself at runtime with a printed reason rather than
failing. The demo server's content is not a fixed contract — it resets and its libraries
come and go — so a missing library says something about the fixture, not about the app.
This is why the spec is a plain `for` loop instead of `it.each`: `it.each` passes only the
case object, with no Vitest `TestContext`, so a case has no way to skip itself once
`beforeAll` has learned what the server actually holds.

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

## Load windows, and testing on a second device

A nav that presses a key immediately after triggering playback spends seconds pressing
into a component designed to ignore input until it is ready. Measured on 2026-08-08, the
press→playable window is **~5-7 s on every device tested** (Stick `3600X` 5.6/5.8 s,
Ultra `4850X` 7.2 s) — it tracks stream start against the remote demo server, not device
speed. So this is not a slow-device quirk to paper over with a longer timeout; it is a
precondition every nav must respect. See the rule in
[`tests/rta/CLAUDE.md`](../../tests/rta/CLAUDE.md).

Two habits that came out of the same investigation:

- **When a failure is device-specific, power-cycle first and re-run.** Device state is
  transient and does drift: on the `3600X` the same suite passed 58 s and 157 s after a power cycle,
  failed at 240 s, and later recovered on its own. Establishing whether the failure even
  reproduces right now costs five minutes and saves chasing a defect that isn't there.
- **Run against the slowest supported device before a release, not only the fast one.**
  In a single afternoon the stick surfaced a rendering bug (#777), a render-thread cost
  regression, and this harness gap. A device with headroom hides all three.

## Leaving the device as you found it

Every RTA entry point drives a device someone actually uses, so the run owns the
device's registry for its duration and is responsible for handing it back.
[`scripts/rta-run.js`](../../scripts/rta-run.js) is that owner — it deploys, snapshots,
runs Vitest **as a child process**, and restores. `npm run test:rta` (and `:fast` /
`:capture` / `:tdd`) all go through it.

- **The snapshot covers the whole registry**, every section and key — not a list of keys.
  A list only ever covers what the *seeds* write, never what the *app* writes while
  running under a seeded session, and never a whole section the seeds create.
- **The restore is a diff, and it is verified.** Keys the run added are deleted,
  sections the run created are dropped, changed values are put back — then the channel
  is cold-restarted and the entire registry is compared against the snapshot. A
  mismatch retries, then **throws** and names the differing keys.
- **Two keys are compared on PRESENCE, not value** — `authToken` and
  `primaryImageTag`, the credentials the app mints for itself. (`LastRunVersion` is
  ignored outright; the app rewrites it about itself.) This is not a softening for
  convenience: the verify step is a cold boot, `resolveUser()` re-authenticates when
  the stored token has been rejected, and the app then persists a NEW one — so
  byte-comparing them meant the restore could never converge, and the snapshot it
  kept on failure wedged every later run. Presence still fails in both directions:

  | Snapshot | Device after restore | Verdict |
  |---|---|---|
  | has a token | has a *different* token | ✅ the app re-minted its own |
  | has a token | has none | ❌ the session was destroyed |
  | has none | has one | ❌ a credential was left behind |

  The restore still WRITES the user's own value back — the exemption is on the
  compare only. Full rationale and the ruled-out alternatives:
  [`restore-compares-credentials-by-presence`](../decisions.md).
- **The snapshot is written to `.device-runs/registry-<host>.json` before any seeding**,
  and deleted only on a verified restore. So a file still sitting there means the last
  run did not put the device back.
  - `npm run rta:restore` reapplies it on demand.
  - The next run repairs the device automatically — it restores from the leftover file
    *before* taking its own snapshot, so a stranded run can't become the new baseline.
  - **It is outside `out/` for the same reason the run ledger is**, and this one was a
    live bug rather than a precaution: while it lived in `out/rta/`, the sequence
    "abandon a run → re-run `npm run test:rta`" deleted the snapshot *before* the
    repair above could use it, because `test:rta` builds first and every `build*`
    opens with `npx rimraf build/ out/`. The run then captured the demo-server state
    as the user's session and restored that from then on — exactly the compounding
    failure the repair exists to prevent. `demo`, `test:rta:fast`, `test:rta:tdd` and
    `rta:restore` never build, which is why it stayed invisible.
  - Unlike the run-record directory, the snapshot path is deliberately **shared**
    across entry points: a device stranded by `npm run demo` has to be repairable by
    the next `npm run test:rta`, and `rta:restore` finds it with no arguments. The
    record wants per-run isolation; the snapshot wants cross-run reach.
  - **It is your real registry, so treat it as a secret at rest.** The file is the
    *whole* registry of the device it was taken from — including `authToken` for
    whatever server you were signed into. It is gitignored, and nothing here ever
    prints its contents (only its path). But note the consequence of the move: it
    used to be wiped incidentally by the next `npm run build`, and now **nothing
    removes it but a verified restore or `npm run rta:restore`**. That matters
    because the case that strands it is a restore that never converged
    ([`restore-compares-credentials-by-presence`](../decisions.md) is the one that
    used to), so a token-bearing file can sit there indefinitely. If a restore has
    failed and you are done with the device, run `rta:restore`. If it *still* cannot
    converge, `npm run rta:restore -- --accept` prints the differences it could not
    restore and clears the snapshot anyway — use it rather than `rm`, which deletes
    the device's only backup and tells you nothing about what was left wrong.
    `--accept` does not claim the device is clean: it writes what you accepted to
    `.device-runs/accepted-<host>.json` (redacted) and `npm run device:status` keeps
    reporting it until you delete that file. Clearing the snapshot is what stops the
    residual wedging later runs; the record is what stops the device going quietly
    back to looking clean.
  - **`npm run device:status` tells you one is sitting there.** It reports every
    stranded snapshot with the host it belongs to and when it was taken, alongside
    the lock line — "free" and "left dirty" are both true at once, and the second is
    the one that costs you the next run. It globs the directory rather than checking
    the host `ROKU_IP` names, because the case that bites is a snapshot for a device
    you are *not* currently pointed at (stranded by `npm run demo` on one Roku, then
    a run against another). Before this the file had no operator-facing surface at
    all, which is how one got destroyed by an `rm -rf` aimed at the ledger beside it.
    It reports accepted differences on the same terms, and that line matters more,
    not less: accepting is what *cleared* the snapshot, so it is the one dirty state
    no later run can rediscover on its own. Deleting `accepted-<host>.json` is how you
    acknowledge it — safe, unlike deleting a snapshot, because the record is redacted
    evidence rather than the recovery path.
- **Ctrl-C is safe.** The interrupt stops the child, and the parent restores before
  exiting (~30 s; press Ctrl-C again to abandon and recover later with
  `npm run rta:restore`). This is why the lifecycle cannot live in Vitest: `afterAll`
  never runs on a killed process, and Vitest's own SIGINT handler exits the process on
  a 1 ms timer, so nothing armed inside it can finish a ~30 s restore.
- **Don't run `vitest --config vitest.rta.config.js` directly** — `globalSetup` refuses
  it, because that path takes no snapshot and performs no restore.

### The second owner: `measure:devices --sign-in`

`rta-run.js` is no longer the only entry point that owns a device's registry.
**`npm run measure:devices -- --sign-in <url> --user <name>`** signs every device in
`ROKU_DEVICES` into one server, measures it, and puts it back — because the matrix has
always *asserted* that its devices share a server (the server is the workload) and could
not *establish* it, which meant signing every device in by hand before every run.

The split of responsibility is the part worth knowing:

- **Single-device `npm run measure` still never writes the registry**, and that invariant
  is load-bearing — it is what lets a lone series measure the app exactly as the device
  already has it. The seed lives on the DRIVER, in
  [`scripts/measure-signin.js`](../../scripts/measure-signin.js), one child process per
  device (`roku-test-automation` binds its client singletons to one host per process).
- **It reuses this same lifecycle rather than a parallel one**: `snapshotRegistry()` from
  [`lib/registry.js`](../../tests/rta/lib/registry.js) before any write, `seedHome` from
  [`lib/seed.js`](../../tests/rta/lib/seed.js), and `npm run rta:restore` afterwards —
  so every guarantee above applies unchanged, including `VERIFIED CLEAN`.
- **`--sign-in <url>` implies `--server <url>`.** The seed is checked rather than trusted:
  tier 1 still hard-asserts the server on every device, so a seed that silently did not
  take fails before a sample is written. Passing `--server` (or `--no-server`) alongside
  it is refused rather than merged — `measure` would take the last one, which would settle
  a disagreement between the seed and the assert silently. **Repeating any sign-in flag is
  refused for the same reason** (`--sign-in A --sign-in B` would seed and assert `B`
  without a word).
- **The sign-in step takes the device lock**, exactly as `measure` does for the series. It
  is the only part of a matrix run that writes the registry, so it is the part where a
  concurrent run's `snapshotRegistry()` would adopt *our seed* as that user's state and
  then restore it faithfully forever. The restore afterwards deliberately does **not** take
  the lock: `rta:restore` is the documented repair for a device stranded by a dead run, and
  a repair tool blocked by that run's leftover lock fails exactly when you need it.
- **`hardRelaunch()` runs before the first registry read**, and that ordering is not
  stylistic: the on-device component lives INSIDE the app, so an ODC read against a device
  that is not running it HANGS rather than failing, and presents like a network problem.
  RTA *does* time out its requests, but `sendRequest` awaits `setupClientSocket()` first
  and that promise only self-rejects on `ECONNREFUSED`/`EPIPE` — so a connect that neither
  connects nor errors never settles, and passing a `timeout` to `readRegistry` would not
  help. The sign-in therefore carries its own **3-minute wall clock** against a ~40–50 s
  healthy run. `hardRelaunch()` covers the common cause; the timeout covers the other one —
  a resident build with no ODC (a Rooibos test build, a `build:prod`), which `--deploy`
  does **not** rescue because that deploy happens inside `measure`, after the seed.
- **The restore runs whatever happened** — sign-in failure, measurement failure, or an
  interrupt. The driver installs handlers for `SIGINT`/`SIGTERM`/`SIGHUP` for that reason:
  the default handling would terminate it in the window between "seeded" and "restored".
  The rules are a pure function (`signalPolicy` in
  [`measure-matrix.js`](../../scripts/measure-matrix.js)) rather than inline in the driver,
  because the first cut of them was dead code — recorded in a flag a synchronous
  `spawnSync` loop never let a handler set — and there was nowhere to pin it. The driver
  awaits its children asynchronously now, like `rta-run.js` does.
  - the **first** signal stops the run and kills the child so a bare `kill` means what
    Ctrl-C means — **except when the restore is running**, which is the child the whole
    mechanism exists to buy time for, so that one is left to finish;
  - a **second** signal abandons it and names the device at risk
    (`ROKU_IP=<the actual host> npm run rta:restore`); the snapshot on disk is the repair.
- **A restore that did not verify fails the whole run** and prints the repair command on
  its own line, even when every measurement succeeded. A summary reporting three measured
  devices while one is still signed into the matrix's server would be true and useless.
- **Every device is seeded in `RTA_CONFIG.languages[0]` (`en_US`)**, and that is a pin
  rather than an oversight: a matrix compares hardware, so a row measured in `fr` beside
  one in `en_US` differs in workload as well as in silicon. The cost is that a seeded
  series and a plain `npm run measure` series on one device need not have run in the same
  language, and `measurements.jsonl` carries no locale field to say so — the driver and the
  sign-in both print it, and carrying it in the record is an open followup.

Use `MEASURE_SIGNIN_PASSWORD` in `.env` rather than a `--password` flag for an account
that has one; blank is the common case on a LAN test server.

## The device lock

There are three Roku devices on this LAN, and **CI does not share one with a developer**
— measured by an ECP sweep on 2026-08-10, not assumed:

| Device | Model | Used by |
|---|---|---|
| `.177` | Streaming Stick 4K | local development (`.env` `ROKU_IP`) |
| `.178` | Ultra | a personal device; occasional dev overflow |
| `.200` | Streaming Stick 4K | **CI only** — the org-level `ROKU_DEVICE_IP` secret, read by both device workflows and by RTA |

So the contention [`scripts/device-lock.js`](../../scripts/device-lock.js) closes
is **local-vs-local**: `test:rta`, `test:unit`, `demo` and `screenshots:capture`
can each grab the same device from a different terminal, and the Rooibos path has
no registry snapshot to fall back on. Because the lock keys on the device's own
identity rather than on a role, it also covers a local run pointed at CI's `.200`
— the only way local and CI can contend at all.

- **The lock is a git ref** — `refs/device-lock/<key>`, held in this repo, where
  `POST /git/refs` returns 422 on conflict. That is a real compare-and-swap, with
  no new infrastructure and no daemon to keep alive (verified against this repo:
  201, then 422, then 204 on delete). Holder identity and the lease clock come
  from a tag object the ref points at.
- **The key is a hash of the device's identity, not its address and not the raw
  id.** The ref name is world-readable on a public repo via `git ls-remote`, and a
  Roku's ECP `device-id` partially encodes its serial — so the key is
  `sha256(device-id)` truncated to 16 hex chars. Keying on the *address* would be
  worse than useless: a DHCP lease change would make each side compute a different
  ref, each would read "no lock", and both would run. A run that can't identify
  the device over ECP degrades loudly rather than inventing an address-shaped key.
- **There is no CI-yield check, deliberately.** An earlier revision polled the
  Actions API and refused to start while any device workflow was in flight. Its
  real behavior was "you may not use `.177` because CI is busy on `.200`" —
  blocking you from your own hardware to protect a device nobody was touching. It
  is gone, along with the hardcoded workflow-filename list it needed.
- **A contended run fails immediately and names the holder.** No queuing: you
  want the answer now, and another Roku on the LAN is usually free
  (`ROKU_IP=<other-ip> npm run test:rta`).
- **Reads are eventually consistent — writes are not.** Measured 2026-08-10: a
  read of an aged ref came back stale 2/24 times, while the CAS returned 422
  reliably every time. So a 422 followed by a read saying "free" means the *read*
  is wrong. Never infer that the device is free from a read.
- **The holder record names the run, not you** — `what`, a `pid`, and `local`/`ci`.
  No hostname: the tag object is public for as long as the lock is held.
- **A crashed holder's lease expires after 15 minutes.** It is a lease, not a
  time limit — every holder heartbeats every 5 minutes, so a long
  `screenshots:capture` renews and never self-expires.
  `npm run device:status` names the holder; `npm run device:release` drops a stuck
  one.
- **`rta-restore.js` deliberately takes no lock.** It is the repair path for an
  abandoned run, and requiring a lock would block the repair in exactly the case
  where a previous run leaked one.

When GitHub is unreachable or you're not logged in, a run **warns and proceeds
unlocked** rather than blocking your device work — but it records `locked: false`
in the run's `run-meta.json`, because a warning line scrolls past and an exit code
of 0 can't tell you the run was unverified. Set `RTA_REQUIRE_LOCK=1` to make that
a hard failure instead, or `RTA_SKIP_LOCK=1` to deliberately bypass. CI does not
set `RTA_REQUIRE_LOCK`: it is alone on `.200`, so there is no contention for the
flag to protect against, and setting it would only trade a genuine green run for
an `api.github.com` blip.

## Notes

- Seeds write the **real** `JellyRock` registry (not a `test-*` section) because the
  app reads real keys to choose a screen — inherent to driving the real app. This is
  the accepted exception to the `test-*` isolation rule, which governs in-process
  Rooibos tests. See "Leaving the device as you found it" below for what puts it back.
- Demo server: the public `demo.jellyfin.org/stable` (license-clear content). It
  resets hourly; navigation anchors on the `SortName` tile index, not the volatile Continue
  Watching row.
