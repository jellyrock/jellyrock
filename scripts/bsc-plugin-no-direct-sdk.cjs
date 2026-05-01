/**
 * BrighterScript plugin — no direct sdk.* calls outside the API layer.
 *
 * `source/api/sdk.bs` is a thin internal wrapper around Jellyfin endpoints,
 * intended to be reachable only through `source/api/ApiClient.bs` (which
 * routes calls through the persistent Task pool). Direct `sdk.<ns>.<fn>(...)`
 * calls from anywhere else bypass the pool, run on the render thread, and
 * skip the v1/v2 API-version dispatch.
 *
 * See `docs/architecture/api.md` and `source/api/CLAUDE.md`.
 *
 * Allowed call sites:
 *  - `source/api/ApiClient.bs`  (the wrapper itself)
 *  - `source/api/sdk.bs`        (internal cross-namespace calls)
 *
 * Escape hatch:
 *  - `' bsc-disable-line no-direct-sdk` on the offending line.
 */
'use strict';

const brighterscript = require('brighterscript');

const ALLOWED_DEST_PATHS = new Set([
  'source/api/ApiClient.bs',
  'source/api/ApiClient.brs',
  'source/api/sdk.bs',
  'source/api/sdk.brs'
]);
const DISABLE_LINE_MARKER = /'\s*bsc-disable-line\s+no-direct-sdk\b/i;
const DISABLE_NEXT_LINE_MARKER = /'\s*bsc-disable-next-line\s+no-direct-sdk\b/i;

class NoDirectSdkPlugin {
  constructor() {
    this.name = 'jellyrock-no-direct-sdk';
  }

  afterValidateFile(event) {
    try {
      const file = event.file;
      if (!brighterscript.isBrsFile(file)) return;

      const destPath = (file.destPath || '').replace(/\\/g, '/');
      if (ALLOWED_DEST_PATHS.has(destPath)) return;

      const sourceLines = (file.fileContents || '').split(/\r?\n/);

      const visitor = brighterscript.createVisitor({
        CallExpression: (call) => {
          // Match: sdk.<ns>.<fn>(...) — i.e. callee is DottedGet whose obj is
          // also a DottedGet whose root is the variable `sdk`.
          const callee = call?.callee;
          if (!brighterscript.isDottedGetExpression(callee)) return;
          const middle = callee.obj;
          if (!brighterscript.isDottedGetExpression(middle)) return;
          const root = middle.obj;
          if (!brighterscript.isVariableExpression(root)) return;
          if (root.tokens?.name?.text !== 'sdk') return;

          const range = call?.location?.range;
          if (!range) return;
          const sourceLine = sourceLines[range.start.line] ?? '';
          if (DISABLE_LINE_MARKER.test(sourceLine)) return;
          const prevLine = range.start.line > 0 ? (sourceLines[range.start.line - 1] ?? '') : '';
          if (DISABLE_NEXT_LINE_MARKER.test(prevLine)) return;

          const ns = middle.tokens?.name?.text || '?';
          const fn = callee.tokens?.name?.text || '?';

          event.program.diagnostics.register({
            code: 'no-direct-sdk',
            severity: 2, // Warning
            source: this.name,
            message: `Direct call to 'sdk.${ns}.${fn}(...)' bypasses ApiClient + the persistent task pool. Route this through GetApi().Build*Request() / fetchRes() instead. See docs/architecture/api.md. Add ' bsc-disable-line no-direct-sdk to suppress.`,
            location: call.location
          });
        }
      });

      file.parser.ast.walk(visitor, {
        walkMode: brighterscript.WalkMode.visitAllRecursive
      });
    } catch (_e) {
      // Never crash the build.
    }
  }
}

module.exports = () => new NoDirectSdkPlugin();
