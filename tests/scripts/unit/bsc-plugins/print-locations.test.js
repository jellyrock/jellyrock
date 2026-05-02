// Tests for the print-locations plugin.
//
// Plugin under test: scripts/bsc-plugins/print-locations.cjs
// Diagnostic code: print-outside-allowlist
//
// What the plugin enforces: `print` statements must be `m.log.*` calls so
// production builds can strip them. Allowed call sites:
//   - source/main.bs (bootstrap; runs before log manager exists)
//   - `#if debug` block in source/utils/globals.bs (developer console)
//   - Free top-level functions in source/*.bs (no `m.log` available)
// Components and class methods are flagged. Three escape hatches:
//   `' bsc-disable-line/next-line/file print-locations`.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import printLocationsPlugin from '../../../../scripts/bsc-plugins/print-locations.cjs';

const CODE = 'print-outside-allowlist';

describe('print-locations', () => {
  it('flags `print` in a component sub', () => {
    const diagnostics = runPluginOnSource(printLocationsPlugin, {
      'components/Foo.bs': `
        sub init()
          print "hi"
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(1);
  });

  it('does not flag `print` in source/main.bs (allowlisted file)', () => {
    const diagnostics = runPluginOnSource(printLocationsPlugin, {
      'source/main.bs': `
        sub main()
          print "boot"
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('does not flag `print` inside `#if debug` in source/utils/globals.bs', () => {
    const diagnostics = runPluginOnSource(printLocationsPlugin, {
      'source/utils/globals.bs': `
        sub showHints()
          #if debug
            print "developer hint"
          #end if
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('flags `print` in a class method in source/utils/globals.bs (smart-skip does not apply)', () => {
    // Free functions in source/*.bs are smart-skipped (no m.log available),
    // so the only way to trigger a diagnostic in globals.bs is from a
    // class method (which can carry m.log) outside any #if debug block.
    const diagnostics = runPluginOnSource(printLocationsPlugin, {
      'source/utils/globals.bs': `
        class GlobalHelper
          sub greet()
            print "always prints"
          end sub
        end class
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(1);
  });

  it('does not flag `print` in a free function in source/*.bs (no m.log available)', () => {
    const diagnostics = runPluginOnSource(printLocationsPlugin, {
      'source/utils/foo.bs': `
        function helper() as void
          print "no m here"
        end function
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('flags `print` in a class method (the class can carry m.log)', () => {
    const diagnostics = runPluginOnSource(printLocationsPlugin, {
      'source/utils/foo.bs': `
        class FooHelper
          sub greet()
            print "hi from class"
          end sub
        end class
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(1);
  });

  it('respects bsc-disable-line on the same line', () => {
    const diagnostics = runPluginOnSource(printLocationsPlugin, {
      'components/Foo.bs': `
        sub init()
          print "hi" ' bsc-disable-line print-locations
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('respects bsc-disable-next-line on the line above', () => {
    const diagnostics = runPluginOnSource(printLocationsPlugin, {
      'components/Foo.bs': `
        sub init()
          ' bsc-disable-next-line print-locations
          print "hi"
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('respects bsc-disable-file at the top of the file', () => {
    const diagnostics = runPluginOnSource(printLocationsPlugin, {
      'components/Foo.bs': `
        ' bsc-disable-file print-locations
        sub init()
          print "hi"
          print "ho"
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('emits one diagnostic per offending print', () => {
    const diagnostics = runPluginOnSource(printLocationsPlugin, {
      'components/Foo.bs': `
        sub init()
          print "one"
          print "two"
          print "three"
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(3);
  });
});
