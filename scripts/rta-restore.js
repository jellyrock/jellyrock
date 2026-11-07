/**
 * Put a device's registry back after an RTA run that never restored it.
 *
 *   npm run rta:restore
 *
 * Every RTA entry point (`test:rta`, `screenshots:capture`, `demo`) writes the
 * device's full registry to `.device-runs/registry-<host>.json` BEFORE it seeds
 * anything, and deletes that file once its own verified restore succeeds. So a
 * file still sitting there means exactly one thing: the run did not put the
 * device back. It was killed, it crashed, or its restore failed.
 *
 * The next run repairs the device automatically (see `snapshotRegistry`); this
 * script is for when you want it back NOW, without starting a run. It targets
 * `ROKU_IP` from `.env` and refuses a snapshot taken from a different host.
 *
 *   npm run rta:restore -- --accept
 *
 * ...records the differences it could not restore and clears the snapshot anyway.
 * The escape hatch for a residual that will never converge: the snapshot is KEPT
 * on failure by design, and `snapshotRegistry()` restores from it before its own,
 * so an unconvergeable one blocks every later run and this very command re-runs
 * the same loop. `--accept` is the way out that is not `rm` on the device's only
 * backup. It does not claim the device is clean: it prints what it accepted.
 *
 * Requires the RTA-enabled build sideloaded (the on-device component is the
 * only way to reach the registry from outside), so it launches the dev channel
 * first if it is not already running.
 *
 *   npm run rta:restore -- --force
 *
 * ...restores even though the snapshot's owning process is still alive. See the
 * refusal below for why that is normally the wrong thing to do.
 *
 *   node scripts/rta-restore.js --takeover --owner=<pid> --wait-group=<pgid> [--release-lock]
 *
 * ...is how `rta-run.js` restores: it starts this as a helper outside its own process
 * tree, so a stop that kills the runner cannot cut the restore short. The helper adopts
 * the snapshot, waits for Vitest's group to exit, restores, and releases the device lock.
 */
import { setupRtaEnv, ecp, device } from '../tests/rta/lib/driver.js';
import { readSnapshotFile, restoreRegistry, adoptSnapshotFile } from '../tests/rta/lib/registry.js';
import { sleep } from '../tests/rta/lib/steps.js';
import { RTA_CONFIG } from '../tests/rta/config.js';
import { isProcessAlive } from './lib/process-liveness.cjs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const takeover = process.argv.includes('--takeover');

if (takeover) {
  // A closed terminal must not crash the helper mid-restore.
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});
}

setupRtaEnv();
const host = device.getCurrentDeviceConfig().host;

const snapshot = readSnapshotFile();
if (!snapshot) {
  console.log(`Nothing to restore: no saved registry snapshot for ${host}.`);
  console.log('(A snapshot only survives a run that failed to restore — this is the good case.)');
  process.exit(0);
}

if (takeover) {
  const owner = Number(arg('owner'));
  const waitGroup = Number(arg('wait-group'));
  if (snapshot.ownerPid !== owner) {
    console.error(
      `[rta-restore] refusing to take over ${host}: the snapshot belongs to pid ` +
        `${snapshot.ownerPid}, not ${owner}.`,
    );
    process.exit(1);
  }
  adoptSnapshotFile(owner, snapshot.file);

  const groupGone = () => {
    try {
      process.kill(-waitGroup, 0);
      return false;
    } catch (e) {
      return e.code === 'ESRCH';
    }
  };
  const waitFor = async (ms) => {
    const end = Date.now() + ms;
    while (!groupGone() && Date.now() < end) await sleep(100);
  };
  await waitFor(15_000);
  if (!groupGone()) {
    try {
      process.kill(-waitGroup, 'SIGKILL');
    } catch {
      /* gone meanwhile */
    }
    await waitFor(3_000);
  }

  let ok = false;
  try {
    await restoreRegistry(snapshot.values);
    ok = true;
    console.log('VERIFIED CLEAN — device left as found.');
  } catch (e) {
    console.error(`[rta-restore] ${e.message}`);
  }
  await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false }).catch(() => {});
  if (process.argv.includes('--release-lock') && !isProcessAlive(owner)) {
    try {
      execFileSync(
        process.execPath,
        [path.join(path.dirname(fileURLToPath(import.meta.url)), 'device-lock.js'), 'release'],
        { env: process.env, stdio: 'inherit' },
      );
    } catch (e) {
      console.error(`[rta-restore] could not release the device lock: ${e.message}`);
    }
  }
  process.exit(ok ? 0 : 1);
}

// The premise of this whole script ("a file still sitting there means the run did
// not put the device back") is false while that run is STILL GOING. The snapshot
// is written before any seeding and removed only by a verified restore, so it is
// present for the entire suite, and restoring from it here would put the registry
// back underneath a live run and relaunch the channel mid-suite. `npm run
// device:status` used to actively recommend exactly that; it no longer does, but
// the recommendation also lives in older docs and in people's memory, so the
// refusal belongs at the destructive end and not only at the signpost.
//
// A missing `ownerPid` (a snapshot from before that field, or a truncated write)
// reads as not-alive and restores as it always did: the conservative direction,
// since those are the stranded cases.
if (isProcessAlive(snapshot.ownerPid) && !process.argv.includes('--force')) {
  console.error(
    `Refusing to restore ${host}: its snapshot belongs to a run that is STILL RUNNING ` +
      `(pid ${snapshot.ownerPid}, taken ${snapshot.takenAt}).\n` +
      '  Restoring now would revert the registry underneath that run and relaunch the\n' +
      '  channel mid-suite. The run removes this file itself once it restores.\n' +
      '  Let it finish, or stop it first. If the pid is not the run you think it is:\n' +
      '    npm run rta:restore -- --force',
  );
  process.exit(1);
}

console.log(`Restoring ${host} from a snapshot taken ${snapshot.takenAt} ...`);

// ODC lives inside the app, so the channel has to be up before we can read or
// write the registry at all.
await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false }).catch(() => {});
await sleep(RTA_CONFIG.bootMs);

const accept = process.argv.includes('--accept');
await restoreRegistry(snapshot.values, { accept });
console.log(
  accept
    ? 'Snapshot cleared. Any differences accepted above were NOT restored.'
    : 'VERIFIED CLEAN — device left as found.',
);
process.exit(0); // RTA keeps the port-9000 socket open
