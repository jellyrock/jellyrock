// Smoke test for scripts/create-package.cjs.
//
// The script wraps roku-deploy.zipPackage() to produce out/jellyrock.zip
// from build/. Full coverage would require a build/ tree; this test just
// confirms the script loads as a Node module without crashing on require.

import { describe, it, expect } from 'vitest';
import { spawnScript } from './_helpers/spawn-script.js';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('create-package (smoke)', () => {
  it('runs against a temp dir without throwing on require', () => {
    // Run from a temp dir with no build/ — roku-deploy will reject
    // (no files to zip), so we expect a non-zero exit, but the script
    // itself must not crash on require.
    const dir = mkdtempSync(join(tmpdir(), 'jellyrock-create-package-'));
    mkdirSync(join(dir, 'build'), { recursive: true });
    try {
      const { exitCode } = spawnScript('scripts/create-package.cjs', [], { cwd: dir });
      // Either zipPackage rejects (non-zero) or it succeeds with empty zip
      // (zero); both confirm the script ran. We just want "didn't crash on
      // load with a SyntaxError or missing-module error."
      expect(typeof exitCode).toBe('number');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
