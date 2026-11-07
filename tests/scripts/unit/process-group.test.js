/**
 * Gate on the property `rta-run.js` depends on: stopping the child it spawned also
 * stops the child's own children. Vitest runs each spec in a forked worker, so a
 * signal sent only to the Vitest main process leaves the worker driving the device.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { signalGroup } from '../../../scripts/lib/process-group.js';

// A parent that forks a grandchild which outlives it unless the grandchild is signalled,
// and prints the grandchild's pid. The parent itself ignores nothing: default signal handling.
const PARENT = `
  const { spawn } = require('node:child_process');
  const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  console.log(g.pid);
  setInterval(() => {}, 1000);
`;

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

const waitUntil = async (predicate, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return predicate();
};

let parent;
let grandchildPid;

// Spawned the way `rta-run.js` spawns Vitest: in its own process group.
async function startTree() {
  parent = spawn(process.execPath, ['-e', PARENT], {
    detached: true,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  grandchildPid = await new Promise((resolve) => {
    parent.stdout.once('data', (d) => resolve(Number(String(d).trim())));
  });
}

const exited = (child) =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', resolve);
  });

afterEach(() => {
  // A failing run must never leak the processes it started.
  for (const pid of [grandchildPid, parent?.pid]) {
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
  if (parent?.pid) {
    try {
      process.kill(-parent.pid, 'SIGKILL');
    } catch {
      /* group already gone */
    }
  }
  parent = undefined;
  grandchildPid = undefined;
});

describe('signalGroup', () => {
  it('stops the grandchild along with the child on SIGTERM', async () => {
    await startTree();
    expect(alive(grandchildPid)).toBe(true);
    signalGroup(parent, 'SIGTERM');
    await exited(parent);
    expect(await waitUntil(() => !alive(grandchildPid))).toBe(true);
  });

  it('forwards SIGINT as SIGINT', async () => {
    await startTree();
    signalGroup(parent, 'SIGINT');
    await exited(parent);
    expect(parent.signalCode).toBe('SIGINT');
    expect(await waitUntil(() => !alive(grandchildPid))).toBe(true);
  });

  it('does not throw when the group is already gone', async () => {
    await startTree();
    signalGroup(parent, 'SIGKILL');
    await exited(parent);
    expect(await waitUntil(() => !alive(grandchildPid))).toBe(true);
    expect(() => signalGroup(parent, 'SIGTERM')).not.toThrow();
  });
});
