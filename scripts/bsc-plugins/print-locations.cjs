/**
 * BrighterScript plugin — print-statement location enforcement.
 *
 * Flags `print` statements that should be `m.log.*` calls — so production
 * builds can strip the call-sites entirely (see `docs/architecture/logging.md`,
 * `components/CLAUDE.md` "No raw print statements").
 *
 * Smart-skipped contexts (no `m.log` access available, so `print` is the only
 * option and flagging it would just create noise):
 *  - `source/main.bs` — early bootstrap, runs before the log manager is up.
 *  - The `#if debug` block in `source/utils/globals.bs` — developer console hints.
 *  - Any free function in `source/*.bs` — top-level subs/functions outside a
 *    class can't carry an `m.log` instance (no `init()` / no constructor).
 *
 * Flagged contexts (do have access to `m.log` via component instance or class):
 *  - Any function in a `components/*.bs` file (paired with `.xml`, so every
 *    sub/function runs as a component method with `m` bound to the instance).
 *  - Any class method in any `.bs` file (the class can hold an `m.log`).
 *
 * Escape hatches:
 *  - `' bsc-disable-file print-locations` — suppress all warnings in this file
 *  - `' bsc-disable-line print-locations` — on the same line as the print
 *  - `' bsc-disable-next-line print-locations` — on the line above
 */
'use strict';

const brighterscript = require('brighterscript');

const ALLOWED_FILE_DESTPATHS = new Set(['source/main.bs', 'source/main.brs']);
const DEBUG_BLOCK_FILE_DESTPATHS = new Set(['source/utils/globals.bs', 'source/utils/globals.brs']);
const DISABLE_FILE_MARKER = /'\s*bsc-disable-file\s+print-locations\b/i;
const DISABLE_LINE_MARKER = /'\s*bsc-disable-line\s+print-locations\b/i;
const DISABLE_NEXT_LINE_MARKER = /'\s*bsc-disable-next-line\s+print-locations\b/i;

class PrintLocationsPlugin {
  constructor() {
    this.name = 'jellyrock-print-locations';
  }

  afterValidateFile(event) {
    try {
      const file = event.file;
      if (!brighterscript.isBrsFile(file)) return;

      const destPath = (file.destPath || '').replace(/\\/g, '/');
      if (ALLOWED_FILE_DESTPATHS.has(destPath)) return;

      const fileContents = file.fileContents;
      if (typeof fileContents === 'string' && DISABLE_FILE_MARKER.test(fileContents)) {
        return;
      }

      const sourceLines = (fileContents || '').split(/\r?\n/);
      const inDebugAllowedFile = DEBUG_BLOCK_FILE_DESTPATHS.has(destPath);
      const isSourceDir = destPath.startsWith('source/');

      const visitor = brighterscript.createVisitor({
        PrintStatement: (stmt) => {
          const range = stmt?.location?.range;
          if (!range) return;

          const line = sourceLines[range.start.line] ?? '';
          if (DISABLE_LINE_MARKER.test(line)) return;
          const prevLine = range.start.line > 0 ? (sourceLines[range.start.line - 1] ?? '') : '';
          if (DISABLE_NEXT_LINE_MARKER.test(prevLine)) return;

          if (inDebugAllowedFile && isInsideDebugConditional(stmt)) return;

          // Smart skip: in source/ files, only flag prints inside a class
          // method (the class can carry m.log). Free functions can't.
          if (isSourceDir && !isInsideClassMethod(stmt)) return;

          event.program.diagnostics.register({
            code: 'print-outside-allowlist',
            severity: 2, // Warning
            source: this.name,
            message: `'print' should be an m.log.* call (so prod builds can strip it — see docs/architecture/logging.md). Add ' bsc-disable-next-line print-locations to suppress.`,
            location: stmt.location,
          });
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

function isInsideDebugConditional(node) {
  let current = node?.parent;
  while (current) {
    if (brighterscript.isConditionalCompileStatement(current)) {
      const conditionText = current.tokens?.condition?.text;
      const isDebug = typeof conditionText === 'string' && conditionText.toLowerCase() === 'debug';
      const negated = !!current.tokens?.not;
      if (isDebug && !negated) return true;
    }
    current = current.parent;
  }
  return false;
}

function isInsideClassMethod(node) {
  let current = node?.parent;
  while (current) {
    if (brighterscript.isClassStatement(current)) return true;
    if (brighterscript.isMethodStatement(current)) return true;
    current = current.parent;
  }
  return false;
}

module.exports = () => new PrintLocationsPlugin();
