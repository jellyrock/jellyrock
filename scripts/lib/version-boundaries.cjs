// scripts/lib/version-boundaries.cjs — loader + accessors for the committed
// Jellyfin server-version → apiVersion tier boundary map
// (docs/dev/jellyfin-version-boundaries.yml).
//
// This is the source-of-truth bridge between JellyRock's integer apiVersion
// tiers and concrete server versions. The server-upgrade-automation pipeline
// (docs/architecture/server-upgrade-automation.md) uses it in Phase 2 to map a
// spec change at server version X onto a tier, and to decide tier relevance
// (frozen tiers can't break upstream). Phase 1 ships the map + this validated
// loader so Phase 2 has a tested surface to build on.
//
// `.cjs` per scripts/CLAUDE.md's module rule (lib/ helpers are CJS so anything
// — plugins or other .cjs — can require() them; ESM callers use createRequire,
// as scripts/catchup-state.js already does for the sibling signals-fetch.cjs).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { compareSemverBase } = require('./signals-fetch.cjs');
const { isUnstableVersion } = require('./spec-fetch.cjs');

const MAP_REL = 'docs/dev/jellyfin-version-boundaries.yml';
const VALID_STATUSES = new Set(['frozen', 'active']);

function isSemverBase(v) {
  return typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
}

// Validate the parsed map shape, throwing a one-line error on any violation.
// Returns the validated object: { floor, tiers: { <n>: { minServer, maxServer,
// status } } } with integer tier keys preserved as-is from YAML (string keys).
function validateBoundaries(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('version-boundaries: map is empty or not an object');
  }
  if (!isSemverBase(raw.floor)) {
    throw new Error(`version-boundaries: floor must be MAJOR.MINOR.PATCH, got ${raw.floor}`);
  }
  if (!raw.tiers || typeof raw.tiers !== 'object') {
    throw new Error('version-boundaries: missing tiers map');
  }
  const tierKeys = Object.keys(raw.tiers);
  if (tierKeys.length === 0) {
    throw new Error('version-boundaries: tiers map is empty');
  }

  let activeCount = 0;
  for (const key of tierKeys) {
    if (!/^\d+$/.test(key)) {
      throw new Error(`version-boundaries: tier key must be a positive integer, got "${key}"`);
    }
    const tier = raw.tiers[key];
    if (!tier || typeof tier !== 'object') {
      throw new Error(`version-boundaries: tier ${key} is not an object`);
    }
    if (!isSemverBase(tier.minServer)) {
      throw new Error(`version-boundaries: tier ${key} minServer must be MAJOR.MINOR.PATCH`);
    }
    if (tier.maxServer !== null && !isSemverBase(tier.maxServer)) {
      throw new Error(
        `version-boundaries: tier ${key} maxServer must be MAJOR.MINOR.PATCH or null`,
      );
    }
    if (!VALID_STATUSES.has(tier.status)) {
      throw new Error(
        `version-boundaries: tier ${key} status must be one of ${[...VALID_STATUSES].join('/')}`,
      );
    }
    if (tier.maxServer !== null && compareSemverBase(tier.minServer, tier.maxServer) > 0) {
      throw new Error(`version-boundaries: tier ${key} minServer is greater than maxServer`);
    }
    if (tier.status === 'active') activeCount++;
  }

  // Exactly one tier is the open-ended top of the range. More than one would
  // make serverToTier ambiguous; zero means the latest release maps nowhere.
  if (activeCount !== 1) {
    throw new Error(`version-boundaries: expected exactly one active tier, found ${activeCount}`);
  }
  // The active tier MUST be the one with an unbounded maxServer, so the latest
  // release always lands in it (frozen-tier immunity falls out of range math).
  const active = Object.entries(raw.tiers).find(([, t]) => t.status === 'active');
  if (active[1].maxServer !== null) {
    throw new Error('version-boundaries: the active tier must have maxServer: null');
  }
  return raw;
}

// Load + validate the committed boundary map from a repo root (default cwd).
function loadBoundaries(rootDir = '.') {
  const file = path.join(rootDir, MAP_REL);
  const parsed = yaml.load(fs.readFileSync(file, 'utf8'));
  return validateBoundaries(parsed);
}

// The active (top, open-ended) tier integer — validateBoundaries guarantees
// exactly one. null only if called on an unvalidated map.
function activeTier(boundaries) {
  const entry = Object.entries(boundaries.tiers).find(([, t]) => t.status === 'active');
  return entry ? parseInt(entry[0], 10) : null;
}

// Map a server version to its apiVersion tier integer, or null if it falls below
// the floor / outside every tier range. A tier with maxServer:null is unbounded.
//
// Handles all three archive channels:
//   - stable  (10.11.10)        → range lookup against the boundary map;
//   - RC       (10.12.0-rc1)    → resolves to the same tier as its base release
//                                 (the suffix is stripped before comparison);
//   - unstable (20240402201942) → the bleeding edge, ahead of every released
//                                 boundary, so it lands in the active tier by
//                                 definition. We special-case it rather than rely
//                                 on the accidental datestamp-vs-semver ordering.
function serverToTier(boundaries, version) {
  if (isUnstableVersion(version)) return activeTier(boundaries);
  const base = typeof version === 'string' ? version.replace(/-.*$/, '') : version;
  if (!isSemverBase(base)) return null;
  if (compareSemverBase(base, boundaries.floor) < 0) return null;
  for (const [key, tier] of Object.entries(boundaries.tiers)) {
    const atOrAboveMin = compareSemverBase(base, tier.minServer) >= 0;
    const atOrBelowMax = tier.maxServer === null || compareSemverBase(base, tier.maxServer) <= 0;
    if (atOrAboveMin && atOrBelowMax) return parseInt(key, 10);
  }
  return null;
}

// True if the given tier integer is the frozen (closed-upstream) kind — an
// endpoint pinned to it cannot be broken by a future upstream release.
function isTierFrozen(boundaries, tier) {
  const t = boundaries.tiers[String(tier)];
  return !!t && t.status === 'frozen';
}

module.exports = {
  MAP_REL,
  loadBoundaries,
  validateBoundaries,
  serverToTier,
  activeTier,
  isTierFrozen,
};
