// scripts/server-upgrade-tracker.js — the proactive-CI surface of the
// server-upgrade-automation pipeline (docs/architecture/server-upgrade-automation.md),
// Phase 4 generalized by Phase 6 into the PER-VERSION RELEASE-TRIAGE DIGEST model.
//
// This is the ONE fully-autonomous, zero-judgment surface in the pipeline. A
// scheduled GitHub Actions workflow (.github/workflows/server-upgrade-tracker.yml)
// runs this script, which:
//
//   1. DETECTS whether a newer Jellyfin STABLE release exists than the version
//      JellyRock has acknowledged. Detection is robust whether or not /catchup
//      has run: it fetches the live latest stable (RCs excluded, per the
//      fetcher) and reads `latest_acknowledged` from docs/signals-backlog.md.
//   2. COMPUTES the full mechanical report (the Phase-2 buildReport, including the
//      Phase-6 endpoint-availability ledger so the recurring floor findings are
//      floor-known, not flagged) against an EPHEMERAL, in-memory `to` fingerprint
//      built from the fetched spec — NOTHING is written to the repo. The
//      reviewed-anchor invariant (a committed fingerprint means a human reviewed
//      it) is preserved; the human commits the `to` fingerprint when they run
//      `/server-upgrade`. If the report can't be computed (spec fetch fails / a
//      baseline fingerprint is missing) the tracker DEGRADES to announce-only.
//   3. RENDERS the per-version digest body (server-upgrade.js renderDigestBody) —
//      a mechanical checklist when there are candidates, or the "mechanically
//      clean" record when 0 candidates touch us — and EMITS a decision JSON the
//      workflow uses to open / refresh / open-then-close the ONE digest issue for
//      THIS version (mirroring docs-stale-tracker.yml's lifecycle, but per-version).
//
// LIFECYCLE (Phase 6 — what changed from the single rolling tracker):
//   - There is one digest issue PER server version (label server-upgrade:tracker,
//     found by its version-stamped title). They stack; each is a persistent audit
//     record of what the mechanical pass found for that release.
//   - action 'clean'  → 0 candidates: a judgment-free claim, so CI opens-then-closes
//                       the digest as a record (the only CI close).
//   - action 'triage' → ≥1 candidate: CI opens/refreshes the digest body until the
//                       digest is first triaged (it carries server-upgrade:triaging,
//                       added by /server-upgrade) — then CI HANDS OFF and never
//                       overwrites or closes it. A candidate-bearing digest is closed
//                       only by a human / the skill (acknowledging ≠ work done).
//   - action 'none'   → caught up (acknowledged == latest): do NOTHING. (Phase 4's
//                       "close on caught-up" is REMOVED — that conflated acknowledgment
//                       with work done.)
//
// It NEVER files per-finding issues (that stays human-gated behind
// `/server-upgrade execute`, which files them as sub-issues of the digest) and
// NEVER touches the journals (latest_upstream / last_checked stay /catchup's job).
//
// CLI:
//   node scripts/server-upgrade-tracker.js [--root <dir>] [--signals <path>]
//        [--latest <version>] [--floor <version>] [--to-file <spec.json>]
//        [--tracker-issues <file.json>] [--body-out <file>]
//     --latest         override the live upstream fetch (workflow_dispatch / tests)
//     --to-file        build the `to` fingerprint from a local spec (offline; tests)
//     --tracker-issues gh JSON ([{title,state}]) of the per-version digests; used
//                      to derive "mechanically cleared through" for the body header
//     --body-out       write the rendered issue body markdown to this path
//   → prints decision JSON: { action, version, acknowledged, floor,
//                             needsInvestigation, title, degraded, error }
//     action ∈ { none | clean | triage }
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
  readAvailability,
} from './generate/findings-candidates.js';
import { buildFingerprint } from './generate/spec-fingerprint.js';
import {
  digestTitle,
  renderDigestBody,
  clearedThroughFrom,
  DIGEST_LABEL,
  TRIAGING_LABEL,
} from './server-upgrade.js';

const require = createRequire(import.meta.url);
const { fetchSpec } = require('./lib/spec-fetch.cjs');
const { fetchJellyfinVersions, compareSemverBase } = require('./lib/signals-fetch.cjs');
const { loadBoundaries } = require('./lib/version-boundaries.cjs');

const SIGNALS_REL = 'docs/signals-backlog.md';
const STABLE_SLUG = 'jellyfin-server-stable';
// The per-version digest label, single-sourced from the filer (server-upgrade.js).
const TRACKER_LABEL = DIGEST_LABEL;

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

// 'ahead' when the latest stable is strictly newer than what we've acknowledged;
// 'caught-up' otherwise (equal, or — defensively — acknowledged somehow ahead). A
// non-semver acknowledged value (placeholder) is treated as "behind" so the
// tracker still nudges rather than silently going quiet. The emitted action
// (none/clean/triage) is derived from this plus the report (see main).
export function decideVersionState({ latestStable, acknowledged }) {
  if (!latestStable) return 'caught-up';
  const isSemver = (v) => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
  if (!isSemver(acknowledged)) return 'ahead';
  return compareSemverBase(latestStable, acknowledged) > 0 ? 'ahead' : 'caught-up';
}

// Map (version-state, report) → the emitted digest action.
//   caught-up                       → 'none'   (do nothing; Phase 4's close-on-caught-up is gone)
//   ahead + report unavailable      → 'triage' (announce-only; can't claim clean)
//   ahead + 0 candidates            → 'clean'  (judgment-free → CI opens-then-closes a record)
//   ahead + ≥1 candidate            → 'triage' (CI opens/refreshes until first triage)
export function decideDigestAction(versionState, report) {
  if (versionState === 'caught-up') return 'none';
  if (!report) return 'triage';
  return (report.counts?.needsInvestigation ?? 0) > 0 ? 'triage' : 'clean';
}

// ── Report computation (the only network/IO path) ───────────────────────────────

// Build the full Phase-2 report against an EPHEMERAL in-memory `to` fingerprint.
// `toSpec` may be injected (tests / offline); otherwise the spec is fetched +
// cached. from/floor fingerprints + manifest + suppressions + the Phase-6
// endpoint-availability ledger are read from committed repo state via the exact
// same readers findings-candidates.js uses, so CI can't drift from a local run
// (and the recurring floor findings are floor-known here too, not flagged).
export async function computeReport({ rootDir, from, to, floor, toSpec }) {
  const spec = toSpec ?? (await fetchSpec(to, { rootDir }));
  const toFp = buildFingerprint(spec, { specVersion: to });
  return buildReport({
    fromFp: readFingerprint(rootDir, from),
    toFp,
    floorFp: readFingerprint(rootDir, floor),
    manifest: readManifest(rootDir),
    boundaries: loadBoundaries(rootDir),
    rules: readSuppressions(rootDir),
    availability: readAvailability(rootDir),
  });
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

  const versionState = decideVersionState({ latestStable, acknowledged });
  if (versionState === 'caught-up') {
    emit({ action: 'none', version: latestStable, acknowledged });
    return;
  }

  const boundaries = loadBoundaries(rootDir);
  const floor = flags.floor ?? boundaries.floor;

  let report = null;
  let error = null;
  try {
    const toSpec = flags['to-file']
      ? JSON.parse(readFileSync(flags['to-file'], 'utf8'))
      : undefined;
    report = await computeReport({ rootDir, from: acknowledged, to: latestStable, floor, toSpec });
  } catch (err) {
    error = err.message;
    console.error(`server-upgrade-tracker: report computation degraded — ${err.message}`);
  }

  const action = decideDigestAction(versionState, report);
  const title = digestTitle(latestStable);
  // How far prior releases have been resolved (clean auto-close or human triage),
  // derived from the per-version digest issues the workflow lists and passes in.
  // The CI surface never writes the journals, so the `acknowledged` anchor trails
  // the newest release; `clearedThrough` is what lets the digest report that
  // honestly ("cleared through X") instead of reading as a stale baseline.
  let trackerIssues = [];
  if (flags['tracker-issues']) {
    try {
      trackerIssues = JSON.parse(readFileSync(flags['tracker-issues'], 'utf8'));
    } catch (err) {
      console.error(`server-upgrade-tracker: could not read --tracker-issues — ${err.message}`);
    }
  }
  const clearedThrough = clearedThroughFrom(trackerIssues, latestStable);
  // Render the per-version digest body (mechanical checklist, or the clean record).
  const body = renderDigestBody({
    version: latestStable,
    acknowledged,
    floor,
    report,
    clearedThrough,
  });
  if (flags['body-out']) {
    writeFileSync(flags['body-out'], body);
    console.error(`server-upgrade-tracker: digest body → ${flags['body-out']}`);
  }
  emit({
    action,
    version: latestStable,
    acknowledged,
    clearedThrough,
    floor,
    needsInvestigation: report ? (report.counts?.needsInvestigation ?? 0) : null,
    title,
    triagingLabel: TRIAGING_LABEL,
    trackerLabel: TRACKER_LABEL,
    degraded: report === null,
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
