/**
 * Library tabs: a library's views as tabs in the overhang.
 *
 * A library declares its tabs once it has its item, with the tab it resolved selected; a
 * tab press switches the view in place with focus on the content, and nothing but a tab
 * press changes the tab afterwards. A movie or TV library has a Favorites tab: its content
 * tab's view with favorites fixed on, which says so when it is empty. A studio, network or
 * genre opened inside a library has one view, so it shows its name and no tabs.
 *
 * Content is asked of the server before it is asserted, and a case skips, with its reason,
 * on a server without the library it needs.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import {
  authenticate,
  genreItemNames,
  getJson,
  getLibraries,
  libraryIdFor,
  setFavorite,
  tokenHeader,
} from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { failRequests } from '../lib/failRequests.js';
import {
  focusDetailButton,
  focusGridTile,
  navLibraryByType,
  overhangSelectedTab,
  overhangTabIds,
  pressGridTile,
  selectHomeTab,
  selectLibraryTab,
  waitGridLoaded,
} from '../lib/nav.js';
import {
  getActiveVal,
  getActiveVals,
  getVals,
  press,
  resendUntilFocusInside,
  scrollFocus,
  waitFocused,
  waitFocusInside,
  waitFor,
  waitHome,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const GRID_READ = 'itemQuery_usersItems';
const inTabBar = (f) => f?.node?.subtype === 'JRTabBar';

let session;
let libraries;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session);
});

/** A cold start, then the `collectionType` library opened, seeded to open on `view` when given. */
async function openLibrary(label, collectionType, view) {
  const libraryId = libraryIdFor(libraries, collectionType);
  const expectedServer = await seedHome(session, LOCALE);
  const landing = view ? await seedLibraryLanding(session, libraryId, view) : null;
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, label, landing ? { landing } : {});
  await waitHome();
  await navLibraryByType(collectionType, libraryId);
  return libraryId;
}

/** How many of a library's items of `itemType` the server holds as favorites. */
async function favoriteCount(libraryId, itemType) {
  const url =
    `${session.serverUrl}/Items?UserId=${session.userId}&ParentId=${libraryId}` +
    `&IncludeItemTypes=${itemType}&Recursive=true&IsFavorite=true&Limit=0`;
  const count = (await getJson(url, tokenHeader(session.token)))?.TotalRecordCount;
  expect(typeof count, 'the server answered with a count').toBe('number');
  return count;
}

/** What the app holds for a library's display settings (its registry keys, in memory). */
async function displaySettings(libraryId) {
  const all = (await odc.getValue({ base: 'global', keyPath: 'user.settings.displaySettings' }))
    ?.value;
  return all?.[libraryId] ?? {};
}

/** The screen's tab and view, and what the overhang draws, in one batch. */
async function tabState() {
  const [selectedTabId, currentView] = await getActiveVals(['selectedTabId', 'currentView']);
  return { selectedTabId, currentView, drawn: await overhangSelectedTab() };
}

for (const [collectionType, contentTab, savedTab] of [
  ['movies', 'movies', 'studios'],
  ['tvshows', 'shows', 'networks'],
]) {
  it(`a ${collectionType} library shows its tabs, with the saved tab selected and not the first`, async (testCtx) => {
    if (!libraryIdFor(libraries, collectionType))
      testCtx.skip(`server has no "${collectionType}" library`);
    await openLibrary(`library tabs ${collectionType}`, collectionType, savedTab);

    const ids = await overhangTabIds();
    expect(ids.slice(0, 2), 'the content tab, then Favorites').toEqual([contentTab, 'favorites']);
    expect(ids, 'the saved tab is offered').toContain(savedTab);
    expect(ids.indexOf(savedTab), 'and is not the first tab').toBeGreaterThan(0);
    expect(await tabState(), 'the screen and the overhang agree on the saved tab').toEqual({
      selectedTabId: savedTab,
      currentView: savedTab,
      drawn: savedTab,
    });
    const [mode, titleVisible] = await getVals([
      '#overhang.#tabBar.mode',
      '#overhang.#title.visible',
    ]);
    expect(mode, 'a library scrolls its tabs').toBe('scrolling');
    expect(titleVisible, 'the tabs replace the title').toBe(false);
  });
}

it('a library opened after Home used its own tabs still shows its own tab selected', async (testCtx) => {
  const libraryId = libraryIdFor(libraries, 'movies');
  if (!libraryId) testCtx.skip('server has no "movies" library');
  const expectedServer = await seedHome(session, LOCALE);
  const landing = await seedLibraryLanding(session, libraryId, 'genres');
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'library tabs after home tabs', { landing });
  // The bar last drew Home's selection, and "favorites" is a library tab id too.
  await selectHomeTab('favorites');
  await selectHomeTab('home');
  await navLibraryByType('movies', libraryId);

  expect(await tabState()).toEqual({
    selectedTabId: 'genres',
    currentView: 'genres',
    drawn: 'genres',
  });
});

it('a tab press shows the tab with focus on the content, and later loads keep the tab', async (testCtx) => {
  const libraryId = libraryIdFor(libraries, 'movies');
  if (!libraryId) testCtx.skip('server has no "movies" library');
  await openLibrary('library tabs press', 'movies', 'movies');

  await selectLibraryTab('studios');
  // At the press, before the load lands: the old grid is emptied in the same step.
  await waitFocusInside('#itemGrid', { label: 'focus on the content at the press', timeout: 8000 });
  await waitGridLoaded('the Studios tab');
  expect(await tabState()).toEqual({
    selectedTabId: 'studios',
    currentView: 'studios',
    drawn: 'studios',
  });
  expect((await displaySettings(libraryId)).landing, 'a tab press does not save the tab').toBe(
    'movies',
  );

  // OK on the tab already selected does nothing: no reload, and focus stays in the bar.
  await waitFocused(inTabBar, {
    timeout: 8000,
    interval: 400,
    action: async () => {
      const f = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
      if (f?.node && !inTabBar(f)) await press(ecp.Key.Up);
    },
    label: 'the tab bar from the Studios grid',
  });
  await press(ecp.Key.Ok);
  await press(ecp.Key.Down);
  await waitFocusInside('#itemGrid', { label: 'Down returns to the grid', timeout: 8000 });
  expect(await getActiveVal('loadState'), 'the same tab again reloads nothing').toBe('loaded');

  // A letter on the rail reloads the grid: the tab stays.
  await waitFocusInside('#alphaMenu', {
    label: 'the letter rail',
    timeout: 10000,
    action: resendUntilFocusInside(ecp.Key.Left, '#alphaMenu'),
  });
  await press(ecp.Key.Ok);
  await waitFor('#itemGrid.content.getChildCount()', (n) => typeof n === 'number', {
    label: 'the grid reloaded for the letter',
    timeout: 20000,
    read: getActiveVal,
  });
  await waitGridLoaded('the Studios tab under a letter');
  expect(await tabState(), 'after a letter').toEqual({
    selectedTabId: 'studios',
    currentView: 'studios',
    drawn: 'studios',
  });

  // Replay from the rail clears the letter and reloads: the tab stays.
  await press(ecp.Key.Replay);
  await waitGridLoaded('the Studios tab after Replay');
  expect(await tabState(), 'after Replay').toEqual({
    selectedTabId: 'studios',
    currentView: 'studios',
    drawn: 'studios',
  });
});

it("the Favorites tab shows the content tab's favorites and draws as that tab", async (testCtx) => {
  const libraryId = libraryIdFor(libraries, 'movies');
  if (!libraryId) testCtx.skip('server has no "movies" library');
  const favorites = await favoriteCount(libraryId, 'Movie');
  await openLibrary('library tabs favorites', 'movies', 'movies');

  await selectLibraryTab('favorites');
  await waitGridLoaded('the Favorites tab');
  expect(await tabState(), 'a tab of its own, drawn as the Movies view').toEqual({
    selectedTabId: 'favorites',
    currentView: 'movies',
    drawn: 'favorites',
  });
  const [count, emptyVisible, emptyText] = await getActiveVals([
    '#itemGrid.content.getChildCount()',
    '#emptyText.visible',
    '#emptyText.text',
  ]);
  // A grid page holds 100.
  expect(count, 'the favorites the server holds for this library').toBe(Math.min(favorites, 100));
  if (favorites === 0) {
    expect(emptyVisible).toBe(true);
    expect(emptyText).toBe('No favorites yet');
  } else {
    expect(emptyVisible).toBe(false);
  }
});

it('an empty Favorites tab says so, and Up from it returns to the tabs', async (testCtx) => {
  const libraryId = libraryIdFor(libraries, 'movies');
  if (!libraryId) testCtx.skip('server has no "movies" library');
  await openLibrary('library tabs empty favorites', 'movies', 'movies');
  // Whatever the server holds, this tab's load comes back empty.
  await failRequests([{ prefix: GRID_READ, kind: 'empty', times: 1 }]);

  await selectLibraryTab('favorites');
  await waitFor('loadState', (v) => v === 'empty', {
    label: 'the Favorites tab empty',
    timeout: 20000,
    read: getActiveVal,
  });
  const [emptyVisible, emptyText] = await getActiveVals(['#emptyText.visible', '#emptyText.text']);
  expect(emptyVisible).toBe(true);
  expect(emptyText).toBe('No favorites yet');

  // Nothing to focus in the grid: Up still leaves it, or Back would be the only way out.
  await waitFocused(inTabBar, {
    timeout: 8000,
    interval: 400,
    action: async () => {
      const f = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
      if (f?.node && !inTabBar(f)) await press(ecp.Key.Up);
    },
    label: 'the tab bar from the empty Favorites tab',
  });
  await selectLibraryTab('movies');
  await waitGridLoaded('the Movies tab again');
  expect(await getActiveVal('#emptyText.visible'), 'the movies are back').toBe(false);
});

for (const [collectionType, folderTab, what] of [
  ['movies', 'studios', 'a studio opened from a movie library'],
  ['tvshows', 'networks', 'a network opened from a TV library'],
]) {
  it(`${what} shows its name as the title and no tabs`, async (testCtx) => {
    if (!libraryIdFor(libraries, collectionType))
      testCtx.skip(`server has no "${collectionType}" library`);
    const libraryId = await openLibrary(
      `library tabs folder ${collectionType}`,
      collectionType,
      folderTab,
    );
    if ((await getActiveVal('#itemGrid.content.getChildCount()')) < 1)
      testCtx.skip(`the library lists nothing on its "${folderTab}" tab`);

    await pressGridTile(0);
    await waitFor(
      'parentItem.id',
      (id) => typeof id === 'string' && id !== '' && id !== libraryId,
      {
        label: 'the folder opened',
        timeout: 20000,
        read: getActiveVal,
      },
    );
    await waitGridLoaded('the folder');
    const [name, overhangTabs] = await getActiveVals(['parentItem.title', 'overhangTabs']);
    expect(typeof name === 'string' && name !== '', 'the folder has a name').toBe(true);
    expect(overhangTabs, 'a folder declares no tabs').toEqual([]);
    expect(await overhangTabIds(), 'and the overhang shows none').toEqual([]);
    const [titleVisible, title] = await getVals([
      '#overhang.#title.visible',
      '#overhang.#title.text',
    ]);
    expect(titleVisible, 'the title shows').toBe(true);
    expect(title.startsWith(name), `the title names the folder (${title})`).toBe(true);

    // Back to the library: its tabs again, on the tab the folder was opened from.
    await press(ecp.Key.Back);
    await waitFor('parentItem.id', (id) => id === libraryId, {
      label: 'the library again',
      timeout: 20000,
      read: getActiveVal,
    });
    expect(await tabState()).toEqual({
      selectedTabId: folderTab,
      currentView: folderTab,
      drawn: folderTab,
    });
  });
}

for (const [collectionType, itemType] of [
  ['movies', 'Movie'],
  ['tvshows', 'Series'],
]) {
  it(`a ${collectionType} genre opened from its View All tile is titled with the genre alone`, async (testCtx) => {
    const libraryId = libraryIdFor(libraries, collectionType);
    if (!libraryId) testCtx.skip(`server has no "${collectionType}" library`);
    // A row gets a View All tile only when its genre holds more than five items.
    const byGenre = await genreItemNames(session, libraryId, itemType);
    const big = [...byGenre].filter(([, names]) => names.size > 5).map(([genre]) => genre);
    if (big.length < 1) {
      testCtx.skip(
        `no ${collectionType} genre holds more than 5 items (${byGenre.size} genre(s)), so no row has a View All tile`,
      );
    }
    await openLibrary(`library tabs genre folder ${collectionType}`, collectionType, 'genres');
    await waitGridLoaded('the Genres tab');
    await waitFocusInside('#genreList', { label: 'focus in the genre rows', timeout: 20000 });

    // The row to open: the first whose genre is big enough, found by what the app drew.
    const rowCount = await getActiveVal('#genreList.content.getChildCount()');
    expect(rowCount >= 1, `the Genres tab drew rows (${rowCount})`).toBe(true);
    const rowTitles = await getActiveVals(
      Array.from({ length: rowCount }, (_, r) => `#genreList.content.${r}.title`),
    );
    const row = rowTitles.findIndex((t) => big.includes(t));
    if (row < 0) {
      throw new Error(`no drawn genre row is one of the big genres (${JSON.stringify(rowTitles)})`);
    }
    const genre = rowTitles[row];

    await scrollFocus({
      keyPath: '#genreList.rowItemFocused',
      target: row,
      forwardKey: ecp.Key.Down,
      backKey: ecp.Key.Up,
      select: (v) => (Array.isArray(v) ? v[0] : undefined),
      read: getActiveVal,
      label: `the "${genre}" genre row`,
    });
    // The tile is the row's first cell: its node title is what the folder will be named.
    const [tileTitle, tileType] = await getActiveVals([
      `#genreList.content.${row}.0.title`,
      `#genreList.content.${row}.0.type`,
    ]);
    expect(tileType, 'the first cell is the View All tile').toBe('Genre');
    expect(tileTitle, 'the tile keeps the genre name as its title').toBe(genre);

    await press(ecp.Key.Ok);
    await waitFor(
      'parentItem.id',
      (id) => typeof id === 'string' && id !== '' && id !== libraryId,
      { label: 'the genre folder opened', timeout: 20000, read: getActiveVal },
    );
    await waitGridLoaded('the genre folder');
    expect(await getActiveVal('parentItem.title'), 'the folder is named for the genre').toBe(genre);
    const [titleVisible, title] = await getVals([
      '#overhang.#title.visible',
      '#overhang.#title.text',
    ]);
    expect(titleVisible, 'the title shows').toBe(true);
    expect(title.startsWith(genre), `the title starts with the genre (${title})`).toBe(true);
    expect(title.startsWith('View All'), `the title is not the tile's wording (${title})`).toBe(
      false,
    );
  });
}

it("Up from the TV guide's first channel reaches the tabs, and Channels opens", async (testCtx) => {
  const libraryId = libraryIdFor(libraries, 'livetv');
  if (!libraryId) testCtx.skip('server has no Live TV library');
  const url = `${session.serverUrl}/LiveTv/Channels?UserId=${session.userId}&Limit=0`;
  const channels = (await getJson(url, tokenHeader(session.token)))?.TotalRecordCount;
  // Two rows, so that a wrap from the first to the last would show.
  if (!(channels >= 2)) testCtx.skip(`server has ${channels} Live TV channel(s), and this needs 2`);
  await openLibrary('library tabs guide', 'livetv', 'guide');

  await waitFocusInside('#scheduleGrid', { label: 'focus in the guide', timeout: 20000 });
  await waitFor('#scheduleGrid.content.getChildCount()', (n) => n >= 2, {
    label: 'the guide has its channels',
    timeout: 20000,
    read: getActiveVal,
  });
  expect(await tabState()).toEqual({
    selectedTabId: 'guide',
    currentView: 'guide',
    drawn: 'guide',
  });

  // Up on the first row leaves the grid. The grid's own default wraps to the last channel.
  await waitFocused(inTabBar, {
    timeout: 8000,
    interval: 400,
    action: async () => {
      const f = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
      if (f?.node && !inTabBar(f)) await press(ecp.Key.Up);
    },
    label: "the tab bar from the guide's first channel",
  });
  expect(await getActiveVal('#scheduleGrid.channelFocused'), 'the guide did not wrap').toBe(0);

  // Down returns to the guide, where it was.
  await press(ecp.Key.Down);
  await waitFocusInside('#scheduleGrid', { label: 'Down returns to the guide', timeout: 8000 });

  await selectLibraryTab('channels');
  await waitGridLoaded('the Channels tab');
  await waitFocusInside('#itemGrid', { label: 'focus on the channels', timeout: 8000 });
  expect(await getActiveVal('#itemGrid.content.getChildCount()'), 'the channels').toBe(
    Math.min(channels, 100),
  );
  expect(await tabState()).toEqual({
    selectedTabId: 'channels',
    currentView: 'channels',
    drawn: 'channels',
  });
});

it('the Star dialog has Sort and Filter only, and a sort picked there keeps the tab', async (testCtx) => {
  const libraryId = libraryIdFor(libraries, 'movies');
  if (!libraryId) testCtx.skip('server has no "movies" library');
  await openLibrary('library tabs star dialog', 'movies', 'movies');
  await selectLibraryTab('studios');
  await waitGridLoaded('the Studios tab');
  await waitFocusInside('#itemGrid', { label: 'focus on the Studios grid', timeout: 8000 });

  await press(ecp.Key.Option);
  await waitFocusInside('#options', { label: 'the options dialog', timeout: 8000 });
  expect(await getActiveVal('#options.#buttons.buttons'), 'no View list').toEqual([
    'Sort',
    'Filter',
  ]);

  // Down enters the Sort list on its first row; the second row is a sort not in force.
  await waitFocusInside('#sortMenu', {
    label: 'the Sort list',
    timeout: 8000,
    action: resendUntilFocusInside(ecp.Key.Down, '#sortMenu'),
  });
  await scrollFocus({
    keyPath: '#options.#sortMenu.itemFocused',
    target: 1,
    forwardKey: ecp.Key.Down,
    backKey: ecp.Key.Up,
    read: getActiveVal,
    stepped: true,
    within: '#sortMenu',
    label: 'the second sort',
  });
  await press(ecp.Key.Ok);
  await press(ecp.Key.Option);
  await waitFocusInside('#itemGrid', { label: 'the grid after the dialog closed', timeout: 20000 });
  await waitGridLoaded('the Studios tab re-sorted');

  const saved = await displaySettings(libraryId);
  expect(saved.sortField, 'the sort picked in the dialog is saved').not.toBe('SortName');
  expect(typeof saved.sortField, 'and it was read').toBe('string');
  expect(await tabState(), 'a sort change keeps the tab').toEqual({
    selectedTabId: 'studios',
    currentView: 'studios',
    drawn: 'studios',
  });
});

/** The item ids in the open grid, in order, as the app holds them (lowercase, no dashes). */
async function gridIds() {
  const count = await getActiveVal('#itemGrid.content.getChildCount()');
  expect(typeof count, 'the grid reported how many tiles it holds').toBe('number');
  if (count === 0) return [];
  const ids = await getActiveVals(
    Array.from({ length: count }, (_, i) => `#itemGrid.content.${i}.id`),
  );
  return ids.map((id) => String(id).replace(/-/g, '').toLowerCase());
}

it('an item unfavorited from its details leaves the Favorites tab on Back', async (testCtx) => {
  const libraryId = libraryIdFor(libraries, 'movies');
  if (!libraryId) testCtx.skip('server has no "movies" library');
  const headers = tokenHeader(session.token);
  const first = (
    await getJson(
      `${session.serverUrl}/Items?UserId=${session.userId}&ParentId=${libraryId}` +
        '&IncludeItemTypes=Movie&Recursive=true&SortBy=SortName&SortOrder=Ascending' +
        '&Limit=1&Fields=UserData',
      headers,
    )
  )?.Items?.[0];
  if (!first) testCtx.skip('the movies library holds no movie');
  const target = first.Id.replace(/-/g, '').toLowerCase();
  const wasFavorite = first.UserData?.IsFavorite === true;
  try {
    if (!wasFavorite) await setFavorite(session, first.Id, true);
    await openLibrary('library tabs unfavorite on details', 'movies', 'movies');
    await selectLibraryTab('favorites');
    await waitGridLoaded('the Favorites tab');
    const before = await gridIds();
    expect(before, 'the favorited movie is on the Favorites tab').toContain(target);

    await pressGridTile(before.indexOf(target));
    await waitFor('#favoriteButton.isButtonSelected', (v) => v === true, {
      label: 'details open on the favorited movie',
      timeout: 20000,
      read: getActiveVal,
    });
    // The details screen's own button: ItemDetails.toggleFavorite() builds the request.
    await focusDetailButton('favoriteButton');
    await press(ecp.Key.Ok);
    // The button changes only once the server has answered, so the unfavorite has landed.
    await waitFor('#favoriteButton.isButtonSelected', (v) => v === false, {
      label: 'the heart cleared',
      timeout: 20000,
      read: getActiveVal,
    });
    await press(ecp.Key.Back);
    await waitFocusInside('#itemGrid', { label: 'the Favorites grid after Back', timeout: 20000 });
    await waitGridLoaded('the Favorites tab after Back');
    expect(await gridIds(), 'the unfavorited movie left the Favorites tab').not.toContain(target);
    expect((await tabState()).selectedTabId, 'and the tab is still Favorites').toBe('favorites');
  } finally {
    await setFavorite(session, first.Id, wasFavorite);
  }
});

it("the Star dialog shows a favorite's heart filled, and one press removes it from the Favorites tab", async (testCtx) => {
  const libraryId = libraryIdFor(libraries, 'movies');
  if (!libraryId) testCtx.skip('server has no "movies" library');
  const headers = tokenHeader(session.token);
  const itemUrl = (id) => `${session.serverUrl}/Users/${session.userId}/Items/${id}`;
  const first = (
    await getJson(
      `${session.serverUrl}/Items?UserId=${session.userId}&ParentId=${libraryId}` +
        '&IncludeItemTypes=Movie&Recursive=true&SortBy=SortName&SortOrder=Ascending' +
        '&Limit=1&Fields=UserData',
      headers,
    )
  )?.Items?.[0];
  if (!first) testCtx.skip('the movies library holds no movie');
  const target = first.Id.replace(/-/g, '').toLowerCase();
  const wasFavorite = first.UserData?.IsFavorite === true;
  const FILLED = 'pkg:/images/icons/favorite_selected_$$RES$$.png';
  const EMPTY = 'pkg:/images/icons/favorite_$$RES$$.png';
  try {
    if (!wasFavorite) await setFavorite(session, first.Id, true);
    await openLibrary('library tabs star dialog favorite', 'movies', 'movies');
    await selectLibraryTab('favorites');
    await waitGridLoaded('the Favorites tab');
    const before = await gridIds();
    expect(before, 'the favorited movie is on the Favorites tab').toContain(target);

    await focusGridTile(before.indexOf(target));
    await press(ecp.Key.Option);
    await waitFocusInside('#options', { label: 'the options dialog', timeout: 8000 });
    expect(
      await getActiveVal('#options.#favoriteMenu.iconUri'),
      'the dialog shows the favorite with a filled heart',
    ).toBe(FILLED);

    // A press that lands on the already-selected button hands focus to the heart: ItemGridOptions.buttonFocusChanged().
    await waitFocusInside('#favoriteMenu', {
      label: 'the heart button',
      timeout: 8000,
      action: resendUntilFocusInside(ecp.Key.Right, '#favoriteMenu'),
    });
    await press(ecp.Key.Ok);
    // ItemGridOptions.toggleFavorite() sets the icon from the new state and never writes it again.
    await waitFor('#options.#favoriteMenu.iconUri', (v) => v === EMPTY, {
      label: 'the heart emptied',
      timeout: 8000,
      read: getActiveVal,
    });

    await press(ecp.Key.Option);
    await waitFocusInside('#itemGrid', {
      label: 'the grid after the dialog closed',
      timeout: 20000,
    });
    await waitGridLoaded('the Favorites tab after the dialog closed');
    expect(await gridIds(), 'the removed movie left the Favorites tab').not.toContain(target);
    const after = await getJson(itemUrl(first.Id), headers);
    expect(after?.UserData?.IsFavorite, 'the server no longer has it as a favorite').toBe(false);
  } finally {
    await setFavorite(session, first.Id, wasFavorite);
  }
});
