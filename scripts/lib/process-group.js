import { execFileSync } from 'node:child_process';

/**
 * Signals the whole process group of a child spawned with `detached: true`.
 *
 * Vitest runs each spec in a forked worker, a grandchild of `rta-run.js`. A signal sent
 * only to the Vitest main process orphans the worker, which keeps driving the device. A
 * detached child leads its own group, so a negative pid reaches every process in it.
 */
export function signalGroup(child, signal) {
  if (!child?.pid) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (e) {
    // The group is already gone: nothing left to stop.
    if (e.code === 'ESRCH') return false;
    throw e;
  }
}

/**
 * Classifies each stop signal for a runner that restores on the first and abandons on the
 * second. Returns a function that answers `'stop'`, `'repeat'` or `'abandon'` per signal.
 *
 * A signal within `windowMs` of the first is the same stop delivered twice, not an
 * operator asking to abandon. npm forwards SIGINT and SIGTERM to its script, and when
 * `/bin/sh` is bash the script runs in place of the shell, so it receives both the
 * terminal's or the tool's signal and npm's copy of it.
 */
export function interruptGate({ windowMs = 500, now = Date.now } = {}) {
  let first = null;
  return () => {
    const t = now();
    if (first === null) {
      first = t;
      return 'stop';
    }
    return t - first < windowMs ? 'repeat' : 'abandon';
  };
}

/**
 * Runs `onSignal` once for the first of `signals` this process receives, and returns a
 * function that removes exactly the listeners it added.
 *
 * For the stretch before a runner has anything to restore: a stop there only has to
 * release what the runner holds. Only the first signal runs `onSignal`. A repeat inside
 * `windowMs` is the same stop delivered twice (see `interruptGate`) and is ignored. A signal
 * after the window is an operator who is tired of waiting: it runs `onAbandon`, so a stalled
 * `onSignal` never leaves the process un-killable.
 */
export function onStopOnce(
  signals,
  onSignal,
  { windowMs = 500, now = Date.now, onAbandon = () => {} } = {},
) {
  const classify = interruptGate({ windowMs, now });
  const listeners = signals.map((signal) => {
    const listener = () => {
      const verdict = classify();
      if (verdict === 'stop') onSignal(signal);
      // A repeat is ignored, and so is any signal past the window if `onAbandon` is not set.
      else if (verdict === 'abandon') onAbandon(signal);
    };
    process.on(signal, listener);
    return [signal, listener];
  });
  return () => {
    for (const [signal, listener] of listeners) process.off(signal, listener);
  };
}

/**
 * Makes Ctrl-Z pause a detached child's group along with this process, and `fg` resume it.
 *
 * A detached child is in a group with no parent in its session, and the kernel discards
 * SIGTSTP for such a group, so without this relay the child keeps running while this
 * process is stopped. SIGSTOP is never discarded. Installing a SIGTSTP listener replaces
 * the default stop, so this process stops itself after its child.
 */
export function relayJobControl(child) {
  process.on('SIGTSTP', () => {
    signalGroup(child, 'SIGSTOP');
    process.kill(process.pid, 'SIGSTOP');
  });
  process.on('SIGCONT', () => signalGroup(child, 'SIGCONT'));
}

/**
 * Kills this process's group once the process that started it dies. Returns a stop function.
 *
 * For a child its parent cannot always stop: a parent killed with SIGKILL never gets to
 * signal it. When the parent dies, `process.ppid` changes to whichever process adopts the
 * orphan, which is how the death is detected.
 */
export function exitWithParent({ intervalMs = 1000 } = {}) {
  const parent = process.ppid;
  const timer = setInterval(() => {
    if (process.ppid !== parent) process.kill(0, 'SIGKILL');
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

// Runs under `node -e <code> <args...>`, where `process.argv` is `[node, ...args]`. The
// helper's fd 1 and 2 are the caller's (fd 3 here is the caller's stdout), and the pid goes
// to this launcher's own stdout pipe.
const LAUNCHER = `
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: ['ignore', 3, 2],
  });
  child.unref();
  process.stdout.write(String(child.pid));
`;

/**
 * Starts `node <args>` in a process that is not a descendant of this one, and returns its pid.
 *
 * A tool that stops a task signals every descendant of it, including detached children. A
 * launcher that spawns the helper and exits at once leaves the helper reparented out of the
 * tree before any stop, so it is not signaled. The helper keeps this process's stdout and
 * stderr.
 */
export function spawnOutsideTree(args, { env = process.env } = {}) {
  const out = execFileSync(process.execPath, ['-e', LAUNCHER, '--', ...args], {
    stdio: ['ignore', 'pipe', 'inherit', 1],
    env,
  });
  return Number(String(out).trim());
}
