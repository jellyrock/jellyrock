/**
 * Page settings: the overhang's settings icon on a screen that offers settings of its own.
 *
 * A screen only declares them (JRScreen.pageSettingsEntries); the scene presents a menu that
 * hangs under the icon, the page's entries above All settings (JRScene.openPageMenu). A movie
 * library's Movies tab offers Layout, and every library with tabs offers Default tab
 * (default-tab.spec.js covers that entry). An entry opens a list of its options, Back there
 * returns to the menu on that entry's row, and a pick applies at once: the tab is redrawn,
 * focus goes to the grid, the choice is saved for that view, and the sort and a letter picked
 * on the letter rail are left alone.
 * A screen with nothing to offer (a network opened from a TV library, which has one view and
 * one layout) still opens Settings in one press.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getJson, getLibraries, libraryIdFor, tokenHeader } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect, heldDefaultTab } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { captureRawUI } from '../capture.js';
import {
  navLibraryGrid,
  navTvLibrary,
  pressGridTile,
  waitGridLoaded,
  waitPageMenu,
  waitSettingsScreen,
} from '../lib/nav.js';
import {
  enterOverhangRow,
  getActiveVal,
  getVal,
  getVals,
  press,
  resendUntilFocusInside,
  scrollFocus,
  waitDialogClosed,
  waitFocused,
  waitFocusInside,
  waitFor,
  waitHome,
  walkOverhangRowTo,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const atSettingsIcon = (f) => f?.node?.id === 'settingsIcon';
// A sort the grid does not default to, so a reset to the default would show.
const SEEDED_SORT = 'DateCreated:desc';

let session;
let libraries;
let moviesId;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session);
  moviesId = libraryIdFor(libraries, 'movies');
});

/**
 * A cold start with the movie library seeded to open `view`, drawn in `layout` when given,
 * with any further registry values in `values`.
 */
async function launchWithMovies(label, view, layout, values = {}) {
  const expectedServer = await seedHome(session, LOCALE);
  const landing = await seedLibraryLanding(session, moviesId, view, { layout });
  // rta-run.js restores the whole registry after the run.
  await odc.writeRegistry({
    values: {
      [session.userId]: { [`display.${moviesId}.sort_movies`]: SEEDED_SORT, ...values },
    },
  });
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, label, { landing });
  await waitHome();
}

/** From a library's content: Up into the overhang row, then along it to the gear. */
async function focusGear(label) {
  await enterOverhangRow(label);
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

it('the gear on a movie library opens a menu under it: its page entries, then All settings', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await launchWithMovies('page settings menu', 'movies', 'grid');
  await navLibraryGrid({ libraries });
  await focusGear('the movie grid');

  await press(ecp.Key.Ok);
  await waitPageMenu();
  expect(await dialogRows(), 'each entry with its value, then All settings').toEqual([
    'Layout (Grid)',
    'Items per row (7)',
    'Item Titles (Shown)',
    'Default tab (Movies)',
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
  await launchWithMovies('page settings layout', 'movies', 'grid');
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
  expect(await dialogRows()).toEqual(['Presentation', 'Grid']);
  expect(await getVal('#optionList.content.1.isSelected'), 'the layout in force is marked').toBe(
    true,
  );
  await waitFor('#optionList.itemFocused', (n) => n === 1, {
    label: 'focus opens on the layout in force',
    timeout: 8000,
  });

  // Back from the list is back to the menu, on the row it was opened from.
  await press(ecp.Key.Back);
  await waitFor('#optionList.content.0.title', (t) => t === 'Layout (Grid)', {
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
  expect(saved.sort_movies, 'a layout change is not a view change: the sort stays').toBe(
    SEEDED_SORT,
  );
  expect(await heldDefaultTab(moviesId), 'and so does the default tab').toBe('movies');

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

/** The item grid's columns and cell size, as it is drawn now. */
async function gridShape() {
  const [columns, itemSize] = await getVals(['#itemGrid.numColumns', '#itemGrid.itemSize']);
  return { columns, itemSize };
}

it('Items per row lists the counts, and a pick redraws the grid and is kept', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await launchWithMovies('page settings columns', 'movies', 'grid');
  await navLibraryGrid({ libraries });
  expect(await gridShape(), 'seven to a row until a count is picked').toEqual({
    columns: 7,
    itemSize: [228, 342],
  });
  await focusGear('the movie grid');

  await press(ecp.Key.Ok);
  await waitPageMenu();
  await press(ecp.Key.Down);
  await waitFor('#optionList.itemFocused', (n) => n === 1, {
    label: 'the Items per row row',
    timeout: 8000,
  });
  await press(ecp.Key.Ok);
  await waitFor('#optionList.content.0.title', (t) => t === '3', {
    label: 'the Items per row list',
    timeout: 10000,
  });
  expect(await dialogRows()).toEqual(['3', '4', '5', '6', '7', '8', '9', '10', '11']);
  await waitFor('#optionList.itemFocused', (n) => n === 4, {
    label: 'focus opens on the count in force',
    timeout: 8000,
  });
  for (const row of [5, 6]) {
    await press(ecp.Key.Down);
    await waitFor('#optionList.itemFocused', (n) => n === row, {
      label: `row ${row} of the list`,
      timeout: 8000,
    });
  }
  await press(ecp.Key.Ok);

  await waitDialogClosed('the pick closed the list');
  await waitGridLoaded('the grid after the count pick');
  await waitFocusInside('#itemGrid', { label: 'focus on the grid after the pick', timeout: 20000 });
  expect(await gridShape(), 'nine to a row, drawn at once').toEqual({
    columns: 9,
    itemSize: [168, 252],
  });
  if (process.env.RTA_CAPTURE) await captureRawUI('page-settings-nine-per-row');

  const saved = await movieDisplaySettings();
  expect(saved.columns_movies, 'saved for the Movies view').toBe('9');
  expect(saved.sort_movies, 'a size change is not a view change: the sort stays').toBe(SEEDED_SORT);

  // Leave and come back: the library opens as it was left.
  await press(ecp.Key.Back);
  await waitHome();
  await navLibraryGrid({ libraries });
  expect((await gridShape()).columns, 'nine again on reopening').toBe(9);
});

it('Item Titles from the menu hides the titles at once and is the app-wide setting', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await launchWithMovies('page settings titles', 'movies', 'grid');
  await navLibraryGrid({ libraries });
  const before = await getVals(['#itemGrid.itemSpacing', '#itemGrid.content.0.title']);
  expect(before[0], 'the row gap holds a line of title').toEqual([21, 69]);
  await focusGear('the movie grid');

  await press(ecp.Key.Ok);
  await waitPageMenu();
  for (const row of [1, 2]) {
    await press(ecp.Key.Down);
    await waitFor('#optionList.itemFocused', (n) => n === row, {
      label: `row ${row} of the menu`,
      timeout: 8000,
    });
  }
  await press(ecp.Key.Ok);
  await waitFor('#optionList.content.0.title', (t) => t === 'Shown', {
    label: 'the Item Titles list',
    timeout: 10000,
  });
  expect(await getVal('#jrDialog.title'), 'the list says how far the setting reaches').toBe(
    'Item Titles (all libraries)',
  );
  await press(ecp.Key.Down);
  await waitFor('#optionList.itemFocused', (n) => n === 1, {
    label: 'Hidden focused',
    timeout: 8000,
  });
  await press(ecp.Key.Ok);

  await waitDialogClosed('the pick closed the list');
  await waitGridLoaded('the grid after the titles pick');
  await waitFocusInside('#itemGrid', { label: 'focus on the grid after the pick', timeout: 20000 });
  const [spacing, isShown, setting] = await getVals([
    '#itemGrid.itemSpacing',
    '#routerOutlet.showItemTitles',
    '#itemGrid.numColumns',
  ]);
  expect(spacing, 'the row gap closes to the column gap').toEqual([21, 21]);
  expect(setting, 'the count is untouched').toBe(7);
  expect(isShown).not.toBe(true);
  const settings = (
    await odc.getValue({ base: 'global', keyPath: 'user.settings.itemGridShowTitles' })
  )?.value;
  expect(settings, 'the app-wide setting is what changed').toBe(false);
  if (process.env.RTA_CAPTURE) await captureRawUI('page-settings-titles-hidden');
});

/**
 * Each grid cell's title, as drawn. `#itemGrid.<n>` is the grid's nth rendered cell, not its
 * nth item, so the cells come back in no particular order; a cell with no text (a loading
 * cell, or one not bound) is left out.
 */
async function cellTitles() {
  const cells = 24;
  const paths = [];
  for (let i = 0; i < cells; i++)
    paths.push(`#itemGrid.${i}.#itemText.text`, `#itemGrid.${i}.#itemText.visible`);
  const values = await getVals(paths);
  const titles = [];
  for (let i = 0; i < cells; i++) {
    const text = values[2 * i];
    if (typeof text === 'string' && text !== '') titles.push({ text, visible: values[2 * i + 1] });
  }
  return titles;
}

/** Star from the grid, then menu row `menuRow`, then list row `listRow` of a list whose first row reads `firstRow`. */
async function pickFromStar(label, menuRow, firstRow, listRow) {
  await press(ecp.Key.Option);
  await waitPageMenu(label);
  await scrollFocus({
    keyPath: '#optionList.itemFocused',
    target: menuRow,
    forwardKey: ecp.Key.Down,
    backKey: ecp.Key.Up,
    label: `${label}: the menu row`,
  });
  await press(ecp.Key.Ok);
  await waitFor('#optionList.content.0.title', (t) => t === firstRow, {
    label: `${label}: the list`,
    timeout: 10000,
  });
  await scrollFocus({
    keyPath: '#optionList.itemFocused',
    target: listRow,
    forwardKey: ecp.Key.Down,
    backKey: ecp.Key.Up,
    label: `${label}: the list row`,
  });
  await press(ecp.Key.Ok);
  await waitDialogClosed(label);
  await waitFocusInside('#itemGrid', { label: `${label}: focus on the grid`, timeout: 20000 });
}

it('a pick from the page menu redraws the grid in place: same item, same items, no reload', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await launchWithMovies('page settings in place', 'movies', 'grid', {
    [`display.${moviesId}.columns_movies`]: '3',
  });
  await navLibraryGrid({ libraries });
  await waitFocusInside('#itemGrid', { label: 'focus on the movie grid', timeout: 20000 });
  // Three to a row puts the seventh movie on the third row: far enough in to be lost by a reload
  const focused = 6;
  await scrollFocus({
    keyPath: '#itemGrid.itemFocused',
    target: focused,
    forwardKey: ecp.Key.Down,
    stride: 3,
    label: 'to the seventh movie',
  });
  // A reload builds a new content node, so a mark on this one says whether the items were kept
  await odc.setValue({ keyPath: '#itemGrid.content.title', value: 'rta-kept' });

  async function expectKept(label, columns) {
    const [index, count, mark, stripTitle, focusedTitle] = await getVals([
      '#itemGrid.itemFocused',
      '#itemGrid.numColumns',
      '#itemGrid.content.title',
      '#headerStrip.#title.text',
      `#itemGrid.content.${focused}.title`,
    ]);
    expect(count, `${label}: the count drawn`).toBe(columns);
    expect(index, `${label}: the same item in focus`).toBe(focused);
    expect(mark, `${label}: the same items, not a reload`).toBe('rta-kept');
    expect(typeof focusedTitle, `${label}: the focused item read`).toBe('string');
    expect(stripTitle, `${label}: the strip names it`).toBe(focusedTitle);
  }

  async function expectTitles(label, isShown) {
    const titles = await cellTitles();
    expect(titles.length, `${label}: cells read`).toBeGreaterThan(0);
    for (const cell of titles) expect(cell.visible, `${label}: "${cell.text}"`).toBe(isShown);
  }

  await pickFromStar('nine to a row', 1, '3', 6);
  await expectKept('nine to a row', 9);
  await expectTitles('nine to a row', true);

  // A cell the grid keeps on its item gets no new bind: it has to follow the setting itself
  await pickFromStar('titles hidden', 2, 'Shown', 1);
  await expectKept('titles hidden', 9);
  await expectTitles('titles hidden', false);

  await pickFromStar('the presentation layout', 0, 'Presentation', 0);
  await expectKept('the presentation layout', 9);
  expect(await getVal('#presentationInfo.visible'), 'the panel shows').toBe(true);

  await pickFromStar('the grid layout', 0, 'Presentation', 1);
  await expectKept('the grid layout', 9);
  expect(await getVal('#presentationInfo.visible'), 'the panel is gone').toBe(false);

  // The titles changed while the library was covered, as Settings or another library's
  // menu changes them: the way back redraws, and keeps the place
  await press(ecp.Key.Ok);
  await waitFor('#videoTitle.text', (t) => typeof t === 'string' && t !== '', {
    label: "the movie's details",
    timeout: 20000,
  });
  await odc.setValue({ base: 'global', keyPath: 'user.settings.itemGridShowTitles', value: true });
  await press(ecp.Key.Back);
  await waitFocusInside('#itemGrid', { label: 'back on the grid', timeout: 20000 });
  await expectKept('back from the details', 9);
  await expectTitles('back from the details', true);
});

it('a layout whose grid starts lower offers only the counts that fit', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  const expectedServer = await seedHome(session, LOCALE);
  const landing = await seedLibraryLanding(session, moviesId, 'movies', { layout: 'presentation' });
  await odc.writeRegistry({
    values: { [session.userId]: { [`display.${moviesId}.columns_movies`]: '3' } },
  });
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'page settings columns floor', { landing });
  await waitHome();
  await navLibraryGrid({ libraries });
  expect((await gridShape()).columns, 'three does not fit under the panel: five is drawn').toBe(5);

  await focusGear('the movie grid');
  await press(ecp.Key.Ok);
  await waitPageMenu();
  expect((await dialogRows())[1]).toBe('Items per row (5)');
  await press(ecp.Key.Down);
  await waitFor('#optionList.itemFocused', (n) => n === 1, {
    label: 'the Items per row row',
    timeout: 8000,
  });
  await press(ecp.Key.Ok);
  await waitFor('#optionList.content.0.title', (t) => t === '5', {
    label: 'the Items per row list',
    timeout: 10000,
  });
  expect(await dialogRows()).toEqual(['5', '6', '7', '8', '9', '10', '11']);
  expect((await movieDisplaySettings()).columns_movies, 'the saved count is left alone').toBe('3');
  await press(ecp.Key.Back);
  await waitFor('#optionList.content.0.title', (t) => t === 'Layout (Presentation)', {
    label: 'the menu again',
    timeout: 10000,
  });
  await press(ecp.Key.Back);
  await waitDialogClosed('Back closed the menu');
});

it('picking the layout already in force closes the list and changes nothing', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  await launchWithMovies('page settings same pick', 'movies', 'grid');
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
  expect((await movieDisplaySettings()).layout_movies, 'nothing new saved').toBe('grid');
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

  await launchWithMovies('page settings letter', 'movies', 'grid');
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

it('a screen with one view still has a page menu, for its grid: a network in a TV library', async (testCtx) => {
  const tvId = libraryIdFor(libraries, 'tvshows');
  if (!tvId) testCtx.skip('server has no "tvshows" library');
  const expectedServer = await seedHome(session, LOCALE);
  const landing = await seedLibraryLanding(session, tvId, 'networks');
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'page settings network', { landing });
  await waitHome();
  await navTvLibrary({ libraries });
  if ((await getActiveVal('#itemGrid.content.getChildCount()')) < 1)
    testCtx.skip('the TV library lists no networks');

  // A network folder has one view, no tabs and no layouts: its menu is its grid's count alone.
  await pressGridTile(0);
  await waitFor('parentItem.id', (id) => typeof id === 'string' && id !== '' && id !== tvId, {
    label: 'the network opened',
    timeout: 20000,
    read: getActiveVal,
  });
  await waitGridLoaded('the network');
  await waitFocusInside('#itemGrid', { label: 'focus on the network grid', timeout: 20000 });
  await focusGear('the network grid');

  await press(ecp.Key.Ok);
  await waitPageMenu();
  expect(await dialogRows(), "the grid's two entries, then All settings").toEqual([
    'Items per row (7)',
    'Item Titles (Shown)',
    'All settings',
  ]);

  // All settings is still there, at the end.
  for (const row of [1, 2]) {
    await press(ecp.Key.Down);
    await waitFor('#optionList.itemFocused', (n) => n === row, {
      label: `row ${row} of the menu`,
      timeout: 8000,
    });
  }
  await press(ecp.Key.Ok);
  await waitSettingsScreen();
  await press(ecp.Key.Back);
  await waitFocused(atSettingsIcon, { timeout: 15000, interval: 250, label: 'the gear again' });
});
