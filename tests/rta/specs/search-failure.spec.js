/**
 * A search that failed never reads as one that found nothing, driven through the
 * request-failure switch (`rtaFailRequests`) against a healthy server:
 *
 *  - every read failed: the results area says so with a Try again, the keyboard keeps focus,
 *    and Try again runs the same search again;
 *  - some reads failed: what answered shows, and a toast says some results are missing;
 *  - every read answered empty: the screen says there are no results;
 *  - typing on after a failure clears it.
 *
 * The search ids all start with `search` (`SearchTask.searchMedia`); the demo user has Live
 * TV access, so a search sends all four reads.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { openSearchKeyboard } from '../lib/nav.js';
import { failRequests } from '../lib/failRequests.js';
import {
  getActiveVal,
  hasChildren,
  press,
  waitFocused,
  waitFocusInside,
  waitFor,
  waitToast,
  walkFocusUntil,
} from '../lib/steps.js';
import { captureRawUI } from '../capture.js';

const LOCALE = RTA_CONFIG.languages[0];
const SEARCH_FAILED = "Couldn't load search results.";
const SEARCH_PARTIAL = "Some results couldn't load.";
const SEARCH_EMPTY = 'No results.';
const EVERY_READ = 4;
// RTA_CAPTURE=1 also saves each state to out/rta-captures/ for review.
const CAPTURE = process.env.RTA_CAPTURE === '1';

let session;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
});

async function freshSearch() {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'search-failure');
  await openSearchKeyboard();
}

/** Types the query with every read of its search failing, and waits for the failure state. */
async function failedSearch() {
  await failRequests([{ prefix: 'search', kind: 'http', status: 500, times: EVERY_READ }]);
  await ecp.sendText(RTA_CONFIG.searchQuery);
  // On `visible`, not the text: the text is set when the screen opens, so a wait on it would
  // pass before the search ran.
  await waitFor('#searchFailed.visible', (v) => v === true, {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'the failed search state',
  });
  expect(await getActiveVal('#searchFailedText.text'), 'the failure message').toBe(SEARCH_FAILED);
}

it('a failed search says so, keeps the keyboard, and Try again runs it again', async () => {
  await freshSearch();
  await failedSearch();
  expect(await getActiveVal('#searchSelect.content.getChildCount()'), 'no result rows').toBe(0);
  await waitFocusInside('#searchKey', { label: 'the keyboard kept focus', timeout: 5000 });

  const atRetry = (f) => f?.node?.id === 'searchRetryButton';
  await waitFocused(atRetry, {
    timeout: 12000,
    interval: 350,
    action: walkFocusUntil(ecp.Key.Right, atRetry),
    label: 'Try again, right of the keyboard',
  });
  if (CAPTURE) await captureRawUI('searchFailed');
  await press(ecp.Key.Ok);
  await waitFor('#searchSelect.content.getChildCount()', hasChildren, {
    read: getActiveVal,
    timeout: 20000,
    label: 'the results of the search run again',
  });
  expect(await getActiveVal('#searchFailed.visible'), 'the failure state is gone').toBe(false);
});

it('a search with one failed read shows what answered and says some is missing', async () => {
  await freshSearch();
  await failRequests([{ prefix: 'searchPersons', kind: 'http', status: 500, times: 1 }]);
  await ecp.sendText(RTA_CONFIG.searchQuery);
  await waitFor('#searchSelect.content.getChildCount()', hasChildren, {
    read: getActiveVal,
    timeout: 20000,
    label: 'the results that answered',
  });
  await waitToast(SEARCH_PARTIAL, { label: 'the some-results-missing toast' });
  if (CAPTURE) await captureRawUI('searchPartial');
  expect(await getActiveVal('#searchFailed.visible'), 'not the failure state').toBe(false);
});

it('a search that finds nothing says so', async () => {
  await freshSearch();
  await failRequests([{ prefix: 'search', kind: 'empty' }]);
  await ecp.sendText(RTA_CONFIG.searchQuery);
  await waitFor('#SearchHelpText.text', (v) => v === SEARCH_EMPTY, {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'the no-results message',
  });
  expect(await getActiveVal('#SearchHelpText.visible'), 'the message shows').toBe(true);
  if (CAPTURE) await captureRawUI('searchNoResults');
  expect(await getActiveVal('#searchFailed.visible'), 'not the failure state').toBe(false);
});

it('typing on after a failed search clears the failure', async () => {
  await freshSearch();
  await failedSearch();
  await ecp.sendText('e');
  await waitFor('#searchFailed.visible', (v) => v === false, {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'the failure state gone once the query changed',
  });
});
