// Tests for scripts/lib/spec-fetch.cjs.
//
// All offline: we exercise URL/path construction, version validation, and the
// cache-hit path (a pre-seeded .api-watch/cache/ file is read without any
// network call). The network miss path is thin stdlib glue over httpGet (itself
// covered by the signals-fetch tests) so we don't mock sockets here.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  specFileName,
  specUrl,
  cachePathFor,
  readCachedSpec,
  fetchSpec,
} = require('../../../../scripts/lib/spec-fetch.cjs');

describe('URL + path construction', () => {
  it('builds the archive filename and permanent URL', () => {
    expect(specFileName('10.11.8')).toBe('jellyfin-openapi-10.11.8.json');
    expect(specUrl('10.11.8')).toBe(
      'https://api.jellyfin.org/openapi/stable/jellyfin-openapi-10.11.8.json',
    );
  });

  it('roots the cache path under .api-watch/cache/', () => {
    expect(cachePathFor('/repo', '10.7.0')).toBe(
      '/repo/.api-watch/cache/jellyfin-openapi-10.7.0.json',
    );
  });
});

describe('cache reads', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function seedCache(version, obj) {
    const file = cachePathFor(dir, version);
    mkdirSync(join(dir, '.api-watch', 'cache'), { recursive: true });
    writeFileSync(file, JSON.stringify(obj), 'utf8');
  }

  it('readCachedSpec returns null on a miss and the parsed object on a hit', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-spec-fetch-'));
    expect(readCachedSpec(dir, '10.7.0')).toBeNull();
    seedCache('10.7.0', { openapi: '3.0.1', paths: {} });
    expect(readCachedSpec(dir, '10.7.0')).toEqual({ openapi: '3.0.1', paths: {} });
  });

  it('fetchSpec reads a cached spec without touching the network', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-spec-fetch-'));
    seedCache('10.11.8', { openapi: '3.0.1', marker: 'cached' });
    // No network is reachable assumptions needed — a hit short-circuits before
    // httpGet. If it tried to fetch, this would hang/throw rather than return.
    const spec = await fetchSpec('10.11.8', { rootDir: dir });
    expect(spec.marker).toBe('cached');
  });

  it('rejects a malformed version before any fetch', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-spec-fetch-'));
    await expect(fetchSpec('latest', { rootDir: dir })).rejects.toThrow(/MAJOR\.MINOR\.PATCH/);
    expect(existsSync(join(dir, '.api-watch'))).toBe(false);
  });
});
