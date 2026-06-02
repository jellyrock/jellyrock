// Structural diff between two Jellyfin OpenAPI fingerprints
// (scripts/generate/spec-fingerprint.js output).
//
// Phase 1 diff step of the server-upgrade-automation pipeline
// (docs/architecture/server-upgrade-automation.md). diffFingerprints(from, to)
// is a PURE function emitting the `change` objects that Phase 2 joins against
// the API-usage manifest. Because the inputs are already-reduced fingerprints
// (descriptions/examples stripped, keys sorted), every change this surfaces is a
// real contract delta — cosmetic regeneration churn was neutralized upstream.
//
// Scope discipline (Phase 1 note #4): this is spec-vs-spec, both sides Jellyfin,
// so field names are compared with the spec's own casing — case-folding for the
// manifest join (the app sends PascalCase, the spec defines camelCase) is
// Phase 2's concern, NOT the diff's.
//
// Change kinds (added/removed/changed across the four axes the fingerprint
// records — endpoints, params, schema fields, enums — plus request/response
// body shape):
//   endpoint-added | endpoint-removed
//   param-added | param-removed | param-changed
//   requestbody-changed | response-changed
//   field-added | field-removed | field-retyped
//   enum-changed
// `param-removed` and `field-removed` additionally carry `renameCandidates`
// (always present, possibly empty): same-scope additions that could be a rename,
// same-signature first — an empty list signals a likely-genuine removal. See
// rankRenameCandidates.
// Each change is self-describing: { kind, ...locator, detail, fromVersion,
// toVersion }, where the locator is `path`+`method` for operation-scoped changes
// and `schema` for component-schema changes (`name` names the param/field).
//
// CLI:
//   node scripts/generate/spec-diff.js <fromVersion> <toVersion> [--root <dir>]
//       → read the two committed fingerprints, write the diff to the gitignored
//         .api-watch/cache/spec-diff-<from>..<to>.json (Phase 2's input)
//   node scripts/generate/spec-diff.js <fromVersion> <toVersion> --stdout
//       → print the diff JSON to stdout instead of writing the cache file

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEMA_VERSION = 1;
const GENERATOR = 'scripts/generate/spec-diff.js';
const FINGERPRINT_DIR_REL = 'docs/architecture/spec-fingerprints';
const CACHE_DIR_REL = '.api-watch/cache';

// ── Pure diff ──────────────────────────────────────────────────────────────

// Rank the same-scope additions that could be a RENAME of a removed param/field.
// `additions` is [{name, sig}]; `sameSignature` is true when an addition's type
// signature matches the removed item's `removedSig` (a high-confidence rename).
// Always returns an array (possibly empty) — an EMPTY list is the load-bearing
// signal: nothing in the same operation/schema could be the rename, so the removal
// is very likely genuine (not a rename/move). Mirrors enum-changed always carrying
// its full added/removed delta. The spec diff can surface candidates but never
// proves intent — confirming a populated list is rename-vs-removal is the agent's
// job (see the /server-upgrade skill's "Removal vs rename" edge case). Same-
// signature candidates sort first.
function rankRenameCandidates(removedSig, additions) {
  return additions
    .map((a) => ({ name: a.name, sameSignature: a.sig === removedSig }))
    .sort((x, y) => Number(y.sameSignature) - Number(x.sameSignature));
}

// Compare two parameter lists (each [{name,in,type,required}]) keyed by in+name.
function diffParameters(fromParams, toParams) {
  const changes = [];
  const key = (p) => `${p.in} ${p.name}`;
  const sig = (p) => `${p.in}|${p.type}|${p.required}`;
  const fromMap = new Map((fromParams ?? []).map((p) => [key(p), p]));
  const toMap = new Map((toParams ?? []).map((p) => [key(p), p]));

  // Additions in THIS operation — the pool a removed param could have been
  // renamed into. Empty ⇒ the removal has no in-scope rename candidate.
  const additions = [...toMap.values()]
    .filter((p) => !fromMap.has(key(p)))
    .map((p) => ({ name: p.name, sig: sig(p) }));

  for (const [k, p] of fromMap) {
    if (!toMap.has(k)) {
      changes.push({
        kind: 'param-removed',
        name: p.name,
        in: p.in,
        detail: `${p.in} param "${p.name}" removed`,
        renameCandidates: rankRenameCandidates(sig(p), additions),
      });
    }
  }
  for (const [k, p] of toMap) {
    if (!fromMap.has(k)) {
      changes.push({
        kind: 'param-added',
        name: p.name,
        in: p.in,
        detail: `${p.in} param "${p.name}" added`,
      });
      continue;
    }
    const prev = fromMap.get(k);
    const deltas = [];
    if (prev.type !== p.type) deltas.push(`type ${prev.type} → ${p.type}`);
    if (prev.required !== p.required) deltas.push(`required ${prev.required} → ${p.required}`);
    if (deltas.length > 0) {
      changes.push({
        kind: 'param-changed',
        name: p.name,
        in: p.in,
        detail: `${p.in} param "${p.name}": ${deltas.join(', ')}`,
      });
    }
  }
  return changes;
}

// Diff the operation maps (keyed "METHOD path"). `to`-only ops are added,
// `from`-only are removed, common ops have their params + body shapes compared.
function diffOperations(fromOps, toOps) {
  const changes = [];
  const splitKey = (opKey) => {
    const sp = opKey.indexOf(' ');
    return { method: opKey.slice(0, sp), path: opKey.slice(sp + 1) };
  };

  for (const opKey of Object.keys(fromOps)) {
    if (!(opKey in toOps)) {
      const { method, path: p } = splitKey(opKey);
      changes.push({ kind: 'endpoint-removed', path: p, method, detail: `${opKey} removed` });
    }
  }
  for (const opKey of Object.keys(toOps)) {
    const { method, path: p } = splitKey(opKey);
    if (!(opKey in fromOps)) {
      changes.push({ kind: 'endpoint-added', path: p, method, detail: `${opKey} added` });
      continue;
    }
    const a = fromOps[opKey];
    const b = toOps[opKey];
    for (const c of diffParameters(a.parameters, b.parameters)) {
      changes.push({ ...c, path: p, method });
    }
    if (a.requestBody !== b.requestBody) {
      changes.push({
        kind: 'requestbody-changed',
        path: p,
        method,
        detail: `requestBody ${a.requestBody ?? '(none)'} → ${b.requestBody ?? '(none)'}`,
      });
    }
    if (a.response !== b.response) {
      changes.push({
        kind: 'response-changed',
        path: p,
        method,
        detail: `response ${a.response ?? '(none)'} → ${b.response ?? '(none)'}`,
      });
    }
  }
  return changes;
}

// Diff one schema's property map. Added/removed properties + retypes.
function diffProperties(schemaName, fromProps, toProps) {
  const changes = [];
  const from = fromProps ?? {};
  const to = toProps ?? {};
  // Added fields in THIS schema — the pool a removed field could have been
  // renamed into (signature = the property's type signature string).
  const additions = Object.keys(to)
    .filter((name) => !(name in from))
    .map((name) => ({ name, sig: to[name] }));
  for (const name of Object.keys(from)) {
    if (!(name in to)) {
      changes.push({
        kind: 'field-removed',
        schema: schemaName,
        name,
        detail: `${schemaName}.${name} removed`,
        renameCandidates: rankRenameCandidates(from[name], additions),
      });
    } else if (from[name] !== to[name]) {
      changes.push({
        kind: 'field-retyped',
        schema: schemaName,
        name,
        detail: `${schemaName}.${name}: ${from[name]} → ${to[name]}`,
      });
    }
  }
  for (const name of Object.keys(to)) {
    if (!(name in from)) {
      changes.push({
        kind: 'field-added',
        schema: schemaName,
        name,
        detail: `${schemaName}.${name} added`,
      });
    }
  }
  return changes;
}

// Diff one schema's enum value set. A single enum-changed carries both the
// added and removed values so a consumer that switches on the enum sees the
// whole delta at once.
function diffEnum(schemaName, fromEnum, toEnum) {
  if (!fromEnum && !toEnum) return [];
  const from = new Set(fromEnum ?? []);
  const to = new Set(toEnum ?? []);
  const added = [...to].filter((v) => !from.has(v));
  const removed = [...from].filter((v) => !to.has(v));
  if (added.length === 0 && removed.length === 0) return [];
  const parts = [];
  if (added.length) parts.push(`+[${added.join(', ')}]`);
  if (removed.length) parts.push(`-[${removed.join(', ')}]`);
  return [
    {
      kind: 'enum-changed',
      schema: schemaName,
      added,
      removed,
      detail: `${schemaName} enum ${parts.join(' ')}`,
    },
  ];
}

// Diff the schema maps. Note: a schema present on only one side produces field
// changes for each of its properties (so a removed DTO surfaces as field-removed
// per field — the granularity Phase 2's manifest join needs); enum-only schemas
// likewise diff their values.
function diffSchemas(fromSchemas, toSchemas) {
  const changes = [];
  const names = new Set([...Object.keys(fromSchemas), ...Object.keys(toSchemas)]);
  for (const name of [...names].sort()) {
    const a = fromSchemas[name] ?? {};
    const b = toSchemas[name] ?? {};
    changes.push(...diffProperties(name, a.properties, b.properties));
    changes.push(...diffEnum(name, a.enum, b.enum));
  }
  return changes;
}

// Stable sort key so the diff output is deterministic regardless of traversal.
function changeSortKey(c) {
  return [c.kind, c.schema ?? '', c.path ?? '', c.method ?? '', c.name ?? '', c.detail].join('\0');
}

// Pure: diff two fingerprints (from = older/baseline, to = newer). Removed =
// present in `from` not `to`; added = present in `to` not `from`.
export function diffFingerprints(from, to) {
  const changes = [
    ...diffOperations(from.operations ?? {}, to.operations ?? {}),
    ...diffSchemas(from.schemas ?? {}, to.schemas ?? {}),
  ].map((c) => ({
    ...c,
    fromVersion: from.specVersion ?? null,
    toVersion: to.specVersion ?? null,
  }));

  changes.sort((a, b) => changeSortKey(a).localeCompare(changeSortKey(b)));

  return {
    schemaVersion: SCHEMA_VERSION,
    generator: GENERATOR,
    fromVersion: from.specVersion ?? null,
    toVersion: to.specVersion ?? null,
    counts: summarizeKinds(changes),
    changes,
  };
}

function summarizeKinds(changes) {
  const counts = { total: changes.length };
  for (const c of changes) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  return counts;
}

export function serializeDiff(diff) {
  return JSON.stringify(diff, null, 2) + '\n';
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function fingerprintPath(rootDir, version) {
  return path.join(rootDir, FINGERPRINT_DIR_REL, `jellyfin-${version}.json`);
}

function readFingerprint(rootDir, version) {
  try {
    return JSON.parse(readFileSync(fingerprintPath(rootDir, version), 'utf8'));
  } catch {
    throw new Error(
      `spec-diff: no committed fingerprint for ${version} ` +
        `(expected ${FINGERPRINT_DIR_REL}/jellyfin-${version}.json — run docs:spec-fingerprints).`,
    );
  }
}

function main() {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  const rootDir = rootIdx >= 0 ? args[rootIdx + 1] : '.';
  const toStdout = args.includes('--stdout');
  const positional = args.filter(
    (a, i) => !a.startsWith('--') && !(rootIdx >= 0 && i === rootIdx + 1),
  );
  const [fromVersion, toVersion] = positional;

  if (!fromVersion || !toVersion) {
    console.error(
      'usage: node scripts/generate/spec-diff.js <fromVersion> <toVersion> [--root <dir>] [--stdout]',
    );
    process.exit(1);
  }

  const diff = diffFingerprints(
    readFingerprint(rootDir, fromVersion),
    readFingerprint(rootDir, toVersion),
  );
  const serialized = serializeDiff(diff);

  if (toStdout) {
    process.stdout.write(serialized);
    process.exit(0);
  }

  const outPath = path.join(rootDir, CACHE_DIR_REL, `spec-diff-${fromVersion}..${toVersion}.json`);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, serialized, 'utf8');
  console.log(
    `spec-diff: ${fromVersion} → ${toVersion}: ${diff.counts.total} changes → ` +
      path.join(CACHE_DIR_REL, `spec-diff-${fromVersion}..${toVersion}.json`),
  );
  process.exit(0);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
