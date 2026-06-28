// Tier 2 coverage for the translation-keys plugin.
//
// Each scenario uses `createTranslationKeysHarness` to write a synthetic
// en_US.json into a tmpdir, fire the plugin's lifecycle hooks against a
// real Program, and assert on the generated `pkg:/source/translationKeys.bs`
// source.
//
// See `scripts/bsc-plugins/translation-keys.cjs` for the plugin under test.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTranslationKeysHarness } from '../_helpers/run-plugin-with-temp-locale.js';
import translationKeysPlugin from '../../../../scripts/bsc-plugins/translation-keys.cjs';

describe('translation-keys plugin (Tier 2)', () => {
  let harness;

  beforeEach(() => {
    harness = createTranslationKeysHarness(translationKeysPlugin);
  });

  afterEach(() => {
    harness.teardown();
  });

  it('generates a const for each valid key', () => {
    const { source } = harness.setup({
      localeJson: JSON.stringify({ greeting: 'Hello', farewell: 'Bye' }),
    });
    expect(source).toMatch(/namespace translationKeys/);
    expect(source).toMatch(/const greeting = "greeting"/);
    expect(source).toMatch(/const farewell = "farewell"/);
    expect(source).toMatch(/end namespace/);
  });

  it('emits an empty namespace with WARNING comment when locale file is missing', () => {
    const { source } = harness.setup({/* no localeJson */});
    expect(source).toMatch(/WARNING: Could not read base translation file/);
    expect(source).toMatch(/namespace translationKeys\s*\nend namespace/);
  });

  it('emits an empty namespace with WARNING when JSON is invalid', () => {
    const { source } = harness.setup({ localeJson: 'not valid json{{' });
    expect(source).toMatch(/WARNING: Could not read base translation file: Invalid JSON:/);
    expect(source).toMatch(/namespace translationKeys\s*\nend namespace/);
  });

  it('silently skips keys that are not valid BS identifiers', () => {
    const { source } = harness.setup({
      localeJson: JSON.stringify({
        validKey: 'a',
        '123bad': 'b',
        'with space': 'c',
        'has-dash': 'd',
      }),
    });
    expect(source).toMatch(/const validKey = "validKey"/);
    expect(source).not.toMatch(/123bad/);
    expect(source).not.toMatch(/with space/);
    expect(source).not.toMatch(/has-dash/);
  });

  it('detects plural bases when XZero/XOne/XMany all exist and X does not', () => {
    const { source } = harness.setup({
      localeJson: JSON.stringify({
        itemZero: '0',
        itemOne: '1',
        itemMany: 'n',
      }),
    });
    expect(source).toMatch(/const itemZero = "itemZero"/);
    expect(source).toMatch(/const itemOne = "itemOne"/);
    expect(source).toMatch(/const itemMany = "itemMany"/);
    expect(source).toMatch(/Plural base keys/);
    expect(source).toMatch(/const item = "item"/);
  });

  it('does not double-emit a plural base when the plain key is already present', () => {
    const { source } = harness.setup({
      localeJson: JSON.stringify({
        itemZero: '0',
        itemOne: '1',
        itemMany: 'n',
        item: 'plain',
      }),
    });
    // Plain `item` const should appear exactly once, not in a plural-base section
    const itemConstMatches = source.match(/const item = "item"/g);
    expect(itemConstMatches).toHaveLength(1);
    expect(source).not.toMatch(/Plural base keys/);
  });

  it('regenerates via beforeValidateProgram when locale content changes', () => {
    const initial = harness.setup({ localeJson: JSON.stringify({ first: 'a' }) }).source;
    expect(initial).toMatch(/const first = "first"/);
    expect(initial).not.toMatch(/const second/);

    harness.writeLocale(JSON.stringify({ first: 'a', second: 'b' }));
    const updated = harness.regenerate();
    expect(updated).toMatch(/const first = "first"/);
    expect(updated).toMatch(/const second = "second"/);
  });
});
