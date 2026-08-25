---
topic: home-first-paint-performance
related-files:
  - components/home/LoadLatestRowsTask.bs
  - components/home/HomeRows.bs
  - source/home/latestRows.bs
  - components/ItemGrid/LoadItemsTask2.bs
  - source/api/apiPipeline.bs
  - source/constants/apiPool.bs
  - scripts/harden-prod-manifest.js
  - scripts/measurements.js
  - manifest
last-reviewed: 2026-08-25
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
eligible library. Five log lines describe it, and all are permanent — they exist in dev
builds only (see [Why this costs production nothing](#why-this-costs-production-nothing)):

The **format** they emit today. The first two are the top-level split; the rest break
`emit` and the render-side work down a level, and are described under
[The second-level splits](#the-second-level-splits):

```text
latest-rows run complete <n> rows <total> ms                                            # HomeRows, render thread
latest-rows orchestrator done - [debug=? perfTiming=true] task <t> wait <w> emit <e>    # LoadLatestRowsTask
latest-rows emit split - [debug=? perfTiming=true] xform <x> append <a> notify <no>     # LoadLatestRowsTask
latest-rows populate split attach <at> detach <d> other <o>                             # HomeRows, render thread
latest-rows size recompute calls <c> drains <d> ms <ms>                                 # HomeRows, render thread
```

The split lines are emitted **once per run**, not per row — they report accumulators.
`emit split` follows `orchestrator done` on the task thread; `populate split` and
`size recompute` follow `run complete` on the render thread.

`size recompute` is a **separate line rather than three more columns on `populate split`**:
`m.log.*` takes at most nine call-site arguments and faults at runtime past that, dropping
the app into the BrightScript debugger.

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

### `size recompute` — how often the row geometry was rewritten

`setRowItemSize()` rebuilds `rowItemSize` / `rowHeights` / `rowSpacings` and writes all three
to the `RowList`. It is expensive out of proportion to the arrays it builds, and it runs once
per **structural** change (a row removed because its library returned nothing, or re-inserted
because one that was empty now has data).

| Column | What it covers |
|---|---|
| `calls` | how many times the recompute actually ran during the run |
| `drains` | how many `rowReady` observer wakes the run was delivered over |
| `ms` | total time inside `setRowItemSize()` |

`calls` and `drains` are counted from the moment the run starts, so the recompute that
follows skeleton insertion is not in them.

⚠️ **`ms` is a SUBSET of `populate split`'s `other`, not a fourth sibling of it.** Every
recompute during a run happens inside a window `other` is already accumulating, which is what
keeps `attach + detach + other ≈ notify` true. Summing all four against `notify` double-counts
— in the after-arm below, `ms` 91 of `other` 95 is the same 91 ms seen twice.

**`drains` is there to stop a specific wrong fix from being re-proposed.** `onLatestRowsReady`
drains a list and looks like a batch boundary, so coalescing the recompute there is the
obvious move. It buys nothing: measured on a Stick 4K, 11 rows arrive over **11 separate
wakes**, one row each, so a per-drain flush has nothing to coalesce. The batch boundary that
works is the **whole run**.

⚠️ **The per-call price is not fixed, so `calls` alone does not predict `ms`.** It tracks how
much content is in the tree when the write lands: ~85 ms for a call early in a load, ~200 ms
for one after every row is populated.

**This section used to conclude from that "batching is a wash where few rows change", and
that was wrong.** The `161 vs 161` behind the sentence is `ms` — time *inside*
`setRowItemSize` — and that figure is fine: two early recomputes really do cost about what
one late one does. The error was generalizing it to the whole change, because the batch also
defers the row **removals**, and that saving does not land in `ms` at all. Corrected on
measurement, not on argument.

**Re-measured 2026-08-19**, against a server producing exactly **2** structural changes (10
libraries requested, 2 returning nothing) — i.e. the very case the old sentence called a
wash. `main` vs this branch, n=30 per arm per tier, alternating blocks, identical `rows=10`
workload on every sample, every figure out of `measure:compare`:

| `total` | 512 MB Stick | 1 GB Stick 4K | 2 GB Ultra |
|---|---|---|---|
| main | 3446 ms | 1760 ms | 1162.5 ms |
| batched | **2828.5 ms** | **1533 ms** | **1042.5 ms** |
| delta | **−617.5 (−17.9%)** | **−227 (−12.9%)** | **−120 (−10.3%)** |
| rank test | p<0.0001 | p<0.0001 | p=0.0025 |

The 1 GB column was taken **twice, with the arm order reversed** the second time (−216 ms,
−12.3%). That control was not ceremony: the first campaign's per-block deltas grew across the
session, and an order effect had to be excluded before any number could be published.

**Why the win grows as the device weakens.** The recompute saving itself is roughly flat
across tiers; the knock-on is not:

| | 512 MB | 1 GB | 2 GB |
|---|---|---|---|
| `other` — the recompute | −104 | −108.5 | −45 *(complete separation, U=0)* |
| `wait` — Task thread | **−308.5** (p=0.0002) | −83.5 (p=0.0012) | −24.5 *(not distinguishable)* |

`wait` is time the Task thread spends on the network, and this change does not touch the
network. It moves because a render thread with less to do stops slowing the Task thread down
— [the rendezvous cost model](../architecture/async.md#crossing-the-thread-boundary-costs-a-rendezvous--budget-crossings-not-bytes)
surfacing in the column you would least expect, and the reason the effect nearly triples
between the Ultra and the 512 MB Stick.

**The result that is easiest to miss: the batch makes the cost BOUNDED, not just smaller.**
`sizeCalls` is 1 on every batched sample taken, on every tier:

| `other` range | 512 MB | 1 GB | 2 GB |
|---|---|---|---|
| main | 202–857 ms | 93–531 ms | 76–251 ms |
| batched | **193–222 ms** | **82–112 ms** | **58–73 ms** |

Main's two recomputes land wherever the network happens to deliver the two empty libraries,
so their cost depends on how full the tree is at that instant; the batch pins its single
recompute to the end of the run. Non-vacuously confirmed: main's `detach` is **flat**
(24–27 ms across all 12 blocks on the 1 GB device) while its `other` swings 128–300 — so the
recomputes got more *expensive*, not more numerous.

What grows with library count is `calls`, and that is where it pays hardest. **Re-derived
2026-08-19 under the current method**, by adding four path-less libraries to the bench server
so six eligible libraries returned nothing (14 requested, 6 empty), then deleting them again:

| 14 rows, 6 empty · n=30/arm | `main` | batched | delta |
|---|---|---|---|
| `other` | 688.5 ms | **100 ms** | −588.5 (−85.5%) |
| `wait` | 977.5 ms | **589 ms** | −388.5 (−39.7%) |
| `emit` | 1391 ms | **689.5 ms** | −701.5 (−50.4%) |
| **`total`** | **2831.5 ms** | **1648 ms** | **−1183.5 (−41.8%)** |

**Complete separation (Mann-Whitney U = 0) on every column**, identical `rows=14` workload on
all 60 samples, alternating blocks, `sizeCalls` 1 on every batched sample. So the scaling
claim holds and is *stronger* than the −36% originally recorded here — at six structural
changes the change is worth about 5× what it is worth at two.

⚠️ **This is still an ENGINEERED condition.** Six libraries returning nothing is not what the
bench server does — it has two, and this work's own session notes record "two such libraries
on the test server". The four extra were created for the measurement and removed afterwards.
Read this table as the SCALING result (what the win becomes on a library-rich server) and the
three-tier table above as what the change is worth on a real library set.

⚠️ **A first attempt at this run was discarded, and the reason is worth keeping.** Blocks 4+
recorded `wait` values of 7–13 s against a normal ~600 ms, because the server's scheduled
12-hourly `Scan Media Library` and `Media Segment Scan` fired mid-campaign. Nothing in the
timing said "the server is busy" — it presented as the app getting slower. The run above was
taken after those tasks went idle, and it reproduced the discarded run's headline (−41.8% in
both) rather than being rescued by the re-run. **Check the server's scheduled tasks are idle
before a campaign**; a maintenance pass is indistinguishable from a regression after the fact.

The figure originally recorded here — `calls` 6 → 1, `ms` 408 → 91, `other` 661 → 95, first
paint 2593.5 → 1669 ms (−36%), n=6/arm back to back at 11 rows — is superseded by the table
above, which measures the same condition at n=30 with interleaved blocks.

🚨 **Batching the recompute alone is a VISIBLE BUG — the removals have to be deferred with
it.** Defer only the recompute and the row list shrinks while the three arrays still describe
the old one, so every row below a removal renders at its neighbor's size. Measured through
ODC, not guessed: a square row drawn at portrait height and a wide row at square width,
across a ~1.0 s window of first paint. Deferring the removals too keeps tree and arrays in
step for the whole run — 0 wrong rows after, against 4 samples before. The **re-insert**
branch is the mirror image (row list longer than the arrays) and flushes eagerly instead,
which is affordable because it is rare.

**The batch holds back only the rows the run itself delivers.** Continue Watching, Next Up, On
Now and Active Recordings share `populateRowFromData` but are fired by `startParallelLoads`,
which races the orchestrator — batching them would make a visible row collapse depend on which
HTTP response won, and their tasks can be re-fired mid-run (`onProgramsExpired`,
`Home.refresh()`), so a queued removal could outlive a repopulate. They remove and recompute
immediately, which is why `calls` can read above 1 on a load with empty non-library sections.
The rule lives in `latestRows.removalIsDeferrable` and is unit-tested; the sizing of what that
costs is in
[`home-row-size-recompute-per-row`](../architecture/tech-debt.md#home-row-size-recompute-per-row).

**How that was measured, since it is worth reaching for again.** Not a screenshot, and not a
judgment call — an ODC probe polling a *structural invariant* through the transient:
`rowItemSize.count()` against the live child count, and, whenever those disagree, each row's
own `cursorSize` against the entry actually applied to it. That distinction is the point: a
length mismatch alone is not a defect (the surplus entry may sit past the last row), so the
oracle has to name which visible row is being drawn at a size that is not its own. Build with
the RTA deploy path so ODC is injected, cold-start via ECP, and poll until the run settles.

So read `calls` as the thing that grows with library count, and `ms` as what it cost this
particular run. Full write-up:
[`home-row-size-recompute-per-row`](../architecture/tech-debt.md#home-row-size-recompute-per-row).

#### `size recompute by` — WHICH call site spent them

`calls` counts recomputes and cannot say who asked for one, and the two mid-run callers have
different fixes. A second line attributes them:

```text
latest-rows size recompute by remove 1 insert 0 at remove:activeRecordings
```

| Column | What it covers |
|---|---|
| `remove` | recomputes from `removeRowAtIndex` — a non-latest section returned nothing and its row was dropped mid-run |
| `insert` | recomputes from `populateRowFromData`'s insert branch — a section that had no row gained one |
| `at` | the section ids behind those counts, in the order they fired; `-` when only the end-of-run flush ran |

**`calls - remove - insert` is the end-of-run flush, and it can only be 0 or 1.** That is the
decomposition's own check, and it is why the attribution is two counters rather than a label:
a recompute arriving by a path neither counter tags shows up as a violated invariant instead
of a sample quietly credited to the wrong call site.

⚠️ **Nothing computes it for you — check it yourself, first, on every arm.** The counters are
captured into the ledger, but no gate evaluates the subtraction, so a violated invariant is
silent until someone looks. It held **40/40** on the 2026-08-25 arms; that is a reading, not a
guarantee for the next one. Over `.device-runs/measure/measurements.jsonl`:

```js
s.timings.sizeCalls - s.timings.sizeRemove - s.timings.sizeInsert  // must be 0 or 1
```

Closing the gap is tracked as
[`measurement-invariants-ungated`](../architecture/tech-debt.md#measurement-invariants-ungated).

`at` is a string, so it lands in the sample's `dimensions` rather than its `timings` — the
same bucket, and for the same reason, as `screen-load`'s `slowestContent`. Do NOT move it: a
dimension is anything that is not a QUANTITY, and subtracting two row ids means nothing.

##### What it read on `.177`, 2026-08-24 (n=40, two arms, BATCAVE, 12 rows / 128 items)

- **`insert` was 0 on 40 of 40 launches, and the reason is structural rather than lucky.**
  On a COLD launch `createSkeletonRows()` plus `insertLatestMediaSkeletons()` give every
  planned section a row before any data arrives, so `findRowBySectionId` always finds one and
  `populateRowFromData` takes the in-place branch — the insert branch is **unreachable**, not
  merely unused by chance. ⚠️ **That is a claim about cold launches only.** The branch becomes
  reachable on a REFRESH, where `initialLoadComplete` suppresses skeleton creation and a
  section removed on a previous load has no row to update: `Home.refresh()` re-running the
  load is exactly that case. These arms measured cold launches, so they say nothing about
  what `insert` costs there.
- **Every mid-run recompute was a `remove`, and every one of them was
  `remove:activeRecordings`** — 7 of 7 on `remove`, and 4 of 4 unanimous on the section
  (the earlier arm did not yet capture `at`). Active Recordings returns nothing on this
  server, so its skeleton row is dropped every load; `removalIsDeferrable` refuses to defer
  it because it is not a `latest_` row, so it recomputes on the spot. **Whether that lands
  inside the run's window is a race between independent network tasks** — which is how an
  identical final structure still produces a bimodal `calls`. The extra recompute costs
  ~24 ms (`sizeMs` median 125 against 101), i.e. an EARLY one, while rows are still
  skeletons.
- **`calls = 2` implies the high bind mode, with no false positives**: 7 of 7 here, 7 of 7 in
  the 2026-08-23 arms — **14 of 14 across 80 launches**, Fisher p = 1.8e-5 on this campaign's
  40 alone.

🚨 **It is NOT NECESSARY for the extra binds, and the same instrument is what says so.** Four
of the 11 high-mode launches ran `calls = 1` — no extra recompute at all — and their `binds`
median is **232**, against **233** for the seven that had one. Identical excess, one with the
recompute and one without. So the recompute is a *rider* on whatever makes a launch high, not
its mechanism, and closing it would not be expected to move `binds`.

⚠️ **Read that as "not necessary", not as "contributes nothing"** — the two are different
claims and only the first is established. Necessity is refuted outright by the four
exceptions: a launch reaches the high mode without the recompute, so the recompute cannot be
what puts it there. *Contribution* rests only on the 232-vs-233 medians at **n=4 against
n=7**, which is far too small to exclude a real effect of a few binds. The operational
conclusion is unchanged and is the part that matters — **do not sell closing this as a bind
fix** — but do not cite it as proof the recompute costs zero binds either.

**The hypothesis that follows:** the removal SHIFTS every row below it up one slot, so a
removal landing after cells have begun binding re-binds the rows that moved, while an early one
has nothing to re-bind. That would explain both the correlation and the four exceptions.
Testing it needs the removal's PHASE, not a bigger arm — and **not** a lifetime removal
counter, which the section below shows would read 1 on every launch and separate nothing. The
`row removed` line is the instrument, and
[what it read](#what-row-removed-read-on-177-2026-08-25-n40-two-arms) is below.

##### `row removed` — WHERE the removal landed, which the run's own counters cannot see

`size recompute by` counts only the removals landing INSIDE the run's window, because
`sizeRemove` is zeroed when a run starts and read when it ends. That window is not where the
interesting removals are, and a code read says why.

**The removal is unconditional.** Every cold launch on this server drops the Active Recordings
row exactly once, and no branch on the path can skip it:

- `homeSection0-6` are **server-authoritative** — the Jellyfin server's `DisplayPreferences`,
  fetched fresh on each sign-in and deliberately never cached in the registry
  (`session.SaveUserHomeSections`). The section plan is identical launch to launch.
- `createSkeletonRows()` builds the row unconditionally for a planned section, and
  `startParallelLoads()` fires `LoadActiveRecordingsTask` unconditionally.
- `LoadItemsTask` pushes only `data.Items`, so a server with no in-progress recordings
  yields `[]`.
- `populateRowFromData` finds the row, `removalIsDeferrable` refuses to defer a non-`latest_`
  row, and it goes on the spot.

So **`sizeRemove` is not measuring whether the removal happened** — it is measuring whether it
happened to land inside the run, and a launch reading `sizeRemove 0` had the same removal
somewhere outside it. A lifetime COUNT would therefore discriminate nothing; it is 1 on every
launch. What separates the launches is *when*.

A third line answers that, emitted at the instant of the removal rather than at run end:

```text
latest-rows row removed at activeRecordings#1 cells 0/41 run 0/0
```

| Column | What it covers |
|---|---|
| `at` | `<sectionId>#<ordinal>`; the ordinal is per `HomeRows` instance — see the split warning below |
| `cells` | `cellLoadLoadsStarted`/`cellLoadBinds` on the content root at that instant, or `-1/-1` when the root carries no counters |
| `run` | `latestRowsProcessedIndex`/`latestRowsExpectedCount` — `0/0` before the run starts, `k/N` inside it, `N/N` once it has completed |

**`loadsStarted` is the discriminator and `binds` is the guard on it.** A skeleton placeholder
binds the moment it is attached (`JRRowItem.onItemContentChanged`) but starts no image load,
so `binds` is already in the tens before any real content exists while `loadsStarted` stays 0
until a real poster URL is assigned. That makes `loadsStarted 0` mean "no real content had
begun arriving" — which is also exactly what a probe reading a root with no counters on it
would print, and `binds` beside it is what tells those two apart.

**It needs no join, and that is why it is a log line rather than a read at the sweep gate.**
The at-gate `binds` / `loadsStarted` are console-only, so pairing them with a sample costs an
explicit join that a silent misalignment can pass. This line lands in `measurements.jsonl` per
sample like every other Home field, because `assembleSamples` opens a sample on the FIRST
matching line whichever end it arrives at and flushes whatever is still open at the end of the
window — so a removal before the run and a removal after it both file against the run they
bracket.

⚠️ **A second immediate removal in one launch SPLITS that launch across two samples.** A
sample closes when a line it already holds repeats, so removal #2 opens a fresh one carrying
nothing else. The ordinal is the defense: without it the record shows the expected number of
complete samples and no sign that any launch dropped two rows. **Expect `#1` on every sample;
a `#2` means the analysis has to account for a split.**

###### What `row removed` read on `.177`, 2026-08-25 (n=40, two arms)

Arms `remove-phase` and `remove-phase-b`, n=20 each, BATCAVE, both `VERIFIED CLEAN`. **Both
arms were built from an uncommitted checkout, so both series stamp `dirty: true`** over base
commit `739caef1` — the probe is the uncommitted change.

**The code read is now measured, not inferred.** A `row removed` line on **40 of 40** samples,
`at activeRecordings` on 40/40, ordinal `#1` on 40/40, no `-1/-1` reading, and
`calls - remove - insert = 1` on 40/40. The removal really is unconditional.

**`binds` at the removal was exactly 4 on every early launch**, which is the number the code
predicts and is worth keeping as the probe's own sanity check: before the libraries return
there are exactly four non-latest skeleton rows, one placeholder cell each.

**The relationship is GRADED, not bimodal** — which is why a gap-finding classifier is the
wrong reader for it:

| `loadsStarted` at the removal | n | at-gate `binds` |
|---|---|---|
| 0 | 32 | 215–222 |
| 4 | 2 | 222, 229 |
| 18–31 | 6 | 231–255 |

Spearman on `loadsStarted`-at-removal against at-gate `binds`: **+0.737** in the first arm
(exploratory), **+0.637** in the second (pre-registered, p = 2.5e-3), **+0.685 pooled**
(p = 1.1e-6). Against at-gate `loadsStarted` the pooled figure is **+0.740** (p = 4.7e-8).
Within just the 8 launches whose removal was not earliest it is **+0.767**, so the ordering is
real inside the tail and not only a zero-versus-nonzero step — though at n=8 that half is
suggestive, not established.

**A late removal is not merely a marker for a slow launch, and that was measured rather than
assumed.** `loadsStarted`-at-removal has effectively no rank association with the orchestrator's
own timings — `waitMs` **+0.031**, `taskMs` **-0.049** — and neither of those relates to at-gate
binds either (**-0.114**, **-0.154**). `totalMs` reaches only +0.190 / +0.248, far under the
+0.685 of interest.

**Where the cost turns on, mechanistically:** a removal at `loadsStarted` 4 does NOT reliably
elevate anything (one such launch sat at 222, inside the low band). Elevation appears from ~18
onward. That is the point at which the libraries have returned and the latest rows exist, so
the shift moves REAL rows rather than four skeletons — which is what the hypothesis predicts.

🚨 **The kickoff's specific sub-claim is UNSUPPORTED at n=40 and must not be repeated.** It held
that the exceptional launches were removals landing *after the run ENDS*. **Zero removals landed
after run end.** The only two phases observed across 40 launches are `0/0` (before the run
started) and `0/10` (after it started, before any row was delivered). The graded association
supports the shift MECHANISM; it says nothing about post-run removals, because none occurred.

⚠️ **This is observational and cannot settle causation.** Ruling out the slow-launch confound is
not the same as establishing that the removal CAUSES the extra binds — the same
sufficient-but-not-necessary shape retired `bindsFromSize` and the recompute itself. The
decisive test is an intervention: take the Active Recordings section out of the user's
`DisplayPreferences` so no such row exists, and see whether the elevated launches disappear.

⚠️ **An unexplained band shift, recorded rather than smoothed.** Both arms sat at an at-gate
`loadsStarted` low band of **90–91** (29 of 40), against the **100–102** band published from the
previous campaign. The earlier campaign's at-gate values were console-only and never reached
the ledger, so there is nothing to compare against directly. Both arms carry the probe, so this
does not separate "the probe's own emit perturbs the race" from "the app version differs"
(2.26.0 here against 2.25.x then). Open.

⚠️ **The high mode is not a single level.** Two launches read at-gate `loadsStarted` 112
(`binds` 238) and 122 (`binds` 255), above the 100–102 band. Both had `calls = 2`. Recorded,
not explained.

## How to run it

**Moved to [`measuring-performance.md`](measuring-performance.md).** The commands
(`npm run measure`, `measure:devices`, `measure:calibrate`), what one run does, the
calibration standing, and the two traps now live there, because they are how you take ANY
measurement — not only this one. The instrumentation this doc describes is read with:

```bash
npm run measure -- -n 10 --server http://192.0.2.10:8096   # the latest-rows family
npm run measure -- -n 10 --measurement item-grid           # the grid/genres family
```

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

**Moved to [`measuring-performance.md`](measuring-performance.md#comparing-two-arms)** —
alternating the arms, what `npm run measure:compare` refuses, and why. The floor above is
what that tool prints beside a delta it cannot distinguish.

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
