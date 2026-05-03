// Fixture helper for tests that drive scripts/lint/update-translations.cjs.
//
// Builds a temp dir with a synthetic locale + source-file layout matching what
// the script expects (locale/custom/*.json, locale/languages.json, source/**/*.bs,
// components/**/*.bs). Specs compose this with spawnScript() to invoke the
// script-under-test against the fixture.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

function serialize(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) + '\n';
}

function writeFile(dir, relPath, contents) {
  const fullPath = join(dir, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, typeof contents === 'string' ? contents : serialize(contents));
}

/**
 * Build a temp locale fixture directory.
 *
 * @param {object} opts
 * @param {object|string} [opts.en_US]         Becomes locale/custom/en_US.json. Object → JSON-stringified; string → written verbatim (use for malformed-JSON scenarios).
 * @param {Object<string, object|string>} [opts.locales]  Additional locale/custom/<code>.json files keyed by locale code.
 * @param {Array<object>|string} [opts.languagesJson]     Optional locale/languages.json contents.
 * @param {Object<string, string>} [opts.sources]         Synthetic source-tree files keyed by repo-relative path (e.g. 'source/Foo.bs').
 * @returns {{ dir: string, write: (relPath: string, contents: any) => void, cleanup: () => void }}
 */
export function createLocaleFixture(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-update-translations-'));

  if (opts.en_US !== undefined) {
    writeFile(dir, 'locale/custom/en_US.json', opts.en_US);
  }

  if (opts.locales) {
    for (const [code, contents] of Object.entries(opts.locales)) {
      writeFile(dir, `locale/custom/${code}.json`, contents);
    }
  }

  if (opts.languagesJson !== undefined) {
    writeFile(dir, 'locale/languages.json', opts.languagesJson);
  }

  if (opts.sources) {
    for (const [relPath, contents] of Object.entries(opts.sources)) {
      writeFile(dir, relPath, contents);
    }
  }

  return {
    dir,
    write: (relPath, contents) => writeFile(dir, relPath, contents),
    cleanup: () => {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    },
  };
}
