/**
 * BrighterScript plugin — button-row overflow bracket discipline.
 *
 * A surface whose button row can overflow (#788) keeps its spilled buttons in an
 * off-layout stash, because a LayoutGroup reserves a slot for an invisible child
 * and an overflowed button therefore has to leave the group entirely. That means
 * the row's PHYSICAL child list is not its LOGICAL one while the row is split,
 * so every function that mutates the row has to bracket its work:
 *
 *     unsplitButtons()      ' the row is whole again; index math is safe
 *     ... insert / remove / focus logic ...
 *     applyOverflow()       ' re-split against the new count
 *
 * This flags a function that mutates the row without both halves.
 *
 * WHY A PLUGIN AND NOT A CONVENTION. The bracket is a no-op today — ItemDetails
 * sits at exactly 8 buttons against a cap of 8, the OSD at 7 against 10 — so a
 * forgotten bracket changes nothing observable, fails no test, and logs nothing.
 * It becomes a bug on the day someone adds the button that pushes a row over its
 * cap: a different PR, usually by a different person, who then reasonably
 * concludes their new button broke the row's ordering. Latent plus misattributed
 * is the expensive combination, and a build-time diagnostic is the only thing
 * that catches it in the change that introduces it.
 *
 * The row's structure was touched by 10 commits in the 12 months before this
 * landed — roughly one a month — so a tenth mutator is a matter of when.
 *
 * SELF-CONFIGURING, so a third surface adopting the pattern is covered with no
 * edit here: the target node is read out of each file's own `unsplitButtons()`,
 * from the first argument of its `restoreOverflowedButtons(<target>, <stash>)`
 * call. A file that does not define both bracket halves is not an overflow
 * surface and is ignored entirely.
 *
 * SCOPE — what this does NOT prove:
 *   - That the bracket halves are in the right ORDER, or that the mutation sits
 *     between them. It proves both are called in a function that mutates the row.
 *     Ordering is visible in review; presence is what gets forgotten.
 *   - Anything about reads. `getButtonIndex()` answering -1 for a stashed button
 *     only misplaces something in combination with a mutation, which is flagged.
 *
 * TWO BLIND SPOTS, stated because a gate you believe is total is worse than one
 * whose edges you know. This matches a mutation only in its literal
 * `m.<row>.<mutator>()` form, so two shapes slip past:
 *
 *   1. HELPER-MEDIATED. A function handed the row as an argument can mutate it
 *      without the call site naming a mutator at all. Not hypothetical:
 *      `appendDebugSpareButtons(m.buttonGrp)` does `group.appendChild(...)`, and
 *      both of its call sites are invisible here. Neither is a bug — both sit
 *      inside already-bracketed functions (`setupButtons`, `setButtonStates`),
 *      and both are `#if debug`, compiled out of production and test builds.
 *   2. LOCAL ALIAS. `grp = m.buttonGrp : grp.removeChild(x)` is not matched.
 *      ZERO instances in the codebase; the house style is uniformly
 *      `m.buttonGrp.<mutator>()`.
 *
 * Neither is closed, deliberately. (1) needs interprocedural analysis to do
 * properly; approximating it by flagging "row passed as an argument" false-
 * positives on read-only helpers — `osdRowSpacing(m.buttonMenuLeft)` is called
 * from the unbracketed `osdRowGeometry()` — and a false positive on an
 * ERROR-level gate blocks correct work, which is strictly worse than the false
 * negative it replaces. (2) is easy but would be machinery for a shape nobody
 * writes. Both would also add code to a plugin scheduled for deletion (below).
 * Revisit if a row-mutating helper ever gains a call site outside a bracket.
 *
 * ⚠️ This plugin is SCAFFOLDING for a design that should not need it. The root
 * cause is that the row's logical content and its physical child list are the
 * same list; a row model with a single render step would delete the bracket and
 * this plugin together. See `button-row-model` in docs/architecture/tech-debt.md.
 * Delete this file when that lands.
 *
 * Escape hatch:
 *  - `' bsc-disable-file button-row-bracket` at the top of the codebehind, for a
 *    surface that genuinely mutates the row outside the bracket. There is no such
 *    case today — all 38 mutation sites in ItemDetails.bs and all 5 in OSD.bs are
 *    already inside a bracketed function.
 */
'use strict';

const brighterscript = require('brighterscript');

const UNSPLIT_FN = 'unsplitButtons';
const APPLY_FN = 'applyOverflow';
const RESTORE_FN = 'restoreOverflowedButtons';
const DISABLE_FILE_MARKER = /'\s*bsc-disable-file\s+button-row-bracket\b/i;

// Child-list writes. A read (getChild / findNode / getChildCount) cannot corrupt
// the row on its own, so it is deliberately not here.
const ROW_MUTATORS = new Set([
  'insertchild',
  'removechild',
  'appendchild',
  'replacechild',
  'removechildindex',
  'appendchildren',
  'removechildren',
]);

// The bracket halves themselves. Exempt because they ARE the bracket — each one
// legitimately mutates the row without calling the other. The menu-close helper
// they call needs no exemption: it cancels a dialog and never touches the row.
const EXEMPT_FUNCTIONS = new Set([UNSPLIT_FN.toLowerCase(), APPLY_FN.toLowerCase()]);

class ButtonRowBracketPlugin {
  constructor() {
    this.name = 'jellyrock-button-row-bracket';
  }

  afterValidateFile(event) {
    try {
      const file = event.file;
      if (!brighterscript.isBrsFile(file)) return;

      const contents = file.fileContents;
      if (typeof contents === 'string' && DISABLE_FILE_MARKER.test(contents)) return;

      const functions = topLevelFunctions(file);
      if (!functions.has(UNSPLIT_FN.toLowerCase()) || !functions.has(APPLY_FN.toLowerCase())) {
        return; // not an overflow-managed surface
      }

      const target = rowNodeName(functions.get(UNSPLIT_FN.toLowerCase()));
      if (!target) return; // unrecognised bracket shape — say nothing rather than guess

      for (const [lowerName, fn] of functions) {
        if (EXEMPT_FUNCTIONS.has(lowerName)) continue;

        const found = inspectFunction(fn, target);
        if (!found.mutation) continue;
        if (found.callsUnsplit && found.callsApply) continue;

        const missing = [];
        if (!found.callsUnsplit) missing.push(`${UNSPLIT_FN}()`);
        if (!found.callsApply) missing.push(`${APPLY_FN}()`);

        event.program.diagnostics.register({
          code: 'button-row-bracket-required',
          severity: 1, // Error — a forgotten bracket is silent until the row overflows.
          source: this.name,
          message:
            `'${fn.tokens?.name?.text}' mutates the overflow-managed row 'm.${target}' but does not call ${missing.join(' or ')}. ` +
            `A row that is currently split has its tail in the stash and a 'More' button in the last slot, so an index or a findNode() here ` +
            `resolves against the wrong list. Bracket the mutation: ${UNSPLIT_FN}() before it, ${APPLY_FN}() after it. ` +
            `Both halves are idempotent and both are no-ops while the row fits.`,
          location: found.mutation.location ?? fn.tokens?.name?.location,
        });
      }
    } catch (_e) {
      // Never crash the build — a plugin fault must not block a contributor.
    }
  }
}

function topLevelFunctions(brsFile) {
  const found = new Map();
  const statements = brsFile?.parser?.ast?.statements;
  if (!Array.isArray(statements)) return found;
  for (const stmt of statements) {
    if (!brighterscript.isFunctionStatement(stmt)) continue;
    const name = stmt.tokens?.name?.text;
    if (name) found.set(name.toLowerCase(), stmt);
  }
  return found;
}

// `m.<name>` -> "<name>", anything else -> null.
function mDottedName(expression) {
  if (!brighterscript.isDottedGetExpression(expression)) return null;
  const obj = expression.obj;
  if (!brighterscript.isVariableExpression(obj)) return null;
  if (obj.tokens?.name?.text?.toLowerCase() !== 'm') return null;
  return expression.tokens?.name?.text ?? null;
}

// The row this file manages, read out of its own unsplitButtons():
// restoreOverflowedButtons(m.buttonGrp, m.buttonOverflow) -> "buttonGrp".
function rowNodeName(unsplitFn) {
  let target = null;
  const visitor = brighterscript.createVisitor({
    CallExpression: (call) => {
      if (target) return;
      const callee = call?.callee;
      if (!brighterscript.isVariableExpression(callee)) return;
      if (callee.tokens?.name?.text?.toLowerCase() !== RESTORE_FN.toLowerCase()) return;
      const first = (call.args || [])[0];
      target = mDottedName(first);
    },
  });
  unsplitFn?.func?.body?.walk(visitor, { walkMode: brighterscript.WalkMode.visitAllRecursive });
  return target;
}

function inspectFunction(fn, target) {
  const found = { mutation: null, callsUnsplit: false, callsApply: false };
  const visitor = brighterscript.createVisitor({
    CallExpression: (call) => {
      const callee = call?.callee;

      // A bare call to one of the bracket halves.
      if (brighterscript.isVariableExpression(callee)) {
        const name = callee.tokens?.name?.text?.toLowerCase();
        if (name === UNSPLIT_FN.toLowerCase()) found.callsUnsplit = true;
        if (name === APPLY_FN.toLowerCase()) found.callsApply = true;
        return;
      }

      // m.<target>.<mutator>(...)
      if (!brighterscript.isDottedGetExpression(callee)) return;
      if (!ROW_MUTATORS.has(callee.tokens?.name?.text?.toLowerCase())) return;
      if (mDottedName(callee.obj) !== target) return;
      if (!found.mutation) found.mutation = callee.tokens?.name ?? call;
    },
  });
  fn?.func?.body?.walk(visitor, { walkMode: brighterscript.WalkMode.visitAllRecursive });
  return found;
}

module.exports = () => new ButtonRowBracketPlugin();
