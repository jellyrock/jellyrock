#!/usr/bin/env node

// One-time migration script: converts JellyRock's translation system from
// Roku's built-in tr() + Qt Linguist XML (.ts) to custom translate() + flat JSON.
//
// Usage: node scripts/migrate-translations.cjs [--dry-run] [--json-only] [--source-only]
//   --dry-run      Generate mapping and report without modifying files
//   --json-only    Only generate JSON locale files (no source code changes)
//   --source-only  Only update source code (assumes JSON files already exist)

const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const xml2js = require('xml2js');

const ROOT_DIR = path.resolve(__dirname, '..');
const LOCALE_DIR = path.join(ROOT_DIR, 'locale');
const CUSTOM_LOCALE_DIR = path.join(LOCALE_DIR, 'custom');
const SETTINGS_JSON_PATH = path.join(ROOT_DIR, 'settings', 'settings.json');
const MAPPING_FILE = path.join(ROOT_DIR, 'migration-mapping.json');
const REPORT_FILE = path.join(ROOT_DIR, 'migration-report.txt');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const JSON_ONLY = args.includes('--json-only');
const SOURCE_ONLY = args.includes('--source-only');

// Locale directory name -> custom locale code
const LOCALE_MAP = {
  'en_US': 'en-us',
  'en_GB': 'en-gb',
  'en_CA': 'en-ca',
  'en_AU': 'en-au',
  'de_DE': 'de-de',
  'es_ES': 'es-es',
  'es_MX': 'es-mx',
  'fr_CA': 'fr-ca',
  'it_IT': 'it-it',
  'pt_BR': 'pt-br',
};

const BRS_PATTERNS = [
  'source/**/*.bs',
  'components/**/*.bs',
  '!**/roku_modules/**',
  '!build/**',
  '!out/**',
  '!tests/**',
];

const XML_PATTERNS = [
  'components/**/*.xml',
  '!**/roku_modules/**',
  '!build/**',
  '!out/**',
  '!tests/**',
];

// ============================================================
// Key Generation
// ============================================================

// Words that indicate error context
const ERROR_WORDS = ['error', 'failed', 'unable', 'cannot', 'could not', 'problem', 'invalid'];
// Common button labels (1-3 words, imperative)
const BUTTON_WORDS = ['play', 'pause', 'stop', 'resume', 'cancel', 'delete', 'save', 'submit',
  'ok', 'close', 'exit', 'back', 'next', 'previous', 'search', 'retry', 'refresh',
  'record', 'shuffle', 'repeat', 'mute', 'unmute', 'mark watched', 'mark unwatched',
  'sign in', 'sign out', 'log in', 'log out', 'connect', 'disconnect', 'reset',
  'view channel', 'record series', 'quick connect', 'manual login'];
// Day/relative time names
const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'today', 'yesterday', 'tomorrow'];
// Month names
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function toPascalCase(str) {
  return str
    .replace(/[^a-zA-Z0-9\s]/g, ' ')  // replace non-alphanumeric with space
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

function truncatePascalCase(pascalCase, maxWords = 6) {
  // Split PascalCase back into words and take first N
  const words = pascalCase.replace(/([A-Z])/g, ' $1').trim().split(/\s+/);
  if (words.length <= maxWords) return pascalCase;
  return words.slice(0, maxWords).join('');
}

function categorizeString(source, context = '') {
  const lower = source.toLowerCase().trim();

  // Day names
  if (DAY_NAMES.includes(lower)) return 'Day';

  // Month names
  if (MONTH_NAMES.includes(lower)) return 'Month';

  // Error messages
  if (ERROR_WORDS.some(w => lower.includes(w))) return 'Error';

  // Button labels — short strings that match common button patterns
  if (BUTTON_WORDS.some(w => lower === w)) return 'Button';

  // Strings with placeholders are messages
  if (source.includes('%1') || source.includes('{0}')) return 'Message';

  // Short strings (1-3 words, no punctuation) are likely labels or buttons
  const wordCount = source.trim().split(/\s+/).length;
  if (wordCount <= 2 && !source.includes('.') && !source.includes('?') && !source.includes('!')) {
    return 'Label';
  }

  // Longer strings with question marks or full sentences are messages
  if (source.includes('?') || source.includes('!') || wordCount > 8) {
    return 'Message';
  }

  return 'Label';
}

function generateKey(source, forcedPrefix = null) {
  const prefix = forcedPrefix || categorizeString(source);
  let pascal = toPascalCase(source);
  pascal = truncatePascalCase(pascal);

  // Avoid double prefix (e.g., "ErrorError...")
  if (pascal.startsWith(prefix) && prefix !== 'Label') {
    return pascal;
  }

  return prefix + pascal;
}

// ============================================================
// XML Parsing
// ============================================================

async function parseTranslationsTs(filePath) {
  const translations = new Map();
  if (!fs.existsSync(filePath)) return translations;

  const xml = fs.readFileSync(filePath, 'utf8');
  const parser = new xml2js.Parser();
  const result = await parser.parseStringPromise(xml);

  if (result.TS?.context?.[0]?.message) {
    for (const msg of result.TS.context[0].message) {
      const source = msg.source?.[0];
      const translation = msg.translation?.[0];
      const comment = msg.extracomment?.[0] || msg.comment?.[0];
      if (source) {
        translations.set(source, {
          translation: (typeof translation === 'string') ? translation : source,
          comment: comment || null,
        });
      }
    }
  }
  return translations;
}

// ============================================================
// Settings.json Processing
// ============================================================

function processSettingsJson(settingsData, keyMap) {
  let counter = 0;

  function processItem(item, parentPath = '') {
    const itemPath = parentPath ? `${parentPath}.${item.title || ''}` : (item.title || '');

    if (item.title && typeof item.title === 'string') {
      const titleKey = generateKey(item.title, 'Setting');
      const uniqueTitleKey = ensureUnique(titleKey, item.title, keyMap);
      item.titleKey = uniqueTitleKey;
      keyMap.set(item.title, { key: uniqueTitleKey, source: 'settings.json:title' });
      counter++;
    }

    if (item.description && typeof item.description === 'string') {
      // For descriptions, use SettingDesc prefix
      let descKey = 'SettingDesc' + toPascalCase(item.title || item.settingName || 'Unknown');
      descKey = truncatePascalCase(descKey.replace('SettingDesc', ''), 5);
      descKey = 'SettingDesc' + descKey;
      const uniqueDescKey = ensureUnique(descKey, item.description, keyMap);
      item.descriptionKey = uniqueDescKey;
      keyMap.set(item.description, { key: uniqueDescKey, source: 'settings.json:description' });
      counter++;
    }

    // Process options (radio buttons)
    if (item.options && Array.isArray(item.options)) {
      for (const option of item.options) {
        if (option.title && typeof option.title === 'string') {
          const optKey = generateKey(option.title, 'Option');
          const uniqueOptKey = ensureUnique(optKey, option.title, keyMap);
          option.titleKey = uniqueOptKey;
          keyMap.set(option.title, { key: uniqueOptKey, source: 'settings.json:option' });
          counter++;
        }
      }
    }

    // Recurse into children
    if (item.children && Array.isArray(item.children)) {
      for (const child of item.children) {
        processItem(child, itemPath);
      }
    }
  }

  for (const section of settingsData) {
    processItem(section);
  }

  return counter;
}

// ============================================================
// Key Deduplication
// ============================================================

const usedKeys = new Set();

function ensureUnique(key, sourceText, keyMap) {
  // Check if this exact source text already has a key assigned
  const existing = keyMap.get(sourceText);
  if (existing) return existing.key;

  let candidate = key;
  let suffix = 2;
  while (usedKeys.has(candidate)) {
    candidate = key + suffix;
    suffix++;
  }
  usedKeys.add(candidate);
  return candidate;
}

// ============================================================
// Source Code Updates
// ============================================================

function updateBsFile(filePath, keyMap, report) {
  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;
  let changeCount = 0;
  const relativePath = path.relative(ROOT_DIR, filePath);

  // Pattern 1: tr("literal").Replace("%1", val1).Replace("%2", val2)
  // Convert to translate("Key", [val1, val2])
  const replaceChainRegex = /\btr\("([^"]+)"\)((?:\s*\.Replace\(\s*"%\d+"\s*,\s*[^)]+\))+)/g;
  content = content.replace(replaceChainRegex, (match, source, replaceChain) => {
    const mapping = keyMap.get(source);
    if (!mapping) {
      report.push(`  WARN: No key mapping for "${source}" in ${relativePath}`);
      return match;
    }

    // Extract all .Replace() arguments
    const replaceArgRegex = /\.Replace\(\s*"%\d+"\s*,\s*([^)]+)\)/g;
    const params = [];
    let replaceMatch;
    while ((replaceMatch = replaceArgRegex.exec(replaceChain)) !== null) {
      params.push(replaceMatch[1].trim());
    }

    changeCount++;
    if (params.length > 0) {
      return `translate("${mapping.key}", [${params.join(', ')}])`;
    }
    return `translate("${mapping.key}")`;
  });

  // Pattern 2: Simple tr("literal")
  const simpleTrRegex = /\btr\("([^"]+)"\)/g;
  content = content.replace(simpleTrRegex, (match, source) => {
    const mapping = keyMap.get(source);
    if (!mapping) {
      report.push(`  WARN: No key mapping for "${source}" in ${relativePath}`);
      return match;
    }
    changeCount++;
    return `translate("${mapping.key}")`;
  });

  // Add import if we made changes and it's a component file
  if (changeCount > 0 && content !== originalContent) {
    if (filePath.includes('components/') && !content.includes('import "pkg:/source/utils/translate.bs"')) {
      // Add import after last existing import or at top
      const lastImportIndex = content.lastIndexOf('import "pkg:/');
      if (lastImportIndex >= 0) {
        const endOfLine = content.indexOf('\n', lastImportIndex);
        content = content.slice(0, endOfLine + 1) +
          'import "pkg:/source/utils/translate.bs"\n' +
          content.slice(endOfLine + 1);
      } else {
        content = 'import "pkg:/source/utils/translate.bs"\n' + content;
      }
    }
  }

  return { content, changeCount, changed: content !== originalContent };
}

// ============================================================
// Settings.bs Special Handling
// ============================================================

function updateSettingsBs(filePath, report) {
  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;
  let changeCount = 0;

  // Replace tr(item.title) -> translate(item.titleKey)
  content = content.replace(/\btr\(item\.title\)/g, () => { changeCount++; return 'translate(item.titleKey)'; });
  content = content.replace(/\btr\(item\.description\)/g, () => { changeCount++; return 'translate(item.descriptionKey)'; });
  content = content.replace(/\btr\(level\.title\)/g, () => { changeCount++; return 'translate(level.titleKey)'; });
  content = content.replace(/\btr\(selectedSetting\.Description\)/g, () => { changeCount++; return 'translate(selectedSetting.descriptionKey)'; });
  content = content.replace(/\btr\(resetItem\.title\)/g, () => { changeCount++; return 'translate(resetItem.titleKey)'; });
  content = content.replace(/\btr\(resetItem\.description\)/g, () => { changeCount++; return 'translate(resetItem.descriptionKey)'; });

  if (changeCount > 0) {
    report.push(`  settings.bs: ${changeCount} variable tr() calls converted to translate() with titleKey/descriptionKey`);
  }

  return { content, changeCount, changed: content !== originalContent };
}

// ============================================================
// ProgramDetails.bs Special Handling
// ============================================================

function updateProgramDetailsBs(filePath, report) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changeCount = 0;

  // tr(day) -> translate(day) — day var already returns translation keys after we update getRelativeDayName
  content = content.replace(/\btr\(day\)/g, () => { changeCount++; return 'translate(day)'; });

  // Update getRelativeDayName to return translation keys instead of English strings
  const dayReplacements = {
    'return "today"': 'return "DayToday"',
    'return "yesterday"': 'return "DayYesterday"',
    'return "tomorrow"': 'return "DayTomorrow"',
    'return "Monday"': 'return "DayMonday"',
    'return "Tuesday"': 'return "DayTuesday"',
    'return "Wednesday"': 'return "DayWednesday"',
    'return "Thursday"': 'return "DayThursday"',
    'return "Friday"': 'return "DayFriday"',
    'return "Saturday"': 'return "DaySaturday"',
    'return "Sunday"': 'return "DaySunday"',
  };

  for (const [oldStr, newStr] of Object.entries(dayReplacements)) {
    if (content.includes(oldStr)) {
      content = content.replace(oldStr, newStr);
      changeCount++;
    }
  }

  // Update the comment block that lists tr() calls for the update-translations script
  const commentReplacements = {
    "' tr(\"today\")": "' translate(\"DayToday\")",
    "' tr(\"yesterday\")": "' translate(\"DayYesterday\")",
    "' tr(\"tomorrow\")": "' translate(\"DayTomorrow\")",
    "' tr(\"Monday\")": "' translate(\"DayMonday\")",
    "' tr(\"Tuesday\")": "' translate(\"DayTuesday\")",
    "' tr(\"Wednesday\")": "' translate(\"DayWednesday\")",
    "' tr(\"Thursday\")": "' translate(\"DayThursday\")",
    "' tr(\"Friday\")": "' translate(\"DayFriday\")",
    "' tr(\"Saturday\")": "' translate(\"DaySaturday\")",
    "' tr(\"Sunday\")": "' translate(\"DaySunday\")",
  };

  for (const [oldStr, newStr] of Object.entries(commentReplacements)) {
    if (content.includes(oldStr)) {
      content = content.replaceAll(oldStr, newStr);
    }
  }

  if (changeCount > 0) {
    report.push(`  ProgramDetails.bs: ${changeCount} changes (tr(day) + getRelativeDayName return values)`);
  }

  return { content, changeCount, changed: content !== fs.readFileSync(filePath, 'utf8') };
}

// ============================================================
// XML Hardcoded String Migration
// ============================================================

async function findXmlHardcodedStrings(keyMap) {
  const xmlFiles = await fg(XML_PATTERNS, { cwd: ROOT_DIR, absolute: true });
  const xmlChanges = [];

  // Strings that should NOT be translated (cosmetic/technical)
  const NON_TRANSLATABLE = new Set([
    ':', '0:00', '0', '|', '-', '--', '...', 'checkmark',
    '00:00', '99', '0.0', 'FHD', 'HD', 'SD',
  ]);

  for (const filePath of xmlFiles) {
    const xml = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(ROOT_DIR, filePath);

    // Find text="..." attributes with actual translatable content
    const textAttrRegex = /(\s)(text|title|hintText)="([^"]+)"/g;
    let match;
    while ((match = textAttrRegex.exec(xml)) !== null) {
      const attrName = match[2];
      const value = match[3];

      if (NON_TRANSLATABLE.has(value.trim())) continue;
      if (/^\d+$/.test(value.trim())) continue; // pure numbers
      if (value.trim().length === 0) continue;

      // Check if this string has a key mapping
      const mapping = keyMap.get(value);
      if (mapping) {
        xmlChanges.push({
          file: relativePath,
          attribute: attrName,
          value: value,
          key: mapping.key,
        });
      }
    }
  }

  return xmlChanges;
}

// ============================================================
// Main Migration Flow
// ============================================================

async function main() {
  console.log('=== JellyRock Translation Migration ===');
  if (DRY_RUN) console.log('*** DRY RUN — no files will be modified ***\n');

  const report = [];
  const keyMap = new Map(); // sourceText -> { key, source }

  // ----------------------------------------------------------
  // PHASE 1: Parse existing XML translations
  // ----------------------------------------------------------
  console.log('Phase 1: Parsing existing XML translations...');

  const enUsPath = path.join(LOCALE_DIR, 'en_US', 'translations.ts');
  const enUsTranslations = await parseTranslationsTs(enUsPath);
  console.log(`  Parsed ${enUsTranslations.size} strings from en_US/translations.ts`);

  // Generate key for each source string
  for (const [source, data] of enUsTranslations) {
    const key = generateKey(source);
    const uniqueKey = ensureUnique(key, source, keyMap);
    keyMap.set(source, { key: uniqueKey, source: 'translations.ts', comment: data.comment });
  }

  // ----------------------------------------------------------
  // PHASE 2: Process settings.json
  // ----------------------------------------------------------
  console.log('\nPhase 2: Processing settings.json...');
  const settingsData = JSON.parse(fs.readFileSync(SETTINGS_JSON_PATH, 'utf8'));
  const settingsCount = processSettingsJson(settingsData, keyMap);
  console.log(`  Generated ${settingsCount} keys from settings.json titles/descriptions/options`);

  // Add hardcoded items from settings.bs that aren't in settings.json
  const hardcodedSettingsStrings = [
    'Reset User Settings',
    'Reset all settings to their default values. Your login session will not be affected.',
  ];
  for (const str of hardcodedSettingsStrings) {
    if (!keyMap.has(str)) {
      const key = generateKey(str, 'Setting');
      const uniqueKey = ensureUnique(key, str, keyMap);
      keyMap.set(str, { key: uniqueKey, source: 'settings.bs:hardcoded' });
    }
    // Also add titleKey/descriptionKey equivalents
  }

  // ----------------------------------------------------------
  // PHASE 3: Add day name keys
  // ----------------------------------------------------------
  console.log('\nPhase 3: Adding day/relative time name keys...');
  const dayNames = {
    'today': 'DayToday', 'yesterday': 'DayYesterday', 'tomorrow': 'DayTomorrow',
    'Monday': 'DayMonday', 'Tuesday': 'DayTuesday', 'Wednesday': 'DayWednesday',
    'Thursday': 'DayThursday', 'Friday': 'DayFriday', 'Saturday': 'DaySaturday',
    'Sunday': 'DaySunday',
  };
  for (const [source, key] of Object.entries(dayNames)) {
    if (!usedKeys.has(key)) {
      usedKeys.add(key);
      keyMap.set(source, { key, source: 'day-names' });
    }
  }
  console.log(`  Added ${Object.keys(dayNames).length} day/time name keys`);

  // ----------------------------------------------------------
  // PHASE 4: Generate JSON locale files
  // ----------------------------------------------------------
  if (!SOURCE_ONLY) {
    console.log('\nPhase 4: Generating JSON locale files...');

    if (!fs.existsSync(CUSTOM_LOCALE_DIR)) {
      fs.mkdirSync(CUSTOM_LOCALE_DIR, { recursive: true });
    }

    // Generate en-us.json
    const enUsJson = {};
    for (const [source, { key }] of keyMap) {
      enUsJson[key] = source;
    }

    // Convert placeholders: %1 -> {0}, %2 -> {1}, etc.
    for (const [key, value] of Object.entries(enUsJson)) {
      let converted = value;
      // Replace %1, %2, etc. with {0}, {1}, etc.
      converted = converted.replace(/%(\d+)/g, (_, num) => `{${parseInt(num) - 1}}`);
      enUsJson[key] = converted;
    }

    // Sort keys alphabetically
    const sortedEnUs = {};
    for (const key of Object.keys(enUsJson).sort()) {
      sortedEnUs[key] = enUsJson[key];
    }

    if (!DRY_RUN) {
      fs.writeFileSync(
        path.join(CUSTOM_LOCALE_DIR, 'en-us.json'),
        JSON.stringify(sortedEnUs, null, 2) + '\n'
      );
    }
    console.log(`  en-us.json: ${Object.keys(sortedEnUs).length} keys`);

    // Generate other locale JSON files
    for (const [dirName, localeCode] of Object.entries(LOCALE_MAP)) {
      if (dirName === 'en_US') continue;

      const tsPath = path.join(LOCALE_DIR, dirName, 'translations.ts');
      if (!fs.existsSync(tsPath)) {
        console.log(`  Skipping ${dirName} — no translations.ts found`);
        continue;
      }

      const localeTranslations = await parseTranslationsTs(tsPath);
      const localeJson = {};

      for (const [source, { key }] of keyMap) {
        const localeData = localeTranslations.get(source);
        if (localeData && localeData.translation && localeData.translation !== source) {
          let translated = localeData.translation;
          // Convert placeholders
          translated = translated.replace(/%(\d+)/g, (_, num) => `{${parseInt(num) - 1}}`);
          localeJson[key] = translated;
        }
        // If no translation exists, omit the key (fallback to en-us at runtime)
      }

      const sortedLocale = {};
      for (const key of Object.keys(localeJson).sort()) {
        sortedLocale[key] = localeJson[key];
      }

      if (!DRY_RUN) {
        fs.writeFileSync(
          path.join(CUSTOM_LOCALE_DIR, `${localeCode}.json`),
          JSON.stringify(sortedLocale, null, 2) + '\n'
        );
      }
      console.log(`  ${localeCode}.json: ${Object.keys(sortedLocale).length} translated keys`);
    }

    // Update settings.json with titleKey/descriptionKey fields
    if (!DRY_RUN) {
      fs.writeFileSync(SETTINGS_JSON_PATH, JSON.stringify(settingsData, null, 2) + '\n');
      console.log('  Updated settings.json with titleKey/descriptionKey fields');
    }
  }

  // ----------------------------------------------------------
  // PHASE 5: Update source code
  // ----------------------------------------------------------
  if (!JSON_ONLY) {
    console.log('\nPhase 5: Updating source code...');

    const bsFiles = await fg(BRS_PATTERNS, { cwd: ROOT_DIR, absolute: true });
    let totalFileChanges = 0;
    let totalCallChanges = 0;

    for (const filePath of bsFiles) {
      const relativePath = path.relative(ROOT_DIR, filePath);

      // Special handling for settings.bs
      if (relativePath === 'components/settings/settings.bs') {
        // First do standard tr("literal") replacements
        const stdResult = updateBsFile(filePath, keyMap, report);
        // Then do variable tr() replacements
        const varResult = updateSettingsBs(filePath, report);

        if (stdResult.changed || varResult.changed) {
          let finalContent = stdResult.changed ? stdResult.content : fs.readFileSync(filePath, 'utf8');
          // Apply variable replacements to the already-updated content
          if (varResult.changed) {
            // Re-run variable replacements on the updated content
            const tempPath = filePath + '.tmp';
            if (!DRY_RUN) {
              fs.writeFileSync(tempPath, finalContent);
              const varResult2 = updateSettingsBs(tempPath, []);
              finalContent = varResult2.content;
              fs.unlinkSync(tempPath);
            }
          }
          if (!DRY_RUN) fs.writeFileSync(filePath, finalContent);
          totalFileChanges++;
          totalCallChanges += stdResult.changeCount + varResult.changeCount;
          report.push(`  ${relativePath}: ${stdResult.changeCount + varResult.changeCount} changes`);
        }
        continue;
      }

      // Special handling for ProgramDetails.bs
      if (relativePath === 'components/liveTv/ProgramDetails.bs') {
        const stdResult = updateBsFile(filePath, keyMap, report);
        let finalContent = stdResult.changed ? stdResult.content : fs.readFileSync(filePath, 'utf8');

        // Write intermediate content so ProgramDetails handler can read it
        if (stdResult.changed && !DRY_RUN) {
          fs.writeFileSync(filePath, finalContent);
        }

        const progResult = updateProgramDetailsBs(filePath, report);
        if (progResult.changed) {
          finalContent = progResult.content;
          if (!DRY_RUN) fs.writeFileSync(filePath, finalContent);
        }

        if (stdResult.changed || progResult.changed) {
          totalFileChanges++;
          totalCallChanges += stdResult.changeCount + progResult.changeCount;
        }
        continue;
      }

      // Standard BS file
      const result = updateBsFile(filePath, keyMap, report);
      if (result.changed) {
        if (!DRY_RUN) fs.writeFileSync(filePath, result.content);
        totalFileChanges++;
        totalCallChanges += result.changeCount;
        report.push(`  ${relativePath}: ${result.changeCount} changes`);
      }
    }

    console.log(`  Updated ${totalFileChanges} files, ${totalCallChanges} tr() -> translate() conversions`);
  }

  // ----------------------------------------------------------
  // PHASE 6: Identify XML hardcoded strings
  // ----------------------------------------------------------
  if (!JSON_ONLY) {
    console.log('\nPhase 6: Identifying XML hardcoded strings...');
    const xmlChanges = await findXmlHardcodedStrings(keyMap);
    console.log(`  Found ${xmlChanges.length} translatable XML attribute strings`);
    report.push('\n--- XML Hardcoded Strings (require manual BS init() migration) ---');
    for (const change of xmlChanges) {
      report.push(`  ${change.file}: ${change.attribute}="${change.value}" -> translate("${change.key}")`);
    }
    report.push('  NOTE: These must be manually moved to each component\'s init() function.');
  }

  // ----------------------------------------------------------
  // PHASE 7: Write mapping and report
  // ----------------------------------------------------------
  console.log('\nPhase 7: Writing mapping and report...');

  // Write mapping file
  const mappingOutput = {};
  for (const [source, data] of keyMap) {
    mappingOutput[source] = { key: data.key, source: data.source };
  }

  if (!DRY_RUN) {
    fs.writeFileSync(MAPPING_FILE, JSON.stringify(mappingOutput, null, 2) + '\n');
  }
  console.log(`  migration-mapping.json: ${Object.keys(mappingOutput).length} entries`);

  // Write report
  const reportContent = [
    '=== JellyRock Translation Migration Report ===',
    `Date: ${new Date().toISOString()}`,
    `Total keys generated: ${keyMap.size}`,
    `Dry run: ${DRY_RUN}`,
    '',
    '--- Changes ---',
    ...report,
    '',
    '--- Remaining tr(variable) calls requiring manual review ---',
    '  components/settings/settings.bs: tr(item.title) etc. -> translate(item.titleKey)',
    '    Handled by migration script (titleKey/descriptionKey added to settings.json)',
    '  components/liveTv/ProgramDetails.bs: tr(day) -> translate(day)',
    '    Handled by migration script (getRelativeDayName returns translation keys)',
    '',
  ].join('\n');

  if (!DRY_RUN) {
    fs.writeFileSync(REPORT_FILE, reportContent);
  }
  console.log(`  migration-report.txt written`);

  console.log('\n=== Migration complete ===');
  if (DRY_RUN) {
    console.log('This was a dry run. Run without --dry-run to apply changes.');
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
