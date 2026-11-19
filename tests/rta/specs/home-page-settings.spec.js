/**
 * Home's settings icon opens a menu of Home's own settings above All settings, as a library's
 * does: Row Layout on both tabs, and on the Home tab also the settings that change what its
 * rows show (homePageSettings.entries). A pick is saved as Settings saves it and applies on
 * screen at once: Row Layout lays the rows out again in place, and a setting a load reads
 * reloads the rows.
 *
 * Every case starts from the user's default settings (seedHome resets them).
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { selectHomeTab, waitPageMenu } from '../lib/nav.js';
import {
  getActiveVal,
  getActiveVals,
  getVal,
  homeListId,
  press,
  scrollFocus,
  waitDialogClosed,
  waitFor,
  waitFocusInHomeContent,
  waitFocused,
  waitHome,
  walkOverhangRowTo,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const atSettingsIcon = (f) => f?.node?.id === 'settingsIcon';

let session;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
});

async function launchHome(label) {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, label);
  await waitHome();
}

/** The text of each row of the list dialog on show. */
async function dialogRows() {
  const count = await getVal('#optionList.content.getChildCount()');
  const rows = [];
  for (let i = 0; i < count; i++) rows.push(await getVal(`#optionList.content.${i}.title`));
  return rows;
}

/** The gear on Home, then OK: Home's menu. */
async function openHomeMenu(label) {
  await walkOverhangRowTo('settingsIcon', { label: `the gear on ${label}` });
  await press(ecp.Key.Ok);
  await waitPageMenu(label);
}

/** In Home's open menu: row `menuRow`, then row `listRow` of a list whose first row reads `firstRow`. */
async function pick(label, menuRow, firstRow, listRow) {
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
}

const readSetting = async (name) =>
  (await odc.getValue({ base: 'global', keyPath: `user.settings.${name}` })).value;

it("Home's gear lists Home's settings with their values, then All settings; Favorites lists Row Layout", async () => {
  await launchHome('the Home menu');
  await openHomeMenu('Home');
  expect(await dialogRows(), 'the Home tab menu, at the default settings').toEqual([
    'Row Layout (Full Width)',
    'Episode Images Next Up (Use Web Client Setting)',
    'Home Row Size (32)',
    'Max Days Next Up (No limit)',
    'Rewatching Next Up (Disabled)',
    'All settings',
  ]);
  await press(ecp.Key.Back);
  await waitDialogClosed('the Home menu closed');
  await waitFocused(atSettingsIcon, { timeout: 8000, interval: 250, label: 'back on the gear' });
  await press(ecp.Key.Down);
  await waitFocusInHomeContent({ label: "Home's rows again, below the row" });

  await selectHomeTab('favorites');
  await openHomeMenu('the Favorites tab');
  expect(await dialogRows(), 'the Favorites tab menu').toEqual([
    'Row Layout (Full Width)',
    'All settings',
  ]);
});

it("Row Layout picked from Home's menu lays the rows out again in place and saves it", async () => {
  await launchHome('Row Layout from the menu');
  const list = await homeListId();
  expect((await getActiveVals([`${list}.translation`]))[0], 'full width to begin with').toEqual([
    0, 126,
  ]);

  await openHomeMenu('Home');
  await pick('Row Layout: Original', 0, 'Original', 0);

  const [translation, focusXOffset] = await getActiveVals([
    `${list}.translation`,
    `${list}.focusXOffset`,
  ]);
  expect(translation, 'the rows moved in from the edge').toEqual([111, 126]);
  expect(focusXOffset, 'and the focus offset follows').toEqual([]);
  expect(await readSetting('uiRowLayout'), 'saved as Settings saves it').toBe('original');
});

it("Max Days Next Up picked from Home's menu is saved and reloads Home's rows", async (testCtx) => {
  await launchHome('Max Days from the menu');
  const list = await homeListId();
  const markPath = `${list}.content.0.0.title`;
  const [firstTitle] = await getActiveVals([markPath]);
  if (typeof firstTitle !== 'string') testCtx.skip("Home's first row has no item to mark");
  // A reload gives every cell a new item node, so a mark on this one says whether it happened
  await odc.setValue({ base: 'global', keyPath: `activeRoutedView.${markPath}`, value: 'rta-old' });

  await openHomeMenu('Home');
  await pick('Max Days Next Up: 30 days', 3, 'No limit', 3);

  expect(await readSetting('uiDetailsMaxDaysNextUp'), 'saved as an integer').toBe(30);
  // eslint-disable-next-line jellyrock-rta/wait-justified -- DYN: Home's list id is a run-time value (homeListId). The row's first item is replaced by the reload's appendChildren and holds until the next load, so a poll cannot miss it.
  await waitFor(markPath, (t) => typeof t === 'string' && t !== 'rta-old', {
    read: getActiveVal,
    label: "Home's rows reloaded",
    timeout: 20000,
  });

  await openHomeMenu('Home again');
  expect((await dialogRows())[3], 'the menu names the new value').toBe(
    'Max Days Next Up (30 days)',
  );
});
