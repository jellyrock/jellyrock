#!/usr/bin/env node

// Validates JSON translation files in locale/custom/:
// - Valid JSON syntax for all locale files
// - All en-us keys present in each locale file (coverage report)
// - Placeholder parity ({0}, {1} counts match source)
// - No orphaned keys (keys in locale not in en-us)
// - Plural completeness (if FooOne exists, FooZero and FooMany must too)
// - File size warnings

const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');

const LOCALE_DIR = path.join(process.cwd(), 'locale/custom');
const EN_US_FILE = 'en-us.json';

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function c(text, color) {
  if (process.platform === 'win32' && !process.env.FORCE_COLOR && !process.stdout.isTTY) return text;
  return `${colors[color]}${text}${colors.reset}`;
}

// Extract {0}, {1}, etc. placeholders from a string
function extractPlaceholders(str) {
  const matches = str.match(/\{(\d+)\}/g);
  return matches ? matches.sort() : [];
}

// Check plural completeness: if FooOne exists, FooZero and FooMany should too
function checkPluralCompleteness(keys) {
  const errors = [];
  const pluralSuffixes = ['Zero', 'One', 'Many'];

  const baseKeys = new Set();
  for (const key of keys) {
    for (const suffix of pluralSuffixes) {
      if (key.endsWith(suffix)) {
        baseKeys.add(key.slice(0, -suffix.length));
        break;
      }
    }
  }

  for (const base of baseKeys) {
    const missing = pluralSuffixes.filter(s => !keys.includes(base + s));
    if (missing.length > 0) {
      errors.push(`Incomplete plural set "${base}": missing ${missing.map(s => base + s).join(', ')}`);
    }
  }

  return errors;
}

async function main() {
  console.log(c('\nValidating JSON Translation Files', 'bold'));
  console.log(c('==================================', 'blue'));

  // Load en-us.json (reference)
  const enUsPath = path.join(LOCALE_DIR, EN_US_FILE);
  if (!fs.existsSync(enUsPath)) {
    console.error(c('ERROR: en-us.json not found', 'red'));
    process.exit(1);
  }

  let enUs;
  try {
    enUs = JSON.parse(fs.readFileSync(enUsPath, 'utf8'));
  } catch (err) {
    console.error(c(`ERROR: en-us.json has invalid JSON: ${err.message}`, 'red'));
    process.exit(1);
  }

  const enUsKeys = Object.keys(enUs);
  console.log(`\n${c('Reference:', 'cyan')} en-us.json (${enUsKeys.length} keys)\n`);

  // Check plural completeness in en-us
  const pluralErrors = checkPluralCompleteness(enUsKeys);
  pluralErrors.forEach(e => console.error(c(`  PLURAL: ${e}`, 'yellow')));

  // Find all locale JSON files
  const localeFiles = await fg(['*.json'], {
    cwd: LOCALE_DIR,
    absolute: true,
    onlyFiles: true
  });

  let totalErrors = 0;
  let totalWarnings = 0;

  // Check en-us.json key sort order
  const sortedKeys = [...enUsKeys].sort();
  if (JSON.stringify(enUsKeys) !== JSON.stringify(sortedKeys)) {
    const firstUnsorted = enUsKeys.find((k, i) => k !== sortedKeys[i]);
    console.error(c(`  en-us.json keys are not sorted alphabetically (first: "${firstUnsorted}")`, 'red'));
    totalErrors++;
  }
  const coverageReport = [];

  for (const filePath of localeFiles) {
    const fileName = path.basename(filePath);
    if (fileName === EN_US_FILE) continue;

    const relativePath = path.relative(process.cwd(), filePath);
    let locale;
    let errors = 0;
    let warnings = 0;

    // 1. Valid JSON
    try {
      locale = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.error(c(`\u2717 ${relativePath}: Invalid JSON — ${err.message}`, 'red'));
      totalErrors++;
      continue;
    }

    const localeKeys = Object.keys(locale);
    const localeKeySet = new Set(localeKeys);

    // 2. Orphaned keys (in locale but not in en-us)
    const orphans = localeKeys.filter(k => !(k in enUs));
    if (orphans.length > 0) {
      console.error(c(`  ${fileName}: ${orphans.length} orphaned key(s)`, 'red'));
      orphans.slice(0, 5).forEach(k => console.error(`    - ${k}`));
      if (orphans.length > 5) console.error(`    ... and ${orphans.length - 5} more`);
      errors += orphans.length;
    }

    // 3. Placeholder parity
    for (const key of localeKeys) {
      if (!(key in enUs)) continue;
      const enPlaceholders = extractPlaceholders(enUs[key]);
      const localePlaceholders = extractPlaceholders(locale[key]);

      if (JSON.stringify(enPlaceholders) !== JSON.stringify(localePlaceholders)) {
        console.error(c(`  ${fileName}: Placeholder mismatch for "${key}"`, 'red'));
        console.error(`    en-us: ${enPlaceholders.join(', ') || '(none)'}  locale: ${localePlaceholders.join(', ') || '(none)'}`);
        errors++;
      }
    }

    // 4. Coverage
    const covered = enUsKeys.filter(k => localeKeySet.has(k)).length;
    const coverage = ((covered / enUsKeys.length) * 100).toFixed(1);
    coverageReport.push({ file: fileName, covered, total: enUsKeys.length, coverage });

    // 5. File size warning (>500KB)
    const stat = fs.statSync(filePath);
    if (stat.size > 500 * 1024) {
      console.warn(c(`  ${fileName}: File size ${(stat.size / 1024).toFixed(0)}KB exceeds 500KB`, 'yellow'));
      warnings++;
    }

    // 6. Plural completeness
    const localePluralErrors = checkPluralCompleteness(localeKeys);
    // Only warn, don't error — locales may intentionally omit some plural forms
    localePluralErrors.forEach(e => {
      console.warn(c(`  ${fileName} PLURAL: ${e}`, 'yellow'));
      warnings++;
    });

    totalErrors += errors;
    totalWarnings += warnings;

    if (errors === 0) {
      console.log(c(`\u2713 ${fileName}`, 'green') + ` — ${coverage}% coverage (${covered}/${enUsKeys.length})`);
    }
  }

  // Coverage summary
  console.log(c('\nCoverage Report:', 'bold'));
  console.log(c('================', 'blue'));
  coverageReport
    .sort((a, b) => parseFloat(b.coverage) - parseFloat(a.coverage))
    .forEach(({ file, covered, total, coverage }) => {
      const color = coverage >= 80 ? 'green' : coverage >= 50 ? 'yellow' : 'red';
      console.log(`  ${c(coverage.padStart(6) + '%', color)} ${file} (${covered}/${total})`);
    });

  console.log(c('\nSummary:', 'bold'));
  console.log(`  Files: ${localeFiles.length - 1}`); // exclude en-us
  console.log(`  Errors: ${c(String(totalErrors), totalErrors > 0 ? 'red' : 'green')}`);
  console.log(`  Warnings: ${c(String(totalWarnings), totalWarnings > 0 ? 'yellow' : 'green')}`);

  if (totalErrors > 0) {
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
