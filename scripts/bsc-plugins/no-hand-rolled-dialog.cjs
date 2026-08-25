/**
 * BrighterScript plugin — no hand-rolled dialog chrome, and no hand-rolled
 * overlay append.
 *
 * The dialog family exists because CONVENTION FAILED HERE ONCE. `JRDialog`,
 * `JRListDialog` and `OverviewDialog` each carried a private copy of the chrome
 * and of the layout arithmetic; when the #757 review restyled `JRDialog` the
 * other two silently kept the old look, and the app shipped two dialog languages
 * with every gate green — nothing asserted a single position, gap, colour or
 * asset. This plugin is the gate that was missing.
 *
 * See `docs/architecture/dialogs.md`.
 *
 * What is flagged:
 *
 *   1. A component that draws its OWN dimmed backdrop — a `Rectangle` sized
 *      1920x1080 (the full screen). Every dialog's backdrop belongs to
 *      `JRDialogPanel`; a second one is a dialog being rebuilt by hand.
 *
 *   2. `appendChild` / `insertChild` onto a SCENE reference (`m.scene`,
 *      `appScene()`, `getScene()`), which is how an overlay used to be mounted
 *      by hand — including via a LOCAL bound to one (`scene = appScene()` then
 *      `scene.appendChild(x)`), which is the shape `presentOverlayDialog` itself
 *      is written in and therefore the shape a copy of it will take. The helpers
 *      in `source/utils/dialogs.bs` are the only path that stamps the shared
 *      overlay id, so a hand-rolled append is invisible to
 *      `isOverlayDialogOpen` / `isDialogOpen` / `cancelOpenDialog` — it cannot
 *      be superseded, queried or cancelled, and nothing about it looks wrong at
 *      the call site.
 *
 * What is NOT flagged, and WHY NOT — this half was learned the hard way:
 *   - The family itself and the helpers that mount it (ALLOWED_DEST_PATHS).
 *   - **The 9-patch panel assets.** The first version of this plugin flagged any
 *     `Poster` drawing `filled-rounded.9.png` or `border-3px.9.png`, on the
 *     theory that those ARE the dialog panel. Run against the tree it produced
 *     16 errors and 1 true positive: those assets are the app's generic rounded
 *     surface and edge, used by `TextButton`, `Toast`, `JRDropdown`,
 *     `IconButton`, `TrackDropdown` and more. An asset does not identify a
 *     dialog; a full-screen dimmed backdrop does. The rule was deleted rather
 *     than allow-listed, because an allow-list of every legitimate user would
 *     have to grow with each new button.
 *   - A Rectangle that is full-screen for a reason other than a dialog backdrop
 *     — there is no way to tell those apart statically, which is why the check
 *     requires an `opacity` (a DIMMING rectangle) and why the escape hatch below
 *     exists.
 *   - Vendored third-party code, in BOTH trees (`components/roku_modules/`,
 *     `source/roku_modules/`, `components/vendor/`).
 *
 * Known gap, stated rather than papered over: a backdrop whose size is set in
 * BrightScript (`m.dim.width = 1920`) rather than in the XML is not caught. The
 * XML half reads the markup on purpose — that is where every dialog in this app
 * declares its chrome — and chasing the code-set case would mean tracking field
 * writes on arbitrary nodes for a shape nothing in the tree uses.
 *
 * Escape hatch:
 *   - `' bsc-disable-line no-hand-rolled-dialog` on the offending line, or
 *     `bsc-disable-next-line` on the one above. XML files use
 *     `<!-- bsc-disable-line no-hand-rolled-dialog -->`.
 */
'use strict';

const brighterscript = require('brighterscript');

/** The dialog family and the helpers that mount it — the sanctioned authors. */
const ALLOWED_DEST_PATHS = new Set([
  'components/dialogs/JRDialogPanel.xml',
  'components/dialogs/JRDialogPanel.bs',
  'components/dialogs/JRDialog.xml',
  'components/dialogs/JRDialog.bs',
  'components/dialogs/JRListDialog.xml',
  'components/dialogs/JRListDialog.bs',
  'components/dialogs/JRKeyboardDialog.xml',
  'components/dialogs/JRKeyboardDialog.bs',
  'components/dialogs/QuickConnectDialog.xml',
  'components/dialogs/QuickConnectDialog.bs',
  'components/OverviewDialog.xml',
  'components/OverviewDialog.bs',
  'source/utils/dialogs.bs',
  'source/utils/dialogs.brs',
]);

const EXCLUDED_DEST_PREFIXES = [
  'components/vendor/',
  // BOTH vendored trees. `source/roku_modules/` alone left
  // `components/roku_modules/` (log, promises, sgrouter) inside the rule, which
  // is third-party code we cannot edit and would have to suppress line by line.
  'components/roku_modules/',
  'source/roku_modules/',
  'source/tests/',
  'tests/',
];

// The marker alone, NOT anchored to a comment opener. A multi-line XML comment
// puts the opener several lines above the marker, so requiring `<!--` on the same
// line silently ignored the suppression — and a bare occurrence of this literal
// is intentional wherever it appears.
const DISABLE_LINE = /bsc-disable-line\s+no-hand-rolled-dialog\b/i;
const DISABLE_NEXT_LINE = /bsc-disable-next-line\s+no-hand-rolled-dialog\b/i;

/** Scene handles an overlay used to be appended to by hand. */
const SCENE_ACCESSORS = new Set(['appscene', 'getscene']);
const CHILD_APPENDERS = new Set(['appendchild', 'insertchild']);

const SCREEN_WIDTH = '1920';
const SCREEN_HEIGHT = '1080';

/**
 * True when this expression evaluates to the SCENE. Covers `appScene()`,
 * `x.getScene()` and the `m.scene` / `m.top.getScene()` shapes, which is every
 * form the codebase has used to reach it.
 */
function isSceneExpression(expression) {
  if (!expression) return false;
  if (brighterscript.isCallExpression(expression)) {
    const callee = expression.callee;
    const name = brighterscript.isDottedGetExpression(callee)
      ? callee.tokens?.name?.text
      : callee?.tokens?.name?.text;
    return typeof name === 'string' && SCENE_ACCESSORS.has(name.toLowerCase());
  }
  if (brighterscript.isDottedGetExpression(expression)) {
    return expression.tokens?.name?.text?.toLowerCase() === 'scene';
  }
  return false;
}

class NoHandRolledDialogPlugin {
  constructor() {
    this.name = 'jellyrock-no-hand-rolled-dialog';
  }

  /** Shared suppression + registration for both file kinds. */
  makeReporter(event, file, sourceLines) {
    return (location, message) => {
      const range = location?.range;
      if (!range) return;
      const line = sourceLines[range.start.line] ?? '';
      if (DISABLE_LINE.test(line)) return;
      const prev = range.start.line > 0 ? (sourceLines[range.start.line - 1] ?? '') : '';
      if (DISABLE_NEXT_LINE.test(prev)) return;

      event.program.diagnostics.register({
        code: 'no-hand-rolled-dialog',
        severity: 1, // Error
        source: this.name,
        message: `${message} Every dialog goes through source/utils/dialogs.bs and takes its chrome from JRDialogPanel — see docs/architecture/dialogs.md. Add ' bsc-disable-line no-hand-rolled-dialog to suppress.`,
        location,
      });
    };
  }

  skips(file) {
    const destPath = (file.destPath || '').replace(/\\/g, '/');
    if (ALLOWED_DEST_PATHS.has(destPath)) return true;
    return EXCLUDED_DEST_PREFIXES.some((prefix) => destPath.startsWith(prefix));
  }

  afterValidateFile(event) {
    try {
      const file = event.file;
      if (this.skips(file)) return;

      if (brighterscript.isXmlFile(file)) {
        this.checkXml(event, file);
        return;
      }
      if (brighterscript.isBrsFile(file)) {
        this.checkBrs(event, file);
      }
    } catch (_e) {
      // Never crash the build.
    }
  }

  /**
   * The chrome half. Read from the raw XML rather than the parsed AST: the
   * component tree is what we are asserting about, and a regex over attributes
   * on one element is both sufficient and far less coupled to BSC's XML AST
   * shape than walking it would be.
   */
  checkXml(event, file) {
    const contents = file.fileContents || '';
    const lines = contents.split(/\r?\n/);
    const report = this.makeReporter(event, file, lines);

    const locate = (index) => {
      const before = contents.slice(0, index);
      const line = before.split(/\r?\n/).length - 1;
      const column = index - (before.lastIndexOf('\n') + 1);
      return {
        uri: file.srcPath,
        range: { start: { line, character: column }, end: { line, character: column + 1 } },
      };
    };

    // A full-screen Rectangle that ALSO dims (carries an opacity) is a dialog
    // backdrop. Both conditions are required: full-screen alone is a background,
    // and an opacity alone is any translucent decoration.
    //
    // Attribute values are matched in EITHER quote style. XML allows both, the
    // vendored components under `components/roku_modules/` are written in single
    // quotes, and a rule that only sees `width="1920"` is one keystroke from
    // being silently unenforceable.
    const attrValue = (name, value) => new RegExp(`${name}\\s*=\\s*(?:"${value}"|'${value}')`, 'i');
    const isFullScreen = (attrs) =>
      attrValue('width', SCREEN_WIDTH).test(attrs) &&
      attrValue('height', SCREEN_HEIGHT).test(attrs);
    const dims = (attrs) => attrValue('opacity', '[^"\']*').test(attrs);

    const elementPattern = /<Rectangle\b([^>]*)>/gi;
    let match;
    while ((match = elementPattern.exec(contents)) !== null) {
      const attrs = match[1];
      if (!isFullScreen(attrs)) continue;
      if (!dims(attrs)) continue;
      report(locate(match.index), 'This is a hand-rolled dimmed dialog backdrop.');
    }
  }

  /**
   * The mounting half — an overlay appended to the scene outside the helpers.
   *
   * Two passes PER FUNCTION, not one over the file. A direct
   * `appScene().appendChild(x)` is the easy shape; the one that actually
   * matters is `scene = appScene()` on one line and `scene.appendChild(x)` two
   * lines later, because that is the shape `presentOverlayDialog` itself is
   * written in — so it is what a developer copying the sanctioned reference
   * produces, and a rule blind to it would wave through every realistic
   * violation while catching only the naive one.
   *
   * Per function rather than per file so a local named `scene` in some
   * unrelated function cannot inherit the binding.
   */
  checkBrs(event, file) {
    const lines = (file.fileContents || '').split(/\r?\n/);
    const report = this.makeReporter(event, file, lines);
    const walkAll = { walkMode: brighterscript.WalkMode.visitAllRecursive };

    const checkFunctionBody = (body) => {
      if (!body?.walk) return;

      // Pass 1 — locals bound to the scene.
      const sceneLocals = new Set();
      body.walk(
        brighterscript.createVisitor({
          AssignmentStatement: (stmt) => {
            const name = stmt?.tokens?.name?.text;
            if (typeof name !== 'string') return;
            if (!isSceneExpression(stmt.value)) return;
            sceneLocals.add(name.toLowerCase());
          },
        }),
        walkAll,
      );

      // Pass 2 — appends onto the scene, however it was reached.
      body.walk(
        brighterscript.createVisitor({
          CallExpression: (call) => {
            const callee = call?.callee;
            if (!brighterscript.isDottedGetExpression(callee)) return;
            const method = callee.tokens?.name?.text?.toLowerCase();
            if (!CHILD_APPENDERS.has(method)) return;

            const target = callee.obj;
            const viaLocal =
              brighterscript.isVariableExpression(target) &&
              sceneLocals.has(target.tokens?.name?.text?.toLowerCase());
            if (!isSceneExpression(target) && !viaLocal) return;

            report(
              call.location,
              'This appends a node directly to the scene, which is how an overlay dialog is mounted by hand.',
            );
          },
        }),
        walkAll,
      );
    };

    file.parser.ast.walk(
      brighterscript.createVisitor({
        FunctionExpression: (func) => checkFunctionBody(func?.body),
      }),
      walkAll,
    );
  }
}

module.exports = () => new NoHandRolledDialogPlugin();

// Exported for the unit tests, which assert the predicates directly rather than
// standing up a whole BSC program for each case.
module.exports.ALLOWED_DEST_PATHS = ALLOWED_DEST_PATHS;
