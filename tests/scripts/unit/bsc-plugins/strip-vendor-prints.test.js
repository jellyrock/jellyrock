// Tests for the strip-vendor-prints plugin.
//
// Plugin under test: scripts/bsc-plugins/strip-vendor-prints.cjs
//
// roku-requests prints each request's URL and headers, token included, and has no switch to
// turn that off. The plugin removes every print from the vendored modules a bsconfig lists,
// in every build, and fails the build when that would silently do nothing or change what the
// module does.

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import { transpileWithPlugin } from '../_helpers/transpile-with-plugin.js';
import stripVendorPrints from '../../../../scripts/bsc-plugins/strip-vendor-prints.cjs';

const RR = 'source/roku_modules/rr/Requests.brs';
const OPTIONS = { stripVendorPrints: { modules: ['rr'], allowedCalls: ['GetURL'] } };

const rrSource = `
function rr_Requests_run(url, headers)
    urlTransfer = CreateObject("roUrlTransfer")
    ? "[http] URL:", urlTransfer.GetURL()
    print "[http] Headers: ", headers
    if url <> ""
        ? "[http] nested"
    end if
    return urlTransfer
end function
`;

describe('strip-vendor-prints', () => {
  it('removes every print from a listed module, nested ones included', async () => {
    const out = await transpileWithPlugin(stripVendorPrints, { [RR]: rrSource }, OPTIONS);
    const code = out[RR];
    expect(code).not.toMatch(/^\s*(\?|print)\b/im);
    expect(code).toContain('urlTransfer = CreateObject("roUrlTransfer")');
    expect(code).toContain('return urlTransfer');
  });

  it('leaves the prints of a module it does not list', async () => {
    const other = 'source/roku_modules/sgrouter/Router.brs';
    const out = await transpileWithPlugin(
      stripVendorPrints,
      { [RR]: rrSource, [other]: 'sub warn()\n    print "[WARN] sgRouter: x"\nend sub\n' },
      OPTIONS,
    );
    expect(out[other]).toContain('print "[WARN] sgRouter: x"');
  });

  it('leaves the app’s own prints alone', async () => {
    const app = 'source/main.bs';
    const out = await transpileWithPlugin(
      stripVendorPrints,
      { [RR]: rrSource, [app]: 'sub main()\n    print "boot"\nend sub\n' },
      OPTIONS,
    );
    expect(out[app]).toContain('print "boot"');
  });

  it('reports nothing for a listed module with prints that only read values', () => {
    const found = runPluginOnSource(stripVendorPrints, { [RR]: rrSource }, OPTIONS);
    expect(found.filter((d) => String(d.code).startsWith('vendor-print'))).toHaveLength(0);
  });

  it('fails a removed print that calls something outside the allowlist', () => {
    const source = 'sub send(t)\n    ? "[http] sent", t.AsyncPostFromString("x")\nend sub\n';
    const found = diagnosticsByCode(
      runPluginOnSource(stripVendorPrints, { [RR]: source }, OPTIONS),
      'vendor-print-call',
    );
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(1);
  });

  it('fails a listed module whose files hold no print, so a change that hides them is seen', () => {
    const found = diagnosticsByCode(
      runPluginOnSource(stripVendorPrints, { [RR]: 'sub quiet()\nend sub\n' }, OPTIONS),
      'vendor-print-none',
    );
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(1);
  });

  it('fails a listed module that matches no file', () => {
    const found = diagnosticsByCode(
      runPluginOnSource(stripVendorPrints, { 'source/main.bs': 'sub main()\nend sub\n' }, OPTIONS),
      'vendor-print-module-missing',
    );
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(1);
  });

  it('is loaded by every build config, through its own plugins or the config it extends', () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    const configs = fs.readdirSync(root).filter((f) => /^bsconfig.*\.json$/.test(f));
    const resolve = (file, seen = []) => {
      const config = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
      if (config.plugins) return config.plugins;
      if (!config.extends || seen.includes(file)) return [];
      return resolve(path.normalize(config.extends), [...seen, file]);
    };
    const missing = configs
      .filter((f) => f !== 'bsconfig-base.json')
      .filter((f) => !resolve(f).some((p) => String(p).includes('strip-vendor-prints')));
    expect(missing).toEqual([]);
  });
});
