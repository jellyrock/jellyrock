// scripts/server-upgrade-tracker.js: the proactive-CI surface of the
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
//      fetcher) and takes the acknowledged version from reviewedAnchor() (the
//      newest committed stable fingerprint).
//   2. COMPUTES the full mechanical report (the Phase-2 buildReport, including the
//      Phase-6 endpoint-availability ledger so the recurring floor findings are
//      floor-known, not flagged) against an EPHEMERAL, in-memory `to` fingerprint
//      built from the fetched spec. Nothing is written to the repo. The
//      reviewed-anchor invariant (a committed fingerprint means a human reviewed
//      it) is preserved; the human commits the `to` fingerprint when they run
//      `/server-upgrade`. If the report can't be computed (spec fetch fails / a
//      baseline fingerprint is missing) the tracker DEGRADES to announce-only.
//   3. RENDERS the per-version digest body (server-upgrade.js renderDigestBody):
//      a mechanical checklist when there are candidates, or the "mechanically
//      clean" record when 0 candidates touch us. It then EMITS a decision JSON the
//      workflow uses to open / refresh / open-then-close the ONE digest issue for
//      THIS version (mirroring docs-stale-tracker.yml's lifecycle, but per-version).
//
// LIFECYCLE (Phase 6: what changed from the single rolling tracker):
//   - There is one digest issue PER server version (label server-upgrade:tracker,
//     found by its version-stamped title). They stack; each is a persistent audit
//     record of what the mechanical pass found for that release.
//   - action 'clean':  0 candidates: a judgment-free claim, so CI opens-then-closes
//                       the digest as a record (the only CI close).
//   - action 'triage': ≥1 candidate: CI opens/refreshes the digest body until the
//                       digest is first triaged (it carries server-upgrade:triaging,
//                       added by /server-upgrade). Then CI HANDS OFF and never
//                       overwrites or closes it. A candidate-bearing digest is closed
//                       only by a human / the skill (acknowledging ≠ work done).
//   - action 'none':   caught up (acknowledged == latest): do nothing. (Phase 4's
//                       "close on caught-up" is removed: it conflated acknowledgment
//                       with work done.)
//
// It never files per-finding issues (that stays human-gated behind
// `/server-upgrade execute`, which files them as sub-issues of the digest) and
// never touches the journals.
//
// CLI:
//   node scripts/server-upgrade-tracker.js [--root <dir>]
//        [--latest <version>] [--floor <version>] [--to-file <spec.json>]
//        [--tracker-issues <file.json>] [--body-out <file>]
//        [--rc <version>] [--rc-issues <file.json>] [--rc-body-out <file>]
//     --latest         override the live upstream fetch (workflow_dispatch / tests)
//     --to-file        build the `to` fingerprint from a local spec (offline; tests)
//     --tracker-issues gh JSON ([{title,state}]) of the per-version digests; used
//                      to derive "mechanically cleared through" for the body header
//     --body-out       write the rendered issue body markdown to this path
//     --rc             the RC in flight, used only with --latest (tests / dispatch)
//     --rc-issues      gh JSON ([{title}]) of the RC_LABEL issues, for decideRc()
//     --rc-body-out    write the RC issue body to this path when an RC is in flight
//   Prints decision JSON: { action, version, acknowledged, clearedThrough, floor,
//                           needsInvestigation, title, triagingLabel,
//                           trackerLabel, degraded, error, rc, rcLabel }
//     rc is null, or { version, title, from } for the release candidate in flight.
//     action ∈ { none | clean | triage }; a 'none' decision carries only
//     action, version, acknowledged, rc and rcLabel.
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
import { buildFingerprint, reviewedAnchor } from './generate/spec-fingerprint.js';
import {
  TITLE_PREFIX,
  digestTitle,
  renderDigestBody,
  clearedThroughFrom,
  DIGEST_LABEL,
  TRIAGING_LABEL,
} from './server-upgrade.js';

const require = createRequire(import.meta.url);
const { fetchSpec } = require('./lib/spec-fetch.cjs');
const {
  fetchJellyfinVersions,
  compareSemverBase,
  isReleaseVersionBase,
} = require('./lib/signals-fetch.cjs');
const { loadBoundaries } = require('./lib/version-boundaries.cjs');

// The per-version digest label, single-sourced from the filer (server-upgrade.js).
const TRACKER_LABEL = DIGEST_LABEL;

// ── Decision ──────────────────────────────────────────────────────────────────

// 'ahead' when the latest stable is strictly newer than what we've acknowledged;
// 'caught-up' otherwise (equal, or, defensively, acknowledged somehow ahead). A
// non-semver acknowledged value (placeholder) is treated as "behind" so the
// tracker still nudges rather than silently going quiet. The emitted action
// (none/clean/triage) is derived from this plus the report (see main).
export function decideVersionState({ latestStable, acknowledged }) {
  if (!latestStable) return 'caught-up';
  if (!isReleaseVersionBase(acknowledged)) return 'ahead';
  return compareSemverBase(latestStable, acknowledged) > 0 ? 'ahead' : 'caught-up';
}

// Map (version-state, report) to the emitted digest action.
//   caught-up                       gives 'none'   (do nothing; Phase 4's close-on-caught-up is gone)
//   ahead + report unavailable      gives 'triage' (announce-only; can't claim clean)
//   ahead + 0 candidates            gives 'clean'  (judgment-free, so CI opens-then-closes a record)
//   ahead + ≥1 candidate            gives 'triage' (CI opens/refreshes until first triage)
export function decideDigestAction(versionState, report) {
  if (versionState === 'caught-up') return 'none';
  if (!report) return 'triage';
  return (report.counts?.needsInvestigation ?? 0) > 0 ? 'triage' : 'clean';
}

// ── Release candidates ───────────────────────────────────────────────────────

// The label on the one issue CI opens per Jellyfin release candidate. It replaces
// the old jellyfin-server-rc journal row: closing the issue is the acknowledgment.
export const RC_LABEL = 'server-upgrade:rc';

export function rcTitle(version) {
  return `${TITLE_PREFIX} Jellyfin ${version} — release candidate`;
}

const RC_TITLE_RE =
  /^\[server-upgrade\] Jellyfin (\d+\.\d+(?:\.\d+)?)-(rc|beta|alpha)(\d+) — release candidate$/;

// Where the RC's diff starts: the newest earlier pre-release of the same base
// version that already has an issue (so rc2 diffs from rc1 and shows only what
// changed since), else the reviewed stable anchor. Returns null when no RC is in
// flight. `rcIssues` is gh JSON ([{title}]) of the issues carrying RC_LABEL.
export function decideRc({ rc, anchor, rcIssues = [] }) {
  if (!rc) return null;
  const m = rc.match(/^(.+)-[a-z]+(\d+)$/);
  if (!m) return null;
  const [, base, n] = m;
  let from = anchor;
  let best = -1;
  for (const issue of rcIssues) {
    const hit = String(issue.title ?? '').match(RC_TITLE_RE);
    if (!hit || hit[1] !== base) continue;
    const k = parseInt(hit[3], 10);
    if (k < parseInt(n, 10) && k > best) {
      best = k;
      from = `${hit[1]}-${hit[2]}${hit[3]}`;
    }
  }
  return { version: rc, title: rcTitle(rc), from };
}

export function renderRcBody({ version, from }) {
  return [
    `Jellyfin published release candidate **${version}**.`,
    '',
    `Triage it locally with \`/server-upgrade ${from} ${version}\`. A release candidate takes the local path: findings go to a \`.claude/handoffs/\` note and nothing is filed until the stable release.`,
    '',
    'Close this issue once it is triaged. Closing it is the acknowledgment; the next release candidate of this version diffs from this one.',
    '',
    '_Opened by `.github/workflows/server-upgrade-tracker.yml`._',
    '',
  ].join('\n');
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
  const acknowledged = reviewedAnchor(rootDir);
  if (!acknowledged) {
    throw new Error(`server-upgrade-tracker: no committed stable fingerprint under ${rootDir}`);
  }

  // Live latest stable and RC in flight, unless --latest overrides (then the RC
  // comes only from --rc, so tests and workflow_dispatch stay offline).
  const live = flags.latest ? null : await fetchJellyfinVersions();
  const latestStable = flags.latest ?? live.stable;
  const rcVersion = flags.latest ? (typeof flags.rc === 'string' ? flags.rc : null) : live.rc;
  const rc = decideRc({
    rc: rcVersion,
    anchor: acknowledged,
    rcIssues: readJsonFlag(flags, 'rc-issues'),
  });
  if (rc && flags['rc-body-out']) writeFileSync(flags['rc-body-out'], renderRcBody(rc));

  const versionState = decideVersionState({ latestStable, acknowledged });
  if (versionState === 'caught-up') {
    emit({ action: 'none', version: latestStable, acknowledged, rc, rcLabel: RC_LABEL });
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
  const trackerIssues = readJsonFlag(flags, 'tracker-issues');
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
    rc,
    rcLabel: RC_LABEL,
  });
}

// Read a gh JSON list passed by path in --<name>; [] when absent or unreadable.
function readJsonFlag(flags, name) {
  if (!flags[name]) return [];
  try {
    return JSON.parse(readFileSync(flags[name], 'utf8'));
  } catch (err) {
    console.error(`server-upgrade-tracker: could not read --${name} — ${err.message}`);
    return [];
  }
}

// Single-line JSON on stdout: the workflow parses it with jq. Human-readable
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
