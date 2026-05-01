// Aggregates the agent tool-use log into a human-readable report.
//
// Reads .claude/logs/tool-use.jsonl (populated by the PostToolUse hook
// at .claude/hooks/log-tool-use.sh) and summarises:
//
//   - Top files agents read (signal: where the agent's mental model is built)
//   - Top files agents edit (signal: where work concentrates)
//   - Top grep / glob patterns (signal: what the agent is searching for —
//     repeated greps in an area may indicate missing CLAUDE.md coverage there)
//   - Files that are both read AND grepped (the agent had to find them; a
//     subdir CLAUDE.md mention might short-circuit future searches)
//
// Why this exists: the agent-context-system architecture decides which
// subdir CLAUDE.md files to write based on telemetry, not vibes. Reading
// "the top 20 files agents touched this week" is the input to "do we need
// a CLAUDE.md in components/X/?"
//
// Usage:
//   node scripts/agent-telemetry-report.cjs              → last 7 days, top 20
//   node scripts/agent-telemetry-report.cjs --days 30
//   node scripts/agent-telemetry-report.cjs --top 50
//
// npm scripts:
//   agent-telemetry  → run the report

'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const FLAG_TAKES_VALUE = new Set(['--days', '--top']);

const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};

const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    if (FLAG_TAKES_VALUE.has(args[i])) i++;
    continue;
  }
  positional.push(args[i]);
}

const ROOT_DIR = positional[0] || '.';
const DAYS = Number(flagValue('--days')) || 7;
const TOP = Number(flagValue('--top')) || 20;
const LOG_PATH = path.join(ROOT_DIR, '.claude/logs/tool-use.jsonl');

if (!fs.existsSync(LOG_PATH)) {
  console.log(`No telemetry log at ${LOG_PATH}.`);
  console.log(`Hook setup: see .claude/settings.json + .claude/hooks/log-tool-use.sh`);
  console.log(`Once an agent runs Read/Grep/Glob/Edit, the log will appear.`);
  process.exit(0);
}

const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
const lines = fs.readFileSync(LOG_PATH, 'utf8').split(/\n/).filter(Boolean);

const counts = {
  byTool: new Map(),
  fileReads: new Map(),
  fileEdits: new Map(),
  patterns: new Map(),
};
const filesGrepped = new Set();
const filesRead = new Set();

let inWindow = 0;
let outOfWindow = 0;

for (const line of lines) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  const ts = new Date(entry.timestamp);
  if (Number.isNaN(ts.getTime()) || ts < cutoff) {
    outOfWindow++;
    continue;
  }
  inWindow++;

  counts.byTool.set(entry.tool, (counts.byTool.get(entry.tool) || 0) + 1);

  if ((entry.tool === 'Read' || entry.tool === 'MultiEdit') && entry.file) {
    counts.fileReads.set(entry.file, (counts.fileReads.get(entry.file) || 0) + 1);
    filesRead.add(entry.file);
  }
  if ((entry.tool === 'Edit' || entry.tool === 'Write') && entry.file) {
    counts.fileEdits.set(entry.file, (counts.fileEdits.get(entry.file) || 0) + 1);
  }
  if ((entry.tool === 'Grep' || entry.tool === 'Glob') && entry.pattern) {
    counts.patterns.set(entry.pattern, (counts.patterns.get(entry.pattern) || 0) + 1);
    if (entry.file) filesGrepped.add(entry.file);
  }
}

function topN(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

console.log(`agent-telemetry: last ${DAYS} day(s)`);
console.log(`  ${inWindow} events in window, ${outOfWindow} outside`);
console.log('');

if (inWindow === 0) {
  console.log('  No events in window. Either no agent activity, or telemetry was disabled.');
  process.exit(0);
}

console.log(`  Events by tool:`);
for (const [tool, count] of topN(counts.byTool, 20)) {
  console.log(`    ${String(count).padStart(6)}  ${tool}`);
}
console.log('');

console.log(`  Top ${TOP} files read:`);
for (const [file, count] of topN(counts.fileReads, TOP)) {
  console.log(`    ${String(count).padStart(4)}  ${file}`);
}
console.log('');

console.log(`  Top ${TOP} files edited:`);
for (const [file, count] of topN(counts.fileEdits, TOP)) {
  console.log(`    ${String(count).padStart(4)}  ${file}`);
}
console.log('');

console.log(`  Top ${TOP} grep/glob patterns:`);
for (const [pattern, count] of topN(counts.patterns, TOP)) {
  const truncated = pattern.length > 80 ? pattern.slice(0, 77) + '...' : pattern;
  console.log(`    ${String(count).padStart(4)}  ${truncated}`);
}
console.log('');

console.log(`Hints to act on:`);
console.log(`  - Heavy reads in a subdir without a CLAUDE.md? Consider adding one.`);
console.log(`  - Many greps for the same pattern? The pattern's home isn't surfaced enough; cross-reference it from a CLAUDE.md.`);
console.log(`  - A file's read-count is huge but it's never edited? It's pure reference; consider a brief at-the-top summary comment.`);
