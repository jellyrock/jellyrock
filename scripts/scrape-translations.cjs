#!/usr/bin/env node

// Scrapes translations from jellyfin-web and jellyfin-roku-legacy repos
// by matching on exact English source strings. Only fills in missing
// translations — never overwrites existing ones.
//
// Sources:
//   1. jellyfin/jellyfin-web (src/strings/*.json) — 105 languages, flat JSON
//   2. jellyfin-archive/jellyfin-roku-legacy (locale/*/translations.ts) — 18 languages, Qt XML
//
// Usage: node scripts/scrape-translations.cjs [--dry-run]

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const xml2js = require('xml2js');

const ROOT_DIR = path.resolve(__dirname, '..');
const CUSTOM_LOCALE_DIR = path.join(ROOT_DIR, 'locale', 'custom');
const EN_US_PATH = path.join(CUSTOM_LOCALE_DIR, 'en-us.json');

const DRY_RUN = process.argv.includes('--dry-run');

// ============================================================
// GitHub API helpers
// ============================================================

function ghApi(endpoint) {
  try {
    const result = execSync(`gh api ${endpoint}`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(result);
  } catch (err) {
    console.error(`  Failed to fetch: ${endpoint}`);
    return null;
  }
}

function ghFileContent(repo, filePath) {
  const data = ghApi(`repos/${repo}/contents/${filePath}`);
  if (!data || !data.content) return null;
  return Buffer.from(data.content, 'base64').toString('utf8');
}

// ============================================================
// Locale code normalization
// ============================================================

// Normalize various locale formats to our lowercase-hyphen convention
function normalizeLocale(code) {
  // Already lowercase-hyphen
  if (/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(code)) return code;
  // Underscore format: de_DE -> de-de
  if (code.includes('_')) return code.toLowerCase().replace('_', '-');
  // Mixed case: en-GB -> en-gb
  return code.toLowerCase();
}

// Map jellyfin-web locale filenames to our format
// Some web locales use different conventions
function webLocaleToOurs(filename) {
  const code = filename.replace('.json', '');
  // Skip the old en_US.json (duplicate of en-us.json)
  if (code === 'en_US') return null;
  // Skip en-us (we have our own)
  if (code === 'en-us') return null;
  return normalizeLocale(code);
}

// Map legacy roku directory names to our format
function legacyLocaleToOurs(dirName) {
  if (dirName === 'en_US') return null; // skip English source
  return normalizeLocale(dirName);
}

// ============================================================
// XML parsing (for legacy roku .ts files)
// ============================================================

async function parseTranslationXml(xmlContent) {
  const translations = new Map(); // source -> translated text
  const parser = new xml2js.Parser();
  const result = await parser.parseStringPromise(xmlContent);

  if (result.TS?.context) {
    for (const ctx of result.TS.context) {
      if (!ctx.message) continue;
      for (const msg of ctx.message) {
        const source = msg.source?.[0];
        const translation = msg.translation?.[0];
        if (source && typeof translation === 'string' && translation !== '' && translation !== source) {
          translations.set(source, translation);
        }
      }
    }
  }
  return translations;
}

// ============================================================
// Placeholder conversion
// ============================================================

// Convert Qt %1/%2 placeholders to {0}/{1}
function convertPlaceholders(text) {
  return text.replace(/%(\d+)/g, (_, num) => `{${parseInt(num) - 1}}`);
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('=== JellyRock Translation Scraper ===');
  if (DRY_RUN) console.log('*** DRY RUN — no files will be written ***\n');

  // Load our English source strings
  const ourEn = JSON.parse(fs.readFileSync(EN_US_PATH, 'utf8'));
  console.log(`Our en-us.json: ${Object.keys(ourEn).length} keys\n`);

  // Build reverse map: English value -> our key(s)
  const valueToKeys = new Map();
  for (const [key, value] of Object.entries(ourEn)) {
    if (!valueToKeys.has(value)) valueToKeys.set(value, []);
    valueToKeys.get(value).push(key);
  }

  // Load existing locale files
  const existingLocales = new Map(); // locale code -> { key: translation }
  const localeFiles = fs.readdirSync(CUSTOM_LOCALE_DIR).filter(f => f.endsWith('.json') && f !== 'en-us.json');
  for (const file of localeFiles) {
    const code = file.replace('.json', '');
    const data = JSON.parse(fs.readFileSync(path.join(CUSTOM_LOCALE_DIR, file), 'utf8'));
    existingLocales.set(code, data);
  }

  // Collect all scraped translations: locale -> { ourKey: translation }
  const scraped = new Map(); // locale -> Map<ourKey, translation>

  // ----------------------------------------------------------
  // SOURCE 1: jellyfin-web (flat JSON, exact English value match)
  // ----------------------------------------------------------
  console.log('--- Source 1: jellyfin/jellyfin-web ---');

  // Get list of locale files
  const webFiles = ghApi('repos/jellyfin/jellyfin-web/contents/src/strings');
  if (!webFiles) {
    console.error('Failed to list jellyfin-web locale files');
  } else {
    // First, load web en-us to build their key->value map
    const webEnContent = ghFileContent('jellyfin/jellyfin-web', 'src/strings/en-us.json');
    const webEn = webEnContent ? JSON.parse(webEnContent) : {};
    console.log(`  Web client en-us: ${Object.keys(webEn).length} keys`);

    // Build: web English value -> web key
    const webValueToKey = new Map();
    for (const [wKey, wValue] of Object.entries(webEn)) {
      if (!webValueToKey.has(wValue)) webValueToKey.set(wValue, []);
      webValueToKey.get(wValue).push(wKey);
    }

    // Find which of our values exist in web client (exact match)
    const matchableWebKeys = new Map(); // web key -> [our keys]
    let webMatchCount = 0;
    for (const [ourValue, ourKeys] of valueToKeys) {
      const webKeys = webValueToKey.get(ourValue);
      if (webKeys) {
        for (const wk of webKeys) {
          matchableWebKeys.set(wk, ourKeys);
        }
        webMatchCount++;
      }
    }
    console.log(`  Matched ${webMatchCount} of our ${valueToKeys.size} English values\n`);

    // Now fetch each non-English web locale file
    const webLocaleFiles = webFiles
      .map(f => f.name)
      .filter(f => f.endsWith('.json'))
      .filter(f => webLocaleToOurs(f) !== null);

    console.log(`  Fetching ${webLocaleFiles.length} web locale files...`);
    let webFilesProcessed = 0;

    for (const filename of webLocaleFiles) {
      const localeCode = webLocaleToOurs(filename);
      if (!localeCode) continue;

      const content = ghFileContent('jellyfin/jellyfin-web', `src/strings/${filename}`);
      if (!content) continue;

      const webLocale = JSON.parse(content);
      webFilesProcessed++;

      if (!scraped.has(localeCode)) scraped.set(localeCode, new Map());
      const localeMap = scraped.get(localeCode);

      for (const [webKey, translatedValue] of Object.entries(webLocale)) {
        const ourKeys = matchableWebKeys.get(webKey);
        if (!ourKeys) continue;
        if (!translatedValue || translatedValue === '') continue;

        for (const ourKey of ourKeys) {
          // Don't overwrite if we already scraped this key
          if (!localeMap.has(ourKey)) {
            localeMap.set(ourKey, translatedValue);
          }
        }
      }

      if (webFilesProcessed % 20 === 0) {
        process.stdout.write(`  ... ${webFilesProcessed}/${webLocaleFiles.length} files\n`);
      }
    }
    console.log(`  Processed ${webFilesProcessed} web locale files`);
  }

  // ----------------------------------------------------------
  // SOURCE 2: jellyfin-roku-legacy (Qt XML, exact English match)
  // ----------------------------------------------------------
  console.log('\n--- Source 2: jellyfin-archive/jellyfin-roku-legacy ---');

  const legacyDirs = ghApi('repos/jellyfin-archive/jellyfin-roku-legacy/contents/locale');
  if (!legacyDirs) {
    console.error('Failed to list legacy roku locale dirs');
  } else {
    // Load legacy en_US to know their source strings
    const legacyEnContent = ghFileContent('jellyfin-archive/jellyfin-roku-legacy', 'locale/en_US/translations.ts');
    let legacyEnStrings = new Set();
    if (legacyEnContent) {
      const parsed = await parseTranslationXml(legacyEnContent);
      // Legacy "translations" for en_US are empty (source=translation),
      // so just collect the source strings
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(legacyEnContent);
      if (result.TS?.context) {
        for (const ctx of result.TS.context) {
          if (!ctx.message) continue;
          for (const msg of ctx.message) {
            const source = msg.source?.[0];
            if (source) legacyEnStrings.add(source);
          }
        }
      }
    }
    console.log(`  Legacy en_US source strings: ${legacyEnStrings.size}`);

    // Only match strings where legacy English === our English (we haven't changed it)
    const legacyMatchable = new Map(); // legacy source string -> [our keys]
    let legacyMatchCount = 0;
    for (const legacySource of legacyEnStrings) {
      const ourKeys = valueToKeys.get(legacySource);
      if (ourKeys) {
        legacyMatchable.set(legacySource, ourKeys);
        legacyMatchCount++;
      }
      // Also try with placeholder conversion: legacy uses %1, we use {0}
      const converted = convertPlaceholders(legacySource);
      if (converted !== legacySource) {
        const ourKeysConverted = valueToKeys.get(converted);
        if (ourKeysConverted && !legacyMatchable.has(legacySource)) {
          legacyMatchable.set(legacySource, ourKeysConverted);
          legacyMatchCount++;
        }
      }
    }
    console.log(`  Matched ${legacyMatchCount} strings with our en-us.json`);

    const localeDirs = legacyDirs
      .filter(d => d.type === 'dir')
      .map(d => d.name)
      .filter(d => legacyLocaleToOurs(d) !== null);

    console.log(`  Fetching ${localeDirs.length} legacy locale files...`);

    for (const dirName of localeDirs) {
      const localeCode = legacyLocaleToOurs(dirName);
      if (!localeCode) continue;

      const content = ghFileContent('jellyfin-archive/jellyfin-roku-legacy', `locale/${dirName}/translations.ts`);
      if (!content) continue;

      const translations = await parseTranslationXml(content);

      if (!scraped.has(localeCode)) scraped.set(localeCode, new Map());
      const localeMap = scraped.get(localeCode);

      for (const [source, translated] of translations) {
        const ourKeys = legacyMatchable.get(source);
        if (!ourKeys) continue;

        // Convert placeholders
        const convertedTranslation = convertPlaceholders(translated);

        for (const ourKey of ourKeys) {
          // Don't overwrite — web client takes priority (fetched first)
          if (!localeMap.has(ourKey)) {
            localeMap.set(ourKey, convertedTranslation);
          }
        }
      }
    }
    console.log(`  Processed ${localeDirs.length} legacy locale files`);
  }

  // ----------------------------------------------------------
  // MERGE: Combine scraped with existing, write files
  // ----------------------------------------------------------
  console.log('\n--- Merging results ---');

  let totalNewKeys = 0;
  let totalNewLocales = 0;
  let totalUpdatedLocales = 0;
  const stats = [];

  for (const [localeCode, scrapedMap] of [...scraped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (scrapedMap.size === 0) continue;

    // Load existing or start fresh
    const existing = existingLocales.get(localeCode) || {};
    const isNew = !existingLocales.has(localeCode);

    let newKeysAdded = 0;
    const merged = { ...existing };

    for (const [key, value] of scrapedMap) {
      // Only add if missing from existing
      if (!merged[key]) {
        merged[key] = value;
        newKeysAdded++;
      }
    }

    if (newKeysAdded === 0) continue;

    totalNewKeys += newKeysAdded;
    if (isNew) totalNewLocales++;
    else totalUpdatedLocales++;

    // Sort keys alphabetically
    const sorted = {};
    for (const key of Object.keys(merged).sort()) {
      sorted[key] = merged[key];
    }

    stats.push({
      locale: localeCode,
      isNew,
      existingKeys: Object.keys(existing).length,
      newKeys: newKeysAdded,
      totalKeys: Object.keys(sorted).length,
    });

    if (!DRY_RUN) {
      fs.writeFileSync(
        path.join(CUSTOM_LOCALE_DIR, `${localeCode}.json`),
        JSON.stringify(sorted, null, 2) + '\n'
      );
    }
  }

  // Print summary
  console.log(`\n=== Summary ===`);
  console.log(`New locales created: ${totalNewLocales}`);
  console.log(`Existing locales updated: ${totalUpdatedLocales}`);
  console.log(`Total new translation keys added: ${totalNewKeys}`);
  console.log(`\nPer-locale breakdown:`);

  for (const s of stats) {
    const tag = s.isNew ? 'NEW' : 'UPD';
    console.log(`  [${tag}] ${s.locale}: +${s.newKeys} keys (${s.existingKeys} existing -> ${s.totalKeys} total)`);
  }

  if (DRY_RUN) {
    console.log('\nThis was a dry run. Run without --dry-run to write files.');
  }
}

main().catch(err => {
  console.error('Scraper failed:', err);
  process.exit(1);
});
