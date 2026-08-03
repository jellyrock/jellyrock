/**
 * BrighterScript plugin — no raw `control = "RUN"` outside the launch chokepoint.
 *
 * Starting a Task node consumes one of RokuOS's 100 concurrent threads per app
 * instance. Epic #728 (`&h29` "too many task threads") came from launch sites
 * that scaled with server data, with nothing in the codebase able to see the
 * total. `launchTask()` in `source/utils/tasks.bs` is the single accounted
 * chokepoint; this plugin makes bypassing it a build error, so the bound holds
 * by construction rather than by convention.
 *
 * See `docs/architecture/tech-debt.md#task-thread-budget` and
 * `docs/projects/2026-08-task-thread-budget/PLAN.md`.
 *
 * What is flagged — an assignment to a `control` member, either form:
 *   - `node.control = "RUN"`
 *   - `node["control"] = "RUN"`
 *   - `node.control = someVariable`   (RHS not statically resolvable, so it
 *                                      may be "RUN" — flagged rather than
 *                                      assumed safe)
 *
 * What is NOT flagged:
 *   - `node.control = "STOP"` — stopping needs no accounting. The ledger derives
 *     the live count from each node's `state`, so a STOP is picked up for free.
 *   - Any other string literal. `control` is not a Task-only field: `Animation`
 *     takes "start"/"pause"/"resume" and `Video` takes "play"/"rewind"/"none",
 *     and the codebase has ~95 such writes. Only "RUN" starts a thread.
 *
 * Allowed call sites:
 *  - `source/utils/tasks.bs`   (the wrapper itself)
 *  - `components/vendor/**`    (vendored third-party code we don't author)
 *
 * Escape hatch:
 *  - `' bsc-disable-line no-raw-run` on the offending line.
 */
'use strict';

const brighterscript = require('brighterscript');

const ALLOWED_DEST_PATHS = new Set(['source/utils/tasks.bs', 'source/utils/tasks.brs']);
const EXCLUDED_DEST_PREFIXES = ['components/vendor/'];
const DISABLE_LINE_MARKER = /'\s*bsc-disable-line\s+no-raw-run\b/i;
const DISABLE_NEXT_LINE_MARKER = /'\s*bsc-disable-next-line\s+no-raw-run\b/i;

const CONTROL_FIELD = 'control';
const RUN_VALUE = 'run';

/** Strips the surrounding quotes BrighterScript keeps on string literal tokens. */
function stringLiteralValue(expression) {
  if (!brighterscript.isLiteralExpression(expression)) return undefined;
  const raw = expression.tokens?.value?.text;
  if (typeof raw !== 'string') return undefined;
  if (!raw.startsWith('"') || !raw.endsWith('"')) return undefined;
  return raw.slice(1, -1);
}

/** True when `expression` is the string literal "control" (any casing). */
function isControlLiteral(expression) {
  const value = stringLiteralValue(expression);
  return typeof value === 'string' && value.toLowerCase() === CONTROL_FIELD;
}

class NoRawRunPlugin {
  constructor() {
    this.name = 'jellyrock-no-raw-run';
  }

  afterValidateFile(event) {
    try {
      const file = event.file;
      if (!brighterscript.isBrsFile(file)) return;

      const destPath = (file.destPath || '').replace(/\\/g, '/');
      if (ALLOWED_DEST_PATHS.has(destPath)) return;
      if (EXCLUDED_DEST_PREFIXES.some((prefix) => destPath.startsWith(prefix))) return;

      const sourceLines = (file.fileContents || '').split(/\r?\n/);

      const report = (statement) => {
        const range = statement?.location?.range;
        if (!range) return;
        const sourceLine = sourceLines[range.start.line] ?? '';
        if (DISABLE_LINE_MARKER.test(sourceLine)) return;
        const prevLine = range.start.line > 0 ? (sourceLines[range.start.line - 1] ?? '') : '';
        if (DISABLE_NEXT_LINE_MARKER.test(prevLine)) return;

        event.program.diagnostics.register({
          code: 'no-raw-run',
          severity: 1, // Error
          source: this.name,
          message:
            'Raw `control = "RUN"` bypasses the accounted launch chokepoint and its thread cannot be counted. Call `launchTask(node)` from source/utils/tasks.bs instead. See docs/architecture/tech-debt.md#task-thread-budget. Add \' bsc-disable-line no-raw-run to suppress.',
          location: statement.location,
        });
      };

      // Flag a `control` write when it starts a Task thread — i.e. the literal
      // "RUN" — or when the assigned value cannot be resolved statically (a
      // variable, call, or concatenation could be "RUN" at runtime). Every other
      // string literal belongs to Animation / Video / Audio and is left alone.
      const startsAThread = (value) => {
        const literal = stringLiteralValue(value);
        if (literal === undefined) return true; // unresolvable — assume the worst
        return literal.toLowerCase() === RUN_VALUE;
      };

      const visitor = brighterscript.createVisitor({
        // node.control = <value>
        DottedSetStatement: (statement) => {
          if (statement.tokens?.name?.text?.toLowerCase() !== CONTROL_FIELD) return;
          if (!startsAThread(statement.value)) return;
          report(statement);
        },
        // node["control"] = <value>
        IndexedSetStatement: (statement) => {
          const indexes = statement.indexes || [];
          if (indexes.length !== 1) return;
          if (!isControlLiteral(indexes[0])) return;
          if (!startsAThread(statement.value)) return;
          report(statement);
        },
      });

      file.parser.ast.walk(visitor, {
        walkMode: brighterscript.WalkMode.visitAllRecursive,
      });
    } catch (_e) {
      // Never crash the build.
    }
  }
}

module.exports = () => new NoRawRunPlugin();
