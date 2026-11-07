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
