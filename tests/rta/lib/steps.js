/**
 * Low-level RTA step primitives shared by navigation, functional tests, and the
 * screenshot orchestrator. These drive the device through remote keypresses
 * (ecp) and read Scene Graph state (odc). `waitFor` / `waitFocused` poll real
 * node state and THROW on timeout — so they double as assertions: in a Vitest
 * `it()` a thrown timeout fails the test with a descriptive message; don't wrap
 * them in `expect`.
 *
 * Node lookups use RTA's `#id` keyPath (a recursive findNode from the scene root).
 */
import { ecp, odc } from 'roku-test-automation';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const press = (key) => ecp.sendKeypress(key);
export const hasChildren = (n) => typeof n === 'number' && n > 0;

/** Read a scene-rooted keyPath; returns the value or undefined if not present. */
export async function getVal(keyPath) {
  const res = await odc.getValue({ base: 'scene', keyPath }).catch(() => ({ found: false }));
  return res.found ? res.value : undefined;
}

/**
 * Like getVal, but scoped to the ACTIVE routed view (`m.global.activeRoutedView`)
 * rather than a recursive scene-root find. sgRouter keepAlive leaves SUSPENDED views
 * in the scene tree, so a recursive `#id` lookup (getVal) can resolve to a suspended
 * view's node when ids aren't unique — e.g. every ItemDetails has `#extrasGrid`, and
 * several components declare `#options`. Anchoring to activeRoutedView (the app's own
 * "view the user is on", set on open/resume by the JRScreen lifecycle) reads the node
 * on the active screen. Use this for value reads of ids that recur across views.
 */
export async function getActiveVal(keyPath) {
  const res = await odc
    .getValue({ base: 'global', keyPath: `activeRoutedView.${keyPath}` })
    .catch(() => ({ found: false }));
  return res.found ? res.value : undefined;
}

/**
 * Poll `keyPath` until `predicate(value)` is true, optionally re-issuing
 * `action` (e.g. a key press) each tick. Throws on timeout so a broken nav/test
 * fails loudly instead of silently proceeding. `read` selects the reader (default
 * scene-rooted getVal); pass getActiveVal to scope the poll to the active routed view.
 *
 * A failing `action` is counted and named in the timeout message. It is still
 * swallowed per-tick (one dropped press should not fail a nav that recovers), but
 * it must not vanish: an action that never lands and a screen that never renders
 * produce the same "timed out waiting for X" otherwise, and telling those apart
 * after the fact costs hours.
 */
export async function waitFor(
  keyPath,
  predicate,
  { timeout = 30000, interval = 500, action, label, read = getVal } = {},
) {
  const start = Date.now();
  let last;
  let actionErrors = 0;
  while (Date.now() - start < timeout) {
    if (action) await action().catch(() => actionErrors++);
    last = await read(keyPath);
    if (predicate(last)) return last;
    await sleep(interval);
  }
  throw new Error(
    `nav timed out waiting for ${label || keyPath} (last=${JSON.stringify(last)})` +
      (actionErrors ? ` — ${actionErrors} action(s) threw; input may not have been delivered` : ''),
  );
}

/**
 * Poll the focused node until `predicate({node, keyPath})` is true, optionally
 * re-issuing `action` (e.g. a keypress) each tick to walk focus toward a target.
 * Mirrors `waitFor`'s action hook; throws on timeout. Guard the action against
 * overshoot (only press while not yet on target) since focus has no index to clamp.
 */
export async function waitFocused(
  predicate,
  { timeout = 15000, interval = 500, action, label } = {},
) {
  const start = Date.now();
  let last;
  let actionErrors = 0;
  while (Date.now() - start < timeout) {
    if (action) await action().catch(() => actionErrors++);
    const f = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
    last = `${f?.node?.subtype}@${f?.keyPath}`;
    if (f && predicate(f)) return f;
    await sleep(interval);
  }
  throw new Error(
    `nav timed out waiting for focus (${label || 'predicate'}); last=${last}` +
      (actionErrors ? ` — ${actionErrors} action(s) threw; input may not have been delivered` : ''),
  );
}

/** Home is ready once HomeRows has rendered its content. */
export async function waitHome() {
  await waitFor('#homeRows.content.getChildCount()', hasChildren, {
    label: 'home rows',
    timeout: 20000,
  });
}
