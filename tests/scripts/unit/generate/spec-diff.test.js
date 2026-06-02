// Tests for scripts/generate/spec-diff.js.
//
// The pure diffFingerprints() is exercised with tiny hand-written fingerprint
// objects (the shape scripts/generate/spec-fingerprint.js emits) covering every
// change kind. A final block runs the CLI --stdout path against committed
// fingerprints written to a temp tree via spawnScript.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';
import { diffFingerprints, serializeDiff } from '../../../../scripts/generate/spec-diff.js';

const SCRIPT = 'scripts/generate/spec-diff.js';

// Minimal fingerprint factory.
function fp(specVersion, { operations = {}, schemas = {} } = {}) {
  return { schemaVersion: 1, specVersion, operations, schemas };
}

// Find the single change matching a predicate (asserts exactly one).
function only(diff, pred) {
  const matches = diff.changes.filter(pred);
  expect(matches).toHaveLength(1);
  return matches[0];
}

describe('diffFingerprints — operations', () => {
  it('flags endpoint-added and endpoint-removed with path + method', () => {
    const from = fp('1.0.0', { operations: { 'GET /Old': { parameters: [] } } });
    const to = fp('1.1.0', { operations: { 'GET /New': { parameters: [] } } });
    const diff = diffFingerprints(from, to);

    const removed = only(diff, (c) => c.kind === 'endpoint-removed');
    expect(removed).toMatchObject({ path: '/Old', method: 'GET' });
    const added = only(diff, (c) => c.kind === 'endpoint-added');
    expect(added).toMatchObject({ path: '/New', method: 'GET' });
  });

  it('flags param add/remove/retype/required on a common operation', () => {
    const from = fp('1.0.0', {
      operations: {
        'GET /Items': {
          parameters: [
            { name: 'limit', in: 'query', type: 'integer:int32', required: false },
            { name: 'gone', in: 'query', type: 'string', required: false },
          ],
        },
      },
    });
    const to = fp('1.1.0', {
      operations: {
        'GET /Items': {
          parameters: [
            { name: 'limit', in: 'query', type: 'integer:int64', required: true },
            { name: 'fresh', in: 'query', type: 'string', required: false },
          ],
        },
      },
    });
    const diff = diffFingerprints(from, to);

    expect(only(diff, (c) => c.kind === 'param-removed').name).toBe('gone');
    expect(only(diff, (c) => c.kind === 'param-added').name).toBe('fresh');
    const changed = only(diff, (c) => c.kind === 'param-changed');
    expect(changed.name).toBe('limit');
    expect(changed.detail).toContain('integer:int32 → integer:int64');
    expect(changed.detail).toContain('required false → true');
    expect(changed).toMatchObject({ path: '/Items', method: 'GET' });
  });

  it('flags request/response body shape changes', () => {
    const from = fp('1.0.0', {
      operations: {
        'POST /X': { parameters: [], requestBody: 'ref:OldDto', response: 'ref:OldResult' },
      },
    });
    const to = fp('1.1.0', {
      operations: {
        'POST /X': { parameters: [], requestBody: 'ref:NewDto', response: 'ref:NewResult' },
      },
    });
    const diff = diffFingerprints(from, to);

    expect(only(diff, (c) => c.kind === 'requestbody-changed').detail).toContain(
      'ref:OldDto → ref:NewDto',
    );
    expect(only(diff, (c) => c.kind === 'response-changed').detail).toContain(
      'ref:OldResult → ref:NewResult',
    );
  });
});

describe('diffFingerprints — renameCandidates (removal-vs-rename heuristic)', () => {
  const op = (params) => ({ operations: { 'GET /Items': { parameters: params } } });
  const P = (name, type = 'string', required = false) => ({ name, in: 'query', type, required });

  it('param-removed: lists a same-signature addition as a high-confidence candidate', () => {
    const from = fp('1.0.0', op([P('gone'), P('keep')]));
    const to = fp('1.1.0', op([P('fresh'), P('keep')])); // fresh: same sig as gone
    const removed = only(diffFingerprints(from, to), (c) => c.kind === 'param-removed');
    expect(removed.name).toBe('gone');
    expect(removed.renameCandidates).toEqual([{ name: 'fresh', sameSignature: true }]);
  });

  it('param-removed: EMPTY candidates when nothing was added (genuine-removal signal)', () => {
    const from = fp('1.0.0', op([P('gone'), P('keep')]));
    const to = fp('1.1.0', op([P('keep')]));
    const removed = only(diffFingerprints(from, to), (c) => c.kind === 'param-removed');
    expect(removed.renameCandidates).toEqual([]); // the NextUp/disableFirstEpisode case
  });

  it('param-removed: a different-signature addition is a low-confidence candidate, sorted last', () => {
    const from = fp('1.0.0', op([P('gone', 'string')]));
    const to = fp('1.1.0', op([P('sameTy', 'string'), P('diffTy', 'integer:int32')]));
    const removed = only(diffFingerprints(from, to), (c) => c.kind === 'param-removed');
    // same-signature first, then the rest
    expect(removed.renameCandidates).toEqual([
      { name: 'sameTy', sameSignature: true },
      { name: 'diffTy', sameSignature: false },
    ]);
  });

  it('field-removed: matches on the property type signature', () => {
    const from = fp('1.0.0', {
      schemas: { Dto: { properties: { Old: 'string', Keep: 'integer:int32' } } },
    });
    const to = fp('1.1.0', {
      schemas: { Dto: { properties: { New: 'string', Keep: 'integer:int32' } } },
    });
    const removed = only(diffFingerprints(from, to), (c) => c.kind === 'field-removed');
    expect(removed.name).toBe('Old');
    expect(removed.renameCandidates).toEqual([{ name: 'New', sameSignature: true }]);
  });

  it('field-removed: EMPTY candidates when the schema only lost a field', () => {
    const from = fp('1.0.0', {
      schemas: { Dto: { properties: { Old: 'string', Keep: 'string' } } },
    });
    const to = fp('1.1.0', { schemas: { Dto: { properties: { Keep: 'string' } } } });
    const removed = only(diffFingerprints(from, to), (c) => c.kind === 'field-removed');
    expect(removed.renameCandidates).toEqual([]);
  });
});

describe('diffFingerprints — schemas', () => {
  it('flags field add/remove/retype on a common schema', () => {
    const from = fp('1.0.0', {
      schemas: {
        BaseItem: { properties: { Id: 'string', Ticks: 'integer:int64', Old: 'string' } },
      },
    });
    const to = fp('1.1.0', {
      schemas: {
        BaseItem: { properties: { Id: 'string', Ticks: 'integer:int32', New: 'string' } },
      },
    });
    const diff = diffFingerprints(from, to);

    expect(only(diff, (c) => c.kind === 'field-removed').name).toBe('Old');
    expect(only(diff, (c) => c.kind === 'field-added').name).toBe('New');
    const retyped = only(diff, (c) => c.kind === 'field-retyped');
    expect(retyped).toMatchObject({ schema: 'BaseItem', name: 'Ticks' });
    expect(retyped.detail).toContain('integer:int64 → integer:int32');
  });

  it('flags enum value additions and removals in one enum-changed', () => {
    const from = fp('1.0.0', { schemas: { Kind: { enum: ['Movie', 'Series', 'Gone'] } } });
    const to = fp('1.1.0', { schemas: { Kind: { enum: ['Movie', 'Series', 'Fresh'] } } });
    const change = only(diffFingerprints(from, to), (c) => c.kind === 'enum-changed');
    expect(change.added).toEqual(['Fresh']);
    expect(change.removed).toEqual(['Gone']);
    expect(change.schema).toBe('Kind');
  });

  it('decomposes a removed DTO into per-field removals (Phase-2 join granularity)', () => {
    const from = fp('1.0.0', {
      schemas: { GoneDto: { properties: { A: 'string', B: 'integer:int32' } } },
    });
    const to = fp('1.1.0', { schemas: {} });
    const diff = diffFingerprints(from, to);
    const removed = diff.changes.filter((c) => c.kind === 'field-removed');
    expect(removed.map((c) => c.name).sort()).toEqual(['A', 'B']);
    expect(removed.every((c) => c.schema === 'GoneDto')).toBe(true);
  });
});

describe('diffFingerprints — metadata + determinism', () => {
  it('stamps fromVersion/toVersion on the diff and every change', () => {
    const diff = diffFingerprints(
      fp('10.11.8', { schemas: { S: { properties: { A: 'string' } } } }),
      fp('10.11.10', { schemas: { S: { properties: {} } } }),
    );
    expect(diff).toMatchObject({ fromVersion: '10.11.8', toVersion: '10.11.10' });
    expect(diff.changes[0]).toMatchObject({ fromVersion: '10.11.8', toVersion: '10.11.10' });
  });

  it('reports zero changes for identical fingerprints', () => {
    const a = fp('1.0.0', {
      operations: { 'GET /X': { parameters: [] } },
      schemas: { S: { enum: ['a'] } },
    });
    const diff = diffFingerprints(
      a,
      fp('1.0.0', {
        operations: { 'GET /X': { parameters: [] } },
        schemas: { S: { enum: ['a'] } },
      }),
    );
    expect(diff.counts.total).toBe(0);
    expect(diff.changes).toEqual([]);
  });

  it('is deterministic and counts kinds', () => {
    const from = fp('1.0.0', {
      operations: { 'GET /A': { parameters: [] }, 'GET /B': { parameters: [] } },
    });
    const to = fp('1.1.0', {
      operations: { 'GET /B': { parameters: [] }, 'GET /C': { parameters: [] } },
    });
    const a = serializeDiff(diffFingerprints(from, to));
    const b = serializeDiff(diffFingerprints(from, to));
    expect(a).toBe(b);
    const parsed = JSON.parse(a);
    expect(parsed.counts).toMatchObject({ total: 2, 'endpoint-added': 1, 'endpoint-removed': 1 });
  });
});

describe('CLI --stdout against committed fingerprints', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function writeFp(version, obj) {
    const fpDir = join(dir, 'docs/architecture/spec-fingerprints');
    mkdirSync(fpDir, { recursive: true });
    writeFileSync(join(fpDir, `jellyfin-${version}.json`), JSON.stringify(obj));
  }

  it('reads both fingerprints and prints a diff; errors on a missing one', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-spec-diff-'));
    writeFp('10.11.8', fp('10.11.8', { schemas: { S: { properties: { A: 'string' } } } }));
    writeFp('10.11.10', fp('10.11.10', { schemas: { S: { properties: { A: 'integer:int32' } } } }));

    const ok = spawnScript(SCRIPT, ['10.11.8', '10.11.10', '--root', dir, '--stdout']);
    expect(ok.exitCode).toBe(0);
    const diff = JSON.parse(ok.stdout);
    expect(diff.counts.total).toBe(1);
    expect(diff.changes[0]).toMatchObject({ kind: 'field-retyped', schema: 'S', name: 'A' });

    const missing = spawnScript(SCRIPT, ['10.11.8', '9.0.0', '--root', dir, '--stdout']);
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stderr).toMatch(/no committed fingerprint for 9\.0\.0/);
  });
});
