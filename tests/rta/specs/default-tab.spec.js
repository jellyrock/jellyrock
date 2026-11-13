/**
 * The default tab: which tab a library opens on, and the gear menu's Default tab entry.
 *
 * A library opens on the tab picked for it on this Roku, else the tab picked for it in the
 * web client, else its type's own default (gridQuery.resolveView). A tab press never changes
 * it. The gear's Default tab entry sets and clears the Roku's pick: its first option keeps
 * none and is named for where the tab then comes from ("Default (Movies)", "Web client
 * setting (Genres)"), and the menu row names the tab in force alone. A pick applies the next
 * time the library opens, so each check here starts the app cold.
 *
 * The web client's pick lives in the server's display preferences, so the cases that set one
 * write to the server's account. They run only against a server of your own
 * (`RTA_SERVER_URL`), never the shared public demo, and put the old value back.
 */
import { afterAll, beforeAll, it, expect } from 'vitest';
import { ecp } from 'roku-test-automation';
import { RTA_CONFIG, isPrivateServer } from '../config.js';
import {
  authenticate,
  getJson,
  getLibraries,
  libraryIdFor,
  setServerLanding,
  tokenHeader,
} from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect, heldDefaultTab } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { navLibraryByType, openLibraryByType, waitPageMenu } from '../lib/nav.js';
import {
  enterOverhangRow,
  getActiveVal,
  getVal,
  press,
  scrollFocus,
  waitDialogClosed,
  waitFocused,
  waitFor,
  waitHome,
  walkOverhangRowTo,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const PRIVATE = isPrivateServer(RTA_CONFIG.server);
const NOT_PRIVATE = 'writes a web pick to the server: set RTA_SERVER_URL to a server of your own';
const atSettingsIcon = (f) => f?.node?.id === 'settingsIcon';

let session;
let libraries;
let moviesId;
// The server picks a case changed, and the values to put back: [key, previous value].
const serverRestores = [];

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session);
  moviesId = libraryIdFor(libraries, 'movies');
});

afterAll(async () => {
  for (const [key, previous] of serverRestores.reverse()) {
    await setServerLanding(session, key, previous ?? '');
  }
  // The app read the changed picks at its last sign-in; a cold start reads them again.
  if (serverRestores.length) await hardRelaunch();
});

/** The web's pick for `key` on the server now, `''` for none. */
async function serverLanding(key) {
  const query = new URLSearchParams({ userId: session.userId, client: 'emby' });
  const prefs = await getJson(
    `${session.serverUrl}/DisplayPreferences/usersettings?${query}`,
    tokenHeader(session.token),
  );
  return prefs?.CustomPrefs?.[`landing-${key}`] ?? '';
}

/** Set the web's pick for `key`, noting the old value for afterAll. */
async function pickOnServer(key, value) {
  serverRestores.push([key, await setServerLanding(session, key, value)]);
}

/** A cold start with no Roku pick for `libraryId`, then that library opened. */
async function openFresh(label, collectionType, libraryId) {
  const expectedServer = await seedHome(session, LOCALE);
  // seedHome clears every display.* key: the Roku keeps no pick.
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, label);
  await waitHome();
  await navLibraryByType(collectionType, libraryId);
}

/** A cold start keeping the registry as it is, then the library opened again. */
async function reopen(collectionType, libraryId) {
  await hardRelaunch();
  await waitHome();
  await navLibraryByType(collectionType, libraryId);
}

const selectedTab = () => getActiveVal('selectedTabId');

/** The text of each row of the list dialog on show. */
async function dialogRows() {
  const count = await getVal('#optionList.content.getChildCount()');
  const rows = [];
  for (let i = 0; i < count; i++) rows.push(await getVal(`#optionList.content.${i}.title`));
  return rows;
}

/** Up into the overhang, along to the gear, open its menu: the menu's rows. */
async function openGearMenu(label) {
  await enterOverhangRow(label);
  await walkOverhangRowTo('settingsIcon', { label: `the gear on ${label}` });
  await press(ecp.Key.Ok);
  await waitPageMenu();
  return dialogRows();
}

/** Focus row `index` of the list on show and press OK. */
async function pickRow(index, label) {
  await scrollFocus({
    keyPath: '#optionList.itemFocused',
    target: index,
    forwardKey: ecp.Key.Down,
    backKey: ecp.Key.Up,
    read: getVal,
    stepped: true,
    within: '#optionList',
    label,
  });
  await press(ecp.Key.Ok);
}

/** From the gear menu: open the Default tab list and return its rows. */
async function openDefaultTabList(menuRows) {
  const row = menuRows.findIndex((r) => r.startsWith('Default tab'));
  expect(row, 'the menu has a Default tab row').toBeGreaterThan(-1);
  await pickRow(row, 'the Default tab row');
  // The list replaces the menu: wait for its own first row, which names a tab's source.
  const isFirstOption = (t) =>
    typeof t === 'string' && (t.startsWith('Default (') || t.startsWith('Web client setting ('));
  await waitFor('#optionList.content.0.title', isFirstOption, {
    label: 'the Default tab list',
    timeout: 10000,
  });
  return dialogRows();
}

/** In the Default tab list on show: pick the row titled `title`. */
async function pickDefaultTab(rows, title) {
  const index = rows.indexOf(title);
  expect(rows, `the list offers ${title}`).toContain(title);
  await pickRow(index, `the ${title} row`);
  await waitDialogClosed(`the ${title} pick closed the list`);
  await waitFocused(atSettingsIcon, { timeout: 8000, interval: 250, label: 'the gear again' });
}

it('with no pick anywhere a movie library opens on Movies, and the gear sets and clears a Roku pick', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  if ((await serverLanding(moviesId)) !== '')
    testCtx.skip('the server account already picks a tab for the movie library');

  await openFresh('default tab none', 'movies', moviesId);
  expect(await selectedTab(), "the type's own default").toBe('movies');

  let menu = await openGearMenu('the movie library');
  expect(menu, 'the row names the tab in force alone').toContain('Default tab (Movies)');
  let rows = await openDefaultTabList(menu);
  expect(rows[0], 'the first option says where the tab comes from').toBe('Default (Movies)');
  expect(
    await getVal('#optionList.content.0.isSelected'),
    'no Roku pick: the first is in force',
  ).toBe(true);

  await pickDefaultTab(rows, 'Genres');
  expect(await heldDefaultTab(moviesId), 'the pick is kept for the library').toBe('genres');
  expect(await selectedTab(), 'the tab on show stays until the library opens again').toBe('movies');

  await reopen('movies', moviesId);
  expect(await selectedTab(), 'the library opens on the Roku pick').toBe('genres');
  menu = await openGearMenu('the movie library on Genres');
  expect(menu).toContain('Default tab (Genres)');
  rows = await openDefaultTabList(menu);
  await pickDefaultTab(rows, rows[0]);
  expect(await heldDefaultTab(moviesId), 'the first option clears the pick').toBeUndefined();

  await reopen('movies', moviesId);
  expect(await selectedTab(), "back to the type's own default").toBe('movies');
});

it('a web client pick opens the library there, and a Roku pick overrides it', async (testCtx) => {
  if (!PRIVATE) testCtx.skip(NOT_PRIVATE);
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await pickOnServer(moviesId, 'genres');

  await openFresh('default tab web', 'movies', moviesId);
  expect(await selectedTab(), "the web client's pick").toBe('genres');

  let menu = await openGearMenu('the movie library');
  expect(menu).toContain('Default tab (Genres)');
  let rows = await openDefaultTabList(menu);
  expect(rows[0]).toBe('Web client setting (Genres)');

  await pickDefaultTab(rows, 'Movies');
  await reopen('movies', moviesId);
  expect(await selectedTab(), 'the Roku pick wins over the web').toBe('movies');

  menu = await openGearMenu('the movie library on Movies');
  rows = await openDefaultTabList(menu);
  await pickDefaultTab(rows, 'Web client setting (Genres)');
  await reopen('movies', moviesId);
  expect(await selectedTab(), 'cleared: the web pick again').toBe('genres');
});

it("Live TV follows the web client's livetv pick", async (testCtx) => {
  if (!PRIVATE) testCtx.skip(NOT_PRIVATE);
  const liveTvId = libraryIdFor(libraries, 'livetv');
  if (!liveTvId) testCtx.skip('server has no "livetv" library');
  // The web keys Live TV's pick by `livetv`, not by the library id.
  await pickOnServer('livetv', 'guide');

  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'default tab live tv');
  await waitHome();
  // The guide loads no grid run, so wait on the tab rather than a loaded grid.
  await openLibraryByType('livetv', liveTvId);
  await waitFor('selectedTabId', (t) => t === 'guide', {
    label: 'Live TV opened on the guide',
    timeout: 20000,
    read: getActiveVal,
  });
});
