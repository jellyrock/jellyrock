/**
 * A reload in place while following a SyncPlay group (a gear pick here; an audio, subtitle or
 * version change and a retry take the same path) rejoins the group where it was, with no
 * correction from the server:
 * - while the group plays, the server accepts this member's Ready, so it sends no Seek, and the
 *   group plays on with this member inside the drift thresholds;
 * - while the group is paused, the reload keeps the group's pause: the node ends paused, and the
 *   group's Unpause plays it on in sync.
 * Before the fix the group heard of a reload only as a stall (followup
 * `syncplay-reload-ready-position`): a reload that buffered under the stall wait reported nothing
 * and fell behind the group in silence; a longer one sent a Ready with the node's position, which
 * reads 0 until the reloaded stream's first frame, and drew a corrective Seek; and under a paused
 * group the node never reached `playing`, so no Ready went out and the group waited on it.
 * `syncPlayManager.sync.groupSeeks` counts the group's Seek commands, so a correction shows as a
 * count that moved, which no poll can miss.
 * A second member of the same account, over REST, creates the group and ignores the wait; the
 * group needs the server's push channel to the Roku, so the suite skips on a server without one.
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
