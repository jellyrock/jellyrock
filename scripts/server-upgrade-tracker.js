// scripts/server-upgrade-tracker.js — Phase 4 (proactive CI) of the
// server-upgrade-automation pipeline (docs/architecture/server-upgrade-automation.md).
//
// This is the ONE fully-autonomous, zero-judgment surface in the pipeline. A
// scheduled GitHub Actions workflow (.github/workflows/server-upgrade-tracker.yml)
// runs this script, which:
//
//   1. DETECTS whether a newer Jellyfin STABLE release exists than the version
//      JellyRock has acknowledged. Detection is robust whether or not /catchup
//      has run: it fetches the live latest stable (RCs excluded, per the
//      fetcher) and reads `latest_acknowledged` from docs/signals-backlog.md.
//   2. COMPUTES the mechanical candidate counts (breaking / opportunity /
//      coverage-gap / symmetry-advisory / needsInvestigation) by running the Phase-2 report against
//      an EPHEMERAL, in-memory `to` fingerprint built from the fetched spec —
//      NOTHING is written to the repo. The reviewed-anchor invariant (a
//      committed fingerprint means a human reviewed it) is preserved; the human
//      commits the `to` fingerprint when they run `/server-upgrade`. If counts
//      can't be computed (spec fetch fails / a baseline fingerprint is missing)
//      the tracker DEGRADES to announce-only rather than hard-failing.
//   3. EMITS a one-line decision JSON to stdout + writes the issue body to a
//      file. The workflow does the gh issue create/edit/close plumbing
//      (mirroring docs-stale-tracker.yml's single-tracker-issue lifecycle).
//
// It NEVER files per-finding issues (that stays human-gated behind
// `/server-upgrade execute`) and NEVER touches the journals (latest_upstream /
// last_checked stay /catchup's job). It only maintains ONE tracker issue.
//
// CLI:
//   node scripts/server-upgrade-tracker.js [--root <dir>] [--signals <path>]
//        [--latest <version>] [--floor <version>] [--to-file <spec.json>]
//        [--body-out <file>]
//     --latest   override the live upstream fetch (workflow_dispatch / tests)
//     --to-file  build the `to` fingerprint from a local spec (offline; tests)
//     --body-out write the rendered issue body markdown to this path
//   → prints decision JSON: { action, version, acknowledged, floor, counts,
//                             title, degraded, error }
//     action ∈ { announce | caught-up }
//
// Pure parts (parse / decide / render) are named exports so the Vitest suite at
// tests/scripts/unit/server-upgrade-tracker.test.js drives them offline.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import {
  buildReport,
  readFingerprint,
  readManifest,
  readSuppressions,
} from './generate/findings-candidates.js';
import { buildFingerprint } from './generate/spec-fingerprint.js';

const require = createRequire(import.meta.url);
const { fetchSpec } = require('./lib/spec-fetch.cjs');
const { fetchJellyfinVersions, compareSemverBase } = require('./lib/signals-fetch.cjs');
const { loadBoundaries } = require('./lib/version-boundaries.cjs');

const SIGNALS_REL = 'docs/signals-backlog.md';
const STABLE_SLUG = 'jellyfin-server-stable';
const TRACKER_LABEL = 'server-upgrade:tracker';

// ── Signal parsing ────────────────────────────────────────────────────────────

// Parse the jellyfin-server-stable row out of signals-backlog.md. Mirrors the
// H3-slug + `- **key**: value` parser in scripts/catchup-state.js (code fences
// skipped). Returns { latest_acknowledged, latest_upstream, status } or null if
// the row is absent.
export function parseStableSignal(markdown) {
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let inRow = false;
  const bullets = {};
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const h3 = line.match(/^###\s+([a-z0-9][a-z0-9-]*)\s*:/);
    if (h3) {
      if (inRow) break; // next row starts → we already captured ours
      inRow = h3[1] === STABLE_SLUG;
      continue;
    }
    if (/^##\s+/.test(line) && inRow) break; // a new H2 closes the row
    if (!inRow) continue;

    const bullet = line.match(/^-\s+\*\*([a-z_]+)\*\*:\s*(.+?)\s*$/);
    if (bullet) bullets[bullet[1]] = bullet[2];
  }
  if (Object.keys(bullets).length === 0) return null;
  return {
    latest_acknowledged: bullets.latest_acknowledged ?? null,
    latest_upstream: bullets.latest_upstream ?? null,
    status: bullets.status ?? null,
  };
}

// ── Decision ──────────────────────────────────────────────────────────────────

// 'announce' when the latest stable is strictly newer than what we've
// acknowledged; 'caught-up' otherwise (equal, or — defensively — acknowledged
// somehow ahead). A non-semver acknowledged value (placeholder) is treated as
// "behind" so the tracker still nudges rather than silently going quiet.
export function decideAction({ latestStable, acknowledged }) {
  if (!latestStable) return 'caught-up';
  const isSemver = (v) => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
  if (!isSemver(acknowledged)) return 'announce';
  return compareSemverBase(latestStable, acknowledged) > 0 ? 'announce' : 'caught-up';
}

// ── Rendering ───────────────────────────────────────────────────────────────────

export function renderTrackerTitle(version) {
  return `🔔 Jellyfin ${version} available — run /server-upgrade to triage`;
}

// The tracker issue body. `counts` is the Phase-2 report's counts block, or null
// when count computation degraded (announce-only fallback); `error` carries the
// degradation reason in that case.
export function renderTrackerBody({ version, acknowledged, floor, counts, error }) {
  const lines = [];
  lines.push(
    'A new Jellyfin **stable** release is available upstream, past the version ' +
      'JellyRock has acknowledged.',
  );
  lines.push('');
  lines.push('| | Version |');
  lines.push('| --- | --- |');
  lines.push(`| Latest stable (upstream) | \`${version}\` |`);
  lines.push(`| Acknowledged (\`signals-backlog.md\`) | \`${acknowledged ?? 'unknown'}\` |`);
  lines.push(`| Supported floor | \`${floor ?? 'unknown'}\` |`);
  lines.push('');

  if (counts) {
    lines.push(
      '**Candidate counts** — a mechanical first pass over ' +
        `\`${acknowledged} → ${version}\` (+ floor coverage). These are NOT ` +
        'verdicts:',
    );
    lines.push('');
    lines.push(`- 🔴 **${counts.breaking ?? 0}** breaking candidate(s)`);
    lines.push(`- 🟢 **${counts.opportunity ?? 0}** opportunit(y/ies)`);
    lines.push(`- 🟡 **${counts['coverage-gap'] ?? 0}** floor coverage-gap(s)`);
    lines.push(`- 🔵 **${counts['symmetry-advisory'] ?? 0}** coverage-symmetry advisor(y/ies)`);
    lines.push(`- 🔎 **${counts.needsInvestigation ?? 0}** total needing investigation`);
    if (counts.suppressed) lines.push(`- 🔇 ${counts.suppressed} suppressed (accepted churn)`);
    lines.push('');
    lines.push(
      '> The `/server-upgrade` agent investigates each candidate against real ' +
        'app usage and decides what (if anything) to file. A coverage-gap is ' +
        'often dispositioned by a capability guard, not a real break.',
    );
  } else {
    lines.push(
      `**Candidate counts**: _unavailable this run_${error ? ` (${error})` : ''}. ` +
        'The release is still worth triaging — `/server-upgrade` generates the ' +
        'report locally.',
    );
  }

  lines.push('');
  lines.push('## Next step');
  lines.push('');
  lines.push('Run **`/server-upgrade`** to triage this release. The skill will:');
  lines.push('');
  lines.push(
    `1. Commit the \`${version}\` spec fingerprint ` +
      `(\`node scripts/generate/spec-fingerprint.js ${version}\`) — the reviewed ` +
      'anchor these counts were computed from ephemerally in CI.',
  );
  lines.push(
    '2. Generate the Phase-2 data report, investigate each candidate, and ' +
      '(human-gated) file/dedup the issues that actually affect us.',
  );
  lines.push('');
  lines.push(
    `When you've reviewed the release, run \`/done ${STABLE_SLUG}\` to bump ` +
      '`latest_acknowledged` — this tracker closes automatically on the next run.',
  );
  lines.push('');
  lines.push('---');
  lines.push(
    '_Auto-generated by `.github/workflows/server-upgrade-tracker.yml`. Edits to ' +
      'this body are overwritten on the next run; counts are recomputed from an ' +
      'ephemeral in-CI fingerprint and are never committed. See ' +
      '`docs/architecture/server-upgrade-automation.md`._',
  );
  return lines.join('\n') + '\n';
}

// ── Count computation (the only network/IO path) ───────────────────────────────

// Build the Phase-2 report against an EPHEMERAL in-memory `to` fingerprint and
// return its counts block. `toSpec` may be injected (tests / offline); otherwise
// the spec is fetched + cached. `from`/`floor` fingerprints + manifest +
// suppressions are read from committed repo state via the exact same readers
// findings-candidates.js uses.
export async function computeCounts({ rootDir, from, to, floor, toSpec }) {
  const spec = toSpec ?? (await fetchSpec(to, { rootDir }));
  const toFp = buildFingerprint(spec, { specVersion: to });
  const report = buildReport({
    fromFp: readFingerprint(rootDir, from),
    toFp,
    floorFp: readFingerprint(rootDir, floor),
    manifest: readManifest(rootDir),
    boundaries: loadBoundaries(rootDir),
    rules: readSuppressions(rootDir),
  });
  return report.counts;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

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

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const rootDir = flags.root ?? '.';
  const signalsPath = flags.signals ?? `${rootDir}/${SIGNALS_REL}`;

  const signal = parseStableSignal(readFileSync(signalsPath, 'utf8'));
  if (!signal) {
    throw new Error(`server-upgrade-tracker: no '${STABLE_SLUG}' row in ${signalsPath}`);
  }
  const acknowledged = signal.latest_acknowledged;

  // Live latest stable (RCs excluded by fetchJellyfinVersions), unless overridden.
  const latestStable = flags.latest ?? (await fetchJellyfinVersions()).stable;

  const action = decideAction({ latestStable, acknowledged });
  if (action === 'caught-up') {
    emit({ action, version: latestStable, acknowledged });
    return;
  }

  const boundaries = loadBoundaries(rootDir);
  const floor = flags.floor ?? boundaries.floor;

  let counts = null;
  let error = null;
  try {
    const toSpec = flags['to-file']
      ? JSON.parse(readFileSync(flags['to-file'], 'utf8'))
      : undefined;
    counts = await computeCounts({ rootDir, from: acknowledged, to: latestStable, floor, toSpec });
  } catch (err) {
    error = err.message;
    console.error(`server-upgrade-tracker: count computation degraded — ${err.message}`);
  }

  const title = renderTrackerTitle(latestStable);
  const body = renderTrackerBody({ version: latestStable, acknowledged, floor, counts, error });
  if (flags['body-out']) {
    writeFileSync(flags['body-out'], body);
    console.error(`server-upgrade-tracker: issue body → ${flags['body-out']}`);
  }
  emit({
    action,
    version: latestStable,
    acknowledged,
    floor,
    counts,
    title,
    degraded: counts === null,
    error,
  });
}

// Single-line JSON on stdout — the workflow parses it with jq. Human-readable
// progress goes to stderr so stdout stays pure.
function emit(decision) {
  process.stdout.write(JSON.stringify(decision) + '\n');
}

export { TRACKER_LABEL };

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(`server-upgrade-tracker: ${err.message}`);
    process.exit(1);
  });
}
