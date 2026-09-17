/**
 * BrighterScript plugin — no STOP-then-relaunch of the same Task node.
 *
 * Measured on device (docs/architecture/threading.md, "Measured findings";
 * pinned by tests/source/unit/platform/TaskRelaunch.spec.bs): writing
 * `control = "STOP"` to a Task node whose function is still running, then
 * `launchTask()` on that same node in the same callback, is a race. The launch
 * is sometimes ignored — nothing starts and nothing errors — and sometimes
 * honored. Neither outcome can be relied on. A NEW node launched in that
 * callback always starts, and the stopped function makes no further progress.
 * So a run that can be restarted while the previous one is in flight must get a
 * new node; `ExtrasRowList.startRun` is the reference.
 *
 * What is flagged — a `launchTask(X)` call, in a function that earlier (in
 * source order):
 *   - writes `X.control = "STOP"` (any casing; also `X["control"] = "STOP"`,
 *     `X.setField("control", "STOP")` and a literal `X.setFields({ control: "STOP" })`), or
 *   - calls a function or sub declared in the SAME file whose body writes that
 *     STOP to `X`, where `X` is an `m.` path (one hop: `prepareDataLoad()` then
 *     `launchTask(m.loadItemsTask)`). A helper's locals mean nothing to its caller,
 *     so only `m.`-rooted paths cross the hop.
 *
 * What is NOT flagged:
 *   - A STOP after the launch (a timeout that stops the task it just started).
 *   - A launch after `X`, or a parent of it, is assigned between the STOP and the
 *     launch — that is the new-node fix. All three write spellings count:
 *     `X = …` / `m.x = …`, the literal-key `m["x"] = …`, and a literal-AA
 *     `setFields` / `addFields`.
 *   - A STOP in a different function from the launch, other than the one-hop
 *     helper above (e.g. a STOP in a completion handler, then a launch from a later
 *     callback). Those run in different callbacks, and a relaunch from a later
 *     callback is reliable.
 *
 * Known residual gaps, stated rather than chased:
 *   - Source order is not control flow. A STOP in one branch and the launch in
 *     another (`if a then stop else launch`) is flagged though they cannot both
 *     run; one suppression each. No such site exists today.
 *   - Helpers are followed one hop, within one file, by bare name. A helper
 *     reached through `m.someMethod()`, another file, or a second hop is missed.
 *   - A STOP guarded by `if X.state = "run"` is flagged like any other: the guard
 *     is exactly the running case the race needs.
 *
 * Allowed call sites:
 *  - `source/utils/tasks.bs`   (the wrapper itself)
 *  - `components/vendor/**`    (vendored third-party code we don't author)
 *
 * Escape hatch (state the reason after the code):
 *  - `' bsc-disable-next-line no-same-node-relaunch <reason>` on the line above
 *    the launch, or `' bsc-disable-line …` on it. `bsc-disable-file` is
 *    deliberately NOT honored, as with `no-raw-run` and `no-task-fanout`.
 */
'use strict';

const brighterscript = require('brighterscript');

const CODE = 'no-same-node-relaunch';
const ALLOWED_DEST_PATHS = new Set(['source/utils/tasks.bs', 'source/utils/tasks.brs']);
const EXCLUDED_DEST_PREFIXES = ['components/vendor/'];
// Line and next-line only, like the other Task rules: a whole-file opt-out would
// remove the guard from every launch in the file.
const DISABLE_LINE_MARKER = /'\s*bsc-disable-line\s+no-same-node-relaunch\b/i;
const DISABLE_NEXT_LINE_MARKER = /'\s*bsc-disable-next-line\s+no-same-node-relaunch\b/i;

const LAUNCH_FUNCTION = 'launchtask';
const CONTROL_FIELD = 'control';
const STOP_VALUE = 'stop';
const SET_FIELD = 'setfield';
const FIELD_WRITE_METHODS = new Set(['setfields', 'addfields']);
const SELF_REFERENCE = 'm';

/** The value of a string literal expression, or undefined. */
function stringLiteralValue(expression) {
  if (!brighterscript.isLiteralExpression(expression)) return undefined;
  const raw = expression.tokens?.value?.text;
  if (typeof raw !== 'string') return undefined;
  if (!raw.startsWith('"') || !raw.endsWith('"')) return undefined;
  return raw.slice(1, -1);
}

function isLiteral(expression, wanted) {
  const value = stringLiteralValue(expression);
  return typeof value === 'string' && value.toLowerCase() === wanted;
}

function aaKey(element) {
  const key = element?.tokens?.key?.text ?? element?.key?.text;
  return typeof key === 'string' ? key.replace(/^"|"$/g, '').toLowerCase() : undefined;
}

/**
 * The lowercased dotted path an expression names — `task`, `m.loadtask`,
 * `m.view.task` — or undefined for anything else (an index, a call). Lowercased
 * because BrightScript identifiers and AA keys are case-insensitive.
 */
function refPath(expression) {
  const steps = [];
  let current = expression;
  while (brighterscript.isDottedGetExpression(current)) {
    const step = current.tokens?.name?.text;
    if (!step) return undefined;
    steps.unshift(step.toLowerCase());
    current = current.obj;
  }
  if (!brighterscript.isVariableExpression(current)) return undefined;
  const root = current.tokens?.name?.text;
  if (!root) return undefined;
  return [root.toLowerCase(), ...steps].join('.');
}

/** True when `call` is `launchTask(...)`, bare or with a dotted callee. */
function isLaunchTaskCall(call) {
  const callee = call?.callee;
  if (
    !brighterscript.isVariableExpression(callee) &&
    !brighterscript.isDottedGetExpression(callee)
  ) {
    return false;
  }
  return callee.tokens?.name?.text?.toLowerCase() === LAUNCH_FUNCTION;
}

function start(node) {
  const s = node?.location?.range?.start;
  return s ? s.line * 100000 + s.character : -1;
}

/**
 * Every STOP, launch, rebind and bare call in `body`, each with its source
 * position. The walk does not visit in source order, so callers sort.
 */
function collectEvents(body) {
  const events = [];
  const push = (kind, path, node, extra = {}) => {
    if (path === undefined) return;
    events.push({ kind, path, pos: start(node), node, ...extra });
  };

  body.walk(
    brighterscript.createVisitor({
      DottedSetStatement: (statement) => {
        const base = refPath(statement.obj);
        const field = statement.tokens?.name?.text?.toLowerCase();
        if (base === undefined || !field) return;
        if (field === CONTROL_FIELD && isLiteral(statement.value, STOP_VALUE)) {
          push('stop', base, statement);
        }
        push('rebind', `${base}.${field}`, statement);
      },
      IndexedSetStatement: (statement) => {
        const indexes = statement.indexes || [];
        if (indexes.length !== 1) return;
        const base = refPath(statement.obj);
        const key = stringLiteralValue(indexes[0])?.toLowerCase();
        if (base === undefined || !key) return;
        if (key === CONTROL_FIELD && isLiteral(statement.value, STOP_VALUE)) {
          push('stop', base, statement);
        }
        push('rebind', `${base}.${key}`, statement);
      },
      AssignmentStatement: (statement) => {
        const name = statement.tokens?.name?.text;
        if (name) push('rebind', name.toLowerCase(), statement);
      },
      CallExpression: (call) => {
        const callee = call?.callee;
        const args = call.args || [];
        if (isLaunchTaskCall(call)) {
          if (args.length === 1) push('launch', refPath(args[0]), call);
          return;
        }
        if (brighterscript.isVariableExpression(callee)) {
          const name = callee.tokens?.name?.text;
          if (name) push('call', name.toLowerCase(), call);
          return;
        }
        if (!brighterscript.isDottedGetExpression(callee)) return;
        const method = callee.tokens?.name?.text?.toLowerCase();
        const base = refPath(callee.obj);
        if (base === undefined) return;
        if (method === SET_FIELD) {
          if (
            args.length >= 2 &&
            isLiteral(args[0], CONTROL_FIELD) &&
            isLiteral(args[1], STOP_VALUE)
          ) {
            push('stop', base, call);
          }
          return;
        }
        if (FIELD_WRITE_METHODS.has(method)) {
          if (args.length !== 1 || !brighterscript.isAALiteralExpression(args[0])) return;
          for (const element of args[0].elements || []) {
            const key = aaKey(element);
            if (!key) continue;
            if (key === CONTROL_FIELD && isLiteral(element.value, STOP_VALUE)) {
              push('stop', base, call);
            }
            push('rebind', `${base}.${key}`, call);
          }
        }
      },
    }),
    { walkMode: brighterscript.WalkMode.visitAllRecursive },
  );
  return events.sort((a, b) => a.pos - b.pos);
}

/** True when `path` itself or any parent of it is in `rebound`. */
function isRebound(path, rebound) {
  const steps = path.split('.');
  for (let end = 1; end <= steps.length; end++) {
    if (rebound.has(steps.slice(0, end).join('.'))) return true;
  }
  return false;
}

/** The functions declared in `file`, as { name, body } (name lowercased). */
function functionsIn(file) {
  const found = [];
  file.parser.ast.walk(
    brighterscript.createVisitor({
      FunctionStatement: (statement) => {
        const name = statement.tokens?.name?.text;
        const body = statement.func?.body;
        if (body) found.push({ name: name?.toLowerCase(), body });
      },
      MethodStatement: (statement) => {
        const body = statement.func?.body;
        if (body) found.push({ name: undefined, body });
      },
    }),
    { walkMode: brighterscript.WalkMode.visitAllRecursive },
  );
  return found;
}

class NoSameNodeRelaunchPlugin {
  constructor() {
    this.name = 'jellyrock-no-same-node-relaunch';
  }

  afterValidateFile(event) {
    try {
      const file = event.file;
      if (!brighterscript.isBrsFile(file)) return;

      const destPath = (file.destPath || '').replace(/\\/g, '/');
      if (ALLOWED_DEST_PATHS.has(destPath)) return;
      if (EXCLUDED_DEST_PREFIXES.some((prefix) => destPath.startsWith(prefix))) return;

      const functions = functionsIn(file).map((fn) => ({ ...fn, events: collectEvents(fn.body) }));

      // One hop: the `m.` paths each named function STOPs directly.
      const helperStops = new Map();
      for (const fn of functions) {
        if (!fn.name) continue;
        const stops = fn.events
          .filter((e) => e.kind === 'stop' && e.path.startsWith(`${SELF_REFERENCE}.`))
          .map((e) => e.path);
        if (stops.length) helperStops.set(fn.name, new Set(stops));
      }

      const reported = new Set();
      for (const fn of functions) {
        // path -> set of paths rebound since that path's last STOP
        const stopped = new Map();
        for (const e of fn.events) {
          if (e.kind === 'stop') {
            stopped.set(e.path, { rebound: new Set(), via: undefined });
          } else if (e.kind === 'call') {
            for (const path of helperStops.get(e.path) ?? []) {
              stopped.set(path, { rebound: new Set(), via: e.path });
            }
          } else if (e.kind === 'rebind') {
            for (const state of stopped.values()) state.rebound.add(e.path);
          } else if (e.kind === 'launch') {
            const state = stopped.get(e.path);
            if (!state || isRebound(e.path, state.rebound)) continue;
            this.report(event.program, file, e.node, e.path, state.via, reported);
          }
        }
      }
    } catch (_e) {
      // Never crash the build.
    }
  }

  report(program, file, call, path, via, reported) {
    const range = call?.location?.range;
    if (!range) return;
    const key = `${range.start.line}:${range.start.character}`;
    if (reported.has(key)) return;
    reported.add(key);
    const lines = (file.fileContents || '').split(/\r?\n/);
    if (DISABLE_LINE_MARKER.test(lines[range.start.line] ?? '')) return;
    if (range.start.line > 0 && DISABLE_NEXT_LINE_MARKER.test(lines[range.start.line - 1] ?? '')) {
      return;
    }

    const where = via ? ` (stopped inside \`${via}()\`)` : '';
    program.diagnostics.register({
      code: CODE,
      severity: 1, // Error
      source: this.name,
      message:
        `\`${path}\` is stopped${where} and relaunched in the same function. If its task is still running, the relaunch is a race: it is sometimes silently ignored. ` +
        'Launch a new node for each run instead (ExtrasRowList.startRun is the reference). ' +
        'Evidence: docs/architecture/threading.md (Measured findings). ' +
        `Add ' bsc-disable-next-line ${CODE} <reason> above the launch to suppress.`,
      location: call.location,
    });
  }
}

module.exports = () => new NoSameNodeRelaunchPlugin();
