/**
 * BrighterScript plugin: no direct favorite requests outside `favorites.request()`.
 *
 * A grid that shows favorites (the Favorites tab, the Favorites filter) is kept fresh by
 * `JRScene.favoritesVersion`: `favorites.request()` in `source/utils/favorites.bs` bumps it
 * when it builds the toggle, and `BaseGridView.favoritesStale()` reloads on resume or when
 * the options dialog closes. A toggle built with `GetApi().BuildMarkFavoriteRequest()` or
 * `BuildUnmarkFavoriteRequest()` directly bumps nothing, so a movie unfavorited on its
 * details screen stayed on the Favorites tab after Back.
 *
 * Allowed call sites:
 *  - `source/utils/favorites.bs`  (the helper)
 *  - `source/api/ApiClient.bs`    (where the builders are defined)
 *
 * Escape hatch:
 *  - `' bsc-disable-line no-direct-favorite-request` on the offending line, or
 *    `' bsc-disable-next-line no-direct-favorite-request` on the line above it.
 */
'use strict';

const brighterscript = require('brighterscript');

const ALLOWED_DEST_PATHS = new Set([
  'source/utils/favorites.bs',
  'source/utils/favorites.brs',
  'source/api/ApiClient.bs',
  'source/api/ApiClient.brs',
]);
const FLAGGED_CALLS = new Set(['buildmarkfavoriterequest', 'buildunmarkfavoriterequest']);
const DISABLE_LINE_MARKER = /'\s*bsc-disable-line\s+no-direct-favorite-request\b/i;
const DISABLE_NEXT_LINE_MARKER = /'\s*bsc-disable-next-line\s+no-direct-favorite-request\b/i;

class NoDirectFavoriteRequestPlugin {
  constructor() {
    this.name = 'jellyrock-no-direct-favorite-request';
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
          // Match: <anything>.BuildMarkFavoriteRequest(...) and the Unmark twin.
          const callee = call?.callee;
          if (!brighterscript.isDottedGetExpression(callee)) return;
          const fn = callee.tokens?.name?.text || '';
          if (!FLAGGED_CALLS.has(fn.toLowerCase())) return;

          const range = call?.location?.range;
          if (!range) return;
          const sourceLine = sourceLines[range.start.line] ?? '';
          if (DISABLE_LINE_MARKER.test(sourceLine)) return;
          const prevLine = range.start.line > 0 ? (sourceLines[range.start.line - 1] ?? '') : '';
          if (DISABLE_NEXT_LINE_MARKER.test(prevLine)) return;

          event.program.diagnostics.register({
            code: 'no-direct-favorite-request',
            severity: 1, // Error
            source: this.name,
            message: `Direct call to '${fn}(...)' skips the favorites bump. Call favorites.request(itemId, isFavorite, m.top.getScene()) so the grids showing favorites learn the list changed. Add ' bsc-disable-line no-direct-favorite-request to suppress.`,
            location: call.location,
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

module.exports = () => new NoDirectFavoriteRequestPlugin();
