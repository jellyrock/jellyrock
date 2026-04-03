#!/usr/bin/env node

// CI validation script for translation files.
// Runs as part of the lint chain. Exits with error code on failure.
//
// Checks:
// - All locale JSON files are valid JSON
// - No orphaned keys (keys in locale files not in en_US.json)
// - Placeholder parity between en_US and all locales
// - All translate()/translatePlural() keys exist in en_US.json
// - No hardcoded string literals in translate()/translatePlural() calls
//   (must use translationKeys.* constants for compile-time safety)

const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');

const ROOT_DIR = process.cwd();
const LOCALE_DIR = path.join(ROOT_DIR, 'locale/custom');
const EN_US_PATH = path.join(LOCALE_DIR, 'en_US.json');

const SOURCE_PATTERNS = [
  'source/**/*.bs',
  'components/**/*.bs',
  '!node_modules/**',
  '!tests/**',
  '!**/roku_modules/**',
  '!build/**',
  '!out/**'
];

function extractPlaceholders(str) {
  const matches = str.match(/\{(\d+)\}/g);
  return matches ? matches.sort() : [];
}

function extractTranslateKeys(code) {
  const keys = new Set();
  const pluralBaseKeys = new Set();
  const hardcodedErrors = []; // violations: translate("string") instead of translationKeys.*
  let match;

  // Match translate(translationKeys.Key) — compile-time safe constant references
  const constRegex = /\btranslate\(\s*translationKeys\.(\w+)/g;
  while ((match = constRegex.exec(code)) !== null) {
    keys.add(match[1]);
  }

  // Match translate("Key") — flag as error (should use translationKeys.*)
  const translateRegex = /\btranslate\(\s*"([^"]+)"/g;
  while ((match = translateRegex.exec(code)) !== null) {
    keys.add(match[1]); // still validate the key exists
    hardcodedErrors.push({
      pattern: `translate("${match[1]}")`,
      suggestion: `translate(translationKeys.${match[1]})`,
      index: match.index
    });
  }

  // Match translatePlural("BaseKey", ...) — flag as error (should use translationKeys.*)
  const pluralRegex = /\btranslatePlural\(\s*"([^"]+)"/g;
  while ((match = pluralRegex.exec(code)) !== null) {
    const baseKey = match[1];
    pluralBaseKeys.add(baseKey);
    keys.add(baseKey + 'Zero');
    keys.add(baseKey + 'One');
    keys.add(baseKey + 'Many');
    hardcodedErrors.push({
      pattern: `translatePlural("${baseKey}", ...)`,
      suggestion: `translatePlural(translationKeys.${baseKey}, ...)`,
      index: match.index
    });
  }

  // Match translatePlural(translationKeys.BaseKey, ...) — compile-time safe plural calls
  const pluralConstRegex = /\btranslatePlural\(\s*translationKeys\.(\w+)/g;
  while ((match = pluralConstRegex.exec(code)) !== null) {
    const baseKey = match[1];
    pluralBaseKeys.add(baseKey);
    keys.add(baseKey + 'Zero');
    keys.add(baseKey + 'One');
    keys.add(baseKey + 'Many');
  }

  // Match translationKeys.Key anywhere (covers comments, return values, etc.)
  // Requires PascalCase key (uppercase start) to avoid matching import paths like translationKeys.bs
  // Skip plural base keys — they don't exist in en_US.json directly (only Zero/One/Many variants do)
  const refRegex = /\btranslationKeys\.([A-Z]\w*)/g;
  while ((match = refRegex.exec(code)) !== null) {
    if (!pluralBaseKeys.has(match[1])) {
      keys.add(match[1]);
    }
  }

  // Match titleKey: translationKeys.Key (compile-time safe settings objects)
  const constPropRegex = /\b(?:titleKey|descriptionKey):\s*translationKeys\.(\w+)/g;
  while ((match = constPropRegex.exec(code)) !== null) {
    keys.add(match[1]);
  }

  // Match titleKey: "Key" and descriptionKey: "Key" — flag as error (should use translationKeys.*)
  const keyPropRegex = /\b(?:titleKey|descriptionKey):\s*"([^"]+)"/g;
  while ((match = keyPropRegex.exec(code)) !== null) {
    keys.add(match[1]); // still validate the key exists
    const prop = match[0].match(/^(titleKey|descriptionKey)/)[1];
    hardcodedErrors.push({
      pattern: `${prop}: "${match[1]}"`,
      suggestion: `${prop}: translationKeys.${match[1]}`,
      index: match.index
    });
  }

  return { keys, pluralBaseKeys, hardcodedErrors };
}

function extractSettingsKeys(jsonData) {
  const keys = new Set();
  function traverse(obj) {
    if (typeof obj !== 'object' || obj === null) return;
    if (typeof obj.titleKey === 'string') keys.add(obj.titleKey);
    if (typeof obj.descriptionKey === 'string') keys.add(obj.descriptionKey);
    for (const key in obj) traverse(obj[key]);
  }
  traverse(jsonData);
  return keys;
}

async function main() {
  const errors = [];

  // Load en_US.json
  if (!fs.existsSync(EN_US_PATH)) {
    console.error('ERROR: locale/custom/en_US.json not found');
    process.exit(1);
  }

  let enUs;
  try {
    enUs = JSON.parse(fs.readFileSync(EN_US_PATH, 'utf8'));
  } catch (err) {
    console.error(`ERROR: en_US.json invalid JSON: ${err.message}`);
    process.exit(1);
  }

  // 1. Validate all locale JSON files
  const localeFiles = await fg(['*.json'], {
    cwd: LOCALE_DIR,
    absolute: true
  });

  for (const filePath of localeFiles) {
    const fileName = path.basename(filePath);
    if (fileName === 'en_US.json') continue;

    let locale;
    try {
      locale = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      errors.push(`${fileName}: Invalid JSON — ${err.message}`);
      continue;
    }

    // Orphaned keys
    const orphans = Object.keys(locale).filter(k => !(k in enUs));
    if (orphans.length > 0) {
      errors.push(`${fileName}: ${orphans.length} orphaned key(s): ${orphans.slice(0, 3).join(', ')}${orphans.length > 3 ? '...' : ''}`);
    }

    // Placeholder parity
    for (const key of Object.keys(locale)) {
      if (!(key in enUs)) continue;
      const enP = extractPlaceholders(enUs[key]);
      const locP = extractPlaceholders(locale[key]);
      if (JSON.stringify(enP) !== JSON.stringify(locP)) {
        errors.push(`${fileName}: Placeholder mismatch for "${key}" (en_US: ${enP.join(',')} vs ${locP.join(',')})`);
      }
    }
  }

  // 2. Check that all code keys exist in en_US.json
  const usedKeys = new Set();
  const hardcodedViolations = [];
  const files = await fg(SOURCE_PATTERNS, { cwd: ROOT_DIR, absolute: true });
  for (const filePath of files) {
    const code = fs.readFileSync(filePath, 'utf8');
    const result = extractTranslateKeys(code);
    result.keys.forEach(k => usedKeys.add(k));

    // Collect hardcoded string violations with file and line info
    if (result.hardcodedErrors.length > 0) {
      const relativePath = path.relative(ROOT_DIR, filePath);
      for (const violation of result.hardcodedErrors) {
        const lineNum = code.substring(0, violation.index).split('\n').length;
        hardcodedViolations.push(
          `${relativePath}:${lineNum} \u2014 ${violation.pattern} \u2192 ${violation.suggestion}`
        );
      }
    }
  }

  // Also check settings.json (key existence only — string literals are expected in JSON)
  const settingsPath = path.join(ROOT_DIR, 'settings/settings.json');
  if (fs.existsSync(settingsPath)) {
    extractSettingsKeys(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).forEach(k => usedKeys.add(k));
  }

  const missing = [...usedKeys].filter(k => !(k in enUs)).sort();
  if (missing.length > 0) {
    errors.push(`en_US.json missing ${missing.length} key(s) used in code: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}`);
  }

  // 3. Flag hardcoded translation keys (must use translationKeys.* constants)
  if (hardcodedViolations.length > 0) {
    errors.push(`${hardcodedViolations.length} hardcoded translation key(s) found (use translationKeys.* constants instead):`);
    hardcodedViolations.forEach(v => errors.push(`  ${v}`));
  }

  // 4. Verify all locale files have a languages.json entry
  const languagesPath = path.join(ROOT_DIR, 'locale/languages.json');
  if (fs.existsSync(languagesPath)) {
    const languages = JSON.parse(fs.readFileSync(languagesPath, 'utf8'));
    const langCodes = new Set(languages.map(l => l.code).filter(c => c !== ''));
    const localeCodes = localeFiles
      .map(f => path.basename(f, '.json'))
      .filter(c => c !== 'en_US');
    const missingFromLangs = localeCodes.filter(c => !langCodes.has(c)).sort();
    if (missingFromLangs.length > 0) {
      errors.push(`${missingFromLangs.length} locale file(s) missing from languages.json: ${missingFromLangs.join(', ')}`);
    }
  }

  // Report
  if (errors.length > 0) {
    console.error(`\nTranslation validation failed (${errors.length} error(s)):\n`);
    errors.forEach(e => console.error(`  \u2717 ${e}`));
    process.exit(1);
  }

  console.log(`\u2713 Translation validation passed (${localeFiles.length} files, ${usedKeys.size} keys)`);
}

main().catch(err => { console.error(err); process.exit(1); });
