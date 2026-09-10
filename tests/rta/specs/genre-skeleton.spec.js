/**
 * Genres-view skeleton window: the interactive stage between "structure drawn"
 * and "samples landed" (PR #779). The window is a few hundred ms against the demo
 * server, so this spec widens it deterministically via the RTA-only
 * `rtaSkeletonHoldMs` global (compiled in only under ENABLE_RTA — the flag every
 * RTA deploy flips) instead of racing real latency.
 *
 * What must hold while skeletons are up, and across the fill:
 *  1. loadState reaches "skeleton" (the stage exists and is observable),
 *  2. OK on a skeleton placeholder is a no-op (no navigation off the Genres view),
 *  3. the user's scroll position survives the content swap (skeleton and real rows
 *     are 1:1 in server order — revealGenreList restores [row, item]),
 *  4. row count and row titles are identical across the swap (the 1:1 contract),
 *  5. the backdrop lands on the focused row's item after the fill — the RowList
 *     re-dispatches rowItemFocused when content is replaced (verified on hardware
 *     2026-08-07 with the child-mutation reveal; this guards the single-swap
 *     reveal against regressing that re-dispatch).
 */
import { beforeAll, it, expect } from 'vitest';
import { odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor, getJson, tokenHeader } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch, ecp } from '../lib/driver.js';
import { openLibraryByType } from '../lib/nav.js';
import { getVal, getActiveVal, waitFor, press, scrollFocus, sleep } from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const HOLD_MS = 5000;

let session;
let libraries;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session);
});

it('genre skeleton window: select is a no-op, scroll survives the fill, backdrop lands', async (testCtx) => {
  const moviesId = libraryIdFor(libraries, 'movies');
  if (!moviesId) testCtx.skip('server has no "movies" library');

  // Content pre-check (per tests/rta/CLAUDE.md): the skeleton stage only exists when
  // the server actually has movie genres — otherwise this would time out, not verify.
  const genres = await getJson(
    `${session.serverUrl}/Genres?userId=${session.userId}&parentId=${moviesId}&includeItemTypes=Movie`,
    tokenHeader(session.token),
  ).catch(() => null);
  const genreCount = genres?.Items?.length ?? 0;
  if (!genreCount) testCtx.skip('server has no movie genres');
  // 3+ specifically, because `targetRow` below is 2. Under that the scroll loop's
  // predicate is satisfied without pressing Down even once, and the post-fill check
  // (`focusAfter[0] === rowBeforeFill`) then passes for free — a content swap lands on
  // row 0 regardless. The spec would go GREEN while verifying nothing about position
  // restore, which is the silent-no-op failure tests/rta/CLAUDE.md warns about. The demo
  // server has 14 today, but its metadata is rebuilt hourly, so this is not a given.
  if (genreCount < 3)
    testCtx.skip(`needs 3+ movie genres to exercise scroll restore, has ${genreCount}`);

  const expectedServer = await seedHome(session, LOCALE);
  await seedLibraryLanding(session, moviesId, 'Genres');
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'genre-skeleton');

  // Widen the skeleton window BEFORE the genre load starts. App-memory only — the
  // next relaunch resets it, so no restore step is needed.
  await odc.setValue({ base: 'global', keyPath: 'rtaSkeletonHoldMs', value: HOLD_MS });

  await openLibraryByType('movies', moviesId); // presses OK, does NOT wait for loaded

  // (1) The skeleton stage is reachable and observable.
  await waitFor('loadState', (v) => v === 'skeleton', {
    read: getActiveVal,
    interval: 250,
    label: 'Genres view skeleton stage',
  });

  const skeletonRows = await getVal('#genreList.content.getChildCount()');
  // Re-assert the pre-check's 3+ against what the APP drew: its genre query carries a
  // `limit` the pre-check's bare REST call does not, so a server count is only a proxy.
  expect(skeletonRows).toBeGreaterThanOrEqual(3);
  const skeletonTitles = [];
  for (let r = 0; r < skeletonRows; r++) {
    skeletonTitles.push(await getVal(`#genreList.content.${r}.title`));
  }

  // (2) OK on a skeleton is ignored — still on the Genres view, still in skeleton.
  await press(ecp.Key.Ok);
  await sleep(800);
  expect(await getActiveVal('currentView')).toBe('Genres');
  expect(await getActiveVal('loadState')).toBe('skeleton');

  // (3) Scroll down while skeletons are up (bounded by the row count).
  //
  // `scrollFocus` rather than a press-per-tick loop, because the position recorded here
  // has to be the SETTLED one — the assertion below compares it against the position
  // after the fill, so a key still in flight when it is read fails a test the app passed.
  // The old loop pressed once per poll without knowing how many presses were already in
  // flight, so it could overshoot by a row, and it covered that with a fixed 600 ms dwell
  // before reading. `scrollFocus` removes the cause instead of out-waiting it: it sends
  // exactly the distance as one burst and only ever presses again for a key it can prove
  // was DROPPED (the index observed unchanged across a tick), which is why its returned
  // `to` is an index that has stopped moving rather than one sampled mid-flight.
  //
  // The budget is deliberately short. Everything here happens inside the 5 s
  // `rtaSkeletonHoldMs` window, and a walk that outlives the hold would be read after the
  // fill — failing later, on the position assertion, with nothing pointing at the walk.
  // Timing out here instead names the step that actually ran long.
  const targetRow = Math.min(2, skeletonRows - 1);
  const walk = await scrollFocus({
    keyPath: '#genreList.rowItemFocused',
    target: targetRow,
    forwardKey: ecp.Key.Down,
    // Supplied for the corrective press only. The burst cannot overshoot (it sends the
    // exact distance), but without a back key an overshoot would press `null`; a walk
    // that can correct in both directions fails as a timeout rather than as a TypeError.
    backKey: ecp.Key.Up,
    select: (v) => (Array.isArray(v) ? v[0] : undefined),
    label: `skeleton scroll to row ${targetRow}`,
    timeout: 2500,
  });
  const rowBeforeFill = walk.to;
  expect(rowBeforeFill).toBe(targetRow);

  // The fill: hold expires, samples land, revealGenreList swaps content.
  await waitFor('loadState', (v) => v === 'loaded', {
    read: getActiveVal,
    timeout: 40000,
    label: 'Genres view real rows',
  });

  // (3) Scroll position survived the swap.
  const focusAfter = await getVal('#genreList.rowItemFocused');
  expect(focusAfter?.[0]).toBe(rowBeforeFill);

  // (4) Same rows, same order — the 1:1 contract the position restore relies on.
  expect(await getVal('#genreList.content.getChildCount()')).toBe(skeletonRows);
  for (let r = 0; r < skeletonRows; r++) {
    expect(await getVal(`#genreList.content.${r}.title`)).toBe(skeletonTitles[r]);
  }

  // (5) The backdrop lands on the focused row's item (re-dispatch across the swap).
  const focusedItemId = await getVal(`#genreList.content.${rowBeforeFill}.0.id`);
  expect(focusedItemId).toBeTruthy();
  await waitFor('#imageFader.uri', (u) => typeof u === 'string' && u.includes(focusedItemId), {
    timeout: 8000,
    interval: 500,
    label: 'backdrop for focused genre item',
  });
});
