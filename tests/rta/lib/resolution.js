/**
 * Did a scene-rooted `#id` read resolve to the node the caller meant?
 *
 * ## The defect this measures
 *
 * `getVal('#homeRows.content.getChildCount()')` is `scene.findNode("homeRows")` — a
 * recursive search of the WHOLE scene, not of the screen the test is standing on. So a
 * read can succeed and describe something other than what the call site names, in two
 * distinct ways:
 *
 *   (a) DUPLICATE — several nodes carry the id, and which one answers is a property of
 *       tree order rather than of the test. Seven components declare a node with id
 *       `buttons`; two declare `buttonRow`.
 *   (b) NOT PRESENTED — exactly one node carries the id and it sits in a view parked
 *       off-screen. sgRouter's default `suspendMode: "hide"` keeps a COVERED view in the
 *       tree, so the read resolves happily against a screen nobody is looking at.
 *
 * Neither is visible in a result: the gate goes green either way. That is the whole
 * class — succeeding for a reason nobody chose.
 *
 * **(b) is the one that has actually bitten, and a uniqueness check misses it.**
 * `waitHome()` passed from a library grid because a scene-rooted `#homeRows` read found
 * a SUSPENDED Home — there was only ever ONE `#homeRows`, so counting ids would have
 * called it clean. The same mechanism ran across 30 more sites that named Home's row list
 * by id (converted 2026-09-08; see ./home-list.js). Any audit that only asks "is this id
 * unique" is answering the easier question.
 *
 * ## Why one device call answers both
 *
 * `odc.storeNodeReferences()` walks from `m.top.getScene()` — the same tree `findNode`
 * searches — and returns a flat list carrying `id`, `subtype`, `parentRef`, `keyPath`,
 * `visible` and `opacity` for every node. So uniqueness is a count over that list and
 * presented-ness is a walk up `parentRef`, both client-side, with no second round trip.
 *
 * Measured on `.177` (Streaming Stick 4K, 108 nodes on Home): a median **30 ms**, n=15
 * across two runs, range 25–64. `convertKeyPathToSceneKeyPath` was measured at ~6 ms and
 * is deliberately NOT used — when the id is unique the single match IS what `findNode`
 * resolved, and when it is not, the ambiguity is already the finding.
 *
 * `isShowingOnScreen` is likewise not used, though it looks like the natural primitive:
 * it answers in 5–10 ms when it answers, but one probe run hung on it indefinitely and
 * that has not been explained. The census carries `visible`/`opacity` anyway, so
 * depending on it would buy nothing and import an unexplained hang into the wait path.
 *
 * ## Why "presented", and NOT "inside the active view"
 *
 * The obvious predicate — is the node under `m.global.activeRoutedView` — is wrong here,
 * and the device says so. `#jrDialog`, the most-read id in the suite (29 sites), is
 * appended to the SCENE by `presentOverlayDialog`, not to the view; `#imageFader` sits at
 * scene level too (`parentRef: 0`). An active-view rule would false-fail both, which is
 * how a gate teaches people to ignore it.
 *
 * ## Report-only, on purpose
 *
 * Nothing here throws. It runs inside the wait path of the only per-PR feedback nav
 * changes get, and a gate whose false-alarm rate has never been measured must not be able
 * to red a healthy suite — the rule `probeFixture` was built under, one layer up:
 * *instrumentation must never move a verdict*. Records land in the ledger's
 * `resolutions.jsonl` stream; promote to a throw once a full suite says the rate is zero.
 *
 * Deliberately WITHOUT an allowlist for now. `getVals`' own docblock says `#homeRows` is
 * "deliberately scene-rooted (Home is not the active view once a drill-down opens)", so
 * that site may well report not-presented and be correct to. Pre-seeding an allowlist
 * from that guess would launder exactly the assumption this exists to test — let the run
 * say which sites fire, then justify or fix each one.
 */
// The ODC singleton comes straight from the package rather than through `driver.js`,
// which re-exports the same object: `steps.js` imports this module and `driver.js`
// imports `sleep` from `steps.js`, so going through the driver would close an import
// cycle. `setupRtaEnv()` configures that singleton in every process that talks to the
// device, so which module hands it over does not change what it is pointed at.
import { odc } from 'roku-test-automation';
import { recordResolution } from '../../../scripts/run-record.js';

/** Env gate. Off unless asked for, so an ordinary run pays nothing until it opts in. */
export const auditEnabled = () => process.env.RTA_AUDIT_RESOLUTION === '1';

/**
 * How many censuses one process may take.
 *
 * A budget rather than a rate limit or a memo, because the FIRST question this pass has
 * to answer is not "are there anomalies" but "how many reads are there to audit at all" —
 * and nobody knows: a `getVal` inside a poll `action` re-runs every tick, so the call
 * volume is not the 106 static call sites. Recording `asked` alongside `audited` answers
 * the sizing question and the anomaly question in one suite run instead of two.
 *
 * Vitest runs one worker per spec FILE, so this is a per-file budget and the total is
 * roughly `files x BUDGET`. At ~30 ms a census that is a bounded few seconds either way.
 */
const CENSUS_BUDGET = Number(process.env.RTA_AUDIT_BUDGET ?? 200);
let spent = 0;
let asked = 0;

/** Test seam — reset the per-process counters. */
export function resetAuditBudget() {
  spent = 0;
  asked = 0;
}

/** What this process has done so far, for the end-of-file record. */
export const auditCounters = () => ({ asked, audited: spent });

/**
 * The id a scene-rooted keyPath resolves through, or null when there is nothing to audit.
 *
 * Only the LEADING segment is a `findNode` call: `#jrDialog.#okButton.blendColor` finds
 * `jrDialog` in the scene and then walks INTO it by id, so the later `#okButton` is
 * scoped to that subtree and cannot pick up a stranger. Auditing the leading segment is
 * therefore auditing the whole ambiguity.
 *
 * A keyPath with no leading `#` (`focusedChild.id`) is not a find at all. A keyPath whose
 * id is interpolated (`` `#${buttonId}.id` ``) arrives here already resolved, because this
 * is handed the string the read actually used.
 */
export function leadingSceneId(keyPath) {
  if (typeof keyPath !== 'string' || !keyPath.startsWith('#')) return null;
  const id = keyPath.slice(1).split('.')[0];
  return id.length ? id : null;
}

/**
 * Is this node CONTAINED IN something hidden? Returns the keyPath of the first hidden
 * ancestor, or null when the chain above it is presented.
 *
 * `visible === false` and `opacity === 0` both count as hidden: sgRouter's "hide" suspend
 * parks a view with `visible = false`, and the app's own reveal machinery
 * (`hideDialogUntilLaidOut`) uses opacity. A node carrying NEITHER field is treated as
 * presented rather than as suspect — 19 of 108 nodes on Home report no `visible` at all
 * (fonts, timers, animations), and flagging those would bury the real signal.
 *
 * ## Why the node ITSELF is deliberately not checked
 *
 * Measured, not reasoned: the first full audited suite produced 19 anomaly records, and
 * 14 of them were `#osd` reported "off-screen" with `hiddenAt` pointing at `…#osd`
 * itself. Those are `waitFor('#osd.visible', (v) => v === false, { label: 'osd hidden' })`
 * — a gate whose whole job is to wait until the OSD IS hidden. Flagging it means flagging
 * a node for being in exactly the state the caller asserted, which is noise that would
 * have taught every reader to skip this line.
 *
 * A node being hidden in its own right is usually the subject of the read. A node being
 * hidden because the VIEW around it was suspended is the defect: that is `waitHome()`
 * passing from a library grid, and it is what the remaining five records caught. Checking
 * strictly upward separates them, and the two `#homeRows` findings survived the change
 * while all fourteen `#osd` false alarms went away.
 *
 * The walk is bounded by the node count: `parentRef` indexes the same flat list and the
 * root reports -1, but a malformed response must not spin.
 */
export function hiddenAncestor(node, byRef) {
  if (!node || typeof node.parentRef !== 'number' || node.parentRef < 0) return null;
  let cur = byRef.get(node.parentRef);
  let hops = 0;
  while (cur && hops++ <= byRef.size) {
    if (cur.visible === false || cur.opacity === 0) return cur.keyPath ?? '';
    if (typeof cur.parentRef !== 'number' || cur.parentRef < 0) return null;
    cur = byRef.get(cur.parentRef);
  }
  return null;
}

/**
 * Classify one census against one id. Pure, so it has tests that need no device.
 *
 * `count: 0` is NOT an anomaly here. A poll reads a keyPath that is legitimately absent
 * on most of its ticks, and this is only ever called once a read has RESOLVED — but a
 * batched read reports a per-key miss as `undefined` without failing, so zero is a
 * reachable and uninteresting state. Reporting it would drown the two findings that
 * matter in noise from every wait that ever polled.
 */
export function classifyResolution(id, flatTree) {
  const byRef = new Map();
  for (const n of flatTree ?? []) byRef.set(n.ref, n);
  const matches = (flatTree ?? []).filter((n) => n.id === id);
  const count = matches.length;
  if (!count) return { id, count, presented: null, hiddenAt: null, subtypes: [] };
  // With a duplicate the winner is a property of tree order, so "which one" is not a
  // question worth answering — the duplication is the finding. Presented-ness is reported
  // for the FIRST match, which is what a depth-first `findNode` reaches first.
  const hiddenAt = hiddenAncestor(matches[0], byRef);
  return {
    id,
    count,
    presented: hiddenAt === null,
    hiddenAt,
    subtypes: [...new Set(matches.map((n) => n.subtype))],
  };
}

/**
 * Take a census and record what the read resolved to. Never throws, never delays a
 * caller that has already got its answer.
 *
 * Swallowing is the right contract for the same reason the readers swallow: this is
 * instrumentation on a path that has already succeeded, and an audit that can fail a
 * green wait is strictly worse than no audit. A census that errors is simply not
 * recorded — it cannot be reported as "clean", because `audited` counts only the ones
 * that produced a record.
 */
export async function auditSceneResolution(keyPath, options) {
  return auditSceneResolutions([keyPath], options);
}

/**
 * The batch form. ONE census answers every keyPath in a batched read, because the census
 * describes the whole scene — asking per id would pay ~30 ms each to re-read the same
 * tree, which is the mistake `getActiveVals` was written to avoid one layer up.
 *
 * It also keeps the observation WINDOW honest for the same reason that docblock gives:
 * the keyPaths in a `getVals` call are read in one device round trip precisely so they
 * describe one frame, and auditing them against N different censuses would compare them
 * against N different frames.
 */
export async function auditSceneResolutions(keyPaths, { label } = {}) {
  if (!auditEnabled()) return;
  const ids = [...new Set((keyPaths ?? []).map(leadingSceneId).filter(Boolean))];
  if (!ids.length) return;
  asked++;
  if (spent >= CENSUS_BUDGET) return;
  spent++;
  try {
    const census = await odc.storeNodeReferences({ nodeRefKey: 'resolutionAudit' });
    for (const id of ids) {
      const verdict = classifyResolution(id, census?.flatTree);
      if (!verdict.count) continue;
      const keyPath = keyPaths.find((k) => leadingSceneId(k) === id);
      recordResolution({ ...verdict, keyPath, label: label ?? keyPath });
    }
  } catch {
    // The device did not answer this census. The reads it describes already succeeded,
    // so there is nothing to fail — and `audited` deliberately does not count it.
  }
}
