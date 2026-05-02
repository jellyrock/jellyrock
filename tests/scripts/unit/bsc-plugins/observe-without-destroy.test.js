// Tests for the observe-without-destroy plugin.
//
// Plugin under test: scripts/bsc-plugins/observe-without-destroy.cjs
// Diagnostic code: observe-without-destroy
//
// What the plugin enforces (in JRScreen subclasses only): every
// `observeField` / `observeFieldScoped` call must have a matching
// `unobserveField` / `unobserveFieldScoped` (same-scope, same-field-name,
// same-target-or-aliased-target) anywhere in the file.
// Three escape hatches: bsc-disable-line, bsc-disable-next-line,
// bsc-disable-file.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import observeWithoutDestroyPlugin from '../../../../scripts/bsc-plugins/observe-without-destroy.cjs';

const CODE = 'observe-without-destroy';

// Standard XML scaffold for a JRScreen subclass paired with a .bs codebehind.
const xmlPaired = (name) => `<?xml version="1.0" encoding="utf-8" ?>
<component name="${name}" extends="JRScreen">
  <script type="text/brightscript" uri="${name}.bs" />
</component>`;

// Convenience: a runner that always pairs the codebehind with a JRScreen
// subclass XML so the plugin actually fires on the body.
function runOnBody(bsBody, { componentName = 'TestScreen', extra = {} } = {}) {
  return runPluginOnSource(observeWithoutDestroyPlugin, {
    [`components/${componentName}.xml`]: xmlPaired(componentName),
    [`components/${componentName}.bs`]: bsBody,
    ...extra,
  });
}

describe('observe-without-destroy', () => {
  it('passes when observeField has a matching unobserveField on the same target', () => {
    const diagnostics = runOnBody(`
      sub init()
        m.button.observeField("buttonSelected", "onSelect")
      end sub
      sub destroy()
        m.button.unobserveField("buttonSelected")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('flags an observeField with no matching unobserve anywhere', () => {
    const diagnostics = runOnBody(`
      sub init()
        m.button.observeField("buttonSelected", "onSelect")
      end sub
      sub destroy()
        ' nothing released
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(1);
  });

  it('passes when unobserve lives in a non-destroy function (e.g. OnScreenHidden)', () => {
    // The plugin intentionally does NOT require unobserve to live in
    // destroy() — anywhere in the file is enough.
    const diagnostics = runOnBody(`
      sub init()
        m.button.observeField("buttonSelected", "onSelect")
      end sub
      sub OnScreenHidden()
        m.button.unobserveField("buttonSelected")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('passes with single-hop alias: cache m.x as local, observe via local, unobserve via m.x', () => {
    const diagnostics = runOnBody(`
      sub init()
        dialog = m.dialog
        dialog.observeField("backPressed", "onBack")
      end sub
      sub destroy()
        m.dialog.unobserveField("backPressed")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('passes with two-hop alias chain across union-find', () => {
    const diagnostics = runOnBody(`
      sub init()
        m.activeContent = m.homeRows
        m.homeRows.observeField("itemSelected", "onPick")
      end sub
      sub destroy()
        m.activeContent.unobserveField("itemSelected")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('flags observeField paired with unobserveFieldScoped (mismatched scope)', () => {
    // Roku tracks scoped vs unscoped observers on separate lists, so the
    // mismatched pair leaks even though the code looks correct.
    const diagnostics = runOnBody(`
      sub init()
        m.button.observeField("buttonSelected", "onSelect")
      end sub
      sub destroy()
        m.button.unobserveFieldScoped("buttonSelected")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(1);
  });

  it('flags observeFieldScoped paired with unobserveField (mismatched scope, reverse)', () => {
    const diagnostics = runOnBody(`
      sub init()
        m.button.observeFieldScoped("buttonSelected", "onSelect")
      end sub
      sub destroy()
        m.button.unobserveField("buttonSelected")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(1);
  });

  it('passes when observeFieldScoped is paired with unobserveFieldScoped', () => {
    const diagnostics = runOnBody(`
      sub init()
        m.button.observeFieldScoped("buttonSelected", "onSelect")
      end sub
      sub destroy()
        m.button.unobserveFieldScoped("buttonSelected")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('flags observeField("foo") paired with unobserveField("bar") (different field names)', () => {
    const diagnostics = runOnBody(`
      sub init()
        m.button.observeField("foo", "onFoo")
      end sub
      sub destroy()
        m.button.unobserveField("bar")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(1);
  });

  it('respects bsc-disable-line on the same line as the observe', () => {
    const diagnostics = runOnBody(`
      sub init()
        m.button.observeField("buttonSelected", "onSelect") ' bsc-disable-line observe-without-destroy
      end sub
      sub destroy()
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('respects bsc-disable-next-line on the line above the observe', () => {
    const diagnostics = runOnBody(`
      sub init()
        ' bsc-disable-next-line observe-without-destroy
        m.button.observeField("buttonSelected", "onSelect")
      end sub
      sub destroy()
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('respects bsc-disable-file at the top of the file', () => {
    const diagnostics = runOnBody(`
      ' bsc-disable-file observe-without-destroy
      sub init()
        m.button.observeField("buttonSelected", "onSelect")
        m.other.observeField("textChange", "onChange")
      end sub
      sub destroy()
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('does not fire on a component that does not extend JRScreen', () => {
    // Plugin only inspects JRScreen subclass codebehinds. Free-standing
    // components with unbalanced observes are someone else's concern.
    const diagnostics = runPluginOnSource(observeWithoutDestroyPlugin, {
      'components/PlainGroup.xml': `<?xml version="1.0" encoding="utf-8" ?>
<component name="PlainGroup" extends="Group">
  <script type="text/brightscript" uri="PlainGroup.bs" />
</component>`,
      'components/PlainGroup.bs': `
        sub init()
          m.button.observeField("buttonSelected", "onSelect")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('emits one diagnostic per unbalanced observe in the same file', () => {
    const diagnostics = runOnBody(`
      sub init()
        m.button.observeField("buttonSelected", "onSelect")
        m.other.observeField("textChange", "onChange")
      end sub
      sub destroy()
        ' neither released
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(2);
  });

  it('matches camelCase field names verbatim (field name is part of the match key)', () => {
    const diagnostics = runOnBody(`
      sub init()
        m.list.observeField("itemContent", "onItemChange")
      end sub
      sub destroy()
        m.list.unobserveField("itemContent")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });
});
