/**
 * A library grid loads the rows near the user rather than the whole library (gridPaging,
 * "keep a runway"), counting the library's total once, and says "Loading more" when the user
 * reaches the last loaded row while the next page is on its way.
 *
 * Both specs shrink the page (`rtaGridPageSize`) so the demo server's small Movies library spans
 * several pages. What the demo cannot stage — a library larger than one screen of runway, and
 * "#" titles to page across — is unit-tested in gridPaging / gridPage and measured on device
 * against a large local library.
 */
import { beforeAll, it, expect } from 'vitest';
import { odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { openLibraryByType } from '../lib/nav.js';
import { failRequests } from '../lib/failRequests.js';
import { getActiveVal, waitFor } from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const PAGE_SIZE = 4;
const SLOW_PAGE_MS = 5000;

let session;
let moviesId;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  moviesId = libraryIdFor(await getLibraries(session), 'movies');
});

async function freshApp() {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'grid-paging');
}

/** How many movies the library holds, from the server. */
async function movieCount() {
  const url =
    `${RTA_CONFIG.server.url}/Items?userId=${session.userId}&ParentId=${moviesId}` +
    '&Recursive=true&IncludeItemTypes=Movie&Limit=0';
  const res = await fetch(url, {
    headers: {
      Authorization: `MediaBrowser Client="JellyRock-RTA", Device="rta", DeviceId="${session.deviceId}", Version="1", Token="${session.token}"`,
    },
  });
  return (await res.json()).TotalRecordCount;
}

function waitChildCount(predicate, label) {
  return waitFor(
    '#itemGrid.content.getChildCount()',
    (n) => typeof n === 'number' && predicate(n),
    {
      read: getActiveVal,
      timeout: 30000,
      interval: 250,
      label,
    },
  );
}

it('pages a small library to its end, the total counted on the first page only', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  const total = await movieCount();
  if (total <= PAGE_SIZE * 2) testCtx.skip(`needs more than ${PAGE_SIZE * 2} movies, has ${total}`);
  await freshApp();
  await odc.setValue({ base: 'global', keyPath: 'rtaGridPageSize', value: PAGE_SIZE });

  // A small library fits in one screen of runway, so every page loads without a key press.
  // Pages after the first ask without a count, and their reply's total is only the page's
  // size: had the grid taken it, it would stop after page 2.
  await openLibraryByType('movies', moviesId);
  await waitChildCount((n) => n === total, 'grid loaded every movie');
});

it('says "Loading more" while the next page is slow, and hides it when the page lands', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await freshApp();
  await odc.setValue({ base: 'global', keyPath: 'rtaGridPageSize', value: PAGE_SIZE });
  // Page 2, slowed: page 1 fills only the first row, so focus is already on the last loaded row.
  await failRequests([
    { prefix: 'itemQuery_usersItems', kind: 'slow', ms: SLOW_PAGE_MS, times: 1, after: 1 },
  ]);

  await openLibraryByType('movies', moviesId);
  await waitFor('#loadingMore.isShown', (v) => v === true, {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: '"Loading more" shown while page 2 is slow',
  });
  expect(await getActiveVal('#itemGrid.content.getChildCount()')).toBe(PAGE_SIZE);

  await waitChildCount((n) => n > PAGE_SIZE, 'page 2 landed');
  await waitFor('#loadingMore.isShown', (v) => v === false, {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: '"Loading more" hidden once the page landed',
  });
});
