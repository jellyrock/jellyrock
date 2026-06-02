// Shared spec-path normalization for the server-upgrade-automation pipeline.
//
// Canonical home for normalizeSpecPath, consumed by BOTH phases of the pipeline:
//   - Phase 2 (scripts/generate/findings-candidates.js) — joins spec-diff paths
//     to the API-usage manifest's `normalized` form.
//   - Phase 3 (scripts/server-upgrade.js) — derives the version-independent
//     `findingKey` dedup identity.
//
// The two phases are deliberately decoupled (they communicate through the
// findings-candidates.json file on disk, not code imports), so a single shared
// helper is the only way to guarantee they normalize identically. A divergence
// would silently break dedup: Phase-3 finding keys would stop matching the
// Phase-2 paths they were derived from, filing every finding as a duplicate.
//
// Lives in scripts/lib/ as .cjs per scripts/CLAUDE.md (shared helpers are CJS;
// ESM callers import it fine — the reverse doesn't work).

// Collapse every {placeholder} to {}, fold case, strip a trailing slash, ensure
// a leading slash. Idempotent, so applying it to an already-normalized manifest
// path is a no-op. This is what makes the spec path (/Items/{itemId}) join to
// the manifest's `normalized` (/items/{}).
function normalizeSpecPath(p) {
  let s = (p.startsWith('/') ? p : '/' + p).replace(/\{[^}]*\}/g, '{}').toLowerCase();
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

module.exports = { normalizeSpecPath };
