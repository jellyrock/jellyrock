// Tests for scripts/lib/version-boundaries.cjs.
//
// Two layers: the pure validator/accessors against hand-written map objects,
// and a load + sanity pass over the REAL committed map so a malformed edit to
// docs/dev/jellyfin-version-boundaries.yml fails here. createRequire loads the
// .cjs module cleanly under Vitest's ESM runner (same pattern as the sibling
// signals-fetch / frontmatter lib tests).

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  loadBoundaries,
  validateBoundaries,
  serverToTier,
  isTierFrozen,
} = require('../../../../scripts/lib/version-boundaries.cjs');

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');

// A minimal valid two-tier map mirroring the real one's shape.
function validMap() {
  return {
    floor: '10.7.0',
    tiers: {
      1: { minServer: '10.7.0', maxServer: '10.8.13', status: 'frozen' },
      2: { minServer: '10.9.0', maxServer: null, status: 'active' },
    },
  };
}

describe('validateBoundaries', () => {
  it('accepts a well-formed map', () => {
    expect(() => validateBoundaries(validMap())).not.toThrow();
  });

  it('rejects a non-semver floor', () => {
    const m = validMap();
    m.floor = '10.7';
    expect(() => validateBoundaries(m)).toThrow(/floor must be/);
  });

  it('rejects a non-integer tier key', () => {
    const m = validMap();
    m.tiers.foo = { minServer: '10.9.0', maxServer: null, status: 'active' };
    expect(() => validateBoundaries(m)).toThrow(/tier key must be a positive integer/);
  });

  it('rejects an unknown status', () => {
    const m = validMap();
    m.tiers[1].status = 'retired';
    expect(() => validateBoundaries(m)).toThrow(/status must be one of/);
  });

  it('rejects minServer greater than maxServer', () => {
    const m = validMap();
    m.tiers[1] = { minServer: '10.9.0', maxServer: '10.8.0', status: 'frozen' };
    expect(() => validateBoundaries(m)).toThrow(/minServer is greater than maxServer/);
  });

  it('rejects more than one active tier', () => {
    const m = validMap();
    m.tiers[1].status = 'active';
    m.tiers[1].maxServer = null;
    expect(() => validateBoundaries(m)).toThrow(/exactly one active tier/);
  });

  it('rejects zero active tiers', () => {
    const m = validMap();
    m.tiers[2].status = 'frozen';
    m.tiers[2].maxServer = '10.11.0';
    expect(() => validateBoundaries(m)).toThrow(/exactly one active tier/);
  });

  it('rejects an active tier that is not unbounded above', () => {
    const m = validMap();
    m.tiers[2].maxServer = '10.11.0';
    expect(() => validateBoundaries(m)).toThrow(/active tier must have maxServer: null/);
  });
});

describe('serverToTier', () => {
  const m = validMap();

  it('maps floor and frozen-range versions to tier 1', () => {
    expect(serverToTier(m, '10.7.0')).toBe(1);
    expect(serverToTier(m, '10.8.13')).toBe(1);
  });

  it('maps the active range (incl. open-ended top) to tier 2', () => {
    expect(serverToTier(m, '10.9.0')).toBe(2);
    expect(serverToTier(m, '10.11.10')).toBe(2);
    expect(serverToTier(m, '11.0.0')).toBe(2); // unbounded active tier
  });

  it('returns null below the floor', () => {
    expect(serverToTier(m, '10.6.0')).toBeNull();
  });

  it('returns null inside the gap between frozen and active tiers', () => {
    // 10.8.13 < x < 10.9.0 is unreachable in practice, but the map has no row
    // covering it, so the lookup is honest about the miss rather than guessing.
    expect(serverToTier(m, '10.8.99')).toBeNull();
  });

  it('returns null for a malformed version string', () => {
    expect(serverToTier(m, 'latest')).toBeNull();
  });
});

describe('isTierFrozen', () => {
  const m = validMap();
  it('reports the frozen tier as frozen and the active tier as not', () => {
    expect(isTierFrozen(m, 1)).toBe(true);
    expect(isTierFrozen(m, 2)).toBe(false);
    expect(isTierFrozen(m, 99)).toBe(false); // unknown tier
  });
});

describe('the committed map', () => {
  it('loads + validates against the real repo file', () => {
    const b = loadBoundaries(REPO_ROOT);
    expect(b.floor).toBe('10.7.0');
    // Sanity: the floor maps to a real tier and the documented split holds.
    expect(serverToTier(b, b.floor)).toBe(1);
    expect(serverToTier(b, '10.9.0')).toBe(2);
  });
});
