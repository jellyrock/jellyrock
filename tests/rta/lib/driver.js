/**
 * RTA device lifecycle: environment setup (from .env), deploy of the
 * RTA-enabled build, and relaunch. Re-exports the RTA client singletons so the
 * rest of the layer imports them from one place.
 *
 * `import 'dotenv/config'` loads .env on import so ROKU_IP / ROKU_PASSWORD are
 * available to any consumer (tests, screenshot script).
 */
import 'dotenv/config';
import { ecp, odc, device, utils } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { sleep } from './steps.js';

export { ecp, odc, device, utils };
export const BOOT_MS = RTA_CONFIG.bootMs;

/**
 * Apply RTA config to the client singletons (device host/password from .env,
 * ECP launch channel, ODC log level). Throws if creds are missing. Must run in
 * EACH process that talks to the device (Vitest workers run separately from
 * globalSetup), so call it from setupFiles AND globalSetup.
 */
export function setupRtaEnv() {
  const host = process.env.ROKU_IP;
  const password = process.env.ROKU_PASSWORD;
  if (!host || !password) {
    throw new Error('Missing ROKU_IP / ROKU_PASSWORD (set them in .env)');
  }
  utils.setupEnvironmentFromConfig({
    RokuDevice: { devices: [{ host, password, screenshotFormat: 'png' }] },
    ECP: { default: { launchChannelId: 'dev' } },
    OnDeviceComponent: { logLevel: 'info' },
  });
}

/**
 * Sideload the dev build with RTA enabled. RTA's deploy stages build/, flips the
 * manifest `ENABLE_RTA=false`->`true`, and injects the on-device component. The
 * build must already exist (callers run `npm run build` first — the dev build,
 * NOT build:prod, which compiles the #if ENABLE_RTA hook out).
 */
export async function deployRtaBuild() {
  await device.deploy({ rootDir: 'build', injectTestingFiles: true });
  await sleep(RTA_CONFIG.bootMs);
}

/**
 * Foreground the dev channel and wait for boot + the RTA on-device component.
 *
 * ⚠️ NOT safe after writing the registry — use `hardRelaunch()` there. This only
 * foregrounds an already-running channel, so the app keeps its in-memory session
 * and re-persists it over anything just seeded. Use this only for relaunches that
 * do NOT depend on registry state having changed.
 */
export async function relaunch() {
  await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false });
  await sleep(RTA_CONFIG.bootMs);
}

/**
 * Restart the channel FOR REAL: exit to the Roku home screen first, then launch.
 *
 * An ECP `/launch/dev` against an ALREADY-RUNNING channel only foregrounds it —
 * the app's in-memory session survives untouched. That is how a seeded demo
 * session outlived a "relaunch" and re-persisted itself over a restored
 * registry, leaving devices signed into `demo.jellyfin.org`. Exiting first
 * forces a cold start that actually re-reads the registry.
 *
 * **Every relaunch that follows a registry write must use this**, not `relaunch()`
 * — restore AND all seeding. An earlier revision applied that rule to the restore
 * path only, reasoning that mid-test relaunches wanted the cheap foreground path.
 * That was wrong in a way that hid for weeks: seeds were silently re-persisted
 * away, so the suite drove an app pointed at the operator's own server using
 * demo-server ids. Fixing the restore leak is what exposed it — before that,
 * devices were routinely left on the demo server, so the seed happened to agree
 * with what was already there. See `assertSeedTookEffect` in seed.js, which now
 * fails loudly instead.
 *
 * Cost is `exitMs` (~4s) per call. That is the price of the seed actually taking.
 */
export async function hardRelaunch() {
  await ecp.sendKeypress('Home');
  await sleep(RTA_CONFIG.exitMs);
  await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false });
  await sleep(RTA_CONFIG.bootMs);
}
