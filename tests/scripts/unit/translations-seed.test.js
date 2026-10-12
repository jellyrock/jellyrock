/**
 * `npm run translations:seed` (`scripts/translations-seed.js`): every refusal the
 * header promises, each pinned by the smallest input that would break it. No
 * network: planning runs on in-memory sources, loading runs on a fixture checkout
 * written to a temp dir.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  formatCommitBody,
  loadSource,
  mapLocales,
  nextLedger,
  normalizeLocaleCode,
  parseKeymap,
  parseSources,
  planSeed,
  rejectReason,
  SeedConfigError,
  serializeLedger,
  suggest,
  verifyLicense,
} from '../../../scripts/translations-seed.js';
import { spawnScript } from './_helpers/spawn-script.js';

const SHA = 'a'.repeat(40);

function source(id, { english, translations, placeholders = 'brace-index', ...rest }) {
  return {
    id,
    ref: 'v1',
    commit: SHA,
    license: 'GPL-2.0-only',
    placeholders,
    ...rest,
    loaded: { english, translations },
  };
}

const web = source('web', {
  english: {
    Actor: 'Actor',
    PersonRole: 'as {0}',
    PriorityIdle: 'Idle',
    Shout: 'DIRECTOR',
    Html: 'Bold',
  },
  translations: {
    fr: { Actor: 'Acteur', PersonRole: '{0}' },
    de: { Actor: 'Schauspieler', PersonRole: 'als' },
    fr_CA: { Actor: 'Acteur' },
    es: { Actor: 'actor' },
  },
});
const tv = source('tv', {
  english: { lbl_actor: 'Actor' },
  translations: { de: { lbl_actor: 'Darsteller' }, nl: { lbl_actor: 'Acteur' } },
  placeholders: 'printf',
});

const locales = () => ({
  en_US: { LabelActor: 'Actor', LabelRoleAs: 'as {0}' },
  fr: {},
  fr_CA: {},
  de: {},
  es: {},
  nl: { LabelActor: 'Al vertaald' },
});

const keymap = {
  LabelActor: {
    en: 'Actor',
    from: { web: { key: 'Actor', en: 'Actor' }, tv: { key: 'lbl_actor', en: 'Actor' } },
  },
  LabelRoleAs: { en: 'as {0}', from: { web: { key: 'PersonRole', en: 'as {0}' } } },
};

describe('planSeed', () => {
  const plan = planSeed({ locales: locales(), sources: [web, tv], keymap });

  it('fills a missing key from the first source in priority order', () => {
    expect(plan.fills.fr.LabelActor).toEqual({ value: 'Acteur', source: 'web' });
    expect(plan.fills.de.LabelActor.source).toBe('web');
  });

  it('never overwrites an existing translation', () => {
    expect(plan.fills.nl?.LabelActor).toBeUndefined();
  });

  it('falls through to the next source when the first is unusable', () => {
    const p = planSeed({
      locales: locales(),
      sources: [web, tv],
      keymap: { LabelRoleAs: keymap.LabelRoleAs },
    });
    // de "als" drops the placeholder — rejected, and tv has no mapping for it.
    expect(p.fills.de?.LabelRoleAs).toBeUndefined();
    expect(p.rejections).toContainEqual({
      key: 'LabelRoleAs',
      locale: 'de',
      source: 'web',
      reason: 'placeholder-mismatch',
    });
  });

  it("keeps a translator's own placeholder placement", () => {
    expect(plan.fills.fr.LabelRoleAs.value).toBe('{0}');
  });

  it('does not copy a base-locale value into a regional locale', () => {
    expect(plan.fills.fr_CA?.LabelActor).toBeUndefined();
    expect(plan.rejections).toContainEqual({
      key: 'LabelActor',
      locale: 'fr_CA',
      source: 'web',
      reason: 'same-as-base-locale',
    });
  });

  it('refuses a value that is the English case-folded, before casing is considered', () => {
    expect(plan.fills.es?.LabelActor).toBeUndefined();
    expect(plan.rejections).toContainEqual({
      key: 'LabelActor',
      locale: 'es',
      source: 'web',
      reason: 'same-as-english',
    });
  });

  it('flags lowercase-first in a cased script and leaves it as written', () => {
    const p = planSeed({
      locales: { en_US: { L: 'Inker' }, sv: {} },
      sources: [
        source('web', { english: { Inker: 'Inker' }, translations: { sv: { Inker: 'bläckare' } } }),
      ],
      keymap: { L: { en: 'Inker', from: { web: { key: 'Inker', en: 'Inker' } } } },
    });
    expect(p.fills.sv.L.value).toBe('bläckare');
    expect(p.flagged).toEqual([{ key: 'L', locale: 'sv', source: 'web', value: 'bläckare' }]);
  });

  it('does not flag a unicameral script', () => {
    const p = planSeed({
      locales: { en_US: { L: 'Play' }, ka: {} },
      sources: [
        source('web', { english: { Play: 'Play' }, translations: { ka: { Play: 'დაკვრა' } } }),
      ],
      keymap: { L: { en: 'Play', from: { web: { key: 'Play', en: 'Play' } } } },
    });
    expect(p.flagged).toEqual([]);
  });

  it('honors a per-cell exclude', () => {
    const p = planSeed({
      locales: locales(),
      sources: [web],
      keymap: {
        LabelActor: {
          en: 'Actor',
          from: { web: { key: 'Actor', en: 'Actor', exclude: { fr: 'reason' } } },
        },
      },
    });
    expect(p.fills.fr?.LabelActor).toBeUndefined();
    expect(p.fills.de.LabelActor).toBeDefined();
  });

  it('stops seeding an entry whose en_US text changed since review', () => {
    const p = planSeed({
      locales: locales(),
      sources: [web],
      keymap: { LabelActor: { ...keymap.LabelActor, en: 'Old text' } },
    });
    expect(p.fills).toEqual({});
    expect(p.stale[0]).toMatchObject({ key: 'LabelActor', reason: 'en-us-changed' });
  });

  it('stops seeding from a source whose English changed since review', () => {
    const p = planSeed({
      locales: locales(),
      sources: [web],
      keymap: { LabelActor: { en: 'Actor', from: { web: { key: 'Actor', en: 'Performer' } } } },
    });
    expect(p.fills).toEqual({});
    expect(p.stale[0]).toMatchObject({
      key: 'LabelActor',
      source: 'web',
      reason: 'source-changed',
    });
  });

  it('refuses an ALL CAPS source string', () => {
    const p = planSeed({
      locales: { en_US: { L: 'Director' }, fr: {} },
      sources: [
        source('web', { english: { D: 'DIRECTOR' }, translations: { fr: { D: 'RÉALISATEUR' } } }),
      ],
      keymap: { L: { en: 'Director', from: { web: { key: 'D', en: 'DIRECTOR' } } } },
    });
    expect(p.fills).toEqual({});
    expect(p.stale[0].reason).toBe('source-all-caps');
  });

  it('converts source placeholders before comparing', () => {
    const p = planSeed({
      locales: { en_US: { L: '{0} Mbps' }, ru: {} },
      sources: [
        source('tv', {
          english: { m: '%1$,.0f Mbit/s' },
          translations: { ru: { m: '%1$,.0f Мбит/с' } },
          placeholders: 'printf',
        }),
      ],
      keymap: { L: { en: '{0} Mbps', from: { tv: { key: 'm', en: '%1$,.0f Mbit/s' } } } },
    });
    expect(p.fills.ru.L.value).toBe('{0} Мбит/с');
  });

  it('reports a keymap entry for a key en_US no longer has', () => {
    const p = planSeed({
      locales: locales(),
      sources: [web],
      keymap: { LabelGone: { en: 'x', from: {} } },
    });
    expect(p.stale[0]).toMatchObject({ key: 'LabelGone', reason: 'unknown-key' });
  });
});

describe('rejectReason', () => {
  const check = (value, enValue = 'Bold', sourceEnglish = 'Bold') =>
    rejectReason({ value, enValue, sourceEnglish });

  it('accepts a real translation', () => expect(check('Gras')).toBeNull());
  it('refuses empty', () => expect(check('  ')).toBe('empty'));
  it('refuses markup en_US lacks', () => expect(check('<b>Gras</b>')).toBe('markup'));
  it('refuses a line break en_US lacks', () => expect(check('Gr\nas')).toBe('newline'));
  it('refuses the English back, case-folded', () => expect(check('BOLD')).toBe('same-as-english'));
  it('refuses a placeholder set that differs', () =>
    expect(check('{0} Gras')).toBe('placeholder-mismatch'));
});

describe('config validation', () => {
  const entry = {
    id: 'web',
    repo: 'https://example.invalid/web.git',
    ref: 'v1',
    commit: SHA,
    license: 'GPL-2.0-only',
    licenseFile: 'LICENSE',
    format: 'json-flat',
    placeholders: 'brace-index',
    english: 'en.json',
    translations: '{locale}.json',
  };
  const yaml = (e) =>
    `sources:\n  - ${Object.entries(e)
      .map(([k, v]) => `${k}: "${v}"`)
      .join('\n    ')}\n`;

  it('accepts a complete entry', () => {
    expect(parseSources(yaml(entry))[0].id).toBe('web');
  });

  it('refuses a license not on the allowlist', () => {
    expect(() => parseSources(yaml({ ...entry, license: 'GPL-3.0-only' }))).toThrow(
      /not on the allowlist/,
    );
  });

  it('refuses a ref without a full commit pin', () => {
    expect(() => parseSources(yaml({ ...entry, commit: 'abc123' }))).toThrow(/40-character SHA/);
  });

  it('refuses an unknown field rather than ignoring a typo', () => {
    expect(() => parseSources(yaml({ ...entry, lisence: 'x' }))).toThrow(/unknown field "lisence"/);
  });

  it('refuses a keymap entry naming an unknown source', () => {
    expect(() =>
      parseKeymap('L:\n  en: x\n  from:\n    nope: { key: a, en: b }\n', ['web']),
    ).toThrow(SeedConfigError);
  });

  it('reads a comments-only keymap as empty', () => {
    expect(parseKeymap('# nothing yet\n', ['web'])).toEqual({});
  });
});

describe('locale mapping', () => {
  const cfg = (format, extra = {}) => ({
    id: 's',
    format,
    localeMap: {},
    skipLocales: [],
    ...extra,
  });
  const jr = [
    'en_US',
    'ar',
    'de',
    'es_419',
    'fil',
    'he',
    'id',
    'nb',
    'pt_BR',
    'zh_Hans',
    'zh_Hant',
    'zh_Hant_HK',
  ];

  it('normalizes each format to JellyRock spelling', () => {
    expect(normalizeLocaleCode('pt-br', 'json-flat')).toBe('pt_BR');
    expect(normalizeLocaleCode('zh-cn', 'json-flat')).toBe('zh_Hans');
    expect(normalizeLocaleCode('zh-hk', 'json-flat')).toBe('zh_Hant_HK');
    expect(normalizeLocaleCode('zh-Hant', 'apple-strings')).toBe('zh_Hant');
    expect(normalizeLocaleCode('b+es+419', 'android-xml')).toBe('es_419');
    expect(normalizeLocaleCode('zh-rTW', 'android-xml')).toBe('zh_Hant');
    expect(normalizeLocaleCode('iw', 'android-xml')).toBe('he');
    expect(normalizeLocaleCode('in', 'android-xml')).toBe('id');
  });

  it('falls back to the base only when the source has no base file of its own', () => {
    expect(mapLocales(['de-DE'], cfg('json-flat'), jr)['de-DE']).toBe('de');
    expect(mapLocales(['nb-NO'], cfg('json-flat'), jr)['nb-NO']).toBe('nb');
    // web ships both ar.json and ar_SA.json; ar_SA must not land on ar.
    expect(mapLocales(['ar', 'ar_SA'], cfg('json-flat'), jr)).toEqual({ ar: 'ar', ar_SA: null });
  });

  it('never maps to en_US, and reports what it cannot map', () => {
    expect(mapLocales(['en-us', 'no-NO'], cfg('json-flat'), jr)).toEqual({
      'en-us': null,
      'no-NO': null,
    });
  });

  it('honors localeMap and refuses two files on one locale', () => {
    expect(mapLocales(['tl'], cfg('android-xml', { localeMap: { tl: 'fil' } }), jr).tl).toBe('fil');
    expect(() => mapLocales(['zh-cn', 'zh_CN'], cfg('json-flat'), jr)).toThrow(
      /both map to zh_Hans/,
    );
  });
});

describe('a fixture checkout', () => {
  function checkout(files) {
    const dir = mkdtempSync(join(tmpdir(), 'jellyrock-seed-'));
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    return dir;
  }
  const cfg = {
    id: 'mpl',
    license: 'MPL-2.0',
    licenseFile: 'LICENSE',
    format: 'json-flat',
    english: 'strings/en.json',
    translations: 'strings/{locale}.json',
    localeMap: {},
    skipLocales: [],
  };

  it('loads English and mapped locales, reporting unmapped ones', () => {
    const dir = checkout({
      'strings/en.json': '{"Actor":"Actor"}',
      'strings/fr.json': '{"Actor":"Acteur"}',
      'strings/xx.json': '{"Actor":"?"}',
    });
    try {
      const loaded = loadSource(cfg, dir, ['en_US', 'fr']);
      expect(loaded.english).toEqual({ Actor: 'Actor' });
      expect(loaded.translations).toEqual({ fr: { Actor: 'Acteur' } });
      expect(loaded.unmapped).toEqual(['xx']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips an MPL file marked Incompatible With Secondary Licenses', () => {
    const dir = checkout({
      'strings/en.json': '{"Actor":"Actor"}',
      'strings/fr.json':
        '{"_":"This Source Code Form is Incompatible With Secondary Licenses","Actor":"Acteur"}',
    });
    try {
      const loaded = loadSource(cfg, dir, ['en_US', 'fr']);
      expect(loaded.translations).toEqual({});
      expect(loaded.skippedFiles[0].file).toBe('strings/fr.json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a LICENSE that does not match the declared license', () => {
    const dir = checkout({ LICENSE: 'GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007' });
    try {
      expect(() => verifyLicense({ ...cfg, license: 'GPL-2.0-only' }, dir)).toThrow(
        /does not read as GPL-2.0-only/,
      );
      expect(() => verifyLicense(cfg, dir)).toThrow(SeedConfigError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a matching LICENSE', () => {
    const dir = checkout({
      LICENSE: 'Mozilla Public License Version 2.0\n==================================',
    });
    try {
      expect(() => verifyLicense(cfg, dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('suggest', () => {
  it('proposes same-English candidates and omits recorded rejections', () => {
    const results = suggest({
      locales: { en_US: { LabelIdle: 'Idle', LabelActor: 'Actor' }, fr: {} },
      sources: [
        source('web', {
          english: { PriorityIdle: 'Idle', Idle: 'idle.' },
          translations: { fr: { Idle: 'Inactif' } },
        }),
      ],
      keymap: {
        LabelIdle: {
          en: 'Idle',
          reject: [{ source: 'web', key: 'PriorityIdle', reason: 'priority' }],
        },
      },
      keys: ['LabelIdle'],
    });
    expect(results[0].candidates).toEqual([{ source: 'web', key: 'Idle', en: 'idle.', fills: 1 }]);
  });
});

describe('formatCommitBody', () => {
  it('records every source used, pinned', () => {
    const plan = planSeed({ locales: locales(), sources: [web, tv], keymap });
    const body = formatCommitBody({ plan, locales: locales(), sources: [web, tv] });
    expect(body).toContain(`Translation-Source: web v1 ${SHA} GPL-2.0-only`);
    expect(body).not.toContain('Translation-Source: tv');
  });
});

describe('the ledger', () => {
  it('never refills a cell it seeded before, so a removal is permanent', () => {
    // fr's LabelActor was seeded once, then deleted (on main or in Weblate).
    const ledger = { fr: { LabelActor: `web@${SHA.slice(0, 12)}` } };
    const plan = planSeed({ locales: locales(), sources: [web, tv], keymap, ledger });
    expect(plan.fills.fr?.LabelActor).toBeUndefined();
    expect(plan.rejections).toContainEqual({
      key: 'LabelActor',
      locale: 'fr',
      source: `web@${SHA.slice(0, 12)}`,
      reason: 'seeded-before',
    });
    expect(plan.fills.de.LabelActor).toBeDefined(); // other cells are untouched
  });

  it('records every fill with its source and pinned commit', () => {
    const plan = planSeed({ locales: locales(), sources: [web, tv], keymap });
    const next = nextLedger({ ledger: {}, plan, sources: [web, tv], locales: locales() });
    expect(next.fr.LabelActor).toBe(`web@${SHA.slice(0, 12)}`);
    expect(next.nl).toBeUndefined(); // nl already had it: not seeded
  });

  it('prunes keys en_US no longer has and locales that are gone', () => {
    const ledger = { fr: { Removed: 'web@x', LabelActor: 'web@x' }, gone: { LabelActor: 'web@x' } };
    const next = nextLedger({ ledger, plan: { fills: {} }, sources: [web], locales: locales() });
    expect(next).toEqual({ fr: { LabelActor: 'web@x' } });
  });

  it('serializes sorted at both levels, so a re-run writes the same bytes', () => {
    expect(serializeLedger({ fr: { b: '2', a: '1' }, de: { z: '0' } })).toBe(
      '{\n  "de": {\n    "z": "0"\n  },\n  "fr": {\n    "a": "1",\n    "b": "2"\n  }\n}\n',
    );
  });

  it('the committed ledger is in canonical form and names only real locale keys', () => {
    const root = join(import.meta.dirname, '..', '..', '..');
    const text = readFileSync(join(root, 'locale/seed/seeded.json'), 'utf8');
    const ledger = JSON.parse(text);
    expect(serializeLedger(ledger)).toBe(text);
    const en = JSON.parse(readFileSync(join(root, 'locale/custom/en_US.json'), 'utf8'));
    for (const keys of Object.values(ledger))
      for (const key of Object.keys(keys)) expect(en).toHaveProperty(key);
  });
});

describe('CLI flags', () => {
  it('rejects a flag with no value instead of reading undefined', () => {
    const r = spawnScript('scripts/translations-seed.js', ['--key']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/--key needs a value/);
  });
});
