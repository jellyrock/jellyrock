// scripts/lib/spec-fetch.cjs — fetch + cache Jellyfin OpenAPI specs for the
// server-upgrade-automation pipeline (docs/architecture/server-upgrade-automation.md).
//
// The Jellyfin archive at api.jellyfin.org/openapi/stable/ serves EVERY version
// back to 10.7.0 at a permanent URL, so:
//   - historical versions are immutable → cache forever, never a TTL miss;
//   - raw specs are ~2 MB → cache to the gitignored .api-watch/cache/ rather
//     than committing them (committed fingerprints give reproducibility — see
//     scripts/generate/spec-fingerprint.js).
//
// Reuses the redirect-following httpGet from signals-fetch.cjs (same archive
// host). `.cjs` per scripts/CLAUDE.md's module rule; ESM callers (the Phase 1
// generators) load it via createRequire, as catchup-state.js already does.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { httpGet } = require('./signals-fetch.cjs');

const ARCHIVE_BASE = 'https://api.jellyfin.org/openapi/stable/';
const CACHE_REL = '.api-watch/cache';
// Specs are large; allow well beyond the signals-fetch 5s default.
const SPEC_TIMEOUT_MS = 30000;

function isSemverBase(v) {
  return typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
}

// The archive filename for a stable version: jellyfin-openapi-<version>.json.
function specFileName(version) {
  return `jellyfin-openapi-${version}.json`;
}

// Permanent archive URL for a stable version's spec.
function specUrl(version) {
  return ARCHIVE_BASE + specFileName(version);
}

// Absolute path the cached raw spec lives at, under a repo root.
function cachePathFor(rootDir, version) {
  return path.join(rootDir, CACHE_REL, specFileName(version));
}

// Read a cached spec as a parsed object, or null if it isn't cached.
function readCachedSpec(rootDir, version) {
  const file = cachePathFor(rootDir, version);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Fetch a version's spec, caching it under rootDir/.api-watch/cache/. Returns
// the parsed spec object. A cached copy is reused unless `force` is set — the
// archive is immutable for released versions, so the cache never goes stale.
//
// Network is only touched on a cache miss (or force), keeping every offline
// path (tests, repeat runs) network-free.
async function fetchSpec(
  version,
  { rootDir = '.', force = false, timeoutMs = SPEC_TIMEOUT_MS } = {},
) {
  if (!isSemverBase(version)) {
    throw new Error(`spec-fetch: version must be MAJOR.MINOR.PATCH, got ${version}`);
  }
  const file = cachePathFor(rootDir, version);
  if (!force && fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const body = await httpGet(specUrl(version), { timeoutMs });
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`spec-fetch: ${specUrl(version)} did not return valid JSON`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Re-serialize compactly: we only ever re-parse this, and the committed
  // artifact is the fingerprint, not the raw cache.
  fs.writeFileSync(file, JSON.stringify(parsed), 'utf8');
  return parsed;
}

module.exports = {
  ARCHIVE_BASE,
  CACHE_REL,
  specFileName,
  specUrl,
  cachePathFor,
  readCachedSpec,
  fetchSpec,
};
