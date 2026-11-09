/**
 * Every changelog line credits its author, and each section ends with the people who
 * made their first contribution in it.
 *
 * A PR line is credited to the PR's author, never its commit: a merge commit is authored
 * by whoever pressed merge, and a squash commit can carry a personal email. A direct
 * commit is credited to its GitHub login, or its git name when the email is linked to no
 * account. A failed lookup fails the sync: a changelog that quietly drops a credit or a
 * contributor is worse than a sync that stops.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stubHistory } from './_helpers/changelog-gh-stub.js';

const { execSync, execFileSync } = vi.hoisted(() => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));
vi.mock('node:child_process', () => ({ execSync, execFileSync }));

const { ChangelogSyncer } = await import('../../../scripts/changelog-syncer.js');

const URL = 'https://github.com/jellyrock/jellyrock';
const sha = (c) => c.repeat(40);

/** A squash commit for PR `n` and its `gh pr view` answer. */
function squash(c, n, title, author, { labels = [] } = {}) {
  return {
    commit: { hash: sha(c), subject: `${title} (#${n})`, name: 'Squash Author' },
    pr: { [n]: { title, labels, mergeCommit: sha(c), author } },
  };
}

function load(history) {
  stubHistory({ execSync, execFileSync }, history);
  const syncer = new ChangelogSyncer();
  const commits = syncer.getCommitsSince(history.latestTag ?? 'v1.0.0');
  syncer.attachAuthors(commits, history.latestTag ?? 'v1.0.0', 'HEAD');
  return { syncer, commits };
}

describe('changelog-syncer: line credits', () => {
  beforeEach(() => {
    execSync.mockReset();
    execFileSync.mockReset();
  });

  it("credits a PR line to the PR's author, not the commit's", () => {
    const a = squash('a', 913, 'fix(playback): Show buttons', 'new-dev');
    const { syncer, commits } = load({
      commits: [a.commit],
      prs: a.pr,
      logins: { [sha('a')]: 'someone-else' },
    });
    expect(syncer.categorizeCommits(commits).Fixed).toEqual([
      `- (playback) Show buttons ([#913](${URL}/pull/913)) by [@new-dev](https://github.com/new-dev)`,
    ]);
  });

  it("credits a bot's PR to its app page", () => {
    const a = squash('a', 1311, 'feat: Add a thing', 'app/renovate');
    const { syncer, commits } = load({ commits: [a.commit], prs: a.pr, logins: {} });
    expect(syncer.categorizeCommits(commits).Added).toEqual([
      `- Add a thing ([#1311](${URL}/pull/1311)) by [@renovate[bot]](https://github.com/apps/renovate)`,
    ]);
  });

  it('credits a direct commit to its GitHub login, a bot login to its app page', () => {
    const { syncer, commits } = load({
      commits: [
        { hash: sha('b'), subject: 'fix: Patch two', name: 'renovate[bot]' },
        { hash: sha('a'), subject: 'fix: Patch one', name: 'Charles Ewert' },
      ],
      logins: { [sha('a')]: 'cewert', [sha('b')]: 'renovate[bot]' },
    });
    expect(syncer.categorizeCommits(commits).Fixed).toEqual([
      `- Patch two ([bbbbbbb](${URL}/commit/${sha('b')})) by [@renovate[bot]](https://github.com/apps/renovate)`,
      `- Patch one ([aaaaaaa](${URL}/commit/${sha('a')})) by [@cewert](https://github.com/cewert)`,
    ]);
  });

  it('credits a direct commit with no linked account to its git name, as plain text', () => {
    const { syncer, commits } = load({
      commits: [{ hash: sha('a'), subject: 'fix: Patch one', name: 'Pat Example' }],
      logins: { [sha('a')]: null },
    });
    expect(syncer.categorizeCommits(commits).Fixed).toEqual([
      `- Patch one ([aaaaaaa](${URL}/commit/${sha('a')})) by Pat Example`,
    ]);
  });

  it("credits a bot commit GitHub links to no account by its noreply email's bot", () => {
    const { syncer, commits } = load({
      commits: [
        {
          hash: sha('a'),
          subject: 'fix: Patch one',
          name: 'jellyrock',
          email: '3126448+jellyrock[bot]@users.noreply.github.com',
        },
      ],
      logins: { [sha('a')]: null },
    });
    expect(syncer.categorizeCommits(commits).Fixed).toEqual([
      `- Patch one ([aaaaaaa](${URL}/commit/${sha('a')})) by [@jellyrock[bot]](https://github.com/apps/jellyrock)`,
    ]);
  });

  it("credits a commit that only ends in a PR's number to its own author", () => {
    const a = squash('a', 1025, 'fix: Keep the resume point', 'new-dev');
    const { commits } = load({
      commits: [
        {
          hash: sha('b'),
          subject: 'chore(journal): sync fix: Keep the resume point (#1025)',
          name: 'jellyrock[bot]',
        },
        a.commit,
      ],
      prs: a.pr,
      logins: { [sha('a')]: 'cewert', [sha('b')]: 'jellyrock[bot]' },
    });
    expect(commits.map((c) => c.author)).toEqual(['jellyrock[bot]', 'new-dev']);
  });

  it('fails naming the PR when GitHub gives it no author login', () => {
    const a = squash('a', 913, 'fix: Show buttons', null);
    expect(() => load({ commits: [a.commit], prs: a.pr, logins: {} })).toThrow(
      /PR #913 has no author login/,
    );
  });

  it('credits each distinct author once on a combined dependency line', () => {
    const deps = { labels: ['dependencies'] };
    const a = squash(
      'a',
      10,
      'chore(deps): update dependency vitest to v5.0.0',
      'app/renovate',
      deps,
    );
    const b = squash(
      'b',
      11,
      'chore(deps): update dependency vitest to v5.1.0',
      'app/renovate',
      deps,
    );
    const c = squash('c', 12, 'chore(deps): update dependency vitest to v5.2.0', 'cewert', deps);
    const { syncer, commits } = load({
      commits: [c.commit, b.commit, a.commit],
      prs: { ...a.pr, ...b.pr, ...c.pr },
      logins: {},
    });
    const sections = syncer.categorizeCommits(commits);
    expect(syncer.consolidateDependencies(sections.Dependencies)).toEqual([
      `- Update vitest from v5.0.0 to v5.2.0 ([#10](${URL}/pull/10), [#11](${URL}/pull/11), [#12](${URL}/pull/12))` +
        ' by [@renovate[bot]](https://github.com/apps/renovate), [@cewert](https://github.com/cewert)',
    ]);
  });
});

describe('changelog-syncer: New Contributors', () => {
  beforeEach(() => {
    execSync.mockReset();
    execFileSync.mockReset();
  });

  it('lists people whose first PR or commit is in the range, oldest first', () => {
    const secondDev = squash('c', 412, 'feat: Scale images', 'second-dev');
    const firstDev = squash('a', 411, 'fix: Subtitle enum', 'first-dev');
    const { syncer, commits } = load({
      commits: [
        secondDev.commit,
        { hash: sha('b'), subject: 'fix: Direct', name: 'Charles Ewert' },
        firstDev.commit,
      ],
      prs: { ...secondDev.pr, ...firstDev.pr },
      logins: { [sha('b')]: 'cewert' },
      earlierPrs: { cewert: 13 },
    });
    expect(syncer.findNewContributors(commits, 'v1.0.0')).toEqual([
      `- [@first-dev](https://github.com/first-dev) made their first contribution in [#411](${URL}/pull/411)`,
      `- [@second-dev](https://github.com/second-dev) made their first contribution in [#412](${URL}/pull/412)`,
    ]);
  });

  it('leaves out anyone with a commit before the range, and every bot', () => {
    const a = squash('a', 62, 'feat: Prepare', 'jellyrock-bot');
    const b = squash('b', 63, 'feat: Bump', 'app/renovate');
    const { syncer, commits } = load({
      commits: [b.commit, a.commit],
      prs: { ...a.pr, ...b.pr },
      logins: {},
      earlierCommitLogins: ['jellyrock-bot'],
    });
    expect(syncer.findNewContributors(commits, 'v1.0.0')).toEqual([]);
  });

  it('never lists a bot whose commits GitHub links to no account', () => {
    const { syncer, commits } = load({
      commits: [
        {
          hash: sha('b'),
          subject: 'chore: Sync',
          name: 'jellyrock[bot]',
          email: '3126448+jellyrock[bot]@users.noreply.github.com',
        },
        {
          hash: sha('a'),
          subject: 'chore: Sync',
          name: 'jellyrock',
          email: '3126448+jellyrock[bot]@users.noreply.github.com',
        },
      ],
      logins: { [sha('a')]: null, [sha('b')]: null },
    });
    expect(syncer.findNewContributors(commits, 'v1.0.0')).toEqual([]);
  });

  it('lists a git name with no account when local history has no earlier commit by it', () => {
    const { syncer, commits } = load({
      commits: [
        { hash: sha('b'), subject: 'fix: Two', name: 'Old Timer' },
        { hash: sha('a'), subject: 'fix: One', name: 'New Person' },
      ],
      logins: { [sha('a')]: null, [sha('b')]: null },
      earlierNames: ['Old Timer'],
    });
    expect(syncer.findNewContributors(commits, 'v1.0.0')).toEqual([
      `- New Person made their first contribution in [aaaaaaa](${URL}/commit/${sha('a')})`,
    ]);
  });

  it('lists a git name that is only part of an earlier one, which is someone else', () => {
    const { syncer, commits } = load({
      commits: [{ hash: sha('a'), subject: 'fix: One', name: 'Pat' }],
      logins: { [sha('a')]: null },
      earlierNames: ['Patrick'],
    });
    expect(syncer.findNewContributors(commits, 'v1.0.0')).toEqual([
      `- Pat made their first contribution in [aaaaaaa](${URL}/commit/${sha('a')})`,
    ]);
  });

  it('lists nobody for the first release, which has no earlier history to compare with', () => {
    const a = squash('a', 1, 'feat: Start', 'cewert');
    const { syncer, commits } = load({ commits: [a.commit], prs: a.pr, logins: {} });
    expect(syncer.findNewContributors(commits, null)).toEqual([]);
  });

  it('writes New Contributors after Dependencies in the [Unreleased] section', () => {
    const a = squash('a', 913, 'fix: Show buttons', 'new-dev');
    const deps = squash(
      'b',
      1311,
      'chore(deps): update dependency vitest to v5.1.0',
      'app/renovate',
      {
        labels: ['dependencies'],
      },
    );
    stubHistory(
      { execSync, execFileSync },
      { commits: [deps.commit, a.commit], prs: { ...a.pr, ...deps.pr }, logins: {} },
    );
    const syncer = new ChangelogSyncer();
    const out = syncer.updateUnreleasedSection('# Changelog\n\n', syncer.getCommitsSince('v1.0.0'));
    expect(out).toMatch(
      /### Dependencies\n\n- Update vitest to v5\.1\.0 .*\n\n### New Contributors\n\n- \[@new-dev\]\(https:\/\/github\.com\/new-dev\) made their first contribution in \[#913\]/,
    );
  });
});

describe('changelog-syncer: a failed lookup fails the sync', () => {
  beforeEach(() => {
    execSync.mockReset();
    execFileSync.mockReset();
  });

  const a = squash('a', 1025, 'fix: Keep the resume point', 'new-dev');
  const direct = { hash: sha('b'), subject: 'fix: Direct', name: 'Charles Ewert' };

  it.each([
    ['a PR cannot be read', /^gh pr view/],
    ["the range's commits cannot be read", /\/compare\//],
    ['an earlier-PR search fails', /search\/issues/],
    ['an earlier-commit check fails', /commits\?author=/],
  ])('throws when %s', (_, fail) => {
    stubHistory(
      { execSync, execFileSync },
      { commits: [direct, a.commit], prs: a.pr, logins: { [sha('b')]: 'cewert' }, fail },
    );
    const syncer = new ChangelogSyncer();
    expect(() =>
      syncer.updateUnreleasedSection('# Changelog\n\n', syncer.getCommitsSince('v1.0.0')),
    ).toThrow();
  });

  it("throws when a direct commit is missing from GitHub's answer", () => {
    stubHistory({ execSync, execFileSync }, { commits: [direct], logins: {} });
    const syncer = new ChangelogSyncer();
    const commits = syncer.getCommitsSince('v1.0.0');
    expect(() => syncer.attachAuthors(commits, 'v1.0.0', 'HEAD')).toThrow(/bbbbbbb/);
  });
});
