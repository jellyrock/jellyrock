/**
 * Gate on the properties `rta-run.js` depends on: stopping the child it spawned also
 * stops the child's own children, Ctrl-Z pauses and resumes them with it, and they do
 * not outlive the runner. Vitest runs each spec in a forked worker, so a signal sent only
 * to the Vitest main process leaves the worker driving the device.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { signalGroup } from '../../../scripts/lib/process-group.js';

const HELPER = pathToFileURL(
  fileURLToPath(new URL('../../../scripts/lib/process-group.js', import.meta.url)),
).href;

// A parent that forks a grandchild which outlives it unless the grandchild is signaled,
// and prints the grandchild's pid. The parent itself ignores nothing: default signal handling.
const PARENT = `
  const { spawn } = require('node:child_process');
  const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  console.log(g.pid);
  setInterval(() => {}, 1000);
`;

// Shaped like `rta-run.js`: spawns a detached child, relays job control to it, prints its pid.
const RELAY_RUNNER = `
  import { spawn } from 'node:child_process';
  import { relayJobControl } from '${HELPER}';
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  relayJobControl(child);
  console.log(child.pid);
  setInterval(() => {}, 1000);
`;

// The Vitest stand-in for the watchdog: arms it, forks a worker in its own group, prints
// "<own pid> <worker pid>". Run detached under a runner that is then killed.
const WATCHED_CHILD = `
  import { spawn } from 'node:child_process';
  import { exitWithParent } from '${HELPER}';
  exitWithParent({ intervalMs: 100 });
  const w = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  console.log(process.pid + ' ' + w.pid);
  setInterval(() => {}, 1000);
`;
const WATCHED_RUNNER = `
  const { spawn } = require('node:child_process');
  spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(WATCHED_CHILD)}], {
    detached: true,
    stdio: 'inherit',
  });
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

// `ps` state letter: T is stopped (SIGSTOP or SIGTSTP).
const stopped = (pid) =>
  execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
    .trim()
    .startsWith('T');

const waitUntil = async (predicate, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return predicate();
};

const firstLine = (proc) =>
  new Promise((resolve) => {
    proc.stdout.once('data', (d) => resolve(String(d).trim()));
  });

const exited = (child) =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', resolve);
  });

// Process groups each test started. Every process here is a group leader or a member of
// one, so killing the groups stops everything without signaling a bare pid that may
// already have been recycled.
let groups = [];

const startDetached = (args) => {
  const proc = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  groups.push(proc.pid);
  return proc;
};

afterEach(() => {
  for (const pgid of groups) {
    try {
      process.kill(-pgid, 'SIGCONT');
      process.kill(-pgid, 'SIGKILL');
    } catch {
      /* group already gone */
    }
  }
  groups = [];
});

describe('signalGroup', () => {
  let parent;
  let grandchildPid;

  // Spawned the way `rta-run.js` spawns Vitest: in its own process group.
  async function startTree() {
    parent = startDetached(['-e', PARENT]);
    grandchildPid = Number(await firstLine(parent));
  }

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

  it('returns false, without throwing, when the group is already gone', async () => {
    await startTree();
    signalGroup(parent, 'SIGKILL');
    await exited(parent);
    expect(await waitUntil(() => !alive(grandchildPid))).toBe(true);
    expect(signalGroup(parent, 'SIGTERM')).toBe(false);
  });

  it('returns false before there is a child', () => {
    expect(signalGroup(null, 'SIGTERM')).toBe(false);
  });
});

describe('relayJobControl', () => {
  it('pauses the detached child on SIGTSTP and resumes it on SIGCONT', async () => {
    const runner = startDetached(['--input-type=module', '-e', RELAY_RUNNER]);
    const childPid = Number(await firstLine(runner));
    groups.push(childPid);

    process.kill(runner.pid, 'SIGTSTP');
    expect(await waitUntil(() => stopped(childPid) && stopped(runner.pid))).toBe(true);

    process.kill(runner.pid, 'SIGCONT');
    expect(await waitUntil(() => !stopped(childPid) && !stopped(runner.pid))).toBe(true);
  });
});

describe('exitWithParent', () => {
  it('stops the child and its worker when the runner is killed outright', async () => {
    const runner = startDetached(['-e', WATCHED_RUNNER]);
    const [childPid, workerPid] = (await firstLine(runner)).split(' ').map(Number);
    groups.push(childPid);
    expect(alive(childPid) && alive(workerPid)).toBe(true);

    // SIGKILL: the runner gets no chance to signal anything.
    process.kill(runner.pid, 'SIGKILL');
    await exited(runner);
    expect(await waitUntil(() => !alive(childPid) && !alive(workerPid))).toBe(true);
  });
});
