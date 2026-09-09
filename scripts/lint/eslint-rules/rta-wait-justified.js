// scripts/lint/eslint-rules/rta-wait-justified.js — every RTA `waitFor` must fall in a
// justified category.
//
// WHY THIS EXISTS
// ---------------
// `roku-test-automation` ships an observer primitive (`onFieldChangeOnce`), and the
// harness polls instead. That is a deviation from the library's documented practice, so
// the project's bar is that every wait either follows that practice or carries a written
// justification for why it deviates. Four categories carry those justifications (see
// `tests/rta/CLAUDE.md` → "Why every wait polls"); this rule makes it impossible for a
// wait to land in NONE of them without someone noticing.
//
// The failure it guards is specific and quiet: a poll can only miss a state that is a
// one-shot PULSE — entered and left inside one interval. Such a wait does not fail
// loudly, it fails RARELY, and the timeout blames whatever it was watching. That is the
// symptom #785 recorded as unattributable, which is why "it works" was ruled out as a
// justification in the first place.
//
// WHAT IT CHECKS, AND WHAT IT DELIBERATELY CANNOT
// -----------------------------------------------
// Three categories prove themselves from the call's own syntax:
//
//   FN     first argument is a function keyPath (`...getChildCount()`, `subtype()`).
//          ODC observes a FIELD; a function call is not one, so the primitive cannot
//          apply at all.
//   ABS    the predicate tests `=== undefined` / `=== null`. The node is gone, and a
//          departed node has no field to observe.
//   ACT    an `action` option is present. The per-tick re-press IS the mechanism (see
//          `resendIfSwallowed` in `tests/rta/lib/steps.js`); an observer would sit and
//          watch for a key that never landed.
//
// The fourth cannot. "This field is not a pulse" is a claim about how the APP writes it,
// which no parser can see — it is established by reading the app source. So the rule
// ratchets on the FIELD rather than on the call site: a keyPath in
// `VERIFIED_SETTLE_KEYPATHS` has been checked and inherits that check for free, and a
// keyPath that has not trips the gate.
//
// That asymmetry is the point. Adding a sixth `#osd.visible` wait costs nothing, because
// the expensive part was verifying `#osd.visible` once. Adding a wait on a field nobody
// has checked is exactly when the verification is owed, and that is when this fires.
//
// A wait whose keyPath is a runtime value cannot be classified here at all; its
// justification belongs in the JSDoc of the helper that owns it, and the call site
// disables this rule with a reason — the same escape hatch `no-restricted-syntax` uses
// for a named fail-fast in these files.

import { calleeName, walkAst } from './_shared.js';

/**
 * KeyPaths whose target states have been read in the app source and found to be
 * non-transient at the poll intervals these waits use — each is either TERMINAL (held
 * until the next user action) or RECURRENT (re-entered if a tick misses it). Neither can
 * be missed by a poll; only a one-shot pulse can.
 *
 * Verified 2026-09-05 against the app source, one entry per distinct keyPath. Two are
 * worth naming because they could plausibly have gone the other way and did not:
 *
 *   - `...#buttonBorder.blendColor` is assigned DIRECTLY on focus change
 *     (`components/ui/button/TextButton.bs`) — no interpolator, so the focus/idle colors
 *     are step values that hold, not frames of an animation a poll could sample between.
 *   - `#scrollContent.translation` is likewise a direct assignment
 *     (`components/OverviewDialog.bs`), and the predicate reads "has scrolled at all"
 *     (`t[1] < 0`), which stays true once true.
 *
 * `state` is the RECURRENT one: Roku's `Video.state` re-enters `playing` after a
 * mid-stream rebuffer, so it is not terminal — but a tick that misses it gets another.
 *
 * The one state in the suite that IS a pulse is `loadState === 'skeleton'`, and it is not
 * waited for bare: `genre-skeleton.spec.js` widens the window first through the
 * `rtaSkeletonHoldMs` hook (`components/ItemGrid/LoadItemsTask2.bs`, compiled in only
 * under `ENABLE_RTA`). `loadState` is listed here because its other use waits for
 * `'loaded'`, which is terminal; the skeleton site is safe because of the hook, not
 * because the field never pulses.
 *
 * TO ADD AN ENTRY: read where the app writes the field, confirm the target state is
 * terminal or recurrent rather than a pulse, and say which in a comment if it is not
 * obvious. Do not add a keyPath you have not read the app source for — an unverified
 * entry is worse than a failing lint, because it looks like it was checked.
 */
const VERIFIED_SETTLE_KEYPATHS = new Set([
  '#buttons.buttonFocused',
  // `ItemDetails.bs` assigns `m.extrasGrid.type = item.type` on content load and on an
  // explicit extras refresh, and never clears it — terminal for the life of that
  // content, so a poll cannot miss it. Read against the app source 2026-09-06, both
  // assignment sites. Note it is NOT set when `item.type = "Person"` (both sites branch
  // to `loadPersonVideos` instead); the only gate using it is
  // `openFirstGridTileDetail`, whose three callers open Series / MusicAlbum |
  // MusicArtist / Playlist, so that branch is unreachable from it.
  '#extrasGrid.type',
  // Not an app field: `scripts/capture-screenshots.js` injects this Poster over ODC and
  // waits for its image to decode. Roku's docs (dev-doc v2.0,
  // REFERENCES/scenegraph/renderable-nodes/poster.md) define `loadStatus` as READ_ONLY
  // over `none -> loading -> ready | failed`, and `ready` holds until the `uri` changes.
  // Worth stating plainly: this is the one field in the inventory whose documentation
  // explicitly suggests an OBSERVER ("set an observer so that when the field value
  // changes to ready, an action can be triggered"). The poll is justified not because an
  // observer could not work, but because `ready` is terminal, so the two are equivalent
  // here — and the call site treats the whole wait as best-effort (`.catch(() => {})`),
  // since a backdrop that never decodes should not fail a screenshot run.
  '#rtaBackdrop.loadStatus',
  '#extrasGrid.rowItemFocused',
  '#imageFader.uri',
  '#jrDialog.#okButton.#buttonBorder.blendColor',
  '#jrDialog.#scrollContent.translation',
  '#jrDialog.id',
  '#jrDialog.sections',
  '#optionList.itemFocused',
  '#osd.visible',
  '#quickConnectCode.text',
  '#scrollContent.translation',
  '#scrollTrack.visible',
  '#trickplayCarousel.isVisible',
  '#userRow',
  '#versionLabel.text',
  '#videoTitle.text',
  'itemId',
  'loadState',
  'state',
]);

const DOC = 'tests/rta/CLAUDE.md → "Why every wait polls"';

/** The literal string a node denotes, or null if it is not a static string. */
function staticString(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  // A template literal with no interpolation is still a static string; one WITH
  // interpolation is a runtime value and is treated as such.
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

/** Does this options object literal carry an `action` property? */
function hasActionOption(node) {
  if (!node || node.type !== 'ObjectExpression') return false;
  return node.properties.some(
    (p) => p.type === 'Property' && !p.computed && (p.key.name ?? p.key.value) === 'action',
  );
}

/**
 * Does the predicate test for absence? Walks the predicate's own subtree looking for a
 * `=== undefined` / `=== null` comparison. Scoped to the predicate argument, so an
 * `undefined` check elsewhere in the call cannot wave a wait through.
 */
function testsForAbsence(node) {
  let found = false;
  walkAst(node, (n) => {
    if (found) return;
    if (n.type === 'BinaryExpression' && (n.operator === '===' || n.operator === '==')) {
      for (const side of [n.left, n.right]) {
        if (side.type === 'Identifier' && side.name === 'undefined') found = true;
        if (side.type === 'Literal' && side.value === null && side.raw === 'null') found = true;
      }
    }
  });
  return found;
}

/**
 * The categories a `waitFor` can land in, in the order they are tested.
 *
 * `UNVERIFIED` is the failing residual — the rule reports it, and a passing lint run
 * therefore has none. That is what lets the inventory checker treat a non-zero count as
 * its own bug rather than as a number to print.
 */
export const WAIT_CATEGORIES = Object.freeze({
  ACT: 'ACT',
  DYN: 'DYN',
  FN: 'FN',
  ABS: 'ABS',
  SETTLE: 'SETTLE',
  UNVERIFIED: 'UNVERIFIED',
});

/**
 * Which category does this `CallExpression` fall in? `null` when it is not a `waitFor`
 * call at all.
 *
 * EXPORTED, and the rule below is one of its two callers — the other is
 * `scripts/lint/rta-wait-inventory.js`, which counts the categories the wait inventory in
 * `tests/rta/CLAUDE.md` publishes. They must not be able to answer differently: a checker
 * with its own copy of this ladder would drift from the gate, and the doc would then be
 * verified against something other than the rule it claims to describe. Same argument, and
 * the same fix, as `scripts/lib/process-liveness.cjs` and `_shared.js` in this directory.
 *
 * The ORDER is load-bearing and is the rule's, not a convenience: `ACT` holds whatever the
 * keyPath looks like, and a dynamic keyPath cannot be classified further.
 */
export function classifyWait(node) {
  if (calleeName(node) !== 'waitFor' || !node.arguments?.length) return null;

  const [keyPathArg, predicateArg] = node.arguments;
  const options = node.arguments.length > 2 ? node.arguments[2] : null;

  // ACT — the per-tick re-press is the mechanism. Checked first because it holds
  // whatever the keyPath looks like.
  if (hasActionOption(options)) return { category: WAIT_CATEGORIES.ACT, keyPath: null };

  const keyPath = staticString(keyPathArg);
  if (keyPath === null) return { category: WAIT_CATEGORIES.DYN, keyPath: null };

  // FN — ODC observes a field, and a function call is not one.
  if (keyPath.includes('()')) return { category: WAIT_CATEGORIES.FN, keyPath };

  // ABS — the node is gone; there is nothing left to observe.
  if (testsForAbsence(predicateArg)) return { category: WAIT_CATEGORIES.ABS, keyPath };

  // SETTLE — the residual, justified per FIELD rather than per site.
  if (VERIFIED_SETTLE_KEYPATHS.has(keyPath)) return { category: WAIT_CATEGORIES.SETTLE, keyPath };

  return { category: WAIT_CATEGORIES.UNVERIFIED, keyPath };
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Every RTA `waitFor` must fall in a justified category: a function keyPath, a ' +
        'test for absence, an `action` retry loop, or a keyPath verified not to pulse.',
    },
    schema: [],
    messages: {
      unverifiedField:
        'RTA wait: `{{keyPath}}` is not in VERIFIED_SETTLE_KEYPATHS. A poll can only miss ' +
        'a state that is entered and left inside one interval, so read where the app ' +
        'writes this field and confirm the target state is terminal (held until the next ' +
        'user action) or recurrent (re-entered if a tick misses it) — then add it to the ' +
        'list in scripts/lint/eslint-rules/rta-wait-justified.js. If it IS a pulse, widen ' +
        'the window in the app under `#if ENABLE_RTA` the way `rtaSkeletonHoldMs` does. ' +
        'See ' +
        DOC +
        '.',
      dynamicKeyPath:
        'RTA wait: this keyPath is a runtime value, so its justification cannot be checked ' +
        'here. Put it in the JSDoc of the helper that owns the wait and disable this rule ' +
        'on the line with that reason. See ' +
        DOC +
        '.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        // The ladder itself lives in `classifyWait` so the inventory checker shares it —
        // see that function. Only the two REPORTING categories are handled here; the four
        // justified ones are silence, exactly as before.
        const verdict = classifyWait(node);
        if (!verdict) return;
        const keyPathArg = node.arguments[0];

        if (verdict.category === WAIT_CATEGORIES.DYN) {
          context.report({ node: keyPathArg, messageId: 'dynamicKeyPath' });
          return;
        }
        if (verdict.category === WAIT_CATEGORIES.UNVERIFIED) {
          context.report({
            node: keyPathArg,
            messageId: 'unverifiedField',
            data: { keyPath: verdict.keyPath },
          });
        }
      },
    };
  },
};
