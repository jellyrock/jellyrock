---
topic: measuring-performance
related-files:
  - scripts/measure.js
  - scripts/measure-args.js
  - scripts/measure-compare.js
  - scripts/measure-report.js
  - scripts/measure-devices.js
  - scripts/measure-matrix.js
  - scripts/measure-calibration.js
  - scripts/measure-arms.js
  - scripts/measure-selection.js
  - scripts/measure-loop.js
  - scripts/measurements.js
  - scripts/measurement-guard.js
  - tests/rta/lib/nav.js
  - tests/rta/lib/steps.js
  - source/utils/cellLoad.bs
  - scripts/roku-devices.js
  - scripts/data/roku-hardware.json
  - source/utils/screenReadiness.bs
  - source/home/homeScreenLoad.bs
  - tests/rta/screens.js
last-reviewed: 2026-10-09
---

# Measuring performance on device

How to take a performance number for any registered screen on any device tier, and read it back into a figure you can publish: the commands, the ledger they write, the readers that turn it into numbers, and the rules a number has to follow to be worth anything.

**The figures here are dated readings of one developer's setup, not constants.** Each one's full record is in the commit or decision record it names. Re-measure; never design against them.

## Which doc answers which question

| Question | Doc |
| --- | --- |
| When did this screen become usable, and how does that differ across devices? | This doc: the `screen-load` family, every screen in [`tests/rta/screens.js`](../../tests/rta/screens.js) |
| How much work did a screen's cells do, and how much was waste? | This doc: the [`cell-load` family](#cell-workloads-how-much-work-did-the-cells-do) |
| Inside one orchestrator, how much time went to the network and how much to its own thread? | [`home-first-paint-performance.md`](home-first-paint-performance.md): the `home-latest-rows` and `item-grid` families |
| Did scrolling a library grid leave the user waiting at the last loaded row? | [`home-first-paint-performance.md`](home-first-paint-performance.md#grid-paging-did-the-user-wait-at-the-last-loaded-row): the `item-grid-paging` family |
| What does the API pool's coordinator spend per request? | [`api.md`](../architecture/api.md#a-request-nobody-is-waiting-for): the `api-dispatch` family |

[`scripts/measurements.js`](../../scripts/measurements.js) draws the same split between its families. `screen-load` says when a screen painted and when it stopped changing; `cell-load` says how much its cells bound and requested on the way; `home-latest-rows` says why one loader took as long as it did. A regression hunt usually starts here and ends there.

`api-dispatch` is not about a screen: the coordinator is one Task for the whole session, so a run says what the app was doing with `--nav`. It reports cross-thread work on the path every request takes, which no screen timing shows. [ADR 0040](../adr/0040-pool-skips-abandoned-reads.md) is what it was built for.

`screen-load` and `cell-load` also close at different times, which is why neither folds into the other. A readiness ledger closes when the screen stops loading; cells rebinding during a scroll happens after that.

## Two milestones per load

A screen instrumented with [`screenReadiness.bs`](../../source/utils/screenReadiness.bs) records two moments per load:

- **`paintMs`:** the screen put something on the display, what a user sees as "it opened".
- **`settledMs`:** the screen stopped changing: every fill it was waiting for has landed.

They can be far apart: `ItemDetails` paints in a few hundred milliseconds and settles more than a second later, when the resume button and the backdrop arrive. **A first paint alone flatters the app; settled alone hides when it became usable.** So every figure from this tooling carries the name of the field it came from, and the readers print it.

`npm run measure` headlines `paintMs`; `--field settledMs` headlines the other. Both are always recorded.

## What has been measured

Ask the ledger:

```bash
npm run measure:report                 # every screen, every tier, what has and has not been taken
```

Its rows come from `tests/rta/screens.js`, so a screen nobody has measured still gets a row, and the gaps show.

## How to run it

`npm run measure` is the procedure, and it records what each sample was taken against:

```bash
npm run measure -- -n 10 --server http://192.0.2.10:8096    # assert the server
npm run measure -- -n 10 --measurement item-grid             # the grid/genres family
npm run measure -- --deploy                                  # sideload first
```

**The device must have "remember me" on and be signed in.** Without a saved token every relaunch lands on the user select screen, Home never loads, and the tool reports a series of nothing.

Reach screens other than Home with `--nav <screen>`, which drives the navigation `tests/rta/screens.js` declares. When a nav passes through another instrumented screen, a launch mounts more than one, and the tool refuses a median until you name one:

- **`--component`** when the mounts are different components: every playback nav passes through `ItemDetails` on the way to the player, and for a movie both stamp variant `Movie`.
- **`--variant`** when one component mounts twice: a Season is reached through its Series.

Both are checked against what the app stamped, so a value no sample carried is refused ([ADR 0028](../adr/0028-mount-identity-component-and-variant.md)).

A screen can also mount once and load twice. `search` opens a keyboard (`--variant open`) and then runs a query (`--variant query`), recorded separately because the user's typing sits between them. A bare `--nav search` refuses.

```bash
npm run measure -- --measurement screen-load --nav settings -n 5
npm run measure -- --measurement screen-load --nav osd --component videoPlayer -n 5
npm run measure -- --measurement screen-load --nav seasonDetails --variant Season -n 5
npm run measure -- --measurement screen-load --nav search --variant query -n 5
npm run measure -- --measurement screen-load --component homeRows -n 5
```

### Home: `paint` is the visible rows landing, not the first frame

Home is landed on, so it takes no `--nav`, but it needs `--component homeRows`: every launch also mounts the `preLogin` coordinator, which records its own run. The name also keeps each launch's watch open until Home's mount is complete, and stamps the record with Home's variant so `measure:compare` can select it.

Home's rows fill from several tasks, so no one handler is its paint. [`HomeRows`](../../components/home/HomeRows.bs) declares one fill per row, keyed by `sectionId`:

- **`paintMs`:** every row in the visible span has landed. The span is `loadedRowRange`'s `[visibleStart, visibleEnd]`, the one texture loading uses: `[focusedRow, focusedRow + numRows − 1]` with `numRows = 3`. The decision is [`homeScreenLoad.visibleRowsResolved`](../../source/home/homeScreenLoad.bs).
- **`settledMs`:** every row has landed.

What that means:

- **A row lands when its answer arrives: data, an empty result or a failure.** A failed row stays on screen and still counts as landed, or Home would never settle.
- **Paint waits for the libraries.** A failed libraries load is not an answer: paint waits for one that succeeds, because until then the latest-media rows are missing and the span would describe rows about to move down.
- **The span's third row is only partly on screen** on a 1080p Stick 4K. The span is the app's idea of the viewport, not a pixel measurement.
- **The span depends on the user's section order.** With the default order (My Media, Continue Watching, Next Up, Active Recordings, On Now, Latest Media) the span is the first three, so no latest-media row gates `paintMs`. Read a Home `paintMs` with the layout it was taken on.

### A library grid on a multi-library server needs `--library`

Every library-grid nav finds its Home tile by `collectionType`, which is ambiguous as soon as the server has two libraries of a type, so the nav refuses rather than guess. The functional suite seeds a library and passes its ID; `measure` seeds nothing, so give it one:

```bash
npm run measure -- --measurement item-grid --nav moviesLibraryGrid --library <libraryId> -n 5
```

The refusal lists every matching library with its ID. `--library` only means something with `--nav`. It refuses rather than pick the first tile because Home orders library tiles differently from `/UserViews`, so the seed and the nav can mean different libraries, and a sample of the wrong library looks like a slow one.

### Cell workloads: how much work did the cells do?

The `cell-load` family counts what a screen's cells did: how often they were bound, how many binds were redundant, how many image loads started and failed, and how many failure glyphs were wiped back to loading (by a rebind or a texture reload). It covers every screen that uses the texture manager (Home, Favorites, search results, `ItemDetails` extras, library grids), because the counters live on the content root `initTextureManager` owns. It also answers whether the texture buffer won its race ([pop-in](#pop-in-did-the-buffer-win-its-race)).

```bash
npm run measure -- --measurement cell-load --nav cellSweepExtras --component ExtrasRowList -n 5
```

**The `--nav` is the denominator.** A bind count means nothing without how far the list moved, so the family's navs are scripted sweeps: open the screen, travel a fixed distance, wait for the counters to stop, leave. Leaving matters: `hideTextureManager` and `destroyTextureManager` publish the counters, so a nav that stays records nothing.

| `nav` | Measures | Component to name |
| --- | --- | --- |
| `cellSweepHome` | Home's rows | None: the only single-sample `nav` |
| `cellSweepGrid` | A library grid | `--component BaseGridView` |
| `cellSweepExtras` | `ItemDetails` extras rows | `--component ExtrasRowList` |
| `cellSweepSearch` | Grouped search results | `--component SearchRow` |

Favorites has no sweep yet. Both of Home's row lists now get their IDs when created, so `#favoritesRows` can be addressed; writing `navCellSweepFavorites` is a followup in [`progress.md`](../progress.md). The suite finds Home's active list through `homeListId()` and `focusIsInHomeContent` in [`tests/rta/lib/home-list.js`](../../tests/rta/lib/home-list.js), and `jellyrock-rta/home-list-resolved` keeps the IDs there.

Every `nav` but `cellSweepHome` mounts more than one cell-bearing screen per launch (reaching extras loads Home and the grid above them, and being hidden makes a screen publish), so the tool refuses a median until you name one. The extra samples are recorded beside it, never folded in.

**A short fixture shortens the sweep rather than failing it,** and says so:

```text
[nav] cellSweepGrid rows: fixture holds 4 entries, so the sweep clamps to 3 of 12 steps.
[nav] cellSweepGrid: swept rows (x6 tiles) 0->18 of 4, row 3 columns 18->23 of 6; cells quiet after 1669 ms
```

A clamp line means the fixture was shorter than the itinerary. Reaching the end of an axis whose length is structural (a grid row is exactly `numColumns` wide) prints nothing, so a clamp line is always news.

**Cell figures don't compare across devices.** `cellSweepGrid` travels `rowTarget × numColumns` tiles, and `numColumns` depends on the device's layout, so a cross-device grid table compares itineraries. The `RowList` sweeps travel the same distance everywhere. Compare a device against itself.

**A screen that replaces its content root starts new counters,** and the old root's are never published. `BaseGridView` and `SearchRow` do this, so a grid's figure covers the time since its last rebuild. No sweep triggers one, but a filter or sort change would.

#### Which mechanism evicted a texture: `unloadsRange` vs `unloadsWindow`

The texture manager releases textures two ways, and `unloads` can't tell them apart:

| Field | Says |
| --- | --- |
| `unloadsRange` | The cell left the managed vertical range (`loadedRowRange`, visible rows ±2). Driven by scrolling down; happens on every texture-managed screen |
| `unloadsWindow` | The horizontal item window inside a visible row evicted the cell. Only possible on a `RowList` row with more than `TEXTURE_BUFFER_THRESHOLD` (20) items, so it is the only sign horizontal windowing ran |

They add up to `unloads` by construction: [`JRRowItem.bs`](../../components/ui/rowitem/JRRowItem.bs)'s two eviction branches are the only places that count them. Both are published, so neither is found by subtraction.

**Read the split, never the total, for a question about windowing.** On Home, most of `unloads` is vertical scrolling, so a total moves for reasons that have nothing to do with the windowing under test. This also checks the instrument: at a per-row limit where no row passes the threshold, `unloadsWindow` must read 0.

#### Pop-in: did the buffer win its race?

The `popin` line measures work done in time. The ±2-row, ±1-column texture buffer exists to load a cell's image before the cell is on screen, so the user never sees a placeholder turn into a poster; this line says whether it did.

| Field | Says |
| --- | --- |
| `appearances` | Cells that came on screen expecting a real image: the denominator |
| `popIns` | Of those, how many appeared before their image |
| `popInsCold` | Of those pop-ins, how many had no request in flight: an evicted cell returning |
| `popInsReload` | Of those pop-ins, how many had a re-entry request in flight: the buffer's own race |
| `popInsFirst` | Of those pop-ins, how many were the cell's first render: first paint, not a buffer failure |
| `loadMs` / `loadMsCount` | Total and count of timed request-to-ready intervals; the mean is the quotient |
| `loadMsMax` | The slowest single image load in the session |

Rules for reading it:

- **Read `popIns` against `appearances`, never alone.** A raw count moves with how far the sweep went.
- **Quote the split, or don't quote the number.** The three kinds need different remedies. **Cold:** the user outran the buffer's depth, and more depth would help. **Reload:** the network was slower than the scroll, and depth can't fix that. **First:** the data had only just arrived, and no buffer could win. Any sweep that opens its screen is dominated by `popInsFirst`.
- **A pop-in counts only when the image arrives.** An image that never arrives is a glyph, which `loadsFailed` counts. So use `cellSweepGrid` to study pop-in, not `cellSweepExtras`: almost none of the extras fixture's person images load, so its `popIns` can hardly rise above zero, and a zero there says nothing. Extras is still the right sweep for the bind counters.
- **`loadMs` is a sum over requests running at the same time,** so it can be many times the sweep's length. Never show it as a share of anything. `loadMsMax` is bounded by the sweep and is the one to act on. Divide by `loadMsCount`, not `loadsSucceeded`: a "ready" with no matching request is a real success with no interval to time.
- **`popIns` has no minimum duration.** An image arriving 5 ms after its cell counts like one arriving a second later, so on a warm cache the count can be high while a viewer sees nothing. Read it with `loadMsMax` and the mean. There is no cutoff because no measured perceptual figure exists to set one; take one from a measurement, never a round number.
- **The buffer wins when `buffer_depth × time_per_scroll_step >= image_load_time`.** `loadMs` times every load, including images fetched ahead that the user never reached, which are the ones a depth decision depends on.
- **Appearances come from the compositor's `renderTracking`,** not the app's `getRowPosition()` and `isInHorizontalBuffer()`, whose horizontal model assumes the focused column is the leftmost visible one, which nobody has checked. `renderTracking` can flip during a layout pass, so an appearance counts at most once per bind.
- **`cellLoad.departed()` ends an appearance when the cell leaves.** A `RowList` or `MarkupGrid` doesn't rebind a cell that scrolls off and back to the same item, so without it a scroll-back would never count. On a sweep that scrolls, `appearances` and `binds` should differ: if they are equal, suspect the instrument before the number. And `popInsCold` should match `unloads`, since an evicted cell has nothing in flight when it returns.
- **A screen suspend is not a departure.** the router's `suspendMode: "hide"` keeps textures loaded and turns `renderTracking` off for every cell, which looks like every cell leaving and coming back as free wins. So `departed()` counts only while `textureManagerState = "active"`. The invariant (a resume with no scrolling pays one bind per appearance) is gated in [`cell-load.spec.js`](../../tests/rta/specs/cell-load.spec.js), since a sweep never suspends its screen.
- **The line is for scroll sweeps.** At first paint, cells appear before their data and `renderTracking` is least reliable, so read Home's first-paint pop-ins with care.

**`instrumentUs` is the instrument's own cost, and a lower bound:** `departed()` is not timed, because timing it would cost more than the function. Adding the `popin` line (#843) made the instrument several times dearer without changing the sweep's wall clock beyond its noise, so `instrumentUs` is not comparable across that change. Release builds turn `perfTiming` off, so they pay none of it.

#### The totals are cumulative: on Home, most of them are not the sweep's

`cellSweepHome` prints a second set of counts, read at the settle gate before the sweep starts:

```text
[nav] cellSweepHome: over 12 row(s) / 128 item(s) at sweep start (settled in 1977 ms), swept …;
  cells quiet after 1843 ms (binds=234 loadsStarted=164 … appearances=100 popIns=40),
  of which before the sweep (binds=218 loadsStarted=91 … appearances=25 popIns=12)
```

That is one launch, shortened and wrapped here; the real line is one row of about 400 characters, so `grep '\[nav\]'` gives one row per sweep. The ledger publishes one total per component at the end of the session, covering the screen's own load plus the sweep; this reading is the seam between them, printed as read so any split is a subtraction you can check.

- **On Home, the sweep's part is the small, steady one.** Its `binds` and `appearances` were constant across a 40-launch campaign while the totals varied, so a `cellSweepHome` figure that moves is telling you about Home's page load, not scrolling (`ebe9b64a7`).
- **`waitRowsSettled` does not mean the cells are done.** It waits for the row structure to stop changing, while dozens of image loads may still be in flight; a sweep starting there overlaps the end of the page load.
- **Keep the console line beside any figure you publish.** `measure` records the `nav`'s name, not its path. The distances in `CELL_SWEEP` ([`nav.js`](../../tests/rta/lib/nav.js)) are frozen: changing one splits the series without saying so. Add a `nav` instead.

#### Home's spread is the app's page load, not the harness

A 40-launch campaign held every harness quantity fixed (the same path on every launch, the same items, the rows already settled before the first press) and Home still bound a different number of cells each time (`1a8c5e9e7`). So the question belongs to `HomeRows` and `JRRowItem`, not `tests/rta/`, and the variation happens during page load, before the first key press. Neither harness change tried moved it. Part of it is now traced app-side: see [`size recompute by`](home-first-paint-performance.md#size-recompute-by-which-call-site-spent-them), which shows what fires on the high launches and that it rides along with the cause rather than being it.

### Reading cell figures

- **Read `binds / items` for one screen over time, never to rank screens.** On a `MarkupGrid` it is a coverage fraction: a one-way sweep binds each tile it visits about once, so 1.00 means it covered the library, not that nothing rebound. A returning grid tile reloads its texture without rebinding. On a `RowList` the ratio mixes coverage with rebinding as rows and shelves scroll, and a sweep along one row leaves most items untouched.
- **Lead a waste story with the fields that mean waste.** `bindsRedundant` is a bind to the same item at the same size, provably useless work; `wipesReload` is a failure glyph wiped on a cell that sat still, which a user sees as flicker.
- **Pool only one population.** Pool per `(nav, component)`, and only runs with the same workload, app and instrument. The same screen on the same server is not the test.
- **A run of identical readings bounds the variance from below; it doesn't measure it.** Choose the sample size from the spread you see at that size.
- **A comparison is decided by separation, not exactness.** A field that wobbles can still settle a question when the arms don't overlap.
- **Home needs about 20 to 30 runs per arm, alternated.** Its counts vary between launches, and within a campaign they have drifted with launch order, so arms run in blocks would put that drift on one arm. Use [`measure:compare`](#comparing-two-arms).
- **`bindsFromSize` is the early warning.** It should be 0; a layout change that starts re-requesting images has no other symptom.

The worked example of all of this is the reload-guard comparison (`3a93bd86c`, #840): three arms, n=10 each, interleaved. What it teaches:

- **The nulls carry the argument.** A large drop in `wipesReload` alone could mean the work moved elsewhere; `binds` and `unloads` staying flat is what rules that out. Quote them beside the headline.
- **Never derive a count by subtraction.** An earlier write-up computed successes as `loadsStarted − loadsFailed`, which counts every request still outstanding as a success; `cellLoad.loadSucceeded` exists because that figure was wrong. `loadsStarted − (loadsFailed + loadsSucceeded)` is what was still in flight.
- **Say what the campaign can't tell you.** Its fixture's cast images were nearly all missing, so "the suppressed retries recovered nothing" holds for that library only.

### More than one device

`npm run measure:devices` takes the same measurement on every Roku in `ROKU_DEVICES`, one after another, and each writes its own line to `measurements.jsonl`:

```bash
# .env or ~/.config/jellyrock/env: ROKU_DEVICES=192.0.2.10,192.0.2.11,192.0.2.12
npm run measure:devices -- --deploy --server http://192.0.2.10:8096 --nav settings -n 30
ROKU_DEVICES=192.0.2.10,192.0.2.12 npm run measure:devices -- --server … -n 5   # a subset
```

Every flag passes through to `npm run measure`. Your env file says which devices exist; [`scripts/data/roku-hardware.json`](../../scripts/data/roku-hardware.json) says what RAM tier each model is. `ROKU_IP` stays the single-device default.

**A matrix run must pass `--server <url>` or `--no-server`.** The server is the workload, so devices signed into different servers compare libraries, not hardware. With the flag, a device on the wrong server refuses before it takes a sample. A single `npm run measure` only warns, since one device has nothing to confound.

Devices run one at a time, never in parallel: `--deploy` wipes `build/`, the server is shared, and the ledger is append-only. A device that fails costs its own row; the summary names it and the exit code is non-zero. First the tool checks every device over ECP and refuses the set if one is unreachable, is a model Roku says can't run apps, or duplicates another (one Roku at two addresses, or two of one model, whose matrix columns couldn't be told apart). Each refusal prints the command for the rest.

> The refusal message in [`measure-matrix.js`](../../scripts/measure-matrix.js) gives a wrong reason: it says the record identifies a device by model, model number and RAM tier "and by nothing else". Every series also carries `deviceKey` (a hash of the ECP `device-id`), which `measure:compare` and `measure:report` expose as the `device` selector, so two series of one model can be told apart with `--select device=<key>`. The refusal may still be right because the columns would collide; its stated reason is not.

The matrix report is a separate reader over the ledger ([`npm run measure:report`](#the-matrix-every-screen-every-tier)), so it can combine runs taken weeks apart.

### Calibrating the instrument: does the ODC component move the number?

Every `measure` number is taken on an RTA build, because identity is read over ODC, so the on-device component is resident the whole session. That is a variable in every measurement, and the reason plain-build [baselines](home-first-paint-performance.md#reading-a-result) can't be compared with a `measure` series. `npm run measure:calibrate` measures it on one device:

```bash
npm run measure:calibrate -- --server http://192.0.2.10:8096            # n=30, blocks of 5
npm run measure:calibrate -- --server <url> -n 10 --block-size 5 --label smoke
```

- **Two arms from one build.** `rta` is the normal deploy. `plain` drops the component and sets `ENABLE_RTA=false` in the staged manifest, the same build state as a plain build. Dropping the component alone is not enough: RTA's manifest rewrite isn't behind `injectTestingFiles` ([`measure-arms.js`](../../scripts/measure-arms.js)).
- **`home-latest-rows`, measured by launching,** because `--nav` runs over ODC and the plain arm has none.
- **Blocks of 5, alternating,** so drift can't land on one arm. Fewer than two blocks per arm is refused.
- **The plain arm's identity is checked by enclosure:** reads taken just before and after it, with nothing writing the registry between ([ADR 0030](../adr/0030-non-odc-arm-identity-by-enclosure.md)). A block whose two reads disagree is recorded `blocked` and not published; the summary names each one, and the exit code follows that count.
- **It always redeploys the RTA build at the end,** after a Ctrl-C or a failure too (the restore is in a `finally`). A device left on a build with no ODC refuses the next `measure`, `test:rta` and sign-in. If the restore fails, the run says which arm the device is stuck on and exits non-zero.
- **The deploy checks the flag it shipped.** The `ENABLE_RTA` change is a string replace, so the deploy reads `bs_const` back and refuses to sideload if it is wrong; otherwise a `plain` arm could silently become a `no-component` arm.
- **`--label <name>`** adds a suffix to both arm labels (`rta-smoke`, `plain-smoke`). Arms are selected across the whole ledger, so without one a second run pools into the first.

#### `--against <arm>`: decomposing a delta that cleared the floor

`rta` against `plain` answers whether the numbers are comparable and nothing more: `plain` drops both the component and the compiled-in `#if ENABLE_RTA` hooks. `--against no-component` drops the component but keeps `ENABLE_RTA=true`, so against `rta` it isolates the resident component, and its difference from `plain` is the hooks.

Run it only after `rta` against `plain` shows a delta at or above the method's floor (about 120 ms at n=30 per arm, measured 2026-08-04); below that it can only say "not distinguishable". Two things before reading it:

- `provenance.enableRta` is derived from ODC answering, so this arm records `false` while its manifest says `true`. Read `provenance.deploy.bsConst` instead.
- Creating a node type that is no longer staged is a path nothing else runs. Try it small (`-n 4 --block-size 2`) before a full series.

`rta` is always one side and can't be an `--against` value: it is the only arm that can read its own identity. Read the result with the command the run prints, which names the arms it recorded:

```bash
npm run measure:compare -- --a arm=rta --b arm=plain                      # the default pair
npm run measure:compare -- --a arm=rta-decomp --b arm=no-component-decomp # --against + --label
```

`measure:compare` allows this one pair to differ in `ENABLE_RTA` ([comparing two arms](#comparing-two-arms)).

### What one run does

It takes the device lock, keeps one console connection for the whole session, relaunches n times, and appends one line per series to `.device-runs/measure/measurements.jsonl`: the timings, the workload (`rows`), the device model and Roku OS version, the app version, the build flags, and the server's identity and version. `--server` makes the server a hard check: a mismatch refuses before the first sample. Without it the tool still records the server seen at the start, checks it again at the end, and says it did not assert it. Add an instrumented screen to [`scripts/measurements.js`](../../scripts/measurements.js) rather than writing a parser.

- **The device must hold an RTA build,** since identity is read over ODC. `--deploy` guarantees it; without it the tool measures whatever is installed and refuses up front if ODC doesn't answer.
- **Without `--deploy`, `appVersion`, `commit` and `dirty` describe your working tree,** which may not be the build that ran. `checkout.deployedFromCheckout` says which, and `checkout.agreesWithDevice` compares the checkout's `bs_const` with the bracket the app stamps on its timing lines; `false` means the device runs something this checkout wouldn't build. `ENABLE_RTA` comes from ODC answering, because RTA's deploy changes it in the staged build and the committed value is always `false`.
- **An argument it doesn't know is an error,** so a typo can't quietly stop the server check.
- **Replay can't enter a series:** each sample is chosen by timestamp from the window after its own launch.
- **A window is never collapsed into one number.** Each run in it is a separate sample with its position; only position 0 feeds the median.
- **It applies no threshold and no gate.** It records; it doesn't judge.

### Trap: `bs_const=debug=true` is not a measurable build

[`printTaskThreads()`](../architecture/debug-tools.md) needs `debug=true`, so it is easy to measure in one by accident. Don't: under `#if debug`, `JellyfinDataTransformer` attaches the full raw API payload to every item, inside `emit`, and a debug build also runs the task-thread ledger on the render thread. Measure at `debug=false`, use the thread readout in a separate build, and never compare their timings.

### Trap: Roku replays its console buffer

Connecting to port 8085 makes the device replay recent output, so a new connection reads the previous run's line as a new sample, with plausible numbers. It arrives within milliseconds of connecting, even on a connection that asks for nothing. Keep one console connection for the whole session and treat each new line as the next sample; `npm run measure` does, and also selects each sample by timestamp. If you find yourself explaining an extra line, check when it arrived first.

### Optional: measuring under network latency

Only for questions about the request pool. Put a latency proxy between the device and the real server so the library stays the same and latency is the only change. [`toxiproxy`](https://github.com/Shopify/toxiproxy) works well: it changes latency through an HTTP API while running, so a sweep needs no rebuild.

> This means pointing the device's stored server URL at the proxy. Record the original first, restore it afterwards, and read it back to confirm: a device left on a dead proxy looks like a broken app. A device set up with an HTTPS URL won't sign in through a plain-HTTP proxy.

## Reading the ledger back

Every `measure` run appends to `.device-runs/measure/measurements.jsonl`. It is append-only, gitignored and kept per machine: the only copy of what your setup has measured. A fresh checkout has none, so `measure:report` says it is empty until you take a series. Two readers turn it into figures:

| Reader | Question |
| --- | --- |
| `npm run measure:compare` | Is arm A different from arm B? Two populations, one delta, a rank test |
| `npm run measure:report` | What do we know, and where are the gaps? Every screen on every tier |

**Every published figure comes out of a reader, a pooled one included.** Never compute a median, delta or percentage by hand: a hand-computed figure has been published wrong before, beside a correct one from `measure:compare`, with nothing to tell them apart (`d90d05503`). To pool arms, filter the ledger to them, rename their labels to one pair, and point `--file` at the copy. `measure:report` builds a cell with the same `buildArm` and summarizes it with the same `summarizeValues` as `measure:compare`, so there is one implementation of "median".

### The matrix: every screen, every tier

```bash
npm run measure:report                                    every family in the ledger
npm run measure:report -- --measurement screen-load       one family
npm run measure:report -- --select arm=rta                one population
npm run measure:report -- --field settledMs               headline the other milestone
```

One table per family, since a table spanning two would put different quantities in one column. The grid gives `median ×n` per screen per tier; the detail block below gives every milestone the samples carried, the workload and the yield.

A cell without a number says which kind of nothing it is:

| Cell | Means |
| --- | --- |
| `—` | Never measured: no series for that screen on that tier |
| `0 cold` | Measured and empty: series exist and none produced a usable cold sample. A fact about the app or the run, not a gap |
| `mixed` | The cell would pool more than one population: two components under one screen, an RTA and a non-RTA build, two servers, two device models of one RAM tier. No median; the note says what it mixes and how to narrow it |

`mixed` is the rule `measure:compare` applies to an arm, from the same `POPULATION_AXES`: a cell is an arm. The ledger mixes populations by design (calibration arms, three tiers, several screens and servers), so narrow with `--select`, which uses `measure:compare`'s grammar. Selecting on `arm` alone pools tiers, and both readers refuse it.

A cell can print a number after dropping most of its series, so the detail block prints the yield when it did: `2 of 18 series usable — 13 produced no cold sample, 3 not a sample`.

#### Refusal or disclosure: which side a new axis lands on

- **Refused** (`POPULATION_AXES`) when pooling changes what the number says about the app: a different screen, component, model, build flag or `ENABLE_RTA` state. There is no honest median across those, so the cell prints `mixed`.
- **Disclosed** (`PROVENANCE_AXES`) when pooling changes only which build of the app it describes: `commit`, `device`, `arm`, `appVersion`, `os`. Spanning those is why a ledger reader exists, so they are printed beside the number.

Staying silent is not an option on either side.

#### Known limitation: a multi-model fleet collapses the tier axis

`model` is refused, so two models of one RAM tier don't pool: a 1 GB Express 4K and a 1 GB Stick 4K have different chips, and a RAM tier is a memory label, not a hardware class. Calibration results on one tier have differed in ways nobody has explained (`d90d05503`), which is the evidence that differences within a tier aren't understood well enough to average. A refusal can be narrowed (`--select model=…`); a wrong median can't be undone.

The cost: narrowing by model collapses the tier axis. On a fleet with several models per tier, the matrix becomes one column per model. If that becomes normal, key the columns on `device` with `tier` as a group label; don't relax the refusal. A test pins it.

#### The provenance line: where a published median came from

Every cell with a number prints one:

```text
  itemDetails · 1GB
    paintMs     median 300.5 ms  ×2  range 197–404 ←
    workload    contentFills=2 fills=3 textureFills=1 ×2
    provenance  2 series, 2026-08-13 · commit 217d038f · device ac4701ca4a5d8a0b · arm (unrecorded) · appVersion 2.25.0 · os 15.3.4
```

One line while the cell is one population on every disclosed axis. A pooled axis breaks out with which values and how many series each:

```text
    provenance  7 series, 2 of them dated 2026-08-14 · arm (unrecorded) · appVersion 2.25.0 · os 15.3.4
                ⚠ 2 commits pooled into this median: (unrecorded) ×5 · 8b95eb99 ×2
                ⚠ 2 devices pooled into this median: (unrecorded) ×5 · ac4701ca4a5d8a0b ×2
                  narrow it: --select commit=<sha>,device=<key>
```

- **`(unrecorded)` is a value.** The oldest series predate `commit`, and folding them in would report "1 commit" for a median that is mostly of unknown origin.
- **`n of them dated` appears when only some series have dates,** since the oldest have no `startedAt` either.
- **The tally counts the series that fed the median,** not every record matched. Dropouts are the yield line's job.

#### The `samples` and `integrity` lines: what weakens the median

**`samples`** says what `n` means. The method wants n of at least 5, and resolves about 120 ms only at n=30 per arm (measured 2026-08-04). A matrix being filled in a few launches at a time has many cells below that, so expect it early:

```text
    samples     ⚠ n=1, below the method's floor of n≥5 — this median is not yet evidence
    samples     n=6; ~120 ms resolution is measured at n=30, so smaller differences cannot be called
```

**`integrity`** lists facts about the series that weaken any number from them. They are shared with `measure:compare` (`SERIES_INTEGRITY`), so the two readers flag the same series:

```text
    integrity   ⚠ 1 of 1 series taken on a dirty tree, so the recorded commit does not pin the code that ran
    integrity   ⚠ 1 of 1 series measured a build nobody attributed to a checkout, so its commit may describe code that never ran
```

| Fact | Fires when |
| --- | --- |
| Dirty tree | `dirty: true`: the commit doesn't fully describe the source |
| Unattributed build | Neither `--deploy` nor `--deployed-by`: nobody can say the build came from the recorded commit |
| Server not asserted | No `--server`, so the recorded server is what the app reported |
| Identity drift | The server identity changed, or couldn't be read again, at the end |
| Hour boundary | The series crossed the top of the hour, when a resetting fixture changes the workload |
| Hour not recorded | The series predates the flag |

- **`--select dirty=false`** narrows a cell to series with a clean tree. Records from before the field read `(unrecorded)`, which it excludes: nobody writing it down is not the same as clean.
- **None of these refuses,** because each describes the best evidence available; the failure is publishing it unqualified. A dirty tree is normal while you iterate, which is why [`flake-baseline.js`](../../scripts/flake-baseline.js) excludes such runs and a measurement reader discloses them instead.
- **`--deploy` settles the attribution warning.** A tool that deploys and then runs `measure` should pass `--deployed-by <name>`, as `measure:calibrate` does.

### Comparing two arms

Take the arms alternating (`--arm before`, `--arm after`, `--arm before`, …), never all of one then all of the other, so anything that drifts with time cancels instead of landing on one arm:

```bash
npm run measure -- -n 5 --arm before --server http://192.0.2.10:8096
npm run measure -- -n 5 --arm after  --server http://192.0.2.10:8096   # …and repeat
npm run measure:compare                              # what is in the ledger
npm run measure:compare -- --a before --b after      # the comparison
npm run measure:compare -- --a before --b after --field emit
```

An arm can be named by any recorded key (`--a commit=abc1234`, `--a device=<key>`); with no arguments, `npm run measure:compare` lists what you can select on.

What it does that a hand comparison doesn't:

- **It prints the workload delta above the timing delta,** so a run that did less work can't pass as a faster one.
- **It refuses two experiments posing as two arms:** a different screen, server, device model, RAM tier, build flavor or `ENABLE_RTA` state. A `debug=true` arm against a `debug=false` one differs before the change under test does anything. One exception since 2026-08-17: the ODC calibration, whose arms differ in `ENABLE_RTA` by design. It is a property of the records, not a flag: both arms carry an asserted identity, each arm's identity source fits its ODC state, and both agree on the server. Only `npm run measure:calibrate` produces that ([ADR 0030](../adr/0030-non-odc-arm-identity-by-enclosure.md)).
- **It refuses two arms that share a series.** Measuring an uncommitted change leaves both arms on one commit, so `--a commit=<sha> --b after` would count B's samples on both sides. Narrow one selector.
- **It says what it dropped.** A series that never reached a verdict (`blocked`, or older than `outcome`) is left out, and the count is printed beside the delta.
- **The RAM tier comes from Roku's published table,** [`roku-hardware.json`](../../scripts/data/roku-hardware.json), generated from `rokudev/dev-doc` and refreshed by a weekly sync PR, so a comparison across tiers is refused.
- **It checks the arms were interleaved,** from the sample timestamps, and says so when they weren't.
- **It reports workload drift but doesn't refuse it.** Arms at 10 rows and 9 rows are still worth reading; not noticing they differ is the mistake.
- **No threshold, no gate, no CI.**

## What this tooling does not do

- **It doesn't gate.** No threshold, no CI check, no exit code meaning "regression": an exit code says whether a comparison could be made, never what it showed. Decided twice ([`decisions.md`](../decisions.md)); what to assert instead of a timing is in [What this does not do](home-first-paint-performance.md#what-this-does-not-do).
- **It doesn't make anything faster.** It makes a claim about speed checkable.
- **It doesn't measure production.** Every number comes from a `perfTiming=true` build, and release builds force it to `false` ([why this costs production nothing](home-first-paint-performance.md#why-this-costs-production-nothing)).

## Related

- [`home-first-paint-performance.md`](home-first-paint-performance.md): the wait-vs-emit method and the splits inside `LoadLatestRowsTask` and `LoadItemsTask2`.
- [ADR 0028](../adr/0028-mount-identity-component-and-variant.md): which mount a number is about (`--component`, `--variant`).
- [ADR 0030](../adr/0030-non-odc-arm-identity-by-enclosure.md): identity by enclosure for the calibration arm without ODC.
- [`rta-tests.md`](rta-tests.md): the functional suite that shares `tests/rta/screens.js` with this tooling.
- [`debug-flags.md`](debug-flags.md): `perfTiming` and the other `bs_const` flags.
