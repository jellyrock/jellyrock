// Tests for scripts/generate/icons-add.js — covers the pure helpers
// (parseArgs, injectWhiteFill, appendProvenanceRow). The fetch step requires
// network + gh CLI, so it's not exercised here; the underlying contract
// (Material's GitHub URL pattern) is locked by the const declarations in the
// script itself.

import { describe, it, expect, afterEach } from 'vitest';
import {
  parseArgs,
  injectWhiteFill,
  appendProvenanceRow,
} from '../../../../scripts/generate/icons-add.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('icons-add', () => {
  describe('parseArgs', () => {
    it('parses a single material name with no flags (defaults to fill=0 outlined)', () => {
      const out = parseArgs(['node', 'icons-add.js', 'play_arrow']);
      expect(out.materialName).toBe('play_arrow');
      expect(out.jellyRockName).toBe('play_arrow');
      expect(out.fill).toBe(0);
      expect(out.dryRun).toBe(false);
    });

    it('honors --as for renaming', () => {
      const out = parseArgs(['node', 'icons-add.js', 'play_arrow', '--as', 'play']);
      expect(out.materialName).toBe('play_arrow');
      expect(out.jellyRockName).toBe('play');
    });

    it('honors --dry-run', () => {
      const out = parseArgs(['node', 'icons-add.js', 'play_arrow', '--dry-run']);
      expect(out.dryRun).toBe(true);
    });

    it('honors --filled to opt into fill=1', () => {
      const out = parseArgs(['node', 'icons-add.js', 'favorite_selected', '--filled']);
      expect(out.fill).toBe(1);
    });

    it('handles --as before positional', () => {
      const out = parseArgs(['node', 'icons-add.js', '--as', 'chapters', 'menu_book']);
      expect(out.materialName).toBe('menu_book');
      expect(out.jellyRockName).toBe('chapters');
    });

    it('errors on missing material name', () => {
      expect(() => parseArgs(['node', 'icons-add.js'])).toThrow(/Missing required/);
    });

    it('errors on too many positionals', () => {
      expect(() => parseArgs(['node', 'icons-add.js', 'a', 'b'])).toThrow(/Too many/);
    });

    it('errors on unknown flag', () => {
      expect(() => parseArgs(['node', 'icons-add.js', 'play_arrow', '--foo'])).toThrow(
        /Unknown flag/,
      );
    });

    it('errors when --as has no argument', () => {
      expect(() => parseArgs(['node', 'icons-add.js', 'play_arrow', '--as'])).toThrow(
        /--as requires/,
      );
    });
  });

  describe('injectWhiteFill', () => {
    it('injects fill="#FFFFFF" on bare <path d="...">', () => {
      const svg = '<svg><path d="M1 2L3 4Z"/></svg>';
      expect(injectWhiteFill(svg)).toBe('<svg><path fill="#FFFFFF" d="M1 2L3 4Z"/></svg>');
    });

    it('respects an existing fill attribute (does not override)', () => {
      const svg = '<svg><path fill="#FF0000" d="M1 2L3 4Z"/></svg>';
      expect(injectWhiteFill(svg)).toBe(svg);
    });

    it('injects on every <path> in a multi-path SVG', () => {
      const svg = '<svg><path d="M1"/><path d="M2"/></svg>';
      const result = injectWhiteFill(svg);
      expect(result).toBe('<svg><path fill="#FFFFFF" d="M1"/><path fill="#FFFFFF" d="M2"/></svg>');
    });
  });

  describe('appendProvenanceRow', () => {
    let dir;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    function setupReadme(contents) {
      dir = mkdtempSync(join(tmpdir(), 'jellyrock-icons-add-'));
      const path = join(dir, 'README.md');
      writeFileSync(path, contents);
      return path;
    }

    const TABLE_HEADER =
      '| File | Material Symbols name | Style | Weight | Fill | Size | Downloaded |';
    const TABLE_SEP = '|---|---|---|---|---|---|---|';

    it('appends an outlined row (fill=0)', () => {
      const readme = setupReadme(`Some preamble.\n\n${TABLE_HEADER}\n${TABLE_SEP}\n`);
      const result = appendProvenanceRow(readme, 'play', 'play_arrow', 0);
      expect(result).toMatch(
        /\| `play\.svg` \| `play_arrow` \| Rounded \| 500 \| 0 \| `24px` \| \d{4}-\d{2}-\d{2} \|/,
      );
    });

    it('appends a filled row (fill=1)', () => {
      const readme = setupReadme(`Some preamble.\n\n${TABLE_HEADER}\n${TABLE_SEP}\n`);
      const result = appendProvenanceRow(readme, 'favorite_selected', 'favorite', 1);
      expect(result).toMatch(
        /\| `favorite_selected\.svg` \| `favorite` \| Rounded \| 500 \| 1 \| `24px` \| \d{4}-\d{2}-\d{2} \|/,
      );
    });

    it('appends after existing rows', () => {
      const existing = `${TABLE_HEADER}\n${TABLE_SEP}\n| \`pause.svg\` | \`pause\` | Rounded | 500 | 1 | \`24px\` | 2026-01-01 |\n`;
      const readme = setupReadme(`# Header\n\n${existing}`);
      const result = appendProvenanceRow(readme, 'play', 'play_arrow', 0);
      const lines = result.split('\n');
      const pauseIdx = lines.findIndex((l) => l.includes('pause.svg'));
      const playIdx = lines.findIndex((l) => l.includes('play.svg'));
      expect(pauseIdx).toBeGreaterThan(0);
      expect(playIdx).toBeGreaterThan(pauseIdx);
    });

    it('replaces an existing row for the same icon (idempotent re-add)', () => {
      const existing = `${TABLE_HEADER}\n${TABLE_SEP}\n| \`play.svg\` | \`old_name\` | Rounded | 500 | 1 | \`24px\` | 2024-01-01 |\n`;
      const readme = setupReadme(existing);
      const result = appendProvenanceRow(readme, 'play', 'play_arrow', 0);
      const matches = result.match(/play\.svg/g) || [];
      expect(matches.length).toBe(1);
      expect(result).toMatch(/play_arrow/);
      expect(result).not.toMatch(/old_name/);
    });

    it('throws when the table header is missing', () => {
      const readme = setupReadme('No table here.\n');
      expect(() => appendProvenanceRow(readme, 'play', 'play_arrow', 0)).toThrow(
        /Provenance table header not found/,
      );
    });
  });
});
