/**
 * BrighterScript v1 plugin for roku-log integration.
 *
 * OURS, not a vendored copy — written from scratch to replace the unmaintained
 * roku-log-bsc-plugin (0.9.0-beta.1), which BSC v1's AST changes broke
 * (parser.references removed, .name → .tokens.name, .range → .location.range,
 * constructors require options objects instead of positional args). There is no
 * upstream to sync from or defer to: change it here.
 *
 * ⚠️ Do not confuse this with the roku-log RUNTIME library in
 * `source/roku_modules/log/`. That one IS upstream (npm:roku-log, vendored by
 * ropm, gitignored, regenerated on every install — edits there vanish). This
 * file rewrites CALL SITES before the compiler sees them, so it can put a
 * statement in a scope that never contained one; when logging misbehaves, work
 * out which of the two artifacts you are looking at first.
 * See docs/architecture/logging.md.
 *
 * Features:
 *  - strip:          Remove all m.log.*() calls from transpiled output (prod builds)
 *  - insertPkgPath:  Inject source file location as first arg to log calls (dev builds)
 *  - guard:          Wrap log calls in `if m.__le = true then` checks
 *  - removeComments: Strip comments from transpiled .brs and XML output
 *
 * Configuration via bsconfig.json:
 *   "rokuLog": {
 *     "strip": false,
 *     "insertPkgPath": true,
 *     "removeComments": false,
 *     "guard": false
 *   }
 */

const brighterscript = require('brighterscript');
const {
  isCallExpression,
  isExpressionStatement,
  isNewExpression,
  createIdentifier,
  createToken,
  VariableExpression,
  DottedGetExpression,
  DottedSetStatement,
  LiteralExpression,
  BinaryExpression,
  Block,
  IfStatement,
  SourceLiteralExpression,
  ParseMode,
  TokenKind,
} = brighterscript;

/**
 * Get the name text from an AST node (BSC v1 uses .tokens.name.text)
 * @param {object} node
 * @returns {string|undefined}
 */
function getNameText(node) {
  return node?.tokens?.name?.text;
}

/**
 * Get the range from an AST node (BSC v1 uses .location.range)
 * @param {object} node
 * @returns {object|undefined}
 */
function getRange(node) {
  return node?.location?.range;
}

// -- AST node factory helpers using BSC v1 options-object constructors --

function makeVar(name) {
  return new VariableExpression({ name: createIdentifier(name) });
}

function makeDottedGet(obj, name) {
  return new DottedGetExpression({
    obj,
    name: createIdentifier(name),
    dot: createToken(TokenKind.Dot, '.'),
  });
}

class RokuLogPlugin {
  constructor() {
    this.name = 'roku-log-plugin';
    this.config = {
      strip: true,
      guard: false,
      insertPkgPath: true,
      removeComments: true,
    };
  }

  beforeBuildProgram(event) {
    this.config = { ...this.config, ...event.program.options.rokuLog };
  }

  beforePrepareFile(event) {
    if (!brighterscript.isBrsFile(event.file)) return;

    const visitedLines = {};
    const config = this.config;

    const logVisitor = brighterscript.createVisitor({
      DottedSetStatement: (statement, _parent, owner, key) => {
        const range = getRange(statement);
        if (!range) return;
        if (visitedLines[range.start.line]) return;

        // Only a logger stored on `m.log` gets the cache line, because that line is
        // hardcoded `m.__le = m.log.enabled` and the call-site visitor below only guards
        // `m.log.<method>()`. For a logger kept under any other name the injection is both
        // UNREAD (nothing guards its calls) and UNSAFE — it dots into an `m.log` that need
        // not exist in that scope.
        //
        // Not hypothetical: `source/utils/screenReadiness.bs` keeps its logger on
        // `m.screenLoadLog`, and the ledger crashed the app at launch with `&hec` ('Dot'
        // operator on invalid) the first time it was called from a scope with no `m.log`
        // of its own — main-thread `source/loginRouter.bs`. Every instrumented COMPONENT
        // happens to set `m.log` in `init()`, which is why the coupling survived until a
        // main-thread caller existed. It also stops a second logger in one component from
        // overwriting `m.__le` with a different logger's enabled state.
        const isMLogTarget =
          getNameText(statement) === 'log' &&
          brighterscript.isVariableExpression(statement.obj) &&
          getNameText(statement.obj) === 'm';

        // Detect: m.log = new log.Logger(...)
        if (isMLogTarget && isNewExpression(statement.value)) {
          const newExpr = statement.value;
          if (newExpr.className.getName(ParseMode.BrighterScript) === 'log.Logger') {
            const guardExpr = createGuardSetStatement();
            event.editor.addToArray(owner, key + 1, guardExpr);
          }
        }
        // Detect: m.log = log.Logger(...) (factory function pattern)
        else if (isMLogTarget && isCallExpression(statement.value)) {
          const callExpr = statement.value;
          if (
            brighterscript.isDottedGetExpression(callExpr.callee) &&
            getNameText(callExpr.callee) === 'Logger' &&
            brighterscript.isVariableExpression(callExpr.callee.obj) &&
            getNameText(callExpr.callee.obj) === 'log'
          ) {
            const guardExpr = createGuardSetStatement();
            event.editor.addToArray(owner, key + 1, guardExpr);
          }
        }
        visitedLines[range.start.line] = true;
      },

      ExpressionStatement: (statement, _parent, owner, key) => {
        if (!isCallExpression(statement.expression)) return;

        const callExpr = statement.expression;
        const callee = callExpr.callee;

        // Match pattern: m.log.<method>(...)
        if (!brighterscript.isDottedGetExpression(callee)) return;
        if (!brighterscript.isDottedGetExpression(callee.obj)) return;
        if (getNameText(callee.obj) !== 'log') return;
        if (!brighterscript.isVariableExpression(callee.obj.obj)) return;
        if (getNameText(callee.obj.obj) !== 'm') return;

        const range = getRange(callExpr);
        if (!range || visitedLines[range.start.line]) return;

        try {
          if (config.strip) {
            event.editor.overrideTranspileResult(callExpr, '');
          } else {
            if (config.insertPkgPath) {
              const funcName = getNameText(callee);
              if (['info', 'verbose', 'error', 'warn', 'debug', 'method'].includes(funcName)) {
                const sourceExpr = new SourceLiteralExpression({
                  value: createToken(TokenKind.SourceLocationLiteral, ''),
                });
                event.editor.addToArray(callExpr.args, 0, sourceExpr);
              }
              visitedLines[range.start.line] = true;
            }

            if (config.guard && isExpressionStatement(callExpr.parent)) {
              event.editor.setProperty(owner, key, createGuardStatement(callExpr));
            }
          }
        } catch (e) {
          console.log(`roku-log-plugin: Error processing ${event.file.pkgPath}: ${e.message}`);
        }
      },
    });

    event.file.parser.ast.walk(logVisitor, {
      walkMode: brighterscript.WalkMode.visitAllRecursive,
    });
  }

  afterSerializeFile(event) {
    if (!this.config.removeComments) return;
    if (!brighterscript.isBrsFile(event.file) && !brighterscript.isXmlFile(event.file)) return;

    const result = event.result.get(event.file)[0];
    let text = result.data.toString();

    if (brighterscript.isXmlFile(event.file)) {
      text = text.replace(/<!(--[\s\S]*?--)?>/gi, '');
    } else {
      text = text.replace(/^(?: *|\t*)('[^\n]*)/gim, '');
    }

    result.data = Buffer.from(text);
  }
}

/**
 * Creates `m.__le = m.log.enabled` assignment for guard pattern.
 * Injected after every `m.log = new log.Logger()` to cache the enabled state.
 *
 * `m.log` is hardcoded on BOTH sides on purpose, and the caller only invokes this for an
 * assignment whose target IS `m.log` — see the note at that call site. A logger under any
 * other name gets no cache line, because nothing would read it and the read itself is
 * unsafe in a scope that has no `m.log`.
 */
function createGuardSetStatement() {
  // m.log.enabled
  const enabledGet = makeDottedGet(makeDottedGet(makeVar('m'), 'log'), 'enabled');

  // m.__le = m.log.enabled
  return new DottedSetStatement({
    obj: makeVar('m'),
    name: createIdentifier('__le'),
    dot: createToken(TokenKind.Dot, '.'),
    equals: createToken(TokenKind.Equal, '='),
    value: enabledGet,
  });
}

/**
 * Creates `if m.__le = true then <original statement>` guard wrapper.
 * Wraps individual log calls so they only execute when logging is enabled.
 */
function createGuardStatement(callExpression) {
  // m.__le
  const leGet = makeDottedGet(makeVar('m'), '__le');

  // true
  const trueExpr = new LiteralExpression({
    value: createToken(TokenKind.True, 'true'),
  });

  // m.__le = true
  const condition = new BinaryExpression({
    left: leGet,
    operator: createToken(TokenKind.Equal, '='),
    right: trueExpr,
  });

  // if m.__le = true then <statement>
  const body = new Block({ statements: [callExpression.parent] });

  return new IfStatement({
    if: createToken(TokenKind.If, 'if'),
    then: createToken(TokenKind.Then, 'then'),
    condition,
    thenBranch: body,
  });
}

module.exports = () => new RokuLogPlugin();
