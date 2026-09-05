// Unit tests for scripts/lib/process-liveness.cjs — the shared "is the process
// that wrote this record still running?" predicate.
//
// Thin, but it is the hinge two independent decisions turn on: whether
// `device:status` recommends a restore, and whether `rta:restore` performs one.
// The cases that matter are the NON-obvious answers — a pid that exists but is
// not ours (EPERM is alive), and every shape of "no pid recorded" (a snapshot
// written before the field, a truncated write) reading as DEAD, which is what
// keeps a genuinely stranded device recoverable.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isProcessAlive } = require('../../../../scripts/lib/process-liveness.cjs');

describe('isProcessAlive', () => {
  it('is true for this very process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('is true for pid 1, which exists and is not ours (the EPERM path)', () => {
    // Signal 0 against init throws EPERM rather than ESRCH for an unprivileged
    // user. Reading that as "dead" would be the dangerous direction: it would let
    // a restore proceed against a live run owned by someone else.
    expect(isProcessAlive(1)).toBe(true);
  });

  it('is false for a pid that cannot exist', () => {
    // Above any pid_max Linux will hand out, so this is ESRCH and not a race
    // against a real process.
    expect(isProcessAlive(2 ** 30)).toBe(false);
  });

  it('is false for every shape of "no pid recorded"', () => {
    // A snapshot written before `ownerPid` existed, or a truncated one. Dead is
    // the safe reading: it keeps the recovery command available for exactly the
    // files that genuinely are stranded.
    for (const pid of [undefined, null, 0, -1, NaN, '1234', 12.5, {}]) {
      expect(isProcessAlive(pid)).toBe(false);
    }
  });
});
