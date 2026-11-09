/**
 * A reload in place while following a SyncPlay group (a gear pick or a version switch here; an
 * audio or subtitle change and a retry take the same path, `VideoPlayerView.reloadInPlace()`)
 * rejoins the group where it was, with no correction from the server (decision
 * `syncplay-reload-reports-its-start`):
 * - while the group plays, the server accepts this member's Ready, so it sends no Seek, and the
 *   group plays on with this member inside the drift thresholds;
 * - while the group is paused, the reload keeps the group's pause: the node ends paused, and the
 *   group's Unpause plays it on in sync;
 * - a second pick while the first reload loads keeps the first one's start: the node reads 0 until
 *   the reloaded stream's first frame, which no reload may save as its start;
 * - a version switch carries the position into the other version.
 * `syncPlayManager.sync.groupSeeks` counts the group's Seek commands, so a correction shows as a
 * count that moved, which no poll can miss.
 * A second member of the same account, over REST, creates the group and ignores the wait; the
 * group needs the server's push channel to the Roku, so the suite skips on a server without one.
 * The version switch needs an episode with two versions (the `Version Episodes` fixture on a local
 * 12.0 or later server) and skips without one.
 */
import { afterAll, beforeAll, it, expect } from 'vitest';
import { odc } from 'roku-test-automation';
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
import { getGlobalVal, readPlayer, stopPlayback, waitFor, waitMediaPlaying } from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const GROUP_NAME = 'RTA reload party';

let session;
let member;
let pushAvailable;
let heroId;

const syncPlay = (who, action, body = {}) =>
  postJson(
    `${who.serverUrl}/SyncPlay/${action}`,
    { ...tokenHeader(who.token), 'Content-Type': 'application/json' },
    body,
  );
const listGroups = (who) => getJson(`${who.serverUrl}/SyncPlay/List`, tokenHeader(who.token));
const managerCall = (funcName, ...funcParams) =>
  odc.callFunc(
    { base: 'global', keyPath: 'syncPlayManager', funcName, funcParams },
    { timeout: 10000 },
  );
const player = () => readPlayer(heroId);
const groupSeeks = () => getGlobalVal('syncPlayManager.sync.groupSeeks');

/** The first movie of ten minutes or more, by SortName: long enough to reload partway in. */
async function longMovieId(who) {
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
  return (data?.Items ?? []).find((i) => (i.RunTimeTicks ?? 0) >= 10 * 60 * 10_000_000)?.Id;
}

/** The first episode with two versions or more, and its versions' ids: a version to switch to. */
async function multiVersionEpisode(who) {
  const query = new URLSearchParams({
    UserId: who.userId,
    IncludeItemTypes: 'Episode',
    Recursive: 'true',
    Fields: 'MediaSources',
    Limit: '200',
  });
  const data = await getJson(`${who.serverUrl}/Items?${query}`, tokenHeader(who.token));
  const episode = (data?.Items ?? []).find((i) => (i.MediaSources ?? []).length > 1);
  return episode ? { id: episode.Id, sourceIds: episode.MediaSources.map((s) => s.Id) } : undefined;
}

/**
 * Reload the stream with a gear pick, the reload a viewer can make on any item (a cap too high
 * to change how it plays), and wait for the reloaded stream's Ready to reach the server and the
 * group to leave the wait the reload's Buffering put it in. A group command can answer that
 * Buffering before the Ready goes out (a Pause to a paused group), so the wait is on this
 * member's own count of Readies, then on the group's state.
 */
async function reloadAndWaitForGroup(groupStateAfter) {
  const sessionBefore = await player()('PlaySessionId');
  const readiesBefore = await getGlobalVal('syncPlayManager.sync.readiesSent');
  await odc.setValue({
    base: 'scene',
    keyPath: '#osd.playbackCapsPick',
    value: { field: 'maxBitrateMbps', value: 120 },
  });
  await waitFor('PlaySessionId', (v) => Boolean(v) && v !== sessionBefore, {
    read: player(),
    timeout: 30000,
    interval: 500,
    label: 'the stream reloaded by the gear pick',
  });
  await waitFor('syncPlayManager.sync.readiesSent', (v) => v > readiesBefore, {
    read: getGlobalVal,
    timeout: 30000,
    label: "the reload's Ready sent",
  });
  await waitFor('syncPlayManager.groupState', (v) => v === groupStateAfter, {
    read: getGlobalVal,
    timeout: 15000,
    label: `the group ${groupStateAfter} again after the reload's Ready`,
  });
}

/** Within `syncPlayPlayback.SETTLE_CORRECTION_MS` ahead and `SKIP_TO_SYNC_MIN_MS` behind. */
const expectInSync = (label) =>
  waitFor(
    'syncPlayManager.sync.playbackDiffMs',
    (v) => typeof v === 'number' && v >= -150 && v <= 400,
    { read: getGlobalVal, timeout: 20000, label },
  );

beforeAll(async () => {
  session = await authenticateForPush(RTA_CONFIG.server, () =>
    getGlobalVal('device.serverDeviceName'),
  );
  member = await authenticate(RTA_CONFIG.server, { role: 'member' });
  pushAvailable = await commandChannelAvailable(session);
  heroId = (await longMovieId(session)) ?? '';
  expect(heroId, 'a movie of ten minutes or more to play').toBeTruthy();
  await syncPlay(member, 'Leave').catch(() => {});
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'syncplay-reload');
  if (!pushAvailable) return;

  await syncPlay(member, 'New', { GroupName: GROUP_NAME });
  // The REST member never reports Ready: without this the group waits on it for good.
  await syncPlay(member, 'SetIgnoreWait', { IgnoreWait: true });
  const groupId = (await listGroups(member)).find((g) => g.GroupName === GROUP_NAME)?.GroupId;
  expect(groupId, 'the member created the group').toBeTruthy();
  await managerCall('join', groupId);
  await waitFor('#overhang.#cluster.#syncplayIcon.isActive', (v) => v === true, {
    timeout: 20000,
    label: 'the Roku in the group',
  });
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
  await waitFor('state', (s) => s === 'playing', {
    read: player(),
    timeout: 60000,
    label: 'the node playing after the group Unpause',
  });
  await expectInSync('this member in sync before the reloads');
});

afterAll(async () => {
  await stopPlayback().catch(() => {});
  await managerCall('leave').catch(() => {});
  await syncPlay(member, 'Leave').catch(() => {});
});

it('a reload while the group plays rejoins it with no correction from the server', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  const seeksBefore = await groupSeeks();
  await reloadAndWaitForGroup('Playing');
  expect(await groupSeeks(), "the server accepted the reload's Ready: no corrective Seek").toBe(
    seeksBefore,
  );
  await waitFor('state', (s) => s === 'playing', {
    read: player(),
    timeout: 15000,
    label: 'the node playing on after the reload',
  });
  expect(await getGlobalVal('syncPlayManager.following'), 'still following the group').toBe(true);
  await expectInSync('this member back in sync after the reload');
});

it("a reload while the group is paused keeps the pause, and the group's Unpause plays it on in sync", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  await syncPlay(member, 'Pause');
  await waitFor('state', (s) => s === 'paused', {
    read: player(),
    timeout: 10000,
    label: "the node paused on the group's pause",
  });
  const seeksBefore = await groupSeeks();
  await reloadAndWaitForGroup('Paused');
  await waitFor('state', (s) => s === 'paused', {
    read: player(),
    timeout: 15000,
    label: 'the reloaded node held paused with the group',
  });
  expect(await groupSeeks(), "the server accepted the reload's Ready: no corrective Seek").toBe(
    seeksBefore,
  );
  await syncPlay(member, 'Unpause');
  await waitFor('state', (s) => s === 'playing', {
    read: player(),
    timeout: 15000,
    label: "the node playing on the group's unpause",
  });
  await expectInSync('this member in sync after the unpause');
});

it('a second pick while the first reload loads reloads from where the stream was, not from 0', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  const positionBefore = await player()('position');
  expect(positionBefore, 'the stream partway in before the picks').toBeGreaterThan(5);
  const seeksBefore = await groupSeeks();
  const readiesBefore = await getGlobalVal('syncPlayManager.sync.readiesSent');
  const pick = () =>
    odc.setValue({
      base: 'scene',
      keyPath: '#osd.playbackCapsPick',
      value: { field: 'maxBitrateMbps', value: 120 },
    });
  await pick();
  // The second pick has to land while the first reload's node reads 0 and has not played:
  // that is the moment a pick used to save 0 as the start.
  await waitFor('position', (v) => typeof v === 'number' && v < 1, {
    read: player(),
    timeout: 15000,
    interval: 100,
    label: "the first reload's node reading 0 before its first frame",
  });
  const stateAtSecondPick = await player()('state');
  expect(
    ['playing', 'paused'],
    'the first reload had not played when the second pick landed',
  ).not.toContain(stateAtSecondPick);
  await pick();
  await waitFor('syncPlayManager.sync.readiesSent', (v) => v > readiesBefore, {
    read: getGlobalVal,
    timeout: 30000,
    label: "the reloads' Ready sent",
  });
  await waitFor('syncPlayManager.groupState', (v) => v === 'Playing', {
    read: getGlobalVal,
    timeout: 15000,
    label: "the group Playing again after the reloads' Ready",
  });
  const playStart = await player()('content.PlayStart');
  expect(
    Math.abs(playStart - positionBefore),
    `the second reload started at ${playStart} s, not near ${positionBefore} s`,
  ).toBeLessThanOrEqual(5);
  expect(await groupSeeks(), "the server accepted the reloads' Ready: no corrective Seek").toBe(
    seeksBefore,
  );
  await expectInSync('this member in sync after the two picks');
});

// A reload starts where the group is, not where this node was (syncPlayHooks.reloadStart): a
// member that fell behind (a stall, a stream the server stopped sending) comes back with one load
// and the keyframe gap, instead of resuming behind and being seek-corrected a few seconds later.
// Here the node is put behind with a seek written on it alone (the group hears nothing), and the
// pick follows at once, before the drift correction's lead passes.
it('a reload on a member that fell behind starts where the group is, not where the node was', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  await waitFor('state', (s) => s === 'playing', {
    read: player(),
    timeout: 30000,
    label: 'playing before falling behind',
  });
  await expectInSync('this member in sync before falling behind');
  const groupPositionBefore = await player()('position');
  expect(groupPositionBefore, 'the stream partway in').toBeGreaterThan(8);
  const seeksBefore = await groupSeeks();
  const readiesBefore = await getGlobalVal('syncPlayManager.sync.readiesSent');
  const behindBy = 4;
  await odc.setValue({
    base: 'scene',
    keyPath: `#${heroId}.seek`,
    value: groupPositionBefore - behindBy,
  });
  await waitFor(
    'position',
    (v) => typeof v === 'number' && v < groupPositionBefore - behindBy + 1.5,
    {
      read: player(),
      timeout: 10000,
      interval: 100,
      label: 'the node behind the group',
    },
  );
  await odc.setValue({
    base: 'scene',
    keyPath: '#osd.playbackCapsPick',
    value: { field: 'maxBitrateMbps', value: 120 },
  });
  await waitFor('syncPlayManager.sync.readiesSent', (v) => v > readiesBefore, {
    read: getGlobalVal,
    timeout: 30000,
    label: "the reload's Ready sent",
  });
  await waitFor('syncPlayManager.groupState', (v) => v === 'Playing', {
    read: getGlobalVal,
    timeout: 15000,
    label: "the group Playing again after the reload's Ready",
  });
  // The group played on through the seek and the pick, so at the pick it was past the position
  // before; the node was `behindBy` less, minus the wait's margin. A start at the node's position
  // reads under groupPositionBefore - 2.5; one at the group's reads at or past it.
  const playStart = await player()('content.PlayStart');
  expect(
    playStart,
    `the reload started at ${playStart} s, behind where the group was (${groupPositionBefore} s at the seek)`,
  ).toBeGreaterThanOrEqual(groupPositionBefore - 1);
  expect(await groupSeeks(), "the server accepted the reload's Ready: no corrective Seek").toBe(
    seeksBefore,
  );
  await expectInSync('this member in sync after the reload');
});

// Under RepeatOne a NextItem on the same item restarts it for the group from its start, and the
// Roku absorbs a restart it is already loading (syncPlayQueue.restartAbsorbed). A reload in place
// is a load too, but from partway in: a restart that lands during it must not be absorbed, or this
// member plays on from where it was while the group starts over, until a corrective Seek drags it
// back (found reading #1344, 2026-11-09).
it('a same-item NextItem under RepeatOne during a reload restarts the item from its start', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  await syncPlay(member, 'SetRepeatMode', { Mode: 'RepeatOne' });
  await waitFor('syncPlayManager.sync.repeatMode', (v) => v === 'RepeatOne', {
    read: getGlobalVal,
    timeout: 15000,
    label: "the group's RepeatOne reached this Roku",
  });
  await waitFor('state', (s) => s === 'playing', {
    read: player(),
    timeout: 30000,
    label: 'playing before the reload',
  });
  const positionBefore = await player()('position');
  expect(positionBefore, 'the stream partway in before the reload').toBeGreaterThan(5);
  const playingItemId = await getGlobalVal('syncPlayManager.sync.playingItemId');
  const loadsBefore = await getGlobalVal('syncPlayManager.sync.loadCount');
  const seeksBefore = await groupSeeks();
  await odc.setValue({
    base: 'scene',
    keyPath: '#osd.playbackCapsPick',
    value: { field: 'maxBitrateMbps', value: 120 },
  });
  // The step goes out while the reload's load is in flight: the tracker is loading from the
  // reload's start, partway in, which is the load the restart must replace.
  expect(
    await getGlobalVal('syncPlayManager.sync.trackerPhase'),
    'the reload loading when the step is sent',
  ).toBe('loading');
  await syncPlay(member, 'NextItem', { PlaylistItemId: playingItemId });
  // Absorbed, the step owes no load and this count stays; the restart's load moves it.
  await waitFor('syncPlayManager.sync.loadCount', (v) => v > loadsBefore, {
    read: getGlobalVal,
    timeout: 30000,
    interval: 100,
    label: "the restart's load performed over the reload",
  });
  await waitFor('state', (s) => s === 'playing', {
    read: player(),
    timeout: 60000,
    label: 'playing after the restart',
  });
  await waitFor('position', (v) => typeof v === 'number' && v < 30 && v < positionBefore - 5, {
    read: player(),
    timeout: 30000,
    label: 'the item playing from its start',
  });
  expect(await groupSeeks(), "the restart's Ready was accepted: no corrective Seek").toBe(
    seeksBefore,
  );
  expect(await getGlobalVal('syncPlayManager.sync.playingItemId'), 'the same item').toBe(
    playingItemId,
  );
  expect(await getGlobalVal('syncPlayManager.following'), 'still following').toBe(true);
  await syncPlay(member, 'SetRepeatMode', { Mode: 'RepeatNone' });
  await waitFor('syncPlayManager.sync.repeatMode', (v) => v === 'RepeatNone', {
    read: getGlobalVal,
    timeout: 15000,
    label: 'repeat off again for the cases after',
  });
  await expectInSync('this member in sync after the restart');
});

it('a version switch carries the position into the other version, with no correction from the server', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  const episode = await multiVersionEpisode(session);
  if (!episode) testCtx.skip('the server has no episode with two versions');
  const episodePlayer = readPlayer(episode.id);
  await syncPlay(member, 'SetNewQueue', {
    PlayingQueue: [episode.id],
    PlayingItemPosition: 0,
    StartPositionTicks: 0,
  });
  await waitFor('state', (s) => s === 'playing', {
    read: episodePlayer,
    timeout: 60000,
    label: "the group's episode playing after the group Unpause",
  });
  await waitFor('position', (v) => typeof v === 'number' && v > 8, {
    read: episodePlayer,
    timeout: 30000,
    label: 'the episode partway in',
  });
  const sourceBefore = String(await episodePlayer('mediaSourceId')).toLowerCase();
  const target = episode.sourceIds.find((id) => id.toLowerCase() !== sourceBefore);
  expect(target, 'a version other than the one playing').toBeTruthy();
  const positionBefore = await episodePlayer('position');
  const sessionBefore = await episodePlayer('PlaySessionId');
  const seeksBefore = await groupSeeks();
  const readiesBefore = await getGlobalVal('syncPlayManager.sync.readiesSent');
  await odc.setValue({ base: 'scene', keyPath: `#${episode.id}.mediaSourceId`, value: target });
  await waitFor('PlaySessionId', (v) => Boolean(v) && v !== sessionBefore, {
    read: episodePlayer,
    timeout: 30000,
    interval: 500,
    label: 'the other version loaded',
  });
  await waitFor('syncPlayManager.sync.readiesSent', (v) => v > readiesBefore, {
    read: getGlobalVal,
    timeout: 30000,
    label: "the switch's Ready sent",
  });
  await waitFor('syncPlayManager.groupState', (v) => v === 'Playing', {
    read: getGlobalVal,
    timeout: 15000,
    label: "the group Playing again after the switch's Ready",
  });
  expect(
    String(await episodePlayer('mediaSourceId')).toLowerCase(),
    'the other version plays',
  ).toBe(target.toLowerCase());
  const playStart = await episodePlayer('content.PlayStart');
  expect(
    Math.abs(playStart - positionBefore),
    `the switch started at ${playStart} s, not near ${positionBefore} s`,
  ).toBeLessThanOrEqual(5);
  expect(await groupSeeks(), "the server accepted the switch's Ready: no corrective Seek").toBe(
    seeksBefore,
  );
  await expectInSync('this member in sync after the version switch');
});
