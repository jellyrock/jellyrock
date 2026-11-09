// Answers the git and gh commands scripts/changelog-syncer.js runs, for tests that mock
// node:child_process. The git-fixture tests (changelog-syncer.test.js) drive real git
// but cannot answer gh; these answer both from a plain description of the history.

/** `git log` output in the syncer's own delimiter format, newest first. */
export function gitLog(commits) {
  return commits
    .map(
      ({ hash, subject, name = 'Some One', email = 'some.one@example.com' }) =>
        `COMMIT_START${hash}\nCOMMIT_AUTHOR\n${name}\n${email}\nCOMMIT_MSG_START\n${subject}\n\nCOMMIT_END`,
    )
    .join('\n');
}

/**
 * Wire mocked `execSync` and `execFileSync` to a described history.
 *
 * @param {{execSync: Function, execFileSync: Function}} mocks
 * @param {object} history
 * @param {Array<{hash: string, subject: string, name?: string, email?: string}>} history.commits
 *   newest first
 * @param {Object<string, object>} [history.prs]  `gh pr view` answers by PR number
 * @param {Object<string, string|null>} [history.logins]  GitHub login by commit hash; a hash
 *   left out is missing from GitHub's answer
 * @param {string|null} [history.latestTag]
 * @param {Object<string, number>} [history.earlierPrs]  merged PRs before the range, by login
 * @param {string[]} [history.earlierCommitLogins]  logins with a commit before the range
 * @param {string[]} [history.earlierNames]  git names with a commit before the range
 * @param {RegExp} [history.fail]  a command matching it fails, as gh does on an error
 * @returns {string[]} every command run, for asserting on the calls made
 */
export function stubHistory({ execSync, execFileSync }, history) {
  const {
    commits,
    prs = {},
    logins = {},
    latestTag = 'v1.0.0',
    earlierPrs = {},
    earlierCommitLogins = [],
    earlierNames = [],
    fail,
  } = history;
  const calls = [];
  const check = (cmd) => {
    calls.push(cmd);
    if (fail && fail.test(cmd)) throw new Error(`stub failure: ${cmd}`);
  };

  execSync.mockImplementation((cmd) => {
    check(cmd);
    if (cmd.startsWith('git log')) return gitLog(commits);
    if (cmd.startsWith('git describe')) {
      if (!latestTag) throw new Error('no tags');
      return `${latestTag}\n`;
    }
    throw new Error(`unexpected command: ${cmd}`);
  });

  execFileSync.mockImplementation((file, args) => {
    const cmd = [file, ...args].join(' ');
    check(cmd);
    if (file === 'gh' && args[0] === 'pr' && args[1] === 'view') {
      const info = prs[args[2]];
      if (!info) throw new Error(`no pull request #${args[2]}`);
      return JSON.stringify(info);
    }
    if (file === 'git' && args[0] === 'rev-parse') return 'f'.repeat(40) + '\n';
    if (file === 'git' && args.includes('--format=%cI')) return '2026-01-01T00:00:00+00:00\n';
    if (file === 'git' && args.includes('--format=%an')) return earlierNames.join('\n') + '\n';
    if (file === 'gh' && args.some((a) => /\/compare\/|\/commits\?sha=/.test(a))) {
      return Object.entries(logins)
        .map(([hash, login]) => `${hash}\t${login ?? ''}`)
        .join('\n');
    }
    if (file === 'gh' && args.includes('search/issues')) {
      const q = args.find((a) => a.startsWith('q='));
      const login = q.match(/author:(\S+)/)[1];
      return `${earlierPrs[login] ?? 0}\n`;
    }
    const byAuthor = args.find((a) => /\/commits\?author=/.test(a));
    if (file === 'gh' && byAuthor) {
      const login = byAuthor.match(/author=([^&]+)/)[1];
      return earlierCommitLogins.includes(login) ? '1\n' : '0\n';
    }
    throw new Error(`unexpected command: ${cmd}`);
  });

  return calls;
}
