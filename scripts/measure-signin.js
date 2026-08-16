/**
 * Sign ONE device into a Jellyfin server so a matrix run can measure it.
 *
 *   ROKU_IP=192.0.2.10 node scripts/measure-signin.js --url http://192.0.2.2:8096 --user alice
 *
 * Spawned once per device by `scripts/measure-devices.js --sign-in`; that flag is the
 * supported surface and this file is its per-device half. Runnable by hand for the same
 * reason `rta-restore.js` is — when a device needs putting into a known state and there is
 * no matrix to run — but nothing else imports it.
 *
 * ## Why this is a separate PROCESS rather than a function the driver calls
 *
 * The same constraint that made the driver spawn `measure.js` per device:
 * `roku-test-automation` configures `ecp` / `odc` / `device` as module singletons bound to
 * ONE host (`setupRtaEnv`), so a parent cannot re-point them at a second Roku with an ODC
 * connection already open against the first. One process per device is the shape the
 * client supports, not a workaround for it.
 *
 * A useful property falls out of that: `sessionDeviceId` hashes `ROKU_IP` when no lock
 * handed it a `deviceKey`, so each child authenticates under its own Jellyfin `DeviceId`
 * and the three sign-ins cannot evict each other's session.
 *
 * ## The sequence, and the trap at the front of it
 *
 * `hardRelaunch()` runs FIRST, before anything reads the registry, and that ordering is
 * the whole reason this comment exists: the on-device component lives INSIDE the app, and
 * RTA sets no timeout on `readRegistry` — so a device sitting on the Roku home screen does
 * not fail, it HANGS, and it presents exactly like a network problem. That cost ~10 minutes
 * to diagnose the first time (2026-08-16) and is the same failure shape as the wedged
 * deploy in #817, one layer down.
 *
 * Then: snapshot the WHOLE registry to disk BEFORE any write (`lib/registry.js` — that file
 * is the device's only backup and the reason a killed run is still recoverable), authenticate,
 * seed, cold restart, and PROVE the seed took. `assertSeedTookEffect` is not ceremony: a plain
 * relaunch only foregrounds a running channel, so the app re-persists its in-memory session
 * over the seed and the run measures the wrong server using the right server's name.
 *
 * Putting the device back is deliberately NOT this script's job — the driver runs
 * `rta-restore.js` after the series, so a device is restored whether the measurement passed,
 * failed, or never got that far. If this process dies partway, the snapshot on disk is the
 * repair: `ROKU_IP=<host> npm run rta:restore`.
 *
 * ## Why `seedHome`, and never `seedServerSelect`
 *
 * `seedServerSelect` overwrites `saved_servers` with the DEMO server — which the project
 * charter puts out of scope for perf work, and which changes the workload of the very screen
 * it would be used to reach. `seedHome` writes an authenticated session for the server the
 * operator named and nothing else.
 */
import { setupRtaEnv, hardRelaunch, device } from '../tests/rta/lib/driver.js';
import { snapshotRegistry } from '../tests/rta/lib/registry.js';
import { seedHome, assertSeedTookEffect } from '../tests/rta/lib/seed.js';
import { authenticate } from '../tests/rta/lib/jellyfin.js';
import { RTA_CONFIG } from '../tests/rta/config.js';

/** `--url <v>` / `--url=<v>`, for the two flags the driver passes. */
function argValue(name) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  if (i !== -1) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

const url = argValue('--url');
const username = argValue('--user');
// Never on argv: a real password there is visible in `ps` and lands in shell history.
// `measure-devices.js` puts it here; `MEASURE_SIGNIN_PASSWORD` is also how an operator
// running this by hand supplies one. Blank is the common case — a Jellyfin account with
// `HasPassword: false` authenticates with an empty `Pw`.
const password = process.env.MEASURE_SIGNIN_PASSWORD ?? '';

if (!url || !username) {
  console.error(
    '[signin] usage: ROKU_IP=<host> node scripts/measure-signin.js --url <url> --user <name>',
  );
  process.exit(1);
}

setupRtaEnv(); // throws if ROKU_IP / ROKU_PASSWORD are missing — before anything is touched
const host = device.getCurrentDeviceConfig().host;

try {
  // FIRST. See the header: the ODC is inside the app, and reading the registry of a device
  // parked on the Roku home screen hangs rather than failing.
  console.log(`[signin] ${host}: relaunching so the on-device component is reachable ...`);
  await hardRelaunch();

  await snapshotRegistry();

  console.log(`[signin] ${host}: authenticating as ${JSON.stringify(username)} ...`);
  const session = await authenticate({ url, username, password }, { role: 'measure-matrix' });

  const seeded = await seedHome(session, RTA_CONFIG.languages[0]);
  await hardRelaunch();
  await assertSeedTookEffect(seeded, `measure:devices --sign-in (${host})`);

  console.log(`[signin] ${host}: signed in to ${seeded} as ${session.username}.`);
  process.exit(0); // RTA holds the port-9000 socket open
} catch (e) {
  console.error(`\n[signin] ${host}: FAILED — ${e.message}`);
  console.error(
    '[signin] The device is left as it stands; the matrix restores it before moving on.\n' +
      `[signin] To repair it by hand at any point: ROKU_IP=${host} npm run rta:restore`,
  );
  process.exit(1);
}
