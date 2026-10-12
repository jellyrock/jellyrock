// Shared spec-path normalization for the server-upgrade-automation pipeline.
//
// Canonical home for normalizeSpecPath, consumed by BOTH phases of the pipeline:
//   - Phase 2 (scripts/generate/findings-candidates.js): joins spec-diff paths
//     to the API-usage manifest's `normalized` form.
//   - Phase 3 (scripts/server-upgrade.js): derives the version-independent
//     `findingKey` dedup identity.
//
// The two phases are decoupled (they communicate through the
// findings-candidates-<from>..<to>.json report on disk, not code imports),
// so the shared helper keeps them on one rule. Phase 3 never compares a
// findingKey with a Phase-2 path: it matches keys only against keys it derives
// itself, and its GitHub dedup confirm reads the title's raw locator. The copy
// that must agree is the manifest's: api-usage-manifest.js keeps its own
// (normalizePath), as does lib/endpoint-availability.cjs, and a divergence
// there would break the Phase-2 join.
//
// Lives in scripts/lib/ as .cjs per scripts/CLAUDE.md (shared helpers are CJS;
// ESM callers can import it, while CJS cannot require an ESM module).

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
