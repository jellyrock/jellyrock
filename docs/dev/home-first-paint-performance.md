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

Four numbers come out of that pair:

| Value | Meaning | Where it runs |
|---|---|---|
| `wait` | blocked on the API pool — network + server | orchestrator Task thread |
| `emit` | transform items → `ContentNode`s → `appendChild` | orchestrator Task thread |
| `task` | the orchestrator's whole run (`≈ wait + emit`) | orchestrator Task thread |
| `drain` | `run complete` total − `task` — `populateRowFromData` | **render thread** |

`wait + emit ≈ task`, and `task + drain ≈ total`. If they stop summing, something moved and
the decomposition needs revisiting before the numbers are trusted.

**Why the split matters:** the total alone cannot separate a slow server from slow work of
our own. Every decision in this area has turned on that distinction, and two plausible
theories died on it (below).

## How to run it

1. Sideload a **dev** build (`npm run build` + deploy). Production strips the logging.
2. Make sure the device has **"remember me"** enabled and is signed in. Without a persisted
   token every relaunch lands on `UserSelect`, Home never loads, and no run occurs.
3. Watch the BrightScript console on port 8085, relaunch the channel, and read the two lines.
4. Repeat, n≥5 — single runs vary by several hundred ms.

Nothing else is required for the device-side numbers: `emit` and `drain` are CPU work, so no
proxy, no server changes, and no registry edits.

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
verified per device, not assumed), `SLOT_COUNT = 3`, no injected latency, n=5 per device,
medians. Recorded **before** the job pool.

| | Ultra (2 GB) | Stick 4K (1 GB) | Stick (512 MB) | 512 MB vs Ultra |
|---|---|---|---|---|
| `emit` | 942 ms | 1359 ms | 2583 ms | 2.7× |
| `drain` | 412 ms | 958 ms | 1490 ms | 3.6× |
| `wait` | 317 ms | 414 ms | 831 ms | 2.6× |
| **total** | **1667 ms** | **2739 ms** | **4953 ms** | **3.0×** |

**`emit` is the largest component on every tier — 57% / 50% / 52%.** No device class inverts
it. Device scaling is ~3× end-to-end with no cliff.

Note `wait` also scales ~2.6× with device class even though the network is identical — a
weak CPU is slower at issuing and parsing requests, not just at transforming them.

HTTP vs HTTPS is not worth controlling for: the same device measured 812 ms of `wait` over
HTTPS and 831 ms over HTTP. Still, keep the transport consistent across devices so the
comparison is like-for-like.

## Two theories this method killed

**"The request pool (3 slots) is too small."** Widening it to 8 slots changed nothing on a
LAN (2660 ms vs 2586 ms). Under injected latency it helps only past a threshold: +150 ms of
added round-trip latency cost ~40 ms of extra wait, while +400 ms cut the run by ~14% at width 8. The reason
is that **`emit` hides latency** — `apiPipeline` keeps requests in flight
while the thread transforms, so added latency is nearly free until it exceeds the emit
shadow. The naive "requests ÷ slots × round-trip" arithmetic badly overstates the cost
of a distant server.

**"The render-thread drain dominates on weak hardware."** It doesn't — at n=5 the drain is
1490 ms and `emit` is larger on every device. The drain is a real secondary cost, and it
grows fastest across device tiers, but it does not displace `emit`.

## What this does NOT do

There is deliberately **no CI gate** on these numbers. They depend on server hardware,
library size and shape, network conditions, and device model — none of which CI controls — so
a threshold cannot distinguish a real regression from a busy server, and a flaky perf gate
teaches people to ignore it.

The durable regression protection is **structural, not temporal**: assert the *mechanism*
(work is distributed across workers) in an ordinary deterministic test, the way the
`no-raw-run` plugin guards the thread bound by construction. A timing number tells you
something got slower; a structural test tells you what broke.
