// Smoke test for the translation-keys plugin.
//
// Tier 2 (generates a virtual file rather than emitting diagnostics), so
// it doesn't fit the diagnostic-checking harness. Full scenario coverage
// is deferred to a follow-up — see
// `tasks/todo/bsc-plugin-tier2-harness.md`.
//
// Until then, this smoke test confirms the plugin loads as a factory,
// registers with a Program, and gracefully handles the missing-en_US.json
// case (which is the only path that fires without disk fixtures). Implicit
// regression coverage exists via every `npm run validate` and `npm run build`.

import { describe, it, expect, afterEach } from 'vitest';
import { Program } from 'brighterscript';
import translationKeysPlugin from '../../../../scripts/bsc-plugins/translation-keys.cjs';

describe('translation-keys (smoke)', () => {
  let plugin;

  afterEach(() => {
    // Plugin uses fs.watch internally; close the watcher so it doesn't keep
    // the test process alive. The plugin's beforeRemoveProgram hook does
    // this, but we don't fire that hook in a smoke test.
    if (plugin && typeof plugin.stopWatching === 'function') {
      plugin.stopWatching();
    }
  });

  it('exports a factory function', () => {
    expect(typeof translationKeysPlugin).toBe('function');
    plugin = translationKeysPlugin();
    expect(plugin).toBeTruthy();
    expect(plugin.name).toBe('translation-keys-plugin');
  });

  it('loads into a Program without crashing', () => {
    const program = new Program({ rootDir: '/tmp/jellyrock-translation-keys-smoke' });
    plugin = translationKeysPlugin();
    expect(() => program.plugins.add(plugin)).not.toThrow();
  });
});
