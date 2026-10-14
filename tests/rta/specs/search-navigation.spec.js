/**
 * Moving between the search screen's suggestions, keyboard and results with the remote:
 *
 *  - Down past the last suggestion leaves the overlay for the results, as Down off the
 *    keyboard's bottom row does (it submits what is typed);
 *  - in recent mode, Down from the last entry reaches Clear History;
 *  - Up from the first results row reopens the overlay where focus left it: on the
 *    suggestion that was picked, or on the keyboard;
 *  - picking a suggestion lands on the results even before any have arrived.
 *
 * Suggestions here are the demo server's live hints for RTA_CONFIG.searchQuery, so each case
 * reads what the list holds before asserting on it rather than naming a title.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { failRequests } from '../lib/failRequests.js';
import { openSearchKeyboard, submitSearchFromKeyboard } from '../lib/nav.js';
import {
  getActiveVal,
  hasChildren,
  press,
  waitFocused,
  waitFocusInside,
  waitFor,
  walkFocusUntil,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const LIST = '#suggestions.#list';

const atList = (f) => f?.node?.id === 'list';
const atResults = (f) => f?.node?.id === 'searchSelect';
const atClear = (f) => f?.node?.id === 'clearButton';
const atSearchIcon = (f) => f?.node?.id === 'searchIcon';

let session;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
});

async function freshSearch() {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'search-navigation');
  await openSearchKeyboard();
}

/**
 * Types the query and waits until its hints, not the recent searches, fill the list. Typing
 * switches the header to Suggestions at once, but the recent rows stay until the hints
 * arrive and replace them, which also puts focus back on row 0. So "the list has rows" is
 * true too early: wait for the first row to change from the recent list's first row.
 */
async function typeAndWaitForHints() {
  const recentFirst = await getActiveVal('#suggestions.#list.content.0.description');
  await ecp.sendText(RTA_CONFIG.searchQuery);
  await waitFor(
    '#suggestions.#list.content.0.description',
    (v) => typeof v === 'string' && v !== '' && v !== recentFirst,
    {
      read: getActiveVal,
      timeout: 20000,
      interval: 250,
      label: `hints for "${RTA_CONFIG.searchQuery}" in place of the recent searches`,
    },
  );
}

/** Types the query, waits for its results, and submits it from the keyboard. */
async function submitTypedQuery() {
  await ecp.sendText(RTA_CONFIG.searchQuery);
  await waitFor('#searchSelect.content.getChildCount()', hasChildren, {
    read: getActiveVal,
    timeout: 20000,
    label: `results for "${RTA_CONFIG.searchQuery}"`,
  });
  await submitSearchFromKeyboard();
}

/** Left from the keyboard's left edge, where focus starts (Q), into the suggestion list. */
async function enterSuggestions() {
  await waitFocused(atList, {
    timeout: 8000,
    interval: 350,
    action: walkFocusUntil(ecp.Key.Left, atList),
    label: 'the suggestion list',
  });
}

it('Down past the last suggestion lands on the results', async () => {
  await freshSearch();
  await typeAndWaitForHints();
  await enterSuggestions();

  await waitFocused(atResults, {
    timeout: 15000,
    interval: 350,
    action: walkFocusUntil(ecp.Key.Down, atResults),
    label: 'the results, below the last suggestion',
  });
  expect(await getActiveVal('isExpanded'), 'the overlay closed').toBe(false);
  expect(await getActiveVal('query'), 'the typed query was submitted').toBe(RTA_CONFIG.searchQuery);
});

it('in recent mode, Down from the last entry reaches Clear History', async () => {
  await freshSearch();
  // A submitted search is what puts a term in the history.
  await submitTypedQuery();
  // Back to Home, which hands focus back to the overhang search icon it was opened from;
  // OK on it reopens search with nothing typed, so the list shows recent searches.
  await press(ecp.Key.Back);
  await waitFocused(atSearchIcon, {
    timeout: 15000,
    interval: 250,
    label: 'the search icon on Home',
  });
  await press(ecp.Key.Ok);
  await waitFocusInside('#kbd', { label: 'search reopened on the keyboard', timeout: 15000 });
  const entries = await getActiveVal(`${LIST}.content.getChildCount()`);
  expect(entries, 'recent searches listed').toBeGreaterThan(0);

  await enterSuggestions();
  await waitFocused(atClear, {
    timeout: 15000,
    interval: 350,
    action: walkFocusUntil(ecp.Key.Down, atClear),
    label: 'Clear History, below the last recent search',
  });
});

it('Up from the results returns to the suggestion that was picked', async () => {
  await freshSearch();
  await typeAndWaitForHints();
  await enterSuggestions();
  await press(ecp.Key.Down);
  await waitFor('#suggestions.#list.itemFocused', (v) => v === 1, {
    read: getActiveVal,
    timeout: 5000,
    interval: 250,
    label: 'the second suggestion focused',
  });
  const picked = await getActiveVal(`${LIST}.content.1.description`);
  expect(typeof picked === 'string' && picked !== '', 'the picked suggestion read').toBe(true);

  await press(ecp.Key.Ok);
  await waitFocused(atResults, {
    timeout: 15000,
    interval: 350,
    label: 'the results after the pick',
  });
  await waitFor('#searchSelect.content.getChildCount()', hasChildren, {
    read: getActiveVal,
    timeout: 20000,
    label: `results for "${picked}"`,
  });

  await press(ecp.Key.Up);
  await waitFocused(atList, { timeout: 8000, interval: 250, label: 'back in the suggestion list' });
  const index = await getActiveVal(`${LIST}.itemFocused`);
  expect(
    await getActiveVal(`${LIST}.content.${index}.description`),
    'on the picked suggestion',
  ).toBe(picked);
});

it('Up from the results returns to the keyboard when the keyboard was left', async () => {
  await freshSearch();
  // Leaves through the keyboard: Down off its bottom row.
  await submitTypedQuery();
  await press(ecp.Key.Up);
  await waitFocusInside('#kbd', { label: 'back on the keyboard', timeout: 8000 });
});

it('picking a suggestion before any results arrive stays on the results', async () => {
  await freshSearch();
  // Hold the full search so the results list is still empty when the pick lands. The pick's
  // OK must not travel on to the screen, where OK on empty results reopens the overlay.
  await failRequests([{ prefix: 'searchItems', kind: 'slow', ms: 15000 }]);
  await typeAndWaitForHints();
  expect(await getActiveVal('#searchSelect.content.getChildCount()'), 'no results yet').toBe(0);
  await enterSuggestions();
  await press(ecp.Key.Ok);
  await waitFocused(atResults, {
    timeout: 5000,
    interval: 250,
    label: 'the results after the pick',
  });
  expect(await getActiveVal('isExpanded'), 'the overlay stayed closed').toBe(false);
});
