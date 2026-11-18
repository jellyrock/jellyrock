/**
 * Where the overhang's ink sits on Home (tabs, dropdown, cluster, clock), on Settings and
 * Search (a title in the tabs' place, the same dropdown) and on a library (its tabs), in
 * every locale the suite covers and with a user name far too long for the row, as tables of
 * design pixels from `measureOverhangInk`. A measurement: it reports and gates nothing (the
 * line the name stops at is gated in `overhang-cluster.spec.js`), so it runs only when asked
 * for:
 *
 *   RTA_BENCH=1 npm run test:rta -- overhang-ink
 *
 * Each table lands beside its capture in `out/rta-captures/` as
 * `overhang-ink-<locale>-<screen>.ink.json`, so a layout change is judged by diffing two
 * runs. A passing test's console output is suppressed in a non-TTY run, which is why the file
 * is the result.
 *
 * The clock is shown for the run (the setting key deleted), so its row always measures.
 * Skipping the only `it` skips the `beforeAll` too, so a normal run pays nothing.
 */
import { beforeAll, it, expect } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { ecp, hardRelaunch, odc } from '../lib/driver.js';
import { navLibraryGrid, navSettings } from '../lib/nav.js';
import { press, waitFocusInside, waitHome, walkOverhangRowTo } from '../lib/steps.js';
import {
  measureOverhangInk,
  HOME_INK_TARGETS,
  LIBRARY_INK_TARGETS,
  TITLE_INK_TARGETS,
} from '../lib/ink.js';

const BENCH_ENABLED = process.env.RTA_BENCH === '1';
// Far wider than the row leaves a name, so every screen shows it cut at the line.
const LONG_NAME = 'Maximiliana Alexandra Featherstonehaugh-Worthington of Somewhere';

let session;
let ctx;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  ctx = { heroIndex: 0, libraries: await getLibraries(session) };
});

/** A cold start in `locale` with the clock shown, on Home, with the long name set. The scene
 * reads the name each time it binds a screen, so every screen after this Home shows it. */
async function freshAppWithLongName(locale) {
  const expectedServer = await seedHome(session, locale);
  // null deletes the key. rta-run.js restores the whole registry after the run.
  await odc.writeRegistry({
    values: { [session.userId]: { uiDesignHideClock: null } },
  });
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, `overhang-ink ${locale}`);
  await waitHome();
  await odc.setValue({ base: 'global', keyPath: 'user.name', value: LONG_NAME });
}

it.skipIf(!BENCH_ENABLED)(
  'measures the overhang ink on Home, Settings, Search and a library, in every locale',
  async () => {
    for (const locale of RTA_CONFIG.languages) {
      await freshAppWithLongName(locale);

      await navSettings();
      const settings = await measureOverhangInk(
        `overhang-ink-${locale}-settings`,
        TITLE_INK_TARGETS,
      );
      expect(settings).toHaveLength(TITLE_INK_TARGETS.length);

      // Back leaves Settings for Home, which the scene binds again, now with the long name
      await press(ecp.Key.Back);
      await waitHome();
      const home = await measureOverhangInk(`overhang-ink-${locale}-home`, HOME_INK_TARGETS);
      expect(home).toHaveLength(HOME_INK_TARGETS.length);

      // Home gives focus back to the gear it was left by, so walk the row from there
      await walkOverhangRowTo('searchIcon', { label: 'the search icon from the gear on Home' });
      await press(ecp.Key.Ok);
      await waitFocusInside('#kbd', { label: 'the search keyboard' });
      const search = await measureOverhangInk(`overhang-ink-${locale}-search`, TITLE_INK_TARGETS);
      expect(search).toHaveLength(TITLE_INK_TARGETS.length);

      await freshAppWithLongName(locale);
      await navLibraryGrid(ctx);
      const library = await measureOverhangInk(
        `overhang-ink-${locale}-library`,
        LIBRARY_INK_TARGETS,
      );
      expect(library).toHaveLength(LIBRARY_INK_TARGETS.length);
    }
  },
);
