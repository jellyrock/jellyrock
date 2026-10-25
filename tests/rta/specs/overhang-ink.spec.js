/**
 * Where the overhang's ink sits on Home (tabs, dropdown, cluster, clock) and on Settings
 * (a title in the tabs' place), as tables of design pixels from `measureOverhangInk`. A
 * measurement: it reports and gates nothing, so it runs only when asked for:
 *
 *   RTA_BENCH=1 npm run test:rta -- overhang-ink
 *
 * Each table lands beside its capture in `out/rta-captures/` as `<name>.ink.json`, so a
 * layout change is judged by diffing two runs. A passing test's console output is
 * suppressed in a non-TTY run, which is why the file is the result.
 *
 * The clock is shown for the run (the setting key deleted), so its row always measures.
 * Skipping the only `it` skips the `beforeAll` too, so a normal run pays nothing.
 */
import { beforeAll, it, expect } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch, odc } from '../lib/driver.js';
import { navSettings } from '../lib/nav.js';
import { waitHome } from '../lib/steps.js';
import { measureOverhangInk, HOME_INK_TARGETS, TITLE_INK_TARGETS } from '../lib/ink.js';

const BENCH_ENABLED = process.env.RTA_BENCH === '1';
const LOCALE = RTA_CONFIG.languages[0];

let session;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
});

it.skipIf(!BENCH_ENABLED)('measures the overhang ink on Home and on Settings', async () => {
  const expectedServer = await seedHome(session, LOCALE);
  // null deletes the key. rta-run.js restores the whole registry after the run.
  await odc.writeRegistry({
    values: { [session.userId]: { uiDesignHideClock: null } },
  });
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'overhang-ink');
  await waitHome();

  const home = await measureOverhangInk('overhang-ink-home', HOME_INK_TARGETS);
  expect(home).toHaveLength(HOME_INK_TARGETS.length);

  await navSettings();
  const settings = await measureOverhangInk('overhang-ink-settings', TITLE_INK_TARGETS);
  expect(settings).toHaveLength(TITLE_INK_TARGETS.length);
});
