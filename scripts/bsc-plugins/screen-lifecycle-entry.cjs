/**
 * BrighterScript plugin: a screen's lifecycle hooks are called only through JRScreen.
 *
 * JRScreen's router bridge (`onViewOpen`, `onViewResume`, `hideCovered`) wraps every call to
 * a screen's `onScreenShown` and `onScreenHidden` in the guards the app depends on: an open
 * dialog keeps the focus while a screen opens under it, and a covered screen's own dialogs
 * end. A caller that reaches a hook directly skips them. `main.bs` did, on screensaver exit:
 * every `onScreenShown` takes the focus, so an open dialog went deaf to the remote. It now
 * calls `onScreensaverExited`, an entry that keeps the guards.
 *
 * What is flagged: `<node>.callFunc("onScreenShown" | "onScreenHidden" | "hideCovered")`.
 *
 * What is allowed:
 *   - Anything in `components/JRScreen.bs`, which owns the hooks.
 *   - `hideCovered` from `components/JRScene.bs`: the screen swap is its one caller.
 *   - A screen forwarding a hook to a screen nested in it, from its own hook of the same name
 *     (`BaseGridView.onScreenShown` calls the TV guide's `onScreenShown`). That call already
 *     runs inside the guarded call of the outer screen.
 *   - Tests and package-managed code.
 *
 * One file decides each finding, and the finding lands in that file, so this hooks
 * `afterValidateFile` directly (scripts/CLAUDE.md). It honors line markers only, not a
 * whole-file opt-out, like the other error-level gates.
 *
 * Escape hatch: `' bsc-disable-line screen-lifecycle-entry` on the call, or
 * `' bsc-disable-next-line screen-lifecycle-entry` on the line above, with the reason.
 */
'use strict';

const brighterscript = require('brighterscript');

const DIAGNOSTIC_CODE = 'screen-lifecycle-entry';
const HOOKS = new Set(['onscreenshown', 'onscreenhidden', 'hidecovered']);
const FORWARDABLE = new Set(['onscreenshown', 'onscreenhidden']);
const OWNER_PATH = 'components/JRScreen.bs';
const SWAP_PATH = 'components/JRScene.bs';

const EXCLUDED_DEST_PREFIXES = [
  'components/roku_modules/',
  'source/roku_modules/',
  'source/tests/',
  'tests/',
];

const DISABLE_LINE = /bsc-disable-line\s+screen-lifecycle-entry\b/i;
const DISABLE_NEXT_LINE = /bsc-disable-next-line\s+screen-lifecycle-entry\b/i;

/** The text of a string literal token without its quotes, or undefined. */
function stringLiteralValue(text) {
  if (typeof text !== 'string' || text.length < 2 || !text.startsWith('"') || !text.endsWith('"'))
    return undefined;
  return text.slice(1, -1);
}

/**
 * Whether a call to `hook` from the function named `enclosing` in the file at `destPath` is
 * allowed. Exported for the tests.
 */
function isAllowed(destPath, enclosing, hook) {
  if (destPath === OWNER_PATH) return true;
  if (hook === 'hidecovered') return destPath === SWAP_PATH;
  return FORWARDABLE.has(hook) && typeof enclosing === 'string' && enclosing.toLowerCase() === hook;
}

class ScreenLifecycleEntryPlugin {
  constructor() {
    this.name = 'jellyrock-screen-lifecycle-entry';
  }

  afterValidateFile(event) {
    try {
      const file = event.file;
      if (!brighterscript.isBrsFile(file)) return;
      const destPath = (file.destPath || '').replace(/\\/g, '/');
      if (EXCLUDED_DEST_PREFIXES.some((prefix) => destPath.startsWith(prefix))) return;
      this.checkBrs(event, file, destPath);
    } catch (_e) {
      // Never crash the build.
    }
  }

  checkBrs(event, file, destPath) {
    const statements = file.parser?.ast?.statements;
    if (!Array.isArray(statements)) return;
    const lines = (file.fileContents || '').split(/\r?\n/);
    const walkAll = { walkMode: brighterscript.WalkMode.visitAllRecursive };

    const checkFunction = (stmt) => {
      const enclosing = stmt.tokens?.name?.text;
      stmt.walk(
        brighterscript.createVisitor({
          CallExpression: (call) => {
            const callee = call?.callee;
            if (!brighterscript.isDottedGetExpression(callee)) return;
            if (callee.tokens?.name?.text?.toLowerCase() !== 'callfunc') return;
            const arg = call.args?.[0];
            if (!brighterscript.isLiteralExpression(arg)) return;
            const method = stringLiteralValue(arg.tokens?.value?.text);
            if (!method) return;
            const hook = method.toLowerCase();
            if (!HOOKS.has(hook)) return;
            if (isAllowed(destPath, enclosing, hook)) return;
            this.report(event, lines, call.location, method);
          },
        }),
        walkAll,
      );
    };

    const visit = (list) => {
      for (const stmt of list) {
        if (brighterscript.isFunctionStatement(stmt)) checkFunction(stmt);
        else if (brighterscript.isNamespaceStatement(stmt)) visit(stmt.body?.statements ?? []);
      }
    };
    visit(statements);
  }

  report(event, lines, location, method) {
    const range = location?.range;
    if (!range) return;
    if (DISABLE_LINE.test(lines[range.start.line] ?? '')) return;
    if (range.start.line > 0 && DISABLE_NEXT_LINE.test(lines[range.start.line - 1] ?? '')) return;
    event.program.diagnostics.register({
      code: DIAGNOSTIC_CODE,
      severity: 1, // Error
      source: this.name,
      message: `callFunc("${method}") reaches a screen's lifecycle hook directly, skipping JRScreen's guards (an open dialog keeps the focus; a covered screen's own dialogs end). Use a JRScreen entry that keeps them, as main.bs uses onScreensaverExited, or add one. See docs/architecture/navigation.md. A screen may forward a hook to a screen nested in it from its own hook of the same name.`,
      location,
    });
  }
}

module.exports = () => new ScreenLifecycleEntryPlugin();
module.exports.isAllowed = isAllowed;
