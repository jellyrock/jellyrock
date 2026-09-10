// scripts/lib/process-liveness.cjs — "is the process that wrote this record still
// running?", shared by the two readers of a registry snapshot's `ownerPid`.
//
// It lives here, in its own dependency-free module, because those two readers sit
// on opposite sides of a deliberate boundary and MUST NOT disagree:
// `scripts/device-lock.js` decides whether to tell you to restore, and
// `scripts/rta-restore.js` decides whether to actually do it. A copy in each would
// be two chances to answer the same question differently, and the disagreement
// would land exactly on the case this predicate exists for — a live run.
// device-lock.js cannot import `tests/rta/lib/registry.js` to share it (that would
// drag the whole roku-test-automation client into a module that only knows about
// locks), so neither reader owns it and a third home is the only one both can use.
//
// `.cjs` per `scripts/CLAUDE.md`: everything in `scripts/lib/` is required by CJS
// callers, and ESM imports it back without ceremony.

/**
 * True when `pid` names a process that exists right now.
 *
 * Signal 0 performs the permission and existence checks WITHOUT sending anything
 * (POSIX kill(2)), so this never disturbs the process it asks about.
 *
 * `EPERM` counts as ALIVE: the process exists, it just belongs to another user.
 * `ESRCH` — no such process — is the only real "dead", and anything unparseable
 * (a record written before `ownerPid` existed, a truncated write) is dead too.
 *
 * A pid can be RECYCLED, so a true answer is "a process with that id exists",
 * not "that exact run". Both callers are built to fail safe on that: the status
 * report withholds a recovery command it would otherwise print, and the restore
 * refuses behind an override. Neither destroys anything on a wrong answer, and
 * the window is small — a snapshot outlives its writer only when that writer was
 * killed, which is also when the operator is right there looking.
 */
function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

module.exports = { isProcessAlive };
