// Smoke tests for scripts/lint/check-touched-lint.cjs.
//
// The script invokes spell / markdown / json linters as child processes
// against the working tree (committed + uncommitted + untracked files).
// Full coverage requires those linters' fixtures, which is heavy. Here we
// verify the script's basic shape: clean tree → 0 output, --quiet works,
// it can run from a non-repo directory without crashing.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';

const SCRIPT = 'scripts/lint/check-touched-lint.cjs';

function git(repoDir, ...args) {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' });
}

describe('check-touched-lint (smoke)', () => {
  let dir;

  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('runs without crashing on a clean working tree', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-check-touched-lint-'));
    git(dir, 'init', '--quiet', '--initial-branch=main');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    writeFileSync(join(dir, 'README.md'), '# Heading\n\nbody\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'init');

    const { exitCode } = spawnScript(SCRIPT, ['--quiet'], { cwd: dir });
    expect(exitCode).toBe(0);
  });

  it('exits 0 (always informational) even from a non-git directory', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-check-touched-lint-nogit-'));
    mkdirSync(join(dir, 'subdir'), { recursive: true });
    const { exitCode } = spawnScript(SCRIPT, ['--quiet'], { cwd: dir });
    // Non-zero would surprise the agent harness; the script's contract is
    // "exit 0 always" so callers don't have to gate on it.
    expect(exitCode).toBe(0);
  });
});
