// scripts/crash-report.js — Process Roku weekly crash-report CSVs.
//
// Roku emails an aggregate "Crash Reporting" CSV (default window: last 7 days)
// listing unique crash signatures with counts, distinct-device counts, OS
// releases, app versions, and pkg:/path.brs(line) references. This script
// turns that report into tracked GitHub issues — one per unique above-threshold
// crash — with the .brs:line resolved back to source .bs:line via the version's
// own source maps (built in a temporary git worktree using bsconfig-analysis.json).
//
// Two-phase CLI keeps the user-confirmation step in the orchestrating skill:
//
//   plan    — parse input, build the version, resolve source locations,
//             search GH for existing matches, emit a JSON plan. No GH writes.
//   execute — read a plan JSON, perform GH writes (create / comment / reopen),
//             write a run-summary handoff.
//
// Usage:
//   node scripts/crash-report.js plan --input <csv|zip> [--min-devices N]
//     [--min-dates N] [--no-build] [--dashboard-csv <path>] --plan-out <path>
//   node scripts/crash-report.js execute --plan <plan.json> [--label crash]
//     [--handoff-dir <path>]
//
// Public exports (for tests): all pure / IO-free helpers are named exports so
// the Vitest suite at tests/scripts/unit/crash-report.test.js can drive them
// directly without spawning a subprocess.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { SourceMapConsumer } from 'source-map';

const require = createRequire(import.meta.url);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const REQUIRED_CSV_HEADERS = [
  'Date',
  'Roku OS Release',
  'App Version',
  'Error Text',
  'Total Count of Crashes',
  'Total Count of Devices with Crashes',
];

export const DEFAULT_MIN_DEVICES = 2;
export const DEFAULT_MIN_DATES = 2;
export const DEFAULT_LABEL = 'crash';

// Lazy-loaded heavy dep so tests can import the pure helpers without paying
// the adm-zip load cost.
let _admZipCtor = null;
function loadAdmZip() {
  if (!_admZipCtor) _admZipCtor = require('adm-zip');
  return _admZipCtor;
}

// ────────────────────────────────────────────────────────────────────
// CSV parsing
// ────────────────────────────────────────────────────────────────────

/**
 * Validate that a CSV's header line matches the Roku crash-report shape.
 * Used to filter out unrelated CSVs that might be bundled in a zip.
 */
export function validateRokuCrashCsv(headerLine) {
  if (typeof headerLine !== 'string' || headerLine.length === 0) return false;
  const headers = parseCsvLine(headerLine).map((h) => h.trim());
  return REQUIRED_CSV_HEADERS.every((req) => headers.includes(req));
}

/**
 * Parse a single CSV line, handling quoted fields containing the separator
 * and escaped double-quotes ("") per RFC-4180. `sep` defaults to ',' for the
 * weekly email CSV; pass '\t' for the dashboard's tab-separated export.
 */
function parseCsvLine(line, sep = ',') {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === sep) {
        fields.push(cur);
        cur = '';
      } else cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

/**
 * Split CSV text into logical lines respecting newlines inside quoted fields.
 */
function splitCsvRows(text) {
  const rows = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        cur += c;
      }
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (cur.length) rows.push(cur);
      cur = '';
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else {
      cur += c;
    }
  }
  if (cur.length) rows.push(cur);
  return rows;
}

/**
 * Parse a Roku crash-report CSV. Returns an array of normalized rows.
 * Throws if the header doesn't match the expected Roku shape.
 */
export function parseCsv(csvText) {
  const rows = splitCsvRows(csvText);
  if (rows.length === 0) return [];
  const headerLine = rows[0];
  if (!validateRokuCrashCsv(headerLine)) {
    throw new Error(
      `CSV does not look like a Roku crash report. Expected headers including: ${REQUIRED_CSV_HEADERS.join(', ')}.`,
    );
  }
  const headers = parseCsvLine(headerLine).map((h) => h.trim());
  const idx = (name) => headers.indexOf(name);
  const result = [];
  for (let r = 1; r < rows.length; r++) {
    const fields = parseCsvLine(rows[r]).map((f) => f.trim());
    if (fields.every((f) => f === '')) continue;
    result.push({
      date: fields[idx('Date')] ?? '',
      osRelease: fields[idx('Roku OS Release')] ?? '',
      version: fields[idx('App Version')] ?? '',
      errorText: fields[idx('Error Text')] ?? '',
      crashes: Number(fields[idx('Total Count of Crashes')] ?? 0) || 0,
      devices: Number(fields[idx('Total Count of Devices with Crashes')] ?? 0) || 0,
    });
  }
  return result;
}

/**
 * Concatenate rows from multiple CSVs and drop exact duplicates. Useful when
 * a zip contains overlapping report slices.
 */
export function mergeCsvs(csvTexts) {
  const allRows = [];
  const seen = new Set();
  for (const text of csvTexts) {
    const rows = parseCsv(text);
    for (const row of rows) {
      const key = `${row.date}|${row.osRelease}|${row.version}|${row.errorText}|${row.crashes}|${row.devices}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allRows.push(row);
    }
  }
  return allRows;
}

// ────────────────────────────────────────────────────────────────────
// Dashboard backtrace CSV (optional enrichment input)
// ────────────────────────────────────────────────────────────────────
//
// Pulled manually from Roku's analytics dashboard. Tab-separated, 4 columns:
//   Daily Error Key | Date | Backtrace Formatted | Backtrace Text Formatted
//
// One row per (signature, date) — the same crash on different days produces
// separate rows. The 4th column carries the parseable payload: a single CSV-
// quoted string where `~~` separates what would otherwise be newlines.
//
// The weekly email CSV remains the primary input (it carries crash counts
// and drives thresholds). The dashboard CSV is optional enrichment that
// attaches multi-frame backtraces + local-variable snapshots to issue bodies.

const DASHBOARD_REQUIRED_HEADERS = ['Date', 'Backtrace Text Formatted'];

const BACKTRACE_FRAME_RE =
  /^#(\d+)\s+Function\s+(\w+)\s*\(([^)]*)\)\s*As\s+(\S+)\s+file\/line:\s*(pkg:\/[^()\s]+)\((\d+)\)/i;

const ERROR_HEADER_RE = /\(runtime error\s+(&h[0-9a-f]+)\)\s+in\s+(pkg:\/[^()\s]+)\((\d+)\)/i;

/**
 * Validate that a header line looks like a Roku analytics dashboard export.
 */
export function validateDashboardCsv(headerLine) {
  if (typeof headerLine !== 'string' || headerLine.length === 0) return false;
  const headers = parseCsvLine(headerLine, '\t').map((h) => h.trim());
  return DASHBOARD_REQUIRED_HEADERS.every((req) => headers.includes(req));
}

/**
 * Parse the `Backtrace Text Formatted` cell into structured pieces. Returns
 * null when the cell can't be recognized as a backtrace. The cell uses `~~`
 * as an in-cell line separator; we split on it and walk three sections —
 * header (one line), frames (after `Backtrace:`), locals (after
 * `Local Variables:`).
 *
 * Returns:
 *   {
 *     errorMessage: string,        // top-line message (quoted body)
 *     errorCode: string | null,    // "&hec" etc.
 *     frames: [{ index, function, args, returnType, pkgPath, line }, ...],
 *                                  // ordered as printed (innermost first)
 *     locals: [{ raw }, ...],      // raw text per local line (preserved as-is)
 *   }
 */
export function parseBacktraceCell(cellText) {
  if (typeof cellText !== 'string' || cellText.length === 0) return null;
  const parts = cellText
    .split('~~')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return null;

  const header = parts[0];
  const headerMatch = ERROR_HEADER_RE.exec(header);
  if (!headerMatch) return null;
  const errorCode = headerMatch[1];

  // Extract the human-readable message: everything before the runtime-error tail.
  // Strip surrounding single-quotes if present.
  const tailIdx = header.search(/\(runtime error/i);
  let errorMessage = tailIdx > 0 ? header.slice(0, tailIdx).trim() : header;
  if (errorMessage.startsWith("'") && errorMessage.endsWith("'")) {
    errorMessage = errorMessage.slice(1, -1);
  }

  const frames = [];
  const locals = [];
  let mode = 'preamble'; // preamble → frames → locals
  for (let i = 1; i < parts.length; i++) {
    const line = parts[i];
    if (/^Backtrace:/i.test(line)) {
      mode = 'frames';
      continue;
    }
    if (/^Local Variables:/i.test(line)) {
      mode = 'locals';
      continue;
    }
    if (mode === 'frames') {
      const m = BACKTRACE_FRAME_RE.exec(line);
      if (m) {
        frames.push({
          index: Number(m[1]),
          function: m[2],
          args: m[3].trim(),
          returnType: m[4],
          pkgPath: m[5],
          line: Number(m[6]),
        });
      }
    } else if (mode === 'locals') {
      locals.push({ raw: line });
    }
  }

  if (frames.length === 0) return null;
  return { errorMessage, errorCode, frames, locals };
}

/**
 * The crash signature is keyed by the *innermost* frame — same convention as
 * groupBySignature uses with the email CSV (which only carries one frame).
 * In a backtrace, the innermost frame is the one with the highest index.
 */
export function innermostFrame(parsed) {
  if (!parsed || !Array.isArray(parsed.frames) || parsed.frames.length === 0) return null;
  return parsed.frames.reduce((acc, f) => (acc == null || f.index > acc.index ? f : acc), null);
}

/**
 * Parse a Roku analytics dashboard CSV. Returns Map<signature, BacktraceEntry>
 * where signature is `${pkgPath}(${line})` of the innermost frame (matching
 * the email-CSV signature key from groupBySignature). When multiple rows
 * share a signature (same crash on different days), the most-recent-by-date
 * row wins — local variable values are a per-crash snapshot, so we keep one.
 */
export function parseDashboardCsv(text) {
  const out = new Map();
  if (typeof text !== 'string' || text.length === 0) return out;
  const rows = splitCsvRows(text);
  if (rows.length === 0) return out;
  if (!validateDashboardCsv(rows[0])) {
    throw new Error(
      `Input does not look like a Roku analytics dashboard CSV. Expected tab-separated headers including: ${DASHBOARD_REQUIRED_HEADERS.join(', ')}.`,
    );
  }
  const headers = parseCsvLine(rows[0], '\t').map((h) => h.trim());
  const dateIdx = headers.indexOf('Date');
  const textIdx = headers.indexOf('Backtrace Text Formatted');
  for (let r = 1; r < rows.length; r++) {
    const fields = parseCsvLine(rows[r], '\t');
    const date = (fields[dateIdx] ?? '').trim();
    const cell = fields[textIdx] ?? '';
    const parsed = parseBacktraceCell(cell);
    if (!parsed) continue;
    const inner = innermostFrame(parsed);
    if (!inner) continue;
    const signature = `${inner.pkgPath}(${inner.line})`;
    const entry = {
      signature,
      date,
      errorMessage: parsed.errorMessage,
      errorCode: parsed.errorCode,
      frames: parsed.frames,
      locals: parsed.locals,
    };
    const prev = out.get(signature);
    if (!prev || (date && date > (prev.date ?? ''))) {
      out.set(signature, entry);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Crash signature parsing + grouping
// ────────────────────────────────────────────────────────────────────

const ERROR_TEXT_RE = /Function\s+(\w+)\s*\([^)]*\)[^;]*;\s*(pkg:\/[^()\s]+)\((\d+)\)/i;

/**
 * Extract function name + pkg path + line from a Roku Error Text string.
 * Returns null when the text doesn't match the expected shape (rare).
 */
export function parseErrorText(errorText) {
  if (typeof errorText !== 'string') return null;
  const m = ERROR_TEXT_RE.exec(errorText);
  if (!m) return null;
  return {
    function: m[1],
    pkgPath: m[2],
    line: Number(m[3]),
  };
}

/**
 * Group CSV rows by crash signature (pkgPath + line). Returns a Map keyed by
 * signature, with aggregated occurrence stats.
 */
export function groupBySignature(rows) {
  const groups = new Map();
  for (const row of rows) {
    const parsed = parseErrorText(row.errorText);
    if (!parsed) continue;
    const signature = `${parsed.pkgPath}(${parsed.line})`;
    let group = groups.get(signature);
    if (!group) {
      group = {
        signature,
        pkgPath: parsed.pkgPath,
        line: parsed.line,
        function: parsed.function,
        rawErrorText: row.errorText,
        versions: new Set(),
        osReleases: new Set(),
        dates: new Set(),
        totalCrashes: 0,
        maxDevicesPerRow: 0,
        sumDevices: 0,
        rows: [],
      };
      groups.set(signature, group);
    }
    group.versions.add(row.version);
    group.osReleases.add(row.osRelease);
    group.dates.add(row.date);
    group.totalCrashes += row.crashes;
    group.sumDevices += row.devices;
    group.maxDevicesPerRow = Math.max(group.maxDevicesPerRow, row.devices);
    group.rows.push(row);
  }
  return groups;
}

/**
 * Split groups into kept (above threshold) and filtered (below). Threshold is
 * met when EITHER max-devices-per-row meets minDevices OR distinct date count
 * meets minDates — catches both "wide" and "persistent" patterns.
 */
export function applyThreshold(groups, { minDevices, minDates } = {}) {
  const minDev = minDevices ?? DEFAULT_MIN_DEVICES;
  const minDt = minDates ?? DEFAULT_MIN_DATES;
  const kept = [];
  const filtered = [];
  for (const group of groups.values()) {
    if (group.maxDevicesPerRow >= minDev || group.dates.size >= minDt) {
      kept.push(group);
    } else {
      filtered.push(group);
    }
  }
  return { kept, filtered };
}

// ────────────────────────────────────────────────────────────────────
// Category inference (best-effort, regex-based)
// ────────────────────────────────────────────────────────────────────

/**
 * Infer a crash category from a source code snippet (the lines around the
 * crash). Pure regex heuristics — render in the issue as "Suspected category"
 * so triagers know to verify.
 */
export function inferCategory(codeSnippet, errorText = '') {
  if (typeof codeSnippet !== 'string') return 'unknown';
  const code = codeSnippet;
  if (/\bm\.global\./.test(code)) return 'global-state-race';
  if (/findNode\s*\(/.test(code) && /findNode\s*\([^)]+\)\s*[.[]/.test(code)) {
    return 'null-node-ref';
  }
  if (/(tokenize|split)\s*\(/i.test(code) && /\[\s*\d+\s*\]/.test(code)) {
    return 'array-bounds';
  }
  if (/callFunc\s*\(/.test(code) && /\b(for|while)\b/i.test(code)) {
    return 'callback-exception';
  }
  // Heuristic: if function name starts with "on" (event handler) and has no
  // arg-null guard in the first lines, flag as event-handler nil arg.
  const fnMatch = /Function\s+(on\w+)\s*\(\s*(\w+)/i.exec(errorText);
  if (fnMatch) {
    const argName = fnMatch[2];
    if (argName && !new RegExp(`(invalid|isvalid)\\s*\\(?\\s*${argName}\\b`, 'i').test(code)) {
      return 'event-handler-nil-arg';
    }
  }
  return 'unknown';
}

// ────────────────────────────────────────────────────────────────────
// Known-noise classification
//
// Some crashes are long-running, hardware-specific, or otherwise "won't fix"
// — race conditions the team has accepted as ongoing noise. Filing a new
// issue per signature per week for these is pure noise. Instead the user
// declares them in .crash-report/known-noise.yml; the skill suppresses
// per-signature issue activity AND posts a single comment to the tracker
// issue when combined occurrence count crosses a baseline × multiplier
// threshold (spike detection). See docs/dev/crash-reports.md.
// ────────────────────────────────────────────────────────────────────

export const NOISE_CONFIG_PATH = '.crash-report/known-noise.yml';
export const DEFAULT_SPIKE_MULTIPLIER = 2.0;

/**
 * Load the noise config from <repoRoot>/.crash-report/known-noise.yml.
 * Returns `{ patterns: [] }` when the file doesn't exist (noise filter
 * silently inactive). Throws on parse error / schema violation — fail-loud
 * is the right move here because a silently-broken filter would leak the
 * noise it's meant to dampen.
 */
export function loadNoiseConfig(repoRoot = REPO_ROOT) {
  const path = join(repoRoot, NOISE_CONFIG_PATH);
  if (!existsSync(path)) return { patterns: [] };
  const yaml = require('js-yaml');
  const raw = readFileSync(path, 'utf8');
  const parsed = yaml.load(raw) ?? {};
  const patterns = Array.isArray(parsed.patterns) ? parsed.patterns : [];
  for (const p of patterns) {
    if (!p || typeof p !== 'object') {
      throw new Error(`${NOISE_CONFIG_PATH}: each pattern must be a mapping`);
    }
    if (typeof p.id !== 'string' || !p.id) {
      throw new Error(`${NOISE_CONFIG_PATH}: pattern missing required string \`id\``);
    }
    if (typeof p.tracker_issue !== 'number') {
      throw new Error(
        `${NOISE_CONFIG_PATH}: pattern \`${p.id}\` missing numeric \`tracker_issue\``,
      );
    }
    if (typeof p.baseline_crashes_per_week !== 'number') {
      throw new Error(
        `${NOISE_CONFIG_PATH}: pattern \`${p.id}\` missing numeric \`baseline_crashes_per_week\``,
      );
    }
    if (!p.match || typeof p.match !== 'object') {
      throw new Error(`${NOISE_CONFIG_PATH}: pattern \`${p.id}\` missing \`match\` mapping`);
    }
    p.spike_multiplier ??= DEFAULT_SPIKE_MULTIPLIER;
  }
  return { patterns };
}

/**
 * Decide whether a single crash group matches a single noise pattern.
 *
 * All provided match fields must agree (AND). Empty / missing match fields
 * are "wildcards" that don't constrain.
 */
export function matchNoisePattern(group, sourceInfo, pattern) {
  const m = pattern.match ?? {};
  if (m.function) {
    if (!new RegExp(m.function).test(group.function)) return false;
  }
  if (m.category) {
    // Category is computed downstream from source; require source resolution
    // to have succeeded AND match. We carry category through the group's
    // metadata when classification runs (see classifyAgainstNoise).
    if (group.inferredCategory !== m.category) return false;
  }
  if (m.file_glob) {
    const globs = Array.isArray(m.file_glob) ? m.file_glob : [m.file_glob];
    const bsFile = sourceInfo?.bsFile;
    if (!bsFile) return false;
    if (!globs.some((g) => globMatch(g, bsFile))) return false;
  }
  if (m.snippet_regex) {
    const snippet = sourceInfo?.codeSnippet ?? '';
    if (!new RegExp(m.snippet_regex).test(snippet)) return false;
  }
  return true;
}

// Minimal glob → regex (supports * and **). Path separators are '/'.
function globMatch(glob, path) {
  const re = new RegExp(
    '^' +
      glob
        .split(/(\*\*|\*)/)
        .map((segment) => {
          if (segment === '**') return '.*';
          if (segment === '*') return '[^/]*';
          return segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('') +
      '$',
  );
  return re.test(path);
}

/**
 * Partition groups into noise-matched (per pattern) and novel. Mutates each
 * group to carry `inferredCategory` so matchNoisePattern can read it.
 *
 * Returns:
 *   { byPattern: Map<patternId, { pattern, groups[] }>, novel: groups[] }
 */
export function classifyAgainstNoise(groups, sourceBySig, config) {
  const byPattern = new Map();
  const novel = [];
  for (const group of groups) {
    const source = sourceBySig.get(group.signature) ?? null;
    // Stash category on the group so matchNoisePattern can read it without
    // re-deriving from snippet + errorText.
    group.inferredCategory = inferCategory(source?.codeSnippet ?? '', group.rawErrorText);
    let matched = null;
    for (const pattern of config.patterns) {
      if (matchNoisePattern(group, source, pattern)) {
        matched = pattern;
        break; // first-match wins
      }
    }
    if (matched) {
      let bucket = byPattern.get(matched.id);
      if (!bucket) {
        bucket = { pattern: matched, groups: [] };
        byPattern.set(matched.id, bucket);
      }
      bucket.groups.push(group);
    } else {
      novel.push(group);
    }
  }
  return { byPattern, novel };
}

/**
 * For each pattern with matched groups, decide whether the combined count
 * exceeds the spike threshold and prepare a structured spike record.
 *
 * Returns array of:
 *   { patternId, trackerIssue, signatures, totalCrashes, baseline,
 *     spikeMultiplier, ratio, isSpike, commentBody (null when not a spike) }
 */
export function evaluateSpikes(byPattern, { runDate, csvWindow }) {
  const out = [];
  for (const { pattern, groups } of byPattern.values()) {
    const totalCrashes = groups.reduce((sum, g) => sum + g.totalCrashes, 0);
    const baseline = pattern.baseline_crashes_per_week;
    const multiplier = pattern.spike_multiplier;
    const threshold = baseline * multiplier;
    const isSpike = totalCrashes > threshold;
    const ratio = baseline > 0 ? totalCrashes / baseline : Infinity;
    out.push({
      patternId: pattern.id,
      trackerIssue: pattern.tracker_issue,
      signatures: groups.map((g) => g.signature),
      totalCrashes,
      baseline,
      spikeMultiplier: multiplier,
      ratio: Number(ratio.toFixed(2)),
      isSpike,
      commentBody: isSpike ? draftSpikeComment(pattern, groups, { runDate, csvWindow }) : null,
    });
  }
  return out;
}

export function draftSpikeComment(pattern, groups, { runDate, csvWindow }) {
  const totalCrashes = groups.reduce((sum, g) => sum + g.totalCrashes, 0);
  const baseline = pattern.baseline_crashes_per_week;
  const multiplier = pattern.spike_multiplier;
  const ratio = baseline > 0 ? (totalCrashes / baseline).toFixed(2) : '∞';
  const windowStr =
    csvWindow.start && csvWindow.end ? `${csvWindow.start} to ${csvWindow.end}` : runDate;
  const sigLines = groups
    .map(
      (g) => `- \`${g.signature}\` — ${g.totalCrashes} crashes, max ${g.maxDevicesPerRow} devices`,
    )
    .join('\n');
  return `**Spike alert** from \`/crash-report\` run on ${runDate} (Roku report window: ${windowStr})

Combined crashes matching noise pattern \`${pattern.id}\`: **${totalCrashes}** across ${groups.length} signature(s) — vs baseline **${baseline}/week** and spike multiplier **${multiplier}×**. Ratio: **${ratio}×**.

Matched signatures:
${sigLines}

This pattern is normally suppressed (see [.crash-report/known-noise.yml](../tree/HEAD/.crash-report/known-noise.yml)). The spike crossed the configured threshold, so this comment is automated. If the spike is a one-off, no action needed. If it's sustained or growing, consider re-investigating or tuning the baseline.
`;
}

// ────────────────────────────────────────────────────────────────────
// Version-to-tag resolution
// ────────────────────────────────────────────────────────────────────

/**
 * Resolve an app version (e.g. "2.17.0") to a git tag. Exact match preferred;
 * falls back to the highest tag whose version is ≤ the requested version with
 * the same major.minor (covers the "manifest didn't bump for late commits"
 * case).
 *
 * Returns { tag, exactMatch } or null when no tag matches.
 */
export function resolveVersionTag(version, gitExec = defaultGitExec) {
  if (!version) return null;
  const exact = `v${version}`;
  const allTags = gitExec(['tag', '--list', 'v*'])
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);
  if (allTags.includes(exact)) return { tag: exact, exactMatch: true };
  // Same major.minor fallback: pick highest with that prefix.
  const [major, minor] = version.split('.').slice(0, 2);
  if (!major || !minor) return null;
  const prefix = `v${major}.${minor}.`;
  const candidates = allTags
    .filter((t) => t.startsWith(prefix))
    .sort((a, b) => semverCompare(b, a));
  if (candidates.length) return { tag: candidates[0], exactMatch: false };
  return null;
}

function semverCompare(a, b) {
  const pa = a
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10));
  const pb = b
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function defaultGitExec(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

// ────────────────────────────────────────────────────────────────────
// Input resolution — CSV file / ZIP / stdin
// ────────────────────────────────────────────────────────────────────

/**
 * Resolve the input arg into a set of CSV texts. Supports:
 *   - a .csv path  → reads the file, returns one text
 *   - a .zip path  → extracts to tmp, walks for Roku crash CSVs (by header
 *     shape, NOT filename), returns matching texts. Unrelated files in the
 *     zip are listed as `ignoredFiles`.
 *   - '-' or undefined → reads stdin
 *
 * Returns { kind, csvTexts, ignoredFiles, tmpDir, sourcePath, cleanup }.
 */
export function resolveInput(arg, { stdinReader = readStdin } = {}) {
  if (!arg || arg === '-') {
    const text = stdinReader();
    if (!text) throw new Error('No input on stdin and no --input path given.');
    return {
      kind: 'stdin',
      csvTexts: [text],
      ignoredFiles: [],
      tmpDir: null,
      sourcePath: '<stdin>',
      cleanup: () => {},
    };
  }
  const absolute = isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
  if (!existsSync(absolute)) {
    throw new Error(`Input not found: ${arg}`);
  }
  if (absolute.toLowerCase().endsWith('.csv')) {
    const text = readFileSync(absolute, 'utf8');
    if (!validateRokuCrashCsv(text.split(/\r?\n/)[0] ?? '')) {
      throw new Error(
        `File ${arg} does not look like a Roku crash-report CSV (header check failed).`,
      );
    }
    return {
      kind: 'csv',
      csvTexts: [text],
      ignoredFiles: [],
      tmpDir: null,
      sourcePath: absolute,
      cleanup: () => {},
    };
  }
  if (absolute.toLowerCase().endsWith('.zip')) {
    return extractZip(absolute);
  }
  throw new Error(`Input must be .csv, .zip, or '-' for stdin. Got: ${arg}`);
}

function extractZip(zipPath) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'jellyrock-crash-zip-'));
  const cleanup = () => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  };
  try {
    const AdmZip = loadAdmZip();
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tmpDir, true);
    const csvTexts = [];
    const ignoredFiles = [];
    for (const entry of walkFiles(tmpDir)) {
      const lower = entry.toLowerCase();
      const rel = relative(tmpDir, entry);
      if (!lower.endsWith('.csv')) {
        ignoredFiles.push(rel);
        continue;
      }
      const text = readFileSync(entry, 'utf8');
      const firstLine = text.split(/\r?\n/)[0] ?? '';
      if (!validateRokuCrashCsv(firstLine)) {
        ignoredFiles.push(rel);
        continue;
      }
      csvTexts.push(text);
    }
    if (csvTexts.length === 0) {
      cleanup();
      throw new Error(
        `Zip ${basename(zipPath)} contained no Roku crash-report CSVs (header check failed on all CSVs).`,
      );
    }
    return { kind: 'zip', csvTexts, ignoredFiles, tmpDir, sourcePath: zipPath, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walkFiles(full);
    else yield full;
  }
}

function readStdin() {
  try {
    const fd = 0;
    return readFileSync(fd, 'utf8');
  } catch {
    return '';
  }
}

// ────────────────────────────────────────────────────────────────────
// Build in a temporary git worktree
// ────────────────────────────────────────────────────────────────────

/**
 * Create a git worktree at the given tag/ref and run the analysis build there.
 * Generates bsconfig-analysis.json by reading the worktree's own bsconfig-prod.json
 * and flipping sourceMap on — this means the build always uses the plugin list
 * that existed at the tagged commit, not the current HEAD's plugin list.
 *
 * Returns { worktreePath, buildDir, cleanup } where cleanup removes the worktree.
 */
export function buildAnalysisInWorktree(
  tag,
  { repoRoot = REPO_ROOT, logger = console.error } = {},
) {
  const worktreePath = mkdtempSync(join(tmpdir(), 'jellyrock-crash-wt-'));
  const cleanup = () => {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: repoRoot,
        stdio: 'pipe',
      });
    } catch {
      // best-effort; fall through to rm
    }
    try {
      rmSync(worktreePath, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  };
  try {
    logger(`[crash-report] creating worktree at ${tag} → ${worktreePath}`);
    execFileSync('git', ['worktree', 'add', '--detach', worktreePath, tag], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    // Derive bsconfig-analysis.json from the worktree's own bsconfig-prod.json.
    const prodConfigPath = join(worktreePath, 'bsconfig-prod.json');
    if (!existsSync(prodConfigPath)) {
      throw new Error(
        `Worktree at ${tag} has no bsconfig-prod.json — too old to build for crash-report analysis.`,
      );
    }
    const prodConfig = JSON.parse(readFileSync(prodConfigPath, 'utf8'));
    const analysisConfig = {
      ...prodConfig,
      sourceMap: true,
      outDir: 'build-analysis',
    };
    writeFileSync(
      join(worktreePath, 'bsconfig-analysis.json'),
      JSON.stringify(analysisConfig, null, 2) + '\n',
    );
    logger(`[crash-report] installing dependencies in worktree`);
    runStep(['npm', 'ci'], worktreePath, logger);
    logger(`[crash-report] building analysis output`);
    runStep(['npx', 'bsc', '--project', 'bsconfig-analysis.json'], worktreePath, logger);
    return {
      worktreePath,
      buildDir: join(worktreePath, 'build-analysis'),
      cleanup,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}

function runStep(cmd, cwd, logger) {
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    logger(result.stdout ?? '');
    logger(result.stderr ?? '');
    throw new Error(`Command failed: ${cmd.join(' ')} (exit ${result.status})`);
  }
}

// ────────────────────────────────────────────────────────────────────
// Source location resolution via source-map
// ────────────────────────────────────────────────────────────────────

/**
 * Resolve a single (pkgPath, lineOneBased) pair to the original source
 * {path, line, character} using the source map BSC emits alongside the
 * transpiled .brs. Returns null when no mapping is available. consumerCache
 * is a Map<destMapPath, SourceMapConsumer | null | undefined> for reuse
 * across calls inside one resolveSourceLocations invocation.
 *
 * `null` means "no map but dest file exists → assume 1:1"; `undefined`
 * means "no map AND no dest file → unresolvable".
 */
async function mapPkgLocationToSource(pkgPath, lineOneBased, buildDir, consumerCache) {
  const destPath = join(buildDir, pkgPath.replace(/^pkg:/i, ''));
  const destMapPath = destPath + '.map';

  let consumer = consumerCache.get(destMapPath);
  if (!consumerCache.has(destMapPath)) {
    if (existsSync(destMapPath)) {
      const mapJson = JSON.parse(readFileSync(destMapPath, 'utf8'));
      consumer = await new SourceMapConsumer(mapJson);
    } else {
      consumer = existsSync(destPath) ? null : undefined;
    }
    consumerCache.set(destMapPath, consumer);
  }

  if (consumer === undefined) return null;
  if (consumer === null) {
    return { path: destPath, line: lineOneBased, character: 0 };
  }

  const pos = consumer.originalPositionFor({
    line: lineOneBased,
    column: 0,
    bias: SourceMapConsumer.LEAST_UPPER_BOUND,
  });
  if (!pos || typeof pos.source !== 'string') return null;
  return {
    path: resolve(dirname(destMapPath), pos.source),
    line: pos.line ?? lineOneBased,
    character: pos.column ?? 0,
  };
}

/**
 * Resolve a set of {pkgPath, line} pairs to source {bsFile, bsLine, codeSnippet}
 * by reading source maps emitted alongside the transpiled .brs files.
 *
 * Returns Map<signature, SourceLocation | null>.
 */
export async function resolveSourceLocations(signatures, buildDir, worktreePath) {
  const consumerCache = new Map();
  const out = new Map();
  try {
    for (const sig of signatures) {
      const mapped = await mapPkgLocationToSource(sig.pkgPath, sig.line, buildDir, consumerCache);
      if (!mapped) {
        out.set(sig.signature, null);
        continue;
      }
      out.set(sig.signature, {
        bsFile: relativeToWorktree(mapped.path, worktreePath),
        bsLine: mapped.line,
        codeSnippet: readSnippet(mapped.path, mapped.line, 2),
      });
    }
  } finally {
    for (const c of consumerCache.values()) {
      if (c && typeof c.destroy === 'function') c.destroy();
    }
  }
  return out;
}

/**
 * Resolve every frame in a backtrace to source. Frames are returned in the
 * same order they came in (innermost first, per parseBacktraceCell's
 * convention). Unresolvable frames keep their pkgPath/line and get
 * { bsFile: null, bsLine: null, codeSnippet: '' }.
 *
 * Shares a SourceMapConsumer cache across the call so frames hitting the
 * same .brs only build one consumer.
 */
export async function resolveBacktraceFrames(frames, buildDir, worktreePath) {
  const consumerCache = new Map();
  const out = [];
  try {
    for (const f of frames) {
      const mapped = await mapPkgLocationToSource(f.pkgPath, f.line, buildDir, consumerCache);
      if (mapped) {
        out.push({
          ...f,
          bsFile: relativeToWorktree(mapped.path, worktreePath),
          bsLine: mapped.line,
          codeSnippet: readSnippet(mapped.path, mapped.line, 2),
        });
      } else {
        out.push({ ...f, bsFile: null, bsLine: null, codeSnippet: '' });
      }
    }
  } finally {
    for (const c of consumerCache.values()) {
      if (c && typeof c.destroy === 'function') c.destroy();
    }
  }
  return out;
}

function relativeToWorktree(absPath, worktreePath) {
  if (!worktreePath) return absPath;
  const rel = relative(worktreePath, absPath);
  return rel.startsWith('..') ? absPath : rel.split(sep).join('/');
}

function readSnippet(filePath, lineOneBased, context) {
  try {
    const text = readFileSync(filePath, 'utf8');
    const lines = text.split(/\r?\n/);
    const start = Math.max(0, lineOneBased - 1 - context);
    const end = Math.min(lines.length, lineOneBased + context);
    return lines.slice(start, end).join('\n');
  } catch {
    return '';
  }
}

// ────────────────────────────────────────────────────────────────────
// GitHub dedup + drafting
// ────────────────────────────────────────────────────────────────────

const TITLE_PREFIX = '[crash]';

export function draftIssueTitle(group) {
  const base = basename(group.pkgPath); // e.g. RectangleSecondary.brs
  const version = [...group.versions][0] ?? 'unknown';
  return `${TITLE_PREFIX} ${group.function}() in ${base}:${group.line} (v${version})`;
}

export function draftDedupSearchQuery(group) {
  // Stable substring used to match across versions. GitHub search splits on
  // colons, so wrap in quotes.
  const base = basename(group.pkgPath);
  return `"${base}:${group.line}"`;
}

/**
 * Look up an existing GH issue for each crash signature. Returns
 * Map<signature, { number, state, title } | null>. State is 'OPEN' or 'CLOSED'.
 */
export function searchExistingIssues(groups, { ghExec = defaultGhExec } = {}) {
  const out = new Map();
  for (const group of groups) {
    const query = draftDedupSearchQuery(group);
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
        '10',
      ]);
      const parsed = JSON.parse(raw || '[]');
      // The title prefix [crash] is what we filed; require that to dedup safely
      // (don't false-match a manually-filed bug that mentions the same file).
      const expectedPrefix = `${TITLE_PREFIX} ${group.function}() in ${basename(group.pkgPath)}:${group.line}`;
      const match = parsed.find(
        (iss) => typeof iss.title === 'string' && iss.title.startsWith(expectedPrefix),
      );
      out.set(
        group.signature,
        match
          ? {
              number: match.number,
              state: match.state,
              title: match.title,
            }
          : null,
      );
    } catch {
      out.set(group.signature, null);
    }
  }
  return out;
}

function defaultGhExec(args) {
  return execFileSync('gh', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

// ────────────────────────────────────────────────────────────────────
// Issue / comment body drafting
// ────────────────────────────────────────────────────────────────────

function csvWindowFromRows(rows) {
  const dates = [...new Set(rows.map((r) => r.date).filter(Boolean))].sort();
  return dates.length === 0
    ? { start: null, end: null }
    : { start: dates[0], end: dates[dates.length - 1] };
}

function occurrenceTable(rows) {
  // Sort newest-first for readability.
  const sorted = [...rows].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const header = '| Date | Roku OS | Crashes | Devices |\n|---|---|---|---|';
  const body = sorted
    .map((r) => `| ${r.date} | ${r.osRelease} | ${r.crashes} | ${r.devices} |`)
    .join('\n');
  return `${header}\n${body}`;
}

function backtraceTable(resolvedFrames) {
  const header = '| # | Function | Transpiled | Source |\n|---|---|---|---|';
  const body = resolvedFrames
    .map((f) => {
      const sig = `${f.function}(${f.args})${f.returnType ? ` As ${f.returnType}` : ''}`;
      const transpiled = `\`${f.pkgPath.replace(/^pkg:\//, '')}(${f.line})\``;
      const source = f.bsFile
        ? `[\`${f.bsFile}:${f.bsLine}\`](${f.bsFile}#L${f.bsLine})`
        : '*unresolved*';
      return `| ${f.index} | \`${sig}\` | ${transpiled} | ${source} |`;
    })
    .join('\n');
  return `${header}\n${body}`;
}

function backtraceSection(backtrace, resolvedFrames) {
  if (!backtrace || !resolvedFrames || resolvedFrames.length === 0) return '';
  const errorLine = backtrace.errorCode
    ? `**Runtime error**: \`${backtrace.errorCode}\` — ${backtrace.errorMessage}\n\n`
    : `**Runtime error**: ${backtrace.errorMessage}\n\n`;
  const localsBlock =
    backtrace.locals && backtrace.locals.length > 0
      ? `\n**Local variables at crash time** (snapshot from ${backtrace.date}):\n\n\`\`\`text\n${backtrace.locals.map((l) => l.raw).join('\n')}\n\`\`\`\n`
      : '';
  return `${errorLine}**Backtrace** (innermost frame first):\n\n${backtraceTable(resolvedFrames)}\n${localsBlock}`;
}

export function draftIssueBody(
  group,
  source,
  category,
  { runDate, csvWindow, backtrace, resolvedFrames } = {},
) {
  const version = [...group.versions][0] ?? 'unknown';
  const osReleases = [...group.osReleases].sort().join(', ') || 'unknown';
  const windowStr =
    csvWindow.start && csvWindow.end ? `${csvWindow.start} to ${csvWindow.end}` : runDate;
  const sourceHeader = source
    ? `**Source file**: [\`${source.bsFile}:${source.bsLine}\`](${source.bsFile}#L${source.bsLine})`
    : `**Source file**: *unresolved — source map lookup failed; see Transpiled file below*`;
  const codeBlock = source
    ? `**Code at line**:\n\`\`\`brightscript\n${source.codeSnippet}\n\`\`\`\n`
    : '';
  const inferredCategory =
    category && category !== 'unknown' ? `**Suspected category**: ${category}\n` : '';
  const backtraceBlock = backtraceSection(backtrace, resolvedFrames);
  const backtraceTrailer = backtraceBlock ? `\n${backtraceBlock}` : '';

  return `### What happened?
JellyRock crashed on user devices. Filed automatically by \`/crash-report\` from Roku's weekly crash report (window: ${windowStr}).

**Function**: \`${group.function}()\`
${sourceHeader}
**Transpiled file**: \`${group.pkgPath.replace(/^pkg:\//, '')}(${group.line})\`
${codeBlock}${inferredCategory}
**Occurrence stats** (this report window):

${occurrenceTable(group.rows)}

**Crash signature (raw from Roku)**:
\`\`\`
${group.rawErrorText}
\`\`\`
${backtraceTrailer}
### Steps to reproduce
Not user-reproduced. This is telemetry-sourced — no repro steps are available from Roku's aggregate crash report. The component containing this function initializes / runs when the relevant code path executes (often on app start, screen transition, or user interaction with the affected feature).

### JellyRock client version
${version}

### Roku device info
Aggregate telemetry — specific device models are not provided by Roku in the aggregate crash report. Observed Roku OS releases: ${osReleases}.

### Server connection type
N/A — telemetry-sourced.

### Logs (optional)
Not available in the aggregate report. To gather logs, reproduce in dev mode and run \`/runtime-triage\` against a captured BrightScript console log.

### Additional context (optional)
- Run \`/issue-triage <this-issue-number>\` to load a deeper investigation handoff.
- Filed by the \`/crash-report\` skill — see \`docs/dev/crash-reports.md\`.
`;
}

export function draftDedupComment(group, { runDate, csvWindow }) {
  const version = [...group.versions][0] ?? 'unknown';
  const windowStr =
    csvWindow.start && csvWindow.end ? `${csvWindow.start} to ${csvWindow.end}` : runDate;
  return `**New occurrences from \`/crash-report\` run on ${runDate}** (Roku report window: ${windowStr}):

${occurrenceTable(group.rows)}

Still occurring in app version ${version}. Crash signature unchanged.
`;
}

export function draftRegressionComment(group, { runDate, csvWindow, previousState }) {
  const version = [...group.versions][0] ?? 'unknown';
  const windowStr =
    csvWindow.start && csvWindow.end ? `${csvWindow.start} to ${csvWindow.end}` : runDate;
  return `**Regression — this crash is reoccurring** after being marked ${previousState ?? 'closed'}.

This crash signature reappeared in app version ${version} during the Roku report window ${windowStr}:

${occurrenceTable(group.rows)}

Reopening for investigation. If this is a false-positive (same crash signature, different root cause), close again with a note.
`;
}

// ────────────────────────────────────────────────────────────────────
// Plan + Execute orchestration
// ────────────────────────────────────────────────────────────────────

/**
 * Build a plan object from the parsed input. Side effects (worktree build,
 * rra lookups, gh searches) are sequenced here; everything else is pure.
 */
export async function buildPlan({
  input,
  minDevices = DEFAULT_MIN_DEVICES,
  minDates = DEFAULT_MIN_DATES,
  noBuild = false,
  buildDirOverride = null,
  noiseConfig = null,
  dashboardCsvText = null,
  gitExec = defaultGitExec,
  ghExec = defaultGhExec,
  logger = console.error,
} = {}) {
  const backtraceMap = dashboardCsvText ? parseDashboardCsv(dashboardCsvText) : new Map();
  const rows = mergeCsvs(input.csvTexts);
  if (rows.length === 0) {
    throw new Error('Input contained no parsable Roku crash-report rows.');
  }
  const window = csvWindowFromRows(rows);
  const groups = groupBySignature(rows);
  const { kept, filtered } = applyThreshold(groups, { minDevices, minDates });
  const resolvedNoiseConfig = noiseConfig ?? loadNoiseConfig();

  // Determine the build tag. Most reports cite a single version; if multiple
  // appear we resolve all of them and build once per version.
  const versionsKept = new Set();
  for (const g of kept) for (const v of g.versions) versionsKept.add(v);

  const buildsByVersion = new Map();
  const buildCleanups = [];
  const buildErrors = [];
  if (!noBuild && kept.length > 0) {
    for (const version of versionsKept) {
      const resolved = resolveVersionTag(version, gitExec);
      if (!resolved) {
        buildErrors.push(`No git tag found for version ${version}`);
        continue;
      }
      try {
        const built = buildAnalysisInWorktree(resolved.tag, { logger });
        buildCleanups.push(built.cleanup);
        buildsByVersion.set(version, { ...built, ...resolved });
      } catch (err) {
        buildErrors.push(`Build failed for ${resolved.tag}: ${err.message}`);
      }
    }
  } else if (noBuild && buildDirOverride) {
    // Test path: use the caller-supplied build dir for every version.
    for (const version of versionsKept) {
      buildsByVersion.set(version, {
        buildDir: buildDirOverride,
        worktreePath: dirname(buildDirOverride),
        tag: `v${version}`,
        exactMatch: true,
        cleanup: () => {},
      });
    }
  }

  // Resolve source locations + existing GH issues.
  const sourceBySig = new Map();
  const backtraceFramesBySig = new Map();
  for (const group of kept) {
    // Use the first version's build (most groups have just one version).
    const ver = [...group.versions][0];
    const build = buildsByVersion.get(ver);
    if (!build) continue;
    try {
      const oneResolved = await resolveSourceLocations(
        [{ pkgPath: group.pkgPath, line: group.line, signature: group.signature }],
        build.buildDir,
        build.worktreePath,
      );
      sourceBySig.set(group.signature, oneResolved.get(group.signature));
    } catch (err) {
      logger(`[crash-report] source resolve failed for ${group.signature}: ${err.message}`);
      sourceBySig.set(group.signature, null);
    }
    // Optional: resolve every frame of the dashboard-provided backtrace.
    const bt = backtraceMap.get(group.signature);
    if (bt) {
      try {
        const resolvedFrames = await resolveBacktraceFrames(
          bt.frames,
          build.buildDir,
          build.worktreePath,
        );
        backtraceFramesBySig.set(group.signature, resolvedFrames);
      } catch (err) {
        logger(`[crash-report] backtrace resolve failed for ${group.signature}: ${err.message}`);
      }
    }
  }

  const runDate = new Date().toISOString().slice(0, 10);

  // Partition kept groups into noise-matched vs novel. inferredCategory is
  // attached to each group as a side effect (used by matchNoisePattern). The
  // novel set goes through the normal GH dedup + draft flow; the noise-
  // matched set goes to suppress-noise actions + (when combined count
  // exceeds baseline × multiplier) a single spike comment on the tracker.
  const { byPattern, novel } = classifyAgainstNoise(kept, sourceBySig, resolvedNoiseConfig);
  const spikeAlerts = evaluateSpikes(byPattern, { runDate, csvWindow: window });

  const matches = searchExistingIssues(novel, { ghExec });
  const actions = [];

  // Per-signature actions for novel groups (existing flow).
  for (const group of novel) {
    const source = sourceBySig.get(group.signature) ?? null;
    const category = group.inferredCategory; // set by classifyAgainstNoise
    const backtrace = backtraceMap.get(group.signature) ?? null;
    const resolvedFrames = backtraceFramesBySig.get(group.signature) ?? null;
    const title = draftIssueTitle(group);
    const body = draftIssueBody(group, source, category, {
      runDate,
      csvWindow: window,
      backtrace,
      resolvedFrames,
    });
    const existing = matches.get(group.signature) ?? null;
    let action = 'create';
    let commentBody = null;
    if (existing && existing.state === 'OPEN') {
      action = 'comment';
      commentBody = draftDedupComment(group, { runDate, csvWindow: window });
    } else if (existing && existing.state === 'CLOSED') {
      action = 'reopen';
      commentBody = draftRegressionComment(group, {
        runDate,
        csvWindow: window,
        previousState: 'closed',
      });
    }
    actions.push({
      signature: group.signature,
      pkgPath: group.pkgPath,
      line: group.line,
      function: group.function,
      versions: [...group.versions],
      totalCrashes: group.totalCrashes,
      maxDevicesPerRow: group.maxDevicesPerRow,
      dates: [...group.dates].sort(),
      osReleases: [...group.osReleases].sort(),
      category,
      source,
      action,
      title,
      body,
      labels: ['bug', DEFAULT_LABEL, 'needs-triage'],
      commentBody,
      existingIssue: existing,
    });
  }

  // Per-signature info actions for noise-matched groups (no GH writes; the
  // spike comment if any fires once per pattern, not per signature).
  for (const { pattern, groups: matchedGroups } of byPattern.values()) {
    for (const group of matchedGroups) {
      actions.push({
        signature: group.signature,
        pkgPath: group.pkgPath,
        line: group.line,
        function: group.function,
        versions: [...group.versions],
        totalCrashes: group.totalCrashes,
        maxDevicesPerRow: group.maxDevicesPerRow,
        dates: [...group.dates].sort(),
        osReleases: [...group.osReleases].sort(),
        category: group.inferredCategory,
        source: sourceBySig.get(group.signature) ?? null,
        action: 'suppress-noise',
        title: draftIssueTitle(group),
        body: null,
        labels: [],
        commentBody: null,
        existingIssue: null,
        noisePatternId: pattern.id,
        trackerIssue: pattern.tracker_issue,
      });
    }
  }

  // Cleanup builds — we've extracted all the source info we need.
  for (const cleanup of buildCleanups) {
    try {
      cleanup();
    } catch {
      // best-effort
    }
  }

  return {
    createdAt: new Date().toISOString(),
    input: {
      kind: input.kind,
      sourcePath: input.sourcePath,
      csvCount: input.csvTexts.length,
      ignoredFiles: input.ignoredFiles ?? [],
    },
    csvWindow: window,
    totalRows: rows.length,
    uniqueSignatures: groups.size,
    threshold: { minDevices, minDates },
    aboveThreshold: kept.length,
    belowThreshold: filtered.length,
    skippedBelowThreshold: filtered.map((g) => ({
      signature: g.signature,
      maxDevicesPerRow: g.maxDevicesPerRow,
      dates: [...g.dates].sort(),
    })),
    noiseSuppressed: [...byPattern.values()].map(({ pattern, groups: gs }) => ({
      patternId: pattern.id,
      trackerIssue: pattern.tracker_issue,
      signatures: gs.map((g) => g.signature),
      totalCrashes: gs.reduce((s, g) => s + g.totalCrashes, 0),
      baseline: pattern.baseline_crashes_per_week,
      spikeMultiplier: pattern.spike_multiplier,
    })),
    spikeAlerts,
    buildErrors,
    actions,
  };
}

/**
 * Execute the plan: perform GH writes for each action, capture the result.
 * Returns Map<signature, { action, issueNumber, error }>.
 */
export function executePlan(plan, { ghExec = defaultGhExec, logger = console.error } = {}) {
  const results = [];
  for (const action of plan.actions) {
    if (action.action === 'suppress-noise') {
      // Info-only — no GH writes. The spike comment fires once per pattern
      // below, not per signature.
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
        logger(`[crash-report] created #${issueNumber}: ${action.title}`);
      } else if (action.action === 'comment') {
        ghExec([
          'issue',
          'comment',
          String(action.existingIssue.number),
          '--body',
          action.commentBody,
        ]);
        issueNumber = action.existingIssue.number;
        logger(`[crash-report] commented on #${issueNumber}: ${action.title}`);
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
        logger(`[crash-report] reopened + commented on #${issueNumber}: ${action.title}`);
      }
      results.push({ ...action, issueNumber, error: null });
    } catch (err) {
      logger(`[crash-report] action FAILED for ${action.signature}: ${err.message}`);
      results.push({ ...action, issueNumber: null, error: err.message });
    }
  }
  // Spike alerts — ONE comment per pattern on the tracker issue. Per the
  // locked design: comment, don't reopen.
  const spikeResults = [];
  for (const spike of plan.spikeAlerts ?? []) {
    if (!spike.isSpike) continue;
    try {
      ghExec(['issue', 'comment', String(spike.trackerIssue), '--body', spike.commentBody]);
      logger(
        `[crash-report] spike alert posted to #${spike.trackerIssue} (pattern ${spike.patternId}, ratio ${spike.ratio}x)`,
      );
      spikeResults.push({ ...spike, error: null });
    } catch (err) {
      logger(
        `[crash-report] spike comment FAILED on #${spike.trackerIssue} (pattern ${spike.patternId}): ${err.message}`,
      );
      spikeResults.push({ ...spike, error: err.message });
    }
  }
  // Attach spike results to the results array shape so renderRunSummary can
  // surface them. Spike results have no `action` field; we tag them.
  for (const sr of spikeResults) results.push({ ...sr, action: 'spike-alert' });
  return results;
}

function extractIssueNumber(ghCreateOutput) {
  // `gh issue create` prints the issue URL. Extract the trailing number.
  const m = /\/issues\/(\d+)/.exec(ghCreateOutput);
  return m ? Number(m[1]) : null;
}

// ────────────────────────────────────────────────────────────────────
// Run summary handoff
// ────────────────────────────────────────────────────────────────────

export function renderRunSummary(plan, results) {
  const created = results.filter((r) => r.action === 'create' && r.issueNumber);
  const commented = results.filter((r) => r.action === 'comment' && r.issueNumber);
  const reopened = results.filter((r) => r.action === 'reopen' && r.issueNumber);
  const suppressed = results.filter((r) => r.action === 'suppress-noise');
  const spikeResults = results.filter((r) => r.action === 'spike-alert');
  const errors = results.filter((r) => r.error);
  const totalNoiseSuppressed = (plan.noiseSuppressed ?? []).reduce(
    (n, p) => n + p.signatures.length,
    0,
  );
  const frontmatter = [
    '---',
    `created: ${plan.createdAt}`,
    `target: crash-report`,
    `input-kind: ${plan.input.kind}`,
    `input-path: ${plan.input.sourcePath}`,
    `csv-window: ${plan.csvWindow.start ?? '?'}..${plan.csvWindow.end ?? '?'}`,
    `csv-count: ${plan.input.csvCount}`,
    `total-rows: ${plan.totalRows}`,
    `unique-signatures: ${plan.uniqueSignatures}`,
    `above-threshold: ${plan.aboveThreshold}`,
    `below-threshold: ${plan.belowThreshold}`,
    `noise-suppressed: ${totalNoiseSuppressed}`,
    `spike-alerts: ${spikeResults.filter((s) => !s.error).length}`,
    `threshold: min-devices=${plan.threshold.minDevices} min-dates=${plan.threshold.minDates}`,
    '---',
  ].join('\n');
  const sections = [];
  sections.push(`## Summary`);
  sections.push(
    `- **Created**: ${created.length}\n` +
      `- **Commented (open)**: ${commented.length}\n` +
      `- **Reopened (regression)**: ${reopened.length}\n` +
      `- **Suppressed (known noise)**: ${totalNoiseSuppressed} signature(s) across ${(plan.noiseSuppressed ?? []).length} pattern(s)\n` +
      `- **Spike alerts**: ${spikeResults.filter((s) => !s.error).length}\n` +
      `- **Skipped below threshold**: ${plan.belowThreshold}\n` +
      `- **Errors**: ${errors.length}\n` +
      `- **Build errors**: ${plan.buildErrors.length}`,
  );
  if (plan.input.ignoredFiles.length) {
    sections.push(`## Ignored zip entries`);
    sections.push(plan.input.ignoredFiles.map((f) => `- ${f}`).join('\n'));
  }
  if (created.length) {
    sections.push(`## Created`);
    sections.push(
      created
        .map(
          (r) =>
            `- #${r.issueNumber} — ${r.title} (${r.totalCrashes} crashes, max ${r.maxDevicesPerRow} devices)`,
        )
        .join('\n'),
    );
  }
  if (commented.length) {
    sections.push(`## Commented (open)`);
    sections.push(commented.map((r) => `- #${r.issueNumber} — ${r.title}`).join('\n'));
  }
  if (reopened.length) {
    sections.push(`## Reopened (closed → open, regression)`);
    sections.push(reopened.map((r) => `- #${r.issueNumber} — ${r.title}`).join('\n'));
  }
  if ((plan.noiseSuppressed ?? []).length) {
    sections.push(`## Suppressed (known noise)`);
    sections.push(
      plan.noiseSuppressed
        .map((p) => {
          const status =
            p.totalCrashes > p.baseline * p.spikeMultiplier
              ? ` — **SPIKE** (${p.totalCrashes} > ${p.baseline} × ${p.spikeMultiplier})`
              : ` — within baseline (${p.totalCrashes} / ${p.baseline} per week)`;
          return (
            `- pattern \`${p.patternId}\` → tracker #${p.trackerIssue}${status}\n` +
            p.signatures.map((s) => `  - ${s}`).join('\n')
          );
        })
        .join('\n'),
    );
    if (suppressed.length === 0 && totalNoiseSuppressed > 0) {
      // Defensive: noiseSuppressed plan section was populated but no
      // per-signature action rows? Likely an execute-side bug.
      sections.push(
        `_Note: ${totalNoiseSuppressed} signature(s) were classified as noise in the plan but no suppress-noise actions appeared in results. This is a bug._`,
      );
    }
  }
  if (spikeResults.length) {
    sections.push(`## Spike alerts`);
    sections.push(
      spikeResults
        .map((s) => {
          const sigCount = s.signatures?.length ?? 0;
          const errSuffix = s.error ? ` (FAILED: ${s.error})` : '';
          return `- #${s.trackerIssue} — pattern \`${s.patternId}\`: ${s.totalCrashes} crashes / baseline ${s.baseline} × ${s.spikeMultiplier} = ratio ${s.ratio}× across ${sigCount} signature(s)${errSuffix}`;
        })
        .join('\n'),
    );
  }
  if (plan.skippedBelowThreshold.length) {
    sections.push(`## Skipped below threshold`);
    sections.push(
      plan.skippedBelowThreshold
        .map((s) => `- ${s.signature} — max ${s.maxDevicesPerRow} devices, ${s.dates.length} dates`)
        .join('\n'),
    );
  }
  if (plan.buildErrors.length) {
    sections.push(`## Build errors`);
    sections.push(plan.buildErrors.map((e) => `- ${e}`).join('\n'));
  }
  if (errors.length) {
    sections.push(`## Errors`);
    sections.push(errors.map((r) => `- ${r.signature}: ${r.error}`).join('\n'));
  }
  return `${frontmatter}\n\n${sections.join('\n\n')}\n`;
}

// ────────────────────────────────────────────────────────────────────
// CLI
// ────────────────────────────────────────────────────────────────────

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

async function cmdPlan(args) {
  const inputArg = args.flags.input ?? args._[1];
  if (!inputArg) {
    throw new Error('Missing --input <csv|zip|-> (or positional path).');
  }
  const planOut = args.flags['plan-out'];
  const minDevices = args.flags['min-devices']
    ? Number(args.flags['min-devices'])
    : DEFAULT_MIN_DEVICES;
  const minDates = args.flags['min-dates'] ? Number(args.flags['min-dates']) : DEFAULT_MIN_DATES;
  const noBuild = Boolean(args.flags['no-build']);
  const buildDirOverride = args.flags['build-dir'] ?? null;
  const dashboardCsvPath = args.flags['dashboard-csv'] ?? null;
  const dashboardCsvText = dashboardCsvPath ? readFileSync(dashboardCsvPath, 'utf8') : null;

  const input = resolveInput(inputArg);
  try {
    const plan = await buildPlan({
      input,
      minDevices,
      minDates,
      noBuild,
      buildDirOverride,
      dashboardCsvText,
    });
    const json = JSON.stringify(plan, null, 2);
    if (planOut) {
      writeFileSync(planOut, json);
      console.error(`[crash-report] plan written to ${planOut}`);
    } else {
      process.stdout.write(json + '\n');
    }
  } finally {
    input.cleanup();
  }
}

function cmdExecute(args) {
  const planPath = args.flags.plan ?? args._[1];
  if (!planPath) throw new Error('Missing --plan <plan.json>.');
  const handoffDir = args.flags['handoff-dir'] ?? join(REPO_ROOT, '.claude', 'handoffs');
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  const results = executePlan(plan, {});
  const summary = renderRunSummary(plan, results);
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..*$/, '')
    .replace('T', '-');
  const handoffPath = join(handoffDir, `crash-report-${stamp}.md`);
  try {
    writeFileSync(handoffPath, summary);
    console.error(`[crash-report] summary written to ${handoffPath}`);
  } catch (err) {
    console.error(`[crash-report] could not write handoff (${err.message})`);
    process.stdout.write(summary);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sub = args._[0];
  if (sub === 'plan') return cmdPlan(args);
  if (sub === 'execute') return cmdExecute(args);
  if (sub === '--help' || sub === 'help' || !sub) {
    process.stdout.write(`Usage:
  node scripts/crash-report.js plan --input <csv|zip|-> [--min-devices N]
    [--min-dates N] [--no-build] [--dashboard-csv <path>] [--plan-out <path>]
  node scripts/crash-report.js execute --plan <plan.json> [--handoff-dir <path>]
`);
    return;
  }
  throw new Error(`Unknown subcommand: ${sub}`);
}

// Run main only when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[crash-report] ${err.message}`);
    process.exit(1);
  });
}
