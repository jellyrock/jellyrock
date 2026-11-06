/**
 * BrighterScript v1 plugin for roku-log integration.
 *
 * OURS, not a vendored copy: written from scratch to replace the unmaintained
 * roku-log-bsc-plugin (0.9.0-beta.1), which BSC v1's AST changes broke
 * (parser.references removed, `.name` became `.tokens.name`, `.range` became
 * `.location.range`, constructors require options objects instead of positional
 * args). There is no
 * upstream to sync from or defer to: change it here.
 *
 * Do not confuse this with the logging runtime in `source/logging/` and
 * `components/logging/` (adopted from roku-log 0.11.1, also ours). This file
 * rewrites CALL SITES before the compiler sees them, so it can put a statement
 * in a scope that never contained one; when logging misbehaves, work out which
 * of the two you are looking at first. See docs/architecture/logging.md.
 *
 * Features:
 *  - strip:          Remove all m.log.*() calls from transpiled output (prod builds)
 *  - insertPkgPath:  Inject source file location as first arg to log calls (dev builds)
 *  - guard:          Wrap log calls in `if m.__le = true then` checks
 *  - removeComments: Strip comments from transpiled .brs and XML output
 *  - arity check:    Error on an m.log.<level>() call with more than the message
 *                    plus 8 values (`log-too-many-values`, see below)
 *  - personal text:  Error on an m.log.<level>() argument whose name says it holds a
 *                    title or a name (`log-personal-text`, see below)
 *
 * Call arity: each level function in the runtime library takes `message` plus nine
 * values (ten parameters), and insertPkgPath prepends a file-and-line argument, so
 * a source call may pass the message plus at most eight values. A ninth builds
 * clean and then crashes the Task or screen at runtime with "Wrong number of
 * function parameters". The check runs in afterValidateFile, so `npm run validate`
 * and the editor see it, and it applies whether or not the build strips or
 * prepends. Suppress with `' bsc-disable-line log-too-many-values`. It ignores
 * `bsc-disable-file`, since a whole-file opt-out would hide every over-limit call in the file.
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

// The level methods of the logging runtime that take (message, value ... value9).
// The same list gates the file-and-line prepend below.
const LOG_LEVELS = ['info', 'verbose', 'error', 'warn', 'debug'];

// Parameter count of each level method: `message` plus `value` to `value9`.
// Source: `sub info(message, value = "~#", ... value9 = "~#")` in
// source/logging/Logger.bs. A test compares this number with that file, so a
// change to the signatures fails the suite.
const LOG_FUNCTION_PARAMS = 10;

// The build prepends one argument (the file and line) to every call, so the source
// call has one fewer slot: the message plus eight values.
const MAX_SOURCE_ARGS = LOG_FUNCTION_PARAMS - 1;

const ARITY_CODE = 'log-too-many-values';

// The logger masks what has a shape (tokens, hosts, IPs: log.Redactor in
// source/logging/Logger.bs). A title or a person's name is free text with no shape to find,
// and a shared log can show who someone is or what they watch, so the build keeps them out
// of m.log by the name of the argument instead. An ID is fine: it identifies nothing alone.
const PERSONAL_CODE = 'log-personal-text';
// Names that hold free text without ending in "name" or "title": what a user searched for, and
// a file path, which holds the title (and sometimes an account name).
const PERSONAL_NAMES = new Set([
  'username',
  'album',
  'albumartist',
  'artist',
  'artists',
  'query',
  'searchterm',
  'path',
]);
// Names that end in "name" or "title" but hold neither: each says what it holds instead.
const NOT_PERSONAL = new Set([
  'settingname', // a setting's key, such as playbackSubsCustom
  'fieldname', // a setting node's field, which is a setting's key
  'trackname', // an audio or subtitle track label, such as "English SDH"
]);
const PERSONAL_DISABLE_LINE = /'\s*bsc-disable-line\s+log-personal-text\b/i;
const PERSONAL_DISABLE_NEXT_LINE = /'\s*bsc-disable-next-line\s+log-personal-text\b/i;
// Calls that only convert or trim a value, so the name of what they convert is what counts.
const PASS_THROUGH_CALLS = new Set(['tostr', 'trim', 'toupper', 'tolower', 'tostring']);
const ARITY_DISABLE_LINE = /'\s*bsc-disable-line\s+log-too-many-values\b/i;
const ARITY_DISABLE_NEXT_LINE = /'\s*bsc-disable-next-line\s+log-too-many-values\b/i;

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
        // UNREAD (nothing guards its calls) and UNSAFE: it dots into an `m.log` that need
        // not exist in that scope.
        //
        // Not hypothetical: `source/utils/screenReadiness.bs` keeps its logger on
        // `m.screenLoadLog`, and the ledger crashed the app at launch with `&hec` ('Dot'
        // operator on invalid) the first time it was called from a scope with no `m.log`
        // of its own: main-thread `source/loginRouter.bs`. Every instrumented COMPONENT
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
              if (LOG_LEVELS.includes(funcName)) {
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

  afterValidateFile(event) {
    try {
      const file = event.file;
      if (!brighterscript.isBrsFile(file)) return;
      const text = file.fileContents || '';
      const sourceLines = text.split(/\r?\n/);

      file.parser.ast.walk(
        brighterscript.createVisitor({
          CallExpression: (call) => {
            const callee = call.callee;
            // Same shape the build edit matches: m.log.<level>(...)
            if (!brighterscript.isDottedGetExpression(callee)) return;
            if (!brighterscript.isDottedGetExpression(callee.obj)) return;
            if (getNameText(callee.obj) !== 'log') return;
            if (!brighterscript.isVariableExpression(callee.obj.obj)) return;
            if (getNameText(callee.obj.obj) !== 'm') return;
            const level = getNameText(callee);
            if (!LOG_LEVELS.includes(level)) return;

            const range = getRange(call);
            if (!range) return;
            const line = range.start.line;

            const personalSuppressed =
              PERSONAL_DISABLE_LINE.test(sourceLines[line] ?? '') ||
              (line > 0 && PERSONAL_DISABLE_NEXT_LINE.test(sourceLines[line - 1] ?? ''));
            if (!personalSuppressed) {
              for (const [argName, arg] of call.args.flatMap((a) => namesIn(a))) {
                if (!isPersonalName(argName)) continue;
                event.program.diagnostics.register({
                  code: PERSONAL_CODE,
                  severity: 1, // Error
                  source: this.name,
                  message: `m.log.${level}() is given \`${argName}\`, which looks like a title or a name. Logs get shared, and free text can show who someone is or what they watch, and masking cannot find it. Log the ID instead, or add ' bsc-disable-line ${PERSONAL_CODE} with why it cannot identify anyone.`,
                  location: arg.location ?? call.location,
                });
              }
            }

            const argCount = call.args.length;
            if (argCount <= MAX_SOURCE_ARGS) return;

            if (ARITY_DISABLE_LINE.test(sourceLines[line] ?? '')) return;
            if (line > 0 && ARITY_DISABLE_NEXT_LINE.test(sourceLines[line - 1] ?? '')) return;

            event.program.diagnostics.register({
              code: ARITY_CODE,
              severity: 1, // Error
              source: this.name,
              message: `m.log.${level}() has ${argCount - 1} values after the message, and the limit is ${MAX_SOURCE_ARGS - 1} values. The roku-log runtime takes ${LOG_FUNCTION_PARAMS} parameters and the build prepends the file and line, so a longer call builds clean and crashes at runtime with "Wrong number of function parameters". Split it into two log lines. Add ' bsc-disable-line ${ARITY_CODE} to suppress.`,
              location: call.location,
            });
          },
        }),
        { walkMode: brighterscript.WalkMode.visitAllRecursive },
      );
    } catch (e) {
      console.log(`roku-log-plugin: Error checking ${event.file?.pkgPath}: ${e.message}`);
    }
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
 * The name an argument expression reads last: `item.name` gives `name`, `rowTitle` gives
 * `rowTitle`, `item["Name"]` gives `Name`, and `item.album.toStr()` gives `album`. Anything
 * else (a literal, an arithmetic result, a call that is not a conversion) gives undefined.
 * @param {object} expression
 * @returns {string|undefined}
 */
function finalName(expression) {
  if (brighterscript.isVariableExpression(expression)) return getNameText(expression);
  if (brighterscript.isDottedGetExpression(expression)) return getNameText(expression);
  if (brighterscript.isIndexedGetExpression(expression)) {
    const index = expression.indexes?.[0] ?? expression.index;
    if (brighterscript.isLiteralExpression(index)) {
      const text = index.tokens?.value?.text ?? '';
      if (text.startsWith('"')) return text.replace(/^"|"$/g, '');
    }
    return undefined;
  }
  if (isCallExpression(expression) && brighterscript.isDottedGetExpression(expression.callee)) {
    const method = (getNameText(expression.callee) ?? '').toLowerCase();
    if (PASS_THROUGH_CALLS.has(method)) return finalName(expression.callee.obj);
  }
  return undefined;
}

/**
 * Every name a log argument passes on, each with the expression to report it at. Besides the
 * argument itself, it looks into what joins values into one string or one value: both sides of
 * `+`, brackets, a template string's `${}` parts, and an AA literal's keys and values.
 * @param {object} expression
 * @returns {Array<[string, object]>}
 */
function namesIn(expression) {
  if (!expression) return [];
  if (brighterscript.isBinaryExpression(expression)) {
    return [...namesIn(expression.left), ...namesIn(expression.right)];
  }
  if (brighterscript.isGroupingExpression(expression)) return namesIn(expression.expression);
  if (brighterscript.isTemplateStringExpression(expression)) {
    return (expression.expressions ?? []).flatMap((part) => namesIn(part));
  }
  if (brighterscript.isAALiteralExpression(expression)) {
    return (expression.elements ?? []).flatMap((member) => {
      if (!brighterscript.isAAMemberExpression(member)) return [];
      const key = (member.tokens?.key?.text ?? '').replace(/^"|"$/g, '');
      return [...(key ? [[key, member]] : []), ...namesIn(member.value)];
    });
  }
  const name = finalName(expression);
  return name ? [[name, expression]] : [];
}

/**
 * True for a name that says it holds a title, a person's name or other free text: any name
 * ending in "name" or "title" (but not "subtitle", which names a track or its index), and the few
 * in PERSONAL_NAMES. NOT_PERSONAL lists the exceptions, so a new free-text name fails the build
 * until someone says it holds none.
 * @param {string} name
 * @returns {boolean}
 */
function isPersonalName(name) {
  const lowered = name.toLowerCase();
  if (NOT_PERSONAL.has(lowered) || lowered.endsWith('subtitle')) return false;
  if (lowered.endsWith('name') || lowered.endsWith('title')) return true;
  return PERSONAL_NAMES.has(lowered);
}

/**
 * Creates `m.__le = m.log.enabled` assignment for guard pattern.
 * Injected after every `m.log = new log.Logger()` to cache the enabled state.
 *
 * `m.log` is hardcoded on BOTH sides on purpose, and the caller only invokes this for an
 * assignment whose target IS `m.log` (see the note at that call site). A logger under any
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
module.exports.LOG_LEVELS = LOG_LEVELS;
module.exports.LOG_FUNCTION_PARAMS = LOG_FUNCTION_PARAMS;
