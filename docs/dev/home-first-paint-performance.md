---
topic: home-first-paint-performance
related-files:
  - components/home/LoadLatestRowsTask.bs
  - components/home/HomeRows.bs
  - components/ItemGrid/LoadItemsTask2.bs
  - source/api/apiPipeline.bs
  - source/constants/apiPool.bs
  - scripts/harden-prod-manifest.js
  - manifest
last-reviewed: 2026-08-05
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

> ⚠️ **The baselines below are snapshots, not constants.** They were taken before the
> orchestration job pool existed and will be wrong once it lands. Re-measure and replace
> them; do not design against them.

## What is being measured

Opening Home fires one `LoadLatestRowsTask` run that fetches the latest items for every
eligible library. Two log lines describe it, and both are permanent — they exist in dev
builds only (see [Why this costs production nothing](#why-this-costs-production-nothing)):

The **format** they emit today:

```text
latest-rows run complete <n> rows <total> ms                                          # HomeRows, render thread
latest-rows orchestrator done - [debug=? perfTiming=true] task <t> wait <w> emit <e>  # LoadLatestRowsTask
```

**Read the bracketed build flags before you trust a sample.** Every line carries the
compile-time state it was taken under, so a number can never be silently compared against
one measured in a distorting build. `debug=true` is not comparable to `debug=false` (see
the trap below).

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

Four numbers come out of that pair. **Three of them are measurements; one is not.**

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

If you genuinely need the render-thread cost, **instrument `populateRowFromData` directly**.
Subtraction cannot produce it.

**Why the split matters:** the total alone cannot separate a slow server from slow work of
our own. Every decision in this area has turned on that distinction, and three plausible
theories died on it (below).

## How to run it

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
the next sample.

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
reverse sign between samples, so decide on `total`.

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

- Home's `emit` is the target → a worker pool that owns the *transform*.
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

The durable regression protection is **structural, not temporal**: assert the *mechanism*
(work is distributed across workers) in an ordinary deterministic test, the way the
`no-raw-run` plugin guards the thread bound by construction. A timing number tells you
something got slower; a structural test tells you what broke.
