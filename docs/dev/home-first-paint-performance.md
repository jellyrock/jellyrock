---
topic: home-first-paint-performance
related-files:
  - components/home/LoadLatestRowsTask.bs
  - components/home/HomeRows.bs
  - source/api/apiPipeline.bs
  - source/constants/apiPool.bs
last-reviewed: 2026-08-04
---

# Measuring Home's first paint

How to measure the latest-media row load on a real device, what the numbers mean, and the
baselines recorded so far. Epic #728's charter carries the criterion **"no slower first
paint than today"** — this is how that gets checked rather than argued about.

> ⚠️ **The baselines below are snapshots, not constants.** They were taken before the
> orchestration job pool existed and will be wrong once it lands. Re-measure and replace
> them; do not design against them.

## What is being measured

Opening Home fires one `LoadLatestRowsTask` run that fetches the latest items for every
eligible library. Two log lines describe it, and both are permanent (roku-log strips them
from production builds, so they exist only in dev builds):

```text
latest-rows run complete 11 rows 2728 ms                      # HomeRows, render thread
latest-rows orchestrator done - task 2106 wait 502 emit 1590  # LoadLatestRowsTask
```

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
