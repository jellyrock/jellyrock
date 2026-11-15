// The ESLint config must ignore the gitignored download cache. A full checkout of
// another project under `.cache/` carries its own eslint.config.*, which ESLint
// loads and crashes on when that project's plugins are not installed here.

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

describe('eslint.config.js ignores', () => {
  it('ignores a cloned source checkout under .cache/', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const ignored = await eslint.isPathIgnored('.cache/translation-seed/x-code/eslint.config.mjs');
    expect(ignored).toBe(true);
  });
});
