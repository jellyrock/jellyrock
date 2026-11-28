/**
 * A library's tab in a deep link, and across the reload a theme or language change makes.
 *
 * A link names a tab with `tab=<id>` in `contentId` (the app's own tab ids, ADR 0056). It
 * opens the library on that tab for that opening only: it wins over the tab kept on this
 * Roku and is never saved. A link to the library already on screen switches its tab in
 * place, with no second screen pushed. A tab the library does not offer is ignored.
 *
 * A theme change in Settings rebuilds every screen. The screen Settings was opened from
 * comes back on the tab it was on: a library, and Home.
 *
 * Each case reads the screen's own tab and the tab the overhang draws: the two are written
 * by different code, and a link or a reload changes the first from inside the screen.
 */
import { afterAll, beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect, heldDefaultTab } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import {
  focusOverhangIcon,
  navLibraryByType,
  openSettingsFromGear,
  overhangSelectedTab,
  pickSettingsRadioOption,
  selectHomeTab,
  selectLibraryTab,
  waitGridLoaded,
  waitSettingsMenuHas,
} from '../lib/nav.js';
import {
  enterOverhangRow,
  getActiveVal,
  getActiveVals,
  press,
  waitFocusInHomeContent,
  waitFocusInside,
  waitFor,
  waitHome,
  walkOverhangRowTo,
} from '../lib/steps.js';

// The Settings menu labels the reload cases walk by are English.
const LOCALE = 'en_US';
// The tab kept on this Roku in every case, so a link's tab has something to win over.
const KEPT_TAB = 'studios';

let session;
let moviesId;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  moviesId = libraryIdFor(await getLibraries(session), 'movies');
});

// A theme picked in Settings is saved, and the registry is restored only when the run ends.
afterAll(async () => {
  if (session) await odc.writeRegistry({ values: { [session.userId]: { uiTheme: null } } });
});

/** A cold start on Home with the movie library seeded to open on `KEPT_TAB`. */
async function freshHome(label) {
  const expectedServer = await seedHome(session, LOCALE);
  const landing = await seedLibraryLanding(session, moviesId, KEPT_TAB, { layout: 'grid' });
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, label, { landing });
  await waitHome();
}

/** Send a runtime deep link (ECP `/input`), as a script or a home automation does. */
const sendLink = (contentId) => ecp.sendInput({ params: { contentId } });

/** The movie library is the active screen and its tab has loaded. */
async function waitLibraryLoaded(label) {
  await waitFor('subtype()', (v) => v === 'BaseGridView', {
    read: getActiveVal,
    timeout: 30000,
    interval: 300,
    label: `${label}: the library is the screen`,
  });
  await waitGridLoaded(`${label}: the tab loaded`);
}

/** The library's own tab and view, and the tab the overhang draws selected. */
async function tabState() {
  const [libraryId, selectedTabId, currentView] = await getActiveVals([
    'parentItem.id',
    'selectedTabId',
    'currentView',
  ]);
  return { libraryId, selectedTabId, currentView, drawn: await overhangSelectedTab() };
}

const onTab = (tabId) => ({
  libraryId: moviesId,
  selectedTabId: tabId,
  currentView: tabId,
  drawn: tabId,
});

/** In Settings: pick another theme, then Back out of Settings, which reloads every screen. */
async function changeThemeAndLeave() {
  await pickSettingsRadioOption(['User Interface', 'General'], 'uiTheme', 'emerald');
  await press(ecp.Key.Back);
  await waitFocusInside('#settingsMenu', { label: 'the menu after the pick' });
  await press(ecp.Key.Back);
  await waitSettingsMenuHas('Libraries', 'back in the User Interface group');
  await press(ecp.Key.Back);
  await waitSettingsMenuHas('User Interface', 'back at the top menu');
  await waitFocusInside('#settingsMenu', { label: 'the top menu' });
  await press(ecp.Key.Back);
}

it('a link that names a tab opens the library on it, over the tab kept on this Roku, and saves nothing', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await freshHome('a link with a tab');

  await sendLink(`id=${moviesId}|tab=genres`);
  await waitLibraryLoaded('a link with a tab');
  expect(await tabState()).toEqual(onTab('genres'));
  expect(await heldDefaultTab(moviesId), 'the kept tab is untouched').toBe(KEPT_TAB);

  // Home is under it, as for any link
  await press(ecp.Key.Back);
  await waitHome();
}, 150000);

it('a link naming a tab the library does not offer opens it as a link with no tab does', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await freshHome('a link with a tab not offered');

  // A music library's tab, sent to a movie library
  await sendLink(`id=${moviesId}|tab=albumartists`);
  await waitLibraryLoaded('a link with a tab not offered');
  expect(await tabState()).toEqual(onTab(KEPT_TAB));
}, 150000);

it('a link to the library on screen switches its tab in place', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await freshHome('a link to the library on screen');
  await navLibraryByType('movies', moviesId);
  await waitLibraryLoaded('the library, opened by hand');
  expect(await tabState()).toEqual(onTab(KEPT_TAB));

  await sendLink(`id=${moviesId}|tab=genres`);
  await waitFor('selectedTabId', (v) => v === 'genres', {
    read: getActiveVal,
    timeout: 25000,
    interval: 300,
    label: 'the library on screen took the tab the link names',
  });
  await waitGridLoaded('the Genres tab the link named');
  // The rows take the focus once they load, as after a tab press
  await waitFocusInside('#genreList', { label: 'focus on the Genres rows', timeout: 20000 });
  expect(await tabState()).toEqual(onTab('genres'));

  // The same screen, not a second one over it: one Back reaches Home
  await press(ecp.Key.Back);
  await waitHome();
}, 180000);

it('a theme change in Settings brings the library back on the tab it was on', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await freshHome('a reload over a library tab');
  await navLibraryByType('movies', moviesId);
  await waitLibraryLoaded('the library, opened by hand');
  await selectLibraryTab('genres');
  await waitGridLoaded('the Genres tab');
  await waitFocusInside('#genreList', { label: 'focus on the Genres rows', timeout: 20000 });

  await enterOverhangRow('the Genres tab');
  await walkOverhangRowTo('settingsIcon', { label: 'the gear on the library' });
  await openSettingsFromGear({ pageMenu: true });
  await changeThemeAndLeave();

  await waitLibraryLoaded('the library after the reload');
  await waitFocusInside('#genreList', { label: 'focus on the Genres rows again', timeout: 20000 });
  expect(await tabState()).toEqual(onTab('genres'));
  expect(await heldDefaultTab(moviesId), 'the kept tab is untouched').toBe(KEPT_TAB);
}, 240000);

it('a theme change in Settings brings Home back on its Favorites tab', async () => {
  await freshHome('a reload over a Home tab');
  await selectHomeTab('favorites');
  await focusOverhangIcon('settingsIcon');
  await openSettingsFromGear();
  await changeThemeAndLeave();

  await waitFor('subtype()', (v) => v === 'Home', {
    read: getActiveVal,
    timeout: 30000,
    interval: 300,
    label: 'Home after the reload',
  });
  await waitFor('selectedTabId', (v) => v === 'favorites', {
    read: getActiveVal,
    timeout: 20000,
    interval: 300,
    label: 'the new Home took its Favorites tab',
  });
  await waitFocusInHomeContent({ label: 'focus in the Favorites rows', timeout: 20000 });
  expect(await overhangSelectedTab(), 'the overhang draws Favorites').toBe('favorites');
}, 240000);
