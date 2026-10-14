/**
 * The search screen on a server that is slow to answer, driven through the request-failure
 * switch's `slow` rule (`rtaFailRequests`). Search keeps its wait on itself
 * (`screenWaits.begin(m.top, "results")`), and the scene shows the waits of the active
 * screen only, so the spinner follows the screen rather than the last call anyone made:
 *
 *  - a slow search says it is still loading, and the text goes with its results;
 *  - Back mid-search takes the spinner with the screen;
 *  - a search answer that lands after the viewer opened a result does not stop the details
 *    screen's own spinner;
 *  - returning to a search that is still loading shows its spinner again, counted from when
 *    the search began rather than from the return.
 *
 * The last three were each measured wrong on a Stick 4K (2026-09-25) before screen waits.
 *
 * Only a SUBMIT opens the wait: typing runs a live search under the open keyboard first
 * (`SearchScreen.onFullSearchDebounceFire`, 0.15 s after the last key) with no spinner, and
 * the submit replaces it. So each search here is two `searchItems` requests, the live one and
 * the submitted one, and each `slow` rule covers both (`times: 2`). The queries are one
 * character, so typing starts exactly one live search.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { navSearch, openSearchKeyboard, submitSearchFromKeyboard } from '../lib/nav.js';
import { failRequests } from '../lib/failRequests.js';
import {
  getActiveVal,
  getGlobalVal,
  getVal,
  hasChildren,
  press,
  sleep,
  waitFocusInside,
  waitFor,
  waitHome,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const STILL_LOADING = 'Still loading…';
// The first stage (loadingStages.STILL_LOADING_MS), and the latest the text may show when it
// counts from the search's start: the stage plus polling and ODC latency.
const STILL_LOADING_MS = 8000;
const STILL_LOADING_LATEST_MS = 11000;

let session;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
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
 * Search, then submit a NEWER query whose answer is held, then open one of the previous
 * query's results, still on screen and reachable because a search keeps the remote live.
 * Leaves the details screen active with the newer search still waiting behind it. Returns
 * the time the submit landed, the latest the search's wait can have begun.
 */
async function openOldResultWhileNewerSearchLoads(rules) {
  await freshApp();
  await navSearch();
  // Up from the first result row reopens the keyboard (SearchScreen.onKeyEvent).
  await press(ecp.Key.Up);
  await waitFocusInside('#kbd', { label: 'back on the search keyboard', timeout: 10000 });
  await failRequests(rules);
  await typeThenSubmit('e');
  const startedAt = Date.now();

  // The submit lands focus on the result rows, which still show the previous query's results.
  await press(ecp.Key.Ok);
  await waitActive('ItemDetails', 'details opened from a previous result');
  return startedAt;
}

it('a slow search says it is still loading, and the text goes with its results', async () => {
  await freshApp();
  await openSearchKeyboard();
  await failRequests([{ prefix: 'searchItems', kind: 'slow', ms: 11000, times: 2 }]);
  await typeThenSubmit(RTA_CONFIG.searchQuery);

  await waitFor('#loadingStageText.text', (v) => v === STILL_LOADING, {
    timeout: 15000,
    interval: 500,
    label: '"Still loading" under the spinner',
  });
  await waitFor('#searchSelect.content.getChildCount()', hasChildren, {
    timeout: 20000,
    label: 'the slow search results',
  });
  await waitFor('#spinner.visible', (v) => v === false, {
    timeout: 5000,
    interval: 250,
    label: 'the spinner gone with the results',
  });
  expect(await getVal('#loadingStageText.visible')).toBe(false);
});

it('Back mid-search takes the spinner with the screen', async () => {
  await freshApp();
  await openSearchKeyboard();
  // Far longer than the spec waits, so only leaving the screen can take the spinner down.
  await failRequests([{ prefix: 'searchItems', kind: 'slow', ms: 90000, times: 2 }]);
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

it("a late search answer does not stop the details screen's spinner", async () => {
  await openOldResultWhileNewerSearchLoads([
    { prefix: 'searchItems', kind: 'slow', ms: 8000, times: 2 },
    { prefix: 'itemMetaData', kind: 'slow', ms: 25000, times: 1 },
  ]);
  await waitHeld(3, "the details screen's metadata is on a slot too");
  await waitHeld(1, 'both searches answered while details still waits', 15000);

  // Timer window, proving a non-event: the search's results reach its (hidden) screen a few
  // round trips after this answer, and must not end the details spinner when they do. No
  // app field reports that a delivery did not happen, so this out-waits it.
  await sleep(3000);
  expect(await getVal('isLoading'), "details' own spinner still up").toBe(true);
  expect(await getVal('isRemoteDisabled'), 'details still blocking while it loads').toBe(true);
});

it('returning to a search that is still loading shows its spinner, counted from the search', async () => {
  const startedAt = await openOldResultWhileNewerSearchLoads([
    { prefix: 'searchItems', kind: 'slow', ms: 25000, times: 2 },
    // Holds the viewer on details long enough that a clock restarted on return could not
    // reach the first stage by STILL_LOADING_LATEST_MS.
    { prefix: 'itemMetaData', kind: 'slow', ms: 4000, times: 1 },
  ]);
  await waitHeld(3, "the details screen's metadata is on a slot too");
  await waitHeld(2, 'details answered; the searches still wait');

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
