// Tests for the no-namespace-const-call plugin.
//
// Plugin under test: scripts/bsc-plugins/no-namespace-const-call.cjs
// Diagnostic code: no-namespace-const-call
//
// What the plugin enforces: BrighterScript inlines a namespaced const or enum
// member only when it ends the expression. With a method call after it
// (`ns.PREFIX.len()`) the dotted chain is read as one function name and
// transpiles to a call of `ns_PREFIX_len()`, which does not exist. Wrap the
// value instead: `Len(ns.PREFIX)`.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import plugin from '../../../../scripts/bsc-plugins/no-namespace-const-call.cjs';

const CODE = 'no-namespace-const-call';

const DECLS = `
  namespace ns
    const PREFIX = "landing-"
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
  const TOP = "abc"
`;

function run(body, extra = {}) {
  return diagnosticsByCode(
    runPluginOnSource(plugin, {
      'source/decls.bs': DECLS,
      'source/use.bs': `
        function go() as dynamic
          ${body}
        end function
      `,
      ...extra,
    }),
    CODE,
  );
}

describe('no-namespace-const-call', () => {
  it('flags a method call on a namespaced const', () => {
    const d = run('return ns.PREFIX.len()');
    expect(d).toHaveLength(1);
    expect(d[0].severity).toBe(1);
    expect(d[0].message).toContain('Len(ns.PREFIX)');
    expect(d[0].location.uri).toContain('use.bs');
  });

  it('flags trim() on a namespaced const', () => {
    expect(run('return ns.PREFIX.trim()')).toHaveLength(1);
  });

  it('flags a const in a nested namespace', () => {
    expect(run('return a.b.DEEP.left(3)')).toHaveLength(1);
  });

  it('flags a relative reference from inside the namespace', () => {
    const d = run('return 1', {
      'source/inside.bs': `
        namespace ns
          function other() as integer
            return PREFIX.len()
          end function
        end namespace
      `,
    });
    expect(d).toHaveLength(1);
  });

  it('flags a method call on a namespaced enum member', () => {
    expect(run('return ns.Kind.Movie.len()')).toHaveLength(1);
  });

  it('does not flag a top-level const method call', () => {
    expect(run('return TOP.len()')).toHaveLength(0);
  });

  it('does not flag the wrapped form Len(ns.CONST)', () => {
    expect(run('return Len(ns.PREFIX)')).toHaveLength(0);
  });

  it('does not flag a namespaced function call', () => {
    expect(run('return ns.fn()')).toHaveLength(0);
  });

  it('does not flag a method call on a variable or AA field', () => {
    const d = run(`
      item = { name: "abc" }
      x = m.x.trim()
      return item.name.left(2)
    `);
    expect(d).toHaveLength(0);
  });

  it('does not flag a const used as a plain value', () => {
    expect(run('x = ns.PREFIX\n return x.len()')).toHaveLength(0);
  });

  it('honors bsc-disable-next-line', () => {
    expect(run(`' bsc-disable-next-line ${CODE}\n return ns.PREFIX.len()`)).toHaveLength(0);
  });
});
