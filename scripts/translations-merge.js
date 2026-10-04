/**
 * Merge two snapshots of `locale/custom/` key by key — release prep's main ↔ weblate
 * sync.
 *
 *   npm run translations:merge -- --base <dir> --incoming <dir> [--en <en_US.json>] [--out <dir>]
 *
 * `--incoming` wins on conflict; a key only `--base` has is kept; keys not in en_US
 * are dropped; en_US itself is never written. `--out` defaults to `--base`.
 *
 * ## Why it exists
 *
 * Release prep used to run `git checkout origin/weblate -- locale/custom/`. That made
 * the weblate branch the sole owner of every non-English file, so anything added on
 * main — a seed from `translations:seed`, a fix — was silently reverted at the next
 * release, because nothing ever sent main's locale files to weblate. Release prep
 * now calls this twice (see `release-management.yml`):
 *
 * 1. into the release branch, with Weblate as `--incoming`: translators win, main's
 *    additions survive;
 * 2. into the weblate branch, with Weblate as `--incoming` again, so Weblate
 *    receives main's additions without any of its own work being overwritten.
 *
 * Deterministic and idempotent: merging the result again changes nothing.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const {
  mergeLocales,
  readLocaleDir,
  writeLocaleFile,
  SOURCE_LOCALE,
} = require('./lib/locale-files.cjs');

/**
 * @returns {{ changed: string[], kept: number, fromIncoming: number, dropped: number }}
 */
export function mergeDirs({ baseDir, incomingDir, enFile, outDir }) {
  const en = JSON.parse(
    readFileSync(enFile ?? path.join(baseDir, `${SOURCE_LOCALE}.json`), 'utf8'),
  );
  const base = readLocaleDir(baseDir);
  const incoming = readLocaleDir(incomingDir);
  const { merged, stats } = mergeLocales(base, incoming, Object.keys(en));
  const changed = [];
  for (const [locale, translations] of Object.entries(merged)) {
    if (writeLocaleFile(outDir ?? baseDir, locale, translations)) changed.push(locale);
  }
  const totals = { kept: 0, fromIncoming: 0, dropped: 0 };
  for (const s of Object.values(stats)) {
    totals.kept += s.fromBase;
    totals.fromIncoming += s.fromIncoming;
    totals.dropped += s.dropped;
  }
  return { changed, ...totals };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[++i];
    if (!value) throw new Error(`${flag} needs a value`);
    if (flag === '--base') args.baseDir = value;
    else if (flag === '--incoming') args.incomingDir = value;
    else if (flag === '--en') args.enFile = value;
    else if (flag === '--out') args.outDir = value;
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!args.baseDir || !args.incomingDir) throw new Error('--base and --incoming are required');
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = mergeDirs(parseArgs(process.argv.slice(2)));
    console.log(
      `translations:merge: ${result.changed.length} locale files changed; ` +
        `${result.fromIncoming} values taken from --incoming, ${result.kept} kept that only --base had, ` +
        `${result.dropped} orphaned keys dropped.`,
    );
  } catch (e) {
    console.error(`translations:merge FAILED — ${e.message}`);
    process.exit(1);
  }
}
