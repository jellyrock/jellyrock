// Tests for scripts/generate/findings-candidates.js (Phase 2: join + classify).
//
// The pure builders are exercised with tiny hand-written manifests + fingerprints
// covering every classification path: case-insensitive field join, tier-relevance
// (active-tier vs frozen-skip), the backward floor-coverage check (incl. the
// modern-only-not-flagged case), opportunities, and .api-watch suppression. A
// final block runs the CLI --stdout path against committed fixtures via
// spawnScript. Mirrors spec-diff.test.js.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';
import {
  normalizeSpecPath,
  buildFieldIndex,
  forwardFindings,
  backwardFindings,
  symmetryFindings,
  matchSuppression,
  applySuppressions,
  buildReport,
  serializeReport,
  readManifestFrom,
  resolveFingerprint,
} from '../../../../scripts/generate/findings-candidates.js';

const SCRIPT = 'scripts/generate/findings-candidates.js';

// Two-tier boundary map matching the real one (tier 1 frozen, tier 2 active).
const BOUNDARIES = {
  floor: '10.7.0',
  tiers: {
    1: { minServer: '10.7.0', maxServer: '10.8.13', status: 'frozen' },
    2: { minServer: '10.9.0', maxServer: null, status: 'active' },
  },
};

function fp(specVersion, { operations = {}, schemas = {} } = {}) {
  return { schemaVersion: 1, specVersion, operations, schemas };
}

function endpoint(over = {}) {
  return {
    path: '/Items/{0}',
    normalized: '/items/{}',
    methods: ['GET'],
    minApiVersion: 2,
    maxApiVersion: null,
    sourceFiles: ['source/api/ApiClient.bs'],
    ...over,
  };
}

function manifest({ endpoints = [], requestFields = [], responseFields = [] } = {}) {
  return { endpoints, requestFields, responseFields };
}

// A forward diff is computed inside buildReport/forwardFindings from the two
// fingerprints, so these helpers build fingerprints whose diff yields the change
// under test. For unit-testing forwardFindings directly we hand it a diff.
function diff(changes, { fromVersion = '10.11.8', toVersion = '10.11.10' } = {}) {
  return { fromVersion, toVersion, counts: { total: changes.length }, changes };
}

describe('normalizeSpecPath', () => {
  it('mirrors the manifest: collapses {x}, folds case, strips trailing slash', () => {
    expect(normalizeSpecPath('/Items/{itemId}')).toBe('/items/{}');
    expect(normalizeSpecPath('/Users/{userId}/Items/')).toBe('/users/{}/items');
    expect(normalizeSpecPath('items')).toBe('/items');
  });

  it('is idempotent on an already-normalized path', () => {
    expect(normalizeSpecPath('/items/{}')).toBe('/items/{}');
  });
});

describe('buildFieldIndex — case-insensitive join (the carry-forward lesson)', () => {
  it('keys PascalCase manifest names by lowercase and unions sources', () => {
    const idx = buildFieldIndex(
      manifest({
        requestFields: [{ name: 'Recursive', sourceFiles: ['source/api/items.bs'] }],
        responseFields: [{ name: 'RunTimeTicks', sourceFiles: ['source/data/X.bs'] }],
      }),
    );
    // spec camelCase joins to app PascalCase
    expect(idx.get('recursive').name).toBe('Recursive');
    expect(idx.get('runtimeticks')).toBeTruthy();
  });
});

describe('forwardFindings — endpoint changes + tier relevance', () => {
  it('flags a used active-tier endpoint removal as breaking, needsInvestigation', () => {
    const m = manifest({ endpoints: [endpoint({ minApiVersion: 2, maxApiVersion: null })] });
    const d = diff([
      { kind: 'endpoint-removed', path: '/Items/{itemId}', method: 'GET', detail: 'gone' },
    ]);
    const { candidates } = forwardFindings(d, m, BOUNDARIES);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      type: 'breaking',
      relevance: 'active-tier',
      needsInvestigation: true,
    });
    expect(candidates[0].appUsage).toMatchObject({ used: true, apiVersionRange: [2, null] });
  });

  it('marks a frozen-only endpoint frozen-skip (self-excludes, no allowlist)', () => {
    const m = manifest({
      endpoints: [
        endpoint({
          path: '/Users/{0}/Items',
          normalized: '/users/{}/items',
          minApiVersion: 1,
          maxApiVersion: 1,
        }),
      ],
    });
    const d = diff([
      { kind: 'endpoint-removed', path: '/Users/{userId}/Items', method: 'GET', detail: 'gone' },
    ]);
    const { candidates } = forwardFindings(d, m, BOUNDARIES);
    expect(candidates[0].relevance).toBe('frozen-skip');
    expect(candidates[0].needsInvestigation).toBe(false);
  });

  it('drops a change on an endpoint the app does not use', () => {
    const m = manifest({ endpoints: [endpoint()] });
    const d = diff([
      { kind: 'endpoint-removed', path: '/Unused/Path', method: 'GET', detail: 'gone' },
    ]);
    const { candidates, dropped } = forwardFindings(d, m, BOUNDARIES);
    expect(candidates).toHaveLength(0);
    expect(dropped.unused).toBe(1);
  });

  it('resolves an UNKNOWN-method endpoint when the verb could not be statically resolved', () => {
    const m = manifest({
      endpoints: [endpoint({ normalized: '/audio/{}/stream', methods: ['UNKNOWN'] })],
    });
    const d = diff([
      {
        kind: 'param-removed',
        path: '/Audio/{itemId}/stream',
        method: 'GET',
        name: 'x',
        detail: '',
      },
    ]);
    const { candidates } = forwardFindings(d, m, BOUNDARIES);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].type).toBe('breaking');
  });

  it('emits endpoint-added as an opportunity only when unused; drops additive param/field-added', () => {
    const m = manifest({ endpoints: [endpoint()] });
    const d = diff([
      { kind: 'endpoint-added', path: '/Brand/New', method: 'GET', detail: 'added' },
      { kind: 'param-added', path: '/Items/{itemId}', method: 'GET', name: 'fresh', detail: '' },
    ]);
    const { candidates, dropped } = forwardFindings(d, m, BOUNDARIES);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ type: 'opportunity', appUsage: { used: false } });
    expect(dropped.additive).toBe(1);
  });

  it('does not emit an opportunity for an added endpoint the app already uses', () => {
    const m = manifest({ endpoints: [endpoint()] });
    const d = diff([
      { kind: 'endpoint-added', path: '/Items/{itemId}', method: 'GET', detail: 'added' },
    ]);
    const { candidates, dropped } = forwardFindings(d, m, BOUNDARIES);
    expect(candidates).toHaveLength(0);
    expect(dropped.unused).toBe(1);
  });
});

describe('forwardFindings — schema/field changes', () => {
  it('joins a field-retyped to a used response field, case-insensitively', () => {
    const m = manifest({
      responseFields: [{ name: 'RunTimeTicks', sourceFiles: ['source/data/X.bs'] }],
    });
    const d = diff([
      {
        kind: 'field-retyped',
        schema: 'BaseItemDto',
        name: 'runTimeTicks',
        detail: 'int64 → int32',
      },
    ]);
    const { candidates } = forwardFindings(d, m, BOUNDARIES);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      type: 'breaking',
      relevance: 'active-tier',
      appUsage: { used: true, apiVersionRange: null, sites: ['source/data/X.bs'] },
    });
  });

  it('drops a field-added (the app cannot already read a brand-new field)', () => {
    const m = manifest({ responseFields: [{ name: 'Existing', sourceFiles: ['a.bs'] }] });
    const d = diff([{ kind: 'field-added', schema: 'BaseItemDto', name: 'BrandNew', detail: '' }]);
    const { candidates, dropped } = forwardFindings(d, m, BOUNDARIES);
    expect(candidates).toHaveLength(0);
    expect(dropped.additive).toBe(1);
  });

  it('joins enum-changed by the enum schema name against a consumed field', () => {
    const m = manifest({
      responseFields: [{ name: 'MediaType', sourceFiles: ['source/data/X.bs'] }],
    });
    const d = diff([
      {
        kind: 'enum-changed',
        schema: 'MediaType',
        added: ['Book'],
        removed: [],
        detail: '+[Book]',
      },
    ]);
    const { candidates } = forwardFindings(d, m, BOUNDARIES);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].change.kind).toBe('enum-changed');
  });

  it('drops an enum change on a type the app does not consume by name', () => {
    const m = manifest({ responseFields: [{ name: 'Type', sourceFiles: ['x.bs'] }] });
    const d = diff([{ kind: 'enum-changed', schema: 'BaseItemKind', added: ['X'], removed: [] }]);
    const { candidates, dropped } = forwardFindings(d, m, BOUNDARIES);
    expect(candidates).toHaveLength(0);
    expect(dropped.unused).toBe(1);
  });
});

describe('backwardFindings — floor-coverage check', () => {
  const floorFp = fp('10.7.0', {
    operations: {
      'GET /Users/{userId}/Items': { parameters: [] },
    },
  });

  it('flags a floor-tier endpoint absent from the floor spec as a coverage-gap', () => {
    const m = manifest({
      endpoints: [
        endpoint({
          path: '/UserViews',
          normalized: '/userviews',
          methods: ['GET'],
          minApiVersion: 1,
          maxApiVersion: null,
        }),
      ],
    });
    const candidates = backwardFindings(m, floorFp, BOUNDARIES);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ type: 'coverage-gap', relevance: 'floor-coverage' });
    expect(candidates[0].change.detail).toContain('absent from floor spec 10.7.0');
  });

  it('does NOT flag a modern-only endpoint (range excludes the floor tier)', () => {
    const m = manifest({
      endpoints: [
        endpoint({
          path: '/UserViews',
          normalized: '/userviews',
          minApiVersion: 2,
          maxApiVersion: null,
        }),
      ],
    });
    expect(backwardFindings(m, floorFp, BOUNDARIES)).toHaveLength(0);
  });

  it('does NOT flag an endpoint present on the floor', () => {
    const m = manifest({
      endpoints: [
        endpoint({
          path: '/Users/{0}/Items',
          normalized: '/users/{}/items',
          methods: ['GET'],
          minApiVersion: 1,
          maxApiVersion: 1,
        }),
      ],
    });
    expect(backwardFindings(m, floorFp, BOUNDARIES)).toHaveLength(0);
  });

  it('treats UNKNOWN-method endpoints as covered when the path exists on the floor', () => {
    const m = manifest({
      endpoints: [
        endpoint({
          path: '/Users/{0}/Items',
          normalized: '/users/{}/items',
          methods: ['UNKNOWN'],
          minApiVersion: 1,
          maxApiVersion: 1,
        }),
      ],
    });
    expect(backwardFindings(m, floorFp, BOUNDARIES)).toHaveLength(0);
  });
});

describe('symmetryFindings — coverage-symmetry advisory (the mirror of the backward check)', () => {
  // Floor spec serves GET /Items (the real 10.7.0 case the app gates to V2+).
  const floorFp = fp('10.7.0', {
    operations: { 'GET /Items': { parameters: [] } },
  });

  it('flags a modern-only endpoint whose op IS present on the floor spec', () => {
    const m = manifest({
      endpoints: [
        endpoint({ path: '/items/', normalized: '/items', methods: ['GET'], minApiVersion: 2 }),
      ],
    });
    const candidates = symmetryFindings(m, floorFp, BOUNDARIES);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      type: 'symmetry-advisory',
      relevance: 'floor-symmetry',
      severityGuess: 'low',
      needsInvestigation: true,
      change: { kind: 'coverage-symmetry', path: '/items', method: 'GET', toVersion: null },
      appUsage: { used: true, apiVersionRange: [2, null] },
    });
    expect(candidates[0].change.detail).toContain('present on floor spec 10.7.0');
    expect(candidates[0].change.detail).toContain('wired tier ≥2 only');
  });

  it('does NOT flag a genuinely modern-only endpoint ABSENT from the floor spec', () => {
    const m = manifest({
      endpoints: [
        endpoint({
          path: '/UserViews',
          normalized: '/userviews',
          methods: ['GET'],
          minApiVersion: 2,
        }),
      ],
    });
    expect(symmetryFindings(m, floorFp, BOUNDARIES)).toHaveLength(0);
  });

  it('does NOT flag a floor-included endpoint (min==1) — that is the backward check’s territory', () => {
    const m = manifest({
      endpoints: [
        endpoint({ path: '/items/', normalized: '/items', methods: ['GET'], minApiVersion: 1 }),
      ],
    });
    expect(symmetryFindings(m, floorFp, BOUNDARIES)).toHaveLength(0);
  });

  it('flags a modern-only endpoint when only a specific method is present on the floor', () => {
    // Floor serves GET /Items but not POST /Items; only the GET surfaces.
    const m = manifest({
      endpoints: [
        endpoint({
          path: '/items/',
          normalized: '/items',
          methods: ['GET', 'POST'],
          minApiVersion: 2,
        }),
      ],
    });
    const candidates = symmetryFindings(m, floorFp, BOUNDARIES);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].change.method).toBe('GET');
  });

  it('treats an UNKNOWN-method modern-only endpoint as present when the path exists on the floor', () => {
    const floorWithPath = fp('10.7.0', { operations: { 'POST /UserImage': { parameters: [] } } });
    const m = manifest({
      endpoints: [
        endpoint({
          path: '/UserImage',
          normalized: '/userimage',
          methods: ['UNKNOWN'],
          minApiVersion: 2,
        }),
      ],
    });
    const candidates = symmetryFindings(m, floorWithPath, BOUNDARIES);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].change.method).toBe('UNKNOWN');
  });

  it('partition: a modern-only floor-present endpoint is a symmetry-advisory and NOT a coverage-gap', () => {
    const m = manifest({
      endpoints: [
        endpoint({ path: '/items/', normalized: '/items', methods: ['GET'], minApiVersion: 2 }),
      ],
    });
    expect(symmetryFindings(m, floorFp, BOUNDARIES)).toHaveLength(1);
    expect(backwardFindings(m, floorFp, BOUNDARIES)).toHaveLength(0);
  });
});

describe('suppression', () => {
  const breakingCandidate = {
    type: 'breaking',
    change: { kind: 'field-retyped', schema: 'BaseItemDto', name: 'runTimeTicks', detail: '' },
    needsInvestigation: true,
    suppressed: false,
  };

  it('matches on kind + schema, and folds case on name', () => {
    expect(
      matchSuppression(breakingCandidate, {
        id: 'r',
        match: { kind: 'field-retyped', schema: '^BaseItemDto$', name: '^RUNTIMETICKS$' },
      }),
    ).toBe(true);
  });

  it('does not match when a predicate references a field the change lacks', () => {
    // `path` predicate against a schema-scoped change → no match.
    expect(matchSuppression(breakingCandidate, { id: 'r', match: { path: '/items/{}' } })).toBe(
      false,
    );
  });

  it('matches a kind list and applies suppressed + needsInvestigation:false', () => {
    const candidates = [{ ...breakingCandidate }];
    applySuppressions(candidates, [
      { id: 'cosmetic-retypes', match: { kind: ['field-retyped', 'enum-changed'] } },
    ]);
    expect(candidates[0]).toMatchObject({
      suppressed: true,
      suppressedBy: 'cosmetic-retypes',
      needsInvestigation: false,
    });
  });

  it('first-match wins', () => {
    const candidates = [{ ...breakingCandidate }];
    applySuppressions(candidates, [
      { id: 'first', match: { kind: 'field-retyped' } },
      { id: 'second', match: { kind: 'field-retyped' } },
    ]);
    expect(candidates[0].suppressedBy).toBe('first');
  });
});

describe('buildReport — integration over fingerprints', () => {
  const m = manifest({
    endpoints: [
      // floor-relevant (minApiVersion 1) and absent from the floor fixture below
      // → both a forward breaking candidate and a backward coverage-gap.
      endpoint({
        path: '/Items/{0}',
        normalized: '/items/{}',
        minApiVersion: 1,
        maxApiVersion: null,
      }),
      // present on the floor → no coverage-gap.
      endpoint({
        path: '/Users/{0}/Items',
        normalized: '/users/{}/items',
        minApiVersion: 1,
        maxApiVersion: 1,
      }),
    ],
    responseFields: [{ name: 'RunTimeTicks', sourceFiles: ['source/data/X.bs'] }],
  });
  const floorFp = fp('10.7.0', {
    operations: { 'GET /Users/{userId}/Items': { parameters: [] } },
  });

  it('produces a deterministic report with forward + backward candidates and counts', () => {
    const fromFp = fp('10.11.8', {
      operations: { 'GET /Items/{itemId}': { parameters: [] } },
      schemas: { BaseItemDto: { properties: { runTimeTicks: 'integer:int64' } } },
    });
    const toFp = fp('10.11.10', {
      operations: {},
      schemas: { BaseItemDto: { properties: { runTimeTicks: 'integer:int32' } } },
    });

    const report = buildReport({ fromFp, toFp, floorFp, manifest: m, boundaries: BOUNDARIES });

    // forward: /Items/{} GET removed (active-tier breaking) + RunTimeTicks retyped (breaking)
    // backward: /items/{} GET absent from floor (coverage-gap)
    expect(report.counts.breaking).toBe(2);
    expect(report.counts['coverage-gap']).toBeGreaterThanOrEqual(1);
    expect(report).toMatchObject({
      fromVersion: '10.11.8',
      toVersion: '10.11.10',
      floorVersion: '10.7.0',
    });

    // determinism
    expect(serializeReport(report)).toBe(
      serializeReport(buildReport({ fromFp, toFp, floorFp, manifest: m, boundaries: BOUNDARIES })),
    );
  });

  it('surfaces a symmetry-advisory in counts when a modern-only endpoint is present on the floor', () => {
    const symMatch = manifest({
      endpoints: [
        endpoint({ path: '/items/', normalized: '/items', methods: ['GET'], minApiVersion: 2 }),
      ],
    });
    const symFloor = fp('10.7.0', { operations: { 'GET /Items': { parameters: [] } } });
    const fromFp = fp('10.11.8', { operations: {} });
    const toFp = fp('10.11.10', { operations: {} });
    const report = buildReport({
      fromFp,
      toFp,
      floorFp: symFloor,
      manifest: symMatch,
      boundaries: BOUNDARIES,
    });
    expect(report.counts['symmetry-advisory']).toBe(1);
    expect(report.counts['coverage-gap']).toBe(0);
    expect(report.counts.needsInvestigation).toBe(1);
  });

  it('respects --no-opportunities via emitOpportunities flag', () => {
    const fromFp = fp('10.11.8', { operations: {} });
    const toFp = fp('10.11.10', { operations: { 'GET /Brand/New': { parameters: [] } } });
    const withOpp = buildReport({ fromFp, toFp, floorFp, manifest: m, boundaries: BOUNDARIES });
    const without = buildReport(
      { fromFp, toFp, floorFp, manifest: m, boundaries: BOUNDARIES },
      { emitOpportunities: false },
    );
    expect(withOpp.counts.opportunity).toBe(1);
    expect(without.counts.opportunity).toBe(0);
  });
});

describe('CLI --stdout against committed fixtures', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function write(rel, obj) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  it('reads fingerprints + manifest + boundaries and prints a report; errors on a missing fingerprint', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-findings-'));
    const fpRel = (v) => `docs/architecture/spec-fingerprints/jellyfin-${v}.json`;

    write(
      fpRel('10.7.0'),
      fp('10.7.0', { operations: { 'GET /Users/{userId}/Items': { parameters: [] } } }),
    );
    write(
      fpRel('10.11.8'),
      fp('10.11.8', { operations: { 'GET /Items/{itemId}': { parameters: [] } } }),
    );
    write(fpRel('10.11.10'), fp('10.11.10', { operations: {} }));
    write(
      'docs/architecture/api-usage-manifest.json',
      manifest({ endpoints: [endpoint({ minApiVersion: 2 })] }),
    );
    write(
      'docs/dev/jellyfin-version-boundaries.yml',
      'floor: "10.7.0"\ntiers:\n  1:\n    minServer: "10.7.0"\n    maxServer: "10.8.13"\n    status: frozen\n  2:\n    minServer: "10.9.0"\n    maxServer: null\n    status: active\n',
    );
    write('.api-watch/suppressions.yml', 'rules: []\n');

    const ok = spawnScript(SCRIPT, ['10.11.8', '10.11.10', '--root', dir, '--stdout']);
    expect(ok.exitCode).toBe(0);
    const report = JSON.parse(ok.stdout);
    expect(report.fromVersion).toBe('10.11.8');
    // /Items/{} GET removed on an active-tier endpoint we use → breaking
    expect(report.counts.breaking).toBeGreaterThanOrEqual(1);

    const missing = spawnScript(SCRIPT, ['10.11.8', '9.9.9', '--root', dir, '--stdout']);
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stderr).toMatch(/no committed fingerprint for 9\.9\.9/);
  });

  it('--manifest <path> overrides the committed manifest (what-if simulation)', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-findings-'));
    const fpRel = (v) => `docs/architecture/spec-fingerprints/jellyfin-${v}.json`;
    write(fpRel('10.7.0'), fp('10.7.0', { operations: {} }));
    write(fpRel('10.11.8'), fp('10.11.8', { operations: { 'GET /Items/{itemId}': {} } }));
    write(fpRel('10.11.10'), fp('10.11.10', { operations: {} })); // /items/{} removed
    // committed manifest USES /items/{} → its removal is a breaking candidate.
    write(
      'docs/architecture/api-usage-manifest.json',
      manifest({ endpoints: [endpoint({ minApiVersion: 2 })] }),
    );
    write(
      'docs/dev/jellyfin-version-boundaries.yml',
      'floor: "10.7.0"\ntiers:\n  1:\n    minServer: "10.7.0"\n    maxServer: "10.8.13"\n    status: frozen\n  2:\n    minServer: "10.9.0"\n    maxServer: null\n    status: active\n',
    );
    write('.api-watch/suppressions.yml', 'rules: []\n');
    // an ALTERNATE manifest that uses nothing → the same diff yields 0 breaking.
    write('alt-manifest.json', manifest({ endpoints: [] }));

    const base = spawnScript(SCRIPT, ['10.11.8', '10.11.10', '--root', dir, '--stdout']);
    expect(JSON.parse(base.stdout).counts.breaking).toBeGreaterThanOrEqual(1);

    const overridden = spawnScript(SCRIPT, [
      '10.11.8',
      '10.11.10',
      '--root',
      dir,
      '--manifest',
      join(dir, 'alt-manifest.json'),
      '--stdout',
    ]);
    expect(overridden.exitCode).toBe(0);
    expect(JSON.parse(overridden.stdout).counts.breaking).toBe(0);
  });
});

describe('readManifestFrom + resolveFingerprint (dry-run helpers)', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('readManifestFrom reads an explicit path and throws a clear error on a bad path', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-findings-'));
    const p = join(dir, 'm.json');
    writeFileSync(p, JSON.stringify(manifest({ endpoints: [endpoint()] })));
    expect(readManifestFrom(p).endpoints).toHaveLength(1);
    expect(() => readManifestFrom(join(dir, 'nope.json'))).toThrow(/cannot read manifest/);
  });

  it('resolveFingerprint prefers a committed fingerprint; missing + no --fetch throws (no network)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-findings-'));
    const rel = 'docs/architecture/spec-fingerprints/jellyfin-10.11.8.json';
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), JSON.stringify(fp('10.11.8', { operations: { 'GET /x': {} } })));

    const committed = await resolveFingerprint(dir, '10.11.8', { fetch: false });
    expect(committed.specVersion).toBe('10.11.8');

    // missing + fetch:false → the helpful "no committed fingerprint" error, no network.
    await expect(resolveFingerprint(dir, '9.9.9', { fetch: false })).rejects.toThrow(
      /no committed fingerprint for 9\.9\.9/,
    );
  });
});
