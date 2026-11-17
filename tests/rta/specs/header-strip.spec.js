/**
 * The library header strip: the row under the tabs with the Sort and Filter chips.
 *
 * Up from the content's first row lands on the strip and Up again on the tabs; Down walks
 * back. Sort opens a menu under its chip with the fields and an Order row. Filter opens a
 * menu of categories that combine: a status from a single-choice list, a server category
 * from a checklist where a tick counts when it is made and Back leaves. Star does what the
 * settings icon does. Replay then Up reaches the strip from deep in a grid.
 *
 * Content is read off the app before it is asserted, and a case skips, with its reason, on
 * a server without what it needs. Row names are the app's English ones.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import {
  applyLibraryFilter,
  applyLibrarySort,
  focusGridTile,
  focusLibraryChip,
  listDialogRows,
  navLibraryByType,
  selectLibraryTab,
  waitGridLoaded,
  waitSettingsScreen,
} from '../lib/nav.js';
import {
  focusIsInside,
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
} from '../lib/steps.js';

const LOCALE = 'en_US';
const inTabBar = (f) => f?.node?.subtype === 'JRTabBar';

let session;
let libraries;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session);
});

/**
 * A cold start, then the `collectionType` library opened on `tab` with focus on its first
 * item. `content` is the list that holds it: the grid, or the row list on a Genres tab.
 */
async function openLibraryTab(collectionType, label, tab, testCtx, content = '#itemGrid') {
  const libraryId = libraryIdFor(libraries, collectionType);
  if (!libraryId) testCtx.skip(`server has no "${collectionType}" library`);
  const expectedServer = await seedHome(session, LOCALE);
  const landing = await seedLibraryLanding(session, libraryId, tab, { layout: 'grid' });
  // rta-run.js restores the whole registry after the run.
  await odc.writeRegistry({
    values: { [session.userId]: { [`display.${libraryId}.sort_${tab}`]: null } },
  });
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, label, { landing });
  await waitHome();
  await navLibraryByType(collectionType, libraryId);
  await waitGridLoaded(label);
  await waitFocusInside(content, { label: `${label}: focus on the content`, timeout: 8000 });
  return libraryId;
}

/** A cold start, then the movie library opened on `tab` with focus on its first item. */
const openMovies = (label, tab = 'movies', testCtx) =>
  openLibraryTab('movies', label, tab, testCtx);

/**
 * A TV library's Genres tab, which offers no filter category: its Filter chip shows only
 * while something narrows the tab. Skips where the server's tab offers one.
 */
async function openTabWithNoFilterCategory(label, testCtx) {
  await openLibraryTab('tvshows', label, 'genres', testCtx, '#genreList');
  if (await getActiveVal('#headerStrip.#filterChip.visible'))
    testCtx.skip("the TV library's Genres tab offers a filter category on this server");
}

/** Pick the rail's first letter ("A") from the content, and wait for the narrowed load. */
async function pickFirstLetter(label) {
  await waitFocusInside('#alphaMenu', {
    label: `the letter rail (${label})`,
    timeout: 10000,
    action: resendUntilFocusInside(ecp.Key.Left, '#alphaMenu'),
  });
  await press(ecp.Key.Down); // from "#" to "A"
  await press(ecp.Key.Ok);
  // The strip says so at the press, before the load: it tells this load from the last one
  await waitFor('#headerStrip.#narrowedBy.text', (t) => /^Filtered by: \S+$/.test(t ?? ''), {
    label: `the strip saying a letter narrows the tab (${label})`,
    timeout: 10000,
    read: getActiveVal,
  });
  await waitGridLoaded(`narrowed to a letter (${label})`);
}

/** What the app holds as the session's filters for one tab, category names in lowercase. */
async function tabFilters(libraryId, tab) {
  const entries =
    (await odc.getValue({ base: 'global', keyPath: 'user.libraryFilters' }))?.value ?? {};
  const entry = entries[`${libraryId}/${tab}`] ?? {};
  return Object.fromEntries(Object.entries(entry).map(([k, v]) => [k.toLowerCase(), v]));
}

/** The saved sort of one tab, as the registry holds it ("SortName:asc"), or undefined. */
async function savedSort(libraryId, tab) {
  const all = (await odc.getValue({ base: 'global', keyPath: 'user.settings.displaySettings' }))
    ?.value;
  return all?.[libraryId]?.[`sort_${tab}`];
}

const chipText = (chip) => getActiveVal(`#headerStrip.#${chip}Chip.text`);

/** Walk the list dialog on show to row `index`. */
async function focusDialogRow(index, label) {
  await waitFocusInside('#optionList', { label: `the list for ${label}`, timeout: 8000 });
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
}

/** The index of the row named `name` (with or without a value after it), or -1. */
const rowNamed = (rows, name) => rows.findIndex((t) => t === name || t?.startsWith(`${name} (`));

it('Up from the first row lands on the strip, then the tabs, and Down walks back', async (testCtx) => {
  await openMovies('header strip walk', 'movies', testCtx);

  await press(ecp.Key.Up);
  await waitFocusInside('#sortChip', { label: 'the Sort chip, Up from the grid', timeout: 8000 });
  await press(ecp.Key.Right);
  await waitFocusInside('#filterChip', { label: 'the Filter chip, Right of Sort', timeout: 8000 });
  await press(ecp.Key.Right);
  await press(ecp.Key.Right);
  await waitFocusInside('#filterChip', { label: 'the walk stops at the last chip', timeout: 8000 });

  await press(ecp.Key.Up);
  await waitFocused(inTabBar, {
    timeout: 8000,
    interval: 250,
    label: 'the tabs, Up from the strip',
  });
  await press(ecp.Key.Down);
  await waitFocusInside('#filterChip', {
    label: 'the chip used last, Down from the tabs',
    timeout: 8000,
  });
  await press(ecp.Key.Down);
  await waitFocusInside('#itemGrid', { label: 'the grid, Down from the strip', timeout: 8000 });
  expect(await getActiveVal('#itemGrid.itemFocused'), 'on the item it left').toBe(0);

  // The strip names the focused item
  const title = await getActiveVal('#itemGrid.content.0.title');
  expect(await getActiveVal('#headerStrip.#title.text'), 'the strip names the focused item').toBe(
    title,
  );
});

it('Sort opens under its chip, marks the field in force, and the Order row flips the direction', async (testCtx) => {
  const libraryId = await openMovies('header strip sort', 'movies', testCtx);
  expect(await chipText('sort'), 'the chip names the default sort').toBe('Sort: Title ↑');

  await focusLibraryChip('sort');
  await press(ecp.Key.Ok);
  await waitFocusInside('#optionList', { label: 'the Sort menu', timeout: 8000 });
  const rows = await listDialogRows();
  expect(rows[0], 'the fields come first').toBe('Title');
  expect(rows.at(-1), 'the Order row is last and names the direction').toBe('Order: Ascending');
  expect(await getVal('#optionList.itemFocused'), 'focus opens on the field in force').toBe(0);
  expect(await getVal('#optionList.content.0.isSelected'), 'which is marked').toBe(true);

  const chip = await getActiveVal('#headerStrip.#sortChip.sceneBoundingRect()');
  const panel = await getVal('#jrDialog.#chrome.#panelBackground.sceneBoundingRect()');
  expect(panel.y, 'the menu hangs under the chip').toBeGreaterThanOrEqual(chip.y + chip.height);

  await focusDialogRow(rows.length - 1, 'the Order row');
  await press(ecp.Key.Ok);
  await waitDialogClosed('the Sort menu after Order');
  await waitGridLoaded('the grid, sorted the other way');
  await waitFocusInside('#sortChip', { label: 'focus back on the Sort chip', timeout: 8000 });
  expect(await chipText('sort'), 'the chip points the other way').toBe('Sort: Title ↓');
  expect(await savedSort(libraryId, 'movies'), 'and the sort is saved for the tab').toBe(
    'SortName:desc',
  );

  // Picking another field keeps the direction
  await press(ecp.Key.Down);
  await waitFocusInside('#itemGrid', { label: 'the grid', timeout: 8000 });
  await applyLibrarySort(1);
  expect(await savedSort(libraryId, 'movies'), 'a field picked keeps the direction').toMatch(
    /^(?!SortName:).+:desc$/,
  );
});

it('filters combine: a status and a checklist category, and Clear filters removes both', async (testCtx) => {
  const libraryId = await openMovies('header strip filters', 'movies', testCtx);
  expect(await chipText('filter'), 'no filter yet').toBe('Filter');

  await applyLibraryFilter('Status', 'Unplayed');
  expect(await tabFilters(libraryId, 'movies'), 'the status is kept').toEqual({
    status: ['Unplayed'],
  });
  expect(await chipText('filter')).toBe('Filter: 1');

  // A checklist category: tick a row, Back, and the tick is kept.
  await focusLibraryChip('filter');
  await press(ecp.Key.Ok);
  await waitFor('#optionList.content.0.title', (t) => t === 'Clear filters', {
    label: 'the Filter menu, Clear filters first',
    timeout: 10000,
  });
  let rows = await listDialogRows();
  const genresRow = rowNamed(rows, 'Genres');
  if (genresRow < 0) testCtx.skip('the library offers no Genres category');
  expect(rows[rowNamed(rows, 'Status')], 'the status row says what is set').toBe(
    'Status (Unplayed)',
  );
  await focusDialogRow(genresRow, 'the Genres category');
  await press(ecp.Key.Ok);
  // The checklist replaces the menu: its first row is a genre, not Clear filters
  const firstGenre = await waitFor(
    '#optionList.content.0.title',
    (t) => typeof t === 'string' && t.length > 0 && t !== 'Clear filters',
    { label: 'the Genres checklist', timeout: 10000 },
  );
  await waitFocusInside('#optionList', { label: 'the Genres checklist', timeout: 8000 });
  await press(ecp.Key.Ok); // tick the first genre
  await press(ecp.Key.Back);
  await waitFor('#optionList.content.0.title', (t) => t === 'Clear filters', {
    label: 'the Filter menu, back from the checklist',
    timeout: 10000,
  });
  rows = await listDialogRows();
  expect(rows[rowNamed(rows, 'Genres')], 'the menu counts the tick').toBe('Genres (1)');
  expect(await tabFilters(libraryId, 'movies'), 'both categories are kept').toEqual({
    status: ['Unplayed'],
    genres: [firstGenre],
  });

  // Back out of a checklist with no change keeps what was set
  await focusDialogRow(rowNamed(rows, 'Genres'), 'the Genres category again');
  await press(ecp.Key.Ok);
  await waitFor('#optionList.content.0.title', (t) => t === firstGenre, {
    label: 'the Genres checklist again',
    timeout: 10000,
  });
  await waitFocusInside('#optionList', { label: 'the Genres checklist again', timeout: 8000 });
  await press(ecp.Key.Back);
  await waitFor('#optionList.content.0.title', (t) => t === 'Clear filters', {
    label: 'the Filter menu, back with no change',
    timeout: 10000,
  });
  expect((await tabFilters(libraryId, 'movies')).genres, 'no change, nothing lost').toEqual([
    firstGenre,
  ]);

  // Clear filters is the first row
  await focusDialogRow(0, 'Clear filters');
  await press(ecp.Key.Ok);
  await waitDialogClosed('the Filter menu after Clear filters');
  await waitGridLoaded('the grid, unfiltered');
  expect(await tabFilters(libraryId, 'movies'), 'nothing narrows the tab').toEqual({});
  expect(await chipText('filter')).toBe('Filter');
  await waitFocusInside('#filterChip', { label: 'focus back on the Filter chip', timeout: 8000 });
});

it('a sort change keeps the letter picked on the rail', async (testCtx) => {
  await openMovies('header strip letter', 'movies', testCtx);
  await pickFirstLetter('movies');
  const narrowed = await getActiveVal('#headerStrip.#narrowedBy.text');

  await waitFocusInside('#itemGrid', {
    label: 'the grid, Right from the rail',
    timeout: 10000,
    action: resendUntilFocusInside(ecp.Key.Right, '#itemGrid'),
  });
  if ((await getActiveVal('#itemGrid.content.getChildCount()')) < 1)
    testCtx.skip('no movie starts with that letter: no first row to walk Up from');
  await applyLibrarySort(1);
  expect(await getActiveVal('#headerStrip.#narrowedBy.text'), 'the letter is still in force').toBe(
    narrowed,
  );
});

it('Clear filters moves the focus off a Filter chip it takes away', async (testCtx) => {
  // Clear filters hides the chip its menu opened from
  await openTabWithNoFilterCategory('header strip clear on genres', testCtx);

  await pickFirstLetter('genres');
  expect(
    await getActiveVal('#headerStrip.#filterChip.visible'),
    'a letter brings the Filter chip, for Clear filters',
  ).toBe(true);
  await waitFocusInside('#genreList', {
    label: 'the genre rows, Right from the rail',
    timeout: 10000,
    action: resendUntilFocusInside(ecp.Key.Right, '#genreList'),
  });

  await focusLibraryChip('filter');
  await press(ecp.Key.Ok);
  await waitFor('#optionList.content.0.title', (t) => t === 'Clear filters', {
    label: 'the Filter menu, Clear filters alone',
    timeout: 10000,
  });
  await waitFocusInside('#optionList', { label: 'the Filter menu', timeout: 8000 });
  await press(ecp.Key.Ok);
  await waitDialogClosed('the Filter menu after Clear filters');
  await waitFor('#headerStrip.#filterChip.visible', (v) => v === false, {
    label: 'the Filter chip gone with nothing narrowing the tab',
    timeout: 10000,
    read: getActiveVal,
  });

  // Focus is on something the viewer can see: the Sort chip while it shows, else the content
  const next = (await getActiveVal('#headerStrip.#sortChip.visible')) ? '#sortChip' : '#genreList';
  await waitFocusInside(next, {
    label: `focus on ${next}, off the hidden Filter chip`,
    timeout: 8000,
  });
});

it('a voice search brings the Filter chip to a tab with no filter category', async (testCtx) => {
  await openTabWithNoFilterCategory('header strip voice on genres', testCtx);

  // The firmware writes the spoken text to the voice box; the screen observes that field
  await odc.setValue({ base: 'scene', keyPath: '#VoiceBox.text', value: 'a' });
  await waitFor('#headerStrip.#filterChip.visible', (v) => v === true, {
    label: 'the Filter chip, with Clear filters behind it',
    timeout: 10000,
    read: getActiveVal,
  });
  expect(await getActiveVal('#headerStrip.#narrowedBy.text'), 'the strip names the search').toBe(
    'Filtered by: a',
  );
});

it('a screen with no tabs is titled with its name alone, underlined as a selected tab is', async (testCtx) => {
  // The reference: the selected tab's underline in a library with tabs
  await openMovies('header strip title reference', 'movies', testCtx);
  const tabLine = await getVal('#overhang.#tabContainer.0.#buttonIndicator.sceneBoundingRect()');

  // A playlists or collections library has one view, so it shows a title in the tabs' place
  const library = (libraries || []).find((l) =>
    ['playlists', 'boxsets'].includes(l.collectionType),
  );
  if (!library) testCtx.skip('server has no playlists or collections library');
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'header strip title');
  await waitHome();
  await navLibraryByType(library.collectionType, library.id);
  await waitGridLoaded('the one-view library');
  await waitFocusInside('#itemGrid', { label: 'the one-view library: focus on the grid' });

  expect(await getVal('#overhang.#title.text'), 'the title is the name alone').toBe(library.name);
  if ((await getActiveVal('#itemGrid.content.getChildCount()')) > 0) {
    expect(await getActiveVal('#headerStrip.#count.text'), 'the strip gives the place').toMatch(
      /^1 of \d+$/,
    );
  }

  expect(await getVal('#overhang.#titleUnderline.visible'), 'the title is underlined').toBe(true);
  const titleLine = await getVal('#overhang.#titleUnderline.sceneBoundingRect()');
  expect(titleLine.x, "from where a first tab's text starts").toBeCloseTo(tabLine.x, 0);
  expect(titleLine.y, "at the height of a tab's underline").toBeCloseTo(tabLine.y, 0);
  expect(titleLine.height, 'and its weight').toBe(tabLine.height);

  // A letter narrows the tab: the strip says so, and the title stays the name
  await pickFirstLetter('the one-view library');
  expect(await getVal('#overhang.#title.text'), 'the title does not repeat it').toBe(library.name);
});

it('Replay then Up reaches the strip from deep in the grid', async (testCtx) => {
  await openMovies('header strip replay', 'movies', testCtx);
  const count = await getActiveVal('#itemGrid.content.getChildCount()');
  const columns = await getActiveVal('#itemGrid.numColumns');
  if (!(count > columns)) testCtx.skip(`the library holds ${count} movie(s): no second row`);

  await focusGridTile(1);
  await press(ecp.Key.Down);
  await waitFor('#itemGrid.itemFocused', (n) => n >= columns, {
    label: 'a row below the first',
    timeout: 8000,
    read: getActiveVal,
  });
  await press(ecp.Key.Replay);
  await waitFor('#itemGrid.itemFocused', (n) => n === 0, {
    label: 'Replay back on the first item',
    timeout: 8000,
    read: getActiveVal,
  });
  await press(ecp.Key.Up);
  await waitFocused((f) => focusIsInside(f.keyPath, '#headerStrip'), {
    timeout: 8000,
    interval: 250,
    label: 'the strip, Up from the first item',
  });
});

it('Star on a screen with no page settings opens Settings, as the settings icon does', async (testCtx) => {
  // A collections library has one view and one layout, so it declares no page settings
  const libraryId = libraryIdFor(libraries, 'boxsets');
  if (!libraryId) testCtx.skip('server has no collections library');
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'header strip star, no page settings');
  await waitHome();
  await navLibraryByType('boxsets', libraryId);
  await waitGridLoaded('the collections library');
  await waitFocusInside('#itemGrid', { label: 'the collections library: focus on the grid' });

  await press(ecp.Key.Option);
  await waitSettingsScreen();
});

it('the TV guide shows the Filter chip only, and names the focused program', async (testCtx) => {
  const libraryId = libraryIdFor(libraries, 'livetv');
  if (!libraryId) testCtx.skip('server has no Live TV library');
  const expectedServer = await seedHome(session, LOCALE);
  const landing = await seedLibraryLanding(session, libraryId, 'channels');
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'header strip guide', { landing });
  await waitHome();
  await navLibraryByType('livetv', libraryId);
  await waitGridLoaded('the Channels tab');
  expect(await getActiveVal('#headerStrip.#sortChip.visible'), 'Channels sorts').toBe(true);

  await selectLibraryTab('guide');
  await waitFor('#headerStrip.#title.text', (t) => typeof t === 'string' && t.length > 0, {
    label: 'the strip naming the focused program',
    timeout: 30000,
    read: getActiveVal,
  });
  expect(await getActiveVal('#headerStrip.#sortChip.visible'), 'the guide takes no sort').toBe(
    false,
  );
  expect(await getActiveVal('#headerStrip.#filterChip.visible'), 'and keeps its filter').toBe(true);
  expect(await getActiveVal('#headerStrip.#count.text'), "with the channel's place").toMatch(
    /^1 of \d+$/,
  );
});
