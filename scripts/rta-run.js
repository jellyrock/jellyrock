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
import { acquireDeviceLock, writeRunMeta } from './device-lock.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const passthrough = process.argv.slice(2).filter((a) => a !== '--watch');

setupRtaEnv(); // throws if ROKU_IP / ROKU_PASSWORD are missing — fail before touching anything

// Claim the device BEFORE the deploy. Acquisition is one API call, the deploy is
// minutes, so a contended run fails in about a second instead of after a build —
// which is the difference between an agent being able to react and not.
const lock = await acquireDeviceLock({ what: watch ? 'test:rta:tdd' : 'test:rta' });
writeRunMeta(lock.meta, { run: watch ? 'test:rta:tdd' : 'test:rta' });

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
  { cwd: repoRoot, stdio: 'inherit', env: { ...process.env, RTA_RUNNER: '1' } },
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
