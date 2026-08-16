/**
 * Take the same measurement on every device in `ROKU_DEVICES`, one after another.
 *
 *   npm run measure:devices -- --measurement screen-load --nav settings -n 30
 *   npm run measure:devices -- --deploy --nav movieDetails -n 30
 *   ROKU_DEVICES=192.0.2.10,192.0.2.11 npm run measure:devices -- -n 5   # a subset, once
 *
 * Every flag is forwarded VERBATIM to `npm run measure`; this tool knows nothing about
 * that grammar and deliberately does not re-implement any of it. What it adds is the one
 * thing `measure` cannot do for itself — drive more than one device — plus the preflight
 * that makes a long unattended run worth starting.
 *
 * ## Why this drives `measure.js` as a CHILD PROCESS rather than calling `runSeries`
 *
 * The obvious shape is an in-process loop around `runSeries` — the loop was extracted for
 * exactly this caller. It is the wrong shape here, for two reasons, and the second is
 * decisive:
 *
 *  - **It would duplicate `measure.js` almost entirely.** Per device, a series also needs
 *    the device lock, the console socket and its replay defense, the tier-1/tier-2
 *    identity guard at both session boundaries, mount selection, the medians, and the
 *    record assembly. That last one is the layer this project deliberately did NOT extract
 *    (`measure-record-assembly-untested` in tech-debt) — so an in-process driver would
 *    have doubled the one untested surface in the subsystem rather than reusing it.
 *  - **`roku-test-automation` binds its client singletons to ONE host per process.**
 *    `setupRtaEnv()` calls `utils.setupEnvironmentFromConfig` with a single device, and
 *    `ecp` / `odc` / `device` are module-level singletons configured from it. Re-pointing
 *    them mid-process at a second Roku, with an ODC connection already open against the
 *    first, is not something that API offers. One process per device is not a workaround
 *    for that; it is the shape the client supports.
 *
 * A child gets its host through `ROKU_IP` in its own environment. That is load-bearing and
 * was verified rather than assumed: `dotenv` does not overwrite a variable already present
 * in `process.env`, so the value passed here wins over the `ROKU_IP` in `.env`.
 *
 * The three properties `measure-loop.js` grew for "the multi-device driver" are not lost by
 * going out-of-process — they are inherited by the `measure.js` running inside each child,
 * which is where a nav failure now has to be survived. The one that did NOT survive
 * on its own was `NavFailedError.samples`: the entry point used to refuse without writing
 * the record, so a device that failed its nav on launch 12 discarded eleven real samples.
 * That is fixed in `measure.js` rather than worked around here, because it is equally a
 * defect for a single-device run.
 *
 * ## Sequential, never parallel — three independent reasons
 *
 *  1. `--deploy` runs `npm run build`, which opens with `rimraf build/ out/`. Two
 *     concurrent builds share that directory and corrupt each other.
 *  2. The Jellyfin server is the shared WORKLOAD. Three devices pulling from it at once
 *     changes what each of them measures, which is the one variable a measurement must
 *     hold still.
 *  3. `measurements.jsonl` is append-only from every process that writes it.
 *
 * Sequential also costs one build per device under `--deploy` (~11 s incremental, measured
 * on this checkout). Deliberately not optimised into a build-once/deploy-thrice mode: it
 * is under 2% of a three-device n=30 run, and buying it back would mean a second way for
 * `measure.js` to be told "deploy but do not build" — a coupling worth more than the
 * seconds.
 *
 * ## What it does NOT do
 *
 * **No matrix report.** Each device writes its own line to `measurements.jsonl` and the
 * summary here says only which devices ran. The report that lays those lines out as one
 * screen × three tiers is a READER over that file (project PLAN, 2026-08-16), because a
 * reader can rebuild the matrix from runs taken weeks apart on different devices while an
 * in-process report can only ever describe the run that just finished.
 *
 * **No lock over the whole matrix.** Each child takes the lock for its own device when it
 * reaches it, which is what keeps the record's lock provenance TRUE — a parent holding all
 * three would have to tell each child to skip its own lock, and the child would then
 * record itself as having run unlocked. The cost is that a second terminal can claim
 * device 3 while device 1 is being measured; that device fails, is reported, and the rest
 * of the matrix carries on.
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchDeviceInfo } from './device-lock.js';
import { describeDevice, cannotRunApps, ramTierFor } from './roku-devices.js';
import {
  MatrixError,
  formatPlanLines,
  preflightRefusal,
  resolveDevices,
  serverDeclarationRefusal,
  summariseMatrix,
} from './measure-matrix.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MEASURE = path.join(here, 'measure.js');

const die = (message) => {
  console.error(`\n[matrix] ${message}`);
  process.exit(1);
};

const forwarded = process.argv.slice(2);

// Free and instant, so it goes ahead of anything that touches the network.
const undeclaredServer = serverDeclarationRefusal(forwarded);
if (undeclaredServer) die(undeclaredServer);

let devices;
try {
  devices = resolveDevices(process.env);
} catch (e) {
  if (!(e instanceof MatrixError)) throw e;
  die(e.message);
}

// ─── Preflight ───────────────────────────────────────────────────────────────
// Read-only ECP, so these can go out together — nothing here touches device state, and
// a serial sweep would put a 5 s timeout per unreachable device in front of the run.
console.log(`[matrix] checking ${devices.length} device(s) ...`);
const probes = await Promise.all(
  devices.map(async (host) => {
    try {
      return { host, info: await fetchDeviceInfo(host), error: null };
    } catch (e) {
      return { host, info: null, error: e.message };
    }
  }),
);

const refusal = preflightRefusal(probes, { cannotRunApps });
if (refusal) die(refusal);

console.log('\n[matrix] measuring, in order:');
for (const line of formatPlanLines(probes, { describeDevice })) console.log(line);
console.log(`[matrix] each device runs: npm run measure -- ${forwarded.join(' ')}`);
if (forwarded.includes('--deploy')) {
  console.log('[matrix] --deploy: every device builds this checkout and sideloads it separately.');
}
// The tier labels are the reason `.env` only has to carry addresses — but a device Roku
// has not published is still measurable, so this is a note rather than a refusal.
const untiered = probes.filter((p) => !ramTierFor(p.info['model-number']));
if (untiered.length) {
  console.log(
    `[matrix] ⚠ no RAM tier for ${untiered.map((p) => p.host).join(', ')} — the model is not in ` +
      "Roku's published table yet. The series still records; only the tier label is absent.",
  );
}

// ─── The devices, in order ───────────────────────────────────────────────────
const results = [];
for (const [i, probe] of probes.entries()) {
  const label = describeDevice(probe.info['model-number']);
  console.log(`\n[matrix] ── ${i + 1}/${probes.length}  ${probe.host} — ${label} ──`);

  const child = spawnSync(process.execPath, [MEASURE, ...forwarded], {
    stdio: 'inherit',
    // `ROKU_IP` LAST so it wins over the inherited one. `.env` cannot take it back:
    // dotenv leaves an already-set variable alone (verified, not assumed — the whole
    // design rests on it).
    env: { ...process.env, ROKU_IP: probe.host },
  });

  results.push({ host: probe.host, label, status: child.status, signal: child.signal });

  // A signal is the operator, not the device. Ctrl-C reaches the whole process group, so
  // the child has already released its own lock — carrying on to the next device would
  // ignore an interrupt that was aimed at the run, not at one series.
  if (child.signal) {
    for (const rest of probes.slice(i + 1)) {
      results.push({
        host: rest.host,
        label: describeDevice(rest.info['model-number']),
        status: null,
        signal: null,
        skipped: true,
      });
    }
    break;
  }
}

// ─── How it went ─────────────────────────────────────────────────────────────
const summary = summariseMatrix(results);
console.log('\n[matrix] ── summary ──');
for (const line of summary.lines) console.log(line);
console.log(
  `[matrix] ${summary.measured}/${results.length} device(s) measured. Each wrote its own series ` +
    'to .device-runs/measure/measurements.jsonl — read them back with `npm run measure:compare`.',
);
process.exit(summary.ok ? 0 : 1);
