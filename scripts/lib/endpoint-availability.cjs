// scripts/lib/endpoint-availability.cjs — loader + validator + matcher for the
// committed endpoint-availability registry (docs/dev/jellyfin-endpoint-availability.yml).
//
// The registry is the server-upgrade-automation pipeline's validated DISPOSITION
// LEDGER for post-floor endpoints (docs/architecture/server-upgrade-automation.md,
// Phase 6). The floor-coverage + symmetry checks in findings-candidates.js consume
// it to mark a known, handled post-floor endpoint `floor-known` (drop it out of the
// actionable set without suppressing it from the report). The validation lint
// (scripts/lint/endpoint-availability-check.cjs) cross-checks each entry's CODE
// claim against current source + the manifest, which is what keeps the ledger
// regression-safe rather than a blunt suppression.
//
// `.cjs` per scripts/CLAUDE.md's module rule (lib/ helpers are CJS so both the ESM
// findings-candidates.js — via createRequire — and the CJS lint can use it).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const REGISTRY_REL = 'docs/dev/jellyfin-endpoint-availability.yml';

// The handling strategies. version-guard + dispatch-sibling make a CODE claim the
// lint validates; sdk-dispatch + graceful-degradation are documented notes.
const HANDLING_TYPES = new Set([
  'version-guard',
  'dispatch-sibling',
  'sdk-dispatch',
  'graceful-degradation',
]);

const HTTP_METHODS = new Set(['GET', 'PUT', 'POST', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE']);

function isSemverBase(v) {
  return typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
}

// Normalize a spec/registry path to the manifest's `normalized` form: collapse
// every {placeholder} to {}, fold case, strip a trailing slash, ensure a leading
// slash. Mirrors normalizeSpecPath in findings-candidates.js / api-usage-manifest.js
// (each module re-implements it to stay decoupled — see those files' comments).
function normalizePath(p) {
  let s = (p.startsWith('/') ? p : '/' + p).replace(/\{[^}]*\}/g, '{}').toLowerCase();
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

// Split an entry's `method` field ("GET", "GET,POST", "GET POST", "*") into an
// uppercased set of verbs, or the wildcard marker '*'.
function parseMethods(method) {
  const raw = String(method ?? '').trim();
  if (raw === '*') return '*';
  return new Set(
    raw
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((m) => m.toUpperCase()),
  );
}

// Stable, human-readable id for citing an entry (path + method).
function entryId(entry) {
  return `${normalizePath(entry.path)} ${String(entry.method).toUpperCase()}`;
}

// Validate the parsed registry shape, throwing a one-line error on any violation.
// SCHEMA validation only — the source/manifest cross-checks live in the lint.
// Returns a normalized array of entries, each augmented with `normalizedPath` and
// `methodSet` (parsed) and a stable `id`.
function validateRegistry(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('endpoint-availability: registry is empty or not an object');
  }
  const endpoints = raw.endpoints ?? [];
  if (!Array.isArray(endpoints)) {
    throw new Error('endpoint-availability: "endpoints" must be a list');
  }

  const seen = new Set();
  return endpoints.map((entry, i) => {
    const where = `entry ${i}${entry && entry.path ? ` (${entry.path})` : ''}`;
    if (!entry || typeof entry !== 'object') {
      throw new Error(`endpoint-availability: ${where} is not an object`);
    }
    if (typeof entry.path !== 'string' || !entry.path.trim()) {
      throw new Error(`endpoint-availability: ${where} missing a string "path"`);
    }
    const methodSet = parseMethods(entry.method);
    if (methodSet !== '*') {
      if (methodSet.size === 0) {
        throw new Error(`endpoint-availability: ${where} missing a "method" (verb, list, or *)`);
      }
      for (const m of methodSet) {
        if (!HTTP_METHODS.has(m)) {
          throw new Error(`endpoint-availability: ${where} has unknown HTTP method "${m}"`);
        }
      }
    }
    if (entry.minServer != null && !isSemverBase(entry.minServer)) {
      throw new Error(
        `endpoint-availability: ${where} minServer must be MAJOR.MINOR.PATCH or null`,
      );
    }
    const h = entry.handling;
    if (!h || typeof h !== 'object') {
      throw new Error(`endpoint-availability: ${where} missing a "handling" object`);
    }
    if (!HANDLING_TYPES.has(h.type)) {
      throw new Error(
        `endpoint-availability: ${where} handling.type must be one of ${[...HANDLING_TYPES].join('/')}`,
      );
    }
    if (h.type === 'version-guard' && (typeof h.symbol !== 'string' || !h.symbol.trim())) {
      throw new Error(`endpoint-availability: ${where} version-guard handling requires a "symbol"`);
    }
    if (h.type === 'dispatch-sibling' && (typeof h.sibling !== 'string' || !h.sibling.trim())) {
      throw new Error(
        `endpoint-availability: ${where} dispatch-sibling handling requires a "sibling" path`,
      );
    }

    const id = entryId(entry);
    if (seen.has(id)) {
      throw new Error(`endpoint-availability: duplicate entry for ${id}`);
    }
    seen.add(id);

    return { ...entry, normalizedPath: normalizePath(entry.path), methodSet, id };
  });
}

// Load + validate the committed registry from a repo root. A MISSING file means
// "no registered endpoints" (an empty ledger is valid — the floor check then
// flags every post-floor endpoint, the pre-registry behavior).
function loadEndpointAvailability(rootDir = '.') {
  const file = path.join(rootDir, REGISTRY_REL);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return validateRegistry(yaml.load(raw));
}

// Does a validated entry cover a floor candidate? The candidate carries the
// manifest's normalized path and a (possibly comma-joined) method string. Match on
// normalized path AND method intersection (a '*' entry matches any verb).
function entryMatchesCandidate(entry, candidate) {
  const c = candidate.change ?? {};
  if (typeof c.path !== 'string') return false;
  if (normalizePath(c.path) !== entry.normalizedPath) return false;
  if (entry.methodSet === '*') return true;
  const candidateMethods = parseMethods(c.method ?? '');
  if (candidateMethods === '*' || candidateMethods.size === 0) return true; // path-level / UNKNOWN
  for (const m of candidateMethods) {
    if (entry.methodSet.has(m)) return true;
  }
  return false;
}

module.exports = {
  REGISTRY_REL,
  HANDLING_TYPES,
  normalizePath,
  parseMethods,
  entryId,
  validateRegistry,
  loadEndpointAvailability,
  entryMatchesCandidate,
};
