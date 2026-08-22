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
  - tests/rta/screens.js
last-reviewed: 2026-08-22
---

# Measuring performance on device

**How to take a per-screen performance number, on any registered screen and any device
tier, and read it back into a figure you can publish.** This is the entry point for the
measurement tooling: the commands, the ledger they write, the readers that turn it into
numbers, and the rules those numbers have to obey to be worth anything.

## What this doc is for, and what the other one is for

There are two performance docs and they answer different questions. Neither is derivable
from the other, and putting a number in the wrong one is how a comparison gets made across
two quantities that share a name.

| Question | Doc |
|---|---|
| *When did this SCREEN become usable, and how does that differ across devices?* | **this doc** — the `screen-load` family, every screen in [`tests/rta/screens.js`](../../tests/rta/screens.js) |
| *How much work did a screen's CELLS do, and how much of it was waste?* | **this doc** — the [`cell-load` family](#cell-workloads--how-much-work-did-the-cells-do) |
| *Where did the time go INSIDE one orchestrator — waiting on the network, or working on its own thread?* | [`home-first-paint-performance.md`](home-first-paint-performance.md) — the `home-latest-rows` and `item-grid` families |

The split is the same one [`scripts/measurements.js`](../../scripts/measurements.js) draws
between its measurement families. `screen-load` says **when** a screen painted and when it
stopped changing; `cell-load` says **how much** its cells bound and re-requested along the
way; `home-latest-rows` says **why** one loader took as long as it did. A regression hunt
usually starts here and ends there.

`screen-load` and `cell-load` also differ in WHEN they close, which is why neither could be
folded into the other. A readiness ledger closes when the screen stops loading; a cell
rebind storm during scrolling happens entirely after that, so it is invisible to one and is
the whole subject of the other.

## The two milestones, and why one number is not enough

A screen instrumented with [`screenReadiness.bs`](../../source/utils/screenReadiness.bs)
emits **two** moments per load, and both are recorded:

- **`paintMs`** — the screen put something on the display. This is what a user perceives as
  "it opened".
- **`settledMs`** — the screen stopped changing: every async fill it was waiting for has
  landed.

Nearly every screen has both, and they can be far apart. `ItemDetails` on a 1 GB Stick 4K
paints at ~300 ms and settles at ~1950 ms, because the resume-watching button and the
backdrop arrive after the first paint. **A single "first paint" flatters the app; a single
"fully settled" hides when it became usable.** Quoting one without saying which is the
failure this split exists to prevent — so every figure taken from this tooling carries the
field name it came from, and the readers below print it.

`npm run measure` headlines `paintMs`; `--field settledMs` headlines the other. Both are
always in the record, so a number taken today can be re-read against the other milestone
later without going back to the device.

## What is measurable today

Ask the ledger rather than this paragraph — it goes stale and the ledger does not:

```bash
npm run measure:report                 # every screen, every tier, what has and has not been taken
```

The row set comes from [`tests/rta/screens.js`](../../tests/rta/screens.js), so a screen
nobody has ever measured still gets a row. That is deliberate: a table built only from what
is *in* the ledger cannot show you what is missing from it, and what is missing is the
question a coverage matrix exists to answer.

## How to run it

**`npm run measure` IS the procedure.** There is no hand method to fall back on any more —
see [the retirement note](#the-manual-procedure-is-retired) below for why the old one was
removed rather than kept as an alternative. One command, and it writes down what the sample
was taken against:

```bash
npm run measure -- -n 10 --server http://192.0.2.10:8096    # assert the server
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

A screen can also mount once and load TWICE, which needs the same flag for a different
reason. `search` opens a keyboard (`--variant open`) and then runs a query
(`--variant query`), and the two are separate ledger runs because the user's typing sits
between them — a single run would time the typing. So a bare `--nav search` refuses, and
the variant says which of the screen's two loads the number is about.

```bash
npm run measure -- --measurement screen-load --nav settings -n 5
npm run measure -- --measurement screen-load --nav osd --component videoPlayer -n 5
npm run measure -- --measurement screen-load --nav seasonDetails --variant Season -n 5
npm run measure -- --measurement screen-load --nav search --variant query -n 5
```

### ⚠️ A library grid on a multi-library server needs `--library`

Every library-grid nav resolves its Home tile by `collectionType`, and **that is ambiguous
the moment the server has more than one library of a type** — so the nav REFUSES rather
than guessing which one it opened. It is not a rare shape: a server with four movie
libraries and two TV libraries hits it on the first launch of `moviesLibraryGrid` *and*
`tvLibraryShows`.

The functional suite never trips this because it seeds a library and passes that id.
`measure` seeds nothing, so you have to hand it one:

```bash
npm run measure -- --measurement item-grid --nav moviesLibraryGrid --library <libraryId> -n 5
```

The refusal prints every matching library with its id, so the id you need is in the error
you just got — run it once without `--library`, then paste one in. `--library` only means
something alongside `--nav`.

**Why it refuses instead of picking the first tile:** Home orders library tiles differently
from `/UserViews`, so seed and nav can silently disagree about which library they mean.
That already produced a valid-looking but wrong measurement — a 12-genre library sampled
where an 8-genre one was seeded. A wrong-library sample is indistinguishable from a slow
one after the fact.

### Cell workloads — how much work did the cells do?

The `cell-load` family counts what a screen's CELLS did: how many times they were bound,
how many of those binds were redundant, how many image loads started and failed, and how
many failure glyphs were wiped back to a loading state (split by whether a rebind or a
texture reload did it). It covers every screen that uses the texture manager — Home,
Favorites, search results, `ItemDetails` extras and library grids — because the counters hang
off the content root that `initTextureManager` already owns, so no screen has a call site of
its own.

It also answers the question the others cannot: **did the texture buffer win its race?** See
[the pop-in line](#pop-in--did-the-buffer-win-its-race) below.

```bash
npm run measure -- --measurement cell-load --nav cellSweepExtras --component ExtrasRowList -n 5
```

> **Provenance, because the squash message understates it.** The ledger (`source/utils/cellLoad.bs`
> and its instrumentation of `JRRowItem` / `GridItem` / `textureManager`) and the scripted sweeps
> that give it a denominator were built in separate sessions but landed on `main` in **one squash,
> [`7cb73074`](https://github.com/jellyrock/jellyrock/pull/838)**. The ledger half had been
> committed to a local `main` and never pushed, so the branch carried it and the PR body — which
> becomes the commit message here — describes only the harness half and says the change touches no
> app code. It does: ~353 lines of it. Nothing is wrong with the code (that half was reviewed and
> device-tested on its own), but anyone bisecting cell-load behavior should know both halves
> arrive at the same commit rather than looking for an earlier one.

**The `--nav` is not optional here, and it is not just navigation — it IS the denominator.**
A bind count means nothing without knowing how far the list was scrolled to produce it, so
the family's `nav`s are scripted SWEEPS: open the screen, travel a fixed distance through it,
wait for the counters to stop moving, then leave. The leaving is load-bearing — the counters
are published by `hideTextureManager` / `destroyTextureManager`, so a walk that stays on its
screen records nothing at all.

| `nav` | Screen it measures | Component to name |
|---|---|---|
| `cellSweepHome` | Home's rows | *(none — the only single-sample `nav`)* |
| `cellSweepGrid` | a library grid | `--component BaseGridView` |
| `cellSweepExtras` | `ItemDetails` extras rows | `--component ExtrasRowList` |
| `cellSweepSearch` | grouped search results | `--component SearchRow` |

`Favorites` is the one cell-bearing screen with no sweep. `Home.onTabChanged` re-creates
both row lists with `CreateObject` and assigns no id, so RTA can only address the active one
by child index — the fragility
[`rta-home-active-list-hardcoded`](../architecture/tech-debt.md#rta-home-active-list-hardcoded)
already tracks. Restoring the ids is an app change with its own device-test cost, so it is
tracked as a followup rather than folded in here.

#### Pop-in — did the buffer win its race?

Every counter above measures work **done**. The `popin` line measures work done **in time**,
which is the only thing the ±2-row / ±1-column texture buffer exists for: load a cell's image
BEFORE the cell is on screen, so the user never watches a placeholder turn into a poster.
Nothing in the app observed whether it succeeded until this line existed.

| field | what it says |
|---|---|
| `appearances` | cells that came on screen expecting a real image. **The denominator** |
| `popIns` | of those, how many appeared *before* their image did |
| `popInsCold` | of those pop-ins, how many had no request even in flight yet — an EVICTED cell returning |
| `popInsReload` | of those pop-ins, how many had a RE-ENTRY request in flight — the buffer's own race |
| `popInsFirst` | of those pop-ins, how many were the cell's FIRST render — first paint, not a buffer failure |
| `loadMs` / `loadMsCount` | total and count of timed request→ready intervals; the mean is the quotient |
| `loadMsMax` | the slowest single image load in the session |

🚨 **Read `popIns` against `appearances`, never alone.** A raw count moves with how far the
sweep traveled — the same trap that makes `binds` meaningless without `items`.

**A pop-in is scored only when the image ACTUALLY ARRIVES, and that is load-bearing.** An
image that never arrives is not pop-in — the user sees a glyph, not a fade-in — and
`loadsFailed` already counts it. Scoring at appearance time instead would make
`ExtrasRowList`, which fails 117 of 140 loads against a real server because the Person images
are gone, report a total buffer failure caused entirely by missing artwork.

🚨 **The same property makes `ExtrasRowList` UNABLE to validate this line, which is worth
knowing before reaching for it as the reproducible screen.** Measured 2026-08-21 on `.177`,
n=5, every sample identical: it issues 43 loads and exactly **1** of them succeeds. A pop-in
scores only on arrival, so `popIns` there has a **ceiling of 1** and reading 0 says nothing
about the buffer. Extras remains the right screen for the BIND counters — its sweep is bounded
and reproducible where Home's is not — and the wrong one for the pop-in line. Use
`cellSweepGrid`, whose 34 loads all succeed.

**The three-way split is what decides what to do about a bad number**, and all three are
emitted so none has to be derived by subtracting the others — the inference `loadsSucceeded`
itself exists to stop. **Cold**: no request in flight when the cell appeared, so it arrived
from outside the managed range and the user outran the buffer's DEPTH — more depth would help.
**Reload**: a re-entry request was already running and the network was slower than the scroll —
depth cannot fix that one. **First**: the cell's first render was still loading, so the data
had only just arrived and no buffer could have won. Three different remedies, two counters
apart.

🚨 **`loadMs` is a SUM OVER CONCURRENT REQUESTS and is NOT a share of the wall clock.**
Measured **16416 ms inside an ~1800 ms sweep — 9.1×** — because a grid has ~34 posters in
flight at once. Same hazard `screen-load`'s `contentMs` carries, same rule: never render it as
a percentage of anything. `loadMsMax` **is** bounded by the sweep and is the one to act on.
First readings on `.177` against a LAN server: mean **483 ms** per poster, max **877 ms** — the
first `image_load_time` figures this project has had.

**`loadMs` is the term the buffer's own adequacy condition needs.** The buffer wins when
`buffer_depth × time_per_scroll_step >= image_load_time`, and `image_load_time` had never been
observed. It is timed for EVERY load, including images the buffer fetched ahead of time and the user never reached —
exactly the ones a depth decision depends on. ⚠️ **Divide by `loadMsCount`, not by
`loadsSucceeded`**: a "ready" with no matching issue (Roku re-reporting a URI that was never
re-requested) is a real success with no interval to record, so the two counts legitimately
differ. That is the same inference-by-subtraction `loadsSucceeded` itself exists to stop.

⚠️ **The appearance signal is the compositor's `renderTracking`, not the app's own
`getRowPosition()` + `isInHorizontalBuffer()`.** Deliberate: the horizontal half of the app's
model assumes the focused column is the LEFTMOST visible one, an assumption the buffer arithmetic
makes and that has never been verified. Scoring the buffer against its own coordinate system
would bake that unverified premise into the number. `renderTracking` can flip spuriously
during a layout recalculation — which is why the app refuses to *act* on it — so an appearance
is counted at most once per bind, making a spurious flip a no-op rather than a fresh sample.

🚨 **`popIns` does NOT filter by duration, and that changes how "near zero" can be read.**
An image that fills 5 ms after its cell appears counts exactly the same as one that fills a
second later, and the first is imperceptible. So on a warm HTTP cache at LAN speed the count
can run high while a viewer sees nothing at all — `popIns` alone cannot be driven to zero and
should not be treated as a target on its own. **Read the pair**: `popIns` says how often the
buffer lost, `loadMsMax` and the `loadMs / loadMsCount` mean say whether losing mattered.

No duration filter is applied because there is no measured perceptual figure in this repo to set one from,
and inventing one is the specific mistake that had to be withdrawn on 2026-08-21 (a ~3 s
first-paint target that existed nowhere). If a cutoff is wanted later it should come from a
measurement, not from a plausible round number.

🚨 **`popInsFirst` dominates any sweep that OPENS its screen, and the combined count cannot
be read without it.** Measured 2026-08-22 on `cellSweepGrid` (`.177`, n=5, every sample
identical on every field): **46 appearances, `popIns` 24 = `popInsFirst` 17 + `popInsCold` 6 +
`popInsReload` 1.** Seventeen were cells bound while their data was still arriving, where no
buffer could have won. The remaining seven are re-entries, and they are the buffer's own
scoreboard: 28 binds against 46 appearances means **18 re-entries**, of which **12 showed
their image immediately** — the buffer held it — while **6 came back evicted and empty** and
**1** lost a live reload race. Quote the split, or do not quote the number.

⚠️ **An earlier revision of this section reported "`popInsCold` 0, so the buffer won 6 of 7
re-entry races." That was WITHDRAWN on 2026-08-22 and its conclusion inverted** — see the
re-entry warning below. It was never a measurement of re-entries at all.

⚠️ **The instrument's own footprint more than DOUBLED when this line was added, recorded
rather than rounded away.** Same grid sweep, same device and session, app code the only
difference: `instrumentUs` **`2710 µs` → `7640 µs`, +182% (2.82×)** as shipped. It is
nonetheless not a perturbation of what it measures — 0.15% → 0.41% of the sweep, workload
identical in both arms on every field (`binds` 28, `loadsStarted` 34, `loadsSucceeded` 34,
`reloads` 7, `unloads` 6), and cells-quiet wall clock moved from a median of 1842 ms to
1847 ms, which is **+5 ms against the before-arm's own 1835–1865 ms spread** — inside its
noise, not distinguishable from it. `perfTiming` is forced off for release artifacts by
`harden-prod-manifest.js`, so a shipped build pays none of it. **Consequence to know:
`instrumentUs` is NOT comparable across this change** — there is a 2.82× step here, and a
series spanning it shows a jump that is the instrument, not the app. The relative figure surfaced only because a before-arm
was taken; the "0.36% of wall clock" argument alone would have concluded there was nothing to
see.

🚨 **A re-entry is only counted because `departed()` ends the appearance episode — and
without it the metric silently measured almost nothing it was built for.** An appearance is
scored once per episode, and the episode has to close when the cell LEAVES. The first cut
re-armed only on bind, and a `RowList` / `MarkupGrid` does **not** rebind a cell that scrolls
off and back onto the same item (`onItemContentChanged` never fires) — so every scroll-back
hit the once-per-episode gate and was skipped. **The evidence was sitting in the ledger and
was walked straight past:** `binds` 28 against 28 `items` means nothing was rebound all sweep,
while `reloads` read 7. All seven re-entry races went unmeasured, and the line still
published a confident-looking `popInsReload` 1. Fixing it moved `appearances` 28 → 46 and
`popInsCold` 0 → 6. **If you add a screen and see `appearances` equal to `binds`, suspect this
before believing the number** — on a sweep that scrolls, they should differ.

⚠️ **A prediction made before that re-measure was wrong in an instructive way.** The expected
rise was 28 → ~34, reasoning that re-entries would be bounded by `unloads` (6). It came back
**46**. The two are different **by design**: leaving the visible window is not eviction, and a
cell sitting in the ±2-row buffer stays loaded. So 18 re-entries produced only 6 evictions —
which is the buffer working, and is the distinction the whole `popInsCold` split rests on.
The corroboration worth trusting is that **`popInsCold` equaled `unloads` exactly — 6 — on
all five launches**: an evicted cell has nothing in flight when it returns, so two independent
counters agree on what the code says must happen.

🚨 **An appearance is scored per EPISODE, and a screen SUSPEND is not an episode boundary.**
sgRouter suspends rather than destroys (`suspendMode: "hide"` — Home, and any grid with a
detail open over it), and `visible=false` propagates down to every cell's `renderTracking`.
Read naively that looks exactly like the whole screen departing and then re-arriving. It is
not: `hidden` deliberately freezes textures loaded so returning is instant, so every one of
those re-arrivals is a guaranteed **non**-pop-in. Left uncounted-for they land in the
denominator of `popIns / appearances` as free wins and flatter the buffer. The INVARIANT is
the app property worth remembering — *on a resume with no scrolling, every appearance must
be paid for by a bind* — and the counts under it are a fixture's, not a constant. Measured
2026-08-22 on `.177` against the **demo server** (`tests/rta/config.js`, so it reproduces
for anyone): backing out of one item detail onto the Movies grid, scrolling nothing, read
**18 appearances against 10 binds with 0 pop-ins**. `cellLoad.departed()` is therefore gated
on `textureManagerState = "active"` in both cell components, matching the refusal
`evaluateTextureState` already makes for the same flip. Gating it costs nothing on a sweep:
on a **real server**, `cellSweepGrid` read 46 / 24 / 6 / 1 / 17 on every one of 5 launches,
identical before and after, because a sweep never suspends its screen. That is also why no sweep
measurement could have caught this, and why the invariant is a gate in
[`tests/rta/specs/cell-load.spec.js`](../../tests/rta/specs/cell-load.spec.js) instead.

⚠️ **`instrumentUs` is a LOWER BOUND: `departed()` is deliberately not probed.** That was
measured rather than argued — on a **real server**, same fixture in both arms, adding the
probe took `instrumentUs` from `7371 µs` to `8411 µs`, **+1040 (+14.1%)**, on an identical
workload (`binds` 28, `appearances` 46, `popIns` 24, `loadsStarted` 34, `unloads` 6 in
both), for a function whose whole body is two associative-array assignments and no node
write. That delta *is* the probe — an `roTimespan` pair plus a render-thread
read-modify-write on `cellLoadInstrumentUs` — so probing it would make the instrument
meaningfully more expensive in order to report a figure that is almost entirely the
measurement apparatus.

⚠️ **The line is designed for a SCROLL sweep, and first paint is a different phenomenon.**
Cells bound while a screen is still laying itself out appear with no image because the data
has only just arrived, not because a buffer lost anything, and `renderTracking` is least
reliable in exactly that window. Read Home's first-paint pop-ins with that caveat; the sweeps
are where the number means what it says.

**These figures do not compare ACROSS DEVICES, and `measure:devices` will not tell you so.**
`cellSweepGrid` travels `rowTarget × numColumns` tiles, and `numColumns` is a property of the
device's layout (6 on a Stick 4K). A device that lays out 8 columns runs a materially longer
sweep for the same `nav` name, so a cross-device `cell-load` table is comparing itineraries,
not devices. The `RowList` sweeps are bounded by row and item counts instead, so they travel
the same distance everywhere — the grid is the exception. Compare a device against itself.

Every `nav` but `cellSweepHome` mounts more than one cell-bearing screen per launch, so the
tool refuses a median until one is named — reaching the extras rows means loading Home and
the grid above them, and **being hidden is what makes a screen publish**, so even a `nav` that
opens no grid still emits Home's sample on the way out. Those extra samples are recorded
beside the one you asked for, never folded into it.

**A short fixture clamps the sweep rather than failing it**, and says so on the console:

```text
[nav] cellSweepGrid rows: fixture holds 4 entries, so the sweep clamps to 3 of 12 steps.
[nav] cellSweepGrid: swept rows (x6 tiles) 0->18 of 4, row 3 columns 18->23 of 6; cells quiet after 1669 ms
```

A clamp line means the *fixture* was shallower than the itinerary. Reaching the end of an
axis whose length is a structural bound — a grid row is exactly `numColumns` wide — is the
itinerary working and is deliberately silent, so a clamp line always carries news.

That second line is the only record of the distance traveled — `measure` writes down the
`nav`'s NAME, not its itinerary — so keep it beside any figure you publish. The travel
distances live in `CELL_SWEEP` in [`tests/rta/lib/nav.js`](../../tests/rta/lib/nav.js) and
are effectively frozen: changing one silently forks the series, because every record taken
before it describes a different workload and nothing in the record says so. Want a different
distance? Add a `nav`.

**What it produced on a 1 GB Stick 4K, 2026-08-21** (one developer's server — reproduce
rather than cite). A field that was not identical on every launch carries its range, because
a median hides exactly the thing you need to know before trusting a delta.

**The two `ExtrasRowList` rows are n=10 and the other three are n=3, and they are different
campaigns** — the extras pair comes from the three-arm reload-guard campaign later on this
page, the rest from the n=3 sweep. They are labeled rather than silently pooled for the
reason the box below this table gives. `loadsSucceeded` reads `—` on the three n=3 rows
because it did not exist when they were taken:

| Screen | `binds` | `items` | `redundant` | `loadsStarted` | `loadsFailed` | `loadsSucceeded` | `reloads` | `wipesReload` |
|---|---|---|---|---|---|---|---|---|
| `HomeRows` *(n=3)* | 231 *(222–234)* | 129 | 1 | 164 *(163–164)* | 0 | — | 57 *(56–57)* | 0 |
| `BaseGridView` *(n=3)* | 28 | 28 | 0 | 34 | 0 | — | 7 | 0 |
| `ExtrasRowList` *(arm `preguard`, n=10)* | 74 *(73–75)* | 41 | **26** | **140** *(134–159)* | **116.5** *(109–139)* | **1** | 121.5 *(117–139)* | **103** *(97–121)* |
| `ExtrasRowList` *(arm `guarddefer`, n=10)* | 74 *(73–74)* | 41 | **26** *(25–26)* | **43** | **33** *(32–34)* | **1** | 25.5 *(25–26)* | **6** |
| `SearchRow` *(n=3)* | 67 | 160 | 0 | 49 | 5 | — | 9 | 4 |

> **Pool per `(nav, component)`, never across campaigns that ran a different itinerary or a
> different settle.** An earlier draft of this table mixed two campaigns — Home's row carried
> the second's medians while extras still carried the first's — so two rows described
> different populations and nothing said so. Every figure here is recomputed from
> `.device-runs/measure/measurements.jsonl` rather than transcribed. Two earlier populations
> are deliberately excluded rather than pooled in: the earlier extras campaign taken before the horizontal leg hunted the widest row
> (`binds` 44, horizontal leg traveled zero), and everything taken before `waitCellsQuiet`
> widened its gate and `cellSweepGrid` gained its return leg.

**What the harness change did to the numbers, measured rather than assumed.** Re-running all
four sweeps under the new code against the same library and server:

- **The grid's reload path went from never exercised to exercised, which was the point.**
  `reloads` **1 → 7** and `loadsStarted` **28 → 34**, the +6 matching the 6 extra reloads
  exactly, since `reloadGridTexture` bumps both in one block. `binds` stayed at **28** and
  `bindsRedundant` at **0** — a returning tile reloads a texture, it does not re-bind, so the
  `MarkupGrid` never recycled a cell. `loadsStarted − reloads` is 27 before and after, i.e.
  the bind-path request count is untouched. The grid can now see a change to
  `reloadGridTexture`; before, it could not.
- **`SearchRow` is bit-identical** across the change, all nine counters.
- **`ExtrasRowList`'s headline fields are bit-identical too** — `binds` 74, `bindsRedundant`
  26, `loadsStarted` 140, and `wipesReload` **103**, which matters because 103 is the baseline
  a reload-guard change has to beat and it survived the harness change intact.
- **Home moved and tightened** (`binds` 231–253 → 222–234, `loadsStarted` 164–179 → 163–164).
  Do not read that as the gate fixing Home. It is n=3 against n=6 on the one screen documented
  below as itinerary-timing-sensitive, taken directly after a full `test:rta` run left the
  device and server warm — three candidate explanations that n=3 cannot separate. Home needs
  the alternating protocol described below before any claim is made about it.

### Read `binds / items` per screen, never across them

`binds / items` is worth watching for ONE screen over time. It is not a figure of merit you
can rank four screens by, because `items` is the content root's whole child count and the
two list geometries reach it differently:

- **A `MarkupGrid`** binds a tile as it enters the render window. A sweep that goes one way
  therefore binds each tile it visits about once, and `binds / items` is a **coverage
  fraction** — how much of the library the sweep reached. The grid's `28 / 28 = 1.00` says
  the sweep covered all 28 tiles and bound each exactly once, with `bindsRedundant` 0. That
  is a clean result, but it is not a measurement of rebinding: on a 200-tile library the same
  sweep would read ~0.36. It stayed at 1.00 after `cellSweepGrid` gained its return leg, which
  is the direct evidence for the distinction — the leg sent tiles out of the render window and
  back (`reloads` 1 → 7) and `binds` did not move, because a returning tile reloads a texture
  without re-binding unless the grid recycled its cell component.
- **A `RowList`** rebinds cells as rows scroll and again as the horizontal leg moves along a
  shelf, so its ratio mixes coverage WITH rebinding. Home's 1.82 and extras' 1.80 are above
  1.00 for that reason. `SearchRow`'s 0.42 is the other end of the same confound: the sweep
  walks Right along one row only, so most of its 160 items never scroll into view and the
  denominator counts content that was never touched.

**So lead the waste story with the fields that mean waste directly.** `bindsRedundant` is a
bind to the same item at the same size — provably zero-value work — and `wipesReload` is a
failure glyph wiped on a cell that was sitting still, which is what a user sees as flicker.
Both point at `ExtrasRowList` (26 and 103) while the other three sit at or near zero, and
both are exact on every sweep except `bindsRedundant` on Home, which reads 0–1 — a single
no-op bind that comes and goes with the same row-arrival timing as the rest of Home's spread.
That is the finding; the ratio is context for it.

**How reproducible it is, measured** — across two campaigns of n=3 taken **9 hours apart on
the same day (2026-08-20)**, with a redeploy between them (`deployedFromCheckout` flips
false → true in the ledger). Read that as the bound it is: the redeploy is the discriminator
that matters, but a same-day pair is weaker evidence of independence than a pair separated by
a reboot, an OS update or a server restart, none of which happened here. Compare per `(nav, component)`: a sweep's launch also mounts the
screens it passed THROUGH, and pooling a swept mount with one it merely passed through is the
mixed-population error the readers refuse by design.

| Sweep | n | Fields exact on every launch | Fields that moved |
|---|---|---|---|
| `cellSweepGrid` | 3 | **all** | — |
| `cellSweepSearch` | 9 | **all** | — |
| `cellSweepExtras` | 9 | `binds` 74, `bindsRedundant` 26, `loadsStarted` 140, `wipesReload` 103 | `loadsFailed` 116–118, `reloads` 121–123, `wipesBind` 32–34, `unloads` 7–8 |
| `cellSweepHome` | 6 + 3, **not pooled** | `loadsFailed` 0, `wipesBind` 20, `wipesReload` 0 | **`binds` 231–253** then 222–234, `loadsStarted` 164–179 then 163–164 |
| `cellSweepHome`, 2026-08-22 | **40** (20/arm, alternated) | `items` 128, `unloads` 59, `popInsCold` 29, the itinerary itself | **`binds` 235–255**, `loadsStarted` 168–181, `appearances` 104–123 |

**Read the `n` column carefully — the four sweeps do not all pool the same way**, and
deciding that per sweep rather than per campaign is the point:

- **Extras pools to 9** precisely BECAUSE the gate widening changed nothing: its four
  wobbling fields land on identical bounds before (n=6) and after (n=3), so the two
  campaigns are one population and saying so is a measurement, not a convenience.
- **Search pools to 9** for the same reason, trivially — every field is exact in both.
- **Grid is post-return-leg only.** The earlier campaign was a different itinerary (no
  reload coverage, `reloads` 1), so pooling it would average two workloads. Both were
  internally exact.
- **Home does NOT pool.** Its bounds moved (231–253 → 222–234) across a change that
  altered the settle, so the two campaigns are two populations and neither is a bound on
  the other. That is also why the headline table quotes only the later one.

🚨 **Home's spread is NOT the harness, and that was settled by measurement on 2026-08-22.**
Every earlier reading of this table treated Home's moving counts as a sweep that had never
been pinned down. A 40-launch campaign (n=20 per arm, alternated in four blocks, `.177`,
one real 12-row / 128-item server, one build) pinned every harness-side quantity there is —
**identical itinerary on all 40 launches with zero corrective presses**, `items` **128**,
`unloads` **59**, `popInsCold` **29**, and, on the 20 launches that ran the
[`waitRowsSettled`](../../tests/rta/lib/steps.js) gate, the row structure measured already
stable before the first key press (`settled in 1983–2048 ms`, the `quietMs` floor plus one
poll). `binds` still spans **235–255**. So Home binds a different number of cells over an
identical, settled workload, and the question belongs to `HomeRows` / `JRRowItem`, not to
`tests/rta/`. Two harness fixes were tried and neither moved the dispersion: the settle gate
(|z| < 1.7 on every field, medians 242 vs 242) and a doubled wait before the sweep (worse —
`binds` range 17 against 7 at n=5). ⚠️ **A pilot at n=5 made the settle gate look like a clean win**
(`appearances` 105×5, `popIns` 42×5) and n=20 erased it; on a discrete, clustered
distribution a range statistic at n=5 is not evidence.

Three things to take from that table.

**The extras sweep's headline fields are TIGHT, not exact — and an earlier draft of this
page said exact.** Across the n=3 sweep `wipesReload` read 103 on all nine launches, and
that got written up as a field to treat as exact. Ten launches of the same code later read
`103 103 103 103 103 103 121 102 100 97`: the median is still 103, but the spread is 97–121
and it runs BOTH ways. The single high launch is the same one carrying `loadsStarted` 159
and `reloads` 139, so it is a launch that did more reload work, not a miscount.

Nine identical readings did not measure the variance — they bounded it from below, and the
distinction is the whole lesson. Pick a sample size from a field's observed spread AT that
sample size, and treat a run of identical numbers as the weakest possible evidence that a
field is stable.

**A ±12% wobble still left the reload-guard comparison decidable at n=10/arm**, because the
effect is an order larger than the spread — 103 against 6, with no overlap between the arms.
See [the reload-guard result](#the-reload-guard-ab--and-the-number-it-took-a-new-counter-to-get-right) below.
Exactness was never what made it work; separation was.

**That residual is the app's path choice drifting, not a measurement artifact** — worth
stating because an earlier draft here explained it as one ("quiescence bounds the in-flight
window, it does not make it empty") and that explanation was wrong. The four wobbling fields
move TOGETHER on every launch while `loadsStarted` holds at exactly 140. A boundary that
truncated the count would show the *same* `reloads` with *fewer* `loadsFailed`; instead the
whole chain shifts.

But note what "together" does and does not mean here, because the obvious reading is also
wrong: the workload is not getting bigger or smaller. There are **140 load attempts every
launch**, and the bind-path share (`loadsStarted - reloads`) falls 19 → 17 exactly as
`reloads` rises 121 → 123. The total is fixed and its *split* drifts — the same cell taking
the reload path rather than the bind path. That is a timing-dependent choice inside the app,
which is worth knowing before comparing two arms that touch `reloadTexture`; it is not slack
in the harness. The one part that does look like a boundary effect is the ±1 at constant
`reloads`, seen in one launch of nine.

`waitCellsQuiet` gates on `loadsFailed` and `unloads` as well as `binds` and `loadsStarted` —
the only two counters that can move while the other two sit still (the rest share a
straight-line block with one of them; the argument is in that function's header comment). That is
worth having because it makes "every field the sample publishes has stopped moving" an
invariant a caller can rely on. **It is not a variance fix, and that was predicted here
before it was tested, then confirmed:** widening the gate left extras' wobbling fields on
exactly the ranges they already had — `loadsFailed` 116–118, `reloads` 121–123, `wipesBind`
32–34, both bounds unchanged. Budget the ±2; it is the workload, not the instrument.

**Home needs a real sample size; the other three do not.** Its `binds` has now been read
across three campaigns and has moved every time: 231 / 235 / 235, then 231 / 238 / 253,
then 222 / 231 / 234. **No campaign has bounded it**, and the history is the argument —
the first was published here as a ~2% floor and the second refuted it, so a third quoting
9.4% (or the 13.2% the raw pool would give) would be making the same mistake with a bigger
number. What is established is only the direction: Home varies where the other three
sweeps do not, by an amount larger than any effect worth calling small.

**This is a statement about cost, not about feasibility.** An exact metric is a luxury: it
lets a grid, extras or search sweep settle a question at n=3. A noisy one just needs the
protocol every other comparison in this repo already uses — n≈20–30 per arm, arms
**alternated** rather than blocked, and the delta read from
[`measure:compare`](#comparing-two-arms), which applies a rank test instead of eyeballing
two medians. Home has already carried exactly that: the row-size-batching change was
measured on Home at n=30/arm/tier with alternating blocks and separated cleanly
(p<0.0001). Do not read "noisy at n=6" as "off limits" — Home has the most cells of any
screen in the app and is the screen a cell optimization most needs to be provable on.

Alternating is not optional here, and Home is why: within each campaign the counts rose
monotonically with launch index, so a blocked A,A,A,B,B,B pair would alias that drift
straight onto one arm.

**`bindsFromSize` is the one field that is NOT zero everywhere, and it earned its keep.**
It is 0 on the grid, extras and search sweeps on every launch, and 0 on five of Home's six
— but the sixth read **1**, and it is the same launch that was the outlier on `binds` (253)
and `loadsStarted` (179). That counter exists precisely because a layout change that starts
re-issuing image requests has no other symptom, and here it fired on the anomalous run and
nowhere else. It is one observation, not a proof, but it points the same way the variance
does: rows still arriving mid-sweep change the row structure, which is the size-recompute
path. Anyone chasing Home's spread should start there.

**Home's itinerary is itself timing-dependent, which is the likeliest reason it is the only
noisy sweep.** `waitHome()` gates on the row list holding SOME rows, not all of them, and
`sweepRowList` then reads the row count and picks the widest row from that one snapshot. A
row that lands a moment later can change both the row limit and which row the horizontal leg
walks — so on Home, unlike the other three, the sweep distance is not fully pinned by the
fixture. Anything that makes Home's rows settle before the sweep reads them would tighten
this; nothing else on the page depends on it.

**Known limit, inherited from the ledger:** a screen that REPLACES its content root starts
fresh counters, and the old root's counts are never emitted at all. `BaseGridView` does that at five
call sites and `SearchRow` at two, so a grid's line covers "since the last rebuild", not
"since the screen opened". Nothing in the sweeps triggers a rebuild, but a filter or sort
change would.

### The reload-guard A/B — and the number it took a new counter to get right

The first change settled with this family, and the worked example for the whole section.
**Three commit-pinned arms, n=10 each, interleaved `AAAAABBBBBCCCCC` twice over 21 min** on a
1 GB Stick 4K against a real server, `--nav cellSweepExtras --component ExtrasRowList`. All 30
launches swept ONE itinerary (`rows 0→1 of 3, row 1 items 0→12 of 31, rows 1→2 of 3`) with
`items` 41 on every launch, so the deltas are not a run that did less work. The arms are
`preguard` (before the fix), `guard` (the reload guard alone) and `guarddefer` (what ships).

`preguard` → `guarddefer`:

| field | `preguard` | `guarddefer` | delta | rank test |
|---|---|---|---|---|
| `wipesReload` | 103 | 6 | **−94.2%** | p=0.0000, complete separation |
| `reloads` | 121.5 | 25.5 | −79.0% | p=0.0001, complete separation |
| `loadsStarted` | 140 | 43 | −69.3% | p=0.0001, complete separation |
| `loadsFailed` | 116.5 | 33 | −71.7% | p=0.0002, complete separation |
| `loadsSucceeded` | 1 | 1 | **0%** | p=1.0000, identical on all 20 launches |
| `binds` | 74 | 74 | 0% | p=0.36, not distinguishable |
| `bindsRedundant` | 26 | 26 | 0% | p=0.17, not distinguishable |
| `unloads` | 8 | 8 | 0% | p=0.30, not distinguishable |
| `wipesBind` | 33.5 | 34 | +1.5% | p=0.10, not distinguishable |

**The nulls carry the argument, not the headline.** A −94% on `wipesReload` alone is equally
consistent with "the work moved somewhere else": `binds` flat at 74 is what rules that out,
and `unloads` flat at 8 is what shows the buffer-window preloading path was not disturbed. Quote
those two beside the headline or the headline does not mean what it appears to.

**`loadsSucceeded` is the null that matters most, and it exists because the first version of
this section was wrong.** That draft reported a successful-load count falling 23.5 → 11 and
called it "the real cost of the change (transient retries that would eventually have
succeeded)". It was computed as `loadsStarted − loadsFailed`, because no counter recorded a
success — and that subtraction silently counts every request still outstanding at the emit
boundary as one. With `cellLoad.loadSucceeded` added, successes read **exactly 1 on all 30
launches in all three arms**. The ~97 suppressed retries per sweep recovered nothing. The
earlier figure is retracted, not qualified: it was never a measurement of successes.

**The residual is the counter's real payload.** `loadsStarted − (loadsFailed +
loadsSucceeded)` is the count still in flight when the session was emitted — 21.5 on `preguard`
(19–24) against 9 shipped (8–10), so roughly 15% and 21% of started loads respectively. Only
an unload can swallow a resolution (the load-status observer returns early on
`isTextureUnloaded`), and `unloads` is 8 in every arm, so that mechanism accounts for nearly
all of the shipped arm's 9 and under half of the `preguard` arm's 21.5. The rest were genuinely
outstanding. **This does not reinstate the withdrawn explanation for the failure tail's
wobble** — that was withdrawn because the whole chain shifts together, which truncation would
not do, and it stays withdrawn. A non-empty in-flight window and a drifting path split are
two different facts, and the residual is evidence for only the first.

**`wipesBind` +0.5 (p=0.10) is the one field that drifted the wrong way**, and it is the
direction that would indicate work relocating to the bind path. n=10 BOUNDS it rather than
proving it zero; it is recorded here rather than rounded to "no change" so a later change that
makes the bind path hot has a prior to compare against.

**The third arm isolates the second fix and finds nothing.** `guard` → `guarddefer` — clearing
the poster URI when a cell defers an off-screen load — moves no field: `loadsStarted`
p=1.0000, `unloads` p=0.17 at an identical median of 8, every other field p≥0.70. That fix is
justified by code correctness (the flag claimed a texture was released while it was still
resident), not by a measured improvement, and this sweep does not exercise the path it
repairs. Recorded so nobody quotes the −94% as evidence for it.

**What this campaign cannot tell you.** `loadsSucceeded` = 1 means the fixture's cast artwork
is essentially all missing, so "the suppressed retries recovered nothing" is a fact about THIS
library. On one where person artwork exists and fails intermittently, those retries could
recover real images and the guard would cost the user something. The check is one number on
that library — `loadsSucceeded` with and without the guard — not a re-derivation.

**Why this settled at n=10 when Home needs 20–30.** Not exactness: the discriminator wobbles
97–121 on the `preguard` arm. Separation — 103 against 6 with no overlap, so the arms are
decidable at any sample size that establishes the medians, while Home's `binds` spread is
wider than most effects worth measuring there. Check a field's observed range before picking
a sample size, and see the tightness note above for why a run of identical readings is not
that range.

### More than one device

`npm run measure:devices` takes the same measurement on every Roku in `ROKU_DEVICES`,
one after another, and each device writes its own line to `measurements.jsonl`:

```bash
# .env: ROKU_DEVICES=192.0.2.10,192.0.2.11,192.0.2.12
npm run measure:devices -- --deploy --server http://192.0.2.10:8096 --nav settings -n 30
ROKU_DEVICES=192.0.2.10,192.0.2.12 npm run measure:devices -- --server … -n 5   # a subset
```

Every flag is forwarded verbatim to `npm run measure`, so nothing above changes. `.env`
declares which devices EXIST; [`scripts/data/roku-hardware.json`](../../scripts/data/roku-hardware.json)
declares what RAM tier a model IS, so listing your own addresses is enough to get correct
tier labels. `ROKU_IP` stays the single-device default — leaving `ROKU_DEVICES` unset
changes nothing.

**A matrix run must pass `--server <url>` (or `--no-server`), and that is a hard
refusal.** The server is the WORKLOAD, so a matrix whose devices are signed into
different servers measures the libraries rather than the hardware. It is not a
hypothetical: it has happened twice on the same three devices, most recently on this
tool's own first run — a Stick on `demo.jellyfin.org` (4 rows, 1757 ms) beside a Stick 4K
on a real server (10 rows, 1791 ms) reads as "the 512 MB device matches the 1 GB device"
until you check the `rows` column. With the flag, tier 1 makes it an assert and a device
on the wrong server refuses before taking a sample. `npm run measure` alone only warns,
because with one device there is nothing to confound.

Devices run **sequentially, never in parallel** — `--deploy` wipes `build/`, the server
is shared, and `measurements.jsonl` is append-only. A device that fails costs its own row
and not the run: the others still measure, the summary names it, and the exit code is
non-zero. Before the first launch the tool checks every device over ECP and refuses the
whole set if one is unreachable, is a model Roku says cannot run apps, or duplicates
another (two addresses on one Roku after a DHCP move, or two devices of the same model —
whose *matrix columns* could not be told apart, since a column is keyed by model and RAM
tier). Each refusal prints the one-line subset command to run the rest.

> ⚠️ The refusal message in [`measure-matrix.js`](../../scripts/measure-matrix.js) gives a
> stronger reason than holds: it says the record identifies a device by model / model
> number / RAM tier "and by nothing else". It does not — every series carries a
> `deviceKey` (a hash of the ECP `device-id`), which `measure:compare` and
> `measure:report` both expose as the `device` selector, so two same-model series ARE
> separable after the fact with `--select device=<key>`. The refusal may still be right
> on column-collision grounds; its stated rationale is not.

The matrix REPORT — every screen across every tier — is a separate reader over
`measurements.jsonl`, not something this tool prints: a reader can rebuild the matrix from
runs taken weeks apart, and an in-process report can only describe the run that just
finished. It is [`npm run measure:report`](#the-matrix--every-screen-every-tier).

### Calibrating the instrument — does the ODC component move the number?

Every number above is taken on a device holding an **RTA build**, because identity is read
over ODC and ODC exists only in one. That makes the on-device component resident for the
whole session, which is an unmeasured variable in every measurement this tooling produces
— and the reason the [baselines below](home-first-paint-performance.md#baselines-2026-08-04), taken on plain builds, may
not be compared against a `measure` series.

`npm run measure:calibrate` answers it, on one device, in one command:

```bash
npm run measure:calibrate -- --server http://192.0.2.10:8096            # n=30, blocks of 5
npm run measure:calibrate -- --server <url> -n 10 --block-size 5 --label smoke
```

What it does, and why each piece is not optional:

- **Two arms off ONE build.** `rta` is the ordinary deploy; `plain` drops the on-device
  component **and** restores `ENABLE_RTA=false` in the staged manifest, which makes it
  byte-for-byte the build state the baselines were taken on. Dropping the component alone
  does *not* do that — RTA's manifest rewrite is not behind `injectTestingFiles`, so that
  arm would still run every `#if ENABLE_RTA` block. See
  [`scripts/measure-arms.js`](../../scripts/measure-arms.js).
- **`home-latest-rows`, measured by LAUNCHING.** `--nav` is driven over ODC, so the plain
  arm cannot navigate anywhere; Home is also the only screen with non-RTA n=30 baselines
  to be made comparable.
- **Blocks of 5, alternating**, so anything that drifts with time cannot alias onto one
  arm. Fewer than two blocks per arm is a refusal, not a warning.
- **The plain arm's identity is asserted by ENCLOSURE** — observed reads taken immediately
  either side of it, with nothing registry-writing in between
  ([ADR 0030](../adr/0030-non-odc-arm-identity-by-enclosure.md)). A block whose brackets
  disagree is recorded `blocked` and **not** published; the summary names every block that
  did not reach the ledger, and the exit code follows that accounting rather than the last
  child's status.
- **It always redeploys the RTA build at the end**, including on the way out of a Ctrl-C
  *and* out of a mid-run failure (the restore is in a `finally`). A device left holding a
  build with no ODC refuses the next `measure`, the next `test:rta` and the next sign-in —
  which has already cost this project a whole RAM tier. If the restore itself fails, the
  run says so loudly, names the arm the device is stuck on, and exits non-zero.
- **The deploy VERIFIES the flag it shipped.** The `ENABLE_RTA` flip is a string replace
  against RTA's staged manifest, so the deploy reads `bs_const` back and refuses before
  sideloading if it does not say what the arm asked for. A flip that silently
  matched nothing would turn the `plain` arm into the `no-component` arm, and nothing
  downstream can tell those two apart — neither one has the ODC component resident.
- **`--label <name>`** suffixes both arm labels (`rta-smoke` / `plain-smoke`). Arm labels
  are selected across the *whole* ledger, so without it a second run pools into the first.

#### `--against <arm>` — decomposing a delta that cleared the floor

The default pair is `rta` vs `plain`, which answers the comparability question and nothing
else: `plain` drops the component **and** the compiled-in `#if ENABLE_RTA` hooks, so a
delta cannot say which of the two it was.

`--against no-component` is the decomposition arm — the one
[ADR 0030](../adr/0030-non-odc-arm-identity-by-enclosure.md) originally specified. It drops
the component while leaving `ENABLE_RTA=true`, so against `rta` it isolates the **resident
component** alone, and its difference from `plain` is the hooks.

Only worth running once `rta` vs `plain` has produced a delta **at or above the method's
~120 ms floor** — below that it can only report "not distinguishable" whichever way the
truth lies. Two things to know before reading its output:

- `provenance.enableRta` is derived from whether ODC answered, so this arm records `false`
  while its shipped manifest says `true`. Read `provenance.deploy.bsConst` for it instead.
- `createObject` on a node type that is no longer staged is a path nothing else exercises.
  Smoke it (`-n 4 --block-size 2`) before committing to a full series.

`rta` is always one side and is refused as an `--against` value: it is the only arm that
can read its own identity, so it is what the enclosure is built from.

Read the answer back with the command the run prints in its own summary — it names the
arms that run actually recorded, including `--against` and `--label`:

```bash
npm run measure:compare -- --a arm=rta --b arm=plain                      # the default pair
npm run measure:compare -- --a arm=rta-decomp --b arm=no-component-decomp # --against + --label
```

`measure:compare` knows this one pair is allowed to differ in `ENABLE_RTA` — see
[the refusal list](#comparing-two-arms).

**Every published figure comes out of `measure:compare`, never out of hand arithmetic.**
That includes a pooled figure across two runs: filter the ledger to the arms you want,
rewrite their labels to one pair, and point the reader at the copy with `--file`. The rule
exists because it was broken — a headline delta was once computed by an ad-hoc script that
took the upper of two middle values and skipped the cold-sample filter, and it sat in a
table beside a figure that had come from `measure:compare`.

### What one run does

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
[What this tooling does NOT do](#what-this-tooling-does-not-do). It records; it does not judge.

### The manual procedure is retired

**Retired 2026-08-19; there is no longer a hand procedure to fall back on.** This doc used
to carry a four-step ritual — sideload, watch port 8085, read the two lines, repeat
n≥5 — described as "still correct and still what the tool does". It was neither safe nor
necessary: step 3 is the [console-replay trap](#trap-roku-replays-its-console-buffer)
below, which silently reads the PREVIOUS run's line as a new sample and was measured
returning a value ~3× the largest real one; and a number taken by hand is unattributable,
because nothing writes down the device, the build, the server or the workload it was taken
against. Both are things the tool fixes by construction, so the hand method was not a
simpler path to the same number — it was a path to a worse one.

The one thing the manual steps carried that the tool did not state is kept, because it is a
real precondition rather than a step:

> **The device must have "remember me" enabled and be signed in.** Without a persisted
> token every relaunch lands on `UserSelect`, Home never loads, and no run occurs. The tool
> will sample a series of nothing and report it as a series of nothing, which is correct and
> unhelpful.

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

## Reading the ledger back

Every `measure` run appends one line per series to
`.device-runs/measure/measurements.jsonl`. It is **append-only, gitignored, and per-machine**
— the only copy of every number YOUR setup has taken, and it is not shared with anyone. A
fresh checkout has no ledger at all, so `measure:report` will tell you it is empty until you
take a series; every worked example below therefore shows one developer's numbers rather than
anything you can reproduce line-for-line. Two readers turn a ledger into figures, and between
them they own every statistic:

| Reader | Question |
|---|---|
| `npm run measure:compare` | *Is arm A different from arm B?* — two populations, one delta, a rank test |
| `npm run measure:report` | *What do we know, and where are the gaps?* — every screen × every tier |

### ⚠️ Every published figure comes out of a reader — including a pooled one

This is not a style preference; it is the rule that came out of getting it wrong. A `+136 ms`
published in this project's own notes came from an ad-hoc script that took
`sorted(...)[len // 2]` — the **upper of two middle values, not a median** — and filtered on
`complete` rather than `indexInLaunch === 0`, so it was neither a median nor cold-only. The
true figure was **`+153`**. It sat in a table beside a `+101.5` that HAD come from
`measure:compare`: two different statistics in adjacent rows of one table, both plausible,
neither checkable by eye. It was caught only by re-deriving from the ledger.

So: **do not compute a median, a delta or a percentage by hand, ever, even for a pooled
number.** To pool across arms, filter the ledger to the arms you want, collapse their labels
to one pair, and point `--file` at that copy — `measure:compare` will do the arithmetic on
it. `measure:report` takes the same route: a cell is assembled by the same `buildArm` and
summarized by the same `summarizeValues` the comparison uses, so there is no second
implementation of "median" in the repo to drift.

### The matrix — every screen, every tier

```bash
npm run measure:report                                    every family in the ledger
npm run measure:report -- --measurement screen-load       one family
npm run measure:report -- --select arm=rta                one population
npm run measure:report -- --field settledMs               headline the other milestone
```

One table per measurement family, because `measurement` is a refusal axis — a table spanning
two families would be a column of numbers that are not the same quantity. The grid gives
`median ×n` per screen per tier; the detail block underneath gives **every** milestone the
samples carried, the workload beside it, and the yield.

**A cell that holds no number says which kind of nothing it is**, and the three are not
interchangeable:

| Cell | Meaning |
|---|---|
| `—` | never measured — no series in the ledger for that screen on that tier |
| `0 cold` | **measured and empty** — series exist and none produced a usable cold sample. A fact about the app or the run, not a gap in coverage |
| `mixed` | the cell pools more than one population — two components under one screen name, an RTA build beside a non-RTA one, two servers, **two device models of one RAM tier**. No median is printed; the note says what it mixes and how to narrow it |

The `mixed` state is the same rule `measure:compare` applies to an arm, from the same
`POPULATION_AXES` — a cell IS an arm. It is not a warning you can read past: a median over
two populations is a well-formed number about two experiments, which is the failure mode this
whole subsystem is built around.

**The ledger mixes populations by design.** It holds several calibration arm labels (`rta`,
`plain`, `no-component-decomp`, …), three tiers, several screens and more than one server.
`--select` narrows a cell using the same selector grammar as `measure:compare`; selecting on
`arm` alone pools across tiers, and both readers refuse that.

A cell can publish a number and still have dropped most of its series, so the detail block
prints the **yield** whenever it did — `2 of 18 series usable — 13 produced no cold sample,
3 not a sample`. A median over what survived reads exactly like a median over what was taken.

#### Refusal or disclosure — which side a new axis lands on

Two axes can both move a number and be handled oppositely, and the difference is not how
much they move it:

- **Refused** (`POPULATION_AXES`) when pooling changes what the number says **about the
  app** — a different screen, a different component, a different silicon, a different
  build flag, a different `ENABLE_RTA` state. There is no honest median across those, so
  the cell prints `mixed` and no number.
- **Disclosed** (`PROVENANCE_AXES`) when pooling changes only **which build of the app**
  the number is about — `commit`, `device`, `arm`, `appVersion`, `os`. Spanning those is
  the whole reason a reader over the ledger exists rather than a report from the run, so
  refusing them would refuse nearly every cell and negate the design. They are printed
  instead, beside the number.

Silence is not one of the options. Before the provenance line existed, `search · 1GB`
published (on one developer's ledger) a 14-sample median where five of its seven series
recorded no commit, no device
and no timestamp at all, and the report said nothing about it.

#### Known limitation: a multi-model fleet collapses the tier axis

`model` is a **refusal** axis, so two different models of one RAM tier do not pool — a
1 GB Express 4K and a 1 GB Stick 4K differ in SoC, and a RAM tier is a memory label rather
than a hardware class. This project's own 512 MB calibration result is a +130.5 ms
inversion with no established mechanism, which is the evidence that sub-tier differences
are not understood well enough to average across. A refusal is also recoverable
(`--select model=…`) and a wrong median is not.

The cost is real and belongs here rather than being discovered later: **narrowing by model
collapses the tier axis.** On a fleet with several models per tier the matrix degenerates
to one column per model and stops being a tier matrix. If that becomes the working shape,
the fix is to re-key the columns on `device` with `tier` as a grouping label — **not** to
relax the refusal.

Today the ledger holds one model per tier (512 MB Roku Stick, 1 GB Stick 4K, 2 GB Ultra),
so the refusal has never fired. It is pinned by a test rather than left to inference,
because a rule nothing exercises is a rule the next reader will assume was accidental.

#### The provenance line — where a published median came from

Every cell that prints a number prints one, in the detail block:

```text
  itemDetails · 1GB
    paintMs     median 300.5 ms  ×2  range 197–404 ←
    workload    contentFills=2 fills=3 textureFills=1 ×2
    provenance  2 series, 2026-08-13 · commit 217d038f · device ac4701ca4a5d8a0b · arm (unrecorded) · appVersion 2.25.0 · os 15.3.4
```

One line while the cell is a single population on every disclosed axis. An axis that IS
pooled breaks out with a tally — which values, and how many series each — because "2
commits" is not actionable and this is:

```text
    provenance  7 series, 2 of them dated 2026-08-14 · arm (unrecorded) · appVersion 2.25.0 · os 15.3.4
                ⚠ 2 commits pooled into this median: (unrecorded) ×5 · 8b95eb99 ×2
                ⚠ 2 devices pooled into this median: (unrecorded) ×5 · ac4701ca4a5d8a0b ×2
                  narrow it: --select commit=<sha>,device=<key>
```

Three details are deliberate. `(unrecorded)` is a **value**, not an omission — the ledger's
oldest series predate `commit` entirely, and folding them in silently would report "1
commit" for a median that is mostly of unknown provenance. `n of them dated` appears
whenever the dates cover only some of the series, because those same legacy series carry no
`startedAt` either and a plain range would date seven series off two of them. And the tally
counts the series that **fed the median**, not every record the selector matched — dropouts
are the `yield` line's job.

#### The `samples` and `integrity` lines — what weakens the median

A cell prints a median whenever it has one. Two things decide how much weight it carries,
and both are printed under the number rather than left for the reader to work out.

**`samples` — the number `n` has to be read against.** The recorded method wants **n≥5**
and only resolves **~120 ms at n=30 per arm**. `n` was always visible; what it means was
not. This is not a rare corner: on the ledger the feature was developed against, six of
the nine cells with a median sat below the n≥5 floor and one published a median of a
**single sample** — which is simply what a matrix looks like while it is being filled in,
a few launches per screen taken between other work. Expect your own ledger to look the
same early on:

```text
    samples     ⚠ n=1, below the method's floor of n≥5 — this median is not yet evidence
    samples     n=6; ~120 ms resolution is measured at n=30, so smaller differences cannot be called
```

**`integrity` — facts about the series that weaken what any number from them can claim.**
These are shared with `measure:compare` (`SERIES_INTEGRITY`), so the two readers cannot
disagree about when one fires — before this, the same series could be flagged by the paired
comparison and silently averaged by the matrix:

```text
    integrity   ⚠ 1 of 1 series taken on a dirty tree, so the recorded commit does not pin the code that ran
    integrity   ⚠ 1 of 1 series measured a build nobody attributed to a checkout, so its commit may describe code that never ran
```

The table's last column is a **snapshot of one developer's ledger** (163 records, August
2026), not a property of the tooling — yours will differ, and on a fresh checkout every
one of them reads 0% because the ledger starts empty. It is here to show which of these
fire often enough to matter, not as a number to compare against.

| Fact | Fires when | Seen in one 163-record ledger |
|---|---|---|
| dirty tree | `dirty: true` — the commit is an incomplete description of the source | 37% |
| unattributed build | neither `--deploy` nor `--deployed-by` — nobody can say the measured build came from the recorded commit | 33% |
| server not asserted | no `--server`, so the recorded server is what the app reported rather than what anyone declared | 32% |
| identity drift | the server identity moved or could not be re-read at the end | 0% |
| hour boundary | the series crossed `:00`, where a resetting fixture changes the workload | 2% |
| hour not recorded | the series predates the flag, so whether it crossed `:00` is unknown | 3% |

**Acting on the dirty warning:** `--select dirty=false` narrows a cell to the series that
recorded a clean tree. It is a three-state field, not a boolean — records predating the
field read as `(unrecorded)`, which `dirty=false` deliberately excludes. "Nobody
wrote it down" is not "it was clean".

**None of these is a refusal**, and that is deliberate: each describes a number that is
still the best evidence available. The failure mode is publishing it as though it were
unqualified. A dirty tree in particular is the *normal* state while iterating on a fix —
[`flake-baseline.js`](../../scripts/flake-baseline.js) excludes such runs outright, and a
measurement reader discloses instead, because excluding them would throw away most of what
anyone measures while working.

`--deploy` settles the attribution warning. A tool that deploys and then runs `measure`
itself should pass `--deployed-by <name>` so its series are attributable —
`measure:calibrate` does, which is why 75 of one ledger's 127 `deployedFromCheckout: false`
records are **not** flagged.

### Comparing two arms

Take the arms **alternating** — `--arm before`, `--arm after`, `--arm before`, … — never all
of one and then all of the other, so anything that drifts with time (fixture content, device
warm-up, a server getting busy) cancels instead of landing on one arm:

```bash
npm run measure -- -n 5 --arm before --server http://192.0.2.10:8096
npm run measure -- -n 5 --arm after  --server http://192.0.2.10:8096   # …and repeat
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
  **One sanctioned exception, since 2026-08-17:** the ODC calibration itself, whose two arms
  differ in `ENABLE_RTA` by design. It is a property of the records rather than a flag —
  both arms must carry an *asserted* identity, each arm's identity source must fit its own
  ODC state (an arm reporting `enableRta: false` cannot claim it *observed* its identity,
  since that field is derived from ODC answering), and the two must agree on the server.
  `npm run measure:calibrate` establishes all three by construction; nothing else does.
  See [ADR 0030](../adr/0030-non-odc-arm-identity-by-enclosure.md).
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
  [What this tooling does NOT do](#what-this-tooling-does-not-do).

## What this tooling does NOT do

- **It does not gate.** No threshold, no CI check, no exit code meaning "regression" — an
  exit code here says whether a comparison could be MADE, never what it showed. Decided
  twice and recorded in [`decisions.md`](../decisions.md); the reasoning, and what to
  assert INSTEAD of a timing threshold, is in
  [What this does NOT do](home-first-paint-performance.md#what-this-does-not-do).
- **It does not make anything faster.** It makes a claim about speed checkable.
- **It does not measure production.** Every number is taken on a `perfTiming=true` build,
  and release artifacts force it to `false` — see
  [Why this costs production nothing](home-first-paint-performance.md#why-this-costs-production-nothing).

## Related

- [`home-first-paint-performance.md`](home-first-paint-performance.md) — the wait-vs-emit
  method, the recorded baselines, and the second-level splits inside `LoadLatestRowsTask`
  and `LoadItemsTask2`.
- [ADR 0028](../adr/0028-mount-identity-component-and-variant.md) — mount identity
  (`--component` / `--variant`), the rule that decides WHICH mount a number is about.
- [ADR 0030](../adr/0030-non-odc-arm-identity-by-enclosure.md) — identity by enclosure for
  the no-ODC calibration arm.
- [`rta-tests.md`](rta-tests.md) — the functional suite that shares
  [`tests/rta/screens.js`](../../tests/rta/screens.js) with this tooling.
- [`debug-flags.md`](debug-flags.md) — `perfTiming` and the other `bs_const` flags.
