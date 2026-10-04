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
  const en = ['Kept', 'Shared', 'WeblateOnly'];

  it('keeps a translation only main has — the one the old overwrite threw away', () => {
    const { merged } = mergeLocales({ fr: { Kept: 'Gardé' } }, { fr: {} }, en);
    expect(merged.fr).toEqual({ Kept: 'Gardé' });
  });

  it('lets Weblate win a conflict', () => {
    const { merged } = mergeLocales({ fr: { Shared: 'main' } }, { fr: { Shared: 'weblate' } }, en);
    expect(merged.fr.Shared).toBe('weblate');
  });

  it('takes keys and whole locales only Weblate has', () => {
    const { merged } = mergeLocales({}, { de: { WeblateOnly: 'Nur' } }, en);
    expect(merged.de).toEqual({ WeblateOnly: 'Nur' });
  });

  it('drops keys en_US no longer has, as the Cleanup add-on would', () => {
    const { merged, stats } = mergeLocales(
      { fr: { Gone: 'x' } },
      { fr: { AlsoGone: 'y', Kept: 'z' } },
      en,
    );
    expect(merged.fr).toEqual({ Kept: 'z' });
    expect(stats.fr.dropped).toBe(2);
  });

  it('never touches en_US', () => {
    const { merged } = mergeLocales({ en_US: { Kept: 'a' } }, { en_US: { Kept: 'b' } }, en);
    expect(merged.en_US).toBeUndefined();
  });

  it('is idempotent', () => {
    const base = { fr: { Kept: 'Gardé', Shared: 'main' } };
    const incoming = { fr: { Shared: 'weblate', WeblateOnly: 'w' } };
    const once = mergeLocales(base, incoming, en).merged;
    expect(mergeLocales(once, incoming, en).merged).toEqual(once);
    expect(mergeLocales(incoming, once, en).merged).toEqual(once);
  });
});
