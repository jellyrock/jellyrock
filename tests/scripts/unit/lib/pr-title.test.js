/**
 * Unit tests for scripts/lib/pr-title.js — the one map from a PR title's type to its
 * CHANGELOG.md section, shared by the changelog, the PR-title gate and the /pr skill.
 *
 * The word-boundary cases are real titles the previous categorizer got wrong: it matched
 * type words with `startsWith`, so "Cinema mode: …" read as `ci` and was dropped.
 */
import { describe, it, expect } from 'vitest';
import {
  CHANGELOG_SECTIONS,
  TITLE_TYPES,
  changelogSection,
  changelogText,
  describeTypes,
  parseTitle,
  titleProblems,
} from '../../../../scripts/lib/pr-title.js';

describe('pr-title.js', () => {
  describe('TITLE_TYPES', () => {
    it('places every type in a rendered section, or leaves it out', () => {
      for (const [type, section] of Object.entries(TITLE_TYPES)) {
        expect(section === null || CHANGELOG_SECTIONS.includes(section), type).toBe(true);
      }
    });

    it('covers every section, so none can only be reached by accident', () => {
      const reached = new Set(Object.values(TITLE_TYPES));
      for (const section of CHANGELOG_SECTIONS) expect(reached.has(section), section).toBe(true);
    });
  });

  describe('parseTitle()', () => {
    it('reads type, scope, breaking marker and subject', () => {
      expect(parseTitle('feat(video)!: Play HDR')).toEqual({
        type: 'feat',
        scope: 'video',
        breaking: true,
        subject: 'Play HDR',
        spaced: true,
      });
    });

    it('lower-cases the type, as Conventional Commits requires', () => {
      expect(parseTitle('Fix: Crash').type).toBe('fix');
    });

    it('keeps scopes this repo has used, whatever their characters', () => {
      for (const scope of ['ItemDetails', 'home,search', 'video/osd', 'claude.md', 'live-tv']) {
        expect(parseTitle(`fix(${scope}): X`).scope).toBe(scope);
      }
    });

    it("reads GitHub's Revert-button title as a revert", () => {
      expect(parseTitle('Revert "fix: Crash"')).toMatchObject({
        type: 'revert',
        subject: 'Revert "fix: Crash"',
      });
    });

    it('returns null for a title with no type', () => {
      expect(parseTitle('Keep the resume point')).toBeNull();
      expect(parseTitle('Cinema mode: play intros twice')).toBeNull();
    });
  });

  describe('changelogSection()', () => {
    it.each([
      ['feat: X', 'Added'],
      ['add: X', 'Added'],
      ['fix(video): X', 'Fixed'],
      ['security: Patch a token leak', 'Fixed'],
      ['update: X', 'Changed'],
      ['refactor: X', 'Changed'],
      ['perf: X', 'Changed'],
      ['Revert "feat: X"', 'Changed'],
      ['remove: X', 'Removed'],
      ['deps: X', 'Dependencies'],
      ['chore(deps): update dependency eslint to v10', 'Dependencies'],
      ['fix(deps): update dependency promises to v0.7.4', 'Dependencies'],
      ['chore: X', null],
      ['ci: X', null],
      ['docs: X', null],
      ['test: X', null],
      ['chore:(docs) sync unreleased changelog entries', null],
      ['chore(journal): sync fix: Stop X', null],
    ])('%s → %s', (title, section) => {
      expect(changelogSection(title)).toBe(section);
    });

    it('does not guess from words: an untyped title lands in Changed', () => {
      for (const title of [
        'Cinema mode: play intros twice',
        'Testing grid shows blank',
        'Fixture loading for tests',
        'Address a crash on Home',
        'Fix the clock',
      ]) {
        expect(changelogSection(title), title).toBe('Changed');
      }
    });

    it('does not let a word in the subject move a typed title', () => {
      expect(changelogSection('fix: Crash in the security settings screen')).toBe('Fixed');
    });

    it('treats an unknown type as untyped', () => {
      expect(changelogSection('cit(rta): Make the leak gate reliable')).toBe('Changed');
    });

    it('puts a PR with a dependency label in Dependencies whatever its title', () => {
      expect(changelogSection('chore: bump', { isDependency: true })).toBe('Dependencies');
    });
  });

  describe('changelogText()', () => {
    it('drops the type and keeps the scope in front', () => {
      expect(changelogText('fix(skills): Make /pr titles name every change')).toBe(
        '(skills) Make /pr titles name every change',
      );
      expect(changelogText('fix: Stop X')).toBe('Stop X');
    });

    it('drops the breaking marker', () => {
      expect(changelogText('feat(api)!: Breaking X')).toBe('(api) Breaking X');
    });

    it('uses an untyped title whole', () => {
      expect(changelogText('Cinema mode: play intros twice')).toBe(
        'Cinema mode: play intros twice',
      );
    });
  });

  describe('titleProblems()', () => {
    it.each([
      'fix: Keep the resume point',
      'fix(video): Keep the resume point',
      'feat(ItemDetails)!: X',
      'FIX: X',
      'Revert "fix: X"',
    ])('accepts %s', (title) => {
      expect(titleProblems(title)).toEqual([]);
    });

    it.each([
      ['', /empty/],
      ['Keep the resume point', /has no type/],
      ['wip: X', /"wip" is not a known type/],
      ['fix(): X', /scope in "\(\)" is empty/],
      ['fix( ): X', /scope in "\(\)" is empty/],
      ['fix( video): X', /starts or ends with a space/],
      ['fix:X', /space after the ":"/],
      ['fix: ', /nothing after the ":"/],
    ])('rejects %j', (title, message) => {
      const problems = titleProblems(title);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join('\n')).toMatch(message);
    });
  });

  describe('describeTypes()', () => {
    it('lists every type once, grouped by section', () => {
      const listed = describeTypes().join(', ');
      for (const type of Object.keys(TITLE_TYPES)) {
        expect(listed).toMatch(new RegExp(`\\b${type}\\b`));
      }
    });
  });
});
