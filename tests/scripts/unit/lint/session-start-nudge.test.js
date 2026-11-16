// Tests for scripts/lint/session-start-nudge.cjs, the install-freshness line.
// The script reads the repo from CLAUDE_PROJECT_DIR, so each test points it at
// a temp checkout. It always exits 0 and stays silent when nothing is actionable.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';

const SCRIPT = 'scripts/lint/session-start-nudge.cjs';

let root;

function write(rel, data) {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, JSON.stringify(data));
}

function makeCheckout(installedVersion) {
  const entry = (version) => ({ version, integrity: `sha512-${version}` });
  write('package-lock.json', { packages: { '': {}, 'node_modules/a': entry('1.0.0') } });
  write('node_modules/.package-lock.json', {
    packages: { 'node_modules/a': entry(installedVersion) },
  });
  write('node_modules/.jellyrock-patches.json', {});
}

const run = () => spawnScript(SCRIPT, [], { env: { CLAUDE_PROJECT_DIR: root } });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'session-nudge-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('session-start-nudge / install freshness', () => {
  it('is silent when the install matches the lockfile', () => {
    makeCheckout('1.0.0');
    const r = run();
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('prints one advisory line when the install is stale, and still exits 0', () => {
    makeCheckout('0.9.0');
    const r = run();
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('npm run check:install');
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('stays silent and exits 0 when there is no lockfile to compare', () => {
    const r = run();
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('');
  });
});
