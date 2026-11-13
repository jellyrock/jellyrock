// Tests for the no-namespace-const-call plugin.
//
// Plugin under test: scripts/bsc-plugins/no-namespace-const-call.cjs
// Diagnostic code: no-namespace-const-call
//
// What the plugin enforces: when a namespaced const or enum member is written
// with its namespace (`ns.PREFIX`) and a member access follows it, BrighterScript
// reads the whole chain as one namespaced name. `ns.PREFIX.len()` compiles to a
// call of `ns_PREFIX_len()` and `ns.CFG.a` to a read of `ns_CFG_a`, neither of
// which exists. The fix is parentheses: `(ns.PREFIX).len()`.
//
// One table of shapes drives two checks, so they cannot drift apart:
// - the plugin flags a shape exactly when the table says it compiles broken;
// - BrighterScript really compiles each shape to the output the table records.
// The second check is the canary for retiring the plugin. When a BrighterScript
// upgrade compiles a broken shape correctly, it fails and says so.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, runPluginOnEdits, diagnosticsByCode } from '../_helpers/run-plugin.js';
import { transpileWithPlugin } from '../_helpers/transpile-with-plugin.js';
import plugin from '../../../../scripts/bsc-plugins/no-namespace-const-call.cjs';

const CODE = 'no-namespace-const-call';
const RETIRE =
  'BrighterScript now compiles this shape differently. If it compiles correctly, retire the ' +
  'plugin (followup bsc-namespace-const-inlining-upstream in docs/progress.md); otherwise ' +
  'update this table and the plugin to match.';

const DECLS = `
  namespace ns
    const PREFIX = "landing-"
    const ARR = [1, 2, 3]
    const CFG = { a: 1 }
    enum Kind
      Movie = "movie"
    end enum
    function fn() as string
      return "x"
    end function
  end namespace
  namespace a.b
    const DEEP = "abcdef"
  end namespace
  enum TE
    A = "aaa"
  end enum
  const TOP = "abc"
`;

/** `body` as the body of a function, top level or inside `namespace <inside>`. */
function useFile(body, inside, params = '') {
  const func = `function go(${params}) as dynamic\n  ${body}\nend function`;
  return inside ? `namespace ${inside}\n${func}\nend namespace` : func;
}

function filesFor({ body, inside, params }) {
  return { 'source/decls.bs': DECLS, 'source/use.bs': useFile(body, inside, params) };
}

function findings(shape) {
  return diagnosticsByCode(runPluginOnSource(plugin, filesFor(shape)), CODE);
}

async function compiled(shape) {
  const out = await transpileWithPlugin(plugin, filesFor(shape));
  return out['source/use.bs'];
}

// `compiles` is a substring of BrighterScript's output for the shape.
const BROKEN = [
  {
    name: 'a method call on a namespaced const',
    body: 'return ns.PREFIX.len()',
    compiles: 'ns_PREFIX_len()',
  },
  {
    name: 'a method call with arguments',
    body: 'return a.b.DEEP.left(3)',
    compiles: 'a_b_DEEP_left(3)',
  },
  {
    name: 'a method call on a namespaced array const',
    body: 'return ns.ARR.count()',
    compiles: 'ns_ARR_count()',
  },
  {
    name: 'a method call on a namespaced enum member',
    body: 'return ns.Kind.Movie.len()',
    compiles: 'ns_Kind_Movie_len()',
  },
  { name: 'a field read on a namespaced AA const', body: 'return ns.CFG.a', compiles: 'ns_CFG_a' },
  {
    name: 'a call on a field of a namespaced AA const',
    body: 'return ns.CFG.a.toStr()',
    compiles: 'ns_CFG_a_toStr()',
  },
  {
    name: 'the full form inside its own namespace',
    body: 'return ns.PREFIX.len()',
    inside: 'ns',
    compiles: 'ns_PREFIX_len()',
  },
  {
    name: 'a call inside a condition',
    body: 'if ns.PREFIX.len() > 0 then return 1',
    compiles: 'ns_PREFIX_len()',
  },
];

const CORRECT = [
  { name: 'a method call on a top-level const', body: 'return TOP.len()', compiles: '"abc".len()' },
  {
    name: 'a method call on a top-level enum member',
    body: 'return TE.A.len()',
    compiles: '"aaa".len()',
  },
  {
    name: 'the relative form of a const inside its namespace',
    body: 'return PREFIX.len()',
    inside: 'ns',
    compiles: '"landing-".len()',
  },
  {
    name: 'the relative form of an enum member inside its namespace',
    body: 'return Kind.Movie.len()',
    inside: 'ns',
    compiles: '"movie".len()',
  },
  {
    name: 'a parameter named like a const in the same namespace',
    body: 'return prefix.len()',
    inside: 'ns',
    params: 'prefix as string',
    compiles: 'prefix.len()',
  },
  {
    name: 'a local named like a const in the same namespace',
    body: 'Prefix = "zz"\n  return Prefix.len()',
    inside: 'ns',
    compiles: 'Prefix.len()',
  },
  {
    name: 'the const in parentheses',
    body: 'return (ns.PREFIX).len()',
    compiles: '("landing-").len()',
  },
  {
    name: 'the enum member in parentheses',
    body: 'return (ns.Kind.Movie).len()',
    compiles: '("movie").len()',
  },
  { name: 'the AA const in parentheses', body: 'return (ns.CFG).a', compiles: '})).a' },
  {
    name: 'the const wrapped in a function',
    body: 'return Len(ns.PREFIX)',
    compiles: 'Len("landing-")',
  },
  { name: 'an index into a namespaced array const', body: 'return ns.ARR[0]', compiles: '])[0]' },
  { name: 'a namespaced function call', body: 'return ns.fn()', compiles: 'ns_fn()' },
  {
    name: 'a const used as a plain value',
    body: 'x = ns.PREFIX\n  return x.len()',
    compiles: 'x = "landing-"',
  },
  {
    name: 'a method call on an AA field',
    body: 'item = { name: "abc" }\n  return item.name.left(2)',
    compiles: 'item.name.left(2)',
  },
];

describe('no-namespace-const-call', () => {
  describe('flags a shape BrighterScript compiles to a name that does not exist', () => {
    for (const shape of BROKEN) {
      it(shape.name, async () => {
        expect(await compiled(shape), RETIRE).toContain(shape.compiles);
        expect(findings(shape)).toHaveLength(1);
      });
    }
  });

  describe('leaves a shape BrighterScript compiles correctly', () => {
    for (const shape of CORRECT) {
      it(shape.name, async () => {
        expect(await compiled(shape)).toContain(shape.compiles);
        expect(findings(shape)).toHaveLength(0);
      });
    }
  });

  describe('the message', () => {
    it('names the compiled call and the parenthesized fix, at error severity', () => {
      const [d] = findings({ body: 'return ns.PREFIX.len()' });
      expect(d.severity).toBe(1);
      expect(d.message).toContain('ns_PREFIX_len()');
      expect(d.message).toContain('(ns.PREFIX).len()');
      expect(d.location.uri).toContain('use.bs');
    });

    it('names the compiled variable for a field read', () => {
      const [d] = findings({ body: 'return ns.CFG.a' });
      expect(d.message).toContain('ns_CFG_a');
      expect(d.message).toContain('(ns.CFG).a');
    });

    it('names an enum member as one', () => {
      const [d] = findings({ body: 'return ns.Kind.Movie.len()' });
      expect(d.message).toContain('enum member');
      expect(d.message).toContain('(ns.Kind.Movie).len()');
    });
  });

  describe('across edits', () => {
    it('clears the finding when the declaring file turns the const into a function', () => {
      const use = 'function go() as dynamic\n  return ns.PREFIX.len()\nend function';
      const steps = runPluginOnEdits(plugin, [
        {
          'source/decls.bs': 'namespace ns\n  const PREFIX = "a"\nend namespace',
          'source/use.bs': use,
        },
        {
          'source/decls.bs':
            'namespace ns\n  function PREFIX() as string\n    return "a"\n  end function\nend namespace',
        },
      ]);
      expect(diagnosticsByCode(steps[0], CODE)).toHaveLength(1);
      expect(diagnosticsByCode(steps[1], CODE)).toHaveLength(0);
    });
  });

  describe('suppression markers', () => {
    it('honors bsc-disable-next-line', () => {
      expect(
        findings({ body: `' bsc-disable-next-line ${CODE}\n  return ns.PREFIX.len()` }),
      ).toHaveLength(0);
    });

    it('honors bsc-disable-line', () => {
      expect(findings({ body: `return ns.PREFIX.len() ' bsc-disable-line ${CODE}` })).toHaveLength(
        0,
      );
    });
  });
});
