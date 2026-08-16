/**
 * Take the same measurement on every device in `ROKU_DEVICES`, one after another.
 *
 *   npm run measure:devices -- --server <url> --measurement screen-load --nav settings -n 30
 *   npm run measure:devices -- --sign-in <url> --user <name> --nav settings -n 30
 *   ROKU_DEVICES=192.0.2.10,192.0.2.11 npm run measure:devices -- --server <url> -n 5
 *
 * Every flag except the sign-in ones is forwarded VERBATIM to `npm run measure`; this tool
 * knows nothing about that grammar and deliberately does not re-implement any of it. What
 * it adds is the one thing `measure` cannot do for itself — drive more than one device —
 * plus the preflight that makes a long unattended run worth starting.
 *
 * ## `--sign-in <url> --user <name>` — establishing the precondition, not just asserting it
 *
 * This tool has always REFUSED a matrix whose devices might be on different servers (the
 * server is the workload), and until now it could not PUT them on one: `measure` never
 * writes the registry, so a cross-tier run meant signing every device in by hand, before
 * every run, because the sanctioned workflow restores them all afterwards. The sign-in mode
 * closes that: per device it seeds an authenticated session, measures, and restores.
 *
 * The rules — including why the URL is forwarded as `--server` so tier 1 still asserts what
 * was seeded, and why `--server` / `--no-server` alongside it are refusals — are in
 * `parseSignIn` (`measure-matrix.js`), where they can be tested. The seeding itself is
 * `measure-signin.js`, one child per device for the same singleton reason as below.
 *
 * **The seed lives here and never in `measure.js`**, whose header states the terms:
 * a mode that seeds must adopt `lib/registry.js` at the same time. This one does, through
 * that child — and the restore is `rta-restore.js`, which already owns exactly this job.
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
  parseSignIn,
  preflightRefusal,
  resolveDevices,
  serverDeclarationRefusal,
  summariseMatrix,
} from './measure-matrix.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MEASURE = path.join(here, 'measure.js');
const SIGNIN = path.join(here, 'measure-signin.js');
const RESTORE = path.join(here, 'rta-restore.js');

const die = (message) => {
  console.error(`\n[matrix] ${message}`);
  process.exit(1);
};

// Free and instant, so these go ahead of anything that touches the network. Sign-in is
// parsed FIRST because it rewrites what `measure` receives — `--sign-in <url>` forwards
// `--server <url>`, which is what makes it a server declaration in its own right.
let signIn = null;
let forwarded = process.argv.slice(2);
try {
  ({ signIn, forward: forwarded } = parseSignIn(forwarded, process.env));
} catch (e) {
  if (!(e instanceof MatrixError)) throw e;
  die(e.message);
}

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
if (signIn) {
  console.log(
    `[matrix] --sign-in: each device is seeded into ${signIn.url} as ` +
      `${JSON.stringify(signIn.username)}, measured, then restored to the state it was found in.\n` +
      '[matrix]   Its whole registry is written to .device-runs/registry-<host>.json before any\n' +
      '[matrix]   seeding, so an interrupted run is repaired by: ROKU_IP=<host> npm run rta:restore',
  );
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

// ─── Interrupts ──────────────────────────────────────────────────────────────
//
// Installed only for the sign-in mode, and it exists to buy the RESTORE a chance to run.
// Ctrl-C reaches the whole process group, so the child dies either way — but the parent's
// DEFAULT SIGINT handling is to terminate too, and it would do so the moment the blocking
// `spawnSync` returned, i.e. exactly between "device is seeded" and "device is restored".
// A handler that records the interrupt and returns suppresses that default, so the
// synchronous flow below reaches its restore and its summary. (It also makes the
// already-written "mark the rest skipped" path reachable on Ctrl-C for the first time; a
// parent killed by the default handler never got there.)
//
// A SECOND interrupt abandons the restore and leaves immediately — the snapshot on disk is
// what makes that safe, and being un-killable is worse than being dirty. Same trade
// `armRestoreOnInterrupt` makes in `tests/rta/lib/registry.js`.
let interrupted = null;
if (signIn) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (interrupted) {
        console.log(`\n[matrix] second ${signal} — abandoning the restore, exiting now.`);
        console.log('[matrix] recover with: ROKU_IP=<host> npm run rta:restore');
        process.exit(130);
      }
      interrupted = signal;
      console.log(
        `\n[matrix] ${signal} — stopping after this device is put back. Ctrl-C again to abandon.`,
      );
    });
  }
}

/** Run one of this tool's helper scripts against `host`, inheriting its output. */
const runFor = (host, script, argv = [], env = {}) =>
  spawnSync(process.execPath, [script, ...argv], {
    stdio: 'inherit',
    // `ROKU_IP` LAST so it wins over the inherited one. `.env` cannot take it back:
    // dotenv leaves an already-set variable alone (verified, not assumed — the whole
    // design rests on it).
    env: { ...process.env, ...env, ROKU_IP: host },
  });

// ─── The devices, in order ───────────────────────────────────────────────────
const results = [];
for (const [i, probe] of probes.entries()) {
  const label = describeDevice(probe.info['model-number']);
  const row = { host: probe.host, label, status: null, signal: null };
  results.push(row);
  console.log(`\n[matrix] ── ${i + 1}/${probes.length}  ${probe.host} — ${label} ──`);

  // Sign in first, and treat a failed sign-in as this device's failure rather than the
  // run's: the remaining devices are still measurable, and stopping the matrix because one
  // Roku would not take a session is the "lose a tier, lose the run" shape the per-device
  // split exists to avoid. The restore below still runs — the snapshot is taken before the
  // first write, so a sign-in that failed halfway is exactly the case it exists for.
  let seeded = false;
  if (signIn) {
    const child = runFor(
      probe.host,
      SIGNIN,
      ['--url', signIn.url, '--user', signIn.username],
      // The password never reaches argv — see `measure-signin.js`.
      { MEASURE_SIGNIN_PASSWORD: signIn.password },
    );
    // Unconditional, and deliberately not conditioned on the child's exit code: a failure
    // says nothing about how far it got, and `rta-restore.js` is a no-op that prints so
    // when there is no snapshot. Guessing wrong in the other direction leaves a seeded
    // device with nobody looking at it.
    seeded = true;
    row.status = child.status;
    row.signal = child.signal;
    if (child.status !== 0 || child.signal) row.stage = 'sign-in';
  }

  if (row.stage) {
    // The sign-in failed, so there is no state to measure against. Its exit code is
    // already on the row; the restore below still runs.
  } else if (interrupted) {
    // The interrupt landed between a successful sign-in and this spawn. Overwriting the
    // sign-in's exit 0 is the whole point: without it the row keeps a passing status and
    // the summary reports a device as `measured` that never ran a series at all.
    row.signal = interrupted;
  } else {
    const child = runFor(probe.host, MEASURE, forwarded);
    row.status = child.status;
    row.signal = child.signal;
    if (child.status !== 0 || child.signal) row.stage = 'measure';
  }

  // ALWAYS, whatever happened above — including an interrupt. A device left seeded is the
  // damage `lib/registry.js` was written to prevent, and it compounds: the next run that
  // snapshots it adopts the leftovers as the user's own state.
  if (seeded) {
    console.log(`\n[matrix] ${probe.host}: restoring the registry ...`);
    row.restored = runFor(probe.host, RESTORE).status === 0;
  }

  // A signal is the operator, not the device. Carrying on to the next device would ignore
  // an interrupt that was aimed at the run rather than at one series.
  if (interrupted || row.signal) {
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
