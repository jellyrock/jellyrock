/**
 * RTA functional tests: each screen in the registry is reached and asserted
 * loaded against a real device. The nav steps' odc waits are the assertions —
 * a screen that fails to render makes the nav throw, failing the test.
 *
 * Run: `npm run test:rta` (build + deploy + run) or `npm run test:rta:fast`
 * (skip redeploy). Set RTA_CAPTURE=1 (or `npm run test:rta:capture`) to also
 * dump a raw UI screenshot per screen to out/rta-captures/ for GUI viewing.
 *
 * Requires a reachable device + .env (ROKU_IP / ROKU_PASSWORD), same as the
 * Rooibos device tests.
 */
import { beforeAll, afterAll, it } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getHero } from '../lib/jellyfin.js';
import { seedHome, seedUserSelect, snapshotSession, restoreSession } from '../lib/seed.js';
import { relaunch, ecp } from '../lib/driver.js';
import { SCREENS } from '../screens.js';
import { captureRawUI } from '../capture.js';

const CAPTURE = process.env.RTA_CAPTURE === '1';
const LOCALE = RTA_CONFIG.languages[0]; // en_US

let saved;
let session;
let ctx;

beforeAll(async () => {
  saved = await snapshotSession(); // restore the device's prior session afterward
  session = await authenticate(RTA_CONFIG.server);
  const hero = await getHero(session);
  // Functional tests assert each screen LOADS; the hero movie exercises every nav
  // (incl. trickplay). The trickplay-specific film is a store-screenshot concern.
  ctx = { heroIndex: hero.index, heroId: hero.id, seekSeconds: RTA_CONFIG.seekSeconds };
});

afterAll(async () => {
  await restoreSession(saved);
  await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false }).catch(() => {});
});

it.each(SCREENS)('screen "$name" loads', async (screen) => {
  if (screen.state === 'home') await seedHome(session, LOCALE);
  else if (screen.state === 'userSelect') await seedUserSelect(session, LOCALE);
  await relaunch();
  if (screen.nav) await screen.nav(ctx); // nav's waitFor gates assert "loaded"
  if (screen.assert) await screen.assert(ctx); // explicit assert for seed-to-land screens
  if (CAPTURE && screen.capture?.eligible) await captureRawUI(screen.name);
});
