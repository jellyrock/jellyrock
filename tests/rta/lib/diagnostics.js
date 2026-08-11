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
 * Those three name whatever server the app is CURRENTLY on, which is not
 * structurally guaranteed to be the demo one. Today it always is: every wait that
 * can reach here runs after a seed + `hardRelaunch`, and the demo runner refuses a
 * non-demo host outright. But a wait added BEFORE a seed would record the
 * developer's own server URL and user id — into `runs.jsonl`, which is never reset.
 * Both are gitignored; keep it that way, and keep waits behind their seed.
 *
 * ## Two load signals, and why both
 *
 * `loadState` is GRID-ONLY. It is declared on `BaseGridView` alone
 * (`components/ItemGrid/BaseGridView.xml`), where it carries a real four-value
 * vocabulary — `loading` / `skeleton` / `loaded` / `empty`. `ItemDetails` extends
 * `JRScreen`, a SIBLING of BaseGridView, so on a detail screen it does not resolve
 * and prints `—`. That is correct, not a broken capture.
 *
 * The universal signal is the app shell's, on the scene root: `isLoading` /
 * `loadingText` / `isRemoteDisabled`, driven by `startLoadingSpinner` /
 * `stopLoadingSpinner` (`source/utils/misc.bs`) from every screen including
 * ItemDetails. `isRemoteDisabled` is the highest-value field in the whole dump:
 * `JRScene.onKeyEvent` does `if m.top.isRemoteDisabled then return true`, so a
 * timeout with it set means THE APP WAS SWALLOWING OUR KEYPRESSES — the north-star
 * failure mode in `tests/rta/CLAUDE.md`, which until now could only be inferred.
 *
 * ## Where it lands
 *
 * One JSON line per failure into this run's `failures.jsonl`, appended by whichever
 * process hit it (the Vitest child for the suite; the orchestrator itself for
 * `capture-screenshots` / `demos`, which share these navs and are not Vitest).
 * The entry point's `endRun` folds them into `run-meta.json` once the child has
 * exited, and prints the summary. The parent stays the SOLE writer of
 * run-meta.json: a child read-modify-writing a file the parent also owns is how
 * that record would start losing fields.
 *
 * The record itself — where it lives, its lifecycle, the run ledger — belongs to
 * [`scripts/run-record.js`](../../../scripts/run-record.js), which is shared with
 * the Rooibos runner and knows nothing about devices. This module only supplies
 * the RTA-specific capture that goes INTO it.
 */
import { odc } from 'roku-test-automation';
import {
  crossesHourBoundary,
  recordFailure,
  runIsCumulative,
  runStartedAt,
} from '../../../scripts/run-record.js';

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
  // Grid-only, by design — see "Two load signals" in the header.
  loadState: { base: 'global', keyPath: 'activeRoutedView.loadState' },
  // The app shell's own state, on the scene root, and therefore the one load
  // signal that answers on EVERY screen. `isRemoteDisabled` is the north-star
  // tell: set means JRScene.onKeyEvent was returning true for every key we sent.
  isLoading: { base: 'scene', keyPath: 'isLoading' },
  loadingText: { base: 'scene', keyPath: 'loadingText' },
  isRemoteDisabled: { base: 'scene', keyPath: 'isRemoteDisabled' },
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
 * The read is a median 21 ms when the device is healthy (n=20 on `.177`, range
 * 18-30 with occasional ~70 ms spikes under a busy render thread), so this only
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
    // `includeNode` already defaults to true; we need the node for its subtype,
    // and only subtype/id/keyPath are kept — the rest never reaches a record.
    odc.getFocusedNode({}, opts).catch(() => null),
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
    // Source field names verbatim, so a record greps back to the component that
    // wrote it. The friendlier wording lives in `formatState`, for humans only.
    shell: {
      isLoading: unwrap(results, 'isLoading'),
      loadingText: unwrap(results, 'loadingText'),
      isRemoteDisabled: unwrap(results, 'isRemoteDisabled'),
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
 * The stable slugs a failure aggregates under. THE key Phase 3's flake baseline
 * groups by, which is why it is a closed set rather than five string literals.
 *
 * Two ways a bucket goes wrong, and they need different guards: two names for one
 * class SPLITS the count (a new throw site inventing its own slug), and one name
 * for two classes MERGES it (a copy-pasted entry). The frozen object plus a
 * uniqueness assertion in the tests cover the second; `kindUnknown` below covers
 * the first.
 *
 * Add a member here BEFORE using it at a throw site — never an inline literal.
 */
export const FAILURE_KINDS = Object.freeze({
  WAIT_FOR_TIMEOUT: 'wait-for-timeout',
  WAIT_FOCUSED_TIMEOUT: 'wait-focused-timeout',
  HOME_LIBRARY_TILE_NOT_FOUND: 'home-library-tile-not-found',
  GRID_LOAD_TIMEOUT: 'grid-load-timeout',
  DETAIL_ROW_NOT_FOUND: 'detail-row-not-found',
  MEDIA_PLAYER_NOT_STARTED: 'media-player-not-started',
});

const KNOWN_KINDS = new Set(Object.values(FAILURE_KINDS));

/** True for a slug that is not a registered member — see `FAILURE_KINDS`. */
export const isUnknownKind = (kind) => !KNOWN_KINDS.has(kind);

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

let failureContext;
/**
 * Ambient "what was this failure part of?", for entry points Vitest cannot label.
 *
 * `currentTestName` covers the suite; nothing covered `capture-screenshots` or
 * `demos`, which drive the same navs. It also carries the piece those runners know
 * and the throw site cannot: `capture-screenshots` RETRIES a screen three times,
 * so without an attempt number a recovered screen leaves records indistinguishable
 * from real failures.
 *
 * Pass nothing to clear.
 */
export function setFailureContext(context) {
  failureContext = context && Object.keys(context).length ? context : undefined;
}

/** Truncated to keep a scannable line; the full value stays in the JSONL record. */
const short = (v) => (typeof v === 'string' && v.length > 12 ? `${v.slice(0, 8)}…` : v);

/**
 * The 2–4 lines a human reads in the terminal. The JSONL record carries everything.
 *
 * The shell fields print only when they are the INTERESTING value — a loaded,
 * responsive app says nothing about either, so a normal failure stays as short as
 * it was before they existed and `input=BLOCKED` keeps its signal value.
 */
function formatState(state, observed) {
  const lines = [];
  if (state.unreachable) lines.push(`device did not answer ODC: ${state.unreachable}`);
  const focus = state.focus ? `${state.focus.subtype}@${state.focus.keyPath}` : 'none';
  const shell = state.shell || {};
  const shellBits = [
    // The app was returning true for every key we sent (JRScene.onKeyEvent).
    shell.isRemoteDisabled === true ? 'input=BLOCKED' : null,
    shell.isLoading === true
      ? `spinner=on${shell.loadingText ? `("${shell.loadingText}")` : ''}`
      : null,
  ].filter(Boolean);
  lines.push(
    // A routed view's id is the item GUID, so it is truncated here for the same
    // reason the identity line is — the untruncated value stays in the record.
    `view=${state.view.subtype ?? '?'}${state.view.id ? `#${short(state.view.id)}` : ''} ` +
      `loadState=${state.view.loadState ?? '—'} · focus=${focus}` +
      (shellBits.length ? ` · ${shellBits.join(' · ')}` : ''),
  );
  const counts = [
    state.counts.homeRows !== undefined ? `home=${state.counts.homeRows}` : null,
    state.counts.detailRows !== undefined ? `detail=${state.counts.detailRows}` : null,
  ].filter(Boolean);
  const seen = Object.entries(observed || {}).map(
    ([k, v]) => `${k}=${Array.isArray(v) ? `[${v.join(', ')}]` : JSON.stringify(v)}`,
  );
  if (counts.length || seen.length) lines.push([...counts, ...seen].join(' · '));
  // Suppressed when nothing resolved: on an unreachable device the first line
  // already says so, and `server=? (id ?) user=?` is pure noise under it.
  const { serverUrl, serverId, userId } = state.identity;
  if (serverUrl !== undefined || serverId !== undefined || userId !== undefined) {
    lines.push(
      `server=${serverUrl ?? '?'} (id ${short(serverId) ?? '?'}) user=${short(userId) ?? '?'}`,
    );
  }
  return lines.map((l) => `        ↳ ${l}`).join('\n');
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
 * @param {string} opts.kind - a `FAILURE_KINDS` member; the Phase-3 aggregation key
 * @param {string} [opts.label] - what the wait was waiting for
 * @param {number} [opts.waitedMs] - how long it waited before giving up
 * @param {object} [opts.observed] - state the loop ALREADY read; costs no extra calls
 */
export async function diagnosedError(message, { kind, label, waitedMs, observed } = {}) {
  const state = await captureFailureState();
  const at = new Date().toISOString();
  const startedAt = runStartedAt();
  // UNKNOWN in a cumulative window, not false. In watch mode the origin is the
  // SESSION's — the record opens once at start and folds once at exit — so any
  // session running over an hour would stamp every failure from then on, which is
  // the same always-fires noise `formatRunSummary` already suppresses for
  // `cumulative`. `false` would be a claim we cannot make (the reset may well have
  // happened); `undefined` says the question is unanswerable here, matching how a
  // missing origin is treated. The origin itself is still recorded — a session's
  // start is provenance either way.
  const afterHourBoundary =
    startedAt && !runIsCumulative() ? crossesHourBoundary(startedAt, at) : undefined;
  recordFailure({
    at,
    kind,
    // Recorded rather than corrected: an unregistered slug is a bucket-integrity
    // problem, and the run summary says so. Silently normalising it here would
    // hide the split it causes; throwing would break the never-throws contract.
    kindUnknown: isUnknownKind(kind) || undefined,
    label,
    waitedMs,
    test: await currentTestName(),
    context: failureContext,
    message,
    observed,
    state,
    runStartedAt: startedAt || undefined,
    afterHourBoundary,
  });
  const reset = afterHourBoundary
    ? '\n        ↳ this run has crossed the top of the hour — the demo server resets then, changing its own content and any state this run created through the app'
    : '';
  return new Error(`${message}\n${formatState(state, observed)}${reset}`);
}
