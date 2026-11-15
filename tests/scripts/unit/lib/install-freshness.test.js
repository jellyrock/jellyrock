// Tests for scripts/lib/install-freshness.cjs: the check that node_modules
// matches package-lock.json and patches/. Each case builds a fixture checkout
// in a temp dir: a lockfile, npm's installed record, a patches folder.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnScript } from '../_helpers/spawn-script.js';

const require = createRequire(import.meta.url);
const { checkInstall, recordPatches } = require('../../../../scripts/lib/install-freshness.cjs');

const SCRIPT = 'scripts/lib/install-freshness.cjs';

const pkg = (version, extra = {}) => ({
  version,
  resolved: `https://registry.example/${version}.tgz`,
  integrity: `sha512-${version}`,
  ...extra,
});

let root;

function write(rel, content) {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
}

// Lay down a fresh checkout: matching lockfile and install record, one patch, and its record.
function makeFresh() {
  const packages = {
    'node_modules/a': pkg('1.0.0'),
    'node_modules/b': pkg('2.0.0'),
  };
  write('package-lock.json', { packages: { '': { version: '3.0.0' }, ...packages } });
  write('node_modules/.package-lock.json', { packages });
  write('patches/a+1.0.0.patch', 'diff a\n');
  recordPatches(root);
}

function lock(mutate) {
  const lockPath = join(root, 'package-lock.json');
  const data = JSON.parse(require('node:fs').readFileSync(lockPath, 'utf8'));
  mutate(data.packages);
  write('package-lock.json', data);
}

function installed(mutate) {
  const p = join(root, 'node_modules/.package-lock.json');
  const data = JSON.parse(require('node:fs').readFileSync(p, 'utf8'));
  mutate(data.packages);
  write('node_modules/.package-lock.json', data);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'install-freshness-'));
  makeFresh();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('install-freshness / packages', () => {
  it('passes on a fresh checkout', () => {
    expect(checkInstall(root)).toEqual({ fresh: true, problems: [] });
  });

  it('fails on a changed version, naming the package', () => {
    installed((p) => (p['node_modules/a'] = pkg('0.9.0')));
    const r = checkInstall(root);
    expect(r.fresh).toBe(false);
    expect(r.problems.join('\n')).toContain('node_modules/a');
    expect(r.problems.join('\n')).toContain('0.9.0');
  });

  it('fails on a changed integrity at the same version', () => {
    installed((p) => (p['node_modules/a'].integrity = 'sha512-other'));
    expect(checkInstall(root).fresh).toBe(false);
  });

  it('fails on a missing non-optional package', () => {
    installed((p) => delete p['node_modules/b']);
    const r = checkInstall(root);
    expect(r.fresh).toBe(false);
    expect(r.problems.join('\n')).toContain('node_modules/b');
  });

  it('fails on an extra installed package', () => {
    installed((p) => (p['node_modules/extra'] = pkg('1.1.1')));
    const r = checkInstall(root);
    expect(r.fresh).toBe(false);
    expect(r.problems.join('\n')).toContain('node_modules/extra');
  });

  it('fails on a missing install record', () => {
    rmSync(join(root, 'node_modules/.package-lock.json'));
    const r = checkInstall(root);
    expect(r.fresh).toBe(false);
    expect(r.problems.join('\n')).toContain('no install record');
  });

  it('passes when an optional package is absent from the record', () => {
    lock((p) => (p['node_modules/plat'] = pkg('1.0.0', { optional: true })));
    expect(checkInstall(root).fresh).toBe(true);
  });

  it('passes when a devOptional package is absent from the record', () => {
    lock((p) => (p['node_modules/plat2'] = pkg('1.0.0', { devOptional: true })));
    expect(checkInstall(root).fresh).toBe(true);
  });

  it('passes when only the root entry version changed', () => {
    lock((p) => (p[''] = { version: '9.9.9' }));
    expect(checkInstall(root).fresh).toBe(true);
  });

  it('compares a link entry by its target', () => {
    lock((p) => (p['node_modules/l'] = { resolved: 'pkgs/l', link: true }));
    installed((p) => (p['node_modules/l'] = { resolved: 'pkgs/l', link: true }));
    expect(checkInstall(root).fresh).toBe(true);
    installed((p) => (p['node_modules/l'] = { resolved: 'pkgs/other', link: true }));
    expect(checkInstall(root).fresh).toBe(false);
  });

  it('caps a long problem list with a count of the rest', () => {
    installed((p) => {
      for (let i = 0; i < 25; i++) p[`node_modules/x${i}`] = pkg('1.0.0');
    });
    const r = checkInstall(root);
    expect(r.problems.length).toBeLessThanOrEqual(11);
    expect(r.problems[r.problems.length - 1]).toMatch(/and 15 more/);
  });
});

describe('install-freshness / patches', () => {
  it('fails on an added patch', () => {
    write('patches/b+2.0.0.patch', 'diff b\n');
    const r = checkInstall(root);
    expect(r.fresh).toBe(false);
    expect(r.problems.join('\n')).toContain('b+2.0.0.patch');
  });

  it('fails on a changed patch', () => {
    write('patches/a+1.0.0.patch', 'diff a changed\n');
    expect(checkInstall(root).fresh).toBe(false);
  });

  it('fails on a removed patch', () => {
    rmSync(join(root, 'patches/a+1.0.0.patch'));
    expect(checkInstall(root).fresh).toBe(false);
  });

  it('fails on a missing patch record', () => {
    rmSync(join(root, 'node_modules/.jellyrock-patches.json'));
    const r = checkInstall(root);
    expect(r.fresh).toBe(false);
    expect(r.problems.join('\n')).toContain('patch record');
  });

  it('records the hashes sorted by name', () => {
    write('patches/0.patch', 'zero\n');
    recordPatches(root);
    const rec = JSON.parse(
      require('node:fs').readFileSync(join(root, 'node_modules/.jellyrock-patches.json'), 'utf8'),
    );
    expect(Object.keys(rec)).toEqual(['0.patch', 'a+1.0.0.patch']);
    expect(checkInstall(root).fresh).toBe(true);
  });

  it('passes with no patches folder and a record of none', () => {
    rmSync(join(root, 'patches'), { recursive: true });
    recordPatches(root);
    expect(checkInstall(root).fresh).toBe(true);
  });
});

describe('install-freshness / CLI', () => {
  it('exits 0 and prints nothing on a fresh checkout', () => {
    const r = spawnScript(SCRIPT, ['--root', root]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('exits 1 with the problems and the fix line on a stale checkout', () => {
    installed((p) => (p['node_modules/a'] = pkg('0.9.0')));
    const r = spawnScript(SCRIPT, ['--root', root]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain(
      "Installed packages don't match package-lock.json or patches/. Run npm ci, then retry.",
    );
  });

  it('exits 2 when the lockfile cannot be read', () => {
    rmSync(join(root, 'package-lock.json'));
    expect(spawnScript(SCRIPT, ['--root', root]).exitCode).toBe(2);
  });

  it('--record-patches writes the record', () => {
    rmSync(join(root, 'node_modules/.jellyrock-patches.json'));
    const r = spawnScript(SCRIPT, ['--root', root, '--record-patches']);
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(root, 'node_modules/.jellyrock-patches.json'))).toBe(true);
  });
});
