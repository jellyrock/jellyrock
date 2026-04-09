// Consolidated translation maintenance script.
//
// Default mode (no flags): validates all translation files, code references,
// placeholders, sort order, plurals, and coverage. Exits 1 on errors.
//
// --fix mode: auto-fixes en_US.json (remove orphans, sort) and languages.json
// (add missing locales), then runs all checks. Exits 1 on remaining errors.
//
// npm scripts:
//   lint:translations    → check mode (all validation)
//   update-translations  → fix mode (--fix baked in)

const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');

// ============================================================
// Config
// ============================================================

const ROOT_DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.';
const FIX_MODE = process.argv.includes('--fix');
const EN_US_PATH = path.join(ROOT_DIR, 'locale/custom/en_US.json');
const LOCALE_DIR = path.join(ROOT_DIR, 'locale/custom');
const LANGUAGES_JSON_PATH = path.join(ROOT_DIR, 'locale/languages.json');
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

// Language metadata for auto-generating languages.json entries.
// Maps locale code → { name (English), nativeName (native script) }.
// Covers all codes from Jellyfin ecosystem + community languages.
const LANGUAGE_METADATA = {
  'af': { name: 'Afrikaans', nativeName: 'Afrikaans' },
  'ar': { name: 'Arabic', nativeName: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629' },
  'as': { name: 'Assamese', nativeName: '\u0985\u09b8\u09ae\u09c0\u09af\u09bc\u09be' },
  'be': { name: 'Belarusian', nativeName: '\u0411\u0435\u043b\u0430\u0440\u0443\u0441\u043a\u0430\u044f' },
  'bg': { name: 'Bulgarian', nativeName: '\u0411\u044a\u043b\u0433\u0430\u0440\u0441\u043a\u0438' },
  'bn': { name: 'Bengali', nativeName: '\u09ac\u09be\u0982\u09b2\u09be' },
  'bn_BD': { name: 'Bengali (Bangladesh)', nativeName: '\u09ac\u09be\u0982\u09b2\u09be (\u09ac\u09be\u0982\u09b2\u09be\u09a6\u09c7\u09b6)' },
  'br': { name: 'Breton', nativeName: 'Brezhoneg' },
  'ca': { name: 'Catalan', nativeName: 'Catal\u00e0' },
  'ckb': { name: 'Central Kurdish', nativeName: '\u06a9\u0648\u0631\u062f\u06cc' },
  'cs': { name: 'Czech', nativeName: '\u010ce\u0161tina' },
  'cy': { name: 'Welsh', nativeName: 'Cymraeg' },
  'da': { name: 'Danish', nativeName: 'Dansk' },
  'de': { name: 'German', nativeName: 'Deutsch' },
  'dv': { name: 'Divehi', nativeName: '\u078b\u07a8\u0788\u07ac\u0780\u07a8' },
  'el': { name: 'Greek', nativeName: '\u0395\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac' },
  'en_GB': { name: 'English (UK)', nativeName: 'English (UK)' },
  'en_US': { name: 'English (US)', nativeName: 'English (US)' },
  'eo': { name: 'Esperanto', nativeName: 'Esperanto' },
  'es': { name: 'Spanish', nativeName: 'Espa\u00f1ol' },
  'es_419': { name: 'Spanish (Latin America)', nativeName: 'Espa\u00f1ol (Latinoam\u00e9rica)' },
  'es_AR': { name: 'Spanish (Argentina)', nativeName: 'Espa\u00f1ol (Argentina)' },
  'es_DO': { name: 'Spanish (Dominican Republic)', nativeName: 'Espa\u00f1ol (Rep\u00fablica Dominicana)' },
  'es_MX': { name: 'Spanish (Mexico)', nativeName: 'Espa\u00f1ol (M\u00e9xico)' },
  'et': { name: 'Estonian', nativeName: 'Eesti' },
  'eu': { name: 'Basque', nativeName: 'Euskara' },
  'fa': { name: 'Persian', nativeName: '\u0641\u0627\u0631\u0633\u06cc' },
  'fi': { name: 'Finnish', nativeName: 'Suomi' },
  'fil': { name: 'Filipino', nativeName: 'Filipino' },
  'fo': { name: 'Faroese', nativeName: 'F\u00f8royskt' },
  'fr': { name: 'French', nativeName: 'Fran\u00e7ais' },
  'fr_CA': { name: 'French (Canada)', nativeName: 'Fran\u00e7ais (Canada)' },
  'ga': { name: 'Irish', nativeName: 'Gaeilge' },
  'gl': { name: 'Galician', nativeName: 'Galego' },
  'gsw': { name: 'Swiss German', nativeName: 'Schwyzerd\u00fctsch' },
  'gu': { name: 'Gujarati', nativeName: '\u0a97\u0ac1\u0a9c\u0ab0\u0abe\u0aa4\u0ac0' },
  'he': { name: 'Hebrew', nativeName: '\u05e2\u05d1\u05e8\u05d9\u05ea' },
  'he_IL': { name: 'Hebrew (Israel)', nativeName: '\u05e2\u05d1\u05e8\u05d9\u05ea (\u05d9\u05e9\u05e8\u05d0\u05dc)' },
  'hi': { name: 'Hindi', nativeName: '\u0939\u093f\u0928\u094d\u0926\u0940' },
  'hr': { name: 'Croatian', nativeName: 'Hrvatski' },
  'ht': { name: 'Haitian Creole', nativeName: 'Krey\u00f2l Ayisyen' },
  'hu': { name: 'Hungarian', nativeName: 'Magyar' },
  'hy': { name: 'Armenian', nativeName: '\u0540\u0561\u0575\u0565\u0580\u0565\u0576' },
  'id': { name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  'is': { name: 'Icelandic', nativeName: '\u00cdslenska' },
  'it': { name: 'Italian', nativeName: 'Italiano' },
  'ja': { name: 'Japanese', nativeName: '\u65e5\u672c\u8a9e' },
  'jbo': { name: 'Lojban', nativeName: 'la .lojban.' },
  'ka': { name: 'Georgian', nativeName: '\u10e5\u10d0\u10e0\u10d7\u10e3\u10da\u10d8' },
  'kab': { name: 'Kabyle', nativeName: 'Taqbaylit' },
  'kk': { name: 'Kazakh', nativeName: '\u049a\u0430\u0437\u0430\u049b\u0448\u0430' },
  'kn': { name: 'Kannada', nativeName: '\u0c95\u0ca8\u0ccd\u0ca8\u0ca1' },
  'ko': { name: 'Korean', nativeName: '\ud55c\uad6d\uc5b4' },
  'kw': { name: 'Cornish', nativeName: 'Kernewek' },
  'lb': { name: 'Luxembourgish', nativeName: 'L\u00ebtzebuergesch' },
  'lt': { name: 'Lithuanian', nativeName: 'Lietuvi\u0173' },
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
  'pt_BR': { name: 'Portuguese (Brazil)', nativeName: 'Portugu\u00eas (Brasil)' },
  'pt_PT': { name: 'Portuguese (Portugal)', nativeName: 'Portugu\u00eas (Portugal)' },
  'ro': { name: 'Romanian', nativeName: 'Rom\u00e2n\u0103' },
  'ru': { name: 'Russian', nativeName: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439' },
  'si': { name: 'Sinhala', nativeName: '\u0dc3\u0dd2\u0d82\u0dc4\u0dbd' },
  'sk': { name: 'Slovak', nativeName: 'Sloven\u010dina' },
  'sl': { name: 'Slovenian', nativeName: 'Sloven\u0161\u010dina' },
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
  'ur_PK': { name: 'Urdu', nativeName: '\u0627\u0631\u062f\u0648' },
  'uz': { name: 'Uzbek', nativeName: 'O\u02bbzbekcha' },
  'vi': { name: 'Vietnamese', nativeName: 'Ti\u1ebfng Vi\u1ec7t' },
  'zh_Hans': { name: 'Chinese (Simplified)', nativeName: '\u7b80\u4f53\u4e2d\u6587' },
  'zh_Hant_HK': { name: 'Chinese (Hong Kong)', nativeName: '\u7e41\u9ad4\u4e2d\u6587\uff08\u9999\u6e2f\uff09' },
  'zh_Hant': { name: 'Chinese (Traditional)', nativeName: '\u7e41\u9ad4\u4e2d\u6587' },
  'zu': { name: 'Zulu', nativeName: 'isiZulu' },
};

// ============================================================
// Colors
// ============================================================

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

// ============================================================
// Utility Functions
// ============================================================

/** Extract {0}, {1}, etc. placeholders from a string. */
function extractPlaceholders(str) {
  const matches = str.match(/\{(\d+)\}/g);
  return matches ? matches.sort() : [];
}

/**
 * Extract translation keys from code. Returns { keys, pluralBaseKeys, hardcodedErrors }.
 * hardcodedErrors tracks translate("Key") violations (should use translationKeys.*).
 */
function extractTranslateKeys(code) {
  const keys = new Set();
  const pluralBaseKeys = new Set();
  const hardcodedErrors = [];
  let match;

  // Match translate(translationKeys.Key) — compile-time safe constant references
  const constRegex = /\btranslate\(\s*translationKeys\.(\w+)/g;
  while ((match = constRegex.exec(code)) !== null) {
    keys.add(match[1]);
  }

  // Match translate("Key") — flag as hardcoded error (should use translationKeys.*)
  const translateRegex = /\btranslate\(\s*"([^"]+)"/g;
  while ((match = translateRegex.exec(code)) !== null) {
    keys.add(match[1]);
    hardcodedErrors.push({
      pattern: `translate("${match[1]}")`,
      suggestion: `translate(translationKeys.${match[1]})`,
      index: match.index
    });
  }

  // Match translatePlural("BaseKey", ...) — flag as hardcoded error
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

  // Match titleKey: "Key" and descriptionKey: "Key" — flag as hardcoded error
  const keyPropRegex = /\b(?:titleKey|descriptionKey):\s*"([^"]+)"/g;
  while ((match = keyPropRegex.exec(code)) !== null) {
    keys.add(match[1]);
    const prop = match[0].match(/^(titleKey|descriptionKey)/)[1];
    hardcodedErrors.push({
      pattern: `${prop}: "${match[1]}"`,
      suggestion: `${prop}: translationKeys.${match[1]}`,
      index: match.index
    });
  }

  return { keys, pluralBaseKeys, hardcodedErrors };
}

/** Extract titleKey and descriptionKey from settings.json. */
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

/** Check plural completeness: if FooOne exists, FooZero and FooMany must too. */
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

// ============================================================
// Main
// ============================================================

async function main() {
  const errors = [];
  const warnings = [];

  console.log(c('\nTranslation Check', 'bold'));
  console.log(c('=================', 'blue'));

  // ----------------------------------------------------------
  // Load en_US.json
  // ----------------------------------------------------------
  if (!fs.existsSync(EN_US_PATH)) {
    console.error(c(`\nERROR: ${EN_US_PATH} not found`, 'red'));
    process.exit(1);
  }

  let enUs;
  try {
    enUs = JSON.parse(fs.readFileSync(EN_US_PATH, 'utf8'));
  } catch (err) {
    console.error(c(`\nERROR: en_US.json has invalid JSON: ${err.message}`, 'red'));
    process.exit(1);
  }

  // ----------------------------------------------------------
  // Scan code + settings for used keys
  // ----------------------------------------------------------
  const usedKeys = new Set();
  const hardcodedViolations = [];
  const files = await fg(SOURCE_PATTERNS, { cwd: ROOT_DIR, absolute: true });

  for (const filePath of files) {
    const code = fs.readFileSync(filePath, 'utf8');
    const result = extractTranslateKeys(code);
    result.keys.forEach(k => usedKeys.add(k));

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

  if (fs.existsSync(SETTINGS_JSON_PATH)) {
    const settingsData = JSON.parse(fs.readFileSync(SETTINGS_JSON_PATH, 'utf8'));
    extractSettingsKeys(settingsData).forEach(k => usedKeys.add(k));
  }

  console.log(`\nScanning... ${usedKeys.size} unique keys in ${files.length} source files`);
  console.log(`en_US.json: ${Object.keys(enUs).length} keys`);

  // ----------------------------------------------------------
  // Fix mode: apply auto-fixes before validation
  // ----------------------------------------------------------
  const enUsKeys = Object.keys(enUs);
  const orphanKeys = [...enUsKeys].filter(k => !usedKeys.has(k)).sort();
  const missingKeys = [...usedKeys].filter(k => !(k in enUs)).sort();

  if (FIX_MODE) {
    let enUsChanged = false;

    // Remove orphan keys from en_US.json
    if (orphanKeys.length > 0) {
      orphanKeys.forEach(k => { delete enUs[k]; });
      console.log(c(`\nFixed: removed ${orphanKeys.length} orphan key(s) from en_US.json`, 'green'));
      enUsChanged = true;
    }

    // Sort en_US.json keys alphabetically
    const sorted = {};
    Object.keys(enUs).sort().forEach(k => { sorted[k] = enUs[k]; });
    const output = JSON.stringify(sorted, null, 2) + '\n';
    const current = fs.readFileSync(EN_US_PATH, 'utf8');
    if (output !== current) {
      fs.writeFileSync(EN_US_PATH, output);
      console.log(c('Fixed: sorted en_US.json keys alphabetically', 'green'));
      enUsChanged = true;
    }

    // Reload en_US.json after fixes for accurate validation
    if (enUsChanged) {
      enUs = JSON.parse(fs.readFileSync(EN_US_PATH, 'utf8'));
    }
  }

  // ----------------------------------------------------------
  // [en_US.json] checks
  // ----------------------------------------------------------
  console.log(c('\n[en_US.json]', 'cyan'));

  // Sort order check (skip in fix mode — already fixed above)
  if (!FIX_MODE) {
    const currentKeys = Object.keys(enUs);
    const sortedKeys = [...currentKeys].sort();
    if (JSON.stringify(currentKeys) !== JSON.stringify(sortedKeys)) {
      const firstUnsorted = currentKeys.find((k, i) => k !== sortedKeys[i]);
      errors.push(`en_US.json keys are not sorted alphabetically (first: "${firstUnsorted}")`);
      console.log(c(`  ERROR: keys not sorted (first unsorted: "${firstUnsorted}")`, 'red'));
    } else {
      console.log(c('  OK', 'green') + ' \u2014 keys sorted alphabetically');
    }

    // Orphan keys check (skip in fix mode — already removed above)
    if (orphanKeys.length > 0) {
      errors.push(`${orphanKeys.length} orphan key(s) in en_US.json`);
      console.log(c(`  ERROR: ${orphanKeys.length} orphan key(s)`, 'red'));
      orphanKeys.forEach(k => console.log(`    - ${k}`));
    }
  } else {
    console.log(c('  OK', 'green') + ' \u2014 keys sorted alphabetically');
  }

  // Plural completeness
  const pluralErrors = checkPluralCompleteness(Object.keys(enUs));
  if (pluralErrors.length > 0) {
    pluralErrors.forEach(e => {
      errors.push(e);
      console.log(c(`  ERROR: ${e}`, 'red'));
    });
  } else {
    console.log(c('  OK', 'green') + ' \u2014 plural sets complete');
  }

  // ----------------------------------------------------------
  // [Code References] checks
  // ----------------------------------------------------------
  console.log(c('\n[Code References]', 'cyan'));

  // Missing keys (used in code but not in en_US.json)
  // Recompute against potentially fixed en_US.json
  const currentMissing = [...usedKeys].filter(k => !(k in enUs)).sort();
  if (currentMissing.length > 0) {
    errors.push(`${currentMissing.length} key(s) used in code but missing from en_US.json`);
    console.log(c(`  ERROR: ${currentMissing.length} missing key(s)`, 'red'));
    currentMissing.forEach(k => console.log(`    - ${k}`));
  } else {
    console.log(c('  OK', 'green') + ` \u2014 all ${usedKeys.size} keys exist in en_US.json`);
  }

  // Hardcoded string violations
  if (hardcodedViolations.length > 0) {
    errors.push(`${hardcodedViolations.length} hardcoded translation key(s) (use translationKeys.* constants)`);
    console.log(c(`  ERROR: ${hardcodedViolations.length} hardcoded translation key(s)`, 'red'));
    hardcodedViolations.forEach(v => console.log(`    ${v}`));
  } else {
    console.log(c('  OK', 'green') + ' \u2014 no hardcoded translation strings');
  }

  // ----------------------------------------------------------
  // [Locale Files] checks
  // ----------------------------------------------------------
  const localeFiles = await fg(['*.json'], { cwd: LOCALE_DIR, absolute: true, onlyFiles: true });
  const nonEnLocales = localeFiles.filter(f => path.basename(f) !== 'en_US.json');

  console.log(c(`\n[Locale Files]`, 'cyan') + ` (${nonEnLocales.length} files)`);

  let totalCovered = 0;
  let totalLocaleKeys = 0;
  const enUsKeyList = Object.keys(enUs);
  const enUsKeyCount = enUsKeyList.length;

  for (const filePath of nonEnLocales) {
    const fileName = path.basename(filePath);

    // Valid JSON check
    let locale;
    try {
      locale = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      errors.push(`${fileName}: invalid JSON \u2014 ${err.message}`);
      console.log(c(`  ERROR: ${fileName}: invalid JSON \u2014 ${err.message}`, 'red'));
      continue;
    }

    const localeKeys = Object.keys(locale);
    const localeKeySet = new Set(localeKeys);

    // Placeholder parity
    for (const key of localeKeys) {
      if (!(key in enUs)) continue;
      const enP = extractPlaceholders(enUs[key]);
      const locP = extractPlaceholders(locale[key]);
      if (JSON.stringify(enP) !== JSON.stringify(locP)) {
        errors.push(`${fileName}: placeholder mismatch for "${key}" (en_US: ${enP.join(',') || 'none'} vs ${locP.join(',') || 'none'})`);
      }
    }

    // Orphaned keys (in locale but not in en_US) — warning only (Weblate's concern)
    const orphans = localeKeys.filter(k => !(k in enUs));
    if (orphans.length > 0) {
      warnings.push(`${fileName}: ${orphans.length} orphaned key(s)`);
    }

    // Plural completeness — warning only
    const localePluralErrors = checkPluralCompleteness(localeKeys);
    localePluralErrors.forEach(e => warnings.push(`${fileName}: ${e}`));

    // File size warning (>500KB)
    const stat = fs.statSync(filePath);
    if (stat.size > 500 * 1024) {
      warnings.push(`${fileName}: file size ${(stat.size / 1024).toFixed(0)}KB exceeds 500KB`);
    }

    // Coverage tracking
    const covered = enUsKeyList.filter(k => localeKeySet.has(k)).length;
    totalCovered += covered;
    totalLocaleKeys++;
  }

  // Placeholder errors summary
  const placeholderErrors = errors.filter(e => e.includes('placeholder mismatch'));
  if (placeholderErrors.length > 0) {
    console.log(c(`  ERROR: ${placeholderErrors.length} placeholder mismatch(es)`, 'red'));
    placeholderErrors.slice(0, 5).forEach(e => console.log(`    ${e}`));
    if (placeholderErrors.length > 5) console.log(`    ... and ${placeholderErrors.length - 5} more`);
  } else {
    console.log(c('  OK', 'green') + ' \u2014 all JSON valid, placeholders match');
  }

  // Coverage summary
  if (totalLocaleKeys > 0) {
    const avgCoverage = ((totalCovered / (totalLocaleKeys * enUsKeyCount)) * 100).toFixed(1);
    console.log(`  Coverage: ${avgCoverage}% average across ${totalLocaleKeys} locale files`);
  }

  // ----------------------------------------------------------
  // [languages.json] checks + fix
  // ----------------------------------------------------------
  console.log(c('\n[languages.json]', 'cyan'));

  const localeCodes = fs.readdirSync(LOCALE_DIR)
    .filter(f => f.endsWith('.json') && f !== 'en_US.json')
    .map(f => f.replace('.json', ''));

  let languages = [];
  if (fs.existsSync(LANGUAGES_JSON_PATH)) {
    languages = JSON.parse(fs.readFileSync(LANGUAGES_JSON_PATH, 'utf8'));
  }
  const langCodes = new Set(languages.filter(l => l.code !== '').map(l => l.code));
  const missingLangs = localeCodes.filter(code => !langCodes.has(code)).sort();

  if (FIX_MODE && missingLangs.length > 0) {
    for (const code of missingLangs) {
      const meta = LANGUAGE_METADATA[code];
      if (meta) {
        languages.push({ code, name: meta.name, nativeName: meta.nativeName });
      } else {
        console.log(c(`  Warning: no metadata for "${code}" \u2014 using code as placeholder name`, 'yellow'));
        languages.push({ code, name: code, nativeName: code });
      }
    }

    // Sort alphabetically by code, keeping "" (Automatic) pinned first
    languages.sort((a, b) => {
      if (a.code === '') return -1;
      if (b.code === '') return 1;
      return a.code.localeCompare(b.code);
    });

    fs.writeFileSync(LANGUAGES_JSON_PATH, JSON.stringify(languages, null, 2) + '\n');
    console.log(c(`  Fixed: added ${missingLangs.length} locale(s) to languages.json`, 'green'));
  } else if (missingLangs.length > 0) {
    errors.push(`${missingLangs.length} locale file(s) missing from languages.json: ${missingLangs.join(', ')}`);
    console.log(c(`  ERROR: ${missingLangs.length} locale file(s) not registered`, 'red'));
    missingLangs.forEach(code => console.log(`    - ${code}`));
  } else {
    console.log(c('  OK', 'green') + ' \u2014 all locale files registered');
  }

  // ----------------------------------------------------------
  // Summary
  // ----------------------------------------------------------
  console.log(c('\nSummary:', 'bold'));

  if (warnings.length > 0) {
    console.log(c(`  ${warnings.length} warning(s)`, 'yellow'));
  }

  if (errors.length > 0) {
    console.log(c(`  ${errors.length} error(s)`, 'red'));
    process.exit(1);
  } else {
    console.log(c('  0 errors', 'green'));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
