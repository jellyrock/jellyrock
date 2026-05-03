// Tests for scripts/create-signed-package.cjs.
//
// The script wraps roku-deploy.deployAndSignPackage(). Hardware-touching
// behavior is out of scope here; we cover the surface the script owns:
// env-var validation and fail-fast on missing prerequisites.

import { describe, it, expect } from 'vitest';
import { spawnScript } from './_helpers/spawn-script.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-create-signed-pkg-'));
  return {
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('create-signed-package', () => {
  it('fails fast when ROKU_IP is missing', () => {
    const ws = freshWorkspace();
    try {
      const { exitCode, stderr } = spawnScript('scripts/create-signed-package.cjs', [], {
        cwd: ws.dir,
        env: {
          ROKU_IP: '',
          ROKU_PASSWORD: 'pw',
          ROKU_SIGNING_PASSWORD: 'sp',
        },
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/ROKU_IP/);
    } finally {
      ws.cleanup();
    }
  });

  it('fails fast when ROKU_PASSWORD is missing', () => {
    const ws = freshWorkspace();
    try {
      const { exitCode, stderr } = spawnScript('scripts/create-signed-package.cjs', [], {
        cwd: ws.dir,
        env: {
          ROKU_IP: '1.2.3.4',
          ROKU_PASSWORD: '',
          ROKU_SIGNING_PASSWORD: 'sp',
        },
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/ROKU_PASSWORD/);
    } finally {
      ws.cleanup();
    }
  });

  it('fails fast when ROKU_SIGNING_PASSWORD is missing', () => {
    const ws = freshWorkspace();
    try {
      const { exitCode, stderr } = spawnScript('scripts/create-signed-package.cjs', [], {
        cwd: ws.dir,
        env: {
          ROKU_IP: '1.2.3.4',
          ROKU_PASSWORD: 'pw',
          ROKU_SIGNING_PASSWORD: '',
        },
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/ROKU_SIGNING_PASSWORD/);
    } finally {
      ws.cleanup();
    }
  });

  it("fails when build/ directory doesn't exist (env validated, build missing)", () => {
    // All required env present but no build/ — script should reject with a
    // clear "run npm run build:prod first" message BEFORE attempting any
    // network call to the Roku.
    const ws = freshWorkspace();
    try {
      const { exitCode, stderr } = spawnScript('scripts/create-signed-package.cjs', [], {
        cwd: ws.dir,
        env: {
          ROKU_IP: '1.2.3.4',
          ROKU_PASSWORD: 'pw',
          ROKU_SIGNING_PASSWORD: 'sp',
        },
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/build:prod/);
    } finally {
      ws.cleanup();
    }
  });

  it('refuses to sign a build/ that contains source maps (dev/test build guard)', () => {
    // Source maps in build/ mean the build came from bsconfig.json or
    // bsconfig-tests*.json (both have sourceMap=true). Only bsconfig-prod.json
    // produces a signing-safe build (sourceMap=false). The script must
    // refuse before reaching deployAndSignPackage.
    const ws = freshWorkspace();
    try {
      const buildDir = join(ws.dir, 'build');
      mkdirSync(join(buildDir, 'source'), { recursive: true });
      writeFileSync(join(buildDir, 'source', 'main.brs'), 'sub Main()\nend sub\n');
      writeFileSync(join(buildDir, 'source', 'main.brs.map'), '{}');
      const { exitCode, stderr } = spawnScript('scripts/create-signed-package.cjs', [], {
        cwd: ws.dir,
        env: {
          ROKU_IP: '1.2.3.4',
          ROKU_PASSWORD: 'pw',
          ROKU_SIGNING_PASSWORD: 'sp',
        },
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/source maps/);
      expect(stderr).toMatch(/main\.brs\.map/);
    } finally {
      ws.cleanup();
    }
  });

  it('fails when build/manifest is missing (need version for filename)', () => {
    // Prod build with no source maps but no manifest — script can't compute
    // the version-tagged filename, so it must bail before signing rather than
    // produce an unversioned .pkg.
    const ws = freshWorkspace();
    try {
      const buildDir = join(ws.dir, 'build');
      mkdirSync(buildDir, { recursive: true });
      const { exitCode, stderr } = spawnScript('scripts/create-signed-package.cjs', [], {
        cwd: ws.dir,
        env: {
          ROKU_IP: '1.2.3.4',
          ROKU_PASSWORD: 'pw',
          ROKU_SIGNING_PASSWORD: 'sp',
        },
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/manifest/);
    } finally {
      ws.cleanup();
    }
  });

  it('fails when manifest is present but missing version fields', () => {
    const ws = freshWorkspace();
    try {
      const buildDir = join(ws.dir, 'build');
      mkdirSync(buildDir, { recursive: true });
      writeFileSync(join(buildDir, 'manifest'), 'title=JellyRock\n');
      const { exitCode, stderr } = spawnScript('scripts/create-signed-package.cjs', [], {
        cwd: ws.dir,
        env: {
          ROKU_IP: '1.2.3.4',
          ROKU_PASSWORD: 'pw',
          ROKU_SIGNING_PASSWORD: 'sp',
        },
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/major_version/);
    } finally {
      ws.cleanup();
    }
  });
});
