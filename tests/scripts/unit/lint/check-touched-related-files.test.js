// Tests for scripts/lint/check-touched-related-files.cjs.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';

const SCRIPT = 'scripts/lint/check-touched-related-files.cjs';

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
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-check-touched-related-'));
  git(dir, 'init', '--quiet', '--initial-branch=main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  mkdirSync(join(dir, 'docs', 'architecture'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), 'init\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '--quiet', '-m', 'init');
  git(dir, 'branch', 'base', 'HEAD');
  return dir;
}

const recent = new Date().toISOString().slice(0, 10);

describe('check-touched-related-files', () => {
  let dir;

  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('emits a reminder when a touched file matches a doc related-files', () => {
    dir = setupRepo();
    mkdirSync(join(dir, 'source'), { recursive: true });
    writeFileSync(join(dir, 'source/foo.bs'), 'sub init()\nend sub\n');
    writeFileSync(join(dir, 'docs/architecture/foo.md'), fmDoc(recent, ['source/foo.bs']));
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'add');
    git(dir, 'branch', '-f', 'base', 'HEAD');
    // PR modifies the source file (in related-files) without touching the doc.
    writeFileSync(join(dir, 'source/foo.bs'), 'change\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'change');

    const { exitCode, stdout } = spawnScript(SCRIPT, ['--base', 'base'], { cwd: dir });
    expect(exitCode).toBe(0); // always informational
    expect(stdout).toMatch(/Architecture-doc reminder/);
    expect(stdout).toMatch(/foo\.md/);
    expect(stdout).toMatch(/source\/foo\.bs/);
  });

  it('emits no reminder when touched files do not match any doc', () => {
    dir = setupRepo();
    writeFileSync(join(dir, 'docs/architecture/foo.md'), fmDoc(recent, ['source/foo.bs']));
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'add doc');
    git(dir, 'branch', '-f', 'base', 'HEAD');
    writeFileSync(join(dir, 'unrelated.txt'), 'change\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'unrelated');

    const { exitCode, stdout } = spawnScript(SCRIPT, ['--base', 'base'], { cwd: dir });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/no architecture docs need attention/);
  });

  it('does not emit a reminder when the doc itself was also touched', () => {
    dir = setupRepo();
    mkdirSync(join(dir, 'source'), { recursive: true });
    writeFileSync(join(dir, 'source/foo.bs'), 'sub init()\nend sub\n');
    writeFileSync(join(dir, 'docs/architecture/foo.md'), fmDoc(recent, ['source/foo.bs']));
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'add');
    git(dir, 'branch', '-f', 'base', 'HEAD');
    // Touch BOTH the source AND the doc — give each file a real diff.
    writeFileSync(join(dir, 'source/foo.bs'), 'sub init()\n  m.x = 1\nend sub\n');
    writeFileSync(
      join(dir, 'docs/architecture/foo.md'),
      fmDoc(recent, ['source/foo.bs']) + '\n<!-- doc updated alongside -->\n',
    );
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'change both');

    const { stdout } = spawnScript(SCRIPT, ['--base', 'base'], { cwd: dir });
    expect(stdout).not.toMatch(/Architecture-doc reminder/);
  });

  it('--quiet suppresses the no-match message', () => {
    dir = setupRepo();
    writeFileSync(join(dir, 'unrelated.txt'), 'change\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'unrelated');

    const { exitCode, stdout } = spawnScript(SCRIPT, ['--base', 'base', '--quiet'], { cwd: dir });
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('');
  });

  it('skips docs that have empty related-files', () => {
    dir = setupRepo();
    writeFileSync(join(dir, 'docs/architecture/foo.md'), fmDoc(recent, []));
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'add');
    git(dir, 'branch', '-f', 'base', 'HEAD');
    writeFileSync(join(dir, 'anything.txt'), 'change\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'change');

    const { stdout } = spawnScript(SCRIPT, ['--base', 'base'], { cwd: dir });
    expect(stdout).not.toMatch(/Architecture-doc reminder/);
  });
});
