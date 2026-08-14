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
    // authoritative for the MESSAGE — it is the format string. Not yet seen on
    // the wire, so `measure.js` refuses to report it as grounded.
    grounded: false,
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
    doc: 'docs/dev/measuring-performance.md',
    // NULL because this family covers EVERY instrumented screen — and unlike
    // `item-grid` above, that is not a gap waiting to be filled by `--screen`. The
    // app emits its own screen name into the line, so the screen arrives as a
    // DIMENSION of the sample rather than as something the operator asserts from
    // outside. That is strictly better evidence, and it is the same argument that
    // made `enableRta` derived rather than assumed in `measure.js`.
    screen: null,
    // Written from `source/utils/screenReadiness.bs`, which is authoritative for the
    // MESSAGE (it is the format string) but has not yet been seen on the wire.
    grounded: false,
    primary: 'paintMs',
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
          /screen-load paint - screen (?<screen>\S+) variant (?<variant>\S+) ms (?<paintMs>\d+)/,
      }),
      Object.freeze({
        key: 'settled',
        required: false,
        pattern: /screen-load settled -.*? ms (?<settledMs>\d+) fills (?<fills>\d+)/,
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
        pattern:
          /screen-load split - content (?<contentFills>\d+) contentMs (?<contentMs>\d+) slowestContent (?<slowestContent>\S+) (?<slowestContentMs>\d+) texture (?<textureFills>\d+) textureMs (?<textureMs>\d+) slowestTexture (?<slowestTexture>\S+) (?<slowestTextureMs>\d+)/,
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
 * has repeats — the app has moved on to another run. The four Home lines are
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
  let open = null;

  const finish = () => {
    if (!open) return;
    open.complete = required.every((k) => open.seen.includes(k));
    delete open.seen;
    samples.push(open);
    open = null;
  };

  for (const raw of rawLines || []) {
    const hit = matchLine(measurement, raw);
    if (!hit) continue;
    if (open && open.seen.includes(hit.key)) finish();
    if (!open) open = { measurement: measurement.id, fields: {}, seen: [], lines: [] };
    open.seen.push(hit.key);
    open.lines.push(hit.key);
    Object.assign(open.fields, hit.fields);
    if (hit.buildFlags) open.buildFlags = { ...open.buildFlags, ...hit.buildFlags };
  }
  finish();
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
