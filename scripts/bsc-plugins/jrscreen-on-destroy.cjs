/**
 * BrighterScript plugin — JRScreen `onDestroy()` discipline.
 *
 * Flags any RSG component that extends `JRScreen` (transitively) and whose
 * codebehind BS file does not declare a top-level `onDestroy` function.
 *
 * Rationale: the base `onDestroy()` in `components/JRScreen.bs` is a no-op
 * virtual; forgetting to override it leaks observers and Tasks across
 * navigation. The companion `observe-without-on-destroy` plugin checks the
 * body of each subclass's onDestroy() for matching unobserve calls.
 *
 * The function name check is case-sensitive (must be exactly `onDestroy`,
 * not `OnDestroy` / `ondestroy` / `destroy`) to enforce the lowerCamelCase
 * lifecycle-hook convention alongside the prefix rule.
 *
 * Skips `components/JRScreen.xml` itself (the no-op base lives there by design).
 *
 * CROSS-FILE, so it runs on the shared scope lifecycle: the diagnostic anchors on
 * the XML's component name, but the verdict comes from the CODEBEHIND's function
 * list. BrighterScript clears a file's diagnostics by `location.uri` when that
 * file re-validates, so before this ran on a scope, adding the `onDestroy()` the
 * message asks for left the warning on screen until the XML was touched — the
 * author does exactly what the diagnostic says and the IDE keeps saying no. See
 * `scripts/lib/bsc-rule.cjs`.
 *
 * `requiresCodebehind: false` because a component with NO codebehind cannot
 * declare `onDestroy` and so is the strongest instance of this finding, not an
 * absent one. That case has no live example today (13 JRScreen descendants, all
 * with a codebehind), but dropping it would silently narrow the gate.
 *
 * Escape hatch:
 *  - `' bsc-disable-file jrscreen-on-destroy` anywhere in the XML or its codebehind
 *    (rare — only for components that legitimately extend JRScreen but never
 *    own observers/Tasks; e.g. a thin pass-through wrapper).
 */
'use strict';

const brighterscript = require('brighterscript');
const { createScopeRule, isSuppressed } = require('../lib/bsc-rule.cjs');

const TARGET_BASE = 'JRScreen';
const REQUIRED_LIFECYCLE_FUNCTION = 'onDestroy';
const MAX_PARENT_CHAIN_DEPTH = 32;
const DIAGNOSTIC_CODE = 'jrscreen-on-destroy';

module.exports = () =>
  createScopeRule({
    name: 'jellyrock-jrscreen-on-destroy',
    requiresCodebehind: false,
    analyze({ xmlFile, brsFile, report }) {
      const componentName = xmlFile.componentName?.text;
      if (!componentName || componentName === TARGET_BASE) return;
      if (!descendsFromJRScreen(xmlFile)) return;

      // The marker is honoured in EITHER half — the reason to exempt a component
      // may be stated where its interface is or where its code is. `report` only
      // ever inspects one file, so both are checked here rather than relying on it.
      if (isSuppressed(xmlFile, DIAGNOSTIC_CODE)) return;
      if (brsFile && isSuppressed(brsFile, DIAGNOSTIC_CODE)) return;

      if (brsFile && hasTopLevelOnDestroyFunction(brsFile)) return;

      const location = xmlFile.componentName?.location;
      if (!location) return;

      report({
        code: 'jrscreen-on-destroy-required',
        severity: 2, // Warning
        message: `Component '${componentName}' extends JRScreen (transitively) but its codebehind does not declare a top-level 'onDestroy' function. JRScreen subclasses must override onDestroy() to release observers and Tasks (otherwise they leak across navigation). The function name is case-sensitive — 'OnDestroy' / 'destroy' will not satisfy this.`,
        location,
        file: xmlFile,
      });
    },
  });

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

function hasTopLevelOnDestroyFunction(brsFile) {
  const statements = brsFile?.parser?.ast?.statements;
  if (!Array.isArray(statements)) return false;
  for (const stmt of statements) {
    if (!brighterscript.isFunctionStatement(stmt)) continue;
    const name = stmt.tokens?.name?.text;
    // Case-sensitive: enforce lowerCamelCase casing alongside the prefix rule.
    if (name === REQUIRED_LIFECYCLE_FUNCTION) return true;
  }
  return false;
}
