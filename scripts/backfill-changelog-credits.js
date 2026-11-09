/**
 * One-time backfill: credit every change line in CHANGELOG.md's released sections and add
 * each release's New Contributors block, with the same code the live sync uses
 * (getCommitsSince(), attachAuthors(), formatCredits(), findNewContributors()).
 *
 * It only appends ` by …` after a line's links and adds New Contributors at a section's
 * end; it never regenerates a section, since released sections are edited by hand. A line
 * already credited is left alone, so it can run again. A line it cannot match fails the
 * run with a list, never a guess.
 *
 * A commit whose email no account owns, ported from the upstream fork, is credited to
 * the author of the upstream PR it came through, found from that PR's commit list.
 *
 * Usage:
 *   node scripts/backfill-changelog-credits.js --out <file> [--compare]   dry run
 *   node scripts/backfill-changelog-credits.js --write [--compare]        write CHANGELOG.md
 *
 * --compare checks every PR credit and New Contributors block against GitHub's own
 * generated notes for each tag range.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { ChangelogSyncer } from './changelog-syncer.js';

const UPSTREAM = 'jellyfin-archive/jellyfin-roku-legacy';
const LINK =
  /\[(?:#(\d+)|([0-9a-f]{7,40}))\]\(https:\/\/github\.com\/[^/]+\/[^/]+\/(?:pull|commit)\/[^)]+\)/g;
const SKIPPED_HEADINGS = new Set(['### Summary', '### New Contributors']);

const args = process.argv.slice(2);
const write = args.includes('--write');
const compare = args.includes('--compare');
const outIndex = args.indexOf('--out');
const out = outIndex === -1 ? null : args[outIndex + 1];
if (!write && !out) {
  console.error('Pass --out <file> for a dry run, or --write to update CHANGELOG.md');
  process.exit(2);
}

const syncer = new ChangelogSyncer();

// GitHub's search API allows 30 calls a minute, and findNewContributors() makes one per
// author per range: wait out the limit instead of failing.
const plainGh = syncer.gh.bind(syncer);
syncer.gh = (ghArgs) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return plainGh(ghArgs);
    } catch (error) {
      const text = `${error.stderr || ''} ${error.message}`;
      if (attempt >= 5 || !/rate limit|secondary rate/i.test(text)) throw error;
      process.stderr.write(`  rate limited; waiting 65 s (attempt ${attempt})\n`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 65000);
    }
  }
};

const upstreamAuthors = new Map();

/** The upstream PR author for a commit no account owns, matched by email and subject. */
function upstreamAuthor(commit) {
  const key = `${commit.authorEmail}\t${commit.message}`;
  if (upstreamAuthors.has(key)) return upstreamAuthors.get(key);
  const matches = syncer
    .gh([
      'api',
      '-X',
      'GET',
      'search/commits',
      '-f',
      `q=repo:${UPSTREAM} author-email:${commit.authorEmail}`,
      '--jq',
      '.items[] | [.sha, (.commit.message | split("\n")[0])] | @tsv',
    ])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter(([, subject]) => subject === commit.message);
  if (matches.length !== 1) {
    throw new Error(
      `Commit ${commit.hash.substring(0, 7)} has no account, and ${matches.length} upstream commits match it`,
    );
  }
  const logins = syncer
    .gh([
      'api',
      `repos/${UPSTREAM}/commits/${matches[0][0]}/pulls`,
      '--jq',
      '[.[] | select(.merged_at != null) | .user.login] | unique | .[]',
    ])
    .split('\n')
    .filter(Boolean);
  if (logins.length !== 1) {
    throw new Error(
      `Upstream commit ${matches[0][0].substring(0, 7)} is in ${logins.length} merged PRs`,
    );
  }
  upstreamAuthors.set(key, logins[0]);
  return logins[0];
}

/**
 * A commit the changelog links but getCommitsSince() filtered out (a merge of main, a
 * translation-file commit), looked up on its own: it must sit in the range, and its
 * login comes from the same commits API attachAuthors() reads.
 */
function filteredCommit(short, previous, tag) {
  const hash = execFileSync('git', ['rev-parse', '--verify', `${short}^{commit}`], {
    encoding: 'utf8',
  }).trim();
  const isAncestor = (a, b) => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', a, b]);
      return true;
    } catch {
      return false;
    }
  };
  if (!isAncestor(hash, tag) || (previous && isAncestor(hash, previous))) {
    throw new Error(`${short} is not in ${previous || 'start'}..${tag}`);
  }
  const [authorName, authorEmail, message] = execFileSync(
    'git',
    ['log', '-1', '--format=%an%n%ae%n%s', hash],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n');
  const login = syncer.gh([
    'api',
    `repos/${syncer.repo}/commits/${hash}`,
    '--jq',
    '.author.login // ""',
  ]);
  const commit = {
    hash,
    authorName,
    authorEmail,
    message,
    author: login || syncer.botFromEmail(authorEmail),
  };
  if (commit.author === null) commit.author = upstreamAuthor(commit);
  return commit;
}

/** Each released section's version and line span, newest first. */
function releasedSections(lines) {
  const starts = lines
    .map((line, i) => [line.match(/^## \[(\d+\.\d+\.\d+)\]/)?.[1], i])
    .filter(([version]) => version);
  return starts.map(([version, start]) => {
    const next = lines.findIndex((line, i) => i > start && line.startsWith('## ['));
    return { version, start, end: next === -1 ? lines.length : next };
  });
}

/** GitHub's generated notes for a range: who it credits per PR, and who is new. */
function githubNotes(tag, previous) {
  const body = syncer.gh([
    'api',
    '-X',
    'POST',
    `repos/${syncer.repo}/releases/generate-notes`,
    '-f',
    `tag_name=${tag}`,
    '-f',
    `previous_tag_name=${previous}`,
    '--jq',
    '.body',
  ]);
  // "by @a in …", "by @a, @b in …", or for GitHub's own agent "by @a with @Copilot in …".
  const credits = new Map();
  const newcomers = new Set();
  for (const line of body.split('\n')) {
    const credit = line.match(/ by (@.+?) in https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)$/);
    if (credit) credits.set(credit[2], credit[1]);
    const first = line.match(/^\* @(\S+) made their first contribution/);
    if (first) newcomers.add(first[1]);
  }
  return { credits, newcomers };
}

const changelog = fs.readFileSync(syncer.changelogPath, 'utf8');
const lines = changelog.split('\n');
const EXCLUDED_LABELS = new Set(['dependencies', 'ignore-changelog']);
const prLabels = compare
  ? new Map(
      syncer
        .gh([
          'pr',
          'list',
          '--repo',
          syncer.repo,
          '--state',
          'merged',
          '--limit',
          '5000',
          '--json',
          'number,labels',
          '--jq',
          '.[] | [(.number | tostring), ([.labels[].name] | join(","))] | @tsv',
        ])
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [number, labels = ''] = line.split('\t');
          return [number, labels.split(',').filter(Boolean)];
        }),
    )
  : new Map();
const failures = [];
const mismatches = [];
const known = [];
const lookedUp = [];
let excluded = 0;
const tally = new Map();
const added = [];
let credited = 0;
let alreadyCredited = 0;

// Oldest first, so a failure names the earliest problem; edits are made bottom-up per
// section, and later sections sit above, so earlier indices stay valid.
for (const { version, start, end } of releasedSections(lines).reverse()) {
  const tag = `v${version}`;
  const previous = syncer.getPreviousTag(tag);
  process.stderr.write(`${previous || 'start'}..${tag}\n`);

  const commits = syncer.getCommitsSince(previous, tag);
  // A PR's own commit carries the PR's author now; attachAuthors() fills in the rest.
  const prAuthors = new Map(
    commits.filter((c) => c.prNumber && c.author).map((c) => [c.prNumber, c.author]),
  );
  syncer.attachAuthors(commits, previous, tag);
  for (const commit of commits) {
    if (commit.author === null) commit.author = upstreamAuthor(commit);
  }

  const prCredit = (number) => {
    if (!prAuthors.has(number)) {
      const pr = syncer.readPr(number, 'author', '{author: .author.login}');
      prAuthors.set(number, syncer.normalizeLogin(pr.author, number));
    }
    return { author: prAuthors.get(number) };
  };
  const commitCredit = (short) => {
    const found = commits.filter((c) => c.hash.startsWith(short));
    if (found.length > 1) {
      throw new Error(`${found.length} commits in ${previous || 'start'}..${tag} match ${short}`);
    }
    if (found.length === 1) return found[0];
    const commit = filteredCommit(short, previous, tag);
    lookedUp.push(`${version}: ${short} ${commit.message} -> ${commit.author}`);
    return commit;
  };

  const ours = new Map();
  let heading = null;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (line.startsWith('### ')) heading = line.trim();
    if (!line.startsWith('- ') || SKIPPED_HEADINGS.has(heading)) continue;

    const links = [...line.matchAll(LINK)];
    if (links.length === 0) {
      failures.push(`${version}: no link: ${line}`);
      continue;
    }
    const last = links[links.length - 1];
    const close = line.indexOf(')', last.index + last[0].length);
    const tail = close === -1 ? null : line.slice(close + 1);
    if (tail === null || (tail !== '' && !tail.startsWith(' by '))) {
      failures.push(`${version}: unexpected text after the links: ${line}`);
      continue;
    }
    if (tail.startsWith(' by ')) {
      alreadyCredited++;
      continue;
    }

    try {
      const sources = links.map(([, pr, hash]) => (pr ? prCredit(pr) : commitCredit(hash)));
      links.forEach(([, pr], n) => pr && ours.set(pr, sources[n].author));
      const credits = syncer.formatCredits(sources);
      for (const source of sources) {
        const who = source.author || source.authorName;
        tally.set(who, (tally.get(who) || 0) + 1);
      }
      lines[i] = `${line} by ${credits}`;
      credited++;
    } catch (error) {
      failures.push(`${version}: ${error.message}: ${line}`);
    }
  }

  const sectionText = lines.slice(start, end).join('\n');
  const newContributors = syncer.findNewContributors(commits, previous);
  if (newContributors.length > 0 && !sectionText.includes('### New Contributors')) {
    let last = end - 1;
    while (last > start && lines[last].trim() === '') last--;
    lines.splice(last + 1, 0, '', '### New Contributors', '', ...newContributors);
    added.push(`${version}: ${newContributors.join(' | ')}`);
  }

  if (compare && previous) {
    const github = githubNotes(tag, previous);
    for (const [pr, login] of ours) {
      const theirs = github.credits.get(pr);
      if (theirs === undefined) {
        // The release.yml at each tag left these labels out of GitHub's notes.
        if (prLabels.get(pr)?.some((label) => EXCLUDED_LABELS.has(label))) excluded++;
        else mismatches.push(`${version}: #${pr} is not in GitHub's notes`);
      } else if (/ with @/.test(theirs)) {
        // GitHub names the person who started its own agent; we credit the PR's author.
        known.push(`${version}: #${pr} ours ${login}, GitHub ${theirs}`);
      } else if (!theirs.split(', ').includes(`@${login}`)) {
        mismatches.push(`${version}: #${pr} ours ${login}, GitHub ${theirs}`);
      }
    }
    const ourNew = new Set(newContributors.map((line) => line.match(/\[@([^\]]+)\]/)?.[1]));
    const missing = [...github.newcomers].filter((login) => !ourNew.has(login));
    const extra = [...ourNew].filter((login) => login && !github.newcomers.has(login));
    if (missing.length || extra.length) {
      mismatches.push(
        `${version}: New Contributors differ (GitHub only: ${missing.join(', ') || 'none'}; ours only: ${extra.join(', ') || 'none'})`,
      );
    }
  }
}

console.log(`Lines credited: ${credited}; already credited: ${alreadyCredited}`);
console.log('Credits per author:');
for (const [who, count] of [...tally].sort((a, b) => b[1] - a[1]))
  console.log(`  ${who}: ${count}`);
console.log(`New Contributors added: ${added.length}`);
for (const line of added) console.log(`  ${line}`);
console.log(`Commits the sync's filter drops, looked up directly: ${lookedUp.length}`);
for (const line of lookedUp) console.log(`  ${line}`);
if (compare) {
  console.log(
    `PRs left out of GitHub's notes by a dependencies or ignore-changelog label: ${excluded}`,
  );
  console.log(`Known differences (GitHub credits who started its agent): ${known.length}`);
  for (const line of known) console.log(`  ${line}`);
  console.log(`Differences from GitHub's notes: ${mismatches.length}`);
  for (const line of mismatches) console.log(`  ${line}`);
}
if (failures.length > 0) {
  console.log(`Lines not credited: ${failures.length}`);
  for (const line of failures) console.log(`  ${line}`);
  process.exit(1);
}

fs.writeFileSync(write ? syncer.changelogPath : out, lines.join('\n'));
console.log(write ? 'CHANGELOG.md updated' : `Wrote ${out}`);
