/**
 * The entry point for every RTA run: deploy, snapshot the device registry, run
 * Vitest as a CHILD, then restore — including when you Ctrl-C.
 *
 *   npm run test:rta            build + deploy + run
 *   npm run test:rta:fast       skip the deploy (RTA_NO_DEPLOY=1)
 *   npm run test:rta:capture    also dump per-screen PNGs (RTA_CAPTURE=1)
 *   npm run test:rta:tdd        watch mode
 *
 * ## Why a parent process, and not Vitest's globalSetup
 *
 * The registry lifecycle cannot live inside Vitest. Two reasons, one measured
 * and one structural:
 *
 *  - **Measured** on `.178` 2026-08-10: with the lifecycle in the specs'
 *    `beforeAll`/`afterAll`, SIGINT ~15 s into `npm run test:rta` left the
 *    device signed into `demo.jellyfin.org` as the demo user, with no restore
 *    output at all. `afterAll` simply does not run on a terminated process —
 *    this is the reported "RTA signed my device into the demo server" bug,
 *    reproduced on demand.
 *  - **Structural**: moving the arming up to `globalSetup` does not fix that.
 *    Vitest's reporter installs its own `SIGINT` handler that calls
 *    `process.exit()` on a 1 ms timer (`addCleanupListeners` in
 *    `vitest/dist/chunks/cli-api.*.js`), and a restore needs ~30 s — write,
 *    cold restart, verify. Any async handler inside the Vitest process is
 *    racing an exit it cannot win.
 *
 * A parent that owns Vitest as a child has neither problem: the interrupt stops
 * the CHILD, and the parent — which nothing else is trying to exit — runs the
 * restore to completion before exiting itself. Verified on `.178` 2026-08-10:
 * SIGINT mid-suite restored the full registry to 0 differences.
 *
 * `globalSetup` still runs, but only to refuse a bare `vitest` invocation that
 * would bypass this file and leave a device stranded.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupRtaEnv, deployRtaBuild, relaunch, ecp } from '../tests/rta/lib/driver.js';
import { snapshotRegistry, restoreRegistry } from '../tests/rta/lib/registry.js';
import { beginRun, RUN_OUTCOMES } from './run-record.js';
import { acquireDeviceLock } from './device-lock.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const passthrough = process.argv.slice(2).filter((a) => a !== '--watch');
const runName = watch ? 'test:rta:tdd' : 'test:rta';

setupRtaEnv(); // throws if ROKU_IP / ROKU_PASSWORD are missing — fail before touching anything

// Claim the device BEFORE the deploy. Acquisition is one API call, the deploy is
// minutes, so a contended run fails in about a second instead of after a build —
// which is the difference between an agent being able to react and not.
const lock = await acquireDeviceLock({ what: runName });

// A throw anywhere below this line exits the module without reaching any of the
// three `lock.release()` calls, leaving the device claimed by a dead process until
// the lease expires. Measured 2026-08-12: `ROKU_IP=192.168.1.200 npm run test:rta`
// threw a 401 out of `deployRtaBuild()` (that device's dev password is a CI secret)
// and `npm run device:status` then reported the device held by a pid that no longer
// existed, for the full 15-minute lease. The deploy is the most failure-prone step
// here and it sits between the claim and every release.
//
// This is the lock's counterpart to `run-record.js`'s process-exit net, and it needs
// its own hook rather than sharing that one: releasing is an API call, and nothing
// can await inside a `process.on('exit')` handler.
//
// A rejection out of top-level await surfaces as `uncaughtException`, NOT
// `unhandledRejection` (verified on Node 22.17) — hook both rather than depend on
// which. `process.exit` still runs the record's exit net, so the run folds as
// `crashed` on the way out.
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, async (err) => {
    console.error(`\n[rta] ${event} — releasing the device.\n${err?.stack || err?.message || err}`);
    await lock.release().catch(() => {});
    process.exit(1);
  });
}
// Opens the run record: stamps the wall-clock origin and clears the previous
// run's failure records. The origin is load-bearing rather than decorative — the
// demo server resets on the hour, so a suite starting after roughly `:46` has
// that reset land MID-RUN and fail as an unrelated-looking nav timeout. (A full
// pass measured 13.6 min and 13.7 min on `.177`, which puts the threshold at
// `:60 - 13.7`.) The Vitest child reads the origin back to stamp each failure;
// the close reports the window.
//
// `cumulative` is declared HERE rather than at the fold, because the fold is not
// always ours to make: the process-exit net in `run-record.js` closes a run the
// entry point never got to close (the abandon path below), and it can only know a
// watch session spans many iterations if the OPEN said so.
const run = beginRun({ lock, run: runName, cumulative: watch });

if (process.env.RTA_NO_DEPLOY === '1') {
  console.log('[rta] RTA_NO_DEPLOY=1 — skipping deploy, using the already-sideloaded build');
  // The snapshot below is an ODC call, and the on-device component only answers
  // while the channel is running. The deploy path launches it for us; this one
  // has to. Safe before any seeding has happened.
  await relaunch();
} else {
  console.log('[rta] deploying RTA-enabled build (ENABLE_RTA) ...');
  await deployRtaBuild();
}

const saved = await snapshotRegistry();

const child = spawn(
  process.execPath,
  [
    path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
    ...(watch ? [] : ['run']),
    '--config',
    'vitest.rta.config.js',
    ...passthrough,
  ],
  // `run.env` carries RTA_RUN_DIR — the child is a separate process, so it cannot
  // inherit which directory this run's records belong in any other way.
  { cwd: repoRoot, stdio: 'inherit', env: { ...process.env, RTA_RUNNER: '1', ...run.env } },
);

let interrupting = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, async () => {
    if (interrupting) {
      // Never trap someone in an un-killable process. The snapshot is on disk,
      // so abandoning here is recoverable rather than destructive. Kill the child
      // outright on the way out: a Vitest that outlives its parent keeps driving
      // the device (measured 2026-08-10 — an orphaned run kept re-seeding the demo
      // server underneath three restore attempts), which is far worse than a
      // device left dirty, because it silently fights the recovery.
      console.log('\n[rta] second interrupt — abandoning restore. Recover: npm run rta:restore');
      child.kill('SIGKILL');
      // Fold before the exit rather than leaving it to the net, which would label
      // an operator's deliberate abandon `crashed`. The device is left dirty here;
      // the RECORD does not have to be wrong as well.
      run.close(RUN_OUTCOMES.INTERRUPTED);
      // Release even on the abandon path: the device is left dirty, but leaving
      // the LOCK behind too would wedge every other contender until the TTL
      // expires, for no benefit. `rta:restore` is the documented repair.
      await lock.release();
      process.exit(130);
    }
    interrupting = true;
    console.log(
      `\n[rta] ${signal} — stopping the suite, then restoring the device (~30s).` +
        ' Ctrl-C again to abandon.',
    );
    child.kill('SIGTERM'); // a terminal Ctrl-C already reached it; this covers the rest
  });
}

const exitCode = await new Promise((resolve) => {
  child.on('exit', (code, signal) => resolve(signal ? 130 : (code ?? 0)));
});

// Fold the child's failure records into the run record, and say what they show.
// This is what `run-meta.json` has been missing: it was written by four entry
// points and read by nothing, so a degraded run's provenance — and now a
// failure's device state — only ever lived in a scrollback line. Explicit here,
// rather than left to the exit net, because ORDER matters on this path: folding
// before the restore is what makes the summary survive a restore that throws.
//
// In watch mode the record opened once at session start and folds once here, so
// the window spans every iteration rather than one run — which is why the open
// declared `cumulative` and the formatter drops the hour flag for it.
// The child's exit code is the only account of whether the suite passed: only five
// throw sites write failure records, and the specs also assert with plain
// `expect()`, so a red run can fold with an EMPTY failure list. Reading `failures`
// as the outcome would score that run green.
run.close(
  interrupting
    ? RUN_OUTCOMES.INTERRUPTED
    : exitCode === 0
      ? RUN_OUTCOMES.PASSED
      : RUN_OUTCOMES.FAILED,
);

try {
  await restoreRegistry(saved);
  console.log('[rta] device registry restored — left as found.');
} catch (e) {
  console.error(`\n[rta] ${e.message}`);
  await lock.release();
  process.exit(1);
}

await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false }).catch(() => {});
// Release only after the restore: the device is not actually free for the next
// contender until it has been put back the way we found it.
await lock.release();
process.exit(interrupting ? 130 : exitCode);
