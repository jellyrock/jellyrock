// Tests for scripts/lint/language-coverage.cjs.
//
// The script parses three AA tables out of source/utils/languages.bs by
// regex and cross-checks them against locale/custom/en_US.json. Tests use
// synthetic .bs + .json fixtures matching the parser's expected shape:
//
//   function <name>()
//     m.<cache> = {
//       "key": "value"   ← string
//       "key": translationKeys.X   ← translationKey
//     }
//   end function
//
// people.bs also holds an ORDERED table, parsed by parseAAArray():
//
//   function creditRowKinds()
//     m.<cache> = [
//       { kind: "creator", messageKey: translationKeys.X }
//     ]
//   end function

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';

const SCRIPT = 'scripts/lint/language-coverage.cjs';

function buildLanguagesBs({ aliases = {}, tier1 = {}, tier2 = {}, matchAliases = {} }) {
  const aliasEntries = Object.entries(aliases)
    .map(([k, v]) => `    "${k}": "${v}"`)
    .join('\n');
  const matchAliasEntries = Object.entries(matchAliases)
    .map(([k, v]) => `    "${k}": "${v}"`)
    .join('\n');
  const tier1Entries = Object.entries(tier1)
    .map(([k, v]) => {
      // tier 1 values can be either translationKey or string; allow both forms
      if (typeof v === 'string' && v.startsWith('translationKeys.')) {
        return `    "${k}": ${v}`;
      }
      return `    "${k}": "${v}"`;
    })
    .join('\n');
  const tier2Entries = Object.entries(tier2)
    .map(([k, v]) => `    "${k}": "${v}"`)
    .join('\n');

  return `
function mediaLanguageAliases()
  m.aliasCache = {
${aliasEntries}
  }
end function

function languageTranslationKeys()
  m.tier1Cache = {
${tier1Entries}
  }
end function

function languageEnglishFallbacks()
  m.tier2Cache = {
${tier2Entries}
  }
end function

function mediaLanguageMatchAliases()
  m.matchAliasCache = {
${matchAliasEntries}
  }
end function
`;
}

// people.bs holds the OTHER localization table the script gates: PersonKind →
// translation key, plus the set of kinds deliberately rendered blank.
function buildPeopleBs({
  personKinds = {},
  unlabelledKinds = [],
  creditRowKinds = [],
  // Escape hatches for the shape-drift tests: author the array literal's body
  // verbatim, or omit the function / its literal entirely.
  rawCreditRows = null,
  omitCreditRowKinds = false,
  omitCreditRowLiteral = false,
}) {
  const kindEntries = Object.entries(personKinds)
    .map(([k, v]) => `    "${k}": ${v}`)
    .join('\n');
  const unlabelledEntries = unlabelledKinds.map((k) => `    "${k}": true`).join('\n');
  const creditEntries =
    rawCreditRows ??
    creditRowKinds
      .map(
        ({ kind, messageKey }) =>
          `    { kind: "${kind}", messageKey: translationKeys.${messageKey} }`,
      )
      .join(',\n');

  let creditFn = `
function creditRowKinds()
  m.creditRowKindsCache = [
${creditEntries}
  ]
end function
`;
  if (omitCreditRowLiteral) {
    creditFn = `
function creditRowKinds()
  m.creditRowKindsCache = invalid
end function
`;
  }
  if (omitCreditRowKinds) creditFn = '';

  return `
function personKindTranslationKeys()
  m.personKindTranslationKeysCache = {
${kindEntries}
  }
end function

function unlabeledPersonKinds()
  m.unlabeledPersonKindsCache = {
${unlabelledEntries}
  }
end function
${creditFn}`;
}

// The PersonKind defaults are deliberately MINIMAL — one enum value, declared blank,
// needing no en_US key — so the language-table tests above are unaffected by the
// person table existing. Tests that exercise Check 4 pass their own.
function setupTree({
  aliases = {},
  tier1 = {},
  tier2 = {},
  matchAliases = {},
  enUS = {},
  personKinds = {},
  unlabelledKinds = ['unknown'],
  creditRowKinds = [],
  rawCreditRows = null,
  omitCreditRowKinds = false,
  omitCreditRowLiteral = false,
  fingerprints = { 'jellyfin-12.0.json': ['Unknown'] },
}) {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-language-coverage-'));
  mkdirSync(join(dir, 'source', 'utils'), { recursive: true });
  mkdirSync(join(dir, 'locale', 'custom'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'architecture', 'spec-fingerprints'), { recursive: true });
  writeFileSync(
    join(dir, 'source', 'utils', 'languages.bs'),
    buildLanguagesBs({ aliases, tier1, tier2, matchAliases }),
  );
  writeFileSync(
    join(dir, 'source', 'utils', 'people.bs'),
    buildPeopleBs({
      personKinds,
      unlabelledKinds,
      creditRowKinds,
      rawCreditRows,
      omitCreditRowKinds,
      omitCreditRowLiteral,
    }),
  );
  for (const [file, values] of Object.entries(fingerprints)) {
    writeFileSync(
      join(dir, 'docs', 'architecture', 'spec-fingerprints', file),
      JSON.stringify({ schemas: { PersonKind: { enum: values } } }, null, 2),
    );
  }
  writeFileSync(join(dir, 'locale', 'custom', 'en_US.json'), JSON.stringify(enUS, null, 2));
  return dir;
}

describe('language-coverage', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 on a clean fixture', () => {
    dir = setupTree({
      aliases: { eng: 'en', fre: 'fr', fra: 'fr' },
      tier1: { en: 'translationKeys.LanguageEnglish', fr: 'translationKeys.LanguageFrench' },
      tier2: {},
      enUS: { LanguageEnglish: 'English', LanguageFrench: 'French' },
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/0 errors/);
  });

  it('exits 1 on an orphan alias (target not in tier 1 or tier 2)', () => {
    dir = setupTree({
      aliases: { tib: 'bo' }, // "bo" is not in tier 1 or tier 2
      tier1: { en: 'translationKeys.LanguageEnglish' },
      tier2: {},
      enUS: { LanguageEnglish: 'English' },
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/alias "tib" → "bo".*not in tier 1 nor tier 2/);
  });

  it('exits 1 when a tier-1 base lacks its 639-2 alias coverage', () => {
    // sl is in tier 1, but the 639-2 variant slv is missing from aliases
    dir = setupTree({
      aliases: { eng: 'en' }, // no slv → sl
      tier1: { en: 'translationKeys.LanguageEnglish', sl: 'translationKeys.LanguageSlovenian' },
      tier2: {},
      enUS: { LanguageEnglish: 'English', LanguageSlovenian: 'Slovenian' },
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/missing alias "slv"/);
  });

  it('exits 1 when a tier-1 translationKey does not exist in en_US.json', () => {
    dir = setupTree({
      aliases: { eng: 'en' },
      tier1: { en: 'translationKeys.LanguageEnglish' },
      tier2: {},
      enUS: {}, // missing LanguageEnglish
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/key "LanguageEnglish" is not defined/);
  });

  it('does not require alias coverage for 3-letter-only tier-1 entries', () => {
    // ckb (Sorani Kurdish) is a tier-1 entry with no 639-1 form; the
    // ISO_639_1_TO_639_2 map has no entry for "ckb", so the script
    // skips the alias-coverage check for it.
    dir = setupTree({
      aliases: { eng: 'en' },
      tier1: {
        en: 'translationKeys.LanguageEnglish',
        ckb: 'translationKeys.LanguageSorani',
      },
      tier2: {},
      enUS: { LanguageEnglish: 'English', LanguageSorani: 'Sorani Kurdish' },
    });
    const { exitCode } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
  });
});

describe('language-coverage — match alias supplement', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const base = {
    aliases: { eng: 'en' },
    tier1: { en: 'translationKeys.LanguageEnglish' },
    enUS: { LanguageEnglish: 'English' },
  };

  it('exits 0 when the match aliases only supplement the display aliases', () => {
    dir = setupTree({ ...base, matchAliases: { swa: 'sw', bod: 'bo', tib: 'bo' } });
    const { exitCode } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
  });

  it('exits 1 when a match alias duplicates a display alias', () => {
    dir = setupTree({ ...base, matchAliases: { eng: 'en' } });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/match alias "eng" is also in mediaLanguageAliases\(\)/);
  });

  it('exits 1 when a match alias is not 639-2 → 639-1', () => {
    dir = setupTree({ ...base, matchAliases: { sw: 'swa' } });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/match alias "sw" → "swa" — expected a 3-letter/);
  });
});

describe('language-coverage — PersonKind coverage', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const CLEAN_LANG = {
    aliases: { eng: 'en' },
    tier1: { en: 'translationKeys.LanguageEnglish' },
    tier2: {},
  };

  it('exits 0 when every enum value is labelled or declared blank', () => {
    dir = setupTree({
      ...CLEAN_LANG,
      enUS: { LanguageEnglish: 'English', LabelPersonKindActor: 'Actor' },
      fingerprints: { 'jellyfin-12.0.json': ['Actor', 'Unknown'] },
      personKinds: { actor: 'translationKeys.LabelPersonKindActor' },
      unlabelledKinds: ['unknown'],
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/every PersonKind value is labelled or deliberately blank/);
  });

  it('exits 1 when an enum value has no row in either table', () => {
    // The exact defect this check was added for: nine values shipped with no row and
    // rendered as raw English, because a missing row is not a compile error.
    dir = setupTree({
      ...CLEAN_LANG,
      enUS: { LanguageEnglish: 'English', LabelPersonKindActor: 'Actor' },
      fingerprints: { 'jellyfin-12.0.json': ['Actor', 'Narrator', 'Unknown'] },
      personKinds: { actor: 'translationKeys.LabelPersonKindActor' },
      unlabelledKinds: ['unknown'],
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/PersonKind "Narrator" has no row/);
  });

  it('unions the enum across fingerprints rather than trusting the newest', () => {
    // A value present only on an OLDER supported line still has to render: the app
    // talks to 10.7 → 12.x simultaneously.
    dir = setupTree({
      ...CLEAN_LANG,
      enUS: { LanguageEnglish: 'English', LabelPersonKindActor: 'Actor' },
      fingerprints: {
        'jellyfin-10.11.8.json': ['Actor', 'Editor', 'Unknown'],
        'jellyfin-12.0.json': ['Actor', 'Unknown'],
      },
      personKinds: { actor: 'translationKeys.LabelPersonKindActor' },
      unlabelledKinds: ['unknown'],
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/PersonKind "Editor" has no row/);
  });

  it('ignores a fingerprint that predates the enum instead of failing on it', () => {
    // 10.7.0 has no PersonKind schema at all. It must contribute nothing, not error.
    dir = setupTree({
      ...CLEAN_LANG,
      enUS: { LanguageEnglish: 'English', LabelPersonKindActor: 'Actor' },
      fingerprints: {
        'jellyfin-10.7.0.json': [],
        'jellyfin-12.0.json': ['Actor', 'Unknown'],
      },
      personKinds: { actor: 'translationKeys.LabelPersonKindActor' },
      unlabelledKinds: ['unknown'],
    });
    const { exitCode } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
  });

  it('exits 1 when a kind is declared both labelled and blank', () => {
    dir = setupTree({
      ...CLEAN_LANG,
      enUS: { LanguageEnglish: 'English', LabelPersonKindActor: 'Actor' },
      fingerprints: { 'jellyfin-12.0.json': ['Actor', 'Unknown'] },
      personKinds: {
        actor: 'translationKeys.LabelPersonKindActor',
        unknown: 'translationKeys.LabelPersonKindActor',
      },
      unlabelledKinds: ['unknown'],
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/is in BOTH/);
  });

  it('exits 1 on a stale row for a kind no supported server sends', () => {
    dir = setupTree({
      ...CLEAN_LANG,
      enUS: { LanguageEnglish: 'English', LabelPersonKindActor: 'Actor' },
      fingerprints: { 'jellyfin-12.0.json': ['Unknown'] },
      personKinds: { choreographer: 'translationKeys.LabelPersonKindActor' },
      unlabelledKinds: ['unknown'],
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/lists "choreographer".*stale row/s);
  });

  it("exits 1 when a kind's translation key is missing from en_US.json", () => {
    dir = setupTree({
      ...CLEAN_LANG,
      enUS: { LanguageEnglish: 'English' }, // no LabelPersonKindActor
      fingerprints: { 'jellyfin-12.0.json': ['Actor', 'Unknown'] },
      personKinds: { actor: 'translationKeys.LabelPersonKindActor' },
      unlabelledKinds: ['unknown'],
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/key "LabelPersonKindActor" is not defined/);
  });

  // ── creditRowKinds(): the ordered table that drives the details screen's
  // per-kind credit lines. It sat outside every check until #1000, because the
  // gate finds its tables by function name AND parses an AA, while this one is
  // an array.
  it('exits 0 when a credit row names an enum kind whose label key exists', () => {
    dir = setupTree({
      ...CLEAN_LANG,
      enUS: {
        LanguageEnglish: 'English',
        LabelPersonKindActor: 'Actor',
        MessageCreatedBy1: 'Created by {0}',
      },
      fingerprints: { 'jellyfin-12.0.json': ['Actor', 'Creator', 'Unknown'] },
      personKinds: { actor: 'translationKeys.LabelPersonKindActor' },
      unlabelledKinds: ['unknown', 'creator'],
      creditRowKinds: [{ kind: 'creator', messageKey: 'MessageCreatedBy1' }],
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/1 credit row kind\(s\) resolve/);
  });

  it('exits 1 when a credit row names a kind no supported server sends', () => {
    // The defect this check closes: upstream renames or drops `Creator`, the
    // "Created by" line silently renders empty, and every other check stays green.
    dir = setupTree({
      ...CLEAN_LANG,
      enUS: { LanguageEnglish: 'English', MessageCreatedBy1: 'Created by {0}' },
      fingerprints: { 'jellyfin-12.0.json': ['Actor', 'Unknown'] },
      personKinds: {},
      unlabelledKinds: ['unknown', 'actor'],
      creditRowKinds: [{ kind: 'creator', messageKey: 'MessageCreatedBy1' }],
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/creditRowKinds\(\) names kind "creator", which is not a PersonKind/);
  });

  it("exits 1 when a credit row's message key is not in en_US.json", () => {
    dir = setupTree({
      ...CLEAN_LANG,
      enUS: { LanguageEnglish: 'English' }, // no MessageCreatedBy1
      fingerprints: { 'jellyfin-12.0.json': ['Creator', 'Unknown'] },
      personKinds: {},
      unlabelledKinds: ['unknown', 'creator'],
      creditRowKinds: [{ kind: 'creator', messageKey: 'MessageCreatedBy1' }],
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/key "MessageCreatedBy1" is not defined/);
  });

  it('exits 0 on a genuinely empty credit-row table', () => {
    // The one quiet answer, and only because the literal provably holds nothing.
    dir = setupTree({
      ...CLEAN_LANG,
      enUS: { LanguageEnglish: 'English' },
      fingerprints: { 'jellyfin-12.0.json': ['Unknown'] },
      creditRowKinds: [],
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/0 credit row kind\(s\) resolve/);
  });

  it('fails loudly when the credit-row table holds entries it cannot read', () => {
    // Shape drift must not read as "no credit rows to check". An entry authored in a
    // form the parser does not know would otherwise disable this check silently —
    // exactly how the table escaped the gate in the first place.
    dir = setupTree({
      ...CLEAN_LANG,
      enUS: { LanguageEnglish: 'English' },
      fingerprints: { 'jellyfin-12.0.json': ['Unknown'] },
      rawCreditRows: '    { kind: "creator" }',
    });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/every entry needs/);
  });

  it('fails loudly when the table is re-authored to a shape with no AA entries', () => {
    // Found while mutation-checking the guard above: keying "is it empty?" on the
    // presence of a brace let a literal of bare strings parse to zero entries and
    // pass. An empty table is quiet; a NON-empty one it cannot read must not be.
    dir = setupTree({
      ...CLEAN_LANG,
      enUS: { LanguageEnglish: 'English' },
      fingerprints: { 'jellyfin-12.0.json': ['Unknown'] },
      rawCreditRows: '    "creator"',
    });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/parsed no entries from/);
  });

  it('fails loudly when the credit-row table is gone entirely', () => {
    dir = setupTree({
      ...CLEAN_LANG,
      enUS: { LanguageEnglish: 'English' },
      fingerprints: { 'jellyfin-12.0.json': ['Unknown'] },
      omitCreditRowKinds: true,
    });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/function creditRowKinds\(\) not found/);
  });

  it('fails loudly when the credit-row table no longer holds an array literal', () => {
    dir = setupTree({
      ...CLEAN_LANG,
      enUS: { LanguageEnglish: 'English' },
      fingerprints: { 'jellyfin-12.0.json': ['Unknown'] },
      omitCreditRowLiteral: true,
    });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/no `= \[ … \]` array literal/);
  });

  it('fails loudly when no fingerprint defines the enum, rather than passing silently', () => {
    // A skip would be indistinguishable from full coverage — the precise failure mode
    // the whole check exists to prevent.
    dir = setupTree({
      ...CLEAN_LANG,
      enUS: { LanguageEnglish: 'English' },
      fingerprints: {},
      personKinds: {},
      unlabelledKinds: ['unknown'],
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stdout).toMatch(/no committed fingerprint .* defines/s);
  });
});
