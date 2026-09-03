/**
 * BrighterScript plugin — auto-guard onKeyEvent against post-teardown key events.
 *
 * sgRouter's closeView runs the view's `_beforeViewClose` hook (which reaches
 * JRScreen.beforeViewClose -> onScreenHidden() + onDestroy()) and only removes
 * the node once the returned promise resolves. Resolution goes through the
 * promise's observed `promiseState` field, so the removal lands on a LATER
 * message-loop turn — and the router deliberately leaves the view visible in
 * the meantime. For that turn the screen is still mounted and still in the
 * focus chain while its `onDestroy` has already set every node reference to
 * `invalid`, so the next key event dots into `invalid` and throws `&hec`
 * ('Dot' Operator attempted with invalid BrightScript Component or interface
 * reference).
 *
 * A base-class fix is not available: SceneGraph `onDestroy` and `onKeyEvent`
 * do NOT chain to a base component (no `super`), which is the same constraint
 * that made `auto-abandon-promises.cjs` an injecting plugin rather than a line
 * in `JRScreen`. So this plugin does it mechanically, for every component that
 * has both hooks:
 *
 *  1. INJECT (beforePrepareFile), all three sites, each independently
 *     idempotent — a site the file already writes by hand is left alone:
 *       init()        -> `m.isDestroyed = false`
 *       onDestroy()   -> `m.isDestroyed = true`
 *       onKeyEvent()  -> `if m.isDestroyed = true then return false`
 *
 *  2. ENFORCE (afterValidateFile): a component with `onDestroy` + `onKeyEvent`
 *     but NO `init()` is a build ERROR. The flag has to be initialised
 *     somewhere: Roku treats `invalid` as neither true nor false ("An
 *     `invalid` value is not considered false" — BrightScript reference), so
 *     an uninitialised flag turns a rare race into a guaranteed throw. The
 *     comparison form (`= true`) rather than a bare truthiness test is the
 *     second half of that belt-and-braces, mirroring roku-log's `m.__le` guard.
 *
 * Returning `false` from a destroyed screen's onKeyEvent is unambiguously
 * correct — the key belongs to whatever the router focuses next, not to a view
 * that has released its nodes.
 *
 * Escape hatch: `' bsc-disable-file auto-destroyed-guard` anywhere in the
 * codebehind (suppresses BOTH the injection and the diagnostic).
 *
 * Known limitation: keys on a top-level `onDestroy` in the component's own
 * codebehind. A screen that tears down via some other method name gets no
 * guard — `onDestroy` is the project-wide convention and the two teardown
 * plugins already assume it.
 */
'use strict';

const brighterscript = require('brighterscript');
const {
  Block,
  BinaryExpression,
  DottedGetExpression,
  DottedSetStatement,
  IfStatement,
  LiteralExpression,
  ReturnStatement,
  VariableExpression,
  createIdentifier,
  createToken,
  TokenKind,
} = brighterscript;

const FLAG = 'isDestroyed';
const INIT = 'init';
const ON_DESTROY = 'onDestroy';
const ON_KEY_EVENT = 'onKeyEvent';
const DIAGNOSTIC_CODE = 'auto-destroyed-guard-needs-init';
const DISABLE_FILE_MARKER = /'\s*bsc-disable-file\s+auto-destroyed-guard\b/i;

class AutoDestroyedGuardPlugin {
  constructor() {
    this.name = 'jellyrock-auto-destroyed-guard';
  }

  // INJECT — wire the destroyed flag through init / onDestroy / onKeyEvent.
  beforePrepareFile(event) {
    try {
      const file = event.file;
      if (!brighterscript.isBrsFile(file)) return;
      if (isDisabled(file)) return;
      if (!hasSiblingComponentXml(event.program, file)) return;

      const onDestroy = findFunction(file, ON_DESTROY);
      const onKeyEvent = findFunction(file, ON_KEY_EVENT);
      // Both hooks are required: no onDestroy means nothing goes invalid, and
      // no onKeyEvent means there is no post-teardown entry point to guard.
      if (!onDestroy || !onKeyEvent) return;

      const init = findFunction(file, INIT);
      if (!init) return; // missing init is handled by the diagnostic

      if (!assignsFlag(init)) {
        prepend(event, init, makeFlagAssignment(false));
      }
      if (!assignsFlag(onDestroy)) {
        prepend(event, onDestroy, makeFlagAssignment(true));
      }
      if (!readsFlag(onKeyEvent)) {
        prepend(event, onKeyEvent, makeGuardStatement());
      }
    } catch (_e) {
      // Never crash the build — injection is best-effort; the diagnostic still
      // guards the uninitialised-flag case.
    }
  }

  // ENFORCE — a guardable component with no init() has nowhere to initialise
  // the flag, and an `invalid` flag would throw on every key press.
  afterValidateFile(event) {
    try {
      const file = event.file;
      if (!brighterscript.isBrsFile(file)) return;
      if (isDisabled(file)) return;
      if (!hasSiblingComponentXml(event.program, file)) return;

      const onDestroy = findFunction(file, ON_DESTROY);
      const onKeyEvent = findFunction(file, ON_KEY_EVENT);
      if (!onDestroy || !onKeyEvent) return;
      if (findFunction(file, INIT)) return; // injection covers it

      const location = onKeyEvent.location || file.componentName?.location;
      if (!location) return;

      event.program.diagnostics.register({
        code: DIAGNOSTIC_CODE,
        severity: 1, // Error — an uninitialised flag throws on EVERY key press.
        source: this.name,
        message: `This component declares '${ON_DESTROY}' and '${ON_KEY_EVENT}' but no top-level '${INIT}' function, so the destroyed-guard flag 'm.${FLAG}' cannot be initialised. A key event delivered after ${ON_DESTROY} nulls this component's node references crashes with &hec. Add 'sub ${INIT}()' — the auto-destroyed-guard plugin fills in the flag. Suppress with ' bsc-disable-file auto-destroyed-guard only if this component cannot receive a key event after teardown.`,
        location: location,
      });
    } catch (_e) {
      // Never crash the build.
    }
  }
}

// True if the file opts out via the disable marker.
function isDisabled(brsFile) {
  const contents = brsFile?.fileContents;
  return typeof contents === 'string' && DISABLE_FILE_MARKER.test(contents);
}

// Finds a top-level FunctionStatement by name (case-insensitive — BrightScript
// identifiers are, and `onkeyevent` / `OnKeyEvent` both appear in the wild).
function findFunction(brsFile, name) {
  const statements = brsFile?.parser?.ast?.statements;
  if (!Array.isArray(statements)) return null;
  const wanted = name.toLowerCase();
  for (const stmt of statements) {
    if (
      brighterscript.isFunctionStatement(stmt) &&
      stmt.tokens?.name?.text?.toLowerCase() === wanted
    ) {
      return stmt;
    }
  }
  return null;
}

// Inserts `statement` as the first statement of `fnStmt`'s body.
function prepend(event, fnStmt, statement) {
  const statements = fnStmt.func?.body?.statements;
  if (!Array.isArray(statements)) return;
  event.editor.addToArray(statements, 0, statement);
}

// True if the function already assigns `m.isDestroyed` anywhere in its body.
function assignsFlag(fnStmt) {
  let found = false;
  const visitor = brighterscript.createVisitor({
    DottedSetStatement: (stmt) => {
      if (found) return;
      if (isFlagOnM(stmt.obj, stmt.tokens?.name?.text)) found = true;
    },
  });
  fnStmt.walk(visitor, { walkMode: brighterscript.WalkMode.visitAllRecursive });
  return found;
}

// True if the function already reads `m.isDestroyed` anywhere in its body.
function readsFlag(fnStmt) {
  let found = false;
  const visitor = brighterscript.createVisitor({
    DottedGetExpression: (expr) => {
      if (found) return;
      if (isFlagOnM(expr.obj, expr.tokens?.name?.text)) found = true;
    },
  });
  fnStmt.walk(visitor, { walkMode: brighterscript.WalkMode.visitAllRecursive });
  return found;
}

// True when `obj`.`name` denotes `m.isDestroyed`.
function isFlagOnM(obj, name) {
  return (
    brighterscript.isVariableExpression(obj) &&
    obj.tokens?.name?.text?.toLowerCase() === 'm' &&
    typeof name === 'string' &&
    name.toLowerCase() === FLAG.toLowerCase()
  );
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

function makeVar(name) {
  return new VariableExpression({ name: createIdentifier(name) });
}

function makeFlagGet() {
  return new DottedGetExpression({
    obj: makeVar('m'),
    name: createIdentifier(FLAG),
    dot: createToken(TokenKind.Dot, '.'),
  });
}

function makeBool(value) {
  return new LiteralExpression({
    value: value ? createToken(TokenKind.True, 'true') : createToken(TokenKind.False, 'false'),
  });
}

// `m.isDestroyed = <value>`
function makeFlagAssignment(value) {
  return new DottedSetStatement({
    obj: makeVar('m'),
    name: createIdentifier(FLAG),
    dot: createToken(TokenKind.Dot, '.'),
    equals: createToken(TokenKind.Equal, '='),
    value: makeBool(value),
  });
}

// `if m.isDestroyed = true then return false`
//
// The `= true` comparison rather than a bare `if m.isDestroyed` is deliberate:
// Roku treats `invalid` as neither true nor false, so a bare truthiness test on
// an uninitialised flag THROWS. init() injection makes that unreachable; this
// is the second layer.
function makeGuardStatement() {
  const condition = new BinaryExpression({
    left: makeFlagGet(),
    operator: createToken(TokenKind.Equal, '='),
    right: makeBool(true),
  });
  const thenBranch = new Block({
    statements: [new ReturnStatement({ value: makeBool(false) })],
  });
  return new IfStatement({
    if: createToken(TokenKind.If, 'if'),
    then: createToken(TokenKind.Then, 'then'),
    condition,
    thenBranch,
  });
}

module.exports = () => new AutoDestroyedGuardPlugin();
