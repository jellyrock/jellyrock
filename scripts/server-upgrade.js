// scripts/server-upgrade.js — Phase 3 mechanical filer for the
// server-upgrade-automation pipeline (docs/architecture/server-upgrade-automation.md).
//
// This is pipeline stage 5 ("File"): the deterministic GitHub side of the
// agent/script seam. The Phase-2 report (findings-candidates.json) lists every
// spec change that intersects code JellyRock ships. The `/server-upgrade`
// agent skill investigates each candidate that `needsInvestigation` and emits a
// VERDICT per finding. This script never decides "is this a real problem" — it
// only does the mechanical work around that judgment:
//
//   scaffold  — read the data report, select the candidates needing
//               investigation (drops suppressed + frozen-skip via the report's
//               own needsInvestigation flag), and emit a verdict-template JSON
//               keyed by a STABLE, version-independent findingKey, pre-listing
//               each candidate's cited sites + mechanical severity guess + base
//               labels. The agent fills the judgment fields in place. No GH, no
//               writes — pure read.
//   plan      — join the agent's filled verdicts back to the report by
//               findingKey, dedup-search GitHub for each finding marked `file`,
//               draft titles + issue bodies, reconcile into concrete actions
//               (create / comment / reopen / skip / monitor / missing-verdict).
//               GH READS only — no writes. Mirrors crash-report's `plan`.
//   execute   — perform the GH writes (create / comment / reopen) + labels for
//               the planned actions, then write a run-summary handoff. Mirrors
//               crash-report's `execute`.
//
// Decisions locked for Phase 3 (see the design doc's "Decisions" + the matching
// /log decision entry):
//   (a) Dedup key is VERSION-INDEPENDENT (kind + locator), so a finding that
//       recurs across releases — every coverage-gap does, since it's recomputed
//       from manifest×floor each run — comments/reopens the one live issue
//       instead of re-filing a duplicate every month. Title carries the
//       human-readable locator; dedup confirms by the version-independent
//       `<kindLabel>: <locator>` substring (mirrors crash-report's stable
//       substring + title-prefix confirm).
//   (b) The agent hands judgment over via a SCRIPT-SCAFFOLDED template so the
//       script owns findingKey derivation (no key drift) and `plan` can flag any
//       un-investigated candidate (no silent drops/misses).
//   (c) ALL finding-classes are human-gated — running `execute` IS the per-
//       release batch approval (the "graduated trust ratchet"). The ratchet is
//       wired (each action carries `autoFileEligible`, always false now) so a
//       future Phase 5 can graduate a low-false-positive class by config, not a
//       rewrite. Nothing auto-files today.
//
// Public exports (for tests): all pure / IO-free helpers are named exports so
// the Vitest suite at tests/scripts/unit/server-upgrade.test.js can drive them
// directly without spawning a subprocess.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SCHEMA_VERSION = 1;
export const GENERATOR = 'scripts/server-upgrade.js';
export const TITLE_PREFIX = '[server-upgrade]';
export const BASE_LABEL = 'server-upgrade';

// Base labels by candidate type. The agent may APPEND labels in its verdict;
// these are the mechanical floor. `bug` / `enhancement` are GitHub defaults so
// they aren't preflight-created — only BASE_LABEL is (see the skill's Step 0).
export const BASE_LABELS_BY_TYPE = {
  breaking: [BASE_LABEL, 'bug'],
  'coverage-gap': [BASE_LABEL, 'bug'],
  opportunity: [BASE_LABEL, 'enhancement'],
  'symmetry-advisory': [BASE_LABEL, 'enhancement'],
};

// Human phrase per change kind — drives the issue title + the version-
// independent dedup confirm substring `<kindLabel>: <locator>`.
export const KIND_LABEL = {
  'endpoint-removed': 'endpoint removed',
  'endpoint-added': 'new endpoint',
  'param-removed': 'param removed',
  'param-changed': 'param changed',
  'requestbody-changed': 'request body changed',
  'response-changed': 'response changed',
  'field-removed': 'field removed',
  'field-retyped': 'field retyped',
  'enum-changed': 'enum changed',
  'coverage-gap': 'floor coverage gap',
  'coverage-symmetry': 'coverage symmetry',
};

// The verdict's recommendedAction vocabulary.
export const ACTIONS = new Set(['file', 'skip', 'monitor']);

// Graduated trust ratchet: which finding-CLASSES auto-file. EMPTY = everything is
// human-gated (running `execute` is the per-release batch approval).
//
// Phase 5 deliberately keeps this empty: no class has an OBSERVED false-positive
// rate yet (the pipeline has filed zero issues), so graduating any class would be
// graduating on faith — exactly what the ratchet decision forbids. The MECHANISM
// is fully wired (each action carries autoFileEligible via isAutoFileEligible), so
// graduating a class later is a one-line config change here, NOT a rewrite.
//
// What graduation MEANS (decided Phase 5): adding a class here relaxes the per-class
// batch-approval gate inside a human-run `/server-upgrade execute` — that class's
// `create` actions no longer need the Step-4 confirmation. It does NOT add an
// autonomous auto-file path to the Phase-4 CI tracker: the CI tracker stays the one
// fully-autonomous surface and only ANNOUNCES; auto-filing a mechanically-derived
// candidate without the agent's per-finding disposition would file the very
// false-positives the disposition exists to catch.
//
// The evidence bar + the FP-rate query that justifies a future graduation live in
// the "Graduation procedure" subsection of the Phase-5 build record in
// docs/architecture/server-upgrade-automation.md.
export const AUTO_FILE_CLASSES = new Set();

export function isAutoFileEligible(type) {
  return AUTO_FILE_CLASSES.has(type);
}

// ── Path normalization (mirrors findings-candidates.js / the manifest) ───────

// Collapse every {placeholder} to {}, fold case, strip a trailing slash, ensure
// a leading slash. Idempotent. Used to make the dedup key stable regardless of
// how a path's placeholders are spelled (/Items/{itemId} vs /items/{}).
export function normalizeSpecPath(p) {
  let s = (p.startsWith('/') ? p : '/' + p).replace(/\{[^}]*\}/g, '{}').toLowerCase();
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

const isSchemaChange = (c) => typeof c.schema === 'string';
const isOperationChange = (c) => typeof c.path === 'string';

// ── Stable, version-independent finding identity ─────────────────────────────

// findingKey is the dedup identity: kind + locator, NEVER the version. The same
// structural concern recurring in a later release maps to the same key →
// comment/reopen, not a duplicate. Both `scaffold` and `plan` derive it from the
// candidate so the agent never invents keys.
export function findingKey(candidate) {
  const c = candidate.change;
  if (isSchemaChange(c)) {
    // field-* carry a `name`; enum-changed does not (the enum schema IS the id).
    return c.name ? `${c.kind} ${c.schema}.${c.name}` : `${c.kind} ${c.schema}`;
  }
  if (isOperationChange(c)) {
    const method = (c.method ?? '').toUpperCase();
    return `${c.kind} ${normalizeSpecPath(c.path)} ${method}`.trim();
  }
  return `${c.kind} ${c.detail ?? ''}`.trim();
}

// Human-readable locator for the title. Uses the change's own spelling (raw spec
// path / Schema.field / enum schema) so the title reads naturally. The dedup
// confirm normalizes, so cosmetic path differences don't matter.
export function findingLocator(candidate) {
  const c = candidate.change;
  if (isSchemaChange(c)) {
    return c.name ? `${c.schema}.${c.name}` : c.schema;
  }
  if (isOperationChange(c)) {
    const method = (c.method ?? '').toUpperCase();
    return method ? `${method} ${c.path}` : c.path;
  }
  return c.detail ?? c.kind;
}

const kindLabel = (kind) => KIND_LABEL[kind] ?? kind;

// The version-independent substring that uniquely identifies a finding inside a
// title: `<kindLabel>: <locator>`. Used both to BUILD the title and to CONFIRM a
// GitHub search hit is really this finding (disambiguates two kinds sharing a
// locator, e.g. "param removed: GET /Items/{}" vs "param changed: GET /Items/{}").
export function titleIdentity(candidate) {
  return `${kindLabel(candidate.change.kind)}: ${findingLocator(candidate)}`;
}

// Version tag appended to the title. Forward changes carry a toVersion; the
// backward coverage-gap check has toVersion:null and is anchored to the floor.
function versionTag(candidate) {
  const c = candidate.change;
  if (c.toVersion) return `→ ${c.toVersion}`;
  if (c.fromVersion) return `floor ${c.fromVersion}`;
  return 'upstream';
}

export function draftIssueTitle(candidate) {
  return `${TITLE_PREFIX} ${titleIdentity(candidate)} (${versionTag(candidate)})`;
}

// GitHub dedup search query: the most distinctive stable token of the locator,
// quoted (GitHub search splits on punctuation, so quote the phrase). The result
// set is then JS-confirmed by titleIdentity containment — broad search, exact
// confirm, same shape as crash-report's searchExistingIssues.
export function draftDedupSearchQuery(candidate) {
  const c = candidate.change;
  const token = isSchemaChange(c)
    ? c.name
      ? `${c.schema}.${c.name}`
      : c.schema
    : isOperationChange(c)
      ? c.path
      : c.kind;
  return `"${token}"`;
}

// Does an existing issue (from the dedup search) actually match this finding?
// It must be one we filed (TITLE_PREFIX) AND carry the version-independent
// identity substring. Pure + testable; no title back-parsing required.
export function issueMatchesFinding(issueTitle, candidate) {
  if (typeof issueTitle !== 'string') return false;
  return issueTitle.startsWith(TITLE_PREFIX) && issueTitle.includes(titleIdentity(candidate));
}

// ── Scaffold (pure read of the report → verdict template) ────────────────────

// Candidates the agent must investigate = those the report flagged
// needsInvestigation. The report already forces this false for suppressed and
// frozen-skip candidates, so respecting the flag honors "don't re-file
// suppressed". Returns them in the report's existing (deterministic) order.
export function investigationCandidates(report) {
  return (report.candidates ?? []).filter((c) => c.needsInvestigation === true);
}

export function baseLabelsFor(type) {
  return [...(BASE_LABELS_BY_TYPE[type] ?? [BASE_LABEL])];
}

// Build the verdict template the agent fills. Judgment fields are blanked (the
// agent must make the call); severityGuess + base labels are prefilled as hints.
export function buildScaffold(report) {
  const candidates = investigationCandidates(report);
  return {
    schemaVersion: SCHEMA_VERSION,
    generator: GENERATOR,
    kind: 'verdict-template',
    fromVersion: report.fromVersion ?? null,
    toVersion: report.toVersion ?? null,
    floorVersion: report.floorVersion ?? null,
    instructions:
      'For each verdict, set real (bool), severity (high|medium|low), ' +
      'recommendedAction (file|skip|monitor), append any extra labels, write a ' +
      'one-paragraph rationale, and (only when recommendedAction is "file") a ' +
      'draftIssueBody in GitHub markdown. Do NOT change findingKey. Investigate ' +
      'by reading every path in appUsage.sites.',
    verdicts: candidates.map((c) => ({
      findingKey: findingKey(c),
      type: c.type,
      change: {
        kind: c.change.kind,
        locator: findingLocator(c),
        detail: c.change.detail ?? null,
      },
      appUsage: {
        apiVersionRange: c.appUsage?.apiVersionRange ?? null,
        sites: [...(c.appUsage?.sites ?? [])],
      },
      severityGuess: c.severityGuess ?? null,
      // ─ agent fills below ─
      real: null,
      severity: null,
      recommendedAction: null,
      labels: baseLabelsFor(c.type),
      rationale: '',
      draftIssueBody: '',
    })),
  };
}

export function serialize(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

// ── Verdict validation ───────────────────────────────────────────────────────

// Validate one filled verdict. Returns an array of human-readable problems
// (empty = valid). Surfaced in the plan so a malformed verdict never silently
// files a broken issue or gets dropped.
export function validateVerdict(verdict) {
  const problems = [];
  if (typeof verdict.findingKey !== 'string' || !verdict.findingKey) {
    problems.push('missing findingKey');
  }
  if (verdict.recommendedAction == null) {
    problems.push('missing recommendedAction');
  } else if (!ACTIONS.has(verdict.recommendedAction)) {
    problems.push(`invalid recommendedAction "${verdict.recommendedAction}"`);
  }
  if (verdict.recommendedAction === 'file') {
    if (typeof verdict.draftIssueBody !== 'string' || verdict.draftIssueBody.trim() === '') {
      problems.push('recommendedAction "file" requires a non-empty draftIssueBody');
    }
    if (verdict.severity == null) problems.push('recommendedAction "file" requires a severity');
  }
  return problems;
}

// ── Issue body assembly ───────────────────────────────────────────────────────
//
// The mechanical wrapper around the agent's draftIssueBody: a provenance header
// (where this came from, the change, the investigated sites, severity) + the
// agent's prose + a standard footer. Keeps the agent focused on substance while
// the script owns the boilerplate + traceability.

function rangeStr(range) {
  if (!Array.isArray(range)) return null;
  const [min, max] = range;
  return `[${min ?? '?'}, ${max == null ? '∞' : max}]`;
}

function provenanceHeader(candidate, verdict, meta) {
  const c = candidate.change;
  const sites = candidate.appUsage?.sites ?? [];
  const range = rangeStr(candidate.appUsage?.apiVersionRange);
  const lines = [];
  lines.push('### Server-upgrade finding');
  lines.push(
    `Detected by \`/server-upgrade\` from the Phase-2 data report ` +
      `(${meta.fromVersion} → ${meta.toVersion}, floor ${meta.floorVersion}).`,
  );
  lines.push('');
  lines.push(`**Type**: ${candidate.type} · **Change**: \`${c.kind}\``);
  lines.push(`**Locator**: \`${findingLocator(candidate)}\``);
  if (c.detail) lines.push(`**Detail**: ${c.detail}`);
  if (range) lines.push(`**API-version range**: ${range}`);
  lines.push(
    `**Severity**: ${verdict.severity ?? 'unset'} ` +
      `(mechanical guess: ${candidate.severityGuess ?? 'n/a'})`,
  );
  if (sites.length) {
    lines.push('');
    lines.push('**Cited app usage** (investigated):');
    for (const s of sites) lines.push(`- \`${s}\``);
  }
  return lines.join('\n');
}

function footer(verdict) {
  const rationale = verdict.rationale ? `**Agent rationale**: ${verdict.rationale}\n\n` : '';
  return (
    `${rationale}_Filed automatically by the \`/server-upgrade\` skill — see ` +
    `\`docs/architecture/server-upgrade-automation.md\`. Run \`/issue-triage <N>\` ` +
    `for a deeper dive._`
  );
}

export function assembleIssueBody(candidate, verdict, meta) {
  return `${provenanceHeader(candidate, verdict, meta)}\n\n---\n\n${verdict.draftIssueBody.trim()}\n\n---\n\n${footer(verdict)}\n`;
}

export function draftRecurrenceComment(candidate, verdict, meta) {
  return `**Still present in ${meta.toVersion}** — re-surfaced by \`/server-upgrade\` (report ${meta.fromVersion} → ${meta.toVersion}, floor ${meta.floorVersion}).

${verdict.rationale ? `**Agent rationale**: ${verdict.rationale}\n\n` : ''}Change: \`${candidate.change.kind}\` · \`${findingLocator(candidate)}\`${candidate.change.detail ? ` — ${candidate.change.detail}` : ''}. Crash/finding identity unchanged; logging the new occurrence rather than filing a duplicate.`;
}

export function draftRegressionComment(candidate, verdict, meta, previousState = 'closed') {
  return `**Regression — this finding re-surfaced** after being marked ${previousState}.

Re-detected by \`/server-upgrade\` in ${meta.toVersion} (report ${meta.fromVersion} → ${meta.toVersion}, floor ${meta.floorVersion}).

${verdict.rationale ? `**Agent rationale**: ${verdict.rationale}\n\n` : ''}Change: \`${candidate.change.kind}\` · \`${findingLocator(candidate)}\`${candidate.change.detail ? ` — ${candidate.change.detail}` : ''}. Reopening for investigation. If this is a false-positive, close again with a note.`;
}

// ── GitHub dedup search ────────────────────────────────────────────────────────

function defaultGhExec(args) {
  return execFileSync('gh', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

// For each candidate, find an existing [server-upgrade] issue carrying its
// version-independent identity. Returns Map<findingKey, {number,state,title}|null>.
export function searchExistingIssues(candidates, { ghExec = defaultGhExec } = {}) {
  const out = new Map();
  for (const candidate of candidates) {
    const key = findingKey(candidate);
    const query = draftDedupSearchQuery(candidate);
    try {
      const raw = ghExec([
        'issue',
        'list',
        '--state',
        'all',
        '--search',
        `${query} in:title`,
        '--json',
        'number,state,title,updatedAt',
        '--limit',
        '20',
      ]);
      const parsed = JSON.parse(raw || '[]');
      const match = parsed.find((iss) => issueMatchesFinding(iss.title, candidate));
      out.set(key, match ? { number: match.number, state: match.state, title: match.title } : null);
    } catch {
      out.set(key, null);
    }
  }
  return out;
}

// ── Reconcile verdicts + candidates + dedup → concrete actions ────────────────

// Pure. Joins the report's investigation candidates with the agent's verdicts
// (by findingKey) and the dedup matches, producing one action per candidate.
// Nothing is silently dropped: a candidate with no verdict → 'missing-verdict';
// a malformed verdict → 'invalid-verdict'; skip/monitor → logged, no write.
export function reconcileActions(candidates, verdicts, dedupMatches, meta) {
  const verdictByKey = new Map();
  for (const v of verdicts ?? []) {
    if (v && typeof v.findingKey === 'string') verdictByKey.set(v.findingKey, v);
  }

  const actions = [];
  for (const candidate of candidates) {
    const key = findingKey(candidate);
    const verdict = verdictByKey.get(key) ?? null;
    const base = {
      findingKey: key,
      type: candidate.type,
      title: draftIssueTitle(candidate),
      locator: findingLocator(candidate),
      change: candidate.change,
      autoFileEligible: isAutoFileEligible(candidate.type),
    };

    if (!verdict) {
      actions.push({ ...base, action: 'missing-verdict' });
      continue;
    }

    const problems = validateVerdict(verdict);
    if (problems.length) {
      actions.push({ ...base, action: 'invalid-verdict', problems, rationale: verdict.rationale });
      continue;
    }

    const severity = verdict.severity ?? candidate.severityGuess ?? null;
    const labels = mergeLabels(baseLabelsFor(candidate.type), verdict.labels);
    const common = { ...base, severity, labels, rationale: verdict.rationale ?? '' };

    if (verdict.recommendedAction === 'skip') {
      actions.push({ ...common, action: 'skip' });
      continue;
    }
    if (verdict.recommendedAction === 'monitor') {
      actions.push({ ...common, action: 'monitor' });
      continue;
    }

    // recommendedAction === 'file' → reconcile against the dedup match.
    const existing = dedupMatches.get(key) ?? null;
    const body = assembleIssueBody(candidate, verdict, meta);
    if (existing && existing.state === 'OPEN') {
      actions.push({
        ...common,
        action: 'comment',
        existingIssue: existing,
        commentBody: draftRecurrenceComment(candidate, verdict, meta),
        body,
      });
    } else if (existing && existing.state === 'CLOSED') {
      actions.push({
        ...common,
        action: 'reopen',
        existingIssue: existing,
        commentBody: draftRegressionComment(candidate, verdict, meta, 'closed'),
        body,
      });
    } else {
      actions.push({ ...common, action: 'create', existingIssue: null, body });
    }
  }
  return actions;
}

export function mergeLabels(base, extra) {
  const out = [...base];
  for (const l of extra ?? []) {
    if (typeof l === 'string' && l.trim() && !out.includes(l)) out.push(l);
  }
  return out;
}

// ── Plan assembly ──────────────────────────────────────────────────────────────

export function buildPlan({ report, verdicts, dedupMatches }) {
  const candidates = investigationCandidates(report);
  const meta = {
    fromVersion: report.fromVersion ?? null,
    toVersion: report.toVersion ?? null,
    floorVersion: report.floorVersion ?? null,
  };
  const actions = reconcileActions(candidates, verdicts, dedupMatches, meta);

  const byAction = (name) => actions.filter((a) => a.action === name);
  return {
    schemaVersion: SCHEMA_VERSION,
    generator: GENERATOR,
    createdAt: null, // stamped by the CLI (Date is unavailable to pure builders by policy)
    report: report.report ?? null,
    ...meta,
    counts: {
      investigationCandidates: candidates.length,
      create: byAction('create').length,
      comment: byAction('comment').length,
      reopen: byAction('reopen').length,
      skip: byAction('skip').length,
      monitor: byAction('monitor').length,
      missingVerdict: byAction('missing-verdict').length,
      invalidVerdict: byAction('invalid-verdict').length,
    },
    // Pass through the report's own suppressed/frozen-skip accounting so the
    // plan render can show what was deliberately NOT investigated (audit trail).
    reportCounts: report.counts ?? null,
    actions,
  };
}

// ── Execute (the only GH-writing path) ─────────────────────────────────────────

function extractIssueNumber(ghCreateOutput) {
  const m = /\/issues\/(\d+)/.exec(ghCreateOutput);
  return m ? Number(m[1]) : null;
}

export function executePlan(plan, { ghExec = defaultGhExec, logger = console.error } = {}) {
  const results = [];
  for (const action of plan.actions) {
    // Non-writing actions are recorded verbatim for the run summary.
    if (['skip', 'monitor', 'missing-verdict', 'invalid-verdict'].includes(action.action)) {
      results.push({ ...action, issueNumber: null, error: null });
      continue;
    }
    try {
      let issueNumber;
      if (action.action === 'create') {
        const out = ghExec([
          'issue',
          'create',
          '--title',
          action.title,
          '--body',
          action.body,
          '--label',
          action.labels.join(','),
        ]);
        issueNumber = extractIssueNumber(out);
        logger(`[server-upgrade] created #${issueNumber}: ${action.title}`);
      } else if (action.action === 'comment') {
        ghExec([
          'issue',
          'comment',
          String(action.existingIssue.number),
          '--body',
          action.commentBody,
        ]);
        issueNumber = action.existingIssue.number;
        logger(`[server-upgrade] commented on #${issueNumber}: ${action.title}`);
      } else if (action.action === 'reopen') {
        ghExec(['issue', 'reopen', String(action.existingIssue.number)]);
        ghExec([
          'issue',
          'comment',
          String(action.existingIssue.number),
          '--body',
          action.commentBody,
        ]);
        issueNumber = action.existingIssue.number;
        logger(`[server-upgrade] reopened + commented on #${issueNumber}: ${action.title}`);
      }
      results.push({ ...action, issueNumber, error: null });
    } catch (err) {
      logger(`[server-upgrade] action FAILED for ${action.findingKey}: ${err.message}`);
      results.push({ ...action, issueNumber: null, error: err.message });
    }
  }
  return results;
}

// ── Run summary handoff ─────────────────────────────────────────────────────────

export function renderRunSummary(plan, results, { createdAt } = {}) {
  const created = results.filter((r) => r.action === 'create' && r.issueNumber);
  const commented = results.filter((r) => r.action === 'comment' && r.issueNumber);
  const reopened = results.filter((r) => r.action === 'reopen' && r.issueNumber);
  const skipped = results.filter((r) => r.action === 'skip');
  const monitored = results.filter((r) => r.action === 'monitor');
  const missing = results.filter((r) => r.action === 'missing-verdict');
  const invalid = results.filter((r) => r.action === 'invalid-verdict');
  const errors = results.filter((r) => r.error);

  const frontmatter = [
    '---',
    `created: ${createdAt ?? plan.createdAt ?? '?'}`,
    `target: server-upgrade`,
    `report: ${plan.report ?? '?'}`,
    `from-version: ${plan.fromVersion ?? '?'}`,
    `to-version: ${plan.toVersion ?? '?'}`,
    `floor-version: ${plan.floorVersion ?? '?'}`,
    `created-issues: ${created.length}`,
    `commented: ${commented.length}`,
    `reopened: ${reopened.length}`,
    `skipped: ${skipped.length}`,
    `monitored: ${monitored.length}`,
    `missing-verdicts: ${missing.length}`,
    `invalid-verdicts: ${invalid.length}`,
    `errors: ${errors.length}`,
    '---',
  ].join('\n');

  const sections = [];
  sections.push('## Summary');
  sections.push(
    `- **Created**: ${created.length}\n` +
      `- **Commented (recurrence on open)**: ${commented.length}\n` +
      `- **Reopened (regression)**: ${reopened.length}\n` +
      `- **Skipped (investigated, not a real problem)**: ${skipped.length}\n` +
      `- **Monitor (real but deferred)**: ${monitored.length}\n` +
      `- **Missing verdicts**: ${missing.length}\n` +
      `- **Invalid verdicts**: ${invalid.length}\n` +
      `- **Errors**: ${errors.length}`,
  );
  const list = (rows, fmt) => rows.map(fmt).join('\n');
  if (created.length) {
    sections.push('## Created');
    sections.push(list(created, (r) => `- #${r.issueNumber} — ${r.title}`));
  }
  if (commented.length) {
    sections.push('## Commented (recurrence on open issue)');
    sections.push(list(commented, (r) => `- #${r.issueNumber} — ${r.title}`));
  }
  if (reopened.length) {
    sections.push('## Reopened (regression)');
    sections.push(list(reopened, (r) => `- #${r.issueNumber} — ${r.title}`));
  }
  if (skipped.length) {
    sections.push('## Skipped — investigated, not filing (false-positive / no real impact)');
    sections.push(
      list(skipped, (r) => `- \`${r.findingKey}\`${r.rationale ? ` — ${r.rationale}` : ''}`),
    );
  }
  if (monitored.length) {
    sections.push('## Monitor — real but deferred (consider `/log signal`)');
    sections.push(
      list(monitored, (r) => `- \`${r.findingKey}\`${r.rationale ? ` — ${r.rationale}` : ''}`),
    );
  }
  if (missing.length) {
    sections.push('## Missing verdicts — investigated candidate with no verdict');
    sections.push(list(missing, (r) => `- \`${r.findingKey}\` (${r.title})`));
  }
  if (invalid.length) {
    sections.push('## Invalid verdicts');
    sections.push(list(invalid, (r) => `- \`${r.findingKey}\` — ${(r.problems ?? []).join('; ')}`));
  }
  if (errors.length) {
    sections.push('## Errors');
    sections.push(list(errors, (r) => `- \`${r.findingKey}\`: ${r.error}`));
  }
  return `${frontmatter}\n\n${sections.join('\n\n')}\n`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) {
        args.flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          args.flags[a.slice(2)] = next;
          i++;
        } else {
          args.flags[a.slice(2)] = true;
        }
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function nowStamp() {
  return new Date().toISOString();
}

function cmdScaffold(args) {
  const reportPath = args.flags.report ?? args._[1];
  if (!reportPath) throw new Error('Missing --report <findings-candidates.json>.');
  const report = readJson(reportPath);
  // Tag the report with its filename so the plan/handoff can cite it.
  report.report = report.report ?? basename(reportPath);
  const scaffold = buildScaffold(report);
  const out = args.flags.out;
  const json = serialize(scaffold);
  if (out) {
    writeFileSync(out, json);
    console.error(
      `[server-upgrade] scaffold: ${scaffold.verdicts.length} candidate(s) to investigate → ${out}`,
    );
  } else {
    process.stdout.write(json);
  }
}

function cmdPlan(args) {
  const reportPath = args.flags.report ?? args._[1];
  const verdictsPath = args.flags.verdicts ?? args._[2];
  if (!reportPath) throw new Error('Missing --report <findings-candidates.json>.');
  if (!verdictsPath) throw new Error('Missing --verdicts <filled-verdicts.json>.');
  const report = readJson(reportPath);
  report.report = report.report ?? basename(reportPath);
  const verdictsDoc = readJson(verdictsPath);
  const verdicts = Array.isArray(verdictsDoc) ? verdictsDoc : (verdictsDoc.verdicts ?? []);

  const candidates = investigationCandidates(report);
  // GitHub READS only (dedup search). No writes happen in plan.
  const dedupMatches = args.flags['no-dedup']
    ? new Map(candidates.map((c) => [findingKey(c), null]))
    : searchExistingIssues(candidates);

  const plan = buildPlan({ report, verdicts, dedupMatches });
  plan.createdAt = nowStamp();
  const json = serialize(plan);
  const out = args.flags['plan-out'];
  if (out) {
    writeFileSync(out, json);
    console.error(
      `[server-upgrade] plan: ${plan.counts.create} create, ${plan.counts.comment} comment, ` +
        `${plan.counts.reopen} reopen, ${plan.counts.skip} skip, ${plan.counts.monitor} monitor, ` +
        `${plan.counts.missingVerdict} missing → ${out}`,
    );
  } else {
    process.stdout.write(json);
  }
}

function cmdExecute(args) {
  const planPath = args.flags.plan ?? args._[1];
  if (!planPath) throw new Error('Missing --plan <plan.json>.');
  const handoffDir = args.flags['handoff-dir'] ?? join(REPO_ROOT, '.claude', 'handoffs');
  const plan = readJson(planPath);
  const results = executePlan(plan, {});
  const createdAt = nowStamp();
  const summary = renderRunSummary(plan, results, { createdAt });
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  const handoffPath = join(handoffDir, `server-upgrade-${stamp}.md`);
  try {
    writeFileSync(handoffPath, summary);
    console.error(`[server-upgrade] summary written to ${handoffPath}`);
  } catch (err) {
    console.error(`[server-upgrade] could not write handoff (${err.message})`);
    process.stdout.write(summary);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sub = args._[0];
  if (sub === 'scaffold') return cmdScaffold(args);
  if (sub === 'plan') return cmdPlan(args);
  if (sub === 'execute') return cmdExecute(args);
  if (sub === '--help' || sub === 'help' || !sub) {
    process.stdout.write(`Usage:
  node scripts/server-upgrade.js scaffold --report <findings-candidates.json> [--out <verdict-template.json>]
  node scripts/server-upgrade.js plan --report <findings-candidates.json> --verdicts <filled.json> [--plan-out <plan.json>] [--no-dedup]
  node scripts/server-upgrade.js execute --plan <plan.json> [--handoff-dir <dir>]
`);
    return;
  }
  throw new Error(`Unknown subcommand: ${sub}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(`[server-upgrade] ${err.message}`);
    process.exit(1);
  }
}
