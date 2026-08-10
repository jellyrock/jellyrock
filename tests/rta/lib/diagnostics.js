/**
 * Failure-time diagnostics for the RTA harness: when a wait gives up, report the
 * state it ACTUALLY OBSERVED, not just the name of what it wanted.
 *
 * ## Why
 *
 * The suite's timeouts are its assertions, and their messages have been
 * describing the ask rather than the answer — "nav timed out waiting for X".
 * The one #789 data point worth anything read `detail row with tile type
 * "Season" not found after 15s (2 row(s) present)`, and it was only that useful
 * because a single call site happened to interpolate a count; `episodeDetails`,
 * the IDENTICAL nav, passed ~35 s later in the same run. Everything else in that
 * class arrives as "not found", which cannot be attributed to a cause after the
 * fact. Phase 3's flake baseline is only worth producing if its failures can be
 * attributed, so capture stops being luck here.
 *
 * ## What it costs
 *
 * Nothing on the success path. Every capture happens AFTER a poll loop has
 * already given up, at the throw site — never inside a tick. That is deliberate:
 * #785 may replace those loops with `onFieldChangeOnce`, and diagnostics must not
 * entrench a shape it might delete.
 *
 * At the failure boundary it is two device round-trips issued in PARALLEL, so the
 * wall-clock cost is one: `getFocusedNode` (which has no batch form) and one
 * `getValues` carrying every field in `CORE_REQUESTS`. `getValues` is a real
 * batch — the on-device component loops the requests inside a single message
 * (`processGetValuesRequest`) — and a keyPath that does not resolve comes back
 * `found: false` rather than failing the batch, which is what lets one fixed
 * request set cover every screen.
 *
 * ## What it never reads
 *
 * Identity is read by NAMED FIELD — `server.id`, `server.serverUrl`, `user.id` —
 * never by dumping the node. `JellyfinUser` carries `authToken`, so a whole-node
 * read would put a live demo credential into an artifact.
 *
 * ## Where it lands
 *
 * One JSON line per failure into `out/rta/failures.jsonl`, appended by whichever
 * process hit it (the Vitest child for the suite; the orchestrator itself for
 * `capture-screenshots` / `demos`, which share these navs and are not Vitest).
 * [`scripts/rta-run.js`](../../../scripts/rta-run.js) folds them into
 * `out/rta/run-meta.json` once the child has exited, and prints the summary. The
 * parent stays the SOLE writer of run-meta.json: a child read-modify-writing a
 * file the parent also owns is how that record would start losing fields.
 */
import fs from 'node:fs';
import path from 'node:path';
import { odc } from 'roku-test-automation';

/** Relative to cwd, like `device-lock.js`'s run-meta path — every entry point runs from the repo root. */
export const FAILURES_PATH = path.join('out', 'rta', 'failures.jsonl');
const RUN_META_PATH = path.join('out', 'rta', 'run-meta.json');

/**
 * The fixed part of the dump — the questions worth asking about ANY failure.
 *
 * Scoped to `activeRoutedView` (the app's own "view the user is on") wherever the
 * id recurs across views, for the same reason `getActiveVal` exists: sgRouter
 * `keepAlive` leaves suspended views in the scene tree, so a scene-rooted `#id`
 * read can answer for the wrong screen. `#homeRows` is deliberately scene-rooted
 * — on a failure deep in a drill-down, "is Home still populated behind me?" is
 * itself a signal.
 */
const CORE_REQUESTS = {
  viewSubtype: { base: 'global', keyPath: 'activeRoutedView.subtype()' },
  viewId: { base: 'global', keyPath: 'activeRoutedView.id' },
  loadState: { base: 'global', keyPath: 'activeRoutedView.loadState' },
  homeRowCount: { base: 'scene', keyPath: '#homeRows.content.getChildCount()' },
  detailRowCount: {
    base: 'global',
    keyPath: 'activeRoutedView.#extrasGrid.content.getChildCount()',
  },
  // Named fields only — never the node. See the header.
  serverId: { base: 'global', keyPath: 'server.id' },
  serverUrl: { base: 'global', keyPath: 'server.serverUrl' },
  userId: { base: 'global', keyPath: 'user.id' },
};

const unwrap = (results, key) => (results?.[key]?.found ? results[key].value : undefined);

/**
 * Bound on the capture, well under RTA's 10 s per-request default.
 *
 * The read is 26 ms when the device is healthy (measured on `.177`), so this only
 * ever bites when the device has stopped answering — and there it is the point:
 * a suite failing N times against a dead device would otherwise spend 10 s per
 * failure re-confirming the same thing. The unanswered read is still recorded.
 */
const CAPTURE_TIMEOUT_MS = 5000;

/**
 * One batched read of device state, plus the focused node.
 *
 * Never throws: a diagnostic that can fail is a diagnostic that turns one clear
 * failure into two confusing ones. A device that has stopped answering ODC is
 * itself the finding, so an unreachable read is recorded as `unreachable`
 * rather than swallowed.
 */
export async function captureFailureState() {
  const started = Date.now();
  const opts = { timeout: CAPTURE_TIMEOUT_MS };
  const [focused, batch] = await Promise.all([
    odc.getFocusedNode({ includeNode: true }, opts).catch(() => null),
    odc
      .getValues({ requests: CORE_REQUESTS }, opts)
      .catch((e) => ({ error: e?.message || String(e) })),
  ]);

  const results = batch?.results;
  return {
    focus: focused?.node
      ? {
          subtype: focused.node.subtype,
          id: focused.node.id || undefined,
          keyPath: focused.keyPath,
        }
      : null,
    view: {
      subtype: unwrap(results, 'viewSubtype'),
      id: unwrap(results, 'viewId'),
      loadState: unwrap(results, 'loadState'),
    },
    counts: {
      homeRows: unwrap(results, 'homeRowCount'),
      detailRows: unwrap(results, 'detailRowCount'),
    },
    identity: {
      serverId: unwrap(results, 'serverId'),
      serverUrl: unwrap(results, 'serverUrl'),
      userId: unwrap(results, 'userId'),
    },
    unreachable: batch?.error,
    captureMs: Date.now() - started,
  };
}

/**
 * Vitest's name for the test we are inside, when there is one.
 *
 * Imported DYNAMICALLY and on the failure path only. `steps.js` / `nav.js` are
 * shared with `scripts/capture-screenshots.js` and `tests/rta/demos/run.mjs`,
 * neither of which runs under Vitest — a static import would drag the whole test
 * runner into the store-screenshot build for a label.
 */
async function currentTestName() {
  try {
    const { expect } = await import('vitest');
    return expect.getState?.()?.currentTestName || undefined;
  } catch {
    return undefined;
  }
}

/** Truncated to keep a scannable line; the full value stays in the JSONL record. */
const short = (v) => (typeof v === 'string' && v.length > 12 ? `${v.slice(0, 8)}…` : v);

/** The 2–4 lines a human reads in the terminal. The JSONL record carries everything. */
function formatState(state, observed) {
  const lines = [];
  if (state.unreachable) lines.push(`device did not answer ODC: ${state.unreachable}`);
  const focus = state.focus ? `${state.focus.subtype}@${state.focus.keyPath}` : 'none';
  lines.push(
    // A routed view's id is the item GUID, so it is truncated here for the same
    // reason the identity line is — the untruncated value stays in the record.
    `view=${state.view.subtype ?? '?'}${state.view.id ? `#${short(state.view.id)}` : ''} ` +
      `loadState=${state.view.loadState ?? '—'} · focus=${focus}`,
  );
  const counts = [
    state.counts.homeRows !== undefined ? `home=${state.counts.homeRows}` : null,
    state.counts.detailRows !== undefined ? `detail=${state.counts.detailRows}` : null,
  ].filter(Boolean);
  const seen = Object.entries(observed || {}).map(
    ([k, v]) => `${k}=${Array.isArray(v) ? `[${v.join(', ')}]` : JSON.stringify(v)}`,
  );
  if (counts.length || seen.length) lines.push([...counts, ...seen].join(' · '));
  lines.push(
    `server=${state.identity.serverUrl ?? '?'} (id ${short(state.identity.serverId) ?? '?'}) ` +
      `user=${short(state.identity.userId) ?? '?'}`,
  );
  return lines.map((l) => `        ↳ ${l}`).join('\n');
}

let runStartCache;
/**
 * When this run began, per the record the entry point wrote before spawning us.
 *
 * This is `run-meta.json`'s first reader. Until now it was written by four entry
 * points and read by nothing — so a degraded or unlocked run was only ever
 * identifiable by a scrollback line. Read once and cached: the file does not
 * change while the run is in flight.
 */
function runStartedAt() {
  if (runStartCache !== undefined) return runStartCache;
  try {
    const meta = JSON.parse(fs.readFileSync(RUN_META_PATH, 'utf8'));
    runStartCache = meta.startedAt || meta.writtenAt || null;
  } catch {
    runStartCache = null;
  }
  return runStartCache;
}

/**
 * True when the top of an hour falls between two instants.
 *
 * The demo server resets hourly (watched data, playlists), so a ~12-minute suite
 * starting after roughly `:48` can have its seeded state wiped MID-RUN — which
 * surfaces as an unrelated-looking nav timeout, never as an obvious seeding
 * error. Epoch-hour flooring is UTC, which is what the reset tracks.
 */
export function crossesHourBoundary(fromIso, toIso) {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const HOUR = 3600_000;
  return Math.floor(a / HOUR) !== Math.floor(b / HOUR);
}

/**
 * Append one failure record. Never throws — bookkeeping must not mask the failure.
 *
 * `file` exists so the hardware-free tests can exercise the real append/read/reset
 * round-trip against a temp path instead of clobbering a live run's records.
 */
export function recordFailure(entry, file = FAILURES_PATH) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {
    // A diagnostic that fails the run would be worse than no diagnostic.
  }
}

/**
 * Build the Error a timed-out wait should throw: the original message, plus what
 * the harness saw, plus a durable record of both.
 *
 * Returns rather than throws so call sites read `throw await diagnosedError(...)`
 * — the control flow stays visible at the throw site instead of hiding inside a
 * helper that only sometimes ends the function.
 *
 * @param {string} message - the existing, human-written failure message
 * @param {object} opts
 * @param {string} opts.kind - stable slug for aggregation across runs (Phase 3)
 * @param {string} [opts.label] - what the wait was waiting for
 * @param {number} [opts.waitedMs] - how long it waited before giving up
 * @param {object} [opts.observed] - state the loop ALREADY read; costs no extra calls
 */
export async function diagnosedError(message, { kind, label, waitedMs, observed } = {}) {
  const state = await captureFailureState();
  const at = new Date().toISOString();
  const startedAt = runStartedAt();
  const afterHourBoundary = startedAt ? crossesHourBoundary(startedAt, at) : undefined;
  recordFailure({
    at,
    kind,
    label,
    waitedMs,
    test: await currentTestName(),
    message,
    observed,
    state,
    runStartedAt: startedAt || undefined,
    afterHourBoundary,
  });
  const reset = afterHourBoundary
    ? '\n        ↳ this run has crossed the top of the hour — the demo server resets its seeded state then'
    : '';
  return new Error(`${message}\n${formatState(state, observed)}${reset}`);
}

// ── The parent's side: fold the child's records into the run record ───────────

/** Drop any records left by a previous run, so a fold can only ever see this one's. */
export function resetFailures(file = FAILURES_PATH) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // Nothing to clear, or the directory does not exist yet.
  }
}

/** Read back the records. A truncated final line (a killed child) is skipped, not fatal. */
export function readFailures(file = FAILURES_PATH) {
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

/** The whole-run view: the wall-clock window, whether it straddled a reset, and the failures. */
export function summarizeRun({ startedAt, endedAt, failures }) {
  return {
    startedAt,
    endedAt,
    durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)) || 0,
    crossedHourBoundary: crossesHourBoundary(startedAt, endedAt),
    failures,
  };
}

const clock = (iso) => (Date.parse(iso) ? new Date(iso).toISOString().slice(11, 16) : '??:??');

/** Terminal lines for the end of a run. Returns [] when there is nothing to say. */
export function formatRunSummary(summary) {
  const { failures = [], startedAt, endedAt, crossedHourBoundary } = summary;
  if (!failures.length && !crossedHourBoundary) return [];
  const window = `${clock(startedAt)}→${clock(endedAt)} UTC`;
  const lines = [];
  if (crossedHourBoundary) {
    lines.push(
      `[rta] this run crossed the top of the hour (${window}) — the demo server resets its ` +
        'seeded state then, so a mid-run failure here may be the fixture, not the app.',
    );
  }
  if (failures.length) {
    lines.push(`[rta] ${failures.length} failure(s) captured with device state → ${FAILURES_PATH}`);
    for (const f of failures) {
      const where = f.test || f.label || f.kind || 'unknown';
      const view = f.state?.view;
      const focus = f.state?.focus;
      lines.push(
        `[rta]   ${clock(f.at)} ${where} — ${f.kind || 'failure'}` +
          (view?.subtype ? `; view=${view.subtype}` : '') +
          (view?.loadState ? ` loadState=${view.loadState}` : '') +
          (focus ? ` focus=${focus.subtype}` : '') +
          (f.afterHourBoundary ? ' [AFTER the hourly reset]' : ''),
      );
    }
  }
  return lines;
}
