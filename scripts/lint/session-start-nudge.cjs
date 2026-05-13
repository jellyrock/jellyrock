// scripts/lint/session-start-nudge.cjs — Local-only state check fired on
// SessionStart. Prints a one-line advisory ONLY when actionable journal /
// handoff state exists; silent (exit 0, no output) when clean.
//
// Three checks, all offline:
//   1. Pending handoffs in .claude/handoffs/ (count + max age)
//   2. docs/progress.md staleness (>7d since last-updated AND commits since)
//   3. Schema-broken journals (frontmatter parse error on progress / signals)
//
// Network-dependent banners (failed CI, PR review requested) stay in
// /focus itself — this hook is cheap and offline-tolerant by design so it
// can't slow down session start or hit gh rate limits on heavy automation.
//
// Always exits 0. Never blocks. Mirrors the advisory-nudge shape of
// scripts/lint/progress-cursor-nudge.cjs.
//
// Usage:
//   node scripts/lint/session-start-nudge.cjs

'use strict';

const { execSync } = require('child_process');
const { existsSync, readFileSync, readdirSync, statSync } = require('fs');
const { join } = require('path');

const { readFrontmatter, getLastUpdated } = require('../lib/frontmatter.cjs');

const REPO_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const HANDOFFS_DIR = join(REPO_ROOT, '.claude/handoffs');
const PROGRESS_PATH = join(REPO_ROOT, 'docs/progress.md');
const SIGNALS_PATH = join(REPO_ROOT, 'docs/signals-backlog.md');

const STALE_DAYS_THRESHOLD = 7;
const HANDOFF_RETENTION_DAYS = 30;

function safeExec(cmd) {
  try {
    return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function checkHandoffs() {
  if (!existsSync(HANDOFFS_DIR)) return null;
  const cutoff = Date.now() - HANDOFF_RETENTION_DAYS * 86400 * 1000;
  const files = readdirSync(HANDOFFS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      try {
        return { name: f, mtime: statSync(join(HANDOFFS_DIR, f)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((x) => x && x.mtime >= cutoff);
  if (files.length === 0) return null;
  const maxAgeDays = Math.floor((Date.now() - Math.min(...files.map((f) => f.mtime))) / 86400000);
  return { count: files.length, maxAgeDays };
}

function checkProgressStale() {
  if (!existsSync(PROGRESS_PATH)) return null;
  const content = readFileSync(PROGRESS_PATH, 'utf8');
  const fm = readFrontmatter(content);
  const lastUpdated = getLastUpdated(fm);
  if (!lastUpdated) return null;
  const last = new Date(lastUpdated + 'T00:00:00Z').getTime();
  if (Number.isNaN(last)) return null;
  const days = Math.floor((Date.now() - last) / 86400000);
  if (days <= STALE_DAYS_THRESHOLD) return null;
  const commitsSince = safeExec(`git log --oneline --since="${lastUpdated}" -- docs/progress.md`)
    .trim()
    .split('\n')
    .filter(Boolean).length;
  const allCommitsSince = safeExec(`git log --oneline --since="${lastUpdated}"`)
    .trim()
    .split('\n')
    .filter(Boolean).length;
  if (allCommitsSince === 0) return null;
  return { days, commitsSince: allCommitsSince - commitsSince };
}

function checkSchemaBroken() {
  const broken = [];
  for (const path of [PROGRESS_PATH, SIGNALS_PATH]) {
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, 'utf8');
      const fm = readFrontmatter(content);
      if (!fm) {
        broken.push({ path, reason: 'missing frontmatter' });
        continue;
      }
      if (!getLastUpdated(fm)) {
        broken.push({ path, reason: 'missing or malformed last-updated' });
      }
    } catch (err) {
      broken.push({ path, reason: err.message });
    }
  }
  return broken.length > 0 ? broken : null;
}

function main() {
  const handoffs = checkHandoffs();
  const progressStale = checkProgressStale();
  const schemaBroken = checkSchemaBroken();

  if (!handoffs && !progressStale && !schemaBroken) {
    process.exit(0);
  }

  const parts = [];
  if (handoffs) {
    parts.push(
      `${handoffs.count} pending handoff${handoffs.count === 1 ? '' : 's'} (oldest ${handoffs.maxAgeDays}d)`,
    );
  }
  if (progressStale) {
    parts.push(
      `progress.md ${progressStale.days}d stale, ${progressStale.commitsSince} commit(s) since`,
    );
  }
  if (schemaBroken) {
    parts.push(
      `schema issue in ${schemaBroken.map((b) => b.path.replace(REPO_ROOT + '/', '')).join(', ')}`,
    );
  }

  console.log('');
  console.log(
    `💡 Session start — actionable state: ${parts.join('; ')}. Consider \`/focus\` for triage, or \`/catchup\` for state-only briefing.`,
  );
  console.log('');

  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { checkHandoffs, checkProgressStale, checkSchemaBroken };
