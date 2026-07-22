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
//   plan         — parse input, build the version, resolve source locations,
//                  search GH for existing matches, emit a JSON plan. No GH writes.
//   execute      — read a plan JSON, perform GH writes (create / comment / reopen),
//                  write a run-summary handoff.
//   enrich-issue — backfill a multi-frame backtrace onto one already-filed crash
//                  issue. Takes the plaintext backtrace from Roku's "View report"
//                  page (per-error click-through), resolves frames against the
//                  issue's cited version, posts a single enrichment comment.
//   resolve-issue— reverse-lookup: given a backtrace, find every [crash] issue
//                  whose title carries the innermost frame's basename:line.
//                  JSON output; powers /crash-backtrace's auto-resolve flow so
//                  the user doesn't have to remember issue numbers.
//
// Usage:
//   node scripts/crash-report.js plan --input <csv|zip> [--min-devices N]
//     [--min-dates N] [--no-build] [--dashboard-csv <path>] --plan-out <path>
//   node scripts/crash-report.js execute --plan <plan.json> [--label crash]
//     [--handoff-dir <path>]
//   node scripts/crash-report.js enrich-issue --issue <N>
//     [--backtrace-file <path>]    # else read backtrace text from stdin
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
  // Roku's real export PREFIXES the logical column name (e.g.
  // `Agg Channel Brightscript Error Daily Error Key Date`,
  // `Agg Channel Brightscript Error Backtrace Formatted Backtrace Text Formatted`),
  // so match by suffix, not exact equality. (The idealized `Date` /
  // `Backtrace Text Formatted` headers still match — endsWith(self) is true.)
  return DASHBOARD_REQUIRED_HEADERS.every((req) =>
    headers.some((h) => h === req || h.endsWith(req)),
  );
}

/** Index of the dashboard column whose header equals or ends with `name`. */
function dashboardHeaderIndex(headers, name) {
  const exact = headers.indexOf(name);
  return exact !== -1 ? exact : headers.findIndex((h) => h.endsWith(name));
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
  const dateIdx = dashboardHeaderIndex(headers, 'Date');
  const textIdx = dashboardHeaderIndex(headers, 'Backtrace Text Formatted');
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
  // js-yaml v5 throws "the input is empty" on a blank document (v4 returned
  // undefined), so guard the empty case to preserve the "no patterns" fallback.
  const parsed = (raw.trim() ? yaml.load(raw) : undefined) ?? {};
  const patterns = Array.isArray(parsed.patterns) ? parsed.patterns : [];
  for (const p of patterns) {
    if (!p || typeof p !== 'object') {
      throw new Error(`${NOISE_CONFIG_PATH}: each pattern must be a mapping`);
    }
    if (typeof p.id !== 'string' || !p.id) {
      throw new Error(`${NOISE_CONFIG_PATH}: pattern missing required string \`id\``);
    }
    // disposition governs what happens to matches: `aggregate` upserts a
    // per-record crashlog comment onto the epic tracker; `watch` (default)
    // stays silent until a spike. `file` is the absence of a pattern.
    const disposition = p.disposition ?? 'watch';
    if (disposition !== 'watch' && disposition !== 'aggregate') {
      throw new Error(
        `${NOISE_CONFIG_PATH}: pattern \`${p.id}\` has invalid \`disposition\` \`${disposition}\` (expected 'watch' | 'aggregate')`,
      );
    }
    p.disposition = disposition;
    // A pattern that routed to issue #0 would try to comment on a
    // non-existent issue — reject non-positive/non-integer trackers loud.
    if (!Number.isInteger(p.tracker_issue) || p.tracker_issue <= 0) {
      throw new Error(
        `${NOISE_CONFIG_PATH}: pattern \`${p.id}\` missing/invalid \`tracker_issue\` (expected a positive integer)`,
      );
    }
    // baseline is only consumed by `watch` spike detection; `aggregate`
    // patterns append unconditionally, so a baseline is optional there.
    if (p.disposition === 'watch') {
      if (typeof p.baseline_crashes_per_week !== 'number') {
        throw new Error(
          `${NOISE_CONFIG_PATH}: watch pattern \`${p.id}\` missing numeric \`baseline_crashes_per_week\``,
        );
      }
    } else {
      p.baseline_crashes_per_week ??= 0;
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
  if (m.exception_code) {
    // The exception code comes from the backtrace, which only exists after
    // the `enrich` phase. During `stage` (CSV-only) group.errorCode is unset,
    // so a code-gated pattern correctly can't match yet — the crash stays
    // `needs-backtrace` until enriched. Case-insensitive; accepts str or list.
    const codes = (Array.isArray(m.exception_code) ? m.exception_code : [m.exception_code]).map(
      (c) => String(c).toLowerCase(),
    );
    const code = String(group.errorCode ?? sourceInfo?.errorCode ?? '').toLowerCase();
    if (!code || !codes.includes(code)) return false;
  }
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
 * Route a single crash to its disposition using the routing table.
 *
 * For `exception_code`-gated patterns to fire, `group.errorCode` must be
 * populated from the enriched backtrace — so this is an ENRICH-phase call.
 * Returns:
 *   { disposition: 'aggregate' | 'watch', pattern }  when a pattern matches
 *   { disposition: 'file',               pattern: null }  when none match
 * First-match wins, mirroring classifyAgainstNoise.
 */
export function routeCrash(group, sourceInfo, config) {
  for (const pattern of config.patterns) {
    if (matchNoisePattern(group, sourceInfo, pattern)) {
      return { disposition: pattern.disposition, pattern };
    }
  }
  return { disposition: 'file', pattern: null };
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
  { repoRoot = REPO_ROOT, logger = console.error, worktreePath: targetPath = null } = {},
) {
  const worktreePath = targetPath ?? mkdtempSync(join(tmpdir(), 'jellyrock-crash-wt-'));
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

// Cache wrapper for `buildAnalysisInWorktree`. Git tags are immutable so the
// source maps generated from one are deterministic across builds (modulo
// package-lock.json + npm registry resolution, which `npm ci` pins). For the
// enrich-issue flow this saves ~30-90s per call when the same version was
// built recently. The cache key is the resolved tag (not the version string,
// since version → tag resolution does fallback matching).
export const ANALYSIS_CACHE_TTL_MS = 60 * 60 * 1000;
export const ANALYSIS_CACHE_PREFIX = 'jellyrock-crash-wt-cache-';

export function getOrBuildAnalysis(
  version,
  { logger = console.error, ttlMs = ANALYSIS_CACHE_TTL_MS, gitExec = defaultGitExec } = {},
) {
  const resolved = resolveVersionTag(version, gitExec);
  if (!resolved) throw new Error(`Could not resolve version ${version} to a git tag.`);
  const tag = resolved.tag;

  const safeTag = tag.replace(/[^a-zA-Z0-9._-]/g, '_');
  const cacheDir = join(tmpdir(), `${ANALYSIS_CACHE_PREFIX}${safeTag}`);
  const buildDir = join(cacheDir, 'build-analysis');

  if (existsSync(buildDir)) {
    const ageMs = Date.now() - statSync(buildDir).mtimeMs;
    if (ageMs < ttlMs) {
      logger(
        `[crash-report] reusing cached worktree at ${cacheDir} (${Math.round(ageMs / 1000)}s old)`,
      );
      return { worktreePath: cacheDir, buildDir, cleanup: () => {}, fromCache: true };
    }
    logger(
      `[crash-report] cache at ${cacheDir} is stale (${Math.round(ageMs / 60000)}min > ${Math.round(ttlMs / 60000)}min TTL); rebuilding`,
    );
  }

  // Clear any leftover cache dir (stale or partial) before rebuilding.
  if (existsSync(cacheDir)) {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', cacheDir], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });
    } catch {
      // best-effort
    }
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }

  const built = buildAnalysisInWorktree(tag, { logger, worktreePath: cacheDir });
  // Override cleanup — we keep the cache for next-call reuse.
  return {
    worktreePath: built.worktreePath,
    buildDir: built.buildDir,
    cleanup: () => {},
    fromCache: false,
  };
}

export function cleanAnalysisCache({ logger = console.error } = {}) {
  const entries = readdirSync(tmpdir()).filter((n) => n.startsWith(ANALYSIS_CACHE_PREFIX));
  let removed = 0;
  for (const name of entries) {
    const path = join(tmpdir(), name);
    try {
      execFileSync('git', ['worktree', 'remove', '--force', path], {
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });
    } catch {
      // best-effort
    }
    try {
      rmSync(path, { recursive: true, force: true });
      removed += 1;
    } catch (err) {
      logger(`[crash-report] could not remove ${path}: ${err.message}`);
    }
  }
  logger(`[crash-report] cleaned ${removed} cached worktree(s)`);
  return removed;
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

// Pre-enrichment classification — flags backtraces that look like known-noise
// patterns the user probably doesn't want enriched. Two cases today:
//
//   1. timeout-one-off  — `Execution timeout` (&h23) with exactly 1 occurrence.
//      Roku OS killed our thread for running too long. One-offs are usually
//      transient (server disconnect, network blip); recurring timeouts are a
//      real bug class worth investigating.
//
//   2. global-constants-init-race-suspect — init() with the `'Dot' Operator`
//      error (&hec). Belt-and-suspenders behind /crash-report's filing-time
//      noise filter; catches variants the YAML pattern missed.
//
// Returns null when the backtrace looks unique enough to enrich without prompting.
export const TIMEOUT_ERROR_CODE = '&h23';
export const NULL_DOT_ERROR_CODE = '&hec';
export const TOO_MANY_TASKS_ERROR_CODE = '&h29';

export function classifyBacktraceForEnrichment(backtrace, { occurrenceCount } = {}) {
  if (!backtrace) return null;
  const innermost = innermostFrame(backtrace);

  if (
    innermost &&
    /^init$/i.test(innermost.function) &&
    backtrace.errorCode === NULL_DOT_ERROR_CODE
  ) {
    return {
      kind: 'global-constants-init-race-suspect',
      reason: `Backtrace shape matches the #103 (m-global-constants-init-race) pattern: errorCode=${backtrace.errorCode}, innermost=init(). Routes to the init-race epic (disposition: aggregate), not a standalone issue.`,
      recommendedAction: 'aggregate-to-epic',
      tracker: 103,
    };
  }

  if (
    backtrace.errorCode === TOO_MANY_TASKS_ERROR_CODE ||
    /too many task/i.test(backtrace.errorMessage ?? '')
  ) {
    return {
      kind: 'too-many-tasks',
      reason: `Too many task threads (${backtrace.errorCode}). Surfaces at whichever \`.control = "RUN"\` tips Roku's Task-thread limit — typically a very large library saturating the pool. This is the big-library architectural class: it routes to the too-many-task-threads epic (disposition: aggregate), not a standalone issue.`,
      recommendedAction: 'aggregate-to-epic',
    };
  }

  const isTimeout =
    backtrace.errorCode === TIMEOUT_ERROR_CODE ||
    /execution timeout/i.test(backtrace.errorMessage ?? '');
  if (isTimeout) {
    if (occurrenceCount === 1) {
      return {
        kind: 'timeout-one-off',
        reason: `Execution timeout (${backtrace.errorCode}) with exactly 1 occurrence — often transient (server disconnect, network blip). Routes to the server-timeout epic (disposition: aggregate) as evidence, not a standalone issue.`,
        recommendedAction: 'aggregate-to-epic',
      };
    }
    return {
      kind: 'timeout-recurring',
      reason: `Execution timeout (${backtrace.errorCode}) with ${occurrenceCount ?? 'unknown'} occurrence(s) — the server-timeout architectural class. Routes to the server-timeout epic (disposition: aggregate).`,
      recommendedAction: 'aggregate-to-epic',
    };
  }

  return null;
}

// Parse the total crash count from an issue body's Occurrence stats table.
// /crash-report renders the table as:
//
//   **Occurrence stats** (this report window):
//
//   | Date | Roku OS | Crashes | Devices |
//   |---|---|---|---|
//   | 2026-05-12 | G2 | 5 | 2 |
//
// Returns the sum of the Crashes column, or null when the table can't be found.
export function parseOccurrenceCount(issueBody) {
  if (typeof issueBody !== 'string') return null;
  const tableMatch = issueBody.match(/\*\*Occurrence stats\*\*[^\n]*\n+((?:\|[^\n]*\n)+)/);
  if (!tableMatch) return null;
  const lines = tableMatch[1].split('\n').filter((l) => l.trim().startsWith('|'));
  // Skip header (line 0) + alignment row (line 1). Sum cell index 2 (Crashes).
  let total = 0;
  let parsedAny = false;
  for (let i = 2; i < lines.length; i++) {
    const cells = lines[i]
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 3) continue;
    const n = parseInt(cells[2], 10);
    if (!Number.isNaN(n)) {
      total += n;
      parsedAny = true;
    }
  }
  return parsedAny ? total : null;
}

// Inverse of draftIssueTitle — extracts { function, basename, line, version }
// from an existing crash-issue title for the enrich-issue flow.
const CRASH_ISSUE_TITLE_RE =
  /^\[crash\]\s+(\w+)\(\)\s+in\s+([^:]+\.brs):(\d+)\s+\(v([0-9.]+)\)\s*$/;
export function parseCrashIssueTitle(title) {
  if (typeof title !== 'string') return null;
  const m = CRASH_ISSUE_TITLE_RE.exec(title.trim());
  if (!m) return null;
  return { function: m[1], basename: m[2], line: Number(m[3]), version: m[4] };
}

// Normalize any of the three shapes the user might paste into a single
// `~~`-separated cell that parseBacktraceCell can consume:
//   1. Roku dashboard TSV export (header row + N data rows, `~~` inside cells).
//      First data row's `Backtrace Text Formatted` cell wins — multi-error TSVs
//      belong on `plan --dashboard-csv`, not the single-issue subcommands.
//   2. Plaintext backtrace (newline-separated) from the dashboard's per-error
//      "View report → Backtrace" page.
//   3. Already-normalized cell text (`~~`-separated, no header) — passes through.
export function normalizeBacktraceText(text) {
  if (typeof text !== 'string') return '';
  const firstNewline = text.indexOf('\n');
  if (firstNewline > 0 && validateDashboardCsv(text.slice(0, firstNewline))) {
    const rows = splitCsvRows(text);
    if (rows.length < 2) {
      throw new Error('Dashboard TSV has a header but no data rows.');
    }
    const headers = parseCsvLine(rows[0], '\t').map((h) => h.trim());
    const textIdx = dashboardHeaderIndex(headers, 'Backtrace Text Formatted');
    const fields = parseCsvLine(rows[1], '\t');
    const cell = (fields[textIdx] ?? '').trim();
    if (!cell) {
      throw new Error('Dashboard TSV first data row has an empty `Backtrace Text Formatted` cell.');
    }
    return cell;
  }
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('~~');
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
// Epic aggregation — flat per-record crashlog upsert
//
// Architectural-class crashes (disposition: aggregate) don't get their own
// issue; each unique crash RECORD becomes one flat comment on the class epic,
// keyed by a hidden marker so a later run edits the existing record instead of
// duplicating it. A record's identity is file · function · line · version —
// distinct lines/versions are NEVER auto-merged (deciding two are "the same
// crash whose line just moved" is a human call after investigation). Only the
// occurrence stats accumulate over time.
//
// Each comment embeds a JSON data block (the source of truth) plus rendered
// markdown derived from it. Merge reads/writes the JSON — we never parse our
// own rendered prose, so a human editing the markdown can't corrupt state (and
// the machine only ever rewrites comments it owns, never the epic body).
// ────────────────────────────────────────────────────────────────────

export const RECORD_MARKER_VERSION = 1;
const RECORD_MARKER_RE = /<!--\s*crashlog-record:\s*v(\d+)\s+key=(\S+)\s*-->/;
const RECORD_DATA_RE = /<!--\s*crashlog-data:\s*([\s\S]*?)\s*-->/;

/**
 * Stable identity for a crash record. Line + version are part of identity —
 * two different lines (or the same line in two versions) are distinct records.
 */
export function epicRecordKey(rec) {
  return [rec.file ?? rec.brsPath, rec.function, rec.line, rec.version]
    .map((x) => String(x ?? ''))
    .join('|');
}

/** Render a record (the data object) to a full epic comment body. */
export function renderEpicRecord(rec) {
  const key = epicRecordKey(rec);
  const occ = [...(rec.occurrences ?? [])].sort((a, b) =>
    String(a.date ?? '').localeCompare(String(b.date ?? '')),
  );
  const totalCrashes = occ.reduce((s, o) => s + (Number(o.crashes) || 0), 0);
  const dates = [...new Set(occ.map((o) => o.date).filter(Boolean))];
  const firstSeen = dates.length ? dates[0] : '';
  const lastSeen = dates.length ? dates[dates.length - 1] : '';
  const sourceLink = rec.file
    ? `[\`${rec.file}:${rec.line}\`](${rec.file}#L${rec.line})`
    : `\`${rec.brsPath}(${rec.line})\``;
  const transpiled =
    rec.brsPath && rec.file ? `  (transpiled \`${rec.brsPath}(${rec.brsLine ?? rec.line})\`)` : '';
  const excLine = rec.code
    ? `**Exception:** ${rec.message ?? ''} (\`${rec.code}\`)`
    : '**Exception:** _unknown (not yet enriched)_';
  const occRows = occ.length
    ? occ
        .map((o) => `| ${o.date ?? ''} | ${o.os ?? ''} | ${o.crashes ?? ''} | ${o.devices ?? ''} |`)
        .join('\n')
    : '| — | — | — | — |';
  const btSection = rec.backtraceMarkdown ? `\n\n${rec.backtraceMarkdown}` : '';
  // The JSON data block is the source of truth. Our content never contains the
  // HTML-comment terminator, so a plain embed is safe and human-legible.
  const dataJson = JSON.stringify({ ...rec, v: RECORD_MARKER_VERSION });
  return `<!-- crashlog-record: v${RECORD_MARKER_VERSION} key=${key} -->
<!-- crashlog-data:
${dataJson}
-->
### \`${rec.function}()\` — ${rec.file ?? rec.brsPath}:${rec.line} · v${rec.version}
${excLine}
**Source:** ${sourceLink}${transpiled}

**Occurrences** (accumulating):

| Date | Roku OS | Crashes | Devices |
|---|---|---|---|
${occRows}

_Total: ${totalCrashes} crashes across ${dates.length} date(s)${firstSeen ? ` · first seen ${firstSeen} · last seen ${lastSeen}` : ''}_${btSection}

<sub>Maintained by \`/crash-report\`. Distinct line/version records are never auto-merged.</sub>`;
}

/** Parse the marker + JSON data out of an existing epic comment body. */
export function parseEpicRecord(commentBody) {
  const marker = RECORD_MARKER_RE.exec(commentBody ?? '');
  if (!marker) return null;
  const dataMatch = RECORD_DATA_RE.exec(commentBody);
  let data = null;
  if (dataMatch) {
    try {
      data = JSON.parse(dataMatch[1]);
    } catch {
      data = null;
    }
  }
  return { key: marker[2], data };
}

/**
 * Merge an incoming record into a prior one with the same key. Only the
 * occurrence stats accumulate (union by date+os); the exception / backtrace /
 * source-line fields refresh to the latest observation.
 */
export function mergeEpicRecord(prior, incoming) {
  const byDateOs = new Map();
  for (const o of prior.occurrences ?? []) byDateOs.set(`${o.date}|${o.os}`, { ...o });
  for (const o of incoming.occurrences ?? []) byDateOs.set(`${o.date}|${o.os}`, { ...o });
  const occurrences = [...byDateOs.values()].sort((a, b) =>
    String(a.date ?? '').localeCompare(String(b.date ?? '')),
  );
  return { ...prior, ...incoming, occurrences };
}

/**
 * Upsert a set of crash records onto an epic issue. For each record: edit the
 * existing comment (merged) if its key is already present, else create one.
 * A no-op edit (rendered body unchanged) is skipped so re-runs stay silent.
 *
 * gh helpers are injectable for testing. Individual failures are captured, not
 * thrown, so one bad comment doesn't abort the batch.
 */
export function upsertEpicRecords(
  epicIssue,
  records,
  { ghExec = defaultGhExec, logger = () => {} } = {},
) {
  const results = [];
  let existing;
  try {
    const raw = ghExec(['api', `repos/{owner}/{repo}/issues/${epicIssue}/comments`, '--paginate']);
    existing = JSON.parse(raw || '[]');
  } catch (err) {
    logger(`[crash-report] failed to list comments on epic #${epicIssue}: ${err.message}`);
    return records.map((rec) => ({ key: epicRecordKey(rec), action: 'error', error: err.message }));
  }
  const byKey = new Map();
  for (const c of existing) {
    const parsed = parseEpicRecord(c.body ?? '');
    if (parsed) byKey.set(parsed.key, { id: c.id, body: c.body, data: parsed.data });
  }
  for (const rec of records) {
    const key = epicRecordKey(rec);
    const prior = byKey.get(key);
    try {
      if (prior) {
        const merged = prior.data ? mergeEpicRecord(prior.data, rec) : rec;
        const body = renderEpicRecord(merged);
        if (body.trim() === (prior.body ?? '').trim()) {
          results.push({ key, action: 'unchanged', id: prior.id });
          continue;
        }
        ghExec([
          'api',
          '--method',
          'PATCH',
          `repos/{owner}/{repo}/issues/comments/${prior.id}`,
          '-f',
          `body=${body}`,
        ]);
        results.push({ key, action: 'updated', id: prior.id });
      } else {
        ghExec(['issue', 'comment', String(epicIssue), '--body', renderEpicRecord(rec)]);
        results.push({ key, action: 'created' });
      }
    } catch (err) {
      logger(`[crash-report] epic upsert FAILED for ${key} on #${epicIssue}: ${err.message}`);
      results.push({ key, action: 'error', error: err.message });
    }
  }
  return results;
}

/**
 * Cheap, deterministic stage-time triage hint from a crash's source. The
 * exception code that actually decides disposition only arrives with a
 * backtrace — so this NEVER authorizes a file; it only ORDERS which crashes to
 * pull a backtrace for first:
 *   - 'task-launch' — a `.control = "RUN"` site (could be the &h29 big-library
 *     class regardless of which site tipped the limit).
 *   - 'network'     — server/HTTP/socket code (could be the &h23 timeout class).
 *   - 'other'       — no architectural-class smell; likely a scoped bug, but
 *     still needs a backtrace to confirm (an ordinary line can be a compute-
 *     bound &h23 timeout).
 * Every above-threshold crash is `pending` until enriched; the hint is purely
 * a pull-ordering signal.
 */
export function mechanismHint(source) {
  const snippet = source?.codeSnippet ?? '';
  const file = source?.bsFile ?? '';
  if (/control\s*=\s*"RUN"/i.test(snippet)) return 'task-launch';
  if (
    /roUrlTransfer|AsyncGetToString|roStreamSocket|WebSocket|https?:\/\/|setUrl|getToString/i.test(
      snippet,
    ) ||
    /\/(api|socket|vendor\/BrightWebSocket)\//i.test(file) ||
    /timeout|inferserverurl|server/i.test(snippet)
  ) {
    return 'network';
  }
  return 'other';
}

/**
 * Build an epic crash record (the upsert data shape) from an enriched file-
 * eligible action + its parsed backtrace. Occurrences come from the action's
 * per-row stats; the source line prefers the resolved `.bs` location.
 */
export function buildEpicRecordForAction(action, { errorCode, errorMessage, backtraceMarkdown }) {
  const source = action.source ?? null;
  return {
    file: source?.bsFile ?? null,
    function: action.function,
    line: source?.bsLine ?? action.line,
    version: (action.versions && action.versions[0]) ?? null,
    code: errorCode ?? null,
    message: errorMessage ?? null,
    brsPath: action.pkgPath,
    brsLine: action.line,
    occurrences: action.occurrences ?? [],
    backtraceMarkdown: backtraceMarkdown ?? null,
  };
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

export function draftDedupComment(group, { runDate, csvWindow, backtrace, resolvedFrames } = {}) {
  const version = [...group.versions][0] ?? 'unknown';
  const windowStr =
    csvWindow.start && csvWindow.end ? `${csvWindow.start} to ${csvWindow.end}` : runDate;
  const backtraceBlock = backtraceSection(backtrace, resolvedFrames);
  const backtraceTrailer = backtraceBlock ? `\n${backtraceBlock}` : '';
  return `**New occurrences from \`/crash-report\` run on ${runDate}** (Roku report window: ${windowStr}):

${occurrenceTable(group.rows)}

Still occurring in app version ${version}. Crash signature unchanged.
${backtraceTrailer}`;
}

export function draftRegressionComment(
  group,
  { runDate, csvWindow, previousState, backtrace, resolvedFrames } = {},
) {
  const version = [...group.versions][0] ?? 'unknown';
  const windowStr =
    csvWindow.start && csvWindow.end ? `${csvWindow.start} to ${csvWindow.end}` : runDate;
  const backtraceBlock = backtraceSection(backtrace, resolvedFrames);
  const backtraceTrailer = backtraceBlock ? `\n${backtraceBlock}` : '';
  return `**Regression — this crash is reoccurring** after being marked ${previousState ?? 'closed'}.

This crash signature reappeared in app version ${version} during the Roku report window ${windowStr}:

${occurrenceTable(group.rows)}

Reopening for investigation. If this is a false-positive (same crash signature, different root cause), close again with a note.
${backtraceTrailer}`;
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
      commentBody = draftDedupComment(group, {
        runDate,
        csvWindow: window,
        backtrace,
        resolvedFrames,
      });
    } else if (existing && existing.state === 'CLOSED') {
      action = 'reopen';
      commentBody = draftRegressionComment(group, {
        runDate,
        csvWindow: window,
        previousState: 'closed',
        backtrace,
        resolvedFrames,
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
      // Per-row occurrences — the epic record's accumulating stats table is
      // built from these when a crash routes to `aggregate` during enrich.
      occurrences: group.rows.map((r) => ({
        date: r.date,
        os: r.osRelease,
        crashes: r.crashes,
        devices: r.devices,
      })),
      category,
      source,
      action,
      title,
      body,
      labels: ['bug', DEFAULT_LABEL],
      commentBody,
      existingIssue: existing,
      // Enrichment fields — populated by the `enrich` phase. Every
      // above-threshold crash is `pending` until a pasted backtrace confirms
      // its exception code: the code decides the disposition (file vs
      // aggregate) and lives ONLY in the backtrace, so nothing files or
      // aggregates without one. `mechanismHint` does NOT authorize a file — it
      // only ORDERS which crashes to pull first (architectural-suspect sites,
      // i.e. task-launch / network, before ordinary ones).
      mechanismHint: mechanismHint(source),
      verdict: 'needs-backtrace',
      disposition: 'pending',
      errorCode: null,
      backtraceMarkdown: null,
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

// ────────────────────────────────────────────────────────────────────
// stage → enrich → file (enrich-before-file flow)
//
// `enrichWorksheet` folds pasted dashboard backtraces into the staged
// worksheet: it extracts the exception code, source-maps the frames, and
// routes each crash to its disposition (file / aggregate / watch). Crashes
// that route to `aggregate` are marked so `file` upserts them onto the epic
// instead of creating a standalone issue.
// ────────────────────────────────────────────────────────────────────

export async function enrichWorksheet(
  plan,
  backtraceTexts,
  {
    noiseConfig = null,
    gitExec = defaultGitExec,
    logger = console.error,
    noBuild = false,
    buildDirOverride = null,
  } = {},
) {
  const config = noiseConfig ?? loadNoiseConfig();
  for (const text of backtraceTexts) {
    let bt;
    try {
      bt = parseBacktraceCell(normalizeBacktraceText(text));
    } catch (err) {
      logger(`[crash-report] enrich: unparseable backtrace (${err.message})`);
      continue;
    }
    const innermost = bt && innermostFrame(bt);
    if (!innermost) {
      logger('[crash-report] enrich: backtrace had no resolvable innermost frame');
      continue;
    }
    const sig = `${innermost.pkgPath}(${innermost.line})`;
    const action =
      plan.actions.find((a) => a.signature === sig) ??
      plan.actions.find(
        (a) =>
          basename(a.pkgPath ?? '') === basename(innermost.pkgPath ?? '') &&
          a.line === innermost.line,
      );
    if (!action) {
      logger(`[crash-report] enrich: no worksheet action matches ${sig} — skipped`);
      continue;
    }

    // Source-map the backtrace frames (worktree build, cached per version).
    const version = (action.versions && action.versions[0]) ?? null;
    let backtraceMarkdown = null;
    let build = null;
    try {
      if (noBuild && buildDirOverride) {
        build = {
          buildDir: buildDirOverride,
          worktreePath: dirname(buildDirOverride),
          cleanup() {},
        };
      } else {
        build = getOrBuildAnalysis(version, { logger, gitExec });
      }
      const frames = await resolveBacktraceFrames(bt.frames, build.buildDir, build.worktreePath);
      backtraceMarkdown = backtraceSection(bt, frames);
    } catch (err) {
      logger(`[crash-report] enrich: frame resolution failed for ${sig} (${err.message})`);
    } finally {
      build?.cleanup?.();
    }

    // Route by exception code + context.
    const group = { function: action.function, errorCode: bt.errorCode };
    const { disposition, pattern } = routeCrash(group, action.source ?? {}, config);
    action.errorCode = bt.errorCode;
    action.errorMessage = bt.errorMessage;
    action.backtraceMarkdown = backtraceMarkdown;
    action.disposition = disposition;
    action.verdict = 'enriched';

    if (disposition === 'aggregate') {
      action.action = 'aggregate'; // do NOT also file a standalone issue
      action.trackerIssue = pattern.tracker_issue;
      action.noisePatternId = pattern.id;
      action.epicRecord = buildEpicRecordForAction(action, {
        errorCode: bt.errorCode,
        errorMessage: bt.errorMessage,
        backtraceMarkdown,
      });
    } else if (backtraceMarkdown) {
      // file disposition — enrich the issue body/comment so it's born complete.
      if (action.action === 'create') {
        action.body = `${action.body}\n\n${backtraceMarkdown}`;
      } else if (action.commentBody) {
        action.commentBody = `${action.commentBody}\n\n${backtraceMarkdown}`;
      }
    }
  }
  return plan;
}

/**
 * File phase: perform GitHub writes for an enriched worksheet. `file`-
 * disposition actions create/comment/reopen issues (reusing executePlan);
 * `aggregate` actions upsert one flat record per crash onto their epic.
 */
export function executeWorksheet(plan, { ghExec = defaultGhExec, logger = console.error } = {}) {
  const aggregateActions = [];
  const passthroughActions = []; // enriched `file` crashes + info-only suppress
  const heldResults = []; // un-enriched crashes — NEVER filed without a backtrace
  for (const a of plan.actions) {
    if (a.action === 'aggregate' || a.disposition === 'aggregate') {
      aggregateActions.push(a);
    } else if (a.disposition === 'file' || a.action === 'suppress-noise') {
      passthroughActions.push(a);
    } else {
      // `pending` (or any non-enriched) — the exception code is unknown, so we
      // cannot know whether this is a scoped bug or an architectural class.
      // Hold it; surface in the summary. This is the enrich-before-file rule.
      logger(`[crash-report] HELD (needs backtrace, not filed): ${a.signature}`);
      heldResults.push({ ...a, action: 'held', issueNumber: null, error: null });
    }
  }

  // File + suppress + spike handling is exactly the old execute path.
  const fileResults = executePlan({ ...plan, actions: passthroughActions }, { ghExec, logger });
  fileResults.push(...heldResults);

  // Aggregate: group records by epic tracker, upsert each epic once.
  const byTracker = new Map();
  for (const a of aggregateActions) {
    if (!a.trackerIssue) {
      logger(`[crash-report] aggregate action ${a.signature} has no trackerIssue — skipped`);
      fileResults.push({ ...a, error: 'missing trackerIssue' });
      continue;
    }
    const record =
      a.epicRecord ??
      buildEpicRecordForAction(a, {
        errorCode: a.errorCode,
        errorMessage: a.errorMessage,
        backtraceMarkdown: a.backtraceMarkdown,
      });
    if (!byTracker.has(a.trackerIssue)) byTracker.set(a.trackerIssue, []);
    byTracker.get(a.trackerIssue).push({ action: a, record });
  }
  for (const [tracker, items] of byTracker) {
    const upserts = upsertEpicRecords(
      tracker,
      items.map((i) => i.record),
      { ghExec, logger },
    );
    upserts.forEach((u, idx) => {
      fileResults.push({
        ...items[idx].action,
        action: 'aggregate',
        trackerIssue: tracker,
        upsert: u,
      });
    });
  }
  return fileResults;
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
  const aggregated = results.filter((r) => r.action === 'aggregate' && !r.error);
  const held = results.filter((r) => r.action === 'held');
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
      `- **Aggregated to epics**: ${aggregated.length}\n` +
      `- **Held (needs backtrace)**: ${held.length}\n` +
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
  if (aggregated.length) {
    sections.push(`## Aggregated to epics (architectural classes)`);
    sections.push(
      aggregated
        .map(
          (r) =>
            `- epic #${r.trackerIssue} — ${r.signature} (${r.errorCode ?? '?'}) → ${r.upsert?.action ?? 'upserted'}`,
        )
        .join('\n'),
    );
  }
  if (held.length) {
    sections.push(`## Held — needs a backtrace before filing`);
    sections.push(
      held
        .map(
          (r) =>
            `- ${r.signature} (${r.function}(), ${r.mechanismHint ?? '?'}) — pull the dashboard backtrace, re-run \`enrich\`, then \`file\``,
        )
        .join('\n'),
    );
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

/**
 * Backfill a multi-frame backtrace + locals snapshot onto an already-filed
 * crash issue. The Roku analytics dashboard exposes backtraces only per-error
 * (one click per signature), so this is the realistic enrichment path — pull
 * the plaintext backtrace for one error, hand it to this command.
 */
export async function enrichIssue({
  issueNumber,
  backtraceText,
  ghExec = defaultGhExec,
  gitExec = defaultGitExec,
  logger = console.error,
}) {
  const json = ghExec(['issue', 'view', String(issueNumber), '--json', 'title,labels,state']);
  const issue = JSON.parse(json);
  const parsed = parseCrashIssueTitle(issue.title);
  if (!parsed) {
    throw new Error(`Issue #${issueNumber} title doesn't match the [crash] shape: ${issue.title}`);
  }
  if (!Array.isArray(issue.labels) || !issue.labels.some((l) => l.name === DEFAULT_LABEL)) {
    throw new Error(`Issue #${issueNumber} is missing the '${DEFAULT_LABEL}' label.`);
  }

  const cellText = normalizeBacktraceText(backtraceText);
  const backtrace = parseBacktraceCell(cellText);
  if (!backtrace) {
    throw new Error(
      `Could not parse backtrace text for issue #${issueNumber}. Expected the plaintext export from Roku's "View report → Backtrace" page.`,
    );
  }
  backtrace.date = backtrace.date ?? new Date().toISOString().slice(0, 10);

  const innermost = innermostFrame(backtrace);
  const innermostBase = innermost && innermost.pkgPath ? basename(innermost.pkgPath) : null;
  if (innermostBase !== parsed.basename || innermost.line !== parsed.line) {
    logger(
      `[crash-report] WARNING: backtrace innermost frame (${innermostBase}:${innermost && innermost.line}) doesn't match issue #${issueNumber} title (${parsed.basename}:${parsed.line}). Posting anyway.`,
    );
  }

  const { buildDir, worktreePath, cleanup, fromCache } = getOrBuildAnalysis(parsed.version, {
    logger,
    gitExec,
  });
  if (fromCache) logger(`[crash-report] (cache hit — saved ~30-90s)`);
  let comment;
  let resolvedFrames;
  try {
    resolvedFrames = await resolveBacktraceFrames(backtrace.frames, buildDir, worktreePath);
    const block = backtraceSection(backtrace, resolvedFrames);
    if (!block) throw new Error('Backtrace section came back empty after frame resolution.');
    comment = `**Backtrace enrichment from Roku analytics dashboard** (manually pulled, posted ${new Date().toISOString().slice(0, 10)}):

${block}`;
  } finally {
    cleanup();
  }

  const tmpFile = join(tmpdir(), `crash-report-enrich-${issueNumber}-${Date.now()}.md`);
  writeFileSync(tmpFile, comment);
  try {
    ghExec(['issue', 'comment', String(issueNumber), '--body-file', tmpFile]);
    logger(
      `[crash-report] enriched #${issueNumber} with ${resolvedFrames.length} backtrace frame(s)`,
    );
  } finally {
    try {
      rmSync(tmpFile);
    } catch {
      // best-effort
    }
  }
}

/**
 * Lightweight pre-enrichment classifier. Does NOT build a worktree — pure
 * backtrace parsing + issue-body inspection. Emits a JSON document so the
 * orchestrating skill can branch on the classification before paying the
 * worktree-build cost.
 */
export async function classifyForEnrichment({
  issueNumber,
  backtraceText,
  ghExec = defaultGhExec,
}) {
  const cellText = normalizeBacktraceText(backtraceText);
  const backtrace = parseBacktraceCell(cellText);
  if (!backtrace) {
    throw new Error('Could not parse backtrace text. Re-check the dashboard export.');
  }
  const json = ghExec(['issue', 'view', String(issueNumber), '--json', 'title,body,labels,state']);
  const issue = JSON.parse(json);
  const occurrenceCount = parseOccurrenceCount(issue.body);
  const innermost = innermostFrame(backtrace);
  const classification = classifyBacktraceForEnrichment(backtrace, { occurrenceCount });
  return {
    issueNumber,
    issueState: issue.state,
    occurrenceCount,
    errorCode: backtrace.errorCode,
    errorMessage: backtrace.errorMessage,
    innermostFrame: innermost
      ? { function: innermost.function, pkgPath: innermost.pkgPath, line: innermost.line }
      : null,
    classification,
  };
}

/**
 * Reverse-lookup: given a parsed backtrace, find every [crash] issue whose
 * title carries the innermost frame's `<basename>:<line>` substring. Same
 * search shape `searchExistingIssues` uses at /crash-report filing time —
 * so the auto-resolve lands on whatever the dedup search would have hit.
 */
export function resolveIssuesByBacktrace(backtrace, { ghExec = defaultGhExec } = {}) {
  const innermost = innermostFrame(backtrace);
  if (!innermost) return [];
  const query = draftDedupSearchQuery({ pkgPath: innermost.pkgPath, line: innermost.line });
  let raw;
  try {
    raw = ghExec([
      'issue',
      'list',
      '--search',
      query,
      '--state',
      'all',
      '--limit',
      '20',
      '--json',
      'number,title,state',
    ]);
  } catch {
    return [];
  }
  let issues;
  try {
    issues = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(issues)) return [];
  return issues
    .filter((i) => typeof i.title === 'string' && i.title.startsWith(TITLE_PREFIX))
    .map((i) => ({ number: i.number, title: i.title, state: i.state }));
}

async function cmdResolveIssue(args) {
  const backtraceFile = args.flags['backtrace-file'];
  let backtraceText;
  if (backtraceFile) {
    backtraceText = readFileSync(backtraceFile, 'utf8');
  } else {
    backtraceText = await readStdin();
  }
  if (!backtraceText || backtraceText.trim().length === 0) {
    throw new Error(
      'No backtrace text provided. Pass --backtrace-file <path> or pipe text on stdin.',
    );
  }
  const cellText = normalizeBacktraceText(backtraceText);
  const backtrace = parseBacktraceCell(cellText);
  if (!backtrace) {
    throw new Error('Could not parse backtrace text. Re-check the dashboard export.');
  }
  const innermost = innermostFrame(backtrace);
  const matches = resolveIssuesByBacktrace(backtrace);
  process.stdout.write(
    JSON.stringify(
      {
        innermostFrame: innermost
          ? { function: innermost.function, pkgPath: innermost.pkgPath, line: innermost.line }
          : null,
        errorCode: backtrace.errorCode,
        errorMessage: backtrace.errorMessage,
        matches,
      },
      null,
      2,
    ) + '\n',
  );
}

async function cmdClassifyBacktrace(args) {
  const issueNumber = Number(args.flags.issue ?? args._[1]);
  if (!issueNumber || Number.isNaN(issueNumber)) {
    throw new Error('Missing --issue <N>.');
  }
  const backtraceFile = args.flags['backtrace-file'];
  let backtraceText;
  if (backtraceFile) {
    backtraceText = readFileSync(backtraceFile, 'utf8');
  } else {
    backtraceText = await readStdin();
  }
  if (!backtraceText || backtraceText.trim().length === 0) {
    throw new Error(
      'No backtrace text provided. Pass --backtrace-file <path> or pipe text on stdin.',
    );
  }
  const result = await classifyForEnrichment({ issueNumber, backtraceText });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

async function cmdEnrichIssue(args) {
  const issueNumber = Number(args.flags.issue ?? args._[1]);
  if (!issueNumber || Number.isNaN(issueNumber)) {
    throw new Error('Missing --issue <N>.');
  }
  const backtraceFile = args.flags['backtrace-file'];
  let backtraceText;
  if (backtraceFile) {
    backtraceText = readFileSync(backtraceFile, 'utf8');
  } else {
    backtraceText = await readStdin();
  }
  if (!backtraceText || backtraceText.trim().length === 0) {
    throw new Error(
      'No backtrace text provided. Pass --backtrace-file <path> or pipe text on stdin.',
    );
  }
  await enrichIssue({ issueNumber, backtraceText });
}

// `enrich` — fold pasted dashboard backtraces into a staged worksheet.
// Backtrace files are positional args after the subcommand; the worksheet is
// --worksheet (alias --plan). Mutates the worksheet in place.
async function cmdEnrich(args) {
  const wsPath = args.flags.worksheet ?? args.flags.plan;
  if (!wsPath) throw new Error('Missing --worksheet <worksheet.json>.');
  const files = [...args._.slice(1)];
  if (args.flags['backtrace-file']) files.push(args.flags['backtrace-file']);
  if (files.length === 0) {
    throw new Error('Provide one or more backtrace files (positional) or --backtrace-file <path>.');
  }
  const plan = JSON.parse(readFileSync(wsPath, 'utf8'));
  const texts = files.map((f) => readFileSync(f, 'utf8'));
  await enrichWorksheet(plan, texts, {});
  writeFileSync(wsPath, JSON.stringify(plan, null, 2));
  console.error(`[crash-report] worksheet enriched (${files.length} backtrace(s)): ${wsPath}`);
}

function writeRunSummary(plan, results, handoffDir) {
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

// `file` — perform GitHub writes for an enriched worksheet (files novel
// crashes, upserts aggregate crashes onto their epics).
function cmdFile(args) {
  const wsPath = args.flags.worksheet ?? args.flags.plan ?? args._[1];
  if (!wsPath) throw new Error('Missing --worksheet <worksheet.json>.');
  const handoffDir = args.flags['handoff-dir'] ?? join(REPO_ROOT, '.claude', 'handoffs');
  const plan = JSON.parse(readFileSync(wsPath, 'utf8'));
  const results = executeWorksheet(plan, {});
  writeRunSummary(plan, results, handoffDir);
}

function cmdExecute(args) {
  const planPath = args.flags.plan ?? args._[1];
  if (!planPath) throw new Error('Missing --plan <plan.json>.');
  const handoffDir = args.flags['handoff-dir'] ?? join(REPO_ROOT, '.claude', 'handoffs');
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  const results = executePlan(plan, {});
  writeRunSummary(plan, results, handoffDir);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sub = args._[0];
  // Reordered flow (enrich-before-file). `stage` is `plan` (the worksheet
  // annotations ride along in buildPlan); `file` replaces `execute`.
  if (sub === 'stage' || sub === 'plan') return cmdPlan(args);
  if (sub === 'enrich') return cmdEnrich(args);
  if (sub === 'file') return cmdFile(args);
  if (sub === 'execute') return cmdExecute(args);
  if (sub === 'enrich-issue') return cmdEnrichIssue(args);
  if (sub === 'classify-backtrace') return cmdClassifyBacktrace(args);
  if (sub === 'resolve-issue') return cmdResolveIssue(args);
  if (sub === 'clean-cache') {
    cleanAnalysisCache();
    return;
  }
  if (sub === '--help' || sub === 'help' || !sub) {
    process.stdout.write(`Usage — reordered enrich-before-file flow (stage → enrich → file):
  node scripts/crash-report.js stage --input <csv|zip|-> [--min-devices N]
    [--min-dates N] [--no-build] [--dashboard-csv <path>] [--plan-out <worksheet.json>]
  node scripts/crash-report.js enrich --worksheet <worksheet.json> <backtrace1.txt> [<backtrace2.txt> ...]
    # folds pasted dashboard backtraces in, routes each to file/aggregate/watch
  node scripts/crash-report.js file --worksheet <worksheet.json> [--handoff-dir <path>]
    # files novel crashes; upserts aggregate crashes onto their epics

  # Legacy per-issue enrichment (deprecated — the new flow enriches before filing):
  node scripts/crash-report.js enrich-issue --issue <N> [--backtrace-file <path>]
  node scripts/crash-report.js classify-backtrace --issue <N> [--backtrace-file <path>]
  node scripts/crash-report.js resolve-issue [--backtrace-file <path>]
  node scripts/crash-report.js clean-cache    # remove all cached worktrees

  # Aliases: 'plan' → 'stage', 'execute' (file-first, pre-reorder) still works.
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
