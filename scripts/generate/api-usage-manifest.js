// Generates docs/architecture/api-usage-manifest.json — a deterministic record
// of the Jellyfin REST API surface JellyRock actually depends on (endpoints,
// request-body fields, response fields).
//
// Why this exists: JellyRock's API client is hand-written (no codegen from the
// Jellyfin OpenAPI spec), so nothing mechanically knows which endpoints/fields
// the app uses. This manifest is the "demand" side — the foundation a later
// spec-diff tool joins against to flag upstream changes that affect us while
// ignoring the churn that doesn't. It's also independently useful: a
// PR-diffable, always-current map of the app's real API footprint.
//
// How it works: parses the relevant BrighterScript sources with the
// brighterscript AST (the same parser the BSC plugins use — robust to
// formatting, unlike grep) and extracts three surfaces:
//   - endpoints       — first arg of buildURL()/APIRequest() calls (string
//                       literal or Substitute("/path/{0}", …) template), with
//                       the HTTP method inferred from the enclosing function.
//   - requestFields   — PascalCase keys of request-body AAs + `postData.X =`
//                       assignments in the API layer.
//   - responseFields  — PascalCase field reads off Jellyfin DTOs in the data
//                       transformers (the canonical DTO→ContentNode boundary).
//
// Coverage is deliberately scoped (see SCOPE below) and the bits we don't yet
// cover are recorded in `coverage` rather than silently dropped. Over-capture
// is self-correcting downstream: a name that isn't a real Jellyfin schema
// field simply won't match anything when the spec-diff tool joins against it.
// Under-capture (a missed dependency) is the dangerous direction, so the
// heuristics lean inclusive.
//
// Run modes (mirrors scripts/generate/dev-index.cjs):
//   node scripts/generate/api-usage-manifest.js            → write (default)
//   node scripts/generate/api-usage-manifest.js --check    → fail on drift (CI)
//   node scripts/generate/api-usage-manifest.js --verbose  → print line-level
//                                                            provenance to stderr
//
// npm scripts:
//   docs:api-manifest        → regenerate (write mode)
//   docs:api-manifest:check  → drift check (pre-push + CI)

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fg from 'fast-glob';
import * as bs from 'brighterscript';

// ── Scope ────────────────────────────────────────────────────────────────────
// Defined as explicit globs so widening coverage later is a one-line change.

// Endpoint sinks are unambiguous (the first string arg IS a path), so we scan
// broadly. baseRequest.bs DEFINES buildURL/APIRequest (its internal buildURL
// call just forwards a path param), and image.bs is a Layer-2 passthrough that
// receives an already-built URL — neither contributes a real endpoint literal.
const ENDPOINT_GLOBS = ['source/**/*.bs'];
const ENDPOINT_EXCLUDE = new Set(['source/api/baseRequest.bs', 'source/api/image.bs']);

// Response-field reads: the data transformers are purpose-built DTO→node
// mappers, so PascalCase reads there are reliably Jellyfin fields (elsewhere a
// PascalCase read could be a Roku object like `deviceInfo.DolbyVision`).
const RESPONSE_FIELD_FILES = [
  'source/data/JellyfinDataTransformer.bs',
  'source/data/SessionDataTransformer.bs',
];

// Request-body fields are built in the API layer.
const REQUEST_FIELD_GLOBS = ['source/api/**/*.bs'];
const REQUEST_FIELD_EXCLUDE = new Set(['source/api/baseRequest.bs']);

const ENDPOINT_SINK_NAMES = new Set(['buildurl', 'apirequest']);
const PATH_TEMPLATE_NAMES = new Set(['substitute']);
const METHOD_CALL_GET = new Set(['getjson']);
const METHOD_CALL_POST = new Set(['postjson']);

const OUTPUT_REL = 'docs/architecture/api-usage-manifest.json';

const PARSE_OPTS = { mode: bs.ParseMode.BrighterScript };

// ── Pure AST helpers ─────────────────────────────────────────────────────────

function unquote(text) {
  if (typeof text !== 'string') return text;
  if (text.length >= 2 && (text[0] === '"' || text[0] === "'")) {
    const q = text[0];
    if (text[text.length - 1] === q) return text.slice(1, -1);
  }
  return text;
}

// Return the string value of a string-literal expression, else null.
function literalStringValue(node) {
  if (!node || !bs.isLiteralExpression(node)) return null;
  const text = node.tokens?.value?.text;
  if (typeof text !== 'string') return null;
  if (text[0] !== '"' && text[0] !== "'") return null; // not a string literal
  return unquote(text);
}

// Name of a call's callee (`buildURL` or `m.validatedReq` → "validatedReq").
function calleeName(call) {
  const callee = call?.callee;
  if (!callee) return null;
  return callee.tokens?.name?.text ?? null;
}

// Walk an object chain (a.b.c, a[0].b) down to the base variable name.
function rootVarName(node) {
  let current = node;
  while (current) {
    if (bs.isVariableExpression(current)) return current.tokens?.name?.text ?? null;
    if (bs.isDottedGetExpression(current) || bs.isIndexedGetExpression(current)) {
      current = current.obj;
      continue;
    }
    return null;
  }
  return null;
}

// Jellyfin DTO fields are PascalCase (Id, RunTimeTicks); JellyRock ContentNode
// writes are camelCase (item.runTimeTicks). Require a leading uppercase AND a
// lowercase letter so ALL-CAPS enum constants (SubtitleSelection.NONE) are out.
function isPascalField(name) {
  return typeof name === 'string' && /^[A-Z]/.test(name) && /[a-z]/.test(name);
}

// Roots whose PascalCase members are never Jellyfin DTO fields: `m` (class
// instance), `item` (the OUTPUT ContentNode — its PascalCase reads are Roku
// built-ins like PlayStart), and `translationKeys` (internal i18n constants).
const EXCLUDED_RESPONSE_ROOTS = new Set(['m', 'item', 'translationKeys']);

function enclosingFunction(node) {
  let current = node?.parent;
  while (current) {
    if (bs.isFunctionExpression(current)) return current;
    current = current.parent;
  }
  return null;
}

function isCalleeOf(node) {
  const parent = node?.parent;
  return !!parent && bs.isCallExpression(parent) && parent.callee === node;
}

// True if `node` appears anywhere inside `subtree`.
function nodeWithin(node, subtree) {
  if (!subtree?.walk) return false;
  let found = false;
  subtree.walk(
    (x) => {
      if (x === node) found = true;
    },
    { walkMode: bs.WalkMode.visitAllRecursive },
  );
  return found;
}

// If an IfStatement's condition is `getApiVersion[...]() >= N` (or `> N`),
// return the minimum apiVersion N the then-branch requires; else null.
function apiVersionGuardThreshold(ifStmt) {
  const c = ifStmt?.condition;
  if (!c || !bs.isBinaryExpression(c)) return null;
  const op = c.tokens?.operator?.text;
  if (op !== '>=' && op !== '>') return null;
  let mentions = false;
  c.walk?.(
    (x) => {
      if (bs.isCallExpression(x) && /getapiversion/i.test(x.callee?.tokens?.name?.text || '')) {
        mentions = true;
      }
    },
    { walkMode: bs.WalkMode.visitAllRecursive },
  );
  if (!mentions) return null;
  const n = parseInt(c.right?.tokens?.value?.text, 10);
  if (!Number.isFinite(n)) return null;
  return op === '>' ? n + 1 : n;
}

function blockEndsInReturn(block) {
  const stmts = block?.statements;
  return Array.isArray(stmts) && stmts.length > 0 && bs.isReturnStatement(stmts[stmts.length - 1]);
}

// Derive the apiVersion range [min, max] (max=null → unbounded) an endpoint
// call serves, from the `getApiVersion() >= N` dispatch guards in its function.
// Handles three real shapes — then/else branches AND the early-return
// fall-through (`if >=N { return … } end if; return …`) where the trailing
// statement is the implicit "< N" case — and nests for a future v3.
function computeApiVersionRange(node, funcNode) {
  let min = 1;
  let max = null;
  if (!funcNode?.walk) return { min, max };

  const guards = [];
  funcNode.walk(
    (x) => {
      if (bs.isIfStatement(x)) {
        const n = apiVersionGuardThreshold(x);
        if (n != null) guards.push({ ifs: x, n });
      }
    },
    { walkMode: bs.WalkMode.visitAllRecursive },
  );

  const nodeLine = node?.location?.range?.start?.line ?? -1;
  const tightenMax = (v) => {
    max = max == null ? v : Math.min(max, v);
  };

  for (const g of guards) {
    if (nodeWithin(node, g.ifs.thenBranch)) {
      min = Math.max(min, g.n); // inside `>= N` then-branch → serves ≥ N
    } else if (nodeWithin(node, g.ifs.elseBranch)) {
      tightenMax(g.n - 1); // inside the else → serves < N
    } else {
      // Fall-through: a statement after an `if >=N { return } end if` is the
      // implicit "< N" case.
      const ifEnd = g.ifs.location?.range?.end?.line ?? -1;
      if (nodeLine > ifEnd && blockEndsInReturn(g.ifs.thenBranch)) tightenMax(g.n - 1);
    }
  }
  return { min, max };
}

function lineOf(node) {
  // brighterscript ranges are 0-based; report 1-based to match editors.
  const line = node?.location?.range?.start?.line;
  return typeof line === 'number' ? line + 1 : null;
}

function ensureLeadingSlash(p) {
  return p.startsWith('/') ? p : '/' + p;
}

// Canonical form for matching against an OpenAPI spec: every {placeholder}
// (and Substitute's {0}/{1}) collapses to {}, case is folded (Jellyfin routing
// is case-insensitive and the app spells paths inconsistently), and a trailing
// slash is stripped (`/items/` and the spec's `/Items` are the same endpoint).
// The raw `path` preserves the as-written casing, so nothing is lost.
function normalizePath(p) {
  let s = ensureLeadingSlash(p)
    .replace(/\{[^}]*\}/g, '{}')
    .toLowerCase();
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

// ── Extraction ───────────────────────────────────────────────────────────────

function parse(contents) {
  return bs.Parser.parse(contents, PARSE_OPTS).ast;
}

// Extract endpoints + inferred methods from one file's AST.
// Returns { endpoints: [{path, normalized, methods, line}], unresolved: [{line}] }.
function extractEndpoints(ast) {
  // Per-function accumulation: the HTTP method belongs to the whole builder
  // function, so we collect methods + paths + literal var-assignments per
  // function, then resolve.
  const funcs = new Map(); // funcNode -> { paths, methods, assignments }
  const FILE_SCOPE = Symbol('file');

  function bucket(node) {
    const fn = enclosingFunction(node) ?? FILE_SCOPE;
    let b = funcs.get(fn);
    if (!b) {
      b = { paths: [], methods: new Set(), assignments: new Map() };
      funcs.set(fn, b);
    }
    return b;
  }

  ast.walk(
    (node) => {
      // var = "literal"  → enables resolving buildURL(varName)
      if (bs.isAssignmentStatement(node)) {
        const lit = literalStringValue(node.value);
        if (lit !== null) {
          const name = node.tokens?.name?.text;
          if (name) {
            const b = bucket(node);
            if (!b.assignments.has(name)) b.assignments.set(name, new Set());
            b.assignments.get(name).add(lit);
          }
        }
        return;
      }

      // Inline AA returns like { method: "POST", url: url }
      if (bs.isAALiteralExpression(node)) {
        for (const el of node.elements ?? []) {
          const key = unquote(el.tokens?.key?.text ?? '');
          if (key.toLowerCase() === 'method') {
            const m = literalStringValue(el.value);
            if (m) bucket(node).methods.add(m.toUpperCase());
          }
        }
        return;
      }

      if (!bs.isCallExpression(node)) return;
      const name = (calleeName(node) ?? '').toLowerCase();

      if (METHOD_CALL_GET.has(name)) bucket(node).methods.add('GET');
      if (METHOD_CALL_POST.has(name)) bucket(node).methods.add('POST');

      if (name === 'validatedreq') {
        const m = literalStringValue(node.args?.[0]);
        if (m) bucket(node).methods.add(m.toUpperCase());
        return;
      }

      if (!ENDPOINT_SINK_NAMES.has(name)) return;

      const arg0 = node.args?.[0];
      const b = bucket(node);
      const line = lineOf(node);
      const range = computeApiVersionRange(node, enclosingFunction(node));

      const direct = literalStringValue(arg0);
      if (direct !== null) {
        b.paths.push({ path: direct, line, range });
        return;
      }
      if (
        bs.isCallExpression(arg0) &&
        PATH_TEMPLATE_NAMES.has((calleeName(arg0) ?? '').toLowerCase())
      ) {
        const tmpl = literalStringValue(arg0.args?.[0]);
        if (tmpl !== null) {
          b.paths.push({ path: tmpl, line, range });
          return;
        }
      }
      if (bs.isVariableExpression(arg0)) {
        b.paths.push({ varRef: arg0.tokens?.name?.text, line, range });
        return;
      }
      b.paths.push({ unresolved: true, line, range });
    },
    { walkMode: bs.WalkMode.visitAllRecursive },
  );

  const endpoints = [];
  const unresolved = [];
  for (const b of funcs.values()) {
    const methods = b.methods.size ? [...b.methods].sort() : ['UNKNOWN'];
    for (const entry of b.paths) {
      let literals = [];
      if (typeof entry.path === 'string') {
        literals = [entry.path];
      } else if (entry.varRef && b.assignments.has(entry.varRef)) {
        literals = [...b.assignments.get(entry.varRef)];
      }
      // Drop empty-string literals — e.g. a `path = ""` initializer before
      // conditional assignment is not itself an endpoint.
      literals = literals.filter((l) => l !== '');
      if (literals.length === 0) {
        if (typeof entry.path !== 'string') unresolved.push({ line: entry.line });
        continue;
      }
      for (const lit of literals) {
        endpoints.push({
          path: ensureLeadingSlash(lit),
          normalized: normalizePath(lit),
          methods,
          minApiVersion: entry.range?.min ?? 1,
          maxApiVersion: entry.range?.max ?? null,
          line: entry.line,
        });
      }
    }
  }
  return { endpoints, unresolved };
}

// Extract PascalCase response-field reads off Jellyfin DTO objects.
// Returns [{ name, root, line }].
function extractResponseFields(ast) {
  const out = [];
  ast.walk(
    (node) => {
      if (!bs.isDottedGetExpression(node)) return;
      const name = node.tokens?.name?.text;
      if (!isPascalField(name)) return;
      if (isCalleeOf(node)) return; // a method call (.Count()), not a field read
      const root = rootVarName(node);
      if (!root || EXCLUDED_RESPONSE_ROOTS.has(root)) return;
      out.push({ name, root, line: lineOf(node) });
    },
    { walkMode: bs.WalkMode.visitAllRecursive },
  );
  return out;
}

// Extract PascalCase request-body field names (AA keys + `body.X =` sets).
// Returns [{ name, line }].
function extractRequestFields(ast) {
  const out = [];
  ast.walk(
    (node) => {
      if (bs.isAALiteralExpression(node)) {
        for (const el of node.elements ?? []) {
          const key = unquote(el.tokens?.key?.text ?? '');
          if (isPascalField(key)) out.push({ name: key, line: lineOf(el) });
        }
        return;
      }
      if (bs.isDottedSetStatement(node)) {
        const name = node.tokens?.name?.text;
        if (isPascalField(name)) out.push({ name, line: lineOf(node) });
      }
    },
    { walkMode: bs.WalkMode.visitAllRecursive },
  );
  return out;
}

// Convenience for tests: parse a single BrighterScript source string and run
// all three extractors against it. Mirrors the inline-snippet style the BSC
// plugin tests use.
export function extractFromSource(contents) {
  const ast = parse(contents);
  const { endpoints, unresolved } = extractEndpoints(ast);
  return {
    endpoints,
    unresolved,
    requestFields: extractRequestFields(ast),
    responseFields: extractResponseFields(ast),
  };
}

// ── Manifest assembly ────────────────────────────────────────────────────────

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function resolveFiles(rootDir, globs, exclude) {
  const matches = fg.sync(globs, { cwd: rootDir, dot: false });
  return matches
    .map(toPosix)
    .filter((rel) => !exclude.has(rel))
    .sort();
}

// Build the manifest object from a repo root. Pure-ish (reads files, no writes).
// `verboseSink` (optional) receives line-level provenance strings.
export function buildManifest(rootDir, { verboseSink } = {}) {
  const endpointFiles = resolveFiles(rootDir, ENDPOINT_GLOBS, ENDPOINT_EXCLUDE);
  const requestFiles = resolveFiles(rootDir, REQUEST_FIELD_GLOBS, REQUEST_FIELD_EXCLUDE);
  const responseFiles = RESPONSE_FIELD_FILES.slice();

  const endpointMap = new Map(); // path -> { path, normalized, methods:Set, sourceFiles:Set }
  const requestMap = new Map(); // name -> Set<file>
  const responseMap = new Map(); // name -> { readVia:Set, sourceFiles:Set }
  const unresolvedSinks = [];

  const note = (msg) => {
    if (verboseSink) verboseSink(msg);
  };

  for (const rel of endpointFiles) {
    const ast = parse(readFileSync(path.join(rootDir, rel), 'utf8'));
    const { endpoints, unresolved } = extractEndpoints(ast);
    for (const ep of endpoints) {
      // Cross-function dispatch clamp: the sdkV1/sdkV2 shim files are
      // version-named by design (sdkV1 = server 10.7–10.8, sdkV2 = 10.9+), but
      // their buildURL has no in-function getApiVersion guard (the V1/V2 choice
      // is made one layer up in ApiClient). Pin the range from the file.
      let minApiVersion = ep.minApiVersion;
      let maxApiVersion = ep.maxApiVersion;
      if (rel.endsWith('/sdkV1.bs'))
        maxApiVersion = maxApiVersion == null ? 1 : Math.min(maxApiVersion, 1);
      if (rel.endsWith('/sdkV2.bs')) minApiVersion = Math.max(minApiVersion, 2);

      let rec = endpointMap.get(ep.path);
      if (!rec) {
        rec = {
          path: ep.path,
          normalized: ep.normalized,
          methods: new Set(),
          minApiVersion,
          maxApiVersion,
          sourceFiles: new Set(),
        };
        endpointMap.set(ep.path, rec);
      }
      for (const m of ep.methods) rec.methods.add(m);
      // Union the apiVersion range across duplicate call-sites for this path:
      // widest min, widest max (null = unbounded wins).
      rec.minApiVersion = Math.min(rec.minApiVersion, minApiVersion);
      rec.maxApiVersion =
        rec.maxApiVersion == null || maxApiVersion == null
          ? null
          : Math.max(rec.maxApiVersion, maxApiVersion);
      rec.sourceFiles.add(rel);
      note(
        `endpoint ${ep.methods.join('/')} ${ep.path} [v${minApiVersion}..${maxApiVersion ?? '∞'}]  (${rel}:${ep.line})`,
      );
    }
    for (const u of unresolved) {
      unresolvedSinks.push({ sourceFile: rel, line: u.line });
      note(`UNRESOLVED endpoint sink (${rel}:${u.line})`);
    }
  }

  for (const rel of requestFiles) {
    const ast = parse(readFileSync(path.join(rootDir, rel), 'utf8'));
    for (const f of extractRequestFields(ast)) {
      if (!requestMap.has(f.name)) requestMap.set(f.name, new Set());
      requestMap.get(f.name).add(rel);
      note(`requestField ${f.name}  (${rel}:${f.line})`);
    }
  }

  for (const rel of responseFiles) {
    const ast = parse(readFileSync(path.join(rootDir, rel), 'utf8'));
    for (const f of extractResponseFields(ast)) {
      let rec = responseMap.get(f.name);
      if (!rec) {
        rec = { readVia: new Set(), sourceFiles: new Set() };
        responseMap.set(f.name, rec);
      }
      rec.readVia.add(f.root);
      rec.sourceFiles.add(rel);
      note(`responseField ${f.name}  via ${f.root}  (${rel}:${f.line})`);
    }
  }

  const endpoints = [...endpointMap.values()]
    .map((r) => ({
      path: r.path,
      normalized: r.normalized,
      methods: [...r.methods].sort(),
      minApiVersion: r.minApiVersion,
      maxApiVersion: r.maxApiVersion,
      sourceFiles: [...r.sourceFiles].sort(),
    }))
    .sort((a, b) => a.normalized.localeCompare(b.normalized) || a.path.localeCompare(b.path));

  const requestFields = [...requestMap.entries()]
    .map(([name, files]) => ({ name, sourceFiles: [...files].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const responseFields = [...responseMap.entries()]
    .map(([name, r]) => ({
      name,
      readVia: [...r.readVia].sort(),
      sourceFiles: [...r.sourceFiles].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  unresolvedSinks.sort(
    (a, b) => a.sourceFile.localeCompare(b.sourceFile) || (a.line ?? 0) - (b.line ?? 0),
  );

  return {
    schemaVersion: 1,
    generator: 'scripts/generate/api-usage-manifest.js',
    description:
      'GENERATED FILE — DO NOT EDIT BY HAND. The Jellyfin REST API surface ' +
      'JellyRock depends on, extracted from source via the BrighterScript AST. ' +
      'Run `npm run docs:api-manifest` to regenerate. See ' +
      'docs/architecture/api-usage-manifest.md for what this is and how it is used.',
    endpoints,
    requestFields,
    responseFields,
    coverage: {
      scope: {
        endpoints: { globs: ENDPOINT_GLOBS, exclude: [...ENDPOINT_EXCLUDE].sort() },
        requestFields: { globs: REQUEST_FIELD_GLOBS, exclude: [...REQUEST_FIELD_EXCLUDE].sort() },
        responseFields: { files: responseFiles },
      },
      counts: {
        endpoints: endpoints.length,
        requestFields: requestFields.length,
        responseFields: responseFields.length,
        unresolvedEndpointSinks: unresolvedSinks.length,
      },
      unresolvedEndpointSinks: unresolvedSinks,
      knownGaps: [
        'Response-field extraction is scoped to the data transformers (the ' +
          'canonical DTO→ContentNode boundary). Ad-hoc DTO reads outside the ' +
          'transformers (e.g. playback tuning in source/api/items.bs) are not ' +
          'yet captured.',
        'PascalCase heuristic may include nested map keys (e.g. ImageTags.Primary) ' +
          'and over-capture is intentional — names that are not real Jellyfin ' +
          'schema fields are ignored when joined against the spec.',
        'Endpoint paths built by non-literal string concatenation are reported ' +
          'under unresolvedEndpointSinks rather than guessed.',
        'Field names are recorded as the app spells them (PascalCase). Jellyfin ' +
          'spells query parameters in camelCase (e.g. the app sends "Recursive", ' +
          'the spec defines "recursive"), so a spec-diff join over request/response ' +
          'field names MUST be case-insensitive — as it already is for endpoints ' +
          '(the `normalized` field case-folds).',
        'requestFields may include HTTP header names (e.g. Content-Type) lifted ' +
          'from `headers:` AAs, not just body/query fields. Harmless: they are ' +
          'ignored when joined against the spec.',
        'minApiVersion/maxApiVersion (max=null → unbounded) record the apiVersion ' +
          'tier range each endpoint serves, derived from the `getApiVersion() >= N` ' +
          'dispatch guards (then/else branches and the early-return fall-through). ' +
          'They generalize to a future v3. A spec-diff at a given tier is a ' +
          'breaking candidate only for endpoints whose range includes that tier, ' +
          'so endpoints pinned to frozen older tiers (e.g. V1, server 10.7–10.8) ' +
          'are excluded automatically — no allowlist needed.',
        'The apiVersion range captures the getApiVersion() dispatch split only, ' +
          'NOT finer per-endpoint floors enforced at the call site (e.g. ' +
          'MediaSegments is 10.10+ guarded by supportsMediaSegments(), but its ' +
          'builder has no getApiVersion branch, so it tags [1,∞)). Refining those ' +
          'is a later step if the backward floor-coverage check needs it.',
      ],
    },
  };
}

export function serializeManifest(manifest) {
  return JSON.stringify(manifest, null, 2) + '\n';
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const rootDir = positional[0] || '.';
  const checkMode = args.includes('--check');
  const verbose = args.includes('--verbose');

  const verboseSink = verbose ? (msg) => process.stderr.write(msg + '\n') : undefined;
  const manifest = buildManifest(rootDir, { verboseSink });
  const generated = serializeManifest(manifest);
  const outPath = path.join(rootDir, OUTPUT_REL);

  let existing;
  try {
    existing = readFileSync(outPath, 'utf8');
  } catch {
    existing = null;
  }

  const c = manifest.coverage.counts;
  const summary = `${c.endpoints} endpoints, ${c.requestFields} request fields, ${c.responseFields} response fields`;

  if (existing === generated) {
    console.log(`docs:api-manifest: up to date (${summary}).`);
    process.exit(0);
  }

  if (checkMode) {
    console.error(
      `docs:api-manifest drift detected. Run 'npm run docs:api-manifest' to regenerate.\n` +
        `Generated would be: ${summary}.`,
    );
    process.exit(1);
  }

  writeFileSync(outPath, generated, 'utf8');
  console.log(`docs:api-manifest: wrote ${OUTPUT_REL} (${summary}).`);
  process.exit(0);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
