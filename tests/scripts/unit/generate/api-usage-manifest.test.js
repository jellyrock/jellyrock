// Tests for scripts/generate/api-usage-manifest.js.
//
// Core coverage drives the pure extractors via extractFromSource() with inline
// BrighterScript snippets (the BSC-plugin test style). A final block runs the
// CLI --check drift gate against a temp tree via spawnScript.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';
import {
  extractFromSource,
  buildManifest,
  serializeManifest,
} from '../../../../scripts/generate/api-usage-manifest.js';

const SCRIPT = 'scripts/generate/api-usage-manifest.js';

// Wrap a snippet body in a function so it parses as a statement context.
function fn(body) {
  return `function f()\n${body}\nend function`;
}

function endpointPaths(result) {
  return result.endpoints.map((e) => e.path);
}
function findEndpoint(result, path) {
  return result.endpoints.find((e) => e.path === path);
}

describe('endpoint extraction', () => {
  it('captures a literal buildURL path with the validatedReq method', () => {
    const r = extractFromSource(fn('  return m.validatedReq("GET", buildURL("/items/", q))'));
    const ep = findEndpoint(r, '/items/');
    expect(ep).toBeTruthy();
    expect(ep.methods).toEqual(['GET']);
    expect(ep.normalized).toBe('/items'); // trailing slash stripped for spec matching
  });

  it('captures a Substitute() template and normalizes placeholders', () => {
    const r = extractFromSource(
      fn('  return m.validatedReq("GET", buildURL(Substitute("/Items/{0}", id), p))'),
    );
    const ep = findEndpoint(r, '/Items/{0}');
    expect(ep).toBeTruthy();
    expect(ep.normalized).toBe('/items/{}'); // placeholders collapsed + case-folded
    expect(ep.methods).toEqual(['GET']);
  });

  it('adds a leading slash to paths written without one', () => {
    const r = extractFromSource(fn('  return buildURL(Substitute("Audio/{0}/Lyrics", id))'));
    expect(endpointPaths(r)).toContain('/Audio/{0}/Lyrics');
  });

  it('infers the method from an inline { method: "POST" } request AA', () => {
    const r = extractFromSource(
      fn(
        '  url = buildURL(Substitute("/items/{0}/playbackinfo", id))\n  return { method: "POST", url: url }',
      ),
    );
    const ep = findEndpoint(r, '/items/{0}/playbackinfo');
    expect(ep.methods).toEqual(['POST']);
  });

  it('resolves a path variable with multiple literal assignments and drops the empty initializer', () => {
    const body = [
      '  path = ""',
      '  if state = "start"',
      '    path = "/sessions/playing"',
      '  else',
      '    path = "/sessions/playing/stopped"',
      '  end if',
      '  url = buildURL(path)',
      '  return { method: "POST", url: url }',
    ].join('\n');
    const r = extractFromSource(fn(body));
    const paths = endpointPaths(r);
    expect(paths).toContain('/sessions/playing');
    expect(paths).toContain('/sessions/playing/stopped');
    expect(paths).not.toContain('/'); // the `path = ""` initializer is dropped
    expect(r.unresolved).toHaveLength(0);
  });

  it('treats APIRequest() as an endpoint sink and maps getJson/postJson to methods', () => {
    const get = extractFromSource(fn('  req = APIRequest("/users/public")\n  return getJson(req)'));
    expect(findEndpoint(get, '/users/public').methods).toEqual(['GET']);

    const post = extractFromSource(
      fn('  req = APIRequest("users/authenticatebyname")\n  return postJson(req, body)'),
    );
    const ep = findEndpoint(post, '/users/authenticatebyname');
    expect(ep.methods).toEqual(['POST']);
  });

  it('records a dynamic (non-literal) path as unresolved rather than guessing', () => {
    const r = extractFromSource(fn('  return buildURL(stream.DeliveryUrl)'));
    expect(r.endpoints).toHaveLength(0);
    expect(r.unresolved).toHaveLength(1);
  });

  it('falls back to UNKNOWN method when no method signal is present', () => {
    const r = extractFromSource(
      fn('  return buildURL(Substitute("/items/{0}/images/{1}", id, t))'),
    );
    expect(findEndpoint(r, '/items/{0}/images/{1}').methods).toEqual(['UNKNOWN']);
  });
});

describe('apiVersion range derivation', () => {
  const range = (ep) => [ep.minApiVersion, ep.maxApiVersion];

  it('tags an unguarded endpoint as all-versions [1, null]', () => {
    const r = extractFromSource(fn('  return buildURL("/branding/configuration")'));
    expect(range(findEndpoint(r, '/branding/configuration'))).toEqual([1, null]);
  });

  it('tags a >=2 then-branch as [2, null] and the early-return fall-through as [1, 1]', () => {
    const body = [
      '  if m.getApiVersion() >= 2',
      '    return buildURL("/v2")',
      '  end if',
      '  return buildURL("/v1")',
    ].join('\n');
    const r = extractFromSource(fn(body));
    expect(range(findEndpoint(r, '/v2'))).toEqual([2, null]);
    expect(range(findEndpoint(r, '/v1'))).toEqual([1, 1]);
  });

  it('handles the if/else form', () => {
    const body = [
      '  if m.getApiVersion() >= 2',
      '    x = buildURL("/v2")',
      '  else',
      '    x = buildURL("/v1")',
      '  end if',
      '  return x',
    ].join('\n');
    const r = extractFromSource(fn(body));
    expect(range(findEndpoint(r, '/v2'))).toEqual([2, null]);
    expect(range(findEndpoint(r, '/v1'))).toEqual([1, 1]);
  });

  it('generalizes to a nested v3 dispatch ([3,∞], [2,2], [1,1])', () => {
    const body = [
      '  if m.getApiVersion() >= 3',
      '    return buildURL("/v3")',
      '  end if',
      '  if m.getApiVersion() >= 2',
      '    return buildURL("/v2")',
      '  end if',
      '  return buildURL("/v1")',
    ].join('\n');
    const r = extractFromSource(fn(body));
    expect(range(findEndpoint(r, '/v3'))).toEqual([3, null]);
    expect(range(findEndpoint(r, '/v2'))).toEqual([2, 2]);
    expect(range(findEndpoint(r, '/v1'))).toEqual([1, 1]);
  });
});

describe('response-field extraction', () => {
  it('captures PascalCase reads off DTO objects, ignoring camelCase writes, m.*, output node, and i18n constants', () => {
    const body = [
      '  item.id = apiData.Id',
      '  item.runTimeTicks = apiData.RunTimeTicks',
      '  x = userData.PlaybackPositionTicks',
      '  y = m.global',
      '  z = SubtitleSelection.NONE',
      '  d = item.PlayDuration - item.PlayStart', // Roku ContentNode built-in read off output node
      '  t = translationKeys.LabelCh', // internal i18n constant
    ].join('\n');
    const r = extractFromSource(fn(body));
    const names = r.responseFields.map((f) => f.name);
    expect(names).toContain('Id');
    expect(names).toContain('RunTimeTicks');
    expect(names).toContain('PlaybackPositionTicks');
    expect(names).not.toContain('NONE'); // ALL-CAPS enum constant
    // camelCase ContentNode writes and m.* are never PascalCase DTO reads:
    expect(names).not.toContain('global');
    expect(names).not.toContain('PlayStart'); // Roku built-in off the output `item` node
    expect(names).not.toContain('LabelCh'); // translationKeys.* is internal
  });

  it('does not capture method calls as fields', () => {
    const r = extractFromSource(fn('  n = apiData.MediaSources.Count()'));
    const names = r.responseFields.map((f) => f.name);
    expect(names).toContain('MediaSources'); // the field read
    expect(names).not.toContain('Count'); // the method call
  });

  it('records the root variable a field was read through', () => {
    const r = extractFromSource(fn('  x = firstSource.Bitrate'));
    expect(r.responseFields.find((f) => f.name === 'Bitrate').root).toBe('firstSource');
  });
});

describe('request-field extraction', () => {
  it('captures PascalCase AA keys and dotted-set body fields, ignoring lowercase params', () => {
    const body = [
      '  postData = { "Username": u, "Pw": p, secret: s }',
      '  postData.SubtitleStreamIndex = 3',
    ].join('\n');
    const r = extractFromSource(fn(body));
    const names = r.requestFields.map((f) => f.name);
    expect(names).toContain('Username');
    expect(names).toContain('Pw');
    expect(names).toContain('SubtitleStreamIndex');
    expect(names).not.toContain('secret'); // lowercase query param, not a body field
  });
});

describe('buildManifest determinism', () => {
  it('produces sorted, stable output on the real repo (idempotent)', () => {
    const a = serializeManifest(buildManifest('.'));
    const b = serializeManifest(buildManifest('.'));
    expect(a).toBe(b);
    const m = JSON.parse(a);
    expect(m.endpoints.length).toBeGreaterThan(40);
    expect(m.responseFields.length).toBeGreaterThan(100);
    // endpoints sorted by (normalized, path) via localeCompare — same comparator
    // the generator uses.
    const cmp = (a, b) => a.normalized.localeCompare(b.normalized) || a.path.localeCompare(b.path);
    expect(m.endpoints).toEqual([...m.endpoints].sort(cmp));
  });
});

describe('CLI --check drift gate', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('exits non-zero when the committed manifest is missing/stale, zero after regen', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-api-manifest-'));
    mkdirSync(join(dir, 'source', 'api'), { recursive: true });
    mkdirSync(join(dir, 'source', 'data'), { recursive: true });
    mkdirSync(join(dir, 'docs', 'architecture'), { recursive: true });
    writeFileSync(
      join(dir, 'source', 'api', 'ApiClient.bs'),
      fn('  return m.validatedReq("GET", buildURL("/items/", q))'),
    );
    // SessionDataTransformer referenced by RESPONSE_FIELD_FILES must exist.
    writeFileSync(
      join(dir, 'source', 'data', 'JellyfinDataTransformer.bs'),
      fn('  x = apiData.Id'),
    );
    writeFileSync(
      join(dir, 'source', 'data', 'SessionDataTransformer.bs'),
      fn('  x = apiData.Name'),
    );

    const check1 = spawnScript(SCRIPT, ['--check', dir]);
    expect(check1.exitCode).toBe(1);

    const write = spawnScript(SCRIPT, [dir]);
    expect(write.exitCode).toBe(0);

    const check2 = spawnScript(SCRIPT, ['--check', dir]);
    expect(check2.exitCode).toBe(0);
  });
});
