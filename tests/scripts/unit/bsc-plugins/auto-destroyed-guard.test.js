// Tests for the auto-destroyed-guard plugin.
//
// Plugin under test: scripts/bsc-plugins/auto-destroyed-guard.cjs
// Diagnostic code: auto-destroyed-guard-needs-init
//
// Two responsibilities:
//  1. INJECT (beforePrepareFile, Tier 2 transpile harness): wire m.isDestroyed
//     through init() / onDestroy() / onKeyEvent() in any component codebehind
//     that declares both teardown hooks. Each site is independently idempotent.
//  2. ENFORCE (afterValidateFile, Tier 1 diagnostic harness): error when a
//     guardable component has no init() to initialise the flag in. Escape
//     hatch: ' bsc-disable-file auto-destroyed-guard.

import { describe, it, expect } from 'vitest';
import { transpileWithPlugin } from '../_helpers/transpile-with-plugin.js';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import autoDestroyedGuardPlugin from '../../../../scripts/bsc-plugins/auto-destroyed-guard.cjs';

const CODE = 'auto-destroyed-guard-needs-init';

const xml = (name, parent = 'Group') =>
  `<?xml version="1.0" encoding="utf-8" ?>
<component name="${name}" extends="${parent}">
  <script type="text/brightscript" uri="${name}.bs" />
</component>`;

const countOccurrences = (haystack, needle) =>
  (haystack.match(new RegExp(needle, 'g')) || []).length;

// A complete guardable component: init + onDestroy + onKeyEvent.
const guardable = (body = '') => `
  sub init()
    m.menu = m.top.findNode("menu")
  end sub
  function onKeyEvent(key as string, press as boolean) as boolean
    ${body}
    if key = "left" and isValid(m.menu.focusedChild)
      return true
    end if
    return false
  end function
  sub onDestroy()
    m.menu = invalid
  end sub
`;

describe('auto-destroyed-guard — injection', () => {
  it('wires the flag through all three sites in a guardable component', async () => {
    const out = await transpileWithPlugin(autoDestroyedGuardPlugin, {
      'components/Foo.xml': xml('Foo'),
      'components/Foo.bs': guardable(),
    });
    const code = out['components/Foo.bs'];
    expect(code).toMatch(/sub init\(\)\s*\n\s*m\.isDestroyed = false/);
    expect(code).toMatch(/sub onDestroy\(\)\s*\n\s*m\.isDestroyed = true/);
    expect(code).toMatch(
      /function onKeyEvent\([^)]*\)[^\n]*\n\s*if m\.isDestroyed = true then\s*\n\s*return false/,
    );
  });

  it('guards before the component reads any of its own nulled references', async () => {
    const out = await transpileWithPlugin(autoDestroyedGuardPlugin, {
      'components/Ord.xml': xml('Ord'),
      'components/Ord.bs': guardable(),
    });
    const code = out['components/Ord.bs'];
    expect(code.indexOf('if m.isDestroyed = true then')).toBeLessThan(
      code.indexOf('m.menu.focusedChild'),
    );
  });

  it('compares against true rather than testing truthiness', async () => {
    // Roku treats `invalid` as neither true nor false: a bare `if m.isDestroyed`
    // THROWS when the flag was never initialised. The comparison form is the
    // second layer behind the init() injection — a regression here would turn a
    // rare teardown race into a crash on every key press.
    const out = await transpileWithPlugin(autoDestroyedGuardPlugin, {
      'components/Cmp.xml': xml('Cmp'),
      'components/Cmp.bs': guardable(),
    });
    const code = out['components/Cmp.bs'];
    expect(code).toContain('if m.isDestroyed = true then');
    expect(code).not.toMatch(/if m\.isDestroyed then/);
  });

  it('is idempotent per site — a hand-written flag keeps only the missing guard', async () => {
    // The VideoPlayerView shape: init and onDestroy already manage the flag by
    // hand (issue #733), but onKeyEvent was never guarded.
    const out = await transpileWithPlugin(autoDestroyedGuardPlugin, {
      'components/Hand.xml': xml('Hand'),
      'components/Hand.bs': `
        sub init()
          m.isDestroyed = false
        end sub
        function onKeyEvent(key as string, press as boolean) as boolean
          return false
        end function
        sub onDestroy()
          m.isDestroyed = true
        end sub
      `,
    });
    const code = out['components/Hand.bs'];
    expect(countOccurrences(code, 'm\\.isDestroyed = false')).toBe(1);
    expect(countOccurrences(code, 'm\\.isDestroyed = true')).toBe(2); // 1 hand-written set + 1 injected compare
    expect(code).toContain('if m.isDestroyed = true then');
  });

  it('does not double-guard an onKeyEvent that already reads the flag', async () => {
    const out = await transpileWithPlugin(autoDestroyedGuardPlugin, {
      'components/Guarded.xml': xml('Guarded'),
      'components/Guarded.bs': `
        sub init()
          m.isDestroyed = false
        end sub
        function onKeyEvent(key as string, press as boolean) as boolean
          if m.isDestroyed then return false
          return false
        end function
        sub onDestroy()
          m.isDestroyed = true
        end sub
      `,
    });
    expect(countOccurrences(out['components/Guarded.bs'], 'm\\.isDestroyed')).toBe(3);
  });

  it('does not inject into a component with no onDestroy', async () => {
    const out = await transpileWithPlugin(autoDestroyedGuardPlugin, {
      'components/NoTeardown.xml': xml('NoTeardown'),
      'components/NoTeardown.bs': `
        sub init()
        end sub
        function onKeyEvent(key as string, press as boolean) as boolean
          return false
        end function
      `,
    });
    expect(out['components/NoTeardown.bs']).not.toContain('isDestroyed');
  });

  it('does not inject into a component with no onKeyEvent', async () => {
    const out = await transpileWithPlugin(autoDestroyedGuardPlugin, {
      'components/NoKeys.xml': xml('NoKeys'),
      'components/NoKeys.bs': `
        sub init()
        end sub
        sub onDestroy()
          m.menu = invalid
        end sub
      `,
    });
    expect(out['components/NoKeys.bs']).not.toContain('isDestroyed');
  });

  it('does not inject into a source helper with no sibling component XML', async () => {
    const out = await transpileWithPlugin(autoDestroyedGuardPlugin, {
      'source/helper.bs': guardable(),
    });
    expect(out['source/helper.bs']).not.toContain('isDestroyed');
  });

  it('respects the bsc-disable-file escape hatch', async () => {
    const out = await transpileWithPlugin(autoDestroyedGuardPlugin, {
      'components/Esc.xml': xml('Esc'),
      'components/Esc.bs': `' bsc-disable-file auto-destroyed-guard\n${guardable()}`,
    });
    expect(out['components/Esc.bs']).not.toContain('isDestroyed');
  });
});

describe('auto-destroyed-guard — enforcement', () => {
  it('errors when a guardable component declares no init()', () => {
    const diagnostics = runPluginOnSource(autoDestroyedGuardPlugin, {
      'components/NoInit.xml': xml('NoInit'),
      'components/NoInit.bs': `
        function onKeyEvent(key as string, press as boolean) as boolean
          return false
        end function
        sub onDestroy()
          m.menu = invalid
        end sub
      `,
    });
    const flagged = diagnosticsByCode(diagnostics, CODE);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].severity).toBe(1); // Error
    expect(flagged[0].message).toMatch(/isDestroyed/);
  });

  it('does not error when the component declares an init()', () => {
    const diagnostics = runPluginOnSource(autoDestroyedGuardPlugin, {
      'components/WithInit.xml': xml('WithInit'),
      'components/WithInit.bs': guardable(),
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('does not error for a component that declares no onKeyEvent', () => {
    const diagnostics = runPluginOnSource(autoDestroyedGuardPlugin, {
      'components/Plain.xml': xml('Plain'),
      'components/Plain.bs': `
        sub onDestroy()
          m.menu = invalid
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('does not error for a source helper with no sibling component XML', () => {
    const diagnostics = runPluginOnSource(autoDestroyedGuardPlugin, {
      'source/helper.bs': `
        function onKeyEvent(key as string, press as boolean) as boolean
          return false
        end function
        sub onDestroy()
          m.menu = invalid
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('respects the bsc-disable-file escape hatch', () => {
    const diagnostics = runPluginOnSource(autoDestroyedGuardPlugin, {
      'components/EscD.xml': xml('EscD'),
      'components/EscD.bs': `
        ' bsc-disable-file auto-destroyed-guard
        function onKeyEvent(key as string, press as boolean) as boolean
          return false
        end function
        sub onDestroy()
          m.menu = invalid
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });
});
