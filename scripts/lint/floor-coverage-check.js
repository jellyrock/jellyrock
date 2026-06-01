// scripts/lint/floor-coverage-check.js — PROACTIVE PR-time floor-coverage lint.
// Phase 6 followup of the server-upgrade-automation pipeline
// (docs/architecture/server-upgrade-automation.md).
//
// The release-triggered server-upgrade digest already runs the floor-coverage
// check (backward + symmetry, minus the endpoint-availability ledger) — but only
// when a NEW Jellyfin release fires it. So a floor gap introduced by JellyRock's
// OWN commit (the app starts calling an endpoint absent from the 10.7.0 floor spec
// without a guard / dispatch-sibling / ledger entry) stays invisible until the next
// upstream release, potentially weeks away. This lint closes that window: it runs the
// SAME floor check on every PR against the committed manifest + floor fingerprint and
// FAILs the moment an unregistered floor gap appears.
//
// It reuses the EXACT pure functions the digest pipeline uses — backwardFindings /
// symmetryFindings / applySuppressions / applyFloorAvailability from
// findings-candidates.js — so the lint's verdict is identical to what the next
// release-triage digest would show for floor findings. There is ONE definition of
// "floor actionable", shared between the proactive lint and the digest. (No forward
// diff: this is floor-only, so diffFingerprints / forwardFindings are never called,
// and there is no network — resolveFingerprint's --fetch path is never reached.)
//
// FAIL POLICY (matches the digest's needsInvestigation set, split by severity):
//   - coverage-gap residual  → FAIL (exit 1). The app calls a floor-included
//     endpoint absent from the floor spec with no ledger entry — a real 404 risk on
//     the oldest supported server. Fix: register it in the endpoint-availability
//     ledger (with a CI-validated version-guard / dispatch-sibling), add a version
//     guard, or stop calling it on the floor tier.
//   - symmetry-advisory residual → WARN (exit 0). Low-severity advisory: a modern-only
//     endpoint whose operation IS present on the floor spec — usually the app already
//     reaches the floor via a V1 sibling the manifest doesn't link, which only a human
//     can disposition. Printed but non-blocking.
//
// ESM (.js), not .cjs, BY NECESSITY: it imports named exports from the ESM
// findings-candidates.js, which a CJS file cannot require(). Matches scripts/CLAUDE.md
// (top-level CLI, no internal callers → .js ESM). version-boundaries.cjs is reached via
// findings-candidates.js's own dependency graph.
//
// Usage:  node scripts/lint/floor-coverage-check.js [--root <dir>] [--json]
// Exit:   0 = clean (no coverage-gap; symmetry advisories only warn) ·
//         1 = at least one unregistered coverage-gap ·
//         2 = internal error (e.g. missing floor fingerprint — a misconfigured repo,
//             NOT a floor gap)

import { createRequire } from 'node:module';
import {
  backwardFindings,
  symmetryFindings,
  applySuppressions,
  applyFloorAvailability,
  readManifest,
  readFingerprint,
  readAvailability,
  readSuppressions,
} from '../generate/findings-candidates.js';

const require = createRequire(import.meta.url);
const { loadBoundaries } = require('../lib/version-boundaries.cjs');

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

// One human-readable line per residual finding: endpoint + the source sites that
// call it + the disposition the dev must add.
function describe(candidate) {
  const sites = candidate.appUsage?.sites ?? [];
  const where = sites.length ? ` [${sites.join(', ')}]` : '';
  return `${candidate.change.detail}${where}`;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const rootDir = flags.root || '.';

  // A missing floor fingerprint throws here → caught at the bottom → exit 2 (internal
  // error), deliberately distinct from a floor gap (exit 1).
  const boundaries = loadBoundaries(rootDir);
  const floorFp = readFingerprint(rootDir, boundaries.floor);
  const manifest = readManifest(rootDir);

  // Same floor candidates the digest builds — then the same two dispositions, in the
  // same order buildReport uses (suppression wins over availability; both force
  // needsInvestigation:false). The residual is exactly the digest's floor actionable set.
  const candidates = [
    ...backwardFindings(manifest, floorFp, boundaries),
    ...symmetryFindings(manifest, floorFp, boundaries),
  ];
  applySuppressions(candidates, readSuppressions(rootDir));
  applyFloorAvailability(candidates, readAvailability(rootDir));

  const residual = candidates.filter((c) => c.needsInvestigation);
  const coverageGapFailures = residual.filter((c) => c.type === 'coverage-gap');
  const symmetryWarnings = residual.filter((c) => c.type === 'symmetry-advisory');

  return finish(flags, { floor: boundaries.floor, coverageGapFailures, symmetryWarnings });
}

function finish(flags, { floor, coverageGapFailures, symmetryWarnings }) {
  if (flags.json) {
    process.stdout.write(
      JSON.stringify(
        {
          floor,
          coverageGapFailures: coverageGapFailures.map((c) => ({
            path: c.change.path,
            method: c.change.method,
            detail: c.change.detail,
            sites: c.appUsage?.sites ?? [],
          })),
          symmetryWarnings: symmetryWarnings.map((c) => ({
            path: c.change.path,
            method: c.change.method,
            detail: c.change.detail,
            sites: c.appUsage?.sites ?? [],
          })),
        },
        null,
        2,
      ) + '\n',
    );
    return coverageGapFailures.length ? 1 : 0;
  }

  // Symmetry advisories are printed (to stderr so they don't pollute a --json-less
  // success on stdout) but never change the exit code.
  for (const w of symmetryWarnings) {
    console.error(`floor-coverage: ⚠ symmetry advisory — ${describe(w)}`);
  }
  if (symmetryWarnings.length) {
    console.error(
      `floor-coverage: ${symmetryWarnings.length} symmetry advisory(ies) above are NOT failures — ` +
        `confirm a lower-tier sibling/fallback covers the floor (or register the endpoint).`,
    );
  }

  if (coverageGapFailures.length === 0) {
    console.log(
      `floor-coverage: OK — no unregistered floor gap against the ${floor} floor` +
        (symmetryWarnings.length ? ` (${symmetryWarnings.length} symmetry advisory warned)` : '') +
        '.',
    );
    return 0;
  }

  console.error(
    `floor-coverage: ${coverageGapFailures.length} unregistered floor gap(s) against the ${floor} floor:`,
  );
  for (const f of coverageGapFailures) console.error(`  - ${describe(f)}`);
  console.error(
    '\nThe app calls an endpoint the oldest supported server lacks, with no disposition. Either:\n' +
      '  - register it in docs/dev/jellyfin-endpoint-availability.yml with a CI-validated\n' +
      '    version-guard (the guard symbol must exist in source/) or dispatch-sibling, or\n' +
      '  - add a version guard around the call, or stop calling it on the floor tier.\n' +
      'See docs/architecture/server-upgrade-automation.md (Phase 6, endpoint-availability ledger).',
  );
  return 1;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`floor-coverage-check: ${err.message}`);
  process.exit(2);
}
