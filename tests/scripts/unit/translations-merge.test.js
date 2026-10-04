/**
 * `npm run translations:merge` (`scripts/translations-merge.js`), on real
 * directories: the release-prep property it exists for is that a translation added
 * on main survives a release, which the old `git checkout origin/weblate --` lost.
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mergeDirs } from '../../../scripts/translations-merge.js';

function dirWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-merge-'));
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(files))
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(data, null, 2) + '\n');
  return dir;
}

describe('mergeDirs', () => {
  it('keeps main-side additions, lets Weblate win, leaves en_US alone, and is idempotent', () => {
    const en = { Seeded: 'Seeded', Translated: 'Translated' };
    const main = dirWith({ en_US: en, fr: { Seeded: 'Semé', Translated: 'old' } });
    const weblate = dirWith({
      en_US: { Translated: 'Translated' },
      fr: { Translated: 'Traduit' },
      de: { Translated: 'Übersetzt' },
    });
    try {
      const first = mergeDirs({ baseDir: main, incomingDir: weblate });
      expect(JSON.parse(readFileSync(join(main, 'fr.json'), 'utf8'))).toEqual({
        Seeded: 'Semé',
        Translated: 'Traduit',
      });
      expect(JSON.parse(readFileSync(join(main, 'de.json'), 'utf8'))).toEqual({
        Translated: 'Übersetzt',
      });
      expect(JSON.parse(readFileSync(join(main, 'en_US.json'), 'utf8'))).toEqual(en);
      expect(first.kept).toBe(1);
      expect(first.changed.sort()).toEqual(['de', 'fr']);

      // Second leg: send main's result into the weblate snapshot, Weblate still winning.
      mergeDirs({
        baseDir: main,
        incomingDir: weblate,
        enFile: join(main, 'en_US.json'),
        outDir: weblate,
      });
      expect(JSON.parse(readFileSync(join(weblate, 'fr.json'), 'utf8'))).toEqual({
        Seeded: 'Semé',
        Translated: 'Traduit',
      });

      expect(mergeDirs({ baseDir: main, incomingDir: weblate }).changed).toEqual([]);
    } finally {
      rmSync(main, { recursive: true, force: true });
      rmSync(weblate, { recursive: true, force: true });
    }
  });
});
