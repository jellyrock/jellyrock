// tests/rta/lib/home-list.js — the ONE module allowed to name Home's row lists by id.
//
// Home's active row list is `m.activeContent` (`components/home/Home.bs`): `HomeRows` under
// the Home tab, `FavoritesRows` under Favorites. Only ONE of them is in the scene at a time —
// `onTabChanged` calls `destroyActiveContent()`, which `removeChild`s the old list BEFORE it
// builds the new one — so naming either id directly reads a node that is absent under the
// other tab. Measured on `.177` 2026-09-07 with Favorites selected, the dangerous shape is the
// one that does NOT throw: `#homeRows.content.getChildCount()` resolved in 8 ms to `undefined`,
// which a caller's `|| 0` turns into "Home has no rows" on a Home that is perfectly healthy.
//
// Everything that used to name an id now asks one of two questions instead:
//
//   which list is live?      -> `homeListKeyPaths(suffix)` reads BOTH and takes the answer
//   is focus in Home?        -> `focusIsInHomeContent(focused)` asks the focused node its subtype
//
// ## Why this is its own module rather than part of `steps.js`
//
// Two reasons, and the first is mechanical. `steps.js` imports `diagnosedError` from
// `diagnostics.js`, so `diagnostics.js` cannot import back from `steps.js` — and the failure
// dump needs these keyPaths too. The second is that it makes the gate honest:
// `jellyrock-rta/home-list-resolved` permits these ids in exactly one file at a fixed cap of
// two, and a ~40-line module whose whole job is owning them is a surface a reviewer can check
// at a glance. Allowlisting 1600 lines of `steps.js` would have been the same rule with far
// more room to hide in.

/**
 * The ids Home's active row list can carry, in the order `homeListKeyPaths` probes them.
 *
 * **This array is the only place in the suite either id appears**, and the lint rule exists
 * to keep it that way. Adding a third id here is a real change; naming one anywhere else is
 * the bug the rule reports.
 */
export const HOME_ROW_LIST_IDS = Object.freeze(['#homeRows', '#favoritesRows']);

/**
 * Subtypes Home uses for `m.activeContent`. Focus resting on one of these means the app is
 * still inside Home's content.
 *
 * Positionally aligned with `HOME_ROW_LIST_IDS` — `#homeRows` is a `HomeRows` — which is what
 * lets a presence probe read `subtype()` and prove the node it found by id really IS the row
 * list, rather than some other node that happens to carry the id.
 */
export const HOME_ROW_LIST_SUBTYPES = Object.freeze(['HomeRows', 'FavoritesRows']);

/**
 * Both candidate keyPaths for `suffix`, for a caller that will read them in ONE batch and
 * take whichever answered.
 *
 * Reading both is the point rather than a cost: it is what makes the read independent of the
 * selected tab. One batched `getValues` is a single device round trip (~5.4 ms on `.177`), so
 * asking about two lists costs the same as asking about one and cannot be wrong about which.
 *
 * @param {string} suffix the keyPath BELOW the list, e.g. `content.getChildCount()`
 * @returns {string[]} candidate keyPaths, aligned with `HOME_ROW_LIST_IDS`
 */
export function homeListKeyPaths(suffix) {
  return HOME_ROW_LIST_IDS.map((id) => (suffix ? `${id}.${suffix}` : id));
}

/**
 * Is focus resting on Home's active row list?
 *
 * Asks the focused node its `subtype` rather than testing its keyPath for an id, per
 * `tests/rta/CLAUDE.md` → *Identify a dynamically-created node by `subtype`*: RTA builds a
 * keyPath segment from `node.id` only while that id is non-empty, so an id-keyed predicate
 * stops matching the moment a node is created without one — silently, and by falling through
 * to whatever the caller's `else` does.
 *
 * ## Why an identity test is not weaker than the containment test it replaces
 *
 * `focusIsInside('#homeRows')` asks whether the id appears anywhere in the focused node's
 * keyPath; this asks what the focused node IS. Those differ only if focus can rest on a
 * DESCENDANT of the row list. Probed on `.177` 2026-09-08 at every state the suite's walks
 * reach — immediately after `waitHome()`, after the containment gate, after a Down to row 1
 * and after a Right to column 1 — the focused node was the list itself every time
 * (`subtype: "HomeRows"`, keyPath terminating at `#homeRows`). A `RowList` moves its internal
 * `rowItemFocused` index without handing SceneGraph focus to a child, which is also why
 * `walkHomeToFirstRow` can read `rowItemFocused` straight off the focused node.
 *
 * @param {object|null} focused `odc.getFocusedNode({includeNode:true})`, or null if it failed
 */
export function focusIsInHomeContent(focused) {
  return HOME_ROW_LIST_SUBTYPES.includes(focused?.node?.subtype);
}
