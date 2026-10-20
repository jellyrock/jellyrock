/**
 * A short search keeps a row for every type the server has a match for.
 *
 * SearchTask once read the whole library in one /Items request limited to 100, shared by
 * every type, and the server filled it with whatever it listed first: on a large library a
 * one-letter search came back as 99 episodes and 1 movie, so the Movies and Shows rows
 * vanished. Each library type now has a read of its own (`searchOutcome.LIBRARY_TYPES`).
 *
 * Both checks only mean something on a library where one type has more matches than a read's
 * limit, which the demo server does not: there the first passes without proving much and the
 * second skips. Run it against a large local library (RTA_SERVER_URL / RTA_SERVER_USER /
 * RTA_SERVER_PASS).
 *
 * A recording comes back as a Movie or Episode and moves to the Recordings row, so a server
 * whose only matches of one of those types are recordings would fail here wrongly. The demo
 * server has no recordings.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getJson, tokenHeader } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { openSearchKeyboard, waitSearchResults } from '../lib/nav.js';
import { getActiveVals } from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const QUERY = RTA_CONFIG.searchQuery;
// The row each library type lands in (SearchRow's labels, en_US).
const ROWS = {
  Movie: 'Movies',
  Series: 'Shows',
  Episode: 'Episodes',
  Playlist: 'Playlists',
  MusicAlbum: 'Albums',
  Audio: 'Songs',
  Video: 'Videos',
  MusicVideo: 'Music Videos',
  LiveTvChannel: 'Channels',
  PhotoAlbum: 'Photo Albums',
  Photo: 'Photos',
  BoxSet: 'Collections',
};

// The most items one read asks for, so the most one row shows: SearchTask's SEARCH_READ_LIMIT.
const READ_LIMIT = 50;

let session;
// How many items of each row's type match the query, asked of the server before the app is
// driven: the ground truth both checks compare the screen with.
const matchCounts = {};
let searched;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  const headers = tokenHeader(session.token);
  for (const [type, row] of Object.entries(ROWS)) {
    const r = await getJson(
      `${session.serverUrl}/Items?userId=${session.userId}&recursive=true&includeItemTypes=${type}` +
        `&searchTerm=${encodeURIComponent(QUERY)}&limit=0&enableTotalRecordCount=true`,
      headers,
    );
    matchCounts[row] = r.TotalRecordCount ?? 0;
  }
});

/** Searches once and reads every row's title and item count in one batch; both tests share it. */
function searchedRows() {
  searched ??= (async () => {
    const expectedServer = await seedHome(session, LOCALE);
    await hardRelaunch();
    await assertSeedTookEffect(expectedServer, 'search-rows');
    await openSearchKeyboard();
    await ecp.sendText(QUERY);
    const rows = await waitSearchResults({
      label: `search results for "${QUERY}"`,
      timeout: 30000,
    });
    const keyPaths = [];
    for (let i = 0; i < rows; i++)
      keyPaths.push(
        `#searchSelect.content.${i}.title`,
        `#searchSelect.content.${i}.getChildCount()`,
      );
    const values = await getActiveVals(keyPaths);
    const itemCounts = {};
    for (let i = 0; i < rows; i++) itemCounts[values[2 * i]] = values[2 * i + 1];
    return itemCounts;
  })();
  return searched;
}

it('keeps a row for every type with a match', async () => {
  const expectedRows = Object.keys(matchCounts).filter((row) => matchCounts[row] > 0);
  expect(expectedRows.length, `the server has matches for "${QUERY}"`).toBeGreaterThan(0);

  const titles = Object.keys(await searchedRows());
  for (const row of expectedRows) expect(titles, `a "${row}" row`).toContain(row);
});

it('fills a row to the read limit when its type has more matches', async (testCtx) => {
  const fullRows = Object.keys(matchCounts).filter((row) => matchCounts[row] > READ_LIMIT);
  if (fullRows.length === 0)
    testCtx.skip(`no type has more than ${READ_LIMIT} matches for "${QUERY}"`);

  const itemCounts = await searchedRows();
  for (const row of fullRows) {
    expect(Object.keys(itemCounts), `a "${row}" row`).toContain(row);
    expect(itemCounts[row], `"${row}" holds ${READ_LIMIT} of ${matchCounts[row]} matches`).toBe(
      READ_LIMIT,
    );
  }
});
