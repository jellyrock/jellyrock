// Tests for the no-direct-sdk plugin.
//
// Plugin under test: scripts/bsc-plugins/no-direct-sdk.cjs
// Diagnostic code: no-direct-sdk
//
// What the plugin enforces: `sdk.<ns>.<fn>(...)` calls must originate from
// the API layer (source/api/ApiClient.bs or source/api/sdk.bs); calls from
// anywhere else bypass the persistent task pool and run on the render thread.
// Two escape hatches: `' bsc-disable-line/next-line no-direct-sdk`.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import noDirectSdkPlugin from '../../../../scripts/bsc-plugins/no-direct-sdk.cjs';

const CODE = 'no-direct-sdk';

describe('no-direct-sdk', () => {
  it('flags sdk.<ns>.<fn>() in a component file', () => {
    const diagnostics = runPluginOnSource(noDirectSdkPlugin, {
      'components/Foo.bs': `
        sub init()
          sdk.users.getMe()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(1);
  });

  it('does not flag sdk.<ns>.<fn>() inside source/api/ApiClient.bs', () => {
    const diagnostics = runPluginOnSource(noDirectSdkPlugin, {
      'source/api/ApiClient.bs': `
        sub go()
          sdk.users.getMe()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('does not flag sdk.<ns>.<fn>() inside source/api/sdk.bs', () => {
    const diagnostics = runPluginOnSource(noDirectSdkPlugin, {
      'source/api/sdk.bs': `
        sub crossNamespaceCall()
          sdk.users.getMe()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('flags sdk.<ns>.<fn>() in a non-API source file', () => {
    const diagnostics = runPluginOnSource(noDirectSdkPlugin, {
      'source/utils/helper.bs': `
        sub doThing()
          sdk.items.list()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(1);
  });

  it('respects bsc-disable-line on the same line', () => {
    const diagnostics = runPluginOnSource(noDirectSdkPlugin, {
      'components/Foo.bs': `
        sub init()
          sdk.users.getMe() ' bsc-disable-line no-direct-sdk
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('respects bsc-disable-next-line on the line above', () => {
    const diagnostics = runPluginOnSource(noDirectSdkPlugin, {
      'components/Foo.bs': `
        sub init()
          ' bsc-disable-next-line no-direct-sdk
          sdk.users.getMe()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('does not flag a 3-level dotted call whose root is not literally `sdk`', () => {
    // The plugin matches only on root variable name === "sdk"; arbitrary
    // 3-level calls like foo.users.getMe() must not be flagged.
    const diagnostics = runPluginOnSource(noDirectSdkPlugin, {
      'components/Foo.bs': `
        sub init()
          foo.users.getMe()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('emits one diagnostic per offending sdk.* call', () => {
    const diagnostics = runPluginOnSource(noDirectSdkPlugin, {
      'components/Foo.bs': `
        sub init()
          sdk.users.getMe()
          sdk.items.list()
          sdk.libraries.refresh()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(3);
  });

  it('flags sdk.* even when an unrelated call shares the line', () => {
    // Only the sdk.* call should be flagged; the unrelated call is fine.
    const diagnostics = runPluginOnSource(noDirectSdkPlugin, {
      'components/Foo.bs': `
        sub init()
          x = sdk.users.getMe() : doSomethingElse()
        end sub
      `,
    });
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(1);
  });
});
