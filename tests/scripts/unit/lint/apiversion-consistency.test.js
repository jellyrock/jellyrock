// Tests for scripts/lint/apiversion-consistency-check.js — the static cross-check
// that source/utils/misc.bs resolveApiVersion() matches the boundary map.
//
// Pure layer: parse fixture .bs strings into ASTs (the same BrighterScript parser
// the lint uses), extract, and diff against hand-written boundary maps. Plus a
// smoke pass over the REAL committed misc.bs + boundary map so a drift in either
// fails here (offline — no Roku hardware, which is the whole point of this lint).

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as bs from 'brighterscript';
import {
  extractResolveApiVersion,
  diffAgainstBoundaries,
} from '../../../../scripts/lint/apiversion-consistency-check.js';

const require = createRequire(import.meta.url);
const { loadBoundaries } = require('../../../../scripts/lib/version-boundaries.cjs');
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');

const parse = (src) => bs.Parser.parse(src).ast;

// A resolveApiVersion body with the given guard lines (highest version first) and
// fallback. `guards` = [[version, tier], …].
function fnSource(guards, fallback = 1) {
  const lines = guards.map(
    ([v, t]) => `  if versionChecker(serverVersion, "${v}")\n    return ${t}\n  end if`,
  );
  return [
    'function resolveApiVersion(serverVersion as string) as integer',
    '  if not isValidAndNotEmpty(serverVersion)',
    '    return 1',
    '  end if',
    ...lines,
    `  return ${fallback}`,
    'end function',
  ].join('\n');
}

const TWO_TIER = {
  floor: '10.7.0',
  tiers: {
    1: { minServer: '10.7.0', maxServer: '10.8.13', status: 'frozen' },
    2: { minServer: '10.9.0', maxServer: null, status: 'active' },
  },
};

// A V3 split where Jellyfin drops the "10." major — 12.0.0 is the new active tier.
const THREE_TIER_CROSS_MAJOR = {
  floor: '10.7.0',
  tiers: {
    1: { minServer: '10.7.0', maxServer: '10.8.13', status: 'frozen' },
    2: { minServer: '10.9.0', maxServer: '11.99.99', status: 'frozen' },
    3: { minServer: '12.0.0', maxServer: null, status: 'active' },
  },
};

describe('extractResolveApiVersion', () => {
  it('pulls the guard pairs + fallback, ignoring the validity-guard if', () => {
    const ast = parse(fnSource([['10.9.0', 2]]));
    expect(extractResolveApiVersion(ast)).toEqual({
      guards: [{ minVersion: '10.9.0', tier: 2 }],
      fallback: 1,
    });
  });

  it('throws a clear error when the function is absent', () => {
    expect(() =>
      extractResolveApiVersion(parse('function other()\nreturn 0\nend function')),
    ).toThrow(/resolveApiVersion\(\) not found/);
  });
});

describe('diffAgainstBoundaries', () => {
  it('passes when the twin matches the 2-tier map', () => {
    const ext = extractResolveApiVersion(parse(fnSource([['10.9.0', 2]])));
    expect(diffAgainstBoundaries(ext, TWO_TIER)).toEqual([]);
  });

  it('passes for a cross-major V3 split (12.0.0 active, "dropping the 10")', () => {
    const ext = extractResolveApiVersion(
      parse(
        fnSource([
          ['12.0.0', 3],
          ['10.9.0', 2],
        ]),
      ),
    );
    expect(diffAgainstBoundaries(ext, THREE_TIER_CROSS_MAJOR)).toEqual([]);
  });

  it('flags a half-built tier (boundary map has V3 but resolveApiVersion lacks the guard)', () => {
    const ext = extractResolveApiVersion(parse(fnSource([['10.9.0', 2]])));
    const problems = diffAgainstBoundaries(ext, THREE_TIER_CROSS_MAJOR);
    expect(problems.join('\n')).toMatch(/missing guard for tier 3.*12\.0\.0.*return 3/);
  });

  it('flags a guard version that disagrees with the boundary minServer', () => {
    const ext = extractResolveApiVersion(
      parse(
        fnSource([
          ['12.0.1', 3],
          ['10.9.0', 2],
        ]),
      ),
    );
    const problems = diffAgainstBoundaries(ext, THREE_TIER_CROSS_MAJOR);
    expect(problems.join('\n')).toMatch(
      /tier 3 guard checks "12\.0\.1" but boundary map minServer is "12\.0\.0"/,
    );
  });

  it('flags a wrong fallback tier', () => {
    const ext = extractResolveApiVersion(parse(fnSource([['10.9.0', 2]], 2)));
    expect(diffAgainstBoundaries(ext, TWO_TIER).join('\n')).toMatch(
      /fallback return is 2, expected 1/,
    );
  });

  it('flags guards in the wrong order (ascending instead of highest-first)', () => {
    const ext = extractResolveApiVersion(
      parse(
        fnSource([
          ['10.9.0', 2],
          ['12.0.0', 3],
        ]),
      ),
    );
    expect(diffAgainstBoundaries(ext, THREE_TIER_CROSS_MAJOR).join('\n')).toMatch(/out of order/);
  });
});

describe('the committed misc.bs + boundary map', () => {
  it('resolveApiVersion() matches the real boundary map (offline drift gate)', () => {
    const boundaries = loadBoundaries(REPO_ROOT);
    const src = readFileSync(resolve(REPO_ROOT, 'source/utils/misc.bs'), 'utf8');
    const ext = extractResolveApiVersion(parse(src));
    expect(diffAgainstBoundaries(ext, boundaries)).toEqual([]);
  });
});
