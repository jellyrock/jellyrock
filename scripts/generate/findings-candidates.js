// Phase 2 (join + classify) of the server-upgrade-automation pipeline
// (docs/architecture/server-upgrade-automation.md). Produces the DATA REPORT —
// findings-candidates.json — that the Phase 3 agent (the /server-upgrade skill)
// investigates.
//
// This is the deterministic seam: the script never decides "is this a real
// problem", only "here is every spec change that intersects code JellyRock
// actually ships, with full provenance". It does three things:
//
//   1. FORWARD check (acknowledged → latest delta): intersect the spec-diff
//      with the API-usage manifest. A change is a breaking candidate only when
//      the app uses the affected endpoint/field AND the endpoint's apiVersion
//      tier range includes the tier the change lands in. Endpoints pinned to a
//      frozen tier self-exclude (frozen-tier immunity falls out of range math —
//      no allowlist), and new endpoints the app doesn't use yet surface as
//      opportunities.
//   2. BACKWARD floor-coverage check (manifest → 10.7.0): for every endpoint
//      whose range includes the floor tier, flag a coverage-gap if it's absent
//      from the floor spec — i.e. we call something the oldest supported server
//      lacks, with no dispatch/guard. (Modern-only endpoints, minApiVersion > 1,
//      are intentionally NOT flagged here — that's the symmetry check's job.)
//   3. COVERAGE-SYMMETRY advisory (Phase 5; manifest → 10.7.0): the mirror image
//      of the backward check. For every MODERN-ONLY endpoint (range excludes the
//      floor tier) whose operation IS present in the floor spec, flag a
//      symmetry-advisory — the oldest supported server serves the endpoint yet
//      the app wires it for the modern tier only, which is plausibly a missing
//      low-tier fallback (or, the common case, the app reaches the same
//      capability on the floor via a different V1 sibling the manifest doesn't
//      link — the agent dispositions which). Genuinely modern-only endpoints
//      (absent from the floor) are NOT flagged: nothing to be asymmetric against.
//   4. SUPPRESSION: .api-watch/suppressions.yml rules flag accepted churn. A
//      suppressed candidate stays in the report (`suppressed: true`) so nothing
//      silently vanishes — it's just marked not-to-investigate.
//
// CRITICAL carry-forward lesson (manifest coverage.knownGaps): the manifest join
// MUST be case-insensitive on field names — the app sends PascalCase, the spec
// defines camelCase. The diff deliberately preserved spec casing because
// case-folding is THIS step's job. Endpoint paths are joined via the manifest's
// `normalized` form (this script mirrors the manifest's normalizePath exactly).
//
// Anchor strategy (Phase 1 left this open; decided here): the join reads
// COMMITTED fingerprints for from/to/floor and computes the forward diff
// in-process via the already-exported diffFingerprints(). "Fetch latest + commit
// its fingerprint" stays the existing separate step (spec-fingerprint.js
// <version>). That keeps Phase 2 a pure, offline, deterministic, fully-testable
// transform, consistent with spec-diff.js.
//
// CLI:
//   node scripts/generate/findings-candidates.js <fromVersion> <toVersion>
//        [--floor <version>] [--root <dir>] [--manifest <path>] [--fetch]
//        [--no-opportunities] [--stdout]
//     <toVersion> may be a stable (10.11.10), an RC (10.12.0-rc1), an unstable
//       datestamp (20240402201942), or the literal `unstable`/`master` — which
//       resolves to the latest immutable master build. Pre-release `to` versions
//       have no committed fingerprint, so pair them with --fetch.
//     → read the committed from/to/floor fingerprints + the API-usage manifest,
//       build the report, write the gitignored
//       .api-watch/cache/findings-candidates-<from>..<to>.json
//   ... --stdout    → print the report JSON to stdout instead of writing the cache
//   ... --fetch     → DRY-RUN: for any version with no committed fingerprint, build
//                     one in-memory from the fetched spec (network) instead of
//                     erroring — preview the full report for a brand-new release
//                     without committing its fingerprint (the same ephemeral path
//                     the Phase-4 tracker uses; nothing is written to the tree).
//   ... --manifest <path> → use an explicit manifest instead of the committed one
//                     (what-if / historical simulation; production uses committed).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { diffFingerprints } from './spec-diff.js';
import { buildFingerprint } from './spec-fingerprint.js';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const { loadBoundaries, serverToTier } = require('../lib/version-boundaries.cjs');
const { fetchSpec } = require('../lib/spec-fetch.cjs');
const { fetchLatestUnstable } = require('../lib/signals-fetch.cjs');
const {
  loadEndpointAvailability,
  entryMatchesCandidate,
} = require('../lib/endpoint-availability.cjs');

const SCHEMA_VERSION = 1;
const GENERATOR = 'scripts/generate/findings-candidates.js';
const FINGERPRINT_DIR_REL = 'docs/architecture/spec-fingerprints';
const MANIFEST_REL = 'docs/architecture/api-usage-manifest.json';
const SUPPRESSIONS_REL = '.api-watch/suppressions.yml';
const CACHE_DIR_REL = '.api-watch/cache';

const HTTP_METHODS = new Set(['GET', 'PUT', 'POST', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE']);

// Diff kinds that are contract regressions for a hand-written client.
const BREAKING_KINDS = new Set([
  'endpoint-removed',
  'param-removed',
  'param-changed',
  'requestbody-changed',
  'response-changed',
  'field-removed',
  'field-retyped',
  'enum-changed',
]);
// Purely additive kinds on a used surface: non-breaking, and not a whole-new
// capability either — dropped (counted) rather than reported as findings.
const ADDITIVE_KINDS = new Set(['param-added', 'field-added']);

// Mechanical first guess at severity. The agent overrides per finding.
const SEVERITY_GUESS = {
  'endpoint-removed': 'high',
  'response-changed': 'high',
  'requestbody-changed': 'medium',
  'param-removed': 'medium',
  'param-changed': 'medium',
  'field-removed': 'medium',
  'field-retyped': 'low',
  'enum-changed': 'medium',
  'endpoint-added': 'low', // opportunity
  'coverage-gap': 'high',
  'coverage-symmetry': 'low', // advisory — agent confirms whether a V1 sibling covers the floor
};

// ── Path normalization (mirrors api-usage-manifest.js normalizePath) ─────────

// Collapse every {placeholder} to {}, fold case, strip a trailing slash, ensure
// a leading slash. Idempotent, so applying it to an already-normalized manifest
// path is a no-op. This is what makes the spec path (/Items/{itemId}) join to
// the manifest's `normalized` (/items/{}).
export function normalizeSpecPath(p) {
  let s = (p.startsWith('/') ? p : '/' + p).replace(/\{[^}]*\}/g, '{}').toLowerCase();
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

const opKey = (normalizedPath, method) => `${normalizedPath} ${method.toUpperCase()}`;

// ── Manifest indexes ─────────────────────────────────────────────────────────

// Index the manifest endpoints by normalized-path + method so a diff change can
// resolve its exact apiVersion range (the same normalized path can appear under
// several entries with different methods AND ranges — e.g. /items/{} has a
// V1 DELETE and a V2 GET). Also keep a normalized-path set for the backward
// check's path-level fallback.
export function buildEndpointIndex(manifest) {
  const byOp = new Map();
  const byPath = new Map(); // normalized path → [endpoint, …] (for fallback)
  for (const ep of manifest.endpoints ?? []) {
    const norm = ep.normalized;
    if (!byPath.has(norm)) byPath.set(norm, []);
    byPath.get(norm).push(ep);
    for (const method of ep.methods ?? []) {
      byOp.set(opKey(norm, method), ep);
    }
  }
  return { byOp, byPath };
}

// Index request + response field usage by LOWERCASED name — the case-insensitive
// join that bridges the app's PascalCase to the spec's camelCase. A name may be
// both a request and a response field; we union the source files.
export function buildFieldIndex(manifest) {
  const byName = new Map();
  const add = (name, sourceFiles) => {
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { name, sites: new Set() });
    for (const f of sourceFiles ?? []) byName.get(key).sites.add(f);
  };
  for (const f of manifest.requestFields ?? []) add(f.name, f.sourceFiles);
  for (const f of manifest.responseFields ?? []) add(f.name, f.sourceFiles);
  return byName;
}

// ── Classification helpers ───────────────────────────────────────────────────

function rangeIncludes(min, max, tier) {
  if (tier == null) return false;
  return min <= tier && (max == null || tier <= max);
}

const isOperationChange = (c) => typeof c.path === 'string' && typeof c.method === 'string';
const isSchemaChange = (c) => typeof c.schema === 'string';

// Resolve the manifest endpoint a forward operation-change touches. Falls back
// to a method recorded as UNKNOWN (the manifest couldn't statically resolve the
// verb but the app does hit the path).
function resolveEndpoint(change, endpointIndex) {
  const norm = normalizeSpecPath(change.path);
  return (
    endpointIndex.byOp.get(opKey(norm, change.method)) ??
    endpointIndex.byOp.get(opKey(norm, 'UNKNOWN')) ??
    null
  );
}

// ── Forward check ────────────────────────────────────────────────────────────

// Intersect the forward diff with the manifest. Returns
// { candidates, dropped: { unused, additive } }.
export function forwardFindings(diff, manifest, boundaries, { emitOpportunities = true } = {}) {
  const endpointIndex = buildEndpointIndex(manifest);
  const fieldIndex = buildFieldIndex(manifest);
  const changeTier = serverToTier(boundaries, diff.toVersion);

  const candidates = [];
  const dropped = { unused: 0, additive: 0 };

  for (const change of diff.changes) {
    if (isOperationChange(change)) {
      const ep = resolveEndpoint(change, endpointIndex);

      if (change.kind === 'endpoint-added') {
        // A new endpoint we don't already use is an opportunity; one we already
        // call is just now-official — no action.
        if (ep || !emitOpportunities) {
          dropped.unused++;
          continue;
        }
        candidates.push(makeOpportunity(change));
        continue;
      }

      if (ADDITIVE_KINDS.has(change.kind)) {
        dropped.additive++;
        continue;
      }
      if (!BREAKING_KINDS.has(change.kind) || !ep) {
        dropped.unused++;
        continue;
      }

      const includes = rangeIncludes(ep.minApiVersion, ep.maxApiVersion, changeTier);
      candidates.push({
        type: 'breaking',
        change,
        appUsage: {
          used: true,
          apiVersionRange: [ep.minApiVersion, ep.maxApiVersion],
          sites: [...(ep.sourceFiles ?? [])],
        },
        relevance: includes ? 'active-tier' : 'frozen-skip',
        severityGuess: SEVERITY_GUESS[change.kind] ?? 'medium',
        needsInvestigation: includes,
        suppressed: false,
      });
      continue;
    }

    if (isSchemaChange(change)) {
      // field-added is additive (the app cannot already read a field that did
      // not exist), so it never joins — drop it explicitly for a clean count.
      if (change.kind === 'field-added') {
        dropped.additive++;
        continue;
      }
      // Join on the field name for field-*; for enum-changed there is no field
      // name, so join the enum's schema name against consumed field names (e.g.
      // a `MediaType` enum ↔ the `MediaType` response field the app reads).
      const lookupName = change.kind === 'enum-changed' ? change.schema : change.name;
      const hit = lookupName ? fieldIndex.get(lookupName.toLowerCase()) : null;
      if (!BREAKING_KINDS.has(change.kind) || !hit) {
        dropped.unused++;
        continue;
      }
      candidates.push({
        type: 'breaking',
        change,
        appUsage: {
          used: true,
          apiVersionRange: null, // DTO fields are not tier-scoped
          sites: [...hit.sites],
        },
        relevance: 'active-tier',
        severityGuess: SEVERITY_GUESS[change.kind] ?? 'medium',
        needsInvestigation: true,
        suppressed: false,
      });
      continue;
    }

    dropped.unused++;
  }

  return { candidates, dropped };
}

function makeOpportunity(change) {
  return {
    type: 'opportunity',
    change,
    appUsage: { used: false, apiVersionRange: null, sites: [] },
    relevance: 'active-tier',
    severityGuess: SEVERITY_GUESS['endpoint-added'],
    needsInvestigation: true,
    suppressed: false,
  };
}

// ── Backward floor-coverage check ──────────────────────────────────────────────

// Build the floor spec's presence sets from its committed fingerprint.
function floorPresence(floorFp) {
  const ops = new Set();
  const paths = new Set();
  for (const key of Object.keys(floorFp.operations ?? {})) {
    const sp = key.indexOf(' ');
    const method = key.slice(0, sp);
    const norm = normalizeSpecPath(key.slice(sp + 1));
    ops.add(opKey(norm, method));
    paths.add(norm);
  }
  return { ops, paths };
}

// For every manifest endpoint whose apiVersion range includes the floor tier,
// flag a coverage-gap when it is absent from the floor spec. Modern-only
// endpoints (range excludes the floor tier) are intentionally skipped.
export function backwardFindings(manifest, floorFp, boundaries) {
  const floorTier = serverToTier(boundaries, floorFp.specVersion);
  const { ops, paths } = floorPresence(floorFp);
  const candidates = [];

  for (const ep of manifest.endpoints ?? []) {
    if (!rangeIncludes(ep.minApiVersion, ep.maxApiVersion, floorTier)) continue;

    const norm = ep.normalized;
    let detail;
    if (!paths.has(norm)) {
      detail = `path absent from floor spec ${floorFp.specVersion}`;
    } else {
      // Path exists; check the concrete methods. UNKNOWN is satisfied by
      // path-level presence (we can't pin the verb statically).
      const missing = (ep.methods ?? []).filter(
        (m) => HTTP_METHODS.has(m.toUpperCase()) && !ops.has(opKey(norm, m)),
      );
      if (missing.length === 0) continue;
      detail = `method(s) ${missing.join(', ')} absent from floor spec ${floorFp.specVersion}`;
    }

    candidates.push({
      type: 'coverage-gap',
      change: {
        kind: 'coverage-gap',
        path: norm,
        method: (ep.methods ?? []).join(','),
        detail: `${ep.path}: ${detail}`,
        fromVersion: floorFp.specVersion,
        toVersion: null,
      },
      appUsage: {
        used: true,
        apiVersionRange: [ep.minApiVersion, ep.maxApiVersion],
        sites: [...(ep.sourceFiles ?? [])],
      },
      relevance: 'floor-coverage',
      severityGuess: SEVERITY_GUESS['coverage-gap'],
      needsInvestigation: true,
      suppressed: false,
    });
  }

  return candidates;
}

// ── Coverage-symmetry advisory (Phase 5) ───────────────────────────────────────

// The mirror image of the backward floor-coverage check. backwardFindings owns
// the floor-INCLUDED endpoints (range includes the floor tier) and flags the ones
// ABSENT from the floor spec (we call something old servers lack). This owns the
// EXACT COMPLEMENT — the floor-EXCLUDED (modern-only) endpoints — and flags the
// ones PRESENT in the floor spec: the oldest supported server serves the endpoint,
// yet the app wires it for the modern tier only. That asymmetry is plausibly a
// missing low-tier fallback... or (the common case on JellyRock today) the app
// reaches the same capability on the floor via a different V1 sibling endpoint the
// manifest doesn't link to this one — a dispatch pair like /Items/{} (V2) vs
// /Users/{}/Items/{} (V1). The agent dispositions which, exactly as it dispositions
// the backward check's capability-guard coverage-gaps.
//
// Genuinely modern-only endpoints (absent from the floor spec — a real 10.9+ feature)
// are NOT flagged: there is nothing on the floor to be asymmetric against. This is
// what "accounting for intentionally-modern-only guarded features" means mechanically.
//
// PARTITION GUARANTEE vs the backward check: both branch on the same predicate,
// rangeIncludes(min, max, floorTier). backwardFindings handles `true`; this handles
// `false`. A given endpoint can therefore be a coverage-gap OR a symmetry-advisory,
// never both — no double-report, by construction.
export function symmetryFindings(manifest, floorFp, boundaries) {
  const floorTier = serverToTier(boundaries, floorFp.specVersion);
  const { ops, paths } = floorPresence(floorFp);
  const candidates = [];

  for (const ep of manifest.endpoints ?? []) {
    // Exact complement of the backward check: only floor-EXCLUDED (modern-only)
    // endpoints are symmetry candidates.
    if (rangeIncludes(ep.minApiVersion, ep.maxApiVersion, floorTier)) continue;

    const norm = ep.normalized;
    // Which of the app's concrete methods does the floor server already serve? For
    // a statically-resolved HTTP verb that's per-operation presence; an UNKNOWN
    // verb (couldn't pin the method) falls back to path-level presence, mirroring
    // the backward check's UNKNOWN handling.
    const present = (ep.methods ?? []).filter((m) =>
      HTTP_METHODS.has(m.toUpperCase()) ? ops.has(opKey(norm, m)) : paths.has(norm),
    );
    if (present.length === 0) continue; // genuinely modern-only — nothing to mirror

    candidates.push({
      type: 'symmetry-advisory',
      change: {
        kind: 'coverage-symmetry',
        path: norm,
        method: present.join(','),
        detail:
          `${ep.path}: method(s) ${present.join(', ')} present on floor spec ` +
          `${floorFp.specVersion} but endpoint wired tier ≥${ep.minApiVersion} only — ` +
          `confirm a lower-tier sibling/fallback covers the floor`,
        fromVersion: floorFp.specVersion,
        toVersion: null,
      },
      appUsage: {
        used: true,
        apiVersionRange: [ep.minApiVersion, ep.maxApiVersion],
        sites: [...(ep.sourceFiles ?? [])],
      },
      relevance: 'floor-symmetry',
      severityGuess: SEVERITY_GUESS['coverage-symmetry'],
      needsInvestigation: true,
      suppressed: false,
    });
  }

  return candidates;
}

// ── Suppression ────────────────────────────────────────────────────────────────

// Does a candidate bind to a rule? ALL predicates the rule provides must match;
// omitted predicates are wildcards. A predicate that references a field the
// change doesn't carry (e.g. `schema` on an operation change) does NOT match.
export function matchSuppression(candidate, rule) {
  const m = rule.match ?? {};
  const c = candidate.change;

  if (m.kind != null) {
    const kinds = Array.isArray(m.kind) ? m.kind : [m.kind];
    if (!kinds.includes(c.kind)) return false;
  }
  if (m.path != null) {
    if (typeof c.path !== 'string') return false;
    if (!new RegExp(m.path).test(normalizeSpecPath(c.path))) return false;
  }
  if (m.method != null) {
    if (typeof c.method !== 'string') return false;
    if (c.method.toUpperCase() !== String(m.method).toUpperCase()) return false;
  }
  if (m.schema != null) {
    if (typeof c.schema !== 'string') return false;
    if (!new RegExp(m.schema).test(c.schema)) return false;
  }
  if (m.name != null) {
    if (typeof c.name !== 'string') return false;
    if (!new RegExp(m.name, 'i').test(c.name)) return false;
  }
  return true;
}

// Mark suppressed candidates in place (first-match-wins). Suppressed candidates
// stay in the report but are forced needsInvestigation:false and carry the
// matched rule id in `suppressedBy`.
export function applySuppressions(candidates, rules) {
  for (const candidate of candidates) {
    for (const rule of rules ?? []) {
      if (matchSuppression(candidate, rule)) {
        candidate.suppressed = true;
        candidate.suppressedBy = rule.id;
        candidate.needsInvestigation = false;
        break;
      }
    }
  }
  return candidates;
}

// ── Endpoint-availability ledger (Phase 6) ──────────────────────────────────────

// Mark FLOOR findings (coverage-gap / symmetry-advisory) whose endpoint is a known,
// handled post-floor endpoint per the committed registry
// (docs/dev/jellyfin-endpoint-availability.yml). A matched candidate becomes
// `relevance: floor-known`, `needsInvestigation: false`, and carries the handling
// disposition in `floorHandling` — it stays in the report as an audit trail but
// drops out of the actionable set (mirrors applySuppressions, but it's a distinct,
// version-semantic concept and stays `suppressed: false`).
//
// This is what makes the recurring floor noise self-resolve: the V1/V2 tier model
// can't express sub-tier introduction versions (MediaSegments@10.10, Lyrics@10.9),
// so without the ledger every such endpoint flags on every run. Registering one
// records WHY its floor-absence is expected; the lint validates the code claim, so
// it's regression-safe, not a blunt mute. An UNREGISTERED post-floor endpoint keeps
// flagging needsInvestigation — the spec-derived floor check is the comprehensive
// enumerator, so a new one can't hide.
export function applyFloorAvailability(candidates, registry) {
  for (const candidate of candidates) {
    if (candidate.type !== 'coverage-gap' && candidate.type !== 'symmetry-advisory') continue;
    for (const entry of registry ?? []) {
      if (entryMatchesCandidate(entry, candidate)) {
        candidate.relevance = 'floor-known';
        candidate.needsInvestigation = false;
        candidate.floorHandling = {
          entry: entry.id,
          minServer: entry.minServer ?? null,
          type: entry.handling.type,
          symbol: entry.handling.symbol ?? null,
          sibling: entry.handling.sibling ?? null,
          note: entry.handling.note ?? null,
        };
        break;
      }
    }
  }
  return candidates;
}

// ── Report assembly ──────────────────────────────────────────────────────────

// Stable order: type, then the change's locator, then detail.
function candidateSortKey(c) {
  const ch = c.change;
  return [
    c.type,
    ch.schema ?? '',
    ch.path ?? '',
    ch.method ?? '',
    ch.name ?? '',
    ch.detail ?? '',
  ].join(' ');
}

// Pure: build the whole report from already-loaded inputs.
export function buildReport(
  { fromFp, toFp, floorFp, manifest, boundaries, rules = [], availability = [] },
  { emitOpportunities = true } = {},
) {
  const diff = diffFingerprints(fromFp, toFp);
  const forward = forwardFindings(diff, manifest, boundaries, { emitOpportunities });
  const backward = backwardFindings(manifest, floorFp, boundaries);
  const symmetry = symmetryFindings(manifest, floorFp, boundaries);

  const candidates = [...forward.candidates, ...backward, ...symmetry];
  applySuppressions(candidates, rules);
  // Resolve known, handled post-floor endpoints (floor-known) AFTER suppression so
  // an explicit suppression still wins; both force needsInvestigation:false.
  applyFloorAvailability(candidates, availability);
  candidates.sort((a, b) => candidateSortKey(a).localeCompare(candidateSortKey(b)));

  return {
    schemaVersion: SCHEMA_VERSION,
    generator: GENERATOR,
    fromVersion: diff.fromVersion,
    toVersion: diff.toVersion,
    floorVersion: floorFp.specVersion ?? null,
    counts: summarize(candidates, forward.dropped, diff),
    candidates,
  };
}

function summarize(candidates, dropped, diff) {
  const counts = {
    total: candidates.length,
    breaking: 0,
    opportunity: 0,
    'coverage-gap': 0,
    'symmetry-advisory': 0,
    suppressed: 0,
    floorKnown: 0,
    frozenSkip: 0,
    needsInvestigation: 0,
    droppedUnusedChanges: dropped.unused,
    droppedAdditiveChanges: dropped.additive,
    forwardDiffChanges: diff.counts?.total ?? diff.changes.length,
  };
  for (const c of candidates) {
    counts[c.type] = (counts[c.type] ?? 0) + 1;
    if (c.suppressed) counts.suppressed++;
    if (c.relevance === 'floor-known') counts.floorKnown++;
    if (c.relevance === 'frozen-skip') counts.frozenSkip++;
    if (c.needsInvestigation) counts.needsInvestigation++;
  }
  return counts;
}

export function serializeReport(report) {
  return JSON.stringify(report, null, 2) + '\n';
}

// ── CLI ────────────────────────────────────────────────────────────────────────

function fingerprintPath(rootDir, version) {
  return path.join(rootDir, FINGERPRINT_DIR_REL, `jellyfin-${version}.json`);
}

// Exported (alongside readManifest / readSuppressions) so the Phase-4 proactive
// CI tracker (scripts/server-upgrade-tracker.js) can reuse the exact committed-
// input readers — it computes counts from the same from/floor fingerprints +
// manifest + suppressions, only swapping in an EPHEMERAL in-memory `to`
// fingerprint instead of a committed one.
export function readFingerprint(rootDir, version) {
  try {
    return JSON.parse(readFileSync(fingerprintPath(rootDir, version), 'utf8'));
  } catch {
    throw new Error(
      `findings-candidates: no committed fingerprint for ${version} ` +
        `(expected ${FINGERPRINT_DIR_REL}/jellyfin-${version}.json — run docs:spec-fingerprints).`,
    );
  }
}

export function readManifest(rootDir) {
  try {
    return JSON.parse(readFileSync(path.join(rootDir, MANIFEST_REL), 'utf8'));
  } catch {
    throw new Error(`findings-candidates: cannot read ${MANIFEST_REL} (run docs:api-manifest).`);
  }
}

// Read a manifest from an EXPLICIT path (the --manifest override). For what-if /
// historical simulations (e.g. reconstructing a pre-V2-split manifest) — in
// production you always want the committed manifest (current code).
export function readManifestFrom(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error(`findings-candidates: cannot read manifest at ${filePath}`);
  }
}

// Resolve a version's fingerprint for the report. PREFER the committed anchor
// (it's the reviewed one). With { fetch:true } and no committed fingerprint, fall
// back to building one IN-MEMORY from the fetched spec — the same ephemeral path
// the Phase-4 tracker uses — so a maintainer can DRY-RUN the full report for any
// upstream version (e.g. preview a brand-new release) without first committing
// its fingerprint. Nothing is written to the committed tree; only the gitignored
// raw-spec cache is populated by fetchSpec.
export async function resolveFingerprint(rootDir, version, { fetch = false } = {}) {
  if (existsSync(fingerprintPath(rootDir, version)) || !fetch) {
    return readFingerprint(rootDir, version); // committed → read; missing + !fetch → helpful throw
  }
  const spec = await fetchSpec(version, { rootDir });
  return buildFingerprint(spec, { specVersion: version });
}

// Read + parse the committed suppression rules. A missing file means "no
// suppressions" (the rules array is optional infrastructure).
export function readSuppressions(rootDir) {
  const file = path.join(rootDir, SUPPRESSIONS_REL);
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const parsed = yaml.load(raw);
  const rules = parsed?.rules ?? [];
  if (!Array.isArray(rules)) {
    throw new Error(`findings-candidates: ${SUPPRESSIONS_REL} "rules" must be a list.`);
  }
  return rules;
}

// Read + validate the committed endpoint-availability registry (Phase 6). Exported
// alongside the other committed-input readers so the Phase-4 tracker reuses the
// exact same ledger when it computes counts ephemerally. A missing file → [].
export function readAvailability(rootDir) {
  return loadEndpointAvailability(rootDir);
}

async function main() {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const rootDir = rootIdx >= 0 ? args[rootIdx + 1] : '.';
  const floorIdx = args.indexOf('--floor');
  const floorArg = floorIdx >= 0 ? args[floorIdx + 1] : null;
  const manifestIdx = args.indexOf('--manifest');
  const manifestArg = manifestIdx >= 0 ? args[manifestIdx + 1] : null;
  const toStdout = args.includes('--stdout');
  const fetchMissing = args.includes('--fetch');
  const emitOpportunities = !args.includes('--no-opportunities');
  const consumed = new Set([rootIdx + 1, floorIdx + 1, manifestIdx + 1].filter((i) => i > 0));
  const positional = args.filter((a, i) => !a.startsWith('--') && !consumed.has(i));
  const [fromVersion, toArg] = positional;

  // The `unstable`/`master` convenience token resolves to the latest IMMUTABLE
  // datestamped master build (re-diffable + reproducible) — never the mutable
  // /openapi/ root pointer. The resolved datestamp becomes `toVersion`, so it lands
  // in the report + cache filename and can be reused as the next `<from>`.
  let toVersion = toArg;
  if (toArg === 'unstable' || toArg === 'master') {
    toVersion = await fetchLatestUnstable();
    console.error(`findings-candidates: resolved ${toArg} → ${toVersion} (latest master build)`);
  }

  if (!fromVersion || !toVersion) {
    console.error(
      'usage: node scripts/generate/findings-candidates.js <fromVersion> <toVersion> ' +
        '[--floor <version>] [--root <dir>] [--manifest <path>] [--fetch] ' +
        '[--no-opportunities] [--stdout]\n' +
        '  <toVersion> accepts a stable/RC version, an unstable datestamp, or the ' +
        'literal `unstable`/`master` (pair pre-release versions with --fetch).',
    );
    process.exit(1);
  }

  const boundaries = loadBoundaries(rootDir);
  const floorVersion = floorArg ?? boundaries.floor;

  const report = buildReport(
    {
      fromFp: await resolveFingerprint(rootDir, fromVersion, { fetch: fetchMissing }),
      toFp: await resolveFingerprint(rootDir, toVersion, { fetch: fetchMissing }),
      floorFp: await resolveFingerprint(rootDir, floorVersion, { fetch: fetchMissing }),
      manifest: manifestArg ? readManifestFrom(manifestArg) : readManifest(rootDir),
      boundaries,
      rules: readSuppressions(rootDir),
      availability: readAvailability(rootDir),
    },
    { emitOpportunities },
  );
  const serialized = serializeReport(report);

  if (toStdout) {
    // Return rather than process.exit(0): a large report can exceed the pipe
    // buffer, and exiting before stdout drains would truncate it. Letting main()
    // return ends the process naturally once the write flushes (exit code 0).
    process.stdout.write(serialized);
    return;
  }

  const outRel = path.join(CACHE_DIR_REL, `findings-candidates-${fromVersion}..${toVersion}.json`);
  const outPath = path.join(rootDir, outRel);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, serialized, 'utf8');

  const c = report.counts;
  console.log(
    `findings-candidates: ${fromVersion} → ${toVersion} (floor ${floorVersion}): ` +
      `${c.total} candidates (${c.breaking} breaking, ${c['coverage-gap']} coverage-gap, ` +
      `${c['symmetry-advisory']} symmetry, ${c.opportunity} opportunity; ` +
      `${c.needsInvestigation} to investigate, ${c.floorKnown} floor-known, ` +
      `${c.suppressed} suppressed) → ${outRel}`,
  );
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(`findings-candidates: ${err.message}`);
    process.exit(1);
  });
}
