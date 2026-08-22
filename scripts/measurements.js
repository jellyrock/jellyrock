/**
 * The registry of on-device MEASUREMENTS the app emits — the single source of
 * truth for what `npm run measure` can sample, and how a console line becomes a
 * number.
 *
 * This is the measurement-side twin of [`tests/rta/screens.js`](../tests/rta/screens.js).
 *
 * ## Adding an instrumented screen costs NOTHING here
 *
 * The two legacy families below are per-COMPONENT, because they were written against
 * lines the app was already emitting and those lines do not share a shape. A screen
 * instrumented with the readiness ledger
 * ([`source/utils/screenReadiness.bs`](../source/utils/screenReadiness.bs)) does share
 * one — the emit is uniform by construction, and the screen's name travels IN the line
 * as a dimension. So `screen-load` is one entry that covers every such screen, present
 * and future, and instrumenting the next one is app-side work only.
 *
 * That inverts the note below rather than contradicting it: a registry beats a parser
 * because the EXISTING lines disagree about their shape. A new shape that agrees with
 * itself does not need an entry per instance, only per shape.
 *
 * The two remain complementary rather than competing, and answer different questions:
 * `home-latest-rows` and `item-grid` say where the time went INSIDE one loader (the
 * wait/emit/xform split), while `screen-load` says when the SCREEN became usable and
 * when it stopped changing. Neither is derivable from the other.
 *
 * ## Why a registry rather than a parser for Home
 *
 * The documented procedure
 * ([`home-first-paint-performance.md`](../docs/dev/home-first-paint-performance.md))
 * and the open perf PR both measure Home, so a Home-shaped parser is the obvious
 * first thing to write. It would have baked in the instance instead of the class:
 * the app already emits a SECOND family from the item grid, which is what the
 * genres optimisation work reads, and every future instrumented screen adds a
 * third. The families do not share a line shape — Home's `run complete` puts the
 * value BEFORE its label (`10 rows 2654 ms`, from `m.log.info(msg, count, "rows",
 * ms, "ms")`) while `orchestrator done` puts it after (`task 2546`) — so a
 * "generic key/value extractor" is not available either. An explicit pattern per
 * line, declared next to the fields it produces, is the honest shape.
 *
 * ## The line format is what the DEVICE prints, not what the doc shows
 *
 * `home-first-paint-performance.md` documents the message only:
 *
 *     latest-rows run complete 11 rows 2728 ms
 *
 * What arrives on port 8085 (captured on `.177`, 2026-08-12) is roku-log's full
 * form — a level, the emitting source file and line, and trailing padding:
 *
 *     INFO file:///…/components/home/HomeRows.bs:459 latest-rows run complete 10 rows 2654 ms␠␠␠␠
 *
 * A pattern written from the doc anchors at the start of the message and matches
 * nothing. The prefix is stripped by `parseLogLine` below rather than repeated
 * into every family's pattern, and it is OPTIONAL there — a build configured
 * without the file transport still emits the message, and a measurement that
 * silently stopped matching would be worse than one that matched a bare line.
 *
 * ## Ground truth for each pattern
 *
 * `home-latest-rows` was captured off a device. `item-grid` is written from the
 * emitting call site — which IS authoritative for the message, since it is the
 * format string itself — but has not yet been observed on the wire. Its
 * `grounded` flag says so, and `npm run measure` reports it, so nobody quotes a
 * number from a pattern that has never matched a real line.
 */

/**
 * roku-log's console form: `<LEVEL> file://<path>:<line> <message>`.
 *
 * The prefix is optional so a bare message still parses (see the header). The
 * message is captured greedily and trimmed by the caller: every observed line
 * carries trailing padding, because `m.log.*` joins its nine possible arguments
 * with spaces whether or not they were supplied.
 */
const LOG_LINE =
  /^\s*(?:(?<level>INFO|WARN|ERROR|VERBOSE|DEBUG)\s+file:\/\/(?<source>\S+?):(?<sourceLine>\d+)\s+)?(?<message>\S.*?)\s*$/;

/**
 * Split a raw console line into its parts, or `null` when it is not a log line.
 *
 * Never throws and never guesses: a line that does not match is not a
 * measurement, and the caller drops it. The device prints a great deal that is
 * not roku-log output (`[http] Response Code 200` and friends), so this runs on
 * every line of a session and has to be cheap and quiet.
 */
export function parseLogLine(raw) {
  if (typeof raw !== 'string') return null;
  const m = LOG_LINE.exec(raw.replace(/\r+$/, ''));
  if (!m) return null;
  const { level, source, sourceLine, message } = m.groups;
  return {
    level,
    // Just the basename: the absolute path is the AGENT's checkout path, which is
    // provenance about the machine that built the app rather than about the app,
    // and it would put a developer's home directory into every sample record.
    source: source ? source.split('/').pop() : undefined,
    sourceLine: sourceLine ? Number(sourceLine) : undefined,
    message,
  };
}

/**
 * The compile-time state a sample was taken under, as the app itself stamps it.
 *
 * Two of the four Home lines and the item-grid line carry `[debug=… perfTiming=…]`,
 * added so "a number can never be silently compared against one measured in a
 * distorting build" — `debug=true` attaches the full raw API payload to every
 * transformed item, landing inside `emit`, the largest component of a Home run.
 *
 * ⚠️ `ENABLE_RTA` is NOT in this bracket. It is the third compile-time flag that
 * can move a measurement (it makes the on-device ODC component resident), and a
 * line lifted out of a scrollback therefore cannot self-report it. `measure.js`
 * records it from the deploy it performed; a line found loose in a log cannot be
 * trusted about it at all.
 */
export function parseBuildFlags(message) {
  const m = /\[([^\]]*)\]/.exec(message);
  if (!m) return undefined;
  const flags = {};
  for (const pair of m[1].split(/\s+/)) {
    const [k, v] = pair.split('=');
    if (k && v !== undefined) flags[k] = v === 'true' ? true : v === 'false' ? false : v;
  }
  return Object.keys(flags).length ? flags : undefined;
}

/** Numeric fields, declared once so a pattern only has to name its groups. */
const nums = (groups) => {
  const out = {};
  for (const [k, v] of Object.entries(groups || {})) {
    if (v === undefined) continue;
    const n = Number(v);
    out[k] = Number.isFinite(n) ? n : v;
  }
  return out;
};

/**
 * One measurement family.
 *
 * - `id` — the record key and the `--measurement` argument.
 * - `screen` — WHERE the app was when the lines were emitted, or `null` when the
 *   family alone cannot say. A measurement is a `(screen, family)` pair: the family
 *   says which loader emitted the timing, the screen says what was on the device.
 *   Today `measure.js` reaches a screen by RELAUNCHING, so only Home is reachable
 *   and the field looks redundant — it is not, and it is declared now rather than
 *   retrofitted, because tier 3's selection predicate is `(measurement, screen)`
 *   and this project has already paid for the retrofit lesson once: `deviceKey` was
 *   added to the run ledger after the fact and the first four runs predate it
 *   entirely, so they can never join a series.
 * - `lines` — the console lines that together make ONE sample. `required` lines
 *   must all be seen before a sample is complete; an optional line enriches it.
 * - `workload` — which of the parsed fields describe HOW MUCH WORK the run did
 *   rather than how long it took. This is the tier-2 split, declared per family
 *   because only the family knows which of its numbers is a workload: Home's
 *   `rows` is a workload and its `totalMs` is a timing, and no naming convention
 *   reliably separates them.
 * - `primary` — the field a comparison headlines. Named explicitly because the
 *   doc is emphatic that not every emitted number is trustworthy: `drain` is a
 *   remainder of two quantities measured on concurrently-running threads and
 *   must not be compared, so a tool that headlined "the biggest number" would
 *   headline the one value the doc says to ignore.
 */
export const MEASUREMENTS = Object.freeze([
  Object.freeze({
    id: 'home-latest-rows',
    title: 'Home first paint (latest-rows)',
    doc: 'docs/dev/home-first-paint-performance.md',
    // Fixed: this family is emitted by Home's own loader and by nothing else, so
    // the screen is a property of the family rather than of the run.
    screen: 'home',
    // Observed end to end on `.177`, 2026-08-12.
    grounded: true,
    primary: 'totalMs',
    workload: Object.freeze(['rows']),
    lines: Object.freeze([
      Object.freeze({
        key: 'total',
        required: true,
        // `m.log.info("latest-rows run complete", count, "rows", ms, "ms")` —
        // value BEFORE label, which is why this cannot share a pattern with the
        // orchestrator line below.
        pattern: /latest-rows run complete (?<rows>\d+) rows (?<totalMs>\d+) ms/,
      }),
      Object.freeze({
        key: 'orchestrator',
        required: true,
        pattern:
          /latest-rows orchestrator done -.*?task (?<taskMs>\d+) wait (?<waitMs>\d+) emit (?<emitMs>\d+)/,
      }),
      Object.freeze({
        key: 'emitSplit',
        required: false,
        pattern:
          /latest-rows emit split -.*?xform (?<xformMs>\d+) append (?<appendMs>\d+) notify (?<notifyMs>\d+)/,
      }),
      Object.freeze({
        key: 'populateSplit',
        required: false,
        pattern:
          /latest-rows populate split attach (?<attachMs>\d+) detach (?<detachMs>\d+) other (?<otherMs>\d+)/,
      }),
      Object.freeze({
        // How often the row geometry was rewritten, and what that cost. Emitted as its
        // OWN line rather than three more groups on `populate split` because `m.log.*`
        // faults at runtime past nine call-site arguments.
        //
        // OPTIONAL, and that is load-bearing rather than cautious: only a build carrying
        // the row-size batching emits it at all, so a REQUIRED line here would drop every
        // sample taken on a build without it — which is exactly the arm any comparison
        // needs as its baseline. An arm that emits nothing records the timings it does
        // have and reports the line as uncovered.
        key: 'sizeRecompute',
        required: false,
        // Transcribed from the pattern that read real device lines throughout the #728
        // campaign rather than rewritten from the call site, so the two cannot disagree
        // about spacing. The columns are documented in
        // `docs/dev/home-first-paint-performance.md` ("size recompute").
        pattern:
          /latest-rows size recompute\s+calls\s+(?<sizeCalls>\d+)\s+drains\s+(?<sizeDrains>\d+)\s+ms\s+(?<sizeMs>\d+)/,
      }),
    ]),
  }),
  Object.freeze({
    id: 'item-grid',
    title: 'Item grid / genres load',
    doc: 'docs/dev/home-first-paint-performance.md#the-grids-genre-loop--the-same-method-the-opposite-answer',
    // NULL, deliberately, and not an oversight: `LoadItemsTask2` backs EVERY library
    // grid because they are all `BaseGridView`, so this family says nothing about
    // which library was open — and a movies grid and a shows grid are different
    // workloads under one id. Whoever navigates there has to say (`--screen`), and
    // until something can, a comparison of two null-screen series is warned about
    // rather than silently trusted.
    screen: null,
    // Written from the emitting call site (LoadItemsTask2.bs:421), which is
    // authoritative for the MESSAGE — it is the format string.
    //
    // GROUNDED 2026-08-19, on ledger evidence rather than recollection — the same
    // standard `screen-load` was flipped on, and this family was the last one left
    // ungrounded. `--nav moviesLibraryGrid --library <id>` on a Stick 4K produced
    // **5/5 cold samples** (taskMs median 426 ms, items 28, genreFetches 0). Until
    // then every run printed "the item-grid pattern has never matched a real device
    // line", which on a genuine zero-sample run tells the operator the pattern is at
    // least as likely at fault as the app — backwards once the pattern is proven.
    //
    // ⚠️ It stayed ungrounded this long for a reason worth knowing: reaching ANY
    // library grid needs `--library <id>` on a server with more than one library of a
    // type, because the nav resolves the Home tile by `collectionType` and REFUSES an
    // ambiguous match rather than guessing. Two runs were blocked by exactly that
    // before one landed. See `docs/dev/measuring-performance.md`.
    grounded: true,
    primary: 'taskMs',
    // `items` and `genreFetches` are already hand-rolled into the message, which
    // is the same instinct tier 2 formalises: record what the run had to chew on,
    // beside how long it took.
    workload: Object.freeze(['items', 'genreFetches']),
    lines: Object.freeze([
      Object.freeze({
        key: 'load',
        required: true,
        pattern:
          /item-grid load done - items (?<items>\d+) genreFetches (?<genreFetches>\d+) firstPaint (?<firstPaintMs>-?\d+).*?task (?<taskMs>\d+) wait (?<waitMs>\d+) emit (?<emitMs>\d+)/,
      }),
    ]),
  }),
  Object.freeze({
    id: 'screen-load',
    title: 'Screen readiness (paint + settle)',
    // The doc this family OWNS, as of 2026-08-19. It pointed at
    // `home-first-paint-performance.md` only because that was the file that existed —
    // a `doc:` naming a missing file is a dead link in every message that prints it, and
    // a registry test asserts every path here resolves. The two docs answer different
    // questions (see the note at the top of this file): `screen-load` is about WHEN a
    // screen became usable, which is what `measuring-performance.md` is for.
    doc: 'docs/dev/measuring-performance.md',
    // NULL because this family covers EVERY instrumented screen — and unlike
    // `item-grid` above, that is not a gap waiting to be filled by `--screen`. The
    // app emits its own screen name into the line, so the screen arrives as a
    // DIMENSION of the sample rather than as something the operator asserts from
    // outside. That is strictly better evidence, and it is the same argument that
    // made `enableRta` derived rather than assumed in `measure.js`.
    screen: null,
    // Written from `source/utils/screenReadiness.bs`, which is authoritative for the
    // MESSAGE (it is the format string) — and it has now been seen on the wire many
    // times over. Flipped on evidence read out of the ledger rather than on the memory
    // of having run it: `.device-runs/measure/measurements.jsonl` holds 35 `screen-load`
    // series, 32 of them carrying at least one COMPLETE sample, across six distinct
    // components (`itemDetails`, `videoPlayer`, `settings`, `searchResults`, `preLogin`,
    // `setServer`) and three days.
    //
    // Left at `false` this was not a harmless stale flag: `measure.js` prints "the
    // screen-load pattern has never matched a real device line" on EVERY run, and on a
    // genuine zero-sample run it says the pattern is at least as likely at fault as the
    // app. That is now backwards — a screen that emits nothing here is the app or the
    // build, and the message was sending whoever hit it to audit a proven parser.
    grounded: true,
    primary: 'paintMs',
    // WHICH LOAD a line belongs to. The assembler splits on this, and it is the whole
    // reason `component` + `variant` are repeated on all three lines rather than stated
    // once on the paint line.
    //
    // A chained navigation mounts one component more than once per launch — reaching a
    // Season means loading its Series first, and the details route is keepAlive with no
    // allowReuse, so each is a FRESH component with its own ledger. Two ledgers emit
    // onto one console and interleave: the nav's gate waits on paint, so it presses into
    // the Season while the Series' extras chain is still running (measured at 649 ms for
    // a Series, 2677 ms for a Movie). Without an identity the assembler files the
    // Series' settle against the Season's paint, and the result is not a detectable
    // error — every field is well-formed while describing two different screens.
    //
    // The legacy families below declare none, so their lines all share one identity and
    // they take exactly the path they took before this existed.
    identity: Object.freeze(['component', 'variant']),
    // Counts of fills, not durations. `fills` is the total; the two class counts sum
    // to it. A sample with more fills than another did more work, which is exactly
    // what tier 2 means by workload.
    workload: Object.freeze(['fills', 'contentFills', 'textureFills']),
    lines: Object.freeze([
      Object.freeze({
        key: 'paint',
        // The only REQUIRED line, and deliberately so. A screen that paints and then
        // never settles has an async fill that never landed, and that must show up as
        // a sample with a paint time and no settle time — not as a dropped sample
        // (which would make a broken screen look like a device that ran fewer times)
        // and not as a silently shorter series.
        required: true,
        pattern:
          /screen-load paint - component (?<component>\S+) variant (?<variant>\S+) ms (?<paintMs>\d+)/,
      }),
      Object.freeze({
        key: 'settled',
        required: false,
        // Captures the identity rather than skipping to the numbers. The earlier form
        // (`settled -.*? ms …`) discarded both, which made the mis-filing above
        // impossible to detect FROM THE RECORD — the burden is on being able to show it
        // did not happen, and a pattern that throws the evidence away cannot.
        pattern:
          /screen-load settled - component (?<component>\S+) variant (?<variant>\S+) ms (?<settledMs>\d+) fills (?<fills>\d+)/,
      }),
      Object.freeze({
        // The per-class breakdown, split off `settled` only because roku-log caps a
        // call at nine arguments — see the note in screenReadiness.bs. It is one
        // sample with the line above, not a second measurement.
        //
        // ⚠️ `contentMs` / `textureMs` are SUMS OVER CONCURRENT FILLS and are NOT
        // shares of `settledMs`. The fills overlap, so the sums can exceed the wall
        // clock — observed on `.177`: a Series detail settled in 845 ms with
        // `contentMs 878`. Do not render either as a percentage of the load.
        // `slowestContentMs` IS bounded by `settledMs`, and is the one to act on.
        key: 'split',
        required: false,
        // `instrumentUs` is OPTIONAL in the pattern and that is load-bearing rather
        // than lazy: every `screen-load` line taken before the ledger began timing
        // itself lacks the field, and a required group would stop those lines matching
        // at all — silently turning three days of recorded series into unparseable
        // text. Absent reads as absent, which is the same rule the family already
        // applies to a settled line that never arrived.
        pattern:
          /screen-load split - component (?<component>\S+) variant (?<variant>\S+) content (?<contentFills>\d+) contentMs (?<contentMs>\d+) slowestContent (?<slowestContent>\S+) (?<slowestContentMs>\d+) texture (?<textureFills>\d+) textureMs (?<textureMs>\d+) slowestTexture (?<slowestTexture>\S+) (?<slowestTextureMs>\d+)(?: instrumentUs (?<instrumentUs>\d+))?/,
      }),
    ]),
  }),
  Object.freeze({
    id: 'cell-load',
    title: 'Cell binds and image loads',
    doc: 'docs/dev/measuring-performance.md',
    // NULL for the same reason `screen-load` is: this family covers EVERY screen that
    // uses the texture manager, and the app emits its own component name into the line,
    // so the screen arrives as a DIMENSION of the sample rather than as something the
    // operator asserts from outside.
    screen: null,
    // GROUNDED 2026-08-20 on `.177`, on ledger evidence rather than on having written the
    // emit: one launch produced EIGHT lines across three distinct components (`HomeRows`,
    // `ExtrasRowList`, `BaseGridView` twice), every field populated, no crash. The
    // multi-component run is what makes it grounded rather than merely seen — it exercised
    // both content shapes (two-level RowList and flat MarkupGrid) and both emit triggers
    // (hide on navigate-away, destroy on teardown).
    grounded: true,
    primary: 'binds',
    // What the run had to chew on. `items` is the content root's child count at emit —
    // rows for a RowList, items for a grid — so `binds / items` is the REBIND RATE, which
    // is the number this family exists to publish.
    workload: Object.freeze(['items']),
    // Every other numeric field here is a COUNT, and a count is not milliseconds. Kept
    // apart from `workload` on purpose: workload is an INPUT held constant across arms and
    // feeds the same-work identity check, while these are the OUTCOMES an A/B is trying to
    // move. See `unitFor`. `loadMs` / `loadMsMax` are absent because they really are
    // durations; `instrumentUs` is absent because its name already answers the question.
    counts: Object.freeze([
      'binds',
      'bindsFromContent',
      'bindsFromSize',
      'bindsRedundant',
      'loadsStarted',
      'loadsFailed',
      'loadsSucceeded',
      'reloads',
      'unloads',
      'wipesBind',
      'wipesReload',
      'appearances',
      'popIns',
      'popInsCold',
      'popInsReload',
      'popInsFirst',
      'loadMsCount',
    ]),
    // A session is per COMPONENT, and a chained navigation mounts more than one cell-
    // bearing screen per launch (Home is suspended, not destroyed, while ItemDetails
    // loads over it), so their sessions interleave on one console exactly the way two
    // `screen-load` ledgers do. Without this identity the assembler would file a grid's
    // work line against Home's bind line and every field would look well-formed.
    identity: Object.freeze(['component']),
    lines: Object.freeze([
      Object.freeze({
        key: 'binds',
        required: true,
        // `fromSize` is USUALLY zero and is carried as a standing invariant: a layout
        // change that starts re-issuing image requests has no other symptom, and a counter
        // that is almost always zero is the cheapest possible way to notice it moved.
        //
        // It is NOT always zero, and the earlier note here saying so was withdrawn on
        // 2026-08-20 rather than qualified. Across the scripted cell sweeps it reads 0 on
        // the grid, extras and search mounts on every launch, and on five of Home's six —
        // but the sixth read 1, and that was the same launch that was the outlier on both
        // `binds` (253 against a median of 235) and `loadsStarted` (179 against 164). The
        // counter fired on exactly the anomalous run and nowhere else, which is the
        // behaviour it was added for. See `docs/dev/measuring-performance.md`.
        pattern:
          /cell-load binds - component (?<component>\S+) binds (?<binds>\d+) fromContent (?<bindsFromContent>\d+) fromSize (?<bindsFromSize>\d+) redundant (?<bindsRedundant>\d+) items (?<items>\d+)/,
      }),
      Object.freeze({
        // Split off `binds` only because roku-log caps a call at nine arguments once the
        // BSC plugin has spent one on the injected pkg path — the same constraint that
        // splits `screen-load settled` from `screen-load split`. One sample, two lines.
        key: 'work',
        required: false,
        // `loadsFailed` far exceeding the number of distinct broken images is the
        // signature of a retry that has no memory of the last failure. `wipesReload` vs
        // `wipesBind` separates a glyph wiped on a cell that was CHANGING anyway from one
        // wiped on a cell sitting still — only the second reads to a user as flicker.
        //
        // `loadsSucceeded` is OPTIONAL in the pattern so records emitted before it existed
        // still parse. Read it with `loadsStarted`: their difference minus `loadsFailed` is
        // the count still in flight at the emit boundary, which a run ended on quiescence
        // should report as zero. Before this counter, "successful loads" could only be
        // inferred as `loadsStarted - loadsFailed`, which silently counts a request that
        // never came back as a success.
        pattern:
          /cell-load work - component (?<component>\S+) loadsStarted (?<loadsStarted>\d+) loadsFailed (?<loadsFailed>\d+)(?: loadsSucceeded (?<loadsSucceeded>\d+))? reloads (?<reloads>\d+) unloads (?<unloads>\d+) wipesBind (?<wipesBind>\d+) wipesReload (?<wipesReload>\d+)(?: instrumentUs (?<instrumentUs>\d+))?/,
      }),
      Object.freeze({
        // The RACE, where `binds` and `work` are the WORK. The buffer exists to load a
        // cell's image before the cell is on screen; `popIns` is how often it did not.
        //
        // Read `popIns` against `appearances`, never on its own — a raw count moves with
        // how far the sweep travelled, which is the same trap `binds` needs `items` for.
        //
        // A pop-in is scored only once the image ACTUALLY ARRIVES, so a permanently broken
        // image lands in `loadsFailed` and not here. Without that, `ExtrasRowList` (117 of
        // 140 loads fail against a real server) would report a total buffer failure caused
        // entirely by missing artwork.
        //
        // `popInsCold` / `popInsReload` / `popInsFirst` partition `popIns` three ways, all
        // emitted so none has to be derived by subtraction. Cold: no request in flight, so
        // the user outran the buffer's DEPTH and more depth would help. Reload: a re-entry
        // request was running and the network was slower — depth cannot fix it. First: the
        // cell's FIRST render was still loading, so the data had only just arrived and no
        // buffer could have won. **`popInsFirst` dominates any sweep that OPENS its
        // screen** — measured 2026-08-21 on `cellSweepGrid`, where `popIns` read 18 of 28
        // appearances with `popInsCold` 0. Reading that 18 as a buffer failure is the
        // mistake this split exists to prevent.
        //
        // 🚨 `loadMs` is a SUM OVER CONCURRENT REQUESTS and is NOT a share of the wall
        // clock — measured 16416 ms inside an ~1800 ms sweep, 9.1x, because the grid has
        // ~34 posters in flight at once. Same hazard, and same wording, as `screen-load`'s
        // `contentMs`. `loadMsMax` IS bounded by the sweep.
        //
        // `loadMsMax` is the one to act on; `loadMs / loadMsCount` is the mean. Divide by
        // `loadMsCount` and NOT by `loadsSucceeded`: a "ready" with no matching issue is a
        // success with no interval, so the two counts legitimately differ.
        //
        // Not `required`, for the reason `screen-load split` is not: every cell-load record
        // taken before this line existed lacks it, and a required line would stop those
        // samples assembling at all.
        key: 'popin',
        required: false,
        pattern:
          /cell-load popin - component (?<component>\S+) appearances (?<appearances>\d+) popIns (?<popIns>\d+) popInsCold (?<popInsCold>\d+) popInsReload (?<popInsReload>\d+) popInsFirst (?<popInsFirst>\d+) loadMs (?<loadMs>\d+) loadMsCount (?<loadMsCount>\d+) loadMsMax (?<loadMsMax>\d+)/,
      }),
    ]),
  }),
]);

/** Look a family up by id; `undefined` when it is not registered. */
export const measurementById = (id) => MEASUREMENTS.find((m) => m.id === id);

/** Every registered id, for CLI help and validation messages. */
export const measurementIds = () => MEASUREMENTS.map((m) => m.id);

/**
 * Match one console line against a family. Returns `{ key, fields, buildFlags }`
 * for the line that matched, or `null`.
 */
export function matchLine(measurement, raw) {
  const parsed = parseLogLine(raw);
  if (!parsed) return null;
  for (const line of measurement.lines) {
    const m = line.pattern.exec(parsed.message);
    if (!m) continue;
    return {
      key: line.key,
      required: line.required,
      fields: nums(m.groups),
      buildFlags: parseBuildFlags(parsed.message),
      source: parsed.source,
    };
  }
  return null;
}

/**
 * Assemble console lines into discrete samples.
 *
 * ## Why this is not "one console window, one sample"
 *
 * A window can hold more than one run. Home's `refresh()` re-runs the load on a
 * return to Home, and a console window that starts before a launch can also carry
 * a REPLAYED line — Roku replays recent output to a newly-connected socket, and a
 * probe on `.177` measured one arriving 10 ms after connect reading `10 rows 7241
 * ms`, against a live range of 1439–2654 ms that session.
 *
 * Either way, collapsing a window to "the" number is how a stale or a warm run
 * gets averaged into a cold-paint series. So samples are delimited by the LINES
 * rather than by the launch, every one is emitted separately, and the caller
 * decides which are comparable.
 *
 * (An earlier version of this note claimed a single launch emits two runs, from a
 * capture that had no timestamps and could not distinguish replay from live. A
 * timestamped probe showed one launch produces exactly one run. The splitting
 * below is still right; the reason given for it was not.)
 *
 * ## The delimiting rule
 *
 * A sample opens on the first matching line and closes when a line it ALREADY
 * has repeats WITHIN ITS OWN IDENTITY — the app has moved on to another run of
 * that same thing. The four Home lines are
 * emitted by two different threads and can interleave, so a strict order cannot
 * be assumed, but a repeat is unambiguous.
 *
 * It deliberately does NOT close as soon as every `required` line has arrived,
 * which was the first rule tried and which a test caught: on a real device the
 * order is `run complete` → `populate split` → `orchestrator done` → `emit
 * split`, so the required pair completes with one optional line still in flight.
 * Closing there truncated every sample and filed the trailing `emit split` as the
 * start of a phantom third run. `required` decides whether a closed sample is
 * COMPLETE; it does not decide when to close.
 *
 * An incomplete sample is emitted with `complete: false` rather than dropped or
 * merged forward. Dropping it would make a device that stopped mid-run look like
 * a device that ran fewer times, and merging would fabricate a run out of halves
 * of two — the same conflation `run-record.js` removed from the ledger's
 * `failures: []`.
 */
export function assembleSamples(measurement, rawLines) {
  const required = measurement.lines.filter((l) => l.required).map((l) => l.key);
  const samples = [];
  // One open sample PER IDENTITY, not one open sample. A family that declares no
  // identity puts every line under the same key, which is byte-for-byte the previous
  // single-open behaviour — the two legacy families take that path.
  const open = new Map();
  let opened = 0;

  // The separator is written as an ESCAPE, not as a literal NUL byte in the source. It
  // has to be a character that cannot occur inside an identity value, and a raw \0 here
  // made this whole file read as BINARY to grep/rg -- which return silently empty rather
  // than erroring, so a search for a family in this file answers 'not found'.
  const identityOf = (fields) =>
    (measurement.identity || []).map((k) => fields?.[k] ?? '').join('\u0000');

  const finish = (key) => {
    const sample = open.get(key);
    if (!sample) return;
    sample.complete = required.every((k) => sample.seen.includes(k));
    delete sample.seen;
    samples.push(sample);
    open.delete(key);
  };

  for (const raw of rawLines || []) {
    const hit = matchLine(measurement, raw);
    if (!hit) continue;
    const key = identityOf(hit.fields);
    if (open.get(key)?.seen.includes(hit.key)) finish(key);
    if (!open.has(key)) {
      open.set(key, {
        measurement: measurement.id,
        // Order of FIRST APPEARANCE, so the emitted array is mount order rather than
        // completion order. They differ exactly when it matters: a chained navigation's
        // first screen keeps loading while the second paints, so it finishes LAST while
        // having started first, and `indexInLaunch` has to keep meaning "which mount".
        openedAt: opened++,
        fields: {},
        seen: [],
        lines: [],
      });
    }
    const sample = open.get(key);
    sample.seen.push(hit.key);
    sample.lines.push(hit.key);
    Object.assign(sample.fields, hit.fields);
    if (hit.buildFlags) sample.buildFlags = { ...sample.buildFlags, ...hit.buildFlags };
  }
  for (const key of [...open.keys()]) finish(key);

  samples.sort((a, b) => a.openedAt - b.openedAt);
  for (const s of samples) delete s.openedAt;
  return samples;
}

/**
 * Split a sample's fields into the tier-2 halves — what the run had to do, and how
 * long it took — plus the DIMENSIONS that say which run it was.
 *
 * The workload/timing split rests on being explicit rather than inferred: tier 2
 * RECORDS workload and never asserts on it, and tier 3 prints the workload delta
 * beside the timing delta so drift is visible instead of refused.
 *
 * The third bucket is inferred, and can be: a dimension is any field whose value is
 * not a number. `screen-load` emits `screen itemDetails`, `variant Movie` and
 * `slowestContent extras` alongside its milliseconds, and none of the three is a
 * quantity — subtracting two of them is meaningless, so leaving them in `timings`
 * would hand `measure:compare` string operands for a numeric delta and a
 * Mann-Whitney. No per-family declaration is needed for the same reason the split
 * above needs one: "is this a count or a duration" genuinely requires the family to
 * say, while "is this a number at all" is decidable here and cannot drift.
 *
 * Families that emit no non-numeric field get an empty object, which is why the two
 * pre-existing ones are unaffected.
 */
export function splitWorkload(measurement, fields = {}) {
  const workload = {};
  const timings = {};
  const dimensions = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v !== 'number') dimensions[k] = v;
    else if (measurement.workload.includes(k)) workload[k] = v;
    else timings[k] = v;
  }
  return { workload, timings, dimensions };
}

/**
 * The unit a field is expressed in — from its NAME for a duration, from the FAMILY
 * for a count.
 *
 * Every reporting layer used to append a bare `ms` to whatever number a family
 * emitted, which was true for as long as every field was milliseconds. `instrumentUs`
 * is the first that is not, and printing it as `3200 ms` would not be a cosmetic
 * slip — it is the well-formed-but-wrong shape this subsystem exists to refuse, and
 * a reader has no way to catch a unit error from the number alone.
 *
 * Durations are keyed on the name's suffix rather than a per-field table, so a family
 * that adds `somethingUs` tomorrow inherits it without a second place to update.
 *
 * An OUTCOME COUNT is not a duration either, and it is not workload: workload is what the
 * run had to chew on and is expected to be IDENTICAL across arms (`workloadKey` builds a
 * comparison identity out of it, and `measure:compare` warns when two samples disagree),
 * while `popIns` and `binds` are results that are SUPPOSED to differ — putting them in
 * `workload` would make every cell-load comparison report samples that "did not all do the
 * same work". Hence a separate `counts` list: same unit answer, opposite role. Verified
 * before it was added rather than supposed — `unitFor('binds', cellLoad)` returned `'ms'`,
 * so `measure:report --field popIns` would have headlined a pop-in count as milliseconds,
 * the same well-formed-but-wrong shape that `--field items` printed before workload took a
 * family.
 *
 * A WORKLOAD field is not a duration and has no unit at all, and no naming convention
 * can say which is which — `rows` is a count and `totalMs` is a duration, but so is
 * `items` a count and `taskMs` a duration, and only the family knows. That is the same
 * reason `splitWorkload` takes a `measurement`: *"is this a count or a duration"
 * genuinely requires the family to say.* So pass the family whenever the caller has
 * one. Every reader that headlines an arbitrary field does — `measure:report`'s
 * `--field items` printed `median 28 ms` for an item count before this took one.
 *
 * @param key the field name.
 * @param measurement OPTIONAL, and omitting it is a claim: without the family the
 *   workload list is unknown, so a count reads as `ms`. Only safe when the key is
 *   known to be a timing. Every caller that can name the family should.
 *
 * Lives here rather than in `measure.js` / `measure-compare.js` for the reason ADR
 * 0028 names: `measure.js` claims the device at import, so a rule that lives there has
 * no gate under it.
 */
export function unitFor(key, measurement) {
  if (measurement?.workload?.includes(key)) return '';
  if (measurement?.counts?.includes(key)) return '';
  return /Us$/.test(key) ? 'µs' : 'ms';
}

/**
 * A value with its unit, as every reporting layer prints one.
 *
 * Beside `unitFor` rather than private to a reader, because it has to agree with it:
 * a workload field's unit is the empty string, and a renderer that pastes it on anyway
 * emits `28 ` — a trailing space inside a padded column. That coupling is the argument
 * for one copy; `measure.js` and `measure:compare` both had their own before this.
 *
 * `—` for a missing value, never `0`: no sample carrying the field and every sample
 * carrying zero are different claims, and this subsystem refuses to blur them.
 */
export const withUnit = (v, unit = 'ms') => {
  if (v === null || v === undefined) return '—';
  const n = Math.round(v * 10) / 10;
  return unit ? `${n} ${unit}` : `${n}`;
};

/**
 * Every field name a family's patterns can produce, each once.
 *
 * Distinct from the keys a RUN happened to observe, and the difference is the whole
 * point: a family that DECLARES `instrumentUs` and saw none has an app older than the
 * field or a build that emitted nothing, and that must be reported rather than read as
 * "this family does not have one". Absence and inapplicability are different claims.
 *
 * De-duplicated because a family's lines repeat the fields that IDENTIFY a sample —
 * `screen-load` carries `component` and `variant` on all three — so the raw scan
 * returns them once per line. No caller today is harmed by that, but "every field name"
 * is the contract, and a count or a rendered list is the obvious next use.
 */
export function declaredFields(measurement) {
  return [
    ...new Set(
      measurement.lines.flatMap((line) =>
        [...line.pattern.source.matchAll(/\(\?<(\w+)>/g)].map(([, group]) => group),
      ),
    ),
  ];
}

/**
 * What fraction of a run's wall clock the ledger itself accounts for.
 *
 * `settledMs` is the denominator rather than the family primary, and that is not a
 * detail: the instrument's span runs from `begin` to the settled emit, which is
 * precisely what `settledMs` measures. `paintMs` contains only the bookkeeping inside
 * `begin`, so dividing by it would overstate the footprint several-fold on exactly the
 * number people quote most.
 *
 * `null` — never 0 — when it cannot be computed. A screen that painted and never
 * settled has no wall clock to be a fraction OF, and returning zero there would report
 * the most broken case as the cleanest one.
 */
export function instrumentShare(instrumentUs, settledMs) {
  if (!Number.isFinite(instrumentUs) || !Number.isFinite(settledMs) || settledMs <= 0) return null;
  return instrumentUs / 1000 / settledMs;
}
