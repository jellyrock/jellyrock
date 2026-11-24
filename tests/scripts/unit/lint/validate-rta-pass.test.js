// Gate: `npm run validate` type-checks the app a second time with `ENABLE_RTA` and
// `debug` on.
//
// WHY THIS EXISTS
// ---------------
// BrighterScript reports no diagnostics inside an inactive conditional-compile
// branch, and the committed `manifest` sets `ENABLE_RTA=false` and `debug=false`. So the
// plain build never checked the RTA-only or debug-only code, and the RTA deploy flips
// the flag only after the compiler has finished. A second pass over
// `bsconfig-validate-rta.json` makes those branches active. The last test is the guard that the mechanism still works after a
// BrighterScript upgrade.

import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProgramBuilder } from 'brighterscript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CONFIG = 'bsconfig-validate-rta.json';
const load = (name) =>
  existsSync(join(ROOT, name)) ? JSON.parse(readFileSync(join(ROOT, name), 'utf8')) : {};

describe('the ENABLE_RTA and debug validate pass', () => {
  it('has a config that extends bsconfig.json', () => {
    expect(existsSync(join(ROOT, CONFIG))).toBe(true);
    expect(load(CONFIG).extends ?? '').toMatch(/(^|\/)bsconfig\.json$/);
  });

  it('turns ENABLE_RTA on through compilerOptions.manifest.bs_const', () => {
    expect(load(CONFIG).compilerOptions?.manifest?.bs_const?.ENABLE_RTA).toBe(true);
  });

  it('turns debug on through compilerOptions.manifest.bs_const', () => {
    expect(load(CONFIG).compilerOptions?.manifest?.bs_const?.debug).toBe(true);
  });

  it('is run by npm run validate through its own script', () => {
    const scripts = load('package.json').scripts;
    expect(scripts['validate:rta'], 'validate:rta script').toBeTypeOf('string');
    expect(scripts['validate:rta']).toContain(`--project ${CONFIG}`);
    expect(scripts['validate:rta']).toContain('--noEmit');
    expect(scripts.validate).toContain('npm run validate:rta');
  });
});

// A project whose only mistakes sit inside an `#if ENABLE_RTA` and an `#if debug` branch.
describe('conditional compile and the manifest override', () => {
  const run = async (override) => {
    const dir = mkdtempSync(join(tmpdir(), 'validate-rta-'));
    try {
      mkdirSync(join(dir, 'source'));
      writeFileSync(
        join(dir, 'manifest'),
        'title=Fixture\nbs_const=debug=false;ENABLE_RTA=false\n',
      );
      writeFileSync(
        join(dir, 'source', 'main.bs'),
        [
          'sub main()',
          '  #if ENABLE_RTA',
          '    thisFunctionDoesNotExist()',
          '  #end if',
          '  #if debug',
          '    debugOnlyMissingFunction()',
          '  #end if',
          'end sub',
          '',
        ].join('\n'),
      );
      const config = { rootDir: dir, files: ['manifest', 'source/**/*'] };
      if (override)
        config.compilerOptions = { manifest: { bs_const: { ENABLE_RTA: true, debug: true } } };
      writeFileSync(join(dir, 'bsconfig.json'), JSON.stringify(config));
      const builder = new ProgramBuilder();
      await builder.run({
        cwd: dir,
        project: join(dir, 'bsconfig.json'),
        noEmit: true,
        // The planted mistakes are the point: keep them out of the test log.
        logLevel: 'off',
        showDiagnosticsInConsole: false,
      });
      const messages = builder.program.getDiagnostics().map((d) => d.message);
      builder.dispose?.();
      return messages;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it.each([
    ['ENABLE_RTA', /thisFunctionDoesNotExist/],
    ['debug', /debugOnlyMissingFunction/],
  ])('reports a mistake inside #if %s only with the override', async (_flag, pattern) => {
    const withOverride = await run(true);
    const without = await run(false);
    expect(without.filter((m) => pattern.test(m))).toEqual([]);
    expect(withOverride.filter((m) => pattern.test(m)).length).toBeGreaterThan(0);
  });
});
