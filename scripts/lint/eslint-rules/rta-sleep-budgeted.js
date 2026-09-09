// scripts/lint/eslint-rules/rta-sleep-budgeted.js — the RTA suite's arbitrary waits are a
// fixed, declared inventory, and this rule keeps them that way.
//
// WHY THIS EXISTS
// ---------------
// `roku-test-automation`'s README says arbitrary waiting "is almost never needed", and
// `tests/rta/CLAUDE.md`'s north star says it more sharply: a flake is never to be papered
// over with a longer timeout or a fixed `sleep`, because the wait was not timing out — it
// was succeeding too early. Every surviving `sleep()` in this suite therefore carries an
// argument for why no signal was available to gate on instead (see
// `tests/rta/CLAUDE.md` → "Why the surviving sleeps are not arbitrary waits").
//
// The failure guarded is a process failure, not a code shape: someone hits a flake at
// 5pm, adds `await sleep(2000)`, and the suite goes green. Nothing in review distinguishes
// that from the ten legitimate paint settles it sits next to — they are the same three
// tokens. What separates them is whether anyone argued the case, and an argument is
// exactly what a diff does not show.
//
// WHAT IT CHECKS
// --------------
// A `sleep()` lexically inside a loop is a POLL TICK, not an arbitrary wait: the loop
// exits on its own predicate and the interval only sets sampling cadence. Those prove
// themselves from syntax and are never counted — which is also why `lib/steps.js`, the
// file that owns the wait primitives, has a budget of zero while containing seven
// `sleep()` calls.
//
// Every OTHER `sleep()` is a bare arbitrary wait and is counted against its file's entry
// in `BUDGETS` below.
//
// WHY A PER-FILE BUDGET RATHER THAN A PER-SITE TAG
// ------------------------------------------------
// The sibling rule (`rta-wait-justified`) ratchets on the FIELD, because "this field is
// not a pulse" is a reusable fact: verify `#osd.visible` once and every wait on it
// inherits the check. Arbitrary waits have no such key — the argument is a property of
// the call site's PURPOSE, and most of the sites are anonymous spec arrows with no
// stable name to hang an allowlist on. The alternative was a `// sleep: <category>` tag
// on every one, and Phase 3 had already rejected that shape for the settle waits:
// annotations that say nothing a reader of the code needs.
//
// A count is the cheapest thing that still fires at the right moment. It cannot say WHICH
// argument a site claims — the prose in `tests/rta/CLAUDE.md` does that, per category —
// but it makes adding a thirty-third arbitrary wait a deliberate act with a second file
// to edit and a reviewer-visible diff, which is the whole failure being guarded.
//
// The match is EXACT, not a ceiling. A stale-high budget would silently re-permit a sleep
// that someone had already done the work to remove, so deleting one is meant to fail this
// rule until the table is lowered to match. That keeps the table an INVENTORY rather than
// a ceiling that only ever drifts upward.

import { relativeFilename, calleeName } from './_shared.js';

const DOC = 'tests/rta/CLAUDE.md → "Why the surviving sleeps are not arbitrary waits"';

/**
 * Bare (non-poll-tick) `sleep()` calls per file, as inventoried from the AST on
 * 2026-09-05. Each file's sites are argued by category in the doc above; the categories
 * are summarised here only far enough to say why the number is not zero.
 *
 * A file absent from this table has a budget of ZERO — a new file that needs an arbitrary
 * wait has to be added here deliberately, which is the point.
 *
 * TO CHANGE A NUMBER: say which category the new site falls in, and if it falls in none,
 * that is the finding — gate on a signal instead. Adding a row here to silence a flake is
 * the exact move this rule exists to make visible.
 */
export const BUDGETS = new Map([
  // App lifecycle: the channel is down or coming up, so ODC cannot answer at all. There
  // is no signal to gate on until the app exists.
  ['tests/rta/lib/driver.js', 4],

  // Paint/texture settle after a `waitFor` gate has already passed, on navs SHARED with
  // the store-screenshot path. The app's only load-completion signal is the `cellLoad*`
  // counter family, which is `#if perfTiming` — and `scripts/harden-prod-manifest.js`
  // forces that const off in `build:prod`, which is what `screenshots:capture` runs. So
  // on the path these serve there is provably no field to read.
  //
  // 12 before Phase 6b. The two it lost were the pre-action settles: the wait before
  // `sendText` now gates on the search keyboard holding focus, and the one before the
  // first OSD press went away with `waitOsdUp`, whose own state gate already established
  // the app's precondition for accepting that key.
  ['tests/rta/lib/nav.js', 10],
  ['scripts/capture-screenshots.js', 1],

  // Timer-window waits: out-wait a period to prove a NON-EVENT (a dialog that must
  // survive its own 5 s auto-hide, a deep link that must not re-navigate) or to catch a
  // periodic refresh. Ungateable by construction — the only signal would be the very
  // thing being disproven.
  ['tests/rta/specs/deeplink.spec.js', 2],
  ['tests/rta/specs/genre-skeleton.spec.js', 1],

  // Timer-window non-events only, since Phase 6b: a dialog that must survive its own 5 s
  // auto-hide, and a Back that must not exit before it. The four pre-action settles that
  // shared this entry are gone — two through `waitOsdUp`, two through `waitFocusInside`.
  ['tests/rta/specs/dialogs.spec.js', 2],

  // Asynchronous teardown that no app field reports — see `retainedAfter`'s docblock.
  ['tests/rta/specs/leaks.spec.js', 1],

  // Measurement windows: the dwell IS the quantity being measured, so gating it on a
  // signal would change what is measured.
  ['tests/rta/specs/task-ledger-screen-cost.spec.js', 1],
  ['tests/rta/specs/task-thread-peak.spec.js', 1],

  // Demo footage: `hold(ms, label)` is a shot-list beat for the camera, not a wait for
  // app state. Not a test.
  ['tests/rta/demos/run.mjs', 1],
]);

const LOOP_TYPES = new Set([
  'WhileStatement',
  'DoWhileStatement',
  'ForStatement',
  'ForOfStatement',
  'ForInStatement',
]);

/**
 * Is this call lexically inside a loop, and therefore a poll tick rather than an
 * arbitrary wait?
 *
 * Deliberately does NOT stop at a function boundary. A `sleep()` inside a callback that
 * is itself inside a loop is still paced by that loop, and the suite has no case where
 * the distinction would change the answer — treating it as bare would count a tick.
 */
function insideLoop(ancestors) {
  return ancestors.some((a) => LOOP_TYPES.has(a.type));
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        "The RTA suite's arbitrary waits are a declared inventory: a `sleep()` outside a " +
        'poll loop is counted against a per-file budget, so adding one is a deliberate act.',
    },
    schema: [],
    messages: {
      overBudget:
        'RTA arbitrary wait: {{file}} now has {{actual}} bare `sleep()` call(s) against a ' +
        'budget of {{budget}}. A fixed sleep is the thing this suite forbids as a fix for ' +
        'a flake — the wait was not timing out, it was succeeding too early. Gate on the ' +
        'state that makes the next step meaningful instead. If this wait genuinely has no ' +
        'signal to gate on, say which category it falls in, then raise the budget in ' +
        'scripts/lint/eslint-rules/rta-sleep-budgeted.js. See ' +
        DOC +
        '.',
      unbudgetedFile:
        'RTA arbitrary wait: {{file}} is not in the arbitrary-wait inventory, so its ' +
        'budget is zero, but it has {{actual}} bare `sleep()` call(s). A `sleep()` inside ' +
        'a poll loop is a tick and is never counted; this one is not in a loop. Gate on a ' +
        'signal, or add the file to BUDGETS with the reason. See ' +
        DOC +
        '.',
      staleBudget:
        'RTA arbitrary wait: {{file}} has {{actual}} bare `sleep()` call(s) but its budget ' +
        'is {{budget}}. Lower it to {{actual}} in ' +
        'scripts/lint/eslint-rules/rta-sleep-budgeted.js. The table is an INVENTORY, not a ' +
        'ceiling: leaving it high silently re-permits a wait someone already removed. See ' +
        DOC +
        '.',
    },
  },

  create(context) {
    const file = relativeFilename(context);
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    const bare = [];

    return {
      CallExpression(node) {
        const name = calleeName(node);
        if (name !== 'sleep') return;

        // A poll tick proves itself from syntax — the loop owns the exit condition.
        const ancestors = sourceCode.getAncestors ? sourceCode.getAncestors(node) : [];
        if (insideLoop(ancestors)) return;

        bare.push(node);
      },

      // Reported at the end so the count is the FILE's, not a running total: the message
      // that helps says how many there are against how many are budgeted.
      'Program:exit'(program) {
        const budget = BUDGETS.get(file);

        // The overwhelmingly common case — a file with no arbitrary waits and no entry.
        if (bare.length === 0 && budget === undefined) return;

        const data = { file, actual: String(bare.length), budget: String(budget ?? 0) };

        // A budgeted file emptied of its sleeps is still a stale entry, and it has no
        // `sleep` node left to hang the report on. Reported on Program rather than
        // skipped: dropping it would mean removing the LAST arbitrary wait in a file
        // passes silently while removing the second-to-last fails, so the table would
        // rot in exactly the case someone did the most work to earn.
        if (bare.length === 0) {
          context.report({ node: program, messageId: 'staleBudget', data });
          return;
        }

        if (budget === undefined) {
          context.report({ node: bare[0], messageId: 'unbudgetedFile', data });
          return;
        }
        if (bare.length > budget) {
          context.report({ node: bare[budget], messageId: 'overBudget', data });
          return;
        }
        if (bare.length < budget) {
          context.report({ node: bare[0], messageId: 'staleBudget', data });
        }
      },
    };
  },
};
