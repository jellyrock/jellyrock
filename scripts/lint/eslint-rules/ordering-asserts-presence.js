// scripts/lint/eslint-rules/ordering-asserts-presence.js — an assertion that two things
// appear in a given ORDER has to establish that they appear at all.
//
// WHY THIS EXISTS
// ---------------
// `indexOf`, `lastIndexOf`, `findIndex` and `search` answer **-1** for "not found", and -1
// is less than every real index. So this:
//
//     expect(code.indexOf('the guard')).toBeLessThan(code.indexOf('the risky read'));
//
// passes when `the guard` is absent from `code` **entirely**. The test reads as "the guard
// is emitted before the read"; what it actually checks is "the guard is emitted before the
// read, OR is not emitted at all". Those are very different claims, and only the first one
// is the reason the test was written.
//
// This is not a hypothetical shape. It was found in this repo three ways:
//   - `tests/rta/lib/diagnostics.test.js:278` — caught by mutation on 2026-09-06 (deleting
//     the screensaver line left the ordering test green) and guarded in place.
//   - Eleven more sites found by an AST audit on 2026-09-07, proven vacuous the same way:
//     rewriting the searched-for text to something unfindable left **57/57 tests green**,
//     including three in `auto-destroyed-guard.test.js`, whose plugin's entire job is
//     emitting a crash guard.
//   - The same audit found the sibling shape in the RTA specs — comparing one device read
//     against another, where two absent reads are `undefined === undefined`.
//
// WHY A LINT RULE RATHER THAN A CONVENTION
// -----------------------------------------
// A vacuous gate is invisible in exactly the way that matters: it does not fail, it does
// not warn, and it does not look different from a sound one in review. Both operands are
// `x.indexOf(...)`; whether the test proves anything depends on an assertion that is
// somewhere else in the body, or missing. That is not something a reader reliably notices,
// which is the whole argument for a gate — the same argument `rta-sleep-budgeted` makes
// about a `sleep()` that a reviewer cannot tell from its ten legitimate neighbours.
//
// It is also, unlike the sibling RTA rules, not an INVENTORY. There is no budget and no
// ratchet, because unlike a `sleep()` there is no such thing as a justified vacuous
// ordering assert — the fix is one line (`expect(idx).toBeGreaterThan(-1)`), it is always
// available, and it always strengthens the test. A rule with no escape hatch is the right
// shape when compliance is free.
//
// WHAT COUNTS AS PRESENCE
// -----------------------
// Any numeric floor at or above "not found" proves the operand was found:
// `toBeGreaterThan(-1)`, `toBeGreaterThan(0)`, `toBeGreaterThanOrEqual(0)`, and the
// explicit `not.toBe(-1)` / `not.toEqual(-1)`. An ordering assertion can therefore double
// as its own presence proof — `expect(idx).toBeGreaterThan(0)` both orders and proves.
//
// `expect(haystack).toContain(needle)` counts too, and is the better fix where it applies:
// it is the idiomatic Vitest spelling, and it reports the missing VALUE on failure where a
// bare `toBeGreaterThan(-1)` reports only "-1 is not greater than -1". Accepting it is
// what stops the rule pushing every call site toward the less readable guard. It proves
// `haystack.indexOf(needle)` and `haystack.lastIndexOf(needle)` only — `findIndex` takes a
// predicate rather than the value, so `toContain` says nothing about it.
//
// The search for that proof is scoped to the ENCLOSING TEST BODY, not the file. A presence
// assertion in one `it()` says nothing about the operands of another, and treating the
// file as one scope would silently excuse the second.

import { walkAst } from './_shared.js';

const SEARCHES = new Set(['indexOf', 'lastIndexOf', 'findIndex', 'search']);
const ORDERING = new Set([
  'toBeLessThan',
  'toBeLessThanOrEqual',
  'toBeGreaterThan',
  'toBeGreaterThanOrEqual',
]);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/**
 * Callers whose function argument is a TEST BODY — the scope a presence proof governs.
 *
 * `describe` is deliberately absent: two `it()`s inside one `describe` are separate tests,
 * and treating the describe body as one scope would let a proof in the first excuse a
 * vacuous assert in the second. That is the same reason the file is not one scope.
 */
const TEST_CALLERS = new Set(['it', 'test', 'fit', 'xit', 'specify']);

/** Is this function the body argument of an `it()` / `test()` call? */
function isTestBody(fn) {
  const call = fn.parent;
  if (call?.type !== 'CallExpression' || !call.arguments.includes(fn)) return false;
  const callee = call.callee;
  // Covers `it(...)`, `it.each(...)(...)`'s inner call, and `it.only` / `it.skip`.
  const root =
    callee.type === 'Identifier'
      ? callee.name
      : callee.type === 'MemberExpression' && callee.object.type === 'Identifier'
        ? callee.object.name
        : null;
  return TEST_CALLERS.has(root);
}

/** True when `node` is a direct call to one of the -1-returning search methods. */
function isSearchCall(node) {
  return (
    node?.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.property.type === 'Identifier' &&
    SEARCHES.has(node.callee.property.name)
  );
}

/** Strip `.not` / `.resolves` / `.rejects` to reach the `expect(...)` call itself. */
function expectCallOf(memberExpression) {
  let object = memberExpression.object;
  while (object.type === 'MemberExpression') object = object.object;
  return object.type === 'CallExpression' &&
    object.callee.type === 'Identifier' &&
    object.callee.name === 'expect'
    ? object
    : null;
}

/**
 * The matcher `node` applies, if it asserts its subject is a FOUND index.
 *
 * `toBe(-1)` and `toEqual(-1)` only prove presence under a `.not`, so the negation is
 * checked rather than assumed from the matcher name.
 */
/** Does a `.not` sit between `expect(...)` and this matcher? */
function isNegated(node) {
  for (let o = node.callee.object; o.type === 'MemberExpression'; o = o.object) {
    if (o.property.type === 'Identifier' && o.property.name === 'not') return true;
  }
  return false;
}

function isPresenceAssertion(node) {
  if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return false;
  const matcher = node.callee.property.type === 'Identifier' ? node.callee.property.name : null;
  const argument = node.arguments[0];
  if (!argument) return false;

  const bound =
    argument.type === 'UnaryExpression' &&
    argument.operator === '-' &&
    argument.argument.type === 'Literal'
      ? -argument.argument.value
      : argument.type === 'Literal' && typeof argument.value === 'number'
        ? argument.value
        : null;

  const negated = isNegated(node);

  // The negation is checked for EVERY matcher, not just the equality pair. `.not` inverts
  // a lower bound into an upper one, so `expect(idx).not.toBeGreaterThan(-1)` asserts the
  // index is at most -1 — that the value was NOT found. Reading it as a presence proof
  // would let the one shape that states the opposite of presence wave a vacuous ordering
  // assert through, which is the rule failing in the exact direction it exists to prevent.
  if (matcher === 'toBeGreaterThan') return !negated && bound !== null && bound >= -1;
  if (matcher === 'toBeGreaterThanOrEqual') return !negated && bound !== null && bound >= 0;
  // `toBe(-1)` / `toEqual(-1)` prove presence only UNDER a `.not` — the mirror image.
  if (matcher === 'toBe' || matcher === 'toEqual') return negated && bound === -1;
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'An ordering assertion over indexOf/findIndex must also assert its operands were found — -1 is less than every real index, so the assertion passes when the thing is absent.',
    },
    schema: [],
    messages: {
      vacuous:
        '`{{operand}}` answers -1 when not found, and -1 satisfies this ordering assertion — so it passes when the value is absent entirely. Assert presence in this test body first: `{{fix}}`.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /**
     * True when `identifier` resolves to a binding initialised from a sentinel search —
     * `const idx = haystack.indexOf(x)`.
     *
     * Resolved through the SCOPE rather than a file-wide name table: two tests in one file
     * routinely both declare `idx`, and only one of them need be an `indexOf`. Keying on
     * the name alone would report the other one, and a rule with no escape hatch cannot
     * afford a false positive — the only way out of one is to disable the rule.
     */
    function isSentinelBinding(identifier) {
      const variable = sourceCode
        .getScope(identifier)
        .references.find((r) => r.identifier === identifier)?.resolved;
      if (!variable) return false;
      return variable.defs.some((def) => {
        const init = def.node?.type === 'VariableDeclarator' ? def.node.init : null;
        if (!init) return false;
        let found = false;
        walkAst(init, (n) => {
          if (isSearchCall(n)) found = true;
        });
        return found;
      });
    }

    /**
     * The scope a presence proof must sit in: the enclosing TEST body where there is one,
     * and otherwise the nearest enclosing function.
     *
     * ## Why not simply the nearest function
     *
     * That was the first shape, and it false-positives on a nested callback. An ordering
     * assert inside a `forEach` / `map` / `for (const … )` arrow cannot see a presence
     * assert sitting in the `it()` body around it, even though that assert governs it
     * perfectly well — the operands are the same, and the proof ran before the loop.
     *
     * A false positive matters more here than in the sibling RTA rules, because this rule
     * deliberately has no escape hatch: its header argues that compliance is always one
     * free line, so there is no budget, no allowlist, and the only way out of a wrong
     * report is disabling the rule. A rule people disable is worse than no rule.
     *
     * The scope still stops at the test: a presence assertion in one `it()` says nothing
     * about the operands of another, and widening to the file would silently excuse the
     * second. So this walks out through nested callbacks and stops at the first function
     * that IS a test body.
     */
    function enclosingBody(node) {
      let nearestFunction = null;
      for (let n = node; n; n = n.parent) {
        if (!FUNCTIONS.has(n.type)) continue;
        if (!nearestFunction) nearestFunction = n;
        if (isTestBody(n)) return n.body;
      }
      return nearestFunction?.body ?? null;
    }

    /**
     * Every operand text that carries a presence assertion inside `body`.
     *
     * `expect(h).toContain(n)` is recorded as proving the two searches whose result it
     * actually constrains — `h.indexOf(n)` and `h.lastIndexOf(n)` — by synthesising their
     * source text, which is what the operand check below compares against.
     */
    function provenPresentIn(body) {
      const proven = new Set();
      /** Haystack source text -> the string literals asserted to be contained in it. */
      const contains = new Map();
      if (!body) return { proven, contains };
      walkAst(body, (node) => {
        if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return;
        const call = expectCallOf(node.callee);
        if (!call?.arguments[0]) return;
        const subject = sourceCode.getText(call.arguments[0]);

        if (isPresenceAssertion(node)) {
          proven.add(subject);
          return;
        }
        const matcher =
          node.callee.property.type === 'Identifier' ? node.callee.property.name : null;
        if (matcher === 'toContain' && node.arguments[0]) {
          const needle = node.arguments[0];
          proven.add(`${subject}.indexOf(${sourceCode.getText(needle)})`);
          proven.add(`${subject}.lastIndexOf(${sourceCode.getText(needle)})`);
          if (needle.type === 'Literal' && typeof needle.value === 'string') {
            if (!contains.has(subject)) contains.set(subject, []);
            contains.get(subject).push(needle.value);
          }
        }
      });
      return { proven, contains };
    }

    return {
      'CallExpression:exit'(node) {
        if (node.callee.type !== 'MemberExpression') return;
        const matcher =
          node.callee.property.type === 'Identifier' ? node.callee.property.name : null;
        if (!ORDERING.has(matcher)) return;
        const expectCall = expectCallOf(node.callee);
        if (!expectCall?.arguments[0]) return;

        // A NEGATED ordering assertion is left alone. `.not` inverts the claim, so
        // "the operand must have been found" stops being its precondition — and the
        // common negated shape, `expect(idx).not.toBeGreaterThan(-1)`, is a deliberate
        // assertion that the value is ABSENT. Reporting it would demand a presence proof
        // for the one assertion whose whole point is the opposite.
        //
        // This leaves one narrow shape unreported: `expect(a.indexOf(x)).not.toBeLessThan(
        // b.indexOf(y))` is satisfied when both are -1. It is accepted deliberately, on
        // this rule's own no-escape-hatch argument — a false positive can only be answered
        // by disabling the rule, so where the two errors are not symmetric the false
        // NEGATIVE is the cheaper one. No instance exists in the tree.
        if (isNegated(node)) return;

        const { proven, contains } = provenPresentIn(enclosingBody(node));

        /**
         * `expect(h).toContain('- 2026-05-10 — fix: beta crash')` also proves
         * `h.indexOf('beta crash')` is found — presence of the longer literal entails
         * presence of any substring of it. Crediting that is what stops the rule
         * demanding a second, redundant assertion next to a sound one.
         */
        const provenBySubstring = (operand) => {
          if (!isSearchCall(operand)) return false;
          const method = operand.callee.property.name;
          if (method !== 'indexOf' && method !== 'lastIndexOf') return false;
          const needle = operand.arguments[0];
          if (needle?.type !== 'Literal' || typeof needle.value !== 'string') return false;
          const haystack = sourceCode.getText(operand.callee.object);
          return (contains.get(haystack) ?? []).some((asserted) => asserted.includes(needle.value));
        };

        for (const operand of [expectCall.arguments[0], node.arguments[0]]) {
          if (!operand) continue;
          const isSentinel =
            isSearchCall(operand) || (operand.type === 'Identifier' && isSentinelBinding(operand));
          if (!isSentinel) continue;
          const text = sourceCode.getText(operand);
          if (proven.has(text) || provenBySubstring(operand)) continue;
          // Name the idiomatic fix where it applies, so the message does not steer an
          // `indexOf` site toward the numeric guard that reads worse on failure.
          const searchMethod = isSearchCall(operand) ? operand.callee.property.name : null;
          const fix =
            (searchMethod === 'indexOf' || searchMethod === 'lastIndexOf') && operand.arguments[0]
              ? `expect(${sourceCode.getText(operand.callee.object)}).toContain(${sourceCode.getText(operand.arguments[0])})`
              : `expect(${text}).toBeGreaterThan(-1)`;
          context.report({ node: operand, messageId: 'vacuous', data: { operand: text, fix } });
        }
      },
    };
  },
};
