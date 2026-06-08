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

/** Relaunch the dev channel and wait for boot + the RTA on-device component. */
export async function relaunch() {
  await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false });
  await sleep(RTA_CONFIG.bootMs);
}
