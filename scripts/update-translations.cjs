// Scans the codebase for translate() and translatePlural() calls,
// compares against locale/custom/en-us.json, and reports:
// - Keys used in code but missing from en-us.json
// - Keys in en-us.json not used in code (orphans)
// Optionally auto-adds missing keys with --fix flag.

const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');

const ROOT_DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.';
const FIX_MODE = process.argv.includes('--fix');
const EN_US_PATH = path.join(ROOT_DIR, 'locale/custom/en-us.json');
const SETTINGS_JSON_PATH = path.join(ROOT_DIR, 'settings/settings.json');

const SOURCE_PATTERNS = [
  'source/**/*.bs',
  'components/**/*.bs',
  '!node_modules/**',
  '!tests/**',
  '!**/roku_modules/**',
  '!build/**',
  '!out/**'
];

// Extract translation keys from code — supports both patterns:
// - translate(translationKeys.Key) — compile-time safe constant references
// - translate("Key") — dynamic string calls (settings.bs, etc.)
function extractTranslateKeys(code) {
  const keys = new Set();
  let match;

  // Match translate(translationKeys.Key) and translate(translationKeys.Key, ...)
  const constRegex = /\btranslate\(\s*translationKeys\.(\w+)/g;
  while ((match = constRegex.exec(code)) !== null) {
    keys.add(match[1]);
  }

  // Match translate("Key") and translate("Key", ...) — dynamic string calls
  const translateRegex = /\btranslate\(\s*"([^"]+)"/g;
  while ((match = translateRegex.exec(code)) !== null) {
    keys.add(match[1]);
  }

  // Match translatePlural("BaseKey", ...) — generates BaseKeyZero, BaseKeyOne, BaseKeyMany
  const pluralRegex = /\btranslatePlural\(\s*"([^"]+)"/g;
  while ((match = pluralRegex.exec(code)) !== null) {
    const baseKey = match[1];
    keys.add(baseKey + 'Zero');
    keys.add(baseKey + 'One');
    keys.add(baseKey + 'Many');
  }

  // Match translationKeys.Key anywhere (covers comments, return values, etc.)
  // Requires PascalCase key (uppercase start) to avoid matching import paths like translationKeys.bs
  const refRegex = /\btranslationKeys\.([A-Z]\w*)/g;
  while ((match = refRegex.exec(code)) !== null) {
    keys.add(match[1]);
  }

  // Match titleKey: translationKeys.Key (compile-time safe settings objects)
  const constPropRegex = /\b(?:titleKey|descriptionKey):\s*translationKeys\.(\w+)/g;
  while ((match = constPropRegex.exec(code)) !== null) {
    keys.add(match[1]);
  }

  // Match titleKey: "Key" and descriptionKey: "Key" (dynamic string objects)
  const keyPropRegex = /\b(?:titleKey|descriptionKey):\s*"([^"]+)"/g;
  while ((match = keyPropRegex.exec(code)) !== null) {
    keys.add(match[1]);
  }

  return keys;
}

// Extract titleKey and descriptionKey from settings.json
function extractSettingsKeys(jsonData) {
  const keys = new Set();

  function traverse(obj) {
    if (typeof obj !== 'object' || obj === null) return;

    if (typeof obj.titleKey === 'string') keys.add(obj.titleKey);
    if (typeof obj.descriptionKey === 'string') keys.add(obj.descriptionKey);

    for (const key in obj) {
      traverse(obj[key]);
    }
  }

  traverse(jsonData);
  return keys;
}

async function main() {
  console.log('Scanning codebase for translation keys...\n');

  // Load en-us.json
  if (!fs.existsSync(EN_US_PATH)) {
    console.error(`ERROR: ${EN_US_PATH} not found`);
    process.exit(1);
  }
  const enUs = JSON.parse(fs.readFileSync(EN_US_PATH, 'utf8'));
  const definedKeys = new Set(Object.keys(enUs));

  // Scan source files
  const usedKeys = new Set();
  const files = await fg(SOURCE_PATTERNS, { cwd: ROOT_DIR, absolute: true });

  for (const filePath of files) {
    const code = fs.readFileSync(filePath, 'utf8');
    const fileKeys = extractTranslateKeys(code);
    fileKeys.forEach(k => usedKeys.add(k));
  }
  console.log(`Found ${usedKeys.size} keys in ${files.length} source files`);

  // Scan settings.json
  if (fs.existsSync(SETTINGS_JSON_PATH)) {
    const settingsData = JSON.parse(fs.readFileSync(SETTINGS_JSON_PATH, 'utf8'));
    const settingsKeys = extractSettingsKeys(settingsData);
    settingsKeys.forEach(k => usedKeys.add(k));
    console.log(`Found ${settingsKeys.size} keys in settings.json`);
  }

  console.log(`Total unique keys used in code: ${usedKeys.size}`);
  console.log(`Total keys defined in en-us.json: ${definedKeys.size}\n`);

  // Find missing keys (used in code but not in en-us.json)
  const missingKeys = [...usedKeys].filter(k => !definedKeys.has(k)).sort();

  // Find orphan keys (in en-us.json but not used in code)
  const orphanKeys = [...definedKeys].filter(k => !usedKeys.has(k)).sort();

  // Report
  if (missingKeys.length > 0) {
    console.log(`\x1b[31mMissing keys (${missingKeys.length}):\x1b[0m`);
    missingKeys.forEach(k => console.log(`  - ${k}`));
    console.log('');
  }

  if (orphanKeys.length > 0) {
    console.log(`\x1b[33mOrphan keys (${orphanKeys.length}):\x1b[0m`);
    orphanKeys.forEach(k => console.log(`  - ${k}`));
    console.log('');
  }

  // Auto-add missing keys if --fix
  if (FIX_MODE && missingKeys.length > 0) {
    console.log('Adding missing keys to en-us.json...');
    missingKeys.forEach(k => { enUs[k] = k; });

    // Sort keys and write
    const sorted = {};
    Object.keys(enUs).sort().forEach(k => { sorted[k] = enUs[k]; });
    fs.writeFileSync(EN_US_PATH, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`Added ${missingKeys.length} keys (values set to key name for translation)`);
  }

  // Summary
  console.log('=== Summary ===');
  console.log(`Keys in code: ${usedKeys.size}`);
  console.log(`Keys in en-us.json: ${definedKeys.size}`);
  console.log(`Missing: ${missingKeys.length}`);
  console.log(`Orphans: ${orphanKeys.length}`);

  if (missingKeys.length > 0 && !FIX_MODE) {
    console.log('\nRun with --fix to auto-add missing keys');
  }

  if (missingKeys.length > 0) {
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
