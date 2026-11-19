/**
 * The overhang cluster (Search, SyncPlay, Settings) is on every screen, and the row's keys are the
 * scene's, not Home's: Up from a screen's top enters the row, Right walks it, OK on the gear
 * opens Settings, and Back lands on the gear again, on a library screen and on details as
 * on Home. Settings' own Up enters the row too, at the user menu Home, Settings and Search
 * show. On the search screen, Up from the keyboard's top row enters the row, and an icon for
 * the screen on show does nothing. Star on Home opens Settings, as the gear does, and Back
 * from a Settings that Star opened returns to where Star was pressed, not the gear. Each screen
 * of a chain keeps its own icon to come back to, a theme reload from Settings returns to the
 * screen Settings was opened from, and the search screen's submitted query shows as the
 * overhang's status. A player shows no cluster.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getJson, getLibraries, tokenHeader } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { captureRawUI } from '../capture.js';
import {
  focusOverhangIcon,
  navLibraryGrid,
  navMovieDetails,
  navSettings,
  openSettingsFromGear,
  openSearchKeyboard,
  returnToLibraryGrid,
  submitSearchFromKeyboard,
  waitPageMenu,
  waitSearchResults,
  waitSettingsScreen,
} from '../lib/nav.js';
import {
  getActiveVal,
  getGlobalVal,
  getVal,
  walkOverhangRowTo,
  press,
  waitDialogClosed,
  waitFocused,
  waitFocusInside,
  waitFor,
  waitHome,
  enterOverhangRow,
  waitFocusInHomeContent,
  walkFocusUntil,
} from '../lib/steps.js';

const CAPTURE = process.env.RTA_CAPTURE === '1';
const LOCALE = RTA_CONFIG.languages[0];
const atSyncPlayIcon = (f) => f?.node?.id === 'syncplayIcon';
const atSearchIcon = (f) => f?.node?.id === 'searchIcon';
const atSettingsIcon = (f) => f?.node?.id === 'settingsIcon';
const atUserMenu = (f) => f?.node?.id === 'userDropdown';

let session;
let ctx;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  ctx = { heroIndex: 0, libraries: await getLibraries(session) };
});

async function freshApp(label) {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, label);
}

/** Up until the row's first icon holds focus: a screen with no tabs and no user menu enters
 * the row there (a library has tabs and enters at its tab bar: enterOverhangRow). The first
 * icon is SyncPlay, since the test account may use it. */
async function enterRow(label) {
  await waitFocused(atSyncPlayIcon, {
    timeout: 15000,
    interval: 350,
    action: walkFocusUntil(ecp.Key.Up, atSyncPlayIcon),
    label: `the row's first icon from ${label}`,
  });
}

/** Along the row to an icon (`walkOverhangRowTo`), named for the step's failure message. */
const walkRowTo = (iconId, label) => walkOverhangRowTo(iconId, { label: `${iconId} on ${label}` });
const walkToGear = (label) => walkRowTo('settingsIcon', label);

/** Up until the user menu holds focus: Settings and Search enter the row there. */
async function enterRowAtUserMenu(label) {
  await waitFocused(atUserMenu, {
    timeout: 15000,
    interval: 350,
    action: walkFocusUntil(ecp.Key.Up, atUserMenu),
    label: `the user menu from ${label}`,
  });
}

/**
 * Right to the gear, OK, Settings up, Back: the gear holds focus again on the screen left.
 * `pageMenu`: the screen has page settings, so the gear opens its menu and All settings is a
 * row of it (page-settings.spec.js covers the menu itself).
 */
async function roundTripThroughSettings(label, { pageMenu = false } = {}) {
  await walkToGear(label);
  await openSettingsFromGear({ pageMenu });
  await press(ecp.Key.Back);
  await waitFocused(atSettingsIcon, {
    timeout: 15000,
    interval: 250,
    label: `the gear again, back on ${label}`,
  });
}

it('a library screen: Up enters the row, the gear round-trips, Down walks back through the strip', async () => {
  await freshApp('overhang-cluster library');
  await navLibraryGrid(ctx);
  expect(await getVal('#overhang.#cluster.visible'), 'the cluster shows').toBe(true);

  await enterOverhangRow('the grid');
  // The row with the cluster against the clock's measured digits (JROverhang.layout).
  if (CAPTURE) await captureRawUI('overhangCluster');
  await roundTripThroughSettings('the library', { pageMenu: true });

  await returnToLibraryGrid('after the gear round trip');
});

it('details: Up climbs to the row, the gear round-trips, Down returns to the screen', async () => {
  await freshApp('overhang-cluster details');
  await navMovieDetails(ctx);
  const viewId = await getActiveVal('id');

  await enterRow('details');
  await roundTripThroughSettings('details');

  await press(ecp.Key.Down);
  await waitFocusInside(viewId, { label: 'details after Down from the row' });
});

it('Settings: Up enters the row, the gear there does nothing, Back from the row leaves for Home', async () => {
  await freshApp('overhang-cluster settings');
  await navSettings();
  await waitFocusInside('#settingsMenu', { label: 'the settings menu' });
  const viewId = await getActiveVal('id');

  await press(ecp.Key.Up);
  await waitFocused(atUserMenu, {
    timeout: 8000,
    interval: 250,
    label: 'the row from Settings, at the user menu',
  });
  await press(ecp.Key.Down);
  await waitFocusInside('#settingsMenu', { label: 'the settings menu after Down from the row' });

  // The gear on Settings is the icon for the screen on show, so it does nothing: no
  // navigation and no menu, the gear keeps focus, and the one Back below still reaches Home
  // (a stacked Settings would take two).
  await press(ecp.Key.Up);
  await walkToGear('Settings');
  await press(ecp.Key.Ok);
  await waitFocused(atSettingsIcon, {
    timeout: 8000,
    interval: 250,
    label: 'the gear, the view reused',
  });
  expect(await getActiveVal('id'), 'still the same Settings').toBe(viewId);

  // Back from the row leaves the screen through its own leaveScreen: one press, not two.
  await press(ecp.Key.Back);
  await waitHome();
});

// Star from the row does what Star does on the screen under it. The row sits outside the
// screen, so the scene gets the key and hands it to the screen (JRScreen.onOptionsKey). On a
// library that is the page menu, the one the settings icon opens.
it('Star from the row on a library opens its page menu, and Back closes it', async () => {
  await freshApp('overhang-cluster star library');
  await navLibraryGrid(ctx);
  await enterOverhangRow('the grid');

  await press(ecp.Key.Option);
  await waitPageMenu('the page menu, opened from the row');
  expect(await getActiveVal('subtype()'), 'the app is still on the library').toBe('BaseGridView');

  await press(ecp.Key.Back);
  await waitDialogClosed('Back closed the page menu');
  expect(await getActiveVal('subtype()'), 'and Back left the library open').toBe('BaseGridView');
});

it('Star from the row on Settings closes Settings in one press, as it does on the screen', async () => {
  await freshApp('overhang-cluster star settings');
  await navSettings();
  await waitFocusInside('#settingsMenu', { label: 'the settings menu' });
  await press(ecp.Key.Up);
  await waitFocused(atUserMenu, {
    timeout: 8000,
    interval: 250,
    label: 'the row from Settings, at the user menu',
  });

  await press(ecp.Key.Option);
  await waitHome();
});

// Back closes the library at once (onDestroy), but Home becomes the active view a turn later.
// A Star sent right behind the Back reaches the scene in that gap, from a screen already torn
// down: the scene must drop it while the router navigates, as it drops Back.
it('Star right after Back from a library is dropped, and Home comes back', async () => {
  await freshApp('overhang-cluster star during back');
  await navLibraryGrid(ctx);
  await waitFocusInside('#itemGrid', { label: 'the library grid' });

  await press(ecp.Key.Back);
  await press(ecp.Key.Option);
  await press(ecp.Key.Option);
  await press(ecp.Key.Option);

  await waitHome();
});

// The case above races a real Back, so it cannot say whether its Stars landed in the gap. This
// one builds the gap's state with no race: the router's own close call tears the library down
// in place, so it stays the active view with its onDestroy run and no navigation in flight.
// The scene must call none of that screen's hooks (JRScreen.isClosed). Nothing a viewer does
// leaves the app here, so the next case starts the app again.
it('Star on a library that is closed but still the active view is dropped', async () => {
  await freshApp('overhang-cluster star on a closed screen');
  await navLibraryGrid(ctx);
  await waitFocusInside('#itemGrid', { label: 'the library grid' });

  await odc.callFunc({ base: 'global', keyPath: 'activeRoutedView', funcName: 'beforeViewClose' });
  expect(await getActiveVal('isClosed'), 'the library reports itself closed').toBe(true);

  await press(ecp.Key.Option);
  // A read that completes is the app still running: without the check the key reached the
  // library's Star handler on released state and the app stopped in the debugger.
  expect(await getActiveVal('subtype()'), 'the app still answers, on the same view').toBe(
    'BaseGridView',
  );
});

// Star opens Settings from the screen, not from the gear, so Back returns to where Star was
// pressed: the gear is focused again only when it was the gear that was pressed
// (JRScene.openClusterRoute's isFromIcon).
it("Star on Home's rows, then All settings: Back returns to the rows, not the gear", async () => {
  await freshApp('overhang-cluster star home rows');
  await waitHome();
  await waitFocusInHomeContent({ label: "Home's rows before Star" });

  await press(ecp.Key.Option);
  const rows = await waitPageMenu("Home's menu, opened by Star on the rows");
  // All settings is the last row: Up from the first wraps to it.
  await press(ecp.Key.Up);
  await waitFor('#optionList.itemFocused', (n) => n === rows - 1, {
    label: 'All settings, the last row',
    timeout: 8000,
  });
  await press(ecp.Key.Ok);
  await waitSettingsScreen();
  await press(ecp.Key.Back);
  await waitHome();
  // A row list holds focus, so the overhang row does not.
  await waitFocusInHomeContent({ label: "Home's rows after Back from Settings, not the gear" });
});

it("Star on a library's grid, then All settings: Back returns to the grid, not the gear", async () => {
  await freshApp('overhang-cluster star library grid');
  await navLibraryGrid(ctx);
  await waitFocusInside('#itemGrid', { label: 'the grid before Star' });

  await press(ecp.Key.Option);
  const rows = await waitPageMenu('the page menu, opened by Star on the grid');
  // All settings is the last row: Up from the first wraps to it.
  await press(ecp.Key.Up);
  await waitFor('#optionList.itemFocused', (n) => n === rows - 1, {
    label: 'All settings, the last row',
    timeout: 8000,
  });
  await press(ecp.Key.Ok);
  await waitSettingsScreen();

  await press(ecp.Key.Back);
  await waitFocusInside('#itemGrid', {
    label: 'the grid after Back from Settings',
    timeout: 20000,
  });
});

// Star from the row does what the gear does on Home: Home's menu, and Back closes it.
it("Star from the row on Home opens Home's menu, as the gear does", async () => {
  await freshApp('overhang-cluster star home');
  await waitHome();
  await focusOverhangIcon('settingsIcon');

  await press(ecp.Key.Option);
  await waitPageMenu("Home's menu, opened by Star from the row");
  expect(await getActiveVal('subtype()'), 'the app is still on Home').toBe('Home');

  await press(ecp.Key.Back);
  await waitDialogClosed("Back closed Home's menu");
  expect(await getActiveVal('subtype()'), 'and Back left Home open').toBe('Home');
});

it('search: Up from the keyboard enters the row, and the search icon there does nothing', async () => {
  await freshApp('overhang-cluster search');
  await openSearchKeyboard();
  expect(await getVal('#overhang.#cluster.visible'), 'the cluster shows on search').toBe(true);
  expect(await getVal('#overhang.#clock.visible'), 'the clock shows on search').toBe(true);

  await enterRowAtUserMenu('the keyboard');
  expect(await getActiveVal('isExpanded'), 'the overlay stays open under the row').toBe(true);

  await press(ecp.Key.Down);
  await waitFocusInside('#kbd', { label: 'the keyboard after Down from the row' });
  await enterRowAtUserMenu('the keyboard again');

  // The search icon on the search screen is the icon for the screen on show: it does nothing,
  // and keeps focus. The peek chip above the results is the way back to the keyboard.
  const viewId = await getActiveVal('id');
  await walkRowTo('searchIcon', 'the search screen');
  await press(ecp.Key.Ok);
  await waitFocused(atSearchIcon, {
    timeout: 8000,
    interval: 250,
    label: 'the search icon, still focused after OK',
  });
  expect(await getActiveVal('id'), 'still the search screen').toBe(viewId);
});

/**
 * What Settings does after a theme or language change (`performSettingsExit` calls
 * `SceneManager.reloadHome`). A call, not a walk to the Theme setting: the reload under test
 * starts at that call, and a theme changed by a test would restyle every later spec in the run,
 * since the runner restores the registry only when the run ends.
 */
async function reloadAsSettingsDoes() {
  await odc.callFunc({ base: 'global', keyPath: 'sceneManager', funcName: 'reloadHome' });
}

it('a theme reload from Settings opened on a library returns to the library, with Home under it', async () => {
  await freshApp('overhang-cluster reload origin');
  await navLibraryGrid(ctx);
  const subtype = await getActiveVal('subtype()');
  const path = await getActiveVal('route.path');

  await enterOverhangRow('the grid');
  await walkToGear('the library');
  await openSettingsFromGear({ pageMenu: true });

  await reloadAsSettingsDoes();
  await waitFor('subtype()', (v) => v === subtype, {
    read: getActiveVal,
    timeout: 30000,
    interval: 250,
    label: 'the library again after the reload',
  });
  expect(await getActiveVal('route.path'), 'the same library').toBe(path);

  await press(ecp.Key.Back);
  await waitHome();
});

it('each screen keeps its own icon: library, search icon, search, gear, then Back to each', async () => {
  await freshApp('overhang-cluster nested');
  await navLibraryGrid(ctx);
  await enterOverhangRow('the grid');
  await walkRowTo('searchIcon', 'the library');
  await press(ecp.Key.Ok);
  await waitFor('subtype()', (v) => v === 'SearchScreen', {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'search, opened from the library',
  });
  await waitFocusInside('#kbd', { label: 'the search keyboard' });

  await enterRowAtUserMenu('the keyboard');
  await walkToGear('search');
  await press(ecp.Key.Ok);
  await waitFor('#versionLabel.text', (t) => typeof t === 'string' && /^v/.test(t), {
    label: 'settings version label',
    timeout: 20000,
  });

  await press(ecp.Key.Back);
  await waitFocused(atSettingsIcon, {
    timeout: 15000,
    interval: 250,
    label: 'the gear again, back on search',
  });
  // Back from the row leaves search in one press, onto the library.
  await press(ecp.Key.Back);
  await waitFocused(atSearchIcon, {
    timeout: 15000,
    interval: 250,
    label: 'the search icon again, back on the library',
  });
});

it('search: the submitted query shows after the title, and again after Back from a result', async () => {
  await freshApp('overhang-cluster search status');
  await openSearchKeyboard();
  const query = RTA_CONFIG.searchQuery;
  await ecp.sendText(query);
  await submitSearchFromKeyboard();
  await waitSearchResults({ label: 'results for the status' });
  await waitFor('#overhang.#status.text', (t) => t === query, { label: 'the query as the status' });
  expect(await getVal('#overhang.#status.visible'), 'the status shows').toBe(true);

  await press(ecp.Key.Ok);
  await waitFor('subtype()', (v) => typeof v === 'string' && v !== 'SearchScreen', {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'a result opened',
  });
  await press(ecp.Key.Back);
  await waitFor('subtype()', (v) => v === 'SearchScreen', {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'back on search',
  });
  await waitFor('#overhang.#status.text', (t) => t === query, {
    label: 'the query as the status again',
  });
  expect(await getVal('#overhang.#status.visible'), 'the status shows again').toBe(true);
});

// Home, Settings and Search carry the same set on the right: the user menu, then the cluster.
// The user menu names who is signed in, so Settings has no status after its title.
it('Settings and Search show the user menu, and Settings no status, at the top and inside Global', async () => {
  await freshApp('overhang-cluster user menu');
  await navSettings();
  await waitFocusInside('#settingsMenu', { label: 'the settings menu' });
  const userName = await getGlobalVal('user.name');
  expect(typeof userName === 'string' && userName !== '', 'a signed-in user name to compare').toBe(
    true,
  );
  await waitFor('#overhang.#userDropdown.visible', (v) => v === true, {
    label: 'the user menu on Settings',
  });
  expect(await getVal('#overhang.#userDropdown.triggerText'), 'the menu names the user').toBe(
    userName,
  );
  expect(await getVal('#overhang.#status.visible'), 'no status on Settings').toBe(false);

  // Global is the menu's first group; Right opens it. It used to say "Everyone on this device"
  // as the status; its own description says so now.
  await press(ecp.Key.Right);
  await waitFocusInside('#settingsMenu', { label: 'the Global group' });
  expect(await getVal('#overhang.#status.visible'), 'no status inside Global').toBe(false);

  await press(ecp.Key.Back);
  await waitFocusInside('#settingsMenu', { label: 'the settings menu again' });
  await enterRowAtUserMenu('Settings');
  await walkRowTo('searchIcon', 'Settings');
  await press(ecp.Key.Ok);
  await waitFor('subtype()', (v) => v === 'SearchScreen', {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'search, opened from Settings',
  });
  await waitFor('#overhang.#userDropdown.visible', (v) => v === true, {
    label: 'the user menu on Search',
  });
});

// A name far wider than its room. Set on the global user, which the scene reads each time it
// binds a screen, so the next screen shows it; the run's relaunch puts the real one back.
const LONG_NAME = 'Maximiliana Alexandra Featherstonehaugh-Worthington of Somewhere';
// overhangRow.LINE_X plus ELEMENT_GAP: the user menu's box never starts left of this.
const MENU_MIN_X = 1068 + 6;

/** On the screen on show: the user menu has taken the long name at its widest, starts right
 * of the line, and whatever is left of it (the tab strip's slot, or the title) ends before it. */
async function assertMenuStopsAtTheLine(label) {
  await waitFor('#overhang.#userDropdown.triggerWidth', (w) => w > 0, {
    label: `the user menu sized on ${label}`,
  });
  const menuMax = await getVal('#overhang.#userDropdown.maxWidth');
  await waitFor('#overhang.#userDropdown.triggerWidth', (w) => w === menuMax, {
    label: `the long name at the menu's limit on ${label}`,
  });
  const menu = await getVal('#overhang.#userDropdown.sceneBoundingRect()');
  expect(menu.x, `the menu starts right of the line on ${label}`).toBeGreaterThanOrEqual(
    MENU_MIN_X,
  );
  if (await getVal('#overhang.#tabBar.visible')) {
    const bar = await getVal('#overhang.#tabBar.translation');
    const slot = await getVal('#overhang.#tabBar.slotWidth');
    expect(bar[0] + slot, `the tab slot ends before the menu on ${label}`).toBeLessThanOrEqual(
      menu.x - 6,
    );
  } else {
    const title = await getVal('#overhang.#title.translation');
    const titleWidth = await getVal('#overhang.#title.maxWidth');
    expect(title[0] + titleWidth, `the title ends before the menu on ${label}`).toBeLessThanOrEqual(
      menu.x - 6,
    );
  }
}

it('a long user name ends at the line on Settings, Search and Home', async () => {
  await freshApp('overhang-cluster long name');
  await waitHome();
  await odc.setValue({ base: 'global', keyPath: 'user.name', value: LONG_NAME });

  await navSettings();
  await waitFor('#overhang.#userDropdown.triggerText', (t) => t === LONG_NAME, {
    label: 'the long name on Settings',
  });
  await assertMenuStopsAtTheLine('Settings');
  if (CAPTURE) await captureRawUI('overhang-long-name-settings');

  await enterRowAtUserMenu('Settings');
  await walkRowTo('searchIcon', 'Settings');
  await press(ecp.Key.Ok);
  await waitFor('subtype()', (v) => v === 'SearchScreen', {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'search, opened from Settings',
  });
  await assertMenuStopsAtTheLine('Search');
  if (CAPTURE) await captureRawUI('overhang-long-name-search');

  // Back from the row leaves each screen in one press
  await press(ecp.Key.Back);
  await waitFor('subtype()', (v) => v === 'Settings', {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'back on Settings',
  });
  await press(ecp.Key.Back);
  await waitHome();
  await assertMenuStopsAtTheLine('Home');
  if (CAPTURE) await captureRawUI('overhang-long-name-home');
});

it('the audio player shows no cluster: leaving a player through it would strand the music', async () => {
  const res = await getJson(
    `${RTA_CONFIG.server.url}/Users/${session.userId}/Items?IncludeItemTypes=Audio&Recursive=true&Limit=1`,
    tokenHeader(session.token),
  );
  const song = res.Items?.[0];
  expect(song?.Id, 'the demo server has a song to play').toBeTruthy();

  await freshApp('overhang-cluster audio player');
  await ecp.sendInput({ params: { contentId: `id=${song.Id}|action=play` } });
  await waitFor('subtype()', (v) => v === 'AudioPlayerView', {
    read: getActiveVal,
    timeout: 30000,
    interval: 250,
    label: 'the audio player opened',
  });
  await waitFor('audioPlayer.state', (v) => v === 'playing', {
    read: getGlobalVal,
    timeout: 30000,
    interval: 250,
    label: 'the song playing',
  });
  expect(await getVal('#overhang.#cluster.visible'), 'no cluster on the audio player').toBe(false);

  // Back stops the music and leaves the player, the one way out.
  await press(ecp.Key.Back);
  await waitFor('subtype()', (v) => v !== 'AudioPlayerView', {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'the player closed on Back',
  });
});
