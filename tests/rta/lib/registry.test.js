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
import { planRestore, compareRegistries, snapshotDir } from './registry.js';
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
    const saved = { user1: { authToken: 'abc', username: 'charlie' } };
    const { sectionsToDelete, writes } = planRestore(saved, {});
    expect(sectionsToDelete).toEqual([]);
    expect(writes).toEqual({ user1: { authToken: 'abc', username: 'charlie' } });
  });

  it('writes nothing when the device already matches', () => {
    const state = { JellyRock: { server: 'http://home:8098' }, user1: { authToken: 'abc' } };
    const { sectionsToDelete, writes } = planRestore(state, clone(state));
    expect(sectionsToDelete).toEqual([]);
    expect(writes).toEqual({});
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
    const saved = { user1: { authToken: 'abc', username: 'charlie' } };
    const live = { user1: { authToken: 'abc' } };
    expect(compareRegistries(saved, live)).toEqual([
      { section: 'user1', key: 'username', want: 'charlie', got: null },
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
    const saved = { JellyRock: { available_users: '[{"username":"charlie"}]' } };
    const live = { JellyRock: { available_users: '[{"username":"charlie"},{"username":"demo"}]' } };
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
