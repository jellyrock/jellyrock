// Tests for scripts/lint/decision-shape-nudge.cjs.
//
// Advisory script: always exits 0; we assert behavior via stdout (printed
// vs silent). Tests use the `--range=` override since the fixture has no
// remote-tracking branch.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';
import { createGitFixture } from '../_helpers/temp-git-fixture.js';

const SCRIPT = 'scripts/lint/decision-shape-nudge.cjs';

function run(cwd, range) {
  return spawnScript(SCRIPT, [`--range=${range}`], { cwd });
}

describe('decision-shape-nudge', () => {
  let fix;

  afterEach(() => {
    if (fix) fix.cleanup();
    fix = null;
  });

  it('exits 0 silently when commits have no decision-shape language', () => {
    fix = createGitFixture();
    fix.commit('initial seed');
    const baseline = fix.git('rev-parse', 'HEAD').trim();
    fix.commit('feat: add new button');
    fix.commit('fix: correct typo');
    const { exitCode, stdout } = run(fix.dir, `${baseline}..HEAD`);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });

  it('prints a nudge when commit message matches "decided"', () => {
    fix = createGitFixture();
    fix.commit('initial seed');
    const baseline = fix.git('rev-parse', 'HEAD').trim();
    fix.commit('refactor: decided to use a single source of truth');
    const { exitCode, stdout } = run(fix.dir, `${baseline}..HEAD`);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Decision-shape commit detected/);
    expect(stdout).toMatch(/decided/);
    expect(stdout).toMatch(/\/log decision/);
  });

  it('prints a nudge when commit matches "switched from"', () => {
    fix = createGitFixture();
    fix.commit('initial seed');
    const baseline = fix.git('rev-parse', 'HEAD').trim();
    fix.commit('chore: switched from npm to pnpm');
    const { stdout } = run(fix.dir, `${baseline}..HEAD`);
    expect(stdout).toMatch(/Decision-shape commit detected/);
  });

  it('prints a nudge for "instead of" / "deprecate" / "going with"', () => {
    fix = createGitFixture();
    fix.commit('initial seed');
    const baseline = fix.git('rev-parse', 'HEAD').trim();
    fix.commit('feat: use a flat config instead of nested');
    fix.commit('chore: deprecate the legacy pathway');
    fix.commit('refactor: going with option B');
    const { stdout } = run(fix.dir, `${baseline}..HEAD`);
    expect(stdout).toMatch(/Decision-shape commit detected/);
    // All three should appear in the matched list (order not guaranteed)
    expect(stdout).toMatch(/instead of/);
    expect(stdout).toMatch(/deprecate/);
    expect(stdout).toMatch(/going with/);
  });

  it('exits 0 silently when range includes docs/decisions.md (already captured)', () => {
    fix = createGitFixture();
    mkdirSync(join(fix.dir, 'docs'), { recursive: true });
    fix.commit('initial seed');
    const baseline = fix.git('rev-parse', 'HEAD').trim();
    fix.commit('docs(decisions): record the decision', {
      'docs/decisions.md': '## decision-id: test\n\n**date**: 2026-05-06\n',
    });
    fix.commit('refactor: decided to do the thing');
    const { exitCode, stdout } = run(fix.dir, `${baseline}..HEAD`);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('');
  });
});
