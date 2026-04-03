// Scans the codebase for translate() and translatePlural() calls,
// compares against locale/custom/en-us.json, and reports:
// - Keys used in code but missing from en-us.json
// - Keys in en-us.json not used in code (orphans)
// With --fix: sorts en-us.json alphabetically and syncs languages.json.

const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');

const ROOT_DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.';
const FIX_MODE = process.argv.includes('--fix');
const EN_US_PATH = path.join(ROOT_DIR, 'locale/custom/en-us.json');
const LOCALE_DIR = path.join(ROOT_DIR, 'locale/custom');
const LANGUAGES_JSON_PATH = path.join(ROOT_DIR, 'locale/languages.json');
const SETTINGS_JSON_PATH = path.join(ROOT_DIR, 'settings/settings.json');

// Language metadata for auto-generating languages.json entries.
// Maps locale code → { name (English), nativeName (native script) }.
// Covers all codes from Jellyfin ecosystem + community languages.
const LANGUAGE_METADATA = {
  'af': { name: 'Afrikaans', nativeName: 'Afrikaans' },
  'ar': { name: 'Arabic', nativeName: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629' },
  'as': { name: 'Assamese', nativeName: '\u0985\u09b8\u09ae\u09c0\u09af\u09bc\u09be' },
  'be-by': { name: 'Belarusian', nativeName: '\u0411\u0435\u043b\u0430\u0440\u0443\u0441\u043a\u0430\u044f' },
  'bg': { name: 'Bulgarian', nativeName: '\u0411\u044a\u043b\u0433\u0430\u0440\u0441\u043a\u0438' },
  'bg-bg': { name: 'Bulgarian', nativeName: '\u0411\u044a\u043b\u0433\u0430\u0440\u0441\u043a\u0438' },
  'bn': { name: 'Bengali', nativeName: '\u09ac\u09be\u0982\u09b2\u09be' },
  'bn-bd': { name: 'Bengali (Bangladesh)', nativeName: '\u09ac\u09be\u0982\u09b2\u09be (\u09ac\u09be\u0982\u09b2\u09be\u09a6\u09c7\u09b6)' },
  'br': { name: 'Breton', nativeName: 'Brezhoneg' },
  'ca': { name: 'Catalan', nativeName: 'Catal\u00e0' },
  'ckb': { name: 'Central Kurdish', nativeName: '\u06a9\u0648\u0631\u062f\u06cc' },
  'cs': { name: 'Czech', nativeName: '\u010ce\u0161tina' },
  'cy': { name: 'Welsh', nativeName: 'Cymraeg' },
  'da': { name: 'Danish', nativeName: 'Dansk' },
  'de': { name: 'German', nativeName: 'Deutsch' },
  'de-de': { name: 'German (Germany)', nativeName: 'Deutsch (Deutschland)' },
  'dv': { name: 'Divehi', nativeName: '\u078b\u07a8\u0788\u07ac\u0780\u07a8' },
  'el': { name: 'Greek', nativeName: '\u0395\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac' },
  'en-gb': { name: 'English (UK)', nativeName: 'English (UK)' },
  'en-us': { name: 'English (US)', nativeName: 'English (US)' },
  'eo': { name: 'Esperanto', nativeName: 'Esperanto' },
  'es': { name: 'Spanish', nativeName: 'Espa\u00f1ol' },
  'es-419': { name: 'Spanish (Latin America)', nativeName: 'Espa\u00f1ol (Latinoam\u00e9rica)' },
  'es-ar': { name: 'Spanish (Argentina)', nativeName: 'Espa\u00f1ol (Argentina)' },
  'es-do': { name: 'Spanish (Dominican Republic)', nativeName: 'Espa\u00f1ol (Rep\u00fablica Dominicana)' },
  'es-es': { name: 'Spanish (Spain)', nativeName: 'Espa\u00f1ol (Espa\u00f1a)' },
  'es-mx': { name: 'Spanish (Mexico)', nativeName: 'Espa\u00f1ol (M\u00e9xico)' },
  'et': { name: 'Estonian', nativeName: 'Eesti' },
  'eu': { name: 'Basque', nativeName: 'Euskara' },
  'fa': { name: 'Persian', nativeName: '\u0641\u0627\u0631\u0633\u06cc' },
  'fi': { name: 'Finnish', nativeName: 'Suomi' },
  'fil': { name: 'Filipino', nativeName: 'Filipino' },
  'fo': { name: 'Faroese', nativeName: 'F\u00f8royskt' },
  'fr': { name: 'French', nativeName: 'Fran\u00e7ais' },
  'fr-ca': { name: 'French (Canada)', nativeName: 'Fran\u00e7ais (Canada)' },
  'ga': { name: 'Irish', nativeName: 'Gaeilge' },
  'gl': { name: 'Galician', nativeName: 'Galego' },
  'gsw': { name: 'Swiss German', nativeName: 'Schwyzerd\u00fctsch' },
  'gu': { name: 'Gujarati', nativeName: '\u0a97\u0ac1\u0a9c\u0ab0\u0abe\u0aa4\u0ac0' },
  'he': { name: 'Hebrew', nativeName: '\u05e2\u05d1\u05e8\u05d9\u05ea' },
  'he-il': { name: 'Hebrew (Israel)', nativeName: '\u05e2\u05d1\u05e8\u05d9\u05ea (\u05d9\u05e9\u05e8\u05d0\u05dc)' },
  'hi-in': { name: 'Hindi', nativeName: '\u0939\u093f\u0928\u094d\u0926\u0940' },
  'hr': { name: 'Croatian', nativeName: 'Hrvatski' },
  'ht': { name: 'Haitian Creole', nativeName: 'Krey\u00f2l Ayisyen' },
  'hu': { name: 'Hungarian', nativeName: 'Magyar' },
  'hy': { name: 'Armenian', nativeName: '\u0540\u0561\u0575\u0565\u0580\u0565\u0576' },
  'id': { name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  'is-is': { name: 'Icelandic', nativeName: '\u00cdslenska' },
  'it': { name: 'Italian', nativeName: 'Italiano' },
  'it-it': { name: 'Italian (Italy)', nativeName: 'Italiano (Italia)' },
  'ja': { name: 'Japanese', nativeName: '\u65e5\u672c\u8a9e' },
  'jbo': { name: 'Lojban', nativeName: 'la .lojban.' },
  'ka': { name: 'Georgian', nativeName: '\u10e5\u10d0\u10e0\u10d7\u10e3\u10da\u10d8' },
  'kab': { name: 'Kabyle', nativeName: 'Taqbaylit' },
  'kk': { name: 'Kazakh', nativeName: '\u049a\u0430\u0437\u0430\u049b\u0448\u0430' },
  'kn': { name: 'Kannada', nativeName: '\u0c95\u0ca8\u0ccd\u0ca8\u0ca1' },
  'ko': { name: 'Korean', nativeName: '\ud55c\uad6d\uc5b4' },
  'kw': { name: 'Cornish', nativeName: 'Kernewek' },
  'lb': { name: 'Luxembourgish', nativeName: 'L\u00ebtzebuergesch' },
  'lt-lt': { name: 'Lithuanian', nativeName: 'Lietuvi\u0173' },
  'lv': { name: 'Latvian', nativeName: 'Latvie\u0161u' },
  'mg': { name: 'Malagasy', nativeName: 'Malagasy' },
  'mi': { name: 'M\u0101ori', nativeName: 'Te Reo M\u0101ori' },
  'mk': { name: 'Macedonian', nativeName: '\u041c\u0430\u043a\u0435\u0434\u043e\u043d\u0441\u043a\u0438' },
  'ml': { name: 'Malayalam', nativeName: '\u0d2e\u0d32\u0d2f\u0d3e\u0d33\u0d02' },
  'mn': { name: 'Mongolian', nativeName: '\u041c\u043e\u043d\u0433\u043e\u043b' },
  'mr': { name: 'Marathi', nativeName: '\u092e\u0930\u093e\u0920\u0940' },
  'ms': { name: 'Malay', nativeName: 'Bahasa Melayu' },
  'mt': { name: 'Maltese', nativeName: 'Malti' },
  'my': { name: 'Burmese', nativeName: '\u1019\u103c\u1014\u103a\u1019\u102c\u1018\u102c\u101e\u102c' },
  'nb': { name: 'Norwegian Bokm\u00e5l', nativeName: 'Norsk Bokm\u00e5l' },
  'ne': { name: 'Nepali', nativeName: '\u0928\u0947\u092a\u093e\u0932\u0940' },
  'nl': { name: 'Dutch', nativeName: 'Nederlands' },
  'nn': { name: 'Norwegian Nynorsk', nativeName: 'Norsk Nynorsk' },
  'pa': { name: 'Punjabi', nativeName: '\u0a2a\u0a70\u0a1c\u0a3e\u0a2c\u0a40' },
  'pl': { name: 'Polish', nativeName: 'Polski' },
  'pr': { name: 'Pirate', nativeName: 'Pirate' },
  'pt': { name: 'Portuguese', nativeName: 'Portugu\u00eas' },
  'pt-br': { name: 'Portuguese (Brazil)', nativeName: 'Portugu\u00eas (Brasil)' },
  'pt-pt': { name: 'Portuguese (Portugal)', nativeName: 'Portugu\u00eas (Portugal)' },
  'ro': { name: 'Romanian', nativeName: 'Rom\u00e2n\u0103' },
  'ru': { name: 'Russian', nativeName: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439' },
  'si': { name: 'Sinhala', nativeName: '\u0dc3\u0dd2\u0d82\u0dc4\u0dbd' },
  'sk': { name: 'Slovak', nativeName: 'Sloven\u010dina' },
  'sl': { name: 'Slovenian', nativeName: 'Sloven\u0161\u010dina' },
  'sl-si': { name: 'Slovenian (Slovenia)', nativeName: 'Sloven\u0161\u010dina (Slovenija)' },
  'so': { name: 'Somali', nativeName: 'Soomaali' },
  'sq': { name: 'Albanian', nativeName: 'Shqip' },
  'sr': { name: 'Serbian', nativeName: '\u0421\u0440\u043f\u0441\u043a\u0438' },
  'sv': { name: 'Swedish', nativeName: 'Svenska' },
  'ta': { name: 'Tamil', nativeName: '\u0ba4\u0bae\u0bbf\u0bb4\u0bcd' },
  'te': { name: 'Telugu', nativeName: '\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41' },
  'th': { name: 'Thai', nativeName: '\u0e44\u0e17\u0e22' },
  'tr': { name: 'Turkish', nativeName: 'T\u00fcrk\u00e7e' },
  'ug': { name: 'Uyghur', nativeName: '\u0626\u06c7\u064a\u063a\u06c7\u0631\u0686\u06d5' },
  'uk': { name: 'Ukrainian', nativeName: '\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430' },
  'ur-pk': { name: 'Urdu', nativeName: '\u0627\u0631\u062f\u0648' },
  'uz': { name: 'Uzbek', nativeName: 'O\u02bbzbekcha' },
  'vi': { name: 'Vietnamese', nativeName: 'Ti\u1ebfng Vi\u1ec7t' },
  'zh-cn': { name: 'Chinese (Simplified)', nativeName: '\u7b80\u4f53\u4e2d\u6587' },
  'zh-hk': { name: 'Chinese (Hong Kong)', nativeName: '\u7e41\u9ad4\u4e2d\u6587\uff08\u9999\u6e2f\uff09' },
  'zh-tw': { name: 'Chinese (Traditional)', nativeName: '\u7e41\u9ad4\u4e2d\u6587' },
  'zu': { name: 'Zulu', nativeName: 'isiZulu' },
};

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
  const pluralBaseKeys = new Set();
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
    pluralBaseKeys.add(baseKey);
    keys.add(baseKey + 'Zero');
    keys.add(baseKey + 'One');
    keys.add(baseKey + 'Many');
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
  // Skip plural base keys — they don't exist in en-us.json directly (only Zero/One/Many variants do)
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

  // Auto-fix en-us.json: ensure sort order
  if (FIX_MODE) {
    // Sort keys and write to ensure consistent order
    const sorted = {};
    Object.keys(enUs).sort().forEach(k => { sorted[k] = enUs[k]; });
    const output = JSON.stringify(sorted, null, 2) + '\n';
    const current = fs.readFileSync(EN_US_PATH, 'utf8');
    if (output !== current) {
      fs.writeFileSync(EN_US_PATH, output);
      console.log('Sorted en-us.json keys alphabetically');
    }
  }

  // ============================================================
  // Sync languages.json with locale files
  // ============================================================
  const localeFiles = fs.readdirSync(LOCALE_DIR)
    .filter(f => f.endsWith('.json') && f !== 'en-us.json')
    .map(f => f.replace('.json', ''));

  let languages = [];
  if (fs.existsSync(LANGUAGES_JSON_PATH)) {
    languages = JSON.parse(fs.readFileSync(LANGUAGES_JSON_PATH, 'utf8'));
  }
  const langCodes = new Set(languages.filter(l => l.code !== '').map(l => l.code));
  const missingLangs = localeFiles.filter(code => !langCodes.has(code)).sort();

  if (missingLangs.length > 0) {
    console.log(`\n\x1b[31mLocale files missing from languages.json (${missingLangs.length}):\x1b[0m`);
    missingLangs.forEach(code => console.log(`  - ${code}`));
  }

  if (FIX_MODE && missingLangs.length > 0) {
    console.log('\nAdding missing locales to languages.json...');
    for (const code of missingLangs) {
      const meta = LANGUAGE_METADATA[code];
      if (meta) {
        languages.push({ code, name: meta.name, nativeName: meta.nativeName });
      } else {
        console.log(`  \x1b[33mWarning: No metadata for "${code}" — using code as placeholder name\x1b[0m`);
        languages.push({ code, name: code, nativeName: code });
      }
    }
    console.log(`Added ${missingLangs.length} locale(s) to languages.json`);

    // Sort alphabetically by code, keeping "" (Automatic) pinned first
    languages.sort((a, b) => {
      if (a.code === '') return -1;
      if (b.code === '') return 1;
      return a.code.localeCompare(b.code);
    });

    const langOutput = JSON.stringify(languages, null, 2) + '\n';
    fs.writeFileSync(LANGUAGES_JSON_PATH, langOutput);
    console.log('Sorted languages.json alphabetically');
  }

  // Summary
  console.log('\n=== Summary ===');
  console.log(`Keys in code: ${usedKeys.size}`);
  console.log(`Keys in en-us.json: ${definedKeys.size}`);
  console.log(`Missing keys: ${missingKeys.length}`);
  console.log(`Orphan keys: ${orphanKeys.length}`);
  console.log(`Missing locales in languages.json: ${missingLangs.length}`);

  if ((missingKeys.length > 0 || missingLangs.length > 0) && !FIX_MODE) {
    console.log('\nRun with --fix to auto-add missing keys and locales');
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
