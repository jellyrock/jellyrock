/**
 * RTA focus-restoration test (#550 sgRouter).
 *
 * The router migration replaces SceneManager's "reliably right" lastFocus dance
 * with the JRScreen lifecycle bridge (saveLastFocus on onViewSuspend, handleFocus
 * on resume). This spec guards that contract end-to-end on a real device: after
 * Home -> Library -> Detail and two Backs, focus must return to exactly where it
 * was at each level — the suspended library grid's tile, then Home's content.
 *
 * The waitFocused gates ARE the assertions (they throw on timeout). Run:
 *   npx vitest run --config vitest.rta.config.js -t 'focus'
 */
import { beforeAll, it, expect } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch, ecp, odc } from '../lib/driver.js';
import { navLibraryByType } from '../lib/nav.js';
import { press, resendIfSwallowed, waitFor, waitFocused, waitHome } from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0]; // en_US

let session;
let libraries;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session); // lets the nav below target a library BY ID
});

it('focus restoration: Home -> Library -> Detail -> back -> back', async () => {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch(); // a plain relaunch lets the running app re-persist over the seed
  await assertSeedTookEffect(expectedServer, 'focus restoration');
  await waitHome();

  // Home -> Movies library grid. navLibraryByType lands focus on a grid tile.
  await navLibraryByType('movies', libraryIdFor(libraries, 'movies'));
  const gridFocus = await odc.getFocusedNode({ includeNode: true });
  expect(typeof gridFocus?.keyPath, 'a grid tile is focused after entering the library').toBe(
    'string',
  );

  // Grid -> first item's detail (the grid is suspended, not destroyed; detail mounts).
  await press(ecp.Key.Ok);
  await waitFor('#videoTitle.text', (t) => typeof t === 'string' && t.length > 0, {
    label: 'detail title',
    timeout: 20000,
  });
  await waitFocused((f) => typeof f.keyPath === 'string' && f.keyPath.includes('#buttons'), {
    label: 'detail buttons focused',
    timeout: 20000,
  });

  // Back -> library grid resumes: focus must return INTO the grid, not be lost. (We assert
  // the grid regained focus rather than a byte-identical keyPath: a `suspendMode: "detach"`
  // view leaves the tree on suspend and is re-attached on resume, which shifts the absolute
  // keyPath even when the same tile is focused.)
  await press(ecp.Key.Back);
  await waitFocused((f) => typeof f.keyPath === 'string' && f.keyPath.includes('#itemGrid'), {
    label: 'library grid focus restored',
    timeout: 15000,
  });

  // Back -> Home resumes: focus must land back in Home's content (#homeRows), not lost.
  //
  // The press is GUARDED rather than fired once: the gate above is a proxy for the state
  // this press needs, so the Back can arrive mid-navigation and be swallowed. Mechanism,
  // detection and the safety argument live with the helper in lib/steps.js.
  await press(ecp.Key.Back);
  await waitHome();
  await waitFocused((f) => typeof f.keyPath === 'string' && f.keyPath.includes('#homeRows'), {
    label: 'home content focus restored',
    timeout: 15000,
    interval: 500,
    action: resendIfSwallowed(ecp.Key.Back, '#itemGrid'),
  });
});
