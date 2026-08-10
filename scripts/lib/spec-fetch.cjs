// scripts/lib/spec-fetch.cjs — fetch + cache Jellyfin OpenAPI specs for the
// server-upgrade-automation pipeline (docs/architecture/server-upgrade-automation.md).
//
// The Jellyfin archive serves EVERY immutable build at a permanent URL across two
// channels (verified against the live archive):
//   - stable/   → jellyfin-openapi-<X.Y.Z>.json and -rcN/-betaN/-alphaN release
//                 candidates (RCs live in the stable dir);
//   - unstable/ → jellyfin-openapi-<datestamp>.json master builds (e.g.
//                 20240402201942, or the legacy <YYYYMMDD>.<N> form).
// Both serve IMMUTABLE per-build files, so:
//   - historical builds are immutable → cache forever, never a TTL miss;
//   - raw specs are ~2 MB → cache to the gitignored .api-watch/cache/ rather
//     than committing them (committed fingerprints give reproducibility — see
//     scripts/generate/spec-fingerprint.js).
// The MUTABLE rolling pointers at /openapi/ root (jellyfin-openapi-unstable.json)
// are deliberately NOT wired here — pinning a baseline to a moving file isn't
// reproducible. To target "latest master", resolve a concrete datestamp via
// signals-fetch.cjs's fetchLatestUnstable() first, then fetch THAT.
//
// Reuses the redirect-following httpGet from signals-fetch.cjs (same archive
// host). `.cjs` per scripts/CLAUDE.md's module rule; ESM callers (the Phase 1
// generators) load it via createRequire, as catchup-state.js already does.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { httpGet } = require('./signals-fetch.cjs');

const ARCHIVE_STABLE = 'https://api.jellyfin.org/openapi/stable/';
const ARCHIVE_UNSTABLE = 'https://api.jellyfin.org/openapi/unstable/';
// Back-compat alias: the stable dir was the only channel before unstable support.
const ARCHIVE_BASE = ARCHIVE_STABLE;
const CACHE_REL = '.api-watch/cache';
// Specs are large; allow well beyond the signals-fetch 5s default.
const SPEC_TIMEOUT_MS = 30000;

// A stable-channel version: MAJOR.MINOR(.PATCH) with an optional pre-release suffix
// (-rcN / -betaN / -alphaN). RCs ship in the stable dir alongside finals.
//
// PATCH is optional because the archive does not always publish one: the 10.x line
// used three segments (10.12.0-rc1), but the 12.0 line ships its RCs as `12.0-rc4`.
// Requiring three segments made every 12.0 RC unfetchable, which blocked triaging the
// whole next major. The `!isUnstableVersion` guard keeps the now-looser shape from
// also swallowing the legacy datestamp form (20240207.2), which must route to unstable/.
function isStableVersion(v) {
  return (
    typeof v === 'string' &&
    /^\d+\.\d+(?:\.\d+)?(?:-(?:rc|beta|alpha)\d+)?$/.test(v) &&
    !isUnstableVersion(v)
  );
}

// An unstable-channel (master) build label: an 8-digit date, optionally followed
// by a 6-digit time (20240402201942) or the legacy <YYYYMMDD>.<N> minor (20240207.2).
function isUnstableVersion(v) {
  return typeof v === 'string' && /^\d{8}(?:\d{6}|\.\d+)?$/.test(v);
}

// Any fetchable spec label across both channels.
function isSpecVersion(v) {
  return isStableVersion(v) || isUnstableVersion(v);
}

// The archive dir a version lives in: datestamped master builds → unstable/,
// everything else (finals + RCs) → stable/.
function archiveBaseFor(version) {
  return isUnstableVersion(version) ? ARCHIVE_UNSTABLE : ARCHIVE_STABLE;
}

// The archive filename for a build: jellyfin-openapi-<version>.json (channel-agnostic).
function specFileName(version) {
  return `jellyfin-openapi-${version}.json`;
}

// Permanent archive URL for a build's spec, routed to the right channel dir.
function specUrl(version) {
  return archiveBaseFor(version) + specFileName(version);
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
  if (!isSpecVersion(version)) {
    throw new Error(
      `spec-fetch: version must be MAJOR.MINOR.PATCH (optionally -rcN/-betaN/-alphaN) ` +
        `or an unstable datestamp, got ${version}`,
    );
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
  ARCHIVE_STABLE,
  ARCHIVE_UNSTABLE,
  CACHE_REL,
  isStableVersion,
  isUnstableVersion,
  isSpecVersion,
  archiveBaseFor,
  specFileName,
  specUrl,
  cachePathFor,
  readCachedSpec,
  fetchSpec,
};
