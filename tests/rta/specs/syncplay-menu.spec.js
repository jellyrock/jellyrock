/**
 * The cluster's SyncPlay icon is the membership's state and its control. Outside a group it
 * is outlined and opens the groups to join (a New group row last); OK on a group's row joins
 * it and the icon fills; the icon then opens a confirm naming the group, whose Leave Group
 * leaves and outlines the icon again. A second member of the same account, over REST,
 * creates the group the Roku joins, so the row's text is checked against a known name.
 * While in a group, Play on a movie goes to the group (decision B): the Roku posts the queue,
 * the server answers every member with it, and the Roku's player mounts from that answer.
 */
import { afterAll, beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import {
  authenticate,
  commandChannelAvailable,
  getHero,
  getJson,
  getLibraries,
  libraryIdFor,
  postJson,
  tokenHeader,
} from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { focusOverhangIcon, startPlayback } from '../lib/nav.js';
import {
  getActiveVal,
  getGlobalVal,
  getVal,
  getVals,
  press,
  stopPlayback,
  waitDialogClosed,
  waitFocused,
  waitFocusInHomeContent,
  waitFor,
  waitMediaPlaying,
  waitToast,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const GROUP_NAME = 'RTA watch party';
const atSyncPlayIcon = (f) => f?.node?.id === 'syncplayIcon';
const isOutlined = (uri) => typeof uri === 'string' && uri.includes('groups_outline');
// The field holds the uri as written, `$$RES$$` unresolved: the glyph name is what tells the two apart.
const isFilled = (uri) => typeof uri === 'string' && uri.includes('groups_') && !isOutlined(uri);

let session;
let member;
let pushAvailable;
// The movie-details walk (`startPlayback`): the libraries and the hero movie's tile index.
let ctx;

// The server's SyncPlay routes take a JSON body and answer 415 without the content type.
const syncPlay = (who, action, body = {}) =>
  postJson(
    `${who.serverUrl}/SyncPlay/${action}`,
    { ...tokenHeader(who.token), 'Content-Type': 'application/json' },
    body,
  );
const listGroups = (who) => getJson(`${who.serverUrl}/SyncPlay/List`, tokenHeader(who.token));

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  member = await authenticate(RTA_CONFIG.server, { role: 'member' });
  // The join's GroupJoined update is pushed to the Roku: without a channel for it the
  // manager never learns of the group, so the second test skips visibly rather than wait.
  pushAvailable = await commandChannelAvailable(session);
  const libraries = await getLibraries(session);
  const hero = await getHero(session, libraryIdFor(libraries, 'movies'));
  ctx = { heroIndex: hero.index, heroId: hero.id, session, libraries };
  // A group a previous run left behind would double the rows this spec counts.
  await syncPlay(member, 'Leave').catch(() => {});
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'syncplay-menu');
});

afterAll(async () => {
  // Both members out, so the next run's row count starts from the server's own groups.
  await odc
    .callFunc({ base: 'global', keyPath: 'syncPlayManager', funcName: 'leave' }, { timeout: 10000 })
    .catch(() => {});
  await syncPlay(member, 'Leave').catch(() => {});
});

/** The list dialog's rows, once it holds `count` of them. */
async function waitMenuRows(count, label) {
  await waitFor('#optionList.content.getChildCount()', (n) => n === count, {
    label: `${label}: ${count} row(s) in the SyncPlay menu`,
    timeout: 20000,
  });
  return getVals(Array.from({ length: count }, (_, i) => `#optionList.content.${i}.title`));
}

it('outside a group the icon is outlined and the menu ends with New group; Back returns to the icon', async () => {
  await focusOverhangIcon('syncplayIcon');
  expect(
    isOutlined(await getVal('#overhang.#cluster.#syncplayIcon.icon')),
    'the icon is outlined outside a group',
  ).toBe(true);
  expect(await getGlobalVal('syncPlayManager.inGroup')).toBe(false);

  const groupsBefore = await listGroups(session);
  await press(ecp.Key.Ok);
  const titles = await waitMenuRows(groupsBefore.length + 1, 'no group of our own');
  expect(titles[titles.length - 1], 'the last row creates a group').toBe('New group');

  await press(ecp.Key.Back);
  await waitDialogClosed('SyncPlay menu dismissed', { timeout: 10000 });
  await waitFocused(atSyncPlayIcon, {
    timeout: 8000,
    interval: 250,
    label: 'the icon again after Back',
  });
});

it('OK on a group joins it and fills the icon; the icon then offers Leave Group, which leaves', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  await syncPlay(member, 'New', { GroupName: GROUP_NAME });
  const groups = await listGroups(member);
  const index = groups.findIndex((g) => g.GroupName === GROUP_NAME);
  expect(index, 'the member created the group').toBeGreaterThanOrEqual(0);

  await waitFocused(atSyncPlayIcon, {
    timeout: 8000,
    interval: 250,
    label: 'the icon before the join',
  });
  await press(ecp.Key.Ok);
  const titles = await waitMenuRows(groups.length + 1, 'one group to join');
  expect(titles[index], 'the row names the group and its member').toContain(GROUP_NAME);
  expect(titles[index]).toContain(RTA_CONFIG.server.username);

  // The list opens on row 0: Down until the group's row holds focus. The re-press each tick
  // is the mechanism (a dropped Down is re-sent), guarded so an arrived walk never overshoots.
  await waitFor('#optionList.itemFocused', (i) => i === index, {
    label: 'the group row focused',
    timeout: 10000,
    interval: 400,
    action: async () => {
      if ((await getVal('#optionList.itemFocused')) < index) await press(ecp.Key.Down);
    },
  });
  await press(ecp.Key.Ok);
  await waitDialogClosed('join menu closed', { timeout: 10000 });
  await waitFor('#overhang.#cluster.#syncplayIcon.icon', isFilled, {
    label: 'the icon fills on the join',
    timeout: 20000,
  });
  await waitToast(`Joined ${GROUP_NAME}.`, { label: 'the joined toast' });
  expect(await getGlobalVal('syncPlayManager.inGroup')).toBe(true);
  expect(await getGlobalVal('syncPlayManager.groupName')).toBe(GROUP_NAME);

  await waitFocused(atSyncPlayIcon, {
    timeout: 8000,
    interval: 250,
    label: 'the icon after the join',
  });
  await press(ecp.Key.Ok);
  await waitFor('#buttonRow.getChildCount()', (n) => n === 2, {
    label: 'the leave dialog',
    timeout: 20000,
  });
  const [cancelLabel, leaveLabel] = await getVals(['#buttonRow.0.text', '#buttonRow.1.text']);
  expect(cancelLabel, 'button labels must read or the waits below prove nothing').toBeTruthy();
  expect(leaveLabel).toBe('Leave Group');
  expect(await getVal('#jrDialog.title'), 'the dialog is named after the group').toBe(GROUP_NAME);

  await waitFocused((f) => f.node?.text === cancelLabel, {
    label: 'Cancel focused on open',
    timeout: 5000,
  });
  await press(ecp.Key.Right);
  await waitFocused((f) => f.node?.text === leaveLabel, {
    label: 'Leave Group focused',
    timeout: 5000,
  });
  await press(ecp.Key.Ok);
  await waitDialogClosed('leave dialog closed', { timeout: 10000 });
  await waitFor('#overhang.#cluster.#syncplayIcon.icon', isOutlined, {
    label: 'the icon outlines on the leave',
    timeout: 20000,
  });
  await waitToast(`Left ${GROUP_NAME}.`, { label: 'the left toast' });
  expect(await getGlobalVal('syncPlayManager.inGroup')).toBe(false);
});

it('Play on a movie while in a group goes to the group, whose answer starts the player', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  await syncPlay(member, 'New', { GroupName: GROUP_NAME });
  // The REST member never reports Ready: without this the group waits on it for good, and
  // the Roku's player would sit paused at the start.
  await syncPlay(member, 'SetIgnoreWait', { IgnoreWait: true });
  const group = (await listGroups(member)).find((g) => g.GroupName === GROUP_NAME);
  expect(group, 'the member created the group').toBeTruthy();

  // The menu's join is the test above; this one joins directly and checks the icon agrees.
  await odc.callFunc(
    { base: 'global', keyPath: 'syncPlayManager', funcName: 'join', funcParams: [group.GroupId] },
    { timeout: 10000 },
  );
  await waitFor('#overhang.#cluster.#syncplayIcon.icon', isFilled, {
    label: 'the icon fills on the direct join',
    timeout: 20000,
  });

  // Focus is on the icon after the join: Down returns it to Home's rows, where the walk starts.
  await waitFocusInHomeContent({
    label: 'back in Home content before the movie walk',
    action: () => press(ecp.Key.Down),
  });
  await startPlayback(ctx);
  await waitToast(`Playing this for ${GROUP_NAME}.`, { label: 'the hand-off toast' });
  // The group's PlayQueue answer, not the press, is what mounts the player.
  await waitFor('subtype()', (v) => v === 'PlayerHostView', {
    read: getActiveVal,
    timeout: 30000,
    interval: 250,
    label: 'the player mounted from the group answer',
  });
  await waitMediaPlaying("the group's item", 60000);
  expect(await getGlobalVal('syncPlayManager.following'), 'the Roku follows the group').toBe(true);
  expect(
    await getGlobalVal('syncPlayManager.sync.playingItemId'),
    'the group has a playing item',
  ).toBeTruthy();
  const after = (await listGroups(member)).find((g) => g.GroupId === group.GroupId);
  expect(after?.State, 'the group left Idle for the queue the Roku posted').not.toBe('Idle');

  // Back halts: the member stays in the group, the player closes, and the viewer is told.
  await stopPlayback();
  await waitToast(`No longer following ${GROUP_NAME}. What plays now is your own.`, {
    label: 'the halted toast',
  });
  expect(await getGlobalVal('syncPlayManager.inGroup')).toBe(true);
  expect(await getGlobalVal('syncPlayManager.following')).toBe(false);
});
