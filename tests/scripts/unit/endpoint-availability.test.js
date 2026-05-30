// Tests for the endpoint-availability registry (Phase 6 of server-upgrade-automation):
//   - scripts/lib/endpoint-availability.cjs — loader/validator/matcher (schema only)
//   - scripts/lint/endpoint-availability-check.cjs — the regression-safety gate that
//     validates each entry's CODE claim against current source + the manifest.
//
// The loader is exercised directly; the lint is driven offline via spawnScript
// against a tiny hand-written repo (manifest + source/*.bs + registry). No network.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from './_helpers/spawn-script.js';
import {
  validateRegistry,
  entryMatchesCandidate,
  normalizePath,
} from '../../../scripts/lib/endpoint-availability.cjs';

const LINT = 'scripts/lint/endpoint-availability-check.cjs';

describe('validateRegistry — schema', () => {
  it('normalizes path + parses methods + assigns a stable id', () => {
    const [e] = validateRegistry({
      endpoints: [
        {
          path: '/MediaSegments/{itemId}',
          method: 'GET',
          handling: { type: 'graceful-degradation' },
        },
      ],
    });
    expect(e.normalizedPath).toBe('/mediasegments/{}');
    expect(e.methodSet.has('GET')).toBe(true);
    expect(e.id).toBe('/mediasegments/{} GET');
  });

  it('accepts a comma/space method list and the * wildcard', () => {
    const [a] = validateRegistry({
      endpoints: [{ path: '/x', method: 'GET,POST', handling: { type: 'sdk-dispatch' } }],
    });
    expect([...a.methodSet].sort()).toEqual(['GET', 'POST']);
    const [b] = validateRegistry({
      endpoints: [{ path: '/y', method: '*', handling: { type: 'sdk-dispatch' } }],
    });
    expect(b.methodSet).toBe('*');
  });

  it('an empty / missing registry is valid (→ [])', () => {
    expect(validateRegistry({})).toEqual([]);
    expect(validateRegistry({ endpoints: [] })).toEqual([]);
  });

  it('rejects an unknown handling type', () => {
    expect(() =>
      validateRegistry({ endpoints: [{ path: '/x', method: 'GET', handling: { type: 'magic' } }] }),
    ).toThrow(/handling.type must be one of/);
  });

  it('requires a symbol for version-guard and a sibling for dispatch-sibling', () => {
    expect(() =>
      validateRegistry({
        endpoints: [{ path: '/x', method: 'GET', handling: { type: 'version-guard' } }],
      }),
    ).toThrow(/version-guard handling requires a "symbol"/);
    expect(() =>
      validateRegistry({
        endpoints: [{ path: '/x', method: 'GET', handling: { type: 'dispatch-sibling' } }],
      }),
    ).toThrow(/dispatch-sibling handling requires a "sibling"/);
  });

  it('rejects an unknown HTTP method and a duplicate entry', () => {
    expect(() =>
      validateRegistry({
        endpoints: [{ path: '/x', method: 'FETCH', handling: { type: 'sdk-dispatch' } }],
      }),
    ).toThrow(/unknown HTTP method/);
    expect(() =>
      validateRegistry({
        endpoints: [
          { path: '/x', method: 'GET', handling: { type: 'sdk-dispatch' } },
          { path: '/x', method: 'GET', handling: { type: 'graceful-degradation' } },
        ],
      }),
    ).toThrow(/duplicate entry/);
  });
});

describe('entryMatchesCandidate', () => {
  const [entry] = validateRegistry({
    endpoints: [{ path: '/mediasegments/{}', method: 'GET', handling: { type: 'sdk-dispatch' } }],
  });
  it('matches on normalized path + method intersection', () => {
    expect(
      entryMatchesCandidate(entry, { change: { path: '/MediaSegments/{x}', method: 'GET' } }),
    ).toBe(true);
    expect(
      entryMatchesCandidate(entry, { change: { path: '/mediasegments/{}', method: 'POST' } }),
    ).toBe(false);
    expect(entryMatchesCandidate(entry, { change: { path: '/other', method: 'GET' } })).toBe(false);
  });
  it('a comma-joined candidate method intersects', () => {
    expect(
      entryMatchesCandidate(entry, { change: { path: '/mediasegments/{}', method: 'GET,POST' } }),
    ).toBe(true);
  });
  it('normalizePath collapses placeholders + folds case', () => {
    expect(normalizePath('/Audio/{itemId}/Lyrics')).toBe('/audio/{}/lyrics');
  });
});

describe('endpoint-availability-check.cjs (lint, offline)', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function scaffold({
    registry,
    manifestEndpoints,
    source = 'function supportsMediaSegments()\nend function\n',
  }) {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-ea-'));
    const write = (rel, body) => {
      const full = join(dir, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, body);
    };
    write('docs/dev/jellyfin-endpoint-availability.yml', registry);
    write(
      'docs/architecture/api-usage-manifest.json',
      JSON.stringify({ endpoints: manifestEndpoints, requestFields: [], responseFields: [] }),
    );
    write('source/stub.bs', source);
  }

  const MANIFEST = [
    {
      path: '/MediaSegments/{0}',
      normalized: '/mediasegments/{}',
      methods: ['GET'],
      minApiVersion: 1,
      maxApiVersion: null,
    },
    {
      path: '/Items',
      normalized: '/items',
      methods: ['GET'],
      minApiVersion: 2,
      maxApiVersion: null,
    },
    {
      path: '/Users/{0}/Items',
      normalized: '/users/{}/items',
      methods: ['GET'],
      minApiVersion: 1,
      maxApiVersion: 1,
    },
  ];

  it('passes when guard symbol exists + sibling is a floor-tier manifest endpoint', () => {
    scaffold({
      manifestEndpoints: MANIFEST,
      registry:
        'endpoints:\n' +
        '  - path: /mediasegments/{}\n    method: GET\n    handling: { type: version-guard, symbol: supportsMediaSegments }\n' +
        '  - path: /items\n    method: GET\n    handling: { type: dispatch-sibling, sibling: "/users/{}/items" }\n',
    });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/2 registered/);
  });

  it('FAILS when a version-guard symbol is missing from source (regression)', () => {
    scaffold({
      manifestEndpoints: MANIFEST,
      source: "' guard was deleted\n",
      registry:
        'endpoints:\n  - path: /mediasegments/{}\n    method: GET\n    handling: { type: version-guard, symbol: supportsMediaSegments }\n',
    });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr + res.stdout).toMatch(/symbol "supportsMediaSegments" not found/);
  });

  it('FAILS when a dispatch-sibling is missing from the manifest', () => {
    scaffold({
      manifestEndpoints: MANIFEST.filter((e) => e.normalized !== '/users/{}/items'),
      registry:
        'endpoints:\n  - path: /items\n    method: GET\n    handling: { type: dispatch-sibling, sibling: "/users/{}/items" }\n',
    });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr + res.stdout).toMatch(/dispatch-sibling .* not found in the manifest/);
  });

  it('FAILS when an entry references an endpoint the app no longer calls (stale)', () => {
    scaffold({
      manifestEndpoints: MANIFEST,
      registry:
        'endpoints:\n  - path: /gone\n    method: GET\n    handling: { type: graceful-degradation }\n',
    });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr + res.stdout).toMatch(/not found in the manifest/);
  });

  it('FAILS on a schema-broken registry', () => {
    scaffold({
      manifestEndpoints: MANIFEST,
      registry: 'endpoints:\n  - path: /x\n    method: GET\n    handling: { type: nope }\n',
    });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr + res.stdout).toMatch(/handling.type must be one of/);
  });
});
