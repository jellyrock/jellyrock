/**
 * BrighterScript plugin — observeField → unobserveField pairing in JRScreen subclasses.
 *
 * For any RSG component whose codebehind extends `JRScreen` (transitively),
 * every `<target>.observeField("<field>", ...)` call must have a matching
 * `<target>.unobserveField("<field>")` somewhere in the same codebehind file.
 *
 * Alias-aware: an assignment like `m.dialog = dialog` or
 * `m.activeContent = m.homeRows` makes `dialog`, `m.dialog`, `m.activeContent`
 * and `m.homeRows` interchangeable for matching purposes (union-find over
 * simple reference chains). This way the canonical pattern of
 *   1. resolve a node ref into a local var
 *   2. cache it on `m`
 *   3. observe via the local
 *   4. unobserve via `m`
 * matches without an opt-out.
 *
 * "Matching" requires the same field name. We deliberately don't require the
 * unobserve to live inside `onDestroy()` because many codebases legitimately
 * unobserve in `onScreenHidden`, dedicated cleanup helpers, or tear-down on
 * tab switch. The intent is to catch the common bug of "I set up an observer
 * and never tore it down anywhere".
 *
 * Scoped/unscoped strictness: `observeField` pairs only with `unobserveField`,
 * and `observeFieldScoped` pairs only with `unobserveFieldScoped`. Roku tracks
 * the two on separate observer lists, so a mismatched pair leaves the
 * registration alive even though the code looks correct. The plugin keeps the
 * two scopes in separate maps and won't cross-match.
 *
 * Runs per component SCOPE (`scripts/lib/bsc-rule.cjs`). The JRScreen-ness half
 * of the verdict comes from the XML while the warning is anchored in the `.bs`,
 * so moving a component out of the JRScreen hierarchy has to clear its warnings
 * — which it did not when this ran off the file hook.
 *
 * Escape hatch:
 *  - `' bsc-disable-line observe-without-on-destroy` on the observeField line
 *  - `' bsc-disable-next-line observe-without-on-destroy` on the line above
 *  - `' bsc-disable-file observe-without-on-destroy` anywhere in the file
 */
'use strict';

const brighterscript = require('brighterscript');
const { createScopeRule, stringLiteralValue, referenceText } = require('../lib/bsc-rule.cjs');

const TARGET_BASE = 'JRScreen';
const MAX_PARENT_CHAIN_DEPTH = 32;
const DIAGNOSTIC_CODE = 'observe-without-on-destroy';

module.exports = () =>
  createScopeRule({
    name: 'jellyrock-observe-without-on-destroy',
    analyze({ xmlFile, brsFile, report }) {
      const componentName = xmlFile.componentName?.text;
      if (!componentName || componentName === TARGET_BASE) return;
      if (!descendsFromJRScreen(xmlFile)) return;

      const aliases = new UnionFind();
      const observes = [];
      // Two separate maps so observeField and observeFieldScoped can't
      // accidentally satisfy each other — Roku stores them on different
      // observer lists, so an unobserveField won't release an
      // observeFieldScoped (and vice versa).
      const unobserveByField = new Map(); // fieldName → Set<canonicalTarget>
      const unobserveByFieldScoped = new Map(); // fieldName → Set<canonicalTarget>

      const visitor = brighterscript.createVisitor({
        AssignmentStatement: (stmt) => {
          const lhsName = stmt.tokens?.name?.text;
          if (!lhsName) return;
          const rhsRef = referenceText(stmt.value);
          if (!rhsRef) return;
          aliases.union(lhsName, rhsRef);
        },
        DottedSetStatement: (stmt) => {
          const baseRef = referenceText(stmt.obj);
          if (!baseRef) return;
          const name = stmt.tokens?.name?.text;
          if (!name) return;
          const lhsRef = `${baseRef}.${name}`;
          const rhsRef = referenceText(stmt.value);
          if (!rhsRef) return;
          aliases.union(lhsRef, rhsRef);
        },
        CallExpression: (call) => {
          const callee = call?.callee;
          if (!brighterscript.isDottedGetExpression(callee)) return;
          const methodName = callee.tokens?.name?.text;
          const isObserveScoped = methodName === 'observeFieldScoped';
          const isObserve = methodName === 'observeField' || isObserveScoped;
          const isUnobserveScoped = methodName === 'unobserveFieldScoped';
          const isUnobserve = methodName === 'unobserveField' || isUnobserveScoped;
          if (!isObserve && !isUnobserve) return;

          const fieldArg = call.args?.[0];
          if (!brighterscript.isLiteralExpression(fieldArg)) return;
          const fieldText = stringLiteralValue(fieldArg.tokens?.value?.text);
          if (!fieldText) return;

          const targetRef = referenceText(callee.obj);
          if (!targetRef) return;

          if (isObserve) {
            observes.push({
              targetRef,
              fieldText,
              scoped: isObserveScoped,
              location: call.location,
            });
          } else {
            const map = isUnobserveScoped ? unobserveByFieldScoped : unobserveByField;
            if (!map.has(fieldText)) {
              map.set(fieldText, new Set());
            }
            map.get(fieldText).add(targetRef);
          }
        },
      });

      brsFile.parser.ast.walk(visitor, {
        walkMode: brighterscript.WalkMode.visitAllRecursive,
      });

      for (const obs of observes) {
        if (isCovered(obs, unobserveByField, unobserveByFieldScoped, aliases)) continue;
        const observeMethod = obs.scoped ? 'observeFieldScoped' : 'observeField';
        const unobserveMethod = obs.scoped ? 'unobserveFieldScoped' : 'unobserveField';
        report({
          code: DIAGNOSTIC_CODE,
          severity: 2, // Warning
          location: obs.location,
          message: `${observeMethod}("${obs.fieldText}") on '${obs.targetRef}' has no matching ${unobserveMethod}("${obs.fieldText}") on this target (or a known alias) anywhere in this file. JRScreen subclasses must release every observer (typically in onDestroy()); scoped/unscoped pairs are tracked separately by Roku, so an ${obs.scoped ? 'unobserveField' : 'unobserveFieldScoped'} won't satisfy this. Add ' bsc-disable-next-line observe-without-on-destroy to suppress.`,
        });
      }
    },
  });

function isCovered(observation, unobserveByField, unobserveByFieldScoped, aliases) {
  const map = observation.scoped ? unobserveByFieldScoped : unobserveByField;
  const candidates = map.get(observation.fieldText);
  if (!candidates || candidates.size === 0) return false;
  const observedRoot = aliases.find(observation.targetRef);
  for (const target of candidates) {
    if (aliases.find(target) === observedRoot) return true;
  }
  return false;
}

function descendsFromJRScreen(xmlFile) {
  let current = xmlFile;
  let depth = 0;
  while (current && depth < MAX_PARENT_CHAIN_DEPTH) {
    const parentName = current.parentComponentName?.text;
    if (!parentName) return false;
    if (parentName === TARGET_BASE) return true;
    current = current.parentComponent;
    depth++;
  }
  return false;
}

/**
 * Minimal union-find for grouping reference texts that alias the same node.
 */
class UnionFind {
  constructor() {
    this.parent = new Map();
  }
  find(x) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      return x;
    }
    let root = x;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root);
    }
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur);
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}
