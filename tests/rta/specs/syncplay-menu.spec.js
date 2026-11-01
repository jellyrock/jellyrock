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
 * On a server with no push channel to the Roku (https without the companion plugin, which is what
 * the default public demo is) a join could never be followed, so the icon is shown disabled with
 * no dot, and OK explains the plugin need instead of opening the menu.
 */
import { afterAll, beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import {
  appSession,
  authenticate,
  authenticateForPush,
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
import { failRequests } from '../lib/failRequests.js';
import {
  getActiveVal,
  getGlobalVal,
  getVal,
  getVals,
  press,
  readPlayer,
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
// The icon's badge (`JROverhangIcon.hasBadge`, read at `#overhang.#cluster.#syncplayIcon.hasBadge`):
// a colorSecondary dot while a group exists to join and the Roku is in none.
const hasBadge = (v) => v === true;
const noBadge = (v) => v === false;
// The icon's disabled flag (`JROverhangIcon.isDisabled`, read at
// `#overhang.#cluster.#syncplayIcon.isDisabled`): set while the server has no push channel.
const isDisabled = (v) => v === true;

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
  session = await authenticateForPush(RTA_CONFIG.server, () =>
    getGlobalVal('device.serverDeviceName'),
  );
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
    // A library that groups movies into collections answers with the BoxSet itself, which the
    // group cannot follow, so ask for the movies inside collections.
    CollapseBoxSetItems: 'false',
    SortBy: 'SortName',
    Limit: String(count + 1),
  });
  const res = await getJson(`${session.serverUrl}/Items?${query}`, tokenHeader(session.token));
  for (const item of res.Items) {
    expect(
      item.Type,
      `the server returned "${item.Name}" (${item.Id}) as a ${item.Type}, not a Movie: the group cannot follow it`,
    ).toBe('Movie');
  }
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

it('without a push channel the icon is disabled and has no dot; OK explains the plugin need and Back returns to the icon', async (testCtx) => {
  if (pushAvailable)
    testCtx.skip('the server has a push channel to this Roku, so the icon is enabled');
  // The status settles once the receiver's probe answers, so the icon may appear after Home.
  await waitFor('#overhang.#cluster.#syncplayIcon.isDisabled', isDisabled, {
    label: 'the icon is shown disabled: no push channel',
    timeout: 30000,
  });
  expect(
    noBadge(await getVal('#overhang.#cluster.#syncplayIcon.hasBadge')),
    'a disabled icon carries no dot',
  ).toBe(true);

  await focusOverhangIcon('syncplayIcon');
  await press(ecp.Key.Ok);
  await waitFor('#jrDialog.message', (m) => typeof m === 'string' && m.includes('HTTPS'), {
    label: 'the alert names the HTTPS plugin need',
    timeout: 10000,
  });
  expect(await getGlobalVal('syncPlayManager.inGroup'), 'no group was joined').toBe(false);

  await press(ecp.Key.Back);
  await waitDialogClosed('the plugin alert dismissed', { timeout: 10000 });
  await waitFocused(atSyncPlayIcon, {
    timeout: 8000,
    interval: 250,
    label: 'the icon again after Back',
  });
});

it('outside a group the icon is at rest and the menu ends with New group; Back returns to the icon', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip('the SyncPlay menu is not offered without a push channel (the icon is disabled)');
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

it('a second OK while the group list loads is ignored: one wait, and the screen comes back', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip('the SyncPlay menu is not offered without a push channel (the icon is disabled)');
  // The case above ends on the icon; walking up from Home again would fail there, so walk only
  // when the spec is not coming from it.
  if (!atSyncPlayIcon(await odc.getFocusedNode({ includeNode: true }))) {
    await focusOverhangIcon('syncplayIcon');
  }
  const groupsBefore = await listGroups(session);
  // The list answers late, so the second press lands while the first one's fetch is in flight.
  await failRequests([{ prefix: 'syncPlayGroups', kind: 'slow', ms: 2000 }]);
  try {
    await press(ecp.Key.Ok);
    await press(ecp.Key.Ok);
    await waitFor('#appWaitHost.openWaits', (v) => v && Object.keys(v).length >= 1, {
      read: getVal,
      timeout: 5000,
      label: 'the list fetch holds a wait',
    });
    const waits = await getVal('#appWaitHost.openWaits');
    expect(Object.keys(waits), 'one wait for two presses').toHaveLength(1);

    await waitMenuRows(groupsBefore.length + 1, 'the list after the slow answer');
  } finally {
    await failRequests([]);
  }
  await press(ecp.Key.Back);
  await waitDialogClosed('SyncPlay menu dismissed', { timeout: 10000 });
  await waitFor('#appWaitHost.openWaits', (v) => v && Object.keys(v).length === 0, {
    read: getVal,
    // Far inside the wait's own time limit, so the limit cannot be what ended it.
    timeout: 10000,
    label: 'no wait left open after the menu closed',
  });
  expect(await getActiveVal('opacity'), 'the screen is not left hidden by a wait').toBe(1);
});

it('while the group list loads the screen stays in view and the wait holds the keys; Back cancels it and no menu opens', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip('the SyncPlay menu is not offered without a push channel (the icon is disabled)');
  if (!atSyncPlayIcon(await odc.getFocusedNode({ includeNode: true }))) {
    await focusOverhangIcon('syncplayIcon');
  }
  // The list answers late, so the wait is open long enough to read the screen and press Back.
  await failRequests([{ prefix: 'syncPlayGroups', kind: 'slow', ms: 2000 }]);
  try {
    await press(ecp.Key.Ok);
    await waitFor('#appWaitHost.openWaits', (v) => v && Object.keys(v).length === 1, {
      read: getVal,
      timeout: 5000,
      label: 'the list fetch holds one wait',
    });
    // The slowed answer is on a pool slot now, so it is still ahead when Back lands.
    await waitFor('rtaHeldRequests', (v) => v === 1, {
      read: getGlobalVal,
      timeout: 5000,
      interval: 100,
      label: 'the slowed list answer is held',
    });

    // One batch: the wait neither hides the screen nor the overhang, and it holds the focus.
    const [screenOpacity, overhangOpacity] = await Promise.all([
      getActiveVal('opacity'),
      getVal('#overhang.opacity'),
    ]);
    const focused = await odc.getFocusedNode({ includeNode: true });
    expect(screenOpacity, 'the screen stays in view during the fetch').toBe(1);
    expect(overhangOpacity, 'the overhang stays in view during the fetch').toBe(1);
    expect(focused?.node?.id, 'the wait host holds the keys, not the icon').toBe('appWaitHost');

    await press(ecp.Key.Back);
    await waitFor('#appWaitHost.openWaits', (v) => v && Object.keys(v).length === 0, {
      read: getVal,
      // Far inside the wait's own time limit, so the limit cannot be what ended it.
      timeout: 5000,
      label: 'Back ended the wait',
    });
    await waitFocused(atSyncPlayIcon, {
      timeout: 5000,
      interval: 250,
      label: 'the icon again after Back cancelled the wait',
    });

    // The late answer is delivered once the slot is given back; it must open nothing.
    await waitFor('rtaHeldRequests', (v) => v === 0, {
      read: getGlobalVal,
      timeout: 10000,
      interval: 250,
      label: 'the late list answer arrived',
    });
    expect(await getVal('#jrDialog.id'), 'the cancelled fetch opened no menu').toBeUndefined();
  } finally {
    await failRequests([]);
  }
  expect(await getActiveVal('opacity'), 'the screen is in view').toBe(1);
  expect(
    atSyncPlayIcon(await odc.getFocusedNode({ includeNode: true })),
    'the icon still holds the focus',
  ).toBe(true);
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
  // The menu's own read of the list feeds the badge too, so it shows under the dialog.
  await waitFor('#overhang.#cluster.#syncplayIcon.hasBadge', hasBadge, {
    label: 'the icon carries the dot once the list names a group',
    timeout: 10000,
  });

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
  expect(
    noBadge(await getVal('#overhang.#cluster.#syncplayIcon.hasBadge')),
    'in a group the tint replaces the dot',
  ).toBe(true);

  await waitFocused(atSyncPlayIcon, {
    timeout: 8000,
    interval: 250,
    label: 'the icon after the join',
  });
  await press(ecp.Key.Ok);
  // In a group the menu is one list in every state: Leave Group alone while following.
  await waitFor('#optionList.content.getChildCount()', (n) => n === 1, {
    label: 'the in-group menu',
    timeout: 20000,
  });
  expect(await getVal('#optionList.content.0.title')).toBe('Leave Group');
  const title = await getVal('#jrDialog.title');
  expect(title, 'the menu is named after the group, with its members').toContain(GROUP_NAME);
  expect(title).toContain(session.username);

  await press(ecp.Key.Ok);
  await waitDialogClosed('leave menu closed', { timeout: 10000 });
  await waitFor('#overhang.#cluster.#syncplayIcon.isActive', isInactive, {
    label: 'the icon goes back to rest on the leave',
    timeout: 20000,
  });
  await waitToast(`Left ${GROUP_NAME}.`, { label: 'the left toast' });
  expect(await getGlobalVal('syncPlayManager.inGroup')).toBe(false);
  // Leaving reads the list again, and the member's group is still there to join.
  await waitFor('#overhang.#cluster.#syncplayIcon.hasBadge', hasBadge, {
    label: 'the dot comes back on the leave: the member still holds the group',
    timeout: 10000,
  });
});

it('the dot clears once the list has no group left to join', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  await syncPlay(member, 'Leave');
  const remaining = await listGroups(session);
  await waitFocused(atSyncPlayIcon, {
    timeout: 8000,
    interval: 250,
    label: 'the icon before the menu',
  });
  await press(ecp.Key.Ok);
  await waitMenuRows(remaining.length + 1, 'the groups left, then New group');
  await press(ecp.Key.Back);
  await waitDialogClosed('SyncPlay menu dismissed', { timeout: 10000 });
  // Another client's group on a shared server keeps the dot, rightly.
  const expected = remaining.length > 0 ? hasBadge : noBadge;
  await waitFor('#overhang.#cluster.#syncplayIcon.hasBadge', expected, {
    label: `the dot matches the ${remaining.length} group(s) left`,
    timeout: 10000,
  });
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

it('while halted the menu offers Resume with Group, which opens the player following at the group position', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  // The case above leaves the Roku halted in the group, the group still on its movie.
  expect(await getGlobalVal('syncPlayManager.following'), 'halted by its Back').toBe(false);
  // Back left the player on the details screen; the walk to the icon starts from Home.
  await press(ecp.Key.Back);
  await waitHome();
  await focusOverhangIcon('syncplayIcon');
  await press(ecp.Key.Ok);
  await waitFor('#optionList.content.getChildCount()', (n) => n === 2, {
    label: 'the halted menu: Resume with Group, then Leave Group',
    timeout: 20000,
  });
  expect(await getVals(['#optionList.content.0.title', '#optionList.content.1.title'])).toEqual([
    'Resume with Group',
    'Leave Group',
  ]);
  await press(ecp.Key.Ok);
  await waitDialogClosed('resume menu closed', { timeout: 10000 });
  await waitFor('subtype()', (v) => v === 'PlayerHostView', {
    read: getActiveVal,
    timeout: 30000,
    interval: 250,
    label: 'the player mounted from the resume',
  });
  await waitToast(`Following ${GROUP_NAME} again.`, { label: 'the following-again toast' });
  await waitMediaPlaying("the group's item, resumed", 60000);
  expect(await getGlobalVal('syncPlayManager.following')).toBe(true);
  // The group kept playing while this member was halted, so the resume lands past the start. A
  // load that starts partway in still reads 0 at its first playing (playback.md), so this waits.
  await waitFor('position', (v) => typeof v === 'number' && v > 5, {
    read: readPlayer(ctx.heroId),
    timeout: 15000,
    interval: 250,
    label: 'resumed at the group position, not from zero',
  });

  // Back halts again, leaving the state the next case starts from.
  await stopPlayback();
  await waitToast(`No longer following ${GROUP_NAME}. What plays now is your own.`, {
    label: 'the halted toast after the resume',
  });
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

it('joining a group that is already playing opens its item with the joined toast alone', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  // Out of the group the cases above left it in, so this join is a fresh one.
  await odc.callFunc(
    { base: 'global', keyPath: 'syncPlayManager', funcName: 'leave' },
    { timeout: 10000 },
  );
  await waitFor('#overhang.#cluster.#syncplayIcon.isActive', isInactive, {
    label: 'the icon at rest before the join',
    timeout: 20000,
  });
  await syncPlay(member, 'Leave').catch(() => {});
  await syncPlay(member, 'New', { GroupName: GROUP_NAME });
  await syncPlay(member, 'SetIgnoreWait', { IgnoreWait: true });
  const [movie] = await moviesOtherThanHero(1);
  await syncPlay(member, 'SetNewQueue', {
    PlayingQueue: [movie],
    PlayingItemPosition: 0,
    StartPositionTicks: 0,
  });
  const group = (await listGroups(member)).find((g) => g.GroupName === GROUP_NAME);
  expect(group?.State, 'the group plays something before the Roku joins').not.toBe('Idle');

  // The server answers this join with GroupJoined and then the group's queue, before any
  // command (WaitingGroupState.SessionJoined): the queue's load is the join's, so Joined is
  // the one toast for it.
  await odc.callFunc(
    { base: 'global', keyPath: 'syncPlayManager', funcName: 'join', funcParams: [group.GroupId] },
    { timeout: 10000 },
  );
  await waitToast(`Joined ${GROUP_NAME}.`, { label: 'the joined toast' });
  await waitFor('subtype()', (v) => v === 'PlayerHostView', {
    read: getActiveVal,
    timeout: 30000,
    interval: 250,
    label: "the player mounted from the group's queue",
  });
  await waitMediaPlaying("the group's item after the join", 60000);
  // The load's notice is written before the player opens, so by now any second toast would
  // have replaced the message.
  expect(await getVal('#toast.message'), 'no second toast after Joined').toBe(
    `Joined ${GROUP_NAME}.`,
  );

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
