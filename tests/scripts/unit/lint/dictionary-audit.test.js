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

describe('dictionary-audit classify() / unescaped regex metacharacters', () => {
  // spellchecker-cli compiles each entry to an ANCHORED regex, so an unescaped
  // metacharacter silently widens what the entry accepts. Measured against the real
  // binary before this check existed: `.claude` / `.github` / `.vscode` /
  // `.editorconfig` / `v2.0` were all present unescaped, and `Xclaude`, `Xgithub`,
  // `Xvscode`, `Xeditorconfig` and `v2X0` therefore passed the spellchecker.
  it.each([
    ['.claude'],
    ['.github'],
    ['.vscode'],
    ['.editorconfig'],
    ['v2.0'],
    ['foo*'],
    ['a|b'],
    ['x+'],
  ])('flags %s', (word) => {
    const verdict = classify(word);
    expect(verdict).not.toBeNull();
    expect(verdict.reason).toMatch(/^unescaped regex metacharacter/);
  });

  it.each([['\\.claude'], ['\\.github'], ['\\.vscode'], ['\\.editorconfig'], ['v2\\.0']])(
    'accepts the escaped form %s',
    (word) => {
      expect(classify(word)).toBeNull();
    },
  );

  it('does not let the escape character itself trip the path-separator rule', () => {
    // The regression this guards: the identifier-shape checks read the RAW entry,
    // so `\\.claude` was rejected as containing a path separator — the audit
    // rejecting the exact fix it had just demanded.
    expect(classify('\\.claude')).toBeNull();
  });

  it('reports an identifier-shaped entry as identifier-shaped, not as a metacharacter', () => {
    // The unescape must not become a way to smuggle an identifier past the audit.
    const verdict = classify('src\\/BaseGridView');
    expect(verdict).not.toBeNull();
    expect(verdict.reason).not.toMatch(/^unescaped regex metacharacter/);
  });

  it('catches an allowlisted proper noun that carries a live metacharacter', () => {
    // The metacharacter check runs AFTER the shape checks (an identifier-shaped
    // entry should be deleted, not escaped), and the allowlist makes `shapeVerdict`
    // return null rather than short-circuiting `classify` — so an allowlisted entry
    // written with a live metacharacter is still caught.
    const [allowlisted] = [...require('../../../../scripts/lint/dictionary-audit.cjs').ALLOWLIST];
    expect(classify(`${allowlisted}.`)).not.toBeNull();
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
