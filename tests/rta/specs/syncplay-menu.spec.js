/**
 * The cluster's SyncPlay icon is the membership's state and its control. Outside a group it
 * is at rest and opens the groups to join (a New group row last); OK on a group's row joins
 * it and the icon turns active (colorSecondary); the icon then opens a confirm naming the group,
 * whose Leave Group leaves and puts the icon back to rest. A second member of the same account, over REST,
 * creates the group the Roku joins, so the row's text is checked against a known name.
 * While in a group, Play on a movie goes to the group (decision `syncplay-play-handed-to-group`):
 * the Roku posts the queue, the server answers every member with it, and the Roku's player
 * mounts from that answer.
 * A membership the app exit left behind is remembered in the registry and ended at the next
 * launch (decision `syncplay-stale-membership-at-launch`).
 */
import { afterAll, beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import {
  appSession,
  authenticate,
  commandChannelAvailable,
  getHero,
  getJson,
  getLibraries,
  libraryIdFor,
  playOnSession,
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
  waitHome,
  waitMediaPlaying,
  waitToast,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const GROUP_NAME = 'RTA watch party';
const atSyncPlayIcon = (f) => f?.node?.id === 'syncplayIcon';
// The icon's on-state (`JROverhangIcon.isActive`, read at `#overhang.#cluster.#syncplayIcon.isActive`):
// its glyph is drawn in colorSecondary while in a group. The waits spell the keyPath out, so the
// wait-justified lint can check it.
const isActive = (v) => v === true;
const isInactive = (v) => v === false;

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

/** `count` movies of the movies library other than the hero, in the grid's order. */
async function moviesOtherThanHero(count) {
  const query = new URLSearchParams({
    userId: session.userId,
    ParentId: libraryIdFor(ctx.libraries, 'movies'),
    IncludeItemTypes: 'Movie',
    Recursive: 'true',
    SortBy: 'SortName',
    Limit: String(count + 1),
  });
  const res = await getJson(`${session.serverUrl}/Items?${query}`, tokenHeader(session.token));
  const ids = res.Items.map((i) => i.Id).filter((id) => id !== ctx.heroId);
  expect(
    ids.length,
    `the movies library holds ${count} movies besides the hero`,
  ).toBeGreaterThanOrEqual(count);
  return ids.slice(0, count);
}

/** The list dialog's rows, once it holds `count` of them. */
async function waitMenuRows(count, label) {
  await waitFor('#optionList.content.getChildCount()', (n) => n === count, {
    label: `${label}: ${count} row(s) in the SyncPlay menu`,
    timeout: 20000,
  });
  return getVals(Array.from({ length: count }, (_, i) => `#optionList.content.${i}.title`));
}

it('outside a group the icon is at rest and the menu ends with New group; Back returns to the icon', async () => {
  await focusOverhangIcon('syncplayIcon');
  expect(
    isInactive(await getVal('#overhang.#cluster.#syncplayIcon.isActive')),
    'the icon is not active outside a group',
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

it('OK on a group joins it and makes the icon active; the icon then offers Leave Group, which leaves', async (testCtx) => {
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
  await waitFor('#overhang.#cluster.#syncplayIcon.isActive', isActive, {
    label: 'the icon turns active on the join',
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
  await waitFor('#overhang.#cluster.#syncplayIcon.isActive', isInactive, {
    label: 'the icon goes back to rest on the leave',
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
  await waitFor('#overhang.#cluster.#syncplayIcon.isActive', isActive, {
    label: 'the icon turns active on the direct join',
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

it('a cast while halted follows the group again, and a cast over its player ends the start it opened', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  // The case above leaves the Roku halted in the group, its player closed.
  expect(await getGlobalVal('syncPlayManager.inGroup'), 'in the group from the case above').toBe(
    true,
  );
  expect(await getGlobalVal('syncPlayManager.following'), 'halted by its Back').toBe(false);
  const [first, second] = await moviesOtherThanHero(2);
  const roku = await appSession(member, await getGlobalVal('device.serverDeviceName'));

  // Halted: the cast follows the group again and goes to it as a new queue. The group's answer
  // opens the player (applyQueue's launch branch), and the follow the cast made holds after it.
  await playOnSession(member, roku.Id, [first]);
  await waitToast(`Playing this for ${GROUP_NAME}.`, { label: 'the first cast handed over' });
  await waitFor('subtype()', (v) => v === 'PlayerHostView', {
    read: getActiveVal,
    timeout: 30000,
    interval: 250,
    label: "the player mounted from the group's answer to the first cast",
  });
  await waitMediaPlaying('the first cast', 60000);
  expect(
    await getGlobalVal('syncPlayManager.following'),
    'the answered cast keeps it following',
  ).toBe(true);

  // Over the mounted player: the group's answer reloads it in place (the remount branch), and no
  // wait may outlive the reload. playingItemId moves when that answer arrives and holds, so it
  // proves the cast was handled before openWaits is read; the reloaded player takes the start
  // the cast opened (takePlaybackStart) and ends it once its stream holds.
  const before = await getGlobalVal('syncPlayManager.sync.playingItemId');
  await playOnSession(member, roku.Id, [second]);
  await waitFor('syncPlayManager.sync.playingItemId', (v) => Boolean(v) && v !== before, {
    read: getGlobalVal,
    timeout: 30000,
    label: "the group's answer to the cast over the player",
  });
  await waitFor('#appWaitHost.openWaits', (v) => v && Object.keys(v).length === 0, {
    read: getVal,
    // Far inside the start's own time limit, so the limit cannot be what ended it.
    timeout: 20000,
    label: 'no wait left open after the reload in place',
  });
  await waitMediaPlaying('the cast over the player', 60000);
  expect(await getActiveVal('subtype()'), 'the player reloaded in place').toBe('PlayerHostView');
  expect(await getGlobalVal('syncPlayManager.following')).toBe(true);

  await stopPlayback();
});

it('a membership the app exit left behind is remembered, and ended at the next launch', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  await syncPlay(member, 'Leave').catch(() => {});
  await syncPlay(member, 'New', { GroupName: GROUP_NAME });
  const group = (await listGroups(member)).find((g) => g.GroupName === GROUP_NAME);
  expect(group, 'the member created the group').toBeTruthy();
  await odc.callFunc(
    { base: 'global', keyPath: 'syncPlayManager', funcName: 'join', funcParams: [group.GroupId] },
    { timeout: 10000 },
  );
  await waitFor('#overhang.#cluster.#syncplayIcon.isActive', isActive, {
    label: 'the icon turns active on the join',
    timeout: 20000,
  });
  const before = (await odc.readRegistry())?.values?.[session.userId] ?? {};
  expect(before.syncPlayGroup, 'the registry remembers the group while in it').toContain(
    GROUP_NAME,
  );

  // The app exit: nothing posts Leave. Home's first run then leaves whatever the registry
  // remembers, before Home finishes mounting, and forgets it.
  await hardRelaunch();
  await waitHome();
  const after = (await odc.readRegistry())?.values?.[session.userId] ?? {};
  expect(after.syncPlayGroup, 'the registry forgets the group at the next launch').toBeUndefined();
  expect(await getGlobalVal('syncPlayManager.inGroup'), 'no membership in memory').toBe(false);
});
