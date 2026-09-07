// Tests for scripts/lint/eslint-rules/rta-home-rows-budgeted.js.
//
// The rule holds a SHRINKING inventory: naming Home's row list by id reads a node that is
// absent under the other tab, so every site is one to be converted and the per-file
// numbers only ever go down. The cases are therefore what it counts, what it must NOT
// count, and each of the three ways a count can disagree with its budget — including the
// direction a ceiling would miss, where a converted site must fail until the table drops.
//
// The filenames are REAL repo paths, deliberately: the budget table is keyed by path, so a
// test on a fictional path would exercise the counting and never the table. Each case
// states the budget it is written against, and the table lives in the rule module.

import path from 'node:path';
import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../../../scripts/lint/eslint-rules/rta-home-rows-budgeted.js';

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

// Budget 1 at the time of writing — `waitHome()`'s second gate.
const STEPS = at('tests/rta/lib/steps.js');
// Budget 1 — the failure dump's `homeRowCount`.
const DIAGNOSTICS = at('tests/rta/lib/diagnostics.js');
// Not in the table, so its budget is zero.
const UNBUDGETED = at('tests/rta/screens.js');

describe('rta-home-rows-budgeted', () => {
  ruleTester.run('home-rows-budgeted', rule, {
    valid: [
      // The overwhelmingly common case: a file that names no row list and has no entry.
      { filename: UNBUDGETED, code: `await waitFocusInside('#itemGrid');` },

      // A COMMENT naming the list is free, in any file. This rule's own module, the debt
      // entry and several docblocks name `#homeRows` many times while explaining why the
      // sites exist — counting prose would make the inventory unmaintainable and would
      // punish documenting the hazard.
      {
        filename: UNBUDGETED,
        code: `// focus must land in #homeRows, not #favoritesRows\nconst x = 1;`,
      },
      {
        filename: UNBUDGETED,
        code: `/** Reads #homeRows.content.getChildCount() when Home is up. */\nconst x = 1;`,
      },

      // Exactly at budget.
      { filename: STEPS, code: `await waitFor('#homeRows.content.getChildCount()', has);` },

      // A resolved list is the shape the conversion moves TO — no literal, so nothing to
      // count, which is what makes the budget able to reach zero.
      {
        filename: UNBUDGETED,
        code: `const list = await activeHomeRows();\nawait waitFor(\`\${list}.content.getChildCount()\`, has);`,
      },

      // Asking the FOCUSED node its subtype is the other sanctioned shape, and it names
      // the SUBTYPE rather than an id — `HomeRows` is not `#homeRows`.
      {
        filename: UNBUDGETED,
        code: `function key(f) { if (HOME_ROW_LIST_SUBTYPES.includes(f?.node?.subtype)) return ecp.Key.Up; }`,
      },
    ],

    invalid: [
      // Over budget — the growth this exists to stop. 21 -> 26 happened without one.
      {
        filename: STEPS,
        code: `await waitFor('#homeRows.content.getChildCount()', has);\nawait waitFocusInside('#homeRows');`,
        errors: [{ messageId: 'overBudget' }],
      },

      // A file with no entry has a budget of zero, so a NEW file cannot quietly join the
      // inventory.
      {
        filename: UNBUDGETED,
        code: `await waitFocusInside('#homeRows');`,
        errors: [{ messageId: 'unbudgetedFile' }],
      },

      // The RATCHET, and the reason the match is exact rather than a ceiling: converting a
      // site must fail until the table is lowered, or a stale-high number silently
      // re-permits the site someone just did the work to remove.
      {
        filename: STEPS,
        code: `await waitFor(\`\${list}.content.getChildCount()\`, has);`,
        errors: [{ messageId: 'staleBudget' }],
      },

      // Converting the LAST site in a file must still report. There is no literal left to
      // hang the message on, so it lands on Program — without that, emptying a file passes
      // silently while emptying all-but-one fails, and the table rots in exactly the case
      // someone earned.
      {
        filename: DIAGNOSTICS,
        code: `const x = 1;`,
        errors: [{ messageId: 'staleBudget' }],
      },

      // A TEMPLATE literal is a site. The interpolated keyPaths in `scanHomeLibraryTiles`
      // are the majority of nav.js's count, so missing these would leave the inventory
      // describing about a third of the real surface.
      {
        filename: UNBUDGETED,
        code: 'const v = await getVal(`#homeRows.content.${r}.${c}.id`);',
        errors: [{ messageId: 'unbudgetedFile' }],
      },

      // ...and it counts ONCE however many holes it carries: the site is the keyPath, not
      // the number of interpolations in it. Budget 1, so a second report would mean this
      // template counted twice.
      {
        filename: STEPS,
        code: 'const v = await getVal(`#homeRows.content.${r}.${c}.${d}.id`);\nawait f("#homeRows");',
        errors: [{ messageId: 'overBudget' }],
      },

      // The SYMMETRY check. Zero sites name `#favoritesRows` today; it is counted because
      // a "conversion" that swapped one hardcoded id for the other would otherwise pass
      // this gate while fixing nothing — the favorites list is equally absent under Home.
      {
        filename: UNBUDGETED,
        code: `await waitFocusInside('#favoritesRows');`,
        errors: [{ messageId: 'unbudgetedFile' }],
      },
    ],
  });
});
