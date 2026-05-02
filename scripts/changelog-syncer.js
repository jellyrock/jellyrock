/**
 * Simplified Changelog Sync Manager
 *
 * Keeps CHANGELOG.md automatically in sync with git state:
 * - Unreleased section tracks commits since latest tag
 * - Release sections are created when tags are pushed
 * - No manual intervention required
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

class ChangelogSyncer {
  constructor() {
    this.changelogPath = 'CHANGELOG.md';
    this.repositoryUrl = 'https://github.com/jellyrock/jellyrock';
  }

  /**
   * Sync unreleased changes - called on push to main
   */
  syncUnreleased() {
    console.log('🔄 Syncing unreleased changes...');

    const latestTag = this.getLatestTag();
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

    // Get previous tag to determine range
    const previousTag = this.getPreviousTag(`v${version}`);
    const commits = this.getCommitsSince(previousTag, `v${version}`);

    if (commits.length === 0) {
      console.log('⚠️ No commits found for release - creating minimal entry');
    }

    const changelog = this.readChangelog();
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

    const status = this.getStatus();
    const issues = [];

    // Check file exists
    if (!fs.existsSync(this.changelogPath)) {
      issues.push('CHANGELOG.md file missing');
    }

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
    const sections = this.categorizeCommits(commits);
    const latestTag = this.getLatestTag();
    const unreleasedContent = this.buildUnreleasedContent(sections, latestTag);

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
      const sections = this.categorizeCommits(commits);
      const releaseContent = this.buildReleaseContent(
        version,
        compareUrl,
        date,
        sections,
        previousTag,
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
    const sections = {
      Added: [],
      Changed: [],
      Fixed: [],
      Removed: [],
      Security: [],
      Deprecated: [],
      Dependencies: [],
    };

    for (const commit of commits) {
      // Check if this is a dependency-related PR
      const category = commit.isDependency ? 'Dependencies' : this.categorizeCommit(commit.message);

      if (category && category !== 'Chore') {
        if (category === 'Dependencies') {
          // Store raw commit object for dependencies (will be consolidated later)
          sections[category].push(commit);
        } else {
          // Format other entries normally
          const entry = this.formatCommitEntry(commit);
          sections[category].push(entry);
        }
      }
    }

    return sections;
  }

  categorizeCommit(message) {
    const msg = message.toLowerCase().trim();

    // Security first (highest priority)
    if (msg.includes('security') || msg.includes('vulnerability') || msg.includes('cve-')) {
      return 'Security';
    }

    // Check prefixes first (most specific)
    // Changes
    if (
      msg.startsWith('update') ||
      msg.startsWith('change') ||
      msg.startsWith('improve') ||
      msg.startsWith('refactor') ||
      msg.startsWith('enhance')
    ) {
      return 'Changed';
    }

    // Additions
    if (
      msg.startsWith('add') ||
      msg.startsWith('feat') ||
      msg.startsWith('implement') ||
      msg.startsWith('create')
    ) {
      return 'Added';
    }

    // Fixes
    if (msg.startsWith('fix')) {
      return 'Fixed';
    }

    // Removals
    if (msg.startsWith('remove') || msg.startsWith('delete')) {
      return 'Removed';
    }

    // Skip chores
    if (
      msg.startsWith('chore') ||
      msg.startsWith('ci') ||
      msg.startsWith('build') ||
      msg.startsWith('docs') ||
      msg.startsWith('style') ||
      msg.startsWith('test')
    ) {
      return 'Chore';
    }

    // Then check content-based matches (less specific)
    if (msg.includes('deprecate') || msg.includes('deprecated')) {
      return 'Deprecated';
    }

    if (msg.includes('removed')) {
      return 'Removed';
    }

    if (
      msg.includes('fixes') ||
      msg.includes('fixed') ||
      msg.includes('resolve') ||
      msg.includes('correct')
    ) {
      return 'Fixed';
    }

    // Only match "new" if it's at the beginning of a word or after common prefixes
    if (msg.includes('new ') || msg.includes('create')) {
      return 'Added';
    }

    // Default to Changed
    return 'Changed';
  }

  formatCommitEntry(commit) {
    const cleanMessage = this.cleanMessage(commit.message);

    // Only show commit link if there's no PR, otherwise show PR link
    if (commit.prNumber) {
      const prLink = `([#${commit.prNumber}](${this.repositoryUrl}/pull/${commit.prNumber}))`;
      return `- ${cleanMessage} ${prLink}`;
    } else {
      const commitLink = `([${commit.hash.substring(0, 7)}](${this.repositoryUrl}/commit/${commit.hash}))`;
      return `- ${cleanMessage} ${commitLink}`;
    }
  }

  /**
   * Clean commit message by removing conventional commit prefixes and action words,
   * while preserving scope information for better changelog context.
   *
   * This function ONLY affects list item display text, NOT section categorization.
   * Section categorization uses the original message via categorizeCommit().
   *
   * @param {string} message - Raw commit message
   * @returns {string} Cleaned message with scope preserved
   *
   * @example
   * // Conventional commits with scope
   * cleanMessage('feat(api): Add user endpoint') // Returns: '(api) Add user endpoint'
   * cleanMessage('fix(auth): broken login') // Returns: '(auth) broken login'
   *
   * @example
   * // Action words with scope
   * cleanMessage('update(docs): Add stuff to readme') // Returns: '(docs) Add stuff to readme'
   * cleanMessage('improve(ui): better animations') // Returns: '(ui) better animations'
   *
   * @example
   * // Without scope
   * cleanMessage('fix: broken button') // Returns: 'broken button'
   * cleanMessage('update: Set button text') // Returns: 'Set button text'
   *
   * @example
   * // No prefix at all
   * cleanMessage('Add new feature') // Returns: 'Add new feature'
   */
  cleanMessage(message) {
    // Single comprehensive regex that captures all parts in one pass:
    // - Conventional types: feat, fix, docs, style, refactor, perf, test, chore, build, ci, revert
    // - Action words: add, remove, update, change, improve, enhance, implement, create, delete
    // - Optional scope: (scope)
    // - Required message: everything after the colon or the whole message if no prefix
    const pattern =
      /^(?:(?:feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert|add|remove|update|change|improve|enhance|implement|create|delete)(\([^)]+\))?:\s*)?(.+)$/i;

    const match = message.trim().match(pattern);

    if (!match) {
      // Fallback: return original message if pattern doesn't match (edge case)
      return message;
    }

    const scope = match[1]; // Capturing group 1: (scope) or undefined
    const cleanedMessage = match[2]; // Capturing group 2: the actual message

    // If scope exists, prepend it to the cleaned message for context
    if (scope) {
      return `${scope} ${cleanedMessage}`;
    }

    return cleanedMessage;
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
    const cleanMsg = this.cleanMessage(message);

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
    // Then remove just the action word if it's still at the start (handles cases without "dependency" keyword)
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

      // Generate PR/commit links
      const links = commits.map((commit) => {
        if (commit.prNumber) {
          return `[#${commit.prNumber}](${this.repositoryUrl}/pull/${commit.prNumber})`;
        } else {
          return `[${commit.hash.substring(0, 7)}](${this.repositoryUrl}/commit/${commit.hash})`;
        }
      });

      // Format entry
      const toVersion = versions[versions.length - 1];
      // Use the action from the first (or any) commit - they should all be the same action for the same package
      const action = deps[0].parsed.action || 'Update';

      if (fromVersion === toVersion) {
        // Single version update
        consolidatedEntries.push(
          `- ${action} ${packageName} to v${toVersion} (${links.join(', ')})`,
        );
      } else {
        // Version range
        consolidatedEntries.push(
          `- ${action} ${packageName} from v${fromVersion} to v${toVersion} (${links.join(', ')})`,
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

      // Generate PR/commit links
      const links = commits.map((commit) => {
        if (commit.prNumber) {
          return `[#${commit.prNumber}](${this.repositoryUrl}/pull/${commit.prNumber})`;
        } else {
          return `[${commit.hash.substring(0, 7)}](${this.repositoryUrl}/commit/${commit.hash})`;
        }
      });

      // Format entry - capitalize first letter for consistency
      const capitalizedMessage = message.charAt(0).toUpperCase() + message.slice(1);
      consolidatedEntries.push(`- ${capitalizedMessage} (${links.join(', ')})`);
    }

    return consolidatedEntries;
  }

  buildUnreleasedContent(sections, fromTag = null) {
    let content = '\n## [Unreleased]\n';

    // Define the order of sections to maintain consistency
    const sectionOrder = [
      'Added',
      'Changed',
      'Fixed',
      'Removed',
      'Security',
      'Deprecated',
      'Dependencies',
    ];

    for (const sectionName of sectionOrder) {
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

    return content;
  }

  buildReleaseContent(version, compareUrl, date, sections, fromTag = null) {
    let content = `\n## [${version}](${compareUrl}) - ${date}\n`;

    // Define the order of sections to maintain consistency
    const sectionOrder = [
      'Added',
      'Changed',
      'Fixed',
      'Removed',
      'Security',
      'Deprecated',
      'Dependencies',
    ];

    for (const sectionName of sectionOrder) {
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

    return content;
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

  getCommitsSince(fromTag, toTag = 'HEAD') {
    try {
      const range = fromTag ? `${fromTag}..${toTag}` : toTag;
      // Use custom delimiter to separate commits, then extract hash and first line of message
      // %h = abbreviated hash, %B = full commit message
      const gitLog = execSync(
        `git log ${range} --pretty=format:"COMMIT_START%h%nCOMMIT_MSG_START%n%B%nCOMMIT_END" --first-parent`,
        { encoding: 'utf8' },
      ).trim();

      if (!gitLog) return [];

      // Split by commit delimiter and process each commit
      const commits = gitLog.split('COMMIT_START').filter((c) => c.trim());

      return commits
        .map((commitBlock) => {
          // Extract hash and message
          const lines = commitBlock.split('\n');
          const commitHash = lines[0].trim();
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
            try {
              const prInfo = execSync(
                `gh pr view ${mergeMatch[2]} --json title,labels --jq '{title, labels: [.labels[].name]}'`,
                { encoding: 'utf8', stdio: 'pipe' },
              ).trim();
              const parsed = JSON.parse(prInfo);
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
                isDependency: isDependency,
                isReleasePrep: isReleasePrep,
              };
            } catch (error) {
              console.log(`⚠️ Failed to get PR info for #${mergeMatch[2]}: ${error.message}`);
              return {
                hash: mergeMatch[1],
                message: `Merged PR #${mergeMatch[2]}`,
                prNumber: mergeMatch[2],
                isDependency: false,
                isReleasePrep: false,
              };
            }
          }

          // Parse regular commits
          const prMatch = firstLine.match(/\(#(\d+)\)$/);
          const prNumber = prMatch ? prMatch[1] : null;
          const commitMessage = prMatch ? firstLine.replace(/\s*\(#\d+\)$/, '') : firstLine;

          let isDependency = false;
          let isReleasePrep = false;
          if (prNumber) {
            try {
              const prInfo = execSync(
                `gh pr view ${prNumber} --json labels --jq '{labels: [.labels[].name]}'`,
                { encoding: 'utf8', stdio: 'pipe' },
              ).trim();
              const parsed = JSON.parse(prInfo);
              isDependency =
                parsed.labels &&
                parsed.labels.some(
                  (label) =>
                    label.toLowerCase().includes('depend') || label.toLowerCase().includes('deps'),
                );
              isReleasePrep =
                parsed.labels &&
                parsed.labels.some((label) => label.toLowerCase().includes('release-prep'));
            } catch (error) {
              // If we can't get PR info, assume not a dependency or release-prep
              console.log(`⚠️ Failed to get PR info for #${prNumber}: ${error.message}`);
              isDependency = false;
              isReleasePrep = false;
            }
          }

          return {
            hash: commitHash,
            message: commitMessage,
            prNumber: prNumber,
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
    } catch (error) {
      console.error('❌ Error getting commits:', error.message);
      return [];
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

export { ChangelogSyncer };
