/**
 * `npm run translations:merge` (`scripts/translations-merge.js`) against real git
 * repositories: a bare `origin` holding `main` and `weblate`, and a release checkout.
 * The per-key rules are covered in lib/locale-files.test.js; this covers what only
 * git can show: which commit is the ancestor, both release legs, and the push-back
 * retry when Weblate moves the branch mid-merge.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitSafeEnv } from './_helpers/git-env.js';
import { findAncestor, mergeRelease, pushBack } from '../../../scripts/translations-merge.js';

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir() {
  const d = mkdtempSync(join(tmpdir(), 'jellyrock-merge-'));
  dirs.push(d);
  return d;
}

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: gitSafeEnv() }).trim();

function writeLocales(dir, locales) {
  mkdirSync(join(dir, 'locale/custom'), { recursive: true });
  for (const [locale, data] of Object.entries(locales))
    writeFileSync(join(dir, `locale/custom/${locale}.json`), JSON.stringify(data, null, 2) + '\n');
}

function commit(dir, message, locales) {
  if (locales) writeLocales(dir, locales);
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '--allow-empty', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

const readFr = (dir) => JSON.parse(readFileSync(join(dir, 'locale/custom/fr.json'), 'utf8'));

const EN = { en_US: { A: 'A', B: 'B', C: 'C' } };

/** origin (bare) with main and weblate, plus a clone of it on `main`. */
function setup(fr) {
  const origin = tempDir();
  git(origin, 'init', '--quiet', '--bare', '--initial-branch=main');
  const repo = tempDir();
  git(repo, 'init', '--quiet', '--initial-branch=main');
  for (const [k, v] of [
    ['user.name', 'Test'],
    ['user.email', 'test@example.com'],
    ['commit.gpgsign', 'false'],
  ])
    git(repo, 'config', k, v);
  git(repo, 'remote', 'add', 'origin', origin);
  writeFileSync(join(repo, 'README'), 'x');
  mkdirSync(join(repo, 'locale'), { recursive: true });
  writeFileSync(join(repo, 'locale/languages.json'), '[]\n');
  commit(repo, 'init', { ...EN, fr });
  git(repo, 'push', '--quiet', 'origin', 'main', 'main:weblate');
  git(repo, 'fetch', '--quiet', 'origin');
  return { origin, repo };
}

/** A second clone, standing in for Weblate pushing to the weblate branch. */
function weblateClone(origin) {
  const w = tempDir();
  git(w, 'clone', '--quiet', '--branch', 'weblate', origin, '.');
  git(w, 'config', 'user.name', 'Weblate');
  git(w, 'config', 'user.email', 'noreply@weblate.org');
  return w;
}

function weblatePush(origin, message, frChanges, trailer) {
  const w = weblateClone(origin);
  const fr = { ...readFr(w), ...frChanges };
  for (const [k, v] of Object.entries(frChanges)) if (v === undefined) delete fr[k];
  writeLocales(w, { fr });
  git(w, 'add', '-A');
  const args = ['commit', '--quiet', '--allow-empty', '-m', message];
  if (trailer) args.push('-m', trailer);
  git(w, ...args);
  git(w, 'push', '--quiet', 'origin', 'weblate');
  return git(w, 'rev-parse', 'HEAD');
}

describe('findAncestor', () => {
  it('takes the newest push-back of a release that shipped, skipping an abandoned one', () => {
    const { origin, repo } = setup({ A: 'a' });
    const shipped = weblatePush(origin, 'sync', {}, 'Translations-Release: 1.0.0');
    weblatePush(origin, 'sync', {}, 'Translations-Release: 1.1.0'); // never tagged
    git(repo, 'tag', 'v1.0.0');
    git(repo, 'fetch', '--quiet', 'origin');
    expect(findAncestor(repo, 'origin/weblate', '1.2.0')).toEqual({
      sha: shipped,
      version: '1.0.0',
    });
  });

  it("takes an earlier pass of the release in progress, which isn't tagged yet", () => {
    const { origin, repo } = setup({ A: 'a' });
    git(repo, 'tag', 'v1.0.0');
    weblatePush(origin, 'sync', {}, 'Translations-Release: 1.0.0');
    const pass1 = weblatePush(origin, 'sync', {}, 'Translations-Release: 1.1.0');
    git(repo, 'fetch', '--quiet', 'origin');
    expect(findAncestor(repo, 'origin/weblate', '1.1.0')).toEqual({ sha: pass1, version: '1.1.0' });
  });

  it('is null when no push-back exists yet', () => {
    const { repo } = setup({ A: 'a' });
    expect(findAncestor(repo, 'origin/weblate', '1.0.0')).toBeNull();
  });
});

describe('mergeRelease + pushBack', () => {
  it('syncs both ways: deletions and main fixes survive, Weblate wins conflicts', () => {
    // Last release: both sides agreed on A, B, C.
    const { origin, repo } = setup({ A: 'a', B: 'b', C: 'c' });
    weblatePush(origin, 'sync', {}, 'Translations-Release: 1.0.0');
    git(repo, 'tag', 'v1.0.0');

    // On main: fix A, delete B (a bad seed). In Weblate: delete C, change A too.
    commit(repo, 'main edits', { ...EN, fr: { A: 'main-a', C: 'c' } });
    weblatePush(origin, 'Translated using Weblate (French)', { A: 'web-a', C: undefined });
    git(repo, 'fetch', '--quiet', 'origin');

    const snapshot = git(repo, 'rev-parse', 'HEAD');
    const result = mergeRelease({
      cwd: repo,
      ours: snapshot,
      theirs: 'origin/weblate',
      version: '1.1.0',
    });
    expect(result.ancestor.version).toBe('1.0.0');
    expect(readFr(repo)).toEqual({ A: 'web-a' }); // B and C deleted, Weblate won A
    expect(result.conflicts).toEqual([{ locale: 'fr', key: 'A', ours: 'main-a', theirs: 'web-a' }]);
    commit(repo, 'refresh');

    const pushed = pushBack({ cwd: repo, ancestor: result.theirsSha, version: '1.1.0' });
    expect(pushed.attempt).toBe(1);
    const w = weblateClone(origin);
    expect(readFr(w)).toEqual({ A: 'web-a' });
    expect(git(w, 'log', '-1', '--format=%(trailers:key=Translations-Release,valueonly)')).toBe(
      '1.1.0',
    );
  });

  it('falls back to the two-way union when there is no ancestor', () => {
    const { origin, repo } = setup({ A: 'a' });
    commit(repo, 'seed', { ...EN, fr: { A: 'a', B: 'seeded' } });
    weblatePush(origin, 'Translated using Weblate (French)', { A: undefined, C: 'web-c' });
    git(repo, 'fetch', '--quiet', 'origin');
    const result = mergeRelease({
      cwd: repo,
      ours: 'HEAD',
      theirs: 'origin/weblate',
      version: '1.0.0',
    });
    expect(result.ancestor).toBeNull();
    // Without an ancestor a missing key reads as "added on the other side", so A stays.
    expect(readFr(repo)).toEqual({ A: 'a', B: 'seeded', C: 'web-c' });
  });

  it('retries when Weblate pushes mid-merge, keeping what Weblate pushed', () => {
    const { origin, repo } = setup({ A: 'a' });
    commit(repo, 'seed', { ...EN, fr: { A: 'a', B: 'seeded' } });
    const read = git(repo, 'rev-parse', 'origin/weblate');

    const pushed = pushBack({
      cwd: repo,
      ancestor: read,
      version: '1.0.0',
      beforePush: (attempt) => {
        if (attempt === 1) weblatePush(origin, 'Translated using Weblate (French)', { C: 'web-c' });
      },
    });
    expect(pushed.attempt).toBe(2);
    expect(readFr(weblateClone(origin))).toEqual({ A: 'a', B: 'seeded', C: 'web-c' });
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1); // temp worktrees cleaned
  });

  it('still writes the ancestor marker when nothing changed', () => {
    const { origin, repo } = setup({ A: 'a' });
    pushBack({ cwd: repo, ancestor: git(repo, 'rev-parse', 'origin/weblate'), version: '1.0.0' });
    const w = weblateClone(origin);
    expect(git(w, 'log', '-1', '--format=%s')).toBe('chore: sync translations from release v1.0.0');
  });

  it('is a no-op on the locale files when merged again', () => {
    const { origin, repo } = setup({ A: 'a' });
    weblatePush(origin, 'Translated using Weblate (French)', { B: 'web-b' });
    git(repo, 'fetch', '--quiet', 'origin');
    mergeRelease({ cwd: repo, ours: 'HEAD', theirs: 'origin/weblate', version: '1.0.0' });
    commit(repo, 'refresh');
    expect(
      mergeRelease({ cwd: repo, ours: 'HEAD', theirs: 'origin/weblate', version: '1.0.0' }).changed,
    ).toEqual([]);
  });
});
