// scripts/lib/locale-files.cjs: read, write and merge `locale/custom/*.json`.
//
// Shared by the scripts that write non-English locale files:
// `scripts/translations-seed.js` (fills gaps from other Jellyfin clients) and
// `scripts/translations-merge.js` (release prep's main ↔ weblate merge). Both must
// write byte-for-byte what Weblate and `update-translations` write, or every run
// would churn the files: 2-space JSON, keys in code-unit order (`Array#sort()`),
// trailing newline.
//
// `.cjs` per scripts/CLAUDE.md, the default for scripts/lib/.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { git } = require('./git-safe.cjs');

const SOURCE_LOCALE = 'en_US';
const LOCALE_DIR = 'locale/custom';
/** The trailer each release's push-back commit on the weblate branch carries. */
const RELEASE_TRAILER = 'Translations-Release';

/** Locale code of a `locale/custom` file name, or null for anything else. */
function localeOfFile(fileName) {
  return fileName.endsWith('.json') ? fileName.slice(0, -'.json'.length) : null;
}

/** Every locale file in `dir`, as `{ locale: { key: value } }`, en_US included. */
function readLocaleDir(dir) {
  const locales = {};
  for (const fileName of fs.readdirSync(dir).sort()) {
    const locale = localeOfFile(fileName);
    if (!locale) continue;
    locales[locale] = JSON.parse(fs.readFileSync(path.join(dir, fileName), 'utf8'));
  }
  return locales;
}

/** The canonical on-disk form of one locale file. */
function serializeLocale(translations) {
  const sorted = {};
  for (const key of Object.keys(translations).sort()) sorted[key] = translations[key];
  return JSON.stringify(sorted, null, 2) + '\n';
}

/**
 * Write one locale file in canonical form. Returns whether the bytes changed, so a
 * caller can report a no-op run as one (release prep must be idempotent).
 */
function writeLocaleFile(dir, locale, translations) {
  const filePath = path.join(dir, `${locale}.json`);
  const next = serializeLocale(translations);
  const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  if (prev === next) return false;
  fs.writeFileSync(filePath, next, 'utf8');
  return true;
}

/**
 * The locales a runtime lookup layers UNDER `locale`, nearest last: the same chain
 * `loadLocaleFile()` / `loadChineseLocaleFile()` in `source/utils/translate.bs` build:
 * `fr_CA` sits on `fr`; `zh_Hant_HK` sits on `zh` then `zh_Hant`; a base locale (and
 * `x-pirate`, which has no underscore) sits on nothing.
 */
function baseChain(locale) {
  if (locale.startsWith('zh_')) {
    return locale.startsWith('zh_Hant_') ? ['zh', 'zh_Hant'] : ['zh'];
  }
  const underscore = locale.indexOf('_');
  return underscore > 0 ? [locale.slice(0, underscore)] : [];
}

/** The value a user of `locale` sees for `key` from the layers beneath it, if any. */
function inheritedValue(locales, locale, key) {
  let value;
  for (const base of baseChain(locale)) {
    const v = locales[base]?.[key];
    if (v !== undefined) value = v;
  }
  return value;
}

/**
 * Three-way merge of the non-English locale files, key by key, against the last
 * state both sides agreed on (`ancestor`). Per key, compared with the ancestor:
 *
 * - changed on one side only (a new value, a new key, or a deletion): that side;
 * - changed on both sides, differently: `theirs`. Release prep passes Weblate as
 *   `theirs`: translators are the authority on wording. Each one is listed in
 *   `conflicts` so the run can say what it overrode;
 * - a key not in `enKeys` is dropped, as Weblate's Cleanup add-on would;
 * - en_US is never touched (main owns it).
 *
 * The ancestor is what lets a deletion through. With only two snapshots, a key one
 * side lacks could be a deletion there or an addition on the other side, and the
 * old merge had to guess "addition", so a removed translation always came back and
 * a fix made on main lost to Weblate's older value.
 *
 * An empty `ancestor` makes every key an addition, which is the plain two-way
 * union with `theirs` winning: the safe fallback when no agreed state is known.
 *
 * @returns {{ merged: object, stats: object, conflicts: Array<{ locale, key, ours, theirs }> }}
 *   `stats[locale]` counts `fromOurs`, `fromTheirs`, `deleted` and `dropped`.
 */
function mergeLocales({ ours, theirs, ancestor = {}, enKeys }) {
  const keep = new Set(enKeys);
  const merged = {};
  const stats = {};
  const conflicts = [];
  const allLocales = new Set([...Object.keys(ours), ...Object.keys(theirs)]);
  allLocales.delete(SOURCE_LOCALE);
  for (const locale of [...allLocales].sort()) {
    const o = ours[locale] ?? {};
    const t = theirs[locale] ?? {};
    const a = ancestor[locale] ?? {};
    const out = {};
    const s = { fromOurs: 0, fromTheirs: 0, deleted: 0, dropped: 0 };
    for (const key of new Set([...Object.keys(o), ...Object.keys(t), ...Object.keys(a)])) {
      if (!keep.has(key)) {
        if (o[key] !== undefined || t[key] !== undefined) s.dropped++;
        continue;
      }
      let value;
      if (o[key] === t[key] || t[key] !== a[key]) {
        value = t[key];
        if (o[key] !== t[key]) {
          s.fromTheirs++;
          if (o[key] !== a[key]) conflicts.push({ locale, key, ours: o[key], theirs: t[key] });
        }
      } else {
        value = o[key];
        s.fromOurs++;
      }
      if (value === undefined) {
        if (a[key] !== undefined) s.deleted++;
      } else {
        out[key] = value;
      }
    }
    merged[locale] = out;
    stats[locale] = s;
  }
  return { merged, stats, conflicts };
}

/** Every locale file at git `ref`, as `{ locale: { key: value } }`, en_US included. */
function readLocaleTree(cwd, ref) {
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
 * Release prep merges against it; the key rename checks Weblate's work since it.
 *
 * @returns {{ sha: string, version: string } | null}
 */
function findAncestor(cwd, weblateRef, version) {
  const log = git(cwd, [
    'log',
    `--format=%H%x09%(trailers:key=${RELEASE_TRAILER},valueonly,separator=%x2C)`,
    weblateRef,
  ]);
  for (const line of log.split('\n')) {
    const [sha, released] = line.split('\t');
    if (!released) continue;
    if (released === version || tagExists(cwd, `v${released}`)) return { sha, version: released };
  }
  return null;
}

/**
 * The canonical on-disk form of the seed ledger (`locale/seed/seeded.json`): locale,
 * then key, both sorted. Shared by the seeder, which writes the ledger, and the key
 * rename in `update-translations.cjs`, which renames a key inside it.
 */
function serializeLedger(ledger) {
  const sorted = {};
  for (const locale of Object.keys(ledger).sort()) {
    sorted[locale] = {};
    for (const key of Object.keys(ledger[locale]).sort()) sorted[locale][key] = ledger[locale][key];
  }
  return JSON.stringify(sorted, null, 2) + '\n';
}

module.exports = {
  LOCALE_DIR,
  RELEASE_TRAILER,
  SOURCE_LOCALE,
  baseChain,
  findAncestor,
  inheritedValue,
  localeOfFile,
  mergeLocales,
  readLocaleDir,
  readLocaleTree,
  serializeLedger,
  serializeLocale,
  writeLocaleFile,
};
