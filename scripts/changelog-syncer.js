/**
 * Simplified Changelog Sync Manager
 *
 * Keeps CHANGELOG.md automatically in sync with git state:
 * - Unreleased section tracks commits since latest tag
 * - Release sections are created when tags are pushed
 * - No manual intervention required
 */

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CHANGELOG_SECTIONS, changelogSection, changelogText } from './lib/pr-title.js';

const ROKU_STORE_URL =
  'https://channelstore.roku.com/details/232f9e82db11ce628e3fe7e01382a330:a85d6e9e520567806e8dae1c0cabadd5/jellyrock';

// Read from the default branch of jellyrock/.github on every build; jellyrock/.github#19
// keeps the path and heading stable for this reader.
const SUPPORT_SOURCE = {
  repo: 'jellyrock/.github',
  path: 'snippets/support.md',
  heading: '## Support JellyRock',
};

// Where a draft's summary goes until /release-summary writes one there. GitHub hides an
// HTML comment on the release page but shows it in the edit box a draft is published from.
const summaryReminder = (version) =>
  `<!-- No summary yet: run /release-summary ${version} before you publish -->`;
const SUMMARY_REMINDER = /^<!-- No summary yet: [^\n]*-->[ \t]*$/m;

class ChangelogSyncer {
  constructor() {
    this.changelogPath = 'CHANGELOG.md';
    this.repo = 'jellyrock/jellyrock';
    this.repositoryUrl = `https://github.com/${this.repo}`;
  }

  /**
   * Sync unreleased changes - called on push to main
   */
  syncUnreleased() {
    console.log('🔄 Syncing unreleased changes...');

    const latestTag = this.getLatestTag();
    if (!latestTag) this.assertTagsFetched();
    const commits = this.getCommitsSince(latestTag);

    if (commits.length === 0) {
      console.log('ℹ️ No unreleased changes to sync');
      return;
    }

    console.log(`📊 Found ${commits.length} unreleased commits since ${latestTag || 'start'}`);

    const changelog = this.readChangelog();
    const updatedChangelog = this.updateUnreleasedSection(changelog, commits);

    fs.writeFileSync(this.changelogPath, updatedChangelog);
    console.log('✅ Unreleased section synced');
  }

  /**
   * Sync release - called when tag is created
   */
  syncRelease(version) {
    console.log(`🚀 Syncing release ${version}...`);

    // Validate version format
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(`Invalid version format: ${version}. Expected: x.y.z`);
    }

    const changelog = this.readChangelog();
    // The commits are read only to build a section when there is no [Unreleased] one to
    // rename. Reading them means asking GitHub, and the release build runs this without
    // a token: a lookup there would fail the release for data it never uses.
    let commits = [];
    if (!changelog.includes('## [Unreleased]')) {
      commits = this.getCommitsSince(this.getPreviousTag(`v${version}`), `v${version}`);
      if (commits.length === 0) {
        console.log('⚠️ No commits found for release - creating minimal entry');
      }
    }

    const updatedChangelog = this.convertUnreleasedToRelease(changelog, version, commits);

    fs.writeFileSync(this.changelogPath, updatedChangelog);
    console.log(`✅ Release ${version} synced to changelog`);
  }

  /**
   * Get current status of changelog
   */
  getStatus() {
    const latestTag = this.getLatestTag();
    const commits = this.getCommitsSince(latestTag);
    const changelog = fs.readFileSync(this.changelogPath, 'utf8');

    const hasUnreleased = changelog.includes('## [Unreleased]');
    const versionEntries = (changelog.match(/## \[\d+\.\d+\.\d+\]/g) || []).length;

    console.log('📊 Changelog Status:');
    console.log(`  Latest tag: ${latestTag || 'none'}`);
    console.log(`  Unreleased commits: ${commits.length}`);
    console.log(`  Has unreleased section: ${hasUnreleased}`);
    console.log(`  Version entries: ${versionEntries}`);

    return {
      latestTag,
      unreleasedCommits: commits.length,
      hasUnreleased,
      versionEntries,
    };
  }

  /**
   * Validate changelog consistency
   */
  validate() {
    console.log('🔍 Validating changelog consistency...');

    // File-existence check has to come before getStatus(), which reads the
    // file unconditionally. Without this guard, a missing CHANGELOG.md
    // crashes with ENOENT instead of producing the intended issue.
    if (!fs.existsSync(this.changelogPath)) {
      console.log('❌ Changelog validation failed:');
      console.log('  - CHANGELOG.md file missing');
      return false;
    }

    const status = this.getStatus();
    const issues = [];

    // Check unreleased section consistency
    if (status.unreleasedCommits > 0 && !status.hasUnreleased) {
      issues.push(`${status.unreleasedCommits} unreleased commits but no [Unreleased] section`);
    }

    if (status.unreleasedCommits === 0 && status.hasUnreleased) {
      // This is actually OK - unreleased section can exist even with no commits
      console.log('ℹ️ [Unreleased] section exists but no unreleased commits (this is fine)');
    }

    // Validate basic format
    const changelog = fs.readFileSync(this.changelogPath, 'utf8');
    if (!changelog.includes('# Changelog')) {
      issues.push('Missing changelog header');
    }

    if (!changelog.includes('Keep a Changelog')) {
      issues.push('Missing Keep a Changelog reference');
    }

    if (issues.length === 0) {
      console.log('✅ Changelog validation passed');
      return true;
    } else {
      console.log('❌ Changelog validation failed:');
      issues.forEach((issue) => console.log(`  - ${issue}`));
      return false;
    }
  }

  // Helper methods
  readChangelog() {
    if (!fs.existsSync(this.changelogPath)) {
      const header = `<!-- markdownlint-disable -->
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

`;
      fs.writeFileSync(this.changelogPath, header);
    }
    return fs.readFileSync(this.changelogPath, 'utf8');
  }

  updateUnreleasedSection(changelog, commits) {
    const latestTag = this.getLatestTag();
    this.attachAuthors(commits, latestTag, 'HEAD');
    const sections = this.categorizeCommits(commits);
    const unreleasedContent = this.buildUnreleasedContent(
      sections,
      latestTag,
      this.findNewContributors(commits, latestTag),
    );

    // More robust removal of unreleased section
    const lines = changelog.split('\n');
    const unreleasedStart = lines.findIndex((line) => line.trim() === '## [Unreleased]');

    if (unreleasedStart === -1) {
      // No existing unreleased section, find insertion point after header
      const headerEndIndex = lines.findIndex(
        (line, index) => index > 5 && line.startsWith('## [') && line.match(/## \[\d+\.\d+\.\d+\]/),
      );

      if (headerEndIndex === -1) {
        // No version sections, append to end
        return changelog + unreleasedContent;
      } else {
        // Insert before first version section
        lines.splice(headerEndIndex, 0, ...unreleasedContent.trim().split('\n'), '');
        return lines.join('\n');
      }
    }

    // Find the end of unreleased section (next version section or end of file)
    let unreleasedEnd = lines.length;
    for (let i = unreleasedStart + 1; i < lines.length; i++) {
      if (lines[i].match(/^## \[\d+\.\d+\.\d+\]/)) {
        unreleasedEnd = i;
        break;
      }
    }

    // Replace the unreleased section
    lines.splice(
      unreleasedStart,
      unreleasedEnd - unreleasedStart,
      ...unreleasedContent.trim().split('\n'),
      '',
    );
    return lines.join('\n');
  }

  convertUnreleasedToRelease(changelog, version, commits) {
    const date = new Date().toISOString().split('T')[0];

    // Generate proper compare URL based on previous version
    const previousTag = this.getPreviousTag(`v${version}`);
    let compareUrl;

    if (previousTag) {
      // Use GitHub compare URL between previous tag and current version
      compareUrl = `${this.repositoryUrl}/compare/${previousTag}...v${version}`;
    } else {
      // First release, use tag URL as fallback
      compareUrl = `${this.repositoryUrl}/releases/tag/v${version}`;
    }

    // If we have unreleased section, convert it to release
    if (changelog.includes('## [Unreleased]')) {
      return changelog.replace(/## \[Unreleased\]/, `## [${version}](${compareUrl}) - ${date}`);
    } else {
      // No unreleased section, create new release entry
      this.attachAuthors(commits, previousTag, `v${version}`);
      const sections = this.categorizeCommits(commits);
      const releaseContent = this.buildReleaseContent(
        version,
        compareUrl,
        date,
        sections,
        previousTag,
        this.findNewContributors(commits, previousTag),
      );

      // Insert after header
      const headerMatch = changelog.match(
        /((?:<!-- markdownlint-disable -->\s*\n)?# Changelog\s*\n\nAll notable changes.*?\n\nThe format is based on.*?\n\n)/s,
      );
      if (headerMatch) {
        const insertPoint = headerMatch.index + headerMatch[0].length;
        return (
          changelog.slice(0, insertPoint) +
          releaseContent.substring(1) + // Remove leading newline
          changelog.slice(insertPoint)
        );
      } else {
        // Fallback: insert after header
        const insertPoint = changelog.indexOf('\n\n') + 2;
        return changelog.slice(0, insertPoint) + releaseContent + changelog.slice(insertPoint);
      }
    }
  }

  categorizeCommits(commits) {
    const sections = Object.fromEntries(CHANGELOG_SECTIONS.map((name) => [name, []]));

    for (const commit of commits) {
      // The section comes from the title's type (scripts/lib/pr-title.js); null keeps the
      // change out of the changelog.
      const category = changelogSection(commit.message, { isDependency: commit.isDependency });
      if (!category) continue;

      if (category === 'Dependencies') {
        // Store raw commit object for dependencies (will be consolidated later)
        sections[category].push(commit);
      } else {
        sections[category].push(this.formatCommitEntry(commit));
      }
    }

    return sections;
  }

  formatCommitEntry(commit) {
    const cleanMessage = changelogText(commit.message);

    // Only show commit link if there's no PR, otherwise show PR link
    if (commit.prNumber) {
      const prLink = `([#${commit.prNumber}](${this.repositoryUrl}/pull/${commit.prNumber}))`;
      return `- ${cleanMessage} ${prLink} by ${this.formatCredit(commit)}`;
    } else {
      const commitLink = `([${commit.hash.substring(0, 7)}](${this.repositoryUrl}/commit/${commit.hash}))`;
      return `- ${cleanMessage} ${commitLink} by ${this.formatCredit(commit)}`;
    }
  }

  /** The PR's link when the commit came from one, else the commit's own link. */
  formatChangeLink(commit) {
    return commit.prNumber
      ? `[#${commit.prNumber}](${this.repositoryUrl}/pull/${commit.prNumber})`
      : `[${commit.hash.substring(0, 7)}](${this.repositoryUrl}/commit/${commit.hash})`;
  }

  /**
   * Who to credit for a commit. A login is a link: in a repo file `@login` is plain text,
   * not a mention. A bot's login (`renovate[bot]`) links to its app page, because
   * github.com/renovate is an unrelated user account. A commit whose email is linked to
   * no account is credited to its git name, unlinked.
   */
  formatCredit(commit) {
    const login = commit.author;
    if (login) {
      const bot = login.match(/^(.+)\[bot\]$/);
      return bot
        ? `[@${login}](https://github.com/apps/${bot[1]})`
        : `[@${login}](https://github.com/${login})`;
    }
    if (commit.authorName) return commit.authorName;
    throw new Error(`No author to credit for commit ${commit.hash.substring(0, 7)}`);
  }

  /** `gh` reports a bot PR author as `app/renovate`; commits name it `renovate[bot]`. */
  normalizeLogin(login, prNumber) {
    if (!login) throw new Error(`PR #${prNumber} has no author login to credit`);
    const app = login.match(/^app\/(.+)$/);
    return app ? `${app[1]}[bot]` : login;
  }

  /**
   * Give each direct commit its GitHub login (null when its email is linked to no
   * account). A PR's own commit already carries the PR's author from getCommitsSince(),
   * which is the one to credit: a merge or squash commit names whoever merged it, or an
   * email the author never linked.
   *
   * One paginated call answers for the whole range, so the cost does not grow with the
   * bot's sync commits. Throws when GitHub cannot answer, or does not know a commit
   * (one never pushed): a guessed credit is worse than a failed sync.
   */
  attachAuthors(commits, fromTag, toRef) {
    const direct = commits.filter((commit) => commit.author === undefined);
    if (direct.length === 0) return;

    const head = execFileSync('git', ['rev-parse', toRef], { encoding: 'utf8' }).trim();
    const [path, jq] = fromTag
      ? [`repos/${this.repo}/compare/${fromTag}...${head}?per_page=100`, '.commits[]']
      : [`repos/${this.repo}/commits?sha=${head}&per_page=100`, '.[]'];
    const logins = new Map(
      this.gh(['api', '--paginate', path, '--jq', `${jq} | [.sha, .author.login // ""] | @tsv`])
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\t')),
    );

    for (const commit of direct) {
      if (!logins.has(commit.hash)) {
        throw new Error(
          `GitHub does not know commit ${commit.hash.substring(0, 7)}; push it before syncing`,
        );
      }
      commit.author = logins.get(commit.hash) || this.botFromEmail(commit.authorEmail);
    }
  }

  /**
   * The bot a commit's email names, or null. GitHub links a commit by the account ID in
   * its noreply address (`<id>+<name>[bot]@users.noreply.github.com`), so a bot commit
   * made with a wrong ID is linked to no account and would read as a person's git name.
   * The name in the address still says which bot it is.
   */
  botFromEmail(email = '') {
    const bot = email.match(/^\d+\+([^@]+\[bot\])@users\.noreply\.github\.com$/);
    return bot ? bot[1] : null;
  }

  /**
   * The people whose first contribution is in this range, oldest first, as changelog
   * lines. Someone is new when no merged PR of theirs predates the range and no commit
   * of theirs is reachable from its start; a git name with no account is checked in
   * local history instead. Bots are never listed, as GitHub's own notes do not list
   * them. The first release has no earlier history to compare with, so lists nobody.
   *
   * Every commit in the range counts, not only those with a changelog line.
   */
  findNewContributors(commits, fromTag) {
    if (!fromTag || commits.length === 0) return [];
    const since = execFileSync('git', ['log', '-1', '--format=%cI', fromTag], {
      encoding: 'utf8',
    }).trim();

    const firsts = new Map();
    for (const commit of [...commits].reverse()) {
      if (commit.author?.endsWith('[bot]')) continue;
      const key = commit.author ? `@${commit.author}` : commit.authorName;
      if (!key) throw new Error(`No author to credit for commit ${commit.hash.substring(0, 7)}`);
      if (!firsts.has(key)) firsts.set(key, commit);
    }

    return [...firsts.values()]
      .filter((commit) =>
        commit.author
          ? this.isNewLogin(commit.author, fromTag, since)
          : this.isNewName(commit.authorName, fromTag),
      )
      .map(
        (commit) =>
          `- ${this.formatCredit(commit)} made their first contribution in ${this.formatChangeLink(commit)}`,
      );
  }

  isNewLogin(login, fromTag, since) {
    const earlierPrs = this.gh([
      'api',
      '-X',
      'GET',
      'search/issues',
      '-f',
      `q=repo:${this.repo} is:pr is:merged base:main author:${login} merged:<${since}`,
      '-f',
      'per_page=1',
      '--jq',
      '.total_count',
    ]);
    if (Number(earlierPrs) !== 0) return false;
    const earlierCommits = this.gh([
      'api',
      `repos/${this.repo}/commits?author=${login}&sha=${fromTag}&per_page=1`,
      '--jq',
      'length',
    ]);
    return Number(earlierCommits) === 0;
  }

  /** Exact names: `git log --author` matches part of one, so "Pat" would find "Patrick". */
  isNewName(name, fromTag) {
    return !execFileSync('git', ['log', '--format=%an', fromTag], { encoding: 'utf8' })
      .split('\n')
      .includes(name);
  }

  /**
   * Throws when the checkout has no release tag below `below` (any tag, when null) while
   * CHANGELOG.md has a released section there. A clone made without tags (actions/checkout's
   * default) would otherwise build from the start of history, and nothing would say so.
   */
  assertTagsFetched(below = null) {
    if (!fs.existsSync(this.changelogPath)) return;
    const released = [
      ...fs.readFileSync(this.changelogPath, 'utf8').matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm),
    ]
      .map(([, version]) => version)
      .find((version) => below === null || this.compareVersions(version, below) < 0);
    if (released) {
      throw new Error(
        `CHANGELOG.md has a [${released}] section but this checkout has no tag for it; ` +
          'fetch the tags (actions/checkout: fetch-depth: 0 and fetch-tags: true)',
      );
    }
  }

  /**
   * The body of a version's GitHub release: the Release Schedule, the summary already in
   * the draft (or, in a draft with none, a reminder where it goes), the version's changelog
   * section (`[Unreleased]` until it is released), the Full Changelog link and the support
   * block. Both draft workflows print it.
   */
  releaseNotes(version, now = new Date()) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(`Invalid version format: ${version}. Expected: x.y.z`);
    }
    const tag = `v${version}`;
    const changelog = fs.readFileSync(this.changelogPath, 'utf8');
    const section = this.readSection(changelog, version);
    const released = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(changelog);
    const previousTag = this.getTagBefore(version);
    if (!previousTag) this.assertTagsFetched(version);
    const compareUrl = previousTag
      ? `${this.repositoryUrl}/compare/${previousTag}...${tag}`
      : `${this.repositoryUrl}/commits/${tag}`;
    // A released section carries its own summary once add-summary has run; printing the
    // draft's as well would show it twice.
    const summary = /^### Summary[ \t]*$/m.test(section) ? null : this.readDraftSummary(tag);

    const parts = [
      `## Release Schedule\n\nJellyRock ${tag} is scheduled for release on the [Roku Channel Store](${ROKU_STORE_URL}) ${this.storeReleaseDate(now)} 6:00 PM PT`,
      summary ?? (released ? null : summaryReminder(version)),
      this.toMentions(section),
      `**Full Changelog**: ${compareUrl}`,
      this.readSupportBlock(),
    ];
    return (
      parts
        .filter(Boolean)
        .map((part) => part.trim())
        .join('\n\n') + '\n'
    );
  }

  /**
   * Copy the published release's `### Summary` to the top of the version's CHANGELOG.md
   * section, where later summaries read it as an example. Returns whether it wrote. A
   * section that has one already, or a release with none, is left alone; a release that
   * cannot be read throws.
   */
  addSummary(version) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(`Invalid version format: ${version}. Expected: x.y.z`);
    }
    const lines = fs.readFileSync(this.changelogPath, 'utf8').split('\n');
    const escaped = version.replace(/\./g, '\\.');
    const heading = lines.findIndex((line) => new RegExp(`^## \\[${escaped}\\]`).test(line));
    if (heading === -1) throw new Error(`CHANGELOG.md has no [${version}] section`);
    const end = lines.findIndex((line, i) => i > heading && line.startsWith('## ['));
    const section = lines.slice(heading + 1, end === -1 ? undefined : end);
    if (section.some((line) => /^### Summary[ \t]*$/.test(line))) {
      console.log(`ℹ️ The ${version} section already has a summary`);
      return false;
    }

    const summary = this.readDraftSummary(`v${version}`);
    if (!summary) {
      console.warn(`⚠️ The v${version} release has no ### Summary; CHANGELOG.md is unchanged`);
      return false;
    }
    lines.splice(heading + 1, 0, '', ...summary.split('\n'));
    fs.writeFileSync(this.changelogPath, lines.join('\n'));
    console.log(`✅ Summary added to the ${version} section`);
    return true;
  }

  /** A version's section without its heading, or `[Unreleased]` when it has none yet. */
  readSection(changelog, version) {
    const lines = changelog.split('\n');
    const escaped = version.replace(/\./g, '\\.');
    let start = lines.findIndex((line) => new RegExp(`^## \\[${escaped}\\]`).test(line));
    if (start === -1) start = lines.findIndex((line) => line.trim() === '## [Unreleased]');
    if (start === -1) {
      throw new Error(`CHANGELOG.md has no [Unreleased] or [${version}] section`);
    }
    const end = lines.findIndex((line, i) => i > start && line.startsWith('## ['));
    return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
  }

  /**
   * A person's credit is a link in CHANGELOG.md, where `@login` is plain text; in a
   * release body `@login` is a mention, so it becomes one. A bot's link to its app page
   * stays: `@renovate[bot]` would mention the unrelated user `renovate`.
   */
  toMentions(text) {
    return text.replace(/\[@([A-Za-z0-9-]+)\]\(https:\/\/github\.com\/\1\)/g, '@$1');
  }

  /** The newest release tag below the version, whether or not the version is tagged yet. */
  getTagBefore(version) {
    return (
      execSync('git tag --sort=-v:refname', { encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
        .find((tag) => this.compareVersions(tag.slice(1), version) < 0) ?? null
    );
  }

  /**
   * The `### Summary` block in the tag's current release body, up to the next heading,
   * so rebuilding a draft keeps the summary written into it. No release, or no such
   * heading, means no summary; any other failure throws.
   */
  readDraftSummary(tag) {
    let body;
    try {
      body = JSON.parse(
        this.gh(['release', 'view', tag, '--repo', this.repo, '--json', 'body']),
      ).body;
    } catch (error) {
      if (/release not found/.test(String(error.stderr))) return null;
      throw new Error(`Could not read the ${tag} release: ${error.stderr || error.message}`, {
        cause: error,
      });
    }
    // GitHub's editor saves CRLF; the summary is copied into CHANGELOG.md, which is LF.
    const match = body
      .replace(/\r\n?/g, '\n')
      .match(/^### Summary[ \t]*\n[\s\S]*?(?=^#{1,3} |(?![\s\S]))/m);
    return match ? match[0].trim() : null;
  }

  /**
   * The support block from jellyrock/.github, which the profile README shares. A missing
   * file fails the build: a release published without it would not show it was dropped.
   */
  readSupportBlock() {
    let block;
    try {
      block = this.gh([
        'api',
        '-H',
        'Accept: application/vnd.github.raw+json',
        `repos/${SUPPORT_SOURCE.repo}/contents/${SUPPORT_SOURCE.path}`,
      ]);
    } catch (error) {
      throw new Error(
        `Could not read ${SUPPORT_SOURCE.path} from ${SUPPORT_SOURCE.repo}: ${error.stderr || error.message}`,
        { cause: error },
      );
    }
    if (!block.startsWith(`${SUPPORT_SOURCE.heading}\n`)) {
      throw new Error(
        `${SUPPORT_SOURCE.repo}/${SUPPORT_SOURCE.path} must start with "${SUPPORT_SOURCE.heading}"`,
      );
    }
    return block;
  }

  /**
   * The next Roku Channel Store release day as Pacific time sees it: the next day,
   * except that Friday and the weekend wait for Monday.
   */
  storeReleaseDate(now) {
    const pacific = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        weekday: 'long',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      })
        .formatToParts(now)
        .map(({ type, value }) => [type, value]),
    );
    const daysToAdd = { Friday: 3, Saturday: 2 }[pacific.weekday] ?? 1;
    const date = new Date(
      Date.UTC(Number(pacific.year), Number(pacific.month) - 1, Number(pacific.day) + daysToAdd),
    );
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'long',
      month: 'long',
      day: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  /** Run `gh` and return its output; throws on any failure, which fails the sync. */
  gh(args) {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: 'pipe' }).trim();
  }

  /**
   * Parse dependency information from commit message.
   * Extracts the action word from the MESSAGE content (not the commit type prefix).
   *
   * @param {string} message - Raw commit message
   * @returns {Object} - { action, packageName, version, message, isVersioned }
   *
   * @example
   * // "chore" is the commit type, "update" is extracted from message content
   * parseDependencyInfo('chore(deps): update dependency package-name to v1.2.3')
   * // Returns: { action: 'Update', packageName: 'package-name', version: '1.2.3', message: 'package-name to v1.2.3', isVersioned: true }
   *
   * @example
   * // "add" action extracted from message content
   * parseDependencyInfo('chore(deps): add dependency new-package to v1.0.0')
   * // Returns: { action: 'Add', packageName: 'new-package', version: '1.0.0', message: 'new-package to v1.0.0', isVersioned: true }
   *
   * @example
   * // Non-versioned dependency
   * parseDependencyInfo('chore(deps): pin dependencies')
   * // Returns: { action: null, packageName: null, version: null, message: 'pin dependencies', isVersioned: false }
   */
  parseDependencyInfo(message) {
    const cleanMsg = changelogText(message);

    // Strip any scope prefix like "(deps)" from the beginning
    let withoutScope = cleanMsg.replace(/^\([^)]+\)\s*/, '');

    // Extract action word (add, remove, update, etc.) before removing it
    const actionMatch = withoutScope.match(
      /^(add|remove|update|upgrade|bump|change|improve|enhance|implement|create|delete)\b/i,
    );
    const action = actionMatch
      ? actionMatch[1].charAt(0).toUpperCase() + actionMatch[1].slice(1).toLowerCase()
      : null;

    // Remove "dependency" keyword and action word for cleaner parsing
    // First remove "action dependency package-name" -> "package-name"
    withoutScope = withoutScope.replace(
      /^(add|remove|update|upgrade|bump|change|improve|enhance|implement|create|delete)?\s*dependency\s+/i,
      '',
    );
    // Then remove only the action word if it's still at the start (handles cases without "dependency" keyword)
    // "implement new-logger" -> "new-logger"
    withoutScope = withoutScope.replace(
      /^(add|remove|update|upgrade|bump|change|improve|enhance|implement|create|delete)\s+/i,
      '',
    );

    // Try to match versioned dependency patterns:
    // Pattern: "package-name to v1.2.3" or "package-name from v1.0.0 to v1.2.3"
    const versionMatch = withoutScope.match(/^(.+?)\s+(?:from\s+v?[\d.]+\s+)?to\s+v?([\d.]+)/i);

    if (versionMatch) {
      return {
        action,
        packageName: versionMatch[1].trim(),
        version: versionMatch[2],
        message: withoutScope,
        isVersioned: true,
      };
    }

    // Not a versioned dependency, return without scope
    return {
      action,
      packageName: null,
      version: null,
      message: withoutScope,
      isVersioned: false,
    };
  }

  /**
   * Compare two semantic versions
   * @param {string} v1 - First version
   * @param {string} v2 - Second version
   * @returns {number} - Negative if v1 < v2, positive if v1 > v2, 0 if equal
   */
  compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;

      if (part1 !== part2) {
        return part1 - part2;
      }
    }

    return 0;
  }

  /**
   * Get dependency version from package.json at a specific tag
   * @param {string} packageName - Name of the package
   * @param {string} tag - Git tag to check
   * @returns {string|null} - Version or null if not found
   */
  getDependencyVersionAtTag(packageName, tag) {
    try {
      const packageJson = execSync(`git show ${tag}:package.json`, { encoding: 'utf8' });
      const parsed = JSON.parse(packageJson);

      // Check both dependencies and devDependencies
      const deps = { ...parsed.dependencies, ...parsed.devDependencies };

      // Handle scoped packages and regular packages
      const version = deps[packageName];
      if (version) {
        // Extract version number (remove ^ ~ npm: etc)
        const match = version.match(/[\d.]+/);
        return match ? match[0] : null;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Consolidate dependency commits into unique entries
   * @param {Array} dependencyCommits - Array of commit objects
   * @param {string} fromTag - Starting tag to check initial versions
   * @returns {Array} - Array of formatted changelog entries
   */
  consolidateDependencies(dependencyCommits, fromTag = null) {
    if (!dependencyCommits || dependencyCommits.length === 0) {
      return [];
    }

    // Parse all dependencies
    const parsedDeps = dependencyCommits.map((commit) => ({
      commit,
      parsed: this.parseDependencyInfo(commit.message),
    }));

    // Separate versioned and non-versioned dependencies
    const versionedDeps = parsedDeps.filter((d) => d.parsed.isVersioned);
    const nonVersionedDeps = parsedDeps.filter((d) => !d.parsed.isVersioned);

    const consolidatedEntries = [];

    // Group versioned dependencies by package name
    const versionedGroups = {};
    for (const dep of versionedDeps) {
      const pkg = dep.parsed.packageName;
      if (!versionedGroups[pkg]) {
        versionedGroups[pkg] = [];
      }
      versionedGroups[pkg].push(dep);
    }

    // Create consolidated entries for versioned dependencies
    for (const [packageName, deps] of Object.entries(versionedGroups)) {
      // Sort by version
      deps.sort((a, b) => this.compareVersions(a.parsed.version, b.parsed.version));

      const versions = deps.map((d) => d.parsed.version);
      const commits = deps.map((d) => d.commit);

      // Try to get the starting version from the previous tag
      let fromVersion = versions[0];
      if (fromTag) {
        const tagVersion = this.getDependencyVersionAtTag(packageName, fromTag);
        if (tagVersion && this.compareVersions(tagVersion, versions[0]) < 0) {
          fromVersion = tagVersion;
        }
      }

      const links = commits.map((commit) => this.formatChangeLink(commit));
      const credits = this.formatCredits(commits);

      // Format entry
      const toVersion = versions[versions.length - 1];
      // Use the action from the first (or any) commit - they should all be the same action for the same package
      const action = deps[0].parsed.action || 'Update';

      if (fromVersion === toVersion) {
        // Single version update
        consolidatedEntries.push(
          `- ${action} ${packageName} to v${toVersion} (${links.join(', ')}) by ${credits}`,
        );
      } else {
        // Version range
        consolidatedEntries.push(
          `- ${action} ${packageName} from v${fromVersion} to v${toVersion} (${links.join(', ')}) by ${credits}`,
        );
      }
    }

    // Group non-versioned dependencies by exact message
    const nonVersionedGroups = {};
    for (const dep of nonVersionedDeps) {
      const msg = dep.parsed.message;
      if (!nonVersionedGroups[msg]) {
        nonVersionedGroups[msg] = [];
      }
      nonVersionedGroups[msg].push(dep);
    }

    // Create consolidated entries for non-versioned dependencies
    for (const [message, deps] of Object.entries(nonVersionedGroups)) {
      const commits = deps.map((d) => d.commit);

      const links = commits.map((commit) => this.formatChangeLink(commit));
      const credits = this.formatCredits(commits);

      // Format entry - capitalize first letter for consistency
      const capitalizedMessage = message.charAt(0).toUpperCase() + message.slice(1);
      consolidatedEntries.push(`- ${capitalizedMessage} (${links.join(', ')}) by ${credits}`);
    }

    return consolidatedEntries;
  }

  /** Each distinct author of the commits once, in the order they first appear. */
  formatCredits(commits) {
    return [...new Set(commits.map((commit) => this.formatCredit(commit)))].join(', ');
  }

  /** The New Contributors block that ends a section, or nothing when there are none. */
  formatNewContributors(newContributors) {
    return newContributors.length > 0
      ? `\n### New Contributors\n\n${newContributors.join('\n')}\n`
      : '';
  }

  buildUnreleasedContent(sections, fromTag = null, newContributors = []) {
    let content = '\n## [Unreleased]\n';

    for (const sectionName of CHANGELOG_SECTIONS) {
      let items = sections[sectionName];

      // Consolidate dependencies before adding to content
      if (sectionName === 'Dependencies' && items && items.length > 0) {
        items = this.consolidateDependencies(items, fromTag);
      }

      if (items && items.length > 0) {
        content += `\n### ${sectionName}\n\n`;
        content += items.join('\n') + '\n';
      }
    }

    return content + this.formatNewContributors(newContributors);
  }

  buildReleaseContent(version, compareUrl, date, sections, fromTag = null, newContributors = []) {
    let content = `\n## [${version}](${compareUrl}) - ${date}\n`;

    for (const sectionName of CHANGELOG_SECTIONS) {
      let items = sections[sectionName];

      // Consolidate dependencies before adding to content
      if (sectionName === 'Dependencies' && items && items.length > 0) {
        items = this.consolidateDependencies(items, fromTag);
      }

      if (items && items.length > 0) {
        content += `\n### ${sectionName}\n\n`;
        content += items.join('\n') + '\n';
      }
    }

    return content + this.formatNewContributors(newContributors);
  }

  getLatestTag() {
    try {
      return execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  }

  getPreviousTag(currentTag) {
    try {
      const allTags = execSync('git tag --sort=-v:refname', { encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter((tag) => tag.match(/^v\d+\.\d+\.\d+$/));

      const currentIndex = allTags.indexOf(currentTag);
      if (currentIndex === -1 || currentIndex === allTags.length - 1) {
        return null; // First release or tag not found
      }

      return allTags[currentIndex + 1];
    } catch {
      return null;
    }
  }

  /**
   * The commits in a range, newest first, each with the title, labels and link to file
   * it under. A PR's own commit also carries the PR's author; attachAuthors() credits the
   * rest. A git failure reads as no commits (a repo with none yet), but a PR that cannot
   * be read throws: guessing from the commit could file the change or credit wrongly.
   */
  getCommitsSince(fromTag, toTag = 'HEAD') {
    const range = fromTag ? `${fromTag}..${toTag}` : toTag;
    let gitLog;
    try {
      // Custom delimiters separate commits; %H = full hash, %an = author name, %ae = author
      // email, %B = message.
      gitLog = execSync(
        `git log ${range} --pretty=format:"COMMIT_START%H%nCOMMIT_AUTHOR%n%an%n%ae%nCOMMIT_MSG_START%n%B%nCOMMIT_END" --first-parent`,
        { encoding: 'utf8' },
      ).trim();
    } catch (error) {
      console.error('❌ Error getting commits:', error.message);
      return [];
    }

    if (!gitLog) return [];

    // Split by commit delimiter and process each commit
    const commits = gitLog.split('COMMIT_START').filter((c) => c.trim());

    return commits
      .map((commitBlock) => {
        // Extract hash and message
        const lines = commitBlock.split('\n');
        const commitHash = lines[0].trim();
        const authorIndex = lines.findIndex((l) => l === 'COMMIT_AUTHOR');
        const authorName = authorIndex === -1 ? '' : lines[authorIndex + 1].trim();
        const authorEmail = authorIndex === -1 ? '' : lines[authorIndex + 2].trim();
        const msgStartIndex = lines.findIndex((l) => l === 'COMMIT_MSG_START');
        const msgEndIndex = lines.findIndex((l) => l === 'COMMIT_END');

        if (msgStartIndex === -1 || msgEndIndex === -1) return null;

        // Get all message lines between markers, filter empty lines, take first non-empty line
        const messageLines = lines.slice(msgStartIndex + 1, msgEndIndex).filter((l) => l.trim());
        const firstLine = messageLines[0] || '';

        // Now process this first line as before
        const line = `${commitHash} ${firstLine}`;

        // Parse PR merges
        const mergeMatch = line.match(/^([a-f0-9]+)\s+Merge pull request #(\d+) from .+$/);
        if (mergeMatch) {
          const parsed = this.readPr(
            mergeMatch[2],
            'title,labels,author',
            '{title, labels: [.labels[].name], author: .author.login}',
          );
          const isDependency =
            parsed.labels &&
            parsed.labels.some(
              (label) =>
                label.toLowerCase().includes('depend') || label.toLowerCase().includes('deps'),
            );
          const isReleasePrep =
            parsed.labels &&
            parsed.labels.some((label) => label.toLowerCase().includes('release-prep'));

          return {
            hash: mergeMatch[1],
            message: parsed.title || `Merged PR #${mergeMatch[2]}`,
            prNumber: mergeMatch[2],
            author: this.normalizeLogin(parsed.author, mergeMatch[2]),
            authorName,
            authorEmail,
            isDependency: isDependency,
            isReleasePrep: isReleasePrep,
          };
        }

        // Parse regular commits
        const prMatch = firstLine.match(/\(#(\d+)\)$/);
        const prNumber = prMatch ? prMatch[1] : null;
        const commitMessage = prMatch ? firstLine.replace(/\s*\(#\d+\)$/, '') : firstLine;

        let isDependency = false;
        let isReleasePrep = false;
        // The PR's CURRENT title, not the commit's first line: a merged PR can be
        // retitled, so a wrong type is fixed by editing the PR and re-syncing, where the
        // commit on main cannot be changed. Only for the PR's own squash commit: other
        // commits end in "(#N)" too (journal-sync's "chore(journal): sync fix: … (#N)"),
        // and giving them the PR's title would list that PR twice.
        let message = commitMessage;
        let author;
        if (prNumber) {
          const parsed = this.readPr(
            prNumber,
            'title,labels,mergeCommit,author',
            '{title, labels: [.labels[].name], mergeCommit: .mergeCommit.oid, author: .author.login}',
          );
          // The same test credits the PR's author: only its own commit is its work.
          if (parsed.mergeCommit?.startsWith(commitHash)) {
            if (parsed.title) message = parsed.title;
            author = this.normalizeLogin(parsed.author, prNumber);
          }
          isDependency =
            parsed.labels &&
            parsed.labels.some(
              (label) =>
                label.toLowerCase().includes('depend') || label.toLowerCase().includes('deps'),
            );
          isReleasePrep =
            parsed.labels &&
            parsed.labels.some((label) => label.toLowerCase().includes('release-prep'));
        }

        return {
          hash: commitHash,
          message,
          prNumber: prNumber,
          author,
          authorName,
          authorEmail,
          isDependency: isDependency,
          isReleasePrep: isReleasePrep,
        };
      })
      .filter((commit) => {
        // Filter out null commits (malformed)
        if (!commit) return false;

        // Filter out automated commits and merge commits
        const msg = commit.message.toLowerCase();
        return (
          !msg.match(
            /^(bump version|release v|version bump|docs: sync changelog|docs: update changelog)/,
          ) &&
          !msg.includes('update en_us translation file') &&
          !msg.includes('en_us translation file') &&
          !msg.includes('update api docs') &&
          !msg.match(/^merge branch ['"]?main['"]? of https:\/\/github\.com\//) &&
          !msg.match(/^merge branch ['"]?master['"]? of https:\/\/github\.com\//) &&
          !commit.isReleasePrep &&
          commit.message.length > 0
        );
      });
  }

  /** `gh pr view` as JSON; throws with the PR's number when it cannot be read. */
  readPr(number, fields, jq) {
    try {
      return JSON.parse(
        this.gh(['pr', 'view', String(number), '--repo', this.repo, '--json', fields, '--jq', jq]),
      );
    } catch (error) {
      throw new Error(`Could not read PR #${number}: ${error.message}`, { cause: error });
    }
  }
}

// CLI Interface
const __filename = fileURLToPath(import.meta.url);
const scriptPath = resolve(process.argv[1]);
const currentPath = resolve(__filename);

if (scriptPath === currentPath) {
  const syncer = new ChangelogSyncer();
  const command = process.argv[2];

  try {
    switch (command) {
      case 'sync-unreleased':
        syncer.syncUnreleased();
        break;

      case 'sync-release': {
        const version = process.argv[3];
        if (!version) {
          console.error('❌ Version required for sync-release');
          process.exit(1);
        }
        syncer.syncRelease(version);
        break;
      }

      case 'release-notes': {
        const version = process.argv[3];
        if (!version) {
          console.error('❌ Version required for release-notes');
          process.exit(1);
        }
        process.stdout.write(syncer.releaseNotes(version));
        break;
      }

      case 'add-summary': {
        const version = process.argv[3];
        if (!version) {
          console.error('❌ Version required for add-summary');
          process.exit(1);
        }
        syncer.addSummary(version);
        break;
      }

      case 'status':
        syncer.getStatus();
        break;

      case 'validate': {
        const isValid = syncer.validate();
        process.exit(isValid ? 0 : 1);
        break;
      }

      default:
        console.log(`
📖 Changelog Syncer

Commands:
  sync-unreleased     Sync unreleased changes from commits
  sync-release <ver>  Convert unreleased to release version
  release-notes <ver> Print the version's GitHub release body
  add-summary <ver>   Copy the published release's summary into its section
  status              Show current changelog status  
  validate            Validate changelog consistency
        `);
        break;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

export { ChangelogSyncer, SUMMARY_REMINDER };
