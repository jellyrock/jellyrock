/**
 * A library grid on a server that is slow to answer, driven through the request-failure
 * switch's `slow` rule (`rtaFailRequests`), which holds a real answer AND its pool slot:
 *
 *  - backing out while the first page is on a slot gives the slot back at once (apiPool.bs,
 *    "Stopping a request nobody is waiting for") and takes the spinner with it. The slot is
 *    read through `rtaHeldRequests`, the count of held answers;
 *  - a first page slower than an ordinary request's limit still loads (timeouts.GRID_PAGE_MS),
 *    and the spinner says it is still loading, then that the server is slow to answer.
 *
 * The real HTTP cancel behind a stopped slot (roku-requests reading ApiTask's `quit`) cannot
 * be staged against a fast server: an injected slow answer has already arrived. It was checked
 * on device against a slow local server.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { openLibraryByType } from '../lib/nav.js';
import { failRequests } from '../lib/failRequests.js';
import { getActiveVal, getGlobalVal, getVal, press, waitFor, waitHome } from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
// Far longer than the spec waits for the slot to come back, so only a stop can free it.
const HELD_PAGE_MS = 90000;
// Past both text stages (8 s, 30 s) and an ordinary request's wait, inside a grid page's limit.
const SLOW_FIRST_PAGE_MS = 32000;
const STILL_LOADING = 'Still loading…';
const SERVER_SLOW = 'The server is taking a while to answer.';

let session;
let moviesId;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  moviesId = libraryIdFor(await getLibraries(session), 'movies');
});

async function freshApp() {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'slow-library');
}

function waitHeld(count, label) {
  return waitFor('rtaHeldRequests', (v) => v === count, {
    read: getGlobalVal,
    timeout: 10000,
    interval: 250,
    label,
  });
}

function waitLoadState(state, label, timeout = 20000) {
  return waitFor('loadState', (v) => v === state, {
    read: getActiveVal,
    timeout,
    interval: 250,
    label,
  });
}

it('backing out of a slow first page frees its pool slot and its spinner', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await freshApp();
  await failRequests([
    { prefix: 'itemQuery_usersItems', kind: 'slow', ms: HELD_PAGE_MS, times: 1 },
  ]);

  await openLibraryByType('movies', moviesId);
  // On a slot, its answer held. Backing out any sooner can stop the grid before it sends
  // the page (measured on device), leaving nothing on a slot and proving nothing.
  await waitHeld(1, 'the first page is on a pool slot');
  await press(ecp.Key.Back);

  // Given back long before the hold would have let it go.
  await waitHeld(0, 'the slot was given back on Back');
  await waitHome();
  // The grid owned the spinner; closing it mid-load must not leave it over Home.
  expect(await getVal('isLoading'), 'spinner hidden after Back').toBe(false);
});

it('a slow first page says so while it waits, and loads', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await freshApp();
  await failRequests([
    { prefix: 'itemQuery_usersItems', kind: 'slow', ms: SLOW_FIRST_PAGE_MS, times: 1 },
  ]);

  await openLibraryByType('movies', moviesId);
  await waitFor('loadingText', (v) => v === STILL_LOADING, {
    timeout: 15000,
    interval: 500,
    label: '"Still loading" after the first stage',
  });
  await waitFor('loadingText', (v) => v === SERVER_SLOW, {
    timeout: 30000,
    interval: 500,
    label: 'the server is slow, after the second stage',
  });

  // Past the wait an ordinary request gets, so this is the grid page's own limit at work.
  await waitLoadState('loaded', 'the slow first page loaded', 20000);
  expect(await getActiveVal('#itemGrid.content.getChildCount()')).toBeGreaterThan(0);
  expect(await getVal('isLoading')).toBe(false);
  expect(await getVal('loadingText')).toBe('');
});
