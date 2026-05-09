// Tests for scripts/journal-sync.js — the post-merge mechanical edit
// engine for docs/progress.md.
//
// Two layers:
//   - Pure-function tests (tokenize, shouldSkip, applyShipEdit) — no fs.
//   - CLI tests via spawnScript with a temp repo fixture to exercise
//     argv parsing, file IO, idempotency, and dry-run.
//
// Hermetic: no network, no real progress.md mutation. Each fs-touching
// test builds its own progress.md inside the git fixture.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  tokenize,
  tokenOverlap,
  shouldSkip,
  applyShipEdit,
  extractCurrentlyRunning,
} from '../../../scripts/journal-sync.js';

import { spawnScript } from './_helpers/spawn-script.js';
import { createGitFixture } from './_helpers/temp-git-fixture.js';

const SCRIPT = 'scripts/journal-sync.js';
const TODAY = new Date().toISOString().slice(0, 10);

function progressTemplate({ lastUpdated = '2026-05-01', running = '', shipped = [] } = {}) {
  const shippedBlock = shipped.length ? shipped.map((s) => `- ${s}`).join('\n') : '(empty for now)';
  return `---
last-updated: ${lastUpdated}
---

# Progress

Live state cursor.

## Currently running

${running}

## Recently shipped

Newest first. Items older than ~14 days are pruned manually.

${shippedBlock}

## Open followups

### scripts

(none)
`;
}

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────────

describe('tokenize', () => {
  it('strips conventional-commit prefix', () => {
    const t = tokenize('feat(catchup): auto-maintain signals');
    expect(t.has('catchup')).toBe(false); // scope dropped via prefix strip
    expect(t.has('auto')).toBe(true);
    expect(t.has('maintain')).toBe(true);
    expect(t.has('signals')).toBe(true);
  });

  it('drops stopwords + short tokens + numerals', () => {
    // All tokens are stopwords / 1-2 chars / pure numerals — nothing left.
    const t = tokenize('the a is and 3 of feat fix');
    expect(t.size).toBe(0);
  });

  it('lowercases and strips punctuation', () => {
    const t = tokenize('Reshape (the) `Journal/skill`-system, into [four]-pillar!');
    expect(t.has('reshape')).toBe(true);
    expect(t.has('journal')).toBe(true);
    expect(t.has('skill')).toBe(true);
    expect(t.has('system')).toBe(true);
    expect(t.has('four')).toBe(true);
    expect(t.has('pillar')).toBe(true);
  });
});

describe('tokenOverlap', () => {
  it('counts shared content tokens', () => {
    expect(tokenOverlap('reshape journal pillar', 'four pillar journal')).toBe(2);
  });

  it('returns 0 when nothing meaningful overlaps', () => {
    expect(tokenOverlap('feat: add foo', 'fix: bar baz')).toBe(0);
  });

  it('handles empty strings', () => {
    expect(tokenOverlap('', 'whatever')).toBe(0);
    expect(tokenOverlap('whatever', '')).toBe(0);
  });
});

describe('extractCurrentlyRunning', () => {
  it('extracts the running paragraph between headings', () => {
    const md = progressTemplate({ running: 'Working on foo bar baz.' });
    expect(extractCurrentlyRunning(md)).toBe('Working on foo bar baz.');
  });

  it('returns empty when section is empty', () => {
    const md = progressTemplate({ running: '' });
    expect(extractCurrentlyRunning(md)).toBe('');
  });

  it('collapses multi-line paragraphs to single line', () => {
    const md = progressTemplate({ running: 'line one\nline two\nline three' });
    expect(extractCurrentlyRunning(md)).toBe('line one line two line three');
  });
});

describe('shouldSkip', () => {
  it('skips on dependencies label', () => {
    expect(shouldSkip({ prTitle: 'feat: add foo', prLabels: ['dependencies'] })).toMatch(
      /dependencies/,
    );
  });

  it('skips on documentation label', () => {
    expect(shouldSkip({ prTitle: 'feat: add foo', prLabels: ['documentation'] })).toMatch(
      /documentation/,
    );
  });

  it('skips on dependabot author', () => {
    expect(shouldSkip({ prTitle: 'chore: bump deps', prAuthor: 'app/dependabot' })).toMatch(
      /bot pattern/,
    );
  });

  it('skips on Renovate-shaped title', () => {
    expect(shouldSkip({ prTitle: 'chore(deps): update foo' })).toMatch(/auto-generated/);
  });

  it('skips on weblate sync title', () => {
    expect(shouldSkip({ prTitle: 'chore: sync translations from weblate' })).toMatch(
      /auto-generated/,
    );
  });

  it('proceeds (returns null) for a normal feature title', () => {
    expect(shouldSkip({ prTitle: 'feat(catchup): auto-maintain signals' })).toBe(null);
  });

  it('rejects empty title', () => {
    expect(shouldSkip({ prTitle: '' })).toMatch(/empty/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// applyShipEdit
// ──────────────────────────────────────────────────────────────────────────

describe('applyShipEdit', () => {
  it('prepends a Recently shipped bullet and bumps last-updated', () => {
    const before = progressTemplate({
      lastUpdated: '2026-05-01',
      running: '',
      shipped: ['2026-05-01 — older shipment'],
    });
    const r = applyShipEdit(before, { prTitle: 'feat: ship widget', today: '2026-05-10' });
    expect(r.changed).toBe(true);
    expect(r.idempotent).toBe(false);
    expect(r.content).toContain('- 2026-05-10 — feat: ship widget');
    expect(r.content).toContain('last-updated: 2026-05-10');
    // Older shipment still there, after the new entry
    const newIdx = r.content.indexOf('- 2026-05-10 — feat: ship widget');
    const oldIdx = r.content.indexOf('- 2026-05-01 — older shipment');
    expect(newIdx).toBeGreaterThan(0);
    expect(oldIdx).toBeGreaterThan(newIdx);
  });

  it('clears Currently running when cursor overlaps PR title', () => {
    const before = progressTemplate({
      running: 'Reshaping the journal pillar system into four-pillar pattern.',
    });
    const r = applyShipEdit(before, {
      prTitle: 'feat(journal): reshape into four-pillar pattern',
      today: '2026-05-10',
    });
    expect(r.cursorCleared).toBe(true);
    expect(extractCurrentlyRunning(r.content)).toBe('');
  });

  it('leaves Currently running alone when cursor and title are unrelated', () => {
    const before = progressTemplate({
      running: 'Working on the video player chapter scrubber.',
    });
    const r = applyShipEdit(before, {
      prTitle: 'fix(api): handle null in user settings response',
      today: '2026-05-10',
    });
    expect(r.cursorCleared).toBe(false);
    expect(extractCurrentlyRunning(r.content)).toContain('chapter scrubber');
  });

  it('is idempotent: same PR title + same today does not duplicate', () => {
    const first = progressTemplate({});
    const r1 = applyShipEdit(first, { prTitle: 'feat: ship widget', today: '2026-05-10' });
    expect(r1.changed).toBe(true);
    const r2 = applyShipEdit(r1.content, { prTitle: 'feat: ship widget', today: '2026-05-10' });
    expect(r2.idempotent).toBe(true);
    expect(r2.content).toBe(r1.content);
  });

  it('two different PRs on the same day both prepend cleanly', () => {
    const start = progressTemplate({});
    const r1 = applyShipEdit(start, { prTitle: 'feat: alpha widget', today: '2026-05-10' });
    const r2 = applyShipEdit(r1.content, { prTitle: 'fix: beta crash', today: '2026-05-10' });
    expect(r2.changed).toBe(true);
    expect(r2.idempotent).toBe(false);
    expect(r2.content).toContain('- 2026-05-10 — fix: beta crash');
    expect(r2.content).toContain('- 2026-05-10 — feat: alpha widget');
    // Newest (r2) appears before older (r1) in the file
    expect(r2.content.indexOf('beta crash')).toBeLessThan(r2.content.indexOf('alpha widget'));
  });

  it('throws on empty content (refuses to write blind)', () => {
    expect(() => applyShipEdit('', { prTitle: 'x', today: TODAY })).toThrow(/empty/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// CLI shell
// ──────────────────────────────────────────────────────────────────────────

describe('CLI: ship', () => {
  let fix;

  afterEach(() => {
    if (fix) fix.cleanup();
    fix = null;
  });

  function setupFixture(progressContent) {
    fix = createGitFixture();
    mkdirSync(join(fix.dir, 'docs'), { recursive: true });
    writeFileSync(join(fix.dir, 'docs/progress.md'), progressContent);
    return fix;
  }

  it('writes a Recently shipped bullet for a normal PR', () => {
    setupFixture(progressTemplate({}));
    const { exitCode, stdout } = spawnScript(
      SCRIPT,
      ['ship', '--pr-title', 'feat(catchup): auto-maintain signals', '--repo-root', fix.dir],
      { cwd: fix.dir },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^shipped:/);
    const after = readFileSync(join(fix.dir, 'docs/progress.md'), 'utf8');
    expect(after).toContain(`- ${TODAY} — feat(catchup): auto-maintain signals`);
    expect(after).toContain(`last-updated: ${TODAY}`);
  });

  it('skips when label is dependencies', () => {
    setupFixture(progressTemplate({}));
    const { exitCode, stdout } = spawnScript(
      SCRIPT,
      [
        'ship',
        '--pr-title',
        'chore(deps): bump foo to 2.0',
        '--pr-labels',
        'dependencies',
        '--repo-root',
        fix.dir,
      ],
      { cwd: fix.dir },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^skipped:/);
    const after = readFileSync(join(fix.dir, 'docs/progress.md'), 'utf8');
    expect(after).not.toContain('chore(deps)');
  });

  it('skips when author is a bot', () => {
    setupFixture(progressTemplate({}));
    const { exitCode, stdout } = spawnScript(
      SCRIPT,
      [
        'ship',
        '--pr-title',
        'feat: noisy auto thing',
        '--pr-author',
        'app/renovate',
        '--repo-root',
        fix.dir,
      ],
      { cwd: fix.dir },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^skipped: author/);
  });

  it('skips on Renovate-shaped title even without label', () => {
    setupFixture(progressTemplate({}));
    const { exitCode, stdout } = spawnScript(
      SCRIPT,
      ['ship', '--pr-title', 'chore(deps): update dependency foo to v2', '--repo-root', fix.dir],
      { cwd: fix.dir },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^skipped: title/);
  });

  it('--dry-run prints the proposed file but does not write', () => {
    const before = progressTemplate({});
    setupFixture(before);
    const { exitCode, stdout } = spawnScript(
      SCRIPT,
      ['ship', '--pr-title', 'feat: dry run check', '--repo-root', fix.dir, '--dry-run'],
      { cwd: fix.dir },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`- ${TODAY} — feat: dry run check`);
    // File on disk is untouched
    expect(readFileSync(join(fix.dir, 'docs/progress.md'), 'utf8')).toBe(before);
  });

  it('exits 2 when --pr-title is missing', () => {
    setupFixture(progressTemplate({}));
    const { exitCode, stderr } = spawnScript(SCRIPT, ['ship', '--repo-root', fix.dir], {
      cwd: fix.dir,
    });
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/--pr-title/);
  });

  it('exits 2 when progress.md does not exist', () => {
    fix = createGitFixture();
    // Note: no docs/progress.md created.
    const { exitCode, stderr } = spawnScript(
      SCRIPT,
      ['ship', '--pr-title', 'feat: nope', '--repo-root', fix.dir],
      { cwd: fix.dir },
    );
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/not found/);
  });

  it('idempotent re-run produces no second bullet', () => {
    setupFixture(progressTemplate({}));
    const args = ['ship', '--pr-title', 'feat: idempotency test', '--repo-root', fix.dir];
    spawnScript(SCRIPT, args, { cwd: fix.dir });
    const { exitCode, stdout } = spawnScript(SCRIPT, args, { cwd: fix.dir });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^skipped:.*duplicate/);
    const after = readFileSync(join(fix.dir, 'docs/progress.md'), 'utf8');
    const occurrences = (after.match(/feat: idempotency test/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it('clears the cursor when overlap matches', () => {
    const before = progressTemplate({
      running: 'Building the catchup auto-maintain signals work.',
    });
    setupFixture(before);
    const { exitCode } = spawnScript(
      SCRIPT,
      [
        'ship',
        '--pr-title',
        'feat(catchup): auto-maintain signals + top-3 tech debt',
        '--repo-root',
        fix.dir,
      ],
      { cwd: fix.dir },
    );
    expect(exitCode).toBe(0);
    const after = readFileSync(join(fix.dir, 'docs/progress.md'), 'utf8');
    // Use the same exported helper so the test mirrors the script's parser
    // exactly — earlier inline regex had a `\s*\n` greedy-swallow bug.
    expect(extractCurrentlyRunning(after)).toBe('');
  });
});
