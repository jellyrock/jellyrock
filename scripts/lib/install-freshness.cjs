// scripts/lib/install-freshness.cjs: is node_modules what package-lock.json and
// patches/ say it should be? `npm ci` and `patch-package` run only at install,
// so nothing else notices a checkout that fell behind. Read-only apart from
// recordPatches(), which `npm run patches:apply` calls after patch-package.
//
// Packages: the lockfile's `packages` against npm's own record of what it
// installed (node_modules/.package-lock.json). Patches: sha256 of each file in
// patches/ against node_modules/.jellyrock-patches.json, written at install.
//
// Usage:
//   node scripts/lib/install-freshness.cjs [--root <dir>]   exit 0 fresh, 1 stale, 2 error
//   node scripts/lib/install-freshness.cjs --record-patches [--root <dir>]

'use strict';

const { createHash } = require('crypto');
const { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require('fs');
const { join, resolve } = require('path');

const MAX_LINES = 10;
const PATCH_RECORD = 'node_modules/.jellyrock-patches.json';
const STALE_MESSAGE =
  "Installed packages don't match package-lock.json or patches/. Run npm ci, then retry.";

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function describeEntry(e) {
  return e.version ?? e.resolved ?? '(unknown)';
}

function differs(a, b) {
  if (a.version !== undefined || b.version !== undefined) {
    return a.version !== b.version || a.integrity !== b.integrity;
  }
  return a.resolved !== b.resolved || a.link !== b.link;
}

function packageProblems(root) {
  const recordPath = join(root, 'node_modules/.package-lock.json');
  if (!existsSync(recordPath)) return ['no install record (node_modules/.package-lock.json)'];
  const wanted = readJson(join(root, 'package-lock.json')).packages ?? {};
  const have = readJson(recordPath).packages ?? {};
  const problems = [];
  for (const [path, want] of Object.entries(wanted)) {
    if (path === '') continue;
    const got = have[path];
    if (!got) {
      if (!want.optional && !want.devOptional) problems.push(`${path}: not installed`);
    } else if (differs(want, got)) {
      problems.push(
        `${path}: installed ${describeEntry(got)}, lockfile has ${describeEntry(want)}`,
      );
    }
  }
  for (const path of Object.keys(have)) {
    if (!wanted[path]) problems.push(`${path}: installed but not in the lockfile`);
  }
  return problems;
}

function patchHashes(root) {
  const dir = join(root, 'patches');
  const out = {};
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    out[name] = createHash('sha256')
      .update(readFileSync(join(dir, name)))
      .digest('hex');
  }
  return out;
}

function recordPatches(root) {
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  writeFileSync(join(root, PATCH_RECORD), JSON.stringify(patchHashes(root), null, 2) + '\n');
}

function patchProblems(root) {
  const recordPath = join(root, PATCH_RECORD);
  if (!existsSync(recordPath)) return [`no patch record (${PATCH_RECORD})`];
  const recorded = readJson(recordPath);
  const current = patchHashes(root);
  const problems = [];
  for (const name of Object.keys(current)) {
    if (!(name in recorded)) problems.push(`patches/${name}: added since the install`);
    else if (recorded[name] !== current[name])
      problems.push(`patches/${name}: changed since the install`);
  }
  for (const name of Object.keys(recorded)) {
    if (!(name in current)) problems.push(`patches/${name}: removed since the install`);
  }
  return problems;
}

function checkInstall(root) {
  const all = [...packageProblems(root), ...patchProblems(root)];
  const problems =
    all.length > MAX_LINES
      ? [...all.slice(0, MAX_LINES), `... and ${all.length - MAX_LINES} more`]
      : all;
  return { fresh: all.length === 0, problems };
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = resolve(rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd());
  try {
    if (argv.includes('--record-patches')) {
      recordPatches(root);
      return 0;
    }
    const { fresh, problems } = checkInstall(root);
    if (fresh) return 0;
    console.log([...problems, STALE_MESSAGE].join('\n'));
    return 1;
  } catch (err) {
    console.error(`install-freshness: ${err.message}`);
    return 2;
  }
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { checkInstall, recordPatches };
