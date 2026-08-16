/**
 * Hardware-free gate on the RTA registry restore's two pure functions, plus the
 * one property of its snapshot file that decides whether recovery works at all.
 *
 * These carry the whole correctness of "leave the device as you found it", and
 * the bug they replace was invisible precisely because it was only ever checked
 * by eye — the old 5-key restore reported `VERIFIED CLEAN` while leaving a demo
 * auth token and a whole registry section on the device. Every case below is a
 * shape that was actually observed on `.178` on 2026-08-10, not an invented one.
 *
 * `.test.js` (Vitest, `npm run test:scripts`, no device) — distinct from the
 * `.spec.js` files under `specs/`, which drive real hardware.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { planRestore, compareRegistries, snapshotDir, buildAcceptedRecord } from './registry.js';
import { runsLedgerPath } from '../../../scripts/run-record.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** A separate object graph with equal contents — these compare values, not identity. */
const clone = (o) => JSON.parse(JSON.stringify(o));

describe('planRestore', () => {
  it('deletes a whole section the run created', () => {
    // The demo user's section: seeded by seedHome, never in the snapshot, and
    // holding a live authToken. The old allow-list restore could not express this.
    const saved = { JellyRock: { server: 'http://home:8098' } };
    const live = {
      JellyRock: { server: 'http://home:8098' },
      demoUserId: { authToken: 'abc', username: 'demo' },
    };
    const { sectionsToDelete, writes } = planRestore(saved, live);
    expect(sectionsToDelete).toEqual(['demoUserId']);
    expect(writes).toEqual({});
  });

  it('nulls a key the run added to a section that already existed', () => {
    // seedLibraryLanding writes display.<libraryId>.landing into a user section.
    const saved = { user1: { authToken: 'abc' } };
    const live = { user1: { authToken: 'abc', 'display.lib1.landing': 'Shows' } };
    const { writes } = planRestore(saved, live);
    expect(writes).toEqual({ user1: { 'display.lib1.landing': null } });
  });

  it('restores a changed value and a key the run deleted', () => {
    const saved = { JellyRock: { server: 'http://home:8098', globalRememberMe: 'false' } };
    const live = { JellyRock: { server: 'https://demo.jellyfin.org/stable' } };
    const { writes } = planRestore(saved, live);
    expect(writes).toEqual({
      JellyRock: { server: 'http://home:8098', globalRememberMe: 'false' },
    });
  });

  it('recreates a section the run removed entirely', () => {
    const saved = { user1: { authToken: 'abc', username: 'testuser' } };
    const { sectionsToDelete, writes } = planRestore(saved, {});
    expect(sectionsToDelete).toEqual([]);
    expect(writes).toEqual({ user1: { authToken: 'abc', username: 'testuser' } });
  });

  it('writes nothing when the device already matches', () => {
    const state = { JellyRock: { server: 'http://home:8098' }, user1: { authToken: 'abc' } };
    const { sectionsToDelete, writes } = planRestore(state, clone(state));
    expect(sectionsToDelete).toEqual([]);
    expect(writes).toEqual({});
  });
});

// The bug that motivated this: `resolveUser()` validates the stored token over
// REST on every cold boot and re-logins on rejection, and the restore's verify IS
// a cold boot — so writing the snapshot's token back could never converge, and the
// kept snapshot then wedged every LATER run. Reproduced on `.177` before the fix.
describe('session credentials the app re-mints for itself', () => {
  const SNAP = { user1: { authToken: 'token-A', username: 'demo', serverId: 'srv' } };

  it('accepts a token the app re-minted for the same user', () => {
    // THE regression gate. Byte-comparing this is what made the restore
    // unconvergeable; presence is what the guarantee actually rests on.
    const live = { user1: { authToken: 'token-B', username: 'demo', serverId: 'srv' } };
    expect(compareRegistries(SNAP, live)).toEqual([]);
  });

  it('still fails when the session was DESTROYED', () => {
    // The direction that matters: a device signed out is precisely the damage
    // this module exists to prevent, so the exemption must not cover it.
    const live = { user1: { username: 'demo', serverId: 'srv' } };
    expect(compareRegistries(SNAP, live).map((d) => d.key)).toEqual(['authToken']);
  });

  it('treats an empty-string token as destroyed, not as present', () => {
    const live = { user1: { authToken: '', username: 'demo', serverId: 'srv' } };
    expect(compareRegistries(SNAP, live).map((d) => d.key)).toEqual(['authToken']);
  });

  it('still fails when a credential was LEFT BEHIND in a section that had none', () => {
    // The leak direction — a token we added to a real user's section. Reported by
    // the appeared-key pass, which presence-comparison deliberately does not soften.
    const saved = { user1: { username: 'demo' } };
    const live = { user1: { username: 'demo', authToken: 'leaked' } };
    expect(compareRegistries(saved, live).map((d) => d.key)).toEqual(['authToken']);
  });

  it('does not soften anything outside the two re-minted keys', () => {
    // `username` and `serverId` are re-written by the same login with STABLE
    // values, so they stay byte-asserted. Widening the exemption to the app's whole
    // `sessionKeys` list would buy nothing and cost the assertion.
    const live = { user1: { authToken: 'token-B', username: 'someone-else', serverId: 'srv' } };
    expect(compareRegistries(SNAP, live).map((d) => d.key)).toEqual(['username']);
  });

  it('still WRITES the user s own credential back, rather than keeping the run s', () => {
    // The exemption is on the COMPARE, never on the restore. An earlier cut of
    // this fix also skipped the write when the device already had a credential —
    // "the live one is the app's own and it works" — and the hardware repro
    // refuted it: with a deliberately-invalid token planted, the restore left that
    // token in place and reported converged. "As we found it" means the USER's
    // value. If it has expired the app re-logins on next boot, as it would anyway.
    const live = { user1: { authToken: 'token-B', username: 'demo', serverId: 'srv' } };
    expect(planRestore(SNAP, live).writes).toEqual({ user1: { authToken: 'token-A' } });
  });

  it('restores a credential the device lost entirely', () => {
    const live = { user1: { username: 'demo', serverId: 'srv' } };
    expect(planRestore(SNAP, live).writes).toEqual({ user1: { authToken: 'token-A' } });
  });

  it('exempts primaryImageTag on the same terms as the token', () => {
    // The second member of the set, and the one added on a code-path argument
    // rather than an observed failure — it rides the same `if saveCredentials`
    // block in `session.bs` (both branches), written from the same login response.
    // That reasoning is exactly what a test has to pin, because nothing else will
    // catch it if the set and the app's write block ever drift apart.
    const saved = { user1: { primaryImageTag: 'tag-A', username: 'demo' } };
    expect(
      compareRegistries(saved, { user1: { primaryImageTag: 'tag-B', username: 'demo' } }),
    ).toEqual([]);
    // ...and only on the same terms: losing it is still a difference.
    expect(compareRegistries(saved, { user1: { username: 'demo' } }).map((d) => d.key)).toEqual([
      'primaryImageTag',
    ]);
  });
});

// `--accept` clears the snapshot, so this record is the ONLY durable trace that a
// device was left not-as-found. What it must not become is a second copy of the
// secret the snapshot already is.
describe('the accepted-difference record', () => {
  const record = (diffs, previous = null) =>
    buildAcceptedRecord({
      host: '192.168.1.177',
      acceptedAt: '2026-08-11T20:00:00Z',
      label: 'restoreRegistry',
      diffs,
      previous,
    });
  const onlyEvent = (r) => {
    expect(r.events).toHaveLength(1);
    return r.events[0];
  };

  it('redacts secret values, so the record is safe to read and paste', () => {
    const [diff] = onlyEvent(
      record([{ section: 'u1', key: 'authToken', want: 'a'.repeat(32), got: 'b'.repeat(32) }]),
    ).differences;
    expect(diff).toEqual({
      section: 'u1',
      key: 'authToken',
      want: '<32 chars>',
      got: '<32 chars>',
    });
    expect(JSON.stringify(diff)).not.toContain('aaaa');
  });

  it('keeps non-secret values legible — the point is knowing WHAT was left wrong', () => {
    const [diff] = onlyEvent(
      record([{ section: 'u1', key: 'username', want: 'testuser', got: 'demo' }]),
    ).differences;
    expect(diff.want).toBe('testuser');
    expect(diff.got).toBe('demo');
  });

  it('says which device, when, and how many — what device:status reports from', () => {
    const r = record([
      { section: 'u1', key: 'authToken', want: 'x', got: null },
      { section: 'u1', key: 'username', want: 'testuser', got: null },
    ]);
    expect(r.host).toBe('192.168.1.177');
    const event = onlyEvent(r);
    expect(event.acceptedAt).toBe('2026-08-11T20:00:00Z');
    expect(event.differences).toHaveLength(2);
    // An absent value has to read as absent, not as an empty string — "the key is
    // gone" and "the key is blank" are different damage.
    expect(event.differences[0].got).toBe('<absent>');
  });

  it('APPENDS to an existing record instead of overwriting it', () => {
    // Nothing repairs an accepted difference — the original value is gone — so an
    // earlier accept is still live damage when a later one lands. Overwriting would
    // drop it silently while leaving the device exactly as wrong, which is the same
    // shape of loss this record exists to prevent.
    const first = record([{ section: 'u1', key: 'authToken', want: 'x', got: 'y' }]);
    const second = record([{ section: 'u2', key: 'username', want: 'a', got: 'b' }], first);
    expect(second.events).toHaveLength(2);
    expect(second.events[0].differences[0].key).toBe('authToken');
    expect(second.events[1].differences[0].key).toBe('username');
  });

  it('starts a fresh history rather than throwing on an unusable prior record', () => {
    // A partial history beats no record at all — the write must not be what fails.
    const diffs = [{ section: 'u1', key: 'k', want: 'x', got: 'y' }];
    expect(record(diffs, {}).events).toHaveLength(1);
    expect(record(diffs, null).events).toHaveLength(1);
  });
});

describe('compareRegistries', () => {
  it('is empty for an exact match', () => {
    const state = { JellyRock: { server: 'http://home:8098' } };
    expect(compareRegistries(state, clone(state))).toEqual([]);
  });

  it('catches a leftover section — the failure the old restore reported as clean', () => {
    const saved = { JellyRock: { server: 'http://home:8098' } };
    const live = { ...saved, demoUserId: { authToken: 'abc' } };
    expect(compareRegistries(saved, live)).toEqual([
      { section: 'demoUserId', key: 'authToken', want: null, got: 'abc' },
    ]);
  });

  it('catches a value that did not come back', () => {
    const saved = { JellyRock: { server: 'http://home:8098' } };
    const live = { JellyRock: { server: 'https://demo.jellyfin.org/stable' } };
    expect(compareRegistries(saved, live)).toEqual([
      {
        section: 'JellyRock',
        key: 'server',
        want: 'http://home:8098',
        got: 'https://demo.jellyfin.org/stable',
      },
    ]);
  });

  it('catches a key that vanished', () => {
    const saved = { user1: { authToken: 'abc', username: 'testuser' } };
    const live = { user1: { authToken: 'abc' } };
    expect(compareRegistries(saved, live)).toEqual([
      { section: 'user1', key: 'username', want: 'testuser', got: null },
    ]);
  });

  it('ignores LastRunVersion, which the app rewrites on boot by design', () => {
    // Case-insensitively, and in user sections as well as the global one:
    // migrations.bs back-fills it into any user section that lacks it.
    const saved = { JellyRock: { LastRunVersion: '2.24.2' }, user1: { authToken: 'abc' } };
    const live = { JellyRock: { LastRunVersion: '2.25.0' }, user1: { authToken: 'abc' } };
    expect(compareRegistries(saved, live)).toEqual([]);
  });

  it('does NOT ignore anything else the app writes', () => {
    // available_users is app-written too, but it is user state — a demo entry
    // appended during a run is a leak, not bookkeeping, so it must be caught.
    const saved = { JellyRock: { available_users: '[{"username":"testuser"}]' } };
    const live = {
      JellyRock: { available_users: '[{"username":"testuser"},{"username":"demo"}]' },
    };
    expect(compareRegistries(saved, live)).toHaveLength(1);
  });
});

describe('the snapshot survives a build', () => {
  // THE regression gate for a bug that disabled recovery on the likeliest path to
  // need it. The snapshot lived in `out/rta/`, every `build*` script opens with
  // `npx rimraf build/ out/`, and `npm run test:rta` is `npm run build && node
  // scripts/rta-run.js`. So: abandon a run (device left dirty, snapshot
  // deliberately KEPT) → re-run `npm run test:rta` → the build deleted the
  // snapshot before `snapshotRegistry()` could restore from it → the run captured
  // the demo-server state as the user's session and restored THAT forever after.
  //
  // Asserted as a property rather than a path string, so moving the file again is
  // fine and moving it back under `out/` is not.
  const wipesOut = (body) => /rimraf[^&|]*\bout\//.test(body);
  const pkg = () => JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  it('does not live under out/, which every build script deletes', () => {
    expect(snapshotDir().startsWith('out')).toBe(false);
  });

  it('pins the reason: build scripts really do rimraf out/', () => {
    // Read from package.json rather than restated in prose, so the day a build
    // stops wiping `out/` this says so instead of silently over-protecting.
    const builds = Object.entries(pkg().scripts).filter(([name]) => name.startsWith('build'));
    expect(builds.length).toBeGreaterThan(0);
    expect(builds.filter(([, body]) => wipesOut(body)).map(([name]) => name)).toContain('build');
  });

  it('pins the other half: the RTA entry point builds before it runs', () => {
    // Both halves are needed for the bug — a wiping build is harmless unless a
    // device entry point runs one first. If `test:rta` ever stops building, this
    // fails and the gate above can be reconsidered rather than cargo-culted.
    expect(pkg().scripts['test:rta']).toMatch(/npm run build\b/);
  });

  it('agrees with the run ledger about where survive-a-build state lives', () => {
    // The root is spelled out in THREE modules — `registry.js` (this snapshot),
    // `run-record.js` (the ledger) and `device-lock.js` (`device:status`'s stranded
    // report) — because the import graph forbids a shared constant: run-record
    // imports device-lock, so device-lock cannot import back, and importing this
    // module there would drag the whole roku-test-automation client into one that
    // only knows about locks.
    //
    // The drift that costs something is SILENT: `device:status` reads the directory
    // with a `readdirSync` whose catch returns early, so if the root moved and it
    // was missed there, the stranded-snapshot warning would simply stop appearing —
    // going quiet at exactly the moment it should speak. This pins the two that CAN
    // see each other, which is the cheaper half of closing that.
    expect(runsLedgerPath().startsWith(`${snapshotDir()}${path.sep}`)).toBe(true);
  });
});
