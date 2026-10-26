/**
 * The overhang cluster (Search, Settings) is on every screen, and the row's keys are the
 * scene's, not Home's: Up from a screen's top enters the row, Right walks it, OK on the gear
 * opens Settings, and Back lands on the gear again, on a library screen and on details as
 * on Home. Settings' own Up enters the row too. On the search screen, Up from the keyboard's
 * top row enters the row and the search icon reopens the keyboard instead of navigating.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { navLibraryGrid, navMovieDetails, navSettings, openSearchKeyboard } from '../lib/nav.js';
import {
  getActiveVal,
  getVal,
  press,
  waitFocused,
  waitFocusInside,
  waitFor,
  walkFocusUntil,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
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

/** Up until the row's first icon holds focus: a screen with no tabs enters the row there. */
async function enterRow(label) {
  await waitFocused(atSearchIcon, {
    timeout: 15000,
    interval: 350,
    action: walkFocusUntil(ecp.Key.Up, atSearchIcon),
    label: `the row's search icon from ${label}`,
  });
}

/** Right to the gear, OK, Settings up, Back: the gear holds focus again on the screen left. */
async function roundTripThroughSettings(label) {
  await press(ecp.Key.Right);
  await waitFocused(atSettingsIcon, {
    timeout: 8000,
    interval: 250,
    label: `the gear on ${label}`,
  });
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

it('Settings: Up from the first item enters the row, Down returns to the menu', async () => {
  await freshApp('overhang-cluster settings');
  await navSettings();
  await waitFocusInside('#settingsMenu', { label: 'the settings menu' });

  await press(ecp.Key.Up);
  await waitFocused(atSearchIcon, { timeout: 8000, interval: 250, label: 'the row from Settings' });

  await press(ecp.Key.Down);
  await waitFocusInside('#settingsMenu', { label: 'the settings menu after Down from the row' });
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
  await press(ecp.Key.Ok);
  // Focus returns to the column it last left the overlay from, so ask for the overlay.
  await waitFocusInside('#overlay', { label: 'the overlay, reopened by the search icon' });
  expect(await getActiveVal('id'), 'still the search screen').toBe(viewId);
  expect(await getActiveVal('isExpanded'), 'the overlay is open').toBe(true);
});
