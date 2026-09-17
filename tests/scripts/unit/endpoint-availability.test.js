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
  validateParameterRegistry,
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

  it('accepts a patchless minServer and rejects a datestamp one', () => {
    const entry = (minServer) => ({
      endpoints: [{ path: '/x', method: 'GET', minServer, handling: { type: 'sdk-dispatch' } }],
    });
    expect(() => validateRegistry(entry('12.0'))).not.toThrow();
    expect(() => validateRegistry(entry('20240207.2'))).toThrow(/minServer must be/);
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

describe('validateParameterRegistry — schema', () => {
  const param = (overrides = {}) => ({
    parameters: [
      {
        path: '/Shows/NextUp',
        method: 'GET',
        name: 'DisableFirstEpisode',
        honoredBelow: '10.11.0',
        removedIn: '12.0.0',
        handling: { type: 'version-guard', symbol: 'honorsDisableFirstEpisode' },
        ...overrides,
      },
    ],
  });

  it('normalizes the path and ids the entry by endpoint + name', () => {
    const [p] = validateParameterRegistry(param());
    expect(p.normalizedPath).toBe('/shows/nextup');
    expect(p.id).toBe('/shows/nextup GET ?DisableFirstEpisode');
  });

  it('a registry with no parameters section (or no registry) is valid (→ [])', () => {
    expect(validateParameterRegistry({ endpoints: [] })).toEqual([]);
    expect(validateParameterRegistry(null)).toEqual([]);
  });

  it('accepts only version-guard handling, with a symbol', () => {
    expect(() =>
      validateParameterRegistry(param({ handling: { type: 'graceful-degradation' } })),
    ).toThrow(/handling.type must be version-guard/);
    expect(() => validateParameterRegistry(param({ handling: { type: 'version-guard' } }))).toThrow(
      /requires a "symbol"/,
    );
  });

  it('requires at least one of honoredFrom / honoredBelow', () => {
    expect(() =>
      validateParameterRegistry(param({ honoredBelow: undefined, removedIn: undefined })),
    ).toThrow(/needs "honoredFrom" and\/or "honoredBelow"/);
    expect(() =>
      validateParameterRegistry(param({ honoredBelow: undefined, honoredFrom: '10.9.0' })),
    ).not.toThrow();
  });

  it('rejects a malformed version, a wildcard method, a bad name and a duplicate', () => {
    expect(() => validateParameterRegistry(param({ removedIn: '12.0.0-rc1' }))).toThrow(
      /removedIn must be/,
    );
    expect(() => validateParameterRegistry(param({ method: '*' }))).toThrow(/explicit "method"/);
    expect(() => validateParameterRegistry(param({ name: 'a b' }))).toThrow(/parameter name/);
    const twice = param();
    twice.parameters.push({ ...twice.parameters[0], name: 'disablefirstepisode' });
    expect(() => validateParameterRegistry(twice)).toThrow(/duplicate parameter entry/);
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
    files = {},
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
    for (const [rel, body] of Object.entries(files)) write(rel, body);
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

  const NEXTUP = {
    path: '/shows/nextup',
    normalized: '/shows/nextup',
    methods: ['GET'],
    minApiVersion: 1,
    maxApiVersion: null,
  };
  const PARAM_REGISTRY =
    'parameters:\n' +
    '  - path: /shows/nextup\n    method: GET\n    name: DisableFirstEpisode\n' +
    '    honoredBelow: "10.11.0"\n' +
    '    handling: { type: version-guard, symbol: honorsDisableFirstEpisode }\n';
  const GUARD_SOURCE =
    'function honorsDisableFirstEpisode(v as string) as boolean\n  return true\nend function\n' +
    'function buildParams(v as string) as object\n  params = {}\n' +
    '  if honorsDisableFirstEpisode(v) then params["DisableFirstEpisode"] = true\n' +
    '  return params\nend function\n';

  it('passes a version-gated parameter sent only beside its guard', () => {
    scaffold({
      manifestEndpoints: [...MANIFEST, NEXTUP],
      source: GUARD_SOURCE,
      registry: PARAM_REGISTRY,
      files: {
        'components/Task.bs':
          "' DisableFirstEpisode is decided in buildParams\nsub run()\nend sub\n",
      },
    });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/1 registered/);
  });

  it('FAILS when a component sends the parameter without the guard, in any spelling', () => {
    scaffold({
      manifestEndpoints: [...MANIFEST, NEXTUP],
      source: GUARD_SOURCE,
      registry: PARAM_REGISTRY,
      files: {
        'components/A.bs':
          'sub a()\n  req({ seriesId: "x", disableFirstEpisode: false })\nend sub\n',
        'components/sub/B.bs': 'sub b()\n  p = {}\n  p.DisableFirstEpisode = true\nend sub\n',
      },
    });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(1);
    const out = res.stderr + res.stdout;
    expect(out).toMatch(
      /components\/A\.bs sends "DisableFirstEpisode" without calling honorsDisableFirstEpisode/,
    );
    expect(out).toMatch(/components\/sub\/B\.bs sends/);
    expect(out).toMatch(/2 validation failure/);
  });

  it('does not count a guard named only in a comment', () => {
    scaffold({
      manifestEndpoints: [...MANIFEST, NEXTUP],
      source: GUARD_SOURCE,
      registry: PARAM_REGISTRY,
      files: {
        'components/C.bs':
          "sub c()\n  ' honorsDisableFirstEpisode() is not needed here\n" +
          '  x = { "DisableFirstEpisode": "it\'s" } \' honorsDisableFirstEpisode\nend sub\n',
      },
    });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr + res.stdout).toMatch(/components\/C\.bs sends/);
  });

  it('reads code after an apostrophe inside a string literal', () => {
    scaffold({
      manifestEndpoints: [...MANIFEST, NEXTUP],
      source: GUARD_SOURCE,
      registry: PARAM_REGISTRY,
      files: {
        'components/D.bs':
          'sub d(v)\n  x = { DisableFirstEpisode: "it\'s", on: honorsDisableFirstEpisode(v) }\nend sub\n',
      },
    });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(0);
  });

  it('FAILS on a parameter after an apostrophe inside a template string', () => {
    scaffold({
      manifestEndpoints: [...MANIFEST, NEXTUP],
      source: GUARD_SOURCE,
      registry: PARAM_REGISTRY,
      files: {
        'components/E.bs':
          "sub e(id)\n  url = `/Shows/NextUp?note=it's&DisableFirstEpisode=false&UserId=${id}`\nend sub\n",
        'components/F.bs':
          'sub f()\n  s = `first line, it\'s\n  ${m.x["q\'"]} DisableFirstEpisode=true`\nend sub\n',
      },
    });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(1);
    const out = res.stderr + res.stdout;
    expect(out).toMatch(/components\/E\.bs sends/);
    expect(out).toMatch(/components\/F\.bs sends/);
  });

  it('does not count a parameter named only in a REM comment, including after a colon', () => {
    scaffold({
      manifestEndpoints: [...MANIFEST, NEXTUP],
      source: GUARD_SOURCE,
      registry: PARAM_REGISTRY,
      files: {
        'components/G.bs':
          'sub g()\n  REM DisableFirstEpisode is not sent here\n  x = 1 : rem nor DisableFirstEpisode here\nend sub\n',
      },
    });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(0);
  });

  it('FAILS when the parameter guard is named only in a source comment', () => {
    scaffold({
      manifestEndpoints: [...MANIFEST, NEXTUP],
      source:
        "' honorsDisableFirstEpisode: decides whether to send it\n" +
        'sub x()\n  p = { DisableFirstEpisode: true }\nend sub\n',
      registry: PARAM_REGISTRY,
    });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr + res.stdout).toMatch(
      /symbol "honorsDisableFirstEpisode" not found in source/,
    );
  });

  it('FAILS when the parameter guard is missing from source', () => {
    scaffold({
      manifestEndpoints: [...MANIFEST, NEXTUP],
      source: 'sub x()\n  p = { DisableFirstEpisode: true }\nend sub\n',
      registry: PARAM_REGISTRY,
    });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr + res.stdout).toMatch(
      /symbol "honorsDisableFirstEpisode" not found in source/,
    );
  });

  it('FAILS a parameter entry nothing sends any more (stale)', () => {
    scaffold({
      manifestEndpoints: [...MANIFEST, NEXTUP],
      source:
        'function honorsDisableFirstEpisode(v as string) as boolean\n  return true\nend function\n',
      registry: PARAM_REGISTRY,
    });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr + res.stdout).toMatch(/sends "DisableFirstEpisode" any more/);
  });

  it('FAILS a parameter entry whose endpoint the app no longer calls', () => {
    scaffold({ manifestEndpoints: MANIFEST, source: GUARD_SOURCE, registry: PARAM_REGISTRY });
    const res = spawnScript(LINT, ['--root', dir]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr + res.stdout).toMatch(
      /\?DisableFirstEpisode: endpoint not found in the manifest/,
    );
  });

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

  it('FAILS when a version-guard symbol is named only in a comment', () => {
    scaffold({
      manifestEndpoints: MANIFEST,
      source: "' supportsMediaSegments() used to guard this\nsub x()\nend sub\n",
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
