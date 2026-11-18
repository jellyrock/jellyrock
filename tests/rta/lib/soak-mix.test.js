import { describe, it, expect } from 'vitest';
import {
  MIX_STEPS,
  atRest,
  mixPlan,
  parseStepList,
  seededRandom,
  slowSummary,
  stuckSummary,
} from './soak-mix.js';

describe('mixPlan: the seeded order of the SyncPlay soak', () => {
  it('gives the same order for the same seed, and another for another seed', () => {
    expect(mixPlan(7, 60)).toEqual(mixPlan(7, 60));
    expect(mixPlan(7, 60)).not.toEqual(mixPlan(8, 60));
  });

  it('draws each step only from the state the last one ended in, starting from playing', () => {
    for (const seed of [1, 2, 3, 99]) {
      let state = 'playing';
      for (const name of mixPlan(seed, 200)) {
        expect(MIX_STEPS[name], `step ${name} exists`).toBeTruthy();
        expect(MIX_STEPS[name].from, `${name} starts from ${state}`).toBe(state);
        state = MIX_STEPS[name].to;
      }
    }
  });

  it('reaches every step in a long run, so no step is dead weight in the table', () => {
    const seen = new Set(mixPlan(1, 2000));
    expect([...seen].sort()).toEqual(Object.keys(MIX_STEPS).sort());
  });

  it('never draws a step the run left out', () => {
    const plan = mixPlan(5, 500, ['lost-ready', 'scrub']);
    expect(plan).toHaveLength(500);
    expect(plan).not.toContain('lost-ready');
    expect(plan).not.toContain('scrub');
  });

  it('seededRandom stays inside [0, 1)', () => {
    const random = seededRandom(123);
    for (let i = 0; i < 1000; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('atRest: the invariants a mix step must end on', () => {
  const playing = {
    following: true,
    correcting: false,
    group: 'Playing',
    state: 'playing',
    phase: 'ready',
    bar: false,
    osd: false,
    drift: 40,
  };
  const paused = {
    following: true,
    correcting: false,
    group: 'Paused',
    state: 'paused',
    osd: true,
  };

  it('passes a playing member in step, and a paused one with the OSD up', () => {
    expect(atRest(playing, 'playing')).toBe(true);
    expect(atRest(paused, 'paused')).toBe(true);
  });

  it('holds the drift to the bars, edges included', () => {
    expect(atRest({ ...playing, drift: -150 }, 'playing')).toBe(true);
    expect(atRest({ ...playing, drift: 400 }, 'playing')).toBe(true);
    expect(atRest({ ...playing, drift: -151 }, 'playing')).toBe(false);
    expect(atRest({ ...playing, drift: 401 }, 'playing')).toBe(false);
  });

  it.each([
    ['a drift that is not known', { drift: undefined }],
    ['a correction under way', { correcting: true }],
    ['a member that stopped following', { following: false }],
    ['a node not playing', { state: 'buffering' }],
    ['a group not Playing', { group: 'Waiting' }],
    ['a player model not at rest', { phase: 'seeking' }],
    ['the scrub bar still up', { bar: true }],
    ['a correction flag that was never read', { correcting: undefined }],
  ])('fails a playing member with %s', (_why, change) => {
    expect(atRest({ ...playing, ...change }, 'playing')).toBe(false);
  });

  it.each([
    ['no OSD', { osd: false }],
    ['a node still playing', { state: 'playing' }],
    ['a group not Paused', { group: 'Waiting' }],
    ['a correction under way', { correcting: true }],
    ['a member that stopped following', { following: false }],
  ])('fails a paused member with %s', (_why, change) => {
    expect(atRest({ ...paused, ...change }, 'paused')).toBe(false);
  });

  it('judges a reading against the state asked for, not the one it is in', () => {
    expect(atRest(playing, 'paused')).toBe(false);
    expect(atRest(paused, 'playing')).toBe(false);
  });
});

describe('parseStepList: a chosen step order for the mix', () => {
  it('returns the names in order, trimming spaces', () => {
    expect(parseStepList('key-pause, member-unpause ,scrub')).toEqual([
      'key-pause',
      'member-unpause',
      'scrub',
    ]);
  });

  it('refuses an unknown step and names it with the known ones', () => {
    expect(() => parseStepList('scrub,nope')).toThrow(/nope.*known steps/s);
  });

  it('refuses a step that does not start where the last one ended', () => {
    expect(() => parseStepList('key-pause,scrub')).toThrow(
      /step 2.*scrub.*starts from playing.*paused/s,
    );
    expect(() => parseStepList('member-unpause')).toThrow(/step 1.*member-unpause/s);
  });

  it('refuses an empty list', () => {
    expect(() => parseStepList(' , ')).toThrow(/no steps/);
  });
});

describe('stuckSummary: the stuck-seek term of the SUMMARY line', () => {
  it('reads stuck=0 and no steps when the app recovered nothing', () => {
    expect(stuckSummary([])).toBe('stuck=0');
  });

  it('totals the recoveries and lists the steps they happened in', () => {
    expect(
      stuckSummary([
        { label: '4:scrub', count: 1 },
        { label: '9:replay', count: 2 },
      ]),
    ).toBe('stuck=3 at 4:scrub 9:replay');
  });
});

describe('slowSummary: the slow-seek term of the SUMMARY line', () => {
  it('reads slow=0 when no step had a slow seek', () => {
    expect(slowSummary([])).toBe('slow=0');
  });
  it('totals the counts and names the steps', () => {
    expect(
      slowSummary([
        { label: '3:seek', count: 1 },
        { label: '7:pause', count: 2 },
      ]),
    ).toBe('slow=3 at 3:seek 7:pause');
  });
});
