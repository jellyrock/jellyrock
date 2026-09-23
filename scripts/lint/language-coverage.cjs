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
//   3. PERSONKIND WITHOUT A LABEL — `source/utils/people.bs` maps every
//      `PersonKind` enum value to a translation key (or declares it
//      deliberately unlabelled). A value with NO row in either table is
//      rendered as raw English enum text. This is NOT a compile error —
//      a missing row has no expression to fail on — which is exactly how
//      nine of the twenty-six values shipped untranslated. The enum is
//      read from the committed spec fingerprints, so the check needs no
//      network and no gitignored API cache.
//
//   4. A CREDIT ROW NAMING A KIND THE SERVER NO LONGER SENDS —
//      `creditRowKinds()` drives the details screen's per-kind credit lines
//      ("Created by", "Directed by") by naming `PersonKind` values. If
//      upstream renames or drops one, the matching line silently renders
//      empty: nothing throws, no row is missing, the label just never has
//      anyone to name. Same silence as class 3, and the same fix — check
//      the named kinds against the committed enum.
//
// All fail silently. Compile passes, unit tests pass, English UI renders
// fine, only non-English users notice — months later. This script catches
// them before merge.
//
// Despite the name this covers BOTH localization lookup tables — the
// language resolver and the person-label resolver. They share the same
// `m.<cache> = { … }` authoring shape and the same failure mode, so they
// share a parser and a gate rather than drifting across two scripts.
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
const PEOPLE_BS_PATH = path.join(ROOT_DIR, 'source/utils/people.bs');
const EN_US_PATH = path.join(ROOT_DIR, 'locale/custom/en_US.json');
// Committed, network-free source of truth for server enums. `.api-watch/cache/` holds
// the raw specs but is gitignored, so it does not exist in CI — these do.
const FINGERPRINT_DIR = path.join(ROOT_DIR, 'docs/architecture/spec-fingerprints');

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
// Values may be a quoted string, `translationKeys.X`, or a bare `true`
// (a SET — `unlabeledPersonKinds()` in people.bs uses that shape).
//
// If either table gains real logic, replace this with a tokenizer.
// ============================================================
function parseAA(source, fnName, fileLabel) {
  const fnRe = new RegExp(
    `function\\s+${fnName}\\s*\\(\\)[^\\n]*\\n([\\s\\S]*?)\\nend function`,
    'm',
  );
  const fnMatch = source.match(fnRe);
  if (!fnMatch) throw new Error(`function ${fnName}() not found in ${fileLabel}`);
  const body = fnMatch[1];

  const result = {};
  // Match: "key": value   where value is a quoted string, translationKeys.X, or `true`
  const entryRe = /"([^"]+)"\s*:\s*(?:"([^"]*)"|translationKeys\.([A-Za-z0-9_]+)|(true))/g;
  let m;
  while ((m = entryRe.exec(body)) !== null) {
    const [, key, strVal, tkVal, flagVal] = m;
    if (strVal !== undefined) result[key] = { kind: 'string', value: strVal };
    else if (tkVal !== undefined) result[key] = { kind: 'translationKey', value: tkVal };
    else result[key] = { kind: 'flag', value: flagVal };
  }
  return result;
}

// ============================================================
// Parse an ARRAY of AAs: `m.<cache> = [ { kind: "x", messageKey: translationKeys.Y }, … ]`
//
// A second shape rather than a second parser by accident: `creditRowKinds()`
// is ordered (the credit lines render in array order), so it cannot be an AA,
// and parseAA() above finds its tables BY FUNCTION NAME while parsing an AA —
// so this table sat outside every check until it was added here.
//
// Keys are UNQUOTED here (`kind:`, not `"kind":`), matching how the table is
// actually authored.
//
// Absence is never confused with failure, the same discipline the PersonKind
// enum read applies below: a missing function, a missing array literal, an
// entry that parses to nothing, and an entry missing either field are all
// LOUD. A genuinely empty `[]` is the one quiet answer, and it is quiet only
// because the literal provably holds no entries. Without that split, a shape
// change to the table would disable this check silently — which is the exact
// failure class the check exists to close.
// ============================================================
function parseAAArray(source, fnName, fileLabel) {
  const fnRe = new RegExp(
    `function\\s+${fnName}\\s*\\(\\)[^\\n]*\\n([\\s\\S]*?)\\nend function`,
    'm',
  );
  const fnMatch = source.match(fnRe);
  if (!fnMatch) throw new Error(`function ${fnName}() not found in ${fileLabel}`);
  const body = fnMatch[1];

  const litMatch = body.match(/=\s*\[([\s\S]*?)\]/);
  if (!litMatch) {
    throw new Error(
      `${fnName}() in ${fileLabel} has no \`= [ … ]\` array literal — the table's shape ` +
        `changed and this check can no longer read it.`,
    );
  }
  const literal = litMatch[1];

  const entries = [];
  const entryRe = /\{([^}]*)\}/g;
  let m;
  while ((m = entryRe.exec(literal)) !== null) {
    const inner = m[1];
    const kind = inner.match(/\bkind\s*:\s*"([^"]*)"/);
    const messageKey = inner.match(/\bmessageKey\s*:\s*translationKeys\.([A-Za-z0-9_]+)/);
    if (!kind || !messageKey) {
      throw new Error(
        `${fnName}() in ${fileLabel} has an entry this check cannot read ` +
          `({${inner.trim()}}) — every entry needs \`kind: "x"\` and ` +
          `\`messageKey: translationKeys.Y\`.`,
      );
    }
    entries.push({ kind: kind[1], messageKey: messageKey[1] });
  }

  // Quiet ONLY for a literal that provably holds nothing. Keying this on `{`
  // would let a re-authoring to bare strings (`[ "creator" ]`) parse to zero
  // entries and pass, so the test is whether the literal holds any CONTENT at
  // all, not whether it has braces.
  if (entries.length === 0 && literal.trim() !== '') {
    throw new Error(
      `${fnName}() in ${fileLabel} holds content this check parsed no entries from ` +
        `(\`${literal.trim()}\`) — the table's shape changed and the check would pass ` +
        `vacuously.`,
    );
  }
  return entries;
}

// ============================================================
// Run checks
// ============================================================
console.log(c('\nLanguage Coverage Check', 'bold'));
console.log(c('========================', 'blue'));

const langsSource = fs.readFileSync(LANGS_BS_PATH, 'utf8');
const aliases = parseAA(langsSource, 'mediaLanguageAliases', 'languages.bs');
const tier1 = parseAA(langsSource, 'languageTranslationKeys', 'languages.bs');
const tier2 = parseAA(langsSource, 'languageEnglishFallbacks', 'languages.bs');
const matchAliases = parseAA(langsSource, 'mediaLanguageMatchAliases', 'languages.bs');
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

// --------------------------------------------------------
// Check 3b: the matching-only alias map supplements the display alias map, never
// overlaps it. languageBaseCode() consults the display map first, so an overlapping
// entry is dead at best and a silent contradiction at worst; and a display alias
// moved here by mistake would change nothing visible, but the reverse (a matching
// alias moved into the display map) breaks tier-2 names — see mediaLanguageMatchAliases().
// --------------------------------------------------------
console.log(c('\n[Match Alias Supplement]', 'cyan'));
const badMatchAliases = [];
for (const [src, dst] of Object.entries(matchAliases)) {
  if (Object.prototype.hasOwnProperty.call(aliases, src)) {
    badMatchAliases.push(`match alias "${src}" is also in mediaLanguageAliases() — keep one copy`);
  }
  if (!/^[a-z]{3}$/.test(src) || !/^[a-z]{2}$/.test(dst.value)) {
    badMatchAliases.push(
      `match alias "${src}" → "${dst.value}" — expected a 3-letter ISO 639-2 code mapped to a 2-letter ISO 639-1 code`,
    );
  }
}
if (badMatchAliases.length === 0) {
  console.log(
    c('  OK', 'green') +
      ` — ${Object.keys(matchAliases).length} match aliases, none overlapping the display map`,
  );
} else {
  errors.push(...badMatchAliases);
}

// --------------------------------------------------------
// Check 4: every `PersonKind` value is either labelled or deliberately blank
//
// Source of truth is the UNION of `schemas.PersonKind.enum` across every committed
// fingerprint, not the newest one: the app supports 10.7 → 12.x simultaneously, so a
// value present on any supported line must render. (10.7.0 predates the enum and
// contributes nothing; no special-casing needed.) A value dropped upstream keeps its
// string harmlessly, a value added anywhere is required.
// --------------------------------------------------------
console.log(c('\n[PersonKind Coverage]', 'cyan'));

/** Union of PersonKind enum values across committed fingerprints, or null if none define it. */
function readPersonKindEnum() {
  let files;
  try {
    files = fs
      .readdirSync(FINGERPRINT_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();
  } catch {
    return null;
  }
  const union = new Map(); // lowercased → canonical spelling
  const sources = [];
  for (const file of files) {
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(path.join(FINGERPRINT_DIR, file), 'utf8'));
    } catch {
      continue;
    }
    const values = doc?.schemas?.PersonKind?.enum;
    if (!Array.isArray(values) || values.length === 0) continue;
    sources.push(file);
    for (const v of values) union.set(String(v).toLowerCase(), String(v));
  }
  return sources.length === 0 ? null : { union, sources };
}

const personKindEnum = readPersonKindEnum();

if (personKindEnum === null) {
  // Loud, not silent. A skip here is indistinguishable from full coverage, which is the
  // precise failure this check exists to prevent.
  errors.push(
    'no committed fingerprint under docs/architecture/spec-fingerprints/ defines ' +
      'schemas.PersonKind — person-label coverage cannot be verified. Run ' +
      '`npm run docs:spec-fingerprints`.',
  );
} else {
  const peopleSource = fs.readFileSync(PEOPLE_BS_PATH, 'utf8');
  const kindKeys = parseAA(peopleSource, 'personKindTranslationKeys', 'people.bs');
  const unlabelled = parseAA(peopleSource, 'unlabeledPersonKinds', 'people.bs');
  const { union, sources } = personKindEnum;

  console.log(
    `  ${union.size} PersonKind value(s) across ${sources.length} fingerprint(s); ` +
      `${Object.keys(kindKeys).length} labelled, ${Object.keys(unlabelled).length} deliberately blank`,
  );

  const before = errors.length;

  // 4a. Every enum value is classified.
  for (const [lower, canonical] of union) {
    const labelled = Object.prototype.hasOwnProperty.call(kindKeys, lower);
    const blank = Object.prototype.hasOwnProperty.call(unlabelled, lower);
    if (!labelled && !blank) {
      errors.push(
        `PersonKind "${canonical}" has no row in personKindTranslationKeys() nor ` +
          `unlabeledPersonKinds() (source/utils/people.bs) — it would render as raw ` +
          `English. Add a LabelPersonKind${canonical} key, or declare it deliberately blank.`,
      );
    } else if (labelled && blank) {
      errors.push(
        `PersonKind "${canonical}" is in BOTH personKindTranslationKeys() and ` +
          `unlabeledPersonKinds() (source/utils/people.bs) — the two must be disjoint.`,
      );
    }
  }

  // 4b. No stale rows for a value no supported server sends.
  for (const table of ['personKindTranslationKeys', 'unlabeledPersonKinds']) {
    const entries = table === 'personKindTranslationKeys' ? kindKeys : unlabelled;
    for (const lower of Object.keys(entries)) {
      if (!union.has(lower)) {
        errors.push(
          `${table}() lists "${lower}", which is not a PersonKind value in any committed ` +
            `fingerprint (${sources.join(', ')}) — stale row.`,
        );
      }
    }
  }

  // 4c. Same key-existence guarantee Check 3 gives the language table.
  for (const [lower, dst] of Object.entries(kindKeys)) {
    if (dst.kind !== 'translationKey') continue;
    if (!Object.prototype.hasOwnProperty.call(enUS, dst.value)) {
      errors.push(
        `PersonKind "${lower}" → translationKeys.${dst.value} — key "${dst.value}" is not ` +
          `defined in locale/custom/en_US.json`,
      );
    }
  }

  // 4d. Every kind a credit ROW names is still a value the server sends, and its
  // label key exists. `creditRowKinds()` is an ordered array, so it is read with
  // parseAAArray() rather than parseAA().
  const creditRows = parseAAArray(peopleSource, 'creditRowKinds', 'people.bs');
  for (const { kind, messageKey } of creditRows) {
    if (!union.has(kind.toLowerCase())) {
      errors.push(
        `creditRowKinds() names kind "${kind}", which is not a PersonKind value in any ` +
          `committed fingerprint (${sources.join(', ')}) — that credit line would render ` +
          `empty with every other check green.`,
      );
    }
    if (!Object.prototype.hasOwnProperty.call(enUS, messageKey)) {
      errors.push(
        `creditRowKinds() kind "${kind}" → translationKeys.${messageKey} — key ` +
          `"${messageKey}" is not defined in locale/custom/en_US.json`,
      );
    }
  }

  if (errors.length === before) {
    console.log(
      c('  OK', 'green') +
        ' — every PersonKind value is labelled or deliberately blank, and ' +
        `${creditRows.length} credit row kind(s) resolve`,
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
