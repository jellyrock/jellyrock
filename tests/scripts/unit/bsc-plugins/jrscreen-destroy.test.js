// Tests for the jrscreen-destroy plugin.
//
// Plugin under test: scripts/bsc-plugins/jrscreen-destroy.cjs
// Diagnostic code: jrscreen-destroy-required
//
// What the plugin enforces: every component that transitively extends
// JRScreen must declare a top-level `destroy` function in its codebehind.
// The base JRScreen.xml is skipped by name. Three escape hatches exist
// (`' bsc-disable-file jrscreen-destroy` in the XML or in the codebehind).

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import jrscreenDestroyPlugin from '../../../../scripts/bsc-plugins/jrscreen-destroy.cjs';

const CODE = 'jrscreen-destroy-required';

const xml = (name, parent, extra = '') =>
  `<?xml version="1.0" encoding="utf-8" ?>
<component name="${name}" extends="${parent}">${extra}
  <script type="text/brightscript" uri="${name}.bs" />
</component>`;

describe('jrscreen-destroy', () => {
  it('flags a JRScreen subclass whose codebehind has no destroy()', () => {
    const diagnostics = runPluginOnSource(jrscreenDestroyPlugin, {
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

  it('does not flag a JRScreen subclass that declares destroy()', () => {
    const diagnostics = runPluginOnSource(jrscreenDestroyPlugin, {
      'components/TestScreen.xml': xml('TestScreen', 'JRScreen'),
      'components/TestScreen.bs': `
        sub init()
        end sub
        sub destroy()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('does not flag a component that does not extend JRScreen', () => {
    const diagnostics = runPluginOnSource(jrscreenDestroyPlugin, {
      'components/TestGroup.xml': xml('TestGroup', 'Group'),
      'components/TestGroup.bs': `
        sub init()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('does not flag JRScreen.xml itself (skipped by name)', () => {
    // Synthetic JRScreen base — extends Group like the real one, no destroy().
    // The plugin must NOT flag a component literally named "JRScreen"
    // regardless of the parent chain.
    const diagnostics = runPluginOnSource(jrscreenDestroyPlugin, {
      'components/JRScreen.xml': xml('JRScreen', 'Group'),
      'components/JRScreen.bs': `
        sub init()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('flags a transitive descendant (Foo extends Bar extends JRScreen)', () => {
    // Bar has destroy() so it doesn't get flagged itself; the only
    // diagnostic in this program should be on Foo.
    const diagnostics = runPluginOnSource(jrscreenDestroyPlugin, {
      'components/Bar.xml': xml('Bar', 'JRScreen'),
      'components/Bar.bs': `
        sub init()
        end sub
        sub destroy()
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
    const diagnostics = runPluginOnSource(jrscreenDestroyPlugin, {
      'components/TestScreen.xml': xml(
        'TestScreen',
        'JRScreen',
        `\n  <!-- ' bsc-disable-file jrscreen-destroy -->`,
      ),
      'components/TestScreen.bs': `
        sub init()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('respects bsc-disable-file marker in the BS codebehind', () => {
    const diagnostics = runPluginOnSource(jrscreenDestroyPlugin, {
      'components/TestScreen.xml': xml('TestScreen', 'JRScreen'),
      'components/TestScreen.bs': `
        ' bsc-disable-file jrscreen-destroy
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
    const diagnostics = runPluginOnSource(jrscreenDestroyPlugin, {
      'components/TestScreen.xml': `<?xml version="1.0" encoding="utf-8" ?>
<component name="TestScreen" extends="JRScreen">
</component>`,
    });
    const flagged = diagnosticsByCode(diagnostics, CODE);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].message).toMatch(/TestScreen/);
  });
});
