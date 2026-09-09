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
//
// It is a CROSS-FILE rule — the diagnostic anchors on the XML's component name
// but the verdict comes from the codebehind's function list — so it runs on the
// shared scope lifecycle in scripts/lib/bsc-rule.cjs. The incremental block at
// the bottom is what guards that: before the migration, adding the onDestroy()
// the message asks for did not clear the warning until the XML was touched.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, runPluginOnEdits, diagnosticsByCode } from '../_helpers/run-plugin.js';
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

describe('jrscreen-on-destroy — incremental validation (the staleness the lifecycle fixes)', () => {
  const XML = xml('TestScreen', 'JRScreen');
  const withoutOnDestroy = {
    'components/TestScreen.xml': XML,
    'components/TestScreen.bs': 'sub init()\nend sub',
  };
  const withOnDestroy = {
    'components/TestScreen.bs': 'sub init()\nend sub\nsub onDestroy()\nend sub',
  };
  const count = (diagnostics) => diagnosticsByCode(diagnostics, CODE).length;

  // The regression this migration exists for: the fix is made in the codebehind,
  // but the diagnostic is anchored on the XML, so nothing cleared it.
  it('clears when onDestroy is added to the codebehind alone', () => {
    const [before, after] = runPluginOnEdits(jrscreenOnDestroyPlugin, [
      withoutOnDestroy,
      withOnDestroy,
    ]);
    expect(count(before)).toBe(1);
    expect(count(after)).toBe(0);
  });

  it('reappears when onDestroy is removed again', () => {
    const [, , third] = runPluginOnEdits(jrscreenOnDestroyPlugin, [
      withoutOnDestroy,
      withOnDestroy,
      { 'components/TestScreen.bs': 'sub init()\nend sub' },
    ]);
    expect(count(third)).toBe(1);
  });

  it('does not accumulate duplicates across repeated validations', () => {
    const [, second, third] = runPluginOnEdits(jrscreenOnDestroyPlugin, [withoutOnDestroy, {}, {}]);
    expect(count(second)).toBe(1);
    expect(count(third)).toBe(1);
  });

  // The other half of the verdict lives in the XML: stop extending JRScreen and
  // the rule no longer applies, even though the codebehind never changed.
  it('clears when the component stops extending JRScreen', () => {
    const [before, after] = runPluginOnEdits(jrscreenOnDestroyPlugin, [
      withoutOnDestroy,
      { 'components/TestScreen.xml': xml('TestScreen', 'Group') },
    ]);
    expect(count(before)).toBe(1);
    expect(count(after)).toBe(0);
  });

  it("leaves an unrelated component's finding alone when another is fixed", () => {
    const two = {
      'components/AScreen.xml': xml('AScreen', 'JRScreen'),
      'components/AScreen.bs': 'sub init()\nend sub',
      'components/BScreen.xml': xml('BScreen', 'JRScreen'),
      'components/BScreen.bs': 'sub init()\nend sub',
    };
    const [before, after] = runPluginOnEdits(jrscreenOnDestroyPlugin, [
      two,
      { 'components/AScreen.bs': 'sub init()\nend sub\nsub onDestroy()\nend sub' },
    ]);
    expect(count(before)).toBe(2);
    const remaining = diagnosticsByCode(after, CODE);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message).toMatch(/BScreen/);
  });

  // requiresCodebehind:false — a component with no codebehind at all cannot
  // declare onDestroy, so it is the strongest instance of this finding, not an
  // absent one. No live example today; the gate would narrow silently without it.
  it('flags a JRScreen subclass that has no codebehind at all', () => {
    const diagnostics = runPluginOnSource(jrscreenOnDestroyPlugin, {
      'components/NoCodebehind.xml': `<?xml version="1.0" encoding="utf-8" ?>
<component name="NoCodebehind" extends="JRScreen">
</component>`,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(1);
  });
});
