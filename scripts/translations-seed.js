/**
 * Fill missing JellyRock translations from other open-source Jellyfin clients.
 *
 *   npm run translations:seed                          dry run: what would be filled, and why not
 *   npm run translations:seed -- --write               apply it to locale/custom/
 *   npm run translations:seed -- suggest [--key K…]    candidate source keys for unmapped keys
 *
 * ## Why a reviewed map, not English-text matching
 *
 * Many JellyRock strings already exist, translated by those projects' communities, in
 * jellyfin-web, jellyfin-androidtv and others. Matching on English text alone gets
 * them wrong in two ways. *Meaning*: web's "Idle" is `PriorityIdle`, a process
 * priority, not an idle transcode. *Shape*: androidtv's `Codec: %1$s` is not the bare
 * label "Codec". So `locale/seed/keymap.yml` maps each JellyRock key to a source key
 * someone has reviewed, and records the English both sides had at review time: when
 * either changes, the entry stops seeding and says it needs another look. `suggest`
 * does the mechanical half of a review (finding candidates); the judgment is the
 * reviewer's.
 *
 * ## What it will never do
 *
 * - **Overwrite.** It only adds a key a locale does not have.
 * - **Use a source whose license is not on the allowlist** (`LICENSE_ALLOWLIST`), or
 *   whose LICENSE file at the pinned commit does not match the declared license, or —
 *   for MPL-2.0 — a file marked "Incompatible With Secondary Licenses". JellyRock is
 *   GPL-2.0-only; MPL-2.0 §1.12 names GPL-2.0 a Secondary License.
 * - **Change a placeholder set**, add markup or a line break en_US does not have, or
 *   write a value that is just the English (case-folded): it renders identically, and
 *   would shadow a later fix to en_US.
 * - **Copy a base value into a regional locale.** Runtime layering already shows `fr`
 *   to `fr_CA` users; a copy would hide later Weblate fixes to `fr`.
 * - **Re-case a translation.** Title Case is an English convention, and naive case
 *   tests misread unicameral scripts. A translation starting lowercase where en_US is
 *   capitalized, in a cased script, is flagged in the report for a reviewer instead.
 *
 * - **Refill a cell it filled before** (`locale/seed/seeded.json`, the ledger). Every
 *   fill is recorded there with its source and commit, and a recorded cell is never
 *   written again. So removing a seeded translation, on main or in Weblate, is
 *   permanent, and the ledger answers where any seeded value came from (the seed
 *   commit's `Translation-Source:` lines do not survive a squash merge).
 *
 * Sources are pinned to a commit and fetched into `.cache/translation-seed/`, so a run
 * is deterministic: the output depends only on the repo and the pinned commits.
 * Release prep runs `--write` after merging Weblate (see `release-management.yml`),
 * so Weblate's own translations always come first.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const fg = require('fast-glob');
const yaml = require('js-yaml');
const { git: gitIn } = require('./lib/git-safe.cjs');
const {
  baseChain,
  readLocaleDir,
  writeLocaleFile,
  SOURCE_LOCALE,
} = require('./lib/locale-files.cjs');
const {
  PARSERS,
  PlaceholderError,
  placeholderSignature,
  toIndexedPlaceholders,
} = require('./lib/translation-formats.cjs');

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SOURCES_REL = path.join('locale', 'seed', 'sources.yml');
export const KEYMAP_REL = path.join('locale', 'seed', 'keymap.yml');
export const CACHE_REL = path.join('.cache', 'translation-seed');
export const LEDGER_REL = path.join('locale', 'seed', 'seeded.json');

/**
 * Licenses whose text may be copied into GPL-2.0-only JellyRock, each with phrases
 * its LICENSE file must contain. GPL-3.0 is deliberately absent: it is incompatible
 * with GPL-2.0-only.
 */
export const LICENSE_ALLOWLIST = Object.freeze({
  'GPL-2.0-only': ['GNU GENERAL PUBLIC LICENSE', 'Version 2, June 1991'],
  'GPL-2.0-or-later': ['GNU GENERAL PUBLIC LICENSE', 'Version 2, June 1991'],
  'MPL-2.0': ['Mozilla Public License Version 2.0'],
});

const MPL_INCOMPATIBLE = /Incompatible With Secondary Licenses/i;

const PLACEHOLDER_STYLES = new Set(['brace-index', 'printf', 'qt', 'i18next']);

export class SeedConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeedConfigError';
  }
}

// ── Config ───────────────────────────────────────────────────────────────────

/** js-yaml 5 throws on a document with only comments; treat that as empty. */
function loadYaml(text) {
  return text.split('\n').some((line) => line.trim() && !line.trim().startsWith('#'))
    ? yaml.load(text)
    : null;
}

function assertKeys(object, allowed, where) {
  for (const key of Object.keys(object ?? {})) {
    if (!allowed.includes(key)) throw new SeedConfigError(`${where}: unknown field "${key}"`);
  }
}

/** Parse and validate `sources.yml`. Order is priority. */
export function parseSources(text) {
  const doc = loadYaml(text);
  if (!doc || !Array.isArray(doc.sources))
    throw new SeedConfigError('sources.yml: expected a top-level `sources:` list');
  const seen = new Set();
  return doc.sources.map((s, i) => {
    const where = `sources.yml entry ${i + 1}${s?.id ? ` (${s.id})` : ''}`;
    assertKeys(
      s,
      [
        'id',
        'repo',
        'ref',
        'commit',
        'license',
        'licenseFile',
        'format',
        'placeholders',
        'english',
        'translations',
        'localeMap',
        'skipLocales',
      ],
      where,
    );
    for (const field of [
      'id',
      'repo',
      'ref',
      'commit',
      'license',
      'licenseFile',
      'format',
      'placeholders',
      'english',
      'translations',
    ]) {
      if (typeof s[field] !== 'string' || !s[field])
        throw new SeedConfigError(`${where}: "${field}" is required`);
    }
    if (seen.has(s.id)) throw new SeedConfigError(`${where}: duplicate id`);
    seen.add(s.id);
    if (!(s.license in LICENSE_ALLOWLIST)) {
      throw new SeedConfigError(
        `${where}: license ${s.license} is not on the allowlist (${Object.keys(LICENSE_ALLOWLIST).join(', ')})`,
      );
    }
    if (!/^[0-9a-f]{40}$/.test(s.commit))
      throw new SeedConfigError(`${where}: "commit" must be a full 40-character SHA`);
    if (!(s.format in PARSERS)) throw new SeedConfigError(`${where}: unknown format ${s.format}`);
    if (!PLACEHOLDER_STYLES.has(s.placeholders))
      throw new SeedConfigError(`${where}: unknown placeholder style ${s.placeholders}`);
    if (!s.translations.includes('{locale}'))
      throw new SeedConfigError(`${where}: "translations" must contain {locale}`);
    return { localeMap: {}, skipLocales: [], ...s };
  });
}

/** Parse and validate `keymap.yml` against the configured source ids. */
export function parseKeymap(text, sourceIds) {
  const doc = loadYaml(text) ?? {};
  const ids = new Set(sourceIds);
  for (const [jrKey, entry] of Object.entries(doc)) {
    const where = `keymap.yml ${jrKey}`;
    assertKeys(entry, ['en', 'from', 'reject'], where);
    if (typeof entry.en !== 'string')
      throw new SeedConfigError(
        `${where}: "en" (the en_US text it was reviewed against) is required`,
      );
    for (const [sourceId, m] of Object.entries(entry.from ?? {})) {
      if (!ids.has(sourceId)) throw new SeedConfigError(`${where}: unknown source "${sourceId}"`);
      assertKeys(m, ['key', 'en', 'placeholders', 'exclude'], `${where} → ${sourceId}`);
      if (typeof m.key !== 'string' || typeof m.en !== 'string') {
        throw new SeedConfigError(`${where} → ${sourceId}: "key" and "en" are required`);
      }
    }
    for (const r of entry.reject ?? []) {
      assertKeys(r, ['source', 'key', 'reason'], `${where} reject`);
      if (!ids.has(r.source))
        throw new SeedConfigError(`${where} reject: unknown source "${r.source}"`);
      if (!r.key || !r.reason)
        throw new SeedConfigError(`${where} reject: "key" and "reason" are required`);
    }
  }
  return doc;
}

// ── Locale codes ─────────────────────────────────────────────────────────────

const LEGACY_ANDROID = { in: 'id', iw: 'he', ji: 'yi' };
const CHINESE = {
  zh_CN: 'zh_Hans',
  zh_SG: 'zh_Hans',
  zh_TW: 'zh_Hant',
  zh_HK: 'zh_Hant_HK',
  zh_MO: 'zh_Hant_HK',
};

/** A source's own locale code → JellyRock's spelling (`pt-br` → `pt_BR`), unchecked. */
export function normalizeLocaleCode(raw, format) {
  let code = raw;
  if (format === 'android-xml') {
    code = code.startsWith('b+')
      ? code.slice(2).replace(/\+/g, '_')
      : code.replace(/-r([A-Za-z]{2})$/, '_$1');
  }
  const parts = code.replace(/-/g, '_').split('_');
  parts[0] = parts[0].toLowerCase();
  if (format === 'android-xml' && LEGACY_ANDROID[parts[0]]) parts[0] = LEGACY_ANDROID[parts[0]];
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    parts[i] =
      p.length === 4
        ? p[0].toUpperCase() + p.slice(1).toLowerCase()
        : p.length === 2
          ? p.toUpperCase()
          : p;
  }
  const joined = parts.join('_');
  return CHINESE[joined] ?? joined;
}

/**
 * Map each source locale code to a JellyRock locale file, or to null (unmapped).
 *
 * An explicit `localeMap` entry wins. Otherwise the normalized code must name a
 * JellyRock locale — or, when JellyRock has only the base (`de` for `de-DE`) AND the
 * source has no file of its own for that base, the base. That second condition keeps
 * web's `ar_SA.json` from landing on `ar` next to web's own `ar.json`. Two source
 * files landing on one locale is a config error, never a silent pick.
 */
export function mapLocales(rawCodes, source, jrLocales) {
  const jr = new Set(jrLocales);
  const normalized = new Map(rawCodes.map((raw) => [raw, normalizeLocaleCode(raw, source.format)]));
  const sourceHas = new Set(normalized.values());
  const result = {};
  const claimed = new Map();
  for (const raw of rawCodes) {
    if (source.skipLocales.includes(raw)) {
      result[raw] = null;
      continue;
    }
    let target = source.localeMap[raw];
    if (target === undefined) {
      const code = normalized.get(raw);
      const base = code.split('_')[0];
      if (jr.has(code)) target = code;
      else if (code !== base && jr.has(base) && !sourceHas.has(base)) target = base;
      else target = null;
    }
    if (target === SOURCE_LOCALE) target = null;
    if (target !== null && !jr.has(target)) {
      throw new SeedConfigError(
        `${source.id}: localeMap sends ${raw} to ${target}, which is not a JellyRock locale`,
      );
    }
    if (target !== null && claimed.has(target)) {
      throw new SeedConfigError(
        `${source.id}: ${claimed.get(target)} and ${raw} both map to ${target}; resolve it with localeMap or skipLocales`,
      );
    }
    if (target !== null) claimed.set(target, raw);
    result[raw] = target;
  }
  return result;
}

// ── Fetching ─────────────────────────────────────────────────────────────────

/** git, with the hook-time variables that would redirect it removed (scripts/lib/git-safe.cjs). */
const git = (args) => gitIn(undefined, args);

/** The sparse paths a source needs: its translations, its English, its LICENSE. */
function sparsePatterns(source) {
  return [
    `/${source.translations.replace('{locale}', '*')}`,
    `/${source.english}`,
    `/${source.licenseFile}`,
  ];
}

/**
 * Check out a source's pinned commit (sparse, depth 1) into the cache and verify it.
 * Refuses when the tag no longer points at the pinned commit — a moved tag is a
 * different input, and the map was reviewed against the old one.
 */
export function fetchSource(source, cacheDir) {
  const dir = path.join(cacheDir, `${source.id}-${source.commit.slice(0, 12)}`);
  const marker = path.join(dir, '.seed-complete');
  if (!existsSync(marker)) {
    const remote = git([
      'ls-remote',
      source.repo,
      `refs/tags/${source.ref}`,
      `refs/tags/${source.ref}^{}`,
      `refs/heads/${source.ref}`,
    ]);
    const shas = remote
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t')[0]);
    if (!shas.includes(source.commit)) {
      throw new SeedConfigError(
        `${source.id}: ${source.ref} does not point at the pinned commit ${source.commit} ` +
          `(remote has ${shas.join(', ') || 'nothing'}). Re-pin it in ${SOURCES_REL} and re-review.`,
      );
    }
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    git(['init', '-q', dir]);
    git(['-C', dir, 'remote', 'add', 'origin', source.repo]);
    git(['-C', dir, 'sparse-checkout', 'set', '--no-cone', ...sparsePatterns(source)]);
    git(['-C', dir, 'fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', source.commit]);
    git(['-C', dir, 'checkout', '-q', 'FETCH_HEAD']);
    writeFileSync(marker, `${source.commit}\n`);
  }
  return dir;
}

/** Throw unless the LICENSE file says what the config claims. */
export function verifyLicense(source, dir) {
  const file = path.join(dir, source.licenseFile);
  if (!existsSync(file))
    throw new SeedConfigError(`${source.id}: no ${source.licenseFile} at ${source.commit}`);
  const text = readFileSync(file, 'utf8');
  const missing = LICENSE_ALLOWLIST[source.license].filter((phrase) => !text.includes(phrase));
  if (missing.length) {
    throw new SeedConfigError(
      `${source.id}: ${source.licenseFile} does not read as ${source.license} (missing "${missing.join('", "')}"). ` +
        'Upstream may have relicensed — check before re-pinning.',
    );
  }
}

// ── Loading a checked-out source ─────────────────────────────────────────────

/**
 * Parse a checked-out source into `{ english, translations: { jrLocale: map },
 * unmapped, skippedFiles }`. `english` maps source key → English; for Qt `.ts`, where
 * the English IS the key, every key maps to itself.
 */
export function loadSource(source, dir, jrLocales) {
  const parse = PARSERS[source.format];
  const read = (rel) => readFileSync(path.join(dir, rel));
  const english =
    source.format === 'qt-ts'
      ? Object.fromEntries(Object.keys(parse(read(source.english))).map((k) => [k, k]))
      : parse(read(source.english));

  const [before, after] = source.translations.split('{locale}');
  const files = fg
    .sync(source.translations.replace('{locale}', '*'), { cwd: dir, onlyFiles: true })
    .sort();
  const byRaw = {};
  for (const rel of files) {
    if (rel === source.english) continue;
    byRaw[rel.slice(before.length, rel.length - after.length)] = rel;
  }
  const mapping = mapLocales(Object.keys(byRaw), source, jrLocales);
  const translations = {};
  const unmapped = [];
  const skippedFiles = [];
  for (const [raw, rel] of Object.entries(byRaw)) {
    const target = mapping[raw];
    if (target === null) {
      if (
        !source.skipLocales.includes(raw) &&
        normalizeLocaleCode(raw, source.format) !== SOURCE_LOCALE
      )
        unmapped.push(raw);
      continue;
    }
    const bytes = read(rel);
    if (source.license === 'MPL-2.0' && MPL_INCOMPATIBLE.test(bytes.toString('latin1'))) {
      skippedFiles.push({ file: rel, reason: 'MPL "Incompatible With Secondary Licenses"' });
      continue;
    }
    translations[target] = parse(bytes);
  }
  return { english, translations, unmapped: unmapped.sort(), skippedFiles };
}

// ── Planning ─────────────────────────────────────────────────────────────────

const CASED_SCRIPT = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}]/u;

/** First letter after any leading placeholders, digits, spaces or punctuation. */
function firstLetter(value) {
  const m = /\p{L}/u.exec(value.replace(/\{\d+\}/g, ''));
  return m ? m[0] : null;
}

function isAllCaps(text) {
  const letters = text.replace(/\{\d+\}|%\d*\$?[a-z@]/gi, '').match(/\p{L}/gu) ?? [];
  return letters.length > 1 && text === text.toUpperCase() && text !== text.toLowerCase();
}

const foldCase = (s) => s.normalize('NFC').toLocaleLowerCase('und').trim();

/**
 * Why `value` cannot fill `jrKey`, or null when it can. Order matters only for the
 * report: the first failing check names the reason.
 */
export function rejectReason({ value, enValue, sourceEnglish }) {
  if (!value.trim()) return 'empty';
  if (placeholderSignature(value) !== placeholderSignature(enValue)) return 'placeholder-mismatch';
  if (/<[a-zA-Z/][^>]*>/.test(value) && !/<[a-zA-Z/][^>]*>/.test(enValue)) return 'markup';
  if (/\n/.test(value) && !/\n/.test(enValue)) return 'newline';
  if (foldCase(value) === foldCase(enValue) || foldCase(value) === foldCase(sourceEnglish))
    return 'same-as-english';
  return null;
}

/**
 * Decide every fill. Pure: takes parsed data, returns what `--write` would do and
 * everything the report says.
 *
 * @param {object} args
 * @param {object} args.locales - `{ locale: { key: value } }`, en_US included
 * @param {Array} args.sources - priority order: `{ ...config, loaded: { english, translations } }`
 * @param {object} args.keymap
 * @param {object} [args.ledger] - `{ locale: { key: 'source@commit' } }`: cells seeded before
 */
export function planSeed({ locales, sources, keymap, ledger = {} }) {
  const enUs = locales[SOURCE_LOCALE];
  // Bases before regional variants, so the same-as-base check sees planned fills.
  const targets = Object.keys(locales)
    .filter((l) => l !== SOURCE_LOCALE)
    .sort((a, b) => a.split('_').length - b.split('_').length || (a < b ? -1 : a > b ? 1 : 0));
  const fills = {}; // locale -> key -> { value, source }
  const rejections = []; // { key, locale, source, reason }
  const stale = []; // { key, source?, reason, detail }
  const flagged = []; // { key, locale, source, value }

  // What a user of `locale` would already see for `key` from its base layers,
  // counting fills planned earlier in this run.
  const inherited = (locale, key) => {
    let value;
    for (const base of baseChain(locale)) {
      const v = fills[base]?.[key]?.value ?? locales[base]?.[key];
      if (v !== undefined) value = v;
    }
    return value;
  };

  for (const jrKey of Object.keys(keymap).sort()) {
    const entry = keymap[jrKey];
    if (!(jrKey in enUs)) {
      stale.push({ key: jrKey, reason: 'unknown-key', detail: 'not in en_US.json' });
      continue;
    }
    if (entry.en !== enUs[jrKey]) {
      stale.push({
        key: jrKey,
        reason: 'en-us-changed',
        detail: `reviewed ${JSON.stringify(entry.en)}, now ${JSON.stringify(enUs[jrKey])}`,
      });
      continue;
    }
    const usable = [];
    for (const source of sources) {
      const m = entry.from?.[source.id];
      if (!m) continue;
      const actual = source.loaded.english[m.key];
      if (actual === undefined) {
        stale.push({
          key: jrKey,
          source: source.id,
          reason: 'source-key-missing',
          detail: `${m.key} not in ${source.id}@${source.ref}`,
        });
      } else if (actual !== m.en) {
        stale.push({
          key: jrKey,
          source: source.id,
          reason: 'source-changed',
          detail: `reviewed ${JSON.stringify(m.en)}, now ${JSON.stringify(actual)}`,
        });
      } else if (isAllCaps(m.en) && !isAllCaps(enUs[jrKey])) {
        stale.push({
          key: jrKey,
          source: source.id,
          reason: 'source-all-caps',
          detail: `${m.key} = ${JSON.stringify(m.en)} is styled, not a label`,
        });
      } else {
        usable.push({ source, m });
      }
    }
    if (!usable.length) continue;

    for (const locale of targets) {
      if (locales[locale][jrKey] !== undefined) continue;
      if (ledger[locale]?.[jrKey] !== undefined) {
        rejections.push({
          key: jrKey,
          locale,
          source: ledger[locale][jrKey],
          reason: 'seeded-before',
        });
        continue;
      }
      for (const { source, m } of usable) {
        if (m.exclude && locale in m.exclude) continue;
        const raw = source.loaded.translations[locale]?.[m.key];
        if (raw === undefined) continue;
        let value;
        try {
          value = toIndexedPlaceholders(raw, source.placeholders, m.placeholders);
        } catch (e) {
          if (!(e instanceof PlaceholderError)) throw e;
          rejections.push({
            key: jrKey,
            locale,
            source: source.id,
            reason: 'placeholder-unmapped',
          });
          continue;
        }
        if (enUs[jrKey] === enUs[jrKey].trim()) value = value.trim();
        const reason = rejectReason({
          value,
          enValue: enUs[jrKey],
          sourceEnglish: toIndexedPlaceholders(m.en, source.placeholders, m.placeholders),
        });
        if (reason) {
          rejections.push({ key: jrKey, locale, source: source.id, reason });
          continue;
        }
        if (inherited(locale, jrKey) === value) {
          rejections.push({ key: jrKey, locale, source: source.id, reason: 'same-as-base-locale' });
          break;
        }
        (fills[locale] ??= {})[jrKey] = { value, source: source.id };
        const enFirst = firstLetter(enUs[jrKey]);
        const first = firstLetter(value);
        if (
          enFirst &&
          enFirst !== enFirst.toLowerCase() &&
          first &&
          CASED_SCRIPT.test(first) &&
          first === first.toLowerCase() &&
          first !== first.toUpperCase()
        ) {
          flagged.push({ key: jrKey, locale, source: source.id, value });
        }
        break;
      }
    }
  }
  return { fills, rejections, stale, flagged };
}

// ── Reporting ────────────────────────────────────────────────────────────────

export function summarize(plan, locales) {
  const bySource = {};
  const byKey = {};
  const byLocale = {};
  let total = 0;
  for (const [locale, keys] of Object.entries(plan.fills)) {
    for (const [key, { source }] of Object.entries(keys)) {
      total++;
      bySource[source] = (bySource[source] ?? 0) + 1;
      (byKey[key] ??= {})[source] = (byKey[key][source] ?? 0) + 1;
      byLocale[locale] = (byLocale[locale] ?? 0) + 1;
    }
  }
  const nonEnglish = Object.keys(locales).filter((l) => l !== SOURCE_LOCALE);
  const coverage = (key) => nonEnglish.filter((l) => locales[l][key] !== undefined).length;
  return { total, bySource, byKey, byLocale, nonEnglishCount: nonEnglish.length, coverage };
}

function count(list, field) {
  const out = {};
  for (const item of list) out[item[field]] = (out[item[field]] ?? 0) + 1;
  return out;
}

export function formatReport({ plan, locales, sources, verbose }) {
  const s = summarize(plan, locales);
  const lines = [];
  lines.push('Sources (priority order):');
  for (const src of sources) {
    const extra = src.loaded.unmapped.length
      ? `  unmapped locales: ${src.loaded.unmapped.join(', ')}`
      : '';
    lines.push(
      `  ${src.id.padEnd(20)} ${src.ref} ${src.commit.slice(0, 7)} ${src.license.padEnd(17)} ${String(Object.keys(src.loaded.translations).length).padStart(3)} locales${extra}`,
    );
    for (const f of src.loaded.skippedFiles) lines.push(`    skipped ${f.file}: ${f.reason}`);
  }
  lines.push(
    '',
    `Would fill ${s.total} translations across ${Object.keys(s.byLocale).length} locales and ${Object.keys(s.byKey).length} keys.`,
  );
  for (const [source, n] of Object.entries(s.bySource).sort((a, b) => b[1] - a[1]))
    lines.push(`  ${source.padEnd(20)} ${n}`);

  lines.push('', 'Per key (locales with a translation, before → after):');
  for (const key of Object.keys(s.byKey).sort()) {
    const before = s.coverage(key);
    const added = Object.values(s.byKey[key]).reduce((a, b) => a + b, 0);
    const from = Object.entries(s.byKey[key])
      .map(([src, n]) => `${src} ${n}`)
      .join(', ');
    lines.push(
      `  ${key.padEnd(44)} ${String(before).padStart(3)} → ${String(before + added).padStart(3)} / ${s.nonEnglishCount}  (${from})`,
    );
  }

  lines.push('', 'Per locale (keys added):');
  const perLocale = Object.entries(s.byLocale)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([l, n]) => `${l} +${n}`);
  for (let i = 0; i < perLocale.length; i += 8)
    lines.push(`  ${perLocale.slice(i, i + 8).join('  ')}`);

  if (plan.stale.length) {
    lines.push(
      '',
      `Needs re-review (${plan.stale.length}) — these entries seed nothing until updated in ${KEYMAP_REL}:`,
    );
    for (const e of plan.stale)
      lines.push(`  ${e.key}${e.source ? ` ← ${e.source}` : ''}: ${e.reason} — ${e.detail}`);
  }
  if (plan.flagged.length) {
    lines.push(
      '',
      `Casing to review (${plan.flagged.length}) — written, but lowercase-first where en_US is capitalized. Exclude a cell with \`exclude: { <locale>: <reason> }\`:`,
    );
    for (const f of plan.flagged)
      lines.push(`  ${f.key} ${f.locale} ← ${f.source}: ${JSON.stringify(f.value)}`);
  }
  if (plan.rejections.length) {
    lines.push('', `Not written (${plan.rejections.length}), by reason:`);
    for (const [reason, n] of Object.entries(count(plan.rejections, 'reason')).sort(
      (a, b) => b[1] - a[1],
    ))
      lines.push(`  ${reason.padEnd(22)} ${n}`);
    const shown = verbose
      ? plan.rejections
      : plan.rejections.filter(
          (r) => !['same-as-english', 'same-as-base-locale', 'seeded-before'].includes(r.reason),
        );
    for (const r of shown.slice(0, verbose ? Infinity : 40))
      lines.push(`    ${r.key} ${r.locale} ← ${r.source}: ${r.reason}`);
    if (!verbose && shown.length > 40) lines.push(`    … ${shown.length - 40} more (--verbose)`);
  }
  return lines.join('\n');
}

/** Commit-message body: what was seeded, from which pinned commits. */
export function formatCommitBody({ plan, locales, sources }) {
  const s = summarize(plan, locales);
  const used = sources.filter((src) => s.bySource[src.id]);
  const lines = [
    `Fill ${s.total} missing translations in ${Object.keys(s.byLocale).length} locales for ${Object.keys(s.byKey).length} keys,`,
    `from the reviewed map in ${KEYMAP_REL.split(path.sep).join('/')}. Fill-only: no existing translation changed.`,
    '',
    ...used.map((src) => `  ${src.id.padEnd(20)} ${s.bySource[src.id]}`),
    '',
    ...used.map((src) => `Translation-Source: ${src.id} ${src.ref} ${src.commit} ${src.license}`),
  ];
  return lines.join('\n') + '\n';
}

/** The ledger id of a fill: source and pinned commit, enough to find the exact file. */
const ledgerEntry = (source) => `${source.id}@${source.commit.slice(0, 12)}`;

/**
 * The ledger after this plan: every fill added, and entries for keys en_US no longer
 * has (or locales that no longer exist) pruned, since nothing can refill those.
 */
export function nextLedger({ ledger, plan, sources, locales }) {
  const byId = Object.fromEntries(sources.map((src) => [src.id, src]));
  const enUs = locales[SOURCE_LOCALE];
  const next = {};
  const add = (locale, key, entry) => {
    if (!(locale in locales) || locale === SOURCE_LOCALE || !(key in enUs)) return;
    (next[locale] ??= {})[key] = entry;
  };
  for (const [locale, keys] of Object.entries(ledger))
    for (const [key, entry] of Object.entries(keys)) add(locale, key, entry);
  for (const [locale, keys] of Object.entries(plan.fills))
    for (const [key, { source }] of Object.entries(keys))
      add(locale, key, ledgerEntry(byId[source]));
  return next;
}

/** The ledger's on-disk form: locales and keys sorted, 2-space, trailing newline. */
export function serializeLedger(ledger) {
  const sorted = {};
  for (const locale of Object.keys(ledger).sort()) {
    sorted[locale] = {};
    for (const key of Object.keys(ledger[locale]).sort()) sorted[locale][key] = ledger[locale][key];
  }
  return JSON.stringify(sorted, null, 2) + '\n';
}

export function readLedger(root = rootDir) {
  const file = path.join(root, LEDGER_REL);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

export function applyPlan(plan, locales, localeDir) {
  const changed = [];
  for (const [locale, keys] of Object.entries(plan.fills)) {
    const next = { ...locales[locale] };
    for (const [key, { value }] of Object.entries(keys)) next[key] = value;
    if (writeLocaleFile(localeDir, locale, next)) changed.push(locale);
  }
  return changed.sort();
}

// ── Suggest ──────────────────────────────────────────────────────────────────

const normalizeForMatch = (text) =>
  foldCase(text)
    .replace(/[\s.…:]+$/u, '')
    .replace(/\s+/g, ' ');

/**
 * Candidate source keys for JellyRock keys that are not in the keymap yet: same
 * English after placeholder conversion, case folding and trailing-punctuation trim.
 * A candidate is a starting point for review, not an answer — this is exactly the
 * matching the keymap exists to get past.
 */
export function suggest({ locales, sources, keymap, keys }) {
  const enUs = locales[SOURCE_LOCALE];
  const nonEnglish = Object.keys(locales).filter((l) => l !== SOURCE_LOCALE);
  const wanted = keys?.length
    ? keys
    : Object.keys(enUs).filter(
        (k) => !keymap[k] && nonEnglish.some((l) => locales[l][k] === undefined),
      );
  const out = [];
  for (const jrKey of wanted.sort()) {
    if (!(jrKey in enUs)) {
      out.push({ key: jrKey, en: undefined, candidates: [] });
      continue;
    }
    const target = normalizeForMatch(enUs[jrKey]);
    const rejected = new Set((keymap[jrKey]?.reject ?? []).map((r) => `${r.source}\0${r.key}`));
    const missing = nonEnglish.filter((l) => locales[l][jrKey] === undefined);
    const candidates = [];
    for (const source of sources) {
      for (const [sk, en] of Object.entries(source.loaded.english)) {
        if (rejected.has(`${source.id}\0${sk}`)) continue;
        let converted;
        try {
          converted = toIndexedPlaceholders(en, source.placeholders);
        } catch {
          converted = en;
        }
        if (normalizeForMatch(converted) !== target) continue;
        const fills = missing.filter(
          (l) => source.loaded.translations[l]?.[sk] !== undefined,
        ).length;
        candidates.push({ source: source.id, key: sk, en, fills });
      }
    }
    out.push({ key: jrKey, en: enUs[jrKey], candidates });
  }
  return out;
}

function formatSuggestions(results) {
  const lines = [
    '# Candidates by normalized English. Review MEANING and SHAPE in context before accepting.',
    '',
  ];
  for (const r of results) {
    if (r.en === undefined) {
      lines.push(`# ${r.key}: not in en_US.json`, '');
      continue;
    }
    lines.push(`${r.key}:`, `  en: ${JSON.stringify(r.en)}`);
    if (!r.candidates.length) {
      lines.push('  # no exact-text candidate; search the sources by meaning', '');
      continue;
    }
    lines.push('  from:');
    const seen = new Set();
    for (const c of r.candidates.sort((a, b) => b.fills - a.fills)) {
      const prefix = seen.has(c.source) ? '  # alt ' : '    ';
      seen.add(c.source);
      lines.push(
        `${prefix}${c.source}: { key: ${JSON.stringify(c.key)}, en: ${JSON.stringify(c.en)} }  # fills ${c.fills}`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    mode: 'plan',
    write: false,
    verbose: false,
    keys: [],
    summaryFile: null,
    localeDir: null,
    sources: null,
  };
  const value = (i, flag) => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) throw new SeedConfigError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'suggest') args.mode = 'suggest';
    else if (a === '--write') args.write = true;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--key') args.keys.push(value(++i, a));
    else if (a === '--summary-file') args.summaryFile = value(++i, a);
    else if (a === '--locale-dir') args.localeDir = value(++i, a);
    else if (a === '--source') (args.sources ??= []).push(value(++i, a));
    else throw new SeedConfigError(`unknown argument ${a}`);
  }
  return args;
}

/** Load config, fetch and verify every source, parse locale files. */
export function loadEverything({ root = rootDir, localeDir, only } = {}) {
  const sourcesConfig = parseSources(readFileSync(path.join(root, SOURCES_REL), 'utf8'));
  const keymap = parseKeymap(
    readFileSync(path.join(root, KEYMAP_REL), 'utf8'),
    sourcesConfig.map((s) => s.id),
  );
  const dir = localeDir ?? path.join(root, 'locale', 'custom');
  const locales = readLocaleDir(dir);
  const jrLocales = Object.keys(locales);
  const cacheDir = path.join(root, CACHE_REL);
  const ledger = readLedger(root);
  const sources = sourcesConfig
    .filter((s) => !only || only.includes(s.id))
    .map((source) => {
      const checkout = fetchSource(source, cacheDir);
      verifyLicense(source, checkout);
      return { ...source, loaded: loadSource(source, checkout, jrLocales) };
    });
  return { keymap, locales, sources, ledger, localeDir: dir };
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
    const { keymap, locales, sources, ledger, localeDir } = loadEverything({
      localeDir: args.localeDir,
      only: args.sources,
    });
    if (args.mode === 'suggest') {
      console.log(formatSuggestions(suggest({ locales, sources, keymap, keys: args.keys })));
      return;
    }
    const plan = planSeed({ locales, sources, keymap, ledger });
    console.log(formatReport({ plan, locales, sources, verbose: args.verbose }));
    if (args.summaryFile)
      writeFileSync(args.summaryFile, formatCommitBody({ plan, locales, sources }), 'utf8');
    if (args.write) {
      const changed = applyPlan(plan, locales, localeDir);
      writeFileSync(
        path.join(rootDir, LEDGER_REL),
        serializeLedger(nextLedger({ ledger, plan, sources, locales })),
        'utf8',
      );
      console.log(`\ntranslations:seed: wrote ${changed.length} locale files and ${LEDGER_REL}.`);
    } else {
      console.log('\nDry run — nothing written. Re-run with --write to apply.');
    }
  } catch (e) {
    if (!(e instanceof SeedConfigError)) throw e;
    console.error(`translations:seed FAILED — ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
