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
 * Poll `keyPath` until `predicate(value)` is true, optionally re-issuing
 * `action` (e.g. a keypress) each tick. Throws on timeout so a broken nav/test
 * fails loudly instead of silently proceeding.
 */
export async function waitFor(
  keyPath,
  predicate,
  { timeout = 30000, interval = 500, action, label } = {},
) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    if (action) await action().catch(() => {});
    last = await getVal(keyPath);
    if (predicate(last)) return last;
    await sleep(interval);
  }
  throw new Error(`nav timed out waiting for ${label || keyPath} (last=${JSON.stringify(last)})`);
}

/** Poll the focused node until `predicate({node, keyPath})` is true; throws on timeout. */
export async function waitFocused(predicate, { timeout = 15000, interval = 500, label } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    const f = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
    last = `${f?.node?.subtype}@${f?.keyPath}`;
    if (f && predicate(f)) return f;
    await sleep(interval);
  }
  throw new Error(`nav timed out waiting for focus (${label || 'predicate'}); last=${last}`);
}

/** Home is ready once HomeRows has rendered its content. */
export async function waitHome() {
  await waitFor('#homeRows.content.getChildCount()', hasChildren, {
    label: 'home rows',
    timeout: 20000,
  });
}
