// Tests for scripts/lint/progress-cursor-nudge.cjs — specifically its
// --json mode, which is the single source of the progress.md temporal-
// staleness computation that used to live (blocking) in docs-check.cjs.
//
// The script reads the repo from CLAUDE_PROJECT_DIR (falling back to cwd),
// so tests point it at a temp git fixture via that env var. It ALWAYS exits
// 0 — progress.md freshness is never a blocking gate.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { spawnScript } from '../_helpers/spawn-script.js';
import { createGitFixture } from '../_helpers/temp-git-fixture.js';

const SCRIPT = 'scripts/lint/progress-cursor-nudge.cjs';

function makeProgress(lastUpdated) {
  return `---\nlast-updated: ${lastUpdated}\n---\n# Progress\n\n## Currently running\n\nbody\n`;
}

function withDocsDir(fix) {
  mkdirSync(join(fix.dir, 'docs'), { recursive: true });
  return fix;
}

// Run the nudge in --json mode against the fixture repo and return { exitCode,
// json }. Points CLAUDE_PROJECT_DIR at the fixture so both the file read and
// the git commands target it (hermetic — never touches the real repo).
function runJson(fixture) {
  const { exitCode, stdout } = spawnScript(SCRIPT, ['--json'], {
    cwd: fixture.dir,
    env: { CLAUDE_PROJECT_DIR: fixture.dir },
  });
  return { exitCode, json: JSON.parse(stdout) };
}

describe('progress-cursor-nudge --json — temporal staleness', () => {
  let fixture;

  afterEach(() => {
    if (fixture) fixture.cleanup();
    fixture = null;
  });

  it('always exits 0 (freshness never blocks)', () => {
    fixture = withDocsDir(createGitFixture());
    fixture.commit('chore: seed from 2020', { 'docs/progress.md': makeProgress('2020-01-01') });
    fixture.commit('feat: a feature');
    const { exitCode } = runJson(fixture);
    expect(exitCode).toBe(0);
  });

  it('stale is null when last-updated is today', () => {
    fixture = withDocsDir(createGitFixture());
    const today = new Date().toISOString().slice(0, 10);
    fixture.commit('feat: work', { 'docs/progress.md': makeProgress(today) });
    expect(runJson(fixture).json.stale).toBeNull();
  });

  it('stale is populated when last-updated is old AND a feature commit exists since', () => {
    fixture = withDocsDir(createGitFixture());
    fixture.commit('chore: seed from 2020', { 'docs/progress.md': makeProgress('2020-01-01') });
    fixture.commit('feat: a real feature commit long after the cursor date');
    const { stale } = runJson(fixture).json;
    expect(stale).not.toBeNull();
    expect(stale.lastUpdated).toBe('2020-01-01');
    expect(stale.commitsSince).toBe(1);
    expect(stale.days).toBeGreaterThan(7);
  });

  it('stale is null when the only commits since are maintenance / deps / docs / merges', () => {
    fixture = withDocsDir(createGitFixture());
    fixture.commit('chore: seed from 2020', { 'docs/progress.md': makeProgress('2020-01-01') });
    fixture.commit('chore(deps): update dependency sharp to v0.35.1');
    fixture.commit('docs(user): add playback troubleshooting guide');
    fixture.commit('Update vitest monorepo to v4.1.9');
    fixture.commit('ci: tweak workflow');
    expect(runJson(fixture).json.stale).toBeNull();
  });

  it('stale is null when the only commit since is authored by a bot', () => {
    fixture = withDocsDir(createGitFixture());
    fixture.commit('chore: seed from 2020', { 'docs/progress.md': makeProgress('2020-01-01') });
    // A bot-authored commit with a feature-shaped subject must still be filtered.
    writeFileSync(join(fixture.dir, 'bot.txt'), 'x');
    fixture.git('add', '.');
    execFileSync(
      'git',
      [
        'commit',
        '--no-gpg-sign',
        '--author=renovate[bot] <bot@example.com>',
        '-m',
        'feat: something that looks like a feature',
      ],
      { cwd: fixture.dir, encoding: 'utf8' },
    );
    expect(runJson(fixture).json.stale).toBeNull();
  });

  it('stale is null when progress.md does not exist', () => {
    fixture = createGitFixture();
    fixture.commit('feat: no progress.md yet');
    const { exitCode, json } = runJson(fixture);
    expect(exitCode).toBe(0);
    expect(json.stale).toBeNull();
  });

  it('stale is null when last-updated frontmatter is missing (nudge cannot compute)', () => {
    // Structural validity of the frontmatter is docs-check's job (blocking);
    // the nudge simply can't compute staleness without a date, so it stays quiet.
    fixture = withDocsDir(createGitFixture());
    fixture.commit('feat: work', { 'docs/progress.md': '# Progress\n\nno frontmatter\n' });
    expect(runJson(fixture).json.stale).toBeNull();
  });
});
