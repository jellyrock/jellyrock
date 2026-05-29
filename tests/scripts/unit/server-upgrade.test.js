// Tests for scripts/server-upgrade.js (Phase 3: mechanical filer).
//
// The judgment layer (the /server-upgrade agent skill) is out of scope here —
// these exercise the deterministic, IO-free seam: stable version-independent
// finding identity, title drafting + dedup confirm, the scaffold (report →
// verdict template), verdict validation, action reconciliation (create /
// comment / reopen / skip / monitor / missing- + invalid-verdict), plan counts,
// and the run-summary render. A final block drives the CLI scaffold + plan
// (--no-dedup, so no GitHub) against fixtures via spawnScript. Mirrors
// findings-candidates.test.js / crash-report.test.js.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from './_helpers/spawn-script.js';
import {
  findingKey,
  findingLocator,
  titleIdentity,
  draftIssueTitle,
  draftDedupSearchQuery,
  issueMatchesFinding,
  investigationCandidates,
  baseLabelsFor,
  buildScaffold,
  validateVerdict,
  mergeLabels,
  assembleIssueBody,
  reconcileActions,
  buildPlan,
  renderRunSummary,
  isAutoFileEligible,
  AUTO_FILE_CLASSES,
  TITLE_PREFIX,
} from '../../../scripts/server-upgrade.js';

const SCRIPT = 'scripts/server-upgrade.js';

const META = { fromVersion: '10.11.8', toVersion: '10.11.10', floorVersion: '10.7.0' };

// ── Candidate builders (mirror the findings-candidates.json shape) ───────────

function opCandidate(over = {}) {
  return {
    type: 'breaking',
    change: {
      kind: 'endpoint-removed',
      path: '/Items/{itemId}',
      method: 'GET',
      detail: 'GET /Items/{itemId} removed',
      fromVersion: '10.11.8',
      toVersion: '10.11.10',
    },
    appUsage: { used: true, apiVersionRange: [2, null], sites: ['source/api/ApiClient.bs'] },
    relevance: 'active-tier',
    severityGuess: 'high',
    needsInvestigation: true,
    suppressed: false,
    ...over,
  };
}

function fieldCandidate(over = {}) {
  return {
    type: 'breaking',
    change: {
      kind: 'field-retyped',
      schema: 'BaseItemDto',
      name: 'runTimeTicks',
      detail: 'BaseItemDto.runTimeTicks: integer:int64 → integer:int32',
      fromVersion: '10.11.8',
      toVersion: '10.11.10',
    },
    appUsage: { used: true, apiVersionRange: null, sites: ['source/data/X.bs'] },
    relevance: 'active-tier',
    severityGuess: 'low',
    needsInvestigation: true,
    suppressed: false,
    ...over,
  };
}

function enumCandidate(over = {}) {
  return {
    type: 'breaking',
    change: {
      kind: 'enum-changed',
      schema: 'MediaType',
      added: ['Book'],
      removed: [],
      detail: 'MediaType enum +[Book]',
      fromVersion: '10.11.8',
      toVersion: '10.11.10',
    },
    appUsage: { used: true, apiVersionRange: null, sites: ['source/data/X.bs'] },
    relevance: 'active-tier',
    severityGuess: 'medium',
    needsInvestigation: true,
    suppressed: false,
    ...over,
  };
}

function coverageGapCandidate(over = {}) {
  return {
    type: 'coverage-gap',
    change: {
      kind: 'coverage-gap',
      path: '/userviews',
      method: 'GET',
      detail: '/UserViews: path absent from floor spec 10.7.0',
      fromVersion: '10.7.0',
      toVersion: null,
    },
    appUsage: { used: true, apiVersionRange: [1, null], sites: ['source/api/ApiClient.bs'] },
    relevance: 'floor-coverage',
    severityGuess: 'high',
    needsInvestigation: true,
    suppressed: false,
    ...over,
  };
}

function report(candidates, over = {}) {
  return {
    schemaVersion: 1,
    fromVersion: '10.11.8',
    toVersion: '10.11.10',
    floorVersion: '10.7.0',
    counts: { total: candidates.length, suppressed: 0, frozenSkip: 0 },
    candidates,
    ...over,
  };
}

// ── Stable identity ──────────────────────────────────────────────────────────

describe('findingKey — stable, version-independent', () => {
  it('keys operation changes by kind + normalized path + method', () => {
    expect(findingKey(opCandidate())).toBe('endpoint-removed /items/{} GET');
  });
  it('normalizes placeholder spelling so the key is stable across path variants', () => {
    const a = findingKey(
      opCandidate({ change: { kind: 'endpoint-removed', path: '/Items/{itemId}', method: 'GET' } }),
    );
    const b = findingKey(
      opCandidate({ change: { kind: 'endpoint-removed', path: '/items/{x}', method: 'get' } }),
    );
    expect(a).toBe(b);
  });
  it('keys field changes by kind + schema.field', () => {
    expect(findingKey(fieldCandidate())).toBe('field-retyped BaseItemDto.runTimeTicks');
  });
  it('keys enum changes by kind + schema (no field name)', () => {
    expect(findingKey(enumCandidate())).toBe('enum-changed MediaType');
  });
  it('keys coverage-gaps by kind + normalized path + method', () => {
    expect(findingKey(coverageGapCandidate())).toBe('coverage-gap /userviews GET');
  });
  it('does NOT include the version (recurrence dedups to the same key)', () => {
    const k1 = findingKey(
      fieldCandidate({
        change: {
          kind: 'field-retyped',
          schema: 'BaseItemDto',
          name: 'runTimeTicks',
          toVersion: '10.11.10',
        },
      }),
    );
    const k2 = findingKey(
      fieldCandidate({
        change: {
          kind: 'field-retyped',
          schema: 'BaseItemDto',
          name: 'runTimeTicks',
          toVersion: '10.12.0',
        },
      }),
    );
    expect(k1).toBe(k2);
  });
});

describe('findingLocator + title', () => {
  it('renders a readable locator using the change spelling', () => {
    expect(findingLocator(opCandidate())).toBe('GET /Items/{itemId}');
    expect(findingLocator(fieldCandidate())).toBe('BaseItemDto.runTimeTicks');
    expect(findingLocator(enumCandidate())).toBe('MediaType');
  });
  it('exposes the version-independent identity substring carried in the title', () => {
    expect(titleIdentity(opCandidate())).toBe('endpoint removed: GET /Items/{itemId}');
    expect(draftIssueTitle(opCandidate())).toContain(titleIdentity(opCandidate()));
  });
  it('appends the toVersion for forward changes and the floor for coverage-gaps', () => {
    expect(draftIssueTitle(opCandidate())).toBe(
      '[server-upgrade] endpoint removed: GET /Items/{itemId} (→ 10.11.10)',
    );
    expect(draftIssueTitle(coverageGapCandidate())).toBe(
      '[server-upgrade] floor coverage gap: GET /userviews (floor 10.7.0)',
    );
  });
});

describe('dedup search + confirm', () => {
  it('quotes the most distinctive locator token', () => {
    expect(draftDedupSearchQuery(opCandidate())).toBe('"/Items/{itemId}"');
    expect(draftDedupSearchQuery(fieldCandidate())).toBe('"BaseItemDto.runTimeTicks"');
    expect(draftDedupSearchQuery(enumCandidate())).toBe('"MediaType"');
  });
  it('confirms a hit only when it is ours AND carries the version-independent identity', () => {
    const c = opCandidate();
    expect(issueMatchesFinding(draftIssueTitle(c), c)).toBe(true);
    // same identity, different version → still our finding (recurrence)
    expect(
      issueMatchesFinding('[server-upgrade] endpoint removed: GET /Items/{itemId} (→ 10.13.0)', c),
    ).toBe(true);
    // a manually-filed issue mentioning the path but not our prefix → no match
    expect(issueMatchesFinding('Bug: GET /Items/{itemId} is slow', c)).toBe(false);
  });
  it('disambiguates two kinds that share a locator', () => {
    const removed = opCandidate({
      change: { kind: 'param-removed', path: '/Items/{itemId}', method: 'GET' },
    });
    const changed = opCandidate({
      change: { kind: 'param-changed', path: '/Items/{itemId}', method: 'GET' },
    });
    const removedTitle = draftIssueTitle(removed);
    expect(issueMatchesFinding(removedTitle, removed)).toBe(true);
    expect(issueMatchesFinding(removedTitle, changed)).toBe(false);
  });
});

// ── Scaffold ──────────────────────────────────────────────────────────────────

describe('investigationCandidates + buildScaffold', () => {
  it('selects only needsInvestigation candidates (drops suppressed / frozen-skip)', () => {
    const r = report([
      opCandidate(),
      fieldCandidate({ needsInvestigation: false, suppressed: true, suppressedBy: 'cosmetic' }),
      opCandidate({
        change: { kind: 'endpoint-removed', path: '/legacy', method: 'GET' },
        relevance: 'frozen-skip',
        needsInvestigation: false,
      }),
    ]);
    expect(investigationCandidates(r)).toHaveLength(1);
  });

  it('produces a verdict template with blanked judgment fields + prefilled hints', () => {
    const scaffold = buildScaffold(report([opCandidate(), coverageGapCandidate()]));
    expect(scaffold.kind).toBe('verdict-template');
    expect(scaffold.verdicts).toHaveLength(2);
    const v = scaffold.verdicts[0];
    expect(v.findingKey).toBe('endpoint-removed /items/{} GET');
    expect(v.severityGuess).toBe('high'); // hint preserved
    expect(v.appUsage.sites).toEqual(['source/api/ApiClient.bs']);
    expect(v.labels).toEqual(['server-upgrade', 'bug']); // base labels prefilled
    // judgment fields blank — the agent must decide
    expect(v.real).toBeNull();
    expect(v.severity).toBeNull();
    expect(v.recommendedAction).toBeNull();
    expect(v.draftIssueBody).toBe('');
  });

  it('assigns enhancement base labels to opportunity / symmetry types', () => {
    expect(baseLabelsFor('opportunity')).toEqual(['server-upgrade', 'enhancement']);
    expect(baseLabelsFor('symmetry-advisory')).toEqual(['server-upgrade', 'enhancement']);
  });
});

// ── Verdict validation + label merge ──────────────────────────────────────────

describe('validateVerdict', () => {
  it('flags a missing recommendedAction', () => {
    expect(validateVerdict({ findingKey: 'k' })).toContain('missing recommendedAction');
  });
  it('flags an invalid recommendedAction', () => {
    expect(validateVerdict({ findingKey: 'k', recommendedAction: 'nope' })[0]).toMatch(
      /invalid recommendedAction/,
    );
  });
  it('requires a body + severity when filing', () => {
    const problems = validateVerdict({
      findingKey: 'k',
      recommendedAction: 'file',
      draftIssueBody: '',
    });
    expect(problems).toContain('recommendedAction "file" requires a non-empty draftIssueBody');
    expect(problems).toContain('recommendedAction "file" requires a severity');
  });
  it('passes a well-formed file verdict', () => {
    expect(
      validateVerdict({
        findingKey: 'k',
        recommendedAction: 'file',
        severity: 'high',
        draftIssueBody: 'real break',
      }),
    ).toHaveLength(0);
  });
  it('passes a skip with no body', () => {
    expect(validateVerdict({ findingKey: 'k', recommendedAction: 'skip' })).toHaveLength(0);
  });
});

describe('mergeLabels', () => {
  it('unions base + agent labels, dedups, ignores blanks', () => {
    expect(mergeLabels(['server-upgrade', 'bug'], ['regression', 'bug', '', null])).toEqual([
      'server-upgrade',
      'bug',
      'regression',
    ]);
  });
});

describe('assembleIssueBody', () => {
  it('wraps the agent body with provenance header + footer', () => {
    const v = {
      findingKey: 'k',
      recommendedAction: 'file',
      severity: 'high',
      rationale: 'real on 10.9+',
      draftIssueBody: 'AGENT PROSE HERE',
    };
    const body = assembleIssueBody(opCandidate(), v, META);
    expect(body).toContain('### Server-upgrade finding');
    expect(body).toContain('**Locator**: `GET /Items/{itemId}`');
    expect(body).toContain('source/api/ApiClient.bs');
    expect(body).toContain('AGENT PROSE HERE');
    expect(body).toContain('**Agent rationale**: real on 10.9+');
    expect(body).toContain('/issue-triage');
  });
});

// ── Reconciliation ─────────────────────────────────────────────────────────────

const fileVerdict = (key, over = {}) => ({
  findingKey: key,
  real: true,
  severity: 'high',
  recommendedAction: 'file',
  labels: ['server-upgrade', 'bug'],
  rationale: 'confirmed break',
  draftIssueBody: 'It breaks.',
  ...over,
});

describe('reconcileActions', () => {
  const c = opCandidate();
  const key = findingKey(c);

  it('creates when no existing issue', () => {
    const actions = reconcileActions([c], [fileVerdict(key)], new Map([[key, null]]), META);
    expect(actions[0].action).toBe('create');
    expect(actions[0].labels).toEqual(['server-upgrade', 'bug']);
    expect(actions[0].body).toContain('It breaks.');
    expect(actions[0].autoFileEligible).toBe(false);
  });

  it('comments when an OPEN issue exists (recurrence, not duplicate)', () => {
    const actions = reconcileActions(
      [c],
      [fileVerdict(key)],
      new Map([[key, { number: 42, state: 'OPEN', title: 't' }]]),
      META,
    );
    expect(actions[0].action).toBe('comment');
    expect(actions[0].existingIssue.number).toBe(42);
    expect(actions[0].commentBody).toContain('Still present in 10.11.10');
  });

  it('reopens when a CLOSED issue exists (regression)', () => {
    const actions = reconcileActions(
      [c],
      [fileVerdict(key)],
      new Map([[key, { number: 7, state: 'CLOSED', title: 't' }]]),
      META,
    );
    expect(actions[0].action).toBe('reopen');
    expect(actions[0].commentBody).toContain('Regression');
  });

  it('skip / monitor do not produce a write action', () => {
    const skip = reconcileActions(
      [c],
      [{ findingKey: key, recommendedAction: 'skip', rationale: 'no-op given ?? default' }],
      new Map(),
      META,
    );
    expect(skip[0].action).toBe('skip');
    const mon = reconcileActions(
      [c],
      [{ findingKey: key, recommendedAction: 'monitor', rationale: 'opportunity, later' }],
      new Map(),
      META,
    );
    expect(mon[0].action).toBe('monitor');
  });

  it('surfaces a candidate with NO verdict as missing-verdict (never silently dropped)', () => {
    const actions = reconcileActions([c], [], new Map(), META);
    expect(actions[0].action).toBe('missing-verdict');
  });

  it('surfaces a malformed verdict as invalid-verdict with problems', () => {
    const actions = reconcileActions(
      [c],
      [{ findingKey: key, recommendedAction: 'file' }],
      new Map(),
      META,
    );
    expect(actions[0].action).toBe('invalid-verdict');
    expect(actions[0].problems.length).toBeGreaterThan(0);
  });

  it('matches the verdict to the candidate by findingKey regardless of order', () => {
    const c2 = fieldCandidate();
    const actions = reconcileActions(
      [c, c2],
      [fileVerdict(findingKey(c2)), fileVerdict(key)],
      new Map(),
      META,
    );
    expect(actions.map((a) => a.action)).toEqual(['create', 'create']);
  });
});

describe('buildPlan + counts', () => {
  it('tallies each action class', () => {
    const c1 = opCandidate();
    const c2 = fieldCandidate();
    const c3 = enumCandidate();
    const r = report([c1, c2, c3]);
    const verdicts = [
      fileVerdict(findingKey(c1)),
      { findingKey: findingKey(c2), recommendedAction: 'skip', rationale: 'dynamic typing no-op' },
      // c3 has no verdict → missing
    ];
    const plan = buildPlan({ report: r, verdicts, dedupMatches: new Map() });
    expect(plan.counts).toMatchObject({
      investigationCandidates: 3,
      create: 1,
      skip: 1,
      missingVerdict: 1,
    });
  });
});

// ── Trust ratchet ──────────────────────────────────────────────────────────────

describe('trust ratchet (Phase 3: all human-gated)', () => {
  it('no class is auto-file eligible', () => {
    expect(AUTO_FILE_CLASSES.size).toBe(0);
    for (const t of ['breaking', 'coverage-gap', 'opportunity', 'symmetry-advisory']) {
      expect(isAutoFileEligible(t)).toBe(false);
    }
  });
});

// ── Run summary ──────────────────────────────────────────────────────────────

describe('renderRunSummary', () => {
  it('renders frontmatter + per-class sections', () => {
    const plan = {
      report: 'r.json',
      fromVersion: '10.11.8',
      toVersion: '10.11.10',
      floorVersion: '10.7.0',
      actions: [],
    };
    const results = [
      { action: 'create', issueNumber: 100, title: 'T1', findingKey: 'k1' },
      { action: 'comment', issueNumber: 50, title: 'T2', findingKey: 'k2' },
      { action: 'skip', findingKey: 'k3', rationale: 'no-op' },
      { action: 'missing-verdict', findingKey: 'k4', title: 'T4' },
      { action: 'create', issueNumber: null, title: 'T5', findingKey: 'k5', error: 'gh failed' },
    ];
    const md = renderRunSummary(plan, results, { createdAt: '2026-05-29T00:00:00Z' });
    expect(md).toContain('target: server-upgrade');
    expect(md).toContain('created-issues: 1');
    expect(md).toContain('## Created');
    expect(md).toContain('#100 — T1');
    expect(md).toContain('## Skipped');
    expect(md).toContain('## Missing verdicts');
    expect(md).toContain('## Errors');
    expect(md).toContain('gh failed');
  });
});

// ── CLI (scaffold + plan --no-dedup; no GitHub) ──────────────────────────────

describe('CLI scaffold + plan via spawnScript', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('scaffolds from a report, then plans against filled verdicts with --no-dedup', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-server-upgrade-'));
    const reportPath = join(dir, 'findings.json');
    const c = opCandidate();
    writeFileSync(reportPath, JSON.stringify(report([c, coverageGapCandidate()])));

    // scaffold → stdout
    const sc = spawnScript(SCRIPT, ['scaffold', '--report', reportPath]);
    expect(sc.exitCode).toBe(0);
    const tmpl = JSON.parse(sc.stdout);
    expect(tmpl.verdicts).toHaveLength(2);

    // fill one verdict (file), leave the other unset → plan should show missing
    const verdicts = {
      verdicts: [fileVerdict(findingKey(c))],
    };
    const verdictsPath = join(dir, 'verdicts.json');
    writeFileSync(verdictsPath, JSON.stringify(verdicts));

    const pl = spawnScript(SCRIPT, [
      'plan',
      '--report',
      reportPath,
      '--verdicts',
      verdictsPath,
      '--no-dedup',
    ]);
    expect(pl.exitCode).toBe(0);
    const plan = JSON.parse(pl.stdout);
    expect(plan.counts.create).toBe(1);
    expect(plan.counts.missingVerdict).toBe(1);
    expect(plan.actions.find((a) => a.action === 'create').title).toContain(TITLE_PREFIX);
  });

  it('errors cleanly when --report is missing', () => {
    const r = spawnScript(SCRIPT, ['scaffold']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/Missing --report/);
  });
});
