/**
 * A short search keeps a row for every type the server has a match for.
 *
 * SearchTask once read the whole library in one /Items request limited to 100, shared by
 * every type, and the server filled it with whatever it listed first: on a large library a
 * one-letter search came back as 99 episodes and 1 movie, so the Movies and Shows rows
 * vanished. The library is now read in families, each with its own limit.
 *
 * The check only means something on a library where one type has more than 100 matches, which
 * the demo server does not, so there it passes without proving much. Run it against a large
 * local library (RTA_SERVER_URL / RTA_SERVER_USER / RTA_SERVER_PASS).
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getJson, tokenHeader } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { openSearchKeyboard } from '../lib/nav.js';
import { getActiveVal, hasChildren, waitFor } from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const QUERY = RTA_CONFIG.searchQuery;
// The row each type lands in (SearchRow's labels, en_US).
const ROWS = { Movie: 'Movies', Series: 'Shows', Episode: 'Episodes' };

let session;
const expectedRows = [];

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  const headers = tokenHeader(session.token);
  // The ground truth, asked of the server before the app is driven: which of these types
  // has at least one match for the query.
  for (const [type, row] of Object.entries(ROWS)) {
    const r = await getJson(
      `${session.serverUrl}/Items?userId=${session.userId}&recursive=true&includeItemTypes=${type}` +
        `&searchTerm=${encodeURIComponent(QUERY)}&limit=1`,
      headers,
    );
    if ((r.Items ?? []).length > 0) expectedRows.push(row);
  }
});

it('keeps a row for every type with a match', async () => {
  expect(expectedRows.length, `the server has matches for "${QUERY}"`).toBeGreaterThan(0);

  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'search-rows');
  await openSearchKeyboard();
  await ecp.sendText(QUERY);
  const rows = await waitFor('#searchSelect.content.getChildCount()', hasChildren, {
    read: getActiveVal,
    timeout: 30000,
    label: `search results for "${QUERY}"`,
  });

  const titles = [];
  for (let i = 0; i < rows; i++)
    titles.push(await getActiveVal(`#searchSelect.content.${i}.title`));
  for (const row of expectedRows) expect(titles, `a "${row}" row`).toContain(row);
});
