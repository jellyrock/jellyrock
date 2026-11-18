/**
 * In a SyncPlay group the viewer's own controls go to the group, and the group's commands reach
 * this member as a viewer's would (phase E of the SyncPlay project):
 * - a Pause by another member pauses this Roku with the OSD up, as the Play key does, and the
 *   group's Unpause plays on and hides it;
 * - the Roku's Play key pauses the whole group (the server's state reads Paused) and a second
 *   press has it playing again;
 * - a trickplay scrub confirmed with OK seeks the whole group: the bar closes and this member
 *   lands at the target through the server's Seek;
 * - the group's repeat mode rides on this Roku's queue (phase F step 2), a Repeat pick here sets
 *   the group's, a finished item starts over for everyone under RepeatOne, and the OSD gear shows
 *   the group's rows (Shuffle, SyncPlay Time Offset, Leave Group), the last of which leaves the
 *   group with the video playing on.
 * A second member of the same account, over REST, creates the group, ignores the wait (it never
 * reports Ready) and queues the item; the Roku joins directly, as the menu spec's join case
 * already drives the menu. The join needs the server's push channel to the Roku, so the suite
 * skips on a server without one (https without the companion plugin).
 */
import { afterAll, beforeAll, it, expect } from 'vitest';
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import {
  appSession,
  authenticate,
  authenticateForPush,
  commandChannelAvailable,
  getJson,
  postJson,
  tokenHeader,
} from '../lib/jellyfin.js';
import { failRequests } from '../lib/failRequests.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { captureRawUI } from '../capture.js';
import {
  getActiveVal,
  getGlobalVal,
  getVal,
  getVals,
  openTrickPlayBar,
  press,
  readPlayer,
  scrollFocus,
  sleep,
  stopPlayback,
  waitDialogClosed,
  waitFocused,
  waitFocusInside,
  waitFor,
  waitMediaPlaying,
  waitOsdUp,
  waitToast,
  walkFocusUntil,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
const CAPTURE = process.env.RTA_CAPTURE === '1';
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
const localRepeatMode = async () =>
  (
    await odc.callFunc(
      { base: 'global', keyPath: 'queueManager', funcName: 'getRepeatMode' },
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
  // The OSD's SyncPlay mark, left of the clock while following (OSD.applySyncPlayMark).
  expect(await player()('#osd.#syncPlayMark.visible'), 'the group mark shows in the OSD').toBe(
    true,
  );
  if (CAPTURE) await captureRawUI('syncPlayOsdMark');
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

it("after the group's unpause this member settles within the correction thresholds of the group's position", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  // `syncPlayPlayback.SETTLE_CORRECTION_MS` ahead and `SKIP_TO_SYNC_MIN_MS` behind: past them
  // the manager corrects, so within them is where every path ends up.
  await waitFor(
    'syncPlayManager.sync.playbackDiffMs',
    (v) => typeof v === 'number' && v >= -150 && v <= 400,
    {
      read: getGlobalVal,
      timeout: 20000,
      label: "this member's drift from the group inside the correction thresholds",
    },
  );
});

// Longer than the player's 10 s report while paused and its read-back (`playbackCheckIn`), and
// than the window the frozen-position check and the buffer check judge a still position over.
const HELD_PAUSE_MS = 25000;
// By this long into the pause the pause report has gone out and one paused check-in has passed.
const SERVER_PAUSED_BY_MS = 12000;

it("a group pause held past the paused check-in stays paused on the node and on the server's session, and the Unpause plays on in step", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  const deviceId = await getGlobalVal('device.serverDeviceName');
  await syncPlay(member, 'Pause');
  await waitFor('state', (s) => s === 'paused', {
    read: playerState,
    timeout: 10000,
    label: "the node paused on the group's pause",
  });
  const pausedAt = await playerPosition();
  expect(typeof pausedAt, 'a position was read at the pause').toBe('number');

  // Not a wait: every sample over the window has to show the pause still held. A playback
  // watchdog that took the still position for a stall would stop or reload the stream, and a
  // lost pause report would leave the server's session playing.
  const samples = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < HELD_PAUSE_MS) {
    const roku = await appSession(member, deviceId);
    samples.push({
      atMs: Date.now() - startedAt,
      state: await playerState(),
      position: await playerPosition(),
      following: await getGlobalVal('syncPlayManager.following'),
      serverPaused: roku.PlayState?.IsPaused,
      serverItem: roku.NowPlayingItem?.Id,
    });
    await sleep(1000);
  }
  const late = samples.filter((s) => s.atMs >= SERVER_PAUSED_BY_MS);
  expect(late.length, 'samples were taken after the paused check-in').toBeGreaterThanOrEqual(5);
  expect(
    samples.filter((s) => s.state !== 'paused'),
    'the node stays paused for the whole pause',
  ).toEqual([]);
  expect(
    samples.filter((s) => typeof s.position !== 'number' || Math.abs(s.position - pausedAt) > 0.5),
    'the node stays where the pause left it',
  ).toEqual([]);
  expect(
    samples.filter((s) => s.following !== true),
    'this member follows the group for the whole pause',
  ).toEqual([]);
  expect(
    late.filter((s) => s.serverPaused !== true || s.serverItem !== heroId),
    "the server's session shows this item paused once the check-in has passed",
  ).toEqual([]);

  await syncPlay(member, 'Unpause');
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 15000,
    label: "the node playing on the group's unpause after the held pause",
  });
  await waitFor('#osd.visible', (v) => v === false, {
    read: osdVisible,
    timeout: 10000,
    label: 'the OSD down again after the held pause',
  });
  await waitFor(
    'syncPlayManager.sync.playbackDiffMs',
    (v) => typeof v === 'number' && v >= -150 && v <= 400,
    {
      read: getGlobalVal,
      timeout: 20000,
      label:
        "this member's drift from the group inside the correction thresholds after the held pause",
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

it("another member's Unpause closes the OSD this member's Play key opened, without its timeout", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  // The OSD hides by itself once no key was pressed for `inactiveTimeout` (5 s, on the OSD's
  // instance in VideoPlayerView.xml). The Play key below is the last key, so an OSD that is
  // down sooner than that after it was closed by the group's resume, not by the timeout.
  const OSD_TIMEOUT_MS = 5000;
  const keyAt = Date.now();
  await press(ecp.Key.Play);
  await waitFor('syncPlayManager.groupState', (s) => s === 'Paused', {
    read: getGlobalVal,
    timeout: 10000,
    label: "the group paused on this member's Play key",
  });
  expect(await osdVisible(), 'the OSD up on the Play key').toBe(true);
  await syncPlay(member, 'Unpause');
  await waitFor('#osd.visible', (v) => v === false, {
    read: osdVisible,
    timeout: 15000,
    label: "the OSD down on the member's Unpause",
  });
  const downAfterMs = Date.now() - keyAt;
  expect(downAfterMs, 'the OSD closed before its own timeout could have closed it').toBeLessThan(
    OSD_TIMEOUT_MS,
  );
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 15000,
    label: "the node playing on the member's Unpause",
  });
});

it('a trickplay scrub confirmed with OK seeks the whole group, and this member lands at the target', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  const before = await playerPosition();
  await openTrickPlayBar(heroId);
  await press(ecp.Key.Ok);
  // Three Right presses read about 30 s ahead on a Stick 4K (2026-10-28); the server's Seek
  // lands this member there, and the bar closes through that Seek.
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

it('a scrub confirmed with OK whose Seek the server never answers still closes the bar, without moving this member', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  const before = await playerPosition();
  const lastEmitted = await getGlobalVal('syncPlayManager.sync.lastCommand.emittedAtMs');
  // The app's Seek request is dropped unsent, once (`SideEffectTask.droppedOnPurpose`), so no
  // group command comes back: the bar must close by its own fallback.
  await failRequests([{ prefix: 'syncPlaySeek', kind: 'http', status: 403, times: 1 }]);
  try {
    await openTrickPlayBar(heroId);
    await press(ecp.Key.Ok);
    // Shorter than the fallback timer: until then nothing may seek this member. A local seek
    // written at once (the old behavior) shows as the bar closing or the node buffering.
    const sampleUntil = Date.now() + 3000;
    while (Date.now() < sampleUntil) {
      const bar = await barVisible();
      const state = await playerState();
      expect(bar, 'the bar stays up while the group answers').toBe(true);
      expect(state, 'no local seek started').not.toBe('buffering');
      await sleep(250);
    }
    await waitFor('trickPlayBar.visible', (v) => v === false, {
      read: barVisible,
      timeout: 10000,
      label: 'the trick-play bar closed by the fallback, with no group Seek',
    });
    await waitFor('state', (s) => s === 'playing', {
      read: playerState,
      timeout: 15000,
      label: 'playing again after the fallback',
    });
    expect(
      await getGlobalVal('syncPlayManager.sync.lastCommand.emittedAtMs'),
      'no group command came, so the Seek was dropped and the rule fired',
    ).toBe(lastEmitted);
    expect(await getGlobalVal('syncPlayManager.following'), 'still following').toBe(true);
    expect(await getGlobalVal('syncPlayManager.groupState'), 'the group still plays').toBe(
      'Playing',
    );
    // Three Right presses read about 30 s ahead: the node did not go to the target.
    expect(await playerPosition(), 'the node did not move to the scrub target').toBeLessThan(
      before + 20,
    );
    // The scrub left this member behind the group; the armed check corrects it.
    await waitFor(
      'syncPlayManager.sync.playbackDiffMs',
      (v) => typeof v === 'number' && v >= -500 && v <= 1000,
      {
        read: getGlobalVal,
        timeout: 25000,
        label: "this member back with the group after the scrub's lost Seek",
      },
    );
  } finally {
    await failRequests([]);
  }
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
  // A replay the group took comes back as the server's Seek, then its Unpause once this member is
  // ready, and the Unpause replaces the Seek in `lastCommand`. So a new Seek counts, and so does a
  // new Unpause that carries a position behind where the replay started; a poll that missed the
  // Seek still sees the one that follows. A seek of this Roku alone brings neither. The command is
  // read whole, so its name, time and position come from one command; ODC lowercases the keys of
  // a record it reads whole.
  const answer = await waitFor(
    'syncPlayManager.sync.lastCommand',
    (c) =>
      Boolean(c) &&
      c.emittedatms !== lastEmitted &&
      (c.command === 'Seek' || c.command === 'Unpause') &&
      c.positionticks / 10_000_000 < before,
    {
      read: getGlobalVal,
      timeout: 10000,
      label: 'a group Seek (or the Unpause after it) answering the replay',
    },
  );
  // Seek and Unpause both carry the group's position: behind where the replay started.
  expect(answer.positionticks / 10_000_000, "the group's position after the replay").toBeLessThan(
    before,
  );
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 15000,
    label: "playing again after the group's Seek and Unpause",
  });
  expect(await getGlobalVal('syncPlayManager.following'), 'still following').toBe(true);
});

it('a voice fast-forward while following seeks the whole group ahead, not this Roku alone', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  const before = await playerPosition();
  const lastEmitted = await getGlobalVal('syncPlayManager.sync.lastCommand.emittedAtMs');
  // The voice "forward" command, as Roku's transport dispatcher delivers it. Outside a group it
  // puts the node in fast-forward; following, it is a seek the group takes, the replay step ahead.
  const answer = await playerCall(heroId, 'forward');
  expect(answer.value?.status, 'the command was taken').toBe('success');
  // As for Replay: the group's Seek, or the Unpause after it, carries a position past where the
  // command was given; a poll that missed the Seek still sees the Unpause.
  const command = await waitFor(
    'syncPlayManager.sync.lastCommand',
    (c) =>
      Boolean(c) &&
      c.emittedatms !== lastEmitted &&
      (c.command === 'Seek' || c.command === 'Unpause') &&
      c.positionticks / 10_000_000 > before,
    {
      read: getGlobalVal,
      timeout: 10000,
      label: 'a group Seek (or the Unpause after it) answering the fast-forward',
    },
  );
  expect(command.positionticks / 10_000_000, "the group's position after the seek").toBeGreaterThan(
    before,
  );
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 15000,
    label: "playing again after the group's Seek and Unpause",
  });
  expect(await getGlobalVal('syncPlayManager.following'), 'still following').toBe(true);
});

// A guard against a race, so one pass proves little: two seeks that overlap on the node could
// leave it buffering for good, with the group waiting on it. The tracker's unit cases hold the
// logic (syncPlayPlayback.spec.bs); this one only watches the group survive the real timing.
it('two member Seeks close together, to different targets, leave the group playing at the second', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  const before = await playerPosition();
  const ticksAt = (seconds) => Math.round(seconds * 10_000_000);
  await syncPlay(member, 'Seek', { PositionTicks: ticksAt(before + 30) });
  await sleep(300);
  await syncPlay(member, 'Seek', { PositionTicks: ticksAt(before + 60) });
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 30000,
    label: 'the node playing after two close Seeks',
  });
  await waitFor('syncPlayManager.groupState', (s) => s === 'Playing', {
    read: getGlobalVal,
    timeout: 30000,
    label: 'the group playing after two close Seeks',
  });
  await waitFor('position', (v) => typeof v === 'number' && v > before + 50, {
    read: playerPosition,
    timeout: 20000,
    label: 'this member at the second Seek target',
  });
  expect(await getGlobalVal('syncPlayManager.following'), 'still following').toBe(true);
});

// A play/pause toggle on a node that is buffering for the group's Seek used to write
// `control = "play"` to it, which leaves it buffering for good. It must pause the group instead.
it("the remote's play/pause during a group Seek pauses the group and does not wedge the node", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  const before = await playerPosition();
  try {
    await syncPlay(member, 'Seek', { PositionTicks: Math.round((before + 40) * 10_000_000) });
    await waitFor('state', (s) => s === 'buffering', {
      read: playerState,
      timeout: 10000,
      interval: 100,
      label: "the node buffering on the group's Seek",
    });
    await playerCall(heroId, 'playpause');
    await waitFor('syncPlayManager.groupState', (s) => s === 'Paused', {
      read: getGlobalVal,
      timeout: 15000,
      label: 'the group paused by the toggle pressed during the Seek',
    });
    await waitFor('state', (s) => s === 'paused', {
      read: playerState,
      timeout: 15000,
      label: "the node paused at the Seek's landing, not buffering for good",
    });
  } finally {
    await syncPlay(member, 'Unpause').catch(() => {});
  }
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 20000,
    label: "the node playing on the group's Unpause",
  });
  expect(await getGlobalVal('syncPlayManager.following'), 'still following').toBe(true);
});

// A time offset picked in the gear takes effect at the pick, with no Unpause: the manager arms the
// settle check, and the next position notifications correct the drift the new offset made. Raised,
// the node reads behind and seeks ahead (with a toast, since nothing the viewer pressed looks like a
// jump); lowered, it reads ahead and holds. The pick is written to the OSD's `syncPlayPick`, the
// field the gear's picker sets, so `VideoPlayerView.onSyncPlayPicked` runs as it does for a viewer.
// Each pick waits for the app's answer to it: `sync.correctionsDone` counting the correction it
// started, or `sync.picksSettled` counting the verdict that the member already rests in step, so
// there is nothing to correct. A drift reading, the toast and the node's state can all still show
// the pick before either. The first raise is the gear's smallest step. A pick's seek that outlasts
// its budget is told to the group as a stall, so the group waits and its Unpause is expected then;
// `sync.slowSeeks` tells the two apart. Nothing here puts the member exactly in step (the normal
// bars leave a resume up to `SKIP_TO_SYNC_MIN_MS` behind, and a seek lands a little late), and a
// member resting more than the bar on the far side absorbs a step. So a pick can settle without a
// correction, and the case asks only that each pick is answered and the member ends in step.
// `syncPlayPlayback.PICK_CORRECTION_MS`: a check a pick armed corrects past this, either way.
const PICK_BAR_MS = 50;
// `playbackSettingsMenu.TIME_OFFSET_STEP_MS`: the gear's smallest pick, under the normal bars.
const PICK_STEP_MS = 100;
// Not ahead of the group past this, so one step up crosses the bar with margin for the noise.
const AHEAD_AT_MOST_MS = 40;
// `syncPlayPlayback.SKIP_TO_SYNC_MIN_MS`: a reading past it is a resume still settling.
const SEEK_BAR_MS = 400;
const pickTimeOffset = (ms) =>
  odc.setValue({
    base: 'scene',
    keyPath: `#${heroId}.#osd.syncPlayPick`,
    value: { kind: 'timeOffset', value: ms },
  });
// Both counts in one read, so a wait compares a pair read together. Each only rises.
const pickAnswers = async () => {
  const done = await getGlobalVal('syncPlayManager.sync.correctionsDone');
  const settled = await getGlobalVal('syncPlayManager.sync.picksSettled');
  expect(typeof done, 'the correction count was read').toBe('number');
  expect(typeof settled, 'the settled-pick count was read').toBe('number');
  return { done, settled };
};
// Picks `ms` and waits for the app's answer: a correction run to its resume, playing again, or the
// verdict that the member was already in step. Returns which one it was.
async function pickAndWaitForAnswer(ms, { toast = false } = {}) {
  const before = await pickAnswers();
  await pickTimeOffset(ms);
  expect(
    await getGlobalVal('user.settings.playbackSyncPlayTimeOffsetMs'),
    'the pick was saved',
  ).toBe(ms);
  const answer = await waitFor(
    'syncPlayManager.sync.picksSettled',
    (a) => a.done > before.done || a.settled > before.settled,
    {
      read: pickAnswers,
      timeout: 20000,
      label: `the app's answer to the pick of ${ms} ms: a correction run to its resume, or in step`,
    },
  );
  const corrected = answer.done > before.done;
  // The toast is raised only for a seek a pick caused, so a pick found in step shows none.
  if (toast && corrected)
    await waitToast('Syncing with the group', {
      label: `the toast for the seek after the pick of ${ms} ms`,
    });
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 15000,
    label: `playing again after the pick of ${ms} ms`,
  });
  return corrected;
}
it('a time offset picked in the gear corrects the drift at once, without an Unpause', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 15000,
    label: 'the node playing before the pick',
  });
  await waitFor(
    'syncPlayManager.sync.playbackDiffMs',
    (v) => typeof v === 'number' && v >= -AHEAD_AT_MOST_MS && v <= SEEK_BAR_MS,
    {
      read: getGlobalVal,
      timeout: 20000,
      label: "this member settled after the group's resume, and not ahead of it",
    },
  );
  const unpausedAt = await getGlobalVal('syncPlayManager.sync.lastCommand.emittedatms');
  const slowBefore = await getGlobalVal('syncPlayManager.sync.slowSeeks');
  expect(typeof slowBefore, 'the slow-seek count was read').toBe('number');
  // A pick's seek that outlasted its budget ends the picks: the group waited for it, and the
  // member corrects by seeking no more until a group Seek lands (`syncPlayPlayer.endSeek`).
  const aPickSeekWasSlow = async () => {
    const slow = await getGlobalVal('syncPlayManager.sync.slowSeeks');
    expect(typeof slow, 'the slow-seek count was read after a pick').toBe('number');
    return slow > slowBefore;
  };
  let heldTheGroup;
  try {
    // Raised twice: behind past the bar, so the node seeks ahead. The toast is read on the first
    // only, since the second's could be the first's still on screen.
    await pickAndWaitForAnswer(PICK_STEP_MS, { toast: true });
    heldTheGroup = await aPickSeekWasSlow();
    if (!heldTheGroup) {
      await pickAndWaitForAnswer(2 * PICK_STEP_MS);
      heldTheGroup = await aPickSeekWasSlow();
    }
    if (!heldTheGroup) {
      // Lowered: ahead past the bar, so the node holds until the group arrives, and lands in step
      // (a hold resumes on time). A reading from before the hold is ahead past the bar, so it
      // cannot pass this wait.
      await pickAndWaitForAnswer(0);
      await waitFor(
        'syncPlayManager.sync.playbackDiffMs',
        (v) => typeof v === 'number' && Math.abs(v) <= PICK_BAR_MS,
        { read: getGlobalVal, timeout: 20000, label: 'the hold brought the node back in step' },
      );
    }
  } finally {
    // Only when a failure left it raised: a pick of the value in force still arms a check.
    if ((await getGlobalVal('user.settings.playbackSyncPlayTimeOffsetMs')) !== 0)
      await pickTimeOffset(0);
  }
  if (heldTheGroup) {
    await waitFor('syncPlayManager.groupState', (g) => g === 'Playing', {
      read: getGlobalVal,
      timeout: 15000,
      label: 'a pick seek ran past its budget and the group waited for this Roku, then played',
    });
    await waitFor('state', (s) => s === 'playing', {
      read: playerState,
      timeout: 15000,
      label: 'the node playing after a pick seek ran past its budget and the group waited',
    });
  } else {
    expect(
      await getGlobalVal('syncPlayManager.sync.lastCommand.emittedatms'),
      'no Unpause came in between: the picks alone settled it',
    ).toBe(unpausedAt);
  }
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

// A Shuffle pick on this Roku goes to the group (`VideoPlayerView.onSyncPlayPicked`, then
// `control({ kind: "shuffle" })`), and the server answers every member with a ShuffleMode queue
// update that reorders its playlist around the playing item. This Roku plays on: the update's
// fetch finds the same item and reloads nothing. With two items the server's new order can match
// the old one, but the Roku's path (the update, its fetch, no load) is the same for any order. The
// pick is written to the OSD's `syncPlayPick`, the field the gear's picker sets. Turned off again,
// the playlist is back in its order with the first movie first, as the repeat cases below expect.
const pickShuffle = (mode) =>
  odc.setValue({
    base: 'scene',
    keyPath: `#${heroId}.#osd.syncPlayPick`,
    value: { kind: 'shuffle', value: mode },
  });
it("a Shuffle pick on this Roku shuffles the group's playlist without reloading the item", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  expect(await getGlobalVal('syncPlayManager.sync.playlistCount'), 'two movies queued').toBe(2);
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 15000,
    label: 'the node playing before the pick',
  });
  const playing = await getGlobalVal('syncPlayManager.sync.playingItemId');
  const loads = await getGlobalVal('syncPlayManager.sync.loadCount');
  try {
    await pickShuffle('Shuffle');
    await waitFor('syncPlayManager.sync.shuffleMode', (v) => v === 'Shuffle', {
      read: getGlobalVal,
      timeout: 15000,
      label: "the group's Shuffle reached this Roku",
    });
    expect(
      await getVal('#showPlaybackSettings.isButtonSelected'),
      'the gear lights while the group shuffles',
    ).toBe(true);
    // The update's fetch runs after the mode lands, and a load would follow it: watch a window
    // long enough for both, every sample still on the same item with no load. The node's state is
    // not sampled: a drift correction can hold it for a moment, and that is not a reload.
    const sampleUntil = Date.now() + 3000;
    while (Date.now() < sampleUntil) {
      expect(await getGlobalVal('syncPlayManager.sync.loadCount'), 'no reload for a reorder').toBe(
        loads,
      );
      expect(await getGlobalVal('syncPlayManager.sync.playingItemId'), 'the same item').toBe(
        playing,
      );
      await sleep(250);
    }
  } finally {
    await pickShuffle('Sorted');
  }
  await waitFor('syncPlayManager.sync.shuffleMode', (v) => v === 'Sorted', {
    read: getGlobalVal,
    timeout: 15000,
    label: "the group's Sorted reached this Roku",
  });
  expect(
    await getGlobalVal('syncPlayManager.sync.playingItemIndex'),
    'the playlist back in its order, the first movie first',
  ).toBe(0);
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 15000,
    label: 'the node still playing the same item after both picks',
  });
  expect(await getGlobalVal('syncPlayManager.sync.loadCount'), 'no reload for either pick').toBe(
    loads,
  );
  expect(
    await getVal('#showPlaybackSettings.isButtonSelected'),
    'the gear unlit with shuffle and repeat off',
  ).toBe(false);
  expect(await getGlobalVal('syncPlayManager.following'), 'still following').toBe(true);
});

// The group's repeat mode is written onto this Roku's queue (SyncPlayManager.syncGroupModes), so
// the OSD reads one holder in and out of a group, and the step buttons follow the server's rule:
// under RepeatAll the first item has a previous (the wrap). The REST member sets the mode, as
// another app's viewer would.
it("the group's repeat mode reaches this Roku's queue, and the OSD's steps follow it", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  expect(await getGlobalVal('syncPlayManager.sync.playingItemIndex'), 'on the first item').toBe(0);
  expect(await getVal('#itemBack.isEnabled'), 'no previous at the first item while off').toBe(
    false,
  );
  await syncPlay(member, 'SetRepeatMode', { Mode: 'RepeatAll' });
  await waitFor('syncPlayManager.sync.repeatMode', (v) => v === 'RepeatAll', {
    read: getGlobalVal,
    timeout: 15000,
    label: "the group's RepeatAll reached this Roku",
  });
  expect(await localRepeatMode(), "the queue holds the group's mode").toBe('RepeatAll');
  expect(
    await getVal('#itemBack.isEnabled'),
    'the first item wraps to the last under RepeatAll',
  ).toBe(true);
});

// A Repeat pick in the gear goes to the group (control({ kind: "repeat" })), not the local queue:
// the server answers every member with the mode, this Roku included. The manager's control is
// called directly, as the OSD's pick calls it, so the case is about the round trip, not the menu.
it("a Repeat pick on this Roku sets the group's mode, which comes back onto its queue", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  expect(
    (await managerCall('control', { kind: 'repeat', mode: 'RepeatOne' })).value,
    'the pick was posted to the group',
  ).toBe(true);
  await waitFor('syncPlayManager.sync.repeatMode', (v) => v === 'RepeatOne', {
    read: getGlobalVal,
    timeout: 15000,
    label: "the group's RepeatOne reached this Roku",
  });
  expect(await localRepeatMode(), "the queue holds the group's mode").toBe('RepeatOne');
});

// Under RepeatOne the server keeps the index on NextItem, sends the update and waits on every
// member's Ready (WaitingGroupState.HandleRequest, read 2026-11-03), so the finished item starts
// over for the whole group. Before this, the Roku treated a same-id NextItem as nothing to load
// and sat on a finished player while the group waited on it (followup syncplay-repeat-modes).
it('under RepeatOne a finished item starts over for the group, on the same item', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  expect(
    await getGlobalVal('syncPlayManager.sync.repeatMode'),
    'RepeatOne from the case before',
  ).toBe('RepeatOne');
  const item = await getJson(
    `${session.serverUrl}/Users/${session.userId}/Items/${heroId}`,
    tokenHeader(session.token),
  );
  const durationSeconds = (item?.RunTimeTicks ?? 0) / 10_000_000;
  expect(durationSeconds, 'the movie has a known length').toBeGreaterThan(60);
  const playingItemId = await getGlobalVal('syncPlayManager.sync.playingItemId');
  // Inside the item: a target at or past the end would be clamped 30 s short by the player.
  await syncPlay(member, 'Seek', {
    PositionTicks: Math.round((durationSeconds - 12) * 10_000_000),
  });
  await waitFor('position', (v) => typeof v === 'number' && v > durationSeconds - 30, {
    read: playerPosition,
    timeout: 30000,
    label: "this member near the end through the group's Seek",
  });
  // The restart: the same item, from its start, playing again for the group.
  await waitFor('position', (v) => typeof v === 'number' && v < durationSeconds - 60 && v < 30, {
    read: playerPosition,
    timeout: 90000,
    label: 'the item playing again from its start',
  });
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 30000,
    label: 'playing after the restart',
  });
  expect(await getGlobalVal('syncPlayManager.sync.playingItemId'), 'the same item').toBe(
    playingItemId,
  );
  expect(await getGlobalVal('syncPlayManager.sync.playingItemIndex'), 'the same index').toBe(0);
  expect(await getGlobalVal('syncPlayManager.following'), 'still following').toBe(true);
  await syncPlay(member, 'SetRepeatMode', { Mode: 'RepeatNone' });
  await waitFor('syncPlayManager.sync.repeatMode', (v) => v === 'RepeatNone', {
    read: getGlobalVal,
    timeout: 15000,
    label: 'repeat off again for the cases after',
  });
});

// Under RepeatOne the server keeps the index on NextItem and drops a duplicate only by playlist
// id, which is unchanged, so two members stepping at once restart the group twice (read from
// Jellyfin's WaitingGroupState and PlayQueueManager, 2026-11-03). This member already loads the
// item for the first restart: the second update must not reload it, or the group waits again.
it('a second same-item NextItem right after a RepeatOne restart does not reload the item again', async (testCtx) => {
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
    read: playerState,
    timeout: 30000,
    label: 'playing before the double step',
  });
  const playingItemId = await getGlobalVal('syncPlayManager.sync.playingItemId');
  const loadsBefore = await getGlobalVal('syncPlayManager.sync.loadCount');
  const unpausedAt = await getGlobalVal('syncPlayManager.sync.lastCommand.emittedatms');
  expect(typeof loadsBefore, 'the manager counts its loads').toBe('number');
  // Two members step the same item. The second step goes out once this member has started loading
  // the first restart: two steps that arrive together are one fetch (the older is superseded), so
  // only a step that finds the load performed can reload it.
  await syncPlay(member, 'NextItem', { PlaylistItemId: playingItemId });
  await waitFor('syncPlayManager.sync.loadCount', (v) => v > loadsBefore, {
    read: getGlobalVal,
    timeout: 20000,
    interval: 50,
    label: 'the first restart loading on this Roku',
  });
  await syncPlay(member, 'NextItem', { PlaylistItemId: playingItemId });
  // The group starts again once this member's Ready is accepted: an Unpause newer than the steps.
  await waitFor(
    'syncPlayManager.sync.lastCommand.emittedatms',
    (v) => typeof v === 'number' && v > unpausedAt,
    {
      read: getGlobalVal,
      timeout: 90000,
      label: "the group's Unpause after the restart",
    },
  );
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 30000,
    label: 'playing after the restart',
  });
  await waitFor('position', (v) => typeof v === 'number' && v < 30, {
    read: playerPosition,
    timeout: 30000,
    label: 'the item playing from its start',
  });
  expect(
    (await getGlobalVal('syncPlayManager.sync.loadCount')) - loadsBefore,
    'the item was loaded once for the two steps',
  ).toBe(1);
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
});

// Restarts the playing item for the group under RepeatOne (a same-item NextItem) and returns once
// this Roku has started loading it, so the caller's next request reaches a member mid-load.
async function restartAndCatchTheLoad() {
  await syncPlay(member, 'SetRepeatMode', { Mode: 'RepeatOne' });
  await waitFor('syncPlayManager.sync.repeatMode', (v) => v === 'RepeatOne', {
    read: getGlobalVal,
    timeout: 15000,
    label: "the group's RepeatOne reached this Roku",
  });
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 30000,
    label: 'playing before the restart',
  });
  const playingItemId = await getGlobalVal('syncPlayManager.sync.playingItemId');
  const loadsBefore = await getGlobalVal('syncPlayManager.sync.loadCount');
  expect(typeof loadsBefore, 'the manager counts its loads').toBe('number');
  await syncPlay(member, 'NextItem', { PlaylistItemId: playingItemId });
  await waitFor('syncPlayManager.sync.loadCount', (v) => v > loadsBefore, {
    read: getGlobalVal,
    timeout: 20000,
    interval: 50,
    label: 'the restart loading on this Roku',
  });
  return { loadsBefore };
}
async function repeatOffAgain() {
  await syncPlay(member, 'SetRepeatMode', { Mode: 'RepeatNone' });
  await waitFor('syncPlayManager.sync.repeatMode', (v) => v === 'RepeatNone', {
    read: getGlobalVal,
    timeout: 15000,
    label: 'repeat off again for the cases after',
  });
}

it("another member's Pause while this Roku loads a restart leaves it paused with the OSD up, and the Unpause plays on", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  const { loadsBefore } = await restartAndCatchTheLoad();
  await syncPlay(member, 'Pause');
  await waitFor('syncPlayManager.sync.lastCommand.command', (v) => v === 'Pause', {
    read: getGlobalVal,
    timeout: 20000,
    label: "the group's Pause reached this Roku during its load",
  });
  await waitFor('state', (s) => s === 'paused', {
    read: playerState,
    timeout: 90000,
    label: 'the node paused once the restart loaded',
  });
  await waitFor('#osd.visible', (v) => v === true, {
    read: osdVisible,
    timeout: 10000,
    label: "the OSD up on the group's pause",
  });
  await waitFor('syncPlayManager.groupState', (v) => v === 'Paused', {
    read: getGlobalVal,
    timeout: 30000,
    label: "the group paused after this member's Ready",
  });
  await syncPlay(member, 'Unpause');
  await waitFor('syncPlayManager.sync.lastCommand.command', (v) => v === 'Unpause', {
    read: getGlobalVal,
    timeout: 20000,
    label: "the group's Unpause reached this Roku",
  });
  // The server's last Pause names a point past where this member stopped, so the Unpause finds it
  // behind and it catches up.
  await waitFor(
    'syncPlayManager.sync.playbackDiffMs',
    (v) => typeof v === 'number' && v >= -150 && v <= 400,
    {
      read: getGlobalVal,
      timeout: 45000,
      label: 'this member in step with the group after the unpause',
    },
  );
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
  expect(
    (await getGlobalVal('syncPlayManager.sync.loadCount')) - loadsBefore,
    'the item was loaded once',
  ).toBe(1);
  expect(await getGlobalVal('syncPlayManager.following'), 'still following').toBe(true);
  await repeatOffAgain();
});

it("another member's Seek while this Roku loads a restart moves it there with one group Seek", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  const seeksBefore = await getGlobalVal('syncPlayManager.sync.groupSeeks');
  expect(typeof seeksBefore, 'the manager counts the group Seeks it took').toBe('number');
  const { loadsBefore } = await restartAndCatchTheLoad();
  const target = 120;
  await syncPlay(member, 'Seek', { PositionTicks: target * 10_000_000 });
  await waitFor('syncPlayManager.sync.lastCommand.command', (v) => v === 'Seek', {
    read: getGlobalVal,
    timeout: 20000,
    interval: 50,
    label: "the group's Seek reached this Roku during its load",
  });
  // The group plays on once this member's Ready at the Seek's point is accepted.
  await waitFor('syncPlayManager.sync.lastCommand.command', (v) => v === 'Unpause', {
    read: getGlobalVal,
    timeout: 90000,
    label: "the group's Unpause after the Seek",
  });
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 30000,
    label: 'playing after the Seek',
  });
  await waitFor('position', (v) => typeof v === 'number' && v >= target, {
    read: playerPosition,
    timeout: 30000,
    label: "the node playing from the Seek's target",
  });
  expect(await playerPosition(), "near the Seek's target, not past it").toBeLessThan(target + 60);
  // A Ready the server finds off the point is answered with another Seek: one means none was.
  expect(
    (await getGlobalVal('syncPlayManager.sync.groupSeeks')) - seeksBefore,
    'group Seeks this member took',
  ).toBe(1);
  expect(
    (await getGlobalVal('syncPlayManager.sync.loadCount')) - loadsBefore,
    'the item was loaded once',
  ).toBe(1);
  expect(await getGlobalVal('syncPlayManager.following'), 'still following').toBe(true);
  await repeatOffAgain();
});

// Opens the OSD gear and returns the number of rows and a reader for a row's title.
async function openGear() {
  await waitOsdUp('the OSD up for the gear', { itemId: heroId });
  const atGear = (f) => f.node?.id === 'showPlaybackSettings';
  await waitFocused(atGear, {
    timeout: 20000,
    action: walkFocusUntil(ecp.Key.Right, atGear),
    label: 'the gear focused',
  });
  await press(ecp.Key.Ok);
  await waitFor(
    '#optionList.content.0.title',
    (t) => typeof t === 'string' && t.startsWith('Maximum Bitrate ('),
    { label: 'gear menu open', timeout: 10000 },
  );
  await waitFocusInside('#optionList', { label: 'gear menu focused', timeout: 5000 });
  const rows = await getVal('#optionList.content.getChildCount()');
  const titles = await getVals(
    Array.from({ length: rows }, (_, i) => `#optionList.content.${i}.title`),
  );
  return { rows, titles };
}

// The gear's SyncPlay rows while following, then Leave Group from the gear: the membership ends
// and the video plays on as the viewer's own, no longer repeating as the group did. Last, because it
// leaves the group.
it('the gear shows the group rows while following, and its Leave Group leaves with the video playing on and repeat off', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  // The group repeats the item, as the REST member set it: the local queue holds that mode.
  await syncPlay(member, 'SetRepeatMode', { Mode: 'RepeatOne' });
  await waitFor('syncPlayManager.sync.repeatMode', (v) => v === 'RepeatOne', {
    read: getGlobalVal,
    timeout: 15000,
    label: "the group's RepeatOne reached this Roku",
  });
  expect(await localRepeatMode(), "the queue holds the group's mode before the leave").toBe(
    'RepeatOne',
  );
  const { rows, titles } = await openGear();
  const [repeatRow, shuffleRow, offsetRow, leaveRow] = [
    titles.find((t) => typeof t === 'string' && t.startsWith('Repeat (')),
    titles[rows - 3],
    titles[rows - 2],
    titles[rows - 1],
  ];
  expect(repeatRow, "the gear's Repeat row reads the group's mode").toBe('Repeat (One)');
  expect(shuffleRow).toBe('Shuffle (Off)');
  expect(offsetRow, 'the offset row is the setting alone').toMatch(
    /^SyncPlay Time Offset \(\d+ ms\)$/,
  );
  expect(leaveRow).toBe('Leave Group');
  if (CAPTURE) await captureRawUI('syncPlayGearMenu');

  await scrollFocus({
    keyPath: '#optionList.itemFocused',
    target: rows - 1,
    forwardKey: ecp.Key.Down,
    backKey: ecp.Key.Up,
    label: 'Leave Group row focused',
  });
  await press(ecp.Key.Ok);
  await waitDialogClosed('the gear menu closed on Leave Group', { timeout: 10000 });
  await waitFor('syncPlayManager.inGroup', (v) => v === false, {
    read: getGlobalVal,
    timeout: 15000,
    label: "the membership ended on the server's GroupLeft",
  });
  expect(await playerState(), "the video plays on as the viewer's own").toBe('playing');
  expect(await localQueueCount(), 'its queue kept the item').toBe(1);
  expect(await localRepeatMode(), "the group's repeat does not outlive the membership").toBe(
    'RepeatNone',
  );
  expect(
    (await listGroups(member)).find((g) => g.GroupId === groupId)?.Participants?.length ?? 0,
    'one member left on the server',
  ).toBe(1);
  // The OSD reads the queue again: its gear's Repeat row says off, with the group rows gone.
  const after = await openGear();
  expect(
    after.titles.find((t) => typeof t === 'string' && t.startsWith('Repeat (')),
    "the gear's Repeat row agrees with the queue",
  ).toBe('Repeat (Off)');
  expect(
    after.titles.some((t) => t === 'Leave Group'),
    'no group rows outside a group',
  ).toBe(false);
});

/**
 * A new group the REST member made and this Roku joined, with nothing queued. The cases below
 * each start from one, so none depends on what the case before it left.
 * @param {string} name the group's name, which finds it in the server's list
 * @returns {Promise<string>} the group's id
 */
async function freshGroup(name) {
  await managerCall('leave').catch(() => {});
  await waitFor('syncPlayManager.inGroup', (v) => v === false, {
    read: getGlobalVal,
    timeout: 20000,
    label: 'the Roku out of the group before',
  });
  await syncPlay(member, 'Leave').catch(() => {});
  await syncPlay(member, 'New', { GroupName: name });
  // The REST member never reports Ready: without this the group waits on it for good.
  await syncPlay(member, 'SetIgnoreWait', { IgnoreWait: true });
  const id = (await listGroups(member)).find((g) => g.GroupName === name)?.GroupId;
  expect(id, `the member created ${name}`).toBeTruthy();
  await managerCall('join', id);
  await waitFor('syncPlayManager.inGroup', (v) => v === true, {
    read: getGlobalVal,
    timeout: 20000,
    label: `the Roku in ${name}`,
  });
  return id;
}
const queueHero = () =>
  syncPlay(member, 'SetNewQueue', {
    PlayingQueue: [heroId],
    PlayingItemPosition: 0,
    StartPositionTicks: 0,
  });
const waitHomeBehindPlayer = (label) =>
  waitFor('subtype()', (v) => v === 'Home', {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label,
  });
const serverGroup = async (id) => (await listGroups(member)).find((g) => g.GroupId === id);

it("another member's Stop closes this Roku's player and leaves it in the group, still following", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  // The case above leaves the gear menu open over a video that plays on as the viewer's own.
  await press(ecp.Key.Back);
  await waitDialogClosed('the gear menu closed', { timeout: 10000 });
  await stopPlayback();
  await waitHomeBehindPlayer("Home, once the viewer's own video is closed");

  await freshGroup('RTA stop party');
  await queueHero();
  await waitMediaPlaying("the group's item", 90000);
  await waitFor('syncPlayManager.sync.lastCommand.command', (v) => v === 'Unpause', {
    read: getGlobalVal,
    timeout: 30000,
    label: "the group's Unpause after this member's first-frame Ready",
  });
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 30000,
    label: 'the node playing before the Stop',
  });

  await syncPlay(member, 'Stop');
  await waitFor('syncPlayManager.sync.lastCommand.command', (v) => v === 'Stop', {
    read: getGlobalVal,
    timeout: 20000,
    label: "the group's Stop reached this Roku",
  });
  await waitHomeBehindPlayer('the player closed on the Stop');
  expect(await getGlobalVal('syncPlayManager.inGroup'), 'a Stop keeps the membership').toBe(true);
  expect(await getGlobalVal('syncPlayManager.following'), 'and the follow').toBe(true);
});

it("a fetch of the group's queue that fails once is tried again, and the item plays", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  await freshGroup('RTA retry party');
  // A player left open would satisfy the playing wait below before this group's item loads.
  expect(await getActiveVal('subtype()'), 'no player open before the queue').toBe('Home');
  const loadsBefore = await getGlobalVal('syncPlayManager.sync.loadCount');
  expect(typeof loadsBefore, 'the load count was read').toBe('number');
  try {
    await failRequests([{ prefix: 'syncplay-queue-', kind: 'timeout', times: 1 }]);
    await queueHero();
    // The first fetch failed, so a load performed at all is the second try's.
    await waitFor('syncPlayManager.sync.loadCount', (n) => n > loadsBefore, {
      read: getGlobalVal,
      timeout: 30000,
      label: "the group's queue loaded on the second try",
    });
    await waitMediaPlaying("the group's item, loaded on the second try", 90000);
    expect(await getGlobalVal('syncPlayManager.following'), 'still following').toBe(true);
  } finally {
    await failRequests([]);
  }
  // Back halts and closes the player, so the next case starts from Home.
  await stopPlayback();
  await waitHomeBehindPlayer('Home, after the retried load is closed');
});

it("a group's queue that cannot be loaded stops this Roku following, so the group does not wait on it", async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  const id = await freshGroup('RTA unloadable party');
  expect(await getActiveVal('subtype()'), 'no player open before the queue').toBe('Home');
  try {
    // An answer with no items: the group's playing item is not in it, which no retry can fix.
    await failRequests([{ prefix: 'syncplay-queue-', kind: 'empty', times: 1 }]);
    await queueHero();
    await waitFor('syncPlayManager.following', (v) => v === false, {
      read: getGlobalVal,
      timeout: 20000,
      label: 'the Roku no longer following the queue it could not load',
    });
  } finally {
    await failRequests([]);
  }
  expect(await getGlobalVal('syncPlayManager.inGroup'), 'still a member').toBe(true);
  // Neither member holds the group now: the REST member ignores waits, and so does a member
  // that stopped following. The server plays on.
  await expect
    .poll(async () => (await serverGroup(id))?.State, { timeout: 15000, interval: 500 })
    .toBe('Playing');
  expect(await getActiveVal('subtype()'), 'no player opened').toBe('Home');
});

it('reset() leaves the group on the server, which ends a group this Roku was the last member of', async (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
  const id = await freshGroup('RTA reset party');
  // The REST member leaves first, so this Roku's Leave is what ends the group.
  await syncPlay(member, 'Leave');
  // Both members sign in as one user and the list names users, so it cannot count them. A
  // group with no member is deleted: still listed means this Roku is in it.
  expect(Boolean(await serverGroup(id)), 'the group lives on with this Roku in it').toBe(true);
  // Sign-out and a server switch call this (`userAuth.bs`).
  await managerCall('reset');
  await expect
    .poll(async () => Boolean(await serverGroup(id)), { timeout: 15000, interval: 500 })
    .toBe(false);
  expect(await getGlobalVal('syncPlayManager.inGroup'), 'out of the group locally').toBe(false);
});
