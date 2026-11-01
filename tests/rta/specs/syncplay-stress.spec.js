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
  readPlayer,
  sleep,
  stopPlayback,
  waitFor,
  waitMediaPlaying,
} from '../lib/steps.js';

const ROUNDS = Number(process.env.RTA_STRESS_ROUNDS || 0);
const CASE = process.env.RTA_STRESS_CASE || 'scrub';
const LATE_MS = Number(process.env.RTA_STRESS_LATE_MS || 5500);
const CASES = ['scrub', 'double-ok', 'replay-twice', 'member-seeks', 'late-seek'];
const SCRUB_CASES = new Set(['scrub', 'double-ok', 'late-seek']);
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
const player = () => readPlayer(heroId);
const playerState = () => player()('state');
const playerPosition = () => player()('position');
const osdVisible = () => player()('#osd.visible');
const barVisible = () => player()('trickPlayBar.visible');
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

/** Brings the position back to a range the case can act in; true when it had to seek. */
async function resetPosition(before) {
  let target = null;
  if (before > FAR_IN_SECONDS) target = RESET_SECONDS;
  else if (CASE === 'replay-twice' && before < REPLAY_FLOOR_SECONDS) target = MID_FILM_SECONDS;
  if (target === null) return;
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

/** Drives the case's input once. Returns the ms the bar took to close, for the scrub cases. */
async function act(before) {
  if (SCRUB_CASES.has(CASE)) {
    await openBar();
    if (CASE === 'late-seek') {
      await failRequests([{ prefix: 'syncPlaySeek', kind: 'slow', ms: LATE_MS, times: 1 }]);
    }
    await ecp.sendKeypress(ecp.Key.Ok);
    const okAt = Date.now();
    if (CASE === 'double-ok') {
      await gap();
      await ecp.sendKeypress(ecp.Key.Ok);
    }
    return okAt;
  }
  if (CASE === 'replay-twice') {
    await ecp.sendKeypress(ecp.Key.Replay);
    await gap();
    await ecp.sendKeypress(ecp.Key.Replay);
  } else {
    await syncPlay(member, 'Seek', { PositionTicks: ticksAt(before + 30) });
    await gap();
    await syncPlay(member, 'Seek', { PositionTicks: ticksAt(before + 60) });
  }
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
    heroId = items.find((i) => (i.RunTimeTicks ?? 0) >= 600 * 10_000_000)?.Id;
    expect(heroId, 'a movie of ten minutes or more to play').toBeTruthy();
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
    await stopPlayback().catch(() => {});
    await managerCall('leave').catch(() => {});
    await syncPlay(member, 'Leave').catch(() => {});
  });

  it(
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
});
