// The pre-push hook regenerates the API usage manifest only when a changed
// file matches its HAS_API_MANIFEST_SOURCES pattern. That pattern must cover
// everything scripts/generate/api-usage-manifest.js reads, or a change to an
// input skips the regenerate and fails the later docs:api-manifest:check.
//
// The generator does not export its scope constants, so they are read from
// its source text.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../../..');
const GENERATOR = 'scripts/generate/api-usage-manifest.js';

function read(rel) {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

function hookPattern() {
  const line = read('.husky/pre-push')
    .split('\n')
    .find((l) => l.startsWith('HAS_API_MANIFEST_SOURCES='));
  const m = line && line.match(/grep -qE '([^']+)'/);
  if (!m) throw new Error('HAS_API_MANIFEST_SOURCES grep -qE pattern not found in .husky/pre-push');
  return new RegExp(m[1]);
}

function constArray(name) {
  const m = read(GENERATOR).match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  if (!m) throw new Error(`${name} not found in ${GENERATOR}`);
  const body = m[1].replace(/^\s*\/\/.*$/gm, '');
  return [...body.matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('pre-push HAS_API_MANIFEST_SOURCES pattern', () => {
  const re = hookPattern();

  it('matches every RESPONSE_FIELD_FILES entry', () => {
    const files = constArray('RESPONSE_FIELD_FILES');
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(re.test(f), f).toBe(true);
  });

  it('matches a sample path under every ENDPOINT_GLOBS scope', () => {
    const globs = constArray('ENDPOINT_GLOBS');
    expect(globs.length).toBeGreaterThan(0);
    for (const g of globs) {
      const sample = g.replace('**/*', 'utils/mediaSegments');
      expect(re.test(sample), sample).toBe(true);
    }
    expect(re.test('source/utils/mediaSegments.bs')).toBe(true);
  });

  it('matches the generator script itself', () => {
    expect(re.test(GENERATOR)).toBe(true);
  });

  it('does not match paths outside the generator scope', () => {
    expect(re.test('docs/x.md')).toBe(false);
    expect(re.test('components/foo/Foo.bs')).toBe(false);
  });
});
