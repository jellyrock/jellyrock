/**
 * A setting changed in Settings reaches the screen under it when Back returns there.
 *
 * Settings opens over any screen, and the screen under it is suspended, not rebuilt. A
 * setting that screen read once, when it was built, used to stay as it was until the screen
 * was opened again. JRScreen now hands the screen coming back the settings written while it
 * was covered (onSettingsChanged), and the screen applies them in place.
 *
 * Each case opens Settings from the screen's gear and writes the setting as Settings saves it
 * (a field write on the settings node): what is under test is the way back, not the Settings
 * menus. The titles, the third setting a library applies this way, are covered in
 * page-settings.spec.js.
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { navLibraryGrid, openSettingsFromGear, waitGridLoaded } from '../lib/nav.js';
import {
  enterOverhangRow,
  getActiveVals,
  homeListId,
  press,
  waitFocused,
  waitFocusInside,
  waitHome,
  walkOverhangRowTo,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const atSettingsIcon = (f) => f?.node?.id === 'settingsIcon';

let session;
let libraries;
let moviesId;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  libraries = await getLibraries(session);
  moviesId = libraryIdFor(libraries, 'movies');
});

/** Write a user setting the way Settings saves it: a field of the settings node. */
const writeSetting = (name, value) =>
  odc.setValue({ base: 'global', keyPath: `user.settings.${name}`, value });

/** Back from Settings to the screen it was opened from, where focus returns to the gear. */
async function backToGear(label) {
  await press(ecp.Key.Back);
  await waitFocused(atSettingsIcon, { timeout: 15000, interval: 250, label });
}

it('the item count turned off in Settings leaves the library strip at once, with the grid kept', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  const expectedServer = await seedHome(session, LOCALE);
  const landing = await seedLibraryLanding(session, moviesId, 'movies', { layout: 'grid' });
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'settings reach the library', { landing });
  await waitHome();
  await navLibraryGrid({ libraries });
  await waitGridLoaded('the movie grid');
  await waitFocusInside('#itemGrid', { label: 'focus on the movie grid', timeout: 20000 });

  const [items, countBefore] = await getActiveVals([
    '#itemGrid.content.getChildCount()',
    '#headerStrip.#count.text',
  ]);
  if (!(items > 0)) testCtx.skip('the movie library is empty');
  expect(countBefore, 'the count shows to begin with (the default)').toMatch(/^1 of \d+$/);
  // A load gives the grid a new content node, so a mark on this one says whether it was kept
  await odc.setValue({ keyPath: '#itemGrid.content.title', value: 'rta-kept' });

  await enterOverhangRow('the movie grid');
  await walkOverhangRowTo('settingsIcon', { label: 'the gear on the movie grid' });
  await openSettingsFromGear({ pageMenu: true });
  await writeSetting('itemGridShowItemCount', false);
  await backToGear('the gear again, over the library');

  const [countAfter, mark, loadState] = await getActiveVals([
    '#headerStrip.#count.text',
    '#itemGrid.content.title',
    'loadState',
  ]);
  expect(countAfter, 'the count is gone').toBe('');
  expect(mark, 'the same items, not a reload').toBe('rta-kept');
  expect(loadState, 'no load started').toBe('loaded');

  // And back on, the same way
  await openSettingsFromGear({ pageMenu: true });
  await writeSetting('itemGridShowItemCount', true);
  await backToGear('the gear again, over the library, a second time');
  expect(
    (await getActiveVals(['#headerStrip.#count.text']))[0],
    'the count is back for the item in focus',
  ).toMatch(/^1 of \d+$/);
});

it('a row layout changed in Settings lays Home out again when Back returns there', async () => {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'settings reach Home');
  await waitHome();
  const list = await homeListId();
  expect(
    (await getActiveVals([`${list}.translation`]))[0],
    'full width to begin with (the default)',
  ).toEqual([0, 126]);

  // Home offers no page settings, so its gear opens Settings in one press
  await walkOverhangRowTo('settingsIcon', { label: 'the gear on Home' });
  await openSettingsFromGear();
  await writeSetting('uiRowLayout', 'original');
  await backToGear('the gear again, over Home');

  const [translation, focusXOffset] = await getActiveVals([
    `${list}.translation`,
    `${list}.focusXOffset`,
  ]);
  expect(translation, 'the rows moved in from the edge').toEqual([111, 126]);
  expect(focusXOffset, 'and the focus offset follows').toEqual([]);
});
