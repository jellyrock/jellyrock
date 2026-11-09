/**
 * `/release-summary`'s script: `context` gathers what the model reads, `check` holds the
 * summary to its shape, `write` puts it into the draft release and nowhere else.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { execSync, execFileSync } = vi.hoisted(() => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));
vi.mock('node:child_process', () => ({ execSync, execFileSync }));

const { ChangelogSyncer } = await import('../../../scripts/changelog-syncer.js');
const { releaseContext, checkSummary, writeSummary, resolveVersion } =
  await import('../../../.claude/skills/release-summary/summary.js');

const URL = 'https://github.com/jellyrock/jellyrock';
const person = (login) => `by [@${login}](https://github.com/${login})`;

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- (home) Add a row ([#20](${URL}/pull/20)) ${person('cewert')}

### Fixed

- (playback) Show buttons ([#21](${URL}/pull/21)) ${person('new-dev')}

### Dependencies

- Update vitest ([#22](${URL}/pull/22)) by [@renovate[bot]](https://github.com/apps/renovate)

### New Contributors

- [@new-dev](https://github.com/new-dev) made their first contribution in [#21](${URL}/pull/21)

## [1.1.0](${URL}/compare/v1.0.4...v1.1.0) - 2025-01-02

### Summary

A feature release that adds search.

- Search finds shows and films (#10)

### Added

- Add search ([#10](${URL}/pull/10)) ${person('cewert')}

## [1.0.4](${URL}/compare/v1.0.3...v1.0.4) - 2025-01-01

### Fixed

- Fix a crash ([#9](${URL}/pull/9)) ${person('cewert')}
`;

const PRS = {
  20: { title: 'feat(home): Add a row', body: 'Adds a row.\n\nRef #40', closes: [30] },
  21: { title: 'fix(playback): Show buttons', body: 'Buttons were hidden. Ref #41', closes: [31] },
  22: { title: 'chore(deps): Update vitest', body: 'RENOVATE BODY', closes: [] },
};
const issue = (title, labels, state, created, closed, association, comments, reactions) => ({
  title,
  labels: labels.map((name) => ({ name })),
  state,
  created_at: created,
  closed_at: closed,
  author_association: association,
  comments,
  reactions: { total_count: reactions },
});
const ISSUES = {
  30: issue(
    'Want a row',
    ['enhancement'],
    'closed',
    '2024-12-01T00:00:00Z',
    '2025-01-10T00:00:00Z',
    'OWNER',
    0,
    0,
  ),
  31: issue(
    'Buttons gone',
    ['bug'],
    'closed',
    '2025-01-05T00:00:00Z',
    '2025-01-20T00:00:00Z',
    'NONE',
    3,
    2,
  ),
  40: issue('[epic] Rows', ['epic'], 'open', '2024-11-01T00:00:00Z', null, 'OWNER', 0, 0),
  41: issue(
    '[epic] Old',
    ['epic'],
    'closed',
    '2024-10-01T00:00:00Z',
    '2024-12-01T00:00:00Z',
    'OWNER',
    0,
    0,
  ),
};

/**
 * Wire the mocks; `release` is the draft (`null`: none), `drafts` the tags of every draft
 * release. Returns the calls made.
 */
function stub({ release = { body: '', isDraft: true }, voice = 0, tags, drafts = [] } = {}) {
  const calls = [];
  execSync.mockImplementation((cmd) => {
    calls.push(cmd);
    if (cmd.startsWith('git tag')) return (tags ?? ['v1.1.0', 'v1.0.4', 'v1.0.3']).join('\n');
    throw new Error(`unexpected command: ${cmd}`);
  });
  execFileSync.mockImplementation((file, args) => {
    const cmd = [file, ...args].join(' ');
    calls.push(cmd);
    if (file === 'git' && args[0] === 'log') return '2025-01-02T12:00:00Z\n';
    if (file === 'bash' && args.includes('--counts')) {
      return `${args.at(-1)}\tem-dash\t${voice}\n${args.at(-1)}\tfiller\t0\n`;
    }
    if (file !== 'gh') throw new Error(`unexpected command: ${cmd}`);
    if (args[0] === 'pr' && args[1] === 'view') {
      const pr = PRS[args[2]];
      return JSON.stringify({
        title: pr.title,
        body: pr.body,
        closingIssuesReferences: pr.closes.map((n) => ({ number: n, url: `${URL}/issues/${n}` })),
      });
    }
    const issuePath =
      args[0] === 'api' && args[1].match(/^repos\/jellyrock\/jellyrock\/issues\/(\d+)$/);
    if (issuePath) return JSON.stringify(ISSUES[issuePath[1]]);
    if (args[0] === 'release' && args[1] === 'list') return drafts.join('\n');
    if (args[0] === 'release' && args[1] === 'view') {
      if (release === null) {
        throw Object.assign(new Error('Command failed'), { stderr: 'release not found\n' });
      }
      return JSON.stringify(release);
    }
    if (args[0] === 'release' && args[1] === 'edit') {
      calls.push(`notes: ${fs.readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8')}`);
      return '';
    }
    throw new Error(`unexpected command: ${cmd}`);
  });
  return calls;
}

const GOOD = `### Summary

Introduces rows on the home screen. Also fixes hidden playback buttons.
`;

describe('release-summary', () => {
  let dir;
  let syncer;
  let features;
  const opts = () => ({ syncer, featuresDir: features, now: new Date('2025-02-01T12:00:00Z') });
  const file = (text) => {
    const f = path.join(dir, 'summary.md');
    fs.writeFileSync(f, text);
    return f;
  };

  beforeEach(() => {
    execSync.mockReset();
    execFileSync.mockReset();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-summary-'));
    syncer = new ChangelogSyncer();
    syncer.changelogPath = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(syncer.changelogPath, CHANGELOG);
    features = path.join(dir, 'features');
    fs.mkdirSync(features);
    fs.writeFileSync(
      path.join(features, 'rows.md'),
      '---\npitch: Rows on home.\nsince: unreleased\n---\n',
    );
    fs.writeFileSync(
      path.join(features, 'search.md'),
      '---\npitch: Find things.\nsince: 1.1.0\n---\n',
    );
    fs.writeFileSync(path.join(features, 'index.md'), '---\nsince: unreleased\n---\n');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('context', () => {
    it('gathers the section, PRs, closing issues, epics, feature pages, history and examples', () => {
      stub();
      const out = releaseContext('1.2.0', opts());
      expect(out).not.toContain('kind:');
      expect(out).toContain('previous: v1.1.0, 30 days before today');
      expect(out).toContain('PRs in this release: #20, #21, #22');
      expect(out).toContain('fixes: 1 line in the Fixed section');
      expect(out).toContain('word limit: 60, for 2 user-facing lines');
      expect(out).toContain('open epics these PRs reference: #40 "[epic] Rows"\n');
      expect(out).toContain('- (playback) Show buttons');
      expect(out).toContain(
        '<pr number="21" title="fix(playback): Show buttons">\nButtons were hidden. Ref #41\n</pr>',
      );
      expect(out).toContain(
        '  closes #31 "Buttons gone" (bug): reported by a user, open 15 days, 3 comments, 2 reactions, opened after v1.1.0\n',
      );
      expect(out).toContain(
        '  closes #30 "Want a row" (enhancement): reported by a maintainer, open 40 days, 0 comments, 0 reactions\n',
      );
      expect(out).toContain('- rows.md: Rows on home.');
      expect(out).not.toContain('search.md');
      expect(out).toContain('<section version="1.1.0">');
      expect(out).toContain('<section version="1.0.4">');
      expect(out).toContain(
        '<example version="1.1.0">\n### Summary\n\nA feature release that adds search.',
      );
    });

    it('skips Dependencies PR bodies and reads each PR and issue once', () => {
      const calls = stub();
      PRS[21].body = 'Buttons were hidden. Ref #41, Ref #40';
      try {
        const out = releaseContext('1.2.0', opts());
        expect(out).not.toContain('RENOVATE BODY');
        expect(calls.filter((c) => c.startsWith('gh pr view'))).toEqual([
          'gh pr view 20 --repo jellyrock/jellyrock --json title,body,closingIssuesReferences',
          'gh pr view 21 --repo jellyrock/jellyrock --json title,body,closingIssuesReferences',
        ]);
        expect(calls.filter((c) => c.endsWith('issues/40'))).toHaveLength(1);
        expect(out.match(/#40 "\[epic\] Rows"/g)).toHaveLength(1);
      } finally {
        PRS[21].body = 'Buttons were hidden. Ref #41';
      }
    });

    it('says when nothing is fixed and no epic is open', () => {
      stub();
      PRS[10] = { title: 'feat: Add search', body: 'Search.', closes: [] };
      const out = releaseContext('1.1.0', opts());
      expect(out).toContain('fixes: none');
      expect(out).toContain('open epics these PRs reference: none');
    });

    it('reads a released version from its own section and its own feature pages', () => {
      stub({ tags: ['v1.1.0', 'v1.0.4', 'v1.0.3'] });
      PRS[10] = { title: 'feat: Add search', body: 'Search.', closes: [] };
      const out = releaseContext('1.1.0', opts());
      expect(out).toContain('PRs in this release: #10');
      expect(out).toContain('previous: v1.0.4, 0 hours before v1.1.0');
      expect(out).toContain('- search.md: Find things.');
      expect(out).not.toContain('<example version="1.1.0">');
    });
  });

  describe('check', () => {
    it('passes a summary of the right shape', () => {
      stub();
      expect(checkSummary(file(GOOD), '1.2.0', opts())).toEqual([]);
    });

    it('passes a paragraph of up to 60 words over more than one line', () => {
      stub();
      const words = Array.from({ length: 29 }, (_, i) => `w${i}`).join(' ');
      const text = `### Summary\n\n${words}.\n${words} end.\n`;
      expect(checkSummary(file(text), '1.2.0', opts())).toEqual([]);
    });

    const long = Array.from({ length: 61 }, (_, i) => `w${i}`).join(' ');
    const cases = [
      ['a missing heading', GOOD.replace('### Summary\n\n', ''), /starts with "### Summary"/],
      ['an empty summary', '### Summary\n', /no text under the heading/],
      ['a bullet list', GOOD + '\n- a change\n', /prose only: line 5 is a list item/],
      ['a numbered list', GOOD + '\n1. a change\n', /prose only: line 5 is a list item/],
      ['a heading inside it', GOOD + '\n#### More\n', /prose only: line 5 is a heading/],
      [
        'more than 60 words in a small release',
        `### Summary\n\n${long}.\n`,
        /61 words; the limit for 2 user-facing lines is 60/,
      ],
    ];
    for (const [name, text, error] of cases) {
      it(`rejects ${name}`, () => {
        stub();
        expect(checkSummary(file(text), '1.2.0', opts()).join('\n')).toMatch(error);
      });
    }

    /** [Unreleased] with `n` user-facing lines, plus Dependencies lines that never count. */
    const releaseOf = (n) =>
      `# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n${Array.from(
        { length: n },
        (_, i) => `- Fix ${i} ([#${i + 100}](${URL}/pull/${i + 100}))`,
      ).join('\n')}\n\n### Dependencies\n\n- Update a ([#99](${URL}/pull/99))\n`;
    const summaryOf = (words) =>
      `### Summary\n\n${Array.from({ length: words }, (_, i) => `w${i}`).join(' ')}.\n`;

    it('allows 2 more words for each user-facing line past 12', () => {
      stub();
      fs.writeFileSync(syncer.changelogPath, releaseOf(20));
      expect(checkSummary(file(summaryOf(76)), '1.2.0', opts())).toEqual([]);
      expect(checkSummary(file(summaryOf(77)), '1.2.0', opts()).join('\n')).toMatch(
        /77 words; the limit for 20 user-facing lines is 76/,
      );
    });

    it('never allows more than 90 words, however large the release', () => {
      stub();
      fs.writeFileSync(syncer.changelogPath, releaseOf(40));
      expect(checkSummary(file(summaryOf(91)), '1.2.0', opts()).join('\n')).toMatch(
        /91 words; the limit for 40 user-facing lines is 90/,
      );
    });

    it('rejects a voice-check failure', () => {
      stub({ voice: 1 });
      expect(checkSummary(file(GOOD), '1.2.0', opts()).join('\n')).toMatch(/em-dash: 1/);
    });
  });

  describe('with no version given', () => {
    it('takes the version from the one draft release', () => {
      stub({ drafts: ['v1.2.0'] });
      expect(resolveVersion(undefined, opts())).toEqual({ version: '1.2.0', from: 'draft' });
    });

    it('keeps a version given, without asking GitHub', () => {
      const calls = stub({ drafts: ['v1.2.0'] });
      expect(resolveVersion('1.3.0', opts())).toEqual({ version: '1.3.0', from: 'argument' });
      expect(calls.some((c) => c.startsWith('gh release list'))).toBe(false);
    });

    it('summarizes [Unreleased] against the latest tag when no draft exists yet', () => {
      stub();
      expect(resolveVersion(undefined, opts())).toEqual({ version: null, from: 'none' });
      const out = releaseContext(null, opts());
      expect(out).toContain('# Release summary context: [Unreleased], no draft release yet');
      expect(out).toContain('previous: v1.1.0, 30 days before today');
      expect(out).toContain('PRs in this release: #20, #21, #22');
    });

    it('ignores a draft whose tag is not a release version', () => {
      stub({ drafts: ['v3.4.0-preview', 'v1.2.0'] });
      expect(resolveVersion(undefined, opts())).toEqual({ version: '1.2.0', from: 'draft' });
    });

    it('stops and lists the drafts when there are several', () => {
      stub({ drafts: ['v1.3.0', 'v1.2.0'] });
      expect(() => resolveVersion(undefined, opts())).toThrow(
        /2 draft releases \(v1\.3\.0, v1\.2\.0\); give the version/,
      );
    });

    it('checks against [Unreleased], and refuses to write until a draft exists', () => {
      stub();
      expect(checkSummary(file(GOOD), null, opts())).toEqual([]);
      expect(() => writeSummary(null, file(GOOD), opts())).toThrow(
        /no draft release yet: push the release-x\.y\.z branch/,
      );
    });
  });

  describe('write', () => {
    const SCHEDULE = '## Release Schedule\n\nJellyRock v1.2.0 is scheduled for Monday\n\n';
    const REST = '### Fixed\n\n- line\n\n## Support JellyRock\n\nThanks\n';
    const summary = GOOD.trim();

    it('puts the summary after the Release Schedule and keeps the rest', () => {
      const calls = stub({ release: { body: SCHEDULE + REST, isDraft: true } });
      writeSummary('1.2.0', file(GOOD), opts());
      expect(calls).toContain(`notes: ${SCHEDULE}${summary}\n\n${REST}`);
    });

    it('replaces a summary already in the draft', () => {
      const old = '### Summary\n\nOld.\n\n- old (#20)\n\n';
      const calls = stub({ release: { body: SCHEDULE + old + REST, isDraft: true } });
      writeSummary('1.2.0', file(GOOD), opts());
      expect(calls).toContain(`notes: ${SCHEDULE}${summary}\n\n${REST}`);
    });

    it('puts the summary where the reminder was, and removes the reminder', () => {
      const reminder = '<!-- No summary yet: run /release-summary 1.2.0 before you publish -->\n\n';
      const calls = stub({ release: { body: SCHEDULE + reminder + REST, isDraft: true } });
      writeSummary('1.2.0', file(GOOD), opts());
      expect(calls).toContain(`notes: ${SCHEDULE}${summary}\n\n${REST}`);
    });

    it('replaces a summary in a draft the GitHub editor saved with CRLF, writing LF', () => {
      const old = '### Summary\n\nOld.\n\n';
      const crlf = (SCHEDULE + old + REST).replace(/\n/g, '\r\n');
      const calls = stub({ release: { body: crlf, isDraft: true } });
      writeSummary('1.2.0', file(GOOD), opts());
      expect(calls).toContain(`notes: ${SCHEDULE}${summary}\n\n${REST}`);
    });

    it('refuses a published release', () => {
      const calls = stub({ release: { body: SCHEDULE + REST, isDraft: false } });
      expect(() => writeSummary('1.2.0', file(GOOD), opts())).toThrow(/published/);
      expect(calls.some((c) => c.startsWith('gh release edit'))).toBe(false);
    });

    it('refuses when there is no draft', () => {
      stub({ release: null });
      expect(() => writeSummary('1.2.0', file(GOOD), opts())).toThrow(/no v1\.2\.0 release/);
    });

    it('refuses a summary that fails the check', () => {
      const calls = stub({ release: { body: SCHEDULE + REST, isDraft: true } });
      expect(() => writeSummary('1.2.0', file(GOOD + '\n- a change\n'), opts())).toThrow(
        /line 5 is a list item/,
      );
      expect(calls.some((c) => c.startsWith('gh release edit'))).toBe(false);
    });
  });
});
