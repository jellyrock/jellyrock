// Tests for scripts/lint/dictionary-audit.cjs.
//
// Two layers:
//  1. classify() unit tests — battery of known-good and known-bad inputs.
//  2. Smoke test — the actual repo dictionary.txt must pass the audit. This
//     protects the on-disk dictionary against regression: if someone strips
//     a needed entry from ALLOWLIST or weakens the heuristic, a real
//     dictionary entry will start getting flagged and this test fails.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classify, audit } = require('../../../../scripts/lint/dictionary-audit.cjs');

describe('dictionary-audit classify()', () => {
  describe('returns null (entry is allowed)', () => {
    it.each([
      // Real English words / domain terms
      ['idempotence'],
      ['transcoder'],
      ['theming'],
      ['affordance'],
      ['namespace'],
      ['callsite'],
      // Plain acronyms
      ['HIG'],
      ['CDN'],
      ['FHD'],
      ['HDR'],
      // Acronym plurals (auto-pattern)
      ['URIs'],
      ['APIs'],
      ['PNGs'],
      ['SVGs'],
      ['READMEs'],
      ['CLIs'],
      // Acronym possessive (auto-pattern)
      ["BSC's"],
      // Allowlisted product names
      ['BrighterScript'],
      ['JavaScript'],
      ['JellyRock'],
      ['ESLint'],
      ['VSCode'],
      ['SceneGraph'],
      // Allowlisted possessive
      ["BrighterScript's"],
      ["JellyRock's"],
      // Allowlisted CS terms
      ['camelCase'],
      ['PascalCase'],
      // Hyphenated compound with allowlisted prefix
      ['GitOps-adjacent'],
      ['Non-Jellyfin'],
      // Hyphenated compound, all-lowercase
      ['user-customizable'],
      ['changelog-sync'],
      ['pre-pipeline'],
    ])('allows %s', (word) => {
      expect(classify(word)).toBeNull();
    });
  });

  describe('flags as identifier-shaped', () => {
    it.each([
      // PascalCase identifiers (2+ humps)
      ['JRRowItem', 'class-prefix identifier'],
      ['JRPlaceholder', 'class-prefix identifier'],
      ['ItemDetails', 'PascalCase identifier'],
      ['MusicArtist', 'PascalCase identifier'],
      ['ItemGrid', 'PascalCase identifier'],
      // camelCase identifiers
      ['blendColor', 'camelCase identifier'],
      ['mediaPlayers', 'camelCase identifier'],
      ['devDependencies', 'camelCase identifier'],
      // File names
      ['package.json', 'file extension'],
      ['progress.md', 'file extension'],
      ['catchup-state.js', 'file extension'],
      ['JRRowItem.xml', 'file extension'],
      // Path separators
      ['source/main.bs', 'path separator'],
      ['components/ui/rowitem', 'path separator'],
    ])('flags %s as %s', (word, expectedReason) => {
      const verdict = classify(word);
      expect(verdict).not.toBeNull();
      expect(verdict.reason).toBe(expectedReason);
    });
  });
});

describe('dictionary-audit audit()', () => {
  it('repo dictionary.txt has no identifier-shaped entries (smoke)', () => {
    const violations = audit();
    if (violations.length > 0) {
      const summary = violations.map((v) => `  line ${v.line}: ${v.word} (${v.reason})`).join('\n');
      throw new Error(
        `dictionary.txt has ${violations.length} identifier-shaped entr${violations.length === 1 ? 'y' : 'ies'}:\n${summary}\n\nFix: remove the entry, backtick the identifier in source markdown.`,
      );
    }
    expect(violations).toEqual([]);
  });
});
