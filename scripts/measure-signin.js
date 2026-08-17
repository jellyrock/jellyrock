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
 * the whole reason this comment exists: the on-device component lives INSIDE the app, so
 * an ODC read against a device that is not running it does not fail, it HANGS — and it
 * presents exactly like a network problem. That cost ~10 minutes to diagnose the first
 * time (2026-08-16) and is the same failure shape as the wedged deploy in #817.
 *
 * WHICH phase hangs is worth being exact about, because it decides where the bound has to
 * go. RTA does time out its requests (`sendRequest` races against `getTimeOut(options)`,
 * 10 s by default) — but it `await`s `setupClientSocket()` BEFORE that race, and that
 * promise only self-rejects on `ECONNREFUSED`/`EPIPE`. A connect to port 9000 that neither
 * connects nor errors never settles it, and the promise is cached, so it stays wedged.
 * Passing a `timeout` option to `readRegistry` therefore would NOT help. The bound has to
 * be an outer wall clock, which is `SIGNIN_TIMEOUT_MS` below.
 *
 * `hardRelaunch()` fixes the common cause (a device parked on the Roku home screen). It
 * cannot fix the other one — a resident build with no ODC at all, which is what a device
 * carrying a Rooibos test build or a `build:prod` has. `--deploy` does not rescue that
 * either: the deploy happens inside `measure`, i.e. AFTER this runs. Hence the timeout,
 * whose message names the cause rather than the elapsed seconds.
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
 *
 * ## The locale the seed writes, and why it is PINNED rather than preserved
 *
 * `seedHome` sets the app's translation locale, so this step chooses one. It pins
 * `RTA_CONFIG.languages[0]` for the same reason the matrix hard-asserts one server: a
 * matrix exists to compare HARDWARE, and a row measured in `fr` beside one measured in
 * `en_US` differs in workload as well as in silicon. Preserving each device's own locale
 * would read as the more conservative choice and is in fact the confounded one.
 *
 * The cost is that a seeded series and a plain `npm run measure` series on the same device
 * need not have run in the same language, and `measurements.jsonl` carries no locale field
 * to say so. That is why the locale is PRINTED here and by the driver, and why carrying it
 * in the record is an open followup rather than something this file quietly assumes away.
 */
import { setupRtaEnv, hardRelaunch, device, withTimeout } from '../tests/rta/lib/driver.js';
import { snapshotRegistry } from '../tests/rta/lib/registry.js';
import { seedHome, assertSeedTookEffect } from '../tests/rta/lib/seed.js';
import { authenticate } from '../tests/rta/lib/jellyfin.js';
import { acquireDeviceLock } from './device-lock.js';
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

/** The locale the seed writes. Pinned, not preserved — see the header. */
const locale = RTA_CONFIG.languages[0];

/**
 * A wall clock on the whole sequence, because one step inside it has no bound of its own.
 *
 * Healthy is ~40-50 s here: two `hardRelaunch`es cost `exitMs + bootMs` each (~14 s), and
 * the registry read, the auth round trip and the seed are small beside that. Three minutes
 * is roughly the 4x headroom `DEPLOY_TIMEOUT_MS` allows its own step, and the direction of
 * error matters — this is a diagnosis for a wedge, never a performance gate, so a slow LAN
 * or a slow server must not be turned into a spurious failure.
 */
const SIGNIN_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Taken for the same reason `measure.js` takes one, and it is the step that needs it MOST.
 *
 * This is the only part of a matrix run that WRITES the registry, and a concurrent run that
 * snapshots while a device is seeded adopts our seed as that user's own state — then
 * restores it faithfully, forever. That is the compounding damage `lib/registry.js` was
 * written to prevent, arrived at from the outside.
 *
 * `acquireDeviceLock` THROWS on contention rather than waiting, which is the behavior this
 * wants: the driver reads a non-zero exit as one device's failure, reports the row, and
 * carries on to the rest of the matrix. Degrades to a warning (never a block) when there is
 * no GitHub token, so it cannot wedge a contributor who has not run `gh auth login`.
 */
let lock;
try {
  lock = await acquireDeviceLock({ what: 'measure sign-in' });
} catch (e) {
  // Contention, not a defect. Its message already names the holder and the way forward,
  // so it is printed as-is — a top-level rejection would bury that under a stack trace
  // for a condition that is nobody's bug.
  console.error(`\n[signin] ${host}: ${e.message}`);
  process.exit(1);
}

// `process.exit` does not run a `finally`, so the release is sequenced explicitly rather
// than wrapped around an exit — a lock held by a process that is gone wedges every
// contender until the lease expires.
let failure = null;
try {
  await withTimeout(
    signIn(),
    SIGNIN_TIMEOUT_MS,
    `the sign-in did not finish within ${SIGNIN_TIMEOUT_MS / 1000}s. The likely cause is not ` +
      'the network: the on-device component lives INSIDE the app, so this hangs rather than ' +
      'fails when the resident build has no ODC — a Rooibos test build or a `build:prod` ' +
      'both present exactly this way, and `--deploy` does not help because the deploy ' +
      `happens after this step. Sideload an RTA build first (ROKU_IP=${host} npm run test:rta ` +
      `deploys one), or check the debug console (telnet ${host} 8085) for a crash on launch.`,
  );
} catch (e) {
  failure = e;
}

await lock.release().catch(() => {});

if (failure) {
  console.error(`\n[signin] ${host}: FAILED — ${failure.message}`);
  console.error(
    '[signin] The device is left as it stands; the matrix restores it before moving on.\n' +
      `[signin] To repair it by hand at any point: ROKU_IP=${host} npm run rta:restore`,
  );
  process.exit(1);
}
process.exit(0); // RTA holds the port-9000 socket open

async function signIn() {
  // FIRST. See the header: the ODC is inside the app, and reading the registry of a device
  // parked on the Roku home screen hangs rather than failing.
  console.log(`[signin] ${host}: relaunching so the on-device component is reachable ...`);
  await hardRelaunch();

  await snapshotRegistry();

  console.log(`[signin] ${host}: authenticating as ${JSON.stringify(username)} ...`);
  const session = await authenticate({ url, username, password }, { role: 'measure-matrix' });

  const seeded = await seedHome(session, locale);
  await hardRelaunch();
  await assertSeedTookEffect(seeded, `measure:devices --sign-in (${host})`);

  // The locale is named because the seed CHANGED it and no record will carry it — see the
  // header. Without this line the one thing the seed altered besides the session is silent.
  console.log(`[signin] ${host}: signed in to ${seeded} as ${session.username}, locale ${locale}.`);
}
