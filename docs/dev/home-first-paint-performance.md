---
topic: home-first-paint-performance
related-files:
  - components/home/LoadLatestRowsTask.bs
  - components/home/HomeRows.bs
  - components/ItemGrid/LoadItemsTask2.bs
  - source/api/apiPipeline.bs
  - source/constants/apiPool.bs
  - scripts/harden-prod-manifest.js
  - scripts/measure.js
  - scripts/measure-compare.js
  - scripts/roku-devices.js
  - scripts/data/roku-hardware.json
  - scripts/measurements.js
  - scripts/measurement-guard.js
  - manifest
last-reviewed: 2026-08-13
---

# Measuring orchestrator wait-vs-emit on device

How to split an orchestrator's run into time spent **waiting on the network** versus time
spent **working on its own thread**, on a real device — what the numbers mean, and the
baselines recorded so far. Epic #728's charter carries the criterion **"no slower first
paint than today"**, and Phase 1 has to pick a mechanism per orchestrator; this is how both
get decided by measurement rather than argument.

Two orchestrators carry the instrumentation today, and they answer **oppositely** — Home's
[`LoadLatestRowsTask`](#baselines-2026-08-04) is work-bound, the grid's
[`LoadItemsTask2` genre loop](#the-grids-genre-loop--the-same-method-the-opposite-answer) is
network-bound. Measure per orchestrator; do not carry one result to another.

> ⚠️ **The baselines below are snapshots, not constants.** Home's have already been
> superseded once — see [What the batched attach changed](#what-the-batched-attach-changed).
> Re-measure and replace them; do not design against them.
>
> An earlier version of this warning said they would go stale "once the orchestration job
> pool lands." That pool was **rejected on measurement** and will not be built
> ([ADR 0026](../adr/0026-no-worker-pool-for-task-ui-handoff.md)); the note is kept here
> rather than deleted because the prediction it made is the one a reader is most likely to
> carry in from an older copy.

## What is being measured

Opening Home fires one `LoadLatestRowsTask` run that fetches the latest items for every
eligible library. Four log lines describe it, and all are permanent — they exist in dev
builds only (see [Why this costs production nothing](#why-this-costs-production-nothing)):

The **format** they emit today. The first two are the top-level split; the second two break
`emit` and the render-side work down a level, and are described under
[The second-level splits](#the-second-level-splits):

```text
latest-rows run complete <n> rows <total> ms                                            # HomeRows, render thread
latest-rows orchestrator done - [debug=? perfTiming=true] task <t> wait <w> emit <e>    # LoadLatestRowsTask
latest-rows emit split - [debug=? perfTiming=true] xform <x> append <a> notify <no>     # LoadLatestRowsTask
latest-rows populate split attach <at> detach <d> other <o>                             # HomeRows, render thread
```

The two split lines are emitted **once per run**, not per row — they report accumulators.
`emit split` follows `orchestrator done` on the task thread; `populate split` follows
`run complete` on the render thread.

**Read the bracketed build flags before you trust a sample.** The two `LoadLatestRowsTask`
lines carry the compile-time state the run was taken under, so a number can never be silently
compared against one measured in a distorting build. `debug=true` is not comparable to
`debug=false` (see the trap below).

The two `HomeRows` lines are **not** stamped. They are read from the same console session as
the task lines, so the bracket above them describes the same run — but if you quote a
render-side number on its own, carry that bracket with it by hand. `run complete` is also the
only one of the four **not** gated on `perfTiming`: seeing it with no split lines beneath it
means the build has `perfTiming=false`, not that the run did no render work.

A **recorded sample** — note it has no bracket, because it predates the flag stamping.
Its build state is known only from the commit that recorded it (`debug=false`), which is
exactly the fragility the bracket exists to remove:

```text
latest-rows run complete 11 rows 2728 ms
latest-rows orchestrator done - task 2106 wait 502 emit 1590
```

Any line you find without a bracket is in the same position: treat its build state as
unverified unless a commit says otherwise. Do not add a bracket to an old sample — a
stamp is only meaningful if the build actually emitted it.

Four numbers come out of the first two lines. **Three of them are measurements; one is not.**

| Value | Meaning | Trust it? |
|---|---|---|
| `total` | `run complete` — what the user actually waits for | ✅ directly measured, ±10% over 30 runs |
| `wait` | blocked on the API pool — network + server | ✅ directly measured |
| `emit` | transform items → `ContentNode`s → `appendChild` | ✅ directly measured |
| `drain` | `total − task` | ❌ **derived; do not compare it** |

`wait + emit ≈ task`, and `task + drain ≈ total`. If they stop summing, something moved and
the decomposition needs revisiting before the numbers are trusted.

### Do not trust `drain`

`drain` is a **remainder of two quantities measured on different threads that run
concurrently**. It is not "render-thread row population" — it is however much render work
happened to spill past the moment the orchestrator task finished. When the overlap between
the two threads shifts, `drain` swings wildly while no real work has changed.

Measured, n=10 per device: a 7–9× spread on every tier, and outright **bimodal** on the
512 MB Stick. It has produced results that are not physically sensible — a Stick 4K
"faster" than an Ultra — and an earlier published figure for one device (958 ms) did not
reproduce at all (366 ms on re-measurement). It is excluded from the baselines below for
that reason.

If you genuinely need the render-thread cost, measure it directly — the `populate split` line
below does exactly that. Subtraction cannot produce it.

**Why the split matters:** the total alone cannot separate a slow server from slow work of
our own. Every decision in this area has turned on that distinction, and three plausible
theories died on it (below).

## The second-level splits

`wait`/`emit` located Home's cost on the task thread but could not say *what* the thread was
doing, and the largest column turned out not to be task-thread work at all. Two further
accumulators answer that, and both are permanent for the same reason the first pair is:
instrumentation re-added later measures something subtly different and cannot be compared
against anything recorded here.

### `emit split` — inside the orchestrator's own loop

| Column | What it covers | Thread |
|---|---|---|
| `xform` | `transformBaseItemArray` plus building the carrier `ContentNode` | **thread-local** |
| `append` | `m.top.appendChild(child)` — one rendezvous per row | crossing |
| `notify` | the `m.top.rowReady = libId` write | crossing |

`xform + append + notify ≈ emit`. A large gap means the split is missing work and none of
it can be trusted.

**`notify` is not the cost of the write.** Writing a Task-node field that the render thread
observes parks the writing thread until the observer's callback *returns*, so `notify` is
`HomeRows.onLatestRowsReady` — `drainReady` plus `populateRowFromData` — measured from the
wrong side of the boundary. It is normally most of `emit`.

That was established with a dose-response rather than a single contrast: three writes in one
build, differing only in what observed them, cost **0.8 ms/row** (unobserved), **1.8 ms/row**
(observed, empty callback) and **40.1 ms/row** (observed, callback sleeping a known 40 ms) —
slope 1.00, intercept ≈1 ms. It matches Roku's documented rendezvous semantics
(`rokudev/dev-doc` v2.0, `DEVELOPER/core-concepts/threads.md`).

**The consequence is not the obvious one.** `notify` is not time this loop can win back.
Only the render thread may serve a rendezvous, so making the write non-blocking does not free
the run — it relocates the queuing into `wait` and `append`, which are rendezvous too. That
was built and measured, not argued: `notify` fell 1092 → 258 ms, `wait` (+633) and `append`
(+351) absorbed all of it, and `total` did not move (2695 → 2733 ms, p = 0.97). Read these
three as a budget for where the run went, not as three independent things to optimize.

### `populate split` — the render thread's own work

The same work `notify` is blocked inside, seen from the owning side — but they do **not**
sum exactly. `notify` is the whole observer callback; the split covers only
`populateRowFromData`, while `drainReady` and the per-row `child.items = []` sit inside the
callback and outside the split. **Measured residual: 3–9% low, across n=12.** A gap much
larger than that means work went missing and the columns can't be trusted; a gap of roughly
that size is the decomposition working.

For reference, the other two invariants are tight over the same samples: `wait + emit` is
within 1.1% of `task`, and `xform + append + notify` within 2.0% of `emit`.

| Column | What it covers |
|---|---|
| `attach` | the `row.appendChildren(itemData)` call, on **both** of `populateRowFromData`'s branches |
| `detach` | dropping the superseded children. In-place branch only |
| `other` | row lookup, row creation + insertion, backdrop, section bookkeeping, and the no-data exit |

Only latest-media sections are timed — every other Home row shares `populateRowFromData` and
would pollute the totals.

⚠️ **`attach` is dominated by the in-place branch, and a low `attach` is not automatically
good news.** The re-insert branch appends into a row that is not in `m.top.content` yet, and
that measures **~0**. Verified by disabling skeleton insertion so every row took that branch
(`detach = 0` proves it): same items, same session, **~315 ms live target vs ~0 ms detached**
— while `total` went the wrong way (2083 → 3266 ms). Where the work goes in that arm is not
established, so don't read the ~0 as free. Practically: `detach ≈ 0` in a sample means you
are looking at a re-insert run whose `attach` is not comparable to a normal one. Decide on
`total`. Full write-up:
[`per-item-cross-thread-appends`](../architecture/tech-debt.md#per-item-cross-thread-appends).

## How to run it

**Prefer `npm run measure`.** It performs the procedure below and writes down what the
sample was taken against, which the manual version leaves to whoever ran it to remember:

```bash
npm run measure -- -n 10 --server http://192.168.1.2:8098    # assert the server
npm run measure -- -n 10 --measurement item-grid             # the grid/genres family
npm run measure -- --deploy                                  # sideload first
```

Screens other than Home are reached with `--nav <screen>`, driving the navigation
`tests/rta/screens.js` already declares. A nav that walks THROUGH another instrumented
screen mounts more than one per launch, and the tool refuses to publish a median until
one of them is named — by `--component` when the mounts are different components (every
playback nav walks through `ItemDetails` to reach the player, and for a movie both stamp
variant `Movie`), or by `--variant` when one component mounted twice (a Season is reached
through its Series). Both are checked against what the app actually stamped, so a value no
sample carried is refused rather than recorded. See [ADR
0028](../adr/0028-mount-identity-component-and-variant.md).

```bash
npm run measure -- --measurement screen-load --nav settings -n 5
npm run measure -- --measurement screen-load --nav osd --component videoPlayer -n 5
npm run measure -- --measurement screen-load --nav seasonDetails --variant Season -n 5
```

It takes the device lock, holds ONE console socket for the whole session, relaunches n
times, and appends one line per series to `.device-runs/measure/measurements.jsonl` —
carrying the timings, the workload (`rows`), the device model + Roku OS version, the app
version, the build flags, and the server's identity and version. `--server` makes the
server a hard assert (tier 1): a mismatch refuses the run before taking a single sample.
Without it the tool still pins the identity seen at session start and re-checks it at the
end, and says out loud that it did **not** assert. Measurements it knows about are
registered in [`scripts/measurements.js`](../../scripts/measurements.js); add an
instrumented screen there rather than writing a parser.

**Precondition: the device must be holding an RTA build.** Identity is read over ODC and
nothing else, and ODC exists only in a build deployed with `injectTestingFiles`. `--deploy`
guarantees that; the default measures whatever is resident, which in practice means
whatever the last `npm run test:rta` or `--deploy` run left there. Without ODC the tool
refuses up front and tells you to pass `--deploy`, rather than taking a series it cannot
attribute to a server.

That default has a cost worth knowing: **`appVersion`, `commit` and `dirty` in the record
describe your working tree, not necessarily the build that produced the numbers.** The
record says which it was (`checkout.deployedFromCheckout`), and compares the checkout's
`bs_const` against the `[debug=… perfTiming=…]` bracket the app stamps into its own timing
lines (`checkout.agreesWithDevice`) — a `false` there means the device is running something
this checkout would not build. `ENABLE_RTA` is *derived* from ODC answering at all, not read
from the manifest, because RTA's deploy flips it in the staged build directory and the committed
value is always `false`.

Unrecognized arguments are an **error**, not a warning. `--sever https://…` used to be
dropped silently, which produced a confident series that had quietly stopped asserting the
server — the exact failure the tool exists to prevent.

Two things it fixes by construction rather than by reminding you:

- **Replay cannot enter a series.** Every sample is selected by timestamp from the window
  after its own launch, so a line buffered before that window is not eligible. See the
  trap below for what that is worth in practice.
- **A window is never collapsed to "the" number.** Each run in a window is a separate
  sample stamped with its position; only position 0 feeds the median, and the rest are
  recorded beside it.

It deliberately applies **no threshold and no gate** — same reasoning as
[What this does NOT do](#what-this-does-not-do). It records; it does not judge.

The manual procedure, still correct and still what the tool does:

1. Sideload a **dev** build (`npm run build` + deploy). Production strips the logging.
   **Leave `bs_const=debug=false`** — the committed manifest value, which `npm run build`
   uses. See the warning below before you change it.
2. Make sure the device has **"remember me"** enabled and is signed in. Without a persisted
   token every relaunch lands on `UserSelect`, Home never loads, and no run occurs.
3. Watch the BrightScript console on port 8085, relaunch the channel, and read the two lines.
4. Repeat, n≥5 — single runs vary by several hundred ms.

Nothing else is required for the device-side numbers: `emit` and `drain` are CPU work, so no
proxy, no server changes, and no registry edits.

### Trap: `bs_const=debug=true` is not a measurable build

`debug=true` is what [`printTaskThreads()`](../architecture/debug-tools.md) needs, so it is
easy to end up measuring in one. Don't — `JellyfinDataTransformer` attaches the **full raw API
payload to every transformed item** under `#if debug`, which lands squarely inside `emit`, the
largest component of the run on every device tier. A debug build also carries the Task-thread
ledger, whose bookkeeping runs on the render thread.

The thread readout and these baselines therefore cannot be taken from the same build. Measure
at `debug=false`; turn the readout on separately, and don't compare its build's timings to
anything here.

### Trap: Roku replays its console buffer

Reconnecting to port 8085 per sample makes the device replay recent output, so a fresh
capture reads the **previous** run's line and reports it as a new sample — silently, with
plausible-looking numbers.

**Keep one console socket open for the whole session** and treat each newly-arriving line as
the next sample. `npm run measure` does this, and additionally selects each sample by
timestamp from the window after its own launch, so a buffered line cannot enter a series.

**Measured, `.177` 2026-08-12** — this trap is faster and larger than the warning suggests. A
socket that connects and then sits **completely idle**, asking the device for nothing, receives
a `latest-rows run complete` line **10 ms later** reading `10 rows 7241 ms`. The live samples
that same session ranged 1439–2654 ms. So the replayed value was not a stale-but-similar
number; it was ~3× the largest real one, and a per-sample reconnect would have folded it in.

It is also worth knowing how this trap presents, because it caught the author of the tool
above: a capture without timestamps saw two `run complete` lines and they were written up as
"one launch emits a cold paint plus a refresh". A timestamped re-probe showed one launch emits
exactly **one** run and the first line had been replayed. If you find yourself explaining an
extra run, check when it arrived before you explain why.

### Optional: measuring under network latency

Only needed for questions about the request pool, not for `emit` / `drain`.

Put a latency-injecting proxy between the device and the real server so the library stays
identical and latency is the only variable — [`toxiproxy`](https://github.com/Shopify/toxiproxy)
works well, since it changes latency through an HTTP API at runtime, so a sweep needs no
rebuild or redeploy.

> ⚠️ This requires aiming the device's stored server URL at the proxy. **Capture the
> original value first and restore it afterwards**, and verify the restore by reading it
> back — a device left pointing at a dead proxy looks like a broken app. Note that a device
> configured with a canonical HTTPS URL will not authenticate against a plain-HTTP proxy.

## Baselines (2026-08-04)

Same 11 eligible rows, same server, **same transport** (`http://<server>:8098` on all three —
read back off each device's own HTTP trace per run, not assumed), `SLOT_COUNT = 3`, no
injected latency, `bs_const=debug=false`, **n=30 per device** across three separate
build/deploy passes, medians. Measured against the committed artifact. Recorded **before**
the job pool.

| | Ultra (2 GB) | Stick 4K (1 GB) | Stick (512 MB) | 512 MB vs Ultra |
|---|---|---|---|---|
| `wait` | 380 ms | 511 ms | 864 ms | 2.3× |
| `emit` | 814 ms | 1342 ms | 2615 ms | 3.2× |
| **total** | **1679 ms** | **2626 ms** | **5010 ms** | **3.0×** |

> ⚠️ **Superseded on the Stick 4K.** The batched attach (below) moved that column to
> `emit` 981 / `total` 2129. The table is kept as recorded because the Ultra and 512 MB
> columns were never re-measured after the change, so the row is no longer internally
> comparable across devices — do not read the 3.0× scaling off it any more.

Run-to-run spread of `total` (`p25`–`p75` / min–max), so a future comparison knows what counts
as a real change:

| | `p25`–`p75` | min–max |
|---|---|---|
| Ultra | 1592–1751 | 1428–1944 |
| Stick 4K | 2520–2734 | 2154–3008 |
| Stick (512 MB) | 4925–5072 | 4635–5621 |

**`emit` is the largest single component on every tier — 48% / 51% / 52% of the run**, and
larger than everything outside the orchestrator combined. No device class inverts it. Device
scaling is ~3× end-to-end with no cliff.

`drain` is deliberately absent — see [above](#do-not-trust-drain).

Note `wait` also scales ~2.3× with device class even though the network is identical — a
weak CPU is slower at issuing and parsing requests, not just at transforming them.

HTTP vs HTTPS is not worth controlling for: the same device measured 812 ms of `wait` over
HTTPS and 831 ms over HTTP. Still, keep the transport consistent across devices so the
comparison is like-for-like.

### What the batched attach changed

The second-level splits above were added to find out what `emit` was made of, and the answer
redirected the work: `notify` — the render thread's own row population, seen from the task
side — was 1092 ms of a 1350 ms `emit`, against 224 ms of actual transform. Splitting the
render side in turn put **849 ms of that into the per-item `row.appendChild(item)` loop**
(~4.8 ms per item to attach a node the orchestrator's Task thread had built), against 30 ms
for the removal loop. `appendChildren` does it in one call.

Stick 4K (`.177`), 11 rows, `debug=false`, **n=10 per arm, both arms the same day on the same
build lineage** — the recorded baseline above is a different session, and a cross-session
median is not a comparison:

| | before | after |
|---|---|---|
| `attach` | 849 ms | **328 ms** |
| `notify` | 1083 ms | 673 ms |
| `emit` | 1358 ms | 981 ms |
| **`total`** | **2646 ms** | **2129 ms** |

The before arm reproduces the n=30 baseline (2646 vs 2626 ms), which is what makes the pair
trustworthy. **Every after sample beats every before sample** — complete separation,
Mann-Whitney U = 0.0, p = 0.0002.

> **That p is the normal approximation, not the exact test** — established 2026-08-13 while
> pinning both against `measure-compare.js`. With complete separation at n=10 per arm, the
> approximation with a continuity correction gives z = 3.742 → p = 1.8e-4; the **exact**
> value is 2/C(20,10) = **1.1e-5**. The conclusion is unchanged (it only gets stronger), and
> the recorded value is kept as it was published — but the two p-values recorded in this
> document were computed by *different methods* and neither said so, which is exactly why
> the test now lives in code: `npm run measure:compare` reports which method it used.
> The `apiPipeline` pair below is genuinely exact, as it says.

**Verified non-vacuous.** A run that renders fewer items looks identical in these numbers, so
the timings alone cannot tell a win from a regression that skipped work. Reading the live
content tree off the device on both builds gave the same 13 rows, same 9 `latest_` rows, same
96 items, and the same per-row tile counts in the same order. **Do this on any future claim
here** — it is cheap and it is the only thing separating the two.

What the remaining 328 ms *is* has not been established — resist the urge to name a mechanism
for it. What is known: it scales with the number of append calls, and it disappears entirely
when the target row is not yet in the live tree (see the ⚠️ under `populate split`). What it
does **not** respond to is more task-thread parallelism:
[ADR 0026](../adr/0026-no-worker-pool-for-task-ui-handoff.md).

### What a real regression looks like

At n=30 per arm this method resolves differences of roughly **120 ms and up**; smaller
effects sit inside run-to-run variation and cannot be called either way. Two worked examples
from the run that produced this table:

- A `debug=true` build is **+178 ms** on the 512 MB Stick and **+121 ms** on the Stick 4K
  (Mann-Whitney p=0.007 and p=0.021) — detectable.
- The Task-thread ledger on its own, and `rawApiData` on its own, are each **not
  distinguishable** at n=10. That bounds them below the floor; it does not make them free.

Use a rank test, not a median difference. A median gap that looks decisive can sit well
inside the spread — and the per-column split (`wait` / `emit`) is noisy enough at n=10 to
reverse sign between samples, so decide on `total`. **`npm run measure:compare` runs the
test for you** (see [below](#comparing-two-arms)); it also prints this floor beside any
result it cannot distinguish, so a small delta is read against what the method can resolve.

### Comparing two arms

Take the arms **alternating** — `--arm before`, `--arm after`, `--arm before`, … — never all
of one and then all of the other, so anything that drifts with time (fixture content, device
warm-up, a server getting busy) cancels instead of landing on one arm:

```bash
npm run measure -- -n 5 --arm before --server http://192.168.1.2:8098
npm run measure -- -n 5 --arm after  --server http://192.168.1.2:8098   # …and repeat
npm run measure:compare                              # what is in the ledger
npm run measure:compare -- --a before --b after      # the comparison
npm run measure:compare -- --a before --b after --field emit
```

An arm can be named by any recorded key, not just a label — `--a commit=abc1234`,
`--a device=<key>` — and `npm run measure:compare` with no arguments lists the values
available to select on.

What it does that a hand-built comparison does not:

- **The workload delta is printed above the timing delta.** This section's own
  *"verified non-vacuous"* check — same rows, same items, same per-row tile counts — is the
  thing the tool now does on every comparison rather than when someone remembers to.
- **It refuses two experiments dressed as two arms**: different screen, server, device model,
  RAM tier, build flavor or `ENABLE_RTA` state. A `debug=true` arm against a `debug=false`
  one is +121 ms before the change under test does anything.
- **It refuses two arms that share a series.** Measuring an uncommitted change leaves both
  arms on one commit, so `--a commit=<sha> --b after` selects every arm on that commit as A —
  including all of B. Those samples would be counted on both sides, in both medians and in
  the rank test. Narrow one selector; two arms of one experiment share no series.
- **It says what it dropped.** A series that never reached a verdict (`blocked`, or written
  before `outcome` existed) is excluded from an arm, and the count is printed beside the
  delta — a median over three samples when you took ten otherwise reads exactly like a result.
- **The RAM tier comes from Roku's published table**, not from anyone's memory:
  [`scripts/data/roku-hardware.json`](../../scripts/data/roku-hardware.json) is generated from
  `rokudev/dev-doc` and refreshed by a weekly sync PR. So a Roku TV, a Projector and a
  Streaming Stick all resolve, and a comparison across tiers is refused rather than eyeballed.
- **It checks the arms were actually interleaved**, from the per-sample timestamps, and says
  so when they were not.
- **Workload drift is reported, never refused.** Two arms at 10 rows and 9 rows are still
  worth looking at; missing that they differ is not.
- No threshold, no gate, no CI — same reasoning as
  [What this does NOT do](#what-this-does-not-do).

## Why this costs production nothing

The instrumentation is gated on a dedicated `bs_const`, **`perfTiming`**, which defaults to
`true` in the committed manifest and is forced to `false` for every release artifact.

**It is deliberately NOT gated on `debug`.** A `debug=true` build attaches `rawApiData` to
every transformed item, which lands inside `emit` — the quantity being measured. Riding
`debug` would mean the only build able to read these numbers is one that inflates them.
Separate flags keep "measure the app" and "test the app's error paths" independent.

**It also cannot rely on `roku-log` stripping alone.** `roku-log` removes the log *call*
from production, but not the `roTimespan`s and per-item `mark()` / `totalMilliseconds()`
calls feeding it — so before `perfTiming` existed, production ran the whole measurement and
threw the result away, on every Home load and every grid load (up to `m.top.limit`, default
100 items).

### `#if` is evaluated on the device, not by `bsc`

This is the part that makes the enforcement non-obvious, and it invalidates the intuitive
way to check it:

- `bsc` does **not** evaluate `#if`. The directives are passed straight through and appear
  verbatim in the emitted `.brs`. **Grepping the build output for `roTimespan` proves
  nothing** — it is always there.
- Roku's on-device compiler evaluates `#if` at load time using the `bs_const` line in the
  **shipped manifest**. The manifest is the only thing that decides what production runs.
- `bsconfig.json` accepts `manifest.bs_const`, and BrighterScript applies it — but only to
  its own in-memory manifest. The `manifest` file is copied to `build/` verbatim, so a
  `bsconfig` override never reaches the device. **Do not use it to enforce this.**

Enforcement therefore lives in
[`scripts/harden-prod-manifest.js`](../../scripts/harden-prod-manifest.js),
the final step of `npm run build:prod`, which forces `debug`, `perfTiming`, and
`ENABLE_RTA` to `false` in `build/manifest` and prints what it flipped. It covers every
route to a release, including `npm run package:signed`.

**To verify, read `build/manifest` — not the `.brs`:**

```bash
npm run build:prod && grep bs_const build/manifest
# bs_const=debug=false;ENABLE_RTA=false;perfTiming=false
```

That hardening also closes a standing hazard independent of timing. Flipping `debug=true`
locally is not an occasional thing — it is currently the **only** way to surface
`m.log.debug` / `.verbose` output, since the log level is welded to the same const
([`JRScene.bs`](../../components/JRScene.bs) sets level 4 vs 2 under `#if debug`), so it
reaches the working tree routinely. Forgetting to revert it before a release would ship
raw API payloads on every item plus the failure-injection hooks. It has been committed as
`true` **twice** — `27d99141` (2025-10-24) and `dc05db8d` (2026-03-12) — each caught and
reverted the same day, i.e. after landing rather than before.

### Turning the numbers off

Set `perfTiming=false` in the manifest and rebuild — useful when profiling something else
and you want the clocks out of the way. Note that the lines then disappear entirely, which
is also why the default is `true`: instrumentation nobody runs stops being a baseline.

## The grid's genre loop — the same method, the opposite answer

The decomposition is not Home-specific. `LoadItemsTask2` carries the same two clocks and
emits the same shape of line, because epic #728's Phase 1 had to choose a mechanism for the
Genres view and only the split could say which:

The format it emits today, then the sample that produced the baseline below (recorded
before the flag stamping landed, hence no bracket — see [What is being measured](#what-is-being-measured)):

```text
item-grid load done - items <n> genreFetches <g> [debug=? perfTiming=true] task <t> wait <w> emit <e>
item-grid load done - items 8 genreFetches 8 task 1060 wait 827 emit 211
```

That sample is one run, and it is the slow end of the spread — the baseline table below
reports the n=4 **median** (1016 ms), not this line.

`genreFetches` is logged alongside the split because one function serves two very different
shapes. A plain grid load is a single query plus a transform loop (`genreFetches 0`). A
**Genres** load is one query plus a fetch *per genre* — so the genre count is what makes that
path I/O-heavy, and a line without it can't be interpreted.

**Baseline** — Stick 4K (`.177`), one movie library, 8 genres, `bs_const=debug=false`, n=4,
medians. Reaching it needs `display.<libraryId>.landing` seeded to `Genres` (see
`seedLibraryLanding`); it is not the default view:

| | median | share |
|---|---|---|
| `wait` | 757 ms | **78%** |
| `emit` | 211 ms | 22% |
| **task** | **1016 ms** | |

Per genre that is ~95 ms of fetch against ~26 ms of transform. Run-to-run spread was tight
(975–1060 ms).

### What the migration to `apiPipeline` actually bought

The genre fetches now ride `apiPipeline` instead of running back to back. Measured
2026-08-05 on the same device and library, **both arms on the same day** — the recorded
baseline above is from a different session, and a cross-session median is not a comparison:

| `.177`, 8 genres, `debug=false` | before (n=5) | after (n=6) |
|---|---|---|
| `wait` | 815 ms | **321 ms** |
| `emit` | 219 ms | 223 ms |
| **task** | **1077 ms** | **603.5 ms** |

Six samples were taken per arm; **one before sample is excluded** because it opened a
12-genre library instead of the 8-genre one that was seeded. Genre count is the independent
variable of this measurement, so that run is a different workload, not a slow sample. (Cause:
`navLibraryByType` resolves the first Home *tile* of a collection type while the seeding side
resolves the first library from `/UserViews`; on a multi-library server those need not agree
— see the open followup in [`docs/progress.md`](../progress.md).) Medians over all six would
read `task` 1081.5 / `wait` 820.5 / `emit` 220.5 — the outlier was the *maximum*, so it moved
each median by under 1% — but the table above and the statistics below are both computed on
the 8-genre samples, so they describe one workload rather than two.

The before arm reproduces the n=4 baseline (1077 vs 1016 ms; 79% vs 78% wait), which is what
makes the pair trustworthy. **Every after sample is faster than every before sample** —
complete separation, exact Mann-Whitney p≈0.004. `emit` is unchanged, as it must be: the
transform work is identical, only the waiting overlaps.

**The arithmetic checks out, which is the real confirmation.** Serial: 8 × ~95 ms + the
library query ≈ 815 ms — measured 815 (landing on the same integer is luck; agreeing to
within a few percent is the point). Pipelined 3-wide: ⌈8/3⌉ = 3 waves × ~95 ms + the same
query ≈ 340 ms — measured 321. The mechanism is doing what it says.

⚠️ **A prediction that did NOT hold, and why.** This migration was projected at
1016 → **~400 ms**; it landed at ~604. The `wait` half of the projection was nearly exact
(285 predicted vs 321 measured); the error was assuming `emit` would disappear into the
in-flight shadow. It cannot: `wait` and `emit` are instrumented as **disjoint** intervals —
`wait` is time inside `apiPipelineNext`, `emit` is time outside it — so `task ≈ wait + emit`
by construction. The shadow makes the *measured wait* smaller (requests progress while the
thread transforms); it never makes emit free. Project a pipelining change by shrinking `wait`
and holding `emit` fixed.

**This inverts Home's result.** On the same device Home is `wait` 511 / `emit` 1342 — emit
51% and dominant. The grid's genre loop is 78% network. The two orchestrators therefore need
**different mechanisms**, which is the whole reason the split is worth measuring per
orchestrator rather than generalizing one number:

- Home's `emit` is the target — but **not** via a worker pool, which is what this line used
  to say. Splitting `emit` a level deeper showed only ~224 ms of it is thread-local work
  more workers could divide; the rest is the render thread's own row population, reached by
  giving that thread *less to do*. Rejected on measurement in
  [ADR 0026](../adr/0026-no-worker-pool-for-task-ui-handoff.md).
- The genre loop's `wait` is the target → **`apiPipeline`**, which already exists, needs no
  new threads, and costs nothing against the 100-thread cap. A worker pool would attack the
  22% and leave the 757 ms serial.

⚠️ Small n throughout (n=4 baseline, n=5/6 migration arms), one device, one library, fast
LAN (~95 ms/request). The *direction* is what
generalizes, and it strengthens rather than weakens off this bench: genre count sets the
number of serial fetches, so a library with 25 genres is worse, and a distant server is worse
again. Re-measure before sizing anything.

### Trap: `m.log` silently caps at 10 arguments

`Logger.info` is `function(message, value, value2 … value9)` — **ten parameters**, and the
roku-log BSC plugin spends the first on the injected pkg path, leaving **nine** for the call
site. Passing more is **not a compile error**. It faults at runtime with `Wrong number of
function parameters (&hf1)`, which drops the app into the BrightScript debugger and *hangs
it mid-load*.

A hung app then fails in ways that look like anything but a log call: ODC requests time out,
`getValue` returns `undefined` for every node so navigation helpers report "screen never
loaded", and the UI sits on a spinner. The device console names the offending file and line
directly — read it first. This cost most of a session during the measurement above.

## Three theories this method killed

**"The request pool (3 slots) is too small."** Widening it to 8 slots changed nothing on a
LAN (2660 ms vs 2586 ms). Under injected latency it helps only past a threshold: +150 ms of
added round-trip latency cost ~40 ms of extra wait, while +400 ms cut the run by ~14% at width 8. The reason
is that **`emit` hides latency** — `apiPipeline` keeps requests in flight
while the thread transforms, so added latency is nearly free until it exceeds the emit
shadow. The naive "requests ÷ slots × round-trip" arithmetic badly overstates the cost
of a distant server.

**"The render-thread drain dominates on weak hardware."** It doesn't — `emit` is the largest
directly-measured component on every tier. This one survives only in that weakened form: it
was originally argued from `drain` figures, and `drain` has since been shown to be an
unreliable derived quantity (above), so "how big is the render-side cost" remains genuinely
unanswered. What is solid is that `emit` is large and real.

**"Refilling the pool the instant a slot frees will speed up the run."** It doesn't. The
pipeline used to top the pool up again immediately after taking a completion — before handing
the result back — so the freed slot would not idle for the caller's per-result work. At
`SLOT_COUNT = 3` that reasoning says a third of the pool is parked for the length of the run,
which sounds compelling.

Measured across six independent device/pass comparisons (n=30 on the 512 MB Stick over four
separate build/deploy passes, n=10 each on the other two tiers), it was **slower every single
time** — never faster — by roughly 1–3%. Sign test p=0.031; per-device Mann-Whitney was not
significant, so this is evidence of *no benefit* rather than proof of harm. The original
justification for it (a 2673 → 2586 ms median at n=4) did not reproduce.

Worth recording as a method lesson too: at n=10 the `wait` column appeared to drop with the
refill, which read as the mechanism working exactly as designed. At n=30 that reversed. The
per-column split is noise-dominated at these sample sizes and will happily supply a mechanism
story for whichever conclusion you already hold. Only `total` was stable enough to decide on.

## What this does NOT do

There is deliberately **no CI gate** on these numbers. They depend on server hardware,
library size and shape, network conditions, and device model — none of which CI controls — so
a threshold cannot distinguish a real regression from a busy server, and a flaky perf gate
teaches people to ignore it.

The durable regression protection is **structural, not temporal**: assert the *mechanism* in
an ordinary deterministic test, the way the `no-raw-run` plugin guards the thread bound by
construction. A timing number tells you something got slower; a structural test tells you
what broke.

For the batching lever specifically, the mechanism worth asserting is **crossing count** —
that a handoff attaches its items in one call rather than N. That is a property of the source,
so a lint rule or a plugin can hold it; a timing threshold cannot. Nothing asserts it today.
