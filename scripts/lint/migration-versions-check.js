// scripts/lint/migration-versions-check.js: the release-time check on migration versions.
//
// A registry migration runs for a user whose last-run version is below its constant
// (source/migrations.bs). So a migration added since the last release must be numbered
// above that release, or its users skip it, and no higher than the release it ships in,
// or it runs again after the next one. Nobody knows the release number until the
// release is cut, so the release workflow runs this then, with both numbers in hand.
//
// It compares the constants in source/migrations.bs with the same file at the previous
// release tag. A constant that is new, or whose value changed, must satisfy
// previous < value <= release. Constants already released are left alone.
//
// Usage:  node scripts/lint/migration-versions-check.js --release <x.y.z> [--previous <tag>] [--root <dir>]
//         --previous defaults to the highest vX.Y.Z tag.
// Exit:   0 = every new migration is numbered for this release
//         1 = at least one is not; each is named with the value to set
//         2 = bad arguments, or the file or tag cannot be read

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import gitSafe from '../lib/git-safe.cjs';

const MIGRATIONS_PATH = 'source/migrations.bs';
const CONSTANT = /^const\s+([A-Z0-9_]+_VERSION)\s*=\s*"(\d+\.\d+\.\d+)"/gm;
const VERSION = /^\d+\.\d+\.\d+$/;

/** Every `const X_VERSION = "a.b.c"` in a migrations file, as a Map of name to version. */
export function parseMigrationVersions(text) {
  const found = new Map();
  for (const match of String(text ?? '').matchAll(CONSTANT)) found.set(match[1], match[2]);
  return found;
}

/** Negative, zero or positive as `a` is below, equal to or above `b` (x.y.z strings). */
export function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/**
 * The migrations new or changed since the previous release, and which of them are
 * numbered wrong for this one.
 *
 * @param {object} input
 * @param {string} input.current - source/migrations.bs as it is now
 * @param {string} input.previous - the same file at the previous release ('' if absent)
 * @param {string} input.previousVersion - the previous release, x.y.z
 * @param {string} input.releaseVersion - the release being cut, x.y.z
 * @returns {{ found: number, checked: string[], problems: { name: string, version: string, message: string }[] }}
 */
export function checkMigrationVersions({ current, previous, previousVersion, releaseVersion }) {
  const now = parseMigrationVersions(current);
  const before = parseMigrationVersions(previous);
  const checked = [];
  const problems = [];

  for (const [name, version] of now) {
    if (before.get(name) === version) continue;
    checked.push(name);
    if (compareVersions(version, previousVersion) <= 0) {
      problems.push({
        name,
        version,
        message: `${name} is ${version}, not above the previous release ${previousVersion}: a user on ${previousVersion} would skip it. Set it to ${releaseVersion}.`,
      });
    } else if (compareVersions(version, releaseVersion) > 0) {
      problems.push({
        name,
        version,
        message: `${name} is ${version}, above this release ${releaseVersion}: it would run again after the next release. Set it to ${releaseVersion}.`,
      });
    }
  }

  return { found: now.size, checked, problems };
}

function readArgs(argv) {
  const args = { root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--release') args.release = argv[++i];
    else if (flag === '--previous') args.previous = argv[++i];
    else if (flag === '--root') args.root = argv[++i];
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!VERSION.test(args.release ?? '')) throw new Error('--release <x.y.z> is required');
  return args;
}

function latestReleaseTag(root) {
  const tags = gitSafe.git(root, ['tag', '--list', 'v*', '--sort=-v:refname']).split('\n');
  return tags.find((tag) => /^v\d+\.\d+\.\d+$/.test(tag.trim()))?.trim();
}

function fileAtTag(root, tag) {
  try {
    return gitSafe.git(root, ['show', `${tag}:${MIGRATIONS_PATH}`]);
  } catch {
    // The file did not exist at that release: every constant is new
    return '';
  }
}

function main(argv) {
  const args = readArgs(argv);
  const tag = args.previous ?? latestReleaseTag(args.root);
  if (!tag) throw new Error('no vX.Y.Z tag found; pass --previous');
  const previousVersion = tag.replace(/^v/, '');
  if (!VERSION.test(previousVersion)) throw new Error(`--previous ${tag} is not a vX.Y.Z tag`);

  const current = readFileSync(join(args.root, MIGRATIONS_PATH), 'utf8');
  const result = checkMigrationVersions({
    current,
    previous: fileAtTag(args.root, tag),
    previousVersion,
    releaseVersion: args.release,
  });

  // A file with no constants means the pattern no longer matches it, not that all is well
  if (result.found === 0)
    throw new Error(`no migration version constants found in ${MIGRATIONS_PATH}`);

  if (result.problems.length === 0) {
    const what = result.checked.length ? result.checked.join(', ') : 'none';
    console.log(
      `migration-versions: OK for ${args.release} (previous ${previousVersion}). New since then: ${what}.`,
    );
    return 0;
  }
  for (const problem of result.problems) console.error(`::error::${problem.message}`);
  console.error('See docs/dev/registry-migrations.md, "1. Add a version constant".');
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`migration-versions-check: ${err.message}`);
    process.exitCode = 2;
  }
}
