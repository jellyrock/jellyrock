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

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { RuleTester } from 'eslint';
import rule, { BUDGETS } from '../../../../scripts/lint/eslint-rules/rta-sleep-budgeted.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('BUDGETS is an inventory of files that exist', () => {
  // The rule's exact-match design catches a REMOVED sleep — but only in a file ESLint
  // still visits. Delete or rename a budgeted file and its row survives unreported
  // forever, because there is nothing left for `Program:exit` to fire on. That is the
  // "table rots" failure the rule's own header argues against, in the one direction the
  // rule structurally cannot see, so it is checked here instead.
  it.each([...BUDGETS.keys()])('%s still exists', (file) => {
    expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(true);
  });
});

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

      // Removing one leaves the table overstating the inventory. The code carries one
      // FEWER sleep than the file's entry allows — stated as a relationship rather than a
      // hardcoded count, because pinning it to a literal is what broke this case when
      // Phase 6b lowered `dialogs.spec.js` from 6 to 2 and five sleeps stopped being
      // "one short" and started being over budget.
      {
        filename: at('tests/rta/specs/dialogs.spec.js'),
        code: `async function f() { await sleep(1); }`,
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
