// scripts/catchup-state.js: the aggregator for /catchup, /ramp and sub-agents.
//
// Single Node call returns JSON describing the repo state the shared reader
// (.claude/skills/catchup/catchup-state.sh) does not cover: open PRs, recent
// issues, CI runs, pending handoffs, open upstream-watch issues, recent ADRs, tech
// debt, doc staleness. Git position and the followup journal are the shared
// reader's. Replaces ~13 parallel-bash calls with one allowlisted invocation. Banner-detection in /catchup becomes deterministic
// JSON compares instead of agent text-parsing of mixed tool outputs.
//
// Usage:
//   node scripts/catchup-state.js [--pretty] [--typed] [--area=<name>] [--no-gh] [--no-network]
//
// Flags:
//   --pretty       indent JSON output (default is single-line)
//   --typed        first the banner rules of .claude/skills/catchup/jellyrock.md as
//                  the shared reader's typed lines (scripts/lib/catchup-typed.cjs),
//                  then the JSON under one `=== STATE ===` line. catchup.conf runs
//                  it so; without the flag the output is the JSON alone.
//   --area=<name>  scope to one of: components, components/video,
//                  components/data, source, source/api, source/utils,
//                  tests, locale, scripts. Filters PR/issue gh queries
//                  via the area-to-keyword map (mirrors /ramp/SKILL.md).
//   --no-gh        skip all `gh` API calls (offline / fast tests)
//   --no-network   skip all network I/O (today the same as --no-gh). Used
//                  by tests and any fully offline invocation.
//
// Per-section error handling: each fetcher is wrapped in try/catch; failures
// return null for that section + an entry in `_errors`. Never throws to
// the caller.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { typedLines } = require('./lib/catchup-typed.cjs');

// The labels of the issues CI opens when an upstream moves: the per-version
// Jellyfin digest and release-candidate issues (scripts/server-upgrade-tracker.js)
// and the Roku OS review issue (scripts/roku-os-watch.js). Duplicated here as
// string literals to avoid importing those modules into the aggregator.
const WATCH_LABELS = ['server-upgrade:tracker', 'server-upgrade:rc', 'roku-os'];
const TRIAGING_LABEL = 'server-upgrade:triaging';

// Resolve sibling script paths relative to THIS script's location, not cwd.
// Lets the aggregator be invoked from any working directory (real repo, test
// tempdir) and still find scripts/lint/docs-stale.cjs etc.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DOCS_STALE_SCRIPT = join(SCRIPT_DIR, 'lint/docs-stale.cjs');

// ────────────────────────────────────────────────────────────────────
// CLI flags

const args = process.argv.slice(2);
const PRETTY = args.includes('--pretty');
const TYPED = args.includes('--typed');
const NO_NETWORK = args.includes('--no-network');
// --no-network implies --no-gh (gh ops are network).
const NO_GH = NO_NETWORK || args.includes('--no-gh');
const AREA_ARG = args.find((a) => a.startsWith('--area='));
const AREA = AREA_ARG ? AREA_ARG.split('=')[1] : null;

const VALID_AREAS = [
  'components',
  'components/video',
  'components/data',
  'source',
  'source/api',
  'source/utils',
  'tests',
  'locale',
  'scripts',
];

if (AREA && !VALID_AREAS.includes(AREA)) {
  process.stderr.write(
    `catchup-state: unrecognized --area=${AREA}. Valid: ${VALID_AREAS.join(', ')}\n`,
  );
  process.exit(2);
}

// Area-to-keyword map. Mirrors the keyword table in .claude/skills/ramp/SKILL.md.
// Used to scope gh PR/issue queries when --area= is set. Keep in sync with
// /ramp; if the map drifts, /ramp's hand-rolled bash and the aggregator
// return different scopes for the same area.
const AREA_KEYWORDS = {
  'components/video': 'video|playback|player|osd|trickplay|transcode',
  'components/data': 'scenemanager|ContentNode|library',
  components: 'component|scene|focus|navigation',
  'source/api': 'api|jellyfin|task|http|auth',
  'source/utils': 'util|helper|registry|config',
  source: 'migration|bootstrap|main',
  tests: 'test|rooibos|spec',
  locale: 'translation|locale|i18n|en_US',
  scripts: 'bsc|plugin|lint|generate',
};

// ────────────────────────────────────────────────────────────────────
// Helpers

function exec(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function execTrim(cmd) {
  return exec(cmd).trim();
}

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400 * 1000).toISOString().slice(0, 10);
}

// Compress a tech-debt **issue** bullet body to a single short line for the
// /catchup briefing. First sentence wins; if shorter than 40 chars (anemic
// preamble like "1,315-line file."), glue on the next sentence. Over-120
// chars get word-trimmed + ellipsis. Markdown spans are left intact.
function summarizeIssue(text) {
  const sentences = text.match(/[^.]+(?:\.|$)/g) || [text];
  let oneline = sentences[0].trim();
  if (oneline.length < 40 && sentences[1]) {
    oneline = (oneline + ' ' + sentences[1].trim()).trim();
  }
  if (oneline.length > 120) {
    let cut = oneline.slice(0, 120);
    const sp = cut.lastIndexOf(' ');
    if (sp > 60) cut = cut.slice(0, sp);
    oneline = cut + '…';
  }
  return oneline;
}

// ────────────────────────────────────────────────────────────────────
// State accumulator + section runner

const _errors = {};
const state = { meta: { area: AREA, generated_at: new Date().toISOString() } };

function run(section, fn) {
  try {
    state[section] = fn();
  } catch (err) {
    state[section] = null;
    _errors[section] = String(err.message || err)
      .split('\n')[0]
      .slice(0, 200);
  }
}

// ────────────────────────────────────────────────────────────────────
// Sections

run('prs', () => {
  if (NO_GH) return { review_requested: [], yours_open: [] };

  const keyword = AREA && AREA_KEYWORDS[AREA] ? AREA_KEYWORDS[AREA] : null;
  const titleScope = keyword ? ` "${keyword}" in:title` : '';

  const review_requested = JSON.parse(
    exec(
      `gh pr list --state open --search 'review-requested:@me${titleScope}' --limit 5 --json number,title,author,updatedAt`,
    ),
  );
  const yours_open = JSON.parse(
    exec(
      `gh pr list --state open --search 'author:@me${titleScope}' --limit 5 --json number,title,isDraft,updatedAt,reviewDecision`,
    ),
  );
  return { review_requested, yours_open };
});

run('issues', () => {
  if (NO_GH) {
    return { high_engagement_bugs: [], recent_bug_reports: [], active_discussion: [] };
  }

  const keyword = AREA && AREA_KEYWORDS[AREA] ? AREA_KEYWORDS[AREA] : null;
  const titleScope = keyword ? ` "${keyword}" in:title` : '';

  // Exclude upstream/wontfix-tagged bugs (platform limitations we can't fix)
  // and require activity in the last 60 days. The lifetime comment-count sort
  // surfaces classics that haven't moved in a year as if they were urgent;
  // pairing it with `updated:>=` filters those out. `labels` is included in
  // --json so the briefing can render them inline (extra signal for anything
  // that slips the filter).
  const high_engagement_bugs = JSON.parse(
    exec(
      `gh issue list --state open --label bug --search '-label:upstream -label:wontfix updated:>=${isoDaysAgo(60)} sort:comments-desc${titleScope}' --limit 5 --json number,title,comments,labels,updatedAt`,
    ),
  );
  const recent_bug_reports = JSON.parse(
    exec(
      `gh issue list --state open --label bug --search 'created:>=${isoDaysAgo(7)}${titleScope}' --limit 5 --json number,title,createdAt`,
    ),
  );
  const active_discussion = JSON.parse(
    exec(
      `gh issue list --state open --search 'comments:>0 updated:>=${isoDaysAgo(30)}${titleScope}' --limit 5 --json number,title,comments,labels,updatedAt`,
    ),
  );

  return { high_engagement_bugs, recent_bug_reports, active_discussion };
});

run('ci', () => {
  if (NO_GH) return { current_branch_runs: [] };
  const branch = execTrim('git rev-parse --abbrev-ref HEAD');
  // Filtered to the branch here, not with --branch: GitHub often serves a --branch
  // run list stale on a cold call (months old, measured 2026-10-07); the unfiltered
  // list was fresh every time.
  const runs = JSON.parse(
    exec(
      // the run id is the /ci-triage route; asked for only under --typed, so the
      // JSON alone stays as it was
      `gh run list --limit 100 --json headBranch,status,conclusion,name,createdAt,event${TYPED ? ',databaseId' : ''}`,
    ),
  );
  const current_branch_runs = runs
    .filter((r) => r.headBranch === branch)
    .slice(0, 3)
    .map(({ headBranch: _headBranch, ...r }) => r);
  if (current_branch_runs.length > 0) return { current_branch_runs };
  return { current_branch_runs, note: `no CI runs for ${branch} among the 100 newest runs` };
});

run('handoffs', () => {
  const dir = '.claude/handoffs';
  if (!existsSync(dir)) return { pending: [], pruned_count: 0 };

  const cutoff = Date.now() - 30 * 86400 * 1000;
  let pruned_count = 0;

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const full = join(dir, f);
      const mtime = statSync(full).mtimeMs;
      return { full, name: f, mtime };
    });

  // Auto-prune handoffs older than 30 days. /catchup historically ran a
  // shell `find -mtime +30 -delete`; here it's part of the aggregator so
  // every consumer (catchup, ramp, sub-agents) gets the same eviction.
  for (const f of files) {
    if (f.mtime < cutoff) {
      try {
        unlinkSync(f.full);
        pruned_count++;
      } catch {
        // ignore individual file failures
      }
    }
  }

  const pending = files
    .filter((f) => f.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 5)
    .map((f) => ({
      name: f.name,
      age_days: Math.floor((Date.now() - f.mtime) / 86400000),
    }));

  return { pending, pruned_count };
});

// The open upstream-watch issues, newest first. An open issue is the "needs
// attention" signal: CI opens one when an upstream moves, and closing it is the
// acknowledgment.
run('watches', () => {
  if (NO_GH) return { open: [] };
  const open = [];
  for (const label of WATCH_LABELS) {
    const out = exec(
      `gh issue list --label ${label} --state open --json number,title,labels --limit 20`,
    );
    for (const iss of JSON.parse(out)) {
      open.push({
        label,
        number: iss.number,
        title: iss.title,
        triaging: (iss.labels ?? []).some((l) => l.name === TRIAGING_LABEL),
      });
    }
  }
  open.sort((a, b) => b.number - a.number);
  return { open };
});

run('decisions', () => {
  // ADR-grade decisions live as numbered, immutable records in docs/adr/.
  // Sub-ADR notes (docs/decisions.md) are left out on purpose: they're below
  // the architectural bar and would dilute the briefing.
  const dir = 'docs/adr';
  if (!existsSync(dir)) return { recent_3: [] };

  // ADRs are `NNNN-<slug>.md`; the highest number is the newest. README.md
  // indexes the set and is not an ADR, so the four-digit prefix filters it out.
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-.*\.md$/.test(f))
    .sort()
    .reverse();
  const recent_3 = files.slice(0, 3).map((file) => {
    const content = readFileSync(join(dir, file), 'utf8');
    const numMatch = file.match(/^(\d{4})-/);
    const titleMatch = content.match(/^#\s+ADR\s+\d{4}:\s*(.+)$/m);
    const dateMatch = content.match(/\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})/);
    const statusMatch = content.match(/\*\*Status:\*\*\s*(\w+)/);
    return {
      adr: numMatch ? numMatch[1] : null,
      title: titleMatch ? titleMatch[1].trim() : null,
      date: dateMatch ? dateMatch[1] : null,
      status: statusMatch ? statusMatch[1].toLowerCase() : null,
    };
  });
  return { recent_3 };
});

run('tech_debt', () => {
  const path = 'docs/architecture/tech-debt.md';
  if (!existsSync(path)) {
    return { top_3: [], high_count: 0, medium_count: 0, low_count: 0 };
  }
  const content = readFileSync(path, 'utf8');
  // Structure: `## Refactor candidates`, then `### High|Medium|Low`, then
  // `#### `slug`` items, each followed by an `- **issue**: <text>` bullet. A
  // non-severity H3 or any H2 closes the current severity section. We capture
  // {slug, severity, issue_oneline} in file order: file order encodes author
  // priority within severity, and the High, Medium, Low file ordering means
  // top_3 only slices the first 3 (cross-severity) and naturally surfaces the
  // most-important remaining work.
  const counts = { High: 0, Medium: 0, Low: 0 };
  const items = [];
  let currentSeverity = null;
  let pendingItem = null;

  for (const line of content.split(/\r?\n/)) {
    const sevMatch = line.match(/^###\s+(High|Medium|Low)\s*$/);
    if (sevMatch) {
      currentSeverity = sevMatch[1];
      pendingItem = null;
      continue;
    }
    if (/^###\s+/.test(line)) {
      currentSeverity = null;
      pendingItem = null;
      continue;
    }
    if (/^##\s+/.test(line)) {
      currentSeverity = null;
      pendingItem = null;
      continue;
    }
    if (!currentSeverity) continue;

    const slugMatch = line.match(/^####\s+`([^`]+)`/);
    if (slugMatch) {
      counts[currentSeverity]++;
      pendingItem = { slug: slugMatch[1], severity: currentSeverity, issue_oneline: null };
      items.push(pendingItem);
      continue;
    }
    if (pendingItem && pendingItem.issue_oneline === null) {
      const issueMatch = line.match(/^-\s+\*\*issue\*\*:\s*(.+?)\s*$/);
      if (issueMatch) {
        pendingItem.issue_oneline = summarizeIssue(issueMatch[1]);
        pendingItem = null;
      }
    }
  }

  return {
    top_3: items.slice(0, 3),
    high_count: counts.High,
    medium_count: counts.Medium,
    low_count: counts.Low,
  };
});

run('docs_stale', () => {
  // Reuse docs-stale.cjs's --json output. Surfaces stale + no-date docs;
  // /catchup banners on these but doesn't block (the blocking gate lives
  // in docs-stale-blocking.cjs and runs in CI).
  const out = exec(`node "${DOCS_STALE_SCRIPT}" --json`);
  const parsed = JSON.parse(out);
  const surfaced = (parsed.findings || []).filter(
    (f) => f.status === 'stale' || f.status === 'no-date',
  );
  return {
    architecture: surfaced.map((f) => ({ file: f.file, days: f.days, status: f.status })),
  };
});

// ────────────────────────────────────────────────────────────────────
// Output

const result = { ...state, _errors };
if (TYPED) process.stdout.write([...typedLines(result), '=== STATE ==='].join('\n') + '\n');
process.stdout.write(JSON.stringify(result, null, PRETTY ? 2 : 0) + '\n');
