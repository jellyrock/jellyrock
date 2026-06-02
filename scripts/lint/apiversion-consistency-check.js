// scripts/lint/apiversion-consistency-check.js — static cross-check that the
// BrighterScript twin `resolveApiVersion()` agrees with the committed boundary
// map (docs/dev/jellyfin-version-boundaries.yml).
//
// WHY: a new apiVersion tier touches two sources that MUST stay in lockstep —
// the YAML map (what the server-upgrade tooling reads) and `resolveApiVersion()`
// in source/utils/misc.bs (what the app runs to pick the tier). If they drift,
// the dispatch is dead code or the tooling's tier-relevance analysis lies. This
// lint makes that invariant machine-checkable OFFLINE, so standing up a tier
// (the /new-api-version skill) doesn't depend on running Roku hardware unit tests.
//
// HOW: parses misc.bs with the SAME BrighterScript AST the api-usage-manifest
// generator uses (robust to comments/formatting, unlike a raw regex), extracts
// the ordered `if versionChecker(serverVersion, "X.Y.Z") return N` guards plus
// the fallback `return M`, and asserts they match the boundary map: every tier
// above the lowest has a guard at its `minServer` returning that tier, ordered
// highest-version-first, and the lowest tier is the fallback.
//
// `.js` (ESM) per scripts/CLAUDE.md: a top-level CLI with no internal .cjs
// callers. Loads brighterscript via import (same as api-usage-manifest.js) and
// the boundary loader via createRequire (the .cjs lib pattern).
//
// CLI: node scripts/lint/apiversion-consistency-check.js [--root <dir>]
//   exit 0 = consistent; exit 1 = drift (mismatches printed); exit 2 = parse error.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as bs from 'brighterscript';

const require = createRequire(import.meta.url);
const { loadBoundaries } = require('../lib/version-boundaries.cjs');

const MISC_REL = 'source/utils/misc.bs';
const FN_NAME = 'resolveApiVersion';

// ── tiny AST literal readers (mirror api-usage-manifest.js) ───────────────────

function unquote(text) {
  return text && (text[0] === '"' || text[0] === "'") ? text.slice(1, -1) : text;
}

function calleeName(call) {
  return call?.callee?.tokens?.name?.text ?? null;
}

function stringLiteral(node) {
  if (!node || !bs.isLiteralExpression(node)) return null;
  const t = node.tokens?.value?.text;
  if (typeof t !== 'string' || (t[0] !== '"' && t[0] !== "'")) return null;
  return unquote(t);
}

function intLiteral(node) {
  if (!node || !bs.isLiteralExpression(node)) return null;
  const t = node.tokens?.value?.text;
  if (typeof t !== 'string' || !/^\d+$/.test(t.trim())) return null;
  return parseInt(t, 10);
}

// ── extraction ────────────────────────────────────────────────────────────────

// Pull the ordered version guards + fallback tier out of resolveApiVersion's AST.
// Returns { guards: [{ minVersion, tier }] (source order, top→bottom), fallback }.
// Exported for the unit tests (fed a parsed AST from a fixture .bs string).
export function extractResolveApiVersion(ast) {
  let fnExpr = null;
  ast.walk(
    (node) => {
      if (bs.isFunctionStatement(node) && node.tokens?.name?.text === FN_NAME) {
        fnExpr = node.func;
      }
    },
    { walkMode: bs.WalkMode.visitAllRecursive },
  );
  if (!fnExpr) throw new Error(`${FN_NAME}() not found in ${MISC_REL}`);

  const guards = [];
  let fallback = null;
  for (const stmt of fnExpr.body?.statements ?? []) {
    if (bs.isIfStatement(stmt)) {
      const cond = stmt.condition;
      if (
        bs.isCallExpression(cond) &&
        (calleeName(cond) ?? '').toLowerCase() === 'versionchecker'
      ) {
        const minVersion = stringLiteral(cond.args?.[1]);
        const ret = (stmt.thenBranch?.statements ?? []).find((s) => bs.isReturnStatement(s));
        const tier = ret ? intLiteral(ret.value) : null;
        if (minVersion != null && tier != null) guards.push({ minVersion, tier });
      }
    } else if (bs.isReturnStatement(stmt)) {
      const v = intLiteral(stmt.value);
      if (v != null) fallback = v;
    }
  }
  return { guards, fallback };
}

// ── comparison ────────────────────────────────────────────────────────────────

// Compare the extracted guards/fallback against the boundary map. Returns a list
// of human-readable problem strings (empty == consistent). Pure + exported.
export function diffAgainstBoundaries({ guards, fallback }, boundaries) {
  const problems = [];
  const tierKeys = Object.keys(boundaries.tiers)
    .map((k) => parseInt(k, 10))
    .sort((a, b) => a - b);
  const lowest = tierKeys[0];
  const upper = tierKeys.filter((t) => t !== lowest); // tiers that need a guard

  // 1. Fallback must be the lowest tier (returned when no guard matches).
  if (fallback !== lowest) {
    problems.push(
      `fallback return is ${fallback ?? '(none)'}, expected ${lowest} (the lowest tier, returned when no versionChecker guard matches)`,
    );
  }

  // 2. Every upper tier needs exactly one guard at its minServer returning it.
  const guardByTier = new Map(guards.map((g) => [g.tier, g]));
  for (const t of upper) {
    const want = boundaries.tiers[String(t)].minServer;
    const got = guardByTier.get(t);
    if (!got) {
      problems.push(
        `missing guard for tier ${t}: expected versionChecker(serverVersion, "${want}") return ${t}`,
      );
    } else if (got.minVersion !== want) {
      problems.push(
        `tier ${t} guard checks "${got.minVersion}" but boundary map minServer is "${want}" — they must match`,
      );
    }
  }

  // 3. No guard should target a tier the map doesn't define above the lowest.
  for (const g of guards) {
    if (!upper.includes(g.tier)) {
      problems.push(
        `guard returns tier ${g.tier} (version "${g.minVersion}") but the boundary map has no such non-floor tier`,
      );
    }
  }

  // 4. Order: guards must be descending by tier (highest version first) so the
  //    top matching guard wins; an ascending order would mis-route.
  const orderedTiers = guards.map((g) => g.tier);
  const descending = [...orderedTiers].sort((a, b) => b - a);
  if (orderedTiers.join(',') !== descending.join(',')) {
    problems.push(
      `guards are out of order (${orderedTiers.join(', ')}); they must be highest-tier-first (${descending.join(', ')}) or a lower threshold matches first`,
    );
  }

  return problems;
}

// ── CLI ────────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf('--root');
  const rootDir = rootIdx >= 0 ? argv[rootIdx + 1] : '.';

  const boundaries = loadBoundaries(rootDir);
  const src = readFileSync(path.join(rootDir, MISC_REL), 'utf8');

  let extracted;
  try {
    extracted = extractResolveApiVersion(bs.Parser.parse(src).ast);
  } catch (err) {
    console.error(`apiversion-consistency: ${err.message}`);
    process.exit(2);
  }

  const problems = diffAgainstBoundaries(extracted, boundaries);
  if (problems.length === 0) {
    const tiers = Object.keys(boundaries.tiers).length;
    console.log(
      `apiversion-consistency: resolveApiVersion() matches the ${tiers}-tier boundary map ✓`,
    );
    return;
  }
  console.error(
    `apiversion-consistency: resolveApiVersion() drifted from ${path.join('docs/dev', 'jellyfin-version-boundaries.yml')}:`,
  );
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nFix: keep source/utils/misc.bs resolveApiVersion() and the boundary map in lockstep (see /new-api-version).',
  );
  process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
