// scripts/lint/eslint-rules/_shared.js — helpers shared by the local ESLint rules.
//
// Underscore-prefixed because it is NOT a rule: `eslint.config.js` imports each rule by
// name (no directory glob), and the prefix keeps that obvious to a reader scanning the
// folder.
//
// It exists because three helpers had been copy-pasted across the four rules in here, and
// the drift that produces is exactly the failure those rules were written to police — a
// fix applied to one copy and not its twin, silently changing which files or which call
// shapes get checked. `scripts/lib/process-liveness.cjs` was extracted for the same
// reason: two readers of one question must not be able to answer it differently.

import path from 'node:path';

/** The repo-relative, POSIX-separated path ESLint is currently linting. */
export function relativeFilename(context) {
  const filename = context.filename ?? context.getFilename();
  return path
    .relative(context.cwd ?? process.cwd(), filename)
    .split(path.sep)
    .join('/');
}

/**
 * The plain name a `CallExpression` is calling, or `null` when it has none.
 *
 * Covers `sleep(...)` and `obj.sleep(...)` — the two shapes every rule in here matches on.
 * A computed member (`obj[k]()`) deliberately returns `null`: the name is not knowable
 * from syntax, and guessing would be worse than declining.
 */
export function calleeName(node) {
  const callee = node?.callee;
  if (!callee) return null;
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

/**
 * Visit `node` and every descendant, depth-first.
 *
 * `parent` is skipped because following it walks back up and never terminates. `loc` and
 * `range` are skipped as an optimisation only — neither carries a `type`, so the guard
 * below would reject them anyway.
 *
 * Full traversal with no early exit: a visitor that wants to stop keeps its own flag and
 * returns immediately, which is what the one short-circuiting caller does.
 */
export function walkAst(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === 'string') walkAst(child, visit);
      }
    } else if (value && typeof value.type === 'string') {
      walkAst(value, visit);
    }
  }
}
