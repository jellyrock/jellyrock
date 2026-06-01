// Tests for the proactive PR-time floor-coverage lint
// (scripts/lint/floor-coverage-check.js, Phase 6 of server-upgrade-automation).
//
// The lint reuses findings-candidates.js's floor functions (backward + symmetry +
// applySuppressions + applyFloorAvailability) against the COMMITTED manifest + floor
// fingerprint, and fails on any unregistered coverage-gap our own code introduced
// (symmetry advisories warn but don't block). Driven offline via spawnScript against
// a tiny synthetic --root repo (manifest + floor fingerprint + boundaries + ledger +
// suppressions). No network, no hardware. Fixture shape cribs from
// server-upgrade-tracker.test.js (BOUNDARIES_YML, fp()) and endpoint-availability.test.js.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from './_helpers/spawn-script.js';

const LINT = 'scripts/lint/floor-coverage-check.js';

const BOUNDARIES_YML =
  'floor: "10.7.0"\ntiers:\n  1:\n    minServer: "10.7.0"\n    maxServer: "10.8.13"\n    status: frozen\n  2:\n    minServer: "10.9.0"\n    maxServer: null\n    status: active\n';

function fp(specVersion, operations = {}) {
  return { schemaVersion: 1, specVersion, operations, schemas: {} };
}

// A floor fingerprint that serves /Users/{}/Items (a V1 sibling present on the floor)
// but NOT /MediaSegments/{} or /Items. So:
//   - a minApiVersion:1 manifest endpoint at /mediasegments/{} → coverage-gap (absent).
//   - a minApiVersion:2 manifest endpoint at /items whose op IS on the floor → symmetry.
const FLOOR_OPS = {
  'GET /Users/{userId}/Items': { parameters: [] },
  'GET /Items': { parameters: [] },
};

const EP = {
  mediaSegments: {
    path: '/MediaSegments/{0}',
    normalized: '/mediasegments/{}',
    methods: ['GET'],
    minApiVersion: 1,
    maxApiVersion: null,
    sourceFiles: ['source/api/items.bs'],
  },
  items: {
    path: '/Items',
    normalized: '/items',
    methods: ['GET'],
    minApiVersion: 2,
    maxApiVersion: null,
    sourceFiles: ['source/api/ApiClient.bs'],
  },
  // A floor-included endpoint the floor spec DOES serve → never a gap (clean baseline).
  usersItems: {
    path: '/Users/{0}/Items',
    normalized: '/users/{}/items',
    methods: ['GET'],
    minApiVersion: 1,
    maxApiVersion: null,
    sourceFiles: ['source/api/ApiClient.bs'],
  },
};

let dir;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

// Build a minimal repo. `endpoints` is the manifest endpoint list; the ledger and
// suppressions default to empty (the floor check then flags every post-floor endpoint).
function scaffold({
  endpoints,
  availability = 'endpoints: []\n',
  suppressions = 'rules: []\n',
  floorOps = FLOOR_OPS,
  writeFloorFp = true,
}) {
  dir = mkdtempSync(join(tmpdir(), 'jellyrock-floor-'));
  const write = (rel, obj) => {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, typeof obj === 'string' ? obj : JSON.stringify(obj));
  };
  write('docs/dev/jellyfin-version-boundaries.yml', BOUNDARIES_YML);
  if (writeFloorFp) {
    write('docs/architecture/spec-fingerprints/jellyfin-10.7.0.json', fp('10.7.0', floorOps));
  }
  write('docs/architecture/api-usage-manifest.json', {
    endpoints,
    requestFields: [],
    responseFields: [],
  });
  write('docs/dev/jellyfin-endpoint-availability.yml', availability);
  write('.api-watch/suppressions.yml', suppressions);
}

describe('floor-coverage-check.js (lint, offline)', () => {
  it('passes when every floor-included endpoint is present on the floor spec', () => {
    scaffold({ endpoints: [EP.usersItems] });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/no unregistered floor gap/);
  });

  it('FAILS on an unregistered coverage-gap (post-floor endpoint absent from floor)', () => {
    scaffold({ endpoints: [EP.usersItems, EP.mediaSegments] });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr + res.stdout).toMatch(/unregistered floor gap/);
    expect(res.stderr + res.stdout).toMatch(/mediasegments/i);
  });

  it('passes when the coverage-gap endpoint is registered in the ledger (version-guard)', () => {
    scaffold({
      endpoints: [EP.usersItems, EP.mediaSegments],
      availability:
        'endpoints:\n  - path: /mediasegments/{}\n    method: GET\n    handling: { type: graceful-degradation }\n',
    });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(0);
  });

  it('passes (exit 0) but WARNS on an unregistered symmetry advisory — not a failure', () => {
    // EP.items is modern-only (minApiVersion 2) but its GET /items IS on the floor spec
    // → symmetry-advisory. usersItems keeps the floor baseline clean of gaps.
    scaffold({ endpoints: [EP.usersItems, EP.items] });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toMatch(/symmetry advisory/i);
    expect(res.stderr).toMatch(/NOT (a )?failures/i);
  });

  it('a coverage-gap drives exit 1 even alongside a symmetry advisory', () => {
    scaffold({ endpoints: [EP.usersItems, EP.mediaSegments, EP.items] });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(1);
    // Both surface: the gap as a failure, the symmetry as a warning.
    expect(res.stderr).toMatch(/unregistered floor gap/);
    expect(res.stderr).toMatch(/symmetry advisory/i);
  });

  it('a suppression rule clears a coverage-gap (mirrors the digest actionable set)', () => {
    scaffold({
      endpoints: [EP.usersItems, EP.mediaSegments],
      suppressions:
        'rules:\n  - id: floor-mediasegments\n    match:\n      kind: coverage-gap\n      path: "/mediasegments/"\n',
    });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(0);
  });

  it('--json emits coverageGapFailures + symmetryWarnings and still exits 1 on a gap', () => {
    scaffold({ endpoints: [EP.usersItems, EP.mediaSegments, EP.items] });
    const res = spawnScript(LINT, ['--root', dir, '--json']);
    expect(res.exitCode).toBe(1);
    const out = JSON.parse(res.stdout);
    expect(out.floor).toBe('10.7.0');
    expect(out.coverageGapFailures).toHaveLength(1);
    expect(out.coverageGapFailures[0].path).toBe('/mediasegments/{}');
    expect(out.coverageGapFailures[0].sites).toContain('source/api/items.bs');
    expect(out.symmetryWarnings).toHaveLength(1);
    expect(out.symmetryWarnings[0].path).toBe('/items');
  });

  it('exits 2 (internal error, not a floor gap) when the floor fingerprint is missing', () => {
    scaffold({ endpoints: [EP.usersItems], writeFloorFp: false });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/no committed fingerprint for 10\.7\.0/);
  });
});
