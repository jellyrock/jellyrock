// scripts/catchup-state.js — Aggregator for /catchup, /ramp, sub-agents.
//
// Single Node call returns JSON describing the repo's current state — git,
// open PRs, recent issues, CI runs, pending handoffs, journal staleness,
// signal watchlist age, etc. Replaces ~13 parallel-bash calls with one
// allowlisted invocation. Banner-detection in /catchup becomes deterministic
// JSON compares instead of agent text-parsing of mixed tool outputs.
//
// Usage:
//   node scripts/catchup-state.js [--pretty] [--area=<name>] [--no-gh]
//
// Flags:
//   --pretty       indent JSON output (default is single-line)
//   --area=<name>  scope to one of: components, components/video,
//                  components/data, source, source/api, source/utils,
//                  tests, locale, scripts. Filters PR/issue gh queries
//                  via the area→keyword map (mirrors /ramp/SKILL.md) and
//                  filters progress.open_followups_by_area.
//   --no-gh        skip all `gh` API calls (offline / fast tests)
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
const { readFrontmatter, getLastUpdated } = require('./lib/frontmatter.cjs');

// Resolve sibling script paths relative to THIS script's location, not cwd.
// Lets the aggregator be invoked from any working directory (real repo, test
// tempdir) and still find scripts/lint/docs-stale.cjs etc.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DOCS_STALE_SCRIPT = join(SCRIPT_DIR, 'lint/docs-stale.cjs');

// ────────────────────────────────────────────────────────────────────
// CLI flags

const args = process.argv.slice(2);
const PRETTY = args.includes('--pretty');
const NO_GH = args.includes('--no-gh');
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

// Area → keyword map. Mirrors .claude/skills/ramp/SKILL.md lines 41-50.
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400 * 1000).toISOString().slice(0, 10);
}

function daysBetween(isoStart, isoEnd) {
  const a = new Date(isoStart + 'T00:00:00Z');
  const b = new Date(isoEnd + 'T00:00:00Z');
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
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

run('git', () => {
  const branch = execTrim('git rev-parse --abbrev-ref HEAD');
  const lastCommit = execTrim('git log -1 --format=%H%x09%s%x09%cI').split('\t');
  const status_porcelain = exec('git status --porcelain');
  const total_7d = parseInt(execTrim('git rev-list --count --since="7 days ago" HEAD'), 10) || 0;

  const by_area = {};
  for (const area of VALID_AREAS) {
    try {
      const out = exec(`git log --oneline --since="7 days ago" -- ${area}`);
      const count = out.split('\n').filter(Boolean).length;
      if (count > 0) by_area[area] = count;
    } catch {
      // area doesn't exist on disk yet; skip
    }
  }

  return {
    branch,
    last_commit: {
      sha: (lastCommit[0] || '').slice(0, 8),
      subject: lastCommit[1] || '',
      committed_at: lastCommit[2] || '',
    },
    status_porcelain: status_porcelain.trim() || null,
    commits_7d: { total: total_7d, by_area },
  };
});

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

  const high_engagement_bugs = JSON.parse(
    exec(
      `gh issue list --state open --label bug --search 'sort:comments-desc${titleScope}' --limit 5 --json number,title,comments,updatedAt`,
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
  const current_branch_runs = JSON.parse(
    exec(
      `gh run list --branch "${branch}" --limit 3 --json status,conclusion,name,createdAt,event`,
    ),
  );
  return { current_branch_runs };
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

run('progress', () => {
  const path = 'docs/progress.md';
  if (!existsSync(path)) return null;
  const content = readFileSync(path, 'utf8');
  const fm = readFrontmatter(content);
  const last_updated = getLastUpdated(fm);
  const days_since = last_updated ? daysBetween(last_updated, todayIso()) : null;

  let commits_since = 0;
  if (last_updated) {
    try {
      commits_since =
        parseInt(execTrim(`git rev-list --count --since="${last_updated}T00:00:00" HEAD`), 10) || 0;
    } catch {
      // ignore
    }
  }

  // Line-by-line state machine: parse "## Currently running" (single
  // paragraph) and "## Open followups" (grouped by ### area subsection).
  // "(none)" bullets are NOT counted; they're placeholders for empty areas.
  const lines = content.split(/\r?\n/);
  let section = null; // 'running' | 'followups' | null
  let currentArea = null;
  const runningLines = [];
  const followupsByArea = {};

  for (const line of lines) {
    if (/^##\s+Currently running\s*$/.test(line)) {
      section = 'running';
      continue;
    }
    if (/^##\s+Open followups\s*$/.test(line)) {
      section = 'followups';
      currentArea = null;
      continue;
    }
    if (/^##\s+/.test(line)) {
      section = null;
      currentArea = null;
      continue;
    }

    if (section === 'running') {
      runningLines.push(line);
      continue;
    }

    if (section === 'followups') {
      const areaMatch = line.match(/^###\s+(\S+)\s*$/);
      if (areaMatch) {
        currentArea = areaMatch[1];
        if (!(currentArea in followupsByArea)) followupsByArea[currentArea] = 0;
        continue;
      }
      if (currentArea && /^-\s+(?!\(none\)).+$/.test(line)) {
        followupsByArea[currentArea]++;
      }
    }
  }

  // Drop areas with zero real bullets (placeholders only)
  for (const k of Object.keys(followupsByArea)) {
    if (followupsByArea[k] === 0) delete followupsByArea[k];
  }
  const open_followups_total = Object.values(followupsByArea).reduce((a, b) => a + b, 0);

  const open_followups_by_area = AREA
    ? Object.fromEntries(Object.entries(followupsByArea).filter(([k]) => k === AREA))
    : followupsByArea;

  const currently_running_summary = runningLines.join('\n').trim() || null;

  return {
    last_updated,
    days_since,
    commits_since,
    open_followups_total,
    open_followups_by_area,
    currently_running_summary,
  };
});

run('signals', () => {
  const path = 'docs/signals-backlog.md';
  if (!existsSync(path)) return null;
  const content = readFileSync(path, 'utf8');
  const lines = content.split(/\r?\n/);

  let inFence = false;
  let currentSlug = null;
  let currentBullets = {};
  const rows = [];

  function finalize() {
    if (!currentSlug) return;
    const staleness_days = currentBullets.staleness_days
      ? Number(currentBullets.staleness_days)
      : 30;
    const age_days = currentBullets.last_checked
      ? daysBetween(currentBullets.last_checked, todayIso())
      : null;
    rows.push({
      slug: currentSlug,
      ...currentBullets,
      staleness_days,
      age_days,
      stale: age_days != null && age_days > staleness_days,
    });
  }

  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (/^##\s+/.test(line)) {
      finalize();
      currentSlug = null;
      currentBullets = {};
      continue;
    }

    const h3 = line.match(/^###\s+([a-z0-9][a-z0-9-]*)\s*:/);
    if (h3) {
      finalize();
      currentSlug = h3[1];
      currentBullets = {};
      continue;
    }

    if (!currentSlug) continue;
    const bullet = line.match(/^-\s+\*\*([a-z_]+)\*\*:\s*(.+?)\s*$/);
    if (bullet) {
      currentBullets[bullet[1]] = bullet[2];
    }
  }
  finalize();

  const stale_count = rows.filter((r) => r.stale).length;
  const action_pending_count = rows.filter((r) => r.status === 'action_pending').length;

  return { rows, stale_count, action_pending_count };
});

run('decisions', () => {
  const path = 'docs/decisions.md';
  if (!existsSync(path)) return { recent_3: [] };
  const content = readFileSync(path, 'utf8');

  // Strip code-fenced blocks before slug-matching — the file's preamble
  // contains a schema example (`## decision-id: switched-from-foo-to-bar`)
  // that would otherwise be parsed as a real entry.
  const stripped = content.replace(/```[\s\S]*?```/g, '');

  const blocks = stripped.match(/##\s+decision-id:\s+[\s\S]*?(?=\n##\s+decision-id:|$)/g) || [];
  // Newest entries are appended at the bottom (per decisions.md preamble).
  const last3 = blocks.slice(-3);
  const recent_3 = last3.map((block) => {
    const slugMatch = block.match(/##\s+decision-id:\s+(\S+)/);
    const dateMatch = block.match(/\*\*date\*\*:\s*(\d{4}-\d{2}-\d{2})/);
    const statusMatch = block.match(/\*\*status\*\*:\s*([a-z]+)/);
    return {
      slug: slugMatch ? slugMatch[1] : null,
      date: dateMatch ? dateMatch[1] : null,
      status: statusMatch ? statusMatch[1] : null,
    };
  });
  return { recent_3 };
});

run('tech_debt', () => {
  const path = 'docs/architecture/tech-debt.md';
  if (!existsSync(path)) return { high_count: 0, medium_count: 0, low_count: 0 };
  const content = readFileSync(path, 'utf8');
  // Structure: `## Refactor candidates` → `### High|Medium|Low` → `#### slug` items.
  // A non-severity H3 or any H2 closes the current severity section.
  const counts = { High: 0, Medium: 0, Low: 0 };
  let currentSeverity = null;
  for (const line of content.split(/\r?\n/)) {
    const sevMatch = line.match(/^###\s+(High|Medium|Low)\s*$/);
    if (sevMatch) {
      currentSeverity = sevMatch[1];
      continue;
    }
    if (/^###\s+/.test(line)) {
      currentSeverity = null;
      continue;
    }
    if (/^##\s+/.test(line)) {
      currentSeverity = null;
      continue;
    }
    if (currentSeverity && /^####\s+/.test(line)) {
      counts[currentSeverity]++;
    }
  }
  return {
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
process.stdout.write(JSON.stringify(result, null, PRETTY ? 2 : 0) + '\n');
