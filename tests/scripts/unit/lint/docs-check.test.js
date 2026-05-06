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
