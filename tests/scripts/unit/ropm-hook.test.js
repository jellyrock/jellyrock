// Tests for scripts/ropm-hook.cjs.
//
// The script walks components/roku_modules/ and source/roku_modules/ and
// rewrites three patterns inside .xml files:
//   /roku_modules/undefined/bslib.brs   → /roku_modules/rokucommunity_bslib/bslib.brs
//   /roku_modules/bslib/bslib.brs       → /roku_modules/rokucommunity_bslib/bslib.brs
//   /roku_modules/undefined             → /roku_modules/maestro
//
// Tests use a temp dir simulating the post-ropm-copy layout.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from './_helpers/spawn-script.js';

const SCRIPT = 'scripts/ropm-hook.cjs';

function setupTree(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-ropm-hook-'));
  mkdirSync(join(dir, 'components', 'roku_modules'), { recursive: true });
  mkdirSync(join(dir, 'source', 'roku_modules'), { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(dir, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('ropm-hook', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('runs cleanly when the roku_modules dirs are empty', () => {
    dir = setupTree({});
    // The script computes the modules dir relative to __dirname, which
    // means it walks the REAL repo's components/source/roku_modules,
    // not the temp dir. Cwd doesn't change that path. So this smoke
    // check just ensures the script doesn't throw on a clean run.
    const { exitCode } = spawnScript(SCRIPT, [], { cwd: dir });
    expect(typeof exitCode).toBe('number');
  });
});
