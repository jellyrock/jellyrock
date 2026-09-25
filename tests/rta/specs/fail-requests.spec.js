/**
 * A library grid whose server does not answer says so and recovers, driven through the
 * request-failure switch (`rtaFailRequests`) against a healthy server:
 *
 *  - the first page failing shows the failure state with Try again focused, and pressing it
 *    loads the grid;
 *  - the "#" letter filter with its first query failing shows the same state — before, the
 *    task went on to its second query and faulted on the failed first reply;
 *  - a later page failing keeps what is on screen, says so once, and moving through the grid
 *    asks again.
 *
 * The later-page case sets `rtaGridPageSize` so the demo server's small Movies library spans
 * several pages, and uses the rule's `after` to let page 1 through: page 2 follows page 1
 * too closely for a rule set in between.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { openLibraryByType } from '../lib/nav.js';
import { failRequests } from '../lib/failRequests.js';
import {
  getActiveVal,
  getVal,
  press,
  waitFor,
  waitFocusInside,
  walkFocusInto,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const PAGE_SIZE = 4;

let session;
let moviesId;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  moviesId = libraryIdFor(await getLibraries(session), 'movies');
});

async function freshApp() {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'fail-requests');
}

function waitLoadState(state, label) {
  return waitFor('loadState', (v) => v === state, {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label,
  });
}

it('a failed first page shows Try again, and pressing it loads the grid', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await freshApp();

  await failRequests([{ prefix: 'itemQuery_usersItems', kind: 'timeout', times: 1 }]);
  await openLibraryByType('movies', moviesId);

  await waitLoadState('failed', 'grid showed its failure state');
  await waitFocusInside('#retryButton', { label: 'Try again focused' });
  expect(await getActiveVal('#loadFailed.visible')).toBe(true);
  expect(await getActiveVal('#emptyText.visible')).toBe(false);

  // The rule is spent, so this reload reaches the server.
  await press(ecp.Key.Ok);
  await waitLoadState('loaded', 'grid loaded after Try again');
  expect(await getActiveVal('#itemGrid.content.getChildCount()')).toBeGreaterThan(0);
  expect(await getActiveVal('#loadFailed.visible')).toBe(false);
});

it('the "#" filter with its first query failing shows the failure state', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await freshApp();
  await openLibraryByType('movies', moviesId);
  await waitLoadState('loaded', 'grid loaded');

  // The alpha menu opens on "#". Fail only its first query: the second would answer, and
  // the task used to append that answer to the failed first one.
  await waitFocusInside('#alphaMenu', { action: walkFocusInto(ecp.Key.Left, '#alphaMenu') });
  await failRequests([{ prefix: 'itemQuery_usersItems', kind: 'timeout', times: 1 }]);
  await press(ecp.Key.Ok);

  await waitLoadState('failed', '"#" load showed its failure state');
  expect(await getActiveVal('#loadFailed.visible')).toBe(true);
});

it('a failed later page keeps the grid, says so once, and moving through the grid asks again', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await freshApp();
  await odc.setValue({ base: 'global', keyPath: 'rtaGridPageSize', value: PAGE_SIZE });
  await failRequests([{ prefix: 'itemQuery_usersItems', kind: 'timeout', times: 1, after: 1 }]);

  await openLibraryByType('movies', moviesId);
  await waitLoadState('loaded', 'first page loaded');
  await waitFor('#toast.message', (v) => typeof v === 'string' && v !== '', {
    read: getVal,
    timeout: 20000,
    interval: 250,
    label: 'later-page failure toast',
  });
  const total = await getActiveVal('#itemGrid.content.getChildCount()');
  expect(total).toBe(PAGE_SIZE);
  expect(await getActiveVal('loadState')).toBe('loaded');

  // Any focus move in the grid's last rows asks for the next page; the rule is spent.
  await waitFocusInside('#itemGrid', { label: 'grid focused' });
  await press(ecp.Key.Right);
  await waitFor(
    '#itemGrid.content.getChildCount()',
    (n) => typeof n === 'number' && n > PAGE_SIZE,
    {
      read: getActiveVal,
      timeout: 20000,
      interval: 250,
      label: 'grid loaded past the failed page',
    },
  );
});
