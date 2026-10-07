// Tests for the docs fact report (scripts/docs-fact-report.js).
//
// A voice rewrite touches nearly every line of a doc, so the report is how a reviewer
// sees whether a number, a symbol or a link was lost. The tests pin what counts as a
// fact, that a fact is counted once, and the CLI against a real temporary repo.

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFacts, diffFacts } from '../../../scripts/docs-fact-report.js';
import { gitSafeEnv } from './_helpers/git-env.js';
import { spawnScript } from './_helpers/spawn-script.js';

describe('docs-fact-report — what counts as a fact', () => {
  it('collects numbers, code spans and link targets', () => {
    const f = extractFacts(
      'Needs Jellyfin 10.11 and `observeFieldScopedEx`. See [api](api.md) and <https://x.org>.\n',
    );
    expect([...f.number.keys()]).toEqual(['10.11']);
    expect([...f.code.keys()]).toEqual(['observeFieldScopedEx']);
    expect([...f.link.keys()]).toEqual(['api.md', 'https://x.org']);
  });

  // A number inside a code span or a link is already a fact of that kind.
  it('does not count a number inside code or a link twice', () => {
    const f = extractFacts('Set `timeout = 30` and read [ADR 43](adr/0043-x.md).\n');
    expect([...f.number.keys()]).toEqual(['43']);
    expect([...f.code.keys()]).toEqual(['timeout = 30']);
    expect([...f.link.keys()]).toEqual(['adr/0043-x.md']);
  });
});

describe('docs-fact-report — the diff', () => {
  it('reports a lost fact and leaves a reworded sentence alone', () => {
    const before = 'The stop took 139 ms — measured on a Stick.\n';
    const after = 'The stop took 139 ms, measured on a Stick.\n';
    expect(diffFacts(before, after)).toEqual({ removed: [], added: [] });
    const lost = diffFacts(before, 'The stop was fast.\n');
    expect(lost.removed).toEqual([{ kind: 'number', fact: '139', before: 1, after: 0 }]);
  });

  it('counts repeats, so dropping one of two mentions shows', () => {
    const { removed } = diffFacts('`a()` then `a()`.\n', '`a()` once.\n');
    expect(removed).toEqual([{ kind: 'code', fact: 'a()', before: 2, after: 1 }]);
  });

  it('reports an added fact for the reviewer to check', () => {
    const { added } = diffFacts('Works on new servers.\n', 'Works on 10.10 and newer.\n');
    expect(added).toEqual([{ kind: 'number', fact: '10.10', before: 0, after: 1 }]);
  });
});

describe('docs-fact-report — CLI', () => {
  let repo;
  afterEach(() => {
    if (repo) rmSync(repo, { recursive: true, force: true });
    repo = undefined;
  });
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', env: gitSafeEnv() });

  it('compares the working tree with the merge base and skips CHANGELOG.md', () => {
    repo = mkdtempSync(join(tmpdir(), 'fact-report-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    mkdirSync(join(repo, 'docs'));
    writeFileSync(join(repo, 'docs/a.md'), 'Needs `foo()` on 10.10 — see [b](b.md).\n');
    writeFileSync(join(repo, 'CHANGELOG.md'), 'Version 1.0\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('switch', '-q', '-c', 'work');
    writeFileSync(join(repo, 'docs/a.md'), 'Needs `foo()`, see [b](b.md).\n');
    writeFileSync(join(repo, 'CHANGELOG.md'), 'Version 2.0\n');

    const res = spawnScript('scripts/docs-fact-report.js', ['--base', 'main'], { cwd: repo });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('### docs/a.md');
    expect(res.stdout).toContain('- number `10.10`');
    expect(res.stdout).not.toContain('CHANGELOG');
  });

  it('exits 1 with a clear message for an unknown base', () => {
    repo = mkdtempSync(join(tmpdir(), 'fact-report-'));
    git('init', '-q', '-b', 'main');
    const res = spawnScript('scripts/docs-fact-report.js', ['--base', 'nope'], { cwd: repo });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('cannot compare against `nope`');
  });
});
