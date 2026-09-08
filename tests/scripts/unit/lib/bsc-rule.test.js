// Tests for scripts/lib/bsc-rule.cjs — the shared lifecycle for BSC convention
// plugins.
//
// The lifecycle is tested with SYNTHETIC rules rather than through a real
// plugin, so a failure here points at the lifecycle and not at somebody's
// wiring logic. The rules below are deliberately trivial: what matters is WHEN
// their findings appear and disappear, not what they detect.
//
// The regression this module exists for: a rule whose verdict depends on the
// component XML but whose finding is anchored in the codebehind. BSC clears
// diagnostics per file by location, so editing the XML used to leave the stale
// finding sitting on the .bs. `clears when only the XML half changes` is that
// bug; the rest guard against over-correcting into dropped findings.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { Program } from 'brighterscript';

const require = createRequire(import.meta.url);
const {
  createScopeRule,
  createProgramRule,
  stringLiteralValue,
  referenceText,
  isSuppressed,
} = require('../../../../scripts/lib/bsc-rule.cjs');

const CODE = 'synthetic-rule';

// Component XML whose interface optionally carries an onChange — the "other
// half" whose edits must move the verdict.
const xml = (withOnChange) =>
  `<?xml version="1.0" encoding="utf-8" ?>
<component name="Foo" extends="Group">
  <interface>
    <field id="flag" type="boolean"${withOnChange ? ' onChange="onFlag"' : ''} />
  </interface>
  <script type="text/brightscript" uri="Foo.bs" />
</component>`;

const bs = (extra = '') => `sub init()\n${extra}end sub\nsub onFlag()\nend sub`;

// Reports once, anchored in the CODEBEHIND, iff the XML declares an onChange.
// That is the exact cross-file shape the module exists to make safe.
const syntheticScopeRule = () =>
  createScopeRule({
    name: 'jellyrock-synthetic',
    analyze({ xmlFile, brsFile, report }) {
      const fields =
        xmlFile?.parser?.ast?.componentElement?.interfaceElement?.getElementsByTagName?.('field') ||
        [];
      if (![...fields].some((f) => f?.onChange)) return;
      const statement = brsFile?.parser?.ast?.statements?.[0];
      if (!statement?.location) return;
      report({ code: CODE, message: 'synthetic finding', location: statement.location });
    },
  });

function run(pluginFactory, steps) {
  const program = new Program({ rootDir: '/tmp/jellyrock-bsc-rule-test' });
  program.plugins.add(pluginFactory());
  return steps.map((files) => {
    for (const [path, content] of Object.entries(files)) program.setFile(path, content);
    program.validate();
    return program.getDiagnostics().filter((d) => d.code === CODE);
  });
}

describe('createScopeRule — cross-file diagnostic lifecycle', () => {
  it('reports a finding whose verdict comes from the XML half', () => {
    const [found] = run(syntheticScopeRule, [
      { 'components/Foo.xml': xml(true), 'components/Foo.bs': bs() },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].location.uri).toMatch(/Foo\.bs$/);
    expect(found[0].severity).toBe(1);
  });

  it('clears when only the XML half changes — the stale-diagnostic regression', () => {
    const [before, after] = run(syntheticScopeRule, [
      { 'components/Foo.xml': xml(true), 'components/Foo.bs': bs() },
      { 'components/Foo.xml': xml(false) },
    ]);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(0);
  });

  it('clears when only the codebehind changes', () => {
    const [before, after] = run(syntheticScopeRule, [
      { 'components/Foo.xml': xml(true), 'components/Foo.bs': bs() },
      // No statements left to anchor to, so the rule reports nothing.
      { 'components/Foo.bs': '' },
    ]);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(0);
  });

  it('appears when the XML half introduces the condition', () => {
    const [before, after] = run(syntheticScopeRule, [
      { 'components/Foo.xml': xml(false), 'components/Foo.bs': bs() },
      { 'components/Foo.xml': xml(true) },
    ]);
    expect(before).toHaveLength(0);
    expect(after).toHaveLength(1);
  });

  it('keeps a finding when an UNRELATED component is edited', () => {
    const [, afterUnrelated] = run(syntheticScopeRule, [
      {
        'components/Foo.xml': xml(true),
        'components/Foo.bs': bs(),
        'components/Other.xml': xml(false).replace(/Foo/g, 'Other'),
        'components/Other.bs': bs(),
      },
      { 'components/Other.bs': bs('  x = 1\n') },
    ]);
    expect(afterUnrelated).toHaveLength(1);
  });

  it('does not duplicate a finding across repeated validations', () => {
    const [, second, third] = run(syntheticScopeRule, [
      { 'components/Foo.xml': xml(true), 'components/Foo.bs': bs() },
      {},
      {},
    ]);
    expect(second).toHaveLength(1);
    expect(third).toHaveLength(1);
  });

  it('says nothing about a component with no codebehind', () => {
    const [found] = run(syntheticScopeRule, [{ 'components/Foo.xml': xml(true) }]);
    expect(found).toHaveLength(0);
  });

  it('never crashes the build when a rule throws', () => {
    const exploding = () =>
      createScopeRule({
        name: 'jellyrock-exploding',
        analyze() {
          throw new Error('rule blew up');
        },
      });
    expect(() =>
      run(exploding, [{ 'components/Foo.xml': xml(true), 'components/Foo.bs': bs() }]),
    ).not.toThrow();
  });

  it('honours a suppression marker on the reported line', () => {
    const suppressing = () =>
      createScopeRule({
        name: 'jellyrock-suppressible',
        analyze({ brsFile, report }) {
          // Anchor on the SECOND statement, which the fixture comments out.
          const statement = brsFile?.parser?.ast?.statements?.[1];
          if (!statement?.location) return;
          report({ code: CODE, message: 'suppressible', location: statement.location });
        },
      });
    const [found] = run(suppressing, [
      {
        'components/Foo.xml': xml(true),
        'components/Foo.bs': `sub init()\nend sub\n' bsc-disable-next-line ${CODE}\nsub onFlag()\nend sub`,
      },
    ]);
    expect(found).toHaveLength(0);
  });
});

describe('createProgramRule — program-wide diagnostic lifecycle', () => {
  // Reports once per .bs file that contains the word "flagme".
  const rule = () =>
    createProgramRule({
      name: 'jellyrock-synthetic-program',
      analyze({ program, report }) {
        for (const file of Object.values(program.files || {})) {
          if (!file.srcPath?.endsWith('.bs')) continue;
          if (!/flagme/.test(file.fileContents || '')) continue;
          const statement = file?.parser?.ast?.statements?.[0];
          if (!statement?.location) continue;
          report({ code: CODE, message: 'program finding', location: statement.location, file });
        }
      },
    });

  it('reports across the program', () => {
    const [found] = run(rule, [
      { 'components/Foo.xml': xml(false), 'components/Foo.bs': bs('  flagme = 1\n') },
    ]);
    expect(found).toHaveLength(1);
  });

  it('clears a finding once the condition is gone', () => {
    const [before, after] = run(rule, [
      { 'components/Foo.xml': xml(false), 'components/Foo.bs': bs('  flagme = 1\n') },
      { 'components/Foo.bs': bs() },
    ]);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(0);
  });

  it('never crashes the build when a rule throws', () => {
    const exploding = () =>
      createProgramRule({
        name: 'jellyrock-exploding-program',
        analyze() {
          throw new Error('rule blew up');
        },
      });
    expect(() => run(exploding, [{ 'components/Foo.bs': bs() }])).not.toThrow();
  });
});

describe('stringLiteralValue', () => {
  it('unwraps a double-quoted literal', () => {
    expect(stringLiteralValue('"itemContent"')).toBe('itemContent');
  });

  it('returns the empty string for an empty literal', () => {
    expect(stringLiteralValue('""')).toBe('');
  });

  it('returns null for a non-string literal rather than inventing a name', () => {
    expect(stringLiteralValue('5')).toBeNull();
    expect(stringLiteralValue('true')).toBeNull();
  });

  it('returns null for a non-string input', () => {
    expect(stringLiteralValue(undefined)).toBeNull();
    expect(stringLiteralValue(42)).toBeNull();
  });
});

describe('referenceText', () => {
  const variable = (name) => ({ kind: 'x', tokens: { name: { text: name } } });

  it('returns null for anything that is not a reference chain', () => {
    expect(referenceText(null)).toBeNull();
    expect(referenceText(variable('m'))).toBeNull(); // not a real VariableExpression
  });
});

describe('isSuppressed', () => {
  const file = (contents) => ({ fileContents: contents });

  it('honours a file-level marker anywhere in the file', () => {
    expect(isSuppressed(file(`' bsc-disable-file ${CODE}\nsub init()\nend sub`), CODE, 1)).toBe(
      true,
    );
  });

  it('honours a line-level marker on the reported line', () => {
    expect(
      isSuppressed(file(`sub init()\n  x = 1 ' bsc-disable-line ${CODE}\nend sub`), CODE, 1),
    ).toBe(true);
  });

  it('honours a next-line marker on the line above', () => {
    expect(
      isSuppressed(
        file(`sub init()\n  ' bsc-disable-next-line ${CODE}\n  x = 1\nend sub`),
        CODE,
        2,
      ),
    ).toBe(true);
  });

  it('scopes a suppression to its own code', () => {
    expect(isSuppressed(file(`' bsc-disable-file other-code\nx = 1`), CODE, 1)).toBe(false);
  });

  it('is false with no marker present', () => {
    expect(isSuppressed(file('sub init()\nend sub'), CODE, 1)).toBe(false);
  });
});
