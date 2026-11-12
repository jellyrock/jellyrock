/**
 * Page settings: the overhang's settings icon on a screen that offers settings of its own.
 *
 * A screen only declares them (JRScreen.pageSettingsEntries); the scene presents a menu that
 * hangs under the icon, the page's entries above All settings (JRScene.openPageMenu). A movie
 * library's Movies tab offers Layout. An entry opens a list of its options, Back there
 * returns to the menu on that entry's row, and a pick applies at once: the tab is redrawn,
 * focus goes to the grid, the choice is saved for that view, and the sort and a letter picked
 * on the letter rail are left alone.
 * A screen with nothing to offer (a TV library, a movie library's Studios tab) still opens
 * Settings in one press.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getJson, getLibraries, libraryIdFor, tokenHeader } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { navLibraryGrid, navTvLibrary, waitPageMenu, waitSettingsScreen } from '../lib/nav.js';
import {
  getActiveVal,
  getVal,
  press,
  resendUntilFocusInside,
  scrollFocus,
  waitDialogClosed,
  waitFocused,
  waitFocusInside,
  waitFor,
  waitHome,
  walkFocusUntil,
  walkOverhangRowTo,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const inOverhangRow = (f) => f?.node?.subtype === 'JROverhangIcon';
const atSettingsIcon = (f) => f?.node?.id === 'settingsIcon';
// A sort the grid does not default to, so a reset to the default would show.
const SEEDED_SORT = 'DateCreated';

let session;
let libraries;
let moviesId;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session);
  moviesId = libraryIdFor(libraries, 'movies');
});

/** A cold start with the movie library seeded to open `view`, drawn in `layout` when given. */
async function launchWithMovies(label, view, layout) {
  const expectedServer = await seedHome(session, LOCALE);
  const landing = await seedLibraryLanding(session, moviesId, view, { layout });
  // rta-run.js restores the whole registry after the run.
  await odc.writeRegistry({
    values: { [session.userId]: { [`display.${moviesId}.sortField`]: SEEDED_SORT } },
  });
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, label, { landing });
  await waitHome();
}

/** From a library's content: Up into the overhang row, then along it to the gear. */
async function focusGear(label) {
  await waitFocused(inOverhangRow, {
    timeout: 15000,
    interval: 350,
    action: walkFocusUntil(ecp.Key.Up, inOverhangRow),
    label: `the overhang row from ${label}`,
  });
  await walkOverhangRowTo('settingsIcon', { label: `the gear on ${label}` });
}

/** The text of each row of the list dialog on show. */
async function dialogRows() {
  const count = await getVal('#optionList.content.getChildCount()');
  const rows = [];
  for (let i = 0; i < count; i++) rows.push(await getVal(`#optionList.content.${i}.title`));
  return rows;
}

/** What the app holds for the movie library's display settings (its registry keys, in memory). */
async function movieDisplaySettings() {
  const all = (await odc.getValue({ base: 'global', keyPath: 'user.settings.displaySettings' }))
    ?.value;
  return all?.[moviesId] ?? {};
}

it('the gear on a movie library opens a menu under it: Layout, then All settings', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await launchWithMovies('page settings menu', 'movies', 'comfortable');
  await navLibraryGrid({ libraries });
  await focusGear('the movie grid');

  await press(ecp.Key.Ok);
  await waitPageMenu();
  expect(await dialogRows(), 'the entry with its value, then All settings').toEqual([
    'Layout (Comfortable)',
    'All settings',
  ]);
  expect(await getVal('#optionList.itemFocused'), 'focus opens on the first entry').toBe(0);

  // The icon is in the overhang row, with nothing above it: the menu hangs below.
  const icon = await getVal('#overhang.#cluster.#settingsIcon.sceneBoundingRect()');
  const panel = await getVal('#jrDialog.#chrome.#panelBackground.sceneBoundingRect()');
  expect(panel.y, 'the menu starts under the icon').toBeGreaterThanOrEqual(icon.y + icon.height);
  expect(panel.y + panel.height, 'and stays on screen').toBeLessThanOrEqual(1080);

  await press(ecp.Key.Back);
  await waitDialogClosed('Back closed the menu');
  await waitFocused(atSettingsIcon, { timeout: 8000, interval: 250, label: 'the gear again' });
  expect(await getVal('#versionLabel.text'), 'Settings did not open').toBeUndefined();
});

it('Layout lists the layouts, Back returns to the menu, and a pick redraws the tab and is kept', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await launchWithMovies('page settings layout', 'movies', 'comfortable');
  await navLibraryGrid({ libraries });
  expect(await getVal('#presentationInfo.visible'), 'the poster grid to begin with').toBe(false);
  await focusGear('the movie grid');

  await press(ecp.Key.Ok);
  await waitPageMenu();
  await press(ecp.Key.Ok);
  // The picker replaces the menu: wait for its own rows, not for any list.
  await waitFor('#optionList.content.0.title', (t) => t === 'Presentation', {
    label: 'the Layout list',
    timeout: 10000,
  });
  expect(await dialogRows()).toEqual(['Presentation', 'Comfortable']);
  expect(await getVal('#optionList.content.1.isSelected'), 'the layout in force is marked').toBe(
    true,
  );
  await waitFor('#optionList.itemFocused', (n) => n === 1, {
    label: 'focus opens on the layout in force',
    timeout: 8000,
  });

  // Back from the list is back to the menu, on the row it was opened from.
  await press(ecp.Key.Back);
  await waitFor('#optionList.content.0.title', (t) => t === 'Layout (Comfortable)', {
    label: 'the menu again',
    timeout: 10000,
  });
  await waitFor('#optionList.itemFocused', (n) => n === 0, {
    label: 'on the Layout row',
    timeout: 8000,
  });

  await press(ecp.Key.Ok);
  await waitFor('#optionList.content.0.title', (t) => t === 'Presentation', {
    label: 'the Layout list again',
    timeout: 10000,
  });
  await waitFor('#optionList.itemFocused', (n) => n === 1, {
    label: 'focus on the layout in force',
    timeout: 8000,
  });
  await press(ecp.Key.Up);
  await waitFor('#optionList.itemFocused', (n) => n === 0, {
    label: 'Presentation focused',
    timeout: 8000,
  });
  await press(ecp.Key.Ok);

  await waitDialogClosed('the pick closed the list');
  await waitFor('#presentationInfo.visible', (v) => v === true, {
    label: 'the tab redrawn in presentation',
    timeout: 20000,
  });
  await waitFocusInside('#itemGrid', { label: 'focus on the grid after the pick', timeout: 20000 });

  const saved = await movieDisplaySettings();
  expect(saved.layout_movies, 'saved for the Movies view').toBe('presentation');
  expect(saved.sortField, 'a layout change is not a view change: the sort stays').toBe(SEEDED_SORT);
  expect(saved.landing, 'and so does the saved view').toBe('movies');

  // Leave and come back: the library opens as it was left.
  await press(ecp.Key.Back);
  await waitHome();
  await navLibraryGrid({ libraries });
  await waitFor('#presentationInfo.visible', (v) => v === true, {
    label: 'presentation again on reopening',
    timeout: 20000,
  });

  // And the menu now names the new value.
  await focusGear('the movie grid');
  await press(ecp.Key.Ok);
  await waitPageMenu();
  expect((await dialogRows())[0]).toBe('Layout (Presentation)');
  await press(ecp.Key.Back);
  await waitDialogClosed('Back closed the menu');
});

it('picking the layout already in force closes the list and changes nothing', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await launchWithMovies('page settings same pick', 'movies', 'comfortable');
  await navLibraryGrid({ libraries });
  await focusGear('the movie grid');

  await press(ecp.Key.Ok);
  await waitPageMenu();
  await press(ecp.Key.Ok);
  await waitFor('#optionList.content.0.title', (t) => t === 'Presentation', {
    label: 'the Layout list',
    timeout: 10000,
  });
  // The list opens on the layout in force: OK there is a pick that changes nothing.
  await waitFor('#optionList.itemFocused', (n) => n === 1, {
    label: 'focus on the layout in force',
    timeout: 8000,
  });
  await press(ecp.Key.Ok);

  await waitDialogClosed('the pick closed the list');
  await waitFocused(atSettingsIcon, { timeout: 8000, interval: 250, label: 'the gear again' });
  expect(await getVal('#presentationInfo.visible'), 'still the poster grid').toBe(false);
  expect((await movieDisplaySettings()).layout_movies, 'nothing new saved').toBe('comfortable');
});

/**
 * A letter of the rail that some of the library's movies start with, but not all of them, so
 * a grid holding that letter's movies can be told from the whole library. Asked of the server:
 * `{ letter, railIndex, count }`, or null when no letter splits the library.
 */
async function letterThatSplitsMovies() {
  const base =
    `${session.serverUrl}/Items?UserId=${session.userId}&ParentId=${moviesId}` +
    `&IncludeItemTypes=Movie&Recursive=true&Limit=0`;
  const headers = tokenHeader(session.token);
  const total = (await getJson(base, headers))?.TotalRecordCount ?? 0;
  // The rail is #, then A to Z.
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    const count = (await getJson(`${base}&NameStartsWith=${letter}`, headers))?.TotalRecordCount;
    if (count > 0 && count < total) return { letter, railIndex: i + 1, count };
  }
  return null;
}

it('a layout change keeps the letter picked on the letter rail', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  const split = await letterThatSplitsMovies();
  if (!split) testCtx.skip('no letter holds some of the movies and not all');
  const gridHoldsTheLetter = (label) =>
    waitFor('#itemGrid.content.getChildCount()', (n) => n === split.count, {
      label: `${label}: the ${split.count} movie(s) under ${split.letter}`,
      timeout: 20000,
    });

  await launchWithMovies('page settings letter', 'movies', 'comfortable');
  await navLibraryGrid({ libraries });

  // Left from the first column enters the rail.
  await waitFocusInside('#alphaMenu', {
    label: 'the letter rail',
    timeout: 10000,
    action: resendUntilFocusInside(ecp.Key.Left, '#alphaMenu'),
  });
  await scrollFocus({
    keyPath: '#alphaMenu.itemFocused',
    target: split.railIndex,
    forwardKey: ecp.Key.Down,
    backKey: ecp.Key.Up,
    read: getActiveVal,
    stepped: true,
    within: '#alphaMenu',
    label: `the letter ${split.letter}`,
  });
  await press(ecp.Key.Ok);
  await gridHoldsTheLetter('after the letter');

  await waitFocusInside('#itemGrid', {
    label: 'the grid from the rail',
    timeout: 10000,
    action: resendUntilFocusInside(ecp.Key.Right, '#itemGrid'),
  });
  await focusGear('the filtered grid');
  await press(ecp.Key.Ok);
  await waitPageMenu();
  await press(ecp.Key.Ok);
  await waitFor('#optionList.content.0.title', (t) => t === 'Presentation', {
    label: 'the Layout list',
    timeout: 10000,
  });
  await waitFor('#optionList.itemFocused', (n) => n === 1, {
    label: 'focus on the layout in force',
    timeout: 8000,
  });
  await press(ecp.Key.Up);
  await waitFor('#optionList.itemFocused', (n) => n === 0, {
    label: 'Presentation focused',
    timeout: 8000,
  });
  await press(ecp.Key.Ok);
  await waitDialogClosed('the pick closed the list');
  // The redraw empties the grid before this turns true, so the count below is the reload's.
  await waitFor('#presentationInfo.visible', (v) => v === true, {
    label: 'the tab redrawn in presentation',
    timeout: 20000,
  });
  await gridHoldsTheLetter('after the layout change');
  await waitFocusInside('#itemGrid', { label: 'focus on the grid after the pick', timeout: 20000 });
});

it('a tab with one layout has no menu: the gear on Studios opens Settings in one press', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await launchWithMovies('page settings studios', 'studios');
  await navLibraryGrid({ libraries });
  await focusGear('the Studios grid');

  await press(ecp.Key.Ok);
  await waitSettingsScreen();
  await press(ecp.Key.Back);
  await waitFocused(atSettingsIcon, { timeout: 15000, interval: 250, label: 'the gear again' });
});

it('a library with no page settings opens Settings in one press', async (testCtx) => {
  if (!libraryIdFor(libraries, 'tvshows')) testCtx.skip('server has no "tvshows" library');
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'page settings tv');
  await waitHome();
  await navTvLibrary({ libraries });
  await focusGear('the shows grid');

  await press(ecp.Key.Ok);
  await waitSettingsScreen();
});
