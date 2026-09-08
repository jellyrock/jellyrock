/**
 * Shared lifecycle for JellyRock's BSC convention plugins.
 *
 * WHY THIS EXISTS
 * ---------------
 * A plugin that derives a finding from ONE file can register it and forget it:
 * BrighterScript clears a file's diagnostics by `location.uri` whenever that
 * file re-validates, so the finding is re-derived from scratch every time.
 *
 * A plugin that derives a finding from TWO files cannot. `field-observer-wiring`
 * reads a component's XML half and anchors the diagnostic in its codebehind;
 * `observe-without-on-destroy` decides JRScreen-ness from the XML and reports on
 * the `.bs`; `jrscreen-on-destroy` runs the same split the other way, anchoring on
 * the XML while the verdict comes from the codebehind's function list;
 * `callfunc-interface` needs every component interface in the program
 * before it can judge one call site. In all four, editing the file that is NOT
 * the diagnostic's anchor changes the verdict — but BSC only clears diagnostics
 * for the file that changed, so the stale finding survives. Measured, before this
 * module existed: fixing a duplicate observer by deleting the XML `onChange`, or
 * fixing a `callfunc-interface` error by adding the `<function>` declaration the
 * message asks for, left the error on screen until the `.bs` was touched. The
 * author does exactly what the diagnostic says and the IDE keeps saying no.
 *
 * The fix is BSC's own: register with a CONTEXT, and clear that context before
 * re-deriving. Core's `ScopeValidator` does this in six places
 * (`clearByFilter({ scope, fileUri, tag })`), and `Program.detectDuplicateComponentNames`
 * does the program-wide variant with `clearForTag`. This module packages both so
 * a rule author writes only the rule.
 *
 * WHICH FACTORY TO USE
 * --------------------
 *   createScopeRule   — the rule reasons over ONE component: its XML plus its
 *                       codebehind. Runs per component scope; both halves are
 *                       resolved for you. This is the common case.
 *   createProgramRule — the rule needs the WHOLE program before it can judge any
 *                       single site (e.g. "is this name declared in ANY component
 *                       interface?"). Runs once per validation.
 *
 * Both give the rule a `report()` that handles the `bsc-disable-*` markers and
 * the registration context, and both swallow exceptions: a convention plugin is
 * a guard, not a hard dependency, and must never crash the build.
 */
'use strict';

const brighterscript = require('brighterscript');

/**
 * Compiled `bsc-disable-*` matchers for a diagnostic code. Cached because a rule
 * checks them once per candidate finding.
 */
const markerCache = new Map();
function markersFor(code) {
  let markers = markerCache.get(code);
  if (!markers) {
    markers = {
      file: new RegExp(`'\\s*bsc-disable-file\\s+${code}\\b`, 'i'),
      line: new RegExp(`'\\s*bsc-disable-line\\s+${code}\\b`, 'i'),
      nextLine: new RegExp(`'\\s*bsc-disable-next-line\\s+${code}\\b`, 'i'),
    };
    markerCache.set(code, markers);
  }
  return markers;
}

/** True when `code` is suppressed at `line` (0-based) of `file`. */
function isSuppressed(file, code, line) {
  const contents = file?.fileContents;
  if (typeof contents !== 'string') return false;
  const markers = markersFor(code);
  if (markers.file.test(contents)) return true;
  if (typeof line !== 'number') return false;
  const lines = contents.split(/\r?\n/);
  if (markers.line.test(lines[line] ?? '')) return true;
  if (line > 0 && markers.nextLine.test(lines[line - 1] ?? '')) return true;
  return false;
}

/**
 * Build the `report` a rule calls to raise a finding. Applies suppression, then
 * registers with the caller's lifecycle context so the finding can be cleared
 * and re-derived on the next validation.
 *
 * `severity` defaults to 1 (Error) — every rule using this module today is a
 * build-failing gate; a warning-level rule passes `severity: 2` explicitly.
 */
function makeReport(program, context, defaultFile, pluginName) {
  return function report({ code, message, location, file, severity = 1 }) {
    if (!location) return;
    const target = file ?? defaultFile;
    const line = location?.range?.start?.line;
    if (isSuppressed(target, code, line)) return;
    program.diagnostics.register(
      { code, severity, source: pluginName, message, location },
      context,
    );
  };
}

/**
 * A rule scoped to one component — its XML and its codebehind.
 *
 * `analyze({ program, scope, xmlFile, brsFile, report })` is called once per
 * component scope. By default a scope with no resolvable codebehind is skipped:
 * a rule that anchors its finding on the `.bs` has nothing to attach to.
 *
 * `requiresCodebehind: false` opts out of that skip, for a rule whose finding
 * anchors on the XML instead — `jrscreen-on-destroy` reports "this component has
 * no onDestroy", and a component with no codebehind at all is the strongest case
 * of that, not an absent one. Such a rule receives `brsFile: null` and must
 * handle it.
 */
function createScopeRule({ name, analyze, requiresCodebehind = true }) {
  return {
    name,
    afterValidateScope(event) {
      try {
        const { program, scope } = event;
        if (!brighterscript.isXmlScope(scope)) return;
        const xmlFile = scope.xmlFile;
        if (!xmlFile) return;
        const brsFile = findCodebehind(program, xmlFile);

        // Clear THIS rule's findings for THIS scope before re-deriving them, so a
        // change to either half of the component cannot leave a stale diagnostic
        // behind. Scoped by tag, so a sibling plugin's findings are untouched;
        // scoped by scope, so a codebehind shared by two components keeps the
        // other component's verdict.
        program.diagnostics.clearByFilter({ scope, tag: name });

        if (!brsFile && requiresCodebehind) return;
        analyze({
          program,
          scope,
          xmlFile,
          brsFile,
          report: makeReport(program, { scope, tags: [name] }, brsFile ?? xmlFile, name),
        });
      } catch (_e) {
        // Never crash the build.
      }
    },
  };
}

/**
 * A rule that needs the whole program before it can judge any single site.
 *
 * `analyze({ program, report })` is called once per validation, after every file
 * has validated. The rule is expected to re-derive its COMPLETE finding set on
 * each call — the tag clear below drops everything it previously reported.
 */
function createProgramRule({ name, analyze }) {
  return {
    name,
    afterValidateProgram(event) {
      try {
        const { program } = event;
        program.diagnostics.clearForTag(name);
        analyze({
          program,
          report: makeReport(program, { tags: [name] }, undefined, name),
        });
      } catch (_e) {
        // Never crash the build.
      }
    },
  };
}

/**
 * The `.bs`/`.brs` codebehind sitting alongside a component `.xml`, or null.
 */
function findCodebehind(program, xmlFile) {
  const base = xmlFile?.srcPath?.replace(/\.xml$/i, '');
  if (!base) return null;
  for (const ext of ['.bs', '.brs']) {
    const file = program.getFile(base + ext);
    if (file && brighterscript.isBrsFile(file)) return file;
  }
  return null;
}

/**
 * The value of a BrightScript string literal token, or null for anything else.
 *
 * Deliberately strict: a non-string literal (`observeField(5)`) returns null so a
 * rule skips it rather than reasoning about a field named "5". Two of the callers
 * this replaced used a looser form that returned the raw token text — keep the
 * strict one, and treat any rule that needs the raw token as wanting its own
 * accessor rather than a loosening here.
 */
function stringLiteralValue(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(/^"(.*)"$/s);
  return match ? match[1] : null;
}

/**
 * A dotted reference rendered as source text (`m.top`, `m.some.node`), or null
 * for anything that is not a plain variable/dotted-get chain (calls, literals,
 * indexed gets). Used to compare observer targets by their written form.
 */
function referenceText(expr) {
  if (!expr) return null;
  if (brighterscript.isVariableExpression(expr)) {
    return expr.tokens?.name?.text || null;
  }
  if (brighterscript.isDottedGetExpression(expr)) {
    const base = referenceText(expr.obj);
    const name = expr.tokens?.name?.text;
    if (!base || !name) return null;
    return `${base}.${name}`;
  }
  return null;
}

module.exports = {
  createScopeRule,
  createProgramRule,
  findCodebehind,
  stringLiteralValue,
  referenceText,
  isSuppressed,
};
