// Tests for scripts/generate/dev-index.cjs.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';

const SCRIPT = 'scripts/generate/dev-index.cjs';

const BEGIN_MARKER =
  '<!-- BEGIN auto-generated dev-index (run `npm run docs:dev-index` to regenerate) -->';
const END_MARKER = '<!-- END auto-generated dev-index -->';

function setupTree(devDocs = {}, readme = null) {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-dev-index-'));
  mkdirSync(join(dir, 'docs', 'dev'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'architecture'), { recursive: true });
  for (const [name, content] of Object.entries(devDocs)) {
    writeFileSync(join(dir, 'docs', 'dev', name), content);
  }
  const readmeContent =
    readme ??
    `# Architecture\n\n## Existing dev guides\n\n${BEGIN_MARKER}\n\nplaceholder\n\n${END_MARKER}\n`;
  writeFileSync(join(dir, 'docs', 'architecture', 'README.md'), readmeContent);
  return dir;
}

describe('dev-index', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('writes the index in default (write) mode', () => {
    dir = setupTree({
      'foo.md': '# Foo Guide\n\nbody\n',
      'bar.md': '# Bar Guide\n\nbody\n',
    });
    const { exitCode } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
    const readme = readFileSync(join(dir, 'docs', 'architecture', 'README.md'), 'utf8');
    expect(readme).toMatch(/\[`docs\/dev\/bar\.md`\].*Bar Guide/);
    expect(readme).toMatch(/\[`docs\/dev\/foo\.md`\].*Foo Guide/);
  });

  it('emits entries sorted alphabetically by filename', () => {
    dir = setupTree({
      'zeta.md': '# Zeta\n',
      'alpha.md': '# Alpha\n',
      'mid.md': '# Mid\n',
    });
    spawnScript(SCRIPT, [dir]);
    const readme = readFileSync(join(dir, 'docs', 'architecture', 'README.md'), 'utf8');
    const alphaIdx = readme.indexOf('alpha.md');
    const midIdx = readme.indexOf('mid.md');
    const zetaIdx = readme.indexOf('zeta.md');
    expect(alphaIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(zetaIdx);
  });

  it('--check exits 0 when README is already in sync', () => {
    dir = setupTree({ 'foo.md': '# Foo\n' });
    spawnScript(SCRIPT, [dir]); // write first
    const { exitCode } = spawnScript(SCRIPT, [dir, '--check']);
    expect(exitCode).toBe(0);
  });

  it('--check exits 1 when README has drifted', () => {
    dir = setupTree({ 'foo.md': '# Foo\n' });
    // Don't run write; placeholder content is between sentinels.
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir, '--check']);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/drift detected/);
  });

  it('errors when a dev doc has no H1 heading', () => {
    dir = setupTree({ 'foo.md': '## Subheading only\n' });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/no H1 heading/);
  });

  it('errors when README is missing the sentinel markers', () => {
    dir = setupTree({ 'foo.md': '# Foo\n' }, '# Architecture\n\nNo sentinels.\n');
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/missing the auto-gen sentinel/);
  });
});
