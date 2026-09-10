/**
 * BrighterScript plugin — a register-once observer must only be detached at teardown.
 *
 * For a member bound from `m.top.findNode()` inside `init()`, observed EXACTLY ONCE
 * (that once being in `init()`), every `unobserveField` on that member must live in
 * `onDestroy()`. Anything else silently drops the registration mid-lifecycle: the node
 * outlives the detach, whatever restarts it (`control = "start"`) does not re-register,
 * and the handler never runs again.
 *
 * ## Why this shape, and not the naive check that was rejected
 *
 * `components/CLAUDE.md` sanctions exactly two wirings for a long-lived node — REGISTER
 * ONCE (observe in `init()`, unobserve in `onDestroy()`, drive with `control`) and
 * BALANCED TOGGLE (observe on the way in, unobserve on every exit). An earlier attempt to
 * gate this asked "is there a preceding `unobserveField` of the same field in the same
 * function", which flagged 143 sites, 16 after narrowing to long-lived receivers, and 3 of
 * 3 spot-checked were false positives — legitimate toggles paired across an `if`/`else`,
 * across a handler boundary, or in `start`/`stop` helper pairs.
 *
 * This rule asks a different question: it identifies the REGISTER-ONCE SHAPE first, and
 * only then checks where the detach lives. Toggles never enter the population, because
 * their observe is not a lone call inside `init()` — `VideoPlayerView.bufferCheckTimer` is
 * the reference toggle and is invisible to this rule for exactly that reason.
 *
 * Measured over 292 `.bs` files, before the `playbackTimer` fix that motivated this: 53
 * register-once members pass, 20 toggle-shaped members are ignored, 2 are flagged — the
 * defect itself and `ResumeButton.buttonIcon`. With the defect fixed, the tree flags one
 * site, suppressed.
 *
 * ## Why there is no carve-out for a self-detaching one-shot
 *
 * A handler that unobserves ITSELF after a one-time event (`loadStatus` reaching `ready`)
 * is a legitimate third shape — but inside THIS rule's population it occurs exactly once
 * in the tree (`ResumeButton.buttonIcon`). A general clause admitting every self-detach
 * would buy one known-good site and silently admit every future one, including the wrong
 * ones: a handler CAN detach on a path where further notifications were still needed,
 * which is this rule's own bug wearing a different hat. What makes `ResumeButton` safe is
 * a set of facts no linter can see — the node is created and destroyed per use rather than
 * recycled, and its icon URI is static — so it carries an explicit suppression instead.
 *
 * Escape hatch:
 *  - `' bsc-disable-line register-once-observer` on the unobserveField line
 *  - `' bsc-disable-next-line register-once-observer` on the line above
 *  - `' bsc-disable-file register-once-observer` anywhere in the file
 */
'use strict';

const brighterscript = require('brighterscript');
const { createScopeRule, stringLiteralValue, referenceText } = require('../lib/bsc-rule.cjs');

const DIAGNOSTIC_CODE = 'register-once-observer';
const INIT = 'init';
const ON_DESTROY = 'onDestroy';

/** Top-level functions in a codebehind, as `{ name, func }`. */
function topLevelFunctions(brsFile) {
  const out = [];
  for (const stmt of brsFile.parser?.ast?.statements ?? []) {
    if (!brighterscript.isFunctionStatement(stmt)) continue;
    const name = stmt.tokens?.name?.text;
    if (name) out.push({ name, func: stmt.func });
  }
  return out;
}

/** `m.<member> = m.top.findNode(...)` → the member name, else null. */
function findNodeBinding(stmt) {
  if (!brighterscript.isDottedSetStatement(stmt)) return null;
  if (referenceText(stmt.obj) !== 'm') return null;
  const member = stmt.tokens?.name?.text;
  if (!member) return null;
  const value = stmt.value;
  if (!brighterscript.isCallExpression(value)) return null;
  const callee = value.callee;
  if (!brighterscript.isDottedGetExpression(callee)) return null;
  if (callee.tokens?.name?.text !== 'findNode') return null;
  if (referenceText(callee.obj) !== 'm.top') return null;
  return member;
}

module.exports = () =>
  createScopeRule({
    name: 'jellyrock-register-once-observer',
    analyze({ brsFile, report }) {
      const functions = topLevelFunctions(brsFile);
      const initFn = functions.find((f) => f.name.toLowerCase() === INIT.toLowerCase());
      if (!initFn) return;

      // 1. Members bound from m.top.findNode() in init().
      const bound = new Set();
      initFn.func.body.walk(
        brighterscript.createVisitor({
          DottedSetStatement: (stmt) => {
            const member = findNodeBinding(stmt);
            if (member) bound.add(member);
          },
        }),
        { walkMode: brighterscript.WalkMode.visitAllRecursive },
      );
      if (bound.size === 0) return;

      // 2. Every observe/unobserve on those members, with its enclosing function.
      // Scoped and unscoped are tracked separately: Roku keeps them on different
      // observer lists, so one does not release the other.
      const observes = []; // { member, field, scoped, fn }
      const unobserves = []; // { member, field, scoped, fn, location }

      for (const { name: fnName, func } of functions) {
        func.body.walk(
          brighterscript.createVisitor({
            CallExpression: (call) => {
              const callee = call?.callee;
              if (!brighterscript.isDottedGetExpression(callee)) return;
              const method = callee.tokens?.name?.text;
              const scoped = method === 'observeFieldScoped' || method === 'unobserveFieldScoped';
              const isObserve = method === 'observeField' || method === 'observeFieldScoped';
              const isUnobserve = method === 'unobserveField' || method === 'unobserveFieldScoped';
              if (!isObserve && !isUnobserve) return;

              const targetRef = referenceText(callee.obj);
              if (!targetRef || !targetRef.startsWith('m.')) return;
              const member = targetRef.slice(2);
              if (!bound.has(member)) return;

              const fieldArg = call.args?.[0];
              if (!brighterscript.isLiteralExpression(fieldArg)) return;
              const field = stringLiteralValue(fieldArg.tokens?.value?.text);
              if (!field) return;

              (isObserve ? observes : unobserves).push({
                member,
                field,
                scoped,
                fn: fnName,
                location: call.location,
              });
            },
          }),
          { walkMode: brighterscript.WalkMode.visitAllRecursive },
        );
      }

      // 3. Per (member, field, scope): register-once, then detached outside onDestroy.
      const keyOf = (o) => `${o.member}::${o.field}::${o.scoped}`;
      const observesByKey = new Map();
      for (const o of observes) {
        if (!observesByKey.has(keyOf(o))) observesByKey.set(keyOf(o), []);
        observesByKey.get(keyOf(o)).push(o);
      }

      for (const u of unobserves) {
        if (u.fn.toLowerCase() === ON_DESTROY.toLowerCase()) continue;
        const registrations = observesByKey.get(keyOf(u));
        // Not register-once (absent, or a toggle) — outside this rule's population.
        if (!registrations || registrations.length !== 1) continue;
        if (registrations[0].fn.toLowerCase() !== INIT.toLowerCase()) continue;

        const observeMethod = u.scoped ? 'observeFieldScoped' : 'observeField';
        const unobserveMethod = u.scoped ? 'unobserveFieldScoped' : 'unobserveField';
        report({
          code: DIAGNOSTIC_CODE,
          severity: 1, // Error
          location: u.location,
          message:
            `'m.${u.member}' is a REGISTER-ONCE observer — bound from m.top.findNode() in ${INIT}() and ` +
            `${observeMethod}("${u.field}") exactly once, there — but this ${unobserveMethod}("${u.field}") ` +
            `is in '${u.fn}', not ${ON_DESTROY}(). The node outlives the detach and nothing re-registers, so ` +
            `the handler never runs again after this line. Either delete it and let the node's own lifecycle ` +
            `(e.g. control = "start"/"stop") drive the behaviour, or convert the member to a balanced toggle ` +
            `(observe on the way in, unobserve on every exit) as components/CLAUDE.md describes. Suppress with ` +
            `' bsc-disable-next-line ${DIAGNOSTIC_CODE} only if this observer is genuinely one-shot AND the node ` +
            `cannot be reused.`,
        });
      }
    },
  });
