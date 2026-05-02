// Tests for scripts/lib/lint-excludes.cjs.
//
// Three predicates over repo-relative POSIX paths. The exclude lists
// mirror package.json `lint:*` script flags; this test suite locks the
// behavior so the three surfaces (lint-staged, end-of-turn hook, package
// scripts) can't drift apart silently.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isSpellExcluded,
  isMarkdownExcluded,
  isJsonExcluded,
} = require('../../../../scripts/lib/lint-excludes.cjs');

describe('lint-excludes / isSpellExcluded', () => {
  it('matches CHANGELOG.md (exact)', () => {
    expect(isSpellExcluded('CHANGELOG.md')).toBe(true);
  });

  it('matches docs/user/app-settings.md (exact)', () => {
    expect(isSpellExcluded('docs/user/app-settings.md')).toBe(true);
  });

  it('matches node_modules/foo/README.md (prefix)', () => {
    expect(isSpellExcluded('node_modules/foo/README.md')).toBe(true);
  });

  it('matches .claude/agents/X.md (prefix)', () => {
    expect(isSpellExcluded('.claude/agents/foo.md')).toBe(true);
  });

  it('does not match a regular doc', () => {
    expect(isSpellExcluded('docs/architecture/README.md')).toBe(false);
  });
});

describe('lint-excludes / isMarkdownExcluded', () => {
  it('matches CLAUDE.md (exact)', () => {
    expect(isMarkdownExcluded('CLAUDE.md')).toBe(true);
  });

  it('matches build/ output (prefix)', () => {
    expect(isMarkdownExcluded('build/foo.md')).toBe(true);
  });

  it('matches anything ending in /copilot-instructions.md (suffix)', () => {
    expect(isMarkdownExcluded('.github/copilot-instructions.md')).toBe(true);
  });

  it('does not match a regular doc', () => {
    expect(isMarkdownExcluded('docs/architecture/README.md')).toBe(false);
  });
});

describe('lint-excludes / isJsonExcluded', () => {
  it('matches scripts/foo.json (prefix)', () => {
    expect(isJsonExcluded('scripts/foo.json')).toBe(true);
  });

  it('matches tests/scripts/foo.json (prefix)', () => {
    // Locks the parity with package.json `lint:json` exclude. Without this
    // prefix, lint-staged would run jshint on JSON under tests/scripts/ even
    // though the package.json script skips it — silent surface drift.
    expect(isJsonExcluded('tests/scripts/foo.json')).toBe(true);
  });

  it('matches locale/custom/en_US.json (prefix)', () => {
    expect(isJsonExcluded('locale/custom/en_US.json')).toBe(true);
  });

  it('matches tasks/foo.json (prefix)', () => {
    expect(isJsonExcluded('tasks/foo.json')).toBe(true);
  });

  it('does not match a top-level config JSON', () => {
    expect(isJsonExcluded('bsconfig.json')).toBe(false);
  });
});
