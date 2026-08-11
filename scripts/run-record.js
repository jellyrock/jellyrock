/**
 * The run record — what a device run leaves behind about itself.
 *
 * Every entry point that claims the device (`rta-run`, `capture-screenshots`,
 * `demo`, `run-roku-tests`) opens with `beginRun` and closes with `endRun`. In
 * between it may append failure records; the close folds them in, appends the run
 * to a ledger, and prints a summary.
 *
 * ## Why this is not in `tests/rta/lib/diagnostics.js`
 *
 * It started there, with the RTA failure capture. It does not belong there: the
 * Rooibos runner (`run-roku-tests.js`) wants the run window too — #800 went red on
 * `SessionManagement.spec.bs` -> "connects to Jellyfin stable demo server", a
 * ROOIBOS test hitting the same fixture, and re-deriving that is the stated
 * prerequisite for the flake baseline. Importing an RTA test lib from it would
 * also drag the whole `roku-test-automation` client into a runner that drives the
 * device over telnet and never touches ODC. So the record lives here, beside
 * `device-lock.js` (its other cross-tree sibling), and knows nothing about
 * devices; `diagnostics.js` owns the RTA-specific capture and imports this.
 *
 * ## Why the directory is per RUN KIND
 *
 * `writeRunMeta` is a full OVERWRITE and every entry point used to share
 * `out/rta/run-meta.json`. So a `npm run test:unit` between two RTA runs silently
 * destroyed the first one's record. That was survivable while the file held only
 * lock provenance. It is not now that it carries folded failure records and the
 * flake baseline reads them back.
 *
 * It also closes the standing "`run-roku-tests.js` is the Rooibos runner and
 * writes to a path named `rta/`" residual: it now writes `out/device/`.
 *
 * ## The ledger
 *
 * `run-meta.json` is THIS run; `runs.jsonl` accumulates every run and is never
 * reset. The baseline aggregates N back-to-back suites, and without the ledger
 * that means "copy a file aside after each run, and lose the run if you forget
 * once" — deterministic bookkeeping done by a human N times over.
 */
import fs from 'node:fs';
import path from 'node:path';
import { writeRunMeta } from './device-lock.js';

/**
 * Run kind -> record directory, under `out/` and relative to cwd (every entry
 * point runs from the repo root).
 */
const RUN_DIRS = Object.freeze({
  'test:rta': 'rta',
  'test:rta:tdd': 'rta',
  'capture-screenshots': 'screenshots',
  demo: 'demo',
  'run-roku-tests': 'device',
});

/**
 * An UNMAPPED run kind gets its own sanitized directory rather than falling back
 * to `out/rta/`. A default that aliases onto a known kind is exactly the clobber
 * this split exists to remove, and it would come back silently.
 */
export function runDir(run) {
  const known = RUN_DIRS[run];
  if (known) return path.join('out', known);
  return path.join('out', `run-${String(run || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '-')}`);
}

let activeRunDir;

/**
 * Resolve this process's record directory.
 *
 * Three sources, in order. `beginRun` sets it for an entry point that owns its own
 * run. A spawned child gets it through `RTA_RUN_DIR` — a separate process cannot
 * inherit module state from the parent. The `out/rta` default keeps a bare read
 * honest for anything driving the harness without a run lifecycle at all.
 */
export function getRunDir() {
  return activeRunDir || process.env.RTA_RUN_DIR || path.join('out', 'rta');
}

/** This run's failure records — one JSON line each, appended by the process that hit them. */
export const failuresPath = () => path.join(getRunDir(), 'failures.jsonl');
const runMetaPath = () => path.join(getRunDir(), 'run-meta.json');
/** The ACCUMULATOR: one line per completed run, never reset. */
export const runsLedgerPath = () => path.join(getRunDir(), 'runs.jsonl');

/**
 * Append one JSON line. Never throws — bookkeeping must not mask the thing it is
 * bookkeeping about.
 */
export function appendJsonLine(file, entry) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {
    // A record that fails the run would be worse than no record.
  }
}

/** Read JSON lines back. A truncated final line (a killed process) is skipped, not fatal. */
function readJsonLines(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A half-written line means the process died mid-append; the rest still counts.
    }
  }
  return out;
}

/**
 * Append one failure record to this run's file.
 *
 * `file` is a parameter so the hardware-free tests can exercise the real
 * append/read/reset round-trip against a temp path instead of clobbering a live
 * run's records.
 */
export function recordFailure(entry, file = failuresPath()) {
  appendJsonLine(file, entry);
}

/** Drop any records left by a previous run, so a fold can only ever see this one's. */
export function resetFailures(file = failuresPath()) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // Nothing to clear, or the directory does not exist yet.
  }
}

/** Read back this run's failure records. */
export function readFailures(file = failuresPath()) {
  return readJsonLines(file);
}

/** Read back the run ledger — one entry per completed run. */
export function readRuns(file = runsLedgerPath()) {
  return readJsonLines(file);
}

let runStartCache;

/**
 * When this run began, per the record the entry point wrote before starting work.
 *
 * This is `run-meta.json`'s reader. Before it existed the file was written by four
 * entry points and read by nothing, so a degraded or unlocked run was only ever
 * identifiable by a scrollback line. Read once and cached: it does not change
 * while the run is in flight.
 */
export function runStartedAt() {
  if (runStartCache !== undefined) return runStartCache;
  try {
    const meta = JSON.parse(fs.readFileSync(runMetaPath(), 'utf8'));
    runStartCache = meta.startedAt || meta.writtenAt || null;
  } catch {
    runStartCache = null;
  }
  return runStartCache;
}

/**
 * True when the top of an hour falls between two instants.
 *
 * The demo server resets hourly (playlists, and anything a run marked watched), so
 * a ~13-minute suite (measured at 13.6 min) starting after roughly `:46` can have
 * that state change underneath it MID-RUN — which surfaces as an unrelated-looking
 * nav timeout, never as an obvious fixture error. Epoch-hour flooring is UTC.
 */
export function crossesHourBoundary(fromIso, toIso) {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const HOUR = 3600_000;
  return Math.floor(a / HOUR) !== Math.floor(b / HOUR);
}

/**
 * The whole-run view: the wall-clock window, whether it straddled a reset, and the
 * failures.
 *
 * `cumulative` marks a window spanning MANY logical runs rather than one — watch
 * mode, where the reset happens once at session start and the fold once at exit.
 * The hour flag is meaningless there (any session over an hour trips it), and a
 * flag that always fires is one nobody reads, so the formatter drops it.
 */
export function summarizeRun({ startedAt, endedAt, failures = [], run, cumulative = false }) {
  return {
    run,
    startedAt,
    endedAt,
    cumulative: cumulative || undefined,
    durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)) || 0,
    crossedHourBoundary: crossesHourBoundary(startedAt, endedAt),
    unknownKinds: [...new Set(failures.filter((f) => f?.kindUnknown).map((f) => f.kind))],
    failures,
  };
}

const clock = (iso) => (Number.isFinite(Date.parse(iso)) ? iso.slice(11, 16) : '??:??');

/** Terminal lines for the end of a run. Returns [] when there is nothing to say. */
export function formatRunSummary(summary, file = failuresPath()) {
  const { failures = [], startedAt, endedAt, crossedHourBoundary, cumulative } = summary;
  const unknownKinds = summary.unknownKinds || [];
  // Suppressed for a cumulative window — see `summarizeRun`.
  const flagHour = crossedHourBoundary && !cumulative;
  if (!failures.length && !flagHour && !unknownKinds.length) return [];
  const window = `${clock(startedAt)}→${clock(endedAt)} UTC`;
  const lines = [];
  if (flagHour) {
    lines.push(
      `[rta] this run crossed the top of the hour (${window}) — the demo server resets its ` +
        'seeded state then, so a mid-run failure here may be the fixture, not the app.',
    );
  }
  if (failures.length) {
    const scope = cumulative ? `this watch session (${window})` : 'this run';
    lines.push(
      `[rta] ${failures.length} failure(s) captured with device state in ${scope} → ${file}`,
    );
    for (const f of failures) {
      const where = f.test || f.context?.screen || f.label || f.kind || 'unknown';
      const attempt = f.context?.attempt ? ` (attempt ${f.context.attempt})` : '';
      const view = f.state?.view;
      const focus = f.state?.focus;
      lines.push(
        `[rta]   ${clock(f.at)} ${where}${attempt} — ${f.kind || 'failure'}` +
          (view?.subtype ? `; view=${view.subtype}` : '') +
          (view?.loadState ? ` loadState=${view.loadState}` : '') +
          (focus ? ` focus=${focus.subtype}` : '') +
          (f.state?.shell?.isRemoteDisabled === true ? ' input=BLOCKED' : '') +
          (f.afterHourBoundary ? ' [AFTER the hourly reset]' : ''),
      );
    }
  }
  // Surfaced HERE, not in a log nobody re-reads: this is the artifact an operator
  // reads after every one of the N baseline runs, so a split bucket announces
  // itself at the moment it would corrupt the number.
  if (unknownKinds.length) {
    lines.push(
      `[rta] ⚠ ${unknownKinds.length} unregistered failure kind(s): ${unknownKinds.join(', ')} — ` +
        'add them to FAILURE_KINDS in tests/rta/lib/diagnostics.js, or the flake ' +
        'baseline will aggregate these as separate buckets.',
    );
  }
  return lines;
}

/**
 * Open a run: stamp its origin, and clear the previous run's failure records.
 *
 * Every device entry point wants the same steps around its work, and three of them
 * used to hand-roll a subset. Collapsing them here is what makes the per-kind
 * directory hold: the run kind is named ONCE, at the top, and both the parent and
 * any child it spawns resolve their paths from it.
 *
 * Returns `{ startedAt, dir, env }` — pass `env` into a spawned child so it writes
 * its records where this run's fold will look for them.
 */
export function beginRun({ lock, run }) {
  activeRunDir = runDir(run);
  runStartCache = undefined; // a new run means a new origin to read back
  // Written BEFORE the work so it survives a run that never reaches `endRun`.
  const startedAt = new Date().toISOString();
  writeRunMeta(lock.meta, { run, startedAt }, activeRunDir);
  resetFailures();
  return { startedAt, dir: activeRunDir, env: { RTA_RUN_DIR: activeRunDir } };
}

/** Close a run: fold the failure records in, append the run to the ledger, print. */
export function endRun({ lock, run, startedAt, cumulative = false }) {
  const summary = summarizeRun({
    run,
    startedAt,
    endedAt: new Date().toISOString(),
    failures: readFailures(),
    cumulative,
  });
  writeRunMeta(lock.meta, { run, startedAt, ...summary }, getRunDir());
  appendJsonLine(runsLedgerPath(), summary);
  for (const line of formatRunSummary(summary)) console.log(line);
  return summary;
}
