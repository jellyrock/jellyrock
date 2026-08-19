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
  - scripts/roku-devices.js
  - scripts/data/roku-hardware.json
  - source/utils/screenReadiness.bs
  - tests/rta/screens.js
last-reviewed: 2026-08-19
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
| *Where did the time go INSIDE one orchestrator — waiting on the network, or working on its own thread?* | [`home-first-paint-performance.md`](home-first-paint-performance.md) — the `home-latest-rows` and `item-grid` families |

The split is the same one [`scripts/measurements.js`](../../scripts/measurements.js) draws
between its measurement families. `screen-load` says **when** a screen painted and when it
stopped changing; `home-latest-rows` says **why** one loader took as long as it did. A
regression hunt usually starts here and ends there.

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
`.device-runs/measure/measurements.jsonl`. It is **append-only and gitignored** — the only
copy of every number this tooling has taken. Two readers turn it into figures, and between
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
published a 14-sample median where five of its seven series recorded no commit, no device
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
