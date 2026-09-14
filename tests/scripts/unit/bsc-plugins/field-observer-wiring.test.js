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
import { runPluginOnSource, runPluginOnEdits, diagnosticsByCode } from '../_helpers/run-plugin.js';
import fieldObserverWiringPlugin from '../../../../scripts/bsc-plugins/field-observer-wiring.cjs';

const DUPLICATE = 'duplicate-field-observer';
const INEFFECTIVE = 'ineffective-unobserve';
const UNDETACHABLE = 'undetachable-observer';

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

describe('case-insensitive field matching', () => {
  // BrightScript field names are case-insensitive, so `<field id="isSelected">`
  // and `observeField("isselected")` name the SAME field and are still a double
  // registration. A case-sensitive compare reads them as unrelated and says
  // nothing. No instance exists in the tree today — this keeps it that way.
  it('flags a duplicate whose spellings differ only in case', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'isSelected', onChange: 'onSelected' }]),
      'components/Foo.bs': `
        sub init()
          m.top.observeField("isselected", "onSelected")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, DUPLICATE)).toHaveLength(1);
  });

  it('flags an ineffective unobserve whose spelling differs only in case', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'itemContent', onChange: 'onItemContent' }]),
      'components/Foo.bs': `
        sub onDestroy()
          m.top.unobserveField("ITEMCONTENT")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, INEFFECTIVE)).toHaveLength(1);
  });
});

// The verdict depends on BOTH halves of the component, but the diagnostic is
// anchored in the .bs. Before the plugin moved onto the shared scope lifecycle,
// a fix made on the XML side left the error sitting on the codebehind until the
// codebehind itself was touched — the author does exactly what the message says
// and the IDE keeps saying no. `runPluginOnSource` validates once and so cannot
// see any of this; these use the edit-sequence harness.
describe('incremental re-validation', () => {
  const buggy = {
    'components/Foo.xml': xml('Foo', [{ id: 'isSelected', onChange: 'onSelected' }]),
    'components/Foo.bs': `
      sub init()
        m.top.observeField("isSelected", "onSelected")
      end sub
    `,
  };
  const clean = { 'components/Foo.xml': xml('Foo', [{ id: 'isSelected' }]) };
  const dupCount = (d) => diagnosticsByCode(d, DUPLICATE).length;

  it('clears when the fix is made on the XML side', () => {
    const [before, after] = runPluginOnEdits(fieldObserverWiringPlugin, [buggy, clean]);
    expect(dupCount(before)).toBe(1);
    expect(dupCount(after)).toBe(0);
  });

  it('clears when the fix is made on the codebehind side', () => {
    const [before, after] = runPluginOnEdits(fieldObserverWiringPlugin, [
      buggy,
      { 'components/Foo.bs': 'sub init()\nend sub' },
    ]);
    expect(dupCount(before)).toBe(1);
    expect(dupCount(after)).toBe(0);
  });

  it('appears when the XML side introduces the duplicate', () => {
    const [before, after] = runPluginOnEdits(fieldObserverWiringPlugin, [
      { ...buggy, ...clean },
      { 'components/Foo.xml': xml('Foo', [{ id: 'isSelected', onChange: 'onSelected' }]) },
    ]);
    expect(dupCount(before)).toBe(0);
    expect(dupCount(after)).toBe(1);
  });

  it('appears when the codebehind side introduces the duplicate', () => {
    const [before, after] = runPluginOnEdits(fieldObserverWiringPlugin, [
      {
        'components/Foo.xml': xml('Foo', [{ id: 'isSelected', onChange: 'onSelected' }]),
        'components/Foo.bs': 'sub init()\nend sub',
      },
      {
        'components/Foo.bs':
          'sub init()\n  m.top.observeField("isSelected", "onSelected")\nend sub',
      },
    ]);
    expect(dupCount(before)).toBe(0);
    expect(dupCount(after)).toBe(1);
  });

  it('keeps the finding when an unrelated component is edited', () => {
    const [, after] = runPluginOnEdits(fieldObserverWiringPlugin, [
      {
        ...buggy,
        'components/Other.xml': xml('Other', [{ id: 'plain' }]),
        'components/Other.bs': 'sub init()\nend sub',
      },
      { 'components/Other.bs': 'sub init()\n  x = 1\nend sub' },
    ]);
    expect(dupCount(after)).toBe(1);
  });

  it('does not duplicate the finding across repeated validations', () => {
    const [, second, third] = runPluginOnEdits(fieldObserverWiringPlugin, [buggy, {}, {}]);
    expect(dupCount(second)).toBe(1);
    expect(dupCount(third)).toBe(1);
  });
});

// The structural half of the wiring rule: an onDestroy is the declaration that a
// component releases state, and an XML onChange is the one registration form that
// cannot be detached. The two must not coexist. Keying on onDestroy's PRESENCE is
// deliberately blunter than asking "can a writer outlive teardown?" — that
// question is true but undecidable by a linter, and left every site to a human.
describe('undetachable-observer', () => {
  const withDestroy = `
    sub init()
    end sub
    sub onDestroy()
      m.node = invalid
    end sub
  `;

  it('errors when a component with onDestroy declares an XML onChange', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'items', onChange: 'onItems' }]),
      'components/Foo.bs': withDestroy,
    });
    const flagged = diagnosticsByCode(diagnostics, UNDETACHABLE);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe(1);
    expect(flagged[0].message).toMatch(/items/);
    expect(flagged[0].message).toMatch(/onDestroy/);
  });

  it('reports ONCE per component, listing every offending field', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [
        { id: 'alpha', onChange: 'onAlpha' },
        { id: 'beta', onChange: 'onBeta' },
        { id: 'gamma', onChange: 'onGamma' },
      ]),
      'components/Foo.bs': withDestroy,
    });
    const flagged = diagnosticsByCode(diagnostics, UNDETACHABLE);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].message).toMatch(/alpha/);
    expect(flagged[0].message).toMatch(/beta/);
    expect(flagged[0].message).toMatch(/gamma/);
    expect(flagged[0].message).toMatch(/3 fields/);
  });

  // 42 of the 53 components using onChange have no onDestroy: they release
  // nothing, so no handler of theirs can dereference a nulled reference. The rule
  // must leave every one of them alone.
  it('is silent for a component with no onDestroy — the majority case', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'items', onChange: 'onItems' }]),
      'components/Foo.bs': `
        sub init()
        end sub
        sub onItems()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, UNDETACHABLE)).toHaveLength(0);
  });

  it('is silent for a component with onDestroy but no XML onChange', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'items' }]),
      'components/Foo.bs': withDestroy,
    });
    expect(diagnosticsByCode(diagnostics, UNDETACHABLE)).toHaveLength(0);
  });

  it('is silent for the converted shape — observeField in init, unobserveField in onDestroy', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'items' }]),
      'components/Foo.bs': `
        sub init()
          m.top.observeField("items", "onItems")
        end sub
        sub onDestroy()
          m.top.unobserveField("items")
          m.node = invalid
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, UNDETACHABLE)).toHaveLength(0);
    expect(diagnosticsByCode(diagnostics, DUPLICATE)).toHaveLength(0);
    expect(diagnosticsByCode(diagnostics, INEFFECTIVE)).toHaveLength(0);
  });

  it('honours a suppression marker', () => {
    const diagnostics = run({
      'components/Foo.xml': xml('Foo', [{ id: 'items', onChange: 'onItems' }]),
      'components/Foo.bs': `
        sub init()
        end sub
        ' bsc-disable-next-line undetachable-observer
        sub onDestroy()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, UNDETACHABLE)).toHaveLength(0);
  });

  it('appears when a teardown is added, and clears when the onChange is moved out', () => {
    const noDestroy = {
      'components/Foo.xml': xml('Foo', [{ id: 'items', onChange: 'onItems' }]),
      'components/Foo.bs': 'sub init()\nend sub',
    };
    const [before, afterDestroy, afterFix] = runPluginOnEdits(fieldObserverWiringPlugin, [
      noDestroy,
      { 'components/Foo.bs': 'sub init()\nend sub\nsub onDestroy()\nend sub' },
      { 'components/Foo.xml': xml('Foo', [{ id: 'items' }]) },
    ]);
    expect(diagnosticsByCode(before, UNDETACHABLE)).toHaveLength(0);
    expect(diagnosticsByCode(afterDestroy, UNDETACHABLE)).toHaveLength(1);
    expect(diagnosticsByCode(afterFix, UNDETACHABLE)).toHaveLength(0);
  });
});

// A registration is not private to the component that made it. On device
// (tests/source/unit/platform/ObserverRegistry.spec.bs), a component calling
// m.top.unobserveField — or m.top.unobserveFieldScoped — removed the plain observer its
// parent held on that field. #898 did exactly that to PlayerHostView's `state` observer,
// and every natural episode end stranded the player.
// So m.top observers are wired once in init() and released once in onDestroy(), and
// these two diagnostics hold both ends of that.
const TOP_UNOBSERVE = 'top-unobserve-outside-ondestroy';
const TOP_OBSERVE = 'top-observer-outside-init';

describe('top-unobserve-outside-ondestroy — the bug it catches', () => {
  it('errors on m.top.unobserveField outside onDestroy', () => {
    const diagnostics = run({
      'components/Player.xml': xml('Player'),
      'components/Player.bs': `
        sub onContentLoaded()
          m.top.unobserveField("state")
          m.top.observeField("state", "onState")
        end sub
      `,
    });
    const flagged = diagnosticsByCode(diagnostics, TOP_UNOBSERVE);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe(1); // Error
    expect(flagged[0].message).toMatch(/"state"/);
    expect(flagged[0].message).toMatch(/onContentLoaded/);
    expect(flagged[0].message).toMatch(/other component/i);
  });

  // The scoped form gets no pass: in the one configuration measured it removed the
  // parent's plain observer too, and scoped behaviour is not understood beyond that.
  it('errors on the unobserveFieldScoped form as well', () => {
    const diagnostics = run({
      'components/Player.xml': xml('Player'),
      'components/Player.bs': `
        sub onContentLoaded()
          m.top.unobserveFieldScoped("state")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, TOP_UNOBSERVE)).toHaveLength(1);
  });

  // JellyfinUserSettings.disableAutoSync loops over getFields(). The field name does not
  // change who loses their observer, so a non-literal argument is flagged, not skipped.
  it('errors when the field argument is not a literal', () => {
    const diagnostics = run({
      'components/Settings.xml': xml('Settings'),
      'components/Settings.bs': `
        sub disableAutoSync()
          for each fieldName in m.top.getFields()
            m.top.unobserveField(fieldName)
          end for
        end sub
      `,
    });
    const flagged = diagnosticsByCode(diagnostics, TOP_UNOBSERVE);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].message).toMatch(/disableAutoSync/);
  });

  // BrightScript is case-insensitive; an error-level gate must not be a spelling away
  // from silent. `ObserveField` casing is already in use elsewhere in the tree.
  it('errors whatever the casing of m.top and the method', () => {
    const diagnostics = run({
      'components/Player.xml': xml('Player'),
      'components/Player.bs': `
        sub onContentLoaded()
          M.Top.UnobserveField("state")
          m.top.UNOBSERVEFIELDSCOPED("position")
          m.top.ObserveField("state", "onState")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, TOP_UNOBSERVE)).toHaveLength(2);
    expect(diagnosticsByCode(diagnostics, TOP_OBSERVE)).toHaveLength(1);
  });

  it('errors inside a function literal nested in another function', () => {
    const diagnostics = run({
      'components/Player.xml': xml('Player'),
      'components/Player.bs': `
        sub fetch()
          callback = sub()
            m.top.unobserveField("position")
          end sub
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, TOP_UNOBSERVE)).toHaveLength(1);
  });

  // The regression the plugin's old early return would have hidden: neither player nor
  // settings node declares an XML onChange.
  it('runs for a component that declares no XML onChange at all', () => {
    const diagnostics = run({
      'components/Player.xml': xml('Player', [{ id: 'plain' }]),
      'components/Player.bs': `
        sub stop()
          m.top.unobserveField("plain")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, TOP_UNOBSERVE)).toHaveLength(1);
  });
});

describe('top-unobserve-outside-ondestroy — what it must NOT flag', () => {
  it('is silent in onDestroy, whatever its casing', () => {
    const diagnostics = run({
      'components/Player.xml': xml('Player'),
      'components/Player.bs': `
        sub ONDESTROY()
          m.top.unobserveField("state")
          m.top.unobserveFieldScoped("position")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, TOP_UNOBSERVE)).toHaveLength(0);
  });

  // A timer the component owns is a legitimate balanced toggle (bufferCheckTimer).
  it('is silent for an unobserve on a node other than m.top', () => {
    const diagnostics = run({
      'components/Player.xml': xml('Player'),
      'components/Player.bs': `
        sub onPaused()
          m.bufferCheckTimer.unobserveField("fire")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, TOP_UNOBSERVE)).toHaveLength(0);
  });

  it('skips both vendored trees', () => {
    const body = `
      sub runLoop()
        m.top.unobserveField("buffer_size")
      end sub
    `;
    const diagnostics = run({
      'components/vendor/Socket/SocketTask.xml': xml('SocketTask'),
      'components/vendor/Socket/SocketTask.bs': body,
      'components/roku_modules/log/LogNode.xml': xml('LogNode'),
      'components/roku_modules/log/LogNode.bs': body,
    });
    expect(diagnosticsByCode(diagnostics, TOP_UNOBSERVE)).toHaveLength(0);
  });

  it('honours bsc-disable-next-line', () => {
    const diagnostics = run({
      'components/Probe.xml': xml('Probe'),
      'components/Probe.bs': `
        sub selfUnobserve()
          ' bsc-disable-next-line top-unobserve-outside-ondestroy
          m.top.unobserveField("value")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, TOP_UNOBSERVE)).toHaveLength(0);
  });

  it('clears when the unobserve moves into onDestroy', () => {
    const [before, after] = runPluginOnEdits(fieldObserverWiringPlugin, [
      {
        'components/Player.xml': xml('Player'),
        'components/Player.bs': 'sub stop()\n  m.top.unobserveField("state")\nend sub',
      },
      { 'components/Player.bs': 'sub onDestroy()\n  m.top.unobserveField("state")\nend sub' },
    ]);
    expect(diagnosticsByCode(before, TOP_UNOBSERVE)).toHaveLength(1);
    expect(diagnosticsByCode(after, TOP_UNOBSERVE)).toHaveLength(0);
  });
});

describe('top-observer-outside-init — the bug it catches', () => {
  // With a mid-life unobserve banned, a re-running observe can no longer be de-duplicated
  // — it accumulates, and the handler runs N times per write (#896, #898). Deleting the
  // unobserve that the diagnostic above flags would produce exactly this.
  it('errors on m.top.observeField with a handler outside init', () => {
    const diagnostics = run({
      'components/Player.xml': xml('Player'),
      'components/Player.bs': `
        sub onContentChange()
          m.top.observeField("position", "onPositionChanged")
        end sub
      `,
    });
    const flagged = diagnosticsByCode(diagnostics, TOP_OBSERVE);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe(1); // Error
    expect(flagged[0].message).toMatch(/"position"/);
    expect(flagged[0].message).toMatch(/onContentChange/);
  });

  it('errors on the observeFieldScoped form as well', () => {
    const diagnostics = run({
      'components/Player.xml': xml('Player'),
      'components/Player.bs': `
        sub later()
          m.top.observeFieldScoped("state", "onState")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, TOP_OBSERVE)).toHaveLength(1);
  });

  // Placement is the rule, not reachability: a helper called only from init today can
  // be called from anywhere tomorrow, and nothing would notice. Inline it.
  it('errors in a helper even when init is its only caller', () => {
    const diagnostics = run({
      'components/Keyboard.xml': xml('Keyboard'),
      'components/Keyboard.bs': `
        sub init()
          enableVoice()
        end sub
        sub enableVoice()
          m.top.observeField("visible", "onVisible")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, TOP_OBSERVE)).toHaveLength(1);
  });

  it('errors when the field argument is not a literal', () => {
    const diagnostics = run({
      'components/Settings.xml': xml('Settings'),
      'components/Settings.bs': `
        sub enableAutoSync()
          for each fieldName in m.top.getFields()
            m.top.observeField(fieldName, "onSettingChanged")
          end for
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, TOP_OBSERVE)).toHaveLength(1);
  });
});

describe('top-observer-outside-init — what it must NOT flag', () => {
  it('is silent in init, whatever its casing', () => {
    const diagnostics = run({
      'components/Player.xml': xml('Player'),
      'components/Player.bs': `
        sub INIT()
          m.top.observeField("state", "onState")
          m.top.observeFieldScoped("position", "onPositionChanged")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, TOP_OBSERVE)).toHaveLength(0);
  });

  // The pool Tasks (ApiTask, ApiQueueTask, SideEffectTask) observe their own request
  // fields on a message port inside the Task's run function. Out of this rule's
  // population: no handler runs in a component scope, and no defect is on record.
  it('is silent for a message-port observer', () => {
    const diagnostics = run({
      'components/ApiTask.xml': xml('ApiTask'),
      'components/ApiTask.bs': `
        sub runApiLoop()
          port = CreateObject("roMessagePort")
          m.top.observeField("request", port)
          m.top.observeField("cancel", m.port)
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, TOP_OBSERVE)).toHaveLength(0);
  });

  it('is silent for an observe on a node other than m.top', () => {
    const diagnostics = run({
      'components/Player.xml': xml('Player'),
      'components/Player.bs': `
        sub onBuffering()
          m.bufferCheckTimer.observeField("fire", "bufferCheck")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, TOP_OBSERVE)).toHaveLength(0);
  });

  it('skips both vendored trees', () => {
    const body = `
      sub runLoop()
        m.top.observeField("__updateNow", "onUpdate")
      end sub
    `;
    const diagnostics = run({
      'components/vendor/Socket/SocketTask.xml': xml('SocketTask'),
      'components/vendor/Socket/SocketTask.bs': body,
      'components/roku_modules/log/LogNode.xml': xml('LogNode'),
      'components/roku_modules/log/LogNode.bs': body,
    });
    expect(diagnosticsByCode(diagnostics, TOP_OBSERVE)).toHaveLength(0);
  });
});
