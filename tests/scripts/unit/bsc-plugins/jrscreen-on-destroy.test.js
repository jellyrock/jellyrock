// Tests for the jrscreen-on-destroy plugin.
//
// Plugin under test: scripts/bsc-plugins/jrscreen-on-destroy.cjs
// Diagnostic code: jrscreen-on-destroy-required
//
// What the plugin enforces: every component that transitively extends
// JRScreen must declare a top-level `onDestroy` function in its codebehind.
// The function name check is case-sensitive (exact `onDestroy`, not
// `OnDestroy` / `ondestroy` / `destroy`). The base JRScreen.xml is skipped
// by name. Three escape hatches exist (`' bsc-disable-file jrscreen-on-destroy`
// in the XML or in the codebehind).

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import jrscreenOnDestroyPlugin from '../../../../scripts/bsc-plugins/jrscreen-on-destroy.cjs';

const CODE = 'jrscreen-on-destroy-required';

const xml = (name, parent, extra = '') =>
  `<?xml version="1.0" encoding="utf-8" ?>
<component name="${name}" extends="${parent}">${extra}
  <script type="text/brightscript" uri="${name}.bs" />
</component>`;

describe('jrscreen-on-destroy', () => {
  it('flags a JRScreen subclass whose codebehind has no onDestroy()', () => {
    const diagnostics = runPluginOnSource(jrscreenOnDestroyPlugin, {
      'components/TestScreen.xml': xml('TestScreen', 'JRScreen'),
      'components/TestScreen.bs': `
        sub init()
        end sub
      `,
    });
    const flagged = diagnosticsByCode(diagnostics, CODE);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].message).toMatch(/TestScreen/);
  });

  it('does not flag a JRScreen subclass that declares onDestroy()', () => {
    const diagnostics = runPluginOnSource(jrscreenOnDestroyPlugin, {
      'components/TestScreen.xml': xml('TestScreen', 'JRScreen'),
      'components/TestScreen.bs': `
        sub init()
        end sub
        sub onDestroy()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('flags a JRScreen subclass that still uses the old destroy() name', () => {
    // Case-sensitive enforcement: pre-rename `destroy()` no longer satisfies
    // the rule even though BrightScript's runtime function lookup is itself
    // case-insensitive. The plugin checks the exact source spelling.
    const diagnostics = runPluginOnSource(jrscreenOnDestroyPlugin, {
      'components/TestScreen.xml': xml('TestScreen', 'JRScreen'),
      'components/TestScreen.bs': `
        sub init()
        end sub
        sub destroy()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(1);
  });

  it('flags a JRScreen subclass that uses PascalCase OnDestroy() (lowerCamelCase rule)', () => {
    const diagnostics = runPluginOnSource(jrscreenOnDestroyPlugin, {
      'components/TestScreen.xml': xml('TestScreen', 'JRScreen'),
      'components/TestScreen.bs': `
        sub init()
        end sub
        sub OnDestroy()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(1);
  });

  it('does not flag a component that does not extend JRScreen', () => {
    const diagnostics = runPluginOnSource(jrscreenOnDestroyPlugin, {
      'components/TestGroup.xml': xml('TestGroup', 'Group'),
      'components/TestGroup.bs': `
        sub init()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('does not flag JRScreen.xml itself (skipped by name)', () => {
    // Synthetic JRScreen base — extends Group like the real one, no onDestroy().
    // The plugin must NOT flag a component literally named "JRScreen"
    // regardless of the parent chain.
    const diagnostics = runPluginOnSource(jrscreenOnDestroyPlugin, {
      'components/JRScreen.xml': xml('JRScreen', 'Group'),
      'components/JRScreen.bs': `
        sub init()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('flags a transitive descendant (Foo extends Bar extends JRScreen)', () => {
    // Bar has onDestroy() so it doesn't get flagged itself; the only
    // diagnostic in this program should be on Foo.
    const diagnostics = runPluginOnSource(jrscreenOnDestroyPlugin, {
      'components/Bar.xml': xml('Bar', 'JRScreen'),
      'components/Bar.bs': `
        sub init()
        end sub
        sub onDestroy()
        end sub
      `,
      'components/Foo.xml': xml('Foo', 'Bar'),
      'components/Foo.bs': `
        sub init()
        end sub
      `,
    });
    const flagged = diagnosticsByCode(diagnostics, CODE);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].message).toMatch(/Foo/);
  });

  it('respects bsc-disable-file marker in the XML', () => {
    const diagnostics = runPluginOnSource(jrscreenOnDestroyPlugin, {
      'components/TestScreen.xml': xml(
        'TestScreen',
        'JRScreen',
        `\n  <!-- ' bsc-disable-file jrscreen-on-destroy -->`,
      ),
      'components/TestScreen.bs': `
        sub init()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('respects bsc-disable-file marker in the BS codebehind', () => {
    const diagnostics = runPluginOnSource(jrscreenOnDestroyPlugin, {
      'components/TestScreen.xml': xml('TestScreen', 'JRScreen'),
      'components/TestScreen.bs': `
        ' bsc-disable-file jrscreen-on-destroy
        sub init()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('flags a JRScreen subclass with no codebehind file at all', () => {
    // Documents current plugin behavior: when there's no codebehind, the
    // plugin still emits the diagnostic (the path through the code falls
    // through to the emit). If we want a different behavior, file as a
    // separate concern.
    const diagnostics = runPluginOnSource(jrscreenOnDestroyPlugin, {
      'components/TestScreen.xml': `<?xml version="1.0" encoding="utf-8" ?>
<component name="TestScreen" extends="JRScreen">
</component>`,
    });
    const flagged = diagnosticsByCode(diagnostics, CODE);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].message).toMatch(/TestScreen/);
  });
});
