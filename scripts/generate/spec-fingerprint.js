// Generates committed Jellyfin OpenAPI "fingerprints" under
// docs/architecture/spec-fingerprints/ — the reduced structural surface of a
// spec (paths, methods, parameters, request/response shapes, schema properties,
// enum values) with all descriptions / summaries / examples STRIPPED.
//
// Why this exists (server-upgrade-automation Phase 1, supply step): a raw spec
// is ~2 MB and Jellyfin regenerates it every release, so a byte-diff of two raw
// specs is dominated by cosmetic churn (reordered keys, reworded descriptions,
// schema refactors). The fingerprint keeps only what can actually break a
// hand-written client and throws away the rest, so a diff of two fingerprints
// (scripts/generate/spec-diff.js) surfaces real contract changes and nothing
// else. Fingerprints are small + deterministic, so they are committed (unlike
// the gitignored raw-spec cache) — reproducible, diffable, drift-gated diff
// anchors. See docs/architecture/server-upgrade-automation.md.
//
// Run modes (mirrors scripts/generate/api-usage-manifest.js):
//   node scripts/generate/spec-fingerprint.js                 → refresh every
//       committed fingerprint (refetch each version named by its file)
//   node scripts/generate/spec-fingerprint.js --check         → fail on drift
//   node scripts/generate/spec-fingerprint.js <version>       → add/update one
//       (e.g. when the acknowledged baseline bumps)
//   node scripts/generate/spec-fingerprint.js <version> --from-file <spec.json>
//       → build from a local spec instead of fetching (offline; tests)
//   node scripts/generate/spec-fingerprint.js <version> --check --from-file …
//
// npm scripts:
//   docs:spec-fingerprints        → refresh committed fingerprints (write)
//   docs:spec-fingerprints:check  → drift check

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fetchSpec } = require('../lib/spec-fetch.cjs');

const SCHEMA_VERSION = 1;
const GENERATOR = 'scripts/generate/spec-fingerprint.js';
const OUTPUT_DIR_REL = 'docs/architecture/spec-fingerprints';
const FILE_PREFIX = 'jellyfin-';

// ── Pure reduction ─────────────────────────────────────────────────────────

// The trailing `#/.../<Name>` segment of a $ref.
function refName(ref) {
  return typeof ref === 'string' ? ref.split('/').pop() : null;
}

// Reduce a JSON schema node to a single normalized type signature string. This
// is the unit the diff compares, so it must capture everything that can break a
// consumer and nothing cosmetic:
//   - $ref            → "ref:<Name>" (the referenced component is fingerprinted
//                       separately, so its internal changes are caught there)
//   - allOf/oneOf/anyOf → unwrapped to the lone ref when the combiner is just a
//                       ref + sibling annotation (the common Jellyfin shape);
//                       otherwise "<combiner>(a|b)"
//   - array           → "array<items>"
//   - primitive       → "<type>" or "<type>:<format>" (so int64→int32 retypes,
//                       which differ only by format, are visible)
//   - nullable        → trailing "?" (so nullable flips surface as a retype)
function typeSig(schema) {
  if (!schema || typeof schema !== 'object') return 'unknown';
  if (schema.$ref) return withNullable('ref:' + refName(schema.$ref), schema);

  for (const combiner of ['allOf', 'oneOf', 'anyOf']) {
    const members = schema[combiner];
    if (Array.isArray(members)) {
      const parts = members.map(typeSig);
      const refs = parts.filter((p) => p.startsWith('ref:'));
      // allOf:[{$ref}] (optionally + a description-only sibling) → just the ref.
      const sig =
        refs.length === 1 && members.length <= 2 ? refs[0] : `${combiner}(${parts.join('|')})`;
      return withNullable(sig, schema);
    }
  }

  let base;
  if (schema.type === 'array') base = `array<${typeSig(schema.items)}>`;
  else if (schema.type) base = schema.format ? `${schema.type}:${schema.format}` : schema.type;
  else base = 'object';
  return withNullable(base, schema);
}

function withNullable(sig, schema) {
  return schema.nullable === true ? sig + '?' : sig;
}

// Reduce one operation (path+method) to its structural surface.
function reduceOperation(op) {
  const parameters = (op.parameters ?? [])
    .map((p) => ({
      name: p.name,
      in: p.in,
      type: typeSig(p.schema),
      required: p.required === true,
    }))
    // Deterministic order independent of how the spec lists params.
    .sort((a, b) => a.in.localeCompare(b.in) || a.name.localeCompare(b.name));

  const out = { parameters };

  const reqSchema = jsonSchemaOf(op.requestBody?.content);
  if (reqSchema !== null) out.requestBody = typeSig(reqSchema);

  // The success (2xx) response body schema. Prefer 200, else the lowest 2xx.
  const responses = op.responses ?? {};
  const okCode =
    responses['200'] !== undefined
      ? '200'
      : Object.keys(responses)
          .filter((c) => /^2\d\d$/.test(c))
          .sort()[0];
  if (okCode) {
    const respSchema = jsonSchemaOf(responses[okCode]?.content);
    if (respSchema !== null) out.response = typeSig(respSchema);
  }

  return out;
}

// Pull the JSON schema out of an OpenAPI content map (prefers application/json,
// tolerating the `application/json; profile="…"` variants Jellyfin emits).
function jsonSchemaOf(content) {
  if (!content || typeof content !== 'object') return null;
  const key =
    Object.keys(content).find((k) => k === 'application/json') ??
    Object.keys(content).find((k) => k.startsWith('application/json')) ??
    Object.keys(content)[0];
  return key ? (content[key]?.schema ?? null) : null;
}

// Build the full fingerprint object from a parsed spec. Pure (no I/O).
export function buildFingerprint(spec, { specVersion } = {}) {
  const operations = {};
  for (const [routePath, methods] of Object.entries(spec.paths ?? {})) {
    if (!methods || typeof methods !== 'object') continue;
    for (const [method, op] of Object.entries(methods)) {
      // Skip non-operation siblings ($ref, parameters, summary on the path item).
      if (!op || typeof op !== 'object' || Array.isArray(op)) continue;
      if (!/^(get|put|post|delete|patch|head|options|trace)$/.test(method)) continue;
      operations[`${method.toUpperCase()} ${routePath}`] = reduceOperation(op);
    }
  }

  const schemas = {};
  for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) {
    if (!schema || typeof schema !== 'object') continue;
    const entry = {};
    if (schema.properties && typeof schema.properties === 'object') {
      entry.properties = {};
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        entry.properties[prop] = typeSig(propSchema);
      }
    }
    if (Array.isArray(schema.enum)) entry.enum = schema.enum.slice();
    schemas[name] = entry;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generator: GENERATOR,
    description:
      'GENERATED FILE — DO NOT EDIT BY HAND. Reduced structural fingerprint of ' +
      'a Jellyfin OpenAPI spec (descriptions/summaries/examples stripped) for ' +
      'the server-upgrade-automation diff. Run `npm run docs:spec-fingerprints` ' +
      'to regenerate. See docs/architecture/server-upgrade-automation.md.',
    specVersion: specVersion ?? spec.info?.version ?? null,
    counts: {
      operations: Object.keys(operations).length,
      schemas: Object.keys(schemas).length,
    },
    operations: sortObjectKeys(operations),
    schemas: sortObjectKeys(schemas),
  };
}

// Recursively sort object keys so serialization is order-independent and
// therefore reproducible across spec regenerations (which reorder freely).
function sortObjectKeys(value) {
  if (Array.isArray(value)) return value; // arrays preserve order (enum values)
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortObjectKeys(value[key]);
    return out;
  }
  return value;
}

export function serializeFingerprint(fingerprint) {
  return JSON.stringify(fingerprint, null, 2) + '\n';
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function outputDir(rootDir) {
  return path.join(rootDir, OUTPUT_DIR_REL);
}

function fingerprintPath(rootDir, version) {
  return path.join(outputDir(rootDir), `${FILE_PREFIX}${version}.json`);
}

// Versions of the currently-committed fingerprints (derived from filenames).
function committedVersions(rootDir) {
  const dir = outputDir(rootDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => {
      const m = f.match(/^jellyfin-(\d+\.\d+\.\d+)\.json$/);
      return m ? m[1] : null;
    })
    .filter(Boolean)
    .sort();
}

// Resolve a version's spec: from --from-file if given, else fetch/cache it.
async function loadSpec(version, { rootDir, fromFile }) {
  if (fromFile) return JSON.parse(readFileSync(fromFile, 'utf8'));
  return fetchSpec(version, { rootDir });
}

// Generate + write/check one version's fingerprint. Returns { drift, summary }.
async function processVersion(version, { rootDir, fromFile, checkMode }) {
  const spec = await loadSpec(version, { rootDir, fromFile });
  const fingerprint = buildFingerprint(spec, { specVersion: version });
  const generated = serializeFingerprint(fingerprint);
  const outPath = fingerprintPath(rootDir, version);

  let existing;
  try {
    existing = readFileSync(outPath, 'utf8');
  } catch {
    existing = null;
  }

  const c = fingerprint.counts;
  const summary = `${version}: ${c.operations} operations, ${c.schemas} schemas`;

  if (existing === generated) return { drift: false, summary, action: 'up-to-date' };
  if (checkMode) return { drift: true, summary, action: 'drift' };

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, generated, 'utf8');
  return { drift: false, summary, action: existing === null ? 'created' : 'updated' };
}

async function main() {
  const args = process.argv.slice(2);
  const checkMode = args.includes('--check');
  const fromFileIdx = args.indexOf('--from-file');
  const fromFile = fromFileIdx >= 0 ? args[fromFileIdx + 1] : null;
  const positional = args.filter(
    (a, i) => !a.startsWith('--') && !(fromFileIdx >= 0 && i === fromFileIdx + 1),
  );
  // First positional that looks like a version; otherwise root defaults to '.'.
  const explicitVersion = positional.find((p) => /^\d+\.\d+\.\d+$/.test(p)) ?? null;
  const rootDir = positional.find((p) => !/^\d+\.\d+\.\d+$/.test(p)) ?? '.';

  let versions;
  if (explicitVersion) {
    versions = [explicitVersion];
  } else {
    versions = committedVersions(rootDir);
    if (versions.length === 0) {
      console.error(
        'docs:spec-fingerprints: no committed fingerprints to refresh and no ' +
          'version given. Bootstrap with: node scripts/generate/spec-fingerprint.js <version>',
      );
      process.exit(checkMode ? 0 : 1);
    }
  }
  if (fromFile && versions.length !== 1) {
    console.error('docs:spec-fingerprints: --from-file requires exactly one explicit <version>.');
    process.exit(1);
  }

  const results = [];
  for (const v of versions) {
    results.push(await processVersion(v, { rootDir, fromFile, checkMode }));
  }

  const drifted = results.filter((r) => r.drift);
  if (checkMode) {
    if (drifted.length > 0) {
      console.error(
        `docs:spec-fingerprints drift detected. Run 'npm run docs:spec-fingerprints' to regenerate.\n` +
          drifted.map((r) => `  ${r.summary}`).join('\n'),
      );
      process.exit(1);
    }
    console.log(
      `docs:spec-fingerprints: up to date (${results.map((r) => r.summary).join('; ')}).`,
    );
    process.exit(0);
  }

  for (const r of results) console.log(`docs:spec-fingerprints: ${r.action} ${r.summary}`);
  process.exit(0);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
