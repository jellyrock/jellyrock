// Smoke test for the roku-log plugin.
//
// This plugin is Tier 2 (mutates transpile output rather than emitting
// diagnostics), so it doesn't fit the diagnostic-checking harness. Full
// scenario coverage is deferred to a follow-up — see
// `tasks/todo/bsc-plugin-tier2-harness.md`.
//
// Until then, this smoke test confirms the plugin loads as a factory,
// registers cleanly with a Program, and doesn't crash on a basic file
// containing m.log.* calls. Implicit regression coverage exists via every
// `npm run validate` and `npm run build` (the plugin runs as part of the
// real pipeline).

import { describe, it, expect } from 'vitest';
import { Program } from 'brighterscript';
import rokuLogPlugin from '../../../../scripts/bsc-plugins/roku-log.cjs';

describe('roku-log (smoke)', () => {
  it('exports a factory function', () => {
    expect(typeof rokuLogPlugin).toBe('function');
    const instance = rokuLogPlugin();
    expect(instance).toBeTruthy();
    expect(instance.name).toBe('roku-log-plugin');
  });

  it('loads into a Program without crashing', () => {
    const program = new Program({ rootDir: '/tmp/jellyrock-roku-log-smoke' });
    expect(() => program.plugins.add(rokuLogPlugin())).not.toThrow();
  });

  it('does not crash validating a file with m.log.* calls', () => {
    const program = new Program({ rootDir: '/tmp/jellyrock-roku-log-smoke' });
    program.plugins.add(rokuLogPlugin());
    program.setFile(
      'components/Foo.bs',
      `
        sub init()
          m.log = new log.Logger("Foo")
          m.log.info("hello")
          m.log.debug("intermediate", 1, 2)
        end sub
      `,
    );
    expect(() => program.validate()).not.toThrow();
  });
});
