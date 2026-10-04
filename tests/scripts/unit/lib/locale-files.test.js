/**
 * `scripts/lib/locale-files.cjs` — the canonical locale-file form and the key-level
 * merge release prep uses instead of overwriting main's locale files with weblate's.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const {
  baseChain,
  mergeLocales,
  serializeLocale,
  writeLocaleFile,
} = require('../../../../scripts/lib/locale-files.cjs');

describe('serializeLocale', () => {
  it('writes the form Weblate and update-translations write: sorted, 2-space, newline', () => {
    expect(serializeLocale({ b: '2', a: '1', B: '3' })).toBe(
      '{\n  "B": "3",\n  "a": "1",\n  "b": "2"\n}\n',
    );
  });

  it('matches every committed locale file byte for byte', () => {
    const dir = join(import.meta.dirname, '..', '..', '..', '..', 'locale', 'custom');
    for (const name of ['fr.json', 'zh_Hant_HK.json', 'en_US.json']) {
      const text = readFileSync(join(dir, name), 'utf8');
      expect(serializeLocale(JSON.parse(text))).toBe(text);
    }
  });
});

describe('writeLocaleFile', () => {
  it('reports a no-op write as unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jellyrock-locale-files-'));
    try {
      expect(writeLocaleFile(dir, 'fr', { a: 'b' })).toBe(true);
      expect(writeLocaleFile(dir, 'fr', { a: 'b' })).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('baseChain', () => {
  // Mirrors loadLocaleFile() / loadChineseLocaleFile() in source/utils/translate.bs.
  it('layers the way the runtime loader does', () => {
    expect(baseChain('fr')).toEqual([]);
    expect(baseChain('fr_CA')).toEqual(['fr']);
    expect(baseChain('es_419')).toEqual(['es']);
    expect(baseChain('zh_Hans')).toEqual(['zh']);
    expect(baseChain('zh_Hant_HK')).toEqual(['zh', 'zh_Hant']);
    expect(baseChain('x-pirate')).toEqual([]);
  });
});

describe('mergeLocales', () => {
  const enKeys = ['K', 'Other'];
  // One key, every combination of what each side did since the ancestor.
  const merge = (a, o, t) =>
    mergeLocales({
      ancestor: a === undefined ? {} : { fr: { K: a } },
      ours: o === undefined ? { fr: {} } : { fr: { K: o } },
      theirs: t === undefined ? { fr: {} } : { fr: { K: t } },
      enKeys,
    });

  it.each([
    // ancestor, ours, theirs → result
    ['a', 'a', 'a', 'a'], //            nobody changed it
    ['a', 'main', 'a', 'main'], //      fixed on main: main's fix survives
    ['a', 'a', 'web', 'web'], //        changed in Weblate
    ['a', 'main', 'web', 'web'], //     changed on both: Weblate wins
    ['a', 'same', 'same', 'same'], //   changed on both, identically
    ['a', undefined, 'a', undefined], // deleted on main: stays deleted
    ['a', 'a', undefined, undefined], // deleted in Weblate: stays deleted
    ['a', undefined, undefined, undefined], // deleted on both
    ['a', undefined, 'web', 'web'], //  deleted on main, changed in Weblate: Weblate wins
    ['a', 'main', undefined, undefined], // changed on main, deleted in Weblate: Weblate wins
    [undefined, 'main', undefined, 'main'], // added on main (a seed)
    [undefined, undefined, 'web', 'web'], // added in Weblate
    [undefined, 'main', 'web', 'web'], // added on both, differently: Weblate wins
  ])('ancestor %j, ours %j, theirs %j → %j', (a, o, t, expected) => {
    expect(merge(a, o, t).merged.fr.K).toBe(expected);
  });

  it('lists exactly the keys both sides changed differently', () => {
    expect(merge('a', 'main', 'web').conflicts).toEqual([
      { locale: 'fr', key: 'K', ours: 'main', theirs: 'web' },
    ]);
    expect(merge('a', 'a', 'web').conflicts).toEqual([]);
    expect(merge('a', 'same', 'same').conflicts).toEqual([]);
  });

  it('counts where each value came from and what was deleted', () => {
    expect(merge('a', 'main', 'a').stats.fr).toMatchObject({ fromOurs: 1, fromTheirs: 0 });
    expect(merge('a', 'a', 'web').stats.fr).toMatchObject({ fromOurs: 0, fromTheirs: 1 });
    expect(merge('a', 'a', undefined).stats.fr).toMatchObject({ deleted: 1 });
  });

  it('with no ancestor, is the two-way union with Weblate winning', () => {
    const { merged } = mergeLocales({
      ours: { fr: { K: 'main' } },
      theirs: { fr: { K: 'web', Other: 'w' }, de: { K: 'nur' } },
      enKeys,
    });
    expect(merged).toEqual({ de: { K: 'nur' }, fr: { K: 'web', Other: 'w' } });
  });

  it('drops keys en_US no longer has, as the Cleanup add-on would', () => {
    const { merged, stats } = mergeLocales({
      ancestor: { fr: { Gone: 'x' } },
      ours: { fr: { Gone: 'x' } },
      theirs: { fr: { AlsoGone: 'y', K: 'z' } },
      enKeys,
    });
    expect(merged.fr).toEqual({ K: 'z' });
    expect(stats.fr.dropped).toBe(2);
  });

  it('never touches en_US', () => {
    const { merged } = mergeLocales({
      ours: { en_US: { K: 'a' } },
      theirs: { en_US: { K: 'b' } },
      enKeys,
    });
    expect(merged.en_US).toBeUndefined();
  });

  it('is idempotent: merging the result again changes nothing', () => {
    const ancestor = { fr: { K: 'a', Other: 'o' } };
    const ours = { fr: { K: 'main' } };
    const theirs = { fr: { K: 'a', Other: 'o2' } };
    const once = mergeLocales({ ancestor, ours, theirs, enKeys }).merged;
    expect(mergeLocales({ ancestor, ours: once, theirs, enKeys }).merged).toEqual(once);
    expect(mergeLocales({ ancestor: once, ours: once, theirs: once, enKeys }).merged).toEqual(once);
  });
});
