// Tests for scripts/lint/docs-stale.cjs.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';

const SCRIPT = 'scripts/lint/docs-stale.cjs';

function setupDocsTree(docs = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-docs-stale-'));
  mkdirSync(join(dir, 'docs', 'architecture'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'dev'), { recursive: true });
  for (const [relPath, content] of Object.entries(docs)) {
    writeFileSync(join(dir, relPath), content);
  }
  return dir;
}

function fmDoc(date) {
  if (date === null) {
    return `---\ntopic: foo\n---\n# Heading\n`;
  }
  return `---\ntopic: foo\nlast-reviewed: ${date}\n---\n# Heading\n`;
}

const today = new Date().toISOString().slice(0, 10);
const longAgo = '2020-01-01';
const recent = today;

describe('docs-stale', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 with --json output when all docs are fresh', () => {
    dir = setupDocsTree({
      'docs/architecture/foo.md': fmDoc(recent),
      'docs/dev/bar.md': fmDoc(recent),
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.findings).toHaveLength(2);
    expect(result.findings.every((f) => f.status === 'fresh')).toBe(true);
  });

  it('marks docs older than threshold as stale', () => {
    dir = setupDocsTree({
      'docs/architecture/foo.md': fmDoc(longAgo),
    });
    const { stdout } = spawnScript(SCRIPT, [dir, '--json']);
    const result = JSON.parse(stdout);
    expect(result.findings[0].status).toBe('stale');
  });

  it('marks docs without a last-reviewed date as no-date', () => {
    dir = setupDocsTree({
      'docs/architecture/foo.md': fmDoc(null),
    });
    const { stdout } = spawnScript(SCRIPT, [dir, '--json']);
    const result = JSON.parse(stdout);
    expect(result.findings[0].status).toBe('no-date');
  });

  it('honors --days override', () => {
    dir = setupDocsTree({
      'docs/architecture/foo.md': fmDoc(longAgo),
    });
    // 100000-day threshold means even longAgo is fresh.
    const { stdout } = spawnScript(SCRIPT, [dir, '--days', '100000', '--json']);
    const result = JSON.parse(stdout);
    expect(result.threshold).toBe(100000);
    expect(result.findings[0].status).toBe('fresh');
  });

  it('exits 1 with --strict when any doc is stale', () => {
    dir = setupDocsTree({
      'docs/architecture/foo.md': fmDoc(longAgo),
    });
    const { exitCode } = spawnScript(SCRIPT, [dir, '--strict']);
    expect(exitCode).toBe(1);
  });

  it('exits 0 with --strict when all docs are fresh', () => {
    dir = setupDocsTree({
      'docs/architecture/foo.md': fmDoc(recent),
    });
    const { exitCode } = spawnScript(SCRIPT, [dir, '--strict']);
    expect(exitCode).toBe(0);
  });

  it('skips README.md within the docs dirs', () => {
    dir = setupDocsTree({
      'docs/architecture/README.md': fmDoc(longAgo),
      'docs/architecture/foo.md': fmDoc(recent),
    });
    const { stdout } = spawnScript(SCRIPT, [dir, '--json']);
    const result = JSON.parse(stdout);
    // Only foo.md tracked; README.md ignored even though it's old.
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toMatch(/foo\.md/);
  });
});
