// scripts/lint/endpoint-availability-check.cjs — validates the committed
// endpoint-availability registry (docs/dev/jellyfin-endpoint-availability.yml)
// against current source + the API-usage manifest. Phase 6 of the
// server-upgrade-automation pipeline (docs/architecture/server-upgrade-automation.md).
//
// The registry is the floor check's DISPOSITION LEDGER: an entry says "this
// post-floor endpoint's absence from the 10.7.0 floor is known and handled this
// way." That's only trustworthy if the CODE claim each entry makes still holds —
// otherwise it's a blunt suppression that could hide a regression (e.g. someone
// deletes the supportsMediaSegments() guard and the endpoint now really would 404
// on old servers). This lint is that regression-safety gate:
//
//   - SCHEMA — the loader's validateRegistry() throws on any shape violation.
//   - USED — every entry's endpoint must still exist in the manifest (an entry for
//     an endpoint the app no longer calls is dead weight — remove it).
//   - version-guard — the cited `symbol` must still appear in source/*.bs. If the
//     guard was removed, FAIL → the dev restores it or drops the entry, and the
//     floor finding correctly resurfaces.
//   - dispatch-sibling — the cited `sibling` path must still exist in the manifest
//     with a floor-tier range (minApiVersion <= 1), i.e. the V1 fallback is real.
//
// NOT checked here (by design): "every floor finding has a registry entry." That
// direction is enforced by the floor check itself — an unregistered post-floor
// endpoint keeps flagging needsInvestigation, so it can't hide. The spec-derived
// floor check is the comprehensive enumerator; this lint only keeps the ledger's
// claims honest.
//
// `.cjs` (scripts/lint convention): reads the manifest JSON + walks source/*.bs +
// requires the .cjs loader. No network, no GitHub.
//
// Usage:  node scripts/lint/endpoint-availability-check.cjs [--root <dir>] [--json]
// Exit:   0 = clean · 1 = at least one validation failure · 2 = internal error

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadEndpointAvailability, normalizePath } = require('../lib/endpoint-availability.cjs');

const MANIFEST_REL = 'docs/architecture/api-usage-manifest.json';
const SOURCE_DIR_REL = 'source';

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[a.slice(2)] = next;
      i++;
    } else {
      flags[a.slice(2)] = true;
    }
  }
  return flags;
}

function readManifest(rootDir) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, MANIFEST_REL), 'utf8'));
}

// Recursively collect the text of every .bs file under source/ (one read; the
// guard-symbol check is a simple substring scan over the concatenation).
function readAllSource(rootDir) {
  const root = path.join(rootDir, SOURCE_DIR_REL);
  const chunks = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.bs')) chunks.push(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(root);
  return chunks.join('\n');
}

// Does the manifest contain an endpoint matching this normalized path + (any of)
// these methods? Returns the matching endpoint or null.
function findManifestEndpoint(manifest, normPath, methodSet) {
  for (const ep of manifest.endpoints ?? []) {
    if (ep.normalized !== normPath) continue;
    if (methodSet === '*') return ep;
    const epMethods = new Set((ep.methods ?? []).map((m) => m.toUpperCase()));
    for (const m of methodSet) {
      if (epMethods.has(m)) return ep;
    }
  }
  return null;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const rootDir = flags.root || '.';

  let entries;
  try {
    entries = loadEndpointAvailability(rootDir); // throws on schema violation
  } catch (err) {
    return finish(flags, [{ entry: '(schema)', problem: err.message }], 0);
  }

  const manifest = readManifest(rootDir);
  const source = readAllSource(rootDir);
  const failures = [];

  for (const entry of entries) {
    // USED — the endpoint must still be in the manifest.
    const ep = findManifestEndpoint(manifest, entry.normalizedPath, entry.methodSet);
    if (!ep) {
      failures.push({
        entry: entry.id,
        problem:
          'endpoint not found in the manifest — the app no longer calls it (stale entry; remove it)',
      });
      continue; // the guard/sibling checks below are moot for a dead endpoint
    }

    const h = entry.handling;
    if (h.type === 'version-guard') {
      // Word-boundary match so `supportsMediaSegments` doesn't match a longer name.
      const re = new RegExp(`\\b${h.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (!re.test(source)) {
        failures.push({
          entry: entry.id,
          problem: `version-guard symbol "${h.symbol}" not found in source/ — guard removed? (the floor finding should resurface; restore the guard or drop the entry)`,
        });
      }
    } else if (h.type === 'dispatch-sibling') {
      const sib = normalizePath(h.sibling);
      const sibEp = findManifestEndpoint(manifest, sib, '*');
      if (!sibEp) {
        failures.push({
          entry: entry.id,
          problem: `dispatch-sibling "${h.sibling}" not found in the manifest — the V1 fallback is gone? (restore it or drop the entry)`,
        });
      } else if ((sibEp.minApiVersion ?? 1) > 1) {
        failures.push({
          entry: entry.id,
          problem: `dispatch-sibling "${h.sibling}" exists but its range (minApiVersion ${sibEp.minApiVersion}) does not include the floor tier — it cannot cover the floor`,
        });
      }
    }
  }

  return finish(flags, failures, entries.length);
}

function finish(flags, failures, registered) {
  if (flags.json) {
    process.stdout.write(JSON.stringify({ registered, failures }, null, 2) + '\n');
  } else if (failures.length === 0) {
    console.log(
      `endpoint-availability: OK — ${registered} registered post-floor endpoint(s), all claims validated.`,
    );
  } else {
    console.error(`endpoint-availability: ${failures.length} validation failure(s):`);
    for (const f of failures) console.error(`  - ${f.entry}: ${f.problem}`);
  }
  return failures.length ? 1 : 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`endpoint-availability-check: ${err.message}`);
  process.exit(2);
}
