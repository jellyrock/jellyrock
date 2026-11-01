/**
 * In a SyncPlay group the viewer's own controls go to the group, and the group's commands reach
 * this member as a viewer's would (phase E of the SyncPlay project):
 * - a Pause by another member pauses this Roku with the OSD up, as the Play key does, and the
 *   group's Unpause plays on and hides it;
 * - the Roku's Play key pauses the whole group (the server's state reads Paused) and a second
 *   press has it playing again;
 * - a trickplay scrub confirmed with OK seeks the whole group: the bar closes and this member
 *   lands at the target through the server's Seek.
 * A second member of the same account, over REST, creates the group, ignores the wait (it never
 * reports Ready) and queues the item; the Roku joins directly, as the menu spec's join case
 * already drives the menu. The join needs the server's push channel to the Roku, so the suite
 * skips on a server without one (https without the companion plugin).
 */
import { afterAll, beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import {
  authenticate,
  authenticateForPush,
  commandChannelAvailable,
  getJson,
  postJson,
  tokenHeader,
} from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import {
  getGlobalVal,
  press,
  readPlayer,
  stopPlayback,
  waitFor,
  waitMediaPlaying,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const GROUP_NAME = 'RTA controls party';

let session;
let member;
let pushAvailable;
let groupId;
let heroId;
let nextId;

const syncPlay = (who, action, body = {}) =>
  postJson(
    `${who.serverUrl}/SyncPlay/${action}`,
    { ...tokenHeader(who.token), 'Content-Type': 'application/json' },
    body,
  );
/** The movies that run ten minutes or more, by SortName. */
async function longMovieIds(who) {
  const query = new URLSearchParams({
    UserId: who.userId,
    IncludeItemTypes: 'Movie',
    Recursive: 'true',
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Fields: 'RunTimeTicks',
    Limit: '50',
  });
  const data = await getJson(`${who.serverUrl}/Items?${query}`, tokenHeader(who.token));
  const tenMinutesTicks = 10 * 60 * 10_000_000;
  return (data?.Items ?? [])
    .filter((i) => (i.RunTimeTicks ?? 0) >= tenMinutesTicks)
    .map((i) => i.Id);
}
const listGroups = (who) => getJson(`${who.serverUrl}/SyncPlay/List`, tokenHeader(who.token));
const managerCall = (funcName, ...funcParams) =>
  odc.callFunc(
    { base: 'global', keyPath: 'syncPlayManager', funcName, funcParams },
    { timeout: 10000 },
  );
// The player node is stamped with the item id (`VideoPlayerView`), so its fields read by that id.
const player = () => readPlayer(heroId);
const playerState = () => player()('state');
const playerPosition = () => player()('position');
const playerCall = (itemId, command) =>
  odc.callFunc(
    {
      base: 'scene',
      keyPath: `#${itemId}`,
      funcName: 'handleTransport',
      funcParams: [{ command }],
    },
    { timeout: 10000 },
  );
const localQueueCount = async () =>
  (
    await odc.callFunc(
      { base: 'global', keyPath: 'queueManager', funcName: 'getCount' },
      { timeout: 10000 },
    )
  ).value;
const osdVisible = () => player()('#osd.visible');
const barVisible = () => player()('trickPlayBar.visible');

beforeAll(async () => {
  session = await authenticateForPush(RTA_CONFIG.server, () =>
    getGlobalVal('device.serverDeviceName'),
  );
  member = await authenticate(RTA_CONFIG.server, { role: 'member' });
  pushAvailable = await commandChannelAvailable(session);
  // A movie at least ten minutes long, found by order, never by name: the seek case scrubs
  // 30 s ahead, and `seekToWithBounds` clamps a target to 30 s short of the end.
  [heroId = '', nextId = ''] = await longMovieIds(session);
  expect(heroId, 'a movie of ten minutes or more to play').toBeTruthy();
  await syncPlay(member, 'Leave').catch(() => {});
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'syncplay-controls');
  if (!pushAvailable) return;

  await syncPlay(member, 'New', { GroupName: GROUP_NAME });
  // The REST member never reports Ready: without this the group waits on it for good.
  await syncPlay(member, 'SetIgnoreWait', { IgnoreWait: true });
  groupId = (await listGroups(member)).find((g) => g.GroupName === GROUP_NAME)?.GroupId;
  expect(groupId, 'the member created the group').toBeTruthy();
  await managerCall('join', groupId);
  await waitFor('#overhang.#cluster.#syncplayIcon.isActive', (v) => v === true, {
    timeout: 20000,
    label: 'the Roku in the group',
  });
  // The queue every case drives: the member queues it, and the group's answer mounts the player.
  await syncPlay(member, 'SetNewQueue', {
    PlayingQueue: [heroId],
    PlayingItemPosition: 0,
    StartPositionTicks: 0,
  });
  await waitFor('syncPlayManager.sync.playingItemId', (v) => Boolean(v), {
    read: getGlobalVal,
    timeout: 30000,
    label: "the group's queue reached the Roku",
  });
  await waitMediaPlaying("the group's item", 90000);
  await waitFor('syncPlayManager.sync.lastCommand.command', (v) => v === 'Unpause', {
    read: getGlobalVal,
    timeout: 30000,
    label: "the group's Unpause after this member's first-frame Ready",
  });
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 30000,
    label: 'the node playing after the first-frame Ready and the group Unpause',
  });
});

afterAll(async () => {
  await stopPlayback().catch(() => {});
  await managerCall('leave').catch(() => {});
  await syncPlay(member, 'Leave').catch(() => {});
});

it("another member's Pause pauses this Roku with the OSD up, and its Unpause plays on and hides it", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  expect(await osdVisible(), 'the OSD is down while the group plays').toBe(false);
  await syncPlay(member, 'Pause');
  await waitFor('#osd.visible', (v) => v === true, {
    read: osdVisible,
    timeout: 10000,
    label: "the OSD up on the group's pause",
  });
  await waitFor('state', (s) => s === 'paused', {
    read: playerState,
    timeout: 10000,
    label: "the node paused on the group's pause",
  });
  await syncPlay(member, 'Unpause');
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 15000,
    label: "the node playing on the group's unpause",
  });
  await waitFor('#osd.visible', (v) => v === false, {
    read: osdVisible,
    timeout: 10000,
    label: 'the OSD down again after the unpause',
  });
});

it("after the group's unpause this member settles within the correction threshold of the group's position", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  // `syncPlayPlayback.SETTLE_CORRECTION_MS`: past it the manager corrects, so within it is
  // where every path ends up (measured 2026-10-31 on a Stick 4K, four paths).
  await waitFor(
    'syncPlayManager.sync.playbackDiffMs',
    (v) => typeof v === 'number' && Math.abs(v) <= 150,
    {
      read: getGlobalVal,
      timeout: 20000,
      label: "this member's drift from the group inside the correction threshold",
    },
  );
});

it("the Roku's Play key pauses the whole group, and a second press has it playing again", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  await press(ecp.Key.Play);
  await waitFor('syncPlayManager.groupState', (s) => s === 'Paused', {
    read: getGlobalVal,
    timeout: 10000,
    label: "the group paused on this member's Play key",
  });
  expect(await playerState(), 'this member paused at once, before the server answered').toBe(
    'paused',
  );
  expect(await osdVisible(), 'with the OSD up, as a local pause').toBe(true);
  const serverState = (await listGroups(member)).find((g) => g.GroupId === groupId)?.State;
  expect(serverState, 'the server agrees').toBe('Paused');

  await press(ecp.Key.Play);
  await waitFor('syncPlayManager.groupState', (s) => s === 'Playing', {
    read: getGlobalVal,
    timeout: 15000,
    label: "the group playing again on this member's Play key",
  });
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 15000,
    label: "the node playing on the server's Unpause",
  });
});

it('a trickplay scrub confirmed with OK seeks the whole group, and this member lands at the target', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  const before = await playerPosition();
  // Trick mode steps once per press it sees: presses sent back to back read as one (the bar's
  // text stayed at the current position, Stick 4K, 2026-10-28), so each gets the library's wait.
  await ecp.sendKeypressSequence([ecp.Key.Right, ecp.Key.Right, ecp.Key.Right], { wait: 400 });
  await waitFor('trickPlayBar.visible', (v) => v === true, {
    read: barVisible,
    timeout: 10000,
    label: 'the trick-play bar up after three Right presses',
  });
  await press(ecp.Key.Ok);
  // Three Right presses read about 30 s ahead on a Stick 4K (2026-10-28); the server's Seek
  // lands this member there, and the bar closes on the way (a seek to the node's own position).
  await waitFor('position', (v) => typeof v === 'number' && v > before + 20, {
    read: playerPosition,
    timeout: 20000,
    label: "this member at the scrub's target through the group's Seek",
  });
  await waitFor('trickPlayBar.visible', (v) => v === false, {
    read: barVisible,
    timeout: 10000,
    label: 'the trick-play bar closed',
  });
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 15000,
    label: "playing again after the group's Seek and Unpause",
  });
  expect(await getGlobalVal('syncPlayManager.following'), 'still following').toBe(true);
});

it("the remote's Replay key seeks the whole group back, not this Roku alone", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  const before = await playerPosition();
  expect(before, 'far enough in for a replay to go back').toBeGreaterThan(15);
  const lastEmitted = await getGlobalVal('syncPlayManager.sync.lastCommand.emittedAtMs');
  await press(ecp.Key.Replay);
  // A replay the group took comes back as the server's Seek (then its Unpause): a newer group
  // command. A seek of this Roku alone brings none.
  await waitFor('syncPlayManager.sync.lastCommand.emittedAtMs', (v) => v !== lastEmitted, {
    read: getGlobalVal,
    timeout: 10000,
    label: 'a group command answering the replay',
  });
  // Seek and Unpause both carry the group's position: behind where the replay started.
  const ticks = await getGlobalVal('syncPlayManager.sync.lastCommand.positionTicks');
  expect(ticks / 10_000_000, "the group's position after the replay").toBeLessThan(before);
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 15000,
    label: "playing again after the group's Seek and Unpause",
  });
  expect(await getGlobalVal('syncPlayManager.following'), 'still following').toBe(true);
});

it("next and previous from the remote step the whole group, with one item in this Roku's queue", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  expect(nextId, 'a second movie of ten minutes or more to queue').toBeTruthy();
  await syncPlay(member, 'Queue', { ItemIds: [nextId], Mode: 'Queue' });
  await waitFor('syncPlayManager.sync.playlistCount', (v) => v === 2, {
    read: getGlobalVal,
    timeout: 15000,
    label: "the second movie in the group's playlist",
  });
  // One item locally, whatever the group's playlist holds: the following-episode append and the
  // whole-playlist fetch are both gone while following.
  expect(await localQueueCount(), "this Roku's queue while following").toBe(1);

  const first = await getGlobalVal('syncPlayManager.sync.playingItemId');
  await playerCall(heroId, 'next');
  await waitFor('syncPlayManager.sync.playingItemId', (v) => Boolean(v) && v !== first, {
    read: getGlobalVal,
    timeout: 20000,
    label: "the group's NextItem moved its playing item",
  });
  expect(await getGlobalVal('syncPlayManager.sync.playingItemIndex'), 'the second item').toBe(1);
  await waitFor('state', (s) => s === 'playing', {
    read: readPlayer(nextId),
    timeout: 90000,
    label: 'the second movie playing on this Roku',
  });
  expect(await localQueueCount(), "this Roku's queue after the step").toBe(1);

  const second = await getGlobalVal('syncPlayManager.sync.playingItemId');
  await playerCall(nextId, 'previous');
  await waitFor('syncPlayManager.sync.playingItemId', (v) => Boolean(v) && v !== second, {
    read: getGlobalVal,
    timeout: 20000,
    label: "the group's PreviousItem moved its playing item back",
  });
  expect(await getGlobalVal('syncPlayManager.sync.playingItemIndex'), 'the first item').toBe(0);
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 90000,
    label: 'the first movie playing again on this Roku',
  });
  expect(await getGlobalVal('syncPlayManager.following'), 'still following').toBe(true);
});
