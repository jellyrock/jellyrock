/**
 * Release prep's translation sync between a release branch and the `weblate` branch:
 * a three-way, key-by-key merge of `locale/custom/` in both directions.
 *
 *   npm run translations:merge -- release   --ours <ref> --theirs <ref> --version X.Y.Z
 *   npm run translations:merge -- push-back --ancestor <sha> --version X.Y.Z [--remote origin] [--branch weblate]
 *
 * `release` merges the weblate branch (`--theirs`) into the working tree's locale
 * files, against `--ours` (the release's locale files before the cherry-picks), and
 * reports the weblate commit it read as `weblate_sha` (a GitHub step output). It never
 * commits. `push-back` merges the committed release (HEAD) into the CURRENT weblate
 * branch against that same weblate commit, commits with a `Translations-Release:`
 * trailer, and pushes, retrying if the branch moved.
 *
 * ## Why three-way
 *
 * Release prep used to run `git checkout origin/weblate -- locale/custom/`, which
 * reverted every translation added on main. A two-way merge fixed additions but
 * could not tell "deleted here" from "added there": a removed translation always
 * came back, and a fix made on main lost to Weblate's older value. Comparing both
 * sides with the last state they agreed on settles each key (`mergeLocales()` in
 * `scripts/lib/locale-files.cjs`); Weblate still wins when both changed one.
 *
 * ## The ancestor
 *
 * Every push-back commit carries `Translations-Release: X.Y.Z`. The ancestor is the
 * newest such commit on the weblate branch whose release actually shipped (tag
 * `vX.Y.Z` exists) or is the release in progress. An abandoned release must not
 * count: its translations reached weblate but never main, so main would look like it
 * had deleted them all. Main's own release commit is no good either, because it also
 * holds main's changes made after the release branch was cut. With no such commit
 * (the first run, or a re-cut weblate branch) the merge falls back to the two-way
 * union, Weblate winning, and says so.
 *
 * Deterministic and idempotent: merging the result again changes nothing.
 */
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { mergeLocales, writeLocaleFile, SOURCE_LOCALE } = require('./lib/locale-files.cjs');
const { git } = require('./lib/git-safe.cjs');

export const LOCALE_DIR = 'locale/custom';
export const RELEASE_TRAILER = 'Translations-Release';

/** Every locale file at `ref` → `{ locale: { key: value } }`, en_US included. */
export function readLocaleTree(cwd, ref) {
  const locales = {};
  const names = git(cwd, ['ls-tree', '--name-only', `${ref}:${LOCALE_DIR}`])
    .split('\n')
    .filter((name) => name.endsWith('.json'));
  for (const name of names) {
    locales[name.slice(0, -'.json'.length)] = JSON.parse(
      git(cwd, ['show', `${ref}:${LOCALE_DIR}/${name}`]),
    );
  }
  return locales;
}

function tagExists(cwd, tag) {
  try {
    git(cwd, ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * The last state the weblate branch and main agreed on: the newest push-back commit
 * on `weblateRef` for a release that shipped, or for `version` itself. Null if none.
 *
 * @returns {{ sha: string, version: string } | null}
 */
export function findAncestor(cwd, weblateRef, version) {
  const log = git(cwd, [
    'log',
    '--format=%H%x09%(trailers:key=Translations-Release,valueonly,separator=%x2C)',
    weblateRef,
  ]);
  for (const line of log.split('\n')) {
    const [sha, released] = line.split('\t');
    if (!released) continue;
    if (released === version || tagExists(cwd, `v${released}`)) return { sha, version: released };
  }
  return null;
}

function readEnKeys(cwd, ref) {
  return Object.keys(JSON.parse(git(cwd, ['show', `${ref}:${LOCALE_DIR}/${SOURCE_LOCALE}.json`])));
}

function summarize(stats, conflicts) {
  const totals = {
    fromOurs: 0,
    fromTheirs: 0,
    deleted: 0,
    dropped: 0,
    conflicts: conflicts.length,
  };
  for (const s of Object.values(stats)) for (const k of Object.keys(s)) totals[k] += s[k];
  return totals;
}

/** Merge `merged` into `<dir>/locale/custom`; returns the locales whose bytes changed. */
function writeMerged(dir, merged) {
  const out = path.join(dir, LOCALE_DIR);
  return Object.entries(merged)
    .filter(([locale, translations]) => writeLocaleFile(out, locale, translations))
    .map(([locale]) => locale);
}

/**
 * Release leg: merge the weblate branch into the working tree's locale files.
 * en_US comes from HEAD (main owns it) and is never written.
 */
export function mergeRelease({ cwd, ours, theirs, version }) {
  const theirsSha = git(cwd, ['rev-parse', `${theirs}^{commit}`]).trim();
  const ancestor = findAncestor(cwd, theirsSha, version);
  const result = mergeLocales({
    ours: readLocaleTree(cwd, ours),
    theirs: readLocaleTree(cwd, theirsSha),
    ancestor: ancestor ? readLocaleTree(cwd, ancestor.sha) : {},
    enKeys: readEnKeys(cwd, 'HEAD'),
  });
  return {
    theirsSha,
    ancestor,
    changed: writeMerged(cwd, result.merged),
    conflicts: result.conflicts,
    totals: summarize(result.stats, result.conflicts),
  };
}

/**
 * Push-back leg: send the committed release's translations to the weblate branch,
 * merged into its CURRENT state against `ancestor` (the weblate commit the release
 * leg read), so anything Weblate changed since still wins. en_US.json and
 * languages.json travel as-is, as jellyrock-bot.yml does. Always commits, even with
 * no change: the commit is the ancestor marker for the next run.
 */
export function pushBack({
  cwd,
  ancestor,
  version,
  remote = 'origin',
  branch = 'weblate',
  attempts = 3,
  beforePush = () => {}, // test seam: lets a test move the branch mid-merge
}) {
  const remoteRef = `refs/remotes/${remote}/${branch}`;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    git(cwd, ['fetch', '--quiet', remote, `+refs/heads/${branch}:${remoteRef}`]);
    const theirsSha = git(cwd, ['rev-parse', remoteRef]).trim();
    const work = mkdtempSync(path.join(tmpdir(), 'jellyrock-weblate-'));
    try {
      git(cwd, ['worktree', 'add', '--quiet', '--detach', work, theirsSha]);
      const result = mergeLocales({
        ours: readLocaleTree(cwd, 'HEAD'),
        theirs: readLocaleTree(cwd, theirsSha),
        ancestor: readLocaleTree(cwd, ancestor),
        enKeys: readEnKeys(cwd, 'HEAD'),
      });
      const changed = writeMerged(work, result.merged);
      for (const rel of [`${LOCALE_DIR}/${SOURCE_LOCALE}.json`, 'locale/languages.json'])
        writeFileSync(path.join(work, rel), git(cwd, ['show', `HEAD:${rel}`]));
      git(work, ['add', 'locale/']);
      git(work, [
        'commit',
        '--quiet',
        '--allow-empty',
        '-m',
        `chore: sync translations from release v${version}`,
        '-m',
        `${RELEASE_TRAILER}: ${version}`,
      ]);
      beforePush(attempt);
      try {
        git(work, ['push', '--quiet', remote, `HEAD:refs/heads/${branch}`]);
        return {
          attempt,
          changed,
          conflicts: result.conflicts,
          totals: summarize(result.stats, result.conflicts),
        };
      } catch (e) {
        if (attempt === attempts) throw e;
        console.log(`${branch} moved during the merge; retrying (${attempt}/${attempts})`);
      }
    } finally {
      // Never let cleanup mask the real error (a failed `worktree add` has nothing to remove).
      try {
        git(cwd, ['worktree', 'remove', '--force', work]);
      } catch {
        git(cwd, ['worktree', 'prune']);
      }
      rmSync(work, { recursive: true, force: true });
    }
  }
  throw new Error('unreachable');
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  const flags = {
    '--ours': 'ours',
    '--theirs': 'theirs',
    '--version': 'version',
    '--ancestor': 'ancestor',
    '--remote': 'remote',
    '--branch': 'branch',
  };
  for (let i = 0; i < rest.length; i++) {
    const name = flags[rest[i]];
    if (!name) throw new Error(`unknown argument ${rest[i]}`);
    const value = rest[++i];
    if (value === undefined || value.startsWith('--'))
      throw new Error(`${rest[i - 1]} needs a value`);
    args[name] = value;
  }
  const required = { release: ['ours', 'theirs', 'version'], 'push-back': ['ancestor', 'version'] };
  if (!required[command])
    throw new Error(`unknown command ${command ?? '(none)'} — expected release or push-back`);
  for (const name of required[command])
    if (!args[name]) throw new Error(`${command} needs --${name}`);
  return args;
}

function report(label, { changed, conflicts, totals }) {
  console.log(
    `translations:merge ${label}: ${changed.length} locale files changed; ` +
      `${totals.fromTheirs} values from weblate, ${totals.fromOurs} from the release, ` +
      `${totals.deleted} deletions, ${totals.dropped} orphaned keys dropped, ` +
      `${totals.conflicts} changed on both sides (weblate kept).`,
  );
  for (const c of conflicts.slice(0, 50))
    console.log(
      `  both changed ${c.locale}.${c.key}: release ${JSON.stringify(c.ours)}, weblate ${JSON.stringify(c.theirs)}`,
    );
  if (conflicts.length > 50) console.log(`  … ${conflicts.length - 50} more`);
}

function main(argv) {
  const args = parseArgs(argv);
  const cwd = process.cwd();
  if (args.command === 'release') {
    const result = mergeRelease({ cwd, ...args });
    if (!result.ancestor)
      console.log(
        `::warning::No ${RELEASE_TRAILER} commit for a shipped release on ${args.theirs}; merged two-way (weblate wins, nothing deleted). Deletions sync from the next release on.`,
      );
    else console.log(`Ancestor: ${result.ancestor.sha} (v${result.ancestor.version})`);
    report('release', result);
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `weblate_sha=${result.theirsSha}\n`);
  } else {
    report('push-back', pushBack({ cwd, ...args }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`translations:merge FAILED — ${e.message}`);
    process.exit(1);
  }
}
