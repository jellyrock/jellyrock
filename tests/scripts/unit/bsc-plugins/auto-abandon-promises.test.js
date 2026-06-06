// Tests for the auto-abandon-promises plugin.
//
// Plugin under test: scripts/bsc-plugins/auto-abandon-promises.cjs
// Diagnostic code: auto-abandon-promises-needs-on-destroy
//
// Two responsibilities:
//  1. INJECT (beforePrepareFile, Tier 2 transpile harness): prepend
//     abandonApiPromises() to onDestroy() in any codebehind that calls
//     fetchAsync. Idempotent.
//  2. ENFORCE (afterValidateFile, Tier 1 diagnostic harness): error when a
//     component codebehind (sibling .xml) calls fetchAsync but has no
//     onDestroy(). Escape hatch: ' bsc-disable-file auto-abandon-promises.

import { describe, it, expect } from 'vitest';
import { transpileWithPlugin } from '../_helpers/transpile-with-plugin.js';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import autoAbandonPlugin from '../../../../scripts/bsc-plugins/auto-abandon-promises.cjs';

const CODE = 'auto-abandon-promises-needs-on-destroy';

const xml = (name, parent = 'Group') =>
  `<?xml version="1.0" encoding="utf-8" ?>
<component name="${name}" extends="${parent}">
  <script type="text/brightscript" uri="${name}.bs" />
</component>`;

const countOccurrences = (haystack, needle) =>
  (haystack.match(new RegExp(needle, 'g')) || []).length;

describe('auto-abandon-promises — injection', () => {
  it('prepends abandonApiPromises() to onDestroy() in a fetchAsync caller', async () => {
    const out = await transpileWithPlugin(autoAbandonPlugin, {
      'components/Foo.bs': `
        sub onLoad()
          p = fetchAsync({}, "id1")
        end sub
        sub onDestroy()
          m.x = invalid
        end sub
      `,
    });
    const code = out['components/Foo.bs'];
    expect(code).toMatch(/sub onDestroy\(\)\s*\n\s*abandonApiPromises\(\)/);
    // injected before the component's own teardown
    expect(code.indexOf('abandonApiPromises()')).toBeLessThan(code.indexOf('m.x = invalid'));
  });

  it('is idempotent — does not double-inject when onDestroy already abandons', async () => {
    const out = await transpileWithPlugin(autoAbandonPlugin, {
      'components/Bar.bs': `
        sub go()
          fetchAsync({}, "id")
        end sub
        sub onDestroy()
          abandonApiPromises()
        end sub
      `,
    });
    expect(countOccurrences(out['components/Bar.bs'], 'abandonApiPromises')).toBe(1);
  });

  it('does not inject into a file that never calls fetchAsync', async () => {
    const out = await transpileWithPlugin(autoAbandonPlugin, {
      'components/Baz.bs': `
        sub onDestroy()
          m.x = invalid
        end sub
      `,
    });
    expect(out['components/Baz.bs']).not.toContain('abandonApiPromises');
  });

  it('does not inject when fetchAsync caller has no onDestroy (diagnostic handles it)', async () => {
    const out = await transpileWithPlugin(autoAbandonPlugin, {
      'components/Qux.bs': `
        sub go()
          fetchAsync({}, "id")
        end sub
      `,
    });
    expect(out['components/Qux.bs']).not.toContain('abandonApiPromises');
  });
});

describe('auto-abandon-promises — enforcement', () => {
  it('errors when a component calls fetchAsync but declares no onDestroy()', () => {
    const diagnostics = runPluginOnSource(autoAbandonPlugin, {
      'components/Qux.xml': xml('Qux'),
      'components/Qux.bs': `
        sub go()
          fetchAsync({}, "id")
        end sub
      `,
    });
    const flagged = diagnosticsByCode(diagnostics, CODE);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe(1); // Error
    expect(flagged[0].message).toMatch(/fetchAsync/);
  });

  it('does not error when the component declares an onDestroy()', () => {
    const diagnostics = runPluginOnSource(autoAbandonPlugin, {
      'components/Quux.xml': xml('Quux'),
      'components/Quux.bs': `
        sub go()
          fetchAsync({}, "id")
        end sub
        sub onDestroy()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('does not error for a fetchAsync caller with no sibling component XML (source helper)', () => {
    const diagnostics = runPluginOnSource(autoAbandonPlugin, {
      'source/helper.bs': `
        sub go()
          fetchAsync({}, "id")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('does not error for a component that never calls fetchAsync', () => {
    const diagnostics = runPluginOnSource(autoAbandonPlugin, {
      'components/Plain.xml': xml('Plain'),
      'components/Plain.bs': `
        sub init()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('respects the bsc-disable-file escape hatch', () => {
    const diagnostics = runPluginOnSource(autoAbandonPlugin, {
      'components/Esc.xml': xml('Esc'),
      'components/Esc.bs': `
        ' bsc-disable-file auto-abandon-promises
        sub go()
          fetchAsync({}, "id")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });
});
