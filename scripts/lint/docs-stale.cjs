// Reports docs whose `last-reviewed` frontmatter date is older than a
// threshold. Powers the quarterly arch-audit cadence — reading "X files
// haven't been reviewed in 90+ days" is the trigger to re-read them
// against the current code.
//
// Why this exists: every architecture doc and dev doc has YAML frontmatter
// with a `last-reviewed` date that's bumped only on substantive content
// refreshes (not on routine edits). When the date drifts far from today,
// it's a signal the doc may have stale claims — exactly the failure mode
// the v2.15.0 audit caught.
//
// Default threshold: 90 days. The cadence is "review quarterly," so any
// doc older than a quarter is a candidate for re-audit.
//
// Usage:
//   node scripts/lint/docs-stale.cjs              → list stale docs (exit 0; informational)
//   node scripts/lint/docs-stale.cjs --days 60    → custom threshold
//   node scripts/lint/docs-stale.cjs --strict     → exit 1 if any are stale (CI mode)
//   node scripts/lint/docs-stale.cjs --json       → JSON output (for tooling)
//
// npm scripts:
//   docs:stale       → human-readable report (informational)

'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

// Flags that take a value: their immediate next argv slot is the value,
// not a positional argument.
const FLAG_TAKES_VALUE = new Set(['--days']);

const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};

// Positional = anything that's not a flag and not a flag's value.
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    if (FLAG_TAKES_VALUE.has(a)) i++; // skip the next arg (it's the value)
    continue;
  }
  positional.push(a);
}

const ROOT_DIR = positional[0] || '.';
const STALE_DAYS = (() => {
  const v = flagValue('--days');
  if (v === null) return 90;
  const n = Number(v);
  return Number.isFinite(n) ? n : 90;
})();
const STRICT = args.includes('--strict');
const JSON_OUT = args.includes('--json');

const ARCH_DIR = path.join(ROOT_DIR, 'docs/architecture');
const DEV_DIR = path.join(ROOT_DIR, 'docs/dev');

function readFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return match ? match[1] : null;
}

function getLastReviewed(frontmatter) {
  if (!frontmatter) return null;
  const m = frontmatter.match(/^last-reviewed:\s*(\d{4}-\d{2}-\d{2})/m);
  return m ? m[1] : null;
}

function daysBetween(isoDate, today) {
  const d = new Date(isoDate + 'T00:00:00Z');
  const t = new Date(today + 'T00:00:00Z');
  return Math.floor((t - d) / (1000 * 60 * 60 * 24));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function collect(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => path.join(dir, f))
    .sort();
}

const today = todayIso();
const allDocs = [...collect(ARCH_DIR), ...collect(DEV_DIR)];
const findings = [];

for (const file of allDocs) {
  const content = fs.readFileSync(file, 'utf8');
  const fm = readFrontmatter(content);
  const date = getLastReviewed(fm);
  if (!date) {
    findings.push({
      file: path.relative(ROOT_DIR, file),
      date: null,
      days: null,
      status: 'no-date',
    });
    continue;
  }
  const days = daysBetween(date, today);
  const status = days > STALE_DAYS ? 'stale' : 'fresh';
  findings.push({ file: path.relative(ROOT_DIR, file), date, days, status });
}

const stale = findings.filter((f) => f.status === 'stale' || f.status === 'no-date');

if (JSON_OUT) {
  console.log(JSON.stringify({ today, threshold: STALE_DAYS, findings }, null, 2));
} else {
  console.log(`docs:stale — threshold ${STALE_DAYS} days (today: ${today})`);
  console.log(`  ${findings.length} doc(s) tracked, ${stale.length} stale`);
  console.log('');
  if (stale.length === 0) {
    console.log('  ✓ All docs reviewed within threshold.');
  } else {
    for (const f of stale) {
      const tag = f.status === 'no-date' ? '(no last-reviewed)' : `(${f.days} days)`;
      console.log(`  ${f.file}  ${tag}`);
    }
  }
  console.log('');
  if (stale.length > 0 && !STRICT) {
    console.log('  Run with --strict to fail CI on stale docs.');
    console.log(
      '  To address: re-read each stale doc against current code, fix any drift, bump last-reviewed.',
    );
  }
}

process.exit(STRICT && stale.length > 0 ? 1 : 0);
