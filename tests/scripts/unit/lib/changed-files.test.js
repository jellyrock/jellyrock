// Tests for scripts/lib/changed-files.cjs.
//
// Wraps git diff invocations via execSync; tests use a real temp git
// repo rather than mocking. Slightly slower per test (init + commit
// overhead) but matches the production code path exactly.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { changedFiles, workingTreeFiles } = require('../../../../scripts/lib/changed-files.cjs');

function git(repoDir, ...args) {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' });
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-changed-files-'));
  git(dir, 'init', '--quiet', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  // Need at least one commit for HEAD to exist.
  writeFileSync(join(dir, 'baseline.txt'), 'initial\n');
  git(dir, 'add', 'baseline.txt');
  git(dir, 'commit', '--quiet', '-m', 'initial');
  return dir;
}

describe('changed-files / workingTreeFiles', () => {
  let repoDir;
  let cwdBefore;

  beforeEach(() => {
    repoDir = initRepo();
    cwdBefore = process.cwd();
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(cwdBefore);
    if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns [] on a clean working tree', () => {
    expect(workingTreeFiles()).toEqual([]);
  });

  it('returns modified + untracked files, deduped', () => {
    writeFileSync(join(repoDir, 'baseline.txt'), 'mutated\n'); // modified
    writeFileSync(join(repoDir, 'fresh.txt'), 'new file\n'); // untracked
    const result = workingTreeFiles().sort();
    expect(result).toEqual(['baseline.txt', 'fresh.txt']);
  });
});

describe('changed-files / changedFiles', () => {
  let repoDir;
  let cwdBefore;

  beforeEach(() => {
    repoDir = initRepo();
    cwdBefore = process.cwd();
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(cwdBefore);
    if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns committed-since-base + working tree, deduped', () => {
    // Make a base ref that points at the initial commit, then add a
    // new committed file + an untracked file on top.
    git(repoDir, 'branch', 'base', 'HEAD');
    writeFileSync(join(repoDir, 'committed.txt'), 'on top\n');
    git(repoDir, 'add', 'committed.txt');
    git(repoDir, 'commit', '--quiet', '-m', 'add committed');
    writeFileSync(join(repoDir, 'fresh.txt'), 'new\n');

    const result = changedFiles('base').sort();
    expect(result).toEqual(['committed.txt', 'fresh.txt']);
  });

  it('falls through candidates without throwing when base ref is unresolvable', () => {
    // No branches named "missing-base" or "origin/missing-base" or "main"
    // (well, `main` exists in our test repo, so origin/main fallback
    // succeeds and returns an empty diff). The point: no throw.
    expect(() => changedFiles('missing-base')).not.toThrow();
  });
});
