/**
 * The seeded order of steps for `syncplay-stress.spec.js`'s `mix` case. Pure, so a seed gives the
 * same order on every machine and a failing run can be replayed step for step.
 *
 * Each step names the group state it starts from and the one it must end in. The order is a walk:
 * a step is drawn only from those that start where the last one ended.
 */

/** Every step of the mix: where it starts, and where the group must be once it has settled. */
export const MIX_STEPS = Object.freeze({
  // The other member, over REST.
  'member-pause': { from: 'playing', to: 'paused' },
  'member-unpause': { from: 'paused', to: 'playing' },
  'member-seek': { from: 'playing', to: 'playing' },
  'member-seek-paused': { from: 'paused', to: 'paused' },
  // The viewer, on the remote.
  'key-pause': { from: 'playing', to: 'paused' },
  'key-resume': { from: 'paused', to: 'playing' },
  scrub: { from: 'playing', to: 'playing' },
  replay: { from: 'playing', to: 'playing' },
  // The viewer picks a time offset in the gear, which starts a correction at once.
  'offset-pick': { from: 'playing', to: 'playing' },
  // The viewer steps the group to its other item: a load, reported to the group.
  'item-step': { from: 'playing', to: 'playing' },
  // Back halts this member, then it follows again and loads the group's item where the group is.
  'halt-refollow': { from: 'playing', to: 'playing' },
  // Two inputs a short gap apart, racing the first one's seek.
  'double-ok': { from: 'playing', to: 'playing' },
  'replay-twice': { from: 'playing', to: 'playing' },
  'member-seeks': { from: 'playing', to: 'playing' },
  // One of the app's own SyncPlay requests made late or lost.
  'late-seek': { from: 'playing', to: 'playing' },
  'lost-seek': { from: 'playing', to: 'playing' },
  'lost-ready': { from: 'playing', to: 'playing' },
  // Nothing happens: the state must hold, and while playing the drift is sampled.
  'dwell-playing': { from: 'playing', to: 'playing' },
  'dwell-paused': { from: 'paused', to: 'paused' },
});

/** A small seeded generator (mulberry32): the same seed gives the same numbers everywhere. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draws the next step from those that start in `state`. The spec draws one at a time, so a run
 * that had to recover a frozen step goes on from the state the recovery left.
 * @param {() => number} random a `seededRandom`
 * @param {'playing' | 'paused'} state where the group is now
 * @param {string[]} [leaveOut] step names this run cannot take
 */
export function nextStep(random, state, leaveOut = []) {
  const open = Object.keys(MIX_STEPS).filter(
    (name) => MIX_STEPS[name].from === state && !leaveOut.includes(name),
  );
  return open[Math.floor(random() * open.length)];
}

/**
 * The step names of one run in which every step settles, in order, starting from a playing group.
 * @param {number} seed
 * @param {number} count how many steps
 * @param {string[]} [leaveOut] step names this run cannot take
 */
export function mixPlan(seed, count, leaveOut = []) {
  const random = seededRandom(seed);
  const plan = [];
  let state = 'playing';
  for (let i = 0; i < count; i++) {
    const name = nextStep(random, state, leaveOut);
    plan.push(name);
    state = MIX_STEPS[name].to;
  }
  return plan;
}

// `syncPlayPlayback.SETTLE_CORRECTION_MS` ahead and `SKIP_TO_SYNC_MIN_MS` behind, the bars
// `syncplay-correction.spec.js` holds a settled member to. A drift is positive when behind.
export const AHEAD_BAR_MS = 150;
export const BEHIND_BAR_MS = 400;

/**
 * Whether one reading shows the member at rest where the group is: the invariants of the mix.
 * Playing: the node plays, no correction is under way, the scrub bar is down, and the drift is
 * known and inside the bars. Paused: the node is paused with the OSD up, so the viewer can see
 * why. Either way the member still follows. A field that was not read counts against rest.
 * @param {object} s a reading: `state`, `group`, `following`, `correcting`, `phase`, `bar`,
 *   `osd`, `drift`
 * @param {'playing' | 'paused'} expected
 */
export function atRest(s, expected) {
  if (s.following !== true || s.correcting !== false) return false;
  if (expected === 'paused') return s.group === 'Paused' && s.state === 'paused' && s.osd === true;
  return (
    s.group === 'Playing' &&
    s.state === 'playing' &&
    s.phase === 'ready' &&
    s.bar !== true &&
    typeof s.drift === 'number' &&
    s.drift >= -AHEAD_BAR_MS &&
    s.drift <= BEHIND_BAR_MS
  );
}
