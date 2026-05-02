// Tests for scripts/lint/docs-stale-blocking.cjs.
//
// The script runs `git diff <base>...HEAD --name-only` to determine what
// the PR touches, then for each architecture doc whose `last-reviewed` is
// past threshold, blocks if the PR touches the doc's related-files without
// also updating the doc itself. Tests use a real temp git repo.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';

const SCRIPT = 'scripts/lint/docs-stale-blocking.cjs';

function git(repoDir, ...args) {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8' });
}

function fmDoc(date, relatedFiles = []) {
  const fm =
    relatedFiles.length === 0
      ? 'related-files: []'
      : 'related-files:\n' + relatedFiles.map((f) => `  - ${f}`).join('\n');
  return `---\ntopic: foo\n${fm}\nlast-reviewed: ${date}\n---\n# Heading\n\nbody\n`;
}

function setupRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-docs-stale-blocking-'));
  git(dir, 'init', '--quiet', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  mkdirSync(join(dir, 'docs', 'architecture'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), 'init\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '--quiet', '-m', 'init');
  // Tag main as the base; subsequent commits diverge.
  git(dir, 'branch', 'base', 'HEAD');
  return dir;
}

const longAgo = '2020-01-01';
const recent = new Date().toISOString().slice(0, 10);

describe('docs-stale-blocking', () => {
  let dir;

  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 when no docs are stale', () => {
    dir = setupRepo();
    writeFileSync(join(dir, 'docs/architecture/foo.md'), fmDoc(recent, ['source/foo.bs']));
    writeFileSync(join(dir, 'source-foo.bs'), 'sub init()\nend sub\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'add foo');

    const { exitCode, stdout } = spawnScript(SCRIPT, ['--base', 'base'], { cwd: dir });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/No stale-doc territory violations/);
  });

  it('exits 0 when stale doc exists but PR does not touch its territory', () => {
    dir = setupRepo();
    writeFileSync(join(dir, 'docs/architecture/foo.md'), fmDoc(longAgo, ['source/foo.bs']));
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'add stale doc');
    // PR touches an unrelated file.
    writeFileSync(join(dir, 'unrelated.txt'), 'change\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'unrelated change');

    const { exitCode } = spawnScript(SCRIPT, ['--base', 'base'], { cwd: dir });
    expect(exitCode).toBe(0);
  });

  it('exits 1 when PR touches stale doc territory without updating the doc', () => {
    dir = setupRepo();
    mkdirSync(join(dir, 'source'), { recursive: true });
    writeFileSync(join(dir, 'source/foo.bs'), 'sub init()\nend sub\n');
    writeFileSync(join(dir, 'docs/architecture/foo.md'), fmDoc(longAgo, ['source/foo.bs']));
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'add doc + source');
    git(dir, 'branch', '-f', 'base', 'HEAD'); // move base forward
    // PR modifies the source file (in related-files) without touching the doc.
    writeFileSync(join(dir, 'source/foo.bs'), 'sub init()\n  m.x = 1\nend sub\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'change source only');

    const { exitCode, stderr } = spawnScript(SCRIPT, ['--base', 'base'], { cwd: dir });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/stale-doc territory violation/);
  });

  it('exits 0 when PR touches stale doc territory AND updates the doc', () => {
    dir = setupRepo();
    mkdirSync(join(dir, 'source'), { recursive: true });
    writeFileSync(join(dir, 'source/foo.bs'), 'sub init()\nend sub\n');
    writeFileSync(join(dir, 'docs/architecture/foo.md'), fmDoc(longAgo, ['source/foo.bs']));
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'add doc + source');
    git(dir, 'branch', '-f', 'base', 'HEAD');
    // PR modifies BOTH the source AND the doc.
    writeFileSync(join(dir, 'source/foo.bs'), 'sub init()\n  m.x = 1\nend sub\n');
    writeFileSync(join(dir, 'docs/architecture/foo.md'), fmDoc(recent, ['source/foo.bs']));
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'change source + bump doc');

    const { exitCode } = spawnScript(SCRIPT, ['--base', 'base'], { cwd: dir });
    expect(exitCode).toBe(0);
  });

  it('honors --days override', () => {
    dir = setupRepo();
    mkdirSync(join(dir, 'source'), { recursive: true });
    writeFileSync(join(dir, 'source/foo.bs'), 'sub init()\nend sub\n');
    writeFileSync(join(dir, 'docs/architecture/foo.md'), fmDoc(longAgo, ['source/foo.bs']));
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'add');
    git(dir, 'branch', '-f', 'base', 'HEAD');
    writeFileSync(join(dir, 'source/foo.bs'), 'change\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'change');

    // 100000-day threshold means longAgo isn't stale.
    const { exitCode } = spawnScript(SCRIPT, ['--base', 'base', '--days', '100000'], { cwd: dir });
    expect(exitCode).toBe(0);
  });

  it('exits 2 when no resolvable base ref', () => {
    // To force the unresolvable case, run in a directory that ISN'T a git
    // repo at all — every fallback candidate will fail to resolve.
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-docs-stale-blocking-nogit-'));
    mkdirSync(join(dir, 'docs', 'architecture'), { recursive: true });
    const { exitCode, stderr } = spawnScript(SCRIPT, ['--base', 'main'], {
      cwd: dir,
    });
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/could not resolve a base ref/);
  });
});
