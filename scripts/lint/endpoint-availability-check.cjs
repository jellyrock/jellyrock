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
//   - version-guard — the cited `symbol` must still appear in source/*.bs code
//     (comments don't count). If the guard was removed, FAIL → the dev restores it or drops the entry, and the
//     floor finding correctly resurfaces.
//   - dispatch-sibling — the cited `sibling` path must still exist in the manifest
//     with a floor-tier range (minApiVersion <= 1), i.e. the V1 fallback is real.
//   - parameters — a query parameter whose server behavior changes by version.
//     Its endpoint must be in the manifest, its guard `symbol` must exist in
//     source/, and EVERY .bs file under source/ or components/ whose code (not
//     comments) names the parameter must also call the guard. A file that sends
//     it without the guard FAILS. So does an entry no file sends any more (stale).
//
// NOT checked here (by design): "every floor finding has a registry entry." That
// direction is enforced by the floor check itself — an unregistered post-floor
// endpoint keeps flagging needsInvestigation, so it can't hide. The spec-derived
// floor check is the comprehensive enumerator; this lint only keeps the ledger's
// claims honest.
//
// `.cjs` (scripts/lint convention): reads the manifest JSON + walks source/ and components/ .bs +
// requires the .cjs loader and BrighterScript's lexer. No network, no GitHub.
//
// Usage:  node scripts/lint/endpoint-availability-check.cjs [--root <dir>] [--json]
// Exit:   0 = clean · 1 = at least one validation failure · 2 = internal error

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Lexer } = require('brighterscript');
const {
  loadEndpointAvailability,
  loadParameterAvailability,
  normalizePath,
} = require('../lib/endpoint-availability.cjs');

const MANIFEST_REL = 'docs/architecture/api-usage-manifest.json';
const SOURCE_DIR_REL = 'source';
// Where a request parameter may be set: the API layer and the Tasks that build
// params before calling it.
const PARAMETER_SCAN_DIRS_REL = ['source', 'components'];

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

// Every .bs file under a directory, as { rel, text }. A missing directory → [].
function readBsFiles(rootDir, dirRel) {
  const root = path.join(rootDir, dirRel);
  if (!fs.existsSync(root)) return [];
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.bs')) {
        files.push({
          rel: path.relative(rootDir, full).split(path.sep).join('/'),
          text: fs.readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(root);
  return files;
}

// Recursively collect the code of every .bs file under source/ (one read; the
// guard-symbol check is a simple scan over the concatenation). Comments are
// dropped, so a guard named only in a comment does not count as present.
function readAllSource(rootDir) {
  return readBsFiles(rootDir, SOURCE_DIR_REL)
    .map((f) => stripComments(f.text))
    .join('\n');
}

// Drop BrightScript comments using the compiler's own lexer, so string, template
// string (including multi-line and `${…}`) and comment boundaries are read
// exactly as the build reads them. The lexer keeps `'` and `rem` comments as
// token trivia, not tokens, so joining the token text leaves only code.
function stripComments(text) {
  return Lexer.scan(text)
    .tokens.map((t) => t.text)
    .join(' ');
}

// BrightScript identifiers and AA keys are case-insensitive, so both the
// parameter and the guard match case-insensitively on a word boundary. That
// catches `params["X"]`, `params.X`, `{ X: … }` and `{ "X": … }` alike.
function wordRegex(word) {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
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

  let parameters;
  try {
    parameters = loadParameterAvailability(rootDir); // throws on schema violation
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

  if (parameters.length) {
    const code = PARAMETER_SCAN_DIRS_REL.flatMap((d) => readBsFiles(rootDir, d)).map((f) => ({
      rel: f.rel,
      code: stripComments(f.text),
    }));
    for (const param of parameters) {
      failures.push(...checkParameter(param, manifest, source, code));
    }
  }

  return finish(flags, failures, entries.length + parameters.length);
}

// The claims a `parameters:` entry makes: its endpoint is still called, its guard
// still exists, and nothing sends the parameter without the guard.
function checkParameter(param, manifest, source, code) {
  const failures = [];
  const fail = (problem) => failures.push({ entry: param.id, problem });

  if (!findManifestEndpoint(manifest, param.normalizedPath, param.methodSet)) {
    fail(
      'endpoint not found in the manifest — the app no longer calls it (stale entry; remove it)',
    );
    return failures;
  }
  const symbol = param.handling.symbol;
  const symbolRe = wordRegex(symbol);
  if (!symbolRe.test(source)) {
    fail(
      `version-guard symbol "${symbol}" not found in source/ — guard removed? (restore it or drop the entry)`,
    );
  }

  const nameRe = wordRegex(param.name);
  const senders = code.filter((f) => nameRe.test(f.code));
  if (senders.length === 0) {
    fail(
      `no .bs file under source/ or components/ sends "${param.name}" any more (stale entry; remove it)`,
    );
  }
  for (const f of senders) {
    if (!symbolRe.test(f.code)) {
      fail(
        `${f.rel} sends "${param.name}" without calling ${symbol}() — servers differ on this parameter, so decide with the guard (see docs/dev/jellyfin-server-versioning.md §4)`,
      );
    }
  }
  return failures;
}

function finish(flags, failures, registered) {
  if (flags.json) {
    process.stdout.write(JSON.stringify({ registered, failures }, null, 2) + '\n');
  } else if (failures.length === 0) {
    console.log(
      `endpoint-availability: OK — ${registered} registered post-floor endpoint(s) and version-gated parameter(s), all claims validated.`,
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
