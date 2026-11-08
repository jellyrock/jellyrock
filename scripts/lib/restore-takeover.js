/**
 * The restore `rta-run.js` hands off: `scripts/rta-restore.js --takeover` runs this outside
 * the runner's process tree, so a stop that kills the runner cannot cut it short.
 *
 * Every process, device and clock call comes in through `deps`, so the decisions here
 * (whose snapshot to take, how long to wait for Vitest, who reports and who frees the
 * lock) are testable without a device.
 */

// Vitest's own SIGINT handling usually finishes well inside this. Past it, Vitest is
// killed: a restore must never run while a worker can still write the registry.
export const GROUP_EXIT_WAIT_MS = 15_000;
// SIGKILL cannot be caught, so this only covers the kernel tearing the group down.
export const GROUP_KILL_WAIT_MS = 3_000;
const POLL_MS = 100;

/**
 * Takes over the runner's snapshot, waits for Vitest's group to exit, restores the
 * registry and relaunches the channel. Resolves to the exit code.
 *
 * Whoever is still running reports the result: the runner when it is alive (it waits on
 * this helper and reads the snapshot), this helper when the runner is gone. The same
 * check decides who frees the device lock. A failed restore's detail is printed either
 * way, since only this process has it.
 *
 * @param {object} o
 * @param {number} o.owner The runner's pid, which must own the snapshot now.
 * @param {number} o.waitGroup Vitest's process group.
 * @param {boolean} o.releaseLock Whether the runner held the device lock.
 * @param {{ file: string, values: object }} o.snapshot
 * @param {object} o.deps `adopt(owner, file)`, `groupGone(pgid)`, `killGroup(pgid)`,
 *   `restore(values)`, `relaunch()`, `ownerAlive(pid)`, `release()`, `sleep(ms)`,
 *   `now()`, `log(line)`, `error(line)`.
 */
export async function runTakeover({ owner, waitGroup, releaseLock, snapshot, deps }) {
  try {
    deps.adopt(owner, snapshot.file);
  } catch (e) {
    deps.error(`[rta-restore] ${e.message}`);
    return 1;
  }

  const waitForGroup = async (ms) => {
    const end = deps.now() + ms;
    while (!deps.groupGone(waitGroup) && deps.now() < end) await deps.sleep(POLL_MS);
  };
  await waitForGroup(GROUP_EXIT_WAIT_MS);
  if (!deps.groupGone(waitGroup)) {
    deps.killGroup(waitGroup);
    await waitForGroup(GROUP_KILL_WAIT_MS);
  }

  let ok = false;
  try {
    await deps.restore(snapshot.values);
    ok = true;
  } catch (e) {
    deps.error(`[rta-restore] ${e.message}`);
  }
  await deps.relaunch().catch(() => {});

  const runnerGone = !deps.ownerAlive(owner);
  if (runnerGone) {
    if (ok) deps.log('[rta-restore] device registry restored: left as found.');
    else deps.error('[rta-restore] the restore failed. Recover: npm run rta:restore');
  }
  if (releaseLock && runnerGone) {
    try {
      await deps.release();
    } catch (e) {
      deps.error(`[rta-restore] could not release the device lock: ${e.message}`);
    }
  }
  return ok ? 0 : 1;
}
