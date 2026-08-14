/**
 * Take an on-device performance measurement that carries its own provenance.
 *
 *   npm run measure                          n=5 samples of Home first paint
 *   npm run measure -- -n 30                 a real series
 *   npm run measure -- --measurement item-grid
 *   npm run measure -- --server http://192.168.1.2:8098   assert tier 1
 *   npm run measure -- --deploy              BUILD this checkout, then sideload it
 *   npm run measure -- --window-ms 20000     cap the per-launch watch (default 45 s)
 *   npm run measure -- --arm before          label this series for `npm run measure:compare`
 *   npm run measure -- --screen movies-grid  say which screen, when the family cannot
 *   npm run measure -- --measurement screen-load --nav movieDetails
 *                                            drive to a screen after each relaunch
 *   npm run measure -- --nav seriesDetails --library <id>
 *                                            …targeting one library, on a server with several
 *   npm run measure -- --nav seasonDetails --variant Season
 *                                            …saying which mount, when the nav is chained
 *   npm run measure -- --nav osd --component videoPlayer
 *                                            …saying which COMPONENT, when the nav walks
 *                                            through another screen to reach the one asked for
 *
 * ## Reaching a screen that is not Home
 *
 * `--nav <screen>` runs the navigation declared for that screen in
 * [`tests/rta/screens.js`](../tests/rta/screens.js) after each relaunch, which makes
 * measurement the THIRD consumer of that registry after the functional suite and the
 * store screenshots. Nothing is seeded — this tool still never writes the registry —
 * so it reaches every screen navigable from a signed-in Home and refuses the ones
 * that are not.
 *
 * A nav that walks through other screens mounts several of them per launch, and those
 * loads all really happened, so all of them are recorded. What the tool will not do is
 * guess which one you meant: a launch that mounted more than one is published as no
 * median at all until the flags name ONE of them, and a flag is refused if no sample
 * carried its value. There are two ways to be walked through, and they need different
 * halves of a mount's identity to name:
 *
 *   - a CHAINED nav mounts one component several times — reaching a Season loads its
 *     Series first — told apart by `--variant`;
 *   - a PLAYBACK nav mounts different components — reaching the player means walking
 *     through `ItemDetails`, and for a movie BOTH stamp variant `Movie` — told apart
 *     only by `--component`.
 *
 * `--library <id>` binds to the target screen's own collection type, never to every
 * library type at once.
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
 * `--deploy` guarantees that state — it builds this checkout and sideloads the result,
 * because every bsconfig writes to the same `build/` directory and deploying without
 * building ships whatever npm script ran last (including a Rooibos TEST build, which has
 * no ODC at all). The default does NOT — it measures whatever is resident, which in
 * practice means "whatever the last `npm run test:rta` or `npm run measure -- --deploy`
 * left there". That was an unstated assumption in the
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
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupRtaEnv, deployRtaBuild, hardRelaunch, ecp } from '../tests/rta/lib/driver.js';
import { RTA_CONFIG } from '../tests/rta/config.js';
import { SCREENS } from '../tests/rta/screens.js';
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
import {
  analyseMounts,
  launchAudit,
  selectColdSamples,
  selectionRefusalFor,
} from './measure-selection.js';

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
    // Each family's DECLARED screen, so the parser can refuse a `--screen` that
    // contradicts one without importing the registry. See `parseMeasureArgs`.
    screens: Object.fromEntries(MEASUREMENTS.map((m) => [m.id, m.screen ?? null])),
    navScreens: SCREENS.map((s) => ({ name: s.name, state: s.state })),
    defaultMeasurement: MEASUREMENTS[0].id,
  });
} catch (e) {
  if (!(e instanceof MeasureArgError)) throw e;
  console.error(`[measure] ${e.message}`);
  process.exit(1);
}
const measurement = measurementById(args.measurement);

// WHICH sample of a launch this run is about. One rule, defined in `measure-selection.js`
// and shared with `measure:compare`, because three implementations of it existed and two
// were wrong.
const selector = { component: args.component, variant: args.variant };

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

// ─── Navigation, when a screen is not reachable by relaunching ───────────────
// The screen registry is `tests/rta/screens.js` and this makes measurement its THIRD
// consumer, after the functional suite and the store screenshots. Deliberately not a
// registry of its own: those two already drive every nav against a real device on
// every run, so reusing them means a nav that breaks is caught by a red test rather
// than by a measurement that quietly stopped reaching the screen it names.
const navEntry = args.nav ? SCREENS.find((s) => s.name === args.nav) : null;

// The nav context, built WITHOUT a Jellyfin session — which is the whole reason this
// works inside a tool that does no seeding and points at the developer's own server.
// The navs read it defensively (`libraryIdFor(ctx?.libraries, …)`, `ctx?.heroIndex || 0`)
// and `navLibraryByType` falls back to scanning Home tiles by collection type, so the
// detail screens navigate with nothing supplied.
//
// Two consequences worth stating rather than discovering:
//  - Without `--library`, a server with MORE THAN ONE library of a type makes that scan
//    ambiguous, and `nav.js` refuses rather than guessing. `--library` is the way out.
//  - Screens whose landing VIEW is seeded by the functional suite (the music album vs
//    artist detail pair) are not distinguishable here; whichever view the device has
//    stickily persisted is the one measured. Warned about below, not silently allowed.
//  - `osd` / `trickplay` need a live session (`ctx.heroId`) and will fail their first
//    nav. That failure aborts the series rather than repeating n times — see the loop.
//
// `--library` is bound to the collection type the TARGET SCREEN declares, not mapped
// onto every type in the registry. The blanket form handed a movies id to a TV nav
// without a word — `--nav tvLibraryShows --library <a-movie-id>` would have opened the
// wrong library and recorded it as the right one, which is the exact class of silent
// mis-attribution this tool exists to refuse. A screen with no declared `view`
// (`movieDetails`, `personDetails`, `libraryOptions`) navigates to a movies library by
// construction, so that is the honest default, and it is stated rather than assumed.
const DEFAULT_NAV_COLLECTION_TYPE = 'movies';
const navCollectionType = navEntry?.view?.collectionType ?? DEFAULT_NAV_COLLECTION_TYPE;
const navContext = args.library
  ? { libraries: [{ collectionType: navCollectionType, id: args.library }] }
  : undefined;

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
  // BUILD, then deploy. `deployRtaBuild()` sideloads the `build/` DIRECTORY and does not
  // produce it, and every bsconfig in the repo writes to that same directory — so
  // `build/` holds whatever npm script ran last, which may be a Rooibos TEST build or a
  // build from before the change being measured. Every sibling consumer pairs the deploy
  // with a build in its npm script (`test:rta` = `npm run build && …`,
  // `screenshots:capture` = `npm run build:prod && …`); `measure` was the one entry point
  // that offered `--deploy` without one, and the flag's own help says "sideload first",
  // which nobody reads as "sideload whatever happens to be lying around".
  //
  // This is not hypothetical and it is not cheap: it cost four device runs and a build
  // inspection across two sessions. Once it shipped a build predating the instrumentation
  // being grounded (zero samples, blamed on the pattern), and once — straight after a
  // `npm run test:unit` — it shipped the TEST build, whose refusal message then advised
  // re-running with the `--deploy` that had just caused it.
  console.log('[measure] building this checkout ...');
  const built = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: false });
  if (built.status !== 0) {
    console.error('\n[measure] the build failed — refusing to deploy a stale `build/`.');
    run.close(RUN_OUTCOMES.BLOCKED);
    await lock.release();
    process.exit(1);
  }
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
if (navEntry) {
  console.log(
    `[measure] driving to "${navEntry.name}" after each relaunch, via tests/rta/screens.js` +
      (args.library ? ` (library ${args.library})` : ''),
  );
  if (navEntry.view) {
    // The functional suite seeds this screen's landing view so its capture is
    // deterministic. Nothing is seeded here, so the library opens on whatever view the
    // device last persisted. For most screens that changes the WORKLOAD (which is
    // recorded, and visible in a comparison). For the two music-detail screens it
    // changes WHICH SCREEN — both run the same nav and are told apart only by the
    // seeded landing — so there the variant the app stamps is the only thing that says
    // what was actually measured. Worth reading before quoting a music number.
    const musical = navEntry.view.collectionType === 'music';
    console.log(
      `[measure] ⚠ "${navEntry.name}" has a seeded landing view in the functional suite ` +
        `(${navEntry.view.collectionType}/${navEntry.view.landing}); nothing is seeded here, so ` +
        'the library opens on whatever view the device last persisted' +
        (musical
          ? ' — and for the music detail screens that decides WHICH screen you measured. Check ' +
            'the recorded `variant` before quoting this number.'
          : '.'),
    );
  }
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

  // Drive to the screen INSIDE the window, not before it. The nav's final gate waits
  // on a node the screen paints, so it necessarily returns AFTER the paint line has
  // been emitted — a window opened when the nav returns would start by missing the
  // very thing it was opened to catch.
  //
  // The intermediate screens a chained nav passes through emit their own lines and are
  // filed as their own samples, told apart by the `variant` the app stamps. That is
  // the shape, not a defect: reaching a Season means loading its Series first, and both
  // loads really happened.
  if (navEntry?.nav) {
    try {
      await navEntry.nav(navContext);
    } catch (e) {
      // Aborts the SERIES rather than counting a failed launch and trying again: a nav
      // that cannot reach its screen once will not reach it on the next four attempts,
      // and n launches of a screen that never loaded is a long way to travel to record
      // nothing. `diagnosedError` has already attached what the device was showing.
      await refuse(
        `--nav ${args.nav} failed on launch ${i + 1}: ${e.message}\n` +
          '  The series is abandoned rather than retried — a nav that cannot reach its screen\n' +
          '  once will not reach it on the remaining launches.',
      );
    }
  }

  // Watch until the console goes quiet after a complete sample, or the cap. `from`
  // already excludes `exitMs`, so the deadline adds only the boot it still has to
  // wait through plus the watch budget itself.
  //
  // The time already spent getting here is added on top, because it is spent INSIDE the
  // window and would otherwise eat the watch budget: an episode detail is four screens
  // deep, and on `.177` that walk alone outlasts the 45 s cap the relaunch-only mode was
  // sized for. Note this span is the RELAUNCH plus the nav (less `exitMs`, which `from`
  // already excluded), not the nav alone — and the deadline adds `bootMs` again below.
  // Both make the window longer than strictly needed, which is the safe direction: the
  // quiet-break ends a healthy launch early anyway, so the only thing a generous cap
  // changes is how long a MISBEHAVING device is given before being reported.
  // Measured from this launch rather than assumed, so a slow nav lengthens only its own
  // window.
  const spentReachingScreen = navEntry?.nav ? Date.now() - from : 0;
  const deadline = from + spentReachingScreen + windowMs + RTA_CONFIG.bootMs;
  let assembled = [];
  while (Date.now() < deadline) {
    await sleep(1000);
    assembled = assembleSamples(measurement, since(from));
    const complete = assembled.filter((s) => s.complete);
    if (complete.length && lastMatchAt && Date.now() - lastMatchAt > QUIET_MS) break;
  }

  assembled.forEach((sample, indexInLaunch) => {
    const { workload, timings, dimensions } = splitWorkload(measurement, sample.fields);
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
      // What the app said this sample WAS — its screen, and which variant of it. Empty
      // for the two legacy families, which emit no non-numeric field. This is the only
      // thing that can tell two samples from the same launch apart: a chained
      // navigation mounts one screen several times (a Season is reached through its
      // Series), so `indexInLaunch` orders them but cannot say which is which.
      dimensions,
    });
  });

  // The SAME rule the medians use, through the same function — not a second copy that
  // can silently come to mean something else. Hardcoding the first mount here printed
  // 260 ms (the details screen a playback nav walks THROUGH) while the summary printed
  // the mount actually named: two numbers 8x apart, one tool, one output, both `osd`.
  //
  // `selectColdSamples` also filters on `complete`, which this line used not to do — it
  // took the first MATCHING sample and only then asked whether it was complete, so a
  // launch whose target mount emitted an incomplete sample ahead of a complete one
  // printed "no complete sample" while the summary counted it.
  const cold = selectColdSamples(
    samples.filter((s) => s.launch === i),
    selector,
  )[0];
  const extra = assembled.length - 1;
  console.log(
    `[measure] ${i + 1}/${args.samples}  ` +
      (cold
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

// ─── Which samples the report is about ───────────────────────────────────────
// All of this lives in `measure-selection.js` — pure, shared with `measure:compare`, and
// unit-tested. It used to live here, where nothing could reach it: `measure.js` claims
// the device on import, so the one layer every defect in this subsystem has been found in
// was the one layer with no tests. Same reason `measure-args.js` exists.
const analysis = analyseMounts(samples, selector);
const { observedVariants, observedComponents } = analysis;
const selectionRefusal = selectionRefusalFor(samples, selector, analysis);

const cold = selectionRefusal ? [] : selectColdSamples(samples, selector);

// Split by WHY a launch came back empty — nothing emitted at all, versus the named mount
// missing from a launch that otherwise recorded fine. See `launchAudit`.
//
// Reaching here means every launch ran: the sample loop has no `continue`, and its only
// early exit is `refuse()`, which closes the run and exits the process.
const { completeSamples, withoutAnySample, withoutNamedMount } = launchAudit(
  samples,
  selector,
  args.samples,
);

const medianOf = (raw) => {
  const v = raw.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

const median = medianOf(
  cold.map((s) => s.timings[measurement.primary] ?? s.workload[measurement.primary]),
);

// A median for EVERY timing the family emitted, each with the number of samples that
// actually carried it — not just the primary.
//
// This is what makes a multi-milestone family honest. A screen emits a paint time and a
// settle time; reporting only the primary would leave the second milestone with no
// number at all, and — worse — an optional line that stopped appearing would look
// exactly like one that was never declared. `n` beside each median is the difference
// between "settled at 3104 ms" and "settled at 3104 ms in three of five runs", and only
// the second of those can be acted on.
//
// Over `cold` alone, matching the primary: a later run in the same launch is a warm
// refresh and is recorded beside the cold sample, never folded into it (trap 3).
const timingKeys = [...new Set(cold.flatMap((s) => Object.keys(s.timings)))].sort();
const medians = Object.fromEntries(
  timingKeys.map((k) => {
    const values = cold.map((s) => s.timings[k]).filter((v) => Number.isFinite(v));
    return [k, { median: medianOf(values), samples: values.length }];
  }),
);

// How many cold samples carried each DECLARED line. The required lines are what
// `complete` already summarises; this exists for the optional ones, where a milestone
// can go missing without anything else in the record changing shape. Declared-line
// keyed rather than observed-line keyed, so a line that appeared in ZERO samples is
// reported as 0 rather than being absent from the report — which is the whole
// distinction between "unmeasurable" and "not asked for".
const lineCoverage = Object.fromEntries(
  measurement.lines.map((l) => [l.key, cold.filter((s) => s.lines.includes(l.key)).length]),
);

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
// A run whose samples cannot be attributed to ONE screen is not a measurement of that
// screen, so it folds as a NON-sample exactly like a drifted identity. The samples are
// still written — they are real loads, and `--component` / `--variant` can select one on
// a re-read — but nothing is published from them.
const usable = consistency.ok && cold.length > 0 && !selectionRefusal;
const outcome = usable ? RUN_OUTCOMES.PASSED : RUN_OUTCOMES.BLOCKED;

// A series that matched NOTHING has to say what the console did carry, or the two
// causes are indistinguishable from the outside: a pattern that is wrong, and an app
// that is silent. Reporting only "0 samples" leaves whoever reads it to re-run the
// whole series by hand with a socket open — which is the manual procedure this tool
// exists to retire, reintroduced at exactly the moment the tool is least useful.
//
// Written to the run dir rather than the accumulator: it is a diagnostic for ONE failed
// run, not a series anyone will join later, and `run.dir` is truncated at open anyway.
// Only on the zero-sample path, so a healthy series never pays for it.
//
// Keyed on whether the pattern MATCHED, not on whether a sample was SELECTED. Those come
// apart on a selection refusal — the samples are all there and all complete, and no cold
// sample was chosen because the operator has not yet said which mount they meant — and
// keying on `cold` sent that case down every zero-sample diagnostic in this file: "none
// matched the pattern", "n launches produced no complete sample", and a hint to re-run
// with `--deploy` because the resident build probably predates the instrumentation.
// Four complete samples were sitting in the record while it said all three.
if (!completeSamples.length && lines.length) {
  const dumpPath = path.join(run.dir, 'console-window.log');
  // The run dir has to be created here, exactly as the accumulator's write does below.
  // `--deploy` runs `npm run build`, which is `rimraf build/ out/` — so the deploy
  // DELETES the directory this dump writes into, and the write then throws ENOENT into
  // the `uncaughtException` handler: the tool dies, and the run records as `crashed`.
  // That lands on the one combination the dump exists to serve — a `--deploy` of new
  // instrumentation that emitted nothing — where it destroys the console capture that
  // is the only evidence of why. Found by dogfooding the dump to answer an unrelated
  // question, not by review.
  fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
  fs.writeFileSync(
    dumpPath,
    lines.map((l) => `${new Date(l.at).toISOString()} ${l.raw}`).join('\n') + '\n',
  );
  console.error(
    `[measure] the console carried ${lines.length} line(s) and none matched ${measurement.id}. ` +
      `Verbatim, with timestamps: ${path.relative(repoRoot, dumpPath)}`,
  );
}

const endedAt = new Date().toISOString();
const record = {
  measurement: measurement.id,
  title: measurement.title,
  grounded: measurement.grounded,
  primary: measurement.primary,
  // WHICH SCREEN, and WHICH side of a comparison this is. Both are selection keys for
  // tier 3 and neither can be recovered afterwards.
  //
  // Precedence: the FAMILY's declared screen, then `--nav`, then `--screen`. `--nav` is
  // EVIDENCE rather than an assertion — the tool drove there and the nav's own waitFor
  // gate gave up if the screen never rendered — which is why it outranks the flag a
  // human types and nothing checks.
  //
  // Deliberately NOT the app's own name: the app knows its COMPONENT (`itemDetails`),
  // which backs all nine `*Details` entries in the screen registry, and it cannot know
  // which of them was navigated to. Recording that as `screen` cost real discriminating
  // power — a `movieDetails` arm and a `seriesDetails` arm both read `itemDetails` and
  // passed `measure:compare`'s mixed-population gate cleanly, which is strictly worse
  // than the operator-typed `--screen` it replaced. The component is recorded below,
  // under its own name.
  screen: measurement.screen ?? args.nav ?? args.screen ?? null,
  // The component the app named, and which KIND of thing it loaded. Promoted from the
  // samples to the record because they are selectors: `measure-compare.js` has read
  // `record.variant` since it was written and nothing had ever written it, so the one
  // field that can separate two item types on one component was dead on arrival.
  //
  // Both of these are NULL on a refusal, including when the operator NAMED one. That
  // ordering is the point: a flag is advertised as checkable evidence, so on the one path
  // where the check FAILED — `--component X matched no sample` — recording X anyway would
  // turn it back into the bare assertion that `--screen` is criticised for two hundred
  // lines above. `selectionRefusal` and the `observed*` lists below say what really ran.
  //
  // Naming the first sample instead would be the same wrong answer the median refuses to
  // publish, written into the field a comparison selects on: a launch that mounted
  // `itemDetails` and then `videoPlayer` would record `component: "itemDetails"`.
  component: selectionRefusal
    ? null
    : (args.component ??
      samples.find((s) => s.dimensions?.component)?.dimensions.component ??
      null),
  // `screenVariant`, NOT `variant`: `runProvenance()` already spreads a `variant` of its
  // own — `process.env.npm_lifecycle_event`, i.e. WHICH NPM SCRIPT launched the run — and
  // it is spread BELOW this, so a field named `variant` here is silently overwritten by
  // the string "measure". Caught on hardware: the record read `variant: "measure"` while
  // the samples plainly carried `Series` and `Season`. Two unrelated senses of one word,
  // one of them load-bearing for the run ledger, so the new one takes the distinct name.
  screenVariant: selectionRefusal
    ? null
    : (args.variant ?? samples.find((s) => s.dimensions?.variant)?.dimensions.variant ?? null),
  // How the screen was reached, and against which library. Neither is recoverable after
  // the fact, and on the server that motivated `--library` (four movie libraries) a
  // comparison cannot otherwise show that both arms opened the same one.
  nav: args.nav ?? null,
  library: args.library ?? null,
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
  // The RUN's window, and whether it straddled the top of an hour. `runProvenance`
  // carries `startedAt` but nothing closed the window, so a reader could not tell a
  // 40-second run from a 40-minute one — and a comparison whose arms are hours apart
  // is exactly the aliasing the interleave rule exists to prevent. Same flag, same
  // reason and the same helper as the run ledger's.
  //
  // The RUN's, not the SERIES': `startedAt` is stamped by `beginRun` above, so this
  // window also covers the deploy and the tier-1 / tier-2 reads that precede the
  // first launch. Per-SAMPLE instants are what tier 3 orders arms by — see
  // `launchAt` — and they are the ones that describe the sampling itself.
  endedAt,
  crossedHourBoundary: crossesHourBoundary(runProvenance().startedAt, endedAt),
  tier1: { ...tier1, pinned: expectedServer },
  seriesConsistency: consistency,
  provenance,
  requested: args.samples,
  // Why no median, when there is none. `coldSamples: 0` alone cannot tell "the app
  // emitted nothing" from "the app emitted several screens and nobody said which".
  selectionRefusal,
  // BOTH halves of what the app stamped, because both halves of `component` /
  // `screenVariant` can be nulled by a refusal — and a record whose selection field is
  // null with no list beside it cannot say what it saw without re-deriving from
  // `samples`. `observedVariants` shipped first and `observedComponents` did not, which
  // left the component half of a two-component record silent in exactly the case that
  // made two-component records possible.
  observedVariants,
  observedComponents,
  coldSamples: cold.length,
  median,
  medians,
  lineCoverage,
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

if (selectionRefusal) {
  console.error(`\n[measure] ⚠ NO MEDIAN PUBLISHED — ${selectionRefusal}`);
  console.error(
    `[measure]   ${samples.length} sample(s) were recorded and are in the record; nothing is lost.\n` +
      '[measure]   Refused rather than picked by position: for a chained navigation the first\n' +
      '[measure]   mount is the screen you passed THROUGH, not the one you asked for.',
  );
}
console.log(
  `\n[measure] ${measurement.primary} median ${median ?? '—'} ms over ${cold.length}/${args.samples} cold samples` +
    (args.component ? ` · component ${args.component}` : '') +
    (args.variant ? ` · variant ${args.variant}` : ''),
);
// Every other timing the family emitted, each with its own sample count. Printed
// rather than left in the record because the second milestone is the reason a
// multi-line family exists, and a number nobody sees on the terminal is a number
// nobody checks.
for (const key of timingKeys) {
  if (key === measurement.primary) continue;
  const { median: m, samples: n } = medians[key];
  console.log(
    `[measure] ${key} median ${m ?? '—'} ms over ${n}/${cold.length} cold samples` +
      (n < cold.length ? '  ⚠ absent from some samples — reported, not averaged away' : ''),
  );
}
const missingLines = measurement.lines.filter((l) => lineCoverage[l.key] < cold.length);
if (cold.length && missingLines.length) {
  console.log(
    `[measure] ⚠ line coverage: ${missingLines
      .map((l) => `${l.key} ${lineCoverage[l.key]}/${cold.length}`)
      .join(' · ')} — a milestone the app did not emit is NOT the same as one it emitted as zero.`,
  );
}
console.log(`[measure] record: ${path.relative(repoRoot, outPath)}`);
// Two warnings, because they are two different failures with two different next steps,
// and one count cannot carry both. A launch that emitted NOTHING points at the build or
// the pattern; a launch that emitted fine but lacked the mount you NAMED points at that
// screen — a playback that never reached its first frame while the details screen it
// walked through recorded perfectly. Collapsing the second into the first hides it behind
// a healthy-looking sample count, which is the opposite of this file's posture.
if (withoutAnySample > 0) {
  console.log(
    `[measure] ⚠ ${withoutAnySample} launch(es) emitted no complete sample at all — reported, not dropped.`,
  );
}
if (withoutNamedMount > 0) {
  console.log(
    `[measure] ⚠ ${withoutNamedMount} launch(es) emitted samples but NOT the mount you named ` +
      `(${[args.component, args.variant].filter(Boolean).join(' / ')}) — that screen did not ` +
      'complete on those launches; the others did.',
  );
}
if (!completeSamples.length) {
  console.error(
    `[measure] ⚠ NO cold sample in the whole series — recorded as \`outcome: "${outcome}"\`.` +
      (measurement.grounded
        ? ' Check that the build on the device was compiled with perfTiming=true.'
        : ` The ${measurement.id} pattern has never matched a real device line, so this is at ` +
          'least as likely to be the pattern as the app.'),
  );
  // The FIRST thing to suspect on a zero-sample run, said first, because the guard
  // that would normally answer it cannot: `agreesWithDevice` is derived from the
  // `[debug=… perfTiming=…]` bracket carried BY A SAMPLE, so a run with no samples
  // records it as `null` — the check meant to catch "the device is not running this
  // checkout" is blind in exactly the case that most needs it, and no amount of
  // reading the record afterwards recovers the answer.
  //
  // Not hypothetical: this cost three consecutive runs and a build inspection to
  // diagnose. Newly-added instrumentation is precisely the case where the resident
  // build and the checkout differ, and `--deploy` is the one-word fix.
  //
  // Note what would NOT have helped, which is why the hint is worth its lines: the
  // flags AGREED. `agreesWithDevice` compares `bs_const` only, so a device running an
  // older build of the same flavour reads as agreeing — it cannot see stale code, only
  // a stale flavour.
  if (!args.deploy) {
    console.error(
      '[measure] ⚠ this run did NOT deploy, so it measured whatever build was already resident.\n' +
        '  If the instrumentation you are measuring is new in this checkout, the device is very\n' +
        '  likely running a build that predates it. Re-run with --deploy before concluding the\n' +
        '  pattern or the app is at fault — `agreesWithDevice` cannot tell you, because it is\n' +
        '  derived from a sample and there were none.',
    );
  }
}

// A series whose identity drifted, or which produced no sample at all, is not a
// sample of anything, so it folds as a NON-sample rather than a failure — the same
// partition `run-record.js` applies to a run blocked by a broken dependency.
run.close(outcome);
socket.destroy();
await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false }).catch(() => {});
await lock.release();
process.exit(usable ? 0 : 1);
