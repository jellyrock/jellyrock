/**
 * The run record — what a device run leaves behind about itself.
 *
 * Every entry point that claims the device (`rta-run`, `capture-screenshots`,
 * `demo`, `run-roku-tests`) opens with `beginRun` and closes with the `close()` on
 * the handle it returns. In between it may append failure records; the close folds
 * them in, appends the run to a ledger, and prints a summary.
 *
 * `close()` carries the lock, run kind, origin and watch-mode flag from the open,
 * so no caller restates them. `beginRun` also arms a `process.on('exit')` net that
 * closes a run whose entry point never got to — three of the four hand their exit
 * to a signal handler ending in `process.exit()`, so the interrupt path cannot
 * fold itself. See `armCloseOnExit`.
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
 *
 * It lives under `.device-runs/`, NOT `out/`, because every `build*` script starts
 * with `rimraf out/` — see `LEDGER_ROOT`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
 * inherit module state from the parent. The `out/rta` default keeps a bare READ
 * honest for anything driving the harness without a run lifecycle at all.
 *
 * That default is deliberately asymmetric with `writeRunMeta`, which refuses one:
 * the only consumer that can reach here without a lifecycle is `diagnostics.js`,
 * which is RTA-only, so `out/rta` is that consumer's own directory rather than an
 * alias onto someone else's. `writeRunMeta` has four callers and no such guarantee,
 * and it OVERWRITES — a wrong guess there destroys a record instead of misfiling a
 * read. Precedence is pinned by tests; do not add a default to the write side.
 */
export function getRunDir() {
  return activeRunDir || process.env.RTA_RUN_DIR || path.join('out', 'rta');
}

/** This run's failure records — one JSON line each, appended by the process that hit them. */
export const failuresPath = () => path.join(getRunDir(), 'failures.jsonl');
const runMetaPath = () => path.join(getRunDir(), 'run-meta.json');

/**
 * Root for the ACCUMULATING record — deliberately NOT under `out/`.
 *
 * `out/` is the build output directory, and every one of the eight `build*` npm
 * scripts opens with `npx rimraf build/ out/`. Since `npm run test:rta` (and
 * `screenshots:capture`, and `test:unit`) build first, a ledger under `out/` was
 * deleted immediately before each run that was supposed to append to it — so the
 * documented N-run baseline would have ended with exactly ONE line. The per-run
 * files can live there safely: they are truncated at open anyway, so a preceding
 * wipe costs nothing. A file whose contract is "never reset" cannot.
 */
const LEDGER_ROOT = '.device-runs';

/**
 * The ACCUMULATOR: one line per completed run, never reset.
 *
 * Keyed off the run directory's own name, so it stays per-run-kind without
 * introducing a second mapping to keep in sync: `out/rta` -> `.device-runs/rta`.
 */
export const runsLedgerPath = () =>
  path.join(LEDGER_ROOT, path.basename(getRunDir()), 'runs.jsonl');

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

let runMetaCache;

/**
 * What the entry point recorded about this run before starting work.
 *
 * This is `run-meta.json`'s reader. Before it existed the file was written by four
 * entry points and read by nothing, so a degraded or unlocked run was only ever
 * identifiable by a scrollback line. Read once and cached: the OPEN's fields do
 * not change while the run is in flight, and a spawned child re-reads nothing.
 *
 * Returns `{}` rather than null on a missing or unparseable file, so every reader
 * below is a plain property access.
 */
function runMeta() {
  if (runMetaCache !== undefined) return runMetaCache;
  try {
    runMetaCache = JSON.parse(fs.readFileSync(runMetaPath(), 'utf8'));
  } catch {
    runMetaCache = {};
  }
  return runMetaCache;
}

/** When this run began, per the record written before any work started. */
export function runStartedAt() {
  const meta = runMeta();
  return meta.startedAt || meta.writtenAt || null;
}

/**
 * True when the origin above belongs to a MANY-run window rather than one run —
 * watch mode, where the record opens once at session start.
 *
 * Stamped by `beginRun` into the OPEN's record, deliberately, rather than passed
 * to a child through its own environment variable: the child already reads this
 * file for the origin, so this costs no second channel and no second parse. It
 * also means a watch session ABANDONED before its fold still has a record saying
 * what it was — the closed summary's `cumulative` only exists once `endRun` runs.
 */
export function runIsCumulative() {
  return runMeta().cumulative === true;
}

/**
 * True when the top of an hour falls between two instants.
 *
 * The demo server resets at the top of every hour, changing its own content
 * (playlists have come and gone) and any state a run created through the app (a
 * watched toggle, a resume point). A ~13-minute suite (measured at 13.6 min)
 * starting after roughly `:46` therefore has that change land MID-RUN — which
 * surfaces as an unrelated-looking nav timeout, never as an obvious fixture error.
 *
 * Epoch-hour flooring is UTC, which is correct for a top-of-hour reset regardless
 * of the server's own timezone: `:00` is the same instant in every whole-hour zone.
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
export function summarizeRun({
  startedAt,
  endedAt,
  failures = [],
  run,
  what,
  variant,
  commit,
  dirty,
  deviceKey,
  cumulative = false,
}) {
  return {
    run,
    // What the lock holder called itself, when it says more than the run kind
    // does. `demo` is the run kind for every take, so without this the LEDGER —
    // the only record that survives the next run — cannot say which take a line
    // came from. Omitted when it would just repeat `run`.
    what: what && what !== run ? what : undefined,
    // The npm script that produced this run, the code it ran against, and the
    // DEVICE it drove. These four are what let a Phase-3 baseline SELECT its runs
    // instead of being told to `rm` the ledger first — see `codeState` and the
    // docs' ledger section.
    //
    // ALWAYS emitted, unlike `what` above, and that asymmetry is deliberate:
    // `what` is prose for a human reading a line, but these are FILTER KEYS. A key
    // that is absent when it equals some default silently drops rows from
    // `runs.filter(r => r.variant === 'test:rta')` — which is the same shape of
    // quiet miscount the ledger exists to prevent. `null` says "unknown"; missing
    // would say "you have to know the convention".
    variant: variant ?? null,
    commit: commit ?? null,
    dirty: dirty ?? null,
    // WHICH Roku. There are three on this LAN and they are not interchangeable:
    // the flake baseline is specified on `.200` because it is quiet and gates a
    // release. Without this key a `.177` run joins a `.200` series and NOTHING in
    // the line says so — `variant` and `commit` cannot separate them, because the
    // whole point of a baseline is that they are identical across its runs. That
    // is the ledger's own failure mode, applied to the measurement it exists for.
    //
    // The lock's key, not an address: `sha256(device-id)` truncated, so it is
    // stable across a DHCP lease change (an address is not) and it is already what
    // both parties agree on. Null on the degraded lock path, which never resolves
    // one — honest, and the run really is of unknown provenance there.
    deviceKey: deviceKey ?? null,
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

/**
 * Terminal lines for the end of a run. Returns [] when there is nothing to say.
 *
 * The `[…]` tag names the RUN KIND, not the RTA harness. This module is shared
 * with the Rooibos runner, so a hardcoded `[rta]` would print over `npm run
 * test:unit` — the same "writes under a path named for the other harness"
 * dishonesty the per-kind directory split removed, just in the output instead of
 * on disk. Derived from the record directory's own name so there is no second
 * mapping to keep in sync, exactly as `runsLedgerPath` does.
 */
export function formatRunSummary(summary, file = failuresPath()) {
  const { failures = [], startedAt, endedAt, crossedHourBoundary, cumulative } = summary;
  const unknownKinds = summary.unknownKinds || [];
  // Suppressed for a cumulative window — see `summarizeRun`.
  const flagHour = crossedHourBoundary && !cumulative;
  if (!failures.length && !flagHour && !unknownKinds.length) return [];
  const tag = `[${path.basename(runDir(summary.run))}]`;
  const window = `${clock(startedAt)}→${clock(endedAt)} UTC`;
  const lines = [];
  if (flagHour) {
    lines.push(
      `${tag} this run crossed the top of the hour (${window}) — the demo server resets then, ` +
        'changing its own content and any state this run created through the app, so a ' +
        'mid-run failure here may be the fixture, not the app.',
    );
  }
  if (failures.length) {
    const scope = cumulative ? `this watch session (${window})` : 'this run';
    lines.push(
      `${tag} ${failures.length} failure(s) captured with device state in ${scope} → ${file}`,
    );
    for (const f of failures) {
      // `context` covers the two entry points Vitest cannot label: a screenshot
      // screen and a demo take. Without the take name a demo failure reads as a
      // bare kind, which does not say which choreography was running.
      const where =
        f.test || f.context?.screen || f.context?.take || f.label || f.kind || 'unknown';
      const attempt = f.context?.attempt ? ` (attempt ${f.context.attempt})` : '';
      const view = f.state?.view;
      const focus = f.state?.focus;
      lines.push(
        `${tag}   ${clock(f.at)} ${where}${attempt} — ${f.kind || 'failure'}` +
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
      `${tag} ⚠ ${unknownKinds.length} unregistered failure kind(s): ${unknownKinds.join(', ')} — ` +
        "register them in the throwing harness's FAILURE_KINDS set (RTA's is " +
        'tests/rta/lib/diagnostics.js), or the flake baseline will aggregate these ' +
        'as separate buckets.',
    );
  }
  return lines;
}

/**
 * Which code this run actually ran against.
 *
 * `commit` alone would over-claim: during RTA work the tree is dirty far more often
 * than not, and a bare SHA on a modified tree asserts a reproducibility the run does
 * not have. So `dirty` rides with it, and a baseline that mixes the two can say so.
 *
 * `--porcelain` with its DEFAULT untracked handling, deliberately: an untracked
 * `.bs` under `source/` is compiled into the build like any other file, so ignoring
 * untracked files would report `dirty: false` for a run whose code HEAD does not
 * describe. Ignored paths are excluded by definition, so `out/` and `.device-runs/`
 * never trip it.
 *
 * Called from `beginRun`, never from `endRun` — the close runs inside a
 * `process.on('exit')` handler, and spawning a subprocess from there is a far worse
 * idea than paying ~10 ms once at the top of a multi-minute device run.
 *
 * Returns nulls rather than throwing: a checkout without git, or a tarball export,
 * is a fine place to run the device tests and a bad place to fail them over
 * bookkeeping.
 *
 * The timeout carries that same contract past the case try/catch cannot reach. git
 * can BLOCK rather than fail — a stale `index.lock`, a slow or networked working
 * tree — and a hang here stalls a device run at its open, before any output has
 * explained what it is doing. `execFileSync` raises ETIMEDOUT, which the catch
 * below already degrades to nulls: the run continues without provenance instead of
 * waiting on bookkeeping.
 */
const GIT_TIMEOUT_MS = 5000;

function codeState() {
  const git = (args) =>
    execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS,
    });
  try {
    return {
      commit: git(['rev-parse', '--short', 'HEAD']).trim() || null,
      dirty: git(['status', '--porcelain']).trim().length > 0,
    };
  } catch {
    return { commit: null, dirty: null };
  }
}

/**
 * Open a run: stamp its origin, and clear the previous run's failure records.
 *
 * Every device entry point wants the same steps around its work, and three of them
 * used to hand-roll a subset. Collapsing them here is what makes the per-kind
 * directory hold: the run kind is named ONCE, at the top, and both the parent and
 * any child it spawns resolve their paths from it.
 *
 * Returns `{ startedAt, dir, env, close }`. Pass `env` into a spawned child so it
 * writes its records where this run's fold will look for them, and call `close()`
 * to fold — it carries the lock, kind, origin, `cumulative` and the invocation
 * provenance this call already resolved, so no caller has to restate them and none
 * can restate them wrongly.
 */
export function beginRun({ lock, run, cumulative = false }) {
  activeRunDir = runDir(run);
  runMetaCache = undefined; // a new run means a new record to read back
  closedSummary = undefined; // ...and a close that has not happened yet
  // Written BEFORE the work so it survives a run that never reaches `endRun`.
  const startedAt = new Date().toISOString();
  // Which npm script this was. Every device entry point is invoked as `node
  // scripts/<x>.js` DIRECTLY from its npm script (none delegates through another
  // `npm run`), so this arrives as the name the operator actually typed —
  // `test:rta:fast` rather than `test:rta`, `test:integration` rather than the run
  // kind they share. That distinction is invisible in the run kind and matters to a
  // baseline: `:fast` skips the deploy, `:capture` adds per-screen PNG work, and
  // `test:all` is a different suite from `test:unit`. Falls back to the run kind
  // when someone invokes the script by hand.
  const variant = process.env.npm_lifecycle_event || run;
  const { commit, dirty } = codeState();
  // `cumulative` is stamped at the OPEN, not only into the closed summary, because
  // a spawned child needs it WHILE the run is in flight — it is what tells the
  // child its origin is a session's rather than an iteration's. Omitted when false,
  // matching `summarizeRun`, so an ordinary run's record is unchanged.
  writeRunMeta(
    lock.meta,
    { run, startedAt, variant, commit, dirty, ...(cumulative ? { cumulative: true } : {}) },
    activeRunDir,
  );
  resetFailures();
  // Closed over rather than re-read at close time, so a handle always folds the run
  // it was handed. Note the LIMIT of that: `activeRunDir` and the `closedSummary`
  // guard below are module state, so this makes a handle carry the right VALUES —
  // it does not make two concurrently-open runs safe in one process. Nothing does
  // that today, and no entry point opens more than one; if a fifth ever needs to,
  // this state moves onto the handle.
  const args = { lock, run, startedAt, cumulative, variant, commit, dirty };
  closeArgs = args;
  armCloseOnExit();
  return {
    startedAt,
    dir: activeRunDir,
    env: { RTA_RUN_DIR: activeRunDir },
    close: () => endRun(args),
  };
}

let closeArgs;
let closedSummary;
let netArmed = false;

/**
 * The safety net that closes a run nobody closed.
 *
 * Three of the four entry points hand their exit to a signal handler ending in
 * `process.exit()` — `armRestoreOnInterrupt`'s among them — so an explicit
 * `endRun` on the happy path alone skips the fold on exactly the interrupt a
 * ~15-minute matrix run is most likely to end with. Registering here rather than
 * in each entry point is what keeps that true for a FIFTH entry point added later.
 *
 * Legal because `endRun` is all-synchronous (`readFileSync` / `writeFileSync` /
 * `appendFileSync` / `console.log`); an `exit` handler cannot await. `process.exit()`
 * always emits `exit`, and every entry point installs signal listeners, so the
 * default terminate-without-exit path never applies.
 *
 * The explicit `endRun` calls stay where OUTPUT ORDER matters — `rta-run` folds
 * before the registry restore so the summary survives a restore that throws. This
 * net only fires when one did not run.
 */
function armCloseOnExit() {
  if (netArmed) return;
  netArmed = true;
  process.on('exit', () => {
    if (closeArgs && !closedSummary) endRun(closeArgs);
  });
}

/**
 * Close a run: fold the failure records in, append the run to the ledger, print.
 *
 * IDEMPOTENT. The exit net above may call this after an entry point already has,
 * and a second fold would append a second ledger line for one run — which is
 * precisely the miscount an N-run baseline cannot absorb.
 */
export function endRun({ lock, run, startedAt, cumulative = false, variant, commit, dirty }) {
  if (closedSummary) return closedSummary;
  const summary = summarizeRun({
    run,
    what: lock?.meta?.holder?.what,
    // Read off the lock here rather than carried from the open, like `what` above
    // and unlike the three below: it is already resolved on `lock.meta` by the time
    // the lock exists, so carrying it would duplicate state for no gain and add a
    // way for the two copies to disagree.
    deviceKey: lock?.meta?.deviceKey,
    // Resolved at the OPEN and carried here, so the exit net folds the same
    // provenance an explicit close would — and so no git subprocess runs on the
    // exit path. See `codeState`.
    variant,
    commit,
    dirty,
    startedAt,
    endedAt: new Date().toISOString(),
    failures: readFailures(),
    cumulative,
  });
  closedSummary = summary;
  writeRunMeta(lock?.meta, { run, startedAt, ...summary }, getRunDir());
  appendJsonLine(runsLedgerPath(), summary);
  for (const line of formatRunSummary(summary)) console.log(line);
  return summary;
}
