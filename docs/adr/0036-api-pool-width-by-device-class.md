# ADR 0036: The API pool width is chosen per device class — 4 on low-memory devices, 6 elsewhere

**Status:** Accepted
**Date:** 2026-09-16

**related-files**: `source/constants/apiPool.bs`, `source/utils/globals.bs`, `components/api/ApiQueueTask.bs`, `source/api/apiPipeline.bs`, `tests/source/unit/constants/apiPool.spec.bs`, `docs/architecture/api.md`

Every Jellyfin GET goes through one persistent pool of `ApiTask` threads, and the pool was a
fixed 3 wide. Home issues one request per row — 16 at 11 libraries — so with more rows than
slots the requests queue, and on a slow connection the queue is the wait. An earlier probe had
found widening to be no lever (`docs/dev/home-first-paint-performance.md`); attach batching
and #799 have since shrunk the per-response work that hid the latency, so the question was
re-measured rather than re-argued.

## Decision

The width is chosen once at startup from the existing low-memory classification —
`apiPool.widthFor(m.global.device.isLowMemoryDevice)`: **4** on the 512 MB list, **6** on
everything else — and stored as `m.global.apiPoolWidth`, which `ApiQueueTask` and `apiPipeline`
read. Each slot is its own guarded block in `setGlobalNodes()` (`no-task-fanout` forbids a loop),
up to 6, so any width from 1 to 6 is a constants change; `ApiQueueTask` checks the created slots
against the width at startup and logs an error in either direction, and a unit spec pins both
values.

The evidence (Home at 11 libraries, through a proxy that delays every response, three device
tiers). A pre-registered sweep of widths 3 / 4 / 6 / 8 at +0 / +150 / +400 ms found that wider
cut full-load time 16–30 % at +150 and +400 ms on a Streaming Stick 4K (1 GB) and an Ultra
(2 GB) and never hurt at +0; on a 512 MB Streaming Stick, 4 already captured the whole +400 ms
gain (−12 %, the same as 6 and 8) while 6 and 8 delayed first paint by ~12 % at +150 ms — a
signal predicted before the run and seen three times, though no single comparison survives a
Holm correction across the sweep. A second pre-registered run then compared the **shipping code**
against the identical code at width 3 (n = 30 at +0, n = 10 at +400, harm gate with a Holm correction
over eight comparisons): no regression on either tier, and full-load time fell 4.5 % / 14.8 %
(512 MB, +0 / +400 ms) and 8.6 % / 31.6 % (Ultra). The live Task-thread peak on the demo
fixture is 8 (512 MB) and 10 (Ultra), against the pre-ship gate of 30.

Considered and ruled out:

- **Keep 3.** Leaves 15–32 % of full-load time on slow connections.
- **One width for every device (6 or 8).** The 512 MB tier gains nothing past 4 and pays the
  first-paint cost at 6 and 8.
- **Wider than 6 on fast devices.** 8 beat 6 by 0–7 %, never significantly. 6 is also a
  browser's per-server connection limit over plain HTTP (Chromium's
  `g_max_sockets_per_group`), and jellyfin-web issues all of Home's row requests at once, so 6
  matches load Jellyfin's own client already generates; above it, server load is unmeasured.
- **Sizing by connection speed.** No width hurt on a fast connection, so there is nothing to
  switch off — the measured best remote width is also safe locally.
- **Sizing by library count.** The coordinator only dispatches queued requests, so a small
  library leaves extra slots idle; a static width already scales down.

## Consequences

- A 512 MB device runs one more persistent thread than before and every other device three
  more; each is ~0.3 MiB on the 512 MB tier (measured at width 6 vs 3: +0.88 MiB of a 300 MiB
  limit). The peak band in `global-state.md` is now width-conditional; ADR 0031's 9–11 was
  measured at width 3 and its watermark (50) still sits far above every measured peak.
- Every screen shares the pool, so pipelined orchestrators (genre samples, extras rows) also
  run wider. The full RTA suite passed on the 6-wide tier; their timing was not measured.
- **Revisit** if the low-memory list changes, if a server-load test clears widths above 6, if a
  device outside both measured classes behaves differently, or if Home's request count grows
  well past 16 rows (a longer queue may want a wider top width). Limits of the evidence: at
  most 11 libraries, one server, one device model per tier, and a delay model that adds no
  connection-setup cost.
