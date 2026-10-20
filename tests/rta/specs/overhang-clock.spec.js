/**
 * The "Hide clock" setting (`uiDesignHideClock`) hides the overhang clock on every screen
 * that shows the overhang, not only on Home and Search. Screens declare `isClockVisible` and
 * JRScene's overhang controller projects it onto the shared overhang, ANDed with the user's
 * preference; a screen that declares nothing (Settings here) must still honor the setting.
 */
import { beforeAll, it, expect } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch, odc } from '../lib/driver.js';
import { navSettings } from '../lib/nav.js';
import { getVal, waitFor, waitHome } from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const CLOCK_FIELD = '#overhang.isClockVisible';
const CLOCK_NODE = '#overhang.#clock.visible';

let session;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
});

async function launchHome(hideClock, label) {
  const expectedServer = await seedHome(session, LOCALE);
  // null deletes the key. rta-run.js restores the whole registry after the run.
  await odc.writeRegistry({
    values: { [session.userId]: { uiDesignHideClock: hideClock ? 'true' : null } },
  });
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, label);
  await waitHome();
}

it('hides the clock on Home and on Settings when the setting is on', async () => {
  await launchHome(true, 'overhang-clock hidden');
  await waitFor('#overhang.isClockVisible', (v) => v === false, { label: 'clock hidden on Home' });
  expect(await getVal(CLOCK_NODE)).toBe(false);

  await navSettings();
  await waitFor('#overhang.isClockVisible', (v) => v === false, {
    label: 'clock hidden on Settings',
  });
  expect(await getVal(CLOCK_NODE)).toBe(false);
});

it('shows the clock on Home and on Settings when the setting is off', async () => {
  await launchHome(false, 'overhang-clock shown');
  expect(await getVal(CLOCK_FIELD)).toBe(true);

  // The field already reads true before the view changes, so a wait would pass on its first
  // tick. navSettings settles the screen first (its version-label gate and paint settle), by
  // which time an over-hiding projection would have run, so a plain read is the right check.
  await navSettings();
  expect(await getVal(CLOCK_FIELD)).toBe(true);
  expect(await getVal(CLOCK_NODE)).toBe(true);
});
