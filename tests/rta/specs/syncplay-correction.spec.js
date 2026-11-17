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
// Pause and unpause rounds in a row. Before the pause position was reckoned, each round left this
// member 50 to 115 ms further ahead, so a hold correction ran by the second or third (Stick 4K,
// 2026-11-10).
const PAUSE_ROUNDS = 5;
// Where the drift must sit after those rounds: inside the hold's bar with room to spare. Twelve
// such rounds settled within 13 ms on a remote member's pause (same device and date).
const PAUSE_ROUND_DRIFT_MS = 100;

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
const slowSeeks = async () => {
  const count = await getGlobalVal('syncPlayManager.sync.slowSeeks');
  expect(typeof count, 'the slow-seek count was read').toBe('number');
  return count;
};
// `m.global.rtaSyncPlaySeekBudgetMs` (RTA builds only): the member's next seek of its own gets this
// landing budget, once. Far under any real seek, so that seek outlasts it.
const SHORT_SEEK_BUDGET_MS = 200;
const armSlowSeek = () =>
  odc.setValue({ base: 'global', keyPath: 'rtaSyncPlaySeekBudgetMs', value: SHORT_SEEK_BUDGET_MS });
// The slow seeks a landed group Seek has answered (`landGroupSeek`). The count starts at zero with
// the app, which `beforeAll` relaunches.
let slowSeeksAnswered = 0;
/**
 * Has the other member seek the group, and waits for the Unpause that follows this Roku's landing.
 * After a seek that outlasted its budget the member stops correcting by seeking
 * (`syncPlayPlayer.endSeek`), until a seek lands in time, and only the group can ask for that one.
 */
async function landGroupSeek() {
  const before = await getGlobalVal('syncPlayManager.sync.lastCommand.emittedatms');
  const at = await playerPosition();
  const target = at > 120 ? at - 60 : at + 60;
  await syncPlay(member, 'Seek', { PositionTicks: Math.round(target * 10_000_000) });
  await waitFor(
    'syncPlayManager.sync.lastCommand',
    (c) => c?.command === 'Unpause' && typeof c.emittedatms === 'number' && c.emittedatms > before,
    { read: getGlobalVal, timeout: 30000, label: "the group's Unpause after its Seek landed here" },
  );
  await waitPlaying();
  slowSeeksAnswered = await slowSeeks();
}
/** One resume that reads behind the group: the phase of the correction's seek, or undefined. */
async function resumeBehind() {
  await setOffset(0);
  await syncPlay(member, 'Pause');
  await waitPaused();
  await syncPlay(member, 'Unpause');
  await waitLastCommand('Unpause');
  await waitPlaying();
  await setOffset(BEHIND_OFFSET_MS);
  return correctionSeekOut();
}
/**
 * Plays on from a resume, reading behind the group, until a correction's seek is out. Two
 * notifications decide the check, so an offset raised after the second leaves it spent: resume
 * again rather than fail on that timing. A seek that outlasted its budget since the last group
 * Seek is answered first, or no correction would seek at all.
 */
async function forceCorrectionSeek() {
  for (let attempt = 0; attempt < 4; attempt++) {
    if ((await slowSeeks()) > slowSeeksAnswered) await landGroupSeek();
    if (await resumeBehind()) return;
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
/** After a correction: the drift inside the thresholds, and the node moving and still playing. */
async function expectBackInStep() {
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
  await waitLastCommand('Unpause');
  // The offset stays until the node plays, so it resumes early by the offset: the comparison
  // places the resume on the clock again at every event, and would resume on time if the offset
  // were taken back before then.
  await waitPlaying();
  const correctionsBefore = await getGlobalVal('syncPlayManager.sync.correctionsDone');
  await setOffset(0);
  // The member now sits ahead of the group by the offset. The comparison holds it at its first
  // reading, before a drift that large is ever published, so the case waits for the correction
  // itself and then for the member in step.
  await waitFor('syncPlayManager.sync.correctionsDone', (v) => v > correctionsBefore, {
    read: getGlobalVal,
    timeout: 15000,
    label: 'the correction for the member ahead of the group, run to its end',
  });
  await expectBackInStep();
});

it('a member behind the group lands in step', async (testCtx) => {
  skipWithoutPush(testCtx);
  // The drift past the threshold shows only until the seek is written, when the offset lands after
  // the resume's first reading. The seek's own phase lasts, and the helper resumes again when the
  // two readings were spent first.
  await forceCorrectionSeek();
  await expectBackInStep();
  await setOffset(0);
});

/**
 * One group pause and unpause, then the member settled: played on long enough for the check's two
 * readings, any correction they started run to its end, and the tracker back at rest. Without the
 * gate the next Pause lands inside a correction's seek, whose jump also satisfies a wait on the
 * position alone, and the rounds then measure the corrections they caused.
 */
async function pauseRound() {
  await syncPlay(member, 'Pause');
  await waitPaused();
  await syncPlay(member, 'Unpause');
  await waitLastCommand('Unpause');
  await waitPlaying();
  const from = await playerPosition();
  await waitFor('position', (p) => p > from + 1.5, {
    read: playerPosition,
    timeout: 10000,
    label: 'the node playing on after the round',
  });
  await waitFor('syncPlayManager.sync.correctionInFlight', (v) => v === false, {
    read: getGlobalVal,
    timeout: 15000,
    label: 'no correction under way after the round',
  });
  await waitFor('syncPlayManager.sync.trackerPhase', (v) => v === 'ready', {
    read: getGlobalVal,
    timeout: 10000,
    label: 'the tracker at rest after the round',
  });
  await waitPlaying();
  await waitDriftInside();
}

it('pause rounds leave this member in step, with no correction', async (testCtx) => {
  skipWithoutPush(testCtx);
  await setOffset(0);
  // The round before the count: whatever the last case left (an offset taken back a moment ago) is put
  // right by this Unpause, its seek or its correction.
  await pauseRound();
  const before = await getGlobalVal('syncPlayManager.sync.correctionsDone');
  expect(typeof before, 'the corrections count is published').toBe('number');
  for (let round = 0; round < PAUSE_ROUNDS; round++) await pauseRound();
  const drift = await getGlobalVal('syncPlayManager.sync.playbackDiffMs');
  expect(await getGlobalVal('syncPlayManager.sync.correctionsDone'), 'no correction ran').toBe(
    before,
  );
  expect(typeof drift, 'the drift is read').toBe('number');
  expect(Math.abs(drift), 'the drift after the rounds').toBeLessThan(PAUSE_ROUND_DRIFT_MS);
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
  const phases = new Set();
  const groupStates = new Set();
  const sampleFor = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      phases.add(await getGlobalVal('syncPlayManager.sync.trackerPhase'));
      groupStates.add(await getGlobalVal('syncPlayManager.groupState'));
    }
  };
  const slowBefore = await slowSeeks();
  await setOffset(RESUME_SEEKS_OFFSET_MS);
  // Sampled from the offset on: the comparison judges the drift at every reading and seeks at
  // once.
  await sampleFor(5000);
  for (let round = 0; round < 4; round++) {
    await syncPlay(member, 'Pause');
    await waitPaused();
    await syncPlay(member, 'Unpause');
    await sampleFor(8000);
  }
  await setOffset(0);
  expect(phases.has('seeking') || phases.has('landing'), 'a resume did seek').toBe(true);
  expect(groupStates.has('Playing'), 'the read saw the group').toBe(true);
  if ((await slowSeeks()) > slowBefore) {
    // A seek that outlasted its budget is a stall the group is told about, so it waits and then
    // plays on: the case checks the recovery instead of silence. The member seeks no more until a
    // group Seek lands, so that comes first.
    await landGroupSeek();
    await waitGroup('Playing');
    await waitDriftInside();
  } else {
    expect(phases.has('rebuffering'), 'no stall reported').toBe(false);
    expect(groupStates.has('Waiting'), 'the group never waited').toBe(false);
  }
});

// The slow path, made to happen: about one seek in a hundred outlasts its budget on its own, too
// few for a run to meet. `armSlowSeek` gives the correction's seek a budget it cannot make.
it('a correction seek that outlasts its budget holds the group once, and the member still corrects by a seek of its own after', async (testCtx) => {
  skipWithoutPush(testCtx);
  const slowBefore = await slowSeeks();
  const readiesBefore = await getGlobalVal('syncPlayManager.sync.readiesSent');
  expect(typeof readiesBefore, 'the Ready count was read').toBe('number');
  try {
    await armSlowSeek();
    await forceCorrectionSeek();
    await waitFor('syncPlayManager.sync.slowSeeks', (v) => v > slowBefore, {
      read: getGlobalVal,
      timeout: 15000,
      label: "the correction's seek counted as slow",
    });
    expect(await getGlobalVal('rtaSyncPlaySeekBudgetMs'), 'the short budget was used once').toBe(0);
    // The group heard of the stall and waited for this member's Ready.
    await waitFor('syncPlayManager.sync.readiesSent', (v) => v > readiesBefore, {
      read: getGlobalVal,
      timeout: 20000,
      label: "this member's Ready after its slow seek",
    });
    await waitGroup('Playing');
    await waitPlaying();
    expect(await getGlobalVal('syncPlayManager.following'), 'still following').toBe(true);
    // Behind again, and a seek of its own goes out: one slow seek that landed is one sample of
    // what a seek takes here, not a reason to stop seeking (`syncPlayConverge.seeksTooSlow`).
    // A resume can spend its check before the offset is raised, so it is tried again, as
    // `forceCorrectionSeek` does, with no group Seek in between.
    let sought;
    for (let attempt = 0; attempt < 4 && !sought; attempt++) sought = await resumeBehind();
    expect(sought, 'a correction seek after a slow one').toBeTruthy();
  } finally {
    await odc.setValue({ base: 'global', keyPath: 'rtaSyncPlaySeekBudgetMs', value: 0 });
    await setOffset(0);
  }
  await waitGroup('Playing');
  await waitPlaying();
  await waitDriftInside();
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
