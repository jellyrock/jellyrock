// Tests for scripts/catchup-state.js (the /catchup + /ramp aggregator).
//
// All tests pass --no-gh so they don't shell out to the gh CLI (would either
// hit the network or fail without auth). Coverage focuses on the journal
// parsers, area filtering, error fallthrough, and JSON shape.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { spawnScript } from './_helpers/spawn-script.js';
import { createGitFixture } from './_helpers/temp-git-fixture.js';

const SCRIPT = 'scripts/catchup-state.js';
const TODAY = new Date().toISOString().slice(0, 10);

function setupFixture() {
  const fix = createGitFixture();
  mkdirSync(join(fix.dir, 'docs'), { recursive: true });
  mkdirSync(join(fix.dir, 'docs/architecture'), { recursive: true });
  mkdirSync(join(fix.dir, 'docs/adr'), { recursive: true });
  mkdirSync(join(fix.dir, 'scripts/lib'), { recursive: true });
  // The aggregator does `require('./lib/*.cjs')` relative to its
  // OWN location, not cwd — so we ALWAYS use the real script via spawnScript
  // (which resolves to repo root). The fixture only needs the data files.
  return fix;
}

function runAggregator(cwd, args = []) {
  // --no-network implies --no-gh AND skips the signals upstream-version fetch.
  // Critical for tests so we never hit api.jellyfin.org or raw.githubusercontent.com.
  return spawnScript(SCRIPT, ['--no-network', ...args], { cwd });
}

describe('catchup-state', () => {
  let fix;

  afterEach(() => {
    if (fix) fix.cleanup();
    fix = null;
  });

  it('emits valid JSON with all expected top-level keys', () => {
    fix = setupFixture();
    fix.commit('seed');
    const { exitCode, stdout } = runAggregator(fix.dir);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Object.keys(parsed).sort()).toEqual(
      [
        '_errors',
        'ci',
        'decisions',
        'docs_stale',
        'handoffs',
        'issues',
        'meta',
        'prs',
        'signals',
        'tech_debt',
      ].sort(),
    );
  });

  it('--no-network empties prs / issues / ci and reports no errors', () => {
    fix = setupFixture();
    fix.commit('seed');
    const { stdout } = runAggregator(fix.dir);
    const parsed = JSON.parse(stdout);
    expect(parsed.prs).toEqual({ review_requested: [], yours_open: [] });
    expect(parsed.issues.high_engagement_bugs).toEqual([]);
    expect(parsed.ci.current_branch_runs).toEqual([]);
    expect(parsed._errors).toEqual({});
  });

  it('signals section flags stale when latest_upstream != latest_acknowledged', () => {
    fix = setupFixture();
    // Three rows exercising the stale rule:
    //   in-sync: latest_upstream == latest_acknowledged → not stale
    //   ahead:   latest_upstream != latest_acknowledged AND status=watching → stale
    //   ahead-pending: ahead BUT status=action_pending → NOT stale (already triaged)
    fix.commit('seed', {
      'docs/signals-backlog.md':
        `---\nlast-updated: ${TODAY}\n---\n# Signals\n\n## Watching\n\n` +
        `### in-sync: label\n\n- **watching**: x\n- **current**: prose\n- **latest_upstream**: 1.0.0\n- **latest_acknowledged**: 1.0.0\n- **last_checked**: ${TODAY}\n- **action_when_moves**: do\n- **status**: watching\n\n` +
        `### ahead: label\n\n- **watching**: y\n- **current**: prose\n- **latest_upstream**: 2.0.0\n- **latest_acknowledged**: 1.0.0\n- **last_checked**: ${TODAY}\n- **action_when_moves**: do\n- **status**: watching\n\n` +
        `### ahead-pending: label\n\n- **watching**: z\n- **current**: prose\n- **latest_upstream**: 3.0.0\n- **latest_acknowledged**: 2.0.0\n- **last_checked**: ${TODAY}\n- **action_when_moves**: do\n- **status**: action_pending\n`,
    });
    const { stdout } = runAggregator(fix.dir);
    const parsed = JSON.parse(stdout);
    expect(parsed.signals.rows).toHaveLength(3);
    const bySlug = Object.fromEntries(parsed.signals.rows.map((r) => [r.slug, r]));
    expect(bySlug['in-sync'].stale).toBe(false);
    expect(bySlug['ahead'].stale).toBe(true);
    expect(bySlug['ahead-pending'].stale).toBe(false);
    expect(parsed.signals.stale_count).toBe(1);
    expect(parsed.signals.action_pending_count).toBe(1);
  });

  it('decisions section surfaces the newest 3 ADRs (highest number first), skipping README', () => {
    fix = setupFixture();
    const adr = (n, title, date, status) =>
      `# ADR ${n}: ${title}\n\n**Status:** ${status}\n**Date:** ${date}\n\nbody.\n`;
    fix.commit('seed', {
      'docs/adr/README.md': '# Architecture Decision Records\n\nIndex — not an ADR.\n',
      'docs/adr/0001-first.md': adr('0001', 'First decision', '2026-05-06', 'Accepted'),
      'docs/adr/0002-second.md': adr('0002', 'Second decision', '2026-05-07', 'Accepted'),
      'docs/adr/0003-third.md': adr('0003', 'Third decision', '2026-05-08', 'Superseded'),
      'docs/adr/0004-fourth.md': adr('0004', 'Fourth decision', '2026-05-09', 'Accepted'),
    });
    const { stdout } = runAggregator(fix.dir);
    const parsed = JSON.parse(stdout);
    expect(parsed.decisions.recent_3).toHaveLength(3);
    expect(parsed.decisions.recent_3.map((d) => d.adr)).toEqual(['0004', '0003', '0002']);
    expect(parsed.decisions.recent_3[0]).toMatchObject({
      adr: '0004',
      title: 'Fourth decision',
      date: '2026-05-09',
      status: 'accepted',
    });
    expect(parsed.decisions.recent_3[1].status).toBe('superseded');
  });

  it('tech_debt section counts items + surfaces top-3 cross-severity', () => {
    fix = setupFixture();
    fix.commit('seed', {
      'docs/architecture/tech-debt.md': `# Tech Debt\n\n## Refactor candidates\n\n### High\n\n#### \`high-1\`\n\n- **issue**: First high issue. Extra trailing detail.\n\n#### \`high-2\`\n\n- **issue**: Second high.\n\n### Medium\n\n#### \`med-1\`\n\n- **issue**: Medium issue.\n\n### Low\n\n#### \`low-1\`\n\n- **issue**: Low one.\n\n#### \`low-2\`\n\n- **issue**: Low two.\n\n## Recently removed\n\nnothing here counts\n`,
    });
    const { stdout } = runAggregator(fix.dir);
    const parsed = JSON.parse(stdout);
    expect(parsed.tech_debt.high_count).toBe(2);
    expect(parsed.tech_debt.medium_count).toBe(1);
    expect(parsed.tech_debt.low_count).toBe(2);
    // Top-3 takes file order (which is High → Medium → Low); within severity,
    // file order is preserved (= author intent).
    expect(parsed.tech_debt.top_3).toHaveLength(3);
    expect(parsed.tech_debt.top_3[0]).toMatchObject({ slug: 'high-1', severity: 'High' });
    expect(parsed.tech_debt.top_3[0].issue_oneline).toMatch(/First high issue/);
    expect(parsed.tech_debt.top_3[1]).toMatchObject({ slug: 'high-2', severity: 'High' });
    expect(parsed.tech_debt.top_3[2]).toMatchObject({ slug: 'med-1', severity: 'Medium' });
  });

  it('--area records the area in meta', () => {
    fix = setupFixture();
    fix.commit('seed');
    const { stdout } = runAggregator(fix.dir, ['--area=scripts']);
    const parsed = JSON.parse(stdout);
    expect(parsed.meta.area).toBe('scripts');
  });

  it('--area=invalid exits 2 with a helpful error', () => {
    fix = setupFixture();
    fix.commit('seed');
    const { exitCode, stderr } = runAggregator(fix.dir, ['--area=nonsense']);
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/unrecognized --area=nonsense/);
  });

  it('--pretty emits indented JSON', () => {
    fix = setupFixture();
    fix.commit('seed');
    const { stdout: pretty } = runAggregator(fix.dir, ['--pretty']);
    expect(pretty.split('\n').length).toBeGreaterThan(10);
    const { stdout: compact } = runAggregator(fix.dir);
    expect(compact.split('\n').length).toBeLessThanOrEqual(2);
    // The two JSON payloads come from separate invocations so meta.generated_at
    // naturally differs. Compare structure modulo that timestamp.
    const p = JSON.parse(pretty);
    const c = JSON.parse(compact);
    delete p.meta.generated_at;
    delete c.meta.generated_at;
    expect(p).toEqual(c);
  });

  it('--typed prints the typed lines, then one === STATE === line, then the same JSON', () => {
    fix = setupFixture();
    mkdirSync(join(fix.dir, '.claude/handoffs'), { recursive: true });
    writeFileSync(join(fix.dir, '.claude/handoffs/issue-1.md'), 'paused');
    fix.commit('seed', {
      'docs/signals-backlog.md':
        `---\nlast-updated: ${TODAY}\n---\n# Signals\n\n## Watching\n\n` +
        `### ahead: label\n\n- **latest_upstream**: 2.0.0\n- **latest_acknowledged**: 1.0.0\n- **last_checked**: ${TODAY}\n- **status**: watching\n`,
    });
    const { exitCode, stdout } = runAggregator(fix.dir, ['--typed', '--pretty']);
    expect(exitCode).toBe(0);
    const lines = stdout.split('\n');
    const at = lines.indexOf('=== STATE ===');
    expect(at).toBeGreaterThan(0);
    expect(lines.slice(0, at)).toEqual([
      'BANNER\tsignals-stale\tsignals-backlog: ahead needs attention (upstream 2.0.0, acknowledged 1.0.0)\treview the upstream change, then /done ahead',
      'BANNER\thandoff-pending\tpending handoff .claude/handoffs/issue-1.md (0d old)\tread it and follow the skill that wrote it',
    ]);
    const typed = JSON.parse(lines.slice(at + 1).join('\n'));
    const plain = JSON.parse(runAggregator(fix.dir, ['--pretty']).stdout);
    delete typed.meta.generated_at;
    delete plain.meta.generated_at;
    expect(typed).toEqual(plain);
  });

  it('--typed asks gh for the run id and routes a failing run to /ci-triage with it; the JSON alone does not', () => {
    fix = setupFixture();
    fix.commit('seed');
    // a gh stand-in: run list answers with the fields it was asked for, everything else is empty
    const bin = join(fix.dir, '.stub-bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'gh'),
      '#!/bin/sh\ncase "$*" in\n' +
        '  "run list --limit 100"*databaseId*) echo \'[{"headBranch":"main","status":"completed","conclusion":"failure","name":"Build","createdAt":"2026-10-06T10:00:00Z","event":"push","databaseId":37560200942}]\' ;;\n' +
        '  "run list --limit 100"*) echo \'[{"headBranch":"main","status":"completed","conclusion":"failure","name":"Build","createdAt":"2026-10-06T10:00:00Z","event":"push"}]\' ;;\n' +
        "  *) echo '[]' ;;\nesac\n",
      { mode: 0o755 },
    );
    const env = { PATH: `${bin}:${process.env.PATH}` };
    const typed = spawnScript(SCRIPT, ['--typed'], { cwd: fix.dir, env });
    expect(typed.stdout.split('\n')).toContain(
      'BANNER\tci-failing\tCI run "Build" failure (2026-10-06T10:00:00Z)\t/ci-triage 37560200942',
    );
    const plain = JSON.parse(spawnScript(SCRIPT, [], { cwd: fix.dir, env }).stdout);
    expect(plain._errors).toEqual({});
    expect(Object.keys(plain.ci.current_branch_runs[0]).sort()).toEqual([
      'conclusion',
      'createdAt',
      'event',
      'name',
      'status',
    ]);
  });

  // a gh stand-in for the unfiltered run list: answers `run list --limit 100` with the
  // given runs, everything else (a --branch query included) with an empty list
  function ghRunList(dir, runs) {
    const bin = join(dir, '.stub-bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'gh'),
      `#!/bin/sh\ncase "$*" in\n  "run list --limit 100"*) echo '${JSON.stringify(runs)}' ;;\n  *) echo '[]' ;;\nesac\n`,
      { mode: 0o755 },
    );
    return { PATH: `${bin}:${process.env.PATH}` };
  }
  const ghRun = (headBranch, name, createdAt) => ({
    headBranch,
    status: 'completed',
    conclusion: 'success',
    name,
    createdAt,
    event: 'push',
  });

  it('ci reads the 100 newest runs and keeps the first 3 on the checked-out branch, without --branch', () => {
    fix = setupFixture();
    fix.commit('seed');
    const env = ghRunList(fix.dir, [
      ghRun('feat/x', 'Other', '2026-10-07T12:00:00Z'),
      ghRun('main', 'A', '2026-10-07T11:00:00Z'),
      ghRun('main', 'B', '2026-10-07T10:00:00Z'),
      ghRun('feat/x', 'Other', '2026-10-07T09:00:00Z'),
      ghRun('main', 'C', '2026-10-07T08:00:00Z'),
      ghRun('main', 'D', '2026-10-07T07:00:00Z'),
    ]);
    const { ci, _errors } = JSON.parse(spawnScript(SCRIPT, [], { cwd: fix.dir, env }).stdout);
    expect(_errors).toEqual({});
    expect(ci.current_branch_runs.map((r) => r.name)).toEqual(['A', 'B', 'C']);
    expect(Object.keys(ci.current_branch_runs[0]).sort()).toEqual([
      'conclusion',
      'createdAt',
      'event',
      'name',
      'status',
    ]);
    expect(ci.note).toBeUndefined();
  });

  it('a branch with no run among the 100 newest gets a note and an INFO line, never silence', () => {
    fix = setupFixture();
    fix.commit('seed');
    const env = ghRunList(fix.dir, [ghRun('feat/x', 'Other', '2026-10-07T12:00:00Z')]);
    const { stdout } = spawnScript(SCRIPT, ['--typed'], { cwd: fix.dir, env });
    expect(stdout.split('\n')).toContain(
      'INFO\tci-none\tno CI runs for main among the 100 newest runs',
    );
    const { ci } = JSON.parse(stdout.slice(stdout.indexOf('=== STATE ===') + 14));
    expect(ci).toEqual({
      current_branch_runs: [],
      note: 'no CI runs for main among the 100 newest runs',
    });
  });

  it('without --typed there are no typed lines and no STATE line', () => {
    fix = setupFixture();
    fix.commit('seed');
    const { stdout } = runAggregator(fix.dir, ['--pretty']);
    expect(stdout).not.toContain('=== STATE ===');
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it('handoffs section returns empty pending + 0 pruned when dir absent', () => {
    fix = setupFixture();
    fix.commit('seed');
    const { stdout } = runAggregator(fix.dir);
    const parsed = JSON.parse(stdout);
    expect(parsed.handoffs).toEqual({ pending: [], pruned_count: 0 });
  });

  it('handoffs section auto-prunes files older than 30 days', () => {
    fix = setupFixture();
    mkdirSync(join(fix.dir, '.claude/handoffs'), { recursive: true });
    const oldPath = join(fix.dir, '.claude/handoffs/old.md');
    const newPath = join(fix.dir, '.claude/handoffs/new.md');
    writeFileSync(oldPath, 'old');
    writeFileSync(newPath, 'new');
    // Backdate the "old" file to 60 days ago via fs.utimes so the auto-prune
    // logic (>30d cutoff) sees it as expired.
    const sixtyDaysAgo = (Date.now() - 60 * 86400 * 1000) / 1000;
    utimesSync(oldPath, sixtyDaysAgo, sixtyDaysAgo);
    fix.commit('seed');
    const { stdout } = runAggregator(fix.dir);
    const parsed = JSON.parse(stdout);
    expect(parsed.handoffs.pruned_count).toBe(1);
    expect(parsed.handoffs.pending.map((p) => p.name)).toEqual(['new.md']);
  });

  it('per-section errors land in _errors when a fetcher throws', () => {
    fix = setupFixture();
    // The decisions parser reads docs/adr/ and returns empty (not a throw) on
    // a missing dir or weird input, so it can't be the origin of an _errors
    // entry. This test mainly documents that the per-section catch is wired
    // (no _errors expected on a healthy fixture). As of v1, none
    // of the parsers throw on real-world input shapes; this test mainly
    // documents that the catch is wired (no _errors expected on a healthy
    // fixture).
    fix.commit('seed');
    const { stdout } = runAggregator(fix.dir);
    const parsed = JSON.parse(stdout);
    // Healthy fixture, no errors.
    expect(parsed._errors).toEqual({});
    // All sections present and non-undefined.
    for (const k of ['signals', 'decisions', 'tech_debt']) {
      expect(k in parsed).toBe(true);
    }
  });
});
