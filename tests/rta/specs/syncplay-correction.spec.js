/**
 * After a resume a member off the group's position corrects itself (phase F of the SyncPlay
 * project):
 * - a member ahead of the group holds where it is and lands in step;
 * - a member behind it seeks past the group, holds and lands in step;
 * - a member's own stall recovery keeps its place, since the group waited for it;
 * - the viewer's Pause during a correction's seek or hold pauses the group and stays paused;
 * - another member's Pause during a hold brings up the OSD;
 * - a resume that seeks reports no stall to the group;
 * - a correction whose seek would run off the item is skipped, so the player does not jump back;
 * - the drift reads unknown once a group command or a leave has made it meaningless.
 * The **SyncPlay Time Offset** setting makes the drift on demand: the offset moves this member's
 * clock, so a node that started early under an offset reads ahead once the offset goes back to 0,
 * and an offset raised once the node plays reads behind. Nothing else on a local server drifts past
 * the threshold every time. A second member of the same account, over REST, drives the group and
 * ignores the wait, as in `syncplay-controls.spec.js`. The suite skips on a server with no push
 * channel to the Roku (https without the companion plugin).
 */
import { afterAll, afterEach, beforeAll, it, expect } from 'vitest';
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
const GROUP_NAME = `RTA correction party ${Date.now()}`;
// `syncPlayPlayback.SETTLE_CORRECTION_MS`, the bar for a member ahead, and `SKIP_TO_SYNC_MIN_MS`,
// the bar for a member behind: past them the manager corrects.
const THRESHOLD_MS = 150;
const BEHIND_THRESHOLD_MS = 400;
// Under one notification interval, so the second of the two readings the check counts always
// falls after the Unpause's `When` on the clock the offset no longer moves.
const AHEAD_OFFSET_MS = 400;
// Well past the threshold, since a resume can start a few hundred ms ahead on its own.
const BEHIND_OFFSET_MS = 1000;
// Past the Unpause's own lead by more than `SKIP_TO_SYNC_MIN_MS`, so every resume seeks. The lead
// can reach most of a second, which is why `BEHIND_OFFSET_MS` does not always do it.
const RESUME_SEEKS_OFFSET_MS = 2000;

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
const setOffset = (value) =>
  odc.setValue({ base: 'global', keyPath: 'user.settings.playbackSyncPlayTimeOffsetMs', value });
const player = () => readPlayer(heroId);
const playerState = () => player()('state');
const playerPosition = () => player()('position');
const setPlayerControl = (value) =>
  odc.setValue({ base: 'scene', keyPath: `#${heroId}.control`, value });
const waitLastCommand = (name) =>
  waitFor('syncPlayManager.sync.lastCommand.command', (v) => v === name, {
    read: getGlobalVal,
    timeout: 15000,
    label: `the group's ${name} at this member`,
  });
const waitDriftInside = () =>
  waitFor(
    'syncPlayManager.sync.playbackDiffMs',
    (v) => typeof v === 'number' && v >= -THRESHOLD_MS && v <= BEHIND_THRESHOLD_MS,
    {
      read: getGlobalVal,
      timeout: 20000,
      label: "this member's drift from the group inside the correction thresholds",
    },
  );
const osdVisible = () => player()('#osd.visible');
const waitGroup = (state) =>
  waitFor('syncPlayManager.groupState', (s) => s === state, {
    read: getGlobalVal,
    timeout: 15000,
    label: `the group ${state}`,
  });
const waitPaused = () =>
  waitFor('state', (s) => s === 'paused', {
    read: playerState,
    timeout: 10000,
    label: "the node paused on the group's pause",
  });
const waitPlaying = () =>
  waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 15000,
    label: 'the node playing',
  });
/** The player's phase once a correction's seek is out, or undefined if none went out. */
async function correctionSeekOut() {
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    const phase = await getGlobalVal('syncPlayManager.sync.trackerPhase');
    if (phase === 'seeking' || phase === 'landing') return phase;
  }
  return undefined;
}
/**
 * Plays on from a resume, reading behind the group, until a correction's seek is out. Two
 * notifications decide the check, so an offset raised after the second leaves it spent: resume
 * again rather than fail on that timing.
 */
async function forceCorrectionSeek() {
  for (let attempt = 0; attempt < 4; attempt++) {
    await setOffset(0);
    await syncPlay(member, 'Pause');
    await waitPaused();
    await syncPlay(member, 'Unpause');
    await waitLastCommand('Unpause');
    await waitPlaying();
    await setOffset(BEHIND_OFFSET_MS);
    if (await correctionSeekOut()) return;
  }
  throw new Error('no correction went out in four resumes');
}
/**
 * The node held for a correction: past its seek, paused, the group still playing. A hold is what
 * the seek left of the lead, so it can be a pulse too short for `waitFor`: this reads as fast as the
 * device answers, and resumes again when the seek took all of it.
 */
async function forceCorrectionHold() {
  for (let attempt = 0; attempt < 4; attempt++) {
    await forceCorrectionSeek();
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      if ((await playerState()) === 'paused') return;
    }
  }
  throw new Error('no correction held the node in four tries');
}
/** The node stays paused through more than a correction's lead: nothing resumes it. */
async function expectStaysPaused() {
  const t0 = Date.now();
  while (Date.now() - t0 < 3500) expect(await playerState(), 'still paused').toBe('paused');
}
/**
 * The drift past the threshold first, so a reading from before the correction cannot pass; then
 * back inside it, and moving, since a frozen node keeps its last reading.
 */
async function expectCorrected(isOff, label) {
  await waitFor('syncPlayManager.sync.playbackDiffMs', (v) => typeof v === 'number' && isOff(v), {
    read: getGlobalVal,
    timeout: 10000,
    label,
  });
  await waitDriftInside();
  await waitPlaying();
  const before = await playerPosition();
  await waitFor('position', (p) => p > before + 1, {
    read: playerPosition,
    timeout: 5000,
    label: 'the node still moving',
  });
  await waitDriftInside();
  expect(await playerState(), 'the node still playing').toBe('playing');
}

beforeAll(async () => {
  session = await authenticateForPush(RTA_CONFIG.server, () =>
    getGlobalVal('device.serverDeviceName'),
  );
  member = await authenticate(RTA_CONFIG.server, { role: 'member' });
  pushAvailable = await commandChannelAvailable(session);
  const query = new URLSearchParams({
    UserId: session.userId,
    IncludeItemTypes: 'Movie',
    Recursive: 'true',
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Fields: 'RunTimeTicks',
    Limit: '50',
  });
  const data = await getJson(`${session.serverUrl}/Items?${query}`, tokenHeader(session.token));
  // Long enough that the end-of-item case's 30 s jump back is plain to see.
  const tenMinutesTicks = 10 * 60 * 10_000_000;
  heroId = (data?.Items ?? []).find((i) => (i.RunTimeTicks ?? 0) >= tenMinutesTicks)?.Id ?? '';
  expect(heroId, 'a movie of ten minutes or more to play').toBeTruthy();
  await syncPlay(member, 'Leave').catch(() => {});
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'syncplay-correction');
  if (!pushAvailable) return;

  await syncPlay(member, 'New', { GroupName: GROUP_NAME });
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
  await waitMediaPlaying("the group's item", 90000);
  await waitLastCommand('Unpause');
  await waitPlaying();
});

afterAll(async () => {
  await setOffset(0).catch(() => {});
  await stopPlayback().catch(() => {});
  await managerCall('leave').catch(() => {});
  await syncPlay(member, 'Leave').catch(() => {});
});

// A failed case must not leave the next one reading a drift it did not ask for.
afterEach(async () => {
  await setOffset(0).catch(() => {});
});

const skipWithoutPush = (testCtx) => {
  if (!pushAvailable)
    testCtx.skip(
      'the server has no command channel to this Roku (https without the companion plugin)',
    );
};

it('a group pause leaves the drift unknown, and a member ahead of the group lands in step', async (testCtx) => {
  skipWithoutPush(testCtx);
  await setOffset(AHEAD_OFFSET_MS);
  await syncPlay(member, 'Pause');
  await waitPaused();
  await waitFor('syncPlayManager.sync.playbackDiffMs', (v) => v === undefined || v === null, {
    read: getGlobalVal,
    timeout: 5000,
    label: 'the drift unknown while the group is paused',
  });
  await syncPlay(member, 'Unpause');
  // The firing time is fixed when the command is scheduled, so the node still starts early.
  await waitLastCommand('Unpause');
  await setOffset(0);
  await expectCorrected((v) => v < -THRESHOLD_MS, 'this member reading ahead of the group');
});

it('a member behind the group lands in step', async (testCtx) => {
  skipWithoutPush(testCtx);
  await syncPlay(member, 'Pause');
  await waitPaused();
  await syncPlay(member, 'Unpause');
  await waitLastCommand('Unpause');
  await waitPlaying();
  await setOffset(BEHIND_OFFSET_MS);
  await expectCorrected((v) => v > BEHIND_THRESHOLD_MS, 'this member reading behind the group');
  await setOffset(0);
});

it("a member's own stall recovery keeps its place, with the drift unknown until the group's next command", async (testCtx) => {
  skipWithoutPush(testCtx);
  // Twice the group's highest ping decides the server's recovery branch. A real client's ping sends
  // the Unpause to the others alone, so this member's last command stays the one before the stall.
  await syncPlay(member, 'Ping', { Ping: 20 });
  const lastEmitted = () => getGlobalVal('syncPlayManager.sync.lastCommand.emittedAtMs');
  const commandBeforeStall = await lastEmitted();
  // The node stops moving, and the manager hears the buffering the host would pass on.
  await setPlayerControl('pause');
  const frozenAt = await playerPosition();
  await managerCall('playerEvent', { kind: 'state', state: 'buffering', position: frozenAt });
  await waitFor('syncPlayManager.sync.trackerPhase', (v) => v === 'rebuffering', {
    read: getGlobalVal,
    timeout: 5000,
    label: 'the stall reported to the server',
  });
  // The group waits while the stall lasts: long enough that a wrong reading is seconds off.
  const stalled = Date.now();
  while (Date.now() - stalled < 3000) await playerPosition();
  await setPlayerControl('resume');
  await waitPlaying();
  // Two notifications decide a correction: this outlasts them, the seek and its hold.
  const positions = [];
  const recovered = Date.now();
  while (Date.now() - recovered < 6000) positions.push(await playerPosition());
  const longestStep = Math.max(...positions.slice(1).map((p, i) => p - positions[i]));
  expect(longestStep, 'no jump after the recovery').toBeLessThan(2);
  // A server before 12.1 answers with a corrective Seek, a command that says where the group is.
  const heardNoCommand = (await lastEmitted()) === commandBeforeStall;
  const drift = await getGlobalVal('syncPlayManager.sync.playbackDiffMs');
  if (heardNoCommand)
    expect([undefined, null], 'no drift to read until the next command').toContain(drift);
  // The server computes the group's position into its Pause, so that is the group's own word.
  await syncPlay(member, 'Pause');
  await waitLastCommand('Pause');
  const groupAt =
    Number(await getGlobalVal('syncPlayManager.sync.lastCommand.positionTicks')) / 10_000_000;
  await waitPaused();
  expect(
    Math.abs((await playerPosition()) - groupAt),
    "this member's distance from the group, in seconds",
  ).toBeLessThan(1);
  await syncPlay(member, 'Unpause');
  await waitLastCommand('Unpause');
  await waitPlaying();
  await waitDriftInside();
});

it("the viewer's Play key during a correction's seek pauses the group at the landing, and a second press plays on", async (testCtx) => {
  skipWithoutPush(testCtx);
  // Three rounds: the press can land while the node still reads `playing` or once it buffers.
  for (let round = 0; round < 3; round++) {
    await forceCorrectionSeek();
    await press(ecp.Key.Play);
    await setOffset(0);
    await waitGroup('Paused');
    await waitPaused();
    expect(await osdVisible(), 'the OSD up, as for any pause on the Play key').toBe(true);
    await expectStaysPaused();
    expect(await getGlobalVal('syncPlayManager.following'), 'still following').toBe(true);
    await press(ecp.Key.Play);
    await waitGroup('Playing');
    await waitPlaying();
    await waitDriftInside();
  }
});

it("the viewer's Play key during a correction's hold means pause: the group pauses and nothing resumes it", async (testCtx) => {
  skipWithoutPush(testCtx);
  await forceCorrectionHold();
  await press(ecp.Key.Play);
  await setOffset(0);
  await waitGroup('Paused');
  expect(await osdVisible(), 'the OSD up').toBe(true);
  await expectStaysPaused();
  await syncPlay(member, 'Unpause');
  await waitGroup('Playing');
  await waitPlaying();
  await waitDriftInside();
});

it("another member's Pause during a correction's hold brings up the OSD", async (testCtx) => {
  skipWithoutPush(testCtx);
  await forceCorrectionHold();
  await syncPlay(member, 'Pause');
  await setOffset(0);
  await waitFor('#osd.visible', (v) => v === true, {
    read: player(),
    timeout: 5000,
    label: 'the OSD up on the group pause',
  });
  await syncPlay(member, 'Unpause');
  await waitGroup('Playing');
  await waitPlaying();
  await waitDriftInside();
});

it('a resume that seeks reports no stall, so the group does not wait', async (testCtx) => {
  skipWithoutPush(testCtx);
  // Above the setting's range: a keypad cannot reach this, and it makes the seek happen.
  await setOffset(RESUME_SEEKS_OFFSET_MS);
  const phases = new Set();
  const groupStates = new Set();
  for (let round = 0; round < 4; round++) {
    await syncPlay(member, 'Pause');
    await waitPaused();
    await syncPlay(member, 'Unpause');
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      phases.add(await getGlobalVal('syncPlayManager.sync.trackerPhase'));
      groupStates.add(await getGlobalVal('syncPlayManager.groupState'));
    }
  }
  await setOffset(0);
  expect(phases.has('seeking') || phases.has('landing'), 'a resume did seek').toBe(true);
  expect(phases.has('rebuffering'), 'no stall reported').toBe(false);
  expect(groupStates.has('Waiting'), 'the group never waited').toBe(false);
  expect(groupStates.has('Playing'), 'the read saw the group').toBe(true);
});

it('a correction whose seek would run off the item is skipped, with no jump back', async (testCtx) => {
  skipWithoutPush(testCtx);
  const duration = await player()('duration');
  const start = duration - 2.5;
  await syncPlay(member, 'Seek', { PositionTicks: Math.round(start * 10_000_000) });
  await waitLastCommand('Seek');
  await waitLastCommand('Unpause');
  await setOffset(BEHIND_OFFSET_MS);
  const seen = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    const position = await playerPosition();
    if (typeof position === 'number' && position > 0) seen.push(position);
  }
  await setOffset(0);
  expect(seen.length, 'the position read during the end of the item').toBeGreaterThan(0);
  expect(Math.min(...seen), 'no jump back from the end').toBeGreaterThan(start - 5);
});

it('a leave leaves the drift unknown', async (testCtx) => {
  skipWithoutPush(testCtx);
  await managerCall('leave');
  await waitFor('#overhang.#cluster.#syncplayIcon.isActive', (v) => v === false, {
    timeout: 10000,
    label: 'this member out of the group',
  });
  expect([undefined, null]).toContain(await getGlobalVal('syncPlayManager.sync.playbackDiffMs'));
});
