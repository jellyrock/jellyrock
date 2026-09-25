/**
 * The request-failure switch (`rtaFailRequests`) reaches a real screen end to end: a rule set
 * from here fails the library grid's query, and it fails only as many times as it says, so
 * the next load of the same query goes through. Every failure-path spec builds on this.
 *
 * What the grid shows for the failed load is deliberately asserted only as "no items": what
 * it SHOULD show is the failure-state work that follows, which will assert it there.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { openLibraryByType } from '../lib/nav.js';
import { failRequests } from '../lib/failRequests.js';
import { getActiveVal, press, waitFor } from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];

let session;
let libraries;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session);
});

it('fails the library query once, then lets the reload through', async (testCtx) => {
  const moviesId = libraryIdFor(libraries, 'movies');
  if (!moviesId) testCtx.skip('server has no "movies" library');

  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'fail-requests');

  await failRequests([{ prefix: 'itemQuery_usersItems', kind: 'timeout', times: 1 }]);
  await openLibraryByType('movies', moviesId);

  await waitFor('loadState', (v) => v === 'empty', {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'grid answered by the injected failure',
  });
  expect(await getActiveVal('#itemGrid.content.getChildCount()')).toBe(0);

  // Back out and open it again: the same query, and the rule is spent, so it reaches the
  // server. (Replay is no use here — with focus in the grid it only scrolls to the top.)
  await press(ecp.Key.Back);
  await openLibraryByType('movies', moviesId);
  await waitFor('loadState', (v) => v === 'loaded', {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'grid reloaded past the spent rule',
  });
  expect(await getActiveVal('#itemGrid.content.getChildCount()')).toBeGreaterThan(0);
});
