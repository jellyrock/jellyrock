// Tests for the callfunc-interface plugin.
//
// Plugin under test: scripts/bsc-plugins/callfunc-interface.cjs
// Diagnostic code: callfunc-interface
//
// Guards the silent-no-op bug: callFunc("X") only dispatches when the target
// component exposes <function name="X" /> in its <interface>. The plugin errors
// when X is a method DEFINED in one of our component codebehinds but declared in
// NO interface anywhere — the exact shape that shipped a dead watched-toggle in
// #551 Batch 2.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, runPluginOnEdits, diagnosticsByCode } from '../_helpers/run-plugin.js';
import callfuncInterfacePlugin from '../../../../scripts/bsc-plugins/callfunc-interface.cjs';

const CODE = 'callfunc-interface';

// Component XML with an optional list of exposed <function> names.
const xml = (name, { parent = 'Group', functions = [] } = {}) =>
  `<?xml version="1.0" encoding="utf-8" ?>
<component name="${name}" extends="${parent}">
  <interface>
${functions.map((f) => `    <function name="${f}" />`).join('\n')}
  </interface>
  <script type="text/brightscript" uri="${name}.bs" />
</component>`;

describe('callfunc-interface — the bug it catches', () => {
  it('errors when callFunc targets a component method declared in no interface', () => {
    const diagnostics = runPluginOnSource(callfuncInterfacePlugin, {
      'components/Foo.xml': xml('Foo'), // no <function> exposed
      'components/Foo.bs': `
        sub doThing()
        end sub
      `,
      'source/caller.bs': `
        sub go()
          m.foo.callFunc("doThing")
        end sub
      `,
    });
    const flagged = diagnosticsByCode(diagnostics, CODE);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe(1); // Error — silent no-op
    expect(flagged[0].message).toMatch(/doThing/);
  });

  it('matches case-insensitively (BrightScript identifiers are case-insensitive)', () => {
    const diagnostics = runPluginOnSource(callfuncInterfacePlugin, {
      'components/Foo.xml': xml('Foo'),
      'components/Foo.bs': `
        sub doThing()
        end sub
      `,
      'source/caller.bs': `
        sub go()
          m.foo.callFunc("DoThing")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(1);
  });
});

describe('callfunc-interface — does not false-positive', () => {
  it('passes when the method IS declared in the component interface', () => {
    const diagnostics = runPluginOnSource(callfuncInterfacePlugin, {
      'components/Foo.xml': xml('Foo', { functions: ['doThing'] }),
      'components/Foo.bs': `
        sub doThing()
        end sub
      `,
      'source/caller.bs': `
        sub go()
          m.foo.callFunc("doThing")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('ignores a callFunc target no component defines (external / vendored)', () => {
    const diagnostics = runPluginOnSource(callfuncInterfacePlugin, {
      'source/caller.bs': `
        sub go()
          m.transport.callFunc("logItem")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('passes when ANY component declares the name (program-wide membership)', () => {
    // Foo exposes doThing; Bar defines-but-does-not-expose it. The program-wide
    // DECLARED set suppresses — a deliberate false-negative that keeps FPs at zero.
    const diagnostics = runPluginOnSource(callfuncInterfacePlugin, {
      'components/Foo.xml': xml('Foo', { functions: ['doThing'] }),
      'components/Foo.bs': `
        sub doThing()
        end sub
      `,
      'components/Bar.xml': xml('Bar'),
      'components/Bar.bs': `
        sub doThing()
        end sub
      `,
      'source/caller.bs': `
        sub go()
          m.bar.callFunc("doThing")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('ignores a non-literal callFunc argument (can not resolve statically)', () => {
    const diagnostics = runPluginOnSource(callfuncInterfacePlugin, {
      'components/Foo.xml': xml('Foo'),
      'components/Foo.bs': `
        sub doThing()
        end sub
      `,
      'source/caller.bs': `
        sub go()
          methodName = "doThing"
          m.foo.callFunc(methodName)
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });
});

describe('callfunc-interface — escape hatches', () => {
  it('respects bsc-disable-next-line', () => {
    const diagnostics = runPluginOnSource(callfuncInterfacePlugin, {
      'components/Foo.xml': xml('Foo'),
      'components/Foo.bs': `
        sub doThing()
        end sub
      `,
      'source/caller.bs': `
        sub go()
          ' bsc-disable-next-line callfunc-interface
          m.foo.callFunc("doThing")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('respects bsc-disable-file', () => {
    const diagnostics = runPluginOnSource(callfuncInterfacePlugin, {
      'components/Foo.xml': xml('Foo'),
      'components/Foo.bs': `
        sub doThing()
        end sub
      `,
      'source/caller.bs': `
        ' bsc-disable-file callfunc-interface
        sub go()
          m.foo.callFunc("doThing")
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });
});

// The verdict for a call site lives in a DIFFERENT file — the target component's
// <interface>. So adding the <function> declaration this diagnostic asks for has
// to clear the error on the caller's .bs, and before the plugin moved onto the
// shared program-rule lifecycle it did not: the author performed the exact fix
// the message prescribes and the error stayed put.
describe('incremental re-validation', () => {
  const undeclared = {
    'components/Foo.xml': xml('Foo'),
    'components/Foo.bs': 'sub doThing()\nend sub',
    'source/caller.bs': 'sub go()\n  m.foo.callFunc("doThing")\nend sub',
  };
  const declared = { 'components/Foo.xml': xml('Foo', { functions: ['doThing'] }) };
  const count = (d) => diagnosticsByCode(d, CODE).length;

  it('clears when the target component declares the function — the prescribed fix', () => {
    const [before, after] = runPluginOnEdits(callfuncInterfacePlugin, [undeclared, declared]);
    expect(count(before)).toBe(1);
    expect(count(after)).toBe(0);
  });

  it('appears when a declaration is removed from the XML', () => {
    const [before, after] = runPluginOnEdits(callfuncInterfacePlugin, [
      { ...undeclared, ...declared },
      { 'components/Foo.xml': xml('Foo') },
    ]);
    expect(count(before)).toBe(0);
    expect(count(after)).toBe(1);
  });

  it('clears when the call site itself goes away', () => {
    const [before, after] = runPluginOnEdits(callfuncInterfacePlugin, [
      undeclared,
      { 'source/caller.bs': 'sub go()\nend sub' },
    ]);
    expect(count(before)).toBe(1);
    expect(count(after)).toBe(0);
  });

  it('keeps the finding across an unrelated edit and a repeated validation', () => {
    const [, afterUnrelated, afterNoop] = runPluginOnEdits(callfuncInterfacePlugin, [
      { ...undeclared, 'source/unrelated.bs': 'sub other()\nend sub' },
      { 'source/unrelated.bs': 'sub other()\n  x = 1\nend sub' },
      {},
    ]);
    expect(count(afterUnrelated)).toBe(1);
    expect(count(afterNoop)).toBe(1);
  });
});
