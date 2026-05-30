// Tests for scripts/server-upgrade-tracker.js — the proactive-CI surface,
// Phase 4 generalized by Phase 6 into the PER-VERSION release-triage DIGEST model.
//
// The pure parts (signal parse, version-state + digest-action decisions) are
// exercised directly. The report-computation + CLI path is driven OFFLINE via
// --to-file (an injected `to` spec) against tiny hand-written committed inputs
// (from/floor fingerprints + manifest + boundaries + suppressions + the
// endpoint-availability ledger), mirroring the findings-candidates CLI test. No
// network, no GitHub writes.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from './_helpers/spawn-script.js';
import {
  parseStableSignal,
  decideVersionState,
  decideDigestAction,
  computeReport,
} from '../../../scripts/server-upgrade-tracker.js';

const SCRIPT = 'scripts/server-upgrade-tracker.js';

function signalsDoc({ acknowledged = '10.11.8', upstream = '10.11.10', status = 'watching' } = {}) {
  return `---
last-updated: 2026-05-29
---

# Signals backlog

\`\`\`markdown
### <slug>: <one-line label>
- **latest_acknowledged**: 99.99.99
\`\`\`

## Watching

### jellyfin-server-stable: Jellyfin server stable channel

- **watching**: latest stable
- **current**: 10.7.0 minimum supported
- **latest_upstream**: ${upstream}
- **latest_acknowledged**: ${acknowledged}
- **last_checked**: 2026-05-29
- **action_when_moves**: run /server-upgrade
- **status**: ${status}

### jellyfin-server-rc: Jellyfin server release candidate channel

- **latest_acknowledged**: (no RC in flight)
- **status**: watching
`;
}

describe('parseStableSignal', () => {
  it('extracts the stable row, skipping the code-fence example and the rc row', () => {
    const sig = parseStableSignal(signalsDoc({ acknowledged: '10.11.8', upstream: '10.11.10' }));
    expect(sig).toEqual({
      latest_acknowledged: '10.11.8',
      latest_upstream: '10.11.10',
      status: 'watching',
    });
  });

  it('returns null when the stable row is absent', () => {
    expect(parseStableSignal('# Signals\n\n### roku-os: x\n- **status**: watching\n')).toBeNull();
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

// `to` spec that DROPS /Items/{itemId} GET vs the `from` fingerprint → a breaking
// candidate on a used active-tier endpoint (needsInvestigation ≥ 1 → triage).
const TO_SPEC_TRIAGE = {
  info: { version: '10.11.10' },
  paths: {
    '/Users/{userId}/Items': { get: { parameters: [], responses: { 200: {} } } },
  },
  components: { schemas: {} },
};

// `to` spec that KEEPS /Items/{itemId} GET → no forward break; with no floor gaps
// the report is mechanically clean (needsInvestigation 0 → clean).
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
    write('docs/signals-backlog.md', signalsDoc());
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

  it("CLI emits 'none' when --latest equals acknowledged (caught up; no work)", () => {
    scaffoldRepo();
    const res = spawnScript(SCRIPT, ['--root', dir, '--latest', '10.11.8']);
    expect(res.exitCode).toBe(0);
    const decision = JSON.parse(res.stdout);
    expect(decision.action).toBe('none');
    expect(decision.version).toBe('10.11.8');
  });

  it("CLI degrades to 'triage' (announce-only) when a baseline fingerprint is missing (offline)", () => {
    scaffoldRepo();
    // Acknowledged 10.10.0 has no committed fingerprint → readFingerprint(from)
    // throws inside computeReport. With --to-file there is NO network, so the
    // degradation is the fingerprint miss, exercised fully offline.
    writeFileSync(join(dir, 'docs/signals-backlog.md'), signalsDoc({ acknowledged: '10.10.0' }));
    const toFile = join(dir, 'to-spec.json');
    writeFileSync(toFile, JSON.stringify(TO_SPEC_TRIAGE));
    const res = spawnScript(SCRIPT, ['--root', dir, '--latest', '10.11.10', '--to-file', toFile]);
    expect(res.exitCode).toBe(0);
    const decision = JSON.parse(res.stdout);
    expect(decision.action).toBe('triage');
    expect(decision.degraded).toBe(true);
    expect(decision.needsInvestigation).toBeNull();
    expect(decision.error).toMatch(/no committed fingerprint for 10\.10\.0/);
  });
});
