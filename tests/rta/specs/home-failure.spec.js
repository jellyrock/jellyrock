/**
 * A Home row whose load fails is never removed or emptied, and a row that fails on its FIRST
 * load says so instead of spinning — driven through the request-failure switch
 * (`rtaFailRequests`) against a healthy server:
 *
 *  - a section failing on first load (Continue Watching) shows the "couldn't load" tile, and
 *    pressing OK on it loads the row;
 *  - a section failing on a refresh (Continue Watching, on the way back from Search) keeps
 *    the items it showed — before, a flaky refresh deleted the row;
 *  - the libraries failing on first load show My Media's tile, and OK builds the Recently
 *    Added rows — before, My Media spun and no Recently Added row was ever made;
 *  - with no My Media row in the layout, the same failure shows as one "Recently Added" row;
 *  - one Recently Added row failing on first load shows the tile, not a spinner;
 *  - OK on that tile shows the spinner at once and loads the row, even when the libraries
 *    request fails again, and even while the rest of its run is still loading.
 *
 * The Favorites tab follows the same rule, over its two requests (`favorites`, /Items, for every
 * row but People; `favoritePeople`, /Persons, for People):
 *
 *  - the items load failing on first load shows ONE "Favorites" row with the tile, not a tile
 *    on every type's row, and OK loads the favorites — before, the tab went blank;
 *  - People failing alone shows People's tile while the other rows load;
 *  - the items load failing on a refresh keeps the rows' items.
 *
 * The Favorites cases need a favorite Movie on the server (the demo user has one); they throw,
 * not skip, when it is gone, so a thinned fixture is not read as a pass.
 *
 * A first load only runs when a HomeRows is mounted — at launch, before a spec can set a rule
 * — or when the Home tab is selected again, which mounts a fresh one. So the first-load cases
 * go to Favorites, set the rule, and come back (`selectHomeTab`).
 *
 * What a row does with a result is `source/home/homeRowFailure.bs`'s rule and unit-tested
 * there; this proves the wiring on a device, end to end.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, favoriteCount } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { failRequests } from '../lib/failRequests.js';
import { focusHomeRow, navSearchReturn, selectHomeTab } from '../lib/nav.js';
import { getGlobalVal, homeRow, press, waitHome, waitHomeRows } from '../lib/steps.js';
import { captureRawUI } from '../capture.js';

const LOCALE = RTA_CONFIG.languages[0];
const LIBRARY_SECTION_TYPES = ['smalllibrarytiles', 'librarybuttons'];
// RTA_CAPTURE=1 also saves the failed tiles, focused, to out/rta-captures/ for review.
const CAPTURE = process.env.RTA_CAPTURE === '1';

let session;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
});

async function freshApp() {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'home-failure');
  await waitHome();
}

/** A row that has loaded real items: more than a lone placeholder. */
const hasItems = (row) => row !== undefined && row.items > 0 && row.firstType !== 'Loading';
const isFailedTile = (row) => row !== undefined && row.items === 1 && row.loadFailed;
/** A row showing only the loading spinner: its load is under way. */
const isSpinning = (row) =>
  row !== undefined && row.items === 1 && row.firstType === 'Loading' && !row.loadFailed;
const latestRows = (snap) => snap.rows.filter((r) => r.sectionId?.startsWith('latest_'));

/** Go to Favorites, set `rules`, and come back: the Home tab's first load runs with them. */
async function firstLoadWith(rules) {
  await selectHomeTab('favorites');
  await failRequests(rules);
  await selectHomeTab('home');
}

/**
 * Home has settled: no row is still showing a spinner. Every section has answered or failed, so
 * the rows have stopped being removed and inserted — and no failure was left spinning.
 */
const settled = (snap) => snap.rows.every((r) => r.firstType !== 'Loading' || r.loadFailed);

/**
 * Focus the row with `sectionId` and press OK on its failed tile, capturing it first if asked.
 *
 * Waits for Home to settle before choosing the row: until every section has answered, rows
 * above can still be removed (an empty section) and the index would point at the wrong row.
 */
async function pressOkOnFailedRow(sectionId, captureName) {
  const snap = await waitHomeRows((s) => settled(s) && isFailedTile(homeRow(s, sectionId)), {
    label: `Home settled with ${sectionId} showing its failed tile`,
  });
  const index = snap.rows.findIndex((r) => r.sectionId === sectionId);
  expect(index).toBeGreaterThan(-1);
  await focusHomeRow(index, sectionId);
  if (CAPTURE && captureName) await captureRawUI(captureName);
  await press(ecp.Key.Ok);
}

it('a section that fails on first load shows the failed tile, and OK loads it', async () => {
  await freshApp();
  await firstLoadWith([{ prefix: 'continue', kind: 'timeout', times: 1 }]);

  await waitHomeRows((s) => isFailedTile(homeRow(s, 'resume')), {
    label: 'Continue Watching showed its failed tile',
  });

  // The rule is spent, so this load reaches the server.
  await pressOkOnFailedRow('resume', 'homeRowFailedWide');
  await waitHomeRows((s) => hasItems(homeRow(s, 'resume')), {
    label: 'Continue Watching loaded after OK',
  });
});

it('a section that fails on a refresh keeps its items', async () => {
  await freshApp();
  const loaded = await waitHomeRows(
    (s) => hasItems(homeRow(s, 'resume')) && s.results.resume?.status === 'ok',
    { label: 'Continue Watching loaded' },
  );
  const before = { items: homeRow(loaded, 'resume').items, count: loaded.results.resume.count };

  await failRequests([{ prefix: 'continue', kind: 'timeout', times: 1 }]);
  // Home refreshes every section on every return to it.
  await navSearchReturn();

  const after = await waitHomeRows((s) => (s.results.resume?.count ?? 0) > before.count, {
    label: "Continue Watching's refresh finished",
  });
  expect(after.results.resume.status).toBe('failed');
  expect(homeRow(after, 'resume')?.items).toBe(before.items);
  expect(homeRow(after, 'resume')?.loadFailed).toBe(false);
});

it('the libraries failing on first load show My Media failed, and OK builds Recently Added', async () => {
  await freshApp();
  await firstLoadWith([{ prefix: 'libraries', kind: 'timeout', times: 1 }]);

  const failed = await waitHomeRows((s) => isFailedTile(homeRow(s, 'library')), {
    label: 'My Media showed its failed tile',
  });
  expect(latestRows(failed)).toEqual([]);

  await pressOkOnFailedRow('library', 'homeRowFailedLibrary');
  await waitHomeRows(
    (s) => hasItems(homeRow(s, 'library')) && latestRows(s).some((r) => hasItems(r)),
    { label: 'My Media and the Recently Added rows loaded after OK' },
  );
});

it('the libraries failing with no My Media row show one Recently Added row, and OK replaces it', async (testCtx) => {
  await freshApp();
  // The layout is the server's (DisplayPreferences), held in memory on the user's settings.
  // Changing it there reaches only this app run and the local registry, which the runner
  // restores — never the server.
  const sections = [];
  for (let i = 0; i <= 6; i++) sections.push(await getGlobalVal(`user.settings.homeSection${i}`));
  if (!sections.includes('latestmedia')) testCtx.skip('layout shows no latest media');
  for (let i = 0; i <= 6; i++) {
    if (LIBRARY_SECTION_TYPES.includes(sections[i])) {
      await odc.setValue({
        base: 'global',
        keyPath: `user.settings.homeSection${i}`,
        value: 'none',
      });
    }
  }

  await firstLoadWith([{ prefix: 'libraries', kind: 'timeout', times: 1 }]);
  const failed = await waitHomeRows((s) => isFailedTile(homeRow(s, 'latestStandIn')), {
    label: 'the Recently Added stand-in showed its failed tile',
  });
  expect(homeRow(failed, 'library')).toBeUndefined();

  await pressOkOnFailedRow('latestStandIn', 'homeRowFailedStandIn');
  await waitHomeRows(
    (s) => homeRow(s, 'latestStandIn') === undefined && latestRows(s).some((r) => hasItems(r)),
    { label: 'the Recently Added rows replaced the stand-in after OK' },
  );
});

it('a Recently Added row that fails on first load shows the failed tile, not a spinner', async () => {
  await freshApp();
  // The first latest-media request the run sends is the first row's.
  await firstLoadWith([{ prefix: 'latestRow-', kind: 'http', status: 500, times: 1 }]);

  const snap = await waitHomeRows((s) => settled(s) && latestRows(s).some(isFailedTile), {
    label: 'Home settled with a Recently Added row showing its failed tile',
  });
  expect(latestRows(snap).filter(isFailedTile)).toHaveLength(1);
});

it('OK on a failed Recently Added row shows the spinner at once and loads it, even when the libraries fail again', async () => {
  await freshApp();
  await firstLoadWith([{ prefix: 'latestRow-', kind: 'http', status: 500, times: 1 }]);
  const snap = await waitHomeRows((s) => settled(s) && latestRows(s).some(isFailedTile), {
    label: 'Home settled with a Recently Added row showing its failed tile',
  });
  const failedId = latestRows(snap).find(isFailedTile).sectionId;

  // The libraries fail again, so only a direct retry can reload the row; its answer is held
  // for 3 s so the spinner is there to see. Before, the tile never changed.
  await failRequests([
    { prefix: 'libraries', kind: 'timeout', times: 1 },
    { prefix: 'latestRow-', kind: 'slow', ms: 3000, times: 1 },
  ]);
  await pressOkOnFailedRow(failedId, 'homeRowRetryingLatest');
  await waitHomeRows((s) => isSpinning(homeRow(s, failedId)), {
    label: `${failedId} showed the spinner after OK`,
    timeout: 2500,
  });
  await waitHomeRows((s) => hasItems(homeRow(s, failedId)), {
    label: `${failedId} loaded after OK`,
  });
});

it('OK on a failed Recently Added row while the rest are still loading spins it, then loads it when the run ends', async () => {
  await freshApp();
  // The first row fails at once; the rest are held for 8 s, so the run is still going.
  await firstLoadWith([
    { prefix: 'latestRow-', kind: 'http', status: 500, times: 1 },
    { prefix: 'latestRow-', kind: 'slow', ms: 8000 },
  ]);
  const notLatestSettled = (s) =>
    s.rows
      .filter((r) => !r.sectionId?.startsWith('latest_'))
      .every((r) => r.firstType !== 'Loading' || r.loadFailed);
  const snap = await waitHomeRows(
    (s) =>
      notLatestSettled(s) && latestRows(s).some(isFailedTile) && latestRows(s).some(isSpinning),
    { label: 'a Recently Added row failed while the others are still loading' },
  );
  const failedId = latestRows(snap).find(isFailedTile).sectionId;
  const index = snap.rows.findIndex((r) => r.sectionId === failedId);
  expect(index).toBeGreaterThan(-1);

  await focusHomeRow(index, failedId);
  await press(ecp.Key.Ok);
  const spinning = await waitHomeRows((s) => isSpinning(homeRow(s, failedId)), {
    label: `${failedId} showed the spinner after OK`,
    timeout: 2500,
  });
  // The run it waits on must still be going, or this is not the case under test.
  expect(
    latestRows(spinning)
      .filter((r) => r.sectionId !== failedId)
      .some(isSpinning),
  ).toBe(true);

  // Let the retry through at full speed; the held answers are already on their way.
  await failRequests([]);
  await waitHomeRows((s) => hasItems(homeRow(s, failedId)), {
    label: `${failedId} loaded after the run ended`,
    timeout: 30000,
  });
});

/**
 * The fixture holds what the Favorites cases assert on: at least one favorite Movie. Thrown,
 * not skipped — a case that loads nothing would pass on the very blank tab it exists to catch.
 */
async function assertFavoriteMovie() {
  const movies = await favoriteCount(session, 'Movie');
  if (movies < 1)
    throw new Error(`the server user has no favorite Movie (${RTA_CONFIG.server.url})`);
}

it('Favorites: the items load failing on first load shows one Favorites row, and OK loads it', async () => {
  await assertFavoriteMovie();
  await freshApp();
  // The Favorites tab's first load runs when the tab is selected, so the rule is set before.
  await failRequests([{ prefix: 'favorites', kind: 'timeout', times: 1 }]);
  await selectHomeTab('favorites');

  const failed = await waitHomeRows(
    (s) => settled(s) && isFailedTile(homeRow(s, 'favoritesStandIn')),
    { label: 'Favorites settled with the stand-in showing its failed tile' },
  );
  // No type's row is left over: at most People, which has its own request.
  expect(failed.rows.map((r) => r.sectionId).filter((id) => id !== 'Person')).toEqual([
    'favoritesStandIn',
  ]);

  await pressOkOnFailedRow('favoritesStandIn', 'favoritesFailedStandIn');
  await waitHomeRows(
    (s) => homeRow(s, 'favoritesStandIn') === undefined && hasItems(homeRow(s, 'Movie')),
    { label: 'the Movies row replaced the stand-in after OK' },
  );
});

it('Favorites: People failing alone shows its failed tile while the other rows load', async () => {
  await assertFavoriteMovie();
  await freshApp();
  await failRequests([{ prefix: 'favoritePeople', kind: 'timeout', times: 1 }]);
  await selectHomeTab('favorites');

  await waitHomeRows(
    (s) =>
      settled(s) &&
      isFailedTile(homeRow(s, 'Person')) &&
      hasItems(homeRow(s, 'Movie')) &&
      s.results.favoritePeople?.status === 'failed',
    { label: 'People showed its failed tile and Movies loaded' },
  );

  await pressOkOnFailedRow('Person', 'favoritesFailedPeople');
  const after = await waitHomeRows((s) => (s.results.favoritePeople?.count ?? 0) > 1, {
    label: "People's retry finished",
  });
  expect(after.results.favoritePeople.status).toBe('ok');
  // An answered People load fills the row or, with no favorite people, removes it.
  const people = homeRow(after, 'Person');
  expect(people === undefined || hasItems(people)).toBe(true);
});

it('Favorites: the items load failing on a refresh keeps the rows', async () => {
  await assertFavoriteMovie();
  await freshApp();
  await selectHomeTab('favorites');
  const loaded = await waitHomeRows(
    (s) => hasItems(homeRow(s, 'Movie')) && s.results.favorites?.status === 'ok',
    { label: 'Favorites loaded' },
  );
  const before = { rows: loaded.rows, count: loaded.results.favorites.count };

  await failRequests([{ prefix: 'favorites', kind: 'timeout', times: 1 }]);
  // Home reloads the selected tab on every return to it.
  await navSearchReturn();

  const after = await waitHomeRows((s) => (s.results.favorites?.count ?? 0) > before.count, {
    label: "Favorites' refresh finished",
  });
  expect(after.results.favorites.status).toBe('failed');
  expect(after.rows).toEqual(before.rows);
});
