// Tests for scripts/server-upgrade-tracker.js: the proactive-CI surface,
// Phase 4 generalized by Phase 6 into the PER-VERSION release-triage DIGEST model.
//
// The pure parts (version-state + digest-action decisions) are
// exercised directly. The report-computation + CLI path is driven OFFLINE via
// --to-file (an injected `to` spec) against tiny hand-written committed inputs
// (from/floor fingerprints + manifest + boundaries + suppressions + the
// endpoint-availability ledger), mirroring the findings-candidates CLI test. No
// network, no GitHub writes.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from './_helpers/spawn-script.js';
import {
  decideRc,
  rcTitle,
  renderRcBody,
  decideVersionState,
  decideDigestAction,
  computeReport,
} from '../../../scripts/server-upgrade-tracker.js';

const SCRIPT = 'scripts/server-upgrade-tracker.js';

describe('decideRc: the release-candidate issue', () => {
  it('is null when no RC is in flight', () => {
    expect(decideRc({ rc: null, anchor: '12.0' })).toBeNull();
  });

  it('diffs the first RC of a version from the reviewed anchor', () => {
    expect(decideRc({ rc: '12.3-rc1', anchor: '12.0', rcIssues: [] })).toEqual({
      version: '12.3-rc1',
      title: '[server-upgrade] Jellyfin 12.3-rc1 — release candidate',
      from: '12.0',
    });
  });

  it('diffs a later RC from the newest earlier RC of the same version', () => {
    const rcIssues = ['12.3-rc1', '12.3-rc2', '12.2-rc4', '12.3-rc3'].map((v) => ({
      title: rcTitle(v),
    }));
    expect(decideRc({ rc: '12.3-rc3', anchor: '12.0', rcIssues }).from).toBe('12.3-rc2');
  });

  it('ignores issues whose title is not an RC title', () => {
    const rcIssues = [{ title: 'Jellyfin 12.3-rc1 notes' }];
    expect(decideRc({ rc: '12.3-rc2', anchor: '12.0', rcIssues }).from).toBe('12.0');
  });

  it('renders a body naming the exact /server-upgrade command', () => {
    expect(renderRcBody({ version: '12.3-rc2', from: '12.3-rc1' })).toContain(
      '`/server-upgrade 12.3-rc1 12.3-rc2`',
    );
  });
});

describe('decideVersionState', () => {
  it('is ahead when latest stable is strictly newer than acknowledged', () => {
    expect(decideVersionState({ latestStable: '10.11.10', acknowledged: '10.11.8' })).toBe('ahead');
    expect(decideVersionState({ latestStable: '10.12.0', acknowledged: '10.11.10' })).toBe('ahead');
  });

  it('is caught-up when equal or acknowledged is ahead', () => {
    expect(decideVersionState({ latestStable: '10.11.10', acknowledged: '10.11.10' })).toBe(
      'caught-up',
    );
    expect(decideVersionState({ latestStable: '10.11.8', acknowledged: '10.11.10' })).toBe(
      'caught-up',
    );
  });

  it('treats a patchless acknowledged release (12.0) as a real version, not a placeholder', () => {
    expect(decideVersionState({ latestStable: '12.0', acknowledged: '12.0' })).toBe('caught-up');
    expect(decideVersionState({ latestStable: '12.0.1', acknowledged: '12.0' })).toBe('ahead');
  });

  it('is ahead when acknowledged is a non-semver placeholder (nudge rather than go quiet)', () => {
    expect(decideVersionState({ latestStable: '10.11.10', acknowledged: '(none)' })).toBe('ahead');
  });

  it('is caught-up when there is no latest stable', () => {
    expect(decideVersionState({ latestStable: null, acknowledged: '10.11.8' })).toBe('caught-up');
  });
});

describe('decideDigestAction', () => {
  it("caught-up → 'none' regardless of report", () => {
    expect(decideDigestAction('caught-up', null)).toBe('none');
    expect(decideDigestAction('caught-up', { counts: { needsInvestigation: 5 } })).toBe('none');
  });

  it("ahead + ≥1 candidate → 'triage'", () => {
    expect(decideDigestAction('ahead', { counts: { needsInvestigation: 3 } })).toBe('triage');
  });

  it("ahead + 0 candidates → 'clean'", () => {
    expect(decideDigestAction('ahead', { counts: { needsInvestigation: 0 } })).toBe('clean');
  });

  it("ahead + report unavailable (degraded) → 'triage' (can't claim clean)", () => {
    expect(decideDigestAction('ahead', null)).toBe('triage');
  });
});

// ── Offline report computation + CLI ─────────────────────────────────────────

const BOUNDARIES_YML =
  'floor: "10.7.0"\ntiers:\n  1:\n    minServer: "10.7.0"\n    maxServer: "10.8.13"\n    status: frozen\n  2:\n    minServer: "10.9.0"\n    maxServer: null\n    status: active\n';

function fp(specVersion, operations = {}) {
  return { schemaVersion: 1, specVersion, operations, schemas: {} };
}

// `to` spec that drops /Items/{itemId} GET vs the `from` fingerprint: a breaking
// candidate on a used active-tier endpoint (needsInvestigation ≥ 1 means triage).
const TO_SPEC_TRIAGE = {
  info: { version: '10.11.10' },
  paths: {
    '/Users/{userId}/Items': { get: { parameters: [], responses: { 200: {} } } },
  },
  components: { schemas: {} },
};

// `to` spec that keeps /Items/{itemId} GET: no forward break; with no floor gaps
// the report is mechanically clean (needsInvestigation 0 means clean).
const TO_SPEC_CLEAN = {
  info: { version: '10.11.10' },
  paths: {
    '/Users/{userId}/Items': { get: { parameters: [], responses: { 200: {} } } },
    '/Items/{itemId}': { get: { parameters: [], responses: { 200: {} } } },
  },
  components: { schemas: {} },
};

describe('computeReport + CLI (offline, injected toSpec)', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function scaffoldRepo({ availability = 'endpoints: []\n' } = {}) {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-su-tracker-'));
    const write = (rel, obj) => {
      const full = join(dir, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, typeof obj === 'string' ? obj : JSON.stringify(obj));
    };
    const fpRel = (v) => `docs/architecture/spec-fingerprints/jellyfin-${v}.json`;
    write(fpRel('10.7.0'), fp('10.7.0', { 'GET /Users/{userId}/Items': { parameters: [] } }));
    write(
      fpRel('10.11.8'),
      fp('10.11.8', {
        'GET /Users/{userId}/Items': { parameters: [] },
        'GET /Items/{itemId}': { parameters: [] },
      }),
    );
    write('docs/architecture/api-usage-manifest.json', {
      endpoints: [
        {
          path: '/Items/{0}',
          normalized: '/items/{}',
          methods: ['GET'],
          minApiVersion: 2,
          maxApiVersion: null,
          sourceFiles: ['source/api/ApiClient.bs'],
        },
      ],
      requestFields: [],
      responseFields: [],
    });
    write('docs/dev/jellyfin-version-boundaries.yml', BOUNDARIES_YML);
    write('.api-watch/suppressions.yml', 'rules: []\n');
    write('docs/dev/jellyfin-endpoint-availability.yml', availability);
  }

  it('runs the Phase-2 report against an ephemeral to fingerprint', async () => {
    scaffoldRepo();
    const report = await computeReport({
      rootDir: dir,
      from: '10.11.8',
      to: '10.11.10',
      floor: '10.7.0',
      toSpec: TO_SPEC_TRIAGE,
    });
    expect(report.counts.breaking).toBeGreaterThanOrEqual(1);
    expect(report.counts.needsInvestigation).toBeGreaterThanOrEqual(1);
  });

  it("CLI --latest + --to-file emits a 'triage' decision with the per-version digest title; no repo write", () => {
    scaffoldRepo();
    const bodyOut = join(dir, 'body.md');
    const toFile = join(dir, 'to-spec.json');
    writeFileSync(toFile, JSON.stringify(TO_SPEC_TRIAGE));

    const res = spawnScript(SCRIPT, [
      '--root',
      dir,
      '--latest',
      '10.11.10',
      '--to-file',
      toFile,
      '--body-out',
      bodyOut,
    ]);
    expect(res.exitCode).toBe(0);
    const decision = JSON.parse(res.stdout);
    expect(decision.action).toBe('triage');
    expect(decision.version).toBe('10.11.10');
    expect(decision.acknowledged).toBe('10.11.8');
    expect(decision.degraded).toBe(false);
    expect(decision.needsInvestigation).toBeGreaterThanOrEqual(1);
    expect(decision.title).toContain('10.11.10');
    expect(decision.title).toContain('release triage');
    expect(decision.trackerLabel).toBe('server-upgrade:tracker');
    expect(decision.triagingLabel).toBe('server-upgrade:triaging');
  });

  it("CLI emits 'clean' when nothing JellyRock uses changed (0 candidates)", () => {
    scaffoldRepo();
    const toFile = join(dir, 'to-spec.json');
    writeFileSync(toFile, JSON.stringify(TO_SPEC_CLEAN));
    const res = spawnScript(SCRIPT, ['--root', dir, '--latest', '10.11.10', '--to-file', toFile]);
    expect(res.exitCode).toBe(0);
    const decision = JSON.parse(res.stdout);
    expect(decision.action).toBe('clean');
    expect(decision.needsInvestigation).toBe(0);
  });

  it('CLI --tracker-issues feeds clearedThrough into the decision + the rendered body', () => {
    scaffoldRepo();
    const bodyOut = join(dir, 'body.md');
    const toFile = join(dir, 'to-spec.json');
    writeFileSync(toFile, JSON.stringify(TO_SPEC_CLEAN));
    const issuesFile = join(dir, 'digests.json');
    writeFileSync(
      issuesFile,
      JSON.stringify([
        { title: '[server-upgrade] Jellyfin 10.11.9 — release triage', state: 'CLOSED' },
        { title: '[server-upgrade] Jellyfin 10.11.10 — release triage', state: 'CLOSED' },
      ]),
    );
    const res = spawnScript(SCRIPT, [
      '--root',
      dir,
      '--latest',
      '10.11.11',
      '--to-file',
      toFile,
      '--tracker-issues',
      issuesFile,
      '--body-out',
      bodyOut,
    ]);
    expect(res.exitCode).toBe(0);
    const decision = JSON.parse(res.stdout);
    expect(decision.clearedThrough).toBe('10.11.10');
    expect(readFileSync(bodyOut, 'utf8')).toContain(
      '| Mechanically cleared through | `10.11.10` |',
    );
  });

  it("CLI emits 'none' when --latest equals acknowledged (caught up; no work)", () => {
    scaffoldRepo();
    const res = spawnScript(SCRIPT, ['--root', dir, '--latest', '10.11.8']);
    expect(res.exitCode).toBe(0);
    const decision = JSON.parse(res.stdout);
    expect(decision.action).toBe('none');
    expect(decision.version).toBe('10.11.8');
  });

  it('CLI takes the acknowledged version from the newest committed stable fingerprint', () => {
    scaffoldRepo();
    const res = spawnScript(SCRIPT, ['--root', dir, '--latest', '10.11.8']);
    expect(JSON.parse(res.stdout).acknowledged).toBe('10.11.8');
  });

  it('CLI reports the RC even when stable is caught up, and writes its body', () => {
    scaffoldRepo();
    const rcBody = join(dir, 'rc.md');
    const res = spawnScript(SCRIPT, [
      '--root',
      dir,
      '--latest',
      '10.11.8',
      '--rc',
      '10.12.0-rc1',
      '--rc-body-out',
      rcBody,
    ]);
    const decision = JSON.parse(res.stdout);
    expect(decision.action).toBe('none');
    expect(decision.rc).toEqual({
      version: '10.12.0-rc1',
      title: rcTitle('10.12.0-rc1'),
      from: '10.11.8',
    });
    expect(decision.rcLabel).toBe('server-upgrade:rc');
    expect(readFileSync(rcBody, 'utf8')).toContain('`/server-upgrade 10.11.8 10.12.0-rc1`');
  });

  it('CLI fails when no stable fingerprint is committed (no anchor)', () => {
    scaffoldRepo();
    rmSync(join(dir, 'docs/architecture/spec-fingerprints'), { recursive: true, force: true });
    const res = spawnScript(SCRIPT, ['--root', dir, '--latest', '10.11.10']);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(/no committed stable fingerprint/);
  });

  it("CLI degrades to 'triage' (announce-only) when the floor fingerprint is missing (offline)", () => {
    scaffoldRepo();
    // The floor 10.7.0 has no committed fingerprint, so readFingerprint(floor)
    // throws inside computeReport. With --to-file there is NO network, so the
    // degradation is the fingerprint miss, exercised fully offline. (The anchor
    // can't be missing: it is derived from the committed fingerprints.)
    rmSync(join(dir, 'docs/architecture/spec-fingerprints/jellyfin-10.7.0.json'));
    const toFile = join(dir, 'to-spec.json');
    writeFileSync(toFile, JSON.stringify(TO_SPEC_TRIAGE));
    const res = spawnScript(SCRIPT, ['--root', dir, '--latest', '10.11.10', '--to-file', toFile]);
    expect(res.exitCode).toBe(0);
    const decision = JSON.parse(res.stdout);
    expect(decision.action).toBe('triage');
    expect(decision.degraded).toBe(true);
    expect(decision.needsInvestigation).toBeNull();
    expect(decision.error).toMatch(/no committed fingerprint for 10\.7\.0/);
  });
});
