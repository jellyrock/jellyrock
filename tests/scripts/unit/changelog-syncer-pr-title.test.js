/**
 * The changelog reads a squash commit's PR title, so a merged PR with the wrong type is
 * fixed by retitling the PR and re-syncing.
 *
 * `git log` and `gh pr view` are mocked: changelog-syncer.test.js drives the real script
 * against a git fixture, but that fixture cannot answer `gh`, which is the part tested
 * here. The key case is the journal-sync commit: its subject ends in the PR's
 * `(#N)` too, and resolving it to the PR's title listed every PR twice (caught rendering
 * v2.29.1..v2.32.0 with the old and new syncer, 2026-09-24).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubHistory } from './_helpers/changelog-gh-stub.js';

const { execSync, execFileSync } = vi.hoisted(() => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));
vi.mock('node:child_process', () => ({ execSync, execFileSync }));

const { ChangelogSyncer } = await import('../../../scripts/changelog-syncer.js');

const SQUASH = 'aaaaaaa';
const JOURNAL = 'bbbbbbb';

function stub({ commits, prs }) {
  stubHistory(
    { execSync, execFileSync },
    { commits: commits.map(([hash, subject]) => ({ hash, subject })), prs },
  );
}

describe('changelog-syncer: PR titles', () => {
  beforeEach(() => {
    execSync.mockReset();
    execFileSync.mockReset();
  });

  it("uses the PR's current title for its own squash commit", () => {
    stub({
      commits: [[SQUASH, 'Keep the resume point (#1025)']],
      prs: {
        1025: {
          title: 'fix: Keep the resume point',
          labels: ['bug-fix'],
          mergeCommit: `${SQUASH}0123456789`,
          author: 'cewert',
        },
      },
    });
    const [commit] = new ChangelogSyncer().getCommitsSince('v1.0.0');
    expect(commit.message).toBe('fix: Keep the resume point');

    const sections = new ChangelogSyncer().categorizeCommits([commit]);
    expect(sections.Fixed).toEqual([
      '- Keep the resume point ([#1025](https://github.com/jellyrock/jellyrock/pull/1025)) by [@cewert](https://github.com/cewert)',
    ]);
    expect(sections.Changed).toEqual([]);
  });

  it("keeps another commit's own subject when it merely ends in the PR number", () => {
    stub({
      commits: [
        [JOURNAL, 'chore(journal): sync fix: Keep the resume point (#1025)'],
        [SQUASH, 'fix: Keep the resume point (#1025)'],
      ],
      prs: {
        1025: {
          title: 'fix: Keep the resume point',
          labels: [],
          mergeCommit: `${SQUASH}0123`,
          author: 'cewert',
        },
      },
    });
    const syncer = new ChangelogSyncer();
    const commits = syncer.getCommitsSince('v1.0.0');
    expect(commits.map((c) => c.message)).toEqual([
      'chore(journal): sync fix: Keep the resume point',
      'fix: Keep the resume point',
    ]);
    expect(syncer.categorizeCommits(commits).Fixed).toHaveLength(1);
  });

  it('throws when the PR cannot be read, rather than guessing from the commit', () => {
    stub({ commits: [[SQUASH, 'fix: Keep the resume point (#1025)']], prs: {} });
    expect(() => new ChangelogSyncer().getCommitsSince('v1.0.0')).toThrow(/#1025/);
  });
});
