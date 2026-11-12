/**
 * A stress tool for the SyncPlay player tracker: it repeats one input that races the node's own
 * seek and counts how each round ends. It is skipped unless `RTA_STRESS_ROUNDS` is set, so a
 * normal `test:rta` run pays nothing for it.
 *
 * Run it (the group needs the server's push channel to the Roku, as `syncplay-controls.spec.js`):
 *   RTA_STRESS_ROUNDS=40 RTA_STRESS_CASE=scrub npm run test:rta -- syncplay-stress
 * `RTA_STRESS_CASE` picks the input, `scrub` by default:
 * - `scrub`: three Right presses, then OK on the trick-play bar;
 * - `double-ok`: the same, with a second OK 300 ms after the first;
 * - `replay-twice`: two Replay presses 300 ms apart;
 * - `member-seeks`: two Seeks from the other member 300 ms apart, to different targets;
 * - `late-seek`: a scrub whose Seek request the app sends late (`RTA_STRESS_LATE_MS`, 5500 by
 *   default), so the bar's own fallback races the group's answer.
 * - `mix`: a seeded order of many inputs (`RTA_STRESS_SEED`, 1 by default), with the member
 *   checked at rest with the group after each. Its steps and the rest check are in
 *   `../lib/soak-mix.js`, and `docs/dev/rta-tests.md` says how to read its record.
 *
 * One pass of a race proves little: a wedge that shows in one round of twenty is a real find, and
 * twenty clean rounds are not a pass. Count rounds, and read the summary line, not the verdict.
 * Each round ends in exactly one of:
 * - `ok`: the node plays and the group is Playing;
 * - `frozen`: at the end of the settle window the node is not playing and the group is not
 *   Playing (the node usually reads `buffering`). The round logs what it saw, then recovers with
 *   a seek to the node's own position. Any frozen round fails the test;
 * - `paused`: the group is Paused (a Pause that raced the input). It is reported, not failed. The
 *   round resumes the group with a member Unpause and waits for the OSD to close, so one Pause
 *   cannot count as many rounds (it once read as 28 of 40).
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
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
import { failRequests } from '../lib/failRequests.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import {
  getGlobalVal,
  press,
  readPlayer,
  sleep,
  stopPlayback,
  waitFor,
  waitMediaPlaying,
} from '../lib/steps.js';
import { MIX_STEPS, atRest, nextStep, seededRandom } from '../lib/soak-mix.js';

const ROUNDS = Number(process.env.RTA_STRESS_ROUNDS || 0);
const CASE = process.env.RTA_STRESS_CASE || 'scrub';
const LATE_MS = Number(process.env.RTA_STRESS_LATE_MS || 5500);
const SEED = Number(process.env.RTA_STRESS_SEED || 1);
const CASES = ['scrub', 'double-ok', 'replay-twice', 'member-seeks', 'late-seek', 'mix'];
const SCRUB_CASES = new Set(['scrub', 'double-ok', 'late-seek', 'lost-seek']);
const REPLAY_CASES = new Set(['replay', 'replay-twice']);
// How long a mix step's end state must hold before the step counts as settled: three position
// notifications while playing, so a correction the resume's first readings start is seen.
const MIX_STABLE_MS = 1500;
// How often a mix step is sampled. Every sample is seven reads the app answers on its render
// thread, so `RTA_STRESS_POLL_MS` lets a run check that the sampling is not what it measures.
const MIX_POLL_MS = Number(process.env.RTA_STRESS_POLL_MS || 100);
const MIX_DWELL_PLAYING_MS = 5000;
const MIX_DWELL_PAUSED_MS = 3000;
const MIX_WINDOW_MS = 20000;
// A lost request is sent again only after its limit, and a lost Seek leaves the bar to its own
// fallback and this member to a catch-up.
const MIX_LOST_WINDOW_MS = 30000;
// A step that loads an item: the stream's start sets it, not the device.
const MIX_LOAD_WINDOW_MS = 90000;
const MIX_LOAD_STEPS = new Set(['item-step', 'halt-refollow']);
const MIX_RECOVER_WINDOW_MS = 90000;
const LOCALE = RTA_CONFIG.languages[0];
const GROUP_NAME = 'RTA stress party';
const GAP_MS = 300;
const COMMAND_WINDOW_MS = 4000;
const SETTLE_WINDOW_MS = 12000;
// Far enough in that the next round's targets stay inside the film, and early enough that a
// Replay has room to go back.
const FAR_IN_SECONDS = 450;
const RESET_SECONDS = 60;
const REPLAY_FLOOR_SECONDS = 60;
const MID_FILM_SECONDS = 200;
const ticksAt = (seconds) => Math.round(seconds * 10_000_000);

let session;
let member;
let pushAvailable;
let heroId;
// The mix's second item, and the item the player node is stamped with now: an item step moves it.
let nextId;
let playingId;

const syncPlay = (who, action, body = {}) =>
  postJson(
    `${who.serverUrl}/SyncPlay/${action}`,
    { ...tokenHeader(who.token), 'Content-Type': 'application/json' },
    body,
  );
const managerCall = (funcName, ...funcParams) =>
  odc.callFunc(
    { base: 'global', keyPath: 'syncPlayManager', funcName, funcParams },
    { timeout: 10000 },
  );
const player = () => readPlayer(playingId);
const playerState = () => player()('state');
const playerPosition = () => player()('position');
const osdVisible = () => player()('#osd.visible');
const barVisible = () => player()('trickPlayBar.visible');
// The viewer's own paths into the player and the gear, as `syncplay-controls.spec.js` drives them.
const playerCall = (command) =>
  odc.callFunc(
    {
      base: 'scene',
      keyPath: `#${playingId}`,
      funcName: 'handleTransport',
      funcParams: [{ command }],
    },
    { timeout: 10000 },
  );
const pickTimeOffset = (ms) =>
  odc.setValue({
    base: 'scene',
    keyPath: `#${playingId}.#osd.syncPlayPick`,
    value: { kind: 'timeOffset', value: ms },
  });
const resetTimeOffset = () =>
  odc.setValue({ base: 'global', keyPath: 'user.settings.playbackSyncPlayTimeOffsetMs', value: 0 });
// The offsets a pick step walks through, each far enough from the last to start a correction.
const OFFSET_PICKS_MS = [300, 0, -300, 0];
let offsetPicks = 0;
const lastEmitted = () => getGlobalVal('syncPlayManager.sync.lastCommand.emittedAtMs');
const groupState = () => getGlobalVal('syncPlayManager.groupState');
/** The gap between the two inputs of a pair is the race being exercised. */
const gap = () => sleep(GAP_MS);

// Vitest hides a passing test's console output, so the result goes to a file in the gitignored
// `.device-runs/` folder, named for the case, and its path is printed.
const outFile = path.join(process.cwd(), '.device-runs', `syncplay-stress-${CASE}.log`);
const note = (line) => {
  console.log(line);
  fs.appendFileSync(outFile, `${line}\n`);
};

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/** Brings the position back to a range the step can act in; true when it had to seek. */
async function resetPosition(before, name = CASE) {
  let target = null;
  if (before > FAR_IN_SECONDS) target = RESET_SECONDS;
  else if (REPLAY_CASES.has(name) && before < REPLAY_FLOOR_SECONDS) target = MID_FILM_SECONDS;
  if (target === null) return false;
  await syncPlay(member, 'Seek', { PositionTicks: ticksAt(target) });
  await waitFor('position', (v) => typeof v === 'number' && Math.abs(v - target) < 20, {
    read: playerPosition,
    timeout: 30000,
    label: 'the position reset by the member Seek',
  });
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 30000,
    label: 'playing again after the position reset',
  });
  await waitFor('syncPlayManager.groupState', (s) => s === 'Playing', {
    read: getGlobalVal,
    timeout: 30000,
    label: 'the group playing after the position reset',
  });
  return true;
}

/** Opens the trick-play bar with three Right presses, one library wait apart. */
async function openBar() {
  await ecp.sendKeypressSequence([ecp.Key.Right, ecp.Key.Right, ecp.Key.Right], { wait: 400 });
  await waitFor('trickPlayBar.visible', (v) => v === true, {
    read: barVisible,
    timeout: 10000,
    label: 'the trick-play bar up after three Right presses',
  });
}

/**
 * Drives one input. Returns the time of the OK press for the scrub cases, else null.
 * @param {number} before the node's position, in seconds
 * @param {string} name the case, or the mix step
 */
async function act(before, name = CASE) {
  if (SCRUB_CASES.has(name)) {
    await openBar();
    if (name === 'late-seek') {
      await failRequests([{ prefix: 'syncPlaySeek', kind: 'slow', ms: LATE_MS, times: 1 }]);
    }
    // The server refuses the Seek once, so no group command comes back and the bar closes by its
    // own fallback, as in `syncplay-controls.spec.js`.
    if (name === 'lost-seek') {
      await failRequests([{ prefix: 'syncPlaySeek', kind: 'http', status: 403, times: 1 }]);
    }
    await ecp.sendKeypress(ecp.Key.Ok);
    const okAt = Date.now();
    if (name === 'double-ok') {
      await gap();
      await ecp.sendKeypress(ecp.Key.Ok);
    }
    return okAt;
  }
  if (name === 'replay-twice') {
    await ecp.sendKeypress(ecp.Key.Replay);
    await gap();
    await ecp.sendKeypress(ecp.Key.Replay);
  } else if (name === 'member-seeks') {
    await syncPlay(member, 'Seek', { PositionTicks: ticksAt(before + 30) });
    await gap();
    await syncPlay(member, 'Seek', { PositionTicks: ticksAt(before + 60) });
  } else if (name === 'member-seek' || name === 'member-seek-paused' || name === 'lost-ready') {
    // The Ready this member owes after the group's Seek gets no answer once: the group waits on
    // it until it is sent again.
    if (name === 'lost-ready') {
      await failRequests([{ prefix: 'syncPlayReady', kind: 'timeout', times: 1 }]);
    }
    await syncPlay(member, 'Seek', { PositionTicks: ticksAt(before + 30) });
  } else if (name === 'member-pause') {
    await syncPlay(member, 'Pause');
  } else if (name === 'member-unpause') {
    await syncPlay(member, 'Unpause');
  } else if (name === 'key-pause' || name === 'key-resume') {
    await press(ecp.Key.Play);
  } else if (name === 'replay') {
    await press(ecp.Key.Replay);
  } else if (name === 'offset-pick') {
    await pickTimeOffset(OFFSET_PICKS_MS[offsetPicks++ % OFFSET_PICKS_MS.length]);
  } else if (name === 'item-step') {
    await stepItem();
  } else if (name === 'halt-refollow') {
    await haltAndFollowAgain();
  }
  // The dwell steps drive nothing.
  return null;
}

/** Samples until the bar closes: ms after OK, or null if it is still up when the cap passes. */
async function barClosedAfter(okAt) {
  while (Date.now() - okAt < SETTLE_WINDOW_MS) {
    if ((await barVisible()) === false) return Date.now() - okAt;
    await sleep(50);
  }
  return null;
}

/**
 * Waits for the group's answer, then for the node and the group to play, and classifies the
 * round. Not a `waitFor`: it has three outcomes, and the window ending is a result, not an error.
 */
async function settle(lastCmd) {
  const commandWindow = (CASE === 'late-seek' ? LATE_MS : 0) + COMMAND_WINDOW_MS;
  const sent = Date.now();
  while (Date.now() - sent < commandWindow && (await lastEmitted()) === lastCmd) await sleep(100);
  const answered = (await lastEmitted()) !== lastCmd;
  const start = Date.now();
  let state = '';
  let group = '';
  while (Date.now() - start < SETTLE_WINDOW_MS) {
    state = (await playerState()) ?? '';
    group = (await groupState()) ?? '';
    if (state === 'playing' && group === 'Playing')
      return { outcome: 'ok', answered, state, group };
    await sleep(300);
  }
  return { outcome: group === 'Paused' ? 'paused' : 'frozen', answered, state, group };
}

async function recoverFrozen(round, seen) {
  const position = await playerPosition();
  const phase = await getGlobalVal('syncPlayManager.sync.trackerPhase').catch(() => '?');
  const buffering = await player()('bufferingStatus');
  note(
    `round ${round} frozen: state=${seen.state} group=${seen.group} phase=${phase} ` +
      `position=${position} bufferingStatus=${JSON.stringify(buffering)}`,
  );
  await odc.setValue({ base: 'scene', keyPath: `#${heroId}.seek`, value: position });
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 20000,
    label: 'the node playing after the seek to its own position',
  }).catch(() => note(`round ${round}: the node did not recover`));
}

async function resumePaused() {
  await syncPlay(member, 'Unpause');
  await waitFor('state', (s) => s === 'playing', {
    read: playerState,
    timeout: 20000,
    label: "the node playing on the member's Unpause",
  });
  await waitFor('#osd.visible', (v) => v === false, {
    read: osdVisible,
    timeout: 15000,
    label: 'the OSD closed before the next round',
  });
}

/**
 * The id the player node carries for the group's playing item: the movie at that place in the
 * playlist this run queued. `sync.playingItemId` cannot say, since it is the playlist entry's id,
 * not the movie's.
 */
const nodeIdAt = (playingItemIndex) => [heroId, nextId][playingItemIndex];

/**
 * Steps the group to its other item from the player, and follows the player node to it. A step
 * that does not arrive is left for the settle window to count, so the waits here do not throw.
 */
async function stepItem() {
  const from = await getGlobalVal('syncPlayManager.sync.playingItemId');
  const index = await getGlobalVal('syncPlayManager.sync.playingItemIndex');
  await playerCall(index === 0 ? 'next' : 'previous');
  const hasMoved = await waitFor(
    'syncPlayManager.sync.playingItemId',
    (v) => Boolean(v) && v !== from,
    { read: getGlobalVal, timeout: 20000, label: "the group's playing item moved by the step" },
  ).then(
    () => true,
    () => false,
  );
  if (hasMoved) playingId = nodeIdAt(index === 0 ? 1 : 0);
}

/**
 * Back halts this member with the player closed; it then follows again by the function the
 * menu's Resume with Group calls. Back closes an open OSD first, so the press waits for it to be
 * down. As in `stepItem`, a wait that fails leaves the outcome to the settle window.
 */
async function haltAndFollowAgain() {
  const isDown = await waitFor('#osd.visible', (v) => v === false, {
    read: osdVisible,
    timeout: 15000,
    label: 'the OSD down before Back, so Back reaches the player',
  }).then(
    () => true,
    () => false,
  );
  if (!isDown) return;
  await press(ecp.Key.Back);
  const hasHalted = await waitFor('syncPlayManager.following', (v) => v === false, {
    read: getGlobalVal,
    timeout: 15000,
    label: 'this member halted by Back',
  }).then(
    () => true,
    () => false,
  );
  if (hasHalted) await managerCall('resumeFollowing');
}

/** One reading of everything a mix step is judged on. ODC lowercases a whole record's keys. */
async function snapshot() {
  const [state, position, osd, bar, group, following, sync] = await Promise.all([
    playerState(),
    playerPosition(),
    osdVisible(),
    barVisible(),
    groupState(),
    getGlobalVal('syncPlayManager.following'),
    getGlobalVal('syncPlayManager.sync'),
  ]);
  return {
    at: Date.now(),
    state,
    position,
    osd,
    bar,
    group,
    following,
    drift: sync?.playbackdiffms,
    correcting: sync?.correctioninflight,
    phase: sync?.trackerphase,
    corrections: sync?.correctionsdone,
    groupSeeks: sync?.groupseeks,
    readies: sync?.readiessent,
    unreachable: sync?.unreachablenotices,
    pauseLandedMs: sync?.pauselandedms,
    resumeLagMs: sync?.resumelagms,
    resumeLagSampleMs: sync?.resumelagsamplems,
    resumeLagKind: sync?.resumelagkind,
    loads: sync?.loadcount,
    itemIndex: sync?.playingitemindex,
    itemId: sync?.playingitemid,
    readAs: playingId,
    offsetMs: sync?.extraoffsetms,
  };
}

/**
 * Samples until the member has been at rest in `expected` for `stableMs`, or the window ends.
 * Not a `waitFor`: the window ending is a result to count (`frozen`), and the samples on the way
 * are the measurement (how long the node was not playing, every drift reading).
 */
async function settleMix(expected, startedAt, windowMs, stableMs = MIX_STABLE_MS) {
  const drifts = [];
  // Every reading of the window, kept only for a frozen step: a rare fault has to be read from
  // the run that caught it.
  const trail = [];
  let notPlayingMs = 0;
  let restSince = null;
  let last = null;
  let s = null;
  while (Date.now() - startedAt < windowMs) {
    s = await snapshot();
    if (last && last.state !== 'playing') notPlayingMs += s.at - last.at;
    if (typeof s.drift === 'number') drifts.push([s.at - startedAt, s.drift]);
    trail.push({ ...s, at: s.at - startedAt });
    if (atRest(s, expected)) {
      restSince ??= s.at;
      if (s.at - restSince >= stableMs) {
        return { outcome: 'ok', settleMs: restSince - startedAt, notPlayingMs, drifts, end: s };
      }
    } else {
      restSince = null;
    }
    last = s;
    await sleep(MIX_POLL_MS);
  }
  return { outcome: 'frozen', settleMs: null, notPlayingMs, drifts, end: s, trail };
}

/** Puts a frozen mix run back to a playing group in step; false when that does not settle. */
async function recoverMix() {
  await failRequests([]).catch(() => {});
  if ((await getGlobalVal('syncPlayManager.following')) === false) {
    await managerCall('resumeFollowing').catch(() => {});
  }
  playingId = nodeIdAt(await getGlobalVal('syncPlayManager.sync.playingItemIndex')) ?? playingId;
  if ((await groupState()) !== 'Playing') await syncPlay(member, 'Unpause').catch(() => {});
  await syncPlay(member, 'Seek', { PositionTicks: ticksAt(RESET_SECONDS) }).catch(() => {});
  return (await settleMix('playing', Date.now(), MIX_RECOVER_WINDOW_MS)).outcome === 'ok';
}

describe.skipIf(ROUNDS <= 0)('SyncPlay stress', () => {
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
      Fields: 'RunTimeTicks',
      Limit: '50',
    });
    const items = (await getJson(`${session.serverUrl}/Items?${query}`, tokenHeader(session.token)))
      .Items;
    // Ten minutes or more, found by order, never by name: the cases move 60 s ahead.
    [heroId, nextId] = items
      .filter((i) => (i.RunTimeTicks ?? 0) >= 600 * 10_000_000)
      .map((i) => i.Id);
    expect(heroId, 'a movie of ten minutes or more to play').toBeTruthy();
    playingId = heroId;
    await syncPlay(member, 'Leave').catch(() => {});
    const expectedServer = await seedHome(session, LOCALE);
    await hardRelaunch();
    await assertSeedTookEffect(expectedServer, 'syncplay-stress');
    if (!pushAvailable) return;

    await syncPlay(member, 'New', { GroupName: GROUP_NAME });
    await syncPlay(member, 'SetIgnoreWait', { IgnoreWait: true });
    const groups = await getJson(`${member.serverUrl}/SyncPlay/List`, tokenHeader(member.token));
    const groupId = groups.find((g) => g.GroupName === GROUP_NAME)?.GroupId;
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
      read: playerState,
      timeout: 30000,
      label: 'the node playing',
    });
  }, 240000);

  afterAll(async () => {
    await failRequests([]).catch(() => {});
    await resetTimeOffset().catch(() => {});
    await stopPlayback().catch(() => {});
    await managerCall('leave').catch(() => {});
    await syncPlay(member, 'Leave').catch(() => {});
  });

  it.skipIf(CASE === 'mix')(
    `repeats ${CASE} and no round freezes the node`,
    async (testCtx) => {
      if (!pushAvailable)
        testCtx.skip(
          'the server has no command channel to this Roku (https without the companion plugin)',
        );
      expect(CASES, 'RTA_STRESS_CASE names a case').toContain(CASE);
      const counts = { ok: 0, frozen: 0, paused: 0 };
      const barMs = [];
      let summary;
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, '');
      console.log(`[STRESS] writing ${outFile}`);
      try {
        for (let round = 0; round < ROUNDS; round++) {
          const before = (await playerPosition()) ?? 0;
          await resetPosition(before);
          const start = (await playerPosition()) ?? before;
          const lastCmd = await lastEmitted();
          const okAt = await act(start);
          if (okAt !== null) {
            const closed = await barClosedAfter(okAt);
            if (closed !== null) barMs.push(closed);
          }
          const result = await settle(lastCmd);
          counts[result.outcome]++;
          note(
            `round ${round} ${CASE} ${result.outcome} state=${result.state} group=${result.group}` +
              `${result.answered ? '' : ' (no group command came)'}`,
          );
          if (result.outcome === 'frozen') await recoverFrozen(round, result);
          if (result.outcome === 'paused') await resumePaused();
        }
      } finally {
        await failRequests([]).catch(() => {});
        const bar = barMs.length
          ? ` bar min=${Math.min(...barMs)}ms median=${median(barMs)}ms max=${Math.max(...barMs)}ms`
          : '';
        summary =
          `SUMMARY case=${CASE} rounds=${ROUNDS} ok=${counts.ok} frozen=${counts.frozen} ` +
          `paused=${counts.paused}${bar}`;
        note(summary);
      }
      // A run that counted no rounds is a finding, not a pass.
      expect(counts.ok + counts.frozen + counts.paused, summary).toBe(ROUNDS);
      expect(counts.frozen, summary).toBe(0);
    },
    ROUNDS * 90000 + 60000,
  );

  it.skipIf(CASE !== 'mix')(
    `mixes ${ROUNDS} seeded steps (seed ${SEED}) and the member is at rest with the group after each`,
    async (testCtx) => {
      if (!pushAvailable)
        testCtx.skip(
          'the server has no command channel to this Roku (https without the companion plugin)',
        );
      const engine = await getGlobalVal('syncPlayManager.sync.engine');
      // The manager's own engine sends a Ready as a write nobody reads, so a lost one is never
      // sent again: the step would only repeat that known gap, which the comparison closes. It
      // runs there as the plain member Seek it is built on, so one seed gives both engines the
      // same order of steps.
      const drivenAs = (name) =>
        name === 'lost-ready' && engine !== 'comparison' ? 'member-seek' : name;
      // Named for its start time too: a second run of one seed must never replace the first's
      // record.
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const file = path.join(
        process.cwd(),
        '.device-runs',
        `syncplay-stress-mix-seed${SEED}-${engine}-${stamp}.jsonl`,
      );
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '');
      console.log(`[STRESS] writing ${file}`);
      const record = (entry) => fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
      const random = seededRandom(SEED);
      const counts = { ok: 0, frozen: 0 };
      const frozenSteps = [];
      let state = 'playing';
      let summary;
      let hasStopped = false;

      /** Runs one step from where the member rests now, records it, and returns its outcome. */
      const runStep = async (index, name, expected, windowMs, stableMs, drive) => {
        const before = await snapshot();
        const startedAt = Date.now();
        await drive(before);
        const result = await settleMix(expected, startedAt, windowMs, stableMs);
        const end = result.end ?? {};
        // No step of the mix fails a request three times, so none may tell the viewer the group
        // cannot be reached: a notice here is a request whose result never counted.
        const toldUnreachable = (end.unreachable ?? 0) - (before.unreachable ?? 0);
        if (toldUnreachable > 0) result.outcome = 'frozen';
        record({
          index,
          step: name,
          from: state,
          to: expected,
          engine,
          outcome: result.outcome,
          settleMs: result.settleMs,
          notPlayingMs: result.notPlayingMs,
          corrections: (end.corrections ?? 0) - (before.corrections ?? 0),
          groupSeeks: (end.groupSeeks ?? 0) - (before.groupSeeks ?? 0),
          readies: (end.readies ?? 0) - (before.readies ?? 0),
          toldUnreachable,
          loads: (end.loads ?? 0) - (before.loads ?? 0),
          positionBefore: before.position,
          end,
          drifts: result.drifts,
          trail: result.trail,
          // On a frozen step, what each queued item's player node answers: a reader pointed at
          // the wrong node looks the same as a player that is gone.
          nodes:
            result.outcome === 'frozen'
              ? {
                  heroId,
                  nextId,
                  heroState: await readPlayer(heroId)('state'),
                  nextState: await readPlayer(nextId)('state'),
                }
              : undefined,
        });
        return result.outcome;
      };

      try {
        // The item steps need a second item in the group's playlist.
        expect(nextId, 'a second movie of ten minutes or more to queue').toBeTruthy();
        await syncPlay(member, 'Queue', { ItemIds: [nextId], Mode: 'Queue' });
        await waitFor('syncPlayManager.sync.playlistCount', (v) => v === 2, {
          read: getGlobalVal,
          timeout: 15000,
          label: "the second movie in the group's playlist",
        });
        // The run starts from a member at rest, or its first step measures the start.
        expect(
          (await settleMix('playing', Date.now(), MIX_RECOVER_WINDOW_MS)).outcome,
          'the member at rest with the group before the first step',
        ).toBe('ok');
        for (let index = 0; index < ROUNDS && !hasStopped; index++) {
          const name = drivenAs(nextStep(random, state));
          const expected = MIX_STEPS[name].to;
          if (state === 'playing') {
            const position = (await playerPosition()) ?? 0;
            if (await resetPosition(position, name)) {
              const reset = await runStep(
                index,
                'reset',
                'playing',
                MIX_WINDOW_MS,
                MIX_STABLE_MS,
                async () => {},
              );
              if (reset !== 'ok') frozenSteps.push(`${index}:reset`);
            }
          }
          let windowMs = MIX_WINDOW_MS;
          if (name === 'late-seek') windowMs += LATE_MS;
          if (name === 'lost-seek' || name === 'lost-ready') windowMs = MIX_LOST_WINDOW_MS;
          if (MIX_LOAD_STEPS.has(name)) windowMs = MIX_LOAD_WINDOW_MS;
          let stableMs = MIX_STABLE_MS;
          if (name === 'dwell-playing') stableMs = MIX_DWELL_PLAYING_MS;
          if (name === 'dwell-paused') stableMs = MIX_DWELL_PAUSED_MS;
          const outcome = await runStep(index, name, expected, windowMs, stableMs, (before) =>
            act(before.position ?? 0, name),
          );
          await failRequests([]);
          counts[outcome]++;
          state = expected;
          if (outcome === 'frozen') {
            frozenSteps.push(`${index}:${name}`);
            state = 'playing';
            hasStopped = !(await recoverMix());
          }
        }
      } finally {
        await failRequests([]).catch(() => {});
        summary =
          `SUMMARY case=mix seed=${SEED} engine=${engine} steps=${ROUNDS} ok=${counts.ok} ` +
          `frozen=${counts.frozen}${frozenSteps.length ? ` at ${frozenSteps.join(' ')}` : ''}` +
          `${hasStopped ? ' (stopped: the member did not recover)' : ''}`;
        console.log(summary);
        record({ summary });
      }
      // A run that counted no steps is a finding, not a pass.
      expect(counts.ok + counts.frozen, summary).toBe(ROUNDS);
      expect(frozenSteps, summary).toEqual([]);
    },
    ROUNDS * 90000 + 120000,
  );
});
