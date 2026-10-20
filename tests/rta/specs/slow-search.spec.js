/**
 * The search screen on a server that is slow to answer, driven through the request-failure
 * switch's `slow` rule (`rtaFailRequests`). Search keeps its wait on itself
 * (`screenWaits.begin(m.top, "results")`), and the scene shows the waits of the active
 * screen only, so the spinner follows the screen rather than the last call anyone made:
 *
 *  - a slow search says it is still loading, and the text goes with its results;
 *  - Back mid-search takes the spinner with the screen;
 *  - a search answer that lands after a deep link opened a library grid over it does not
 *    stop the grid's own spinner;
 *  - returning to a search that is still loading shows its spinner again, counted from when
 *    the search began rather than from the return.
 *
 * The last three were each measured wrong on a Stick 4K (2026-09-25) before screen waits.
 *
 * Only a SUBMIT opens the wait: typing runs a live search under the open keyboard first
 * (`SearchScreen.onFullSearchDebounceFire`, 0.15 s after the last key) with no spinner, and
 * the submit replaces it. Each search sends one read per library type, side by side, and
 * waits for all of them (`SearchTask.searchMedia`), so slowing its Movie read alone holds the
 * whole search. Each `slow` rule names that read (SLOW_READ): one request per search, so the
 * live search and the submitted one are two, `times: 2`, and the held counts stay exact. The
 * queries are one character, so typing starts exactly one live search.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getHero, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import {
  openSearchKeyboard,
  SKELETON_TYPE,
  submitSearchFromKeyboard,
  waitSearchResults,
} from '../lib/nav.js';
import { failRequests } from '../lib/failRequests.js';
import {
  getActiveVal,
  getActiveVals,
  getGlobalVal,
  getVal,
  press,
  sleep,
  waitFor,
  waitHome,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
// The one read per search the `slow` rules hold: the search's Movie read, which every search sends.
const SLOW_READ = 'searchItemsMovie';
const STILL_LOADING = 'Still loading…';
// The first stage (loadingStages.STILL_LOADING_MS), and the latest the text may show when it
// counts from the search's start: the stage plus polling and ODC latency.
const STILL_LOADING_MS = 8000;
const STILL_LOADING_LATEST_MS = 11000;

let session;

let heroId; // a Movie: a details deep link
let moviesLibraryId; // a CollectionFolder: a library deep link

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  heroId = (await getHero(session)).id;
  moviesLibraryId = libraryIdFor(await getLibraries(session), 'movies');
  if (!heroId || !moviesLibraryId) {
    throw new Error(
      'slow-search setup: could not resolve a movie and a movies library on the demo server',
    );
  }
});

async function freshApp() {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'slow-search');
}

function waitHeld(count, label, timeout = 10000) {
  return waitFor('rtaHeldRequests', (v) => v === count, {
    read: getGlobalVal,
    timeout,
    interval: 250,
    label,
  });
}

function waitActive(subtype, label) {
  return waitFor('subtype()', (v) => v === subtype, {
    read: getActiveVal,
    timeout: 15000,
    interval: 250,
    label,
  });
}

/**
 * Type `text` into the focused search keyboard, wait for its live search to reach a pool slot,
 * then submit: the submitted search is the one whose wait the spinner shows. `heldBefore` is
 * how many requests were already held, so the counts stay exact.
 */
async function typeThenSubmit(text, heldBefore = 0) {
  await ecp.sendText(text);
  await waitHeld(heldBefore + 1, 'the live search is on a pool slot');
  await submitSearchFromKeyboard();
  await waitHeld(heldBefore + 2, 'the submitted search is on a pool slot');
}

/**
 * Submit a search whose answer is held, then cover the search screen with a runtime deep link
 * (ECP `/input?contentId=…`, deeplink.spec.js) while it still loads. Its rows are skeleton
 * tiles until it answers (SearchScreen.runFullSearch), so a deep link is the way a viewer can
 * open another screen over a search in flight. Returns the time the submit landed, the latest
 * the search's wait can have begun.
 */
async function coverSearchWhileItLoads(rules, contentId) {
  await freshApp();
  await openSearchKeyboard();
  await failRequests(rules);
  await typeThenSubmit('e');
  const startedAt = Date.now();
  await ecp.sendInput({ params: { contentId } });
  return startedAt;
}

it('a slow search says it is still loading, and the text goes with its results', async () => {
  await freshApp();
  await openSearchKeyboard();
  await failRequests([{ prefix: SLOW_READ, kind: 'slow', ms: 11000, times: 2 }]);
  await typeThenSubmit(RTA_CONFIG.searchQuery);

  await waitFor('#loadingStageText.text', (v) => v === STILL_LOADING, {
    timeout: 15000,
    interval: 500,
    label: '"Still loading" under the spinner',
  });
  await waitSearchResults({ label: 'the slow search results' });
  await waitFor('#spinner.visible', (v) => v === false, {
    timeout: 5000,
    interval: 250,
    label: 'the spinner gone with the results',
  });
  expect(await getVal('#loadingStageText.visible')).toBe(false);
});

it('a slow search shows a skeleton row for each read, then its results', async () => {
  await freshApp();
  await openSearchKeyboard();
  await failRequests([{ prefix: SLOW_READ, kind: 'slow', ms: 11000, times: 2 }]);
  await typeThenSubmit(RTA_CONFIG.searchQuery);

  // SearchScreen.runFullSearch: one titled row per read (searchOutcome.rowTypes), each a
  // loading tile, until the held read answers. Movies come first in the result order.
  const [firstTile, firstTitle, skeletonRows] = await getActiveVals([
    '#searchSelect.content.0.0.type',
    '#searchSelect.content.0.title',
    '#searchSelect.content.getChildCount()',
  ]);
  expect(firstTile, 'a skeleton tile while the search is held').toBe(SKELETON_TYPE);
  expect(firstTitle, 'the first row is titled').toBe('Movies');
  // 15 row types read with Live TV access, 14 without (searchOutcome.spec.bs pins the list).
  expect(skeletonRows, 'a row for each read').toBeGreaterThanOrEqual(14);

  // OK on a skeleton tile goes nowhere: it is not a result.
  await press(ecp.Key.Ok);
  const rows = await waitSearchResults({ label: 'the slow search results' });
  expect(rows, 'only the types that found something keep a row').toBeLessThan(skeletonRows);
  const [view, expanded] = await getActiveVals(['subtype()', 'isExpanded']);
  expect(view, 'still on the search screen').toBe('SearchScreen');
  expect(expanded, 'the OK did not reopen the keyboard either').toBe(false);
});

it('Back mid-search takes the spinner with the screen', async () => {
  await freshApp();
  await openSearchKeyboard();
  // Far longer than the spec waits, so only leaving the screen can take the spinner down.
  await failRequests([{ prefix: SLOW_READ, kind: 'slow', ms: 90000, times: 2 }]);
  await typeThenSubmit(RTA_CONFIG.searchQuery);
  expect(await getVal('#spinner.visible'), 'spinner up while the search waits').toBe(true);

  await press(ecp.Key.Back);
  await waitHome();
  await waitFor('#spinner.visible', (v) => v === false, {
    timeout: 5000,
    interval: 250,
    label: 'no spinner over Home once search closed',
  });
  expect(await getVal('#loadingStageText.visible')).toBe(false);
});

it("a late search answer does not stop the library grid's spinner", async () => {
  // A library deep link opens its grid, which loads its own items under the scene spinner.
  // (A details deep link would not do: details takes the item the deep link fetched and loads
  // nothing of its own, so it has no spinner a late answer could stop.)
  await coverSearchWhileItLoads(
    [
      { prefix: SLOW_READ, kind: 'slow', ms: 8000, times: 2 },
      { prefix: 'itemQuery_', kind: 'slow', ms: 25000, times: 1 },
    ],
    moviesLibraryId,
  );
  await waitActive('BaseGridView', 'the library grid opened over the search');
  await waitHeld(3, "the grid's items are on a slot too");
  await waitHeld(1, 'both searches answered while the grid still waits', 15000);

  // Timer window, proving a non-event: the search's results reach its (hidden) screen a few
  // round trips after this answer, and must not end the details spinner when they do. No
  // app field reports that a delivery did not happen, so this out-waits it.
  await sleep(3000);
  expect(await getVal('isLoading'), "the grid's own spinner still up").toBe(true);
});

it('returning to a search that is still loading shows its spinner, counted from the search', async () => {
  const startedAt = await coverSearchWhileItLoads(
    [
      { prefix: SLOW_READ, kind: 'slow', ms: 25000, times: 2 },
      // Holds the deep link's item fetch long enough that a clock restarted on return could
      // not reach the first stage by STILL_LOADING_LATEST_MS.
      { prefix: 'itemMetaData', kind: 'slow', ms: 4000, times: 1 },
    ],
    heroId,
  );
  await waitHeld(3, "the deep link's item fetch is on a slot too");
  await waitHeld(2, 'the item answered; the searches still wait');
  // Back while the deep link still resolves would cancel it rather than leave details.
  await waitActive('ItemDetails', 'details opened over the search');

  await press(ecp.Key.Back);
  await waitActive('SearchScreen', 'back on the search that is still loading');
  const returnedMs = Date.now() - startedAt;
  // The journey this test depends on: without it, restart and continue look alike.
  expect(returnedMs, 'return late enough to tell the two clocks apart').toBeGreaterThan(
    STILL_LOADING_LATEST_MS - STILL_LOADING_MS,
  );

  await waitFor('#spinner.visible', (v) => v === true, {
    timeout: 5000,
    interval: 250,
    label: "the search's spinner back with its screen",
  });
  await waitFor('#loadingStageText.text', (v) => v === STILL_LOADING, {
    timeout: 15000,
    interval: 250,
    label: '"Still loading" for the search',
  });
  // startedAt is when the submit landed, at or after the wait began, so this bound is the
  // strict one: a clock that kept counting meets it, one restarted on return cannot.
  expect(Date.now() - startedAt, 'stage counted from the search, not the return').toBeLessThan(
    STILL_LOADING_LATEST_MS,
  );
});
