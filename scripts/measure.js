/**
 * Take an on-device performance measurement that carries its own provenance.
 *
 *   npm run measure                          n=5 samples of Home first paint
 *   npm run measure -- -n 30                 a real series
 *   npm run measure -- --measurement item-grid
 *   npm run measure -- --server http://192.168.1.2:8098   assert tier 1
 *   npm run measure -- --deploy              sideload first (default: use what is on the device)
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
import { beginRun, ledgerPath, runProvenance, RUN_OUTCOMES } from './run-record.js';
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
  checkServerIdentity,
  checkSeriesConsistency,
  readDeviceProvenance,
  readAppVersion,
  readBuildFlags,
} from './measurement-guard.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, 'manifest');

/** Minimal flag parsing, matching the `--flag value` / `--flag=value` shapes the other scripts accept. */
function parseArgs(argv) {
  const args = { samples: 5, measurement: MEASUREMENTS[0].id, deploy: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // Accepts `--name value`, `--name=value`, and the short `-n` the header
    // documents. The short form is spelled out rather than derived, so a flag
    // named in the usage block cannot silently fail to parse — which it did, and
    // only a read of both caught it.
    const take = (...names) => {
      const eq = arg.indexOf('=');
      for (const name of names) {
        const long = name.length === 1 ? `-${name}` : `--${name}`;
        if (arg === long) return argv[++i];
        if (eq > 0 && arg.slice(0, eq) === long) return arg.slice(eq + 1);
      }
      return undefined;
    };
    const n = take('n', 'samples');
    if (n !== undefined) {
      args.samples = Number(n);
      continue;
    }
    const m = take('measurement');
    if (m !== undefined) {
      args.measurement = m;
      continue;
    }
    const s = take('server');
    if (s !== undefined) {
      args.server = s;
      continue;
    }
    const w = take('window-ms');
    if (w !== undefined) {
      args.windowMs = Number(w);
      continue;
    }
    if (arg === '--deploy') args.deploy = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const measurement = measurementById(args.measurement);
if (!measurement) {
  console.error(
    `[measure] unknown measurement ${JSON.stringify(args.measurement)}. Registered: ${measurementIds().join(', ')}`,
  );
  process.exit(1);
}
if (!Number.isInteger(args.samples) || args.samples < 1) {
  console.error(`[measure] --n must be a positive integer, got ${JSON.stringify(args.samples)}`);
  process.exit(1);
}

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
    if (matchLine(measurement, raw)) lastMatchAt = Date.now();
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
const identityAtStart = await readIdentity();
const expectedServer = args.server || identityAtStart.serverUrl;
const tier1 = checkServerIdentity(identityAtStart, args.server);
const provenance = {
  device: await readDeviceProvenance(host),
  appVersion: readAppVersion(manifestPath),
  manifestFlags: readBuildFlags(manifestPath),
  // The deploy this invocation performed. `--deploy` uses `injectTestingFiles`,
  // which makes the on-device ODC component resident; without it we are measuring
  // whatever build was already there, and cannot claim to know. Honest `null`
  // rather than a guess.
  enableRta: args.deploy ? true : null,
  server: {
    url: identityAtStart.serverUrl,
    id: identityAtStart.serverId,
    version: identityAtStart.serverVersion,
    apiVersion: identityAtStart.apiVersion,
  },
  userId: identityAtStart.userId,
};

console.log(
  `\n[measure] ${measurement.title} — n=${args.samples} on ${provenance.device.model} (Roku OS ${provenance.device.osVersion})`,
);
console.log(
  `[measure] app ${provenance.appVersion} · server ${provenance.server.url} (Jellyfin ${provenance.server.version})`,
);
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
if (tier1.asserted && !tier1.ok) {
  console.error(`\n[measure] ${tier1.reason}`);
  run.close(RUN_OUTCOMES.BLOCKED);
  socket.destroy();
  await lock.release();
  process.exit(1);
}

// ─── The series ──────────────────────────────────────────────────────────────
const windowMs = Number.isFinite(args.windowMs) ? args.windowMs : MAX_WINDOW_MS;
const samples = [];
for (let i = 0; i < args.samples; i++) {
  const from = Date.now();
  lastMatchAt = 0;
  await hardRelaunch();

  // Watch until the console goes quiet after a complete sample, or the cap.
  const deadline = from + windowMs + RTA_CONFIG.bootMs + RTA_CONFIG.exitMs;
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
const identityAtEnd = await readIdentity();
const consistency = checkSeriesConsistency(identityAtStart, identityAtEnd);
if (!consistency.ok) {
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
  : undefined;

const record = {
  measurement: measurement.id,
  title: measurement.title,
  grounded: measurement.grounded,
  primary: measurement.primary,
  // The same selection keys the run ledger carries, so a comparison can pick its
  // two arms out of this file alone rather than joining it against `runs.jsonl`
  // on a timestamp.
  ...runProvenance(),
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

// A series whose identity drifted is not a sample of anything, so it folds as a
// NON-sample rather than a failure — the same partition `run-record.js` applies
// to a run blocked by a broken dependency.
run.close(consistency.ok ? RUN_OUTCOMES.PASSED : RUN_OUTCOMES.BLOCKED);
socket.destroy();
await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false }).catch(() => {});
await lock.release();
process.exit(consistency.ok ? 0 : 1);
