// Smoke test for scripts/create-package.cjs.
//
// The script wraps roku-deploy.zipPackage() to produce out/jellyrock.zip from
// build/. This test points both directories at temp dirs with --staging-dir
// and --out-dir, so the run never touches the checkout's real out/.

import { describe, it, expect } from 'vitest';
import { spawnScript } from './_helpers/spawn-script.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ZIP = resolve(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  '..',
  '..',
  'out',
  'jellyrock.zip',
);

/** The real package's state, or null when it does not exist. */
const stampOf = (file) =>
  existsSync(file) ? `${statSync(file).size}:${statSync(file).mtimeMs}` : null;

describe('create-package (smoke)', () => {
  it('zips the staging dir into the out dir it was given and leaves the real out/ alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jellyrock-create-package-'));
    const stagingDir = join(dir, 'build');
    const outDir = join(dir, 'out');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'manifest'), 'title=test\n');
    const before = stampOf(REPO_ZIP);
    try {
      const { exitCode, stderr } = spawnScript(
        'scripts/create-package.cjs',
        ['--staging-dir', stagingDir, '--out-dir', outDir],
        { cwd: dir },
      );
      expect(stderr).toBe('');
      expect(exitCode).toBe(0);
      expect(existsSync(join(outDir, 'jellyrock.zip'))).toBe(true);
      expect(stampOf(REPO_ZIP)).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolves relative flag values against the cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jellyrock-create-package-'));
    mkdirSync(join(dir, 'stage'), { recursive: true });
    writeFileSync(join(dir, 'stage', 'manifest'), 'title=test\n');
    try {
      const { exitCode } = spawnScript(
        'scripts/create-package.cjs',
        ['--staging-dir', 'stage', '--out-dir', 'pkg'],
        {
          cwd: dir,
        },
      );
      expect(exitCode).toBe(0);
      expect(existsSync(join(dir, 'pkg', 'jellyrock.zip'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an unknown argument with exit 1', () => {
    const { exitCode, stderr } = spawnScript('scripts/create-package.cjs', ['--bogus']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('--bogus');
  });
});
