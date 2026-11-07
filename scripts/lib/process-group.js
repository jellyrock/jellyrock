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
