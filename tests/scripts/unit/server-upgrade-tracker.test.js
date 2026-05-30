// Tests for scripts/server-upgrade-tracker.js (Phase 4: proactive CI tracker).
//
// The pure parts (signal parse, action decision, body/title render) are
// exercised directly. The count-computation + CLI path is driven OFFLINE via
// --to-file (an injected `to` spec) against tiny hand-written committed inputs
// (from/floor fingerprints + manifest + boundaries + suppressions), mirroring
// the findings-candidates CLI test. No network, no GitHub writes.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from './_helpers/spawn-script.js';
import {
  parseStableSignal,
  decideAction,
  renderTrackerTitle,
  renderTrackerBody,
  computeCounts,
} from '../../../scripts/server-upgrade-tracker.js';

const SCRIPT = 'scripts/server-upgrade-tracker.js';

// A minimal signals-backlog.md with the jellyfin-server-stable row plus a
// neighbour row and a code fence (the schema example) to prove the parser skips
// fences and stops at the next row.
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

describe('decideAction', () => {
  it('announces when latest stable is strictly newer than acknowledged', () => {
    expect(decideAction({ latestStable: '10.11.10', acknowledged: '10.11.8' })).toBe('announce');
    expect(decideAction({ latestStable: '10.12.0', acknowledged: '10.11.10' })).toBe('announce');
  });

  it('is caught-up when equal or acknowledged is ahead', () => {
    expect(decideAction({ latestStable: '10.11.10', acknowledged: '10.11.10' })).toBe('caught-up');
    expect(decideAction({ latestStable: '10.11.8', acknowledged: '10.11.10' })).toBe('caught-up');
  });

  it('announces when acknowledged is a non-semver placeholder (nudge rather than go quiet)', () => {
    expect(decideAction({ latestStable: '10.11.10', acknowledged: '(none)' })).toBe('announce');
  });

  it('is caught-up when there is no latest stable', () => {
    expect(decideAction({ latestStable: null, acknowledged: '10.11.8' })).toBe('caught-up');
  });
});

describe('renderTrackerTitle', () => {
  it('carries the version + the /server-upgrade call to action', () => {
    expect(renderTrackerTitle('10.11.10')).toBe(
      '🔔 Jellyfin 10.11.10 available — run /server-upgrade to triage',
    );
  });
});

describe('renderTrackerBody', () => {
  const base = { version: '10.11.10', acknowledged: '10.11.8', floor: '10.7.0' };

  it('renders the counts block when counts are present', () => {
    const body = renderTrackerBody({
      ...base,
      counts: {
        breaking: 2,
        opportunity: 1,
        'coverage-gap': 3,
        'symmetry-advisory': 1,
        needsInvestigation: 7,
        suppressed: 1,
      },
    });
    expect(body).toContain('**2** breaking');
    expect(body).toContain('**1** opportunit');
    expect(body).toContain('**3** floor coverage-gap');
    expect(body).toContain('**1** coverage-symmetry advisor');
    expect(body).toContain('**7** total needing investigation');
    expect(body).toContain('1 suppressed');
    expect(body).toContain('spec-fingerprint.js 10.11.10');
    expect(body).toContain('/done jellyfin-server-stable');
  });

  it('degrades to announce-only when counts are null, surfacing the error', () => {
    const body = renderTrackerBody({ ...base, counts: null, error: 'boom' });
    expect(body).toContain('_unavailable this run_');
    expect(body).toContain('boom');
    expect(body).not.toContain('breaking candidate');
  });
});

// ── Offline count computation + CLI ──────────────────────────────────────────

const BOUNDARIES_YML =
  'floor: "10.7.0"\ntiers:\n  1:\n    minServer: "10.7.0"\n    maxServer: "10.8.13"\n    status: frozen\n  2:\n    minServer: "10.9.0"\n    maxServer: null\n    status: active\n';

function fp(specVersion, operations = {}) {
  return { schemaVersion: 1, specVersion, operations, schemas: {} };
}

// A tiny raw OpenAPI spec for the `to` version. /Items/{itemId} GET is dropped
// vs the `from` fingerprint below → a breaking candidate on a used active-tier
// endpoint.
const TO_SPEC = {
  info: { version: '10.11.10' },
  paths: {
    '/Users/{userId}/Items': { get: { parameters: [], responses: { 200: {} } } },
  },
  components: { schemas: {} },
};

describe('computeCounts (offline, injected toSpec)', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function scaffoldRepo() {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-su-tracker-'));
    const write = (rel, obj) => {
      const full = join(dir, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, typeof obj === 'string' ? obj : JSON.stringify(obj));
    };
    const fpRel = (v) => `docs/architecture/spec-fingerprints/jellyfin-${v}.json`;
    // Floor + acknowledged both have the endpoint; the `to` spec drops it.
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
    write('docs/signals-backlog.md', signalsDoc());
  }

  it('runs the Phase-2 report against an ephemeral to fingerprint', async () => {
    scaffoldRepo();
    const counts = await computeCounts({
      rootDir: dir,
      from: '10.11.8',
      to: '10.11.10',
      floor: '10.7.0',
      toSpec: TO_SPEC,
    });
    // /Items/{} GET removed on a used active-tier endpoint → a breaking candidate.
    expect(counts.breaking).toBeGreaterThanOrEqual(1);
    expect(counts.needsInvestigation).toBeGreaterThanOrEqual(1);
  });

  it('CLI --latest + --to-file emits an announce decision with counts; no repo write', () => {
    scaffoldRepo();
    const bodyOut = join(dir, 'body.md');
    const toFile = join(dir, 'to-spec.json');
    writeFileSync(toFile, JSON.stringify(TO_SPEC));

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
    expect(decision.action).toBe('announce');
    expect(decision.version).toBe('10.11.10');
    expect(decision.acknowledged).toBe('10.11.8');
    expect(decision.degraded).toBe(false);
    expect(decision.counts.breaking).toBeGreaterThanOrEqual(1);
    expect(decision.title).toContain('10.11.10');
  });

  it('CLI emits caught-up (no body, no counts) when --latest equals acknowledged', () => {
    scaffoldRepo();
    const res = spawnScript(SCRIPT, ['--root', dir, '--latest', '10.11.8']);
    expect(res.exitCode).toBe(0);
    const decision = JSON.parse(res.stdout);
    expect(decision.action).toBe('caught-up');
    expect(decision.version).toBe('10.11.8');
  });

  it('CLI degrades to announce-only when a baseline fingerprint is missing (offline)', () => {
    scaffoldRepo();
    // Acknowledged 10.10.0 has no committed fingerprint → readFingerprint(from)
    // throws inside computeCounts. With --to-file there is NO network, so the
    // degradation is the fingerprint miss, exercised fully offline.
    writeFileSync(join(dir, 'docs/signals-backlog.md'), signalsDoc({ acknowledged: '10.10.0' }));
    const toFile = join(dir, 'to-spec.json');
    writeFileSync(toFile, JSON.stringify(TO_SPEC));
    const res = spawnScript(SCRIPT, ['--root', dir, '--latest', '10.11.10', '--to-file', toFile]);
    expect(res.exitCode).toBe(0);
    const decision = JSON.parse(res.stdout);
    expect(decision.action).toBe('announce');
    expect(decision.degraded).toBe(true);
    expect(decision.error).toMatch(/no committed fingerprint for 10\.10\.0/);
  });
});
