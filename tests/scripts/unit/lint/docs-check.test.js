// Tests for scripts/lint/docs-check.cjs.
//
// Validates: related-files frontmatter paths, markdown links, tech-debt
// anchor refs across docs/architecture/, docs/dev/, docs/decisions.md,
// every CLAUDE.md, and the BSC plugin sources under scripts/bsc-plugins/.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';
import { createGitFixture } from '../_helpers/temp-git-fixture.js';

const SCRIPT = 'scripts/lint/docs-check.cjs';

function setup(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-docs-check-'));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(dir, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const fmDoc = (relatedFiles = [], body = 'body\n') => {
  const fm =
    relatedFiles.length === 0
      ? 'related-files: []'
      : 'related-files:\n' + relatedFiles.map((f) => `  - ${f}`).join('\n');
  return `---\ntopic: foo\n${fm}\nlast-reviewed: 2026-05-01\n---\n# Heading\n\n${body}`;
};

describe('docs-check', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 when an architecture doc has only valid related-files', () => {
    dir = setup({
      'docs/architecture/foo.md': fmDoc(['source/foo.bs']),
      'source/foo.bs': 'sub init()\nend sub\n',
      'docs/architecture/tech-debt.md': '---\ntopic: tech-debt\n---\n# Tech Debt\n',
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/clean/);
  });

  it('exits 1 with a broken related-files path', () => {
    dir = setup({
      'docs/architecture/foo.md': fmDoc(['source/missing.bs']),
      'docs/architecture/tech-debt.md': '---\ntopic: tech-debt\n---\n# Tech Debt\n',
    });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/related-files path does not exist: source\/missing\.bs/);
  });

  it('exits 1 on a broken inline markdown link', () => {
    dir = setup({
      'docs/architecture/foo.md': fmDoc([], 'See [missing](./missing-doc.md) for details.\n'),
      'docs/architecture/tech-debt.md': '---\ntopic: tech-debt\n---\n# Tech Debt\n',
    });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/markdown link target does not exist/);
  });

  it('exits 1 on a stale tech-debt anchor reference', () => {
    dir = setup({
      'docs/architecture/foo.md': fmDoc(
        [],
        'See [`old-slug`](./tech-debt.md#old-slug) — the canonical citation form.\n',
      ),
      'docs/architecture/tech-debt.md': '---\ntopic: tech-debt\n---\n# Tech Debt\n\n## Real Slug\n',
    });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/stale tech-debt anchor reference/);
  });

  it('passes when a tech-debt anchor matches a real heading', () => {
    dir = setup({
      'docs/architecture/foo.md': fmDoc(
        [],
        'See [`legacy`](./tech-debt.md#legacy-print-statements).\n',
      ),
      'docs/architecture/tech-debt.md':
        '---\ntopic: tech-debt\n---\n# Tech Debt\n\n## `legacy-print-statements`\n',
    });
    const { exitCode } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
  });

  it('scans plugins under scripts/bsc-plugins/ for stale anchor refs (regression coverage)', () => {
    // The reorg moved plugins from scripts/bsc-plugin-*.cjs to
    // scripts/bsc-plugins/*.cjs; a stale plugin reference here must still
    // be caught.
    dir = setup({
      'docs/architecture/tech-debt.md':
        '---\ntopic: tech-debt\n---\n# Tech Debt\n\n## `real-slug`\n',
      'scripts/bsc-plugins/example.cjs':
        '// Plugin enforces the rule documented at tech-debt.md#nonexistent-slug.\n',
    });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/nonexistent-slug/);
  });

  it('--verbose emits per-file counts', () => {
    dir = setup({
      'docs/architecture/foo.md': fmDoc(['source/foo.bs']),
      'source/foo.bs': 'sub init()\nend sub\n',
      'docs/architecture/tech-debt.md': '---\ntopic: tech-debt\n---\n# Tech Debt\n',
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--verbose']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/foo\.md.*1 related/);
  });

  it('--json emits structured output on a clean run (exit 0)', () => {
    dir = setup({
      'docs/architecture/foo.md': fmDoc(['source/foo.bs']),
      'source/foo.bs': 'sub init()\nend sub\n',
      'docs/architecture/tech-debt.md': '---\ntopic: tech-debt\n---\n# Tech Debt\n',
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.errorsCount).toBe(0);
    expect(parsed.errors).toEqual([]);
    expect(parsed.filesChecked).toBeGreaterThan(0);
  });

  it('--json categorizes errors and exits 1', () => {
    dir = setup({
      'docs/architecture/foo.md': fmDoc(
        ['source/missing.bs'],
        'See [missing](./missing-doc.md) and [`x`](./tech-debt.md#nope).\n',
      ),
      'docs/architecture/tech-debt.md': '---\ntopic: tech-debt\n---\n# Tech Debt\n',
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.errorsCount).toBe(3);
    const cats = parsed.errors.map((e) => e.category).sort();
    expect(cats).toEqual(['broken-link', 'broken-related-file', 'stale-anchor']);
    for (const e of parsed.errors) {
      expect(e.file).toMatch(/foo\.md$/);
      expect(typeof e.message).toBe('string');
      expect(typeof e.target).toBe('string');
    }
  });
});

describe('docs-check — progress.md staleness', () => {
  let fixture;

  afterEach(() => {
    if (fixture) fixture.cleanup();
    fixture = null;
  });

  function makeProgress(lastUpdated) {
    return `---\nlast-updated: ${lastUpdated}\n---\n# Progress\n\nbody\n`;
  }

  function withDocsDir(fix) {
    mkdirSync(join(fix.dir, 'docs'), { recursive: true });
    return fix;
  }

  it('passes when last-updated is today', () => {
    fixture = withDocsDir(createGitFixture());
    const today = new Date().toISOString().slice(0, 10);
    fixture.commit('seed', { 'docs/progress.md': makeProgress(today) });
    const { exitCode } = spawnScript(SCRIPT, [fixture.dir, '--json']);
    expect(exitCode).toBe(0);
  });

  it('FAILs when last-updated is stale AND commits have happened since', () => {
    fixture = withDocsDir(createGitFixture());
    fixture.commit('seed: progress.md from 2020', {
      'docs/progress.md': makeProgress('2020-01-01'),
    });
    fixture.commit('subsequent code change');
    const { exitCode, stdout } = spawnScript(SCRIPT, [fixture.dir, '--json']);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    const stale = parsed.errors.filter((e) => e.category === 'progress-stale');
    expect(stale.length).toBe(1);
    expect(stale[0].message).toMatch(/days stale/);
    expect(stale[0].message).toMatch(/commit\(s\) since/);
  });

  it('does NOT fail on stale date when the only commits since are maintenance/deps', () => {
    fixture = withDocsDir(createGitFixture());
    fixture.commit('chore: seed progress.md from 2020', {
      'docs/progress.md': makeProgress('2020-01-01'),
    });
    fixture.commit('chore(deps): update dependency sharp to v0.35.1');
    fixture.commit('docs(user): add playback troubleshooting guide');
    fixture.commit('Update vitest monorepo to v4.1.9');
    const { exitCode, stdout } = spawnScript(SCRIPT, [fixture.dir, '--json']);
    const stale = JSON.parse(stdout).errors.filter((e) => e.category === 'progress-stale');
    expect(stale.length).toBe(0);
    expect(exitCode).toBe(0);
  });

  it('FAILs when frontmatter is missing or malformed', () => {
    fixture = withDocsDir(createGitFixture());
    fixture.commit('seed', { 'docs/progress.md': '# Progress\n\nno frontmatter\n' });
    const { exitCode, stdout } = spawnScript(SCRIPT, [fixture.dir, '--json']);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    const stale = parsed.errors.filter((e) => e.category === 'progress-stale');
    expect(stale.length).toBe(1);
    expect(stale[0].message).toMatch(/missing or has malformed/);
  });

  it('passes silently when progress.md does not exist (pre-foundation builds)', () => {
    fixture = createGitFixture();
    fixture.commit('seed: no progress.md yet');
    const { exitCode } = spawnScript(SCRIPT, [fixture.dir, '--json']);
    expect(exitCode).toBe(0);
  });
});

describe('docs-check — signals-backlog schema', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  const SIGNALS_FRONTMATTER = `---\nlast-updated: ${new Date()
    .toISOString()
    .slice(0, 10)}\n---\n# Signals backlog\n\n## Watching\n\n`;

  function makeRow(slug, opts = {}) {
    const o = {
      watching: 'something',
      current: 'v1',
      latest_upstream: 'v2',
      latest_acknowledged: 'v2',
      last_checked: '2026-05-06',
      action_when_moves: 'do thing',
      status: 'watching',
      ...opts,
    };
    let row = `### ${slug}: label\n\n`;
    for (const [k, v] of Object.entries(o)) {
      if (v === null) continue;
      row += `- **${k}**: ${v}\n`;
    }
    return row + '\n';
  }

  it('passes on a well-formed row', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-signals-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs/signals-backlog.md'),
      SIGNALS_FRONTMATTER + makeRow('valid-slug'),
    );
    const { exitCode } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(0);
  });

  it('FAILs when a required bullet is missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-signals-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs/signals-backlog.md'),
      SIGNALS_FRONTMATTER + makeRow('missing-status', { status: null }),
    );
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    const errs = parsed.errors.filter((e) => e.category === 'signals-schema-invalid');
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/missing required bullet `\*\*status\*\*`/);
  });

  it('FAILs on an invalid status value', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-signals-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs/signals-backlog.md'),
      SIGNALS_FRONTMATTER + makeRow('bad-status', { status: 'wat' }),
    );
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    const errs = parsed.errors.filter((e) => e.category === 'signals-schema-invalid');
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/invalid status "wat"/);
  });

  it('FAILs on a non-ISO last_checked', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-signals-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs/signals-backlog.md'),
      SIGNALS_FRONTMATTER + makeRow('bad-date', { last_checked: 'yesterday' }),
    );
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    const errs = parsed.errors.filter((e) => e.category === 'signals-schema-invalid');
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/invalid last_checked "yesterday"/);
  });

  it('accepts an optional staleness_days override', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-signals-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs/signals-backlog.md'),
      SIGNALS_FRONTMATTER + makeRow('with-override', { staleness_days: '14' }),
    );
    const { exitCode } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(0);
  });

  it('FAILs on a non-positive staleness_days', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-signals-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs/signals-backlog.md'),
      SIGNALS_FRONTMATTER + makeRow('bad-override', { staleness_days: '-1' }),
    );
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    const errs = parsed.errors.filter((e) => e.category === 'signals-schema-invalid');
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/invalid staleness_days "-1"/);
  });

  it('ignores schema-shaped lines inside code fences (preamble examples)', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-signals-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    const withFence = `---\nlast-updated: 2026-05-06\n---\n# Signals\n\n## Schema\n\n\`\`\`markdown\n### example: label\n\n- **watching**: stuff\n\`\`\`\n\n## Watching\n\n${makeRow('real-row')}`;
    writeFileSync(join(dir, 'docs/signals-backlog.md'), withFence);
    const { exitCode } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(0);
  });

  it('passes silently when signals-backlog.md does not exist', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-signals-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    const { exitCode } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(0);
  });
});
