/**
 * A search lists the Live TV guide programs that match it, and only those.
 *
 * SearchTask once asked GET /LiveTv/Programs with a SearchTerm, which that endpoint does not
 * take, so every search showed the first 20 guide programs whatever was typed. It now searches
 * programs through /Items with LiveTvProgram.
 *
 * Needs a server with guide data, which the demo server does not have, so the case skips
 * there. Run it against a local server with an XMLTV guide whose titles contain the query
 * (RTA_SERVER_URL / RTA_SERVER_USER / RTA_SERVER_PASS; the query defaults to "eddie", set
 * RTA_PROGRAMS_QUERY for another).
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
const QUERY = process.env.RTA_PROGRAMS_QUERY || 'eddie';
const PROGRAMS_ROW = 'Programs';

let session;
let guideTotal = 0;
let expected = [];

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  const headers = tokenHeader(session.token);
  const base = `${session.serverUrl}/Items?userId=${session.userId}&recursive=true&includeItemTypes=LiveTvProgram`;
  // The ground truth, asked of the server before the app is driven.
  const all = await getJson(`${base}&limit=1&enableTotalRecordCount=true`, headers);
  guideTotal = all.TotalRecordCount ?? 0;
  const matches = await getJson(
    `${base}&searchTerm=${encodeURIComponent(QUERY)}&limit=20`,
    headers,
  );
  expected = (matches.Items ?? []).map((i) => i.Name);
});

it('lists only the guide programs that match the search', async (testCtx) => {
  if (guideTotal === 0) testCtx.skip('server has no Live TV guide programs');
  expect(expected.length, `the guide has a program matching "${QUERY}"`).toBeGreaterThan(0);
  expect(
    guideTotal,
    'the guide has programs that do not match, or this proves nothing',
  ).toBeGreaterThan(expected.length);

  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'search-programs');
  await openSearchKeyboard();
  await ecp.sendText(QUERY);

  // Rows build as the search answers; wait for the programs row by its title.
  const rowIndex = await waitFor('#searchSelect.content.getChildCount()', hasChildren, {
    read: getActiveVal,
    timeout: 20000,
    label: `search results for "${QUERY}"`,
  }).then(async (rows) => {
    for (let i = 0; i < rows; i++) {
      if ((await getActiveVal(`#searchSelect.content.${i}.title`)) === PROGRAMS_ROW) return i;
    }
    return -1;
  });
  expect(rowIndex, `a "${PROGRAMS_ROW}" row`).toBeGreaterThan(-1);

  const count = await getActiveVal(`#searchSelect.content.${rowIndex}.getChildCount()`);
  const titles = [];
  for (let j = 0; j < count; j++)
    titles.push(await getActiveVal(`#searchSelect.content.${rowIndex}.${j}.title`));
  for (const t of titles)
    expect(String(t).toLowerCase(), 'every program matches').toContain(QUERY.toLowerCase());
  expect([...titles].sort(), 'exactly the matching programs').toEqual([...expected].sort());
});
