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
  executePlan,
  renderRunSummary,
  isAutoFileEligible,
  AUTO_FILE_CLASSES,
  TITLE_PREFIX,
  digestTitle,
  issueIsDigestFor,
  renderDigestBody,
  renderDigestVerdicts,
  attachSubIssue,
  TRIAGING_LABEL,
  searchExistingIssues,
  assertSchemaVersion,
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

function symmetryCandidate(over = {}) {
  return {
    type: 'symmetry-advisory',
    change: {
      kind: 'coverage-symmetry',
      path: '/items',
      method: 'GET',
      detail:
        '/items/: method(s) GET present on floor spec 10.7.0 but endpoint wired tier ≥2 only — confirm a lower-tier sibling/fallback covers the floor',
      fromVersion: '10.7.0',
      toVersion: null,
    },
    appUsage: { used: true, apiVersionRange: [2, null], sites: ['source/api/ApiClient.bs'] },
    relevance: 'floor-symmetry',
    severityGuess: 'low',
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
  it('keys symmetry advisories by kind + normalized path + method', () => {
    expect(findingKey(symmetryCandidate())).toBe('coverage-symmetry /items GET');
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
    expect(draftIssueTitle(symmetryCandidate())).toBe(
      '[server-upgrade] coverage symmetry: GET /items (floor 10.7.0)',
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

  it('files a symmetry-advisory with enhancement base labels, still human-gated', () => {
    const sc = symmetryCandidate();
    const k = findingKey(sc);
    const actions = reconcileActions(
      [sc],
      [fileVerdict(k, { severity: 'low', labels: ['server-upgrade', 'enhancement'] })],
      new Map([[k, null]]),
      META,
    );
    expect(actions[0].action).toBe('create');
    expect(actions[0].labels).toEqual(['server-upgrade', 'enhancement']);
    expect(actions[0].autoFileEligible).toBe(false);
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

// ── Execute (write branches, injected gh) ────────────────────────────────────

describe('executePlan — write branches via injected ghExec', () => {
  function fakeGh(calls) {
    return (args) => {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'create') {
        return 'https://github.com/owner/repo/issues/901\n';
      }
      return '';
    };
  }

  it('creates with title/body/labels and extracts the new issue number', () => {
    const calls = [];
    const plan = {
      actions: [
        {
          action: 'create',
          findingKey: 'k',
          title: '[server-upgrade] endpoint removed: GET /Items/{itemId} (→ 10.11.10)',
          body: 'BODY',
          labels: ['server-upgrade', 'bug'],
          existingIssue: null,
        },
      ],
    };
    const results = executePlan(plan, { ghExec: fakeGh(calls), logger: () => {} });
    expect(results[0].issueNumber).toBe(901);
    expect(results[0].error).toBeNull();
    expect(calls[0]).toEqual([
      'issue',
      'create',
      '--title',
      plan.actions[0].title,
      '--body',
      'BODY',
      '--label',
      'server-upgrade,bug',
    ]);
  });

  it('comments on the open issue (recurrence) without creating', () => {
    const calls = [];
    const plan = {
      actions: [
        {
          action: 'comment',
          findingKey: 'k',
          title: 't',
          existingIssue: { number: 42, state: 'OPEN' },
          commentBody: 'recurred',
        },
      ],
    };
    const results = executePlan(plan, { ghExec: fakeGh(calls), logger: () => {} });
    expect(results[0].issueNumber).toBe(42);
    expect(calls[0]).toEqual(['issue', 'comment', '42', '--body', 'recurred']);
  });

  it('reopens then comments on a closed issue (regression)', () => {
    const calls = [];
    const plan = {
      actions: [
        {
          action: 'reopen',
          findingKey: 'k',
          title: 't',
          existingIssue: { number: 7, state: 'CLOSED' },
          commentBody: 'regressed',
        },
      ],
    };
    executePlan(plan, { ghExec: fakeGh(calls), logger: () => {} });
    expect(calls[0]).toEqual(['issue', 'reopen', '7']);
    expect(calls[1]).toEqual(['issue', 'comment', '7', '--body', 'regressed']);
  });

  it('records a gh failure per action and keeps going', () => {
    const plan = {
      actions: [
        { action: 'create', findingKey: 'k1', title: 't', body: 'b', labels: ['server-upgrade'] },
        { action: 'skip', findingKey: 'k2' },
      ],
    };
    const throwGh = () => {
      throw new Error('gh boom');
    };
    const results = executePlan(plan, { ghExec: throwGh, logger: () => {} });
    expect(results[0].error).toBe('gh boom');
    expect(results[1].action).toBe('skip');
    expect(results[1].error).toBeNull();
  });

  it('makes NO gh calls for skip / monitor / missing-verdict / invalid-verdict', () => {
    const calls = [];
    const plan = {
      actions: [
        { action: 'skip', findingKey: 'a' },
        { action: 'monitor', findingKey: 'b' },
        { action: 'missing-verdict', findingKey: 'c' },
        { action: 'invalid-verdict', findingKey: 'd', problems: ['x'] },
      ],
    };
    executePlan(plan, { ghExec: fakeGh(calls), logger: () => {} });
    expect(calls).toHaveLength(0);
  });
});

// ── Per-version digest (Phase 6) ───────────────────────────────────────────────

describe('digest identity + render', () => {
  it('digestTitle + issueIsDigestFor round-trip per version', () => {
    expect(digestTitle('10.11.10')).toBe('[server-upgrade] Jellyfin 10.11.10 — release triage');
    expect(issueIsDigestFor(digestTitle('10.11.10'), '10.11.10')).toBe(true);
    expect(issueIsDigestFor(digestTitle('10.11.10'), '10.11.11')).toBe(false);
    expect(issueIsDigestFor('some other issue', '10.11.10')).toBe(false);
  });

  it('renderDigestBody renders a candidate checklist when there are candidates', () => {
    const report = {
      counts: {
        breaking: 1,
        'coverage-gap': 0,
        'symmetry-advisory': 0,
        needsInvestigation: 1,
        floorKnown: 5,
      },
      candidates: [
        {
          type: 'breaking',
          needsInvestigation: true,
          change: {
            kind: 'endpoint-removed',
            path: '/Items/{itemId}',
            method: 'GET',
            detail: 'gone',
          },
          appUsage: { sites: ['source/api/ApiClient.bs:59'] },
        },
      ],
    };
    const body = renderDigestBody({
      version: '10.11.10',
      acknowledged: '10.11.8',
      floor: '10.7.0',
      report,
    });
    expect(body).toContain('### Candidates to triage');
    expect(body).toContain('- [ ] **endpoint removed: GET /Items/{itemId}**');
    expect(body).toContain('✅ 5 floor-known');
    expect(body).toContain(TRIAGING_LABEL);
  });

  it('renderDigestBody renders the mechanically-clean record when 0 candidates', () => {
    const report = { counts: { needsInvestigation: 0, floorKnown: 5 }, candidates: [] };
    const body = renderDigestBody({
      version: '10.11.11',
      acknowledged: '10.11.10',
      floor: '10.7.0',
      report,
    });
    expect(body).toContain('Mechanically clean');
    expect(body).toContain('CI closes this issue');
    expect(body).not.toContain('### Candidates to triage');
  });

  it('renderDigestVerdicts checks off each disposition with its link/rationale', () => {
    const results = [
      {
        action: 'create',
        issueNumber: 851,
        change: { kind: 'endpoint-removed', path: '/Items/{itemId}', method: 'GET' },
        rationale: 'real break',
      },
      {
        action: 'skip',
        change: { kind: 'coverage-gap', path: '/x/{}' },
        rationale: 'guarded by V1 sibling',
      },
      { action: 'monitor', change: { kind: 'coverage-symmetry', path: '/y' }, rationale: 'later' },
    ];
    const body = renderDigestVerdicts(
      { version: '10.11.10', acknowledged: '10.11.8', floor: '10.7.0' },
      results,
      { triagedOn: '2026-05-30' },
    );
    expect(body).toContain('FILED**: endpoint removed: GET /Items/{itemId} → #851');
    expect(body).toContain('SKIP**: floor coverage gap: /x/{} — guarded by V1 sibling');
    expect(body).toContain('MONITOR**: coverage symmetry: /y — later');
  });
});

describe('attachSubIssue', () => {
  it('resolves the child db id then POSTs to the digest sub_issues endpoint', () => {
    const calls = [];
    const ghExec = (args) => {
      calls.push(args);
      if (args.includes('--jq') && args.includes('.id')) return '555\n';
      return '';
    };
    const id = attachSubIssue(ghExec, 840, 851);
    expect(id).toBe(555);
    expect(calls[0]).toEqual(['api', 'repos/{owner}/{repo}/issues/851', '--jq', '.id']);
    expect(calls[1]).toEqual([
      'api',
      '--method',
      'POST',
      'repos/{owner}/{repo}/issues/840/sub_issues',
      '-F',
      'sub_issue_id=555',
    ]);
  });
});

describe('executePlan — digest edit + sub-issue attach + close guard (Phase 6)', () => {
  function fakeGh(calls) {
    return (args) => {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'create') {
        return 'https://github.com/owner/repo/issues/901\n';
      }
      if (args[0] === 'api' && args.includes('--jq') && args.includes('.id')) return '555\n';
      return '';
    };
  }

  const planWith = (extraActions = []) => ({
    toVersion: '10.11.10',
    fromVersion: '10.11.8',
    floorVersion: '10.7.0',
    actions: [
      {
        action: 'create',
        findingKey: 'k1',
        title: '[server-upgrade] endpoint removed: GET /Items/{itemId} (→ 10.11.10)',
        body: 'B',
        labels: ['server-upgrade', 'bug'],
        change: { kind: 'endpoint-removed', path: '/Items/{itemId}', method: 'GET' },
        existingIssue: null,
      },
      ...extraActions,
    ],
  });

  it('files the promotion, links it as a sub-issue, edits + triages the digest, and closes it', () => {
    const calls = [];
    const results = executePlan(planWith(), {
      ghExec: fakeGh(calls),
      digest: 840,
      closeDigest: true,
      triagedOn: '2026-05-30',
      logger: () => {},
    });
    const flat = calls.map((c) => c.join(' '));
    // promotion created
    expect(flat.some((c) => c.startsWith('issue create'))).toBe(true);
    // sub-issue linked (child 901 → digest 840)
    expect(calls).toContainEqual(['api', 'repos/{owner}/{repo}/issues/901', '--jq', '.id']);
    expect(calls).toContainEqual([
      'api',
      '--method',
      'POST',
      'repos/{owner}/{repo}/issues/840/sub_issues',
      '-F',
      'sub_issue_id=555',
    ]);
    expect(results[0].subIssueError).toBeNull();
    // digest edited with the triaging label
    const edit = calls.find((c) => c[0] === 'issue' && c[1] === 'edit');
    expect(edit).toBeTruthy();
    expect(edit).toContain('840');
    expect(edit).toContain('--add-label');
    expect(edit).toContain(TRIAGING_LABEL);
    // digest closed (fully triaged)
    expect(calls.some((c) => c[0] === 'issue' && c[1] === 'close' && c[2] === '840')).toBe(true);
  });

  it('does NOT close the digest when a candidate is unresolved (missing-verdict), even with --close-digest', () => {
    const calls = [];
    executePlan(
      planWith([
        {
          action: 'missing-verdict',
          findingKey: 'k2',
          change: { kind: 'field-removed', schema: 'X', name: 'y' },
        },
      ]),
      {
        ghExec: fakeGh(calls),
        digest: 840,
        closeDigest: true,
        logger: () => {},
      },
    );
    expect(calls.some((c) => c[0] === 'issue' && c[1] === 'edit')).toBe(true); // still edits
    expect(calls.some((c) => c[0] === 'issue' && c[1] === 'close')).toBe(false); // but does NOT close
  });

  it('records a sub-issue link failure without aborting (promotion still filed)', () => {
    const calls = [];
    const ghExec = (args) => {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'create') return 'https://github.com/o/r/issues/901\n';
      if (args[0] === 'api') throw new Error('sub-issues API 404');
      return '';
    };
    const results = executePlan(planWith(), { ghExec, digest: 840, logger: () => {} });
    expect(results[0].issueNumber).toBe(901);
    expect(results[0].subIssueError).toMatch(/sub-issues API 404/);
  });

  it('skips all digest steps when no digest is given (standalone promotions)', () => {
    const calls = [];
    executePlan(planWith(), { ghExec: fakeGh(calls), logger: () => {} });
    expect(calls.some((c) => c[0] === 'api')).toBe(false);
    expect(calls.some((c) => c[0] === 'issue' && (c[1] === 'edit' || c[1] === 'close'))).toBe(
      false,
    );
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

// ── searchExistingIssues (dedup read via injected ghExec) ──────────────────────
// The idempotency-critical GitHub read. Driven through the same injected-ghExec
// seam executePlan uses, so no real `gh` runs.

describe('searchExistingIssues — dedup read', () => {
  function suCandidate() {
    return {
      type: 'breaking',
      change: {
        kind: 'endpoint-removed',
        path: '/Items/{itemId}',
        method: 'GET',
        detail: 'GET /Items/{itemId} removed',
      },
    };
  }

  it('returns the matching open issue keyed by findingKey, with the right search args', () => {
    const calls = [];
    const matchTitle = `${TITLE_PREFIX} endpoint removed: GET /Items/{itemId} (→ 10.11.10)`;
    const ghExec = (args) => {
      calls.push(args);
      return JSON.stringify([
        { number: 51, state: 'OPEN', title: matchTitle, updatedAt: '2026-05-01T00:00:00Z' },
      ]);
    };
    const c = suCandidate();
    const out = searchExistingIssues([c], { ghExec });
    expect(out.get(findingKey(c))).toEqual({ number: 51, state: 'OPEN', title: matchTitle });
    // broad search by the quoted locator token, confirmed in-title
    expect(calls[0]).toContain('list');
    expect(calls[0]).toContain('--search');
    expect(calls[0]).toContain('"/Items/{itemId}" in:title');
  });

  it('returns null when only a foreign (non-matching) issue is found', () => {
    const ghExec = () =>
      JSON.stringify([{ number: 9, state: 'OPEN', title: 'unrelated /Items/{itemId} chatter' }]);
    const c = suCandidate();
    expect(searchExistingIssues([c], { ghExec }).get(findingKey(c))).toBeNull();
  });

  it('returns null on an empty gh result', () => {
    const c = suCandidate();
    expect(searchExistingIssues([c], { ghExec: () => '' }).get(findingKey(c))).toBeNull();
  });

  it('falls back to null when ghExec throws (never crashes the run)', () => {
    const ghExec = () => {
      throw new Error('gh boom');
    };
    const c = suCandidate();
    expect(searchExistingIssues([c], { ghExec }).get(findingKey(c))).toBeNull();
  });
});

// ── assertSchemaVersion (read-side guard: warn + continue, never throw) ─────────

describe('assertSchemaVersion — warn + continue', () => {
  it('is silent and returns true when the version matches', () => {
    const warnings = [];
    const ok = assertSchemaVersion({ schemaVersion: 1 }, 'report.json', (m) => warnings.push(m));
    expect(ok).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('warns and returns false on a mismatch, without throwing', () => {
    const warnings = [];
    const ok = assertSchemaVersion({ schemaVersion: 99 }, 'report.json', (m) => warnings.push(m));
    expect(ok).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('schemaVersion mismatch');
    expect(warnings[0]).toContain('report.json');
  });

  it('is silent for a doc that legitimately carries no schemaVersion', () => {
    const warnings = [];
    const push = (m) => warnings.push(m);
    expect(assertSchemaVersion([], 'verdicts.json', push)).toBe(true);
    expect(assertSchemaVersion({ verdicts: [] }, 'verdicts.json', push)).toBe(true);
    expect(assertSchemaVersion(null, 'nothing.json', push)).toBe(true);
    expect(warnings).toHaveLength(0);
  });
});
