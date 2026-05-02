// Shared frontmatter / path-matching helpers used by docs tooling.
//
// Callers: docs-stale-blocking.cjs, check-touched-related-files.cjs.
// (docs-check.cjs and docs-stale.cjs predate this lib and continue to use
// their own inlined parsers; if either gets a bug fix here that they need,
// migrate them at that point rather than touching them speculatively.)
//
// Keep this module dependency-free (Node stdlib only) — the docs tooling
// runs in CI without `npm ci`.

'use strict';

const fs = require('fs');

/**
 * Extracts the YAML frontmatter block (between the leading `---` fences)
 * from a markdown document. Returns the raw string between the fences, or
 * null if no frontmatter is present.
 */
function readFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return match ? match[1] : null;
}

/**
 * Reads the `last-reviewed:` ISO date (YYYY-MM-DD) from a frontmatter
 * string, or null if absent / malformed.
 */
function getLastReviewed(frontmatter) {
  if (!frontmatter) return null;
  const m = frontmatter.match(/^last-reviewed:\s*(\d{4}-\d{2}-\d{2})/m);
  return m ? m[1] : null;
}

/**
 * Parses the `related-files:` list from a frontmatter string. Supports both
 * the empty-array literal (`related-files: []`) and the multi-line form:
 *
 *     related-files:
 *       - path/one.bs
 *       - path/two.bs
 *
 * Returns an array of entries (file or directory paths) — never null.
 */
function parseRelatedFiles(frontmatter) {
  if (!frontmatter) return [];
  if (/^related-files:\s*\[\s*\]/m.test(frontmatter)) return [];

  const lines = frontmatter.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => /^related-files:\s*$/.test(l));
  if (startIdx === -1) return [];

  const items = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s+-\s+(.+?)\s*$/);
    if (m) {
      items.push(m[1]);
      continue;
    }
    if (/^\S/.test(line)) break; // hit the next top-level frontmatter key
  }
  return items;
}

/**
 * True when a touched path matches a related-files entry. Exact-string
 * match for files; prefix match for directories (when `related` exists on
 * disk and is a directory).
 *
 * If `related` doesn't exist on disk, only an exact match counts. That
 * lets stale entries (e.g., a related-file that was renamed) silently
 * stop matching here — drift detection is `lint:docs`'s job, not ours.
 */
function pathMatches(touched, related) {
  if (touched === related) return true;
  try {
    const stat = fs.statSync(related);
    if (stat.isDirectory()) {
      const prefix = related.endsWith('/') ? related : related + '/';
      return touched.startsWith(prefix);
    }
  } catch {
    // entry not on disk — exact-only behavior above
  }
  return false;
}

module.exports = {
  readFrontmatter,
  getLastReviewed,
  parseRelatedFiles,
  pathMatches,
};
