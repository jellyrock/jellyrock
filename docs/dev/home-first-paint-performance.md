---
topic: home-first-paint-performance
related-files:
  - components/home/LoadLatestRowsTask.bs
  - components/home/HomeRows.bs
  - source/home/latestRows.bs
  - components/ItemGrid/LoadItemsTask2.bs
  - components/ItemGrid/BaseGridView.bs
  - source/api/apiPipeline.bs
  - source/constants/apiPool.bs
  - scripts/harden-prod-manifest.js
  - scripts/measurements.js
  - manifest
last-reviewed: 2026-10-09
---

# Measuring orchestrator wait-vs-emit on device

How to split an orchestrator's run on a real device into time spent waiting on the network and time spent working on its own thread, and how to read each number. How to take a measurement at all (`npm run measure`, comparing arms, the ledger) is in [`measuring-performance.md`](measuring-performance.md).

**Measure each orchestrator on its own.** Two carry this instrumentation, and they answer oppositely: Home's `LoadLatestRowsTask` is bound by its own work, and the grid's `LoadItemsTask2` genre loop by the network. A result for one says nothing about the other.

**Re-measure; never design against an old number.** The figures below are dated readings. The code under them changes, and several have been overtaken already. Each one's full record is in the commit or decision record it links.

## What is being measured

Opening Home fires one `LoadLatestRowsTask` run that fetches the latest items for every eligible library. Five log lines describe it, in builds with `perfTiming` on (see [Why this costs production nothing](#why-this-costs-production-nothing)):

```text
latest-rows run complete <n> rows <total> ms                                            # HomeRows, render thread
latest-rows orchestrator done - [debug=? perfTiming=true] task <t> wait <w> emit <e>    # LoadLatestRowsTask
latest-rows emit split - [debug=? perfTiming=true] xform <x> append <a> notify <no>     # LoadLatestRowsTask
latest-rows populate split attach <at> detach <d> other <o>                             # HomeRows, render thread
latest-rows size recompute calls <c> drains <d> ms <ms>                                 # HomeRows, render thread
```

The split lines report totals for the run, once, not one line per row. `emit split` follows `orchestrator done` on the task thread; `populate split` and `size recompute` follow `run complete` on the render thread.

**This run is not "when Home became usable".** Home also logs the `screen-load` family (`--component homeRows`): `paintMs` when the visible rows have landed, `settledMs` when every row has ([`measuring-performance.md`](measuring-performance.md#home-paint-is-the-visible-rows-landing-not-the-first-frame)). With the default section order, no latest-media row is on the first screen (read on a Stick 4K, 2026-09-15), so `total` is the wait for the rows below it.

**Read the bracketed build flags before you trust a sample.** The two `LoadLatestRowsTask` lines carry the compile-time flags they ran under. `debug=true` is not comparable with `debug=false`: a debug build attaches `rawApiData` to every item, inside `emit`. The `HomeRows` lines carry no bracket; they come from the same console session, so quote the bracket with them by hand. `run complete` is the only line not gated on `perfTiming`, so seeing it alone means `perfTiming=false`, not a run with no render work. A line from before the stamping has no bracket; treat its build as unknown unless a commit names it, and never add a bracket to an old sample.

The first two lines give four numbers, and only three are measurements:

| Value | Meaning | Trust it? |
| --- | --- | --- |
| `total` | `run complete`: every latest-media row delivered | Yes, measured |
| `wait` | Blocked on the API pool: network and server | Yes, measured |
| `emit` | Transforming items into `ContentNode`s and appending them | Yes, measured |
| `drain` | `total − task` | No: derived, never compare it |

`wait + emit ≈ task`, and `task + drain ≈ total`. When they stop adding up, something moved, and the split needs checking before any number is trusted.

### Don't trust `drain`

`drain` is the remainder of two quantities measured on different threads running at the same time. It is not the render thread's row population: it is however much render work spilled past the moment the task finished, so it swings when the two threads' overlap shifts while no work changed. Over 10 runs per device it spread 7 to 9 times and was bimodal on the 512 MB Stick. To measure render-thread cost, read `populate split`.

The total alone can't tell a slow server from slow work of our own. That distinction is what the split exists for.

## The second-level splits

### `emit split`: inside the orchestrator's loop

| Column | Covers | Thread |
| --- | --- | --- |
| `xform` | `transformBaseItemArray` plus building the carrier `ContentNode` | Its own |
| `append` | `m.top.appendChild(child)`, one rendezvous per row | Crossing |
| `notify` | The `m.top.rowReady = libId` write | Crossing |

`xform + append + notify ≈ emit` (within about 2%). A larger gap means the split is missing work.

**`notify` is not the cost of the write.** Writing a Task-node field the render thread observes parks the writer until the observer's callback returns. So `notify` is `HomeRows.onLatestRowsReady` (`drainReady` plus `populateRowFromData`), measured from the wrong side, and it is normally most of `emit`.

**It is not time this loop can win back.** Only the render thread serves a rendezvous, so a write that doesn't block moves the queuing into `wait` and `append`, which are rendezvous too, and `total` stays put. Read the three columns as one budget. [ADR 0026](../adr/0026-no-worker-pool-for-task-ui-handoff.md) has the measurements.

### `populate split`: the render thread's own work

| Column | Covers |
| --- | --- |
| `attach` | The `row.appendChildren(itemData)` call, on both of `populateRowFromData`'s branches |
| `detach` | Dropping the replaced children; in-place branch only |
| `other` | Finding and creating rows, the backdrop, section bookkeeping, and the no-data exit |

Only latest-media sections are timed: every other Home row shares `populateRowFromData` and would mix into the totals.

This is the work `notify` waits on, seen from the render side, but the two don't match exactly: `drainReady` and the per-row `child.items = []` are inside the callback and outside the split. A gap of a few percent (3 to 9% over 12 samples) is the split working; a much larger one means work went missing.

**A low `attach` is not automatically good news.** Appending into a row not yet in `m.top.content` (the re-insert branch) measures about 0, while `total` got worse. `detach ≈ 0` in a sample means a re-insert run, whose `attach` can't be compared with a normal one: decide on `total`. Details in [`per-item-cross-thread-appends`](../architecture/tech-debt.md#per-item-cross-thread-appends).

### `size recompute`: how often the row geometry was rewritten

`setRowItemSize()` rebuilds `rowItemSize`, `rowHeights` and `rowSpacings` and writes all three to the `RowList`. It costs far more than the arrays suggest, and it runs once per structural change: a row removed because its library returned nothing, or put back because an empty one now has data.

| Column | Covers |
| --- | --- |
| `calls` | How many times the recompute ran during the run |
| `drains` | How many `rowReady` observer wakes delivered the run |
| `ms` | Total time inside `setRowItemSize()` |

Both counts start when the run starts, so the recompute after the skeleton rows are inserted is not in them. Three things to know when reading them:

- **`ms` is part of `other`**, not a fourth column beside it. Summing `attach + detach + other + ms` against `notify` counts it twice.
- **`drains` is there to stop one wrong fix.** `onLatestRowsReady` drains a list, so coalescing the recompute there looks obvious. It buys nothing: on a Stick 4K, 11 rows arrive over 11 separate wakes, one row each. The batch that works is the whole run.
- **The price per call is not fixed.** It grows with how much content is in the tree when the write lands (roughly 85 ms early in a load, 200 ms after every row is filled), so `calls` alone doesn't predict `ms`.

The run batches its own removals and one recompute to the end. That makes the cost bounded as well as smaller, and it is worth most on a server with many empty libraries. The measurements are in the commit of #799.

**Defer the removals with the recompute, never the recompute alone.** Deferring only the recompute leaves the row list shorter than the three arrays, so every row below a removal draws at its neighbor's size. The re-insert branch is the mirror case (more rows than entries) and recomputes at once, which it can afford because it is rare.

**Only the run's own rows are deferred.** Continue Watching, Next Up, On Now and Active Recordings share `populateRowFromData` but come from `startParallelLoads`, which races the run, and their tasks can fire again mid-run (`onProgramsExpired`, `Home.refresh()`). They remove and recompute at once, which is why `calls` can read above 1 when a non-library section is empty. The rule is `latestRows.removalIsDeferrable`, unit-tested; what it costs is in [`home-row-size-recompute-per-row`](../architecture/tech-debt.md#home-row-size-recompute-per-row).

**To check a layout bug like that one, poll a structural invariant through ODC**, not a screenshot. Compare `rowItemSize.count()` with the live child count and, when they disagree, each row's `cursorSize` with the entry applied to it: a length mismatch alone is not a defect, so the check has to name the visible row drawn at the wrong size. Build with the RTA deploy so ODC is injected, cold-start through ECP, and poll until the run settles.

**Check that the server's scheduled tasks are idle before a campaign.** A library scan running mid-campaign shows up as the app getting slower, and nothing in the timings says the server is busy.

#### `size recompute by`: which call site spent them

`calls` can't say who asked for a recompute, and the two mid-run callers have different fixes. A second line attributes them:

```text
latest-rows size recompute by remove 1 insert 0 at remove:activeRecordings
```

| Column | Covers |
| --- | --- |
| `remove` | Recomputes from `removeRowAtIndex`: a non-latest section returned nothing and its row was dropped mid-run |
| `insert` | Recomputes from `populateRowFromData`'s insert branch: a section without a row gained one |
| `at` | The section IDs behind those counts, in the order they fired; `-` when only the end-of-run flush ran |

**`calls - remove - insert` is the end-of-run flush, so it is 0 or 1.** Any other value means a recompute came by a path neither counter tags. No gate checks it, so check it yourself on every arm, over `.device-runs/measure/measurements.jsonl`:

```js
s.timings.sizeCalls - s.timings.sizeRemove - s.timings.sizeInsert  // must be 0 or 1
```

Gating it is [`measurement-invariants-ungated`](../architecture/tech-debt.md#measurement-invariants-ungated). `at` is a string, so it goes in the sample's `dimensions`, not its `timings`: a row ID is not a quantity.

On a cold launch every planned section gets a skeleton row before data arrives, so the insert branch can't be reached and `insert` reads 0. A refresh (`Home.refresh()`) can reach it. What the readings showed about Active Recordings and extra binds is in [`home-row-size-recompute-per-row`](../architecture/tech-debt.md#home-row-size-recompute-per-row).

##### `row removed`: when the removal landed

`size recompute by` counts only removals inside the run, because `sizeRemove` is reset when a run starts. On a server with no recordings in progress, the Active Recordings row is removed on every cold launch, so what separates launches is when the removal lands. This line is logged at the moment of the removal:

```text
latest-rows row removed at activeRecordings#1 cells 0/41 run 0/0
```

| Column | Covers |
| --- | --- |
| `at` | `<sectionId>#<ordinal>`; the ordinal counts per `HomeRows` instance |
| `cells` | `cellLoadLoadsStarted`/`cellLoadBinds` on the content root at that moment, or `-1/-1` when the root has no counters |
| `run` | `latestRowsProcessedIndex`/`latestRowsExpectedCount`: `0/0` before the run, `k/N` during it, `N/N` after |

- **`loadsStarted` tells launches apart, and `binds` checks it.** A skeleton placeholder binds as soon as it is attached but starts no image load, so `loadsStarted 0` with `binds` in the tens means no real content had arrived yet.
- **`-1/-1` should never appear in `HomeRows`.** The counters are attached to the content root in `init()`, under the same `perfTiming` gate. The value is kept so the capture pattern never drops the whole line, which would read as "no removal".
- **A second immediate removal in one launch splits it across two samples**, because a sample closes when a line it holds repeats. Expect `#1` on every sample; a `#2` means the analysis has to allow for a split.
- **It sees immediate removals only.** A `latest_` row whose library returned nothing is dropped at run end by `applyPendingRowRemovals`, through `removeChildIndex()`, which logs nothing. Covering those needs one line carrying a count: one line per row would split the sample.

The readings and what they did and did not establish are in [`home-row-size-recompute-per-row`](../architecture/tech-debt.md#home-row-size-recompute-per-row) and the commit of #862.

## How to run it

The commands and their traps are in [`measuring-performance.md`](measuring-performance.md). For this instrumentation:

```bash
npm run measure -- -n 10 --server http://192.0.2.10:8096   # the latest-rows family
npm run measure -- -n 10 --measurement item-grid           # the grid/genres family
```

## Reading a result

- **Decide on `total`.** At n=10 the per-column split is noisy enough to reverse sign between samples, and it will supply a mechanism story for whichever answer you expect. Use a rank test, not a median difference: `npm run measure:compare` runs it ([comparing two arms](measuring-performance.md#comparing-two-arms)).
- **Know the floor.** At n=30 per arm the method resolved differences of about 120 ms and up (measured 2026-08-04 on three devices); smaller effects sit inside run-to-run spread. `measure:compare` prints the floor beside a delta it can't tell apart.
- **Check the work was the same.** A run that renders fewer items looks like a faster one. Read the content tree off the device on both builds (rows, `latest_` rows, items, tiles per row) before you claim a win.
- **Keep the transport the same on every device** you compare.

As of 2026-08-04, `emit` was the largest part of Home's run on every device class, about half of it. Cutting it came from giving the render thread less to do (attaching each row's items in one `appendChildren` call), not from more task threads ([ADR 0026](../adr/0026-no-worker-pool-for-task-ui-handoff.md)).

## How high the per-row limit can go

`uiHomeRowLimit` sizes Home's latest-media rows. A sweep on a Stick 4K on 2026-08-26 went to 800 items per row, eight times the setting's maximum of 100, so every value a user can pick sits inside measured range. `attach` stayed flat across a 7.4 times change in item count, because `RowList` keeps only `TEXTURE_BUFFER_THRESHOLD` textures per row resident and virtualizes the rest. The marginal transform cost was about 0.76 ms per item. The figures are in the commit of #864.

**The ceiling is total items, and past it rows go missing without an error.** When `PIPELINE_RUN_MS` expires, `apiPipeline` hands back every undelivered entry with `res = invalid`, and `HomeRows` leaves a failed row standing. Since 2026-09-16 the budget counts only time waiting on the server, and that wait grows with request size, so the ceiling depends partly on the user's server. A per-row number can't express a total, which is why the maximum is 100 and not the highest value measured. An enforced ceiling, if one is ever added, should count total items.

## Why this costs production nothing

The instrumentation is gated on its own `bs_const`, `perfTiming`. It is `true` in the committed `manifest` and forced to `false` in every release build.

- **It is not gated on `debug`,** because a debug build attaches `rawApiData` to every item inside `emit`, the quantity being measured. Separate flags keep "measure the app" apart from "test its error paths".
- **`roku-log` stripping alone is not enough.** It removes the log call in production, but not the `roTimespan`s and per-item `mark()` and `totalMilliseconds()` calls that feed it.

### `#if` is evaluated on the device, not by `bsc`

- `bsc` passes `#if` through unchanged, so the built `.brs` always contains `roTimespan`. Grepping the build output proves nothing.
- Roku's compiler evaluates `#if` at load time from the `bs_const` line in the shipped `manifest`. That file alone decides what production runs.
- A `manifest.bs_const` in `bsconfig.json` changes only BrighterScript's in-memory manifest; the `manifest` file is copied to `build/` unchanged. Don't use it to enforce this.

So [`scripts/harden-prod-manifest.js`](../../scripts/harden-prod-manifest.js), the last step of `npm run build:prod`, forces `debug`, `perfTiming` and `ENABLE_RTA` to `false` in `build/manifest` and prints what it changed. Every route to a release goes through it, `npm run package:signed` included. To check, read the manifest:

```bash
npm run build:prod && grep bs_const build/manifest
# bs_const=debug=false;ENABLE_RTA=false;perfTiming=false
```

This also guards against shipping `debug=true`, which is the only way to see `m.log.debug` output, so it is in working trees often. It has been committed by mistake before ([`build-and-tooling.md`](../architecture/build-and-tooling.md)).

### Turning the numbers off

Set `perfTiming=false` in `manifest` and rebuild, when you want the clocks out of the way while profiling something else. The lines then disappear entirely, which is why the default is `true`: instrumentation nobody runs stops being a baseline.

## The grid's genre loop

`LoadItemsTask2` carries the same two clocks:

```text
item-grid load done - items <n> genreFetches <g> firstPaint <f> handoff <h> [debug=? perfTiming=true] task <t> wait <w> emit <e>
item-grid load done - items 8 genreFetches 8 task 1060 wait 827 emit 211
```

- **`handoff`** is the part of `emit` spent writing `status` and `content`, the crossing that carries the page to the view, so `emit − handoff` is building the nodes. Older lines lack it and still parse.
- **`genreFetches`** says which shape ran. A plain grid load is one query and a transform loop (`genreFetches 0`). A **Genres** load is one query plus one fetch per genre, so the genre count is what makes it network-bound. To reach that view, seed `display.<libraryId>.landing` to `Genres` (`seedLibraryLanding`).
- **On a 12.0 server, a page with alternate versions also pays a display-progress lookup** (up to two requests, once per run; [`playback.md`](../architecture/playback.md#what-a-tile-shows--versiondisplaycorrectdisplayprogress)). It counts as `wait`.

The genre loop measured mostly `wait` (78% on 2026-08-04), the opposite of Home, so its fix was overlapping the fetches with `apiPipeline` rather than cutting `emit`. The before and after figures are in [`tech-debt.md`](../architecture/tech-debt.md) and the commit of #810.

**To project a pipelining change, shrink `wait` and hold `emit` fixed.** `wait` is time inside `apiPipelineNext` and `emit` is time outside it, so `task ≈ wait + emit` by construction. Overlap makes the measured wait smaller; it never makes `emit` free.

### `m.log` faults past nine arguments

`Logger.info` takes ten parameters, and the roku-log plugin uses the first for the file path, leaving nine for the call. More is not a compile error: it faults at runtime with `Wrong number of function parameters (&hf1)` and stops the app in the debugger mid-load. That is why `size recompute` is its own line and not three more columns on `populate split`.

A hung app looks like something else: ODC requests time out, `getValue` returns `undefined` for every node, so navigation reports "screen never loaded", and the UI sits on a spinner. The device console names the file and line, so read it first.

## Grid paging: did the user wait at the last loaded row?

`item-grid load done` times one page. It can't say whether a user scrolling the grid reached the last loaded row before the next page arrived, which is the wait they see. `BaseGridView.logGridSession()` answers that, with one line per grid query, printed when the grid starts a new query (options, a letter, a voice search) or is destroyed. So a run has to leave the grid for the line to appear. Like the others, it exists only in `perfTiming` builds.

```text
item-grid paging - stalls <s> stallMs <ms> furthestRow <r> appendMs <a> appendMaxMs <m> pages <p> items <i> pageMs <avg>
item-grid paging - stalls 1 stallMs 70 furthestRow 107 appendMs 262 appendMaxMs 34 pages 8 items 800 pageMs 1360
```

| Field | Reads |
| --- | --- |
| `stalls` / `stallMs` | How many times, and for how long in all, focus sat on the last loaded row with a page in flight, counted before the "Loading more" indicator's delay |
| `furthestRow` | The deepest row focus reached |
| `appendMs` / `appendMaxMs` | The render thread adding each page's items, summed and at the worst page. A long add is a scroll hitch no task-side number shows. Absent before #1046 |
| `pages` / `items` | What had loaded when the user left |
| `pageMs` | The running average page time the paging rule plans with (`gridPaging`) |

`furthestRow`, `pages` and `items` are outcomes: a press at the last loaded row goes nowhere, so a grid that loads faster lets the same scroll go further. The scroll is the fixed input.

### Taking it

```bash
npm run measure -- --measurement item-grid-paging --nav gridScroll -n 6
```

`gridScroll` (`navGridScroll` in `tests/rta/lib/nav.js`) opens the Movies grid, waits for focus in it, rests 3 s, presses Down every 150 ms (plus one ECP round trip) for 20 s, waits 3 s for a page in flight, and presses Back. The presses are timed, not walked: a walk waits for focus before each press, so it never outruns the loaded rows and reads zero stalls on any build. Each launch prints `[nav] gridScroll: <n> Down presses … focus came to rest on row <r>`, which shows two runs did the same work.

`measure` doesn't do two things for you:

- **Sign the device in to the server under test.** It measures whatever the device is signed in to: use `scripts/measure-signin.js`, and `npm run rta:restore` after.
- **Seed the library's landing view.** It warns, and a Genres landing fails the nav rather than measuring the wrong screen. A server with more than one movies library needs `--library <id>`.

**Alternate the arms; never compare series taken hours apart.** The same device, build and scroll has read several times slower in one series than in another the same night, with no cause found. `measure:compare` checks the alternation. Readings from 2026-09-26 on a large library are in the commit of #1049.

## What this does not do

There is no CI gate on these numbers. They depend on the server's hardware, the library, the network and the device model, none of which CI controls, so a threshold can't tell a regression from a busy server, and a flaky gate teaches people to ignore it.

The lasting protection is structural: assert the mechanism in an ordinary test, the way the `no-raw-run` plugin holds the thread bound. A timing tells you something got slower; a structural test tells you what broke. For batching, the mechanism to assert is the number of crossings (a handoff attaches its items in one call, not N). That is a property of the source, so a lint rule or a plugin could hold it. Nothing asserts it today.
