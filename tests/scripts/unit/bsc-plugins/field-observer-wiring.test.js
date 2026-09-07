// Tests for the field-observer-wiring plugin.
//
// Plugin under test: scripts/bsc-plugins/field-observer-wiring.cjs
// Diagnostic codes: duplicate-field-observer, ineffective-unobserve
//
// Guards two silent wiring bugs, both established by PR #891:
//
//   duplicate-field-observer — a field wired by BOTH an XML `onChange` and an
//   `m.top.observeField()` registers two observers and runs the handler twice
//   per write. Invisible whenever the handler is idempotent, which is how
//   `OSD.itemData` and `IconButton.isButtonSelected` each survived months.
//
//   ineffective-unobserve — an `unobserveField()` against a field whose only
//   registration is an XML `onChange`. That does not appear to detach it, and
//   `unobserveField` returns true regardless, so the line reads as teardown
//   protection and provides none.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import fieldObserverWiringPlugin from '../../../../scripts/bsc-plugins/field-observer-wiring.cjs';

const DUPLICATE = 'duplicate-field-observer';
const INEFFECTIVE = 'ineffective-unobserve';

// Component XML whose <interface> carries the given fields.
// `fields` entries: { id, onChange? }
const xml = (name, fields = []) =>
  `<?xml version="1.0" encoding="utf-8" ?>
<component name="${name}" extends="Group">
  <interface>
${fields
  .map(
    (f) =>
      `    <field id="${f.id}" type="boolean"${f.onChange ? ` onChange="${f.onChange}"` : ''} />`,
  )
  .join('\n')}
  </interface>
  <script type="text/brightscript" uri="${name}.bs" />
</component>`;

const run = (files) => runPluginOnSource(fieldObserverWiringPlugin, files);

describe('duplicate-field-observer — the bug it catches', () => {
  it('errors when a field is wired by BOTH an XML onChange and observeField', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'isSelected', onChange: 'onSelected' }]),
      'components/Foo.bs': `
        sub init()
          m.top.observeField("isSelected", "onSelected")
        end sub
        sub onSelected()
        end sub
      `,
    });
    const flagged = diagnosticsByCode(diagnostics, DUPLICATE);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe(1); // Error
    expect(flagged[0].message).toMatch(/isSelected/);
    expect(flagged[0].message).toMatch(/TWICE/);
  });

  it('also catches the observeFieldScoped form', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'isSelected', onChange: 'onSelected' }]),
      'components/Foo.bs': `
        sub init()
          m.top.observeFieldScoped("isSelected", "onSelected")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, DUPLICATE)).toHaveLength(1);
  });

  it('reports once per duplicated field, not once per component', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [
        { id: 'alpha', onChange: 'onAlpha' },
        { id: 'beta', onChange: 'onBeta' },
      ]),
      'components/Foo.bs': `
        sub init()
          m.top.observeField("alpha", "onAlpha")
          m.top.observeField("beta", "onBeta")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, DUPLICATE)).toHaveLength(2);
  });
});

describe('duplicate-field-observer — what it must NOT flag', () => {
  it('is silent when the XML onChange is the only registration', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'isSelected', onChange: 'onSelected' }]),
      'components/Foo.bs': `
        sub onSelected()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, DUPLICATE)).toHaveLength(0);
  });

  it('is silent when observeField is the only registration (no onChange)', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'isSelected' }]),
      'components/Foo.bs': `
        sub init()
          m.top.observeField("isSelected", "onSelected")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, DUPLICATE)).toHaveLength(0);
  });

  it('ignores an observer on a DIFFERENT node — only m.top can collide with onChange', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'isSelected', onChange: 'onSelected' }]),
      'components/Foo.bs': `
        sub init()
          m.child = m.top.findNode("child")
          m.child.observeField("isSelected", "onChildSelected")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, DUPLICATE)).toHaveLength(0);
  });

  it('matches on field name, not merely on the presence of some observeField', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'isSelected', onChange: 'onSelected' }]),
      'components/Foo.bs': `
        sub init()
          m.top.observeField("somethingElse", "onOther")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, DUPLICATE)).toHaveLength(0);
  });
});

describe('ineffective-unobserve — the bug it catches', () => {
  it('errors when unobserveField targets a field whose only registration is an onChange', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'itemContent', onChange: 'onItemContent' }]),
      'components/Foo.bs': `
        sub onDestroy()
          m.top.unobserveField("itemContent")
        end sub
      `,
    });
    const flagged = diagnosticsByCode(diagnostics, INEFFECTIVE);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe(1); // Error
    expect(flagged[0].message).toMatch(/itemContent/);
    expect(flagged[0].message).toMatch(/nothing it can remove/);
  });

  it('catches the unobserveFieldScoped form too', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'itemContent', onChange: 'onItemContent' }]),
      'components/Foo.bs': `
        sub onDestroy()
          m.top.unobserveFieldScoped("itemContent")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, INEFFECTIVE)).toHaveLength(1);
  });

  // The two diagnostics overlap on "onChange + unobserve + observe". The duplicate
  // is the accurate description there (the unobserve DOES remove the programmatic
  // half), so reporting both would send the author to the wrong fix.
  it('defers to duplicate-field-observer when a programmatic observe also exists', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'itemContent', onChange: 'onItemContent' }]),
      'components/Foo.bs': `
        sub init()
          m.top.observeField("itemContent", "onItemContent")
        end sub
        sub onDestroy()
          m.top.unobserveField("itemContent")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, INEFFECTIVE)).toHaveLength(0);
    expect(diagnosticsByCode(diagnostics, DUPLICATE)).toHaveLength(1);
  });

  it('is silent for the correct pairing — observeField in init, unobserveField in onDestroy', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'itemContent' }]),
      'components/Foo.bs': `
        sub init()
          m.top.observeField("itemContent", "onItemContent")
        end sub
        sub onDestroy()
          m.top.unobserveField("itemContent")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, INEFFECTIVE)).toHaveLength(0);
    expect(diagnosticsByCode(diagnostics, DUPLICATE)).toHaveLength(0);
  });
});

describe('escape hatches', () => {
  it('honours bsc-disable-next-line', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'isSelected', onChange: 'onSelected' }]),
      'components/Foo.bs': `
        sub init()
          ' bsc-disable-next-line duplicate-field-observer
          m.top.observeField("isSelected", "onSelected")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, DUPLICATE)).toHaveLength(0);
  });

  it('honours bsc-disable-line', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'isSelected', onChange: 'onSelected' }]),
      'components/Foo.bs': `
        sub init()
          m.top.observeField("isSelected", "onSelected") ' bsc-disable-line duplicate-field-observer
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, DUPLICATE)).toHaveLength(0);
  });

  it('honours bsc-disable-file', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'itemContent', onChange: 'onItemContent' }]),
      'components/Foo.bs': `
        ' bsc-disable-file ineffective-unobserve
        sub onDestroy()
          m.top.unobserveField("itemContent")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, INEFFECTIVE)).toHaveLength(0);
  });

  it('scopes a suppression to its own code — disabling one does not mute the other', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'isSelected', onChange: 'onSelected' }]),
      'components/Foo.bs': `
        ' bsc-disable-file ineffective-unobserve
        sub init()
          m.top.observeField("isSelected", "onSelected")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, DUPLICATE)).toHaveLength(1);
  });
});

describe('robustness', () => {
  it('says nothing about a component with no codebehind', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'isSelected', onChange: 'onSelected' }]),
    });
    expect(diagnosticsByCode(diagnostics, DUPLICATE)).toHaveLength(0);
    expect(diagnosticsByCode(diagnostics, INEFFECTIVE)).toHaveLength(0);
  });

  it('says nothing when the component declares no onChange at all', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'plain' }]),
      'components/Foo.bs': `
        sub init()
          m.top.observeField("plain", "onPlain")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, DUPLICATE)).toHaveLength(0);
  });

  it('ignores a non-literal field argument rather than guessing', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'isSelected', onChange: 'onSelected' }]),
      'components/Foo.bs': `
        sub init()
          fieldName = "isSelected"
          m.top.observeField(fieldName, "onSelected")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, DUPLICATE)).toHaveLength(0);
  });
});
