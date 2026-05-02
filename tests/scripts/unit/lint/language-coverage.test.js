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

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';

const SCRIPT = 'scripts/lint/language-coverage.cjs';

function buildLanguagesBs({ aliases = {}, tier1 = {}, tier2 = {} }) {
  const aliasEntries = Object.entries(aliases)
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
`;
}

function setupTree({ aliases = {}, tier1 = {}, tier2 = {}, enUS = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-language-coverage-'));
  mkdirSync(join(dir, 'source', 'utils'), { recursive: true });
  mkdirSync(join(dir, 'locale', 'custom'), { recursive: true });
  writeFileSync(
    join(dir, 'source', 'utils', 'languages.bs'),
    buildLanguagesBs({ aliases, tier1, tier2 }),
  );
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
