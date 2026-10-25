// Tests for scripts/lint/skill-placeholders-check.js: the gate on argument placeholders
// in skills.
//
// Pure layer: hand-written lines exercise each form the check rejects and each safe form
// it allows. Plus a pass over the REAL committed skills, so a placeholder added to any
// skill fails here as well as in lint.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findHits, skillFiles, main } from '../../../../scripts/lint/skill-placeholders-check.js';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');

const lines = (text) => findHits(text, 'x').map((h) => h.line);

describe('findHits', () => {
  it.each([
    ['a positional field', "awk '{print $4}'"],
    ['$0', 'echo $0'],
    ['$ARGUMENTS', 'The input is `$ARGUMENTS`.'],
    ['an indexed $ARGUMENTS', 'The second word is $ARGUMENTS[1].'],
    ['an arguments: list', 'arguments: [file]'],
  ])('rejects %s', (_name, line) => {
    expect(lines(line)).toEqual([1]);
  });

  it.each([
    ['a spaced awk field', "awk '{print $ 4}'"],
    ['a parenthesized awk field', 'awk "{print $(4)}"'],
    ['a brace fill-in', 'the {{name}} fill-in'],
    ['prose', 'Pass the arguments.'],
    ['an indented arguments: key', '  arguments: nested'],
  ])('allows %s', (_name, line) => {
    expect(lines(line)).toEqual([]);
  });

  it('reports each hit with its line number', () => {
    expect(lines('ok\n$1\nok\n$ARGUMENTS\n')).toEqual([2, 4]);
  });
});

describe('skillFiles', () => {
  it('keeps only skill SKILL.md files, absolute or relative', () => {
    const files = skillFiles(
      [
        resolve(REPO_ROOT, '.claude/skills/log/SKILL.md'),
        '.claude/skills/log/notes.md',
        'docs/README.md',
      ],
      REPO_ROOT,
    );
    expect(files).toEqual(['.claude/skills/log/SKILL.md']);
  });
});

describe('the committed skills', () => {
  it('have no argument placeholders', () => {
    expect(skillFiles([], REPO_ROOT).length).toBeGreaterThan(0);
    expect(main([], REPO_ROOT)).toBe(0);
  });
});
