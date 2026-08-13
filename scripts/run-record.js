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
  measure: 'measure',
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
export const runsLedgerPath = () => ledgerPath('runs.jsonl');

/**
 * Any other accumulating, never-reset artifact for this run kind.
 *
 * Exported so a new accumulator cannot accidentally be written under `out/`,
 * which is the mistake this whole split exists to prevent and which is very easy
 * to make: `beginRun` hands back a `dir`, that `dir` is the obvious place to put
 * a record, and it is wiped by the next `npm run build`. A caller that reaches
 * for this instead gets the surviving location and the per-run-kind separation
 * for free.
 */
export const ledgerPath = (filename) =>
  path.join(LEDGER_ROOT, path.basename(getRunDir()), filename);

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

/**
 * Read JSON lines back. A truncated final line (a killed process) is skipped, not fatal.
 *
 * Exported for the accumulators that are NOT the run ledger — `measurements.jsonl` is
 * read by `measure-compare.js` — so a second reader does not grow a second parser with
 * its own idea of what a half-written line means.
 */
export function readJsonLines(file) {
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

/**
 * This run's ASSERTION records — how much each content assertion actually checked.
 *
 * A separate stream from `failures.jsonl` because these are written by assertions
 * that PASSED, and folding them into a file named for failures would make both
 * harder to read.
 *
 * ## Why record a passing assertion at all
 *
 * A content assertion's strength is invisible from its result. `assertGenreRowsOwnTheirItems`
 * verifies a subset relation over whatever the fixture happens to hold, so it can
 * check forty item-to-genre pairings or four and go green either way — and the day it
 * can check zero it goes red, having silently weakened for months first. That decay is
 * a shape this repo already expects: `tests/rta/CLAUDE.md` warns that "the demo library
 * is small and shrinks" and that an assertion keyed on content it never has "passes
 * vacuously forever and reads as coverage."
 *
 * Recording the count makes the weakening visible while it is still cheap to fix. It
 * is deliberately NOT an assertion or a threshold — a floor here would fail runs over
 * fixture churn, which is the false-red this whole phase exists to remove. It is
 * provenance, in the same spirit as the measurement guard's tier 2: assert identity,
 * record everything else.
 */
export const assertionsPath = () => path.join(getRunDir(), 'assertions.jsonl');

/** Append one assertion record. Same never-throws contract as `recordFailure`. */
export function recordAssertion(entry, file = assertionsPath()) {
  appendJsonLine(file, entry);
}

/** Drop the previous run's assertion records. */
export function resetAssertions(file = assertionsPath()) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // Nothing to clear, or the directory does not exist yet.
  }
}

/** Read back this run's assertion records. */
export function readAssertions(file = assertionsPath()) {
  return readJsonLines(file);
}

/**
 * Collapse assertion records into `{ <name>: <verified> }` for the run summary.
 *
 * Last write wins per name, which matters for a watch-mode session where the same
 * screen is asserted many times: the useful number is the most recent, not the first
 * or a sum across iterations.
 */
export function foldAssertions(records) {
  const out = {};
  for (const r of records || []) {
    if (r && typeof r.name === 'string' && typeof r.verified === 'number') out[r.name] = r.verified;
  }
  return out;
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
 * The OPEN's selection keys, for a record that is not the run ledger.
 *
 * `runs.jsonl` gets these stamped into every line by `endRun`, but an accumulator
 * written by an entry point itself — a measurement series, say — would otherwise
 * have to be joined against the ledger on a timestamp to learn what code it ran.
 * A join is a second thing to get right, and the ledger's own history is a
 * catalogue of what happens when a selection key is missing: `variant` and
 * `commit` are identical across a baseline BY CONSTRUCTION, so they are exactly
 * the keys that cannot separate a stray run, and `deviceKey` had to be added
 * later for that reason.
 *
 * Reads the same `run-meta.json` as the wrappers above, so there is no second
 * source and no second git invocation.
 */
export function runProvenance() {
  const meta = runMeta();
  return {
    run: meta.run ?? null,
    variant: meta.variant ?? null,
    commit: meta.commit ?? null,
    dirty: meta.dirty ?? null,
    deviceKey: meta.deviceKey ?? null,
    startedAt: meta.startedAt ?? null,
  };
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
 * The stable slugs a failure aggregates under. THE key Phase 3's flake baseline
 * groups by, which is why it is a closed set rather than string literals.
 *
 * Two ways a bucket goes wrong, and they need different guards: two names for one
 * class SPLITS the count (a new throw site inventing its own slug), and one name
 * for two classes MERGES it (a copy-pasted entry). The frozen object plus a
 * uniqueness assertion in the tests cover the second; `kindUnknown` covers the first.
 *
 * Add a member here BEFORE using it at a throw site — never an inline literal.
 *
 * Lives in the ledger module rather than beside the RTA capture that first needed
 * it, because it has two producers with nothing else in common:
 * `tests/rta/lib/diagnostics.js` (device state at a wait's throw site) and
 * `tests/rta/lib/jellyfin.js` (a fixture request that failed). The latter is a pure
 * REST helper — reaching a registry inside `diagnostics.js` would import the whole
 * device client into it. `diagnostics.js` re-exports these, so its own callers are
 * unaffected.
 */
export const FAILURE_KINDS = Object.freeze({
  WAIT_FOR_TIMEOUT: 'wait-for-timeout',
  WAIT_FOCUSED_TIMEOUT: 'wait-focused-timeout',
  HOME_LIBRARY_TILE_NOT_FOUND: 'home-library-tile-not-found',
  GRID_LOAD_TIMEOUT: 'grid-load-timeout',
  DETAIL_ROW_NOT_FOUND: 'detail-row-not-found',
  MEDIA_PLAYER_NOT_STARTED: 'media-player-not-started',
  /**
   * A request to the fixture server did not answer usefully — a non-2xx, or a
   * transport error. NOT an app failure, and the one kind that changes the run's
   * OUTCOME rather than only describing it: see `RUN_OUTCOMES.BLOCKED`.
   */
  SERVER_REQUEST_FAILED: 'server-request-failed',
  /** A batched device read did not come back as a batch — see `getActiveVals`. */
  BATCH_READ_FAILED: 'batch-read-failed',
  /** The Genres view never presented the rows an assertion needs to read. */
  GENRE_ROWS_NOT_READY: 'genre-rows-not-ready',
  /**
   * The Genres view presented rows, but not one item could be checked against the
   * server. Distinct from `not-ready` because the structure DID arrive — and, since
   * `/Genres` only lists genres that exist in the library, a populated view whose
   * rows verify nothing is a real signal rather than a thin fixture.
   */
  GENRE_ROWS_UNVERIFIED: 'genre-rows-unverified',
});

const KNOWN_KINDS = new Set(Object.values(FAILURE_KINDS));

/** True for a slug that is not a registered member — see `FAILURE_KINDS`. */
export const isUnknownKind = (kind) => !KNOWN_KINDS.has(kind);

/**
 * The kinds that mean the run was never a fair test of the app — see
 * `RUN_OUTCOMES.BLOCKED`. Read by the entry point when it picks an outcome.
 */
export const BLOCKING_KINDS = new Set([FAILURE_KINDS.SERVER_REQUEST_FAILED]);

/** True when a run's folded failures include a dependency failure. */
export const wasBlocked = (failures) => (failures || []).some((f) => BLOCKING_KINDS.has(f?.kind));

/**
 * What became of a run, as distinct from what it DIAGNOSED.
 *
 * `failures` is the diagnostic record — the five RTA throw sites that capture
 * device state. It is not an outcome, and reading it as one conflates three
 * different runs into the identical line `failures: []`:
 *
 *   1. the suite ran and passed;
 *   2. the suite ran and went red somewhere the diagnostics do not cover (a plain
 *      `expect()` — there are 11 in `tests/rta/specs/` — or a Vitest-level error);
 *   3. the suite never ran at all.
 *
 * (3) is not hypothetical: `ROKU_IP=192.168.1.200 npm run test:rta` on 2026-08-12
 * threw out of `deployRtaBuild()` on a 401 (that device's dev password is a CI
 * secret, not the one in `.env`) and appended `durationMs: 621, failures: []` —
 * a line indistinguishable from a clean pass, on a clean commit, and the FIRST
 * one ever to satisfy the documented baseline selection recipe.
 *
 * A flake baseline's entire output is "how many of N runs were red", so the
 * ledger has to answer that directly instead of leaving it to be inferred from
 * the absence of records.
 */
export const RUN_OUTCOMES = Object.freeze({
  PASSED: 'passed',
  FAILED: 'failed',
  INTERRUPTED: 'interrupted',
  /** Nobody closed the run — the entry point died before it got there. */
  CRASHED: 'crashed',
  /**
   * The suite ran and went red, but a DEPENDENCY failed it — a request to the
   * fixture server that never answered, or answered 401. The app was never on
   * trial, so the red says nothing about it.
   *
   * Distinct from `failed` because it is the difference between evidence and
   * noise, and the two are indistinguishable from the exit code alone: a 401
   * inside a helper surfaces as an ordinary assertion failure several frames
   * away from its cause. On 2026-08-12 an evicted session produced exactly that
   * — a red run whose visible failure was a content assertion, whose real cause
   * was a dead token, and which would have entered a flake baseline as an app
   * failure.
   *
   * It OUTRANKS `failed` when a run has both, deliberately: a broken dependency
   * is a plausible cause of whatever else went red in the same run, so the run
   * cannot be used as evidence either way. Both observed failures that day were
   * downstream of the same eviction.
   */
  BLOCKED: 'blocked',
});

/**
 * The outcomes are NOT peers — they partition into two kinds, and a rate computed
 * without that split is wrong in both directions.
 *
 * A `passed` or `failed` run reached its verdict, so it is a SAMPLE: it belongs in
 * the population and in the numerator respectively. A `crashed`, `interrupted` or
 * `blocked` run never reached one — a deploy that 401'd, an operator's Ctrl-C, a
 * fixture server that stopped answering — so it is not evidence about the app either
 * way. Counting it red inflates the rate; counting it green hides a real failure; the
 * only correct move is to drop it from the population entirely.
 *
 * `blocked` is the subtlest member and the reason this set is worth its own export.
 * The other two non-samples are obvious from outside — no suite ran, or a human
 * stopped it. A blocked run looks EXACTLY like a red one: the suite ran, tests
 * failed, the exit code is non-zero. Only the recorded cause separates them, which
 * is why the dependency failure has to be written down at the moment it happens
 * rather than inferred at the close.
 *
 * Exported because the aggregation lives with the reader, not here, and the doc's
 * filter recipe and this module's own operator advice have to agree on it. They did
 * not on first cut: the recipe counted `outcome !== 'passed'` as a failure while the
 * summary told the operator to exclude a crashed run — the same shape of quiet
 * miscount as the `variant === 'test:rta'` trap the ledger keys exist to prevent.
 *
 * Deliberately NOT `Object.freeze`d, unlike `RUN_OUTCOMES` above: freezing a Set
 * seals its own properties and does nothing to its CONTENTS (`Object.freeze(new
 * Set(['a'])).add('b')` succeeds), so the call would read as a guarantee it does not
 * make. The test that pins the membership is the actual guard.
 */
export const SAMPLE_OUTCOMES = new Set([RUN_OUTCOMES.PASSED, RUN_OUTCOMES.FAILED]);

/**
 * Every value `outcome` is allowed to take. An unrecognized one is RECORDED as it
 * was given and flagged — never coerced, never thrown on.
 *
 * Not thrown on because of WHERE the check runs: the close is what reports that a
 * run died, so a throw there would destroy the record it exists to write, on exactly
 * the runs whose record matters most. Not coerced because a guess is how a bad value
 * becomes invisible. Flagging follows `unknownKinds`, the same problem one field
 * over — an unregistered value that would quietly split a baseline's buckets.
 *
 * It also degrades safely without any of that: an unknown value is not in
 * `SAMPLE_OUTCOMES`, so a typo drops the run from the population rather than
 * scoring it green.
 */
const KNOWN_OUTCOMES = new Set(Object.values(RUN_OUTCOMES));

/**
 * The whole-run view: the wall-clock window, whether it straddled a reset, the
 * outcome, and the failures.
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
  assertions = {},
  run,
  what,
  variant,
  commit,
  dirty,
  deviceKey,
  outcome,
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
    // The fifth filter key, and the only one that is about the run rather than the
    // invocation. `null` when the entry point did not say — honest, and the same
    // "missing would mean you have to know the convention" argument as the four
    // above. A baseline reads `outcome` over `SAMPLE_OUTCOMES`, never
    // `!failures.length` — see that set for why the four values are not four peers.
    outcome: outcome ?? null,
    // Recorded rather than corrected — see `KNOWN_OUTCOMES`. Omitted when false, so
    // an ordinary line is unchanged, matching `cumulative` above.
    outcomeUnknown: (outcome != null && !KNOWN_OUTCOMES.has(outcome)) || undefined,
    startedAt,
    endedAt,
    cumulative: cumulative || undefined,
    durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)) || 0,
    crossedHourBoundary: crossesHourBoundary(startedAt, endedAt),
    unknownKinds: [...new Set(failures.filter((f) => f?.kindUnknown).map((f) => f.kind))],
    // How much each content assertion actually CHECKED — see `assertionsPath`.
    // Omitted entirely when nothing recorded one, so an ordinary line is unchanged
    // and older ledger entries stay comparable.
    assertions: Object.keys(assertions).length ? assertions : undefined,
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
  const { failures = [], startedAt, endedAt, crossedHourBoundary, cumulative, outcome } = summary;
  const unknownKinds = summary.unknownKinds || [];
  // Suppressed for a cumulative window — see `summarizeRun`.
  const flagHour = crossedHourBoundary && !cumulative;
  // A run that died before it could run anything has no failures to report, which
  // is exactly why it printed NOTHING and slipped into the ledger unnoticed. Silence
  // is the right output for a clean run only.
  const flagOutcome = outcome && outcome !== RUN_OUTCOMES.PASSED;
  const flagUnknownOutcome = Boolean(summary.outcomeUnknown);
  if (!failures.length && !flagHour && !unknownKinds.length && !flagOutcome) return [];
  const tag = `[${path.basename(runDir(summary.run))}]`;
  const window = `${clock(startedAt)}→${clock(endedAt)} UTC`;
  const lines = [];
  if (flagOutcome) {
    // What the operator is told has to match the aggregation the docs prescribe —
    // see SAMPLE_OUTCOMES. A `failed` run IS evidence and counts; a `crashed` or
    // `interrupted` one is not a sample at all and leaves the population.
    //
    // Each non-sample says HOW it failed to reach a verdict, and only what the
    // record can actually support. Two earlier cuts of this line overclaimed: "it
    // ran no suite" was true of the deploy 401 that motivated the field and false in
    // general (`capture-screenshots` can die on locale 5 of 5, and `demos` runs no
    // suite at all), and "its entry point never closed it" is true of `crashed` —
    // which is DEFINED by the exit net firing — but false of `interrupted`, which
    // only ever comes from an entry point closing deliberately on the abandon path.
    // What both share, and all the shared clause may claim, is the missing verdict.
    //
    // `blocked` needs its own clause for the same reason and is the least obvious of
    // the three: its entry point DID close it, and the operator DIDN'T stop it, so
    // both existing clauses are false of it. What it lacks is not an ending but a
    // fair trial, because a precondition underneath it did not hold.
    //
    // The clause is deliberately stated at THAT level rather than as "a fixture
    // request failed", which is how it was first written — true of the RTA suite,
    // which was its only producer, and false the moment a second one arrived.
    // `measure.js` blocks a run when the app is not on the server the measurement
    // declared: nothing failed, and the old wording asserted a cause that had not
    // happened. Same overclaiming this block's own history is a record of; the fix
    // is to say only what every producer's record supports.
    const why = {
      [RUN_OUTCOMES.INTERRUPTED]: 'You stopped it',
      [RUN_OUTCOMES.BLOCKED]:
        'A precondition underneath it did not hold (a fixture request failed, or the ' +
        'device was not in the state the run requires), so its result says nothing about the app',
    };
    lines.push(
      `${tag} run ${outcome} (${window}) — recorded as \`outcome: "${outcome}"\` in the ledger. ` +
        (SAMPLE_OUTCOMES.has(outcome)
          ? 'It reached a verdict, so it counts: a rate over these runs reads `outcome`, never an empty failure list.'
          : `${why[outcome] ?? 'Nobody closed it'}, so it never reached a verdict ` +
            'about the app — it is NOT a sample: drop it from the population rather ' +
            'than counting it as a failure.'),
    );
  }
  if (flagUnknownOutcome) {
    // Same shape as the unregistered-failure-kind warning below, for the same
    // reason: a value nobody registered splits a baseline's buckets, and the run
    // summary is the one artifact an operator reads after every run in a series.
    lines.push(
      `${tag} ⚠ unrecognized outcome \`${outcome}\` — recorded as given, not corrected. ` +
        'Use a `RUN_OUTCOMES` member (scripts/run-record.js); until then this run is ' +
        'not a sample and drops out of any baseline.',
    );
  }
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
  // Same contract as the failure records: a fold may only ever see THIS run's.
  resetAssertions();
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
    // `RTA_DEVICE_KEY` rides along because the CHILD needs the device's identity and
    // cannot cheaply resolve it: the key comes from an ECP lookup the lock already
    // paid for, in this process. `tests/rta/lib/jellyfin.js` folds it into the
    // DeviceId every session is minted under, so two devices driven at once cannot
    // authenticate as the same client and log each other out. Omitted rather than
    // `null` on the degraded path — `sessionDeviceId` then falls back to a hash of
    // `ROKU_IP`, and an absent var picks that up where the string "null" would not.
    env: {
      RTA_RUN_DIR: activeRunDir,
      ...(lock.meta?.deviceKey ? { RTA_DEVICE_KEY: lock.meta.deviceKey } : {}),
    },
    // The outcome is passed at CLOSE, not at open: it is the one thing about a run
    // that cannot be known when it starts.
    close: (outcome) => endRun({ ...args, outcome }),
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
    // Reaching here with an unclosed run IS the definition of a crash: every entry
    // point closes explicitly on the paths it can reach, so the net firing means
    // the run died before one of them ran. Labelling it is what stops a run that
    // never executed a test from reading as a clean pass.
    if (closeArgs && !closedSummary) endRun({ ...closeArgs, outcome: RUN_OUTCOMES.CRASHED });
  });
}

/**
 * Close a run: fold the failure records in, append the run to the ledger, print.
 *
 * IDEMPOTENT. The exit net above may call this after an entry point already has,
 * and a second fold would append a second ledger line for one run — which is
 * precisely the miscount an N-run baseline cannot absorb.
 */
export function endRun({
  lock,
  run,
  startedAt,
  cumulative = false,
  variant,
  commit,
  dirty,
  outcome,
}) {
  if (closedSummary) return closedSummary;
  const summary = summarizeRun({
    run,
    outcome,
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
    assertions: foldAssertions(readAssertions()),
    cumulative,
  });
  closedSummary = summary;
  writeRunMeta(lock?.meta, { run, startedAt, ...summary }, getRunDir());
  appendJsonLine(runsLedgerPath(), summary);
  for (const line of formatRunSummary(summary)) console.log(line);
  return summary;
}
