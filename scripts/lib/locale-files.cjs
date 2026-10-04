// scripts/lib/locale-files.cjs — read, write and merge `locale/custom/*.json`.
//
// Shared by the two scripts that write non-English locale files:
// `scripts/translations-seed.js` (fills gaps from other Jellyfin clients) and
// `scripts/translations-merge.js` (release prep's main ↔ weblate merge). Both must
// write byte-for-byte what Weblate and `update-translations` write, or every run
// would churn the files: 2-space JSON, keys in code-unit order (`Array#sort()`),
// trailing newline.
//
// `.cjs` per scripts/CLAUDE.md: everything in scripts/lib/ is.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_LOCALE = 'en_US';

/** Locale code of a `locale/custom` file name, or null for anything else. */
function localeOfFile(fileName) {
  return fileName.endsWith('.json') ? fileName.slice(0, -'.json'.length) : null;
}

/** Every locale file in `dir` → `{ locale: { key: value } }`, en_US included. */
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
 * The locales a runtime lookup layers UNDER `locale`, nearest last — the same chain
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
 * Merge two snapshots of the non-English locale files, key by key.
 *
 * - `incoming` wins on conflict. Release prep passes Weblate as `incoming`:
 *   translators are the authority on wording.
 * - A key only `base` has is kept. This is the property the old
 *   `git checkout origin/weblate -- locale/custom/` lacked: it threw away every
 *   translation added on main (a seed, a fix) at each release.
 * - A key that is not in `enKeys` is dropped, as Weblate's Cleanup add-on would.
 * - A locale either side has is kept; en_US is never touched (main owns it).
 *
 * @returns {{ merged: object, stats: { locale: { fromBase, fromIncoming, dropped } } }}
 */
function mergeLocales(base, incoming, enKeys) {
  const keep = new Set(enKeys);
  const merged = {};
  const stats = {};
  const allLocales = new Set([...Object.keys(base), ...Object.keys(incoming)]);
  allLocales.delete(SOURCE_LOCALE);
  for (const locale of [...allLocales].sort()) {
    const b = base[locale] ?? {};
    const i = incoming[locale] ?? {};
    const out = {};
    const s = { fromBase: 0, fromIncoming: 0, dropped: 0 };
    for (const key of new Set([...Object.keys(b), ...Object.keys(i)])) {
      if (!keep.has(key)) {
        s.dropped++;
        continue;
      }
      if (i[key] !== undefined) {
        out[key] = i[key];
        if (b[key] !== i[key]) s.fromIncoming++;
      } else {
        out[key] = b[key];
        s.fromBase++;
      }
    }
    merged[locale] = out;
    stats[locale] = s;
  }
  return { merged, stats };
}

module.exports = {
  SOURCE_LOCALE,
  baseChain,
  inheritedValue,
  localeOfFile,
  mergeLocales,
  readLocaleDir,
  serializeLocale,
  writeLocaleFile,
};
