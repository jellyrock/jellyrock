/**
 * The mechanics behind /release-summary; the model writes only the summary itself.
 *
 *   node .claude/skills/release-summary/summary.js context [<version>]
 *     everything the summary is drawn from, printed for the model to read
 *   node .claude/skills/release-summary/summary.js check [<version>] <file>
 *     the shape the summary must have; prints each problem and exits 1
 *   node .claude/skills/release-summary/summary.js write [<version>] <file>
 *     puts a passing summary into the version's draft release, and nowhere else
 *
 * With no version, it is the one draft release's; with no draft yet, [Unreleased].
 *
 * A published release is never written: it gets its summary from its CHANGELOG.md
 * section when its page is rebuilt with `release-notes`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ChangelogSyncer, SUMMARY_REMINDER } from '../../../scripts/changelog-syncer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const VOICE_CHECK = path.join(REPO, '.claude/skills/log/voice-check.sh');
const FEATURES_DIR = path.join(REPO, 'docs/user/features');
// Short enough to read in a notification preview, with room for a large release's
// story: 2 more words for each user-facing line past 12, never past the ceiling.
const MAX_WORDS = 60;
const WORDS_FROM_LINE = 12;
const WORDS_PER_LINE = 2;
const MAX_WORDS_CEILING = 90;
const EXAMPLES = 3;
const DAY_MS = 86400000;
const MAINTAINERS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const ISSUE_REF = /\b(?:Ref|Refs|Part of|Fixes|Closes|Resolves)\s+#(\d+)/gi;
const SUMMARY_BLOCK = /^### Summary[ \t]*\r?\n[\s\S]*?(?=^#{1,3} |(?![\s\S]))/m;

function assertVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid version format: ${version}. Expected: x.y.z`);
  }
}

/** A released version's section, heading excluded, or null when it has none. */
function releasedSection(changelog, version) {
  const lines = changelog.split('\n');
  const escaped = version.replace(/\./g, '\\.');
  const start = lines.findIndex((line) => new RegExp(`^## \\[${escaped}\\]`).test(line));
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## ['));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

/**
 * The section's PRs (every one cited, and the ones whose bodies are worth reading), how
 * many lines its Fixed heading lists, and how many lines a user would notice (every
 * heading but Dependencies and New Contributors).
 */
function readSectionFacts(section) {
  const all = new Set();
  const read = new Set();
  let fixes = 0;
  let userLines = 0;
  let heading = '';
  for (const line of section.split('\n')) {
    if (line.startsWith('### ')) heading = line.slice(4).trim();
    if (!line.startsWith('- ') || heading === 'Summary') continue;
    if (heading === 'Fixed') fixes++;
    if (heading !== 'Dependencies' && heading !== 'New Contributors') userLines++;
    for (const [, n] of line.matchAll(/\[#(\d+)\]\(/g)) {
      all.add(Number(n));
      if (heading !== 'Dependencies' && heading !== 'New Contributors') read.add(Number(n));
    }
  }
  const sort = (set) => [...set].sort((a, b) => a - b);
  return { all: sort(all), read: sort(read), fixes, userLines };
}

/** The word limit for a release with this many user-facing lines. */
function wordLimit(userLines) {
  const extra = Math.max(0, userLines - WORDS_FROM_LINE) * WORDS_PER_LINE;
  return Math.min(MAX_WORDS + extra, MAX_WORDS_CEILING);
}

/** A version's own section, or [Unreleased] while it is a draft or has no version yet. */
function versionSection(syncer, version) {
  const changelog = fs.readFileSync(syncer.changelogPath, 'utf8');
  if (version === null) return syncer.readSection(changelog, '');
  return releasedSection(changelog, version) ?? syncer.readSection(changelog, version);
}

/** The newest release tag, for [Unreleased] before it has a version. */
function latestTag() {
  return (
    execSync('git tag --sort=-v:refname', { encoding: 'utf8' })
      .trim()
      .split('\n')
      .find((tag) => /^v\d+\.\d+\.\d+$/.test(tag)) ?? null
  );
}

/**
 * The version to summarize: the one given, else the one draft release's (the release
 * branch creates it), else null for [Unreleased] before any draft exists. Several drafts
 * throw, since picking one would be a guess.
 */
export function resolveVersion(given, { syncer }) {
  if (given) {
    assertVersion(given);
    return { version: given, from: 'argument' };
  }
  const drafts = syncer
    .gh([
      'release',
      'list',
      '--repo',
      syncer.repo,
      '--json',
      'tagName,isDraft',
      '--jq',
      '.[] | select(.isDraft) | .tagName',
    ])
    .split('\n')
    // A draft tagged anything but vX.Y.Z (a preview, a test) is not a release.
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  if (drafts.length > 1) {
    throw new Error(`${drafts.length} draft releases (${drafts.join(', ')}); give the version`);
  }
  return drafts.length === 1
    ? { version: drafts[0].replace(/^v/, ''), from: 'draft' }
    : { version: null, from: 'none' };
}

function commitDate(tag) {
  return new Date(
    execFileSync('git', ['log', '-1', '--format=%cI', tag], { encoding: 'utf8' }).trim(),
  );
}

function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  const fields = {};
  for (const line of match ? match[1].split('\n') : []) {
    const kv = line.match(/^([a-z]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

/**
 * One issue a PR closes, with what makes a fix worth naming: who reported it, how long it
 * stayed open, how many people weighed in, and whether it was opened after the previous
 * release.
 */
function describeIssue(n, issue, previous, now) {
  const labels = issue.labels.map((l) => l.name).join(', ');
  const opened = new Date(issue.created_at);
  const end = issue.closed_at ? new Date(issue.closed_at) : now;
  const days = Math.floor((end - opened) / DAY_MS);
  const who = MAINTAINERS.has(issue.author_association) ? 'a maintainer' : 'a user';
  const after = previous.date && opened > previous.date ? `, opened after ${previous.tag}` : '';
  return (
    `#${n} "${issue.title}"${labels ? ` (${labels})` : ''}: reported by ${who}, ` +
    `open ${days} days, ${issue.comments} comments, ${issue.reactions.total_count} reactions${after}`
  );
}

/** Everything the summary is drawn from, as text for the model. */
export function releaseContext(version, { syncer, featuresDir = FEATURES_DIR, now = new Date() }) {
  if (version !== null) assertVersion(version);
  const changelog = fs.readFileSync(syncer.changelogPath, 'utf8');
  const releasedText = version === null ? null : releasedSection(changelog, version);
  const released = releasedText !== null;
  const section = releasedText ?? versionSection(syncer, version);
  const facts = readSectionFacts(section);
  const previousTag = version === null ? latestTag() : syncer.getTagBefore(version);
  const previous = { tag: previousTag, date: previousTag ? commitDate(previousTag) : null };
  const issues = new Map();
  const readIssue = (n) => {
    if (!issues.has(n)) {
      issues.set(n, JSON.parse(syncer.gh(['api', `repos/${syncer.repo}/issues/${n}`])));
    }
    return issues.get(n);
  };

  const prLines = [];
  const referenced = new Set();
  for (const n of facts.read) {
    const pr = JSON.parse(
      syncer.gh([
        'pr',
        'view',
        String(n),
        '--repo',
        syncer.repo,
        '--json',
        'title,body,closingIssuesReferences',
      ]),
    );
    prLines.push(`<pr number="${n}" title="${pr.title}">`, (pr.body || '').trim(), '</pr>');
    for (const [, ref] of (pr.body || '').matchAll(ISSUE_REF)) referenced.add(Number(ref));
    for (const ref of pr.closingIssuesReferences || []) {
      if (!ref.url.startsWith(`${syncer.repositoryUrl}/issues/`)) continue;
      referenced.add(ref.number);
      prLines.push(`  closes ${describeIssue(ref.number, readIssue(ref.number), previous, now)}`);
    }
    prLines.push('');
  }
  const epics = [...referenced]
    .sort((a, b) => a - b)
    .map((n) => [n, readIssue(n)])
    .filter(([, i]) => i.state === 'open' && i.labels.some((l) => l.name === 'epic'))
    .map(([n, i]) => `#${n} "${i.title}"`);

  const title = version === null ? '[Unreleased], no draft release yet' : `v${version}`;
  const out = [`# Release summary context: ${title}`, ''];
  if (previous.date) {
    // A released version is measured to its own tag, a draft to today.
    const [end, endName] = released ? [commitDate(`v${version}`), `v${version}`] : [now, 'today'];
    // Under two days, hours: a release a few hours after the last is how a hotfix shows.
    const hours = Math.floor((end - previous.date) / 3600000);
    const gap = hours < 48 ? `${hours} hours` : `${Math.floor(hours / 24)} days`;
    out.push(`previous: ${previous.tag}, ${gap} before ${endName}`);
  } else {
    out.push('previous: none');
  }
  out.push(`PRs in this release: ${facts.all.map((n) => `#${n}`).join(', ') || 'none'}`);
  const plural = facts.fixes === 1 ? '' : 's';
  out.push(`fixes: ${facts.fixes ? `${facts.fixes} line${plural} in the Fixed section` : 'none'}`);
  out.push(`word limit: ${wordLimit(facts.userLines)}, for ${facts.userLines} user-facing lines`);
  out.push(`open epics these PRs reference: ${epics.join(', ') || 'none'}`, '');

  out.push('## The changelog section', '', '<section>', section.trim(), '</section>', '');
  out.push('## Pull requests (Dependencies bodies left out)', '', ...prLines);

  out.push('## Feature pages this release ships', '');
  const since = released ? version : 'unreleased';
  const pages = fs
    .readdirSync(featuresDir)
    .filter((f) => f.endsWith('.md') && f !== 'index.md')
    .sort()
    .map((f) => [f, frontmatter(fs.readFileSync(path.join(featuresDir, f), 'utf8'))])
    .filter(([, fm]) => fm.since === since && fm.pitch);
  out.push(...(pages.length ? pages.map(([f, fm]) => `- ${f}: ${fm.pitch}`) : ['none']), '');

  out.push('## The two releases before it', '');
  let tag = previous.tag;
  for (let i = 0; i < 2 && tag; i++) {
    const text = releasedSection(changelog, tag.slice(1));
    if (text !== null) {
      out.push(`<section version="${tag.slice(1)}">`, text.trim(), '</section>', '');
    }
    tag = syncer.getTagBefore(tag.slice(1));
  }

  out.push('## Style examples: approved summaries, newest first', '');
  const examples = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)]
    .map(([, v]) => v)
    .filter((v) => v !== version)
    .map((v) => [v, releasedSection(changelog, v).match(SUMMARY_BLOCK)])
    .filter(([, m]) => m)
    .slice(0, EXAMPLES);
  out.push(
    ...(examples.length
      ? examples.flatMap(([v, m]) => [`<example version="${v}">`, m[0].trim(), '</example>', ''])
      : ['none yet', '']),
  );
  return out.join('\n');
}

/** Every way the summary in `file` breaks its shape; empty when it passes. */
export function checkSummary(file, version, { syncer }) {
  if (version !== null) assertVersion(version);
  const { userLines } = readSectionFacts(versionSection(syncer, version));
  const limit = wordLimit(userLines);
  const errors = [];
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');

  if (lines[0] !== '### Summary') {
    errors.push('The summary starts with "### Summary" on its own line.');
  }
  const text = [];
  lines.forEach((line, i) => {
    if (i === 0 && line === '### Summary') return;
    if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line)) {
      errors.push(`The summary is prose only: line ${i + 1} is a list item.`);
    } else if (line.startsWith('#')) {
      errors.push(`The summary is prose only: line ${i + 1} is a heading.`);
    } else if (line.trim()) {
      text.push(line);
    }
  });
  const words = text.join(' ').split(/\s+/).filter(Boolean).length;
  if (words === 0) errors.push('The summary has no text under the heading.');
  if (words > limit) {
    errors.push(`It has ${words} words; the limit for ${userLines} user-facing lines is ${limit}.`);
  }

  const counts = execFileSync('bash', [VOICE_CHECK, '--counts', file], { encoding: 'utf8' });
  for (const line of counts.trim().split('\n')) {
    const [, category, count] = line.split('\t');
    if (Number(count) > 0) errors.push(`House voice: ${category}: ${count}.`);
  }
  return errors;
}

/** Put a passing summary into the version's draft release, replacing any summary there. */
export function writeSummary(version, file, { syncer }) {
  const errors = checkSummary(file, version, { syncer });
  if (errors.length) throw new Error(`The summary fails its check:\n${errors.join('\n')}`);
  if (version === null) {
    throw new Error('There is no draft release yet: push the release-x.y.z branch, then write');
  }
  const tag = `v${version}`;
  let release;
  try {
    release = JSON.parse(
      syncer.gh(['release', 'view', tag, '--repo', syncer.repo, '--json', 'body,isDraft']),
    );
  } catch (error) {
    if (/release not found/.test(String(error.stderr))) {
      throw new Error(`There is no ${tag} release to write into`, { cause: error });
    }
    throw new Error(`Could not read the ${tag} release: ${error.stderr || error.message}`, {
      cause: error,
    });
  }
  if (!release.isDraft) {
    throw new Error(`${tag} is published: it gets its summary from CHANGELOG.md, not from here`);
  }

  const text = fs.readFileSync(file, 'utf8').trim();
  const summary = text + '\n\n';
  // GitHub's editor saves CRLF; LF keeps the blocks below matching line ends.
  const body = release.body.replace(/\r\n?/g, '\n');
  let next;
  // A function replacement, so a `$` in the summary is never read as a pattern.
  if (SUMMARY_BLOCK.test(body)) {
    next = body.replace(SUMMARY_BLOCK, () => summary);
  } else if (SUMMARY_REMINDER.test(body)) {
    next = body.replace(SUMMARY_REMINDER, () => text);
  } else {
    const schedule = body.match(/^## Release Schedule[^\n]*\n[\s\S]*?(?=^#{1,3} |(?![\s\S]))/m);
    const at = schedule ? schedule.index + schedule[0].length : 0;
    const before = body.slice(0, at);
    next =
      (before && !before.endsWith('\n\n') ? before.replace(/\n*$/, '\n\n') : before) +
      summary +
      body.slice(at);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-summary-'));
  try {
    const notes = path.join(dir, 'notes.md');
    fs.writeFileSync(notes, next);
    syncer.gh(['release', 'edit', tag, '--repo', syncer.repo, '--notes-file', notes]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  // A first argument shaped like x.y.z is the version; anything else is the file.
  const given = /^\d+\.\d+\.\d+$/.test(rest[0] ?? '') ? rest.shift() : undefined;
  const file = rest[0];
  const syncer = new ChangelogSyncer();
  try {
    const needsFile = command === 'check' || command === 'write';
    if (!['context', 'check', 'write'].includes(command) || (needsFile && !file)) {
      console.error(
        'Usage: summary.js context [<version>] | check [<version>] <file> | write [<version>] <file>',
      );
      process.exit(2);
    }
    const { version, from } = resolveVersion(given, { syncer });
    if (from === 'draft') console.error(`ℹ️ v${version}: the draft release's version`);
    if (from === 'none') console.error('ℹ️ No draft release yet: summarizing [Unreleased]');
    if (command === 'context') {
      process.stdout.write(releaseContext(version, { syncer }) + '\n');
    } else if (command === 'check') {
      const errors = checkSummary(file, version, { syncer });
      if (errors.length) {
        console.error(errors.join('\n'));
        process.exit(1);
      }
      console.log('✅ The summary passes');
    } else {
      writeSummary(version, file, { syncer });
      console.log(`✅ Summary written to the v${version} draft`);
    }
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}
