// Tests for scripts/lint/eslint-rules/rta-sleep-budgeted.js.
//
// The rule's value is that it separates a POLL TICK (a `sleep` inside a bounded loop,
// which is cadence and proves itself from syntax) from an ARBITRARY WAIT (everything
// else, which needs an argument), and then holds the second population to a declared
// per-file count. So the cases are that boundary plus each way the count can be wrong.
//
// The filenames are REAL repo paths, deliberately: the budget table is keyed by path, so
// a test on a fictional path would exercise the counting and never the table. Each case
// states the budget it is written against, and the table lives in the rule module.

import path from 'node:path';
import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../../../scripts/lint/eslint-rules/rta-sleep-budgeted.js';

// RuleTester drives its own describe/it; hand it Vitest's so failures land in the normal
// reporter. Must run at module scope — `ruleTester.run()` registers its cases while the
// describe callback below is being evaluated.
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

/** An absolute path, since the rule relativises against cwd to key the budget table. */
const at = (relativePath) => path.join(process.cwd(), relativePath);

// Budget 1 at the time of writing — a single async-teardown wait in `retainedAfter`.
const LEAKS = at('tests/rta/specs/leaks.spec.js');
// Not in the table, so its budget is zero.
const UNBUDGETED = at('tests/rta/screens.js');

describe('rta-sleep-budgeted', () => {
  ruleTester.run('sleep-budgeted', rule, {
    valid: [
      // A poll tick — the loop owns the exit condition, so the interval is cadence, not
      // an arbitrary wait. Free in ANY file, including one with no budget entry.
      {
        filename: UNBUDGETED,
        code: `async function f() { while (Date.now() < end) { if (await read()) return; await sleep(500); } }`,
      },
      {
        filename: UNBUDGETED,
        code: `async function f() { for (let i = 0; i < 10; i++) { await press(); await sleep(300); } }`,
      },
      {
        filename: UNBUDGETED,
        code: `async function f() { for (;;) { if (await scan()) break; await sleep(POLL_MS); } }`,
      },
      // A tick inside a callback that is itself inside a loop is still paced by the loop.
      {
        filename: UNBUDGETED,
        code: `async function f() { for (const x of xs) { await run(async () => { await sleep(10); }); } }`,
      },

      // Exactly at budget.
      { filename: LEAKS, code: `async function f() { await walk(); await sleep(3000); }` },

      // A file with no sleeps and no budget entry — by far the common case.
      { filename: UNBUDGETED, code: `export const SCREENS = [{ name: 'home' }];` },

      // Not our call.
      { filename: UNBUDGETED, code: `async function f() { await settle(1000); }` },
    ],

    invalid: [
      // The case the rule exists for: one more arbitrary wait than was argued for.
      {
        filename: LEAKS,
        code: `async function f() { await sleep(3000); await sleep(2000); }`,
        errors: [{ messageId: 'overBudget' }],
      },

      // A `sleep` reached through a member expression is still a sleep — otherwise
      // `utils.sleep(2000)` would be a silent way around the whole gate.
      {
        filename: LEAKS,
        code: `async function f() { await sleep(3000); await utils.sleep(2000); }`,
        errors: [{ messageId: 'overBudget' }],
      },

      // A new file that grows an arbitrary wait has to be added to the table on purpose.
      {
        filename: UNBUDGETED,
        code: `async function f() { await sleep(1000); }`,
        errors: [{ messageId: 'unbudgetedFile' }],
      },

      // Removing one leaves the table overstating the inventory.
      {
        filename: at('tests/rta/specs/dialogs.spec.js'), // budget 6
        code: `async function f() { await sleep(1); await sleep(2); await sleep(3); await sleep(4); await sleep(5); }`,
        errors: [{ messageId: 'staleBudget' }],
      },

      // Removing them ALL is the case that would rot silently if the rule bailed out on
      // an empty file: it has a budget, so the entry is still stale and must be lowered.
      {
        filename: LEAKS,
        code: `async function f() { await gateOnASignal(); }`,
        errors: [{ messageId: 'staleBudget' }],
      },

      // A loop-paced tick does not earn budget for a bare one in the same file: the
      // bare call is still counted, the tick still is not.
      {
        filename: UNBUDGETED,
        code: `async function f() { for (;;) { await sleep(100); } await sleep(2000); }`,
        errors: [{ messageId: 'unbudgetedFile' }],
      },
    ],
  });
});
