/**
 * Vitest globalSetup — runs ONCE in the main process before any test worker.
 * Sideloads the RTA-enabled build a single time for the whole run. Set
 * RTA_NO_DEPLOY=1 to skip the deploy and run against whatever is already
 * sideloaded (fast inner loop).
 *
 * The build/ dir must already exist — the npm scripts run `npm run build` first.
 */
import { setupRtaEnv, deployRtaBuild } from '../lib/driver.js';

export async function setup() {
  setupRtaEnv();
  if (process.env.RTA_NO_DEPLOY === '1') {
    console.log('[rta] RTA_NO_DEPLOY=1 — skipping deploy, using the already-sideloaded build');
    return;
  }
  console.log('[rta] deploying RTA-enabled build (ENABLE_RTA) ...');
  await deployRtaBuild();
}
