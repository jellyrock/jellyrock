/**
 * Take an on-device performance measurement that carries its own provenance.
 *
 *   npm run measure                          n=5 samples of Home first paint
 *   npm run measure -- -n 30                 a real series
 *   npm run measure -- --measurement item-grid
 *   npm run measure -- --server http://192.168.1.2:8098   assert tier 1
 *   npm run measure -- --deploy              sideload first (default: use what is on the device)
 *   npm run measure -- --window-ms 20000     cap the per-launch watch (default 45 s)
 *   npm run measure -- --arm before          label this series for `npm run measure:compare`
 *   npm run measure -- --screen movies-grid  say which screen, when the family cannot
 *
 * ## Taking the two arms of a comparison
 *
 * Alternate the arms — `--arm before`, `--arm after`, `--arm before`, … — rather than
 * taking all of one and then all of the other, so content drift and device warm-up
 * cancel instead of aliasing onto one arm. `npm run measure:compare` reads the arms
 * back, prints the workload delta beside the timing delta, and CHECKS the alternation
 * from the recorded sample times rather than trusting that it happened.
 *
 * ## What it needs on the device — the precondition, stated
 *
 * **The build on the device must be an RTA deploy** (`injectTestingFiles`, which
 * flips `ENABLE_RTA` on in the staged manifest). Identity is read over ODC and
 * nothing else, so ODC is a hard precondition, not a nicety: without it the tool
 * refuses before taking a sample rather than recording a series it cannot attribute.
 *
 * `--deploy` guarantees that state. The default does NOT — it measures whatever is
 * resident, which in practice means "whatever the last `npm run test:rta` or
 * `npm run measure -- --deploy` left there". That was an unstated assumption in the
 * first revision and it is worth being blunt about, because it cuts both ways: the
 * mode that avoids re-deploying is the mode where the tool knows least about what
 * it is measuring. See the provenance note below.
 *
 * ## What the record can and cannot claim about the build
 *
 * - `enableRta` is **derived, not assumed**: a responding ODC proves the running
 *   build has it on. True on every run that gets far enough to record anything.
 * - `checkout.appVersion` / `commit` / `dirty` describe **this working tree**. They
 *   describe the device only when `--deploy` put it there, which is why
 *   `checkout.deployedFromCheckout` is recorded beside them instead of leaving a
 *   reader to assume.
 * - `checkout.agreesWithDevice` compares the checkout's `bs_const` against the
 *   `[debug=… perfTiming=…]` bracket the app stamps into its own timing lines. It
 *   is the only evidence available that a non-deploy run measured this checkout's
 *   code at all, and `false` is printed loudly.
 *
 * ## What this replaces
 *
 * The documented procedure
 * ([`home-first-paint-performance.md`](../docs/dev/home-first-paint-performance.md))
 * is: sideload a dev build, hold a console socket open, relaunch n≥5 times, read
 * the numbers off the terminal, and type the medians into a document. Every
 * safeguard in it is a thing whoever runs it has to remember — and the project's own
 * audit found that recent samples were clear of a leaked demo session only
 * *because each happened to record a count* a reader could check afterwards.
 *
 * This does the same run and writes down what it was taken against.
 *
 * ## Three traps this closes by construction
 *
 * 1. **The wrong server.** Nothing in any existing record says which server a
 *    sample was taken against. Tier 1 asserts it (`--server`) and, always, pins
 *    the identity seen at session start and re-checks it at the end, so a server
 *    that moves UNDER a series cannot pass. See `measurement-guard.js` for why
 *    the assert is on `serverUrl` and not the `serverId`/`userId` pair.
 * 2. **Console replay, measured.** Reconnecting to port 8085 makes the device
 *    replay recent output, so a fresh capture reads a PREVIOUS run's line and
 *    reports it as a new sample. The docs name this trap; here is what it
 *    actually does, probed on `.177` 2026-08-12: a socket that connects and then
 *    sits completely idle receives a `latest-rows run complete` line **10 ms
 *    later**, reading `10 rows 7241 ms` — a number nowhere near the live
 *    distribution that same session produced (1439–2654 ms). A per-sample
 *    reconnect would have folded that 7241 into the series.
 *
 *    Two independent defences, because this one is expensive to get wrong: ONE
 *    socket is opened for the whole session and never reconnected, AND every
 *    sample is selected by timestamp from the window that follows its own launch,
 *    so anything buffered before that window cannot enter it.
 *
 *    This trap caught the author. The capture used to GROUND the parser saw two
 *    `run complete` lines and they were written up as "one launch emits a cold
 *    paint and a refresh, 77% apart". That capture had no timestamps, so it could
 *    not tell replay from live; the timestamped probe above shows one launch
 *    produces exactly ONE run, and the first line had been replayed. The claim was
 *    wrong and is recorded here rather than quietly deleted, because it is the
 *    same shape of error this project has hit repeatedly: a plausible mechanism
 *    fitted to an artifact of the instrument.
 * 3. **More than one run in a window is still possible, and is never averaged.**
 *    Home's `refresh()` genuinely re-runs the load on a return to Home, so a
 *    window CAN legitimately contain a second run. Samples are therefore stamped
 *    with `indexInLaunch`; 0 is what the summary reports, and any later run in the
 *    same window is recorded beside it rather than folded into the median.
 *
 * ## What it deliberately does NOT do
 *
 * **No registry lifecycle.** Every other device entry point snapshots and
 * restores the registry, because it SEEDS. This one measures the app as the
 * device already has it — signed into whatever server the developer uses, which
 * is the whole point of a perf measurement — so it never writes the registry and
 * has nothing to put back. If a future mode needs to seed, it must adopt
 * `lib/registry.js` at the same time; do not add a seed without one.
 *
 * **No threshold, no gate, no CI.** The numbers depend on server hardware,
 * library size, network and device model, none of which CI controls, so a
 * threshold cannot separate a regression from a busy server — and a flaky perf
 * gate teaches people to ignore it. This tool records; it never judges.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupRtaEnv, deployRtaBuild, hardRelaunch, ecp } from '../tests/rta/lib/driver.js';
import { RTA_CONFIG } from '../tests/rta/config.js';
import { acquireDeviceLock } from './device-lock.js';
import {
  beginRun,
  crossesHourBoundary,
  ledgerPath,
  runProvenance,
  RUN_OUTCOMES,
} from './run-record.js';
import {
  MEASUREMENTS,
  measurementById,
  measurementIds,
  assembleSamples,
  matchLine,
  splitWorkload,
} from './measurements.js';
import {
  readIdentity,
  missingIdentityFields,
  IDENTITY_FATAL_FIELDS,
  checkServerIdentity,
  checkSeriesConsistency,
  readDeviceProvenance,
  readAppVersion,
  readCheckoutBuildFlags,
  buildFlagsAgree,
} from './measurement-guard.js';
import { parseMeasureArgs, MeasureArgError } from './measure-args.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, 'manifest');

// Parsed by `measure-args.js`, which REFUSES an unknown flag or a value flag with
// no value rather than dropping it. A dropped `--server` is a run that silently
// stopped asserting the thing the operator typed it to assert, which is the one
// failure this tool must not have.
let args;
try {
  args = parseMeasureArgs(process.argv.slice(2), {
    measurementIds: measurementIds(),
    defaultMeasurement: MEASUREMENTS[0].id,
  });
} catch (e) {
  if (!(e instanceof MeasureArgError)) throw e;
  console.error(`[measure] ${e.message}`);
  process.exit(1);
}
const measurement = measurementById(args.measurement);

// How long to watch the console after each launch, capped so a device that never
// paints cannot hang the series. Cut short once a complete sample has been seen
// and the console has gone quiet for `QUIET_MS` — a device that has finished
// emitting has finished, and at n=30 the saving is real.
//
// `QUIET_MS` is what decides whether a legitimate SECOND run in the window is
// caught or cut off, so it is a real trade rather than a timeout to tune away: too
// short and a `refresh()` run is missed, too long and every sample pays for it.
// Six seconds is comfortably past the observed emit spread (a complete run's four
// lines arrived well inside 1 s on `.177`) without doubling the series length.
const MAX_WINDOW_MS = 45000;
const QUIET_MS = 6000;

setupRtaEnv(); // throws if ROKU_IP / ROKU_PASSWORD are missing — fail before touching anything

const host = process.env.ROKU_IP;
const lock = await acquireDeviceLock({ what: 'measure' });

// Same net as `rta-run.js`: a throw below this line would otherwise leave the
// device claimed by a dead process for the full lease. Nothing can await inside a
// `process.on('exit')` handler, so the release needs its own hook. A rejection out
// of top-level await surfaces as `uncaughtException`, not `unhandledRejection` —
// hook both rather than depend on which.
let socket = null;
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, async (err) => {
    console.error(
      `\n[measure] ${event} — releasing the device.\n${err?.stack || err?.message || err}`,
    );
    socket?.destroy();
    await lock.release().catch(() => {});
    process.exit(1);
  });
}

const run = beginRun({ lock, run: 'measure' });

if (args.deploy) {
  console.log('[measure] deploying (ENABLE_RTA) ...');
  await deployRtaBuild();
} else {
  console.log('[measure] using the build already on the device (pass --deploy to sideload)');
}

// ONE socket, held for the whole session — see trap 2 in the header.
const lines = [];
// Set by the socket callback below and reset per launch. Declared without an
// initializer because the only reads happen after a launch has reset it — an
// initial value here would be dead, and ESLint says so.
let lastMatchAt;
// The instant the current sample's window opens. Read by the socket callback, which
// runs outside the loop, so it cannot be a loop-local. `Infinity` until the first
// launch sets it: before that every arriving line is replay or setup traffic, and
// none of it may move the quiet clock.
let windowFrom = Infinity;
socket = net.createConnection(8085, host);
let buffered = '';
socket.on('data', (chunk) => {
  buffered += chunk.toString();
  const parts = buffered.split('\n');
  buffered = parts.pop();
  for (const line of parts) {
    const raw = line.replace(/\r+$/, '');
    lines.push({ at: Date.now(), raw });
    // Quiet-detection uses the registry's own matcher rather than a substring of
    // the pattern: the console carries a lot of unrelated traffic (`[http]` lines
    // arrive continuously during a load), so "something was printed" is not a
    // signal that the MEASUREMENT is still emitting.
    //
    // Gated on the same window the samples are, so a line the window excludes
    // cannot move the quiet clock either — otherwise a straggler from the previous
    // launch would age the clock and cut this launch's watch short.
    if (Date.now() >= windowFrom && matchLine(measurement, raw)) lastMatchAt = Date.now();
  }
});
socket.on('error', (e) => console.error(`[measure] console socket: ${e.message}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Collect console lines emitted since `from`, as raw strings. */
const since = (from) => lines.filter((l) => l.at >= from).map((l) => l.raw);

// ─── Tier 1 + tier 2, at the session boundary ────────────────────────────────
// Read BEFORE any sample, and again after the last one. Never between a relaunch
// and the line being measured — see the guard's header for why ODC traffic stays
// out of the measured window.
await hardRelaunch();

/** Fold the run as a NON-sample, release everything, and exit. */
async function refuse(message) {
  console.error(`\n[measure] ${message}`);
  run.close(RUN_OUTCOMES.BLOCKED);
  socket.destroy();
  await lock.release();
  process.exit(1);
}

// The ODC precondition, checked as a precondition rather than surfacing as a stack
// trace 5 s into an unexplained timeout. This is the documented failure of the
// default mode — nothing guarantees the resident build was RTA-deployed — so it
// gets the sentence that says what to do about it.
let identityAtStart;
try {
  identityAtStart = await readIdentity();
} catch (e) {
  await refuse(
    `could not read identity over ODC: ${e.message}\n` +
      '  `npm run measure` reads the server identity over ODC, which is present only in an RTA\n' +
      '  deploy. Re-run with --deploy to sideload one, or point it at a device that has one.',
  );
}

// A field ODC answered but could not find. `serverUrl` is fatal: tier 1 rests on
// it, and a series nobody can attribute to a server is not a series. The rest are
// reported and recorded as absent.
const missing = missingIdentityFields(identityAtStart);
const fatal = missing.filter((f) => IDENTITY_FATAL_FIELDS.includes(f));
if (fatal.length) {
  await refuse(
    `the app answered ODC but has no ${fatal.join(', ')} — it is probably not signed in.\n` +
      '  A sample cannot be attributed to a server, so it is not a sample.',
  );
}
if (missing.length) {
  console.log(`[measure] ⚠ identity fields absent, recorded as null: ${missing.join(', ')}`);
}

const expectedServer = args.server || identityAtStart.serverUrl;
const tier1 = checkServerIdentity(identityAtStart, args.server);
const checkoutFlags = readCheckoutBuildFlags(manifestPath);
const provenance = {
  device: await readDeviceProvenance(host),
  // DERIVED, not assumed. `readIdentity()` above is pure ODC and it answered; the
  // on-device component exists only in a build deployed with `injectTestingFiles`,
  // whose staged manifest has `ENABLE_RTA=true`. So reaching this line is proof,
  // and it holds whether or not THIS invocation performed the deploy — which is
  // strictly more than the old `args.deploy ? true : null` could say, and it
  // replaces a `manifestFlags.ENABLE_RTA` that read `false` on every run.
  enableRta: true,
  // What this WORKING TREE would build. Not the device — unless `--deploy` put it
  // there, which is what `deployedFromCheckout` records instead of leaving a reader
  // to assume. `agreesWithDevice` is filled in after the series, once the app's own
  // `[debug=… perfTiming=…]` bracket has been seen.
  checkout: {
    appVersion: readAppVersion(manifestPath),
    manifestFlags: checkoutFlags,
    deployedFromCheckout: args.deploy,
    agreesWithDevice: null,
  },
  server: {
    url: identityAtStart.serverUrl,
    id: identityAtStart.serverId ?? null,
    version: identityAtStart.serverVersion ?? null,
    apiVersion: identityAtStart.apiVersion ?? null,
  },
  userId: identityAtStart.userId ?? null,
};

console.log(
  `\n[measure] ${measurement.title} — n=${args.samples} on ${provenance.device.model} ` +
    `(${provenance.device.ramTier ?? 'RAM unknown'}, Roku OS ${provenance.device.osVersion})` +
    (args.arm ? ` · arm "${args.arm}"` : ''),
);
console.log(
  `[measure] app ${provenance.checkout.appVersion} · server ${provenance.server.url} (Jellyfin ${provenance.server.version})`,
);
if (!args.deploy) {
  console.log(
    '[measure] ⚠ measuring the build ALREADY on the device — the recorded appVersion/commit ' +
      'describe this checkout, not necessarily what ran (pass --deploy to make them the same thing).',
  );
}
if (!measurement.grounded) {
  console.log(
    `[measure] ⚠ the ${measurement.id} pattern has never matched a real device line — ` +
      'treat a zero-sample result as an unverified pattern, not as a silent app.',
  );
}
if (tier1.asserted) {
  console.log(`[measure] tier 1: server asserted — ${tier1.ok ? 'OK' : 'MISMATCH'}`);
} else {
  console.log(
    `[measure] ⚠ tier 1 did NOT assert a server (no --server given). Pinned ${expectedServer} ` +
      'for series consistency only.',
  );
}
if (tier1.asserted && !tier1.ok) await refuse(tier1.reason);

// ─── The series ──────────────────────────────────────────────────────────────
const windowMs = Number.isFinite(args.windowMs) ? args.windowMs : MAX_WINDOW_MS;
const samples = [];
for (let i = 0; i < args.samples; i++) {
  // The window opens at the LAUNCH, not at the keypress. `hardRelaunch()` presses
  // Home and sleeps `exitMs` (~4 s) before it launches anything, so a window that
  // opened at `Date.now()` would cover 4 s in which the PREVIOUS launch can still
  // be emitting. `assembleSamples` merges by line, not by launch, so a straggler
  // landing there is absorbed into this launch's sample and the record fabricates
  // one run out of halves of two — exactly what `measurements.js` refuses to do
  // with an incomplete sample. Filtering by a future instant is safe: lines are
  // stamped as they arrive, so nothing before it can ever be eligible.
  //
  // Usually masked by the quiet-break below, which will not fire until the console
  // has been silent for QUIET_MS. Not masked on the deadline path — i.e. exactly
  // when the device is already misbehaving.
  const from = Date.now() + RTA_CONFIG.exitMs;
  windowFrom = from;
  lastMatchAt = 0;
  await hardRelaunch();

  // Watch until the console goes quiet after a complete sample, or the cap. `from`
  // already excludes `exitMs`, so the deadline adds only the boot it still has to
  // wait through plus the watch budget itself.
  const deadline = from + windowMs + RTA_CONFIG.bootMs;
  let assembled = [];
  while (Date.now() < deadline) {
    await sleep(1000);
    assembled = assembleSamples(measurement, since(from));
    const complete = assembled.filter((s) => s.complete);
    if (complete.length && lastMatchAt && Date.now() - lastMatchAt > QUIET_MS) break;
  }

  assembled.forEach((sample, indexInLaunch) => {
    const { workload, timings } = splitWorkload(measurement, sample.fields);
    samples.push({
      launch: i,
      // WHEN this sample's window opened. Per sample rather than per series,
      // because tier 3's interleave check needs to order two arms' samples against
      // each other: an A,B,A,B experiment and an all-A-then-all-B one produce
      // identical series records and are not equally trustworthy. The window
      // instant, not the line's, since `assembleSamples` merges by line and has no
      // timestamps to hand back.
      launchAt: new Date(from).toISOString(),
      // 0 is the cold first paint; 1+ are the refreshes that follow it in the
      // same launch. Recorded, never averaged together — see trap 3.
      indexInLaunch,
      complete: sample.complete,
      lines: sample.lines,
      buildFlags: sample.buildFlags,
      workload,
      timings,
    });
  });

  const cold = samples.find((s) => s.launch === i && s.indexInLaunch === 0);
  const extra = assembled.length - 1;
  console.log(
    `[measure] ${i + 1}/${args.samples}  ` +
      (cold?.complete
        ? `${measurement.primary}=${cold.timings[measurement.primary] ?? cold.workload[measurement.primary]} ` +
          `workload=${JSON.stringify(cold.workload)}`
        : '⚠ no complete sample in the window') +
      (extra > 0
        ? `  (+${extra} later run${extra > 1 ? 's' : ''} in this launch, recorded separately)`
        : ''),
  );
}

// ─── Close the boundary ──────────────────────────────────────────────────────
// The closing read must NOT be able to destroy the series. It is a 5 s-bounded ODC
// call arriving after every sample has been taken, and an unguarded throw here went
// to the `uncaughtException` handler, which releases the device and exits WITHOUT
// writing `measurements.jsonl` — up to an hour of exclusive device time discarded
// because a bookkeeping read timed out. That is the same defect that moved the run
// ledger out of `out/`, one layer up: a record that costs real time to produce must
// survive the failure of the thing that annotates it.
//
// A failed read is recorded as an unverifiable boundary, which is a NON-sample and
// not a pass, because the series genuinely cannot be shown to be one population.
let consistency;
try {
  consistency = checkSeriesConsistency(identityAtStart, await readIdentity());
} catch (e) {
  consistency = {
    ok: false,
    drifted: [],
    unreadable:
      `the closing identity read failed (${e.message}), so the series could not be ` +
      'shown to be one population. The samples below are kept; treat them as unverified.',
  };
  console.error(`\n[measure] ⚠ ${consistency.unreadable}`);
}
if (!consistency.ok && consistency.drifted.length) {
  console.error(
    '\n[measure] ⚠ IDENTITY DRIFTED DURING THE SERIES — these samples are not one population:',
  );
  for (const d of consistency.drifted) {
    console.error(`  ${d.field}: ${JSON.stringify(d.from)} → ${JSON.stringify(d.to)}`);
  }
}

const cold = samples.filter((s) => s.indexInLaunch === 0 && s.complete);
const values = cold
  .map((s) => s.timings[measurement.primary] ?? s.workload[measurement.primary])
  .filter((v) => Number.isFinite(v))
  .sort((a, b) => a - b);
const median = values.length
  ? values.length % 2
    ? values[(values.length - 1) / 2]
    : (values[values.length / 2 - 1] + values[values.length / 2]) / 2
  : null;

// Did the build that produced these samples agree with the checkout? The app's own
// bracket is authoritative — it came out of the running build — so a disagreement
// says the device is running something this checkout would not produce, which is
// the case where `checkout.appVersion` and `commit` describe the wrong artifact.
provenance.checkout.agreesWithDevice = buildFlagsAgree(
  samples.find((s) => s.buildFlags)?.buildFlags,
  checkoutFlags,
);
if (provenance.checkout.agreesWithDevice === false) {
  console.error(
    '\n[measure] ⚠ the build on the device does NOT match this checkout — its own ' +
      `[debug=… perfTiming=…] bracket disagrees with ${JSON.stringify(checkoutFlags)}. ` +
      'The recorded appVersion/commit describe the checkout, not what ran.',
  );
}

// A series with no cold sample is not a measurement of anything: the app emitted
// nothing the registry recognised (a build without `perfTiming`, a pattern that has
// never been grounded, a screen that never painted). Carried IN the record rather
// than left to a reader to infer from `coldSamples: 0`, because this file is the
// one with a reader coming and it has to be self-describing about whether a line is
// usable. Same partition, same vocabulary as the run ledger.
const usable = consistency.ok && cold.length > 0;
const outcome = usable ? RUN_OUTCOMES.PASSED : RUN_OUTCOMES.BLOCKED;

const endedAt = new Date().toISOString();
const record = {
  measurement: measurement.id,
  title: measurement.title,
  grounded: measurement.grounded,
  primary: measurement.primary,
  // WHERE the app was, and WHICH side of a comparison this is. Both are selection
  // keys for tier 3 and neither can be recovered afterwards: `--screen` is the only
  // thing that can say which library grid was open, and two arms of an uncommitted
  // change are otherwise identical in every recorded field. `null` when not given,
  // never omitted — an absent key would silently drop the line out of a `screen ===
  // null` selection, which is the ledger's own documented failure mode.
  screen: args.screen ?? measurement.screen ?? null,
  arm: args.arm ?? null,
  // The same selection keys the run ledger carries, so a comparison can pick its
  // two arms out of this file alone rather than joining it against `runs.jsonl`
  // on a timestamp.
  ...runProvenance(),
  // Whether tier 3 may use this line at all, without a join it is designed not to
  // need. Note the two files have different cardinality BY DESIGN — a run refused
  // by tier 1 writes a `runs.jsonl` line and no measurement record at all — so this
  // is not a duplicate of the ledger's outcome; it is this file's own verdict on
  // its own line.
  outcome,
  // The series' own window, and whether it straddled the top of an hour. `runProvenance`
  // carries `startedAt` but nothing closed the window, so a reader could not tell a
  // 40-second series from a 40-minute one — and a comparison whose arms are hours apart
  // is exactly the aliasing the interleave rule exists to prevent. Same flag, same
  // reason and the same helper as the run ledger's.
  endedAt,
  crossedHourBoundary: crossesHourBoundary(runProvenance().startedAt, endedAt),
  tier1: { ...tier1, pinned: expectedServer },
  seriesConsistency: consistency,
  provenance,
  requested: args.samples,
  coldSamples: cold.length,
  median,
  samples,
};

// Under `.device-runs/measure/`, NOT `run.dir`. `beginRun` hands back a directory
// under `out/`, and every `build*` script opens with `rimraf out/` — a series that
// took an hour of exclusive device time would be destroyed by the next build,
// which is exactly the defect that moved the run ledger out of `out/` in the first
// place. The per-run files can live there because they are truncated at open
// anyway; an accumulator cannot.
//
// One JSON line per SERIES (not per sample): the series is the unit a comparison
// pairs, and tier 3 reads this the way `flake-baseline.js` reads `runs.jsonl`.
const outPath = ledgerPath('measurements.jsonl');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.appendFileSync(outPath, `${JSON.stringify(record)}\n`);

console.log(
  `\n[measure] ${measurement.primary} median ${median ?? '—'} ms over ${cold.length}/${args.samples} cold samples`,
);
console.log(`[measure] record: ${path.relative(repoRoot, outPath)}`);
if (cold.length < args.samples) {
  console.log(
    `[measure] ⚠ ${args.samples - cold.length} launch(es) produced no complete sample — reported, not dropped.`,
  );
}
if (!cold.length) {
  console.error(
    `[measure] ⚠ NO cold sample in the whole series — recorded as \`outcome: "${outcome}"\`.` +
      (measurement.grounded
        ? ' Check that the build on the device was compiled with perfTiming=true.'
        : ` The ${measurement.id} pattern has never matched a real device line, so this is at ` +
          'least as likely to be the pattern as the app.'),
  );
}

// A series whose identity drifted, or which produced no sample at all, is not a
// sample of anything, so it folds as a NON-sample rather than a failure — the same
// partition `run-record.js` applies to a run blocked by a broken dependency.
run.close(outcome);
socket.destroy();
await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false }).catch(() => {});
await lock.release();
process.exit(usable ? 0 : 1);
