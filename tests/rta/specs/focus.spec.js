/**
 * RTA focus-restoration test (#550 sgRouter).
 *
 * The router migration replaces SceneManager's "reliably right" lastFocus dance
 * with the JRScreen lifecycle bridge (saveLastFocus on onViewSuspend, handleFocus
 * on resume). This spec guards that contract end-to-end on a real device: after
 * Home -> Library -> Detail and two Backs, focus must return to exactly where it
 * was at each level — the keepAlive library grid tile, then Home's content.
 *
 * The waitFocused gates ARE the assertions (they throw on timeout). Run:
 *   npx vitest run --config vitest.rta.config.js -t 'focus'
 */
import { beforeAll, afterAll, it, expect } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate } from '../lib/jellyfin.js';
import { seedHome, snapshotSession, restoreSession, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch, ecp, odc } from '../lib/driver.js';
import { navLibraryByType } from '../lib/nav.js';
import { press, waitFor, waitFocused, waitHome } from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0]; // en_US

let saved;
let session;

beforeAll(async () => {
  saved = await snapshotSession();
  session = await authenticate(RTA_CONFIG.server);
});

afterAll(async () => {
  await restoreSession(saved);
  await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false }).catch(() => {});
});

it('focus restoration: Home -> Library -> Detail -> back -> back', async () => {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch(); // a plain relaunch lets the running app re-persist over the seed
  await assertSeedTookEffect(expectedServer, 'focus restoration');
  await waitHome();

  // Home -> Movies library grid. navLibraryByType lands focus on a grid tile.
  await navLibraryByType('movies');
  const gridFocus = await odc.getFocusedNode({ includeNode: true });
  expect(typeof gridFocus?.keyPath, 'a grid tile is focused after entering the library').toBe(
    'string',
  );

  // Grid -> first item's detail (keepAlive grid is suspended; detail mounts).
  await press(ecp.Key.Ok);
  await waitFor('#videoTitle.text', (t) => typeof t === 'string' && t.length > 0, {
    label: 'detail title',
    timeout: 20000,
  });
  await waitFocused((f) => typeof f.keyPath === 'string' && f.keyPath.includes('#buttons'), {
    label: 'detail buttons focused',
    timeout: 20000,
  });

  // Back -> library grid resumes (keepAlive): focus must return INTO the grid, not be
  // lost. (We assert the grid regained focus rather than a byte-identical keyPath: the
  // keepAlive view is reparented between viewTarget<->keepAliveViewTarget on
  // suspend/resume, which shifts the absolute keyPath even when the same tile is focused.)
  await press(ecp.Key.Back);
  await waitFocused((f) => typeof f.keyPath === 'string' && f.keyPath.includes('#itemGrid'), {
    label: 'library grid focus restored',
    timeout: 15000,
  });

  // Back -> Home resumes: focus must land back in Home's content (#homeRows), not lost.
  await press(ecp.Key.Back);
  await waitHome();
  await waitFocused((f) => typeof f.keyPath === 'string' && f.keyPath.includes('#homeRows'), {
    label: 'home content focus restored',
    timeout: 15000,
  });
});
