// scripts/ci/pull-main.sh: catch up with origin/main, and run `npm ci` only when
// the pull left node_modules out of step with the lockfile. A fake `npm` first on
// PATH records its arguments and answers `check:install` from FAKE_INSTALL_STALE.

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitSafeEnv } from '../_helpers/git-env.js';

const SCRIPT = resolve(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  '..',
  '..',
  '..',
  'scripts',
  'ci',
  'pull-main.sh',
);

let root;
let work;
let origin;
let npmLog;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: gitSafeEnv() }).trim();
}

function run({ stale = false, cwd = work } = {}) {
  return spawnSync('bash', [SCRIPT], {
    cwd,
    encoding: 'utf8',
    env: {
      ...gitSafeEnv(),
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      NPM_LOG: npmLog,
      FAKE_INSTALL_STALE: stale ? '1' : '0',
    },
  });
}

function npmCalls() {
  return existsSync(npmLog) ? readFileSync(npmLog, 'utf8').trim().split('\n').filter(Boolean) : [];
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pull-main-'));
  origin = join(root, 'origin.git');
  work = join(root, 'work');
  npmLog = join(root, 'npm.log');
  execFileSync('mkdir', ['-p', join(root, 'bin')]);
  writeFileSync(
    join(root, 'bin', 'npm'),
    '#!/usr/bin/env bash\necho "$*" >> "$NPM_LOG"\n' +
      'if [ "$*" = "run -s check:install" ]; then [ "$FAKE_INSTALL_STALE" = 1 ] && exit 1; fi\nexit 0\n',
  );
  chmodSync(join(root, 'bin', 'npm'), 0o755);

  git(root, 'init', '--bare', '-b', 'main', origin);
  git(root, 'clone', origin, work);
  git(work, 'config', 'user.email', 't@example.com');
  git(work, 'config', 'user.name', 'Test');
  writeFileSync(join(work, 'a.txt'), 'one\n');
  git(work, 'add', '.');
  git(work, 'commit', '-m', 'first');
  git(work, 'push', 'origin', 'main');

  // A second clone moves origin/main ahead, as a merged dependency bump would.
  const other = join(root, 'other');
  git(root, 'clone', origin, other);
  git(other, 'config', 'user.email', 't@example.com');
  git(other, 'config', 'user.name', 'Test');
  writeFileSync(join(other, 'package-lock.json'), '{}\n');
  git(other, 'add', '.');
  git(other, 'commit', '-m', 'bump');
  git(other, 'push', 'origin', 'main');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('pull-main.sh', () => {
  it('pulls origin/main forward', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(git(work, 'rev-parse', 'HEAD')).toBe(git(origin, 'rev-parse', 'main'));
  });

  it('skips npm ci when the install is still fresh', () => {
    const r = run({ stale: false });
    expect(r.status).toBe(0);
    expect(npmCalls()).toEqual(['run -s check:install']);
  });

  it('runs npm ci when the pull left the install stale', () => {
    const r = run({ stale: true });
    expect(r.status).toBe(0);
    expect(npmCalls()).toEqual(['run -s check:install', 'ci']);
    expect(r.stdout).toMatch(/new lockfile or patches/);
  });

  it('exits nonzero and runs no npm when the pull fails', () => {
    git(work, 'remote', 'remove', 'origin');
    const r = run({ stale: true });
    expect(r.status).not.toBe(0);
    expect(npmCalls()).toEqual([]);
  });
});
