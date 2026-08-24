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
 *      by hand. The helpers in `source/utils/dialogs.bs` are the only path that
 *      stamps the shared overlay id, so a hand-rolled append is invisible to
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
 *   - Vendored third-party code.
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
    const elementPattern = /<Rectangle\b([^>]*)>/gi;
    let match;
    while ((match = elementPattern.exec(contents)) !== null) {
      const attrs = match[1];
      const isFullScreen =
        new RegExp(`width\\s*=\\s*"${SCREEN_WIDTH}"`, 'i').test(attrs) &&
        new RegExp(`height\\s*=\\s*"${SCREEN_HEIGHT}"`, 'i').test(attrs);
      if (!isFullScreen) continue;
      if (!/opacity\s*=\s*"/i.test(attrs)) continue;
      report(locate(match.index), 'This is a hand-rolled dimmed dialog backdrop.');
    }
  }

  /** The mounting half — an overlay appended to the scene outside the helpers. */
  checkBrs(event, file) {
    const lines = (file.fileContents || '').split(/\r?\n/);
    const report = this.makeReporter(event, file, lines);

    const visitor = brighterscript.createVisitor({
      CallExpression: (call) => {
        const callee = call?.callee;
        if (!brighterscript.isDottedGetExpression(callee)) return;
        const method = callee.tokens?.name?.text?.toLowerCase();
        if (!CHILD_APPENDERS.has(method)) return;
        if (!isSceneExpression(callee.obj)) return;
        report(
          call.location,
          'This appends a node directly to the scene, which is how an overlay dialog is mounted by hand.',
        );
      },
    });

    file.parser.ast.walk(visitor, { walkMode: brighterscript.WalkMode.visitAllRecursive });
  }
}

module.exports = () => new NoHandRolledDialogPlugin();

// Exported for the unit tests, which assert the predicates directly rather than
// standing up a whole BSC program for each case.
module.exports.ALLOWED_DEST_PATHS = ALLOWED_DEST_PATHS;
