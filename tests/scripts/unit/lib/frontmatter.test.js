// Tests for scripts/lib/frontmatter.cjs.
//
// Pure functions over markdown-with-frontmatter strings (no fs except for
// pathMatches's optional disk check). Tests use createRequire so the .cjs
// module loads cleanly under Vitest's ESM runner.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  readFrontmatter,
  getLastReviewed,
  parseRelatedFiles,
  pathMatches,
} = require('../../../../scripts/lib/frontmatter.cjs');

describe('frontmatter / readFrontmatter', () => {
  it('extracts the inner block from a fenced document', () => {
    const doc = '---\ntopic: foo\nlast-reviewed: 2026-05-01\n---\n# Heading\n';
    expect(readFrontmatter(doc)).toBe('topic: foo\nlast-reviewed: 2026-05-01');
  });

  it('returns null when no frontmatter is present', () => {
    expect(readFrontmatter('# Heading\nNo frontmatter here.\n')).toBeNull();
  });

  it('handles CRLF line endings', () => {
    const doc = '---\r\ntopic: foo\r\n---\r\n# Heading\r\n';
    expect(readFrontmatter(doc)).toBe('topic: foo');
  });
});

describe('frontmatter / getLastReviewed', () => {
  it('returns the ISO date when present', () => {
    expect(getLastReviewed('topic: foo\nlast-reviewed: 2026-05-01\n')).toBe('2026-05-01');
  });

  it('returns null when the field is absent', () => {
    expect(getLastReviewed('topic: foo')).toBeNull();
  });

  it('returns null when frontmatter is null', () => {
    expect(getLastReviewed(null)).toBeNull();
  });

  it('returns null when the date format is malformed', () => {
    expect(getLastReviewed('last-reviewed: 5/1/2026')).toBeNull();
  });
});

describe('frontmatter / parseRelatedFiles', () => {
  it('returns [] for the empty-array literal form', () => {
    expect(parseRelatedFiles('related-files: []')).toEqual([]);
  });

  it('parses the multi-line form', () => {
    const fm =
      'topic: foo\nrelated-files:\n  - source/foo.bs\n  - source/bar.bs\nlast-reviewed: 2026-05-01';
    expect(parseRelatedFiles(fm)).toEqual(['source/foo.bs', 'source/bar.bs']);
  });

  it('stops at the next top-level frontmatter key', () => {
    // Asserts the parser doesn't treat the next field's value as a list entry.
    const fm = 'related-files:\n  - source/foo.bs\nlast-reviewed: 2026-05-01';
    expect(parseRelatedFiles(fm)).toEqual(['source/foo.bs']);
  });

  it('returns [] when related-files key is absent', () => {
    expect(parseRelatedFiles('topic: foo\nlast-reviewed: 2026-05-01')).toEqual([]);
  });

  it('returns [] when frontmatter is null', () => {
    expect(parseRelatedFiles(null)).toEqual([]);
  });
});

describe('frontmatter / pathMatches', () => {
  let tmpDir;
  let realDir;
  let realFile;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'jellyrock-frontmatter-'));
    realDir = join(tmpDir, 'realdir');
    realFile = join(tmpDir, 'realfile.bs');
    mkdirSync(realDir);
    writeFileSync(realFile, 'sub init()\nend sub\n');
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true on exact file match', () => {
    expect(pathMatches('source/foo.bs', 'source/foo.bs')).toBe(true);
  });

  it('returns true when touched is inside a real directory entry', () => {
    expect(pathMatches(join(realDir, 'sub', 'x.bs'), realDir)).toBe(true);
  });

  it('returns false on path mismatch when the entry exists as a file', () => {
    expect(pathMatches('source/other.bs', realFile)).toBe(false);
  });

  it('returns false when entry is missing on disk and paths differ', () => {
    // Stale related-files entries silently stop matching here — that's
    // by design; lint:docs catches the staleness.
    expect(pathMatches('source/foo.bs', 'source/renamed.bs')).toBe(false);
  });
});
