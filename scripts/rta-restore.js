/**
 * Put a device's registry back after an RTA run that never restored it.
 *
 *   npm run rta:restore
 *
 * Every RTA entry point (`test:rta`, `screenshots:capture`, `demo`) writes the
 * device's full registry to `.device-runs/registry-<host>.json` BEFORE it seeds
 * anything, and deletes that file once its own verified restore succeeds. So a
 * file still sitting there means exactly one thing: the run did not put the
 * device back — it was killed, it crashed, or its restore failed.
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
 * backup. It does not claim the device is clean — it prints what it accepted.
 *
 * Requires the RTA-enabled build sideloaded — the on-device component is the
 * only way to reach the registry from outside — so it launches the dev channel
 * first if it is not already running.
 */
import { setupRtaEnv, ecp, device } from '../tests/rta/lib/driver.js';
import { readSnapshotFile, restoreRegistry } from '../tests/rta/lib/registry.js';
import { sleep } from '../tests/rta/lib/steps.js';
import { RTA_CONFIG } from '../tests/rta/config.js';

setupRtaEnv();
const host = device.getCurrentDeviceConfig().host;

const snapshot = readSnapshotFile();
if (!snapshot) {
  console.log(`Nothing to restore: no saved registry snapshot for ${host}.`);
  console.log('(A snapshot only survives a run that failed to restore — this is the good case.)');
  process.exit(0);
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
