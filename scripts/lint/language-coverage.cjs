// Verifies the three-tier language resolver in source/utils/languages.bs is
// internally consistent and provides coverage for every UI-translatable
// language across all common input formats.
//
// Why this exists: resolveLanguageName() resolves a media stream language
// code (ISO 639-2/T, /B, 639-1, or BCP-47) to a localized display name via
// three tiers — alias → translationKey → English fallback. Three classes of
// silent regression are easy to introduce and impossible to catch via
// existing lints, type checking, or unit tests:
//
//   1. ALIAS WITHOUT TARGET — alias maps "tib" → "bo" but "bo" is not in
//      tier 1 nor tier 2. The user sees raw "bo" instead of a name.
//   2. TIER 1 WITHOUT ALIAS COVERAGE — adds LanguageSl + "sl" to tier 1
//      but forgets "slv" → "sl" in aliases. ffmpeg-tagged Slovenian audio
//      ("slv") falls through to tier 2's English string in EVERY UI locale,
//      including Slovenian — the user's own language fails to localize.
//
// Both fail silently. Compile passes, unit tests pass, English UI renders
// fine, only non-English users notice — months later. This script catches
// both before merge.
//
// Exits 1 on any inconsistency, 0 when clean.
//
// npm scripts:
//   lint:language-coverage  → run this check

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.';
const LANGS_BS_PATH = path.join(ROOT_DIR, 'source/utils/languages.bs');
const EN_US_PATH = path.join(ROOT_DIR, 'locale/custom/en_US.json');

// ============================================================
// Reference: ISO 639-1 (2-letter) → ISO 639-2 (3-letter) variants.
// Used for the alias-coverage check: when the resolver registers a 2-letter
// code in tier 1, the matching 3-letter forms (T = terminological, B =
// bibliographic; B is listed only when it differs from T) must alias to
// that 2-letter code, otherwise ffmpeg-tagged 3-letter input falls through
// to tier 2's English fallback in every UI locale.
//
// Source: https://www.loc.gov/standards/iso639-2/php/code_list.php
// ============================================================
const ISO_639_1_TO_639_2 = {
  af: ['afr'],
  ar: ['ara'],
  as: ['asm'],
  be: ['bel'],
  bg: ['bul'],
  bn: ['ben'],
  br: ['bre'],
  ca: ['cat'],
  cs: ['ces', 'cze'],
  cy: ['cym', 'wel'],
  da: ['dan'],
  de: ['deu', 'ger'],
  dv: ['div'],
  el: ['ell', 'gre'],
  en: ['eng'],
  eo: ['epo'],
  es: ['spa'],
  et: ['est'],
  eu: ['eus', 'baq'],
  fa: ['fas', 'per'],
  fi: ['fin'],
  fo: ['fao'],
  fr: ['fra', 'fre'],
  ga: ['gle'],
  gl: ['glg'],
  gu: ['guj'],
  he: ['heb'],
  hi: ['hin'],
  hr: ['hrv'],
  ht: ['hat'],
  hu: ['hun'],
  hy: ['hye', 'arm'],
  id: ['ind'],
  is: ['isl', 'ice'],
  it: ['ita'],
  ja: ['jpn'],
  ka: ['kat', 'geo'],
  kk: ['kaz'],
  kn: ['kan'],
  ko: ['kor'],
  kw: ['cor'],
  lb: ['ltz'],
  lt: ['lit'],
  lv: ['lav'],
  mg: ['mlg'],
  mi: ['mri', 'mao'],
  mk: ['mkd', 'mac'],
  ml: ['mal'],
  mn: ['mon'],
  mr: ['mar'],
  ms: ['msa', 'may'],
  mt: ['mlt'],
  my: ['mya', 'bur'],
  nb: ['nob'],
  ne: ['nep'],
  nl: ['nld', 'dut'],
  nn: ['nno'],
  no: ['nor'],
  pa: ['pan'],
  pl: ['pol'],
  pt: ['por'],
  ro: ['ron', 'rum'],
  ru: ['rus'],
  si: ['sin'],
  sk: ['slk', 'slo'],
  sl: ['slv'],
  so: ['som'],
  sq: ['sqi', 'alb'],
  sr: ['srp'],
  sv: ['swe'],
  ta: ['tam'],
  te: ['tel'],
  th: ['tha'],
  tr: ['tur'],
  ug: ['uig'],
  uk: ['ukr'],
  ur: ['urd'],
  uz: ['uzb'],
  vi: ['vie'],
  zh: ['zho', 'chi'],
  zu: ['zul'],
};

// ============================================================
// Output formatting (matches scripts/lint/update-translations.cjs style)
// ============================================================
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};
function c(text, color) {
  if (process.platform === 'win32' && !process.env.FORCE_COLOR && !process.stdout.isTTY)
    return text;
  return `${colors[color]}${text}${colors.reset}`;
}

// ============================================================
// Parser: extract an AssocArray literal from a function body in languages.bs
//
// Regex-based on purpose — the function bodies are write-once tables of
// `"key": "value"` / `"key": translationKeys.X` pairs with no other string
// literals. Two assumptions this parser makes; violate either and entries
// will be silently misread:
//
//   1. The body contains NO string literals outside the AA (no comments
//      with `"x": "y"` patterns, no helper string vars). Today the only
//      non-AA code is the cache-guard `if isValid(...) then return ...`.
//   2. Each function declares the AA on a `m.<cache> = { ... }` block
//      bounded by `function <name>()` and the next `\nend function`.
//
// If languages.bs gains real logic, replace this with a tokenizer.
// ============================================================
function parseAA(source, fnName) {
  const fnRe = new RegExp(
    `function\\s+${fnName}\\s*\\(\\)[^\\n]*\\n([\\s\\S]*?)\\nend function`,
    'm',
  );
  const fnMatch = source.match(fnRe);
  if (!fnMatch) throw new Error(`function ${fnName}() not found in languages.bs`);
  const body = fnMatch[1];

  const result = {};
  // Match: "key": value   where value is either a quoted string OR translationKeys.X
  const entryRe = /"([^"]+)"\s*:\s*(?:"([^"]*)"|translationKeys\.([A-Za-z0-9_]+))/g;
  let m;
  while ((m = entryRe.exec(body)) !== null) {
    const [, key, strVal, tkVal] = m;
    result[key] =
      strVal !== undefined
        ? { kind: 'string', value: strVal }
        : { kind: 'translationKey', value: tkVal };
  }
  return result;
}

// ============================================================
// Run checks
// ============================================================
console.log(c('\nLanguage Coverage Check', 'bold'));
console.log(c('========================', 'blue'));

const langsSource = fs.readFileSync(LANGS_BS_PATH, 'utf8');
const aliases = parseAA(langsSource, 'mediaLanguageAliases');
const tier1 = parseAA(langsSource, 'languageTranslationKeys');
const tier2 = parseAA(langsSource, 'languageEnglishFallbacks');
const enUS = JSON.parse(fs.readFileSync(EN_US_PATH, 'utf8'));

console.log(
  `\nLoaded: ${Object.keys(aliases).length} aliases, ${Object.keys(tier1).length} tier-1 keys, ${Object.keys(tier2).length} tier-2 fallbacks`,
);

const errors = [];

// --------------------------------------------------------
// Check 1: every alias target must land somewhere
// --------------------------------------------------------
console.log(c('\n[Alias Targets]', 'cyan'));
const orphanAliases = [];
for (const [src, dst] of Object.entries(aliases)) {
  const target = dst.value;
  const inTier1 = Object.prototype.hasOwnProperty.call(tier1, target);
  const inTier2 = Object.prototype.hasOwnProperty.call(tier2, target);
  if (!inTier1 && !inTier2) {
    orphanAliases.push({ src, target });
  }
}
if (orphanAliases.length === 0) {
  console.log(
    c('  OK', 'green') +
      ` — all ${Object.keys(aliases).length} alias targets resolve in tier 1 or tier 2`,
  );
} else {
  for (const { src, target } of orphanAliases) {
    errors.push(
      `alias "${src}" → "${target}" — target is not in tier 1 nor tier 2 (would render as raw "${target}")`,
    );
  }
}

// --------------------------------------------------------
// Check 2: every tier-1 base with known 3-letter ISO equivalents
// must have those 3-letter codes in the alias map
// --------------------------------------------------------
console.log(c('\n[Tier 1 Localization Parity]', 'cyan'));
const missingAliases = [];
for (const base of Object.keys(tier1)) {
  const variants = ISO_639_1_TO_639_2[base];
  if (!variants) continue; // 3-letter-only tier-1 entries (ckb, fil, gsw, jbo, kab) are fine
  for (const variant of variants) {
    if (!Object.prototype.hasOwnProperty.call(aliases, variant)) {
      missingAliases.push({ base, variant });
    } else if (aliases[variant].value !== base) {
      missingAliases.push({ base, variant, actualTarget: aliases[variant].value });
    }
  }
}
if (missingAliases.length === 0) {
  console.log(
    c('  OK', 'green') + ` — every tier-1 base has its 639-2/T and /B aliases registered`,
  );
} else {
  for (const { base, variant, actualTarget } of missingAliases) {
    if (actualTarget) {
      errors.push(
        `tier 1 has "${base}" but alias "${variant}" → "${actualTarget}" (expected → "${base}")`,
      );
    } else {
      errors.push(
        `tier 1 has "${base}" but missing alias "${variant}" → "${base}" — ffmpeg-tagged audio with code "${variant}" would skip translate() and use tier 2's English string in all UI locales`,
      );
    }
  }
}

// --------------------------------------------------------
// Check 3: every tier-1 translationKey value exists in en_US.json
// (the BSC plugin makes this a compile error in production, but we want
// a fast Node-level signal too so PRs don't have to wait for full validate)
// --------------------------------------------------------
console.log(c('\n[Translation Key Existence]', 'cyan'));
const missingKeys = [];
for (const [base, dst] of Object.entries(tier1)) {
  if (dst.kind !== 'translationKey') continue;
  const key = dst.value;
  if (!Object.prototype.hasOwnProperty.call(enUS, key)) {
    missingKeys.push({ base, key });
  }
}
if (missingKeys.length === 0) {
  console.log(c('  OK', 'green') + ` — every tier-1 translation key exists in en_US.json`);
} else {
  for (const { base, key } of missingKeys) {
    errors.push(
      `tier 1 entry "${base}" → translationKeys.${key} — key "${key}" is not defined in locale/custom/en_US.json`,
    );
  }
}

// ============================================================
// Summary
// ============================================================
console.log(c('\nSummary:', 'bold'));
if (errors.length === 0) {
  console.log(c('  0 errors', 'green'));
  process.exit(0);
} else {
  console.log(c(`  ${errors.length} error(s)`, 'red'));
  for (const err of errors) {
    console.log(c('  ✗ ', 'red') + err);
  }
  process.exit(1);
}
