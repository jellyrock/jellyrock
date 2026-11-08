/**
 * Gate on the decisions the restore helper makes after `rta-run.js` hands off: it takes
 * only the runner's snapshot, never restores while Vitest can still write the registry,
 * and reports and frees the lock only once the runner is gone. Every process, device and
 * clock call is a fake, so the 15 s wait costs nothing here.
 */
import { describe, it, expect } from 'vitest';
import { runTakeover, GROUP_EXIT_WAIT_MS } from '../../../scripts/lib/restore-takeover.js';

const OWNER = 4242;
const GROUP = 5151;
const SNAPSHOT = { file: '/tmp/registry-test.json', values: { JellyRock: { a: '1' } } };

/**
 * Fakes for `deps`. `groupExitsAt` is the fake time Vitest's group exits (Infinity: never,
 * until killed). `calls` records each call in order, so a test can check what ran before what.
 */
function fakes({
  groupExitsAt = 0,
  ownerAlive = false,
  adoptThrows = null,
  restoreThrows = null,
} = {}) {
  let clock = 0;
  let killed = false;
  const calls = [];
  const lines = { log: [], error: [] };
  const deps = {
    adopt: (owner, file) => {
      calls.push(['adopt', owner, file]);
      if (adoptThrows) throw new Error(adoptThrows);
    },
    groupGone: () => killed || clock >= groupExitsAt,
    killGroup: (pgid) => {
      calls.push(['killGroup', pgid, clock]);
      killed = true;
    },
    restore: async (values) => {
      calls.push(['restore', values, clock]);
      if (restoreThrows) throw new Error(restoreThrows);
    },
    relaunch: async () => calls.push(['relaunch']),
    ownerAlive: (pid) => {
      calls.push(['ownerAlive', pid]);
      return ownerAlive;
    },
    release: async () => calls.push(['release']),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    log: (line) => lines.log.push(line),
    error: (line) => lines.error.push(line),
  };
  const names = () => calls.map((c) => c[0]);
  return { deps, calls, lines, names };
}

const run = (deps, { releaseLock = true } = {}) =>
  runTakeover({ owner: OWNER, waitGroup: GROUP, releaseLock, snapshot: SNAPSHOT, deps });

describe('runTakeover', () => {
  it("refuses a snapshot the runner doesn't own, touching nothing else", async () => {
    const f = fakes({ adoptThrows: 'its owner is pid 1, not 4242' });
    expect(await run(f.deps)).toBe(1);
    expect(f.names()).toEqual(['adopt']);
    expect(f.lines.error.join('\n')).toMatch(/\[rta-restore\].*owner is pid 1/);
  });

  it.each([
    ['owner', 0],
    ['owner', Number.NaN],
    ['waitGroup', 0],
    ['waitGroup', 1],
    ['waitGroup', Number.NaN],
  ])('refuses %s %s, touching nothing', async (field, value) => {
    const f = fakes();
    const args = { owner: OWNER, waitGroup: GROUP, releaseLock: true, snapshot: SNAPSHOT };
    expect(await runTakeover({ ...args, [field]: value, deps: f.deps })).toBe(1);
    expect(f.names()).toEqual([]);
    expect(f.lines.error.join('\n')).toMatch(/\[rta-restore\].*process id above 1/);
  });

  it('adopts the snapshot by the runner pid and file before anything else', async () => {
    const f = fakes();
    await run(f.deps);
    expect(f.calls[0]).toEqual(['adopt', OWNER, SNAPSHOT.file]);
  });

  it('waits for Vitest to exit, then restores without killing it', async () => {
    const f = fakes({ groupExitsAt: 2_000 });
    expect(await run(f.deps)).toBe(0);
    expect(f.names()).not.toContain('killGroup');
    const restore = f.calls.find((c) => c[0] === 'restore');
    expect(restore[1]).toEqual(SNAPSHOT.values);
    expect(restore[2]).toBeGreaterThanOrEqual(2_000);
  });

  it('kills a group still running after the wait, and restores only after the kill', async () => {
    const f = fakes({ groupExitsAt: Infinity });
    expect(await run(f.deps)).toBe(0);
    const kill = f.calls.find((c) => c[0] === 'killGroup');
    expect(kill[1]).toBe(GROUP);
    expect(kill[2]).toBeGreaterThanOrEqual(GROUP_EXIT_WAIT_MS);
    expect(f.names()).toContain('killGroup');
    expect(f.names()).toContain('restore');
    expect(f.names().indexOf('killGroup')).toBeLessThan(f.names().indexOf('restore'));
  });

  it('leaves the report and the lock to a runner that is still alive', async () => {
    const f = fakes({ ownerAlive: true });
    expect(await run(f.deps)).toBe(0);
    expect(f.names()).not.toContain('release');
    expect(f.lines.log).toEqual([]);
  });

  it('reports and frees the lock itself when the runner is gone', async () => {
    const f = fakes({ ownerAlive: false });
    expect(await run(f.deps)).toBe(0);
    expect(f.names()).toContain('release');
    expect(f.lines.log.join('\n')).toMatch(/\[rta-restore\] device registry restored/);
  });

  it('keeps the lock when the runner held none', async () => {
    const f = fakes({ ownerAlive: false });
    await run(f.deps, { releaseLock: false });
    expect(f.names()).not.toContain('release');
  });

  it('checks the runner only after the restore, so a runner killed mid-restore is seen', async () => {
    const f = fakes();
    await run(f.deps);
    expect(f.names()).toContain('ownerAlive');
    expect(f.names()).toContain('restore');
    expect(f.names().indexOf('ownerAlive')).toBeGreaterThan(f.names().indexOf('restore'));
  });

  it('prints a failed restore even while the runner is alive, and still relaunches', async () => {
    const f = fakes({ ownerAlive: true, restoreThrows: 'restoreRegistry failed after 3 attempts' });
    expect(await run(f.deps)).toBe(1);
    expect(f.names()).toContain('relaunch');
    expect(f.lines.error.join('\n')).toMatch(/failed after 3 attempts/);
    expect(f.lines.error.join('\n')).not.toMatch(/Recover/);
  });

  it('tells a lone operator how to recover from a failed restore, and frees the lock', async () => {
    const f = fakes({ ownerAlive: false, restoreThrows: 'nope' });
    expect(await run(f.deps)).toBe(1);
    expect(f.lines.error.join('\n')).toMatch(/Recover: npm run rta:restore/);
    expect(f.names()).toContain('release');
  });
});
