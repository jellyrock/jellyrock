/**
 * The theme colors the app draws with come from the chosen theme, not from the seven
 * `uiThemeColor*` registry keys alone, and a choice in Settings applies the moment it is made.
 *
 * Signing in with a built-in theme applies that theme's colors even when the color keys hold
 * other values, and leaves those keys alone, so the custom colors survive for the day the user
 * picks Custom again. Custom reads the keys, and a user with no theme gets the JellyRock default.
 *
 * Picking a preset in Settings and then leaving it by the overhang (search opens over Settings,
 * so Settings' own exit never runs) restyles the next screen with the picked colors, shows no
 * "replace your custom colors" prompt, and leaves the custom keys as they were.
 *
 * The registry keys are seeded for each case and cleared when the file ends: the runner restores
 * the whole registry only at the end of the run, and a theme left behind would restyle every
 * later spec.
 */
import fs from 'node:fs';
import { afterAll, beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { navSettings } from '../lib/nav.js';
import {
  getActiveVal,
  getActiveVals,
  getGlobalVal,
  getVal,
  press,
  resendUntilFocusInside,
  scrollFocus,
  waitFocused,
  waitFocusInside,
  waitFor,
  walkOverhangRowTo,
} from '../lib/steps.js';

// The menu labels this file walks by are English.
const LOCALE = 'en_US';

/** Each registry key that carries a color, with the Constants field the app draws it with. */
const COLOR_KEYS = Object.freeze({
  uiThemeColorPrimary: 'colorPrimary',
  uiThemeColorSecondary: 'colorSecondary',
  uiThemeColorBackgroundPrimary: 'colorBackgroundPrimary',
  uiThemeColorBackgroundSecondary: 'colorBackgroundSecondary',
  uiThemeColorTextPrimary: 'colorTextPrimary',
  uiThemeColorTextSecondary: 'colorTextSecondary',
  uiThemeColorTextDisabled: 'colorTextDisabled',
});
const THEME_KEYS = ['uiTheme', ...Object.keys(COLOR_KEYS)];

/** A color no preset in settings.json uses, so a preset and a custom value can never agree by chance. */
const CUSTOM_PRIMARY = '123ABC';

/** The uiTheme options from settings.json, the same file the app reads its presets from. */
function readThemeOptions() {
  const tree = JSON.parse(
    fs.readFileSync(new URL('../../../settings/settings.json', import.meta.url), 'utf8'),
  );
  const find = (nodes) => {
    for (const node of nodes) {
      if (node.settingName === 'uiTheme') return node;
      const found = node.children ? find(node.children) : undefined;
      if (found) return found;
    }
    return undefined;
  };
  return find(tree).options;
}

const THEME_OPTIONS = readThemeOptions();
const presetOf = (id) => THEME_OPTIONS.find((o) => o.id === id).presetValues;

let session;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
});

/** Delete every theme key from the signed-in user's registry section (null = delete the key). */
async function clearThemeKeys() {
  const nulls = Object.fromEntries(THEME_KEYS.map((key) => [key, null]));
  await odc.writeRegistry({ values: { [session.userId]: nulls } });
}

afterAll(async () => {
  if (session) await clearThemeKeys();
});

/** Land signed in on a cold start with exactly these theme keys in the user's section. */
async function freshAppWithTheme(label, themeKeys) {
  const expectedServer = await seedHome(session, LOCALE);
  await clearThemeKeys();
  if (Object.keys(themeKeys).length) {
    await odc.writeRegistry({ values: { [session.userId]: themeKeys } });
  }
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, label);
}

/** The seven Constants colors the app is drawing with, read in one batch, as `0x` strings. */
async function readConstants() {
  const names = Object.values(COLOR_KEYS);
  const batch = await odc.getValues({
    requests: Object.fromEntries(
      names.map((name, i) => [`k${i}`, { base: 'global', keyPath: `constants.${name}` }]),
    ),
  });
  return Object.fromEntries(names.map((name, i) => [name, batch?.results?.[`k${i}`]?.value]));
}

/** What the seven Constants should read for a preset's values. */
function expectedConstants(presetValues) {
  return Object.fromEntries(
    Object.entries(COLOR_KEYS).map(([key, name]) => [name, `0x${presetValues[key].toUpperCase()}`]),
  );
}

/** The signed-in user's registry section. */
async function readUserSection() {
  const reg = await odc.readRegistry();
  return reg?.values?.[session.userId] ?? {};
}

it('a built-in theme applies its own colors at sign-in and leaves the color keys alone', async () => {
  await freshAppWithTheme('theme preset over keys', {
    uiTheme: 'emerald',
    uiThemeColorPrimary: CUSTOM_PRIMARY,
  });

  const emerald = presetOf('emerald');
  expect(emerald.uiThemeColorPrimary, 'the seeded color is not the preset color').not.toBe(
    CUSTOM_PRIMARY,
  );
  expect(await getGlobalVal('constants.colorPrimary'), 'emerald primary').toBe(
    `0x${emerald.uiThemeColorPrimary}`,
  );
  expect(await readConstants(), 'every color is the preset color').toEqual(
    expectedConstants(emerald),
  );

  const section = await readUserSection();
  expect(section.uiThemeColorPrimary, 'the custom color survives under a preset').toBe(
    CUSTOM_PRIMARY,
  );
  expect(section.uiTheme).toBe('emerald');
});

it('the Custom theme applies the color keys', async () => {
  await freshAppWithTheme('theme custom', {
    uiTheme: 'custom',
    uiThemeColorPrimary: CUSTOM_PRIMARY,
  });

  expect(await getGlobalVal('constants.colorPrimary'), 'the custom primary').toBe(
    `0x${CUSTOM_PRIMARY}`,
  );
});

it('no theme and no color keys gives the JellyRock default', async () => {
  await freshAppWithTheme('theme default', {});

  expect(await readConstants(), 'every color is the JellyRock preset').toEqual(
    expectedConstants(presetOf('jellyrock')),
  );
});

/**
 * The titles of the Settings menu now showing, in order.
 *
 * Settings swaps one list's content as the user goes into and out of a group, so the labels
 * are what says which menu this is. Two reads (count, then titles), never mid-swap in a way
 * that matters: every caller waits for a label that only the wanted menu holds.
 */
async function menuTitles() {
  const count = await getActiveVal('#settingsMenu.content.getChildCount()');
  if (!(count > 0)) return [];
  const titles = await getActiveVals(
    [...Array(count).keys()].map((i) => `#settingsMenu.content.${i}.title`),
  );
  return titles.filter((t) => typeof t === 'string');
}

/**
 * Wait until the Settings menu holds `label`. The keyPath is a function result
 * (`getChildCount()`) and the read returns the titles beside it, so the poll is a function
 * wait (`FN`): the menu's content is replaced by the app, never pulsed.
 */
async function waitMenuHas(label, why) {
  return waitFor('#settingsMenu.content.getChildCount()', (titles) => titles.includes(label), {
    read: () => menuTitles(),
    timeout: 15000,
    interval: 300,
    label: why,
  });
}

/** Walk the Settings menu to the entry titled `label` and press Right on it. */
async function walkMenuTo(label) {
  const titles = await menuTitles();
  const target = titles.indexOf(label);
  expect(target, `the menu lists "${label}" (has ${JSON.stringify(titles)})`).toBeGreaterThan(-1);
  await waitFocusInside('#settingsMenu', { label: `the settings menu before "${label}"` });
  await scrollFocus({
    keyPath: '#settingsMenu.itemFocused',
    target,
    forwardKey: ecp.Key.Down,
    backKey: ecp.Key.Up,
    read: getActiveVal,
    stepped: true,
    within: '#settingsMenu',
    label: `the settings menu entry "${label}"`,
  });
}

it('a preset picked in Settings applies at once when search opens over Settings, with no prompt', async () => {
  await freshAppWithTheme('theme picked in settings', {
    uiTheme: 'custom',
    uiThemeColorPrimary: CUSTOM_PRIMARY,
  });
  const wanted = THEME_OPTIONS.find((o) => o.id === 'emerald');
  const preset = wanted.presetValues;
  expect(await getGlobalVal('constants.colorPrimary'), 'starts on the custom primary').toBe(
    `0x${CUSTOM_PRIMARY}`,
  );

  await navSettings();
  await waitFocusInside('#settingsMenu', { label: 'the settings menu' });

  // User Interface, General, Theme: each Right opens the group, and the labels that only the
  // opened menu holds say it arrived.
  await walkMenuTo('User Interface');
  await press(ecp.Key.Right);
  await waitMenuHas('General', 'the User Interface group');
  await walkMenuTo('General');
  await press(ecp.Key.Right);
  await waitMenuHas('Theme', 'the General group');
  await walkMenuTo('Theme');

  // The radio list is filled one turn after the menu focus lands: wait for all its options.
  await waitFor('#radioSetting.content.getChildCount()', (n) => n === THEME_OPTIONS.length, {
    read: getActiveVal,
    timeout: 10000,
    interval: 300,
    label: 'the theme options listed',
  });
  await press(ecp.Key.Right);
  await waitFocusInside('#radioSetting', {
    label: 'the theme options',
    action: resendUntilFocusInside(ecp.Key.Right, '#radioSetting'),
  });

  const ids = await getActiveVals(THEME_OPTIONS.map((_, i) => `#radioSetting.content.${i}.id`));
  const index = ids.indexOf(wanted.id);
  expect(index, `the radio lists ${wanted.id} (has ${JSON.stringify(ids)})`).toBeGreaterThan(-1);
  await scrollFocus({
    keyPath: '#radioSetting.itemFocused',
    target: index,
    forwardKey: ecp.Key.Down,
    backKey: ecp.Key.Up,
    read: getActiveVal,
    stepped: true,
    within: '#radioSetting',
    label: `the ${wanted.id} option`,
  });
  await press(ecp.Key.Ok);

  // Back out of the radio, the General group and the User Interface group, to the top menu.
  await press(ecp.Key.Back);
  await waitFocusInside('#settingsMenu', { label: 'the menu after the pick' });
  expect(await getActiveVal('#radioSetting.checkedItem'), 'the option is checked').toBe(index);
  await press(ecp.Key.Back);
  await waitMenuHas('Libraries', 'back in the User Interface group');
  await press(ecp.Key.Back);
  await waitMenuHas('User Interface', 'back at the top menu');
  await waitFocusInside('#settingsMenu', { label: 'the top menu' });

  // Up from the menu's first entry enters the overhang, on its first icon: SyncPlay for an
  // account that may use it, search otherwise. Settings' own exit never runs from here: search
  // opens over it.
  await scrollFocus({
    keyPath: '#settingsMenu.itemFocused',
    target: 0,
    forwardKey: ecp.Key.Down,
    backKey: ecp.Key.Up,
    read: getActiveVal,
    stepped: true,
    within: '#settingsMenu',
    label: 'the first menu entry',
  });
  await press(ecp.Key.Up);
  // Wait for any overhang icon before walking, so no Right can reach the Settings menu if Up is slow.
  await waitFocused((f) => f?.node?.subtype === 'JROverhangIcon', {
    timeout: 8000,
    interval: 250,
    label: 'the row from Settings',
  });
  await walkOverhangRowTo('searchIcon', { label: 'the search icon from Settings' });
  await press(ecp.Key.Ok);
  await waitFor('subtype()', (v) => v === 'SearchScreen', {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label: 'search, opened from the overhang over Settings',
  });
  await waitFocusInside('#kbd', { label: 'the search keyboard' });

  expect(await readConstants(), `the colors are ${wanted.id}'s, not the custom ones`).toEqual(
    expectedConstants(preset),
  );
  expect(await getVal('#jrDialog.id'), 'no confirm dialog appeared').toBeUndefined();

  const section = await readUserSection();
  expect(section.uiTheme, 'the pick was saved').toBe(wanted.id);
  expect(section.uiThemeColorPrimary, 'the custom color keys were not overwritten').toBe(
    CUSTOM_PRIMARY,
  );
});
