/**
 * The overhang cluster (Search, SyncPlay, Settings) is on every screen, and the row's keys are the
 * scene's, not Home's: Up from a screen's top enters the row, Right walks it, OK on the gear
 * opens Settings, and Back lands on the gear again, on a library screen and on details as
 * on Home. Settings' own Up enters the row too. On the search screen, Up from the keyboard's
 * top row enters the row and the search icon reopens the keyboard instead of navigating.
 * Each screen of a chain keeps its own icon to come back to, a theme reload from Settings
 * returns to the screen Settings was opened from, and the search screen's submitted query
 * shows as the overhang's status. A player shows no cluster.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getJson, getLibraries, tokenHeader } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import {
  navLibraryGrid,
  navMovieDetails,
  navSettings,
  openSearchKeyboard,
  submitSearchFromKeyboard,
  waitSearchResults,
} from '../lib/nav.js';
import {
  getActiveVal,
  getGlobalVal,
  getVal,
  walkOverhangRowTo,
  press,
  waitFocused,
  waitFocusInside,
  waitFor,
  waitHome,
  walkFocusUntil,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const atSyncPlayIcon = (f) => f?.node?.id === 'syncplayIcon';
const atSearchIcon = (f) => f?.node?.id === 'searchIcon';
const atSettingsIcon = (f) => f?.node?.id === 'settingsIcon';

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

/** Up until the row's first icon holds focus: a screen with no tabs enters the row there. The
 * first icon is SyncPlay, since the test account may use it. */
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

/** Right to the gear, OK, Settings up, Back: the gear holds focus again on the screen left. */
async function roundTripThroughSettings(label) {
  await walkToGear(label);
  await press(ecp.Key.Ok);
  await waitFor('#versionLabel.text', (t) => typeof t === 'string' && /^v/.test(t), {
    label: 'settings version label',
    timeout: 20000,
  });
  await press(ecp.Key.Back);
  await waitFocused(atSettingsIcon, {
    timeout: 15000,
    interval: 250,
    label: `the gear again, back on ${label}`,
  });
}

it('a library screen: Up enters the row, the gear round-trips, Down returns to the grid', async () => {
  await freshApp('overhang-cluster library');
  await navLibraryGrid(ctx);
  expect(await getVal('#overhang.#cluster.visible'), 'the cluster shows').toBe(true);

  await enterRow('the grid');
  await roundTripThroughSettings('the library');

  await press(ecp.Key.Down);
  await waitFocusInside('#itemGrid', { label: 'the grid after Down from the row' });
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
  await waitFocused(atSyncPlayIcon, {
    timeout: 8000,
    interval: 250,
    label: 'the row from Settings',
  });
  await press(ecp.Key.Down);
  await waitFocusInside('#settingsMenu', { label: 'the settings menu after Down from the row' });

  // The gear on Settings is a navigation to the route on screen: the router reuses the view
  // and the gear keeps focus, so the one Back below still reaches Home (a stacked Settings
  // would take two).
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

it('search: Up from the keyboard enters the row, and the search icon reopens the keyboard', async () => {
  await freshApp('overhang-cluster search');
  await openSearchKeyboard();
  expect(await getVal('#overhang.#cluster.visible'), 'the cluster shows on search').toBe(true);
  expect(await getVal('#overhang.#clock.visible'), 'the clock shows on search').toBe(true);

  await enterRow('the keyboard');
  expect(await getActiveVal('isExpanded'), 'the overlay stays open under the row').toBe(true);

  await press(ecp.Key.Down);
  await waitFocusInside('#kbd', { label: 'the keyboard after Down from the row' });
  await enterRow('the keyboard again');

  // The search icon on the search screen reopens the keyboard; it does not navigate.
  const viewId = await getActiveVal('id');
  await walkRowTo('searchIcon', 'the search screen');
  await press(ecp.Key.Ok);
  // Focus returns to the column it last left the overlay from, so ask for the overlay.
  await waitFocusInside('#overlay', { label: 'the overlay, reopened by the search icon' });
  expect(await getActiveVal('id'), 'still the search screen').toBe(viewId);
  expect(await getActiveVal('isExpanded'), 'the overlay is open').toBe(true);
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

  await enterRow('the grid');
  await walkToGear('the library');
  await press(ecp.Key.Ok);
  await waitFor('#versionLabel.text', (t) => typeof t === 'string' && /^v/.test(t), {
    label: 'settings version label',
    timeout: 20000,
  });

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
  await enterRow('the grid');
  await walkRowTo('searchIcon', 'the library');
  await press(ecp.Key.Ok);
  await waitFor('subtype()', (v) => v === 'SearchScreen', {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'search, opened from the library',
  });
  await waitFocusInside('#kbd', { label: 'the search keyboard' });

  await enterRow('the keyboard');
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

// locale/custom/en_US.json LabelEveryoneOnThisDevice.
const DEVICE_WIDE_STATUS = 'Everyone on this device';

it('Settings: the status names the signed-in user, and everyone on the device inside Global', async () => {
  await freshApp('overhang-cluster settings status');
  await navSettings();
  await waitFocusInside('#settingsMenu', { label: 'the settings menu' });
  const userName = await getGlobalVal('user.name');
  expect(typeof userName === 'string' && userName !== '', 'a signed-in user name to compare').toBe(
    true,
  );
  await waitFor('#overhang.#status.text', (t) => t === userName, {
    label: "the user's name as the status",
  });

  // Global is the menu's first group; Right opens it.
  await press(ecp.Key.Right);
  await waitFor('#overhang.#status.text', (t) => t === DEVICE_WIDE_STATUS, {
    label: 'the device-wide status inside Global',
  });
  await press(ecp.Key.Back);
  await waitFor('#overhang.#status.text', (t) => t === userName, {
    label: "the user's name again at the top",
  });
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
