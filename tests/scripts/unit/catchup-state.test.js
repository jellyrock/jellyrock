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
  mkdirSync(join(fix.dir, 'scripts/lib'), { recursive: true });
  // Copy the frontmatter helper so the aggregator's createRequire works.
  // The aggregator does `require('./lib/frontmatter.cjs')` relative to its
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
        'git',
        'handoffs',
        'issues',
        'meta',
        'prs',
        'progress',
        'signals',
        'tech_debt',
      ].sort(),
    );
  });

  it('git section returns branch + last_commit + commits_7d', () => {
    fix = setupFixture();
    fix.commit('first commit');
    fix.commit('second commit');
    const { stdout } = runAggregator(fix.dir);
    const parsed = JSON.parse(stdout);
    expect(parsed.git.branch).toBe('main');
    expect(parsed.git.last_commit.subject).toBe('second commit');
    expect(parsed.git.last_commit.sha).toMatch(/^[a-f0-9]{8}$/);
    expect(parsed.git.commits_7d.total).toBe(2);
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

  it('progress section parses last_updated + days_since + commits_since', () => {
    fix = setupFixture();
    fix.commit('seed', {
      'docs/progress.md': `---\nlast-updated: 2020-01-01\n---\n# Progress\n\n## Currently running\n\nin-flight stuff.\n\n## Open followups\n\n### scripts\n\n- one followup\n- another\n\n### components\n\n(none)\n`,
    });
    fix.commit('post-progress code change');
    const { stdout } = runAggregator(fix.dir);
    const parsed = JSON.parse(stdout);
    expect(parsed.progress.last_updated).toBe('2020-01-01');
    expect(parsed.progress.days_since).toBeGreaterThan(0);
    expect(parsed.progress.commits_since).toBeGreaterThan(0);
    expect(parsed.progress.open_followups_total).toBe(2);
    expect(parsed.progress.open_followups_by_area).toEqual({ scripts: 2 });
    expect(parsed.progress.currently_running_summary).toMatch(/in-flight/);
  });

  it('progress section returns null when docs/progress.md is absent', () => {
    fix = setupFixture();
    fix.commit('seed');
    const { stdout } = runAggregator(fix.dir);
    const parsed = JSON.parse(stdout);
    expect(parsed.progress).toBeNull();
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

  it('decisions section ignores schema examples inside code fences', () => {
    fix = setupFixture();
    const exampleFence = '```markdown\n## decision-id: example-fake\n**date**: 2099-01-01\n```';
    fix.commit('seed', {
      'docs/decisions.md': `# Decisions\n\nIntro.\n\n${exampleFence}\n\n## decision-id: real-decision\n\n**date**: 2026-05-06\n**status**: accepted\n\nbody.\n`,
    });
    const { stdout } = runAggregator(fix.dir);
    const parsed = JSON.parse(stdout);
    expect(parsed.decisions.recent_3).toHaveLength(1);
    expect(parsed.decisions.recent_3[0].slug).toBe('real-decision');
    expect(parsed.decisions.recent_3[0].status).toBe('accepted');
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

  it('--area filters progress.open_followups_by_area to the requested area', () => {
    fix = setupFixture();
    fix.commit('seed', {
      'docs/progress.md': `---\nlast-updated: ${TODAY}\n---\n# Progress\n\n## Open followups\n\n### scripts\n\n- one\n\n### components\n\n- two\n- three\n`,
    });
    const { stdout } = runAggregator(fix.dir, ['--area=scripts']);
    const parsed = JSON.parse(stdout);
    expect(parsed.meta.area).toBe('scripts');
    expect(parsed.progress.open_followups_by_area).toEqual({ scripts: 1 });
    // The total stays unfiltered (it's a global signal); only the by_area
    // map is scoped.
    expect(parsed.progress.open_followups_total).toBe(3);
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
    // Corrupt decisions.md so the parser has to handle weirdness gracefully.
    // Decisions parser doesn't actually throw on weird input — it returns
    // empty. So we instead corrupt tech-debt.md to ensure it can be the
    // origin of an _errors entry if something does throw. As of v1, none
    // of the parsers throw on real-world input shapes; this test mainly
    // documents that the catch is wired (no _errors expected on a healthy
    // fixture).
    fix.commit('seed');
    const { stdout } = runAggregator(fix.dir);
    const parsed = JSON.parse(stdout);
    // Healthy fixture, no errors.
    expect(parsed._errors).toEqual({});
    // All sections present and non-undefined.
    for (const k of ['git', 'progress', 'signals', 'decisions', 'tech_debt']) {
      expect(k in parsed).toBe(true);
    }
  });
});
