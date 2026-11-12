import { describe, it, expect } from 'vitest';
import { MIX_STEPS, atRest, mixPlan, seededRandom } from './soak-mix.js';

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
