// scripts/lint/migration-versions-check.js: checks the version constants of registry migrations.
//
// A registry migration runs for a user whose last-run version is below its constant
// (source/migrations.bs). So a migration added since the last release must be numbered
// above that release, or its users skip it, and no higher than the release it ships in,
// or it runs on every launch until a later release.
//
// It compares the constants in source/migrations.bs with the same file at the previous
// release tag:
//   - A new constant must be above the previous release (the floor). With a release
//     version, it must also be at or below that release (the ceiling).
//   - A released constant keeps its value. Changing it re-runs the migration for users
//     who already ran it, or does nothing; new work gets a new constant and block.
//   - A released constant may be removed, or renamed with its value kept.
//
// The floor is known on any pull request; the ceiling only once the release is named.
// So pull requests run it with --branch (a release-X.Y.Z branch gets both checks, any
// other the floor), and the release workflow runs it with --release.
//
// Usage:  node scripts/lint/migration-versions-check.js
//           [--release <x.y.z> | --branch <name>] [--previous <tag>] [--root <dir>]
//         --previous defaults to the highest vX.Y.Z tag.
// Exit:   0 = every constant is numbered correctly
//         1 = at least one is not; each is named with what to do
//         2 = bad arguments, or the file or tag cannot be read

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import gitSafe from '../lib/git-safe.cjs';

const MIGRATIONS_PATH = 'source/migrations.bs';
// Loose on purpose: any `const <NAME>_VERSION =` line, whatever its value, so a value
// the device would still read (BrightScript pads "3.5" to 3.5.0) is reported, not skipped
const CONSTANT_LINE = /^[ \t]*const[ \t]+([A-Za-z0-9_]+_VERSION)[ \t]*=[ \t]*(.*)$/gim;
const CONSTANT_VALUE = /^"(\d+\.\d+\.\d+)"[ \t]*(?:'.*)?$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;
const RELEASE_BRANCH = /^release-(\d+\.\d+\.\d+)$/;

/**
 * Every `const X_VERSION = …` in a migrations file.
 *
 * @returns {{ constants: Map<string, string>, malformed: { name: string, raw: string }[] }}
 */
export function parseMigrationVersions(text) {
  const constants = new Map();
  const malformed = [];
  for (const [, name, rawValue] of String(text ?? '').matchAll(CONSTANT_LINE)) {
    const raw = rawValue.trim();
    const value = raw.match(CONSTANT_VALUE);
    if (value) constants.set(name, value[1]);
    else malformed.push({ name, raw });
  }
  return { constants, malformed };
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

/** The x.y.z of a `release-x.y.z` branch, or undefined for any other branch. */
export function releaseFromBranch(branch) {
  return RELEASE_BRANCH.exec(branch ?? '')?.[1];
}

/**
 * Checks the constants against the previous release, and against this one when given.
 *
 * @param {object} input
 * @param {string} input.current - source/migrations.bs as it is now
 * @param {string} input.previous - the same file at the previous release ('' if absent)
 * @param {string} input.previousVersion - the previous release, x.y.z
 * @param {string} [input.releaseVersion] - the release being cut, x.y.z; omit to check only the floor
 */
export function checkMigrationVersions({ current, previous, previousVersion, releaseVersion }) {
  const now = parseMigrationVersions(current);
  const before = parseMigrationVersions(previous).constants;
  const checked = [];
  const renamed = [];
  const problems = [];

  for (const { name, raw } of now.malformed) {
    problems.push({
      name,
      message: `${name} is ${raw}, not a quoted x.y.z version such as "${releaseVersion ?? '1.2.3'}".`,
    });
  }

  // A released name that is gone may have been renamed: pair it with a new name of the
  // same value, once per released name, so a second new constant at that value is checked
  const removedByValue = new Map();
  for (const [name, version] of before) {
    if (now.constants.has(name)) continue;
    removedByValue.set(version, [...(removedByValue.get(version) ?? []), name]);
  }

  for (const [name, version] of now.constants) {
    const released = before.get(name);
    if (released === version) continue;

    if (released !== undefined) {
      problems.push({
        name,
        message: `${name} was released as ${released} and is now ${version}. A released value stays fixed: changing it re-runs the migration for users who already ran it, or does nothing. Put it back to ${released}, and add a new constant and block for new work.`,
      });
      continue;
    }

    const renamedFrom = removedByValue.get(version)?.shift();
    if (renamedFrom) {
      renamed.push({ from: renamedFrom, to: name });
      continue;
    }

    checked.push(name);
    const fix = releaseVersion
      ? `Set it to ${releaseVersion}.`
      : `Set it to the release it ships in, above ${previousVersion}.`;
    if (compareVersions(version, previousVersion) <= 0) {
      problems.push({
        name,
        message: `${name} is ${version}, not above the previous release ${previousVersion}: a user on ${previousVersion} would skip it. ${fix}`,
      });
    } else if (releaseVersion && compareVersions(version, releaseVersion) > 0) {
      problems.push({
        name,
        message: `${name} is ${version}, above this release ${releaseVersion}: it would run on every launch until a later release. ${fix}`,
      });
    }
  }

  return {
    found: now.constants.size + now.malformed.length,
    checked,
    renamed,
    removed: [...removedByValue.values()].flat(),
    problems,
  };
}

function readArgs(argv) {
  const args = { root: process.cwd() };
  const flags = {
    '--release': 'release',
    '--branch': 'branch',
    '--previous': 'previous',
    '--root': 'root',
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!(flag in flags)) throw new Error(`unknown argument ${flag}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    args[flags[flag]] = value;
  }
  if (args.release !== undefined && args.branch !== undefined)
    throw new Error('pass --release or --branch, not both');
  if (args.release !== undefined && !VERSION.test(args.release))
    throw new Error(`--release ${args.release} is not x.y.z`);
  return args;
}

function latestReleaseTag(root) {
  const tags = gitSafe.git(root, ['tag', '--list', 'v*', '--sort=-v:refname']).split('\n');
  return tags.map((tag) => tag.trim()).find((tag) => RELEASE_TAG.test(tag));
}

function fileAtTag(root, tag) {
  try {
    gitSafe.git(root, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`]);
  } catch {
    throw new Error(`${tag} is not a tag in this repository; fetch it, or pass --previous`);
  }
  // Empty when the file did not exist at that release: then every constant is new
  const listed = gitSafe.git(root, ['ls-tree', '--name-only', tag, '--', MIGRATIONS_PATH]);
  return listed.trim() ? gitSafe.git(root, ['show', `${tag}:${MIGRATIONS_PATH}`]) : '';
}

function main(argv) {
  const args = readArgs(argv);
  const release = args.release ?? releaseFromBranch(args.branch);
  const tag = args.previous ?? latestReleaseTag(args.root);
  if (!tag) throw new Error('no vX.Y.Z tag found; fetch tags, or pass --previous');
  if (!RELEASE_TAG.test(tag)) throw new Error(`--previous ${tag} is not a vX.Y.Z tag`);
  const previous = fileAtTag(args.root, tag);
  const previousVersion = tag.slice(1);
  if (release && compareVersions(release, previousVersion) <= 0)
    throw new Error(`release ${release} is not above the previous release ${previousVersion}`);

  const current = readFileSync(join(args.root, MIGRATIONS_PATH), 'utf8');
  const result = checkMigrationVersions({
    current,
    previous,
    previousVersion,
    releaseVersion: release,
  });

  // A file with no constants means the pattern no longer matches it, not that all is well
  if (result.found === 0)
    throw new Error(`no migration version constants found in ${MIGRATIONS_PATH}`);

  if (result.problems.length === 0) {
    const scope = release
      ? `for ${release} (previous ${previousVersion})`
      : `above ${previousVersion}`;
    const lines = [
      `migration-versions: OK ${scope}. New since then: ${result.checked.join(', ') || 'none'}.`,
    ];
    for (const { from, to } of result.renamed) lines.push(`  Renamed: ${from} to ${to}.`);
    if (result.removed.length) lines.push(`  Removed: ${result.removed.join(', ')}.`);
    console.log(lines.join('\n'));
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
    console.error(`::error::migration-versions-check: ${err.message}`);
    process.exitCode = 2;
  }
}
