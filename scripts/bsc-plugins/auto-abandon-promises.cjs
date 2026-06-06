/**
 * BrighterScript plugin — auto-abandon pending API promises on destroy.
 *
 * Companion to the `fetchAsync` adapter (source/api/apiPromise.bs). A render-
 * thread promise registers a pending entry on its owning component's `m`; if
 * the component is destroyed while a request is in flight, the late pool
 * response must NOT fire a callback into the dead node. `abandonApiPromises()`
 * tears the pending entries down — but SceneGraph component `onDestroy()` does
 * NOT chain to a base class (no `super`), so the call can't simply live in a
 * base `onDestroy`. Every component that owns promises has to abandon in its
 * own `onDestroy`.
 *
 * Rather than make every dev remember that line (and risk a silent leak when
 * they forget), this plugin does it mechanically:
 *
 *  1. INJECT (beforePrepareFile): for any codebehind that calls `fetchAsync`,
 *     prepend `abandonApiPromises()` as the first statement of its `onDestroy()`
 *     at transpile time. Idempotent — skipped if onDestroy already abandons.
 *     A `fetchAsync` caller already `import`s apiPromise.bs, so the injected
 *     `abandonApiPromises` reference is guaranteed in scope.
 *
 *  2. ENFORCE (afterValidateFile): if a COMPONENT codebehind (one with a
 *     sibling component .xml) calls `fetchAsync` but declares NO `onDestroy()`
 *     at all, there's nothing to inject into — a guaranteed leak. That's a
 *     build ERROR (not a warning): the whole point of the plugin is that the
 *     leak is impossible to ship. The dev adds an `onDestroy()` (the injection
 *     then fills it in). Errors block the build, so the escape hatch below
 *     exists for the rare legitimate exception.
 *
 * This mirrors the spirit of the `observe-without-on-destroy` plugin (which
 * pairs observe↔unobserve) but AUTO-FIXES the common case instead of only
 * warning. Source-invisibility of the injected call is the same tradeoff the
 * roku-log plugin already makes.
 *
 * Escape hatch (suppresses the missing-onDestroy ERROR):
 *  - `' bsc-disable-file auto-abandon-promises` anywhere in the codebehind.
 *
 * Known limitation: detection keys on a DIRECT `fetchAsync(...)` call in the
 * component file. A component that reaches the pool only through a shared
 * source/ helper that itself calls `fetchAsync` won't be detected — call
 * `fetchAsync` directly from the component (the designed usage), or abandon
 * by hand.
 */
'use strict';

const brighterscript = require('brighterscript');
const {
  CallExpression,
  ExpressionStatement,
  VariableExpression,
  createIdentifier,
  createToken,
  TokenKind,
} = brighterscript;

const FETCH_FN = 'fetchAsync';
const ABANDON_FN = 'abandonApiPromises';
const ON_DESTROY = 'onDestroy';
const DIAGNOSTIC_CODE = 'auto-abandon-promises-needs-on-destroy';
const DISABLE_FILE_MARKER = /'\s*bsc-disable-file\s+auto-abandon-promises\b/i;

class AutoAbandonPromisesPlugin {
  constructor() {
    this.name = 'jellyrock-auto-abandon-promises';
  }

  // INJECT — prepend abandonApiPromises() to onDestroy() in fetchAsync callers.
  beforePrepareFile(event) {
    try {
      const file = event.file;
      if (!brighterscript.isBrsFile(file)) return;
      if (!findFetchAsyncCall(file)) return;

      const onDestroy = findOnDestroy(file);
      if (!onDestroy) return; // missing onDestroy is handled by the diagnostic

      if (onDestroyAbandons(onDestroy)) return; // idempotent

      const statements = onDestroy.func?.body?.statements;
      if (!Array.isArray(statements)) return;

      event.editor.addToArray(statements, 0, makeAbandonStatement());
    } catch (_e) {
      // Never crash the build — injection is best-effort; the diagnostic still
      // guards the missing-onDestroy case.
    }
  }

  // ENFORCE — error when a component codebehind uses fetchAsync but has no
  // onDestroy() to abandon in.
  afterValidateFile(event) {
    try {
      const file = event.file;
      if (!brighterscript.isBrsFile(file)) return;

      const contents = file.fileContents;
      if (typeof contents === 'string' && DISABLE_FILE_MARKER.test(contents)) return;

      const fetchCall = findFetchAsyncCall(file);
      if (!fetchCall) return;

      // Only components have an onDestroy lifecycle / per-m promise registry.
      // A bare source/ helper that calls fetchAsync has no sibling XML and is
      // out of scope (the caller component is what must abandon).
      if (!hasSiblingComponentXml(event.program, file)) return;

      if (findOnDestroy(file)) return; // injection covers it

      const location = fetchCall.location || file.componentName?.location;
      if (!location) return;

      event.program.diagnostics.register({
        code: DIAGNOSTIC_CODE,
        severity: 1, // Error — a fetchAsync caller with no onDestroy is a guaranteed leak.
        source: this.name,
        message: `This component calls ${FETCH_FN}() but declares no top-level '${ON_DESTROY}' function. A pending promise would fire its callback into the destroyed node. Add 'sub ${ON_DESTROY}()' — the auto-abandon plugin injects ${ABANDON_FN}() into it. Suppress with ' bsc-disable-file auto-abandon-promises only if you are certain no request can outlive this component.`,
        location: location,
      });
    } catch (_e) {
      // Never crash the build.
    }
  }
}

// Returns the first `fetchAsync(...)` CallExpression in the file, or null.
function findFetchAsyncCall(brsFile) {
  return findBareCall(brsFile?.parser?.ast, FETCH_FN);
}

// Returns true if the onDestroy function already calls abandonApiPromises().
function onDestroyAbandons(onDestroyFn) {
  return findBareCall(onDestroyFn, ABANDON_FN) !== null;
}

// Walks `root` for a CallExpression whose callee is the bare global function
// `name` (a VariableExpression, not a member call). Returns the call or null.
function findBareCall(root, name) {
  if (!root || typeof root.walk !== 'function') return null;
  let match = null;
  const visitor = brighterscript.createVisitor({
    CallExpression: (call) => {
      if (match) return;
      const callee = call.callee;
      if (brighterscript.isVariableExpression(callee) && callee.tokens?.name?.text === name) {
        match = call;
      }
    },
  });
  root.walk(visitor, { walkMode: brighterscript.WalkMode.visitAllRecursive });
  return match;
}

// Finds the top-level `onDestroy` FunctionStatement (case-sensitive), or null.
function findOnDestroy(brsFile) {
  const statements = brsFile?.parser?.ast?.statements;
  if (!Array.isArray(statements)) return null;
  for (const stmt of statements) {
    if (brighterscript.isFunctionStatement(stmt) && stmt.tokens?.name?.text === ON_DESTROY) {
      return stmt;
    }
  }
  return null;
}

// True if the brs file has a sibling component .xml (i.e. it's a codebehind).
function hasSiblingComponentXml(program, brsFile) {
  if (!program || !brsFile) return false;
  const bases = [];
  if (brsFile.srcPath) bases.push(brsFile.srcPath.replace(/\.(bs|brs)$/i, ''));
  if (brsFile.pkgPath) bases.push(brsFile.pkgPath.replace(/\.(bs|brs)$/i, ''));
  for (const base of bases) {
    const xml = program.getFile(base + '.xml');
    if (xml && brighterscript.isXmlFile(xml)) return true;
  }
  return false;
}

// Builds the `abandonApiPromises()` expression statement to inject.
function makeAbandonStatement() {
  const callee = new VariableExpression({ name: createIdentifier(ABANDON_FN) });
  const call = new CallExpression({
    callee,
    openingParen: createToken(TokenKind.LeftParen, '('),
    closingParen: createToken(TokenKind.RightParen, ')'),
    args: [],
  });
  return new ExpressionStatement({ expression: call });
}

module.exports = () => new AutoAbandonPromisesPlugin();
