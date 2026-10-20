/**
 * A search that failed never reads as one that found nothing, driven through the
 * request-failure switch (`rtaFailRequests`) against a healthy server:
 *
 *  - every read failed: the results area says so with a Try again, which takes focus, and
 *    Try again runs the same search again;
 *  - some reads failed: what answered shows, and a toast says some results are missing;
 *  - every read answered empty: the screen says there are no results for the query;
 *  - typing on after a failure clears it.
 *
 * Only a SUBMITTED search reports its outcome (decision search-outcome-on-submit-only): the live
 * search that runs while typing stays quiet. So each case types, then submits. A submit replaces the live search partway
 * through its reads, so how many reads the live one sent varies; the rules here therefore
 * cover every matching read (no `times`) and are cleared before a retry.
 *
 * The search ids all start with `search` (`SearchTask.searchMedia`).
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { openSearchKeyboard, submitSearchFromKeyboard, waitSearchResults } from '../lib/nav.js';
import { failRequests } from '../lib/failRequests.js';
import {
  getActiveVal,
  getActiveVals,
  press,
  waitFocused,
  waitFocusInside,
  waitFor,
  waitToast,
} from '../lib/steps.js';
import { captureRawUI } from '../capture.js';

const LOCALE = RTA_CONFIG.languages[0];
const SEARCH_FAILED = "Couldn't load search results.";
const SEARCH_PARTIAL = "Some results couldn't load.";
const SEARCH_EMPTY = `No results for "${RTA_CONFIG.searchQuery}"`;
const SEARCH_HELP = 'You can search for Titles, People, Live TV Channels and more';
// RTA_CAPTURE=1 also saves each state to out/rta-captures/ for review.
const CAPTURE = process.env.RTA_CAPTURE === '1';

const atRetry = (f) => f?.node?.id === 'searchRetryButton';

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

/** Types and submits the query with every read failing, and waits for the failure state. */
async function failedSearch() {
  await failRequests([{ prefix: 'search', kind: 'http', status: 500 }]);
  await ecp.sendText(RTA_CONFIG.searchQuery);
  // The submit collapses onto the rows first; the failure then hands focus to Try again.
  await submitSearchFromKeyboard({
    arrived: (f) => atRetry(f) || f?.node?.id === 'searchSelect',
    label: 'the submit left the keyboard',
  });
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

it('a failed search says so, takes focus to Try again, and Try again runs it again', async () => {
  await freshSearch();
  await failedSearch();
  expect(await getActiveVal('#searchSelect.content.getChildCount()'), 'no result rows').toBe(0);
  await waitFocused(atRetry, { timeout: 5000, interval: 250, label: 'Try again took focus' });
  if (CAPTURE) await captureRawUI('searchFailed');

  await failRequests([]);
  await press(ecp.Key.Ok);
  await waitSearchResults({ label: 'the results of the search run again' });
  expect(await getActiveVal('#searchFailed.visible'), 'the failure state is gone').toBe(false);
});

// timeouts.HTTP_MS: how long roku-requests waits before it gives a request up.
const HTTP_MS = 10000;
// A search's reads share one budget (timeouts.PIPELINE_RUN_MS, 20 s), so on a dead server the
// failure shows once it runs out, plus the time to hand back and draw. The headroom is for a
// slower device; reads waiting their turn one after another would take several HTTP_MS.
const DEAD_SERVER_LIMIT_MS = 25000;

it('a search on a server that never answers shows the failure in time', async () => {
  await freshSearch();
  // Every search read, hints included, holds its pool slot until the HTTP layer gives up,
  // then answers as a timeout: a server that accepts the connection and never replies.
  await failRequests([{ prefix: 'search', kind: 'timeout', ms: HTTP_MS }]);
  await ecp.sendText(RTA_CONFIG.searchQuery);
  const submittedAt = Date.now();
  await submitSearchFromKeyboard({
    arrived: (f) => atRetry(f) || f?.node?.id === 'searchSelect',
    label: 'the submit left the keyboard',
  });
  await waitFor('#searchFailed.visible', (v) => v === true, {
    read: getActiveVal,
    timeout: DEAD_SERVER_LIMIT_MS,
    interval: 250,
    label: 'the failed search state on a server that never answers',
  });
  const elapsedMs = Date.now() - submittedAt;
  console.log(`[dead-server] failure shown ${elapsedMs} ms after the submit`);
  expect(await getActiveVal('#searchFailedText.text'), 'the failure message').toBe(SEARCH_FAILED);
  expect(elapsedMs, 'the failure within its limit').toBeLessThan(DEAD_SERVER_LIMIT_MS);
});

it('a search with one failed read shows what answered and says some is missing', async () => {
  await freshSearch();
  await failRequests([{ prefix: 'searchPersons', kind: 'http', status: 500 }]);
  await ecp.sendText(RTA_CONFIG.searchQuery);
  await submitSearchFromKeyboard();
  await waitSearchResults({ label: 'the results that answered' });
  await waitToast(SEARCH_PARTIAL, { label: 'the some-results-missing toast' });
  if (CAPTURE) await captureRawUI('searchPartial');
  expect(await getActiveVal('#searchFailed.visible'), 'not the failure state').toBe(false);
});

it('a search that finds nothing says so', async () => {
  await freshSearch();
  await failRequests([{ prefix: 'search', kind: 'empty' }]);
  await ecp.sendText(RTA_CONFIG.searchQuery);
  await submitSearchFromKeyboard();
  // The live search already showed this text under the keyboard, so the text alone does not
  // say the submitted search answered. The submit hides the label until it does.
  await waitFor('#SearchHelpText.visible', (v) => v === true, {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'the no-results message after the submit',
  });
  expect(await getActiveVal('#SearchHelpText.text'), 'the message').toBe(SEARCH_EMPTY);
  if (CAPTURE) await captureRawUI('searchNoResults');
  expect(await getActiveVal('#searchFailed.visible'), 'not the failure state').toBe(false);
});

it('a live search that finds nothing says so below the keyboard, and counts 0', async () => {
  await freshSearch();
  await failRequests([{ prefix: 'search', kind: 'empty' }]);
  await ecp.sendText(RTA_CONFIG.searchQuery);
  await waitFor('#SearchHelpText.text', (v) => v === SEARCH_EMPTY, {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'the no-results message under the keyboard',
  });
  const [visible, expanded, count] = await getActiveVals([
    '#SearchHelpText.visible',
    'isExpanded',
    '#resultCount.text',
  ]);
  expect(visible, 'the message shows').toBe(true);
  expect(expanded, 'the keyboard is still open').toBe(true);
  expect(count, 'the count says 0').toBe('0 results');
});

it('emptying the query brings the help text back', async () => {
  await freshSearch();
  await failRequests([{ prefix: 'search', kind: 'empty' }]);
  await ecp.sendText(RTA_CONFIG.searchQuery);
  await waitFor('#SearchHelpText.text', (v) => v === SEARCH_EMPTY, {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'the no-results message',
  });
  for (let i = 0; i < RTA_CONFIG.searchQuery.length; i++) await press(ecp.Key.Backspace);
  await waitFor('#SearchHelpText.text', (v) => v === SEARCH_HELP, {
    read: getActiveVal,
    timeout: 10000,
    interval: 250,
    label: 'the help text once the query is empty',
  });
  const [visible, count] = await getActiveVals(['#SearchHelpText.visible', '#resultCount.text']);
  expect(visible, 'the help text shows').toBe(true);
  expect(count, 'no count for an empty query').toBe('');
});

it('typing on after a failed search clears the failure', async () => {
  await freshSearch();
  await failedSearch();
  // Up from Try again reopens the keyboard (SearchScreen.onKeyEvent).
  await press(ecp.Key.Up);
  await waitFocusInside('#kbd', { label: 'back on the search keyboard', timeout: 10000 });
  await ecp.sendText('e');
  await waitFor('#searchFailed.visible', (v) => v === false, {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'the failure state gone once the query changed',
  });
});
